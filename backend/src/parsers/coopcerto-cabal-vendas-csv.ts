import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { RegistroCoopcertoCabalVendasCsv, VendaAdquirente } from '../repositorio.js';
import { chaveSemanticaCoopcerto } from '../services/coopcerto-upsert.js';

const CABECALHO = [
  'Nº do estabelecimento', 'Data da transação', 'Nº da transação', 'ID Venda', 'Bandeira',
  'Forma de Pagamento', 'Plano de venda', 'Parcela', 'Total de parcela', 'Número da autorização',
  'Tipo cartão', 'Número do cartão', 'Número do terminal', 'Tipo captura', 'Indicador Crédito/Débito',
  'Indicador de cancelamento da venda', 'Nº resumo da venda', 'Data prevista de liquidação', 'Seu número',
  'Nº ordem de pagamento', 'Status', 'Valor parcela bruto', 'Desconto parcela', 'Valor parcela liquido',
  'Total plano de venda',
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
  if (!Number.isFinite(numero)) throw new Error(`Valor monetário COOPCERTO/CABAL inválido: ${valor || '(vazio)'}.`);
  return numero;
}

function dataHora(valor: string) {
  const match = String(valor || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Data da transação COOPCERTO/CABAL inválida: ${valor || '(vazia)'}.`);
  const [, dd, mm, yyyy, hh, mi, ss] = match;
  const data = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)));
  if (data.getUTCFullYear() !== Number(yyyy) || data.getUTCMonth() !== Number(mm) - 1 || data.getUTCDate() !== Number(dd) || Number(hh) > 23 || Number(mi) > 59 || Number(ss) > 59) {
    throw new Error(`Data da transação COOPCERTO/CABAL inválida: ${valor}.`);
  }
  return { data: `${yyyy}-${mm}-${dd}`, hora: `${hh}:${mi}:${ss}` };
}

function dataSomente(valor: string): string {
  const v = String(valor || '').trim();
  if (!v || v === '-') return '';
  const match = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Data prevista de liquidação COOPCERTO/CABAL inválida: ${valor}.`);
  const [, dd, mm, yyyy] = match;
  const data = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (data.getUTCFullYear() !== Number(yyyy) || data.getUTCMonth() !== Number(mm) - 1 || data.getUTCDate() !== Number(dd)) {
    throw new Error(`Data prevista de liquidação COOPCERTO/CABAL inválida: ${valor}.`);
  }
  return `${yyyy}-${mm}-${dd}`;
}

function statusCanonico(statusOriginal: string, indicadorCancelamento: string): string {
  const status = String(statusOriginal || '').trim();
  const upper = status.toLocaleUpperCase('pt-BR');
  const cancel = String(indicadorCancelamento || '').trim();
  if ((cancel && cancel !== '-' && cancel !== '000') || upper.includes('CANCEL')) return 'CANCELADO';
  if (upper.includes('PENDENTE')) return 'PENDENTE_PROCESSAMENTO';
  if (upper.includes('NEGAD') || upper.includes('RECUS') || upper.includes('REJEIT') || upper.includes('NÃO AUTORIZ') || upper.includes('NAO AUTORIZ')) return 'NEGADO';
  if (upper.includes('PROCESSADA') || upper.includes('PROCESSADO') || upper.includes('APROVAD') || upper.includes('AUTORIZ')) return 'AUTORIZADO';
  return status;
}

const hash = (linha: string) => crypto.createHash('sha256').update(`COOPCERTO_CABAL_VENDAS_CSV|${linha}`).digest('hex');

