import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { copySftpFile, listSftpFolder, resolveSftpFolder, validateSftpFilename, withSftpBrowser, type BrowserClient } from '../src/services/sftp-browser.js';
const providers = [{ key: 'sipag', nome: 'SIPAG', usuario: 'sipag_sftp', inDir: '/in', processedDir: '/processed', errorDir: '/error' }];
function client(patch: Partial<BrowserClient> = {}): BrowserClient {
  return { list: async () => [], realPath: async p => p, lstat: async () => ({ isFile: true, isSymbolicLink: false }),
    fastGet: async (_r, l) => { await fs.writeFile(l, Buffer.from([0, 1, 2, 255])); }, end: async () => undefined, ...patch };
}
test('somente adquirentes cadastradas e três pastas configuradas', () => {
  for (const folder of ['in', 'processed', 'error']) assert.equal(resolveSftpFolder(providers, 'sipag', folder).dir, `/${folder}`);
  for (const folder of ['/processed', '../error', 'other', ['in']]) assert.throws(() => resolveSftpFolder(providers, 'sipag', folder));
  assert.throws(() => resolveSftpFolder(providers, 'outro_usuario', 'in'));
});
test('nomes não permitem traversal; acentos, espaços e caracteres de URL são preservados', () => {
  for (const name of ['../a', '/a', 'x/y', 'x\\y', '.', '..', '', 'a\n.txt', 'a\0.txt', ['a']]) assert.throws(() => validateSftpFilename(name));
  for (const name of ['Relatório (1).csv', 'A&B #1%.txt', '.arquivo', 'a..b']) assert.doesNotThrow(() => validateSftpFilename(name));
});
test('lista todos os arquivos regulares sem restringir layouts ou extensões e ordena recentes primeiro', async () => {
  const files = await listSftpFolder(client({ list: async () => [
    {name:'sem_extensao', type:'-',size:0,modifyTime:1000}, {name:'arquivo.zip',type:'-',size:4,modifyTime:2000},
    {name:'link',type:'l',size:1}, {name:'subpasta',type:'d',size:1}, {name:'../invasor',type:'-',size:1},
  ] }), '/processed');
  assert.deepEqual(files.map(f => f.nome), ['arquivo.zip', 'sem_extensao']);
  assert.equal(files[1].tamanho_bytes, 0);
});
test('download preserva bytes, usa somente leitura remota e limpa temporário', async () => {
  const calls: string[] = [];
  const c=client({ fastGet: async (r,l) => { calls.push(r); await fs.writeFile(l, Buffer.from([0,1,2,255])); } });
  const result = await withSftpBrowser(async () => c, (active, signal) => copySftpFile(active, '/processed', 'Relatório & 1.csv', signal));
  assert.deepEqual(await fs.readFile(result.local), Buffer.from([0,1,2,255]));
  assert.deepEqual(calls, ['/processed/Relatório & 1.csv']);
  await result.cleanup(); await assert.rejects(fs.stat(result.local));
});
test('rejeita symlink, diretório e realpath fora da pasta antes de baixar', async () => {
  for (const patch of [
    { lstat: async () => ({ isFile: false, isSymbolicLink: true }) },
    { lstat: async () => ({ isFile: false, isSymbolicLink: false }) },
    { realPath: async (p: string) => p === '/processed' ? p : '/error/a.csv' },
  ]) {
    let downloaded=false;
    await assert.rejects(copySftpFile(client({...patch,fastGet:async()=>{downloaded=true;}}),'/processed','a.csv'));
    assert.equal(downloaded,false);
  }
});
test('falha no download remove a cópia parcial e encerra conexão', async () => {
  let local=''; let ended=0;
  const c=client({fastGet:async(_r,l)=>{local=l;await fs.writeFile(l,'parcial');throw new Error('falha');},end:async()=>{ended++;}});
  await assert.rejects(withSftpBrowser(async()=>c,(active,signal)=>copySftpFile(active,'/in','a',signal)),/falha/);
  await assert.rejects(fs.stat(path.dirname(local))); assert.equal(ended,1);
});
test('cancelamento encerra a conexão e impede concluir a operação', async () => {
  const abort=new AbortController(); let ended=0;
  const promise=withSftpBrowser(async()=>client({end:async()=>{ended++;}}),async()=>{abort.abort();return new Promise<never>(()=>{});},abort.signal);
  await assert.rejects(promise,/cancelada/); assert.ok(ended>=1);
});
test('timeout fecha a conexão de uma operação sem resposta', async () => {
  let ended=0;
  await assert.rejects(withSftpBrowser(async()=>client({end:async()=>{ended++;}}),async()=>new Promise<never>(()=>{}),undefined,15),/demorou/);
  assert.ok(ended>=1);
});
