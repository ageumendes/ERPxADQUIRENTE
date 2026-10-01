import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { API_URL, apiFetch } from '../lib/api';
import { COLUNAS_MOEDA, COLUNAS_PERCENTUAL, formatarMoedaBrasil, normalizarData, valorTabela } from '../lib/formatters';
import { RenderAdquirenteLogo, RenderBandeiraLogo, normalizarChaveLogo } from '../components/PaymentLogos';
import { FiltrosVendas, montarParamsListagemVendas, opcoesFiltrosVazias, type FiltrosListagemVendas, type OpcoesFiltrosVendas } from '../components/FiltrosVendas';
import { useTamanhoPaginaResponsivo } from '../hooks/useTamanhoPaginaResponsivo';
import { useFiltrosVendasUrl, useValorDebounced } from '../hooks/useFiltrosVendas';
import { extrairRespostaPaginada, rolarParaTopoElemento } from '../lib/paginacao';
import type { VendaAdquirente } from '../types/vendas';
import { ConciliacaoVenda, NsuCurto } from '../components/ConciliacaoVenda';
import { estiloLarguraColuna, LARGURAS_COLUNAS, type LarguraColuna } from '../lib/columnWidths';
import { abrirJanelaImpressao, imprimirTabelaAtual } from '../lib/imprimirTabela';
import { carregarTodasVendasParaImpressao } from '../lib/impressaoVendas';

