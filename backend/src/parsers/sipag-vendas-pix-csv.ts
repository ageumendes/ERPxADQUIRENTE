import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { RegistroSipagVendasPixCsv, VendaAdquirente } from '../repositorio.js';

const CABECALHO = [
  'Estabelecimento', 'Data da Venda', 'Status', 'Código da Transação',
  'Nº Terminal', 'Nome do Pagador', 'Valor Reembolsado', 'Valor da Venda',
];

function parseLinhaCsv(linha: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let emAspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i];
    if (ch === '"') {
      if (emAspas && linha[i + 1] === '"') { atual += '"'; i += 1; }
      else emAspas = !emAspas;
      continue;
    }
    if (ch === ';' && !emAspas) { campos.push(atual); atual = ''; continue; }
    atual += ch;
  }
  campos.push(atual);
  return campos;
}

function dinheiro(valor: string): number {
  const v = String(valor ?? '').trim();
  if (!v || v === '-') return 0;
  const limpo = v.replace(/R\$/gi, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const numero = Number(limpo);
  if (!Number.isFinite(numero)) throw new Error(`Valor monetário SIPAG PIX inválido: ${valor || '(vazio)'}.`);
  return numero;
}

function dataHora(valor: string) {
  const match = String(valor || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Data da venda SIPAG PIX inválida: ${valor || '(vazia)'}.`);
  const [, dd, mm, yyyy, hh, mi, ss] = match;
  const data = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)));
  if (data.getUTCFullYear() !== Number(yyyy) || data.getUTCMonth() !== Number(mm) - 1 || data.getUTCDate() !== Number(dd) || Number(hh) > 23 || Number(mi) > 59 || Number(ss) > 59) {
    throw new Error(`Data da venda SIPAG PIX inválida: ${valor}.`);
  }
  return { data: `${yyyy}-${mm}-${dd}`, hora: `${hh}:${mi}:${ss}` };
}

const hash = (linha: string) => crypto.createHash('sha256').update(`SIPAG_VENDAS_PIX_CSV|${linha}`).digest('hex');

export async function parseSipagVendasPixCsv(importacaoId: string, caminhoArquivo: string, nomeOriginal: string) {
  const buffer = await fs.readFile(caminhoArquivo);
  let conteudo: string;
  try { conteudo = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw new Error('Arquivo SIPAG Vendas PIX CSV inválido: conteúdo não está em UTF-8 válido.'); }

  const linhas = conteudo.split(/\r?\n/).map((linha) => linha.replace(/\r$/, '')).filter((linha) => linha.trim().length > 0);
  if (linhas.length < 4) throw new Error('Arquivo SIPAG Vendas PIX CSV inválido: conteúdo incompleto.');
  if (linhas[0].trim().toLocaleLowerCase('pt-BR') !== 'relatório de vendas pix') throw new Error('Arquivo SIPAG Vendas PIX CSV inválido: título não reconhecido.');
  if (!linhas[1].startsWith('Estabelecimento(s);')) throw new Error('Arquivo SIPAG Vendas PIX CSV inválido: identificação de estabelecimento ausente.');

  const cabecalho = parseLinhaCsv(linhas[2]).map((v) => v.trim());
  if (cabecalho.length !== CABECALHO.length || CABECALHO.some((campo, i) => cabecalho[i] !== campo)) {
    throw new Error(`Arquivo SIPAG Vendas PIX CSV inválido: cabeçalho inesperado: ${cabecalho.join(' | ')}`);
  }

  const estabelecimentoRelatorio = parseLinhaCsv(linhas[1])[1]?.trim() || '';
  const registros_brutos: RegistroSipagVendasPixCsv[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];
  let totalizador: Record<string, string> | null = null;

  for (let index = 3; index < linhas.length; index += 1) {
    const linha = linhas[index];
    const campos = parseLinhaCsv(linha);
    if (campos[0]?.trim().toUpperCase() === 'TOTAL') {
      totalizador = { valor_reembolsado: campos[6]?.trim() || '', valor_venda: campos[7]?.trim() || '', linha_original: linha };
      continue; // totalizador: validado, mas nunca persistido
    }
    if (campos.length !== 8) throw new Error(`Linha ${index + 1} SIPAG PIX inválida: esperado 8 campos, recebido ${campos.length}.`);

    const [estabelecimento, dataVendaOriginal, statusOriginal, codigoTransacao, terminal, nomePagador, valorReembolsadoOriginal, valorVendaOriginal] = campos.map((v) => v.trim());
    if (!estabelecimento || !codigoTransacao || !terminal) throw new Error(`Linha ${index + 1} SIPAG PIX incompleta.`);
    const dh = dataHora(dataVendaOriginal);
    const bruto = dinheiro(valorVendaOriginal);
    const taxa = valorReembolsadoOriginal === '-' || valorReembolsadoOriginal === '' ? 0 : dinheiro(valorReembolsadoOriginal);
    const liquido = bruto - taxa;
    const h = hash(linha);
    const dadosOriginais = {
      estabelecimento,
      data_venda: dataVendaOriginal,
      status: statusOriginal,
      codigo_transacao: codigoTransacao,
      numero_terminal: terminal,
      nome_pagador: nomePagador,
      valor_reembolsado: valorReembolsadoOriginal,
      valor_venda: valorVendaOriginal,
    };

    registros_brutos.push({
      ...dadosOriginais,
      id: `${importacaoId}-sipag-pix-csv-${index + 1}`,
      importacao_id: importacaoId,
      tipo_arquivo: 'SIPAG_VENDAS_PIX_CSV',
      codigo_registro: 'VENDA_PIX',
      numero_linha: index + 1,
      linha_original: linha,
      hash_linha: h,
      dados_json: dadosOriginais,
      data_criacao: new Date().toISOString(),
    });

    vendas_adquirentes.push({
      id: `${importacaoId}-sipag-pix-venda-${index + 1}`,
      importacao_id: importacaoId,
      adquirente: 'SIPAG',
      layout_origem: 'sipag_vendas_pix_csv',
      tipo_arquivo: 'SIPAG_VENDAS_PIX_CSV',
      codigo_registro: 'PIX',
      numero_linha: index + 1,
      data_venda: dh.data,
      hora_venda: dh.hora,
      data_pagamento: '',
      valor_bruto: bruto.toFixed(2),
      valor_taxa: Math.abs(taxa).toFixed(2),
      percentual_taxa: bruto ? ((Math.abs(taxa) / Math.abs(bruto)) * 100).toFixed(4) : '0.0000',
      valor_liquido: liquido.toFixed(2),
      nsu: '',
      codigo_autorizacao: '',
      terminal,
      bandeira: 'PIX',
      modalidade: 'PIX',
      parcelas: '1/1',
      status_transacao: statusOriginal.toUpperCase() === 'LIQUIDADA' ? 'AUTORIZADO' : statusOriginal,
      status_transacao_original: statusOriginal,
      codigo_produto: 'PIX',
      hash_linha: h,
      linha_original: linha,
      dados_json: {
        ...dadosOriginais,
        estabelecimento_relatorio: estabelecimentoRelatorio,
        codigo_transacao_pix: codigoTransacao,
        nome_pagador: nomePagador,
        valor_reembolsado_original: valorReembolsadoOriginal,
      },
      data_criacao: new Date().toISOString(),
    });
  }

  if (registros_brutos.length === 0) throw new Error('Arquivo SIPAG Vendas PIX CSV não contém vendas.');
  if (totalizador) {
    const totalCalculado = vendas_adquirentes.reduce((soma, venda) => soma + Number(venda.valor_bruto || 0), 0);
    const totalArquivo = dinheiro(totalizador.valor_venda);
    if (Math.abs(totalCalculado - totalArquivo) > 0.01) {
      throw new Error(`Total SIPAG PIX divergente: vendas somam R$ ${totalCalculado.toFixed(2)}, totalizador informa R$ ${totalArquivo.toFixed(2)}.`);
    }
  }

  return {
    tipo_arquivo: 'SIPAG_VENDAS_PIX_CSV' as const,
    nome_original: nomeOriginal,
    estabelecimento_relatorio: estabelecimentoRelatorio,
    registros_brutos,
    vendas_adquirentes,
    totalizador,
    quantidade_vendas: registros_brutos.length,
  };
}
