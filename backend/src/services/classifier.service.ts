import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizarTexto } from '../utils.js';
import type { ResultadoClassificacao } from '../types.js';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

function texto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString();
  return String(valor).trim();
}

function lerAmostraExcel(caminhoArquivo: string) {
  try {
    const workbook = XLSX.readFile(caminhoArquivo, { cellDates: false, raw: false });
    const sheetName = workbook.SheetNames?.[0];
    if (!sheetName) return { conteudo: '', quantidade_registros: 0, matriz: [] as unknown[][] };
    const sheet = workbook.Sheets[sheetName];
    const matriz = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
    const primeirasLinhas = matriz.slice(0, 30).map((linha) => linha.map(texto).join(' | ')).join('\n');
    const linhasComConteudo = matriz.filter((linha) => linha.some((celula) => texto(celula).length > 0));
    return { conteudo: primeirasLinhas, quantidade_registros: linhasComConteudo.length, matriz };
  } catch {
    return { conteudo: '', quantidade_registros: 0, matriz: [] as unknown[][] };
  }
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
    const dataHora = pareceDataHoraInterdata(linha[0]);
    const numeroVenda = pareceNumero(linha[2]);
    const tipoEntradaSaida = ['E', 'S'].includes(texto(linha[4]).toUpperCase());
    const dataMovimento = pareceDataHoraInterdata(linha[5]);
    const formaPagamento = texto(linha[8]).length > 0;
    const modalidade = texto(linha[11]).length > 0;
    const status = ['ATIVO', 'CANCELADO', 'CANCELADA', 'ESTORNADO', 'ESTORNADA'].includes(texto(linha[15]).toUpperCase());
    const parcelas = /^\d+\/\d+$/.test(texto(linha[16]));
    const valor = pareceNumero(linha[24]);
    return dataHora && numeroVenda && tipoEntradaSaida && dataMovimento && formaPagamento && modalidade && status && parcelas && valor;
  });

  return linhasComPadrao.length >= Math.min(5, linhas.length);
}

async function lerAmostraTexto(caminhoArquivo: string) {
  const buffer = await fs.readFile(caminhoArquivo);
  const conteudo = buffer.toString('latin1').slice(0, 60000);
  const linhas = conteudo.split(/\r?\n/).filter((linha) => linha.trim().length > 0);
  return { conteudo, quantidade_registros: Math.max(linhas.length - 1, 0) };
}

