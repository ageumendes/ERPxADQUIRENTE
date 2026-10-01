import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import type { SicoobLayoutPspPix, VendaAdquirente } from '../repositories/repositorio.js';
import { mapPixParaTabelaSicoob, normalizeSicoobPix, type PixRecebidoNormalizado } from '../services/sicoob/pix-normalizer.js';
import { dataHoraPixLaPaz } from '../services/sicoob/pix-date.js';


const DOCUMENTOS_MESMA_TITULARIDADE = new Set(['27752608000129', '27752608000200', '99271133234']);

function somenteDigitos(valor: unknown) {
  return String(valor ?? '').replace(/\D/g, '');
}

export function codigoEstabelecimentoSicoobPeloNome(nomeArquivo: string): string {
  const nome = String(nomeArquivo || '').split(/[\\/]/).pop() || '';
  const comCnpj = nome.match(/^sicoob[_-]pix[_-](\d{14})[_-](?:\d{4}-\d{2}-\d{2}|reconsulta[_-]\d{4}-\d{2}-\d{2}[_-]a[_-]\d{4}-\d{2}-\d{2})\.json$/i);
  if (comCnpj) return comCnpj[1];
  if (/^sicoob[_-]pix[_-]\d{4}-\d{2}-\d{2}\.json$/i.test(nome)) return '27752608000129';
  return '';
}

function documentoPagadorPix(pix: PixRecebidoNormalizado) {
  const pagador = (pix.pagador || {}) as Record<string, unknown>;
  return somenteDigitos(pagador.cnpj || pagador.cpf || '');
}

function classificarUtilidadePix(pix: PixRecebidoNormalizado): { pagador_documento?: string; utilidade_status: 'UTIL' | 'NAO_UTIL'; utilidade_motivo?: string } {
  const documento = documentoPagadorPix(pix);
  const naoUtil = DOCUMENTOS_MESMA_TITULARIDADE.has(documento);
  return {
    pagador_documento: documento || undefined,
    utilidade_status: naoUtil ? 'NAO_UTIL' : 'UTIL',
    utilidade_motivo: naoUtil ? 'PIX_MESMA_TITULARIDADE' : undefined,
  };
}

type ResultadoSicoobPspPixJson = {
  registros_brutos: SicoobLayoutPspPix[];
  vendas_adquirentes: VendaAdquirente[];
};

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

export function mapSicoobPixParaVendaAdquirente(importacaoId: string, pix: PixRecebidoNormalizado, numeroLinha: number, codigoEstabelecimento = ''): VendaAdquirente {
  const { data_venda: dataLocal, hora_venda: horaLocal } = dataHoraPixLaPaz(pix.horario);
  const data_venda = dataLocal || undefined;
  const hora_venda = horaLocal || undefined;
  const valor = valorMoeda(pix.valor);
  const status = pix.devolucoes.length > 0 ? 'RECEBIDO_COM_DEVOLUCAO' : 'AUTORIZADO';
  const linha_original = jsonLinha(pix.raw);
  const hash_linha = hashVendaCanonica(pix);
  const utilidade = classificarUtilidadePix(pix);

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
    ...(dataLocal ? { horario_fuso_aplicado: 'America/La_Paz' } : {}),
    valor_bruto: valor,
    valor_liquido: valor,
    valor_taxa: '0.00',
    nsu: pix.endToEndId,
    codigo_autorizacao: pix.txid || pix.endToEndId,
    terminal: 'PIX QR_CODE',
    codigo_estabelecimento: codigoEstabelecimento || undefined,
    cnpj_estabelecimento: codigoEstabelecimento || undefined,
    bandeira: 'PIX',
    modalidade: 'PIX',
    parcelas: '1',
    status_transacao: status,
    codigo_produto: 'SICOOB_PSP_PIX',
    ...utilidade,
    hash_linha,
    linha_original,
    dados_json: {
      endToEndId: pix.endToEndId,
      txid: pix.txid || '',
      horario: pix.horario || '',
      horario_fuso_aplicado: dataLocal ? 'America/La_Paz' : '',
      nomePagador: pix.nomePagador || '',
      infoPagador: pix.infoPagador || '',
      valor: valor || '',
      pagador_cpf: somenteDigitos((pix.pagador as any)?.cpf || ''),
      pagador_cnpj: somenteDigitos((pix.pagador as any)?.cnpj || ''),
      pagador_documento: utilidade.pagador_documento || '',
      codigo_estabelecimento_origem: codigoEstabelecimento ? 'NOME_ARQUIVO_SICOOB' : '',
      raw: linha_original,
    },
    data_criacao: new Date().toISOString(),
  };
}

export async function parseSicoobPspPixJson(importacaoId: string, caminhoArquivo: string, nomeOriginal = ''): Promise<ResultadoSicoobPspPixJson> {
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
  const codigoEstabelecimento = codigoEstabelecimentoSicoobPeloNome(nomeOriginal || caminhoArquivo);
  const registros_brutos = pix.map((item: PixRecebidoNormalizado) => ({ ...mapPixParaTabelaSicoob(item), ...classificarUtilidadePix(item), codigo_estabelecimento: codigoEstabelecimento || undefined }));
  const vendas_adquirentes = pix.map((item: PixRecebidoNormalizado, index: number) => mapSicoobPixParaVendaAdquirente(importacaoId, item, index + 1, codigoEstabelecimento));

  return { registros_brutos, vendas_adquirentes };
}
