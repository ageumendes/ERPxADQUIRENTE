import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { RegistroCieloLayout1515Cielo03, RegistroCieloLayout1515Cielo04, RegistroCieloLayout1515Cielo16, VendaAdquirente } from '../repositorio.js';

export type ResultadoCieloLayout1515 = {
  tipo_arquivo: '03' | '04' | '16';
  registros_brutos: Array<RegistroCieloLayout1515Cielo03 | RegistroCieloLayout1515Cielo04 | RegistroCieloLayout1515Cielo16>;
  vendas_adquirentes: VendaAdquirente[];
};

type CampoFixo = { chave: string; ini: number; fim: number };

const CAMPOS_REGISTRO_E: CampoFixo[] = [
  { chave: 'codigo_registro', ini: 1, fim: 1 },
  { chave: 'estabelecimento_submissor', ini: 2, fim: 11 },
  { chave: 'bandeira_liquidacao', ini: 12, fim: 14 },
  { chave: 'tipo_liquidacao', ini: 15, fim: 17 },
  { chave: 'parcela', ini: 18, fim: 19 },
  { chave: 'total_parcelas', ini: 20, fim: 21 },
  { chave: 'codigo_autorizacao', ini: 22, fim: 27 },
  { chave: 'tipo_lancamento', ini: 28, fim: 29 },
  { chave: 'chave_ur', ini: 30, fim: 129 },
  { chave: 'codigo_transacao_recebida', ini: 130, fim: 151 },
  { chave: 'codigo_ajuste', ini: 152, fim: 155 },
  { chave: 'forma_pagamento', ini: 156, fim: 158 },
  { chave: 'indicativo_cielo_promo', ini: 159, fim: 159 },
  { chave: 'indicativo_dcc', ini: 160, fim: 160 },
  { chave: 'indicativo_comissao_minima', ini: 161, fim: 161 },
  { chave: 'indicativo_ra_tc', ini: 162, fim: 162 },
  { chave: 'indicativo_taxa_zero', ini: 163, fim: 163 },
  { chave: 'indicativo_transacao_rejeitada', ini: 164, fim: 164 },
  { chave: 'indicativo_venda_tardia', ini: 165, fim: 165 },
  { chave: 'bin_cartao', ini: 166, fim: 171 },
  { chave: 'final_cartao', ini: 172, fim: 175 },
  { chave: 'nsu_doc', ini: 176, fim: 181 },
  { chave: 'numero_nota_fiscal', ini: 182, fim: 191 },
  { chave: 'tid', ini: 192, fim: 211 },
  { chave: 'codigo_pedido_referencia', ini: 212, fim: 231 },
  { chave: 'taxa_mdr', ini: 232, fim: 236 },
  { chave: 'taxa_recebimento_automatico', ini: 237, fim: 241 },
  { chave: 'taxa_venda', ini: 242, fim: 246 },
  { chave: 'sinal_valor_total_venda', ini: 247, fim: 247 },
  { chave: 'valor_total_venda', ini: 248, fim: 260 },
  { chave: 'sinal_valor_bruto_venda_parcela', ini: 261, fim: 261 },
  { chave: 'valor_bruto_venda_parcela', ini: 262, fim: 274 },
  { chave: 'sinal_valor_liquido_venda', ini: 275, fim: 275 },
  { chave: 'valor_liquido_venda', ini: 276, fim: 288 },
  { chave: 'sinal_valor_comissao', ini: 289, fim: 289 },
  { chave: 'valor_comissao', ini: 290, fim: 302 },
  { chave: 'sinal_valor_comissao_minima', ini: 303, fim: 303 },
  { chave: 'valor_comissao_minima', ini: 304, fim: 316 },
  { chave: 'sinal_valor_entrada', ini: 317, fim: 317 },
  { chave: 'valor_entrada', ini: 318, fim: 330 },
  { chave: 'sinal_valor_tarifa_mdr', ini: 331, fim: 331 },
  { chave: 'valor_tarifa_mdr', ini: 332, fim: 344 },
  { chave: 'sinal_valor_receba_rapido', ini: 345, fim: 345 },
  { chave: 'valor_recebimento_automatico', ini: 346, fim: 358 },
  { chave: 'sinal_valor_saque', ini: 359, fim: 359 },
  { chave: 'valor_saque', ini: 360, fim: 372 },
  { chave: 'sinal_valor_tarifa_embarque', ini: 373, fim: 373 },
  { chave: 'valor_tarifa_embarque', ini: 374, fim: 386 },
  { chave: 'sinal_valor_pendente', ini: 387, fim: 387 },
  { chave: 'valor_pendente', ini: 388, fim: 400 },
  { chave: 'sinal_valor_total_divida', ini: 401, fim: 401 },
  { chave: 'valor_total_divida', ini: 402, fim: 414 },
  { chave: 'sinal_valor_cobrado', ini: 415, fim: 415 },
  { chave: 'valor_cobrado', ini: 416, fim: 428 },
  { chave: 'sinal_valor_tarifa_administrativa', ini: 429, fim: 429 },
  { chave: 'valor_tarifa_administrativa', ini: 430, fim: 442 },
  { chave: 'sinal_valor_cielo_promo', ini: 443, fim: 443 },
  { chave: 'valor_cielo_promo', ini: 444, fim: 456 },
  { chave: 'sinal_valor_dcc', ini: 457, fim: 457 },
  { chave: 'valor_dcc', ini: 458, fim: 470 },
  { chave: 'hora_transacao', ini: 471, fim: 476 },
  { chave: 'grupo_cartoes', ini: 477, fim: 478 },
  { chave: 'cpf_cnpj_recebedor', ini: 479, fim: 492 },
  { chave: 'bandeira_autorizacao', ini: 493, fim: 495 },
  { chave: 'codigo_unico_venda', ini: 496, fim: 510 },
  { chave: 'codigo_original_venda', ini: 511, fim: 525 },
  { chave: 'identificador_efeito_negociacao', ini: 526, fim: 540 },
  { chave: 'canal_venda', ini: 541, fim: 543 },
  { chave: 'numero_terminal', ini: 544, fim: 551 },
  { chave: 'tipo_lancamento_original', ini: 552, fim: 553 },
  { chave: 'tipo_transacao', ini: 554, fim: 556 },
  { chave: 'uso_cielo_557_560', ini: 557, fim: 560 },
  { chave: 'codigo_modelo_precificacao_taxa', ini: 561, fim: 565 },
  { chave: 'data_autorizacao_venda', ini: 566, fim: 573 },
  { chave: 'data_captura', ini: 574, fim: 581 },
  { chave: 'data_lancamento', ini: 582, fim: 589 },
  { chave: 'data_original_lancamento', ini: 590, fim: 597 },
  { chave: 'numero_lote', ini: 598, fim: 604 },
  { chave: 'numero_transacao_processada', ini: 605, fim: 626 },
  { chave: 'motivo_rejeicao', ini: 627, fim: 629 },
  { chave: 'data_vencimento_original', ini: 630, fim: 637 },
  { chave: 'matriz_pagamento', ini: 638, fim: 647 },
  { chave: 'tipo_cartao', ini: 648, fim: 649 },
  { chave: 'origem_cartao', ini: 650, fim: 650 },
  { chave: 'indicativo_mdr_tipo_cartao', ini: 651, fim: 651 },
  { chave: 'indicativo_parcelado_cliente', ini: 652, fim: 652 },
  { chave: 'banco', ini: 653, fim: 656 },
  { chave: 'agencia', ini: 657, fim: 661 },
  { chave: 'conta', ini: 662, fim: 681 },
  { chave: 'digito_conta', ini: 682, fim: 682 },
  { chave: 'arn', ini: 683, fim: 705 },
  { chave: 'indicativo_negociacao_recebiveis_cielo', ini: 706, fim: 706 },
  { chave: 'tipo_captura', ini: 707, fim: 708 },
  { chave: 'cpf_cnpj_negociador', ini: 709, fim: 722 },
  { chave: 'uso_cielo', ini: 723, fim: 760 },
];

