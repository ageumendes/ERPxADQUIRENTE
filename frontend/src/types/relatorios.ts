export type RelatorioGrupo = {
  chave: string;
  data?: string;
  data_pagamento?: string;
  bruto: number;
  taxa: number;
  liquido: number;
  quantidade: number;
  ticket_medio: number;
  taxa_media_percentual: number;
};

export type RelatorioAdquirentes = {
  opcoes: { estabelecimentos: string[]; adquirentes: string[]; modalidades: string[]; bandeiras: string[]; status: string[] };
  resumo: {
    total_bruto: number; total_taxas: number; total_liquido: number; quantidade_transacoes: number;
    ticket_medio: number; taxa_media_percentual: number; autorizadas: number;
    canceladas_ou_negadas: number; canceladas: number; negadas: number; estornadas: number;
  };
  por_dia: RelatorioGrupo[];
  por_adquirente: RelatorioGrupo[];
  por_forma_pagamento: RelatorioGrupo[];
  por_modalidade: RelatorioGrupo[];
  por_bandeira: RelatorioGrupo[];
  por_terminal: RelatorioGrupo[];
  analise_adquirentes: Array<{
    adquirente: string;
    bandeiras_historicas?: string[];
    modalidades: Array<{
      nome: string; bruto: number; taxa: number; liquido: number; quantidade: number;
      bandeiras: Array<{ bandeira: string; bruto: number; taxa: number; liquido: number; quantidade: number }>;
    }>;
  }>;
};

export type FiltrosRelatorio = {
  busca: string; data_inicio: string; data_fim: string; estabelecimento: string; adquirente: string; forma_pagamento: string;
  modalidade: string; bandeira: string; status: string;
};

export type LinhaRelatorioFinanceiro = {
  nivel: 'ADQUIRENTE' | 'FORMA' | 'MODALIDADE' | 'BANDEIRA';
  adquirente: string; forma_pagamento: string; modalidade: string; bandeira: string;
  quantidade: number; bruto: number; taxa: number; taxa_percentual: number; liquido: number;
};
