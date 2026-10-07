import { ParcelasErp } from '../components/ParcelasErp';
import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { API_URL, apiFetch } from '../lib/api';
import { COLUNAS_MOEDA, formatarHoraVenda, formatarMoedaBrasil, normalizarData, primeiroValor, valorTabela } from '../lib/formatters';
import { RenderBandeiraLogo, RenderErpLogo } from '../components/PaymentLogos';
import { FiltrosVendas, montarParamsListagemVendas, opcoesFiltrosVazias, type FiltrosListagemVendas, type OpcoesFiltrosVendas } from '../components/FiltrosVendas';
import { useTamanhoPaginaResponsivo } from '../hooks/useTamanhoPaginaResponsivo';
import { useFiltrosVendasUrl, useValorDebounced } from '../hooks/useFiltrosVendas';
import { extrairRespostaPaginada, rolarParaTopoElemento } from '../lib/paginacao';
import type { VendaErp } from '../types/vendas';
import { ConciliacaoVenda, NsuCurto } from '../components/ConciliacaoVenda';
import { estiloLarguraColuna, LARGURAS_COLUNAS, type LarguraColuna } from '../lib/columnWidths';
import { abrirJanelaImpressao, imprimirTabelaAtual } from '../lib/imprimirTabela';
import { carregarTodasVendasParaImpressao } from '../lib/impressaoVendas';

type VendaErpColuna = 'erp' | 'estabelecimento' | 'data_venda' | 'hora_venda_exibicao' | 'valor_bruto' | 'valor_liquido' | 'tipo_produto' | 'modalidade' | 'bandeira' | 'parcelas' | 'status_venda' | 'nsu' | 'terminal' | 'status_conciliacao' | 'score_conciliacao' | 'tipo_match' | 'duplicidade_status';

const colunasVendasErp: { chave: VendaErpColuna; titulo: string; largura?: LarguraColuna }[] = [
  { chave: 'erp', titulo: 'ERP', largura: LARGURAS_COLUNAS.vendasErp.erp },
  { chave: 'estabelecimento', titulo: 'Loja', largura: LARGURAS_COLUNAS.vendasErp.estabelecimento },
  { chave: 'data_venda', titulo: 'Data venda', largura: LARGURAS_COLUNAS.vendasErp.data_venda },
  { chave: 'hora_venda_exibicao', titulo: 'Hora venda', largura: LARGURAS_COLUNAS.vendasErp.hora_venda_exibicao },
  { chave: 'valor_bruto', titulo: 'VALOR BRUTO', largura: LARGURAS_COLUNAS.vendasErp.valor_bruto },
  { chave: 'valor_liquido', titulo: 'VALOR LÍQUIDO', largura: LARGURAS_COLUNAS.vendasErp.valor_bruto },
  { chave: 'tipo_produto', titulo: 'Modalidade', largura: LARGURAS_COLUNAS.vendasErp.tipo_produto },
  { chave: 'bandeira', titulo: 'Bandeira', largura: LARGURAS_COLUNAS.vendasErp.bandeira },
  { chave: 'parcelas', titulo: 'Parcelas', largura: LARGURAS_COLUNAS.vendasErp.parcelas },
  { chave: 'status_conciliacao', titulo: 'Conciliação', largura: LARGURAS_COLUNAS.vendasErp.status_conciliacao },
  { chave: 'nsu', titulo: 'NSU', largura: LARGURAS_COLUNAS.vendasErp.nsu },
];
/*console.log(colunasVendasErp)*/

function exibirVenda(venda: VendaErp, coluna: VendaErpColuna) {
  if (coluna === 'parcelas') return <ParcelasErp venda={venda}/>;
  if (coluna === 'erp') return <RenderErpLogo />;
  if (coluna === 'estabelecimento') return valorTabela(primeiroValor(venda.cnpj_estabelecimento, venda.codigo_estabelecimento));
  if (coluna === 'data_venda') return normalizarData(venda.data_venda);
  if (coluna === 'hora_venda_exibicao') return formatarHoraVenda(venda.hora_venda);
  if (coluna === 'modalidade') {
    const originalPreservado = venda.forma_pagamento_original;
    const valorAtual = venda.forma_pagamento;
    if (originalPreservado !== undefined && originalPreservado !== '' && originalPreservado !== valorAtual) {
      return <span title={`Valor original: ${valorTabela(originalPreservado)}`}>{valorTabela(valorAtual)}</span>;
    }
    return valorTabela(valorAtual);
  }
  if (coluna === 'bandeira') return <RenderBandeiraLogo valor={primeiroValor(venda.bandeira, venda.bandeira_original)} />;
  if (coluna === 'status_venda') {
    const valor = venda.status_venda || '';
    const title = valor === 'ATIVO' ? 'a confirmar na adquirente' : valorTabela(venda.status_venda_original || valor);
    return <span title={title}>{valorTabela(valor)}</span>;
  }
  if (COLUNAS_MOEDA.has(String(coluna))) return formatarMoedaBrasil(venda[coluna as keyof VendaErp]);

  const chaveOriginal = coluna;
  const originalPreservado = venda[`${String(chaveOriginal)}_original` as keyof VendaErp];
  const valorAtual = venda[chaveOriginal as keyof VendaErp];

  if (originalPreservado !== undefined && originalPreservado !== '' && originalPreservado !== valorAtual) {
    return <span title={`Valor original: ${valorTabela(originalPreservado)}`}>{valorTabela(valorAtual)}</span>;
  }

  return valorTabela(valorAtual);
}

