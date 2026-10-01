import type { Express, Request, Response } from 'express';
import { baixarCopiaArquivoSftp, listarArquivosSftp, obterPastasNavegadorSftp } from '../services/remote-edi.service.js';
import { SftpBrowserError } from '../services/sftp-browser.js';

// Registradas após autenticação e política de acesso global do servidor.
export function registerSftpBrowserRoutes(app: Express) {
  const fail = (res: Response, error: unknown) => {
    console.error('[sftp-arquivos]', error instanceof Error ? error.message : error);
    if (res.headersSent || res.destroyed) return;
    const code = String((error as { code?: number | string })?.code || '');
    const missing = code === '2' || code === 'ENOENT';
    res.status(error instanceof SftpBrowserError ? error.status : missing ? 404 : 502).json({ sucesso: false,
      mensagem: error instanceof SftpBrowserError ? error.message : missing
        ? 'Arquivo ou pasta não encontrado. Atualize a lista; a coleta pode ter movido o arquivo.'
        : 'Não foi possível acessar o SFTP. Teste a conexão e consulte o log do servidor.' });
  };
  const cancellation = (res: Response) => {
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    return controller.signal;
  };
  app.get('/api/importacoes/sftp/pastas', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(obterPastasNavegadorSftp());
  });
  app.get('/api/importacoes/sftp/arquivos', async (req: Request, res: Response) => {
    const signal = cancellation(res);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const data = await listarArquivosSftp(req.query.provider, req.query.pasta, signal);
      if (!signal.aborted) res.json(data);
    } catch (error) { fail(res, error); }
  });
  app.get('/api/importacoes/sftp/arquivo/download', async (req: Request, res: Response) => {
    const signal = cancellation(res);
    res.setHeader('Cache-Control', 'no-store');
    try {
      const copy = await baixarCopiaArquivoSftp(req.query.provider, req.query.pasta, req.query.nome, signal);
      const cleanup = () => { void copy.cleanup().catch(error => console.error('[sftp-arquivos:limpeza]', error)); };
      if (signal.aborted) { cleanup(); return; }
      res.once('close', cleanup);
      res.type('application/octet-stream');
      res.download(copy.local, copy.name, error => {
        cleanup();
        if (error) fail(res, error);
      });
    } catch (error) { fail(res, error); }
  });
}
