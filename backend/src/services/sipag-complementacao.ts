import type { VendaAdquirente } from '../repositorio.js';

const texto = (v: unknown) => String(v ?? '').trim();
const dados = (v: VendaAdquirente): Record<string, any> => v.dados_json || {};
type Fontes = Record<string, VendaAdquirente>;

function fonte(v: VendaAdquirente) {
  const layout = texto(v.layout_origem);
  if (layout === 'sipag_extrato_transacoes_autorizadas') return 'TRANSACOES_AUTORIZADAS';
  if (layout === 'sipag_extrato_vendas_realizadas') return 'VENDAS_REALIZADAS';
  if (layout === 'sipag_extrato_vendas_pix') return 'PIX_EXTRATO';
  if (layout === 'sipag_layout_2_0_s_cartoes' || layout === 'sipag_layout_2_0_s_pix') return 'EDI_2_0';
  return '';
}

export function ehSipagComplementar(v: VendaAdquirente) {
  return texto(v.adquirente).toUpperCase() === 'SIPAG'
    && Boolean(fonte(v) || ['sipag_extrato_venda_complementada', 'sipag_venda_complementada'].includes(texto(v.layout_origem)));
}

function fontes(v: VendaAdquirente): Fontes {
  const d = dados(v);
  if (d.sipag_fontes_v197) return d.sipag_fontes_v197;
  const f = fonte(v);
  if (f) return { [f]: v };
  // Compatibilidade com a complementação entre extratos criada nas versões anteriores.
  if (v.layout_origem === 'sipag_extrato_venda_complementada') {
    const result: Fontes = {};
    if (d.sipag_financeiro && Object.keys(d.sipag_financeiro).length) {
      const edi = Boolean(d.sipag_financeiro.__layout_mapeado?.startsWith('SIPAG_LAYOUT_2_0'));
      result[edi ? 'EDI_2_0' : 'VENDAS_REALIZADAS'] = { ...v, dados_json: d.sipag_financeiro };
    }
    if (d.sipag_autorizacao && Object.keys(d.sipag_autorizacao).length) {
      result.TRANSACOES_AUTORIZADAS = { ...v, dados_json: d.sipag_autorizacao };
    }
    return result;
  }
  return {};
}

