import { createHash } from 'node:crypto';
import { createSicoobHttpsAgent, sicoobPixConfig } from './config.js';
import { clearSicoobTokenCache, getSicoobAccessToken } from './auth.js';
import { HttpRequestError, requestJson } from './http.js';
import type { SicoobLayoutPspPix } from '../../repositories/repositorio.js';

export type PixRecebidoNormalizado = {
  endToEndId: string;
  txid: string | null;
  valor: number | null;
  valorOriginal: string | null;
  horario: string | null;
  chave: string | null;
  infoPagador: string | null;
  nomePagador: string | null;
  pagador: Record<string, unknown> | null;
  devolucoes: unknown[];
  raw: Record<string, unknown>;
};

function buildQueryString(params: Record<string, unknown> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    query.append(key, String(value));
  });
  return query.toString();
}

function toBoolean(value: unknown, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'sim', 's', 'yes'].includes(String(value).toLowerCase());
}

function validatePeriod(inicio?: string, fim?: string) {
  if (!inicio || !fim) throw new Error('Informe inicio e fim em formato RFC3339. Ex: 2026-06-01T00:00:00Z');
}

export function normalizeSicoobPix(pix: any): PixRecebidoNormalizado {
  return {
    endToEndId: String(pix.endToEndId || ''),
    txid: pix.txid || null,
    valor: pix.valor ? Number(String(pix.valor).replace(',', '.')) : null,
    valorOriginal: pix.valor || null,
    horario: pix.horario || null,
    chave: pix.chave || null,
    infoPagador: pix.infoPagador || null,
    nomePagador: pix.nomePagador || pix.pagador?.nome || null,
    pagador: pix.pagador || null,
    devolucoes: Array.isArray(pix.devolucoes) ? pix.devolucoes : [],
    raw: pix,
  };
}

async function requestPix(path: string, params: Record<string, unknown> = {}, retry = true): Promise<any> {
  const token = await getSicoobAccessToken();
  try {
    const queryString = buildQueryString(params);
    const url = `${sicoobPixConfig.pixBaseUrl}${path}${queryString ? `?${queryString}` : ''}`;
    const response = await requestJson(url, {
      agent: createSicoobHttpsAgent(),
      headers: {
        Authorization: `Bearer ${token}`,
        client_id: sicoobPixConfig.clientId,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeoutMs: 30000,
    });
    return response.data;
  } catch (error: any) {
    if (retry && error instanceof HttpRequestError && error.status === 401) {
      clearSicoobTokenCache();
      return requestPix(path, params, false);
    }
    throw error;
  }
}

export async function consultarPaginaPixRecebidos(params: Record<string, any>) {
  validatePeriod(params.inicio, params.fim);
  const data = await requestPix('/pix', {
    inicio: params.inicio,
    fim: params.fim,
    txid: params.txid,
    txIdPresente: params.txIdPresente,
    devolucaoPresente: params.devolucaoPresente,
    cpf: params.cpf,
    cnpj: params.cnpj,
    'paginacao.paginaAtual': Number(params.paginaAtual || params['paginacao.paginaAtual'] || 0),
    'paginacao.itensPorPagina': Number(params.itensPorPagina || params['paginacao.itensPorPagina'] || 100),
  });
  return {
    parametros: data.parametros,
    pix: Array.isArray(data.pix) ? data.pix.map(normalizeSicoobPix).filter((item: PixRecebidoNormalizado) => item.endToEndId) : [],
    raw: data,
  };
}

export async function consultarPixRecebidos(params: Record<string, any> = {}) {
  const itensPorPagina = Number(params.itensPorPagina || params['paginacao.itensPorPagina'] || 100);
  const buscarTodasPaginas = toBoolean(params.buscarTodasPaginas, true);

  if (!buscarTodasPaginas) {
    return consultarPaginaPixRecebidos({ ...params, paginaAtual: Number(params.paginaAtual || 0), itensPorPagina });
  }

  const primeiraPagina = await consultarPaginaPixRecebidos({ ...params, paginaAtual: 0, itensPorPagina });
  const paginacao = primeiraPagina.parametros?.paginacao || {};
  const quantidadeDePaginas = Number(paginacao.quantidadeDePaginas || 1);
  const pix = [...primeiraPagina.pix];
  const paginasConsultadas = [0];
  const rawPaginas = [primeiraPagina.raw];

  for (let paginaAtual = 1; paginaAtual < quantidadeDePaginas; paginaAtual += 1) {
    const pagina = await consultarPaginaPixRecebidos({ ...params, paginaAtual, itensPorPagina });
    paginasConsultadas.push(paginaAtual);
    rawPaginas.push(pagina.raw);
    pix.push(...pagina.pix);
  }

  return {
    parametros: {
      ...primeiraPagina.parametros,
      paginacao: { ...paginacao, paginasConsultadas, quantidadeRetornadaNestaConsulta: pix.length },
    },
    pix,
    raw: { parametros: primeiraPagina.parametros, paginas: rawPaginas },
  };
}

function extrairDataHora(horario?: string | null) {
  if (!horario) return { data_venda: null, hora_venda: null };
  const match = String(horario).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return { data_venda: match?.[1] || null, hora_venda: match?.[2] || null };
}

function somenteDigitos(value: unknown) {
  const texto = value === null || value === undefined ? '' : String(value);
  return texto.replace(/\D/g, '') || null;
}

export function mapPixParaTabelaSicoob(pix: PixRecebidoNormalizado): SicoobLayoutPspPix {
  const agora = new Date().toISOString();
  const { data_venda, hora_venda } = extrairDataHora(pix.horario);
  const pagador = (pix.pagador || {}) as Record<string, unknown>;
  const hash_linha = createHash('sha256').update(`SICOOB_PSP_PIX|${pix.endToEndId}`).digest('hex');

  return {
    id: `sicoob-psp-pix-${pix.endToEndId}`,
    origem: 'SICOOB',
    layout_origem: 'SICOOB_PSP_PIX_API',
    end_to_end_id: pix.endToEndId,
    txid: pix.txid,
    valor: pix.valor === null ? null : pix.valor.toFixed(2),
    valor_original: pix.valorOriginal,
    horario: pix.horario,
    data_venda,
    hora_venda,
    chave: pix.chave,
    info_pagador: pix.infoPagador,
    nome_pagador: pix.nomePagador,
    pagador_nome: typeof pagador.nome === 'string' ? pagador.nome : pix.nomePagador,
    pagador_cpf: somenteDigitos(pagador.cpf),
    pagador_cnpj: somenteDigitos(pagador.cnpj),
    tem_devolucao: pix.devolucoes.length > 0,
    quantidade_devolucoes: pix.devolucoes.length,
    devolucoes: pix.devolucoes,
    hash_linha,
    dados_json: pix.raw,
    data_criacao: agora,
  };
}

function dataOntemBrasil() {
  const agora = new Date();
  const brasilMs = agora.getTime() - 3 * 60 * 60 * 1000;
  const brasil = new Date(brasilMs);
  brasil.setUTCDate(brasil.getUTCDate() - 1);
  return brasil.toISOString().slice(0, 10);
}

export function periodoD1Sicoob(dataReferencia?: string) {
  const data = dataReferencia || dataOntemBrasil();
  return {
    dataReferencia: data,
    inicio: `${data}T00:00:00-03:00`,
    fim: `${data}T23:59:59-03:00`,
  };
}
