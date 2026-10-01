import type { VendaAdquirente } from '../repositorio.js';

const texto = (valor: unknown) => String(valor ?? '').trim();
const normalizar = (valor: unknown) => texto(valor).toLocaleUpperCase('pt-BR');
const dados = (venda: VendaAdquirente): Record<string, any> => venda.dados_json || {};

function primeiro(...valores: unknown[]) {
  return valores.map(texto).find((valor) => valor && valor !== '-') || '';
}

export function ehVendaCoopcertoCabal(venda: VendaAdquirente) {
  return normalizar(venda.adquirente) === 'COOPCERTO'
    && ['COOPCERTO_CABAL_VENDAS_CSV', 'COOPCERTO_CABAL_ATUALIZADA'].includes(normalizar(venda.tipo_arquivo));
}

/**
 * Identidade fornecida pelo próprio portal COOPCERTO. O ID Venda/RRN existe
 * desde a pendência; Nº da transação/NSU pode nascer somente na autorização.
 * Por isso status, taxa, líquido, autorização e NSU não participam da chave.
 */
export function chaveSemanticaCoopcerto(venda: VendaAdquirente) {
  if (!ehVendaCoopcertoCabal(venda)) return '';
  const d = dados(venda);
  const estabelecimento = primeiro(
    d['Nº do estabelecimento'], d.numero_estabelecimento,
    d.estabelecimento_relatorio, venda.codigo_estabelecimento,
  );
  const idVenda = primeiro(d.id_venda_rrn, d['ID Venda'], d.id_venda);
  const parcela = primeiro(venda.parcelas,
    d.Parcela && d['Total de parcela'] ? `${d.Parcela}/${d['Total de parcela']}` : '',
  );
  if (!estabelecimento || !idVenda || !parcela) return '';
  return ['COOPCERTO', estabelecimento, idVenda, parcela].map(normalizar).join('|');
}

function prioridadeStatus(venda: VendaAdquirente) {
  const status = normalizar(venda.status_transacao || venda.status_transacao_original);
  if (/CANCEL|ESTORN/.test(status)) return 3;
  if (/AUTORIZ|PROCESSAD|APROVAD/.test(status)) return 2;
  if (/NEGAD|RECUS|REJEIT/.test(status)) return 2;
  if (/PENDENTE/.test(status)) return 0;
  return 1;
}

export function deveAtualizarCoopcerto(existente: VendaAdquirente, novo: VendaAdquirente) {
  if (texto(existente.hash_linha) && texto(existente.hash_linha) === texto(novo.hash_linha)) return false;
  const atual = prioridadeStatus(existente);
  const recebido = prioridadeStatus(novo);
  // Um relatório antigo dos últimos 30 dias jamais rebaixa uma venda concluída.
  if (recebido === 0 && atual > 0) return false;
  // Cancelamento/estorno é terminal e não volta a autorizado em reimportação.
  if (atual === 3 && recebido < 3) return false;
  return recebido >= atual;
}

const CAMPOS_CONCILIACAO = [
  'conciliacao_id', 'status_conciliacao', 'score_conciliacao', 'tipo_match',
  'confianca', 'criterios_usados', 'data_conciliacao',
] as const;

