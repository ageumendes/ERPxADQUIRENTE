import type { NextFunction, Request, Response } from 'express';

const janelaMs = 60_000;
const limite = Math.max(30, Number(process.env.RATE_LIMIT_PER_MINUTE || 240));
const acessos = new Map<string, { inicio: number; total: number }>();
const tentativasLogin = new Map<string, { inicio: number; total: number }>();
const LOGIN_JANELA_MS = 15 * 60_000;
const LOGIN_LIMITE = Math.max(3, Number(process.env.LOGIN_RATE_LIMIT_PER_15_MINUTES || 5));

setInterval(() => {
  const agora = Date.now();
  for (const [chave, valor] of acessos) if (agora - valor.inicio >= janelaMs) acessos.delete(chave);
  for (const [chave, valor] of tentativasLogin) if (agora - valor.inicio >= LOGIN_JANELA_MS) tentativasLogin.delete(chave);
}, 5 * 60_000).unref();

export function cabecalhosSeguranca(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  next();
}

export function limitarLogin(req: Request, res: Response, next: NextFunction) {
  const login = String(req.body?.login || '').trim().toLowerCase().slice(0, 80);
  const chave = `${req.ip || 'desconhecido'}:${login}`;
  const agora = Date.now();
  const atual = tentativasLogin.get(chave);
  if (!atual || agora - atual.inicio >= LOGIN_JANELA_MS) {
    tentativasLogin.set(chave, { inicio: agora, total: 1 });
    return next();
  }
  atual.total += 1;
  if (atual.total > LOGIN_LIMITE) {
    res.setHeader('Retry-After', String(Math.ceil((LOGIN_JANELA_MS - (agora - atual.inicio)) / 1000)));
    return res.status(429).json({ sucesso: false, codigo: 'LOGIN_TEMPORARIAMENTE_BLOQUEADO', mensagem: 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.' });
  }
  next();
}

export function liberarLimiteLogin(req: Request) {
  const login = String(req.body?.login || '').trim().toLowerCase().slice(0, 80);
  tentativasLogin.delete(`${req.ip || 'desconhecido'}:${login}`);
}

export function limitarRequisicoes(req: Request, res: Response, next: NextFunction) {
  const chave = req.ip || 'desconhecido'; const agora = Date.now(); const atual = acessos.get(chave);
  if (!atual || agora - atual.inicio >= janelaMs) { acessos.set(chave, { inicio: agora, total: 1 }); return next(); }
  atual.total += 1;
  if (atual.total > limite) return res.status(429).json({ sucesso: false, codigo: 'MUITAS_REQUISICOES', mensagem: 'Limite de requisições excedido. Tente novamente em instantes.' });
  next();
}
