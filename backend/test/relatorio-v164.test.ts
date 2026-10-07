import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { APP_VERSION } from '../src/version.js';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const lerFrontend = (arquivo: string) => readFile(path.resolve(raizBackend, '../frontend', arquivo), 'utf8');

test('versão atual mantém pacotes sincronizados', async () => {
  assert.match(APP_VERSION, /^0\.1\.\d+$/);
  const [raiz, backend, frontend, tema] = await Promise.all([
    readFile(path.resolve(raizBackend, '../package.json'), 'utf8'),
    readFile(path.resolve(raizBackend, 'package.json'), 'utf8'),
    lerFrontend('package.json'), lerFrontend('src/lib/theme.ts'),
  ]);
  for (const pacote of [raiz, backend, frontend]) assert.equal(JSON.parse(pacote).version, APP_VERSION);
  assert.ok(tema.includes(`version: '${APP_VERSION}'`));
});

test('atualização da URL não navega pelo React Router nem repete o carregamento', async () => {
  const hook = await lerFrontend('src/hooks/useRelatorioFinanceiro.ts');
  assert.doesNotMatch(hook, /useSearchParams|setSearchParams/);
  assert.match(hook, /window\.history\.replaceState/);
  assert.match(hook, /const carregarRelatorio = useCallback\([\s\S]*?\}, \[\]\);/);
  assert.doesNotMatch(hook, /\}, \[setSearchParams\]\);/);
  assert.match(hook, /useEffect\(\(\) => \{\s*void carregarRelatorio\(filtrosIniciais\)/);
});

test('atalhos não exibem Hoje e os cards SFTP usam cabeçalho compacto', async () => {
  const [pagina, main, estilo] = await Promise.all([
    lerFrontend('src/pages/RelatoriosAdquirentesPage.tsx'),
    lerFrontend('src/main.tsx'),
    lerFrontend('src/styles.css'),
  ]);
  assert.doesNotMatch(pagina, /aplicarPeriodo\('HOJE'\)|>Hoje</);
  assert.match(main, /<SftpImportPanel onImportacoesAlteradas=\{loadImports\}/);
  assert.match(estilo, /\.provider-cards[\s\S]*?grid-auto-flow:\s*column/);
});

test('coleta SFTP reconta o diretório de entrada e possui fallback de arquivamento', async () => {
  const servico = await readFile(path.resolve(raizBackend, 'src/services/remote-edi.service.ts'), 'utf8');
  assert.match(servico, /const listaFinal = await client\.list\(provider\.inDir\)/);
  assert.match(servico, /await client\.fastPut\(copiaLocal, destino\)/);
  assert.match(servico, /await client\.delete\(origem\)/);
});

test('log do relatório identifica o período efetivamente consultado', async () => {
  const repositorio = await readFile(path.resolve(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
  assert.match(repositorio, /periodo=\$\{periodoLog\}/);
  assert.match(repositorio, /filtros\.data_inicio/);
  assert.match(repositorio, /filtros\.data_fim/);
});
