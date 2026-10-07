import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizarTexto } from '../utils.js';
import type { VendaErp } from '../repositorio.js';
import { lerExcelIsolado } from '../services/excel-isolado.js';

const aliases: Record<keyof Omit<VendaErp, 'id' | 'importacao_id' | 'numero_linha' | 'hash_linha' | 'dados_originais' | 'data_criacao'>, string[]> = {
  data_venda: ['DATA VENDA', 'DATA', 'SALE_DATE', 'CANON_SALE_DATE'],
  hora_venda: ['HORA', 'DATA E HORA DA VENDA', 'SALE_TIME', 'SALE_DATETIME'],
  terminal: ['TERMINAL', 'PDV', 'CAIXA', 'TERMINAL_NO', 'CANON_TERMINAL_NO'],
  nsu: ['NSU', 'Nº OP', 'N OP', 'NUMERO OP', 'AUTORIZAÇÃO', 'AUTORIZACAO'],
  valor_bruto: ['VALOR BRUTO', 'VALOR', 'GROSS_AMOUNT', 'CANON_GROSS_AMOUNT'],
  valor_liquido: ['VLR. LIQUIDO', 'VLR LIQUIDO', 'VALOR LIQUIDO', 'NET_AMOUNT'],
  forma_pagamento: ['FORMA PAGAMENTO', 'ESPEIE PAG', 'ESPECIE PAG', 'ESPÉCIE PAG', 'PAYMENT_METHOD', 'CANON_METHOD_GROUP'],
  bandeira: ['BANDEIRA', 'BRAND', 'CANON_BRAND'],
  tipo_produto: ['TIPO', 'ESPEIE PAG', 'ESPECIE PAG', 'ESPÉCIE PAG', 'NATCART', 'CRÉDITO/DÉBITO/PARCELADO', 'CREDITO/DEBITO/PARCELADO', 'PRODUCT_TYPE', 'CANON_PRODUCT'],
  parcelas: ['PARCELAS', 'Nº PARCELAS', 'N PARCELAS', 'NUMERO PARCELAS', 'INSTALLMENTS'],
  cnpj_estabelecimento: ['CNPJ', 'ESTABELECIMENTO', 'MERCHANT_CNPJ'],
  id_venda_erp: ['ID INTERNO', 'ID VENDA', 'Nº VENDA', 'N VENDA', 'NUMERO VENDA', 'ERP_ID'],
  status_venda: ['STATUS'],
};

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString();
  return String(valor).trim();
}

function pareceDataHoraInterdata(valor: unknown): boolean {
  const v = texto(valor);
  return /^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/.test(v) || /^\d{2}\/\d{2}\/\d{4}$/.test(v);
}

function pareceNumero(valor: unknown): boolean {
  const v = texto(valor).replace(/R\$|\s/g, '').replace(/\./g, '').replace(',', '.');
  return v !== '' && !Number.isNaN(Number(v));
}

