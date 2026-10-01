import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const raiz = process.cwd().endsWith('backend') ? process.cwd() : resolve(process.cwd(), 'backend');
const repositorio = readFileSync(resolve(raiz, 'src/repositories/repositorio.ts'), 'utf8');
const rotas = readFileSync(resolve(raiz, 'src/routes/core.routes.ts'), 'utf8');
const frontend = readFileSync(resolve(raiz, '../frontend/src/main.tsx'), 'utf8');

test('v0.1.206 cria projeções indexadas sem alterar o JSONB original', () => {
  assert.match(repositorio, /data_venda_filtro TEXT GENERATED ALWAYS AS/);
  assert.match(repositorio, /registro_nao_aplicavel BOOLEAN GENERATED ALWAYS AS/);
  assert.match(repositorio, /pagador_documento/);
  assert.match(repositorio, /idx_vendas_interdata_data_filtro/);
  assert.match(repositorio, /idx_vendas_adquirentes_data_adquirente/);
});

test('data mais recente usa índice, ordenação descendente e limite um', () => {
  const inicio = repositorio.indexOf('export async function obterDataMaisRecenteErpParaConciliacao');
  const fim = repositorio.indexOf('export async function obterInicializacaoConciliacoes', inicio);
  const bloco = repositorio.slice(inicio, fim);
  assert.match(bloco, /ORDER BY e\.data_venda_filtro DESC/);
  assert.match(bloco, /LIMIT 1/);
  assert.doesNotMatch(bloco, /SELECT MAX\(/);
});

test('Central de Conciliações usa um único endpoint dedicado na inicialização', () => {
  assert.match(rotas, /\/api\/conciliacoes\/inicializacao/);
  const inicio = frontend.indexOf('async function carregarInicializacaoConciliacoes');
  const fim = frontend.indexOf('async function executarConciliacao', inicio);
  const bloco = frontend.slice(inicio, fim);
  assert.match(bloco, /\/api\/conciliacoes\/inicializacao/);
  assert.doesNotMatch(bloco, /\/api\/vendas-erp\/opcoes/);
  assert.doesNotMatch(bloco, /\/api\/vendas-adquirentes\/opcoes/);
});

test('inicialização estrutural do PostgreSQL é compartilhada entre requisições concorrentes', () => {
  assert.match(repositorio, /let inicializacaoDbPostgres: Promise<void> \| null/);
  assert.match(repositorio, /if \(!inicializacaoDbPostgres\)/);
  assert.match(repositorio, /await inicializacaoDbPostgres/);
});
