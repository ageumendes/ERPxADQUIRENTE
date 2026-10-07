import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { aplicarSchemaBanco } from '../src/database/bootstrap.js';
import { sincronizarVinculosPixSipagSicoobTx, validarElegibilidadeConciliacao, PIX_FINANCEIRO_SQL } from '../src/services/pix-vinculos.js';
import { listarArquivosRecursivos, caminhoDentroPastas } from '../src/services/arquivos-recuperacao.js';
import { validarConfiguracaoProducao } from '../src/config/producao.js';
import { lerExcelIsolado } from '../src/services/excel-isolado.js';

test('PostgreSQL embarcado: migrações, fontes PIX, relatório, manual e desfazimento atômico', async () => {
  // Executa SQL real do PostgreSQL sem servidor/socket. Não simula concorrência de conexões.
  const pg = new PGlite();
  const query = async (sql: string, params: unknown[] = []) => {
    const r = await pg.query(sql, params);
    return {rows:r.rows,rowCount:r.rows.length || r.affectedRows || 0};
  };
  const oldQuery=Pool.prototype.query, oldConnect=Pool.prototype.connect, oldEnd=Pool.prototype.end;
  (Pool.prototype as any).query=query;
  (Pool.prototype as any).connect=async()=>({query,release(){}});
  (Pool.prototype as any).end=async()=>{};
  process.env.DATABASE_URL='postgresql://test:test@localhost/erp_test_embedded';
  try {
    await aplicarSchemaBanco({query} as any);
    await aplicarSchemaBanco({query} as any); // Repetir o bootstrap não apaga registros ou regras.
    const repo = await import('../src/repositories/repositorio.js');
    await repo.prepararConsultasOtimizadas();
    const insert = async (id: string, adquirente: string, extra:Record<string,unknown>={}) => {
      const dados={id,adquirente,modalidade:'PIX',data_venda:'2026-10-02',hora_venda:'10:00:00',
        codigo_estabelecimento:'SRG',cnpj_estabelecimento:'SRG',nsu:'E00000000202610020000000000000001',
        valor_bruto:'10.00',valor_taxa:'0.00',valor_liquido:'10.00',status_transacao:'AUTORIZADO',
        dados_json:{},...extra};
      await query('INSERT INTO vendas_adquirentes(row_id,hash_linha,dados) VALUES($1,$1,$2::jsonb)',[id,JSON.stringify(dados)]);
    };
    const sync=async()=>pg.transaction(async t=>sincronizarVinculosPixSipagSicoobTx({
      $executeRawUnsafe:async(sql,...p)=>{await t.query(sql,p);},
      $queryRawUnsafe:async(sql,...p)=>(await t.query(sql,p)).rows,
    }));
    await insert('bloqueado-doc','CIELO',{modalidade:'DEBITO',pagador_documento:'  não aplica  ',valor_bruto:'999.00'});
    await insert('negado-teste','CIELO',{modalidade:'DEBITO',status_transacao:'NEGADO',nsu:'N-NEGADO'});
    const autorizados = await repo.listarCandidatosConciliacaoManual('ADQUIRENTE');
    assert.equal(autorizados.total_linhas, 0);
    const negados = await repo.listarCandidatosConciliacaoManual('ADQUIRENTE',80,0,'','','','','','','NEGADO');
    assert.equal(negados.total_linhas, 1);
    assert.equal(negados.linhas[0].id,'negado-teste');
    assert.deepEqual(negados.opcoes_status, ['NEGADO']);
    const todos = await repo.listarCandidatosConciliacaoManual('ADQUIRENTE',80,0,'','','','','','','');
    assert.equal(todos.total_linhas,1);
    const tabela = await repo.obterDadosTabela('vendas_adquirentes');
    assert.ok(tabela);
    assert.ok(!tabela.linhas.some((v:any)=>v.id==='bloqueado-doc'));
    await assert.rejects(repo.criarConciliacaoManual('','bloqueado-doc','teste',{},true), /NÃO APLICA/);
    await assert.rejects(repo.criarConciliacaoManual('','negado-teste','teste',{},true), /autorizada/);
    assert.equal(((await query("SELECT dados FROM vendas_adquirentes WHERE row_id='bloqueado-doc'")).rows[0] as any).dados.pagador_documento,'  não aplica  ');
    await insert('sipag-pix','SIPAG');
    await sync();
    await insert('sicoob-pix','SICOOB');
    await sync();
    const rows=await query('SELECT row_id,dados FROM vendas_adquirentes ORDER BY row_id');
    assert.equal((rows.rows.find((r:any)=>r.row_id==='sicoob-pix') as any).dados.pix_redundante,'NAO');
    assert.equal((rows.rows.find((r:any)=>r.row_id==='sipag-pix') as any).dados.pix_redundante,'SIM');
    const total=await query(`SELECT SUM((dados->>'valor_bruto')::numeric)::text AS total FROM vendas_adquirentes WHERE dados->>'modalidade'='PIX' AND ${PIX_FINANCEIRO_SQL()}`);
    assert.equal((total.rows[0] as any).total,'10.00');
    const report=await repo.gerarRelatorioAdquirentes({data_inicio:'2026-10-02',data_fim:'2026-10-02'});
    assert.equal(report.resumo.total_bruto,10);
    assert.equal(report.resumo.quantidade_transacoes,2); // PIX principal + registro negado; NÃO APLICA não participa.
    const lista = await repo.listarVendasAdquirentesComExibicao(500,0,{});
    assert.ok(!lista.linhas.some((v:any)=>v.id==='bloqueado-doc'));
    await query('INSERT INTO vendas_interdata(row_id,hash_linha,dados) VALUES($1,$1,$2::jsonb)', ['erp-1',JSON.stringify({id:'erp-1',data_venda:'2026-10-02',hora_venda:'10:00:00',cnpj_estabelecimento:'SRG',valor_bruto:'10.00',tipo_produto:'PIX'})]);
    await assert.rejects(repo.criarConciliacaoManual('erp-1','sipag-pix','teste'), /PIX complementar/);
    const manual=await repo.criarConciliacaoManual('erp-1','sicoob-pix','teste');
    assert.equal(manual.conciliacao.status,'CONCILIADO');
    await assert.rejects(repo.criarConciliacaoManual('erp-1','sipag-pix','teste'),/PIX complementar/);
    // Falha de histórico deve reverter também a alteração de estado.
    await query(`CREATE FUNCTION bloquear_historico_242() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'historico_indisponivel'; END $$`);
    await query(`CREATE TRIGGER bloquear_historico_242 BEFORE INSERT ON historico_conciliacoes FOR EACH ROW EXECUTE FUNCTION bloquear_historico_242()`);
    await assert.rejects(repo.desfazerConciliacao(manual.conciliacao.id,'teste'),/historico_indisponivel/);
    const estado=await query('SELECT status FROM conciliacoes WHERE row_id=$1',[manual.conciliacao.id]);
    assert.equal((estado.rows[0] as any).status,'CONCILIADO');
    await query('DROP TRIGGER bloquear_historico_242 ON historico_conciliacoes');
    await repo.desfazerConciliacao(manual.conciliacao.id,'teste');
    assert.equal(((await query("SELECT dados FROM vendas_adquirentes WHERE row_id='sicoob-pix'")).rows[0] as any).dados.pix_fonte_primaria,'SICOOB');
    assert.equal((await query('SELECT * FROM historico_conciliacoes')).rows.length,2);
    await query("DELETE FROM vendas_adquirentes WHERE row_id='sipag-pix'");
    await sync();
    assert.equal(((await query("SELECT dados FROM vendas_adquirentes WHERE row_id='sicoob-pix'")).rows[0] as any).dados.pix_operacao_compartilhada,undefined);
    // Paginação usa pk crescente, mesmo com parcelas heterogêneas em mais de um lote.
    await query('DELETE FROM vendas_interdata WHERE row_id=$1',['erp-1']);
    for(let i=1;i<=102;i++) await query('INSERT INTO vendas_interdata(row_id,hash_linha,dados) VALUES($1,$1,$2::jsonb)', ['pag-'+i,JSON.stringify({id:'pag-'+i,data_venda:'2026-10-02',cnpj_estabelecimento:'SRG',valor_bruto:'999.00',tipo_produto:'DEBITO',parcelas:i<=2?'1':'3'})]);
    const resultado=await repo.executarConciliacaoAutomatica({simular:true,tamanhoLote:100});
    assert.equal((resultado as any).avaliados.vendas_interdata,102);
  } finally {
    Pool.prototype.query=oldQuery;Pool.prototype.connect=oldConnect;Pool.prototype.end=oldEnd;
    await pg.close();
  }
});

