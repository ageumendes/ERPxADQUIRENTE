import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class SftpBrowserError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type SftpFolder = 'in' | 'processed' | 'error';
export type BrowserProvider = { key: string; nome: string; usuario: string; inDir: string; processedDir: string; errorDir: string };
export type BrowserClient = {
  list(dir: string): Promise<Array<{ name: string; type: string; size: number; modifyTime?: number }>>;
  realPath(remote: string): Promise<string>;
  lstat(remote: string): Promise<{ isFile: boolean; isSymbolicLink: boolean }>;
  fastGet(remote: string, local: string): Promise<unknown>;
  end(): Promise<unknown>;
};

export function resolveSftpFolder(providers: BrowserProvider[], providerKey: unknown, folder: unknown) {
  const provider = providers.find(p => p.key === providerKey);
  if (!provider) throw new SftpBrowserError(400, 'Selecione uma adquirente válida.');
  if (folder !== 'in' && folder !== 'processed' && folder !== 'error') throw new SftpBrowserError(400, 'Selecione uma pasta válida.');
  const dir = { in: provider.inDir, processed: provider.processedDir, error: provider.errorDir }[folder];
  if (!dir || !path.posix.isAbsolute(dir)) throw new SftpBrowserError(400, 'A pasta SFTP deve estar configurada com um caminho absoluto.');
  return { provider, folder, dir };
}

export function validateSftpFilename(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\/\\\x00-\x1f\x7f]/.test(name)) {
    throw new SftpBrowserError(400, 'Nome de arquivo inválido.');
  }
}

// A mesma conexão é encerrada no sucesso, erro, cancelamento e limite de duração.
export async function withSftpBrowser<T>(connect: () => Promise<BrowserClient>, action: (client: BrowserClient, signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 300000): Promise<T> {
  const operation = new AbortController();
  let client: BrowserClient | undefined;
  let interrupted = false;
  let rejectStop: (error: Error) => void = () => undefined;
  const stop = new Promise<never>((_, reject) => { rejectStop = reject; });
  const interrupt = (error: Error) => {
    interrupted = true;
    operation.abort();
    rejectStop(error);
    void client?.end().catch(() => undefined);
  };
  const abort = () => interrupt(new SftpBrowserError(499, 'Operação cancelada.'));
  const timer = setTimeout(() => interrupt(new SftpBrowserError(504, 'O servidor demorou para responder. Tente novamente.')), timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    return await Promise.race([stop, (async () => {
      if (interrupted) throw new SftpBrowserError(499, 'Operação cancelada.');
      client = await connect();
      if (interrupted) {
        await client.end().catch(() => undefined);
        throw new SftpBrowserError(499, 'Operação cancelada.');
      }
      return action(client, operation.signal);
    })()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await client?.end().catch(() => undefined);
  }
}

export async function listSftpFolder(client: BrowserClient, dir: string) {
  const rows = await client.list(dir);
  return rows.filter(row => {
    try { validateSftpFilename(row.name); return row.type === '-'; } catch { return false; }
  }).map(row => ({ nome: row.name, tamanho_bytes: row.size, modificado_em: row.modifyTime && Number.isFinite(row.modifyTime) ? new Date(row.modifyTime).toISOString() : null }))
    .sort((a, b) => (b.modificado_em || '').localeCompare(a.modificado_em || '') || a.nome.localeCompare(b.nome));
}

export async function copySftpFile(client: BrowserClient, dir: string, name: unknown, signal?: AbortSignal) {
  validateSftpFilename(name);
  const remote = path.posix.join(dir, name);
  const stat = await client.lstat(remote);
  if (!stat.isFile || stat.isSymbolicLink) throw new SftpBrowserError(400, 'Selecione um arquivo regular. Links e diretórios não podem ser baixados.');
  const root = path.posix.normalize(await client.realPath(dir));
  const resolved = path.posix.normalize(await client.realPath(remote));
  if (path.posix.dirname(resolved) !== root) throw new SftpBrowserError(400, 'Arquivo fora da pasta selecionada.');
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'erpx-sftp-copy-'));
  const local = path.join(tempDir, 'download');
  const cleanup = () => fs.rm(tempDir, { recursive: true, force: true });
  const abort = () => { void cleanup().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new SftpBrowserError(499, 'Operação cancelada.');
    await client.fastGet(resolved, local);
    if (signal?.aborted) throw new SftpBrowserError(499, 'Operação cancelada.');
    return { local, name, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
