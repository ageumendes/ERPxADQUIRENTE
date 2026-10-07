export type ModalidadeCanonica = 'PIX' | 'DEBITO' | 'CREDITO' | 'VOUCHER' | '';

export const AJUSTE_HORARIO_MINUTOS: Record<string, number> = {
  SIPAG: -60,
  CONVCARD: -60,
  CIELO: -60,
  SICREDI: -60,
  VR: -60,
  PLUXEE: -60,
  SICOOB: -240,
};

export function normalizarTexto(valor: unknown) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

export function normalizarAdquirente(valor: unknown) {
  const texto = normalizarTexto(valor);
  if (texto.includes('CONVCARD')) return 'CONVCARD';
  if (texto.includes('SICOOB')) return 'SICOOB';
  if (texto.includes('SICREDI')) return 'SICREDI';
  if (texto.includes('SIPAG')) return 'SIPAG';
  if (texto.includes('CIELO')) return 'CIELO';
  if (texto === 'VR' || texto.includes('VR BENEF')) return 'VR';
  if (texto.includes('PLUXEE')) return 'PLUXEE';
  if (texto.includes('ALELO')) return 'ALELO';
  if (texto.includes('TICKET')) return 'TICKET';
  if (texto.includes('CABAL')) return 'CABAL';
  if (texto.includes('FACER')) return 'FACER';
  return texto;
}

export function normalizarModalidade(valor: unknown): ModalidadeCanonica {
  const texto = normalizarTexto(valor);
  // CARTEIRA DIGITAL é a modalidade de apresentação adotada para transações PIX.
  if (texto.includes('CARTEIRA DIGITAL')) return 'PIX';
  if (texto.includes('PIX')) return 'PIX';
  if (texto.includes('DEBIT')) return 'DEBITO';
  if (texto.includes('CREDIT')) return 'CREDITO';
  if (/(VOUCHER|ALIMENT|REFEIC|BENEF|VALE)/.test(texto)) return 'VOUCHER';
  return '';
}

export function modalidadesCompativeis(erp: unknown, adquirente: unknown, nomeAdquirente?: unknown) {
  const a = normalizarModalidade(adquirente);
  const e = normalizarModalidade(erp);
  const nome = normalizarAdquirente(nomeAdquirente);
  if (nome === 'VR' && e === 'VOUCHER') return true;
  return Boolean(a && e && a === e);
}

export function normalizarNsu(valor: unknown) {
  const limpo = String(valor || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!limpo) return '';
  return /^\d+$/.test(limpo) ? limpo.replace(/^0+(?=\d)/, '') : limpo;
}

export function valorEmCentavos(valor: unknown) {
  if (typeof valor === 'number') return Math.round(valor * 100);
  let texto = String(valor || '').trim().replace(/R\$/gi, '').replace(/\s/g, '');
  if (texto.includes(',') && texto.includes('.')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (texto.includes(',')) texto = texto.replace(',', '.');
  const numero = Number(texto);
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
}

function dataIso(valor: unknown) {
  const texto = String(valor || '').trim();
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : '';
}

function diferencaDias(a: unknown, b: unknown) { const da=Date.parse(`${dataIso(a)}T00:00:00Z`),db=Date.parse(`${dataIso(b)}T00:00:00Z`);return Number.isFinite(da)&&Number.isFinite(db)?Math.abs(Math.round((da-db)/86400000)):999; }
export function normalizarParcelas(valor: unknown) { const texto=String(valor??'').trim();if(!texto)return null;const partes=texto.match(/(?:\d+\s*\/\s*)?(\d+)$/);const numero=partes?Number(partes[1]):Number(texto.replace(',','.'));return Number.isInteger(numero)&&numero>0?numero:null; }

function minutosDoDia(valor: unknown) {
  const match = String(valor || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]) + Number(match[3] || 0) / 60;
}

function instanteVendaMinutos(data: unknown, hora: unknown) {
  const iso = dataIso(data);
  const minutos = minutosDoDia(hora || data);
  if (!iso || minutos === null) return null;
  const base = Date.parse(`${iso}T00:00:00.000Z`);
  return Number.isFinite(base) ? base / 60000 + minutos : null;
}

export function formatarDiferencaHorario(segundosTotais: number) {
  const segundos = Math.max(0, Math.round(segundosTotais));
  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const restante = segundos % 60;
  if (horas > 0) return `${horas}h${String(minutos).padStart(2, '0')}min${String(restante).padStart(2, '0')}s`;
  if (minutos > 0) return `${minutos}min${String(restante).padStart(2, '0')}s`;
  return `${restante}s`;
}

