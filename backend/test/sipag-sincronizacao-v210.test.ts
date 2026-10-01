import assert from 'node:assert/strict';
import test from 'node:test';
import { MENSAGEM_EXTRATO_SIPAG_BLOQUEADO, validarLayoutExtratoSipagPermitido } from '../src/parsers/sipag-extratos-csv.js';

test('v0.1.210 aceita somente autorizações entre os extratos SIPAG', () => {
  assert.doesNotThrow(() => validarLayoutExtratoSipagPermitido('SIPAG_EXTRATO_TRANSACOES_AUTORIZADAS'));
  for (const layout of [
    'SIPAG_EXTRATO_VENDAS_REALIZADAS',
    'SIPAG_EXTRATO_VENDAS_A_RECEBER',
    'SIPAG_EXTRATO_VENDAS_RECEBIDAS',
    'SIPAG_EXTRATO_VENDAS_PIX',
    'SIPAG_VENDAS_PIX_CSV',
  ]) {
    assert.throws(() => validarLayoutExtratoSipagPermitido(layout), (erro: unknown) => {
      assert.equal((erro as Error).message, MENSAGEM_EXTRATO_SIPAG_BLOQUEADO);
      return true;
    });
  }
});