// Mapeamento inicial do registro 8 do CIELO16 (PIX), baseado no arquivo real recebido.
// Mantém a linha original e o JSON para auditoria; campos podem ser refinados conforme o manual completo.
const CAMPOS_REGISTRO_8_PIX: CampoFixo[] = [
  { chave: 'codigo_registro', ini: 1, fim: 1 },
  { chave: 'estabelecimento_submissor', ini: 2, fim: 11 },
  { chave: 'tipo_lancamento', ini: 12, fim: 13 },
  { chave: 'data_venda', ini: 14, fim: 19 },
  { chave: 'hora_venda', ini: 20, fim: 25 },
  { chave: 'indicador_transacao', ini: 26, fim: 26 },
  { chave: 'codigo_autorizacao', ini: 27, fim: 34 },
  { chave: 'data_confirmacao', ini: 35, fim: 42 },
  { chave: 'hora_confirmacao', ini: 43, fim: 46 },
  { chave: 'identificador_pix', ini: 47, fim: 60 },
  { chave: 'nsu', ini: 62, fim: 67 },
  { chave: 'data_processamento', ini: 68, fim: 73 },
  { chave: 'sinal_valor_bruto', ini: 74, fim: 74 },
  { chave: 'valor_bruto', ini: 75, fim: 87 },
  { chave: 'sinal_valor_taxa', ini: 88, fim: 88 },
  { chave: 'valor_taxa', ini: 89, fim: 101 },
  { chave: 'sinal_valor_liquido', ini: 102, fim: 102 },
  { chave: 'valor_liquido', ini: 103, fim: 115 },
  { chave: 'codigo_banco', ini: 115, fim: 118 },
  { chave: 'agencia', ini: 119, fim: 123 },
  { chave: 'conta', ini: 124, fim: 143 },
  { chave: 'data_pagamento', ini: 145, fim: 150 },
  { chave: 'codigo_produto', ini: 151, fim: 157 },
  { chave: 'terminal', ini: 162, fim: 169 },
  { chave: 'data_terminal', ini: 170, fim: 175 },
  { chave: 'hora_terminal', ini: 176, fim: 181 },
  { chave: 'status_pix', ini: 222, fim: 222 },
  { chave: 'referencia_pix', ini: 223, fim: 239 },
  { chave: 'indicativo_rejeicao', ini: 240, fim: 240 },
  { chave: 'nome_adquirente', ini: 241, fim: 245 },
  { chave: 'data_cielo', ini: 246, fim: 253 },
  { chave: 'codigo_unico_pix', ini: 255, fim: 279 },
  { chave: 'end_to_end_id', ini: 316, fim: 350 },
];

