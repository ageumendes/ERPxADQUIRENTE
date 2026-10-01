import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { RegistroAlelo, RegistroAleloPagamento, VendaAdquirente } from '../repositorio.js';

export type EmpresaAlelo = 'ALELO' | 'NAIP';
export type CodigoExtratoAlelo = '01' | '02' | '04' | '05' | '06';
export type TipoArquivoAlelo = `${EmpresaAlelo}${CodigoExtratoAlelo}`;

type Campo = [string, number, number];

const E_DIMENSAO = 500;
const TIPOS_EXTRATO = new Set<CodigoExtratoAlelo>(['01', '02', '04', '05', '06']);

const PRODUTOS: Record<string, string> = {
  '45': 'REFEICAO AUXILIO',
  '46': 'ALIMENTACAO AUXILIO',
  '47': 'REFEICAO PAT',
  '48': 'ALIMENTACAO PAT',
  '57': 'MULTIBENEFICIOS SALDO',
  '58': 'MULTIBENEFICIOS LIMITE',
  '59': 'VELOE GO',
  '60': 'NATAL',
  '61': 'CULTURA',
};

const TIPOS_MOVIMENTO: Record<string, string> = {
  '01': 'VENDA',
  '02': 'AJUSTE A CREDITO',
  '03': 'AJUSTE A DEBITO',
  '04': 'PAGAMENTO',
  '05': 'DEBIT BALANCE',
};

const STATUS_PAGAMENTO: Record<string, string> = {
  '01': 'AGENDADO_OU_AGUARDANDO_RETORNO_BANCO',
  '03': 'EFETIVADO',
  '04': 'REJEITADO',
  '05': 'DIVIDIDO',
};

const HEADER_00: Campo[] = [
  ['tipo_registro', 1, 2],
  ['identificador_agrupamento', 3, 17],
  ['data_processamento_arquivo', 18, 25],
  ['periodo_inicial', 26, 33],
  ['periodo_final', 34, 41],
  ['tipo_geracao_arquivo', 42, 42],
  ['sequencia_arquivo', 43, 49],
  ['empresa_adquirente', 50, 54],
  ['tipo_extrato', 55, 56],
  ['caixa_postal', 57, 106],
  ['versao_layout', 107, 111],
  ['cnpj_empresa_adquirente', 112, 125],
];

const MOVIMENTO_01: Campo[] = [
  ['tipo_registro', 1, 2],
  ['chave_exclusiva_pagamento', 3, 32],
  ['matriz_pagamento', 33, 47],
  ['ec_filial', 48, 62],
  ['raiz_cnpj', 63, 70],
  ['tipo_movimento', 71, 73],
  ['origem_ajuste', 74, 79],
  ['id_compensacao', 80, 94],
  ['data_processamento', 95, 102],
  ['data_prevista_processamento', 103, 110],
  ['data_transacao_venda', 111, 118],
  ['hora_captura_venda', 119, 124],
  ['data_prevista_pagamento', 125, 132],
  ['sinal_valor_bruto', 133, 133],
  ['valor_bruto', 134, 146],
  ['sinal_valor_liquido', 147, 147],
  ['valor_liquido', 148, 160],
  ['sinal_taxa_administrativa', 161, 161],
  ['valor_taxa_administrativa', 162, 174],
  ['percentual_taxa_administrativa', 175, 187],
  ['valor_tarifa_administrativa', 188, 200],
  ['codigo_produto', 201, 204],
  ['tipo_captura', 205, 206],
  ['meio_captura', 207, 208],
  ['bandeira', 209, 211],
  ['modo_entrada_cartao', 212, 214],
  ['cartao_truncado', 215, 233],
  ['numero_logico_terminal', 234, 241],
  ['codigo_autorizacao', 242, 249],
  ['nsu_doc', 250, 255],
  ['banco', 256, 259],
  ['agencia', 260, 264],
  ['conta', 265, 278],
  ['identificador_movimento', 279, 296],
  ['psr', 297, 299],
];

