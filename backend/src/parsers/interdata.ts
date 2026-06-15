import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizarTexto } from '../utils.js';
import type { VendaErp } from '../repositorio.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const aliases: Record<keyof Omit<VendaErp, 'id' | 'importacao_id' | 'numero_linha' | 'hash_linha' | 'dados_originais' | 'data_criacao'>, string[]> = {
  data_venda: ['DATA VENDA', 'DATA', 'SALE_DATE', 'CANON_SALE_DATE'],
  hora_venda: ['HORA', 'DATA E HORA DA VENDA', 'SALE_TIME', 'SALE_DATETIME'],
  terminal: ['TERMINAL', 'PDV', 'CAIXA', 'TERMINAL_NO', 'CANON_TERMINAL_NO'],
  nsu: ['NSU', 'Nº OP', 'N OP', 'NUMERO OP', 'AUTORIZAÇÃO', 'AUTORIZACAO'],
  valor_bruto: ['VALOR BRUTO', 'VALOR', 'GROSS_AMOUNT', 'CANON_GROSS_AMOUNT'],
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

function linhaPosicionalInterdata(row: unknown[], importacaoId: string, numeroLinha: number, agora: string): VendaErp {
  const dataHora = texto(row[0]);
  const [dataVenda, horaVenda = ''] = dataHora.split(/\s+/);
  const bruto: Record<string, string> = {};
  row.forEach((cell, index) => { bruto[`COLUNA_${index + 1}`] = texto(cell); });

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
    cnpj_estabelecimento: '',
    id_venda_erp: texto(row[2]),
    status_venda: texto(row[15]),
    hash_linha: hashLinha(importacaoId, numeroLinha, bruto),
    dados_originais: bruto,
    data_criacao: agora,
  };
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

function lerLinhasExcel(caminhoArquivo: string): Record<string, string>[] {
  const workbook = XLSX.readFile(caminhoArquivo, { cellDates: false, raw: false });
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
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
  // Hash do conteúdo bruto. Nenhum campo importado é convertido ou alterado.
  return crypto.createHash('sha256').update(JSON.stringify({ importacaoId, numeroLinha, row })).digest('hex');
}

export async function parseLayoutInterdata(importacaoId: string, caminhoArquivo: string): Promise<VendaErp[]> {
  const ext = path.extname(caminhoArquivo).toLowerCase();
  const agora = new Date().toISOString();
  let linhas: Record<string, string>[] = [];

  if (['.xls', '.xlsx'].includes(ext)) {
    const workbook = XLSX.readFile(caminhoArquivo, { cellDates: false, raw: false });
    const sheetName = workbook.SheetNames?.[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    const matriz = sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][] : [];

    if (ehExcelInterdataSemCabecalho(matriz)) {
      return matriz
        .map((row, index) => ({ row, numeroLinha: index + 1 }))
        .filter(({ row }) => row.some((value) => texto(value).length > 0))
        .filter(({ row }) => pareceDataHoraInterdata(row[0]) && pareceNumero(row[24]))
        .map(({ row, numeroLinha }) => linhaPosicionalInterdata(row, importacaoId, numeroLinha, agora));
    }

    linhas = lerLinhasExcel(caminhoArquivo);
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
        forma_pagamento: buscarValor(row, aliases.forma_pagamento),
        bandeira: buscarValor(row, aliases.bandeira),
        tipo_produto: buscarValor(row, aliases.tipo_produto),
        parcelas: buscarValor(row, aliases.parcelas),
        cnpj_estabelecimento: buscarValor(row, aliases.cnpj_estabelecimento),
        id_venda_erp: buscarValor(row, aliases.id_venda_erp),
        status_venda: buscarValor(row, aliases.status_venda),
        hash_linha: hashLinha(importacaoId, numeroLinha, row),
        dados_originais: row,
        data_criacao: agora,
      };
      return venda;
    });
}
