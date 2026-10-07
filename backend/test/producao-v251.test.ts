import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { aplicarSchemaBanco } from '../src/database/bootstrap.js';
import { obterOpcoesPool } from '../src/config/postgres.js';
import { estadoCoopcerto, mergeAtualizacaoCoopcerto, planejarAtualizacoesCoopcerto } from '../src/services/coopcerto-upsert.js';
import { validarElegibilidadeConciliacao } from '../src/services/pix-vinculos.js';
import { voucherElegivel } from '../src/services/voucher-pares.js';
import { avaliarCandidatoHibrido } from '../src/services/conciliacao-hibrida.js';
import type { VendaAdquirente } from '../src/repositorio.js';

const venda = (id: string, patch: Record<string, unknown> = {}) => ({
  id, importacao_id: 'imp-' + id, hash_linha: 'hash-' + id, adquirente: 'COOPCERTO',
  layout_origem: 'coopcerto_cabal_vendas_csv', tipo_arquivo: 'COOPCERTO_CABAL_VENDAS_CSV',
  codigo_registro: 'VENDA', numero_linha: 1, data_venda: '2026-10-01', hora_venda: '18:13:11',
  linha_original: 'ORIGINAL-' + id, data_criacao: '2026-10-01T22:13:11Z',
  codigo_estabelecimento: 'NBO', valor_bruto: '29.98', valor_taxa: '1.05', valor_liquido: '28.93',
  modalidade: 'VOUCHER', bandeira: 'CABAL', parcelas: '1/1', nsu: '3969069876',
  status_transacao: 'AUTORIZADO', dados_json: {'Nº do estabelecimento': 'LOJA-NBO', id_venda_rrn: 'RRN-251'},
  ...patch,
}) as VendaAdquirente;

test('status negativo não contém autorização positiva e desconhecido não a substitui', () => {
  for (const status of ['NÃO AUTORIZADO', 'NAO AUTORIZADO', 'NAO_AUTORIZADO', 'NOT_AUTHORIZED', 'UNAUTHORIZED - ZU', 'UNAUTHORISED', 'NEGADO', 'RECUSADO'])
    assert.equal(estadoCoopcerto(venda(status, {status_transacao: status})), 'NEGADO');
  const original = venda('original');
  assert.equal(mergeAtualizacaoCoopcerto(original, venda('desconhecida', {status_transacao:'????'})), original);
});

test('contradição autorizado/negado conserva dados atuais e exige decisão humana, sem promoção implícita', () => {
  for (const [antes, recebido] of [['AUTORIZADO','NAO AUTORIZADO'],['NEGADO','AUTORIZADO']]) {
    const atual = venda('atual', {status_transacao: antes, conciliacao_id:'c1',status_conciliacao:'CONCILIADO'});
    const nova = venda('nova', {status_transacao: recebido, valor_liquido:'0.00'});
    const result = mergeAtualizacaoCoopcerto(atual, nova) as any;
    assert.equal(result.status_transacao, antes); assert.equal(result.valor_liquido, '28.93');
    assert.equal(result.conciliacao_id, 'c1'); assert.equal(result.revisao_coopcerto.status, 'PENDENTE');
    assert.equal(result.revisao_coopcerto.recebido.status_transacao, recebido);
    assert.throws(() => validarElegibilidadeConciliacao(result, 'ADQUIRENTE'), /revisão/);
    assert.equal(voucherElegivel(result), false);
    assert.equal(avaliarCandidatoHibrido(result, {id:'e1'}), null);
    assert.equal(mergeAtualizacaoCoopcerto(result, nova), result, 'mesmo evento não regrava a revisão');
  }
});

test('cancelamento mantém vínculo histórico com alerta e não é revertido por autorização antiga', () => {
  const original = venda('original', {conciliacao_id:'c1',status_conciliacao:'CONCILIADO'});
  const cancelada = venda('cancelada', {status_transacao:'CANCELADO',valor_liquido:'0.00'});
  const final = mergeAtualizacaoCoopcerto(original, cancelada) as any;
  assert.equal(final.status_transacao, 'CANCELADO'); assert.equal(final.conciliacao_id,'c1');
  assert.equal(final.status_conciliacao,'CONCILIADO'); assert.equal(final.revisao_coopcerto.status,'PENDENTE');
  assert.equal(final.revisao_coopcerto.anterior.valor_liquido,'28.93');
  assert.equal(mergeAtualizacaoCoopcerto(final,venda('autorizada-antiga')),final);
});

