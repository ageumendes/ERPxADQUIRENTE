import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('migração recupera BIN somente em bandeiras vazias das autorizações SIPAG', async () => {
  const bootstrap = await readFile(path.join(raiz, 'src/database/bootstrap.ts'), 'utf8');
  assert.match(bootstrap, /SIPAG_EXTRATO_TRANSACOES_AUTORIZADAS/);
  assert.match(bootstrap, /dados_json'->>'Nº cartão'/);
  assert.match(bootstrap, /COALESCE\(TRIM\(dados->>'bandeira'\), ''\) = ''/);
  assert.match(bootstrap, /candidato\.bin ~ '\^\[0-9\]\{6\}\$'/);
  assert.match(bootstrap, /'\{bandeira\}'/);
  assert.match(bootstrap, /'0\.1\.170'/);
});

test('correção retroativa substitui PIX indevido e blinda a bandeira original', async () => {
  const bootstrap = await readFile(path.join(raiz, 'src/database/bootstrap.ts'), 'utf8');
  assert.match(bootstrap, /IN \('CREDITO', 'DEBITO', 'VOUCHER'\)/);
  assert.match(bootstrap, /IN \('', 'PIX'\)/);
  assert.match(bootstrap, /'\{bandeira_original\}'/);
  assert.match(bootstrap, /BIN_CARTAO_CORRECAO_RETROATIVA/);
  assert.match(bootstrap, /'0\.1\.171'/);
});