const PAGAMENTO_02: Campo[] = [
  ['tipo_registro', 1, 2],
  ['ec_pagamento', 3, 17],
  ['raiz_cnpj', 18, 25],
  ['matriz_pagamento', 26, 40],
  ['chave_exclusiva_pagamento', 41, 70],
  ['tipo_pagamento', 71, 71],
  ['status_pagamento', 72, 74],
  ['rejeicao_pagamento', 75, 79],
  ['reenvio_pagamento', 80, 80],
  ['data_pagamento_original', 81, 88],
  ['data_pagamento', 89, 96],
  ['data_envio_banco', 97, 104],
  ['sinal_valor_pagamento', 105, 105],
  ['valor_pagamento', 106, 123],
  ['numero_operacao_antecipacao', 124, 132],
  ['sinal_valor_liquido_arv', 133, 133],
  ['valor_liquido_arv', 134, 151],
  ['desconto_total_arv', 152, 169],
  ['banco', 170, 173],
  ['agencia', 174, 178],
  ['conta', 179, 192],
  ['tipo_operacao_arv', 193, 196],
  ['id_pagamento_arv', 197, 208],
  ['data_atualizacao_status_pagamento', 209, 216],
  ['identificador_pagamento_unificado', 217, 228],
];

const PAGAMENTO_03: Campo[] = [
  ['tipo_registro', 1, 2],
  ['chave_exclusiva_pagamento', 3, 32],
  ['identificador_ip', 33, 62],
  ['ec_pagamento', 63, 77],
  ['raiz_cnpj', 78, 85],
  ['tipo_pagamento', 86, 87],
  ['status_pagamento', 88, 90],
  ['rejeicao_pagamento', 91, 95],
  ['data_pagamento', 96, 103],
  ['sinal_valor_pagamento', 104, 104],
  ['valor_pagamento', 105, 122],
  ['unidade_recebivel', 123, 172],
  ['numero_contrato', 173, 222],
  ['banco', 223, 226],
  ['agencia', 227, 231],
  ['conta', 232, 245],
  ['identificador_pagamento_unificado', 246, 257],
];

const DEBIT_BALANCE_05: Campo[] = [
  ['tipo_registro', 1, 2],
  ['ec_filial', 48, 62],
  ['raiz_cnpj', 63, 70],
  ['tipo_movimento', 71, 73],
  ['data_processamento', 95, 102],
  ['data_inicio_saldo_negativo', 125, 132],
  ['sinal_saldo_negativo_atual', 133, 133],
  ['valor_saldo_negativo_atual', 134, 146],
  ['sinal_abatimento_saldo_negativo', 147, 147],
  ['valor_abatimento_saldo_negativo', 148, 160],
  ['sinal_saldo_negativo_anterior', 161, 161],
  ['valor_saldo_negativo_anterior', 162, 174],
  ['variacao_saldo_negativo', 175, 187],
  ['codigo_produto', 201, 204],
];

const TOTAL_PAGAMENTO_06: Campo[] = [
  ['tipo_registro', 1, 2],
  ['raiz_cnpj', 18, 25],
  ['tipo_pagamento', 71, 71],
  ['status_pagamento', 72, 74],
  ['rejeicao_pagamento', 75, 79],
  ['reenvio_pagamento', 80, 80],
  ['data_pagamento_original', 81, 88],
  ['data_pagamento', 89, 96],
  ['data_envio_banco', 97, 104],
  ['sinal_valor_pagamento', 105, 105],
  ['valor_pagamento', 106, 123],
  ['banco', 170, 173],
  ['agencia', 174, 178],
  ['conta', 179, 192],
  ['data_atualizacao_status_pagamento', 209, 216],
  ['identificador_pagamento_unificado', 217, 228],
];

const campo = (linha: string, inicio: number, fim: number) => linha.slice(inicio - 1, fim).trim();
const extrair = (linha: string, campos: Campo[]) => Object.fromEntries(campos.map(([nome, inicio, fim]) => [nome, campo(linha, inicio, fim)]));

