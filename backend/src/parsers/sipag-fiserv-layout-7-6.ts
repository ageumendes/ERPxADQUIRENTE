import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { RegistroSipagFiserv76, VendaAdquirente } from '../repositorio.js';

export type ResultadoSipagFiserv76 = {
  tipo_arquivo: 'S' | 'P';
  registros_brutos: RegistroSipagFiserv76[];
  vendas_adquirentes: VendaAdquirente[];
};

const CAMPOS_PIX_POS_001: Campo[] = [
  'recordType','institutionCode','serviceContractCode','document','merchantId','terminalRegister','pspCode','qrCodeStatus','dateQRCodeGenerated','hourQRCodeGenerated','dateQrCodeConfirmationReceived','hourQrCodeConfirmationReceived','amountTransaction','walletAuthorizerName','nsuTransaction','undoneResponseCode','undoneDateTransaction','undoneHourTransaction','undoneReason','referenceNumberFEPAS','authorizationCode','systemRetrievalReferenceNumber','recordNumber',
].map((chave) => ({ chave, descricao: chave }));

type Campo = { chave: string; descricao: string };

const CAMPOS_S: Record<string, Campo[]> = {
  '001': CAMPOS_PIX_POS_001,
  '000': [
    'recordType','processingDate','acquiringName','fileTypeDescription','fileNumber','clientCode','clientName','clientDocument','processingType','fileLayoutVersion','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '101': [
    'recordType','processingDate','matrixClientCode','matrixClientName','branchClientDocument','branchClientCode','branchClientName','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '010': [
    'recordType','matrixClientCode','clientCode','salesDate','salesSummaryNumber','quantityOfSales','cardSchemeDescription','transactionTypeDescription','transactionStatusDescription','grossAmountField','discountAmountField','netAmountField','creditDate','cashBackAmountField','reverseInterchangeField','bank','agency','accountTypeDescription','accountNumber','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '011': [
    'recordType','clientCode','salesDate','salesSummaryNumber','salesReceiptNumber','cardSchemeDescription','transactionTypeDescription','maskedCardNumber','paymentAccountReference','clientControlNumber','authorizationCode','transactionDateTime','terminalNumber','technologyTypeDescription','entryModeDescription','cardIssuer','cardTypeDescription','grossAmountField','discountAmountField','interchangePlusAmountField','netAmountField','creditDate','rechargeProviderName','rechargeClientCode','rechargeTerminalNumber','rechargeAuthorizationCode','cashBackAmountField','reverseInterchangeField','interchangeFeePercentField','feePercentField','feeBaseField','feeMinimumField','acquirerReference','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '012': [
    'recordType','matrixClientCode','clientCode','salesDate','salesSummaryNumber','quantityOfSales','cardSchemeDescription','transactionTypeDescription','transactionStatusDescription','grossAmountField','discountAmountField','netAmountField','creditDate','bank','agency','accountTypeDescription','accountNumber','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '013': [
    'recordType','clientCode','salesDate','salesSummaryNumber','salesReceiptNumber','cardSchemeDescription','transactionTypeDescription','maskedCardNumber','paymentAccountReference','clientControlNumber','authorizationCode','transactionDateTime','terminalNumber','technologyTypeDescription','entryModeDescription','cardIssuer','cardTypeDescription','grossAmountField','discountAmountField','interchangePlusAmountField','netAmountField','creditDate','rechargeProviderName','rechargeClientCode','rechargeTerminalNumber','rechargeAuthorizationCode','interchangeFeePercentField','feePercentField','feeBaseField','feeMinimumField','acquirerReference','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '014': [
    'recordType','matrixClientCode','clientCode','salesDate','salesSummaryNumber','quantityOfSales','cardSchemeDescription','cardIssuer','cardTypeDescription','transactionTypeDescription','transactionStatusDescription','maskedCardNumber','paymentAccountReference','clientControlNumber','authorizationCode','transactionDateTime','terminalNumber','technologyTypeDescription','entryModeDescription','grossAmountField','discountAmountField','interchangePlusAmountField','netAmountField','creditDate','totalInstallments','bank','agency','accountTypeDescription','accountNumber','feeCategory','interchangeFeePercentField','feePercentField','feeBaseField','feeMinimumField','feeMaximumField','splitOriginalSlip','splitDiscountAmount','splitDiscountFranchiseAmount','splitGrossAmount','splitClientCode','idSubSeller','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '015': [
    'recordType','clientCode','salesDate','salesSummaryNumber','salesReceiptNumber','cardSchemeDescription','transactionTypeDescription','splitGrossAmountInstallment','splitDiscountFranchiseAmountParcel','splitGrossParcelDiscountedAmount','discountAmountField','netAmountParcelField','totalNetAmountField','creditDate','salesInstallmentReceiptNumber','installmentNumber','totalInstallments','acquirerReference','idUr','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '016': [
    'recordType','matrixClientCode','clientCode','salesDate','salesSummaryNumber','quantityOfSales','cardSchemeDescription','transactionTypeDescription','transactionStatusDescription','grossAmountField','discountAmountField','netAmountField','creditDate','bank','agency','accountTypeDescription','accountNumber','splitOriginalSlip','splitGrossAmount','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '017': [
    'recordType','clientCode','salesDate','salesSummaryNumber','salesReceiptNumber','cardSchemeDescription','transactionTypeDescription','maskedCardNumber','paymentAccountReference','clientControlNumber','authorizationCode','transactionDateTime','terminalNumber','technologyTypeDescription','entryModeDescription','cardIssuer','cardTypeDescription','grossAmountField','discountAmountField','interchangePlusAmountField','netAmountField','creditDate','rechargeProviderName','rechargeClientCode','rechargeTerminalNumber','rechargeAuthorizationCode','feePercentField','feeBaseField','feeMinimumField','feeMaximumField','acquirerReference','splitOriginalSlip','splitDiscountAmount','splitGrossAmount','splitClientCode','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '018': [
    'recordType','matrixClientCode','clientCode','salesDate','salesSummaryNumber','quantityOfSales','transactionTypeDescription','transactionStatusDescription','grossAmountField','discountAmountField','netAmountField','creditDate','totalInstallments','bank','agency','accountTypeDescription','accountNumber','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '019': [
    'recordType','matrixClientCode','clientCode','salesDate','salesSummaryNumber','salesReceiptNumber','cardSchemeDescription','transactionTypeDescription','entryModeDescription','cardTypeDescription','grossAmountField','discountAmountField','netAmountField','creditDate','clientControlNumber','salesInstallmentReceiptNumber','installmentNumber','totalInstallments','acquirerReference','recordNumber',
  ].map((chave) => ({ chave, descricao: chave })),
  '201': ['recordType','matrixClientCode','branchClientCode','debitSalesQuantity','debitSalesGrossAmountField','debitSalesDiscountAmountField','debitSalesNetAmountField','creditSalesQuantity','creditSalesGrossAmountField','creditSalesDiscountAmountField','creditSalesNetAmountField','installmentSalesQuantity','installmentSalesGrossAmountField','installmentSalesDiscountAmountField','installmentSalesNetAmountField','installmentSalesIssuerQuantity','installmentSalesIssuerGrossAmountField','installmentSalesIssuerDiscountAmountField','installmentSalesIssuerNetAmountField','voucherPatSalesQuantity','voucherPatSalesGrossAmount','voucherPatSalesDiscountAmount','voucherPatSalesNetAmount','cashBackAmountField','reverseInterchangeField','quantityOfRecharge','recordNumber'].map((chave) => ({ chave, descricao: chave })),
  '999': ['recordType','matrixClientCode','debitSalesQuantity','debitSalesGrossAmountField','debitSalesDiscountAmountField','debitSalesNetAmountField','creditSalesQuantity','creditSalesGrossAmountField','creditSalesDiscountAmountField','creditSalesNetAmountField','installmentSalesQuantity','installmentSalesGrossAmountField','installmentSalesDiscountAmountField','installmentSalesNetAmountField','installmentSalesIssuerQuantity','installmentSalesIssuerGrossAmountField','installmentSalesIssuerDiscountAmountField','installmentSalesIssuerNetAmountField','voucherPatSalesQuantity','voucherPatSalesGrossAmount','voucherPatSalesDiscountAmount','voucherPatSalesNetAmount','cashBackAmountField','reverseInterchangeField','quantityOfRecharge','recordNumber'].map((chave) => ({ chave, descricao: chave })),
};

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim();
}