function cnpjValido(valor: string): boolean {
  const cnpj = valor.replace(/\D/g, '');
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const digito = (base: string, pesos: number[]) => {
    const soma = base.split('').reduce((total, numero, indice) => total + Number(numero) * pesos[indice], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = digito(cnpj.slice(0, 12) + primeiro, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.endsWith(`${primeiro}${segundo}`);
}

export function extrairEstabelecimentoInterdata(matriz: unknown[][]): { cnpj: string; razao_social: string } {
  // Alguns relatórios trazem a LOJA/CNPJ apenas no rodapé.
  const candidatas = [...matriz.slice(0, 30), ...matriz.slice(Math.max(30, matriz.length - 40))];
  for (const linha of candidatas) {
    const indiceCnpj = linha.findIndex((celula) => {
      const digitos = texto(celula).replace(/\D/g, '');
      return cnpjValido(digitos);
    });
    if (indiceCnpj < 0) continue;
    const cnpj = texto(linha[indiceCnpj]).replace(/\D/g, '');
    const razaoSocial = linha
      .slice(0, indiceCnpj)
      .map(texto)
      .find((valor) => /[A-Za-zÀ-ÿ]{3}/.test(valor) && !/^(CNPJ|ESTABELECIMENTO)$/i.test(valor)) || '';
    return { cnpj, razao_social: razaoSocial };
  }
  return { cnpj: '', razao_social: '' };
}

function ehExcelInterdataSemCabecalho(matriz: unknown[][]): boolean {
  const linhas = matriz.slice(0, 50).filter((linha) => linha.some((celula) => texto(celula).length > 0));
  if (linhas.length < 5) return false;
  const linhasComPadrao = linhas.filter((linha) => {
    return pareceDataHoraInterdata(linha[0]) &&
      pareceNumero(linha[2]) &&
      ['E', 'S'].includes(texto(linha[4]).toUpperCase()) &&
      pareceDataHoraInterdata(linha[5]) &&
      texto(linha[8]).length > 0 &&
      texto(linha[11]).length > 0 &&
      ['ATIVO', 'CANCELADO', 'CANCELADA', 'ESTORNADO', 'ESTORNADA'].includes(texto(linha[15]).toUpperCase()) &&
      /^\d+\/\d+$/.test(texto(linha[16])) &&
      pareceNumero(linha[24]);
  });
  return linhasComPadrao.length >= Math.min(5, linhas.length);
}

function linhaPosicionalInterdata(row: unknown[], importacaoId: string, numeroLinha: number, agora: string, estabelecimento: { cnpj: string; razao_social: string }): VendaErp {
  const dataHora = texto(row[0]);
  const [dataVenda, horaVenda = ''] = dataHora.split(/\s+/);
  const bruto: Record<string, string> = {};
  row.forEach((cell, index) => { bruto[`COLUNA_${index + 1}`] = texto(cell); });
  if (estabelecimento.cnpj) bruto.CNPJ_ESTABELECIMENTO_RELATORIO = estabelecimento.cnpj;
  if (estabelecimento.razao_social) bruto.RAZAO_SOCIAL_ESTABELECIMENTO = estabelecimento.razao_social;

  return {
    id: `${importacaoId}-erp-${numeroLinha}`,
    importacao_id: importacaoId,
    numero_linha: numeroLinha,
    data_venda: dataVenda || texto(row[5]),
    hora_venda: horaVenda,
    terminal: '',
    nsu: texto(row[13]),
    valor_bruto: texto(row[24]),
    forma_pagamento: texto(row[8]),
    bandeira: texto(row[8]),
    tipo_produto: texto(row[11]),
    parcelas: texto(row[16]),
    cnpj_estabelecimento: estabelecimento.cnpj,
    id_venda_erp: texto(row[2]),
    status_venda: texto(row[15]),
    hash_linha: hashLinha(importacaoId, numeroLinha, bruto),
    dados_originais: bruto,
    data_criacao: agora,
  };
}

export function parseMatrizPosicionalInterdata(importacaoId: string, matriz: unknown[][], agora = new Date().toISOString()): VendaErp[] | null {
  if (!ehExcelInterdataSemCabecalho(matriz)) return null;
  const estabelecimento = extrairEstabelecimentoInterdata(matriz);
  return matriz
    .map((row, index) => ({ row, numeroLinha: index + 1 }))
    .filter(({ row }) => row.some((value) => texto(value).length > 0))
    .filter(({ row }) => pareceDataHoraInterdata(row[0]) && pareceNumero(row[24]))
    .map(({ row, numeroLinha }) => linhaPosicionalInterdata(row, importacaoId, numeroLinha, agora, estabelecimento));
}

function detectarSeparador(linha: string) {
  const candidatos = [';', ',', '|', '\t'];
  return candidatos.map((sep) => ({ sep, qtd: linha.split(sep).length })).sort((a, b) => b.qtd - a.qtd)[0]?.sep || ';';
}

function parseTextoTabular(conteudo: string): Record<string, string>[] {
  const linhas = conteudo.split(/\r?\n/).filter((linha) => linha.trim().length > 0);
  if (linhas.length < 2) return [];
  const separador = detectarSeparador(linhas[0]);
  const headers = linhas[0].split(separador).map((h) => h.trim());
  return linhas.slice(1).map((linha) => {
    const cells = linha.split(separador);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = texto(cells[index]); });
    return row;
  });
}

function encontrarLinhaCabecalho(matriz: unknown[][]): number {
  let melhorIndice = 0;
  let melhorPontuacao = -1;
  for (let i = 0; i < Math.min(matriz.length, 30); i += 1) {
    const linha = matriz[i].map(texto).join(' | ');
    const normalizada = normalizarTexto(linha);
    const pistas = ['DATA', 'HORA', 'NSU', 'TERMINAL', 'PDV', 'VALOR', 'FORMA', 'BANDEIRA', 'PARCELAS', 'STATUS'];
    const pontuacao = pistas.filter((pista) => normalizada.includes(pista)).length;
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhorIndice = i;
    }
  }
  return melhorIndice;
}