function formatarPercentual(valor: unknown) { const numero = Number(valor || 0); return (Number.isFinite(numero) ? numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00') + '%'; }

type VendaAdquirenteColuna = 'adquirente' | 'codigo_estabelecimento' | 'data_venda' | 'hora_venda_exibicao' | 'valor_bruto' | 'valor_taxa' | 'percentual_taxa' | 'valor_liquido' | 'modalidade' | 'bandeira' | 'parcelas' | 'status_transacao' | 'terminal' | 'nsu' | 'codigo_autorizacao' | 'status_conciliacao' | 'score_conciliacao' | 'tipo_match' | 'duplicidade_status';

const colunasVendasAdquirentes: { chave: VendaAdquirenteColuna; titulo: string; largura?: LarguraColuna }[] = [
  { chave: 'codigo_estabelecimento', titulo: 'Loja', largura: LARGURAS_COLUNAS.vendasAdquirentes.codigo_estabelecimento },
  { chave: 'adquirente', titulo: 'Adquirente', largura: LARGURAS_COLUNAS.vendasAdquirentes.adquirente },
  { chave: 'data_venda', titulo: 'Data venda', largura: LARGURAS_COLUNAS.vendasAdquirentes.data_venda },
  { chave: 'hora_venda_exibicao', titulo: 'Hora venda', largura: LARGURAS_COLUNAS.vendasAdquirentes.hora_venda_exibicao },
  { chave: 'valor_bruto', titulo: 'Valor bruto', largura: LARGURAS_COLUNAS.vendasAdquirentes.valor_bruto },
  { chave: 'valor_taxa', titulo: 'Valor taxa', largura: LARGURAS_COLUNAS.vendasAdquirentes.valor_taxa },
  { chave: 'percentual_taxa', titulo: '%taxa', largura: LARGURAS_COLUNAS.vendasAdquirentes.percentual_taxa },
  { chave: 'valor_liquido', titulo: 'Valor líquido', largura: LARGURAS_COLUNAS.vendasAdquirentes.valor_liquido },
  { chave: 'modalidade', titulo: 'Modalidade', largura: LARGURAS_COLUNAS.vendasAdquirentes.modalidade },
  { chave: 'bandeira', titulo: 'Bandeira', largura: LARGURAS_COLUNAS.vendasAdquirentes.bandeira },
  { chave: 'status_transacao', titulo: 'Status', largura: LARGURAS_COLUNAS.vendasAdquirentes.status_transacao },
  { chave: 'parcelas', titulo: 'Parcelas', largura: LARGURAS_COLUNAS.vendasAdquirentes.parcelas },
  { chave: 'status_conciliacao', titulo: 'Conciliação', largura: LARGURAS_COLUNAS.vendasAdquirentes.status_conciliacao },
  { chave: 'nsu', titulo: 'NSU', largura: LARGURAS_COLUNAS.vendasAdquirentes.nsu },
];

function horaParaOrdenacao(hora?: unknown) {
  const texto = String(hora ?? '').trim();
  if (!texto || texto === '-') return '00:00:00';
  const compacto = texto.replace(/\D/g, '');
  if (/^\d{6}$/.test(compacto)) return `${compacto.slice(0, 2)}:${compacto.slice(2, 4)}:${compacto.slice(4, 6)}`;
  if (/^\d{4}$/.test(compacto)) return `${compacto.slice(0, 2)}:${compacto.slice(2, 4)}:00`;
  const partes = texto.split(':').map((parte) => parte.replace(/\D/g, '').padStart(2, '0'));
  const [hh = '00', mm = '00', ss = '00'] = partes;
  return `${hh.slice(0, 2)}:${mm.slice(0, 2)}:${ss.slice(0, 2)}`;
}

function timestampVendaParaOrdenacao(data?: unknown, hora?: unknown) {
  const dataTexto = String(data ?? '').trim();
  const horaNormalizada = horaParaOrdenacao(hora);
  if (!dataTexto) return 0;

  const iso = dataTexto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const timestamp = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T${horaNormalizada}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const compactaBr = dataTexto.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (compactaBr) {
    const timestamp = Date.parse(`${compactaBr[3]}-${compactaBr[2]}-${compactaBr[1]}T${horaNormalizada}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const br = dataTexto.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (br) {
    const ano = br[3].length === 2 ? `20${br[3]}` : br[3];
    const timestamp = Date.parse(`${ano}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}T${horaNormalizada}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const timestamp = Date.parse(dataTexto);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function ordenarVendasAdquirentesPorDataHoraDesc(a: VendaAdquirente, b: VendaAdquirente) {
  const dataB = timestampVendaParaOrdenacao(b.data_venda, b.hora_venda);
  const dataA = timestampVendaParaOrdenacao(a.data_venda, a.hora_venda);
  if (dataB !== dataA) return dataB - dataA;
  const criacaoB = Date.parse(String((b as any).data_criacao || '')) || 0;
  const criacaoA = Date.parse(String((a as any).data_criacao || '')) || 0;
  if (criacaoB !== criacaoA) return criacaoB - criacaoA;
  return Number(b.numero_linha || 0) - Number(a.numero_linha || 0);
}

function exibirAdquirente(venda: VendaAdquirente, coluna: VendaAdquirenteColuna) {
  if (coluna === 'data_venda') return normalizarData(venda.data_venda);
  if (coluna === 'hora_venda_exibicao') return valorTabela(venda.hora_venda);
  if (coluna === 'adquirente') return <RenderAdquirenteLogo valor={venda.adquirente} />;
  if (coluna === 'bandeira') return <RenderBandeiraLogo valor={venda.bandeira} />;
  if (coluna === 'status_transacao') {
    const valor = venda.status_transacao;
    const chave = normalizarChaveLogo(valor);
    const classe = chave === 'AUTORIZADO' ? 'status-chip autorizado' : ['NAO AUTORIZADO','NEGADO','RECUSADO','REJEITADO'].includes(chave) ? 'status-chip nao-autorizado' : ['PENDENTE'].includes(chave) ? 'status-chip pendente' : 'status-chip neutro';
    return <span className={classe}>{valorTabela(valor)}</span>;
  }
  if (COLUNAS_PERCENTUAL.has(String(coluna))) return formatarPercentual(venda[coluna as keyof VendaAdquirente]);
  if (COLUNAS_MOEDA.has(String(coluna))) {
    return formatarMoedaBrasil(venda[coluna as keyof VendaAdquirente]);
  }
  return valorTabela(venda[coluna as keyof VendaAdquirente]);
}

export function VendasAdquirentesPage() {
  const tabelaRef = useRef<HTMLDivElement>(null);
  const tamanhoPagina = useTamanhoPaginaResponsivo(tabelaRef, 285);
  const [vendas, setVendas] = useState<VendaAdquirente[]>([]);
  const [totalLinhas, setTotalLinhas] = useState(0);
  const [message, setMessage] = useState('');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [opcoesFiltros, setOpcoesFiltros] = useState<OpcoesFiltrosVendas>(opcoesFiltrosVazias);
  const { filtros, atualizarFiltro, restaurarFiltros } = useFiltrosVendasUrl();
  const buscaDebounced = useValorDebounced(filtros.busca, 350);
  const requisicaoAtualRef = useRef<AbortController | null>(null);

  async function carregarOpcoesFiltros(proximosFiltros: FiltrosListagemVendas) {
    try {
      const params = montarParamsListagemVendas(proximosFiltros, tamanhoPagina, 0);
      const response = await apiFetch(`${API_URL}/api/vendas-adquirentes/opcoes?${params.toString()}`);
      if (response.ok) setOpcoesFiltros(await response.json());
    } catch {
      // As opções são auxiliares; a tabela ainda pode carregar sem elas.
    }
  }

  async function carregarVendas(proximoOffset = offset, proximosFiltros = filtros) {
    requisicaoAtualRef.current?.abort();
    const controller = new AbortController();
    requisicaoAtualRef.current = controller;
    setMessage('');
    setLoading(true);
    try {
      const params = montarParamsListagemVendas(proximosFiltros, tamanhoPagina, proximoOffset);
      const response = await apiFetch(`${API_URL}/api/vendas-adquirentes?${params.toString()}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Não foi possível carregar as vendas das adquirentes.');
      const data = extrairRespostaPaginada<VendaAdquirente>(await response.json(), tamanhoPagina, proximoOffset);
      setVendas([...data.linhas].sort(ordenarVendasAdquirentesPorDataHoraDesc));
      setTotalLinhas(data.total_linhas);
      setOffset(data.offset);
      if (proximoOffset !== offset) rolarParaTopoElemento(tabelaRef);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar vendas das adquirentes.');
    } finally {
      if (requisicaoAtualRef.current === controller) setLoading(false);
    }
  }

  useEffect(() => {
    void carregarVendas(0, { ...filtros, busca: buscaDebounced });
    return () => requisicaoAtualRef.current?.abort();
  }, [buscaDebounced]);

  // v0.1.240: o cálculo responsivo controla exclusivamente o LIMIT da próxima
  // consulta. Alterações de tamanhoPagina nunca recarregam a página atual e
  // nunca alteram o OFFSET; isso elimina o ciclo entre renderização, medição
  // das linhas e navegação.

  useEffect(() => {
    if (filtros.busca !== buscaDebounced) return;
    carregarOpcoesFiltros({ ...filtros, busca: buscaDebounced });
  }, [filtros, buscaDebounced]);

  function filtrarVendas() {
    carregarVendas(0, filtros);
  }

  function limparFiltros() {
    const padrao = restaurarFiltros();
    carregarVendas(0, padrao);
  }

  function paginaAnterior() {
    carregarVendas(Math.max(0, offset - tamanhoPagina), filtros);
  }

  function proximaPagina() {
    carregarVendas(offset + vendas.length, filtros);
  }

  async function imprimirTodos() {
    const janela = abrirJanelaImpressao();
    if (!janela) return;
    try {
      const resultado = await carregarTodasVendasParaImpressao<VendaAdquirente>('vendas-adquirentes', filtros);
      const linhas = resultado.linhas.map((v) => [valorTabela(v.codigo_estabelecimento), valorTabela(v.adquirente), normalizarData(v.data_venda), valorTabela(v.hora_venda), formatarMoedaBrasil(v.valor_bruto), formatarMoedaBrasil(v.valor_taxa), formatarPercentual(v.percentual_taxa), formatarMoedaBrasil(v.valor_liquido), valorTabela(v.modalidade), valorTabela(v.bandeira), valorTabela(v.status_transacao), valorTabela(v.parcelas), valorTabela(v.status_conciliacao || 'PENDENTE'), valorTabela(v.nsu)]);
      imprimirTabelaAtual('Vendas Adquirentes', ['Loja','Adquirente','Data venda','Hora venda','Valor bruto','Valor taxa','%taxa','Valor líquido','Modalidade','Bandeira','Status','Parcelas','Conciliação','NSU'], linhas, `Total de registros filtrados: ${resultado.total.toLocaleString('pt-BR')}`, [
        { rotulo: 'Período', valor: `${normalizarData(filtros.data_inicio)} a ${normalizarData(filtros.data_fim)}` }, { rotulo: 'Loja', valor: filtros.estabelecimento || 'Todos' }, { rotulo: 'Adquirente', valor: filtros.adquirente || 'Todas' }, { rotulo: 'F. pagamento', valor: filtros.forma_pagamento || 'Todas' }, { rotulo: 'Modalidade', valor: filtros.modalidade || 'Todas' }, { rotulo: 'Bandeira', valor: filtros.bandeira || 'Todas' }, { rotulo: 'Status', valor: filtros.status || 'Todos' }, { rotulo: 'Conciliação', valor: filtros.conciliacao || 'Todos' }, { rotulo: 'Busca', valor: filtros.busca || '—' }
      ], janela);
    } catch (error) { janela.close(); window.alert(error instanceof Error ? error.message : 'Erro ao preparar impressão.'); }
  }

  const colunas = colunasVendasAdquirentes;

  return (
    <section className="vendas-list-page">
      <FiltrosVendas
        filtros={filtros}
        opcoes={opcoesFiltros}
        loading={loading}
        exibirAdquirente
        exibirConciliacao
        onChange={atualizarFiltro}
        onFiltrar={filtrarVendas}
        onLimpar={limparFiltros}
      />

      <div className="panel vendas-list-panel" ref={tabelaRef}>
        <div className="db-title-row">
          <div>
            <h2>Registros das adquirentes</h2>
          </div>
          <div className="table-title-actions"><span className="muted">Exibindo {totalLinhas === 0 ? 0 : offset + 1}–{Math.min(offset + vendas.length, totalLinhas)} de {totalLinhas}</span><button type="button" className="secondary table-print-button" title="Imprimir ou salvar todos os registros filtrados como PDF" onClick={() => void imprimirTodos()}><Printer size={15}/> PDF / Imprimir</button></div>
        </div>
        {message && <p className="message">{message}</p>}
        <div className="table-pagination-shell">
          <button className="page-nav page-nav-left" onClick={paginaAnterior} disabled={offset === 0 || loading} title="Página anterior" aria-label="Página anterior"><ChevronLeft size={22}/></button>
          <div className="table-wrap db-data-table">
            <table>
              <thead><tr>{colunas.map((coluna) => <th key={coluna.chave} className={`${coluna.chave === 'nsu' ? 'venda-nsu-coluna ' : ''}coluna-limitavel`.trim()} style={estiloLarguraColuna(coluna.largura)} title={coluna.titulo}><span className="coluna-header-texto">{coluna.titulo}</span></th>)}</tr></thead>
              <tbody>
                {vendas.map((venda) => (
                  <tr key={venda.id}>{colunas.map((coluna) => <td key={coluna.chave} className={`${coluna.chave === 'nsu' ? 'venda-nsu-coluna ' : ''}coluna-limitavel`.trim()} style={estiloLarguraColuna(coluna.largura)}>{coluna.chave === 'nsu' ? <NsuCurto valor={venda.nsu}/> : coluna.chave === 'status_conciliacao' ? <ConciliacaoVenda venda={venda} lado="ADQUIRENTE"/> : exibirAdquirente(venda, coluna.chave)}</td>)}</tr>
                ))}
                {vendas.length === 0 && <tr><td colSpan={colunas.length}>Nenhuma venda de adquirente encontrada para os filtros selecionados.</td></tr>}
              </tbody>
            </table>
          </div>
          <button className="page-nav page-nav-right" onClick={proximaPagina} disabled={loading || offset + vendas.length >= totalLinhas} title="Próxima página" aria-label="Próxima página"><ChevronRight size={22}/></button>
        </div>
      </div>
    </section>
  );
}
