import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const raizProjeto = path.resolve(raizBackend, '..');
const repositorio = fs.readFileSync(path.resolve(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
const bootstrap = fs.readFileSync(path.resolve(raizBackend, 'src/database/bootstrap.ts'), 'utf8');
const servidor = fs.readFileSync(path.resolve(raizBackend, 'src/server.ts'), 'utf8');
const appShell = fs.readFileSync(path.resolve(raizProjeto, 'frontend/src/components/AppShell.tsx'), 'utf8');
const estilos = fs.readFileSync(path.resolve(raizProjeto, 'frontend/src/styles.css'), 'utf8');
const filtros = fs.readFileSync(path.resolve(raizProjeto, 'frontend/src/components/FiltrosVendas.tsx'), 'utf8');

test('regras NÃO APLICA usam pagador_documento e corrigem somente os dois CNPJs próprios SICOOB', () => {
  assert.match(repositorio, /'pagador_documento'/);
  assert.match(bootstrap, /0\.1\.202-pagador-documento-nao-aplica/);
  assert.match(bootstrap, /jsonb_set\(dados, '\{coluna_origem\}', to_jsonb\('pagador_documento'::text\)/);
  assert.match(bootstrap, /27752608000129/);
  assert.match(bootstrap, /27752608000200/);
  assert.match(bootstrap, /adquirente_aplicacao[\s\S]*SICOOB/);
});

test('bandeiras numéricas são consolidadas como Outras nas consultas e nos filtros', () => {
  assert.match(repositorio, /\^\[0-9\]\+\$'[\s\S]*THEN 'OUTRAS'/);
  assert.match(repositorio, /function bandeiraParaExibicao/);
  assert.match(filtros, /\^\\d\+\$/);
  assert.match(filtros, /'Outras'/);
});

test('central mantém controles compactos e paginação dentro da área visível', () => {
  assert.match(estilos, /\.conciliacao-control-bar[\s\S]*grid-template-columns/);
  assert.match(estilos, /\.manual-side\{[\s\S]*overflow:hidden/);
  assert.match(estilos, /\.manual-conciliacao-columns\.inline-columns \.manual-side \{ grid-template-rows: auto auto minmax\(0,1fr\) auto; \}/);
  assert.match(estilos, /\.manual-pagination \{[\s\S]*flex: 0 0 auto/);
});

test('indicador global acompanha HTTP e trabalhos de segundo plano', () => {
  assert.match(appShell, /erp:atividade-http/);
  assert.match(appShell, /global-activity-bar/);
  assert.match(appShell, /global-activity-spinner/);
  assert.match(servidor, /atividade_em_segundo_plano/);
  assert.match(servidor, /Aplicando conversões/);
  assert.match(servidor, /Executando conciliação automática/);
});
