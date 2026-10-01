import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ajustarFiltrosListagemVendas,
  criarFiltrosVendasPadrao,
  filtrosVendasDaUrl,
  paramsUrlDosFiltros,
  type FiltrosListagemVendas,
} from '../components/FiltrosVendas';

export function useValorDebounced<T>(valor: T, atrasoMs = 350) {
  const [debounced, setDebounced] = useState(valor);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(valor), atrasoMs);
    return () => window.clearTimeout(timer);
  }, [valor, atrasoMs]);
  return debounced;
}

export function useFiltrosVendasUrl() {
  const [params, setParams] = useSearchParams();
  const [filtros, setFiltros] = useState<FiltrosListagemVendas>(() => filtrosVendasDaUrl(params));

  useEffect(() => {
    setParams(paramsUrlDosFiltros(filtros), { replace: true });
  }, [filtros, setParams]);

  function atualizarFiltro(chave: keyof FiltrosListagemVendas, valor: string) {
    setFiltros((atual) => ajustarFiltrosListagemVendas(atual, chave, valor));
  }

  function restaurarFiltros() {
    const padrao = criarFiltrosVendasPadrao();
    setFiltros(padrao);
    return padrao;
  }

  return { filtros, setFiltros, atualizarFiltro, restaurarFiltros };
}