function dataIsoOpcional(valor: string): string {
  if (!valor || /^0+$/.test(valor)) return '';
  if (!/^\d{8}$/.test(valor)) throw new Error(`Data ALELO inválida: ${valor || '(vazia)'}.`);
  const ano = Number(valor.slice(0, 4));
  const mes = Number(valor.slice(4, 6));
  const dia = Number(valor.slice(6, 8));
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) throw new Error(`Data ALELO inválida: ${valor}.`);
  return `${valor.slice(0, 4)}-${valor.slice(4, 6)}-${valor.slice(6, 8)}`;
}

function horaFormatada(valor: string): string {
  if (!valor || /^0+$/.test(valor)) return '';
  if (!/^\d{6}$/.test(valor)) return valor;
  return `${valor.slice(0, 2)}:${valor.slice(2, 4)}:${valor.slice(4, 6)}`;
}

function decimalImplicito(valor: string, escala = 6, sinal = ''): string {
  if (!valor || !/^\d+$/.test(valor)) return '';
  const negativo = sinal === '-';
  const limpo = valor.replace(/^0+(?=\d)/, '').padStart(escala + 1, '0');
  const inteiro = limpo.slice(0, -escala) || '0';
  const decimal = limpo.slice(-escala);
  return `${negativo ? '-' : ''}${inteiro}.${decimal}`;
}

function hash(tipoArquivo: TipoArquivoAlelo, linha: string) {
  return crypto.createHash('sha256').update(`${tipoArquivo}|${linha}`).digest('hex');
}

function tipoDoHeader(linha: string): TipoArquivoAlelo | null {
  const empresa = campo(linha, 50, 54).toUpperCase() as EmpresaAlelo;
  const extrato = campo(linha, 55, 56) as CodigoExtratoAlelo;
  if (!['ALELO', 'NAIP'].includes(empresa) || !TIPOS_EXTRATO.has(extrato)) return null;
  return `${empresa}${extrato}` as TipoArquivoAlelo;
}

function tipoDoNome(nomeOriginal: string): TipoArquivoAlelo | null {
  const m = nomeOriginal.toUpperCase().match(/_(ALELO|NAIP)_(01|02|04|05|06)_/);
  if (!m) return null;
  return `${m[1]}${m[2]}` as TipoArquivoAlelo;
}

export function detectarTipoArquivoAlelo(nomeOriginal: string, linhas: string[]): TipoArquivoAlelo | null {
  if (!linhas.length || linhas[0].length !== E_DIMENSAO || !linhas[0].startsWith('00')) return null;
  return tipoDoHeader(linhas[0]) || tipoDoNome(nomeOriginal);
}

function dadosRegistro(linha: string, codigo: string): Record<string, string> {
  if (codigo === '00') return extrair(linha, HEADER_00);
  if (codigo === '01') return extrair(linha, MOVIMENTO_01);
  if (codigo === '02') return extrair(linha, PAGAMENTO_02);
  if (codigo === '03') return extrair(linha, PAGAMENTO_03);
  if (codigo === '05') return extrair(linha, DEBIT_BALANCE_05);
  if (codigo === '06') return extrair(linha, TOTAL_PAGAMENTO_06);
  if (codigo === '99') return {
    tipo_registro: '99',
    total_registros: campo(linha, 3, 13),
    total_filiais: campo(linha, 14, 19),
  };
  return { tipo_registro: codigo };
}

function enriquecerDados(dados: Record<string, string>, header: Record<string, string>) {
  const saida: Record<string, string> = { ...dados };
  if (dados.codigo_produto) saida.produto_descricao = PRODUTOS[dados.codigo_produto] || '';
  if (dados.tipo_movimento) saida.tipo_movimento_descricao = TIPOS_MOVIMENTO[dados.tipo_movimento] || '';
  if (dados.status_pagamento) {
    const codigoStatus = String(Number(dados.status_pagamento)).padStart(2, '0');
    saida.status_pagamento_descricao = STATUS_PAGAMENTO[codigoStatus] || '';
  }
  saida.empresa_adquirente_arquivo = header.empresa_adquirente || '';
  saida.tipo_extrato_arquivo = header.tipo_extrato || '';
  saida.identificador_agrupamento = header.identificador_agrupamento || '';
  saida.versao_layout = header.versao_layout || '';
  saida.header_legado = header.header_legado || 'false';
  saida.empresa_adquirente_original_header = header.empresa_adquirente_original_header || '';
  saida.tipo_extrato_original_header = header.tipo_extrato_original_header || '';
  saida.empresa_origem_nome = header.empresa_origem_nome || '';
  saida.tipo_extrato_nome = header.tipo_extrato_nome || '';
  return saida;
}