export async function classificarArquivo(caminhoArquivo: string, nomeOriginal: string): Promise<ResultadoClassificacao> {
  const ext = path.extname(nomeOriginal || caminhoArquivo).toLowerCase();
  const amostra = ['.xls', '.xlsx'].includes(ext) ? lerAmostraExcel(caminhoArquivo) : await lerAmostraTexto(caminhoArquivo);
  const conteudo = normalizarTexto(amostra.conteudo);
  const nome = normalizarTexto(nomeOriginal);
  const quantidade_registros = amostra.quantidade_registros;

  // SICOOB PSP PIX: JSON gerado pela API /pix do Sicoob contendo array "pix".
  // Importante: ler o JSON completo aqui. A amostra de texto é truncada em 60KB e
  // arquivos Sicoob grandes ficavam com JSON.parse inválido, caindo em fallback ERP.
  if (ext === '.json') {
    try {
      const conteudoJsonCompleto = await fs.readFile(caminhoArquivo, 'utf8');
      const parsed = JSON.parse(conteudoJsonCompleto);
      const listaPix = Array.isArray(parsed?.pix) ? parsed.pix : Array.isArray(parsed) ? parsed : [];
      const primeiro = listaPix[0] || {};
      const ehSicoobPspPix =
        listaPix.length > 0 &&
        Boolean(primeiro.endToEndId || primeiro.txid || primeiro.horario) &&
        (parsed?.layout === 'sicoob_layout_psp_pix' ||
          parsed?.origem === 'SICOOB' ||
          parsed?.consulta ||
          parsed?.resumo ||
          nome.includes('SICOOB') ||
          nome.includes('PSP'));

      if (ehSicoobPspPix) {
        return { origem_detectada: 'SICOOB', layout_detectado: 'SICOOB_LAYOUT_PSP_PIX_JSON', quantidade_registros: listaPix.length };
      }
    } catch {
      // Se não for JSON válido, segue para as demais classificações.
    }
  }

  // ERP INTERDATA em XLS gerado sem cabeçalho: algumas exportações vêm direto com
  // linhas de dados. Exemplo observado: col. 0=data/hora, col. 2=nº venda,
  // col. 8=bandeira/forma, col. 11=modalidade, col. 15=status, col. 16=parcelas,
  // col. 24=valor. Esse caso precisa ser detectado antes da busca por cabeçalhos.
  if (['.xls', '.xlsx'].includes(ext) && ehExcelInterdataSemCabecalho((amostra as any).matriz || [])) {
    return { origem_detectada: 'ERP_INTERDATA', layout_detectado: 'LAYOUT_INTERDATA', quantidade_registros };
  }

  const pistasInterdata = [
    'INTERDATA', 'DATA VENDA', 'DATA', 'HORA', 'TERMINAL', 'PDV', 'CAIXA', 'NSU', 'AUTORIZACAO',
    'AUTORIZAÇÃO', 'VALOR BRUTO', 'VALOR', 'FORMA PAGAMENTO', 'BANDEIRA', 'PARCELAS', 'ID VENDA', 'ID INTERNO',
    'CNPJ', 'ESTABELECIMENTO', 'STATUS',
    // Cabeçalhos técnicos usados no XLS/XLSX exportado pelo ERP INTERDATA.
    'SALE_DATE', 'SALE_TIME', 'GROSS_AMOUNT', 'METHOD_GROUP', 'PRODUCT_TYPE', 'ERP_ID',
  ];
  const totalPistasInterdata = pistasInterdata.filter((pista) => conteudo.includes(normalizarTexto(pista))).length;

  if (nome.includes('INTERDATA') || conteudo.includes('INTERDATA') || totalPistasInterdata >= 4) {
    return { origem_detectada: 'ERP_INTERDATA', layout_detectado: 'LAYOUT_INTERDATA', quantidade_registros };
  }



  // CONVCARD Layout Padrão Conciliação Financeira v2.0.3: registros fixos A0/L0/CV/CP/CC/TB/L9/A9, 240 posições.
  if (nome.includes('CONVCARD') || conteudo.includes('CONVCARD') || /^A0\d{6}02\.0\.3/.test(conteudo) || conteudo.includes('CV') && conteudo.includes('A0')) {
    const linhasConvcard = amostra.conteudo.split(/\r?\n/).map((linha) => linha.trim()).filter(Boolean);
    const tiposConvcard = new Set(linhasConvcard.map((linha) => linha.slice(0, 2).toUpperCase()));
    if (tiposConvcard.has('A0') || tiposConvcard.has('CV') || tiposConvcard.has('L0')) {
      return { origem_detectada: 'CONVCARD', layout_detectado: 'CONVCARD_LAYOUT_2_0_3', quantidade_registros };
    }
  }

  // PRIORIDADE ABSOLUTA: os layouts SIPAG 2.0 e Fiserv 7.6 usam padrões de nome diferentes.
  // SIPAG 2.0 vem como SIPAG-EDI-*. Fiserv 7.6 vem como BRCDSE00-EDI-*.
  // Nunca usar apenas "-EDI-S-" para classificar, pois isso captura os dois layouts.
  if (nome.startsWith('SIPAG-EDI-S') || nome.includes('/SIPAG-EDI-S') || nome.includes('SIPAG-EDI-S-')) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_LAYOUT_2_0_S', quantidade_registros };
  }

  if (nome.startsWith('SIPAG-EDI-P') || nome.includes('/SIPAG-EDI-P') || nome.includes('SIPAG-EDI-P-')) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_LAYOUT_2_0_P', quantidade_registros };
  }

  if (nome.startsWith('SIPAG-EDI-R') || nome.includes('/SIPAG-EDI-R') || nome.includes('SIPAG-EDI-R-')) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_LAYOUT_2_0_R', quantidade_registros };
  }

  if (nome.startsWith('BRCDSE00-EDI-S') || nome.includes('/BRCDSE00-EDI-S') || nome.includes('BRCDSE00-EDI-S-')) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_FISERV_LAYOUT_7_6_S', quantidade_registros };
  }

  if (nome.startsWith('BRCDSE00-EDI-P') || nome.includes('/BRCDSE00-EDI-P') || nome.includes('BRCDSE00-EDI-P-')) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_FISERV_LAYOUT_7_6_P', quantidade_registros };
  }

  // Fallback por conteúdo. O SIPAG 2.0 antigo geralmente informa layout 704 no registro 000.
  if ((conteudo.includes('SIPAG') && conteudo.includes('MOVIMENTO DE VENDAS') && conteudo.includes(',704,')) ||
      (conteudo.includes('SIPAG') && conteudo.includes('MOVIMENTO DE VENDAS') && conteudo.includes('LAYOUT 2.0'))) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_LAYOUT_2_0_S', quantidade_registros };
  }

  if ((conteudo.includes('SIPAG') && conteudo.includes('MOVIMENTO FINANCEIRO') && conteudo.includes(',704,')) ||
      (conteudo.includes('SIPAG') && conteudo.includes('MOVIMENTO FINANCEIRO') && conteudo.includes('LAYOUT 2.0'))) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_LAYOUT_2_0_P', quantidade_registros };
  }

  if ((nome.includes('SIPAG') || conteudo.includes('BANCO COOPERATIVO DO BRASIL')) && conteudo.includes('MOVIMENTO DE RECEB')) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_LAYOUT_2_0_R', quantidade_registros };
  }

  // Fallback Fiserv 7.6 somente quando houver indicação explícita de Fiserv/BRCDSE, não por "-EDI-S-" genérico.
  if ((nome.includes('FISERV') || conteudo.includes('FISERV')) && conteudo.includes('MOVIMENTO DE VENDAS') && (conteudo.includes('7.1.0') || conteudo.includes('7.6'))) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_FISERV_LAYOUT_7_6_S', quantidade_registros };
  }

  if ((nome.includes('FISERV') || conteudo.includes('FISERV')) && conteudo.includes('MOVIMENTO FINANCEIRO') && (conteudo.includes('7.1.0') || conteudo.includes('7.6'))) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_FISERV_LAYOUT_7_6_P', quantidade_registros };
  }

  if (nome.includes('SIPAG') || nome.includes('FISERV') || conteudo.includes('SIPAG') || conteudo.includes('FISERV') || conteudo.includes('CARDSE')) {
    return { origem_detectada: 'SIPAG', layout_detectado: 'SIPAG_LAYOUT_2_0', quantidade_registros };
  }


  // SICREDI Fiserv Layout 7.4 em JSON. Deve ser detectado antes do fallback genérico de SICREDI.
  if (nome.includes('EDI-S-00000004-110') || nome.includes('SICREDI') && nome.includes('EDI-S')) {
    return { origem_detectada: 'SICREDI', layout_detectado: 'SICREDI_FISERV_LAYOUT_7_4_S', quantidade_registros };
  }

  if (nome.includes('EDI-P-00000004-110') || nome.includes('SICREDI') && nome.includes('EDI-P')) {
    return { origem_detectada: 'SICREDI', layout_detectado: 'SICREDI_FISERV_LAYOUT_7_4_P', quantidade_registros };
  }

  if (nome.includes('EDI-R-00000004-110') || nome.includes('SICREDI') && nome.includes('EDI-R')) {
    return { origem_detectada: 'SICREDI', layout_detectado: 'SICREDI_FISERV_LAYOUT_7_4_R', quantidade_registros };
  }

  if (conteudo.includes('"ACQUIRINGNAME"') && conteudo.includes('SICREDI') && conteudo.includes('"FILELAYOUTVERSION"') && conteudo.includes('7.4')) {
    if (conteudo.includes('MOVIMENTO DE VENDAS')) {
      return { origem_detectada: 'SICREDI', layout_detectado: 'SICREDI_FISERV_LAYOUT_7_4_S', quantidade_registros };
    }
    if (conteudo.includes('MOVIMENTO FINANCEIRO')) {
      return { origem_detectada: 'SICREDI', layout_detectado: 'SICREDI_FISERV_LAYOUT_7_4_P', quantidade_registros };
    }
    if (conteudo.includes('MOVIMENTO DE RECEB')) {
      return { origem_detectada: 'SICREDI', layout_detectado: 'SICREDI_FISERV_LAYOUT_7_4_R', quantidade_registros };
    }
    return { origem_detectada: 'SICREDI', layout_detectado: 'SICREDI_FISERV_LAYOUT_7_4', quantidade_registros };
  }

  if (nome.startsWith('CIELO03') || nome.includes('CIELO03') || conteudo.includes('CIELO03')) {
    return { origem_detectada: 'CIELO', layout_detectado: 'CIELO_LAYOUT_15_15_CIELO03', quantidade_registros };
  }

  if (nome.startsWith('CIELO04') || nome.includes('CIELO04') || conteudo.includes('CIELO04')) {
    return { origem_detectada: 'CIELO', layout_detectado: 'CIELO_LAYOUT_15_15_CIELO04', quantidade_registros };
  }

  if (nome.startsWith('CIELO16') || nome.includes('CIELO16') || conteudo.includes('CIELO16')) {
    return { origem_detectada: 'CIELO', layout_detectado: 'CIELO_LAYOUT_15_15_CIELO16', quantidade_registros };
  }

  if (nome.includes('CIELO') || conteudo.includes('CIELO') || conteudo.includes('ESTABELECIMENTO CIELO')) {
    return { origem_detectada: 'CIELO', layout_detectado: 'CIELO_LAYOUT_A_CLASSIFICAR', quantidade_registros };
  }

  if (nome.includes('SICREDI') || conteudo.includes('SICREDI') || conteudo.includes('COOPERATIVA SICREDI')) {
    return { origem_detectada: 'SICREDI', layout_detectado: 'SICREDI_LAYOUT_A_CLASSIFICAR', quantidade_registros };
  }

  // Relatório bancário PIX só deve ser classificado para arquivos textuais.
  // Não usar esse fallback para XLS/XLSX, porque vendas ERP podem ter forma de pagamento PIX.
  const extTextualPixBanco = ['.csv', '.txt', '.ret', '.rem', '.edi'].includes(ext);
  if (extTextualPixBanco && (conteudo.includes('CHAVE PIX') || conteudo.includes('TRANSF PIX') || conteudo.includes('TRANSFERENCIA PIX'))) {
    return { origem_detectada: 'PIX_BANCO', layout_detectado: 'PIX_BANCO_RELATORIO_INICIAL', quantidade_registros };
  }

  return { origem_detectada: 'DESCONHECIDO', layout_detectado: 'LAYOUT_NAO_IDENTIFICADO', quantidade_registros };
}
