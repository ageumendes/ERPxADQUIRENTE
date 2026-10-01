import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { APP_VERSION } from '../src/version.js';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const lerBackend = (arquivo: string) => readFile(path.join(raizBackend, arquivo), 'utf8');
const lerFrontend = (arquivo: string) => readFile(path.resolve(raizBackend, '../frontend', arquivo), 'utf8');

test('versão permanece sincronizada após a v0.1.161', async () => {
  assert.match(APP_VERSION, /^0\.1\.\d+$/);
  const [backendPackage, frontendPackage, theme] = await Promise.all([
    lerBackend('package.json'), lerFrontend('package.json'), lerFrontend('src/lib/theme.ts'),
  ]);
  assert.equal(JSON.parse(backendPackage).version, APP_VERSION);
  assert.equal(JSON.parse(frontendPackage).version, APP_VERSION);
  assert.ok(theme.includes(`version: '${APP_VERSION}'`));
});

test('páginas de vendas e filtros estão fora do main', async () => {
  const [main, erp, adquirentes, filtros, tipos] = await Promise.all([
    lerFrontend('src/main.tsx'),
    lerFrontend('src/pages/VendasErpPage.tsx'),
    lerFrontend('src/pages/VendasAdquirentesPage.tsx'),
    lerFrontend('src/components/FiltrosVendas.tsx'),
    lerFrontend('src/types/vendas.ts'),
  ]);
  assert.doesNotMatch(main, /function (VendasErpPage|VendasAdquirentesPage|FiltrosVendas)/);
  assert.match(erp, /export function VendasErpPage/);
  assert.match(adquirentes, /export function VendasAdquirentesPage/);
  assert.match(filtros, /export function FiltrosVendas/);
  assert.match(tipos, /export type VendaErp/);
  assert.match(tipos, /export type VendaAdquirente/);
});

test('busca de vendas possui debounce, URL, cancelamento e filtro SQL parametrizado', async () => {
  const [hook, erp, adquirentes, repositorio, rotas] = await Promise.all([
    lerFrontend('src/hooks/useFiltrosVendas.ts'),
    lerFrontend('src/pages/VendasErpPage.tsx'),
    lerFrontend('src/pages/VendasAdquirentesPage.tsx'),
    lerBackend('src/repositories/repositorio.ts'),
    lerBackend('src/routes/core.routes.ts'),
  ]);
  assert.match(hook, /useSearchParams/);
  assert.match(hook, /useValorDebounced/);
  assert.match(erp, /AbortController/);
  assert.match(adquirentes, /AbortController/);
  assert.match(repositorio, /codigo_autorizacao/);
  assert.match(repositorio, /parametroBusca/);
  assert.match(rotas, /busca: req\.query\.busca/);
});
