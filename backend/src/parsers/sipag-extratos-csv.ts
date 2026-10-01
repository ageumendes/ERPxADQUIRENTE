import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { VendaAdquirente } from '../repositorio.js';
import { identificarBandeiraCartao } from '../services/bandeira-cartao.js';

export type TipoExtratoSipag = 'TRANSACOES_AUTORIZADAS' | 'VENDAS_REALIZADAS' | 'VENDAS_PIX' | 'VENDAS_A_RECEBER' | 'VENDAS_RECEBIDAS';
type RegistroExtrato = Record<string, unknown> & { id: string; importacao_id: string; hash_linha: string };

export const MENSAGEM_EXTRATO_SIPAG_BLOQUEADO = 'Extrato SIPAG não importado: vendas realizadas, vendas a receber, vendas recebidas e vendas PIX já são importadas pelo EDI SIPAG. Importe somente o relatório de transações autorizadas; apenas as transações negadas geram vendas, e todas as linhas ficam no extrato bruto.';

export function validarLayoutExtratoSipagPermitido(layout: string) {
  const bloqueados = new Set([
    'SIPAG_EXTRATO_VENDAS_REALIZADAS',
    'SIPAG_EXTRATO_VENDAS_A_RECEBER',
    'SIPAG_EXTRATO_VENDAS_RECEBIDAS',
    'SIPAG_EXTRATO_VENDAS_PIX',
    'SIPAG_VENDAS_PIX_CSV',
  ]);
  if (bloqueados.has(layout)) throw new Error(MENSAGEM_EXTRATO_SIPAG_BLOQUEADO);
}

function csv(linha: string) {
  const campos: string[] = []; let atual = ''; let aspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i += 1; } else aspas = !aspas; }
    else if (c === ';' && !aspas) { campos.push(atual); atual = ''; }
    else atual += c;
  }
  campos.push(atual); return campos.map((item) => item.trim());
}

const normalizar = (valor: string) => valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const codigoEstabelecimento = (valor: string) => String(valor || '').replace(/\D/g, '');
const hash = (tipo: string, linha: string) => crypto.createHash('sha256').update(`SIPAG_EXTRATO|${tipo}|${linha}`).digest('hex');

