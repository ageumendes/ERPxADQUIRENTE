import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');

test('v0.1.148 da precedencia a UNAUTHORIZED sobre fallback de layout', async () => {
  const repositorio = await readFile(path.join(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
  const posUnauthorized = repositorio.indexOf("canonico.includes('UNAUTHORIZED')");
  const posFallback = repositorio.indexOf("layout.endsWith('_S_PIX')");
  assert.ok(posUnauthorized >= 0, 'regra UNAUTHORIZED ausente');
  assert.ok(posFallback >= 0, 'fallback de layout S_PIX ausente');
  assert.ok(posUnauthorized < posFallback, 'UNAUTHORIZED deve ser avaliado antes do fallback do layout');
  assert.match(repositorio, /UNAUTHORIZED[\s\S]*return 'NEGADO'/);
});

test('v0.1.148 usa status original explicito para reparar classificacao inferida', async () => {
  const repositorio = await readFile(path.join(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
  assert.match(repositorio, /status_transacao_original/);
  assert.match(repositorio, /const statusFonte = \/UNAUTHORIZED/);
});

test('v0.1.148 migra apenas AUTORIZADO com original UNAUTHORIZED e nao altera datas', async () => {
  const bootstrap = await readFile(path.join(raizBackend, 'src/database/bootstrap.ts'), 'utf8');
  const inicio = bootstrap.indexOf("const migration148");
  const fim = bootstrap.indexOf("await pool.query(\n      `INSERT INTO schema_migrations", inicio);
  const trecho = bootstrap.slice(inicio, fim > inicio ? fim : undefined);
  assert.match(trecho, /status_transacao_original/);
  assert.match(trecho, /LIKE 'UNAUTHORIZED%'/);
  assert.match(trecho, /to_jsonb\('NEGADO'::text\)/);
  assert.doesNotMatch(trecho, /data_venda|data_pagamento/);
});