export function mergeAtualizacaoCoopcerto(existente: VendaAdquirente, novo: VendaAdquirente): VendaAdquirente {
  if (!deveAtualizarCoopcerto(existente, novo)) return existente;
  const chave = chaveSemanticaCoopcerto(novo) || chaveSemanticaCoopcerto(existente);
  const statusAnterior = texto(existente.status_transacao);
  const historicoAnterior = Array.isArray(dados(existente).historico_status_coopcerto)
    ? dados(existente).historico_status_coopcerto : [];
  const mudouStatus = statusAnterior && statusAnterior !== texto(novo.status_transacao);
  const historico = mudouStatus ? [...historicoAnterior, {
    status: statusAnterior,
    status_original: texto(existente.status_transacao_original),
    importacao_id: texto(existente.importacao_id),
    hash_linha: texto(existente.hash_linha),
    substituido_em: new Date().toISOString(),
  }] : historicoAnterior;
  const atualizado: VendaAdquirente = {
    ...existente,
    ...novo,
    id: existente.id,
    importacao_id: existente.importacao_id,
    data_criacao: existente.data_criacao,
    ultima_importacao_id: novo.importacao_id,
    layout_origem: 'coopcerto_cabal_atualizada',
    tipo_arquivo: 'COOPCERTO_CABAL_ATUALIZADA',
    chave_semantica_coopcerto: chave,
    dados_json: {
      ...dados(existente),
      ...dados(novo),
      chave_semantica_coopcerto: chave,
      ultima_importacao_id: novo.importacao_id,
      historico_status_coopcerto: historico,
    },
  } as VendaAdquirente;
  for (const campo of CAMPOS_CONCILIACAO) {
    const valor = (existente as any)[campo];
    if (valor !== undefined && valor !== null && texto(valor) !== '') (atualizado as any)[campo] = valor;
  }
  return atualizado;
}

export type LinhaCoopcerto = { row_id: string; dados: VendaAdquirente };

/** Planejamento puro para garantir ordem, idempotência e testes sem PostgreSQL. */
export function planejarAtualizacoesCoopcerto(existentes: LinhaCoopcerto[], vendas: VendaAdquirente[]) {
  const indice = new Map<string, LinhaCoopcerto[]>();
  const hashes = new Map<string, LinhaCoopcerto>();
  const novos = new Map<string, VendaAdquirente>();
  const updates = new Map<string, VendaAdquirente>();
  const substituidos = new Map<string, string>();
  let duplicados = 0;
  let conflitos = 0;

  const incluir = (item: LinhaCoopcerto) => {
    const chave = chaveSemanticaCoopcerto(item.dados);
    if (chave) indice.set(chave, [...(indice.get(chave) || []), item]);
    if (item.dados.hash_linha) hashes.set(item.dados.hash_linha, item);
  };
  existentes.forEach(incluir);

  for (const vendaOriginal of vendas) {
    const chave = chaveSemanticaCoopcerto(vendaOriginal);
    const venda = chave ? {
      ...vendaOriginal,
      chave_semantica_coopcerto: chave,
      dados_json: { ...dados(vendaOriginal), chave_semantica_coopcerto: chave },
    } as VendaAdquirente : vendaOriginal;
    const candidatos = chave ? (indice.get(chave) || []).filter((item) => !substituidos.has(item.row_id)) : [];
    const conciliacoes = new Set(candidatos.map((item) => texto((item.dados as any).conciliacao_id)).filter(Boolean));
    if (conciliacoes.size > 1) {
      conflitos += 1;
      duplicados += 1;
      continue;
    }
    const principal = candidatos.find((item) => texto((item.dados as any).conciliacao_id)) || candidatos[0] || hashes.get(venda.hash_linha);
    if (!principal) {
      novos.set(venda.id, venda);
      const item = { row_id: venda.id, dados: venda };
      incluir(item);
      continue;
    }

    const antesPrincipal = JSON.stringify(principal.dados);
    let consolidada = principal.dados;
    for (const candidato of candidatos) {
      if (candidato.row_id === principal.row_id) continue;
      consolidada = mergeAtualizacaoCoopcerto(consolidada, candidato.dados);
      substituidos.set(candidato.row_id, principal.row_id);
    }
    consolidada = mergeAtualizacaoCoopcerto(consolidada, venda);
    principal.dados = consolidada;
    if (novos.has(principal.row_id)) novos.set(principal.row_id, consolidada);
    else if (JSON.stringify(consolidada) !== antesPrincipal) {
      updates.set(principal.row_id, consolidada);
    }
    hashes.set(venda.hash_linha, principal);
    duplicados += 1;
  }
  return { novos: [...novos.values()], updates, substituidos, duplicados, conflitos };
}
