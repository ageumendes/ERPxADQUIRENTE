import crypto from 'node:crypto';
import fs from 'node:fs/promises';

export type TipoExtratoCoopcerto = 'VENDAS_A_RECEBER' | 'VENDAS_RECEBIDAS';
type RegistroExtratoCoopcerto = Record<string, unknown> & { id: string; importacao_id: string; hash_linha: string };

const CABECALHO_BASE = [
  'Nº do estabelecimento', 'Data da transação', 'Nº da transação', 'ID Venda', 'Bandeira',
  'Forma de Pagamento', 'Plano de venda', 'Parcela', 'Total de parcela', 'Número da autorização',
  'Tipo cartão', 'Número do cartão', 'Número do terminal', 'Tipo captura', 'Indicador Crédito/Débito',
  'Indicador de cancelamento da venda', 'Nº resumo da venda', 'Data prevista de liquidação', 'Seu número',
  'Nº ordem de pagamento', 'Status',
];
const CABECALHO_FINANCEIRO = ['Valor parcela bruto', 'Desconto parcela', 'Valor parcela liquido', 'Total plano de venda'];
const CABECALHO_RECEBIDAS = [...CABECALHO_BASE, 'Data do pagamento', 'Nº do banco', 'Nº da agência', 'Nº da conta', ...CABECALHO_FINANCEIRO];
const CABECALHO_A_RECEBER = [...CABECALHO_BASE, ...CABECALHO_FINANCEIRO];

function csv(linha: string) {
  const campos: string[] = []; let atual = ''; let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i += 1; } else aspas = !aspas; }
    else if (c === ';' && !aspas) { campos.push(atual); atual = ''; }
    else atual += c;
  }
  campos.push(atual);
  return campos.map((item) => item.trim());
}

const normalizar = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const codigoEstabelecimento = (valor: string) => String(valor || '').replace(/\D/g, '');