function campo(linha: string, ini: number, fim: number) {
  return linha.slice(ini - 1, fim).trim();
}

function hashLinha(importacaoId: string, numeroLinha: number, linha: string) {
  return crypto.createHash('sha256').update(`${importacaoId}|${numeroLinha}|${linha}`).digest('hex');
}

function valorComSinal(sinal: string | undefined, valor: string | undefined) {
  const digits = String(valor || '').replace(/\D/g, '');
  if (!digits) return '';
  const numero = Number(digits) / 100;
  const final = sinal === '-' ? -numero : numero;
  return final.toFixed(2);
}

function valorAbsoluto(sinal: string | undefined, valor: string | undefined) {
  const v = valorComSinal(sinal, valor);
  if (!v) return '';
  return Math.abs(Number(v)).toFixed(2);
}

function horaHHMMSS(valor?: string) {
  const v = String(valor || '').replace(/\D/g, '').padStart(6, '0');
  if (v.length !== 6) return valor || '';
  return `${v.slice(0, 2)}:${v.slice(2, 4)}:${v.slice(4, 6)}`;
}

function dataYYMMDDparaDDMMAAAA(valor?: string) {
  const v = String(valor || '').replace(/\D/g, '');
  if (v.length !== 6) return valor || '';
  return `${v.slice(4, 6)}${v.slice(2, 4)}20${v.slice(0, 2)}`;
}

const TIPOS_LANCAMENTO_CIELO03_VENDAS = ['01', '02', '03', '42'];