function mapearVenda(
  importacaoId: string,
  tipoArquivo: TipoArquivoAlelo,
  numeroLinha: number,
  linha: string,
  dados: Record<string, string>,
  header: Record<string, string>,
  hashLinha: string,
): VendaAdquirente {
  // IMPORTANTE: campos canônicos abaixo recebem o valor original interpretado do EDI.
  // Nenhuma regra cadastrada em Conversões é aplicada durante a importação.
  const empresaOriginal = header.empresa_adquirente || tipoArquivo.slice(0, -2);
  const bruto = decimalImplicito(dados.valor_bruto, 6, dados.sinal_valor_bruto);
  const liquido = decimalImplicito(dados.valor_liquido, 6, dados.sinal_valor_liquido);
  const taxa = decimalImplicito(dados.valor_taxa_administrativa, 6, dados.sinal_taxa_administrativa);
  const percentual = decimalImplicito(dados.percentual_taxa_administrativa, 6);
  return {
    id: `${importacaoId}-alelo-venda-${numeroLinha}`,
    importacao_id: importacaoId,
    adquirente: 'ALELO',
    adquirente_original: empresaOriginal,
    layout_origem: 'alelo_edi_2_1_500',
    tipo_arquivo: tipoArquivo,
    codigo_registro: '01',
    numero_linha: numeroLinha,
    data_venda: dataIsoOpcional(dados.data_transacao_venda),
    hora_venda: horaFormatada(dados.hora_captura_venda),
    data_pagamento: dataIsoOpcional(dados.data_prevista_pagamento),
    valor_bruto: bruto,
    valor_liquido: liquido,
    valor_taxa: taxa,
    percentual_taxa: percentual,
    nsu: dados.nsu_doc,
    codigo_autorizacao: dados.codigo_autorizacao,
    terminal: dados.numero_logico_terminal,
    // EC da venda (posições 48–62): a raiz do CNPJ e o agrupador não distinguem filiais.
    // Preservar como texto, inclusive zeros à esquerda; SRG/NBO são definidos em Conversões.
    cnpj_estabelecimento: dados.ec_filial,
    bandeira: dados.bandeira,
    modalidade: dados.codigo_produto,
    status_transacao: dados.tipo_movimento,
    codigo_produto: dados.codigo_produto,
    hash_linha: hashLinha,
    linha_original: linha,
    dados_json: {
      ...enriquecerDados(dados, header),
      data_processamento_iso: dataIsoOpcional(dados.data_processamento),
      data_transacao_venda_iso: dataIsoOpcional(dados.data_transacao_venda),
      data_prevista_pagamento_iso: dataIsoOpcional(dados.data_prevista_pagamento),
      hora_captura_formatada: horaFormatada(dados.hora_captura_venda),
      valor_bruto_decimal: bruto,
      valor_liquido_decimal: liquido,
      valor_taxa_decimal: taxa,
      percentual_taxa_decimal: percentual,
    },
    data_criacao: new Date().toISOString(),
  };
}

function chavePagamentoSemantica(tipoArquivo: TipoArquivoAlelo, codigo: string, dados: Record<string, string>) {
  if (codigo === '02') return [tipoArquivo, codigo, dados.ec_pagamento, dados.chave_exclusiva_pagamento, dados.data_pagamento_original, dados.tipo_pagamento].join('|');
  if (codigo === '03') return [tipoArquivo, codigo, dados.chave_exclusiva_pagamento, dados.identificador_ip, dados.ec_pagamento, dados.data_pagamento].join('|');
  if (codigo === '06') return [tipoArquivo, codigo, dados.identificador_pagamento_unificado, dados.data_pagamento_original, dados.raiz_cnpj, dados.tipo_pagamento].join('|');
  return '';
}