function dinheiro(valor: string) {
  const texto = String(valor || '').trim();
  if (!texto || texto === '-') return 0;
  const numero = Number(texto.replace(/R\$/gi, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(numero)) throw new Error(`Valor monetário inválido no extrato COOPCERTO: ${valor}.`);
  return numero;
}

function dataHora(valor: string) {
  const match = String(valor || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Data/hora inválida no extrato COOPCERTO: ${valor || '(vazia)'}.`);
  return { data: `${match[3]}-${match[2]}-${match[1]}`, hora: `${match[4]}:${match[5]}:${match[6]}` };
}

function data(valor: string) {
  const match = String(valor || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

export async function parseCoopcertoExtratoCsv(importacaoId: string, caminhoArquivo: string, nomeOriginal: string, tipo: TipoExtratoCoopcerto) {
  const buffer = await fs.readFile(caminhoArquivo);
  let conteudo = '';
  try { conteudo = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw new Error('Extrato COOPCERTO inválido: conteúdo não está em UTF-8 válido.'); }
  const linhas = conteudo.split(/\r?\n/).map((linha) => linha.replace(/\r$/, '')).filter((linha) => linha.trim());
  if (linhas.length < 4 || !linhas[1].startsWith('Estabelecimento(s);')) throw new Error('Extrato COOPCERTO incompleto ou sem identificação dos estabelecimentos.');
  const tituloEsperado = tipo === 'VENDAS_RECEBIDAS' ? 'RELATORIO DE VENDAS RECEBIDAS' : 'RELATORIO DE VENDAS';
  if (normalizar(linhas[0]) !== tituloEsperado) throw new Error(`Título incompatível com o extrato COOPCERTO ${tipo}: ${linhas[0]}.`);

  const cabecalhoEsperado = tipo === 'VENDAS_RECEBIDAS' ? CABECALHO_RECEBIDAS : CABECALHO_A_RECEBER;
  const cabecalho = csv(linhas[2]);
  if (cabecalho.length !== cabecalhoEsperado.length || cabecalhoEsperado.some((campo, i) => campo !== cabecalho[i])) {
    throw new Error(`Cabeçalho inesperado no extrato COOPCERTO ${tipo}: ${cabecalho.join(' | ')}`);
  }

  const estabelecimentoRelatorio = csv(linhas[1])[1] || '';
  const registros_brutos: RegistroExtratoCoopcerto[] = [];
  let totalizador: string[] | null = null;
  for (let indice = 3; indice < linhas.length; indice += 1) {
    const linha = linhas[indice]; const valores = csv(linha);
    if (normalizar(valores[0] || '') === 'TOTAL') { totalizador = valores; continue; }
    if (valores.length !== cabecalho.length) throw new Error(`Linha ${indice + 1} do extrato COOPCERTO possui ${valores.length} campos; esperado ${cabecalho.length}.`);
    const codigoOriginal = valores[0]; const codigo = codigoEstabelecimento(codigoOriginal);
    if (!codigo) throw new Error(`Linha ${indice + 1} do extrato COOPCERTO sem código de estabelecimento.`);
    const dh = dataHora(valores[1]);
    const indiceFinanceiro = tipo === 'VENDAS_RECEBIDAS' ? 25 : 21;
    const original = Object.fromEntries(cabecalho.map((campo, i) => [campo, valores[i] || '']));
    const hashLinha = crypto.createHash('sha256').update(`COOPCERTO_EXTRATO|${tipo}|${linha}`).digest('hex');
    registros_brutos.push({
      id: `${importacaoId}-coopcerto-extrato-${tipo.toLowerCase()}-${indice + 1}`,
      importacao_id: importacaoId,
      tipo_arquivo: `COOPCERTO_EXTRATO_${tipo}`,
      codigo_registro: tipo,
      numero_linha: indice + 1,
      codigo_estabelecimento: codigo,
      codigo_estabelecimento_original: codigoOriginal,
      estabelecimento_relatorio: estabelecimentoRelatorio,
      data_venda: dh.data,
      hora_venda: dh.hora,
      numero_transacao: valores[2],
      id_venda: valores[3],
      bandeira: valores[4],
      modalidade: valores[5],
      parcela: valores[7],
      total_parcela: valores[8],
      codigo_autorizacao: valores[9],
      numero_cartao: valores[11],
      terminal: valores[12],
      data_prevista_liquidacao: data(valores[17]),
      status: valores[20],
      data_pagamento: tipo === 'VENDAS_RECEBIDAS' ? data(valores[21]) : '',
      numero_banco: tipo === 'VENDAS_RECEBIDAS' ? valores[22] : '',
      numero_agencia: tipo === 'VENDAS_RECEBIDAS' ? valores[23] : '',
      numero_conta: tipo === 'VENDAS_RECEBIDAS' ? valores[24] : '',
      valor_parcela_bruto: valores[indiceFinanceiro],
      desconto_parcela: valores[indiceFinanceiro + 1],
      valor_parcela_liquido: valores[indiceFinanceiro + 2],
      total_plano_venda: valores[indiceFinanceiro + 3],
      linha_original: linha,
      hash_linha: hashLinha,
      dados_json: original,
      data_criacao: new Date().toISOString(),
    });
  }
  if (!registros_brutos.length) throw new Error(`Extrato COOPCERTO ${tipo} não contém registros financeiros.`);

  if (totalizador) {
    const indiceFinanceiro = tipo === 'VENDAS_RECEBIDAS' ? 25 : 21;
    for (let deslocamento = 0; deslocamento < 3; deslocamento += 1) {
      const calculado = registros_brutos.reduce((soma, item) => soma + dinheiro(String(item[['valor_parcela_bruto', 'desconto_parcela', 'valor_parcela_liquido'][deslocamento]] || '')), 0);
      const informado = dinheiro(totalizador[indiceFinanceiro + deslocamento] || '');
      if (Math.abs(calculado - informado) > 0.01) throw new Error(`Totalizador COOPCERTO ${tipo} divergente na coluna financeira ${deslocamento + 1}: calculado ${calculado.toFixed(2)}, informado ${informado.toFixed(2)}.`);
    }
  }

  return { tipo, nome_original: nomeOriginal, registros_brutos, totalizador, quantidade_registros: registros_brutos.length };
}
