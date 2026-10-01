import assert from 'node:assert/strict';
import test from 'node:test';
import { pontuarMatchConciliacao, type VendaAdquirente, type VendaInterdata } from '../src/repositories/repositorio.js';

function adq(overrides: Partial<VendaAdquirente> = {}): VendaAdquirente {
  return { id: 'A1', importacao_id: 'I1', adquirente: 'CIELO', layout_origem: 'TESTE', tipo_arquivo: 'VENDA', numero_linha: 1, nsu: '123', codigo_autorizacao: 'ABC', valor_bruto: '100.00', data_venda: '2026-07-20', cnpj_estabelecimento: '12345678000199', terminal: 'T1', bandeira: 'VISA', modalidade: 'CREDITO', data_criacao: new Date(0).toISOString(), ...overrides } as VendaAdquirente;
}
function erp(overrides: Partial<VendaInterdata> = {}): VendaInterdata {
  return { id: 'E1', importacao_id: 'I1', nsu: '123', codigo_autorizacao: 'ABC', valor_bruto: '100.00', data_venda: '2026-07-20', cnpj_estabelecimento: '12345678000199', terminal: 'T1', bandeira: 'VISA', tipo_produto: 'CREDITO', data_criacao: new Date(0).toISOString(), ...overrides } as VendaInterdata;
}

test('NSU forte, valor e data compativeis permitem match automatico', () => {
  const resultado = pontuarMatchConciliacao(adq(), erp());
  assert.equal(resultado?.tipo, 'NSU');
  assert.equal(resultado?.elegivelAutomatico, true);
  assert.ok((resultado?.score ?? 0) >= 90);
});

test('valor e data isolados nunca permitem match automatico', () => {
  const resultado = pontuarMatchConciliacao(adq({ nsu: '', codigo_autorizacao: '' }), erp({ nsu: '', codigo_autorizacao: '' }));
  assert.equal(resultado?.tipo, 'VALOR_DATA');
  assert.equal(resultado?.elegivelAutomatico, false);
});

test('CNPJ divergente elimina candidato mesmo com NSU igual', () => {
  assert.equal(pontuarMatchConciliacao(adq(), erp({ cnpj_estabelecimento: '99999999000199' })), null);
});

test('identificador conflitante impede confirmacao automatica', () => {
  const resultado = pontuarMatchConciliacao(adq(), erp({ codigo_autorizacao: 'OUTRA' }));
  assert.equal(resultado?.tipo, 'NSU');
  assert.equal(resultado?.elegivelAutomatico, false);
});