function mapearPagamento(
  importacaoId: string,
  tipoArquivo: TipoArquivoAlelo,
  numeroLinha: number,
  linha: string,
  dados: Record<string, string>,
  header: Record<string, string>,
  hashLinha: string,
): RegistroAleloPagamento {
  const valor = decimalImplicito(dados.valor_pagamento, 6, dados.sinal_valor_pagamento);
  const chaveSemantica = chavePagamentoSemantica(tipoArquivo, dados.tipo_registro, dados);
  return {
    id: `${importacaoId}-alelo-pag-${numeroLinha}`,
    importacao_id: importacaoId,
    tipo_arquivo: tipoArquivo,
    codigo_registro: dados.tipo_registro,
    numero_linha: numeroLinha,
    empresa_adquirente: header.empresa_adquirente || '',
    ec_pagamento: dados.ec_pagamento || '',
    chave_exclusiva_pagamento: dados.chave_exclusiva_pagamento || '',
    identificador_pagamento_unificado: dados.identificador_pagamento_unificado || '',
    tipo_pagamento: dados.tipo_pagamento || '',
    status_pagamento: dados.status_pagamento || '',
    reenvio_pagamento: dados.reenvio_pagamento || '',
    data_pagamento_original: dataIsoOpcional(dados.data_pagamento_original),
    data_pagamento: dataIsoOpcional(dados.data_pagamento),
    data_atualizacao_status_pagamento: dataIsoOpcional(dados.data_atualizacao_status_pagamento),
    valor_pagamento: valor,
    chave_semantica: chaveSemantica,
    hash_linha: hashLinha,
    linha_original: linha,
    dados_json: {
      ...enriquecerDados(dados, header),
      valor_pagamento_decimal: valor,
      data_pagamento_original_iso: dataIsoOpcional(dados.data_pagamento_original),
      data_pagamento_iso: dataIsoOpcional(dados.data_pagamento),
      data_atualizacao_status_pagamento_iso: dataIsoOpcional(dados.data_atualizacao_status_pagamento),
      chave_semantica: chaveSemantica,
    },
    data_criacao: new Date().toISOString(),
  };
}

