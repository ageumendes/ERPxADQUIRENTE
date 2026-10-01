import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(process.cwd(), '..');
const erp = readFileSync(resolve(raiz, 'frontend/src/pages/VendasErpPage.tsx'), 'utf8');
const filtros = readFileSync(resolve(raiz, 'frontend/src/components/FiltrosVendas.tsx'), 'utf8');
const relatorio = readFileSync(resolve(raiz, 'frontend/src/pages/RelatoriosAdquirentesPage.tsx'), 'utf8');
const hookRelatorio = readFileSync(resolve(raiz, 'frontend/src/hooks/useRelatorioFinanceiro.ts'), 'utf8');
const rotas = readFileSync(resolve(raiz, 'backend/src/routes/core.routes.ts'), 'utf8');
const repositorio = readFileSync(resolve(raiz, 'backend/src/repositories/repositorio.ts'), 'utf8');

test('Vendas ERP exibe o estabelecimento e as duas listagens compartilham o filtro', () => {
  assert.match(erp, /chave: 'estabelecimento', titulo: 'Loja'/);
  assert.match(erp, /venda\.cnpj_estabelecimento, venda\.codigo_estabelecimento/);
  assert.match(filtros, /label>Loja<\/label>/);
  assert.match(filtros, /opcoes\.estabelecimentos/);
  assert.match(filtros, /estabelecimento: ''/);
});

test('relatório preserva estabelecimento na URL e envia o filtro ao backend', () => {
  assert.match(relatorio, /atualizarFiltro\('estabelecimento'/);
  assert.match(relatorio, /filtrosAplicados\.estabelecimento/);
  assert.match(hookRelatorio, /'estabelecimento'/);
  assert.ok((rotas.match(/estabelecimento: req\.query\.estabelecimento/g) || []).length >= 3);
});

test('PostgreSQL filtra pelo campo correto de cada tabela e oferece valores distintos', () => {
  assert.match(repositorio, /vendas_adquirentes[\s\S]*?COALESCE\(NULLIF\(dados->>'codigo_estabelecimento',''\), dados->>'cnpj_estabelecimento'/);
  assert.match(repositorio, /vendas_interdata[\s\S]*?COALESCE\(NULLIF\(dados->>'cnpj_estabelecimento',''\), dados->>'codigo_estabelecimento'/);
  assert.match(repositorio, /tabela: 'vendas_adquirentes'[\s\S]*?estabelecimento: 'estabelecimento_filtro'/);
  assert.match(repositorio, /texto\('estabelecimento'\)/);
  assert.match(repositorio, /valoresDistintosPostgres\(config, config\.estabelecimento/);
});