function ehRegistroVendaCielo03(registro: RegistroCieloLayout1515Cielo03) {
  return TIPOS_LANCAMENTO_CIELO03_VENDAS.includes(String(registro.tipo_lancamento || ''));
}

function parseRegistroE(importacaoId: string, linha: string, numeroLinha: number): RegistroCieloLayout1515Cielo03 {
  const dados: Record<string, string> = {};
  for (const def of CAMPOS_REGISTRO_E) dados[def.chave] = campo(linha, def.ini, def.fim);
  const now = new Date().toISOString();
  return {
    id: `${importacaoId}-cielo03-e-${numeroLinha}`,
    importacao_id: importacaoId,
    tipo_arquivo: '03',
    codigo_registro: 'E',
    numero_linha: numeroLinha,
    linha_original: linha,
    hash_linha: hashLinha(importacaoId, numeroLinha, linha),
    ...dados,
    dados_json: dados,
    data_criacao: now,
  };
}

function parseRegistroCielo04(importacaoId: string, linha: string, numeroLinha: number): RegistroCieloLayout1515Cielo04 {
  const codigoRegistro = linha.slice(0, 1);
  const dados: Record<string, string> = {};

  // O registro E do CIELO04 compartilha a mesma estrutura posicional base do registro E do CIELO03.
  // Para o registro D, preservamos a linha original e quebramos em blocos fixos auxiliares para auditoria visual,
  // até refinarmos o mapeamento completo com amostras reais do arquivo de liquidação.
  if (codigoRegistro === 'E') {
    for (const def of CAMPOS_REGISTRO_E) dados[def.chave] = campo(linha, def.ini, def.fim);
  } else {
    dados.codigo_registro = codigoRegistro;
    for (let pos = 0; pos < linha.length; pos += 20) {
      const indice = String(Math.floor(pos / 20) + 1).padStart(2, '0');
      dados[`BLOCO_${indice}`] = linha.slice(pos, pos + 20).trim();
    }
  }

  const now = new Date().toISOString();
  return {
    id: `${importacaoId}-cielo04-${codigoRegistro.toLowerCase()}-${numeroLinha}`,
    importacao_id: importacaoId,
    tipo_arquivo: '04',
    codigo_registro: codigoRegistro,
    numero_linha: numeroLinha,
    linha_original: linha,
    hash_linha: hashLinha(importacaoId, numeroLinha, linha),
    ...dados,
    dados_json: dados,
    data_criacao: now,
  };
}

function parseRegistro8Pix(importacaoId: string, linha: string, numeroLinha: number): RegistroCieloLayout1515Cielo16 {
  const dados: Record<string, string> = {};
  for (const def of CAMPOS_REGISTRO_8_PIX) dados[def.chave] = campo(linha, def.ini, def.fim);
  const now = new Date().toISOString();
  return {
    id: `${importacaoId}-cielo16-pix-${numeroLinha}`,
    importacao_id: importacaoId,
    tipo_arquivo: '16',
    codigo_registro: '8',
    numero_linha: numeroLinha,
    linha_original: linha,
    hash_linha: hashLinha(importacaoId, numeroLinha, linha),
    ...dados,
    dados_json: dados,
    data_criacao: now,
  };
}

