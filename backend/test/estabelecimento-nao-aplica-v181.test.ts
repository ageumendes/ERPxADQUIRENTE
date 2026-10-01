import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const repositorio = fs.readFileSync(path.resolve(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');

test('NÃO APLICA é uma lista negra lógica aplicada às listagens e conciliações', () => {
  assert.match(repositorio, /function sqlRegistroNaoAplicavel/);
  assert.match(repositorio, /NAOAPLICA/);
  assert.match(repositorio, /construirWhereListagem[\s\S]*sqlRegistroNaoAplicavel\(config\.tabela\)/);
  assert.match(repositorio, /listarConciliacoesComExibicao[\s\S]*sqlRegistroNaoAplicavel\('vendas_interdata','e'\)/);
  assert.match(repositorio, /executarConciliacaoHibridaPostgres[\s\S]*sqlRegistroNaoAplicavel\('vendas_adquirentes','a'\)/);
  assert.match(repositorio, /Conciliação bloqueada: o estabelecimento está marcado como NÃO APLICA/);
});

test('SQL híbrido exige estabelecimento preenchido e igual antes dos demais critérios', () => {
  assert.ok(repositorio.includes("sqlCodigoEstabelecimento('vendas_adquirentes','a')} <> ''"));
  assert.ok(repositorio.includes("sqlCodigoEstabelecimento('vendas_interdata','e')} <> ''"));
  assert.ok(repositorio.includes("sqlCodigoEstabelecimento('vendas_adquirentes','a')} = ${sqlCodigoEstabelecimento('vendas_interdata','e')}"));
});