test('elegibilidade bloqueia não autorizados, duplicados, NÃO APLICA e conflitos PIX', () => {
  for(const patch of [{status_transacao:'NEGADO'},{pix_redundante:'SIM'},{pix_vinculo_conflito:'AMBOS_CONCILIADOS'},
    {duplicidade_status:'DUPLICADO_PROVAVEL'},{codigo_estabelecimento:'NÃO APLICA'},{utilidade_status:'NAO_UTIL'}]) {
    assert.throws(()=>validarElegibilidadeConciliacao({status_transacao:'AUTORIZADO',...patch},'ADQUIRENTE'));
  }
});

test('recuperação encontra arquivos em subpastas e ignora links simbólicos', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'erp242-recovery-'));
  try {
    await fs.mkdir(path.join(dir,'_uploads','lote'),{recursive:true});
    await fs.writeFile(path.join(dir,'_uploads','lote','arquivo.txt'),'ok');
    await fs.symlink('/etc/passwd',path.join(dir,'link'));
    const files=await listarArquivosRecursivos(dir);
    assert.equal(files.length,1);
    assert.equal(caminhoDentroPastas(files[0],[dir]),true);
    assert.equal(caminhoDentroPastas('/etc/passwd',[dir]),false);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('XLSX válido é lido pelo worker incluído no pacote compilado', async () => {
  const xlsx=createRequire(import.meta.url)('xlsx');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'erp242-xlsx-'));
  try {
    const workbook=xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook,xlsx.utils.aoa_to_sheet([['NSU','VALOR'],['000123','10,00']]),'Dados');
    const file=path.join(dir,'valid.xlsx');xlsx.writeFile(workbook,file);
    const parsed=await lerExcelIsolado(file);
    assert.equal(parsed.matriz[1][0],'000123');assert.equal(parsed.quantidade_registros,2);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('produção exige segredos exclusivos, HTTPS e proxy restrito', () => {
  assert.throws(()=>validarConfiguracaoProducao({NODE_ENV:'production'}));
  const env={NODE_ENV:'production',STORAGE_DIR:'/var/lib/erpxadquirente/storage',AUTH_SECRET:'a'.repeat(48),SFTP_ENCRYPTION_KEY:'b'.repeat(48),CORS_ORIGINS:'https://erp.example.com',TRUST_PROXY:'loopback'};
  assert.doesNotThrow(()=>validarConfiguracaoProducao(env));
  assert.throws(()=>validarConfiguracaoProducao({...env,CORS_ORIGINS:'http://erp.example.com'}));
  assert.throws(()=>validarConfiguracaoProducao({...env,TRUST_PROXY:'true'}));
});
