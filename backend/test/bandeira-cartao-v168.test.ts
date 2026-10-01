import assert from 'node:assert/strict';
import test from 'node:test';
import { identificarBandeiraCartao } from '../src/services/bandeira-cartao.js';

test('preserva o BIN como bandeira original para conversão administrável', () => {
  assert.equal(identificarBandeiraCartao('439267******7643').bandeira, '439267');
  assert.equal(identificarBandeiraCartao('250060******0000').bandeira, '250060');
  assert.equal(identificarBandeiraCartao('506722******0000').bandeira, '506722');
  assert.equal(identificarBandeiraCartao('639350******0000').bandeira, '639350');
});

test('não traduz BINs de voucher e sinaliza cartão sem BIN completo', () => {
  assert.deepEqual(identificarBandeiraCartao('604220******3332'), { bandeira: '604220', bin: '604220', criterio: 'BIN_CARTAO' });
  assert.equal(identificarBandeiraCartao('603389******9753').bandeira, '603389');
  assert.equal(identificarBandeiraCartao('637036******4876').bandeira, '637036');
  assert.deepEqual(identificarBandeiraCartao('****1234'), { bandeira: '1234', bin: '1234', criterio: 'BIN_INDISPONIVEL' });
});
