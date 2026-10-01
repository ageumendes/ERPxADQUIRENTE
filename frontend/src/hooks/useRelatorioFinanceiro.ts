import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL, apiFetch } from '../lib/api';
import type { FiltrosRelatorio, RelatorioAdquirentes } from '../types/relatorios';

export const relatorioVazio: RelatorioAdquirentes = {
  opcoes: { estabelecimentos: [], adquirentes: [], modalidades: [], bandeiras: [], status: [] },
  resumo: {
    total_bruto: 0, total_taxas: 0, total_liquido: 0, quantidade_transacoes: 0,
    ticket_medio: 0, taxa_media_percentual: 0, autorizadas: 0,
    canceladas_ou_negadas: 0, canceladas: 0, negadas: 0, estornadas: 0,
  },
  por_dia: [], por_adquirente: [], por_forma_pagamento: [], por_modalidade: [],
  por_bandeira: [], por_terminal: [], analise_adquirentes: [],
};

const CHAVES_FILTRO: Array<keyof FiltrosRelatorio> = [
  'busca', 'data_inicio', 'data_fim', 'estabelecimento', 'adquirente', 'forma_pagamento', 'modalidade',
  'bandeira', 'status',
];

export function filtrosRelatorioDaUrl(params: URLSearchParams, padrao: FiltrosRelatorio) {
  const filtros = { ...padrao };
  for (const chave of CHAVES_FILTRO) {
    const valor = params.get(chave);
    if (valor !== null) filtros[chave] = valor;
  }
  return filtros;
}

export function useRelatorioFinanceiro(criarFiltrosPadrao: () => FiltrosRelatorio) {
  const filtrosIniciaisRef = useRef<FiltrosRelatorio | null>(null);
  if (filtrosIniciaisRef.current === null) {
    filtrosIniciaisRef.current = filtrosRelatorioDaUrl(new URLSearchParams(window.location.search), criarFiltrosPadrao());
  }
  const filtrosIniciais = filtrosIniciaisRef.current;
  const [relatorio, setRelatorio] = useState<RelatorioAdquirentes>(relatorioVazio);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosRelatorio>(filtrosIniciais);
  const [filtrosAplicados, setFiltrosAplicados] = useState<FiltrosRelatorio>(filtrosIniciais);
  const requisicaoAtual = useRef<AbortController | null>(null);

  const carregarRelatorio = useCallback(async (proximosFiltros: FiltrosRelatorio) => {
    requisicaoAtual.current?.abort();
    const controller = new AbortController();
    requisicaoAtual.current = controller;
    setLoading(true);
    setMessage('');
    const params = new URLSearchParams();
    for (const [chave, valor] of Object.entries(proximosFiltros)) if (valor) params.set(chave, valor);

    try {
      const response = await apiFetch(`${API_URL}/api/relatorios-adquirentes?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error('Não foi possível carregar os relatórios das adquirentes.');
      const dados = await response.json() as RelatorioAdquirentes;
      if (controller.signal.aborted) return;
      setRelatorio(dados);
      setFiltrosAplicados(proximosFiltros);
      const query = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar relatórios das adquirentes.');
    } finally {
      if (requisicaoAtual.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregarRelatorio(filtrosIniciais);
    return () => requisicaoAtual.current?.abort();
  }, [carregarRelatorio]);

  return { relatorio, message, setMessage, loading, filtros, setFiltros, filtrosAplicados, carregarRelatorio };
}
