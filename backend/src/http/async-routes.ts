import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';

type HandlerEntrada = RequestHandler | HandlerEntrada[];

function envolverHandler(handler: HandlerEntrada): HandlerEntrada {
  if (Array.isArray(handler)) return handler.map(envolverHandler);
  return function rotaAssincronaSegura(req: Request, res: Response, next: NextFunction) {
    try {
      const resultado = (handler as (req: Request, res: Response, next: NextFunction) => unknown)(req, res, next);
      if (resultado && typeof (resultado as PromiseLike<unknown>).then === 'function') {
        Promise.resolve(resultado).catch(next);
      }
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Express 4 não encaminha automaticamente rejeições de handlers async ao
 * middleware de erro. Esta proteção é instalada antes do registro das rotas
 * para que todo app.get/post/put/patch/delete permaneça vivo após uma falha.
 */
export function protegerRotasAssincronas(app: Application) {
  const metodos = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'] as const;
  for (const metodo of metodos) {
    const original = app[metodo].bind(app) as (...args: any[]) => unknown;
    (app as any)[metodo] = (...args: any[]) => {
      // app.get('configuracao') também funciona como leitor de configuração.
      if (metodo === 'get' && args.length === 1) return original(...args);
      const [caminho, ...handlers] = args;
      return original(caminho, ...handlers.map((handler) => envolverHandler(handler)));
    };
  }
}

export function erroBancoTemporariamenteIndisponivel(error: unknown) {
  const mensagem = error instanceof Error ? error.message : String(error || '');
  const codigo = String((error as { code?: unknown } | null)?.code || '');
  return mensagem.includes('timeout exceeded when trying to connect')
    || mensagem.includes('Connection terminated unexpectedly')
    || ['53300', '57P03', '08000', '08003', '08006'].includes(codigo);
}
