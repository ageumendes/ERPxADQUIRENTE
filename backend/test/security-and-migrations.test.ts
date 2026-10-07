import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { autorizar, perfisDeEscrita } from '../src/security/auth.js';

test('perfis somente leitura nao pertencem ao conjunto de escrita', () => {
  assert.deepEqual(perfisDeEscrita(), ['ADMINISTRADOR', 'FINANCEIRO', 'OPERADOR']);
  let status = 0; let body: any; let avancou = false;
  const req = { usuario: { perfil: 'AUDITOR' } } as any;
  const res = { status(codigo: number) { status = codigo; return this; }, json(valor: any) { body = valor; return this; } } as any;
  autorizar(['ADMINISTRADOR', 'FINANCEIRO'])(req, res, () => { avancou = true; });
  assert.equal(avancou, false); assert.equal(status, 403); assert.equal(body.codigo, 'ACESSO_NEGADO');
});

test('migracoes de conciliacao e deduplicacao evitam TRUNCATE', async () => {
  const raizBackend = existsSync(path.resolve(process.cwd(), 'prisma')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  for (const arquivo of ['prisma/migration-v0.1.84.sql', 'prisma/migration-v0.1.85.sql']) {
    const sql = await readFile(path.join(raizBackend, arquivo), 'utf8');
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
    assert.match(sql, /BEGIN|CREATE/i);
  }
});

test('bootstrap preserva conversoes cadastradas pelo usuario', async () => {
  const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const bootstrap = await readFile(path.join(raizBackend, 'src/database/bootstrap.ts'), 'utf8');
  assert.match(bootstrap, /INSERT INTO \$\{conversoes\}[\s\S]+?ON CONFLICT \(row_id\) DO NOTHING/);
  assert.doesNotMatch(bootstrap, /DELETE FROM (?:"?conversoes"?|\$\{conversoes\})/i);
  assert.doesNotMatch(bootstrap, /INSERT INTO \$\{conversoes\}[\s\S]+?ON CONFLICT \(row_id\) DO UPDATE/i);
});

test('conversoes cadastradas usam a origem preservada e comparação canônica', async () => {
  const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const repositorio = await readFile(path.join(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
  const inicio = repositorio.indexOf('async function aplicarConversoesCadastradasEmTabelasExistentes');
  const fim = repositorio.indexOf('export async function salvarSicoobLayoutPspPix', inicio);
  const bloco = repositorio.slice(inicio, fim);

  assert.match(bloco, /CASE WHEN dados \? \$2/);
  assert.match(bloco, /TRANSLATE\(/);
  assert.match(bloco, /conversoes_bloqueadas/);
  assert.match(repositorio, /layout_origem[^\n]+vr_layout_16ap/);
});

test('aplicacao de conversoes retorna auditoria por regra', async () => {
  const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const repositorio = await readFile(path.join(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
  assert.match(repositorio, /relatorio_regras/);
  assert.match(repositorio, /registros_encontrados/);
  assert.match(repositorio, /registros_alterados/);
  assert.match(repositorio, /SEM_CORRESPONDENCIA/);
  assert.match(repositorio, /regras_com_erro/);
});

test('v0.1.116 aplica conversoes diretamente no JSONB do PostgreSQL', async () => {
  const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const repositorio = await readFile(path.join(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
  const inicio = repositorio.indexOf('async function aplicarConversoesCadastradasEmTabelasExistentes');
  const fim = repositorio.indexOf('export async function salvarSicoobLayoutPspPix', inicio);
  const bloco = repositorio.slice(inicio, fim);

  assert.match(bloco, /jsonb_set/);
  assert.match(bloco, /dados->>'adquirente'/);
  assert.match(bloco, /CASE WHEN dados \? \$2 THEN COALESCE\(dados->>\$2, ''\) ELSE COALESCE\(dados->>\$1, ''\) END/);
  assert.match(bloco, /IS DISTINCT FROM/);
  assert.match(bloco, /data_atualizacao = NOW\(\)/);
});

test('v0.1.147 exige PostgreSQL e remove banco local em JSON', async () => {
  const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const repositorio = await readFile(path.join(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');
  const paths = await readFile(path.join(raizBackend, 'src/database/paths.ts'), 'utf8');
  assert.match(repositorio, /DATABASE_URL é obrigatória/);
  assert.doesNotMatch(repositorio, /JsonPath|json-local|storage\/db|auditoria-duplicidades\.json/);
  assert.doesNotMatch(paths, /JsonPath|storage\/db/);
  assert.match(paths, /vendasAdquirentesTabela = 'vendas_adquirentes'/);
});

test('SFTP usa UUID nativo e preserva falha parcial de processed', async () => {
  const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const servico = await readFile(path.join(raizBackend, 'src/services/remote-edi.service.ts'), 'utf8');
  assert.match(servico, /randomUUID/);
  assert.doesNotMatch(servico, /from ['"]uuid['"]/);
  assert.match(servico, /não foi possível arquivá-lo remotamente em processed/);
  assert.match(servico, /falha ao mover .* para processed/);
  assert.match(servico, /if \(moveu\)/);
});

test('v0.1.114 exige fingerprint e separa os segredos SFTP', async () => {
  const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const servico = await readFile(path.join(raizBackend, 'src/services/remote-edi.service.ts'), 'utf8');
  assert.match(servico, /SFTP_ENCRYPTION_KEY/);
  assert.match(servico, /hostHash: 'sha256'/);
  assert.match(servico, /hostVerifier/);
});

test('v0.1.114 permite senha de oito ou mais caracteres', async () => {
  const raizBackend = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const auth = await readFile(path.join(raizBackend, 'src/security/auth.ts'), 'utf8');
  assert.match(auth, /senha\.length < 8/);
  assert.match(auth, /senhaNova\.length < 8/);
  assert.doesNotMatch(auth, /senha\.length < 12|senhaNova\.length < 12/);
});

test('v0.1.115 isola Excel e limita recursos dos parsers', async () => {
  const raiz = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const isolador = await readFile(path.join(raiz, 'src/services/excel-isolado.ts'), 'utf8');
  const parser = await readFile(path.join(raiz, 'src/parsers/interdata.ts'), 'utf8');
  assert.match(isolador, /--max-old-space-size/);
  assert.match(isolador, /PARSER_TIMEOUT_MS/);
  assert.match(isolador, /PARSER_MAX_ROWS/);
  assert.match(isolador, /PARSER_MAX_CELLS/);
  assert.doesNotMatch(parser, /require\(['"]xlsx['"]\)|XLSX\.readFile/);
});

test('v0.1.115 usa paginação SQL e inserção em lote sem SELECT prévio', async () => {
  const raiz = existsSync(path.resolve(process.cwd(), 'src')) ? process.cwd() : path.resolve(process.cwd(), 'backend');
  const repo = await readFile(path.join(raiz, 'src/repositories/repositorio.ts'), 'utf8');
  const append = repo.slice(repo.indexOf('async function appendTabelaPostgres'), repo.indexOf('export type Importacao'));
  const explorador = repo.slice(repo.indexOf('export async function listarTabelasBanco'), repo.indexOf('export async function limparTabelaBanco'));
  assert.match(append, /VALUES \$\{placeholders\.join/);
  assert.doesNotMatch(append, /SELECT pk FROM/);
  assert.match(explorador, /COUNT\(\*\)/);
  assert.match(explorador, /LIMIT/);
  assert.match(explorador, /proximo_cursor/);
  assert.doesNotMatch(explorador, /lerJson</);
});

test('Vite separa CSP de desenvolvimento e produção', async () => {
  const raiz = existsSync(path.resolve(process.cwd(), '../frontend')) ? path.resolve(process.cwd(), '..') : process.cwd();
  const vite = await readFile(path.join(raiz, 'frontend/vite.config.ts'), 'utf8');
  assert.match(vite, /server:\s*\{\s*headers: developmentSecurityHeaders/);
  assert.match(vite, /preview:\s*\{\s*headers: productionSecurityHeaders/);
  assert.match(vite, /developmentSecurityHeaders[\s\S]+unsafe-inline/);
  const producao = vite.slice(vite.indexOf('const productionSecurityHeaders'));
  assert.match(producao, /script-src 'self';/);
  assert.doesNotMatch(producao, /script-src[^;]+unsafe-inline/);
  assert.match(producao, /style-src 'self' 'unsafe-inline'/);
});