function vendaCanonicaCielo03(importacaoId: string, registro: RegistroCieloLayout1515Cielo03): VendaAdquirente | null {
  const tipoLancamento = String(registro.tipo_lancamento || '');
  if (!TIPOS_LANCAMENTO_CIELO03_VENDAS.includes(tipoLancamento)) return null;
  const parcela = String(registro.parcela || '').padStart(2, '0');
  const totalParcelas = String(registro.total_parcelas || '').padStart(2, '0');
  const parcelas = totalParcelas !== '00' ? `${parcela}/${totalParcelas}` : '1/1';
  const valorBruto = valorComSinal(String(registro.sinal_valor_bruto_venda_parcela || ''), String(registro.valor_bruto_venda_parcela || ''));
  const valorLiquido = valorComSinal(String(registro.sinal_valor_liquido_venda || ''), String(registro.valor_liquido_venda || ''));
  const valorTaxa = valorAbsoluto(String(registro.sinal_valor_comissao || ''), String(registro.valor_comissao || ''));
  return {
    id: `${importacaoId}-cielo03-venda-${registro.numero_linha}`,
    importacao_id: importacaoId,
    adquirente: 'CIELO',
    layout_origem: 'cielo_layout_15_15_cielo03',
    tipo_arquivo: '03',
    codigo_registro: 'E',
    numero_linha: Number(registro.numero_linha || 0),
    data_venda: String(registro.data_autorizacao_venda || ''),
    hora_venda: horaHHMMSS(String(registro.hora_transacao || '')),
    data_pagamento: String(registro.data_vencimento_original || ''),
    valor_bruto: valorBruto,
    valor_liquido: valorLiquido,
    valor_taxa: valorTaxa,
    nsu: String(registro.nsu_doc || ''),
    codigo_autorizacao: String(registro.codigo_autorizacao || ''),
    terminal: String(registro.numero_terminal || ''),
    bandeira: String(registro.bandeira_autorizacao || registro.bandeira_liquidacao || ''),
    modalidade: tipoLancamento,
    parcelas,
    status_transacao: String(registro.indicativo_transacao_rejeitada || ''),
    codigo_produto: String(registro.forma_pagamento || ''),
    hash_linha: String(registro.hash_linha || ''),
    linha_original: String(registro.linha_original || ''),
    dados_json: registro.dados_json as Record<string, string>,
    data_criacao: new Date().toISOString(),
  };
}

function vendaCanonicaCielo16(importacaoId: string, registro: RegistroCieloLayout1515Cielo16): VendaAdquirente {
  return {
    id: `${importacaoId}-cielo16-pix-venda-${registro.numero_linha}`,
    importacao_id: importacaoId,
    adquirente: 'CIELO',
    layout_origem: 'cielo_layout_15_15_cielo16',
    tipo_arquivo: '16',
    codigo_registro: '8',
    numero_linha: Number(registro.numero_linha || 0),
    data_venda: dataYYMMDDparaDDMMAAAA(String(registro.data_venda || '')),
    hora_venda: horaHHMMSS(String(registro.hora_venda || '')),
    data_pagamento: dataYYMMDDparaDDMMAAAA(String(registro.data_pagamento || registro.data_processamento || '')),
    valor_bruto: valorComSinal(String(registro.sinal_valor_bruto || ''), String(registro.valor_bruto || '')),
    valor_liquido: valorComSinal(String(registro.sinal_valor_liquido || ''), String(registro.valor_liquido || '')),
    valor_taxa: valorAbsoluto(String(registro.sinal_valor_taxa || ''), String(registro.valor_taxa || '')),
    nsu: String(registro.nsu || registro.referencia_pix || '').trim(),
    codigo_autorizacao: String(registro.codigo_autorizacao || ''),
    terminal: String(registro.terminal || ''),
    bandeira: 'PIX',
    modalidade: 'PIX',
    parcelas: '1/1',
    status_transacao: String(registro.status_pix || registro.indicativo_rejeicao || ''),
    codigo_produto: 'PIX_CIELO16',
    hash_linha: String(registro.hash_linha || ''),
    linha_original: String(registro.linha_original || ''),
    dados_json: registro.dados_json as Record<string, string>,
    data_criacao: new Date().toISOString(),
  };
}

async function parseCielo03(importacaoId: string, caminhoArquivo: string): Promise<ResultadoCieloLayout1515> {
  const conteudo = await fs.readFile(caminhoArquivo, 'latin1');
  const linhas = conteudo.split(/\r?\n/).filter((linha) => linha.trim().length > 0);
  const registros_brutos: RegistroCieloLayout1515Cielo03[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];
  linhas.forEach((linha, index) => {
    const numeroLinha = index + 1;
    if (!linha.startsWith('E')) return;
    const registro = parseRegistroE(importacaoId, linha, numeroLinha);
    // A tabela CIELO03 deve guardar somente registros de venda; descarta, por exemplo, tipo_lancamento=10.
    if (!ehRegistroVendaCielo03(registro)) return;
    registros_brutos.push(registro);
    const venda = vendaCanonicaCielo03(importacaoId, registro);
    if (venda) vendas_adquirentes.push(venda);
  });
  return { tipo_arquivo: '03', registros_brutos, vendas_adquirentes };
}

