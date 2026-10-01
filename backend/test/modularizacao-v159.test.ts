import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { APP_VERSION } from '../src/version.js';

const raizBackend = process.cwd().endsWith('backend') ? process.cwd() : path.resolve(process.cwd(), 'backend');
const lerBackend = (arquivo: string) => readFile(path.join(raizBackend, arquivo), 'utf8');
const lerFrontend = (arquivo: string) => readFile(path.resolve(raizBackend, '../frontend', arquivo), 'utf8');

test('versão permanece sincronizada após a modularização da v0.1.159', async () => {
  const [backendPackage, frontendPackage, theme] = await Promise.all([
    lerBackend('package.json'),
    lerFrontend('package.json'),
    lerFrontend('src/lib/theme.ts'),
  ]);
  assert.equal(JSON.parse(backendPackage).version, APP_VERSION);
  assert.equal(JSON.parse(frontendPackage).version, APP_VERSION);
  assert.ok(theme.includes(`version: '${APP_VERSION}'`));
});

test('domínio de importações não permanece no repositório monolítico', async () => {
  const [fachada, monolito, importacoes] = await Promise.all([
    lerBackend('src/repositorio.ts'),
    lerBackend('src/repositories/repositorio.ts'),
    lerBackend('src/repositories/importacoes.repository.ts'),
  ]);
  assert.match(fachada, /repositories\/repositorio\.js/);
  assert.doesNotMatch(monolito, /export async function listarImportacoes/);
  assert.match(monolito, /from '\.\/importacoes\.repository\.js'/);
  assert.match(importacoes, /export async function listarImportacoes/);
  assert.match(importacoes, /randomUUID\(\)/);
});

test('Remote EDI usa o módulo de importações sem depender do monólito', async () => {
  const remoteEdi = await lerBackend('src/services/remote-edi.service.ts');
  assert.match(remoteEdi, /from '\.\.\/repositories\/importacoes\.repository\.js'/);
  assert.doesNotMatch(remoteEdi, /from '\.\.\/repositories\/repositorio\.js'/);
});

test('frontend consome tipos, utilitários e logos modularizados', async () => {
  const [main, relatorio, tipos, utilitarios, logos] = await Promise.all([
    lerFrontend('src/main.tsx'),
    lerFrontend('src/pages/RelatoriosAdquirentesPage.tsx'),
    lerFrontend('src/types/importacoes.ts'),
    lerFrontend('src/lib/importacoes.ts'),
    lerFrontend('src/lib/payment-logos.ts'),
  ]);
  assert.match(main, /from '\.\/types\/importacoes'/);
  assert.match(main, /from '\.\/lib\/importacoes'/);
  assert.match(`${main}\n${relatorio}`, /from '\.\.\/lib\/payment-logos'/);
  assert.doesNotMatch(main, /assets\/payment-logos/);
  assert.match(tipos, /export type Importacao/);
  assert.match(utilitarios, /export function statusLabel/);
  assert.match(logos, /export const adquirenteLogoMap/);
});
