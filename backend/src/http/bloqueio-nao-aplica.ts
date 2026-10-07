import type { RequestHandler } from 'express';

export function documentoNaoAplica(valor: unknown): boolean {
  return String(valor ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase() === 'NAOAPLICA';
}

// Última barreira de saída para detalhes, auditorias e explorador técnico.
// Não escreve no banco e não substitui os filtros SQL dos totais e das listas.
export function registroBloqueado(valor: unknown): boolean {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  const item = valor as Record<string, unknown>;
  if (documentoNaoAplica(item.pagador_documento)) return true;
  return ['dados', 'venda_adquirente'].some(chave => {
    const nested = item[chave];
    return !!nested && typeof nested === 'object' && documentoNaoAplica((nested as Record<string, unknown>).pagador_documento);
  });
}

export function filtrarSaidaNaoAplica(valor: unknown): unknown {
  if (registroBloqueado(valor)) return null;
  if (Array.isArray(valor)) return valor.filter(item => !registroBloqueado(item)).map(filtrarSaidaNaoAplica);
  if (!valor || typeof valor !== 'object' || valor instanceof Date || Buffer.isBuffer(valor)) return valor;
  return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, filtrarSaidaNaoAplica(item)]));
}

export const bloquearNaoAplicaNaSaida: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => json(filtrarSaidaNaoAplica(body))) as typeof res.json;
  next();
};