async function parseCielo16(importacaoId: string, caminhoArquivo: string): Promise<ResultadoCieloLayout1515> {
  const conteudo = await fs.readFile(caminhoArquivo, 'latin1');
  const linhas = conteudo.split(/\r?\n/).filter((linha) => linha.trim().length > 0);
  const registros_brutos: RegistroCieloLayout1515Cielo16[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];
  linhas.forEach((linha, index) => {
    const numeroLinha = index + 1;
    if (!linha.startsWith('8')) return;
    const registro = parseRegistro8Pix(importacaoId, linha, numeroLinha);
    registros_brutos.push(registro);
    vendas_adquirentes.push(vendaCanonicaCielo16(importacaoId, registro));
  });
  return { tipo_arquivo: '16', registros_brutos, vendas_adquirentes };
}


async function parseCielo04(importacaoId: string, caminhoArquivo: string): Promise<ResultadoCieloLayout1515> {
  const conteudo = await fs.readFile(caminhoArquivo, 'latin1');
  const linhas = conteudo.split(/\r?\n/).filter((linha) => linha.trim().length > 0);
  const registros_brutos: RegistroCieloLayout1515Cielo04[] = [];

  linhas.forEach((linha, index) => {
    const numeroLinha = index + 1;
    if (!linha.startsWith('D') && !linha.startsWith('E')) return;
    registros_brutos.push(parseRegistroCielo04(importacaoId, linha, numeroLinha));
  });

  // CIELO04 é liquidação/pagamento. Nesta fase ele fica só na tabela bruta,
  // para evitar duplicidade na tabela de vendas das adquirentes.
  return { tipo_arquivo: '04', registros_brutos, vendas_adquirentes: [] };
}

function detectarTipoCieloLayout1515(nomeOriginal: string, conteudo: string): '03' | '04' | '16' | null {
  const nome = nomeOriginal.toUpperCase();
  const amostra = conteudo.slice(0, 200000).toUpperCase();

  // Primeiro tenta pelo nome, quando ele ainda preserva o nome original recebido da adquirente.
  if (nome.includes('CIELO16')) return '16';
  if (nome.includes('CIELO04')) return '04';
  if (nome.includes('CIELO03')) return '03';

  // Depois tenta pelo conteúdo. Isso é essencial porque arquivos recuperados, duplicados
  // ou reprocessados podem estar com nomes técnicos/legados, mas o layout real continua
  // identificado no header interno do arquivo, como CIELO03I, CIELO04I ou CIELO16I.
  if (amostra.includes('CIELO16')) return '16';
  if (amostra.includes('CIELO04')) return '04';
  if (amostra.includes('CIELO03')) return '03';

  // Fallback estrutural: CIELO03/CIELO04 costumam ter registros E; CIELO16 usa registros 8.
  const linhas = conteudo.split(/\r?\n/).filter((linha) => linha.trim().length > 0).slice(0, 50);
  if (linhas.some((linha) => linha.startsWith('8'))) return '16';
  if (linhas.some((linha) => linha.startsWith('D'))) return '04';
  if (linhas.some((linha) => linha.startsWith('E'))) return '03';

  return null;
}

export async function parseCieloLayout1515(importacaoId: string, caminhoArquivo: string, nomeOriginal: string): Promise<ResultadoCieloLayout1515> {
  const conteudo = await fs.readFile(caminhoArquivo, 'latin1');
  const tipo = detectarTipoCieloLayout1515(nomeOriginal, conteudo);

  if (tipo === '16') return parseCielo16(importacaoId, caminhoArquivo);
  if (tipo === '04') return parseCielo04(importacaoId, caminhoArquivo);
  if (tipo === '03') return parseCielo03(importacaoId, caminhoArquivo);

  throw new Error('O parser cielo_layout_15_15 não reconheceu CIELO03, CIELO04 ou CIELO16 pelo nome nem pelo conteúdo do arquivo.');
}
