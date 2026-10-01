export type StatusImportacao =
  | 'RECEBIDO'
  | 'CLASSIFICANDO'
  | 'CLASSIFICADO'
  | 'PROCESSANDO'
  | 'PROCESSADO'
  | 'ERRO'
  | 'LAYOUT_DESCONHECIDO'
  | 'ARQUIVO_DUPLICADO'
  | 'EXTENSAO_BLOQUEADA';

export type OrigemDetectada =
  | 'ERP_INTERDATA'
  | 'SIPAG'
  | 'CIELO'
  | 'SICREDI'
  | 'CONVCARD'
  | 'SICOOB'
  | 'VR'
  | 'PLUXEE'
  | 'ALELO'
  | 'TICKET'
  | 'COOPCERTO'
  | 'PIX_BANCO'
  | 'DESCONHECIDO';

export interface ResultadoClassificacao {
  origem_detectada: OrigemDetectada;
  layout_detectado: string;
  quantidade_registros: number;
}

export const EXTENSOES_PERMITIDAS = new Set(['.csv', '.txt', '.xls', '.xlsx', '.edi', '.ret', '.rem', '.json', '.026']);
export const EXTENSOES_BLOQUEADAS = new Set(['.exe', '.bat', '.cmd', '.sh', '.js', '.mjs', '.cjs', '.php', '.py', '.ps1', '.jar', '.msi', '.dll']);