function splitCsvLinha(linha: string): string[] {
  const cells: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const char = linha[i];
    const proximo = linha[i + 1];
    if (char === '"' && aspas && proximo === '"') {
      atual += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      aspas = !aspas;
      continue;
    }
    if (char === ',' && !aspas) {
      cells.push(atual.trim());
      atual = '';
      continue;
    }
    atual += char;
  }
  cells.push(atual.trim());
  return cells;
}

function detectarTipoArquivo(nomeOriginal: string, linhas: string[]): 'S' | 'P' {
  const nome = nomeOriginal.toUpperCase();
  if (nome.includes('-EDI-P-') || nome.includes('EDI-P')) return 'P';
  if (nome.includes('-EDI-S-') || nome.includes('EDI-S')) return 'S';
  const primeira = linhas[0] || '';
  if (primeira.toLowerCase().includes('movimento financeiro')) return 'P';
  return 'S';
}

function dadosPorPosicao(cells: string[]) {
  const dados: Record<string, string> = {};
  cells.forEach((cell, index) => {
    dados[`COLUNA_${String(index + 1).padStart(2, '0')}`] = texto(cell);
  });
  return dados;
}


function valorMonetarioFiserv(valor: unknown): string {
  const bruto = texto(valor);
  if (!bruto || bruto === '-') return '';
  const sinal = bruto.startsWith('-') ? -1 : 1;
  const somenteDigitos = bruto.replace(/^[+-]/, '').replace(/\D/g, '');
  if (!somenteDigitos) return '';
  const numero = (Number(somenteDigitos) / 100) * sinal;
  if (!Number.isFinite(numero)) return '';
  return Math.abs(numero).toFixed(2);
}