export function sipagData(v: VendaAdquirente) {
  const s = texto(v.data_venda);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const br = s.match(/^(\d{2})\/?(\d{2})\/?(\d{4})$/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : br ? `${br[3]}-${br[2]}-${br[1]}` : '';
}

function hora(v: VendaAdquirente) {
  const s = texto(v.hora_venda);
  const match = s.match(/^(\d{2}):?(\d{2})(?::?(\d{2}))?$/);
  if (!match || +match[1] > 23 || +match[2] > 59 || +(match[3] || 0) > 59) return '';
  return `${match[1]}:${match[2]}:${match[3] || '00'}`;
}

function estabelecimento(v: VendaAdquirente) {
  const d = dados(v);
  return texto(d.codigo_estabelecimento_original || d['Nº Estabelecimento']
    || d['Nº do estabelecimento'] || d.codigo_cliente || d.Estabelecimento
    || v.codigo_estabelecimento).replace(/\D/g, '');
}

function cartao(v: VendaAdquirente) {
  const d = dados(v);
  return texto(d.numero_cartao || d['Nº cartão'] || d['Número do cartão']).toUpperCase();
}

function situacao(v: VendaAdquirente) {
  const d = dados(v);
  const s = texto(d['Situação'] || d.sipag_autorizacao?.['Situação']
    || v.status_transacao_original || v.status_transacao).toUpperCase();
  if (/RECUS|NEGAD|REJEIT/.test(s)) return 'NEGADO';
  if (/CANCEL|ESTORN/.test(s)) return 'CANCELADO';
  if (/APROV|AUTORIZ|COMPROVANTE|PROCESSADA/.test(s)) return 'APROVADO';
  return s;
}

export function sipagChaveComplementar(v: VendaAdquirente) {
  if (!ehSipagComplementar(v)) return '';
  const est = estabelecimento(v), data = sipagData(v), h = hora(v);
  const bruto = texto(v.valor_bruto);
  const valor = Number(bruto.replace(',', '.'));
  if (!est || !data || !h || !bruto || !Number.isFinite(valor)) return '';
  if (texto(v.modalidade).toUpperCase() === 'PIX') {
    const d = dados(v);
    // v0.1.196 colocava o campo 5 no terminal, embora o terminal esteja no campo 6.
    // Os dados brutos permitem reconhecer também as linhas já importadas nessa versão.
    const ediPix = texto(d.__layout_mapeado).endsWith('_REGISTRO_001') || v.layout_origem === 'sipag_layout_2_0_s_pix';
    const terminal = texto(d.terminal_original || (ediPix ? d.nsu : '') || v.terminal);
    return terminal ? ['PIX', est, data, h, Math.round(valor * 100), terminal].join('|') : '';
  }
  const auth = texto(v.codigo_autorizacao).toUpperCase(), card = cartao(v);
  // Não aproxima horários e não transforma valores ausentes em zero.
  // Recusas/cancelamentos jamais enriquecem a face de uma venda aprovada.
  if (!auth || auth === '-' || !card) return '';
  return [est, auth, data, h, Math.round(valor * 100), card, situacao(v)].join('|');
}

function rrn(v?: VendaAdquirente) {
  if (!v) return '';
  const d = dados(v);
  return texto(d.acquirer_reference_number || d.rrn || d['ID Venda']).replace(/^RRN:\s*/i, '');
}

function validarFontes(a: Fontes, b: Fontes) {
  const vendas = [...Object.values(a), ...Object.values(b)];
  const rrns = new Set(vendas.map(rrn).filter(Boolean));
  if (rrns.size > 1) throw new Error('SIPAG: vínculo ambíguo; RRN diferentes para a mesma chave. Revise as vendas antes de reimportar.');
  for (const f of ['EDI_2_0', 'TRANSACOES_AUTORIZADAS', 'VENDAS_REALIZADAS', 'PIX_EXTRATO']) {
    if (!a[f] || !b[f]) continue;
    const getId = (v: VendaAdquirente) => f === 'PIX_EXTRATO' ? texto(dados(v)['Código da Transação'])
      : texto(dados(v).end_to_end_id || (f === 'TRANSACOES_AUTORIZADAS' ? dados(v)['Nº comprovante'] : ''));
    const x = getId(a[f]), y = getId(b[f]);
    if (x && y && x !== '-' && y !== '-' && x !== y) throw new Error('SIPAG: identificadores distintos para a mesma chave; complementação interrompida.');
  }
}

export function mergeSipagComplementar(existente: VendaAdquirente, novo: VendaAdquirente): VendaAdquirente {
  const antes = fontes(existente), recebidas = fontes(novo);
  validarFontes(antes, recebidas);
  const todas: Fontes = { ...antes, ...recebidas };
  // Uma cópia antiga do PIX ativo não desfaz uma liquidação já observada.
  for (const f of ['EDI_2_0', 'PIX_EXTRATO']) {
    if (antes[f]?.modalidade === 'PIX' && recebidas[f]) {
      const liquidado = (v: VendaAdquirente) => ['1', 'LIQUIDADA', 'AUTORIZADO'].includes(texto(v.status_transacao));
      if (liquidado(antes[f]) && !liquidado(recebidas[f])) todas[f] = antes[f];
    }
  }
  const financeiro = todas.EDI_2_0 || todas.VENDAS_REALIZADAS;
  const autorizacao = todas.TRANSACOES_AUTORIZADAS;
  const pix = todas.PIX_EXTRATO;
  const base = financeiro || autorizacao || pix || existente;
  const campo = (chave: keyof VendaAdquirente): any => {
    for (const v of [financeiro, todas.VENDAS_REALIZADAS, autorizacao, pix, existente]) {
      if (v && v[chave] !== undefined && v[chave] !== null && texto(v[chave]) !== '') return v[chave];
    }
    return undefined;
  };
  const nomes = Object.keys(todas).sort();
  const bruto = Number(campo('valor_bruto')), taxa = Number(campo('valor_taxa'));
  const percentual = Number.isFinite(bruto) && Number.isFinite(taxa) && bruto !== 0
    ? ((Math.abs(taxa) / Math.abs(bruto)) * 100).toFixed(4) : campo('percentual_taxa');
  const complementada = nomes.length > 1;
  const statusPix = Object.values(todas).some(v => v.modalidade === 'PIX'
    && ['1', 'LIQUIDADA', 'AUTORIZADO'].includes(texto(v.status_transacao))) ? 'AUTORIZADO' : base.status_transacao;
  // Somente snapshots de fontes, sem aninhar recursivamente a venda complementada.
  const snapshots = Object.fromEntries(Object.entries(todas).map(([f, v]) => {
    const { sipag_fontes_v197, sipag_autorizacao, sipag_financeiro, ...originais } = dados(v);
    return [f, { ...v, dados_json: originais }];
  }));
  return {
    ...existente, ...base,
    id: existente.id, importacao_id: existente.importacao_id, hash_linha: existente.hash_linha,
    data_criacao: existente.data_criacao,
    ultima_importacao_id: novo.importacao_id,
    layout_origem: complementada ? 'sipag_venda_complementada' : base.layout_origem,
    tipo_arquivo: complementada ? 'SIPAG_VENDA_COMPLEMENTADA' : base.tipo_arquivo,
    codigo_estabelecimento: existente.codigo_estabelecimento || base.codigo_estabelecimento,
    bandeira: financeiro?.bandeira || todas.VENDAS_REALIZADAS?.bandeira || autorizacao?.bandeira || base.bandeira,
    valor_bruto: campo('valor_bruto'), valor_taxa: campo('valor_taxa'),
    valor_liquido: campo('valor_liquido'), percentual_taxa: percentual,
    parcelas: campo('parcelas'), nsu: campo('nsu'), terminal: campo('terminal'),
    data_pagamento: campo('data_pagamento'), codigo_produto: campo('codigo_produto'),
    // EDI 013 também transporta voucher; a modalidade declarada na autorização é mais precisa.
    modalidade: autorizacao?.modalidade || base.modalidade,
    status_transacao: base.modalidade === 'PIX' ? statusPix : autorizacao?.status_transacao || base.status_transacao,
    status_transacao_original: autorizacao?.status_transacao_original || base.status_transacao_original,
    dados_json: {
      ...dados(existente), ...dados(base),
      codigo_estabelecimento_original: estabelecimento(base),
      ultima_importacao_id: novo.importacao_id,
      sipag_fontes_v197: snapshots,
      sipag_autorizacao: autorizacao?.dados_json || {},
      sipag_financeiro: financeiro?.dados_json || {},
      fontes_complementares: nomes.join('+'),
      vinculo_complementar_sipag: complementada ? 'SIM' : 'NAO',
    } as any,
  };
}

export type LinhaSipag = { row_id: string; dados: VendaAdquirente };

function quantidadeFontes(v: VendaAdquirente) {
  return Object.keys(fontes(v)).length;
}

function escolherPrincipal(candidatos: LinhaSipag[]) {
  return [...candidatos].sort((a, b) => {
    const fontesA = quantidadeFontes(a.dados), fontesB = quantidadeFontes(b.dados);
    if (fontesA !== fontesB) return fontesB - fontesA;
    return a.row_id.localeCompare(b.row_id);
  })[0];
}

function fonteJaRecebida(existente: VendaAdquirente, nova: VendaAdquirente) {
  const tipoFonte = fonte(nova);
  if (!tipoFonte || !nova.hash_linha) return false;
  const anterior = fontes(existente)[tipoFonte];
  return Boolean(anterior?.hash_linha && anterior.hash_linha === nova.hash_linha);
}

/** Planejamento puro, usado pela transação PostgreSQL e pelos testes de ordem/reimportação. */
export function planejarSipagComplementares(existentes: LinhaSipag[], vendas: VendaAdquirente[], chavesComConflito = new Set<string>()) {
  const indice = new Map<string, LinhaSipag[]>(), hashes = new Map<string, LinhaSipag>();
  const novos = new Map<string, VendaAdquirente>(), updates = new Map<string, VendaAdquirente>();
  const substituidos = new Map<string, string>();
  let duplicados = 0, conflitos = 0;
  const incluir = (item: LinhaSipag) => {
    const chave = sipagChaveComplementar(item.dados);
    if (chave) indice.set(chave, [...(indice.get(chave) || []), item]);
    if (item.dados.hash_linha) hashes.set(item.dados.hash_linha, item);
  };
  existentes.forEach(incluir);
  for (const venda of vendas) {
    const chave = sipagChaveComplementar(venda);
    // Conciliações distintas no mesmo grupo exigem revisão humana. O restante
    // do arquivo ainda pode ser importado, sem fundir nem alterar essas linhas.
    if (chave && chavesComConflito.has(chave)) { conflitos++; continue; }
    let candidatos = chave ? indice.get(chave) || [] : [];
    if (candidatos.length > 1) {
      // Versões antigas podiam persistir separadamente o EDI e o relatório de
      // autorizações. Consolida somente quando todas as fontes são compatíveis;
      // validarFontes continua bloqueando RRN/identificadores conflitantes.
      const principal = escolherPrincipal(candidatos);
      for (const redundante of candidatos.filter((item) => item.row_id !== principal.row_id)) {
        principal.dados = mergeSipagComplementar(principal.dados, redundante.dados);
        substituidos.set(redundante.row_id, principal.row_id);
      }
      updates.set(principal.row_id, principal.dados);
      candidatos = [principal];
      if (chave) indice.set(chave, candidatos);
    }
    const item = candidatos[0] || hashes.get(venda.hash_linha);
    if (!item) {
      const nova = mergeSipagComplementar(venda, venda);
      novos.set(nova.id, nova); incluir({ row_id: nova.id, dados: nova }); continue;
    }
    if (fonteJaRecebida(item.dados, venda)) {
      duplicados++;
      continue;
    }
    const merged = mergeSipagComplementar(item.dados, venda);
    item.dados = merged;
    if (novos.has(item.row_id)) novos.set(item.row_id, merged);
    else updates.set(item.row_id, merged);
    hashes.set(venda.hash_linha, item);
    duplicados++;
  }
  return { novos: [...novos.values()], updates, substituidos, duplicados, conflitos };
}
