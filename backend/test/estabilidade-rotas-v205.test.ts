import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { protegerRotasAssincronas } from '../src/http/async-routes.js';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const rotasAssincronas = fs.readFileSync(path.resolve(raizBackend, 'src/http/async-routes.ts'), 'utf8');
const servidor = fs.readFileSync(path.resolve(raizBackend, 'src/server.ts'), 'utf8');
const repositorio = fs.readFileSync(path.resolve(raizBackend, 'src/repositories/repositorio.ts'), 'utf8');

test('todas as rotas async encaminham rejeições ao middleware de erro do Express 4', () => {
  assert.match(rotasAssincronas, /Promise\.resolve\(resultado\)\.catch\(next\)/);
  assert.match(rotasAssincronas, /next\(error\)/);
  assert.match(rotasAssincronas, /'get', 'post', 'put', 'patch', 'delete'/);
  assert.match(servidor, /protegerRotasAssincronas\(app\)/);
});

test('rejeição real de um handler async alcança o middleware e o servidor continua respondendo', async () => {
  const app = express();
  protegerRotasAssincronas(app);
  app.get('/falha', async () => { throw new Error('timeout simulado'); });
  app.get('/saude', async (_req, res) => { res.json({ status: 'online' }); });
  app.use((_error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(503).json({ codigo: 'BANCO_TEMPORARIAMENTE_OCUPADO' });
  });

  const servidor = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    servidor.once('listening', resolve);
    servidor.once('error', reject);
  });
  try {
    const endereco = servidor.address();
    assert.ok(endereco && typeof endereco !== 'string');
    const base = `http://127.0.0.1:${endereco.port}`;
    const falha = await fetch(`${base}/falha`);
    assert.equal(falha.status, 503);
    const saude = await fetch(`${base}/saude`);
    assert.equal(saude.status, 200);
    assert.deepEqual(await saude.json(), { status: 'online' });
  } finally {
    await new Promise<void>((resolve, reject) => servidor.close((error) => error ? reject(error) : resolve()));
  }
});

test('timeouts do pool recebem 503 sem encerrar o processo', () => {
  assert.match(rotasAssincronas, /timeout exceeded when trying to connect/);
  assert.match(rotasAssincronas, /53300/);
  assert.match(servidor, /erroBancoTemporariamenteIndisponivel\(error\)/);
  assert.match(servidor, /BANCO_TEMPORARIAMENTE_OCUPADO/);
});

test('opções do ERP não reservam três conexões simultâneas', () => {
  const bloco = repositorio.match(/export async function obterOpcoesVendasErp[\s\S]*?export async function listarVendasAdquirentesComExibicao/)?.[0] || '';
  assert.match(bloco, /opcoesErpCache/);
  assert.match(bloco, /opcoesErpEmAndamento/);
  assert.doesNotMatch(bloco, /Promise\.all\(/);
  assert.match(bloco, /const estabelecimentos = await valoresDistintosPostgres[\s\S]*const modalidades = await valoresDistintosPostgres[\s\S]*const bandeiras = await valoresDistintosPostgres/);
});
