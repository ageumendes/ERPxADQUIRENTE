import { API_URL, apiFetch } from './api';
import { montarParamsListagemVendas, type FiltrosListagemVendas } from '../components/FiltrosVendas';
import { extrairRespostaPaginada } from './paginacao';

export async function carregarTodasVendasParaImpressao<T>(rota: 'vendas-erp' | 'vendas-adquirentes', filtros: FiltrosListagemVendas) {
  const lote = 500;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const linhas: T[] = [];
  while (offset < total) {
    const params = montarParamsListagemVendas(filtros, lote, offset);
    const response = await apiFetch(`${API_URL}/api/${rota}?${params.toString()}`);
    if (!response.ok) throw new Error('Não foi possível preparar todos os registros para impressão.');
    const pagina = extrairRespostaPaginada<T>(await response.json(), lote, offset);
    linhas.push(...pagina.linhas);
    total = pagina.total_linhas;
    if (!pagina.linhas.length) break;
    offset += pagina.linhas.length;
  }
  return { linhas, total: Number.isFinite(total) ? total : linhas.length };
}
