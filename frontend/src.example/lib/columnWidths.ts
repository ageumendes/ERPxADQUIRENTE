import type { CSSProperties } from 'react';

export type LarguraColuna =
  | { px: number }
  | { percentual: number }
  | { fracao: number; totalFracoes?: number };

/**
 * Configuração CENTRAL das larguras das tabelas.
 * Edite somente os valores abaixo para ajustar manualmente as colunas.
 * Formatos aceitos: { px: 60 }, { percentual: 8 }, { fracao: 1, totalFracoes: 20 }.
 */
export const LARGURAS_COLUNAS = {
  vendasErp: {
    erp: { percentual: 8 },
    estabelecimento: { percentual: 6 },
    data_venda: { percentual: 8 },
    hora_venda_exibicao: { percentual: 5 },
    valor_bruto: { percentual: 10 },
    tipo_produto: { percentual: 12 },
    bandeira: { percentual: 8 },
    parcelas: { percentual: 7 },
    status_conciliacao: { percentual: 8 },
    nsu: { percentual: 8 },
  },
  vendasAdquirentes: {
    codigo_estabelecimento: { percentual: 5 },
    adquirente: { percentual: 8 },
    data_venda: { percentual: 10 },
    hora_venda_exibicao: { percentual: 8 },
    valor_bruto: { percentual: 8 },
    valor_taxa: { percentual: 7 },
    percentual_taxa: { percentual: 6 },
    valor_liquido: { percentual: 8 },
    modalidade: { percentual: 12 },
    bandeira: { percentual: 7 },
    status_transacao: { percentual: 10 },
    parcelas: { percentual: 6 },
    status_conciliacao: { percentual: 7 },
    nsu: { percentual: 8 },
  },
  conciliacoes: {
    selecao: { px: 34 },
    loja: { percentual: 7 },
    data_venda: { percentual: 16 },
    hora: { percentual: 8 },
    valor_bruto: { percentual: 12 },
    modalidade: { percentual: 18 },
    bandeira: { percentual: 10 },
    parcelas: { percentual: 8 },
    nsu: { percentual: 10 },
    autorizacao: { percentual: 11 },
  },
} satisfies Record<string, Record<string, LarguraColuna>>;

export function estiloLarguraColuna(largura?: LarguraColuna): CSSProperties | undefined {
  if (!largura) return undefined;
  let valor: string;
  if ('px' in largura) valor = `${largura.px}px`;
  else if ('percentual' in largura) valor = `${largura.percentual}%`;
  else valor = `${(largura.fracao / (largura.totalFracoes || 12)) * 100}%`;
  return { width: valor, maxWidth: valor, minWidth: valor };
}

export const larguraCabecalho = (titulo: string, largura?: LarguraColuna) => ({
  style: estiloLarguraColuna(largura),
  title: titulo,
});
