export type Importacao = {
  id: string;
  nome_arquivo_original: string;
  tamanho_bytes: string | number;
  origem_detectada: string | null;
  layout_detectado: string | null;
  status_importacao: string;
  quantidade_registros: number;
  quantidade_processados: number;
  quantidade_erros: number;
  hash_arquivo?: string;
  data_importacao: string;
  mensagem_erro?: string | null;
  pasta_arquivo?: string | null;
  nome_arquivo_salvo?: string | null;
  data_atualizacao?: string | null;
};

export type ImportacoesPoll = {
  timestamp: string;
  fila_importacao?: {
    rodando: boolean;
    modo?: string;
    pendentes: number;
    atual?: { importacao_id: string; nome_arquivo_original: string; origem_fila: string } | null;
  };
  sftp?: Record<string, unknown>;
  pastas_importacao?: Record<string, unknown>;
  resumo_importacoes?: Record<string, number> | null;
  importacoes?: Importacao[];
};

export type DashboardArquivoImportado = {
  importacao_id: string;
  tipo: string;
  data_itens: string;
  data_importacao: string | null;
  quantidade_registros: number;
  arquivo: string;
  layout_detectado: string;
  detalhe: string;
};

export type DashboardGrupoImportado = {
  grupo: string;
  status: 'IMPORTADO';
  quantidade_registros: number;
  quantidade_arquivos: number;
  arquivos: DashboardArquivoImportado[];
};

export type DashboardPendenciasImportacao = {
  data_referencia: string;
  atualizado_em: string;
  resumo: {
    total: number;
    importados: number;
    arquivos: number;
    registros: number;
  };
  grupos: DashboardGrupoImportado[];
};
