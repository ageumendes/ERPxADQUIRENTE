export function formatBytes(value: string | number) {
  const bytes = Number(value || 0);
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const indice = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / Math.pow(1024, indice)).toFixed(2)} ${sizes[indice]}`;
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    RECEBIDO: 'Recebido',
    CLASSIFICANDO: 'Classificando',
    CLASSIFICADO: 'Classificado',
    PROCESSANDO: 'Processando',
    PROCESSADO: 'Processado',
    ERRO: 'Erro',
    LAYOUT_DESCONHECIDO: 'Layout desconhecido',
    ARQUIVO_DUPLICADO: 'Arquivo duplicado',
    EXTENSAO_BLOQUEADA: 'Extensão bloqueada',
    PROCESSANDO_FILA: 'Na fila',
    RECUPERADO_REENFILEIRADO: 'Recuperado',
    ENFILEIRADO: 'Enfileirado',
  };
  return labels[status] || status;
}
