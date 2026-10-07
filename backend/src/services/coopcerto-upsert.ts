import type { VendaAdquirente } from '../repositorio.js';
import { centavosVenda } from './identidade-venda.js';

const texto = (valor: unknown) => String(valor ?? '').trim();
const normalizar = (valor: unknown) => texto(valor).toLocaleUpperCase('pt-BR');
const dados = (venda: VendaAdquirente): Record<string, any> => venda.dados_json || {};

function primeiro(...valores: unknown[]) {
  return valores.map(texto).find((valor) => valor && valor !== '-') || '';
}

export function ehVendaCoopcertoCabal(venda: VendaAdquirente) {
  return normalizar(venda.adquirente) === 'COOPCERTO'
    && (['COOPCERTO_CABAL_VENDAS_CSV', 'COOPCERTO_CABAL_ATUALIZADA'].includes(normalizar(venda.tipo_arquivo))
      || ['COOPCERTO_CABAL_VENDAS_CSV','COOPCERTO_CABAL_ATUALIZADA'].includes(normalizar(venda.layout_origem)));
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

export function estadoCoopcerto(venda: VendaAdquirente) {
  const status = normalizar([venda.status_transacao, venda.status_transacao_original].filter(Boolean).join(' '))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_-]+/g, ' ');
  // Negativas devem ser reconhecidas antes de AUTORIZ (NÃO AUTORIZADO/UNAUTHORIZED).
  if (/CANCEL|ESTORN|REVERSED/.test(status)) return 'CANCELADO';
  if (/NAO\s+AUTORIZ|NOT\s+AUTHORIZ|UNAUTHORI[ZS]ED|NEGAD|RECUS|REJEIT|DENIED|DECLIN|REJECT/.test(status)) return 'NEGADO';
  if (/PENDENT/.test(status)) return 'PENDENTE';
  if (/AUTORIZ|AUTHORIZED|PROCESSAD|APROVAD|APPROVED/.test(status)) return 'AUTORIZADO';
  return 'DESCONHECIDO';
}

export function deveAtualizarCoopcerto(existente: VendaAdquirente, novo: VendaAdquirente) {
  if (texto(existente.hash_linha) && texto(existente.hash_linha) === texto(novo.hash_linha)) return false;
  const revisao = (existente as any).revisao_coopcerto as RevisaoCoopcerto | undefined;
  if (revisao && revisao.status !== 'PENDENTE' && revisao.hash_recebido === novo.hash_linha) return false;
  const atual = estadoCoopcerto(existente);
  const recebido = estadoCoopcerto(novo);
  // Um relatório antigo dos últimos 30 dias jamais rebaixa uma venda concluída.
  if (recebido === 'PENDENTE' && atual !== 'PENDENTE' && atual !== 'DESCONHECIDO') return false;
  // Cancelamento/estorno é terminal e não volta a autorizado em reimportação.
  if (atual === 'CANCELADO' && recebido !== 'CANCELADO') return false;
  if (recebido === 'DESCONHECIDO' && atual !== 'DESCONHECIDO') return false;
  return true;
}

export type RevisaoCoopcerto = {
  status: 'PENDENTE' | 'TRATADA_MANUALMENTE' | 'TRATADA_POR_REVERSAO'; motivos: string[]; detectada_em: string;
  importacao_id: string; hash_recebido: string;
  anterior: Record<string, unknown>; recebido: Record<string, unknown>;
};

function snapshot(venda: VendaAdquirente) {
  return Object.fromEntries(['status_transacao','status_transacao_original','valor_bruto','valor_taxa',
    'valor_liquido','percentual_taxa','nsu','codigo_autorizacao','data_venda','parcelas','importacao_id','hash_linha']
    .map(c => [c, (venda as any)[c] ?? '']));
}

export function sinalizarRevisaoCoopcerto(existente: VendaAdquirente, recebido: VendaAdquirente, motivos: string[], snapshotAnterior = snapshot(existente)): VendaAdquirente {
  const ultima = (existente as any).revisao_coopcerto as RevisaoCoopcerto | undefined;
  if (ultima?.hash_recebido === recebido.hash_linha) return existente;
  const anterior = ultima?.status === 'PENDENTE' ? ultima : undefined;
  const revisao: RevisaoCoopcerto = {
    status: 'PENDENTE', motivos: [...new Set([...(anterior?.motivos || []), ...motivos])],
    detectada_em: new Date().toISOString(), importacao_id: recebido.importacao_id,
    hash_recebido: recebido.hash_linha,
    anterior: anterior?.anterior || snapshotAnterior, recebido: snapshot(recebido),
  };
  return { ...existente, revisao_coopcerto: revisao } as VendaAdquirente;
}

