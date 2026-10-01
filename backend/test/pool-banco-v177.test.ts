import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const raiz = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');

test('explorador conta todas as tabelas usando uma única aquisição do pool', async () => {
  const fonte = await readFile(path.resolve(raiz, 'src/repositories/repositorio.ts'), 'utf8');
  const inicio = fonte.indexOf('export async function listarTabelasBanco');
  const fim = fonte.indexOf('export async function obterDadosTabela', inicio);
  const bloco = fonte.slice(inicio, fim);
  assert.match(bloco, /join\(' UNION ALL '\)/);
  assert.equal((bloco.match(/\$queryRawUnsafe/g) || []).length, 1);
  assert.doesNotMatch(bloco, /Promise\.all/);
});

test('rotas do explorador devolvem 503 em vez de derrubar o Express 4', async () => {
  const fonte = await readFile(path.resolve(raiz, 'src/routes/core.routes.ts'), 'utf8');
  const inicio = fonte.indexOf("app.get('/api/banco/tabelas'");
  const fim = fonte.indexOf("app.delete('/api/banco/tabelas/:nome/limpar'", inicio);
  const bloco = fonte.slice(inicio, fim);
  assert.match(bloco, /BANCO_TEMPORARIAMENTE_OCUPADO/g);
  assert.match(bloco, /res\.status\(503\)/g);
  assert.match(bloco, /catch \(error\)/g);
});
