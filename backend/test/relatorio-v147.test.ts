import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');

test('v0.1.147 nao classifica NAO AUTORIZADO como autorizado', async () => {
  const repositorio = await readFile(path.join(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
  assert.match(repositorio, /status NOT LIKE '%NÃO AUTORIZ%'/);
  assert.match(repositorio, /status LIKE '%NÃO AUTORIZ%'.*AS negadas/s);
});

test('v0.1.147 exclui estados nao financeiros dos totais', async () => {
  const repositorio = await readFile(path.join(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
  assert.match(repositorio, /financeiramente_valida/);
  assert.match(repositorio, /SUM\(CASE WHEN financeiramente_valida THEN bruto ELSE 0 END\)/);
});

test('v0.1.147 recebe filtros de duplicidade e conciliacao no relatorio', async () => {
  const rotas = await readFile(path.join(raizBackend, 'src/routes/core.routes.ts'), 'utf8');
  assert.match(rotas, /duplicidade: req\.query\.duplicidade/);
  assert.match(rotas, /conciliacao: req\.query\.conciliacao/);
});