test('formatos financeiros equivalentes não geram revisão; alteração posterior e referência legada geram', () => {
  const original = venda('original', {conciliacao_id:'c1',status_conciliacao:'CONCILIADO'});
  assert.equal((mergeAtualizacaoCoopcerto(original, venda('equivalente',{valor_taxa:'1,05',valor_liquido:'28,93'})) as any).revisao_coopcerto, undefined);
  const result = mergeAtualizacaoCoopcerto(original, venda('alterada',{valor_taxa:'2.00',valor_liquido:'27.98'})) as any;
  assert.equal(result.revisao_coopcerto.status,'PENDENTE'); assert.equal(result.valor_liquido,'27.98');
  const semJson = venda('sem-json');
  const legado = planejarAtualizacoesCoopcerto([{row_id:semJson.id,dados:semJson,referenciado:true}], [venda('nova',{valor_liquido:'27.98'})]);
  assert.equal((legado.updates.get(semJson.id) as any).revisao_coopcerto.status,'PENDENTE');
});

test('divergência de bruto com vínculo preserva valor e sinaliza; pendente evolui sem vínculo', () => {
  const original = venda('original', {conciliacao_id:'c1'});
  const plano = planejarAtualizacoesCoopcerto([{row_id:original.id,dados:original}], [venda('nova',{valor_bruto:'99.00'})]);
  assert.equal(plano.conflitos,1); assert.equal(plano.novos.length,0);
  assert.equal(plano.updates.get(original.id)?.valor_bruto,'29.98');
  assert.equal((plano.updates.get(original.id) as any).revisao_coopcerto.status,'PENDENTE');
  const pendente = venda('pendente',{status_transacao:'PENDENTE',valor_taxa:'0.00',valor_liquido:'0.00',nsu:''});
  const autorizada = mergeAtualizacaoCoopcerto(pendente,venda('autorizada')) as any;
  assert.equal(autorizada.status_transacao,'AUTORIZADO'); assert.equal(autorizada.revisao_coopcerto,undefined);
  assert.equal(mergeAtualizacaoCoopcerto(autorizada,pendente),autorizada);
});

test('pool recusa NaN, frações, timeout inválido e capacidade que esgota com tarefa de fundo', () => {
  assert.equal(obterOpcoesPool({}).max,10);
  assert.equal(obterOpcoesPool({POSTGRES_POOL_MAX:'12'}).max,12);
  for (const numero of ['2','3','NaN','abc','','0','4.5','Infinity','101'])
    assert.throws(()=>obterOpcoesPool({POSTGRES_POOL_MAX:numero}),/POSTGRES_POOL_MAX/);
  assert.throws(()=>obterOpcoesPool({POSTGRES_CONNECTION_TIMEOUT_MS:'abc'}),/POSTGRES_CONNECTION_TIMEOUT_MS/);
});

