import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { RegistroConvcard203, VendaAdquirente } from '../repositorio.js';

export type TipoRegistroConvcard = 'A0' | 'L0' | 'CV' | 'CP' | 'CC' | 'TB' | 'L9' | 'A9' | string;

export type ResultadoConvcard203 = {
  registros_brutos: RegistroConvcard203[];
  vendas_adquirentes: VendaAdquirente[];
};

type Campo = { chave: string; inicio: number; fim: number };

const CAMPOS: Record<string, Campo[]> = {
  A0: [
    ['tipo_registro',1,2], ['nseq_registro_arquivo',3,8], ['versao_layout',9,14], ['data_geracao',15,22], ['hora_geracao',23,28], ['cnpj_grupo_lojas',29,42], ['nome_grupo_lojas',43,72], ['espaco_reservado',73,240],
  ].map(([chave,inicio,fim]) => ({ chave: String(chave), inicio: Number(inicio), fim: Number(fim) })),
  L0: [
    ['tipo_registro',1,2], ['nseq_registro_arquivo',3,8], ['data_movimento',9,16], ['nseq_lote',17,22], ['cnpj_adm',23,36], ['nome_adm',37,66], ['codigo_adm',67,74], ['codigo_bandeira',75,76], ['telefone_adm',77,91], ['espaco_reservado',92,240],
  ].map(([chave,inicio,fim]) => ({ chave: String(chave), inicio: Number(inicio), fim: Number(fim) })),
  CV: [
    ['tipo_registro',1,2], ['nseq_registro_arquivo',3,8], ['nseq_registro_lote',9,14], ['cnpj_loja',15,28], ['nsu_transacao',29,40], ['data_transacao',41,48], ['hora_transacao',49,54], ['numero_cartao',55,73], ['numero_autorizacao',74,85], ['numero_parcela',86,87], ['quantidade_parcelas',88,89], ['data_lancamento',90,97], ['valor_bruto_venda',98,108], ['valor_desconto',109,119], ['valor_liquido_venda',120,130], ['valor_bruto_parcela',131,141], ['valor_desconto_parcela',142,152], ['valor_liquido_parcela',153,163], ['banco',164,166], ['agencia',167,172], ['conta',173,183], ['nseq_lote',184,189], ['tipo_aplicativo',190,199], ['espaco_reservado',200,240],
  ].map(([chave,inicio,fim]) => ({ chave: String(chave), inicio: Number(inicio), fim: Number(fim) })),
  CP: [
    ['tipo_registro',1,2], ['nseq_registro_arquivo',3,8], ['nseq_registro_lote',9,14], ['cnpj_loja',15,28], ['nsu_transacao',29,40], ['data_transacao',41,48], ['hora_transacao',49,54], ['numero_cartao',55,73], ['numero_autorizacao',74,85], ['numero_parcela',86,87], ['data_pagamento',88,95], ['valor_bruto_pagamento',96,106], ['valor_desconto',107,117], ['valor_liquido_pagamento',118,128], ['banco',129,131], ['agencia',132,137], ['conta',138,148], ['nseq_lote',149,154], ['espaco_reservado',155,240],
  ].map(([chave,inicio,fim]) => ({ chave: String(chave), inicio: Number(inicio), fim: Number(fim) })),
  CC: [
    ['tipo_registro',1,2], ['nseq_registro_arquivo',3,8], ['nseq_registro_lote',9,14], ['cnpj_loja',15,28], ['nsu_transacao_original',29,40], ['data_transacao_original',41,48], ['hora_transacao',49,54], ['numero_cartao',55,73], ['numero_autorizacao',74,85], ['numero_parcela',86,87], ['data_cancelamento',88,95], ['nseq_lote',96,101], ['espaco_reservado',102,240],
  ].map(([chave,inicio,fim]) => ({ chave: String(chave), inicio: Number(inicio), fim: Number(fim) })),
  TB: [
    ['tipo_registro',1,2], ['nseq_registro_arquivo',3,8], ['nseq_registro_lote',9,14], ['cnpj_loja',15,28], ['data_transacao',29,36], ['valor',37,47], ['banco',48,50], ['agencia',51,56], ['conta_corrente',57,67], ['nseq_lote',68,73], ['espaco_reservado',74,240],
  ].map(([chave,inicio,fim]) => ({ chave: String(chave), inicio: Number(inicio), fim: Number(fim) })),
  L9: [
    ['tipo_registro',1,2], ['nseq_registro_arquivo',3,8], ['nseq_lote',9,14], ['quantidade_registros_lote',15,20], ['valor_total_bruto_lote',21,32], ['espaco_reservado',33,240],
  ].map(([chave,inicio,fim]) => ({ chave: String(chave), inicio: Number(inicio), fim: Number(fim) })),
  A9: [
    ['tipo_registro',1,2], ['nseq_registro_arquivo',3,8], ['quantidade_registros',9,17], ['espaco_reservado',18,240],
  ].map(([chave,inicio,fim]) => ({ chave: String(chave), inicio: Number(inicio), fim: Number(fim) })),
};

const BANDEIRAS: Record<string, string> = { '00': 'CONVCARD', '01': 'UTIL', '02': 'CONVNET' };
const TIPO_APLICATIVO: Record<string, string> = { '1': 'TEF', '2': 'PDV INTEGRADO', '3': 'SISTEMA CONVCARD' };

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

