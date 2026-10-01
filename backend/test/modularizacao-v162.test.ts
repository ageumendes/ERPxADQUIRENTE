import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { APP_VERSION } from '../src/version.js';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const lerBackend = (arquivo: string) => readFile(path.join(raizBackend, arquivo), 'utf8');
const lerFrontend = (arquivo: string) => readFile(path.resolve(raizBackend, '../frontend', arquivo), 'utf8');

test('versão permanece sincronizada após a v0.1.162', async () => {
  assert.match(APP_VERSION, /^0\.1\.\d+$/);
  const [raiz, backend, frontend, tema] = await Promise.all([
    readFile(path.resolve(raizBackend, '../package.json'), 'utf8'),
    lerBackend('package.json'), lerFrontend('package.json'), lerFrontend('src/lib/theme.ts'),
  ]);
  for (const pacote of [raiz, backend, frontend]) assert.equal(JSON.parse(pacote).version, APP_VERSION);
  assert.ok(tema.includes(`version: '${APP_VERSION}'`));
});

test('relatório financeiro está modularizado fora do main', async () => {
  const [main, pagina, hook, tipos] = await Promise.all([
    lerFrontend('src/main.tsx'), lerFrontend('src/pages/RelatoriosAdquirentesPage.tsx'),
    lerFrontend('src/hooks/useRelatorioFinanceiro.ts'), lerFrontend('src/types/relatorios.ts'),
  ]);
  assert.doesNotMatch(main, /function RelatoriosAdquirentesPage|type RelatorioAdquirentes/);
  assert.match(pagina, /export function RelatoriosAdquirentesPage/);
  assert.match(pagina, /exportarCsv/);
  assert.match(pagina, /exportarExcel/);
  assert.match(pagina, /imprimirRelatorio/);
  assert.match(hook, /URLSearchParams/);
  assert.match(hook, /AbortController/);
  assert.match(hook, /controller\.signal\.aborted/);
  assert.match(tipos, /export type RelatorioAdquirentes/);
});

test('consulta financeira reutiliza base materializada e possui índices dedicados', async () => {
  const [repositorio, bootstrap] = await Promise.all([
    lerBackend('src/repositories/repositorio.ts'), lerBackend('src/database/bootstrap.ts'),
  ]);
  assert.match(repositorio, /WITH base AS MATERIALIZED/);
  assert.match(repositorio, /consultaAgrupamentos/);
  assert.match(repositorio, /UNION ALL/);
  assert.match(repositorio, /Promise\.all/);
  assert.match(bootstrap, /idx_vendas_adquirentes_relatorio_data_adquirente/);
  assert.match(bootstrap, /idx_vendas_adquirentes_status_transacao/);
  assert.match(bootstrap, /idx_vendas_adquirentes_duplicidade_status/);
});