function hashLinha(importacaoId: string, tipoArquivo: string, numeroLinha: number, linhaOriginal: string) {
  return crypto.createHash('sha256').update(JSON.stringify({ importacaoId, tipoArquivo, numeroLinha, linhaOriginal })).digest('hex');
}

type DetalheParcela = { nsu: string; numeroParcela: string; totalParcelas: string; dataCredito: string; valorLiquidoParcela: string; valorLiquidoCompra: string };

const REGISTROS_S_DE_VENDA_BRUTA = ['001', '011', '013', '014', '015', '017'];

function registroSVaiParaTabelaBrutaS(codigo: string): boolean {
  // As tabelas sipag_fiserv_layout_7_6_s_pix/cartoes devem guardar somente linhas de venda separadas por tipo.
  // Headers, resumos e trailers como 000, 101, 010, 012, 016, 018, 201 e 999 ficam fora.
  return REGISTROS_S_DE_VENDA_BRUTA.includes(codigo);
}

function registroSVaiParaVendasAdquirentes(codigo: string): boolean {
  // Apenas itens canônicos de venda entram na tabela vendas_adquirentes.
  // O 015 é detalhe de parcela e fica só na tabela bruta para auditoria da venda parcelada.
  return ['001', '011', '013', '014', '017'].includes(codigo);
}

function chaveParcelado014(cells: string[]): string {
  return [texto(cells[2]), texto(cells[3]), texto(cells[4])].join('|');
}

function menorParcela(atual: DetalheParcela | undefined, novo: DetalheParcela) {
  if (!atual) return novo;
  const a = Number(String(atual.numeroParcela).split('/')[0] || '999999');
  const n = Number(String(novo.numeroParcela).split('/')[0] || '999999');
  return n < a ? novo : atual;
}

function vendaCanonicaS(importacaoId: string, numeroLinha: number, linhaOriginal: string, cells: string[], dados_json: Record<string, string>, hash_linha: string, detalhesParcelas: Map<string, DetalheParcela>): VendaAdquirente | null {
  const codigo = texto(cells[0]);
  if (!registroSVaiParaVendasAdquirentes(codigo)) return null;
  const agora = new Date().toISOString();
  const layoutOrigem = codigo === '001' ? 'sipag_fiserv_layout_7_6_s_pix' : 'sipag_fiserv_layout_7_6_s_cartoes';
  const base = {
    id: `${importacaoId}-fiserv76-s-${numeroLinha}`,
    importacao_id: importacaoId,
    adquirente: 'SIPAG',
    layout_origem: layoutOrigem,
    tipo_arquivo: 'S',
    codigo_registro: codigo,
    numero_linha: numeroLinha,
    hash_linha,
    linha_original: linhaOriginal,
    dados_json,
    data_criacao: agora,
  };

  if (codigo === '001') {
    return {
      ...base,
      data_venda: texto(cells[8]),
      hora_venda: texto(cells[9]),
      data_pagamento: texto(cells[10]),
      valor_bruto: valorMonetarioFiserv(cells[12]),
      valor_taxa: '',
      valor_liquido: valorMonetarioFiserv(cells[12]),
      nsu: texto(cells[14]),
      codigo_autorizacao: texto(cells[20]),
      terminal: texto(cells[5]),
      bandeira: 'PIX',
      modalidade: texto(cells[13]) || 'PIX',
      parcelas: '1',
      status_transacao: texto(cells[7]) || 'PIX_POS',
      codigo_produto: texto(cells[6]),
    };
  }

  if (codigo === '011' || codigo === '013' || codigo === '017') {
    return {
      ...base,
      data_venda: texto(cells[2]),
      hora_venda: texto(cells[11]),
      data_pagamento: texto(cells[21]),
      valor_bruto: valorMonetarioFiserv(cells[17]),
      valor_taxa: valorMonetarioFiserv(cells[18]),
      valor_liquido: valorMonetarioFiserv(cells[20]),
      nsu: texto(cells[4]),
      codigo_autorizacao: texto(cells[10]),
      terminal: texto(cells[12]),
      bandeira: texto(cells[5]),
      modalidade: codigo === '011' ? 'DEBITO' : codigo === '017' ? 'VOUCHER' : 'CREDITO',
      parcelas: '1',
      status_transacao: codigo === '011' ? 'DETALHE_DEBITO' : codigo === '013' ? 'DETALHE_CREDITO_A_VISTA' : 'DETALHE_VOUCHER_BANDEIRA',
      codigo_produto: texto(cells[16]),
    };
  }

  if (codigo === '014') {
    const detalhe = detalhesParcelas.get(chaveParcelado014(cells));
    return {
      ...base,
      data_venda: texto(cells[3]),
      hora_venda: texto(cells[15]),
      data_pagamento: detalhe?.dataCredito || texto(cells[23]),
      valor_bruto: valorMonetarioFiserv(cells[19]),
      valor_taxa: valorMonetarioFiserv(cells[20]),
      valor_liquido: valorMonetarioFiserv(cells[22]),
      nsu: detalhe?.nsu || '',
      codigo_autorizacao: texto(cells[14]),
      terminal: texto(cells[16]),
      bandeira: texto(cells[6]),
      modalidade: 'CREDITO',
      parcelas: detalhe?.totalParcelas || texto(cells[24]),
      status_transacao: texto(cells[10]) || 'DETALHE_CREDITO_PARCELADO',
      codigo_produto: texto(cells[8]),
    };
  }

  return null;
}