function lerLinhasExcel(matriz: unknown[][]): Record<string, string>[] {
  if (matriz.length < 2) return [];

  const headerIndex = encontrarLinhaCabecalho(matriz);
  const headers = matriz[headerIndex].map((cell, index) => texto(cell) || `COLUNA_${index + 1}`);

  return matriz.slice(headerIndex + 1).map((linha) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = texto(linha[index]); });
    return row;
  });
}

function buscarValor(row: Record<string, string>, nomes: string[]) {
  const entradas = Object.entries(row);
  for (const nome of nomes) {
    const alvo = normalizarTexto(nome);
    const encontrado = entradas.find(([header]) => {
      const headerNormalizado = normalizarTexto(header);
      return headerNormalizado === alvo || headerNormalizado.includes(alvo) || alvo.includes(headerNormalizado);
    });
    if (encontrado) return encontrado[1];
  }
  return '';
}


function ehLinhaCabecalhoRepetido(row: Record<string, string>): boolean {
  const valores = Object.values(row).map((value) => normalizarTexto(texto(value))).filter(Boolean);
  if (valores.length === 0) return true;

  const pistasCabecalho = [
    'DATA VENDA',
    'DATA E HORA DA VENDA',
    'N VENDA',
    'NUMERO VENDA',
    'N OP',
    'NUMERO OP',
    'VALOR',
    'ESPEIE PAG',
    'ESPECIE PAG',
    'BANDEIRA',
    'N PARCELAS',
    'NUMERO PARCELAS',
    'STATUS',
    'STATUS CONSILIACAO',
    'NATCART',
    'ACREC DESC',
  ];

  const qtdPistas = valores.filter((valor) => pistasCabecalho.some((pista) => valor === pista || valor.includes(pista))).length;
  const qtdValoresIguaisAoNomeDaColuna = Object.entries(row).filter(([header, value]) => {
    const h = normalizarTexto(header);
    const v = normalizarTexto(texto(value));
    return Boolean(h && v && (h === v || h.includes(v) || v.includes(h)));
  }).length;

  // O relatório Interdata repete cabeçalhos no início de páginas internas.
  // Essas linhas têm vários textos de coluna como dados: Data Venda, Nº Op, Valor, Status etc.
  return qtdPistas >= 4 || qtdValoresIguaisAoNomeDaColuna >= 4;
}

function hashLinha(importacaoId: string, numeroLinha: number, row: Record<string, string>) {
  // Layouts legados mantêm a identidade histórica baseada no lote/linha.
  return crypto.createHash('sha256').update(JSON.stringify({ importacaoId, numeroLinha, row })).digest('hex');
}

