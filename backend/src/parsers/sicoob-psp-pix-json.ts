import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { SicoobLayoutPspPix, VendaAdquirente } from '../repositories/repositorio.js';
import { mapPixParaTabelaSicoob, normalizeSicoobPix, type PixRecebidoNormalizado } from '../services/sicoob/pix.js';

type ResultadoSicoobPspPixJson = {
  registros_brutos: SicoobLayoutPspPix[];
  vendas_adquirentes: VendaAdquirente[];
};

function extrairDataHora(horario?: string | null) {
  if (!horario) return { data_venda: undefined, hora_venda: undefined };
  const match = String(horario).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return { data_venda: match?.[1], hora_venda: match?.[2] };
}

function valorMoeda(valor: number | null | undefined) {
  if (valor === null || valor === undefined || Number.isNaN(Number(valor))) return undefined;
  return Number(valor).toFixed(2);
}

function jsonLinha(item: unknown) {
  try {
    return JSON.stringify(item);
  } catch {
    return String(item ?? '');
  }
}

function hashVendaCanonica(pix: PixRecebidoNormalizado) {
  return createHash('sha256').update(`VENDA_ADQUIRENTE|SICOOB|PSP_PIX|${pix.endToEndId}`).digest('hex');
}

export function mapSicoobPixParaVendaAdquirente(importacaoId: string, pix: PixRecebidoNormalizado, numeroLinha: number): VendaAdquirente {
  const { data_venda, hora_venda } = extrairDataHora(pix.horario);
  const valor = valorMoeda(pix.valor);
  const status = pix.devolucoes.length > 0 ? 'RECEBIDO_COM_DEVOLUCAO' : 'AUTORIZADO';
  const linha_original = jsonLinha(pix.raw);
  const hash_linha = hashVendaCanonica(pix);

  return {
    id: `venda-adq-sicoob-psp-pix-${pix.endToEndId}`,
    importacao_id: importacaoId,
    adquirente: 'SICOOB',
    layout_origem: 'sicoob_layout_psp_pix',
    tipo_arquivo: 'PIX',
    codigo_registro: 'PIX',
    numero_linha: numeroLinha,
    data_venda,
    hora_venda,
    valor_bruto: valor,
    valor_liquido: valor,
    valor_taxa: '0.00',
    nsu: pix.endToEndId,
    codigo_autorizacao: pix.txid || pix.endToEndId,
    terminal: 'PIX QR_CODE',
    bandeira: 'PIX',
    modalidade: 'PIX',
    parcelas: '1',
    status_transacao: status,
    codigo_produto: 'SICOOB_PSP_PIX',
    hash_linha,
    linha_original,
    dados_json: {
      endToEndId: pix.endToEndId,
      txid: pix.txid || '',
      horario: pix.horario || '',
      nomePagador: pix.nomePagador || '',
      infoPagador: pix.infoPagador || '',
      valor: valor || '',
      raw: linha_original,
    },
    data_criacao: new Date().toISOString(),
  };
}

export async function parseSicoobPspPixJson(importacaoId: string, caminhoArquivo: string): Promise<ResultadoSicoobPspPixJson> {
  const conteudo = await fs.readFile(caminhoArquivo, 'utf8');
  let payload: any;
  try {
    payload = JSON.parse(conteudo);
  } catch {
    throw new Error('Arquivo Sicoob PSP PIX inválido: JSON malformado.');
  }

  const lista = Array.isArray(payload?.pix)
    ? payload.pix
    : Array.isArray(payload)
      ? payload
      : [];

  if (lista.length === 0) {
    throw new Error('Arquivo Sicoob PSP PIX não possui array pix com registros.');
  }

  const pix = lista.map((item: unknown) => normalizeSicoobPix(item)).filter((item: PixRecebidoNormalizado) => item.endToEndId);
  const registros_brutos = pix.map(mapPixParaTabelaSicoob);
  const vendas_adquirentes = pix.map((item: PixRecebidoNormalizado, index: number) => mapSicoobPixParaVendaAdquirente(importacaoId, item, index + 1));

  return { registros_brutos, vendas_adquirentes };
}
