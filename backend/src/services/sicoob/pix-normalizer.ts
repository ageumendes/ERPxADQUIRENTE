import { createHash } from 'node:crypto';
import type { SicoobLayoutPspPix } from '../../repositories/repositorio.js';
import { dataHoraPixLaPaz } from './pix-date.js';

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

export function mapPixParaTabelaSicoob(pix: PixRecebidoNormalizado): SicoobLayoutPspPix {
  const agora = new Date().toISOString();
  const { data_venda, hora_venda } = dataHoraPixLaPaz(pix.horario);
  const pagador = (pix.pagador || {}) as Record<string, unknown>;
  const hash_linha = createHash('sha256').update(`SICOOB_PSP_PIX|${pix.endToEndId}`).digest('hex');

  return {
    id: `sicoob-psp-pix-${pix.endToEndId}`,
    origem: 'SICOOB',
    layout_origem: 'SICOOB_PSP_PIX_SFTP',
    end_to_end_id: pix.endToEndId,
    txid: pix.txid,
    valor: pix.raw?.valor === null || pix.raw?.valor === undefined ? pix.valorOriginal : String(pix.raw.valor),
    valor_original: pix.valorOriginal,
    horario: pix.horario,
    data_venda,
    hora_venda,
    chave: pix.chave,
    info_pagador: pix.infoPagador,
    nome_pagador: pix.nomePagador,
    pagador_nome: typeof pagador.nome === 'string' ? pagador.nome : pix.nomePagador,
    pagador_cpf: pagador.cpf === null || pagador.cpf === undefined ? null : String(pagador.cpf),
    pagador_cnpj: pagador.cnpj === null || pagador.cnpj === undefined ? null : String(pagador.cnpj),
    tem_devolucao: pix.devolucoes.length > 0,
    quantidade_devolucoes: pix.devolucoes.length,
    devolucoes: pix.devolucoes,
    hash_linha,
    dados_json: pix.raw,
    data_criacao: agora,
  };
}
