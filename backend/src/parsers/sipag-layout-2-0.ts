import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { RegistroSipagLayout20, VendaAdquirente } from '../repositorio.js';

export type ResultadoSipagLayout20 = {
  tipo_arquivo: 'S' | 'P' | 'R';
  registros_brutos: RegistroSipagLayout20[];
  vendas_adquirentes: VendaAdquirente[];
};

type CampoLayout = { chave: string; descricao: string };

const CAMPOS_SIPAG_S: Record<string, CampoLayout[]> = {
  '000': [
    { chave: 'tipo_registro', descricao: 'Tipo de Registro' },
    { chave: 'data_processamento', descricao: 'Data do Processamento' },
    { chave: 'nome_adquirente', descricao: 'Nome do Adquirente' },
    { chave: 'tipo_arquivo_descricao', descricao: 'Tipo do Arquivo' },
    { chave: 'numero_arquivo', descricao: 'Número do Arquivo' },
    { chave: 'codigo_cliente', descricao: 'Código do Cliente' },
    { chave: 'nome_cliente', descricao: 'Nome do Cliente' },
    { chave: 'cpf_cnpj_estabelecimento', descricao: 'Número do CPF/CNPJ' },
    { chave: 'tipo_processamento', descricao: 'Tipo de Processamento' },
    { chave: 'layout_arquivo', descricao: 'Layout do Arquivo' },
    { chave: 'numero_sequencia_registro', descricao: 'Número de Sequência do Registro' },
  ],
  '101': [
    { chave: 'tipo_registro', descricao: 'Tipo de Registro' },
    { chave: 'data_processamento', descricao: 'Data do Processamento' },
    { chave: 'codigo_cliente_matriz', descricao: 'Código do Cliente Matriz' },
    { chave: 'nome_cliente_matriz', descricao: 'Nome do Cliente Matriz' },
    { chave: 'cpf_cnpj_cliente', descricao: 'CPF/CNPJ do Cliente' },
    { chave: 'codigo_cliente_filial', descricao: 'Código do Cliente Filial' },
    { chave: 'nome_cliente_filial', descricao: 'Nome do Cliente Filial' },
    { chave: 'numero_sequencia_registro', descricao: 'Número de Sequência do Registro' },
  ],
  '001': [
    { chave: 'tipo_registro', descricao: 'Transações PIX' },
    { chave: 'instituicao', descricao: 'Instituição' },
    { chave: 'service_contract', descricao: 'Service Contract' },
    { chave: 'codigo_cliente', descricao: 'Código do Cliente' },
    { chave: 'codigo_terminal_pix', descricao: 'Código/Terminal PIX' },
    { chave: 'nsu', descricao: 'Identificador/NSU PIX' },
    { chave: 'status_transacao', descricao: 'Status da Transação' },
    { chave: 'data_venda', descricao: 'Data da Venda' },
    { chave: 'hora_venda', descricao: 'Hora da Venda' },
    { chave: 'data_confirmacao', descricao: 'Data da Confirmação' },
    { chave: 'hora_confirmacao', descricao: 'Hora da Confirmação' },
    { chave: 'valor_bruto', descricao: 'Valor Bruto' },
    { chave: 'end_to_end_id', descricao: 'EndToEndId/Identificador PIX' },
    { chave: 'numero_sequencia_registro', descricao: 'Número de Sequência do Registro' },
  ],
  '010': [
    { chave: 'tipo_registro', descricao: 'Resumo de Transações de Débito' },
    { chave: 'codigo_cliente_matriz', descricao: 'Código do Cliente Matriz' },
    { chave: 'codigo_cliente', descricao: 'Código do Cliente' },
    { chave: 'data_venda', descricao: 'Data da Venda' },
    { chave: 'numero_resumo_venda', descricao: 'Número do Resumo de Venda' },
    { chave: 'quantidade_comprovantes', descricao: 'Quantidade de Comprovantes' },
    { chave: 'bandeira', descricao: 'Bandeira do Cartão' },
    { chave: 'tipo_transacao', descricao: 'Tipo de Transação' },
    { chave: 'valor_bruto', descricao: 'Valor Bruto' },
    { chave: 'valor_desconto', descricao: 'Valor de Desconto' },
    { chave: 'valor_liquido', descricao: 'Valor Líquido' },
    { chave: 'data_credito', descricao: 'Data de Crédito' },
    { chave: 'reversao_intercambio', descricao: 'Reversão de Intercâmbio' },
    { chave: 'banco', descricao: 'Banco' },
    { chave: 'agencia', descricao: 'Agência' },
    { chave: 'tipo_conta', descricao: 'Tipo de Conta' },
    { chave: 'conta', descricao: 'Conta' },
    { chave: 'numero_sequencia_registro', descricao: 'Número de Sequência do Registro' },
  ],
  '011': [
    { chave: 'tipo_registro', descricao: 'Comprovante de Venda Débito' },
    { chave: 'codigo_cliente', descricao: 'Código do Cliente' },
    { chave: 'data_venda', descricao: 'Data da Venda' },
    { chave: 'numero_resumo_venda', descricao: 'Número do Resumo de Venda' },
    { chave: 'nsu', descricao: 'Número do Comprovante de Venda' },
    { chave: 'bandeira', descricao: 'Bandeira do Cartão' },
    { chave: 'tipo_transacao', descricao: 'Tipo de Transação' },
    { chave: 'numero_cartao', descricao: 'Número do Cartão Mascarado' },
    { chave: 'codigo_autorizacao', descricao: 'Código de Autorização' },
    { chave: 'hora_venda', descricao: 'Horário da Transação' },
    { chave: 'terminal', descricao: 'Número do Terminal' },
    { chave: 'tipo_captura', descricao: 'Tipo de Captura' },
    { chave: 'entry_mode', descricao: 'Entry Mode' },
    { chave: 'emissor_cartao', descricao: 'Emissor do Cartão' },
    { chave: 'tipo_cartao', descricao: 'Tipo de Cartão' },
    { chave: 'valor_bruto', descricao: 'Valor Bruto' },
    { chave: 'valor_desconto', descricao: 'Valor de Desconto' },
    { chave: 'valor_liquido', descricao: 'Valor Líquido' },
    { chave: 'data_credito', descricao: 'Data de Crédito' },
    { chave: 'nome_operadora_recarga', descricao: 'Nome da Operadora - Recarga' },
    { chave: 'codigo_cliente_recarga', descricao: 'Código do Cliente - Recarga' },
    { chave: 'terminal_recarga', descricao: 'Terminal - Recarga' },
    { chave: 'codigo_recarga', descricao: 'Código da Recarga' },
    { chave: 'reversao_intercambio', descricao: 'Reversão de Intercâmbio' },
    { chave: 'taxa_percentual', descricao: 'Taxa em Percentual' },
    { chave: 'acquirer_reference_number', descricao: 'Acquirer Reference Number' },
    { chave: 'numero_sequencia_registro', descricao: 'Número de Sequência do Registro' },
  ],
  '012': [
    { chave: 'tipo_registro', descricao: 'Resumo de Vendas Cartão de Crédito à Vista' },
    { chave: 'codigo_cliente_matriz', descricao: 'Código do Cliente Matriz' },
    { chave: 'codigo_cliente', descricao: 'Código do Cliente' },
    { chave: 'data_venda', descricao: 'Data da Venda' },
    { chave: 'numero_resumo_venda', descricao: 'Número do Resumo de Venda' },
    { chave: 'quantidade_comprovantes', descricao: 'Quantidade de Comprovantes' },
    { chave: 'bandeira', descricao: 'Bandeira do Cartão' },
    { chave: 'tipo_transacao', descricao: 'Tipo de Transação' },
    { chave: 'valor_bruto', descricao: 'Valor Bruto' },
    { chave: 'valor_desconto', descricao: 'Valor de Desconto' },
    { chave: 'valor_liquido', descricao: 'Valor Líquido' },
    { chave: 'data_credito', descricao: 'Data de Crédito' },
    { chave: 'banco', descricao: 'Banco' },
    { chave: 'agencia', descricao: 'Agência' },
    { chave: 'tipo_conta', descricao: 'Tipo de Conta' },
    { chave: 'conta', descricao: 'Conta' },
    { chave: 'numero_sequencia_registro', descricao: 'Número de Sequência do Registro' },
  ],
  '013': [
    { chave: 'tipo_registro', descricao: 'Comprovante de Venda Crédito à Vista' },
    { chave: 'codigo_cliente', descricao: 'Código do Cliente' },
    { chave: 'data_venda', descricao: 'Data da Venda' },
    { chave: 'numero_resumo_venda', descricao: 'Número do Resumo de Venda' },
    { chave: 'nsu', descricao: 'Número do Comprovante de Venda' },
    { chave: 'bandeira', descricao: 'Bandeira do Cartão' },
    { chave: 'tipo_transacao', descricao: 'Tipo de Transação' },
    { chave: 'numero_cartao', descricao: 'Número do Cartão Mascarado' },
    { chave: 'codigo_autorizacao', descricao: 'Código de Autorização' },
    { chave: 'hora_venda', descricao: 'Horário da Transação' },
    { chave: 'terminal', descricao: 'Número do Terminal' },
    { chave: 'tipo_captura', descricao: 'Tipo de Captura' },
    { chave: 'entry_mode', descricao: 'Entry Mode' },
    { chave: 'emissor_cartao', descricao: 'Emissor do Cartão' },
    { chave: 'tipo_cartao', descricao: 'Tipo de Cartão' },
    { chave: 'valor_bruto', descricao: 'Valor Bruto' },
    { chave: 'valor_desconto', descricao: 'Valor de Desconto' },
    { chave: 'valor_liquido', descricao: 'Valor Líquido' },
    { chave: 'data_credito', descricao: 'Data de Crédito' },
    { chave: 'nome_operadora_recarga', descricao: 'Nome da Operadora - Recarga' },
    { chave: 'codigo_cliente_recarga', descricao: 'Código do Cliente - Recarga' },
    { chave: 'terminal_recarga', descricao: 'Terminal - Recarga' },
    { chave: 'codigo_recarga', descricao: 'Código da Recarga' },
    { chave: 'taxa_percentual', descricao: 'Taxa em Percentual' },
    { chave: 'acquirer_reference_number', descricao: 'Acquirer Reference Number' },
    { chave: 'numero_sequencia_registro', descricao: 'Número de Sequência do Registro' },
  ],
  '014': [
    { chave: 'tipo_registro', descricao: 'Resumo de Vendas Crédito Parcelado' },
    { chave: 'codigo_cliente_matriz', descricao: 'Código do Cliente Matriz' },
    { chave: 'codigo_cliente', descricao: 'Código do Cliente' },
    { chave: 'data_venda', descricao: 'Data da Venda' },
    { chave: 'numero_resumo_venda', descricao: 'Número do Resumo de Venda' },
    { chave: 'quantidade_comprovantes', descricao: 'Quantidade de Comprovantes' },
    { chave: 'bandeira', descricao: 'Bandeira do Cartão' },
    { chave: 'emissor_cartao', descricao: 'Emissor do Cartão' },
    { chave: 'tipo_cartao', descricao: 'Tipo de Cartão' },
    { chave: 'tipo_transacao', descricao: 'Tipo de Transação' },
    { chave: 'numero_cartao', descricao: 'Número do Cartão Mascarado' },
    { chave: 'codigo_autorizacao', descricao: 'Código de Autorização' },
    { chave: 'hora_venda', descricao: 'Horário da Transação' },
    { chave: 'terminal', descricao: 'Número do Terminal' },
    { chave: 'tipo_captura', descricao: 'Tipo de Captura' },
    { chave: 'entry_mode', descricao: 'Entry Mode' },
    { chave: 'valor_bruto', descricao: 'Valor Bruto' },
    { chave: 'valor_desconto', descricao: 'Valor de Desconto' },
    { chave: 'valor_liquido', descricao: 'Valor Líquido' },
    { chave: 'data_credito', descricao: 'Data de Crédito da Primeira Parcela' },
    { chave: 'total_parcelas_resumo', descricao: 'Total de Parcelas do Resumo de Vendas' },
    { chave: 'banco', descricao: 'Banco' },
    { chave: 'agencia', descricao: 'Agência' },
    { chave: 'tipo_conta', descricao: 'Tipo de Conta' },
    { chave: 'conta', descricao: 'Conta' },
    { chave: 'taxa_percentual', descricao: 'Taxa em Percentual' },
    { chave: 'numero_sequencia_registro', descricao: 'Número de Sequência do Registro' },
  ],
  '015': [
    { chave: 'tipo_registro', descricao: 'Detalhe Parcelas de Vendas Crédito Parcelado' },
    { chave: 'codigo_cliente', descricao: 'Código do Cliente' },
    { chave: 'data_venda', descricao: 'Data da Venda' },
    { chave: 'numero_resumo_venda', descricao: 'Número do Resumo de Venda' },
    { chave: 'nsu', descricao: 'Número do Comprovante de Venda' },
    { chave: 'bandeira', descricao: 'Bandeira do Cartão' },
    { chave: 'tipo_transacao', descricao: 'Tipo de Transação' },
    { chave: 'valor_desconto', descricao: 'Valor de Desconto' },
    { chave: 'valor_liquido_parcela', descricao: 'Valor Líquido da Parcela' },
    { chave: 'valor_liquido_compra', descricao: 'Valor Líquido da Venda Total Parcelada' },
    { chave: 'data_credito', descricao: 'Data de Crédito' },
    { chave: 'numero_parcela', descricao: 'Número da Parcela' },
    { chave: 'numero_comprovante_parcela', descricao: 'Número do Comprovante da Parcela de Venda' },
    { chave: 'total_parcelas', descricao: 'Total de Parcelas do Comprovante de Vendas' },
    { chave: 'acquirer_reference_number', descricao: 'Acquirer Reference Number' },
    { chave: 'numero_sequencia_registro', descricao: 'Número de Sequência do Registro' },
  ],
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

function dadosPorPosicao(cells: string[], tipoArquivo: 'S' | 'P' | 'R', codigoRegistro: string) {
  const dados: Record<string, string> = {};
  cells.forEach((cell, index) => {
    dados[`COLUNA_${String(index + 1).padStart(2, '0')}`] = texto(cell);
  });

  if (tipoArquivo === 'S') {
    const layout = CAMPOS_SIPAG_S[codigoRegistro] || [];
    layout.forEach((campo, index) => {
      dados[campo.chave] = texto(cells[index]);
    });
    if (layout.length > 0) {
      dados.__layout_mapeado = `SIPAG_LAYOUT_2_0_S_REGISTRO_${codigoRegistro}`;
    }
  }

  return dados;
}

function hashLinha(importacaoId: string, tipoArquivo: string, numeroLinha: number, linhaOriginal: string) {
  return crypto.createHash('sha256').update(JSON.stringify({ importacaoId, tipoArquivo, numeroLinha, linhaOriginal })).digest('hex');
}

type DetalheParcela014 = { taxa: string; rrn: string; nsu: string; numeroParcela: string; totalParcelas: string; dataCredito: string; valorLiquidoParcela: string; valorLiquidoCompra: string };

function totalParcelasDoResumo(valor: string): string {
  const match = texto(valor).match(/^(\d+)\/(\d+)$/);
  return match ? match[2] : texto(valor);
}

function chaveParcelado014(cells: string[]): string {
  // Registro 014 pode repetir uma vez por parcela. A chave representa a venda, não a parcela.
  return [
    texto(cells[2]), // codigo_cliente
    texto(cells[3]), // data_venda
    texto(cells[4]), // numero_resumo_venda
    texto(cells[10]), // numero_cartao
    texto(cells[11]), // codigo_autorizacao
    texto(cells[12]), // hora
    texto(cells[13]), // terminal
    texto(cells[16]), // valor_bruto
  ].join('|');
}

function detectarTipoArquivo(nomeOriginal: string, linhas: string[]): 'S' | 'P' | 'R' {
  const nome = nomeOriginal.toUpperCase();
  if (nome.includes('SIPAG-EDI-S')) return 'S';
  if (nome.includes('SIPAG-EDI-P')) return 'P';
  if (nome.includes('SIPAG-EDI-R')) return 'R';

  const primeira = linhas[0] || '';
  if (primeira.includes('Movimento de vendas')) return 'S';
  if (primeira.includes('Movimento Financeiro')) return 'P';
  if (primeira.toLowerCase().includes('receb')) return 'R';
  return 'S';
}


const REGISTROS_SIPAG20_S_DE_VENDA_BRUTA = ['001', '011', '013', '014', '015', '017'];
const REGISTROS_ESTRUTURAIS_SIPAG20 = ['000', '101', '010', '012', '016', '018', '020', '022', '024', '030', '035', '200', '201', '999'];

function registroEntraNaTabelaBrutaSipag20(tipoArquivo: 'S' | 'P' | 'R', codigo: string): boolean {
  if (tipoArquivo === 'S') return REGISTROS_SIPAG20_S_DE_VENDA_BRUTA.includes(codigo);
  // Para P e R, preserva movimentos/detalhes e ignora headers, trailers e resumos.
  return !REGISTROS_ESTRUTURAIS_SIPAG20.includes(codigo);
}

function colunasPorPosicao60(cells: string[]) {
  const dados: Record<string, string> = {};
  for (let index = 0; index < 60; index += 1) {
    dados[`COLUNA_${String(index + 1).padStart(2, '0')}`] = texto(cells[index] ?? '');
  }
  return dados;
}

function registroEntraNaTabelaVendasAdquirentesS(codigo: string): boolean {
  // Entram na tabela canônica somente transações úteis para conciliação.
  // 010, 012 são totalizadores/resumos e 015 é agenda/detalhe de parcela: ficam apenas nas tabelas brutas sipag_layout_2_0_s_pix/cartoes.
  return ['001', '011', '013', '014'].includes(codigo);
}

function vendaCanonicaS(
  importacaoId: string,
  numeroLinha: number,
  linhaOriginal: string,
  cells: string[],
  dados_json: Record<string, string>,
  hash_linha: string,
  detalhesParcelasPorResumo: Map<string, DetalheParcela014[]>,
  parceladosJaIncluidos: Set<string>,
): VendaAdquirente | null {
  const codigo = texto(cells[0]);
  if (!registroEntraNaTabelaVendasAdquirentesS(codigo)) return null;
  const agora = new Date().toISOString();
  const layoutOrigem = codigo === '001' ? 'sipag_layout_2_0_s_pix' : 'sipag_layout_2_0_s_cartoes';
  const base = {
    id: `${importacaoId}-sipag-s-${numeroLinha}`,
    importacao_id: importacaoId,
    adquirente: 'SIPAG',
    layout_origem: layoutOrigem,
    tipo_arquivo: 'S',
    codigo_registro: codigo,
    numero_linha: numeroLinha,
    hash_linha,
    linha_original: linhaOriginal,
    codigo_estabelecimento: dados_json.codigo_cliente,
    dados_json: { ...dados_json, codigo_estabelecimento_original: dados_json.codigo_cliente },
    data_criacao: agora,
  };

  if (codigo === '001') {
    return {
      ...base,
      data_venda: texto(cells[7]),
      hora_venda: texto(cells[8]),
      valor_bruto: texto(cells[11]),
      nsu: texto(cells[12]),
      terminal: texto(cells[5]),
      dados_json: { ...base.dados_json, terminal_original: texto(cells[5]) },
      modalidade: 'PIX',
      status_transacao: texto(cells[6]),
      codigo_produto: texto(cells[12]),
    };
  }


  if (codigo === '011' || codigo === '013') {
    return {
      ...base,
      data_venda: texto(cells[2]),
      hora_venda: texto(cells[9]),
      data_pagamento: texto(cells[18]),
      valor_bruto: texto(cells[15]),
      valor_taxa: texto(cells[16]),
      valor_liquido: texto(cells[17]),
      nsu: texto(cells[4]),
      codigo_autorizacao: texto(cells[8]),
      terminal: texto(cells[10]),
      bandeira: texto(cells[5]),
      modalidade: codigo === '011' ? 'DEBITO' : 'CREDITO',
      parcelas: '1',
      status_transacao: codigo === '011' ? 'COMPROVANTE_DEBITO' : 'COMPROVANTE_CREDITO_A_VISTA',
      codigo_produto: texto(cells[14]),
    };
  }

  if (codigo === '014') {
    const chaveVenda = chaveParcelado014(cells);
    if (parceladosJaIncluidos.has(chaveVenda)) return null;
    parceladosJaIncluidos.add(chaveVenda);

    const detalhes = detalhesParcelasPorResumo.get(chaveVenda) || [];
    const detalhe = detalhes[0];
    const total = Number(totalParcelasDoResumo(texto(cells[20])) || detalhe?.totalParcelas || 1);
    const completo = detalhes.length === total && detalhes.every((d, i) => Number(d.numeroParcela) === i + 1);
    const centavos = (v: string) => Math.round(Number(v) * 100);
    const liquido = completo
      ? (detalhes.reduce((s, d) => s + centavos(d.valorLiquidoParcela), 0) / 100).toFixed(2)
      : detalhe?.valorLiquidoCompra || undefined;
    const taxa = completo
      ? (detalhes.reduce((s, d) => s + centavos(d.taxa), 0) / 100).toFixed(2)
      : liquido ? ((centavos(texto(cells[16])) - centavos(liquido)) / 100).toFixed(2) : undefined;
    const totalParcelas = totalParcelasDoResumo(texto(cells[20])) || detalhe?.totalParcelas || texto(cells[20]);

    return {
      ...base,
      data_venda: texto(cells[3]),
      hora_venda: texto(cells[12]),
      data_pagamento: detalhe?.dataCredito || texto(cells[19]),
      valor_bruto: texto(cells[16]),
      valor_taxa: taxa,
      valor_liquido: liquido,
      dados_json: { ...base.dados_json, acquirer_reference_number: detalhe?.rrn || '',
        parcelas_completas: completo ? 'SIM' : 'NAO', detalhes_parcelas: JSON.stringify(detalhes) },
      nsu: detalhe?.nsu || '',
      codigo_autorizacao: texto(cells[11]),
      terminal: texto(cells[13]),
      bandeira: texto(cells[6]),
      modalidade: 'CREDITO',
      parcelas: totalParcelas,
      status_transacao: 'COMPROVANTE_CREDITO_PARCELADO',
      codigo_produto: texto(cells[8]),
    };
  }

  return null;
}

export async function parseSipagLayout20(importacaoId: string, caminhoArquivo: string, nomeOriginal: string): Promise<ResultadoSipagLayout20> {
  const buffer = await fs.readFile(caminhoArquivo);
  const conteudo = buffer.toString('utf8').includes('�') ? buffer.toString('latin1') : buffer.toString('utf8');
  const linhas = conteudo.split(/\r?\n/).map((linha) => linha.replace(/\r$/, '')).filter((linha) => linha.trim().length > 0);
  const tipo_arquivo = detectarTipoArquivo(nomeOriginal, linhas);
  const registros_brutos: RegistroSipagLayout20[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];
  const detalhesParcelasPorResumo = new Map<string, DetalheParcela014[]>();
  const parceladosJaIncluidos = new Set<string>();

  if (tipo_arquivo === 'S') {
    let resumo: string[] | undefined;
    for (const linha of linhas) {
      const cells = splitCsvLinha(linha);
      if (cells[0] === '014') { resumo = cells; continue; }
      if (cells[0] !== '015') { resumo = undefined; continue; }
      if (!resumo || cells[1] !== resumo[2] || cells[2] !== resumo[3] || cells[3] !== resumo[4]) {
        throw new Error('SIPAG 2.0: parcela 015 sem venda 014 correspondente.');
      }
      const chave = chaveParcelado014(resumo);
      const detalhe: DetalheParcela014 = {
        nsu: texto(cells[4]), numeroParcela: texto(cells[11]), totalParcelas: texto(cells[13]),
        dataCredito: texto(cells[10]), valorLiquidoParcela: texto(cells[8]),
        valorLiquidoCompra: texto(cells[9]), taxa: texto(cells[7]), rrn: texto(cells[14]),
      };
      const detalhes = detalhesParcelasPorResumo.get(chave) || [];
      const repetida = detalhes.find(d => d.numeroParcela === detalhe.numeroParcela);
      if (repetida && JSON.stringify(repetida) !== JSON.stringify(detalhe)) {
        throw new Error('SIPAG 2.0: dados conflitantes para a mesma parcela.');
      }
      if (detalhes.some(d => d.rrn !== detalhe.rrn || d.totalParcelas !== detalhe.totalParcelas)) {
        throw new Error('SIPAG 2.0: parcelas com RRN ou total incompatível.');
      }
      if (!repetida) detalhes.push(detalhe);
      detalhes.sort((a, b) => Number(a.numeroParcela) - Number(b.numeroParcela));
      detalhesParcelasPorResumo.set(chave, detalhes);
    }
  }

  for (let index = 0; index < linhas.length; index += 1) {
    const linhaOriginal = linhas[index];
    const numeroLinha = index + 1;
    const cells = splitCsvLinha(linhaOriginal);
    const codigo_registro = texto(cells[0]);
    const dados_json = dadosPorPosicao(cells, tipo_arquivo, codigo_registro);
    const hash_linha = hashLinha(importacaoId, tipo_arquivo, numeroLinha, linhaOriginal);
    const data_criacao = new Date().toISOString();

    if (registroEntraNaTabelaBrutaSipag20(tipo_arquivo, codigo_registro)) {
      registros_brutos.push({
        id: `${importacaoId}-sipag-${tipo_arquivo.toLowerCase()}-raw-${numeroLinha}`,
        importacao_id: importacaoId,
        tipo_arquivo,
        codigo_registro,
        numero_linha: numeroLinha,
        linha_original: linhaOriginal,
        hash_linha,
        ...colunasPorPosicao60(cells),
        dados_json,
        data_criacao,
      });
    }

    // A tabela canônica vendas_adquirentes deve conter somente itens de venda.
    // Para SIPAG 2.0, os itens de venda vêm do arquivo S; arquivos P e R permanecem somente nas tabelas brutas.
    const venda = tipo_arquivo === 'S'
      ? vendaCanonicaS(importacaoId, numeroLinha, linhaOriginal, cells, dados_json, hash_linha, detalhesParcelasPorResumo, parceladosJaIncluidos)
      : null;

    if (venda) {
      venda.hash_linha = crypto.createHash('sha256').update(JSON.stringify({
        layout: venda.layout_origem, campos: cells.slice(0, -1),
      })).digest('hex');
      vendas_adquirentes.push(venda);
    }
  }

  return { tipo_arquivo, registros_brutos, vendas_adquirentes };
}