function normalizarDataInterdata(valor: unknown): string {
  const v = texto(valor);
  if (!v) return '';
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[1]}/${br[2]}/${br[3]}` : v;
}

function normalizarHoraInterdata(valor: unknown): string {
  const v = texto(valor);
  const m = v.match(/(?:T|\s)(\d{2}:\d{2}(?::\d{2})?)/);
  return m?.[1] || '';
}

function ehLayoutInterdataMovimento30Dias(matriz: unknown[][]): boolean {
  const linha = matriz.slice(0, 10).find((r) => {
    const n = r.map((c) => normalizarTexto(texto(c)).replace(/[^A-Z0-9/]+/g, ' ').trim()).filter(Boolean);
    return ['BANDEIRA', 'PRCLAS', 'ESPEIE PAG', 'VLR PARCELA', 'EMISSAO', 'VENCIMENTO', 'CODIGO', 'COD VENDA', 'DATA/HORA']
      .filter((p) => n.includes(p)).length >= 7;
  });
  return Boolean(linha);
}

function hashMovimento30Dias(row: Record<string, string>, cnpj: string): string {
  // O campo Código é estável entre exportações sobrepostas do mesmo estabelecimento.
  // A identidade NÃO usa importacaoId nem numeroLinha, portanto D-29 + hoje pode ser
  // reimportado diariamente sem criar cópias. O fallback usa apenas conteúdo comercial.
  const codigo = buscarValor(row, ['CÓDIGO', 'CODIGO']);
  const identidade = codigo
    ? { layout: 'INTERDATA_MOVIMENTO_30D', estabelecimento: cnpj, codigo }
    : {
        layout: 'INTERDATA_MOVIMENTO_30D', estabelecimento: cnpj,
        emissao: buscarValor(row, ['EMISSÃO', 'EMISSAO']),
        vencimento: buscarValor(row, ['VENCIMENTO']),
        data_hora: buscarValor(row, ['DATA/HORA']),
        numero_operacao: buscarValor(row, ['Nº OP', 'N OP']),
        codigo_venda: buscarValor(row, ['CÓD. VENDA', 'COD VENDA']),
        bandeira: buscarValor(row, ['BANDEIRA']),
        parcelas: buscarValor(row, ['PRCLAS']),
        especie: buscarValor(row, ['ESPEIE PAG', 'ESPECIE PAG']),
        valor: buscarValor(row, ['VLR. PARCELA', 'VLR PARCELA']),
        cliente: buscarValor(row, ['CÓD. CLIENTE', 'COD CLIENTE']),
      };
  return crypto.createHash('sha256').update(JSON.stringify(identidade)).digest('hex');
}

export function parseMatrizMovimento30Dias(importacaoId: string, matriz: unknown[][], agora: string): VendaErp[] | null {
  if (!ehLayoutInterdataMovimento30Dias(matriz)) return null;
  const estabelecimento = extrairEstabelecimentoInterdata(matriz);
  if (!estabelecimento.cnpj) {
    throw new Error('Layout ERP de movimento identificado, mas o CNPJ/LOJA do rodapé não foi encontrado. Importação bloqueada para evitar atribuição à loja errada.');
  }
  const linhas = lerLinhasExcel(matriz);
  return linhas
    .map((row, index) => ({ row, numeroLinha: index + 2 }))
    .filter(({ row }) => !ehLinhaCabecalhoRepetido(row))
    .filter(({ row }) => Boolean(buscarValor(row, ['CÓDIGO', 'CODIGO'])) && Boolean(buscarValor(row, ['VLR. PARCELA', 'VLR PARCELA'])))
    .map(({ row, numeroLinha }) => {
      const dataHora = buscarValor(row, ['DATA/HORA']);
      const emissao = buscarValor(row, ['EMISSÃO', 'EMISSAO']);
      const codigo = buscarValor(row, ['CÓDIGO', 'CODIGO']);
      const originais = {
        ...row,
        CNPJ_ESTABELECIMENTO_RELATORIO: estabelecimento.cnpj,
        RAZAO_SOCIAL_ESTABELECIMENTO: estabelecimento.razao_social,
        CODIGO_REGISTRO_ERP: codigo,
        LAYOUT_ERP: 'INTERDATA_MOVIMENTO_30D',
      };
      return {
        id: `${importacaoId}-erp-${numeroLinha}`, importacao_id: importacaoId, numero_linha: numeroLinha,
        data_venda: normalizarDataInterdata(dataHora || emissao),
        hora_venda: normalizarHoraInterdata(dataHora),
        terminal: '', nsu: buscarValor(row, ['Nº OP', 'N OP']),
        valor_bruto: buscarValor(row, ['VLR. PARCELA', 'VLR PARCELA']),
        valor_liquido: buscarValor(row, aliases.valor_liquido),
        forma_pagamento: buscarValor(row, ['ESPEIE PAG', 'ESPECIE PAG']),
        bandeira: buscarValor(row, ['BANDEIRA']),
        tipo_produto: buscarValor(row, ['ESPEIE PAG', 'ESPECIE PAG']),
        parcelas: buscarValor(row, ['PRCLAS']),
        cnpj_estabelecimento: estabelecimento.cnpj,
        id_venda_erp: buscarValor(row, ['CÓD. VENDA', 'COD VENDA']),
        status_venda: '', hash_linha: hashMovimento30Dias(row, estabelecimento.cnpj),
        dados_originais: originais, data_criacao: agora,
      } satisfies VendaErp;
    });
}

export async function parseLayoutInterdata(importacaoId: string, caminhoArquivo: string): Promise<VendaErp[]> {
  const ext = path.extname(caminhoArquivo).toLowerCase();
  const agora = new Date().toISOString();
  let linhas: Record<string, string>[] = [];

  if (['.xls', '.xlsx'].includes(ext)) {
    const { matriz } = await lerExcelIsolado(caminhoArquivo);
    const estabelecimento = extrairEstabelecimentoInterdata(matriz);
    const movimento30Dias = parseMatrizMovimento30Dias(importacaoId, matriz, agora);
    if (movimento30Dias) return movimento30Dias;
    const posicionais = parseMatrizPosicionalInterdata(importacaoId, matriz, agora);
    if (posicionais) return posicionais;

    linhas = lerLinhasExcel(matriz);
    if (estabelecimento.cnpj) {
      linhas = linhas.map((linha) => ({
        ...linha,
        CNPJ_ESTABELECIMENTO_RELATORIO: estabelecimento.cnpj,
        RAZAO_SOCIAL_ESTABELECIMENTO: estabelecimento.razao_social,
      }));
    }
  } else {
    const conteudo = await fs.readFile(caminhoArquivo, 'latin1');
    linhas = parseTextoTabular(conteudo);
  }

  return linhas
    .map((row, index) => ({ row, numeroLinha: index + 2 }))
    .filter(({ row }) => Object.values(row).some((value) => texto(value).length > 0))
    .filter(({ row }) => !ehLinhaCabecalhoRepetido(row))
    .map(({ row, numeroLinha }) => {
      const venda: VendaErp = {
        id: `${importacaoId}-erp-${numeroLinha}`,
        importacao_id: importacaoId,
        numero_linha: numeroLinha,
        data_venda: buscarValor(row, aliases.data_venda),
        hora_venda: buscarValor(row, aliases.hora_venda),
        terminal: buscarValor(row, aliases.terminal),
        nsu: buscarValor(row, aliases.nsu),
        valor_bruto: buscarValor(row, aliases.valor_bruto),
        valor_liquido: buscarValor(row, aliases.valor_liquido),
        forma_pagamento: buscarValor(row, aliases.forma_pagamento),
        bandeira: buscarValor(row, aliases.bandeira),
        tipo_produto: buscarValor(row, aliases.tipo_produto),
        parcelas: buscarValor(row, aliases.parcelas),
        cnpj_estabelecimento: buscarValor(row, ['CNPJ_ESTABELECIMENTO_RELATORIO', ...aliases.cnpj_estabelecimento]),
        id_venda_erp: buscarValor(row, aliases.id_venda_erp),
        status_venda: buscarValor(row, aliases.status_venda),
        hash_linha: hashLinha(importacaoId, numeroLinha, row),
        dados_originais: row,
        data_criacao: agora,
      };
      return venda;
    });
}
