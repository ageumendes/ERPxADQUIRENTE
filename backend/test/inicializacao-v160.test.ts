import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { APP_VERSION } from '../src/version.js';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');

test('grafo local de imports ESM está íntegro antes da inicialização', () => {
  const resultado = spawnSync(process.execPath, ['scripts/verificar-imports-esm.mjs'], {
    cwd: raizBackend,
    encoding: 'utf8',
  });
  assert.equal(resultado.status, 0, `${resultado.stdout}\n${resultado.stderr}`);
  assert.match(resultado.stdout, /Smoke test ESM/);
});

test('páginas extraídas na v0.1.160 permanecem fora do ponto de entrada', async () => {
  const raizFrontend = path.resolve(raizBackend, '../frontend');
  const [main, duplicidades, auditoria, usuarios] = await Promise.all([
    readFile(path.join(raizFrontend, 'src/main.tsx'), 'utf8'),
    readFile(path.join(raizFrontend, 'src/pages/DuplicidadesPage.tsx'), 'utf8'),
    readFile(path.join(raizFrontend, 'src/pages/AuditoriaReversoesPage.tsx'), 'utf8'),
    readFile(path.join(raizFrontend, 'src/pages/UsersPage.tsx'), 'utf8'),
  ]);
  assert.doesNotMatch(main, /function (DuplicidadesPage|AuditoriaReversoesPage|UsersPage)/);
  assert.match(main, /from '\.\/pages\/DuplicidadesPage'/);
  assert.match(duplicidades, /export function DuplicidadesPage/);
  assert.match(auditoria, /export function AuditoriaReversoesPage/);
  assert.match(usuarios, /export function UsersPage/);
});