test('SQL: revisão, vínculos e histórico atômicos; revisão humana, hash concorrente e reversão', async () => {
  const pg = new PGlite();
  const old = {query:Pool.prototype.query,connect:Pool.prototype.connect,end:Pool.prototype.end};
  const query = async(sql:string,params:unknown[]=[]) => {const r=await pg.query(sql,params);return {rows:r.rows as any[],rowCount:r.rows.length || r.affectedRows || 0};};
  (Pool.prototype as any).query=query; (Pool.prototype as any).connect=async()=>({query,release(){}}); (Pool.prototype as any).end=async()=>{};
  process.env.DATABASE_URL='postgresql://teste:teste@localhost/erp251_test';
  try {
    await aplicarSchemaBanco({query} as any);
    const repo = await import('../src/repositories/repositorio.js');
    const original = venda('original',{conciliacao_id:'c1',status_conciliacao:'CONCILIADO'});
    await query('INSERT INTO vendas_adquirentes(row_id,hash_linha,dados,conciliacao_id) VALUES($1,$2,$3::jsonb,$4)',[original.id,original.hash_linha,JSON.stringify(original),null]);
    await query('INSERT INTO vendas_interdata(row_id,dados,conciliacao_id) VALUES($1,$2::jsonb,$3)',['e1',JSON.stringify({id:'e1',cnpj_estabelecimento:'NBO',tipo_produto:'VOUCHER',data_venda:'2026-10-01',valor_bruto:'29.98',parcelas:'1/1',status_conciliacao:'CONCILIADO',conciliacao_id:'c1'}),null]);
    await query('INSERT INTO conciliacoes(row_id,dados,venda_adquirente_id,venda_interdata_id,status) VALUES($1,$2::jsonb,$3,$4,$5)',['c1',JSON.stringify({id:'c1',venda_adquirente_id:original.id,venda_interdata_id:'e1',status:'CONCILIADO',score:100,tipo_match:'MANUAL'}),original.id,'e1','CONCILIADO']);
    await query("UPDATE vendas_adquirentes SET conciliacao_id='c1' WHERE row_id=$1",[original.id]);
    await query("UPDATE vendas_interdata SET conciliacao_id='c1' WHERE row_id='e1'");
    await query(`CREATE FUNCTION falha_historico251() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'historico_indisponivel'; END $$`);
    await query('CREATE TRIGGER falha251 BEFORE INSERT ON historico_conciliacoes FOR EACH ROW EXECUTE FUNCTION falha_historico251()');
    const alterada = venda('alterada',{valor_taxa:'2.00',valor_liquido:'27.98'});
    await assert.rejects(repo.salvarVendasAdquirentes([alterada]),/historico_indisponivel/);
    assert.equal((await query('SELECT dados FROM vendas_adquirentes WHERE row_id=$1',[original.id])).rows[0].dados.valor_liquido,'28.93');
    assert.equal((await query('SELECT dados FROM conciliacoes WHERE row_id=$1',['c1'])).rows[0].dados.revisao_coopcerto,undefined);
    await query('DROP TRIGGER falha251 ON historico_conciliacoes');
    await repo.salvarVendasAdquirentes([alterada]);
    const r = (await query('SELECT dados,conciliacao_id FROM vendas_adquirentes WHERE row_id=$1',[original.id])).rows[0];
    assert.equal(r.conciliacao_id,'c1'); assert.equal(r.dados.revisao_coopcerto.status,'PENDENTE');
    assert.equal((await query('SELECT dados FROM vendas_interdata WHERE row_id=$1',['e1'])).rows[0].dados.revisao_coopcerto.status,'PENDENTE');
    assert.equal((await repo.obterDetalhesConciliacao('c1')).historico.length,1);
    const lista=await repo.listarConciliacoesComExibicao(10,0,'CONCILIADO');
    assert.equal(lista.contadores?.revisao_coopcerto,1);
    assert.equal((lista.linhas[0] as any).venda_adquirente.revisao_coopcerto.status,'PENDENTE');
    await assert.rejects(repo.confirmarConciliacao('c1','confirmacao bloqueada'),/revisão/);
    await assert.rejects(repo.tratarRevisaoCoopcerto(original.id,'hash-velho','Verificado no relatório'),/revisão mudou/);
    await assert.rejects(repo.tratarRevisaoCoopcerto(original.id,alterada.hash_linha,'curto'),/Justifique/);
    await query('CREATE TRIGGER falha251 BEFORE INSERT ON historico_conciliacoes FOR EACH ROW EXECUTE FUNCTION falha_historico251()');
    await assert.rejects(repo.tratarRevisaoCoopcerto(original.id,alterada.hash_linha,'Taxa conferida no relatório',{nome:'Financeiro'}),/historico_indisponivel/);
    assert.equal((await repo.obterDetalhesConciliacao('c1')).conciliacao.revisao_coopcerto.status,'PENDENTE');
    await query('DROP TRIGGER falha251 ON historico_conciliacoes');
    await repo.tratarRevisaoCoopcerto(original.id,alterada.hash_linha,'Taxa conferida no relatório',{id:'u1',nome:'Financeiro'});
    assert.equal((await repo.obterDetalhesConciliacao('c1')).conciliacao.revisao_coopcerto.status,'TRATADA_MANUALMENTE');
    await repo.salvarVendasAdquirentes([alterada]);
    assert.equal((await repo.obterDetalhesConciliacao('c1')).historico.length,2,'reimportação tratada não duplica histórico');
    const semVinculo=venda('sem-vinculo',{dados_json:{'Nº do estabelecimento':'LOJA-NBO',id_venda_rrn:'RRN-SEM-VINCULO'}});
    await repo.salvarVendasAdquirentes([semVinculo]);
    const negada={...semVinculo,id:'negada',hash_linha:'hash-negada',status_transacao:'NAO AUTORIZADO'};
    await repo.salvarVendasAdquirentes([negada]);
    await repo.tratarRevisaoCoopcerto(semVinculo.id,negada.hash_linha,'Relatório autorizado conferido',{nome:'Financeiro'});
    await repo.salvarVendasAdquirentes([negada]);
    const sem=(await query('SELECT dados FROM vendas_adquirentes WHERE row_id=$1',[semVinculo.id])).rows[0].dados;
    assert.equal(sem.status_transacao,'AUTORIZADO'); assert.equal(sem.revisao_coopcerto.status,'TRATADA_MANUALMENTE');
    const cancelada = venda('cancelada',{status_transacao:'CANCELADO',valor_liquido:'0.00'});
    await repo.salvarVendasAdquirentes([cancelada]);
    assert.equal((await repo.obterDetalhesConciliacao('c1')).conciliacao.revisao_coopcerto.status,'PENDENTE');
    await assert.rejects(repo.tratarRevisaoCoopcerto(original.id,cancelada.hash_linha,'Conferida a venda cancelada'),/desfaça/);
    await repo.desfazerConciliacao('c1','Cancelamento confirmado no relatório',{nome:'Financeiro'});
    const final=(await query('SELECT dados,conciliacao_id FROM vendas_adquirentes WHERE row_id=$1',[original.id])).rows[0];
    assert.equal(final.conciliacao_id,null); assert.equal(final.dados.status_transacao,'CANCELADO');
    assert.equal(final.dados.revisao_coopcerto.status,'TRATADA_POR_REVERSAO');
    assert.equal((await repo.obterDetalhesConciliacao('c1')).conciliacao.status,'DESFEITO');
  } finally {Object.assign(Pool.prototype,old);await pg.close();}
});