export async function parseSipagFiserv76(importacaoId: string, caminhoArquivo: string, nomeOriginal: string): Promise<ResultadoSipagFiserv76> {
  const buffer = await fs.readFile(caminhoArquivo);
  const conteudo = buffer.toString('utf8').includes('�') ? buffer.toString('latin1') : buffer.toString('utf8');
  const linhas = conteudo.split(/\r?\n/).map((linha) => linha.replace(/\r$/, '')).filter((linha) => linha.trim().length > 0);
  const tipo_arquivo = detectarTipoArquivo(nomeOriginal, linhas);
  const registros_brutos: RegistroSipagFiserv76[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];
  const detalhesParcelas = new Map<string, DetalheParcela>();

  if (tipo_arquivo === 'S') {
    for (const linha of linhas) {
      const cells = splitCsvLinha(linha);
      if (texto(cells[0]) !== '015') continue;
      const chave = `${texto(cells[1])}|${texto(cells[2])}|${texto(cells[3])}`;
      const novo: DetalheParcela = {
        nsu: texto(cells[4]),
        numeroParcela: texto(cells[15]),
        totalParcelas: texto(cells[16]),
        dataCredito: texto(cells[13]),
        valorLiquidoParcela: texto(cells[11]),
        valorLiquidoCompra: texto(cells[12]),
      };
      detalhesParcelas.set(chave, menorParcela(detalhesParcelas.get(chave), novo));
    }
  }

  for (let index = 0; index < linhas.length; index += 1) {
    const linhaOriginal = linhas[index];
    const numeroLinha = index + 1;
    const cells = splitCsvLinha(linhaOriginal);
    const codigo_registro = texto(cells[0]);
    const dados_posicao = dadosPorPosicao(cells);
    const hash_linha = hashLinha(importacaoId, tipo_arquivo, numeroLinha, linhaOriginal);
    const data_criacao = new Date().toISOString();

    const deveGravarBruto = tipo_arquivo === 'S'
      ? registroSVaiParaTabelaBrutaS(codigo_registro)
      : true;

    if (deveGravarBruto) {
      registros_brutos.push({
        id: `${importacaoId}-fiserv76-${tipo_arquivo.toLowerCase()}-raw-${numeroLinha}`,
        importacao_id: importacaoId,
        tipo_arquivo,
        codigo_registro,
        numero_linha: numeroLinha,
        linha_original: linhaOriginal,
        hash_linha,
        ...dados_posicao,
        data_criacao,
      });
    }

    // Somente o arquivo S representa vendas da adquirente para a tabela canônica.
    const venda = tipo_arquivo === 'S'
      ? vendaCanonicaS(importacaoId, numeroLinha, linhaOriginal, cells, dados_posicao, hash_linha, detalhesParcelas)
      : null;
    if (venda) vendas_adquirentes.push(venda);
  }

  return { tipo_arquivo, registros_brutos, vendas_adquirentes };
}