export function VendasErpPage() {
  const tabelaRef = useRef<HTMLDivElement>(null);
  const tamanhoPagina = useTamanhoPaginaResponsivo(tabelaRef, 285);
  const [vendas, setVendas] = useState<VendaErp[]>([]);
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
      const response = await apiFetch(`${API_URL}/api/vendas-erp/opcoes?${params.toString()}`);
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
      const response = await apiFetch(`${API_URL}/api/vendas-erp?${params.toString()}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Não foi possível carregar as vendas ERP.');
      const data = extrairRespostaPaginada<VendaErp>(await response.json(), tamanhoPagina, proximoOffset);
      setVendas(data.linhas);
      setTotalLinhas(data.total_linhas);
      setOffset(data.offset);
      if (proximoOffset !== offset) rolarParaTopoElemento(tabelaRef);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar vendas ERP.');
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
      const resultado = await carregarTodasVendasParaImpressao<VendaErp>('vendas-erp', filtros);
      const linhas = resultado.linhas.map((v) => ['INTERDATA', valorTabela(primeiroValor(v.cnpj_estabelecimento, v.codigo_estabelecimento)), normalizarData(v.data_venda), formatarHoraVenda(v.hora_venda), formatarMoedaBrasil(v.valor_bruto), formatarMoedaBrasil(v.valor_liquido), valorTabela(v.tipo_produto), valorTabela(v.bandeira), valorTabela(v.parcelas), valorTabela(v.status_conciliacao || 'PENDENTE'), valorTabela(v.nsu)]);
      imprimirTabelaAtual('Vendas ERP - INTERDATA', ['ERP','Loja','Data venda','Hora venda','VALOR BRUTO','VALOR LÍQUIDO','Modalidade','Bandeira','Parcelas','Conciliação','NSU'], linhas, `Total de registros filtrados: ${resultado.total.toLocaleString('pt-BR')}`, [
        { rotulo: 'Período', valor: `${normalizarData(filtros.data_inicio)} a ${normalizarData(filtros.data_fim)}` }, { rotulo: 'Loja', valor: filtros.estabelecimento || 'Todos' }, { rotulo: 'F. pagamento', valor: filtros.forma_pagamento || 'Todas' }, { rotulo: 'Modalidade', valor: filtros.modalidade || 'Todas' }, { rotulo: 'Bandeira', valor: filtros.bandeira || 'Todas' }, { rotulo: 'Conciliação', valor: filtros.conciliacao || 'Todos' }, { rotulo: 'Busca', valor: filtros.busca || '—' }
      ], janela);
    } catch (error) { janela.close(); window.alert(error instanceof Error ? error.message : 'Erro ao preparar impressão.'); }
  }

  const colunas = colunasVendasErp;

  return (
    <section className="vendas-list-page">
      <FiltrosVendas
        filtros={filtros}
        opcoes={opcoesFiltros}
        loading={loading}
        exibirStatus={false}
        exibirConciliacao
        onChange={atualizarFiltro}
        onFiltrar={filtrarVendas}
        onLimpar={limparFiltros}
      />

      <div className="panel vendas-list-panel" ref={tabelaRef}>
        <div className="db-title-row">
          <h2>Registros importados do INTERDATA</h2>
          <div className="table-title-actions"><span className="muted">Exibindo {totalLinhas === 0 ? 0 : offset + 1}–{Math.min(offset + vendas.length, totalLinhas)} de {totalLinhas}</span><button type="button" className="secondary table-print-button" title="Imprimir ou salvar todos os registros filtrados como PDF" onClick={() => void imprimirTodos()}><Printer size={15}/> PDF / Imprimir</button></div>
        </div>
        {message && <p className="message">{message}</p>}
        <div className="table-pagination-shell">
          <button className="page-nav page-nav-left" onClick={paginaAnterior} disabled={offset === 0 || loading} title="Página anterior" aria-label="Página anterior"><ChevronLeft size={22}/></button>
          <div className="table-wrap db-data-table">
            <table>
              <thead>
                <tr>{colunas.map((coluna) => <th key={coluna.chave} className={`${coluna.chave === 'nsu' ? 'venda-nsu-coluna ' : ''}coluna-limitavel`.trim()} style={estiloLarguraColuna(coluna.largura)} title={coluna.titulo}><span className="coluna-header-texto">{coluna.titulo}</span></th>)}</tr>
              </thead>
              <tbody>
                {vendas.map((venda) => (
                  <tr key={venda.id}>
                    {colunas.map((coluna) => <td key={coluna.chave} className={`${coluna.chave === 'nsu' ? 'venda-nsu-coluna ' : ''}coluna-limitavel`.trim()} style={estiloLarguraColuna(coluna.largura)}>{coluna.chave === 'nsu' ? <NsuCurto valor={venda.nsu}/> : coluna.chave === 'status_conciliacao' ? <ConciliacaoVenda venda={venda} lado="ERP"/> : exibirVenda(venda, coluna.chave)}</td>)}
                  </tr>
                ))}
                {vendas.length === 0 && <tr><td colSpan={colunas.length}>Nenhuma venda ERP encontrada para os filtros selecionados.</td></tr>}
              </tbody>
            </table>
          </div>
          <button className="page-nav page-nav-right" onClick={proximaPagina} disabled={loading || offset + vendas.length >= totalLinhas} title="Próxima página" aria-label="Próxima página"><ChevronRight size={22}/></button>
        </div>
      </div>
    </section>
  );
}
