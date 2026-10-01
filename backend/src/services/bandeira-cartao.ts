export type IdentificacaoBandeira = {
  bandeira: string;
  bin: string;
  criterio: 'BIN_CARTAO' | 'BIN_INDISPONIVEL';
};

/** Preserva o BIN original; a tradução é administrada pelo módulo de conversões. */
export function identificarBandeiraCartao(numeroCartao: string): IdentificacaoBandeira {
  const bin = String(numeroCartao || '').replace(/\D/g, '').slice(0, 6);
  return { bandeira: bin, bin, criterio: bin.length === 6 ? 'BIN_CARTAO' : 'BIN_INDISPONIVEL' };
}