export type VendaCandidata = Record<string, unknown> & { id: string };
export type AvaliacaoHibrida = {
  estrategia: 'NSU_VALOR_DATA' | 'VALOR_DATA_MODALIDADE_HORARIO' | 'HORARIO_FORTE_DADOS_DIVERGENTES' | 'VOUCHER_DATA_VALOR_PARCELAS' | 'RECUPERACAO_NSU_NORMALIZADO' | 'RECUPERACAO_CONTEXTO_HORA';
  classificacao: 'MATCH_EXATO_NSU' | 'MATCH_EXATO_HORARIO' | 'MATCH_HORARIO_FORTE_DIVERGENTE' | 'VOUCHER_HORARIO_FORTE' | 'VOUCHER_UNICO_DATA_VALOR_PARCELAS' | 'CANDIDATO_UNICO_JANELA_8H' | 'RECUPERACAO_NSU_NORMALIZADO' | 'RECUPERACAO_CONTEXTO_HORA';
  score: number;
  diferenca_segundos: number;
  ajuste_horario_minutos: number;
  criterios: string[];
};

const ADQUIRENTES_VOUCHER = new Set(['CONVCARD', 'PLUXEE', 'ALELO', 'VR', 'TICKET', 'CABAL', 'FACER']);

function ehAdquirenteVoucherConhecida(adq: VendaCandidata) {
  const adquirente = normalizarAdquirente(adq.adquirente);
  const bandeira = normalizarAdquirente(adq.bandeira);
  return ADQUIRENTES_VOUCHER.has(adquirente) || ADQUIRENTES_VOUCHER.has(bandeira);
}

function criterioBandeira(erp: VendaCandidata, adq: VendaCandidata) {
  const e = normalizarTexto(erp.bandeira);
  const a = normalizarTexto(adq.bandeira);
  if (!e || !a) return [];
  return [e === a ? 'Bandeira igual' : `Bandeira divergente (${e} × ${a})`];
}

export function parcelaSipagSemAgrupamento(adq:Record<string,unknown>,erp:Record<string,unknown>) {
  const parcela=String(erp.parcelas||'').trim().match(/^(\d+)\s*\/\s*(\d+)$/);
  return normalizarTexto(adq.adquirente)==='SIPAG'&&normalizarModalidade(adq.modalidade)==='CREDITO'
    && Boolean(parcela&&Number(parcela[2])>1)&&erp.origem_erp!=='AGRUPAMENTO_PARCELAS_SIPAG';
}