export async function parseCoopcertoCabalVendasCsv(importacaoId: string, caminhoArquivo: string, nomeOriginal: string) {
  const buffer = await fs.readFile(caminhoArquivo);
  let conteudo: string;
  try { conteudo = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw new Error('Arquivo COOPCERTO/CABAL CSV inválido: conteúdo não está em UTF-8 válido.'); }

  const linhas = conteudo.split(/\r?\n/).map((linha) => linha.replace(/\r$/, ''));
  const naoVazias = linhas.filter((linha) => linha.trim().length > 0);
  if (naoVazias.length < 4) throw new Error('Arquivo COOPCERTO/CABAL CSV inválido: conteúdo incompleto.');
  if (naoVazias[0].trim().toLocaleLowerCase('pt-BR') !== 'relatório de vendas') throw new Error('Arquivo COOPCERTO/CABAL CSV inválido: título não reconhecido.');
  if (!naoVazias[1].startsWith('Estabelecimento(s);')) throw new Error('Arquivo COOPCERTO/CABAL CSV inválido: identificação de estabelecimento ausente.');

  const cabecalho = parseLinhaCsv(naoVazias[2]).map((v) => v.trim());
  if (cabecalho.length !== CABECALHO.length || CABECALHO.some((campo, i) => cabecalho[i] !== campo)) {
    throw new Error(`Arquivo COOPCERTO/CABAL CSV inválido: cabeçalho inesperado: ${cabecalho.join(' | ')}`);
  }

  const estabelecimentoRelatorio = parseLinhaCsv(naoVazias[1])[1]?.trim() || '';
  const registros_brutos: RegistroCoopcertoCabalVendasCsv[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];
  let totalizador: Record<string, string> | null = null;

  for (let index = 3; index < naoVazias.length; index += 1) {
    const linha = naoVazias[index];
    const campos = parseLinhaCsv(linha);
    if (campos[0]?.trim().toUpperCase() === 'TOTAL') {
      totalizador = {
        valor_bruto: campos[21]?.trim() || '',
        valor_desconto: campos[22]?.trim() || '',
        valor_liquido: campos[23]?.trim() || '',
        total_plano_venda: campos[24]?.trim() || '',
        linha_original: linha,
      };
      continue; // totalizador: validado, nunca persistido
    }
    if (campos.length !== CABECALHO.length) throw new Error(`Linha ${index + 1} COOPCERTO/CABAL inválida: esperado ${CABECALHO.length} campos, recebido ${campos.length}.`);

    const valores = campos.map((v) => v.trim());
    const [
      numeroEstabelecimento, dataTransacaoOriginal, numeroTransacao, idVenda, bandeiraOriginal,
      formaPagamentoOriginal, planoVendaOriginal, parcela, totalParcela, numeroAutorizacao,
      tipoCartao, numeroCartao, numeroTerminal, tipoCaptura, indicadorCreditoDebito,
      indicadorCancelamento, numeroResumoVenda, dataPrevistaLiquidacaoOriginal, seuNumero,
      numeroOrdemPagamento, statusOriginal, valorBrutoOriginal, descontoOriginal, valorLiquidoOriginal,
      totalPlanoVendaOriginal,
    ] = valores;

    if (!numeroEstabelecimento || !dataTransacaoOriginal || !idVenda || !statusOriginal) throw new Error(`Linha ${index + 1} COOPCERTO/CABAL incompleta.`);
    if (bandeiraOriginal.toLocaleUpperCase('pt-BR') !== 'CABAL') throw new Error(`Linha ${index + 1} COOPCERTO/CABAL inválida: bandeira inesperada ${bandeiraOriginal || '(vazia)'}.`);

    const dh = dataHora(dataTransacaoOriginal);
    const bruto = dinheiro(valorBrutoOriginal);
    const taxa = dinheiro(descontoOriginal);
    const liquido = dinheiro(valorLiquidoOriginal);
    const status = statusCanonico(statusOriginal, indicadorCancelamento);
    const h = hash(linha);
    const dadosOriginais = Object.fromEntries(CABECALHO.map((campo, i) => [campo, valores[i] ?? ''])) as Record<string, string>;

    registros_brutos.push({
      id: `${importacaoId}-coopcerto-cabal-${index + 1}`,
      importacao_id: importacaoId,
      tipo_arquivo: 'COOPCERTO_CABAL_VENDAS_CSV',
      codigo_registro: 'VENDA',
      numero_linha: index + 1,
      numero_estabelecimento: numeroEstabelecimento,
      data_transacao: dataTransacaoOriginal,
      numero_transacao: numeroTransacao,
      id_venda: idVenda,
      bandeira: bandeiraOriginal,
      forma_pagamento: formaPagamentoOriginal,
      plano_venda: planoVendaOriginal,
      parcela,
      total_parcela: totalParcela,
      numero_autorizacao: numeroAutorizacao,
      tipo_cartao: tipoCartao,
      numero_cartao: numeroCartao,
      numero_terminal: numeroTerminal,
      tipo_captura: tipoCaptura,
      indicador_credito_debito: indicadorCreditoDebito,
      indicador_cancelamento: indicadorCancelamento,
      numero_resumo_venda: numeroResumoVenda,
      data_prevista_liquidacao: dataPrevistaLiquidacaoOriginal,
      seu_numero: seuNumero,
      numero_ordem_pagamento: numeroOrdemPagamento,
      status: statusOriginal,
      valor_parcela_bruto: valorBrutoOriginal,
      desconto_parcela: descontoOriginal,
      valor_parcela_liquido: valorLiquidoOriginal,
      total_plano_venda: totalPlanoVendaOriginal,
      linha_original: linha,
      hash_linha: h,
      dados_json: dadosOriginais,
      data_criacao: new Date().toISOString(),
    });

    const vendaCanonica: VendaAdquirente = {
      id: `${importacaoId}-coopcerto-cabal-venda-${index + 1}`,
      importacao_id: importacaoId,
      adquirente: 'COOPCERTO',
      layout_origem: 'coopcerto_cabal_vendas_csv',
      tipo_arquivo: 'COOPCERTO_CABAL_VENDAS_CSV',
      codigo_registro: 'VENDA',
      numero_linha: index + 1,
      data_venda: dh.data,
      hora_venda: dh.hora,
      data_pagamento: dataSomente(dataPrevistaLiquidacaoOriginal),
      valor_bruto: bruto.toFixed(2),
      valor_taxa: Math.abs(taxa).toFixed(2),
      percentual_taxa: bruto ? ((Math.abs(taxa) / Math.abs(bruto)) * 100).toFixed(4) : '0.0000',
      valor_liquido: liquido.toFixed(2),
      nsu: numeroTransacao === '-' ? '' : numeroTransacao,
      codigo_autorizacao: numeroAutorizacao === '-' ? '' : numeroAutorizacao,
      terminal: numeroTerminal === '-' ? '' : numeroTerminal,
      bandeira: 'CABAL',
      bandeira_original: bandeiraOriginal,
      modalidade: 'VOUCHER',
      modalidade_original: formaPagamentoOriginal,
      parcelas: `${parcela || '0'}/${totalParcela || '1'}`,
      status_transacao: status,
      status_transacao_original: statusOriginal,
      codigo_produto: planoVendaOriginal || tipoCartao,
      hash_linha: h,
      linha_original: linha,
      dados_json: {
        ...dadosOriginais,
        estabelecimento_relatorio: estabelecimentoRelatorio,
        id_venda_rrn: idVenda,
        numero_transacao: numeroTransacao,
        numero_autorizacao: numeroAutorizacao,
        forma_pagamento_original: formaPagamentoOriginal,
        plano_venda_original: planoVendaOriginal,
        tipo_cartao_original: tipoCartao,
        indicador_cancelamento_original: indicadorCancelamento,
        valor_bruto_original: valorBrutoOriginal,
        valor_taxa_original: descontoOriginal,
        valor_liquido_original: valorLiquidoOriginal,
      },
      data_criacao: new Date().toISOString(),
    };
    const chaveCoopcerto = chaveSemanticaCoopcerto(vendaCanonica);
    vendaCanonica.chave_semantica_coopcerto = chaveCoopcerto;
    vendaCanonica.dados_json = { ...vendaCanonica.dados_json, chave_semantica_coopcerto: chaveCoopcerto };
    vendas_adquirentes.push(vendaCanonica);
  }

  if (registros_brutos.length === 0) throw new Error('Arquivo COOPCERTO/CABAL CSV não contém vendas.');
  if (totalizador) {
    const somaBruto = vendas_adquirentes.reduce((s, v) => s + Number(v.valor_bruto || 0), 0);
    const somaTaxa = vendas_adquirentes.reduce((s, v) => s + Number(v.valor_taxa || 0), 0);
    const somaLiquido = vendas_adquirentes.reduce((s, v) => s + Number(v.valor_liquido || 0), 0);
    const totalBruto = dinheiro(totalizador.valor_bruto);
    const totalTaxa = dinheiro(totalizador.valor_desconto);
    const totalLiquido = dinheiro(totalizador.valor_liquido);
    if (Math.abs(somaBruto - totalBruto) > 0.01 || Math.abs(somaTaxa - totalTaxa) > 0.01 || Math.abs(somaLiquido - totalLiquido) > 0.01) {
      throw new Error(`Total COOPCERTO/CABAL divergente: calculado bruto/taxa/líquido R$ ${somaBruto.toFixed(2)}/${somaTaxa.toFixed(2)}/${somaLiquido.toFixed(2)}, arquivo informa R$ ${totalBruto.toFixed(2)}/${totalTaxa.toFixed(2)}/${totalLiquido.toFixed(2)}.`);
    }
  }

  return {
    tipo_arquivo: 'COOPCERTO_CABAL_VENDAS_CSV' as const,
    nome_original: nomeOriginal,
    estabelecimento_relatorio: estabelecimentoRelatorio,
    registros_brutos,
    vendas_adquirentes,
    totalizador,
    quantidade_vendas: registros_brutos.length,
  };
}