export async function parseAleloLayout(importacaoId: string, caminhoArquivo: string, nomeOriginal = '') {
  const buffer = await fs.readFile(caminhoArquivo);
  const utf8 = buffer.toString('utf8');
  const texto = utf8.includes('�') ? buffer.toString('latin1') : utf8;
  const linhas = texto.split(/\r?\n/).map((linha) => linha.replace(/\r$/, '')).filter(Boolean);
  if (linhas.length < 2) throw new Error('Arquivo ALELO inválido: header/trailer ausentes.');
  linhas.forEach((linha, index) => {
    if (linha.length !== E_DIMENSAO) throw new Error(`Arquivo ALELO inválido: linha ${index + 1} possui ${linha.length} posições; esperado ${E_DIMENSAO}.`);
  });
  if (!linhas[0].startsWith('00') || !linhas.at(-1)?.startsWith('99')) throw new Error('Arquivo ALELO inválido: registro 00 inicial ou 99 final ausente.');

  const tipoArquivo = detectarTipoArquivoAlelo(nomeOriginal, linhas);
  if (!tipoArquivo) throw new Error('Não foi possível identificar empresa/tipo de extrato ALELO/NAIP.');

  const headerExtraido = extrair(linhas[0], HEADER_00);
  const tipoNome = tipoDoNome(nomeOriginal);
  const empresaHeader = (headerExtraido.empresa_adquirente || '').trim().toUpperCase();
  const extratoHeader = (headerExtraido.tipo_extrato || '').trim() as CodigoExtratoAlelo;
  const empresaHeaderValida = empresaHeader === 'ALELO' || empresaHeader === 'NAIP';
  const extratoHeaderValido = TIPOS_EXTRATO.has(extratoHeader);

  // Alguns arquivos históricos/reprocessados (NSA=9999999) recebidos da própria Alelo
  // não preenchem as posições 50-54 com ALELO/NAIP, embora preservem corretamente
  // o tipo do extrato nas posições 55-56 e a nomenclatura oficial no nome do arquivo.
  // Nesses casos, usamos empresa/tipo do nome e mantemos a indicação de header legado.
  const headerLegado = !empresaHeaderValida && Boolean(tipoNome) && extratoHeaderValido;
  if (!headerLegado) {
    const tipoHeader = empresaHeaderValida && extratoHeaderValido
      ? `${empresaHeader}${extratoHeader}`
      : '';
    if (tipoHeader !== tipoArquivo) {
      throw new Error(`Arquivo ALELO inconsistente: nome/header indicam tipos diferentes (${tipoArquivo} x ${tipoHeader || 'NAO_IDENTIFICADO'}).`);
    }
  } else {
    const extratoNome = tipoNome!.slice(-2);
    if (extratoHeader !== extratoNome) {
      throw new Error(`Arquivo ALELO legado inconsistente: nome/header indicam tipos de extrato diferentes (${extratoNome} x ${extratoHeader}).`);
    }
  }

  const empresaNome = tipoArquivo.slice(0, -2) as EmpresaAlelo;
  const extratoNome = tipoArquivo.slice(-2) as CodigoExtratoAlelo;
  const header: Record<string, string> = {
    ...headerExtraido,
    empresa_adquirente_original_header: headerExtraido.empresa_adquirente || '',
    tipo_extrato_original_header: headerExtraido.tipo_extrato || '',
    empresa_adquirente: headerLegado ? empresaNome : empresaHeader,
    tipo_extrato: headerLegado ? extratoNome : extratoHeader,
    header_legado: headerLegado ? 'true' : 'false',
    empresa_origem_nome: empresaNome,
    tipo_extrato_nome: extratoNome,
  };

  const extrato = header.tipo_extrato as CodigoExtratoAlelo;
  const transacional = extrato === '01' || extrato === '04';
  const pagamento = extrato === '02' || extrato === '05' || extrato === '06';
  const registros_brutos: RegistroAlelo[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];
  const pagamentos_alelo: RegistroAleloPagamento[] = [];

  linhas.forEach((linha, index) => {
    const numeroLinha = index + 1;
    const codigo = linha.slice(0, 2);
    const dadosBase = dadosRegistro(linha, codigo);
    const hashLinha = hash(tipoArquivo, linha);

    if (transacional && codigo === '01' && dadosBase.tipo_movimento === '01') {
      if (!dadosBase.data_transacao_venda) throw new Error(`Venda ALELO sem data da transação na linha ${numeroLinha}.`);
      if (!dadosBase.valor_bruto) throw new Error(`Venda ALELO sem valor bruto na linha ${numeroLinha}.`);
      dataIsoOpcional(dadosBase.data_transacao_venda);
      vendas_adquirentes.push(mapearVenda(importacaoId, tipoArquivo, numeroLinha, linha, dadosBase, header, hashLinha));
    }

    if (pagamento && ['02', '03', '06'].includes(codigo)) {
      pagamentos_alelo.push(mapearPagamento(importacaoId, tipoArquivo, numeroLinha, linha, dadosBase, header, hashLinha));
    }

    // Tabela de layout guarda somente registros de negócio do EDI. Header 00,
    // trailer 99 e totalizador 06 continuam usados para validação, mas não são persistidos.
    if (['01', '02', '03', '05'].includes(codigo)) {
      registros_brutos.push({
        id: `${importacaoId}-alelo-raw-${numeroLinha}`,
        importacao_id: importacaoId,
        tipo_arquivo: tipoArquivo,
        codigo_registro: codigo,
        numero_linha: numeroLinha,
        linha_original: linha,
        hash_linha: hashLinha,
        dados_json: dadosBase,
        data_criacao: new Date().toISOString(),
      });
    }
  });

  const trailer = dadosRegistro(linhas.at(-1)!, '99');
  const totalInformado = Number(trailer.total_registros || 0);
  const totalReal = Math.max(linhas.length - 2, 0);
  if (Number.isFinite(totalInformado) && totalInformado !== totalReal) {
    throw new Error(`Arquivo ALELO inválido: trailer informa ${totalInformado} registro(s), mas foram encontrados ${totalReal}.`);
  }

  return { tipo_arquivo: tipoArquivo, registros_brutos, vendas_adquirentes, pagamentos_alelo };
}
