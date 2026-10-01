import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { VendaAdquirente } from '../../src/repositorio.js';

test('SIPAG PostgreSQL: importações concorrentes complementam uma única linha e preservam sua identidade', async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, 'TEST_DATABASE_URL é obrigatória.');
  assert.match(new URL(url).pathname, /test|teste/i, 'Use somente um banco exclusivo de teste.');
  process.env.DATABASE_URL = url;
  const { salvarVendasAdquirentes } = await import('../../src/repositorio.js');
  const { getPool, closePool } = await import('../../src/database/pool.js');
  const prefix = `sipag197-test-${randomUUID()}`;
  const a: VendaAdquirente = {
    id: prefix+'-a', importacao_id: prefix, hash_linha: prefix+'-a', linha_original: '',
    data_criacao: new Date().toISOString(), adquirente: 'SIPAG', layout_origem: 'sipag_extrato_transacoes_autorizadas',
    tipo_arquivo: 'SIPAG_EXTRATO_TRANSACOES_AUTORIZADAS', codigo_registro: 'VENDA', numero_linha: 1,
    data_venda: '2050-01-01', hora_venda: '10:00:00', codigo_estabelecimento: '999999999999',
    codigo_autorizacao: prefix, modalidade: 'DEBITO', status_transacao: 'AUTORIZADO', status_transacao_original: 'APROVADA',
    valor_bruto: '10.00', valor_taxa: '0.00', valor_liquido: '10.00',
    dados_json: { 'Nº cartão': '999999******9999', 'Nº Estabelecimento': '999999999999' },
  };
  const e: VendaAdquirente = { ...a, id: prefix+'-e', hash_linha: prefix+'-e',
    layout_origem: 'sipag_layout_2_0_s_cartoes', tipo_arquivo: 'S', codigo_registro: '011',
    data_venda: '01012050', valor_taxa: '0.08', valor_liquido: '9.92',
    dados_json: { numero_cartao: '999999******9999', codigo_cliente: '999999999999' },
  };
  const pool = getPool();
  try {
    // Inicializa o schema antes de testar a concorrência entre as transações de importação.
    await salvarVendasAdquirentes([e]);
    await pool.query('DELETE FROM vendas_adquirentes WHERE row_id=$1', [e.id]);
    const resultados = await Promise.all([salvarVendasAdquirentes([a]), salvarVendasAdquirentes([e])]);
    assert.equal(resultados.reduce((s,r)=>s+r.inseridos,0),1);
    const antes = (await pool.query("SELECT pk,row_id,dados FROM vendas_adquirentes WHERE dados->>'codigo_autorizacao'=$1",[prefix])).rows;
    assert.equal(antes.length,1);assert.equal(antes[0].dados.valor_taxa,'0.08');
    await salvarVendasAdquirentes([{...a,id:prefix+'-again',hash_linha:prefix+'-again',importacao_id:prefix+'-again'}]);
    const depois = (await pool.query("SELECT pk,row_id,dados FROM vendas_adquirentes WHERE dados->>'codigo_autorizacao'=$1",[prefix])).rows;
    assert.equal(depois.length,1);assert.equal(depois[0].pk,antes[0].pk);assert.equal(depois[0].row_id,antes[0].row_id);
    assert.equal(depois[0].dados.valor_liquido,'9.92');
  } finally {
    await pool.query("DELETE FROM vendas_adquirentes WHERE dados->>'codigo_autorizacao'=$1",[prefix]);
    await closePool();
  }
});