export function avaliarCandidatoHibrido(adq: VendaCandidata, erp: VendaCandidata): AvaliacaoHibrida | null {
  if ((adq.revisao_coopcerto as {status?:string}|undefined)?.status === 'PENDENTE'
    || (erp.revisao_coopcerto as {status?:string}|undefined)?.status === 'PENDENTE') return null;
  if (parcelaSipagSemAgrupamento(adq,erp)) return null;
  const estabelecimentoAdq = normalizarTexto(adq.codigo_estabelecimento || adq.cnpj_estabelecimento).replace(/[^A-Z0-9]/g, '');
  const estabelecimentoErp = normalizarTexto(erp.cnpj_estabelecimento || erp.codigo_estabelecimento).replace(/[^A-Z0-9]/g, '');
  if (!estabelecimentoAdq || !estabelecimentoErp || estabelecimentoAdq !== estabelecimentoErp) return null;
  const criterioEstabelecimento = 'Estabelecimento igual';
  const adquirente = normalizarAdquirente(adq.adquirente);
  const diffDias = diferencaDias(adq.data_venda, erp.data_venda);
  if (diffDias > 1) return null;
  if (valorEmCentavos(adq.valor_bruto) <= 0 || valorEmCentavos(adq.valor_bruto) !== valorEmCentavos(erp.valor_bruto)) return null;
  const parcelasAdq = normalizarParcelas(adq.parcelas), parcelasErp = normalizarParcelas(erp.parcelas);
  const parcelasDivergentes = parcelasAdq !== null && parcelasErp !== null && parcelasAdq !== parcelasErp;
  const criterioParcelas = parcelasAdq !== null && parcelasErp !== null && !parcelasDivergentes ? ['Parcelas iguais'] : [];
  const criterioData = diffDias === 0 ? 'Data igual' : 'Data compatível (D±1)';

  const nsuAdq = normalizarNsu(adq.nsu);
  const nsuErp = normalizarNsu(erp.nsu);
  if (['SIPAG', 'CONVCARD'].includes(adquirente) && nsuAdq && nsuAdq === nsuErp) {
    return { estrategia: 'NSU_VALOR_DATA', classificacao: 'MATCH_EXATO_NSU', score: 100, diferenca_segundos: 0, ajuste_horario_minutos: AJUSTE_HORARIO_MINUTOS[adquirente] || 0, criterios: [criterioEstabelecimento, 'NSU igual', 'Valor igual', criterioData, ...criterioParcelas] };
  }

  const modalidadeErp = normalizarModalidade(erp.tipo_produto || erp.forma_pagamento || erp.modalidade);
  const modalidadeAdq = normalizarModalidade(adq.modalidade);
  const modalidadeCompativel = modalidadesCompativeis(erp.tipo_produto || erp.forma_pagamento || erp.modalidade, adq.modalidade, adquirente);
  const voucherConhecido = ehAdquirenteVoucherConhecida(adq) && modalidadeAdq === 'VOUCHER' && ['CREDITO', 'DEBITO', 'VOUCHER'].includes(modalidadeErp);

  // Os PIX SICOOB importados com hora local já receberam a conversão UTC → La Paz.
  // O legado, sem esta marca, continua usando o ajuste anterior de quatro horas.
  const ajuste = adquirente === 'SICOOB' && (adq.horario_fuso_aplicado === 'America/La_Paz' ||
    (adq.dados_json as Record<string, unknown> | undefined)?.horario_fuso_aplicado === 'America/La_Paz')
    ? 0 : AJUSTE_HORARIO_MINUTOS[adquirente] || 0;
  const instanteAdq = instanteVendaMinutos(adq.data_venda, adq.hora_venda || adq.data_venda_hora);
  const instanteErp = instanteVendaMinutos(erp.data_venda, erp.hora_venda || erp.hora_venda_exibicao || erp.data_venda_hora);
  const segundos = instanteAdq !== null && instanteErp !== null
    ? Math.round(Math.abs(instanteAdq + ajuste - instanteErp) * 60)
    : null;

  // v0.1.226: camadas finais de recuperação. Elas só entram quando a regra tradicional
  // seria bloqueada por divergência de parcelas e preservam os valores originais no banco.
  // Exigem data/valor/loja/modalidade/bandeira iguais e serão confirmadas automaticamente
  // apenas quando a seleção global comprovar unicidade 1×1.
  if (parcelasDivergentes && diffDias === 0 && modalidadeCompativel) {
    const bandeiraErp = normalizarTexto(erp.bandeira);
    const bandeiraAdq = normalizarTexto(adq.bandeira);
    const bandeiraIgual = Boolean(bandeiraErp && bandeiraAdq && bandeiraErp === bandeiraAdq);
    if (bandeiraIgual && nsuAdq && nsuErp && nsuAdq === nsuErp) {
      return {
        estrategia: 'RECUPERACAO_NSU_NORMALIZADO',
        classificacao: 'RECUPERACAO_NSU_NORMALIZADO',
        score: 89,
        diferenca_segundos: segundos ?? 999999,
        ajuste_horario_minutos: ajuste,
        criterios: [criterioEstabelecimento, 'Data igual', 'Valor igual', 'Modalidade compatível', 'Bandeira igual', `NSU igual após normalização (${String(erp.nsu || '')} ↔ ${String(adq.nsu || '')})`, 'Parcelas divergentes toleradas somente nesta camada final', 'Exige candidato único 1×1'],
      };
    }
    if (bandeiraIgual && segundos !== null && segundos <= 120) {
      return {
        estrategia: 'RECUPERACAO_CONTEXTO_HORA',
        classificacao: 'RECUPERACAO_CONTEXTO_HORA',
        score: 85,
        diferenca_segundos: segundos,
        ajuste_horario_minutos: ajuste,
        criterios: [criterioEstabelecimento, 'Data igual', 'Valor igual', 'Modalidade compatível', 'Bandeira igual', `Horário normalizado com diferença de ${formatarDiferencaHorario(segundos)}`, 'NSU/autorização não usados nesta camada', 'Parcelas divergentes toleradas somente nesta camada final', 'Exige candidato único 1×1'],
      };
    }
    return null;
  }
  if (parcelasDivergentes) return null;

  // v0.1.138: voucher conhecido pode ser conciliado mesmo quando o ERP classifica a venda
  // como crédito/débito. Modalidade e bandeira deixam de ser bloqueios absolutos, mas somente
  // dentro da lista controlada e com evidências fortes de data/valor/parcelas/unicidade.
  if (voucherConhecido && diffDias === 0 && !modalidadeCompativel) {
    if (segundos !== null && segundos <= 120) {
      return {
        estrategia: 'VOUCHER_DATA_VALOR_PARCELAS',
        classificacao: 'VOUCHER_HORARIO_FORTE',
        score: 90,
        diferenca_segundos: segundos,
        ajuste_horario_minutos: ajuste,
        criterios: ['Valor igual', criterioData, ...criterioParcelas, `Voucher conhecido (${adquirente || normalizarTexto(adq.bandeira)})`, `Modalidade ERP ${modalidadeErp || 'N/D'} compatível por regra de voucher com ADQ VOUCHER`, ...criterioBandeira(erp, adq), `Horário normalizado com diferença de ${formatarDiferencaHorario(segundos)}`],
      };
    }
    return {
      estrategia: 'VOUCHER_DATA_VALOR_PARCELAS',
      classificacao: 'VOUCHER_UNICO_DATA_VALOR_PARCELAS',
      score: 80,
      diferenca_segundos: segundos ?? 999999,
      ajuste_horario_minutos: ajuste,
      criterios: ['Valor igual', criterioData, ...criterioParcelas, `Voucher conhecido (${adquirente || normalizarTexto(adq.bandeira)})`, `Modalidade ERP ${modalidadeErp || 'N/D'} compatível por regra de voucher com ADQ VOUCHER`, ...criterioBandeira(erp, adq), 'Elegível somente se restar candidato único 1×1'],
    };
  }

  // Regra tradicional: modalidade compatível + horário normalizado.
  if (modalidadeCompativel) {
    if (segundos === null) {
      if (voucherConhecido && diffDias === 0) {
        return {
          estrategia: 'VOUCHER_DATA_VALOR_PARCELAS',
          classificacao: 'VOUCHER_UNICO_DATA_VALOR_PARCELAS',
          score: 80,
          diferenca_segundos: 999999,
          ajuste_horario_minutos: ajuste,
          criterios: ['Valor igual', criterioData, 'Modalidade compatível', ...criterioParcelas, `Voucher conhecido (${adquirente || normalizarTexto(adq.bandeira)})`, ...criterioBandeira(erp, adq), 'Sem horário suficiente; elegível somente se restar candidato único 1×1'],
        };
      }
      return null;
    }
    if (segundos > 8 * 60 * 60) return null;
    const seguro = segundos <= 120;
    return {
      estrategia: 'VALOR_DATA_MODALIDADE_HORARIO',
      classificacao: seguro ? 'MATCH_EXATO_HORARIO' : 'CANDIDATO_UNICO_JANELA_8H',
      score: seguro ? 95 : 80,
      diferenca_segundos: segundos,
      ajuste_horario_minutos: ajuste,
      criterios: ['Valor igual', criterioData, 'Modalidade compatível', ...criterioParcelas, ...criterioBandeira(erp, adq), `Horário normalizado com diferença de ${formatarDiferencaHorario(segundos)}`],
    };
  }

  // v0.1.138: quando valor/data/parcelas e horário são muito fortes, divergência de modalidade
  // ou bandeira não elimina o candidato. A seleção automática posterior exige melhor candidato
  // mútuo e ausência de empate técnico.
  if (segundos !== null && segundos <= 120 && diffDias === 0) {
    return {
      estrategia: 'HORARIO_FORTE_DADOS_DIVERGENTES',
      classificacao: 'MATCH_HORARIO_FORTE_DIVERGENTE',
      score: 90,
      diferenca_segundos: segundos,
      ajuste_horario_minutos: ajuste,
      criterios: ['Valor igual', criterioData, ...criterioParcelas, `Modalidade divergente (${modalidadeErp || 'N/D'} × ${modalidadeAdq || 'N/D'})`, ...criterioBandeira(erp, adq), `Horário normalizado forte com diferença de ${formatarDiferencaHorario(segundos)}`, 'Elegível somente como melhor candidato mútuo sem empate técnico'],
    };
  }

  return null;
}
