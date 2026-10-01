import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const raiz = process.cwd().endsWith('backend') ? process.cwd() : resolve(process.cwd(), 'backend');
const repositorio = readFileSync(resolve(raiz, 'src/repositories/repositorio.ts'), 'utf8');
const servidor = readFileSync(resolve(raiz, 'src/server.ts'), 'utf8');
const bootstrap = readFileSync(resolve(raiz, 'src/database/bootstrap.ts'), 'utf8');
const rotas = readFileSync(resolve(raiz, 'src/routes/conversoes.routes.ts'), 'utf8');
const frontend = readFileSync(resolve(raiz, '../frontend/src/main.tsx'), 'utf8');

test('venda SIPAG complementada grava o identificador do último lote na raiz', () => {
  const bloco = readFileSync(resolve(raiz, 'src/services/sipag-complementacao.ts'), 'utf8');
  assert.match(bloco, /ultima_importacao_id: novo\.importacao_id/);
});

test('consultas incrementais aceitam o formato legado dentro de dados_json', () => {
  assert.match(repositorio, /dados->'dados_json'->>'ultima_importacao_id'/);
  assert.match(bootstrap, /idx_\$\{tabela\}_escopo_importacao_v194/);
});

test('serviço e superfícies de consulta BIN foram removidos', () => {
  assert.equal(existsSync(resolve(raiz, 'src/services/bin-lookup-scheduler.service.ts')), false);
  assert.doesNotMatch(servidor, /agendarConsultaAutomaticaBins|bins-auto/);
  assert.doesNotMatch(rotas, /\/api\/conversoes\/bins/);
  assert.doesNotMatch(frontend, /Catálogo de BINs|Identificar online \(até 5\)/);
});

test('bootstrap desativa somente conversões de bandeira cujo original é BIN', () => {
  assert.match(bootstrap, /UPDATE conversoes[\s\S]*tabela_origem'[\s\S]*vendas_adquirentes[\s\S]*coluna_origem'[\s\S]*bandeira[\s\S]*\^\[0-9\]\{6\}\$/);
  assert.match(bootstrap, /\['0\.1\.194'/);
});