function moeda(valor: string) {
  const texto = String(valor || '').trim();
  if (!texto || texto === '-') return 0;
  const numero = Number(texto.replace(/R\$/gi, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(numero)) throw new Error(`Valor monetário inválido no extrato SIPAG: ${valor}.`);
  return numero;
}

function dataHora(valor: string) {
  const texto = String(valor || '').trim();
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (iso) return { data: `${iso[1]}-${iso[2]}-${iso[3]}`, hora: `${iso[4]}:${iso[5]}:${iso[6] || '00'}` };
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (br) return { data: `${br[3]}-${br[2]}-${br[1]}`, hora: `${br[4]}:${br[5]}:${br[6] || '00'}` };
  throw new Error(`Data/hora inválida no extrato SIPAG: ${valor || '(vazia)'}.`);
}

function data(valor: string) {
  const match = String(valor || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

function detectarTipo(titulo: string): TipoExtratoSipag {
  const valor = normalizar(titulo);
  if (valor === 'RELATORIO DE AUTORIZACOES') return 'TRANSACOES_AUTORIZADAS';
  if (valor === 'RELATORIO DE VENDAS PIX') return 'VENDAS_PIX';
  if (valor === 'RELATORIO DE VENDAS RECEBIDAS') return 'VENDAS_RECEBIDAS';
  if (valor === 'RELATORIO DE VENDAS') return 'VENDAS_REALIZADAS';
  throw new Error(`Título de extrato SIPAG não reconhecido: ${titulo}.`);
}

function statusAutorizacao(valor: string) {
  const status = normalizar(valor);
  if (status.includes('APROVAD')) return 'AUTORIZADO';
  if (status.includes('RECUS') || status.includes('NEGAD') || status.includes('REJEIT')) return 'NEGADO';
  if (status.includes('CANCEL')) return 'CANCELADO';
  return status;
}

export async function parseSipagExtratoCsv(importacaoId: string, caminhoArquivo: string, nomeOriginal: string) {
  const buffer = await fs.readFile(caminhoArquivo);
  let conteudo = '';
  try { conteudo = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, ''); }
  catch { throw new Error('Extrato SIPAG inválido: conteúdo não está em UTF-8 válido.'); }
  const linhas = conteudo.split(/\r?\n/).map((linha) => linha.replace(/\r$/, '')).filter((linha) => linha.trim());
  if (linhas.length < 4 || !linhas[1].startsWith('Estabelecimento(s);')) throw new Error('Extrato SIPAG incompleto ou sem identificação dos estabelecimentos.');
  const tipo = detectarTipo(linhas[0]);
  const cabecalho = csv(linhas[2]);
  const registros_brutos: RegistroExtrato[] = [];
  const vendas_adquirentes: VendaAdquirente[] = [];

  for (let indice = 3; indice < linhas.length; indice += 1) {
    const linha = linhas[indice]; const valores = csv(linha);
    if (normalizar(valores[0] || '') === 'TOTAL') continue;
    if (valores.length !== cabecalho.length) throw new Error(`Linha ${indice + 1} do extrato SIPAG possui ${valores.length} campos; esperado ${cabecalho.length}.`);
    const original = Object.fromEntries(cabecalho.map((campo, i) => [campo, valores[i] || '']));
    const estabelecimentoOriginal = valores[0] || '';
    const estabelecimento = codigoEstabelecimento(estabelecimentoOriginal);
    if (!estabelecimento) throw new Error(`Linha ${indice + 1} do extrato SIPAG sem código de estabelecimento.`);
    const h = hash(tipo, linha);
    registros_brutos.push({
      id: `${importacaoId}-sipag-extrato-${tipo.toLowerCase()}-${indice + 1}`,
      importacao_id: importacaoId, tipo_arquivo: `SIPAG_EXTRATO_${tipo}`, codigo_registro: tipo,
      numero_linha: indice + 1, codigo_estabelecimento: estabelecimento,
      codigo_estabelecimento_original: estabelecimentoOriginal, linha_original: linha,
      hash_linha: h, dados_json: original, ...original, data_criacao: new Date().toISOString(),
    });

    if (tipo === 'TRANSACOES_AUTORIZADAS') {
      // Preserve todas as linhas originais no extrato bruto. Vendas aprovadas
      // pertencem ao EDI, que contém bandeira e informações financeiras.
      const status = statusAutorizacao(valores[2]);
      const identificacaoBandeira = identificarBandeiraCartao(valores[5]);
      Object.assign(registros_brutos.at(-1)!, {
        bandeira: identificacaoBandeira.bandeira,
        bin_cartao: identificacaoBandeira.bin,
        criterio_bandeira: identificacaoBandeira.criterio,
      });
      if (status !== 'NEGADO') continue;
      const dh = dataHora(valores[9]); const bruto = moeda(valores[10]);
      vendas_adquirentes.push({
        id: `${importacaoId}-sipag-extrato-autorizacao-${indice + 1}`, importacao_id: importacaoId,
        adquirente: 'SIPAG', layout_origem: 'sipag_extrato_transacoes_autorizadas',
        tipo_arquivo: 'SIPAG_EXTRATO_TRANSACOES_AUTORIZADAS', codigo_registro: normalizar(valores[6] || 'VENDA'), numero_linha: indice + 1,
        codigo_estabelecimento: estabelecimento, data_venda: dh.data, hora_venda: dh.hora, data_pagamento: '',
        valor_bruto: bruto.toFixed(2), valor_taxa: '0.00', percentual_taxa: '0.0000', valor_liquido: bruto.toFixed(2),
        nsu: valores[8] === '-' ? '' : valores[8], codigo_autorizacao: valores[1], terminal: valores[4],
        // O relatório de autorizações fornece número do cartão, não bandeira.
        // O BIN permanece no dado técnico e a coluna canônica só recebe a
        // bandeira textual quando o relatório Vendas realizadas complementar.
        bandeira: '', modalidade: normalizar(valores[7]), parcelas: '1/1', status_transacao: status,
        status_transacao_original: valores[2], codigo_produto: valores[6], hash_linha: h, linha_original: linha,
        dados_json: { ...original, codigo_estabelecimento_original: estabelecimentoOriginal, bin_cartao: identificacaoBandeira.bin, criterio_bandeira: identificacaoBandeira.criterio }, data_criacao: new Date().toISOString(),
      });
    }

    if (tipo === 'VENDAS_PIX') {
      const dh = dataHora(valores[1]); const bruto = moeda(valores[7]); const taxa = moeda(valores[6]);
      vendas_adquirentes.push({
        id: `${importacaoId}-sipag-extrato-pix-${indice + 1}`, importacao_id: importacaoId,
        adquirente: 'SIPAG', layout_origem: 'sipag_extrato_vendas_pix', tipo_arquivo: 'SIPAG_EXTRATO_VENDAS_PIX',
        codigo_registro: 'PIX', numero_linha: indice + 1, codigo_estabelecimento: estabelecimento,
        data_venda: dh.data, hora_venda: dh.hora, data_pagamento: '', valor_bruto: bruto.toFixed(2),
        valor_taxa: Math.abs(taxa).toFixed(2), percentual_taxa: bruto ? ((Math.abs(taxa) / Math.abs(bruto)) * 100).toFixed(4) : '0.0000',
        valor_liquido: (bruto - Math.abs(taxa)).toFixed(2), nsu: valores[3], codigo_autorizacao: '', terminal: valores[4],
        bandeira: 'PIX', modalidade: 'PIX', parcelas: '1/1', status_transacao: normalizar(valores[2]) === 'LIQUIDADA' ? 'AUTORIZADO' : valores[2],
        status_transacao_original: valores[2], codigo_produto: 'PIX', hash_linha: h, linha_original: linha,
        dados_json: { ...original, codigo_estabelecimento_original: estabelecimentoOriginal }, data_criacao: new Date().toISOString(),
      });
    }

    if (tipo === 'VENDAS_REALIZADAS' || tipo === 'VENDAS_RECEBIDAS') {
      const dh = dataHora(valores[1]);
      Object.assign(registros_brutos.at(-1)!, {
        data_venda: dh.data, hora_venda: dh.hora, data_pagamento: tipo === 'VENDAS_RECEBIDAS' ? data(valores[21]) : '',
        data_prevista_liquidacao: data(valores[17]), numero_transacao: valores[2], id_venda: valores[3],
        bandeira: valores[4], modalidade: valores[5], terminal: valores[12], codigo_autorizacao: valores[9], status: valores[20],
      });

      if (tipo === 'VENDAS_REALIZADAS') {
        const bruto = moeda(valores[24] || valores[21]);
        const totalParcelas = Math.max(1, Number(String(valores[8] || '1').replace(/\D/g, '')) || 1);
        const parcelaAtual = Math.max(1, Number(String(valores[7] || '1').replace(/\D/g, '')) || 1);
        // Uma venda parcelada aparece uma vez por parcela no CSV. Apenas a primeira linha cria a venda canônica;
        // as demais permanecem na tabela bruta e serão usadas pelo consolidado financeiro do repositório.
        if (parcelaAtual === 1 || totalParcelas === 1) {
          const taxaParcela = Math.abs(moeda(valores[22]));
          const taxaTotalInicial = taxaParcela * totalParcelas;
          const liquidoInicial = bruto - taxaTotalInicial;
          const rrn = String(valores[3] || '').replace(/^RRN:\s*/i, '').trim();
          const statusProcessamento = valores[20] || '';
          vendas_adquirentes.push({
            id: `${importacaoId}-sipag-extrato-venda-${indice + 1}`, importacao_id: importacaoId,
            adquirente: 'SIPAG', layout_origem: 'sipag_extrato_vendas_realizadas', tipo_arquivo: 'SIPAG_EXTRATO_VENDAS_REALIZADAS',
            codigo_registro: 'VENDA', numero_linha: indice + 1, codigo_estabelecimento: estabelecimento,
            data_venda: dh.data, hora_venda: dh.hora, data_pagamento: '', valor_bruto: bruto.toFixed(2),
            valor_taxa: taxaTotalInicial.toFixed(2), percentual_taxa: bruto ? ((taxaTotalInicial / Math.abs(bruto)) * 100).toFixed(4) : '0.0000',
            valor_liquido: liquidoInicial.toFixed(2), nsu: rrn || (valores[2] === '-' ? '' : valores[2]), codigo_autorizacao: valores[9], terminal: valores[12],
            bandeira: valores[4], modalidade: normalizar(valores[5]), parcelas: `${totalParcelas}x`,
            status_transacao: 'AUTORIZADO', status_transacao_original: 'APROVADA', codigo_produto: valores[10] || valores[5], hash_linha: h, linha_original: linha,
            dados_json: { ...original, codigo_estabelecimento_original: estabelecimentoOriginal, status_processamento: statusProcessamento, fonte_financeira: 'VENDAS_REALIZADAS' },
            data_criacao: new Date().toISOString(),
          });
        }
      }
    }
  }
  if (!registros_brutos.length) throw new Error('Extrato SIPAG não contém registros de negócio.');
  return { tipo, nome_original: nomeOriginal, registros_brutos, vendas_adquirentes, quantidade_registros: registros_brutos.length };
}
