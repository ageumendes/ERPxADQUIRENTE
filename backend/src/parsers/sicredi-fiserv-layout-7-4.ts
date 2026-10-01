import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { RegistroSicrediFiserv74, VendaAdquirente } from '../repositorio.js';

type TipoArquivoSicredi = 'S' | 'P' | 'R';

type ResultadoSicrediFiserv74 = {
  tipo_arquivo: TipoArquivoSicredi;
  registros_brutos: RegistroSicrediFiserv74[];
  vendas_adquirentes: VendaAdquirente[];
};

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;
    if (typeof obj.description === 'string' && typeof obj.code === 'string') return `${obj.code} - ${obj.description}`;
    if (typeof obj.description === 'string') return obj.description;
    if (typeof obj.code === 'string') return obj.code;
    return JSON.stringify(valor);
  }
  return String(valor).trim();
}

function detectarTipoArquivo(nomeOriginal: string, data: any): TipoArquivoSicredi {
  const nome = nomeOriginal.toUpperCase();
  if (nome.includes('EDI-P-') || nome.includes('-P-')) return 'P';
  if (nome.includes('EDI-R-') || nome.includes('-R-')) return 'R';
  if (nome.includes('EDI-S-') || nome.includes('-S-')) return 'S';
  const desc = texto(data?.fileHeader?.fileTypeDescription).toUpperCase();
  if (desc.includes('FINANCEIRO')) return 'P';
  if (desc.includes('RECEB')) return 'R';
  return 'S';
}

function hashRegistro(importacaoId: string, tipoArquivo: string, codigo: string, numeroLinha: number, payload: unknown) {
  return crypto.createHash('sha256').update(JSON.stringify({ importacaoId, tipoArquivo, codigo, numeroLinha, payload })).digest('hex');
}

function flatten(valor: unknown, prefixo = '', saida: Record<string, string> = {}): Record<string, string> {
  if (valor === null || valor === undefined) {
    if (prefixo) saida[prefixo] = '';
    return saida;
  }
  if (Array.isArray(valor)) {
    if (prefixo) saida[prefixo] = JSON.stringify(valor);
    return saida;
  }
  if (typeof valor === 'object') {
    for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
      flatten(item, prefixo ? `${prefixo}.${chave}` : chave, saida);
    }
    return saida;
  }
  if (prefixo) saida[prefixo] = texto(valor);
  return saida;
}

function colunasPorRegistro(registro: Record<string, unknown>) {
  const flat = flatten(registro);
  const valores = Object.values(flat);
  const colunas: Record<string, string> = {};
  for (let i = 0; i < Math.min(valores.length, 60); i += 1) {
    colunas[`COLUNA_${String(i + 1).padStart(2, '0')}`] = valores[i] ?? '';
  }
  return colunas;
}

function registroBruto(importacaoId: string, tipo_arquivo: TipoArquivoSicredi, registro: Record<string, unknown>, numeroLinha: number): RegistroSicrediFiserv74 {
  const codigo = texto(registro.recordType || '');
  const linha_original = JSON.stringify(registro);
  return {
    id: `${importacaoId}-sicredi74-${tipo_arquivo.toLowerCase()}-raw-${numeroLinha}`,
    importacao_id: importacaoId,
    tipo_arquivo,
    codigo_registro: codigo,
    numero_linha: numeroLinha,
    linha_original,
    hash_linha: hashRegistro(importacaoId, tipo_arquivo, codigo, numeroLinha, registro),
    ...colunasPorRegistro(registro),
    dados_json: registro,
    data_criacao: new Date().toISOString(),
  };
}

function valorDecimal(valor: unknown): string {
  const v = texto(valor);
  if (!v) return '';
  const numero = Number(v.replace(',', '.'));
  if (Number.isFinite(numero)) return Math.abs(numero).toFixed(2);
  const digitos = v.replace(/^[+-]/, '').replace(/\D/g, '');
  if (!digitos) return '';
  return Math.abs(Number(digitos) / 100).toFixed(2);
}