const CAMPOS_CONCILIACAO = [
  'conciliacao_id', 'status_conciliacao', 'score_conciliacao', 'tipo_match',
  'confianca', 'criterios_usados', 'data_conciliacao',
] as const;

export function mergeAtualizacaoCoopcerto(existente: VendaAdquirente, novo: VendaAdquirente, referenciado = false): VendaAdquirente {
  if (!deveAtualizarCoopcerto(existente, novo)) return existente;
  const estadoAnterior = estadoCoopcerto(existente), estadoNovo = estadoCoopcerto(novo);
  // Sem data do evento fornecida pelo relatório não se presume que NEGADO → AUTORIZADO
  // seja evolução, nem que AUTORIZADO → NEGADO seja um relatório mais recente.
  const contradicao = (estadoAnterior === 'AUTORIZADO' && estadoNovo === 'NEGADO')
    || (estadoAnterior === 'NEGADO' && estadoNovo === 'AUTORIZADO');
  const protegido = Boolean(referenciado || existente.conciliacao_id || existente.vinculo_voucher_id
    || normalizar(existente.status_conciliacao) === 'CONCILIADO');
  const motivos: string[] = [];
  if (contradicao) motivos.push('STATUS_CONTRADITORIO');
  if (protegido && estadoAnterior !== estadoNovo) motivos.push('STATUS_ALTERADO_APOS_VINCULO');
  if (protegido && ['valor_bruto','valor_taxa','valor_liquido'].some(c =>
    centavosVenda((existente as any)[c]) !== centavosVenda((novo as any)[c]))) motivos.push('VALORES_ALTERADOS_APOS_VINCULO');
  if (protegido && ['nsu','codigo_autorizacao'].some(c => texto((existente as any)[c]) !== texto((novo as any)[c])))
    motivos.push('IDENTIFICADOR_ALTERADO_APOS_VINCULO');
  if (contradicao) return sinalizarRevisaoCoopcerto(existente, novo, motivos);
  const chave = chaveSemanticaCoopcerto(novo) || chaveSemanticaCoopcerto(existente);
  const statusAnterior = texto(existente.status_transacao);
  const historicoAnterior = Array.isArray(dados(existente).historico_status_coopcerto)
    ? dados(existente).historico_status_coopcerto : [];
  const mudouStatus = statusAnterior && (statusAnterior !== texto(novo.status_transacao) || ['valor_taxa','valor_liquido','nsu','codigo_autorizacao'].some(k=>texto((existente as any)[k])!==texto((novo as any)[k])));
  const historico = mudouStatus ? [...historicoAnterior, {
    status: statusAnterior,
    status_original: texto(existente.status_transacao_original),
    nsu: existente.nsu, codigo_autorizacao: existente.codigo_autorizacao,
    valor_bruto: existente.valor_bruto, valor_taxa: existente.valor_taxa, valor_liquido: existente.valor_liquido,
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
  return motivos.length ? sinalizarRevisaoCoopcerto(atualizado, novo, motivos, snapshot(existente)) : atualizado;
}

export type LinhaCoopcerto = { row_id: string; dados: VendaAdquirente; referenciado?: boolean };

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
    // Não elimina outro registro que possua sugestão, conciliação ou vínculo.
    const protegidos=candidatos.filter(item=>item.referenciado||texto(item.dados.conciliacao_id)||item.dados.vinculo_voucher_id);
    const data=(v:VendaAdquirente)=>{const t=texto(v.data_venda);const br=t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);return br?`${br[3]}-${br[2]}-${br[1]}`:t.slice(0,10);};
    const bruto=(v:VendaAdquirente)=>{let t=texto(v.valor_bruto).replace(/^R\$\s*/,'');if(t.includes(','))t=t.replace(/\./g,'').replace(',','.');return Number(t);};
    const divergente=candidatos.some(item=>data(item.dados)!==data(venda)||!Number.isFinite(bruto(item.dados))||!Number.isFinite(bruto(venda))||Math.abs(bruto(item.dados)-bruto(venda))>0.00001);
    if (conciliacoes.size > 1 || protegidos.length>1 || divergente) {
      if (divergente) for (const item of protegidos) {
        const revisada = sinalizarRevisaoCoopcerto(item.dados, venda, ['IDENTIDADE_OU_BRUTO_DIVERGENTE']);
        if (revisada !== item.dados) {
          item.dados = revisada;
          updates.set(item.row_id, revisada);
        }
      }
      conflitos += 1;
      duplicados += 1;
      continue;
    }
    const principal = protegidos[0] || candidatos[0] || hashes.get(venda.hash_linha);
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
      consolidada = mergeAtualizacaoCoopcerto(consolidada, candidato.dados, principal.referenciado);
      substituidos.set(candidato.row_id, principal.row_id);
    }
    consolidada = mergeAtualizacaoCoopcerto(consolidada, venda, principal.referenciado);
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
