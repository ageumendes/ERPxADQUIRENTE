import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { aplicarSchemaBanco } from '../src/database/bootstrap.js';
import { sincronizarVinculosPixSipagSicoobTx, validarParConciliacao } from '../src/services/pix-vinculos.js';
import { urlPostgresParaCliente } from '../src/config/database-url.js';

test('regressões produção: legado preservado, remoção do catálogo, sugestões históricas, NÃO APLICA e divergências PIX', async () => {
  const pg = new PGlite();
  const query = async (sql:string, params:unknown[]=[]) => {const r=await pg.query(sql,params);return {rows:r.rows as Array<Record<string,any>>,rowCount:r.rows.length||r.affectedRows||0};};
  const old={query:Pool.prototype.query,connect:Pool.prototype.connect,end:Pool.prototype.end};
  (Pool.prototype as any).query=query;(Pool.prototype as any).connect=async()=>({query,release(){}});(Pool.prototype as any).end=async()=>{};
  process.env.DATABASE_URL='postgresql://test:test@localhost/erp244_test';
  try {
    await query('CREATE TABLE linhas_importadas(id integer)');await query('INSERT INTO linhas_importadas VALUES(123)');
    await query('CREATE TABLE catalogo_bins(bin text)');
    await query('CREATE TABLE catalogo_bins_referencia(bin text, fonte text NOT NULL)');
    await aplicarSchemaBanco({query} as any);
    assert.equal((await query('SELECT * FROM linhas_importadas')).rows.length,1);
    const raw={id:'cabecalho-preservado',codigo_registro:'H',linha_original:'ORIGINAL'};
    await query('INSERT INTO vr_layout_16ap(row_id,dados) VALUES($1,$2::jsonb)',[raw.id,JSON.stringify(raw)]);
    await query("DELETE FROM schema_migrations WHERE versao='0.1.152'");
    await query("INSERT INTO vendas_adquirentes(row_id,dados) VALUES('sem-inferencia',$1::jsonb)",[JSON.stringify({adquirente:'SIPAG',tipo_arquivo:'SIPAG_EXTRATO_TRANSACOES_AUTORIZADAS',bandeira:'',modalidade:'DEBITO',dados_json:{'Nº cartão':'466070******4225'}})]);
    await aplicarSchemaBanco({query} as any);
    assert.equal((await query('SELECT * FROM linhas_importadas')).rows.length,1);
    assert.equal((await query("SELECT dados FROM vr_layout_16ap WHERE row_id='cabecalho-preservado'")).rows.length,1);
    assert.equal((await query("SELECT COUNT(*)::int AS total FROM information_schema.tables WHERE table_name IN ('catalogo_bins','catalogo_bins_referencia')")).rows[0]?.total,0);
    assert.equal((await query("SELECT dados FROM vendas_adquirentes WHERE row_id='sem-inferencia'")).rows[0]?.dados.bandeira,'');
    const repo=await import('../src/repositories/repositorio.js');await repo.prepararConsultasOtimizadas();
    assert.equal((await query('SELECT * FROM linhas_importadas')).rows.length,1);
    const insert=async(t:string,id:string,dados:Record<string,unknown>)=>query(`INSERT INTO ${t}(row_id,hash_linha,dados) VALUES($1,$1,$2::jsonb)`,[id,JSON.stringify({id,...dados})]);
    for(const [id,adqExtra,erpExtra] of [
      ['loja',{}, {cnpj_estabelecimento:'NBO'}],
      ['valor',{}, {valor_bruto:'11.00'}],
      ['literal',{pagador_documento:'NÃO APLICA'},{}],
      ['conversao',{bandeira:'BLOQUEAR'},{}],
      ['valido',{},{}],
    ] as Array<[string,Record<string,unknown>,Record<string,unknown>]>) {
      await insert('vendas_adquirentes','a-'+id,{adquirente:'SIPAG',modalidade:'DEBITO',status_transacao:'AUTORIZADO',codigo_estabelecimento:'SRG',data_venda:'2026-10-02',hora_venda:'10:00:00',valor_bruto:'10.00',nsu:id,...adqExtra});
      await insert('vendas_interdata','e-'+id,{cnpj_estabelecimento:'SRG',tipo_produto:'DEBITO',data_venda:'2026-10-02',hora_venda:'10:00:00',valor_bruto:'10.00',nsu:id,...erpExtra});
      await query('INSERT INTO conciliacoes(row_id,dados,venda_adquirente_id,venda_interdata_id,status) VALUES($1,$2::jsonb,$3,$4,$5)',['c-'+id,JSON.stringify({id:'c-'+id,venda_adquirente_id:'a-'+id,venda_interdata_id:'e-'+id,status:'SUGERIDO',score:95,tipo_match:'NSU_VALOR_DATA'}),'a-'+id,'e-'+id,'SUGERIDO']);
      for(const t of ['vendas_adquirentes','vendas_interdata']) await query(`UPDATE ${t} SET conciliacao_id=$1 WHERE row_id=$2`,['c-'+id,(t==='vendas_adquirentes'?'a-':'e-')+id]);
    }
    await query('INSERT INTO conversoes(row_id,dados) VALUES($1,$2::jsonb)',['cv-bloqueio',JSON.stringify({tabela_origem:'vendas_adquirentes',coluna_origem:'bandeira',valor_original:'BLOQUEAR',valor_exibicao:'NÃO APLICA',ativo:true,adquirente_aplicacao:'SIPAG'})]);
    await assert.rejects(repo.confirmarConciliacao('c-loja','teste'), /estabelecimentos/);
    await assert.rejects(repo.confirmarConciliacao('c-conversao','teste'), /NÃO APLICA/);
    const result=await repo.executarConciliacaoAutomatica({});
    assert.equal((result as any).promovidas_alta_confianca,1);
    for(const id of ['loja','valor','literal','conversao']) assert.equal((await query('SELECT status FROM conciliacoes WHERE row_id=$1',['c-'+id])).rows[0]?.status,'SUGERIDO');
    assert.equal((await query("SELECT status FROM conciliacoes WHERE row_id='c-valido'")).rows[0]?.status,'CONCILIADO');
    for(const [id,adquirente,extra] of [['pix-a','SIPAG',{}],['pix-b','SICOOB',{codigo_estabelecimento:'NBO',data_venda:'2026-10-01',valor_bruto:'12.00'}]] as Array<[string,string,Record<string,unknown>]>) await insert('vendas_adquirentes',id,{adquirente,modalidade:'PIX',status_transacao:'AUTORIZADO',codigo_estabelecimento:'SRG',data_venda:'2026-10-02',valor_bruto:'10.00',nsu:'E-TESTE-244',...extra});
    await pg.transaction(tx=>sincronizarVinculosPixSipagSicoobTx({$queryRawUnsafe:async(sql,...p)=>(await tx.query(sql,p)).rows,$executeRawUnsafe:async(sql,...p)=>tx.query(sql,p)}));
    const pix=await query("SELECT dados FROM vendas_adquirentes WHERE row_id LIKE 'pix-%'");
    assert.ok(pix.rows.every((r:any)=>r.dados.pix_vinculo_conflito==='DIVERGENCIA_ENTRE_FONTES'));
    await assert.rejects(repo.criarConciliacaoManual('','pix-b','teste',{},true), /PIX complementar ou com conflito/);
    // Mesmo valor em representações equivalentes não cria falso conflito.
    await query("UPDATE vendas_adquirentes SET dados=dados || $1::jsonb WHERE row_id='pix-b'",[JSON.stringify({codigo_estabelecimento:'SRG',data_venda:'2026-10-02',valor_bruto:'10,00'})]);
    await pg.transaction(tx=>sincronizarVinculosPixSipagSicoobTx({$queryRawUnsafe:async(sql,...p)=>(await tx.query(sql,p)).rows,$executeRawUnsafe:async(sql,...p)=>tx.query(sql,p)}));
    assert.ok((await query("SELECT dados FROM vendas_adquirentes WHERE row_id LIKE 'pix-%'")).rows.every((r:any)=>r.dados.pix_vinculo_conflito===''));
  } finally {Object.assign(Pool.prototype,old);await pg.close();}
});

test('normalização para pg_dump remove schema e preserva TLS e senha codificada', () => {
  const u=new URL(urlPostgresParaCliente('postgresql://erp:p%40ss@localhost/banco?schema=public&sslmode=require&application_name=backup'));
  assert.equal(u.searchParams.has('schema'),false);assert.equal(u.searchParams.get('sslmode'),'require');assert.equal(u.password,'p%40ss');
});

test('validação comum impede loja ausente, diferente e NÃO APLICA dinâmico', () => {
  const adq={status_transacao:'AUTORIZADO',codigo_estabelecimento:'SRG'};
  assert.throws(()=>validarParConciliacao(adq,{cnpj_estabelecimento:'NBO'}),/estabelecimentos/);
  assert.throws(()=>validarParConciliacao(adq,{cnpj_estabelecimento:'SRG'},true),/NÃO APLICA/);
  assert.doesNotThrow(()=>validarParConciliacao(adq,{cnpj_estabelecimento:'SRG'}));
});