function vendaBase(importacaoId: string, numeroLinha: number, codigo: string, registro: Record<string, unknown>, layoutOrigem: string): Omit<VendaAdquirente, 'hash_linha'> & { hash_linha?: string } {
  const linha_original = JSON.stringify(registro);
  return {
    id: `${importacaoId}-sicredi74-s-${numeroLinha}`,
    importacao_id: importacaoId,
    adquirente: 'SICREDI',
    layout_origem: layoutOrigem,
    tipo_arquivo: 'S',
    codigo_registro: codigo,
    numero_linha: numeroLinha,
    hash_linha: hashRegistro(importacaoId, 'S', codigo, numeroLinha, registro),
    linha_original,
    dados_json: flatten(registro),
    data_criacao: new Date().toISOString(),
  };
}

function vendaPix(importacaoId: string, numeroLinha: number, registro: any): VendaAdquirente {
  return {
    ...vendaBase(importacaoId, numeroLinha, '001', registro, 'sicredi_fiserv_layout_7_4_s_pix'),
    data_venda: texto(registro.dateQRCodeGenerated),
    hora_venda: texto(registro.hourQRCodeGenerated),
    data_pagamento: texto(registro.dateQrCodeConfirmationReceived),
    valor_bruto: valorDecimal(registro.amountTransaction ?? registro.amountTransactionField),
    valor_taxa: '',
    valor_liquido: valorDecimal(registro.amountTransaction ?? registro.amountTransactionField),
    nsu: texto(registro.nsuTransaction),
    codigo_autorizacao: texto(registro.authorizationCode),
    terminal: texto(registro.terminalRegister),
    bandeira: 'PIX',
    modalidade: 'PIX',
    parcelas: '1',
    status_transacao: texto(registro.qrCodeStatus),
    codigo_produto: texto(registro.pspCode),
  } as VendaAdquirente;
}

function vendaCartao(importacaoId: string, numeroLinha: number, codigo: '011' | '013', registro: any): VendaAdquirente {
  const modalidade = codigo === '011' ? 'DEBITO' : 'CREDITO';
  return {
    ...vendaBase(importacaoId, numeroLinha, codigo, registro, 'sicredi_fiserv_layout_7_4_s_cartoes'),
    data_venda: texto(registro.salesDate),
    hora_venda: texto(registro.transactionDateTime),
    data_pagamento: texto(registro.creditDate),
    valor_bruto: valorDecimal(registro.grossAmount ?? registro.grossAmountField),
    valor_taxa: valorDecimal(registro.discountAmount ?? registro.discountAmountField),
    valor_liquido: valorDecimal(registro.netAmount ?? registro.netAmountField),
    nsu: texto(registro.salesReceiptNumber),
    codigo_autorizacao: texto(registro.authorizationCode),
    terminal: texto(registro.terminalNumber),
    bandeira: texto(registro.cardSchemeDescription || registro.cardScheme),
    modalidade,
    parcelas: '1',
    status_transacao: codigo === '011' ? 'DETALHE_DEBITO' : 'DETALHE_CREDITO_A_VISTA',
    codigo_produto: texto(registro.cardTypeDescription || registro.cardType),
  } as VendaAdquirente;
}

