import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { APP_VERSION } from '../src/version.js';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const lerFrontend = (arquivo: string) => readFile(path.resolve(raizBackend, '../frontend', arquivo), 'utf8');

test('versão permanece sincronizada após a v0.1.163', async () => {
  assert.match(APP_VERSION, /^0\.1\.\d+$/);
  const [raiz, backend, frontend, tema] = await Promise.all([
    readFile(path.resolve(raizBackend, '../package.json'), 'utf8'),
    readFile(path.resolve(raizBackend, 'package.json'), 'utf8'),
    lerFrontend('package.json'), lerFrontend('src/lib/theme.ts'),
  ]);
  for (const pacote of [raiz, backend, frontend]) assert.equal(JSON.parse(pacote).version, APP_VERSION);
  assert.ok(tema.includes(`version: '${APP_VERSION}'`));
});

test('relatório não expõe filtros de duplicidade e conciliação', async () => {
  const [pagina, tipos, hook] = await Promise.all([
    lerFrontend('src/pages/RelatoriosAdquirentesPage.tsx'),
    lerFrontend('src/types/relatorios.ts'),
    lerFrontend('src/hooks/useRelatorioFinanceiro.ts'),
  ]);
  assert.doesNotMatch(pagina, /<label>Duplicidade<\/label>|<label>Conciliação<\/label>/);
  assert.doesNotMatch(tipos, /duplicidade: string|conciliacao: string/);
  assert.doesNotMatch(hook, /'duplicidade'|'conciliacao'/);
});

test('atalhos de período atualizam datas e consultam imediatamente', async () => {
  const pagina = await lerFrontend('src/pages/RelatoriosAdquirentesPage.tsx');
  assert.match(pagina, /function aplicarPeriodo/);
  assert.match(pagina, /setFiltros\(proximosFiltros\)/);
  assert.match(pagina, /carregarRelatorio\(proximosFiltros\)/);
  for (const periodo of ['ONTEM', '7_DIAS', 'MES_ATUAL', 'MES_ANTERIOR']) {
    assert.match(pagina, new RegExp(`aplicarPeriodo\\('${periodo}'\\)`));
  }
  assert.doesNotMatch(pagina, /aplicarPeriodo\('HOJE'\)/);
});
