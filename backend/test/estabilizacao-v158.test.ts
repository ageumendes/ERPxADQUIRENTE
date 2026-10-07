import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { checklistImportacoesDiarias } from '../src/config/importacoes-diarias.js';
import { APP_VERSION } from '../src/version.js';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const ler = (arquivo: string) => readFile(path.join(raizBackend, arquivo), 'utf8');

test('versão de aplicação permanece centralizada após a v0.1.158', async () => {
  const [backendPackage, frontendPackage, theme] = await Promise.all([
    ler('package.json'),
    readFile(path.resolve(raizBackend, '../frontend/package.json'), 'utf8'),
    readFile(path.resolve(raizBackend, '../frontend/src/lib/theme.ts'), 'utf8'),
  ]);
  assert.equal(JSON.parse(backendPackage).version, APP_VERSION);
  assert.equal(JSON.parse(frontendPackage).version, APP_VERSION);
  assert.ok(theme.includes(`version: '${APP_VERSION}'`));
});

test('checklist diário cobre todas as origens operacionais', () => {
  const grupos = new Set(checklistImportacoesDiarias.map((item) => item.grupo));
  for (const grupo of ['ERP', 'CIELO', 'SIPAG', 'SICREDI', 'CONVCARD', 'COOPCERTO', 'SICOOB', 'VR', 'ALELO', 'PLUXEE', 'TICKET']) {
    assert.ok(grupos.has(grupo), `Origem ausente no checklist: ${grupo}`);
  }
  assert.ok(checklistImportacoesDiarias.every((item) => item.termos.length > 0));
});

test('reversões possuem autorização explícita antes do registro das rotas', async () => {
  const server = await ler('src/server.ts');
  const registro = server.indexOf('registerCoreRoutes(app');
  const duplicidade = server.indexOf("app.use('/api/auditoria'");
  const conversao = server.indexOf("app.use('/api/auditoria'");
  assert.ok(duplicidade >= 0 && duplicidade < registro);
  assert.ok(conversao >= 0 && conversao < registro);
  assert.match(server.slice(duplicidade, registro), /exigirAdmin/);
  assert.match(server.slice(conversao, registro), /exigirAdmin/);
});

test('rotas de auditoria e conversões estão modularizadas', async () => {
  const [core, auditoria, conversoes] = await Promise.all([
    ler('src/routes/core.routes.ts'),
    ler('src/routes/auditoria.routes.ts'),
    ler('src/routes/conversoes.routes.ts'),
  ]);
  assert.match(core, /registerAuditoriaRoutes\(app\)/);
  assert.match(core, /registerConversoesRoutes\(app\)/);
  assert.doesNotMatch(core, /app\.post\('\/api\/auditoria\/conversoes/);
  assert.match(auditoria, /export function registerAuditoriaRoutes/);
  assert.match(conversoes, /export function registerConversoesRoutes/);
});

test('consulta de hash não carrega todo o histórico em memória', async () => {
  const repositorio = await ler('src/repositories/importacoes.repository.ts');
  const inicio = repositorio.indexOf('export async function buscarImportacaoPorHash');
  const fim = repositorio.indexOf('export async function buscarImportacaoPendentePorHash', inicio);
  const bloco = repositorio.slice(inicio, fim);
  assert.match(bloco, /WHERE hash_arquivo = \$1/);
  assert.match(bloco, /LIMIT 1/);
  assert.doesNotMatch(bloco, /lerTabela/);
});