function vendaParcelada(importacaoId: string, numeroLinha: number, registro014: any, detalhe015?: any): VendaAdquirente {
  return {
    ...vendaBase(importacaoId, numeroLinha, '014', registro014, 'sicredi_fiserv_layout_7_4_s_cartoes'),
    data_venda: texto(registro014.salesDate),
    hora_venda: texto(registro014.transactionDateTime),
    data_pagamento: texto(registro014.creditDate || detalhe015?.creditDate),
    valor_bruto: valorDecimal(registro014.grossAmount ?? registro014.grossAmountField),
    valor_taxa: valorDecimal(registro014.discountAmount ?? registro014.discountAmountField),
    valor_liquido: valorDecimal(registro014.netAmount ?? registro014.netAmountField),
    nsu: texto(detalhe015?.salesReceiptNumber || registro014.salesReceiptNumber || registro014.salesSummaryNumber),
    codigo_autorizacao: texto(registro014.authorizationCode),
    terminal: texto(registro014.terminalNumber),
    bandeira: texto(registro014.cardSchemeDescription || registro014.cardScheme),
    modalidade: 'CREDITO',
    parcelas: texto(registro014.totalInstallments || detalhe015?.totalInstallments),
    status_transacao: texto(registro014.transactionStatusDescription || 'DETALHE_CREDITO_PARCELADO'),
    codigo_produto: texto(registro014.cardTypeDescription || registro014.cardType),
  } as VendaAdquirente;
}

function menorDetalheParcela(detalhes: any[] | undefined): any | undefined {
  if (!Array.isArray(detalhes) || detalhes.length === 0) return undefined;
  return [...detalhes].sort((a, b) => Number(texto(a.installmentNumber).split('/')[0] || 999) - Number(texto(b.installmentNumber).split('/')[0] || 999))[0];
}

export async function parseSicrediFiserv74(importacaoId: string, caminhoArquivo: string, nomeOriginal: string): Promise<ResultadoSicrediFiserv74> {
  const conteudo = await fs.readFile(caminhoArquivo, 'utf8');
  const data = JSON.parse(conteudo);
  const tipo_arquivo = detectarTipoArquivo(nomeOriginal, data);
  const registros_brutos: RegistroSicrediFiserv74[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];
  let numero = 1;

  const pushBruto = (registro: Record<string, unknown>) => {
    registros_brutos.push(registroBruto(importacaoId, tipo_arquivo, registro, numero));
    numero += 1;
  };

  if (tipo_arquivo === 'S') {
    // A tabela bruta do S mantém somente registros que representam vendas/cartão/PIX.
    // Headers, trailers, resumos, cancelamentos, chargebacks e detalhes financeiros ficam fora desta tabela.
    for (const pix of data.pixTransactions || []) {
      pushBruto(pix);
      vendas_adquirentes.push(vendaPix(importacaoId, numero - 1, pix));
    }

    for (const resumo of data.debitSalesSummary || []) {
      for (const recibo of resumo.debitSalesReceipt || []) {
        pushBruto(recibo);
        vendas_adquirentes.push(vendaCartao(importacaoId, numero - 1, '011', recibo));
      }
    }

    for (const resumo of data.creditSalesSummary || []) {
      for (const recibo of resumo.creditSalesReceipt || []) {
        pushBruto(recibo);
        vendas_adquirentes.push(vendaCartao(importacaoId, numero - 1, '013', recibo));
      }
    }

    for (const parcelado of data.salesInstallmentTransaction || []) {
      const numeroRegistro014 = numero;
      pushBruto(parcelado);
      vendas_adquirentes.push(vendaParcelada(importacaoId, numeroRegistro014, parcelado, menorDetalheParcela(parcelado.salesReceiptInstallmentTransaction)));
    }
  } else if (tipo_arquivo === 'P') {
    // Arquivo financeiro: persistimos somente eventos/detalhes úteis. Headers,
    // trailers e objetos explicitamente totalizadores (*Summary) não vão ao banco.
    const listas = ['financeSuspendedTransactions', 'financeAdjustments', 'chargebackReceipt'];
    for (const lista of listas) for (const item of data[lista] || []) pushBruto(item);
  } else {
    // Recebíveis: a unidade recebível é o evento de negócio; trailers e cabeçalhos
    // são apenas estruturas de controle do arquivo.
    for (const item of data.receivableUnits || []) pushBruto(item);
  }

  return { tipo_arquivo, registros_brutos, vendas_adquirentes };
}
