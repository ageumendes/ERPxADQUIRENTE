import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const lerFrontend = (arquivo: string) => readFile(path.resolve(raizBackend, '../frontend', arquivo), 'utf8');

test('dashboard consulta a data dos itens e não a data de importação', async () => {
  const rotas = await readFile(path.resolve(raizBackend, 'src/routes/core.routes.ts'), 'utf8');
  assert.match(rotas, /FROM vendas_adquirentes/);
  assert.match(rotas, /FROM vendas_interdata/);
  assert.match(rotas, /registros_brutos/);
  assert.match(rotas, /WHERE data_itens = \$1/);
  assert.doesNotMatch(rotas, /const deHoje = correspondentes\.filter/);
});

test('dashboard agrupa adquirentes e expande arquivos com nomes amigáveis', async () => {
  const [pagina, tipos] = await Promise.all([
    lerFrontend('src/main.tsx'),
    lerFrontend('src/types/importacoes.ts'),
  ]);
  assert.match(pagina, /gruposExpandidos/);
  assert.match(pagina, /Data dos itens/);
  assert.match(pagina, /Data da importação/);
  assert.match(pagina, /pendencias\?\.grupos/);
  assert.doesNotMatch(pagina, /<th>Item esperado<\/th>|<th>Registros hoje<\/th>/);
  assert.match(tipos, /DashboardGrupoImportado/);
});

test('backend converte layouts CIELO em tipos compreensíveis', async () => {
  const rotas = await readFile(path.resolve(raizBackend, 'src/routes/core.routes.ts'), 'utf8');
  assert.match(rotas, /CIELO16[^\n]*return 'PIX'/);
  assert.match(rotas, /CIELO03[^\n]*return 'VENDAS'/);
  assert.match(rotas, /CIELO04[^\n]*return 'PAGAMENTOS'/);
});