function slicePos(linha: string, inicio: number, fim: number): string {
  return linha.slice(inicio - 1, fim).trim();
}

function parseRegistro(linha: string): Record<string, string> {
  const codigo = linha.slice(0, 2).trim().toUpperCase();
  const campos = CAMPOS[codigo] || [{ chave: 'tipo_registro', inicio: 1, fim: 2 }, { chave: 'conteudo', inicio: 3, fim: Math.max(linha.length, 240) }];
  const dados: Record<string, string> = {};
  for (const campo of campos) dados[campo.chave] = slicePos(linha, campo.inicio, campo.fim);
  return dados;
}

function valorMonetario(valor: unknown): string {
  const bruto = texto(valor).replace(/\D/g, '');
  if (!bruto) return '';
  const numero = Number(bruto) / 100;
  return Number.isFinite(numero) ? numero.toFixed(2) : '';
}

function hashLinha(importacaoId: string, numeroLinha: number, linhaOriginal: string) {
  return crypto.createHash('sha256').update(JSON.stringify({ importacaoId, layout: 'CONVCARD_2_0_3', numeroLinha, linhaOriginal })).digest('hex');
}

function grupoRegistro(codigo: string): 'CV' | 'CP' | 'CC' | 'TB' | 'CONTROLE' {
  if (codigo === 'CV') return 'CV';
  if (codigo === 'CP') return 'CP';
  if (codigo === 'CC') return 'CC';
  if (codigo === 'TB') return 'TB';
  return 'CONTROLE';
}

function vendaCanonica(importacaoId: string, numeroLinha: number, linhaOriginal: string, dados: Record<string, string>, hash_linha: string, loteAtual: Record<string, string> | null): VendaAdquirente | null {
  if (dados.tipo_registro !== 'CV') return null;
  const agora = new Date().toISOString();
  const codigoBandeira = texto(loteAtual?.codigo_bandeira || '00').padStart(2, '0');
  const tipoApp = texto(dados.tipo_aplicativo).replace(/^0+/, '') || texto(dados.tipo_aplicativo);
  return {
    id: `${importacaoId}-convcard-cv-${numeroLinha}`,
    importacao_id: importacaoId,
    adquirente: 'CONVCARD',
    layout_origem: 'convcard_layout_2_0_3_cv',
    tipo_arquivo: 'CONVCARD_2_0_3',
    codigo_registro: 'CV',
    numero_linha: numeroLinha,
    data_venda: dados.data_transacao,
    hora_venda: dados.hora_transacao,
    data_pagamento: dados.data_lancamento,
    valor_bruto: valorMonetario(dados.valor_bruto_venda),
    valor_taxa: valorMonetario(dados.valor_desconto),
    valor_liquido: valorMonetario(dados.valor_liquido_venda),
    nsu: texto(dados.nsu_transacao),
    codigo_autorizacao: texto(dados.numero_autorizacao),
    terminal: tipoApp,
    bandeira: BANDEIRAS[codigoBandeira] || `CONVCARD-${codigoBandeira}`,
    modalidade: TIPO_APLICATIVO[tipoApp] || 'CONVCARD',
    parcelas: `${texto(dados.numero_parcela) || '01'}/${texto(dados.quantidade_parcelas) || '01'}`,
    status_transacao: 'VENDA_AUTORIZADA',
    codigo_produto: texto(loteAtual?.codigo_adm || ''),
    hash_linha,
    linha_original: linhaOriginal,
    dados_json: dados,
    data_criacao: agora,
  };
}

export async function parseConvcard203(importacaoId: string, caminhoArquivo: string): Promise<ResultadoConvcard203> {
  const buffer = await fs.readFile(caminhoArquivo);
  const utf8 = buffer.toString('utf8');
  const conteudo = utf8.includes('�') ? buffer.toString('latin1') : utf8;
  const linhas = conteudo.split(/\r?\n/).map((linha) => linha.replace(/\r/g, '')).filter((linha) => linha.trim().length > 0);
  const registros_brutos: RegistroConvcard203[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];
  let loteAtual: Record<string, string> | null = null;

  for (let index = 0; index < linhas.length; index += 1) {
    const linhaOriginal = linhas[index];
    const numeroLinha = index + 1;
    const dados = parseRegistro(linhaOriginal);
    const codigo = texto(dados.tipo_registro || linhaOriginal.slice(0, 2)).toUpperCase();
    if (codigo === 'L0') loteAtual = dados;
    const hash_linha = hashLinha(importacaoId, numeroLinha, linhaOriginal);
    const agora = new Date().toISOString();
    registros_brutos.push({
      id: `${importacaoId}-convcard-raw-${numeroLinha}`,
      importacao_id: importacaoId,
      tipo_arquivo: 'CONVCARD_2_0_3',
      codigo_registro: codigo,
      grupo_registro: grupoRegistro(codigo),
      numero_linha: numeroLinha,
      linha_original: linhaOriginal,
      hash_linha,
      dados_json: dados,
      data_criacao: agora,
    });
    const venda = vendaCanonica(importacaoId, numeroLinha, linhaOriginal, dados, hash_linha, loteAtual);
    if (venda) vendas_adquirentes.push(venda);
  }

  return { registros_brutos, vendas_adquirentes };
}
