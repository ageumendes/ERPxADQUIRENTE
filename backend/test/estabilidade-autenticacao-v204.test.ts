import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const raizProjeto = path.resolve(raizBackend, '..');
const autenticacao = fs.readFileSync(path.resolve(raizBackend, 'src/security/auth.ts'), 'utf8');
const appShell = fs.readFileSync(path.resolve(raizProjeto, 'frontend/src/components/AppShell.tsx'), 'utf8');

test('timeout de autenticação retorna 503 sem deixar a rejeição derrubar o processo', () => {
  assert.match(autenticacao, /export async function autenticar[\s\S]*try \{/);
  assert.match(autenticacao, /catch \(error\)[\s\S]*status\(503\)/);
  assert.match(autenticacao, /BANCO_TEMPORARIAMENTE_INDISPONIVEL/);
});

test('tokens válidos usam cache curto, limitado e invalidado em alterações de segurança', () => {
  assert.match(autenticacao, /AUTH_TOKEN_VALIDATION_CACHE_SECONDS \|\| 15/);
  assert.match(autenticacao, /TOKEN_CACHE_LIMITE = 1_000/);
  assert.match(autenticacao, /Math\.min\(60/);
  assert.match(autenticacao, /function invalidarCacheTokens/);
  assert.match(autenticacao, /alterarPropriaSenha[\s\S]*invalidarCacheTokens\(\)/);
  assert.match(autenticacao, /atualizarUsuario[\s\S]*invalidarCacheTokens\(\)/);
});

test('polling de atividade é sequencial, pausado em aba oculta e cancelável', () => {
  assert.match(appShell, /consultando/);
  assert.match(appShell, /document\.hidden/);
  assert.match(appShell, /window\.setTimeout\(\(\) => void consultar\(\), 5_000\)/);
  assert.doesNotMatch(appShell, /setInterval\(consultar/);
  assert.match(appShell, /controlador\?\.abort\(\)/);
  assert.match(appShell, /visibilitychange/);
});
