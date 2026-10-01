export type VendaComEstabelecimento = {
  adquirente?: string;
  layout_origem?: string;
  codigo_estabelecimento?: string;
  cnpj_estabelecimento?: string;
  dados_json?: Record<string, unknown>;
  [chave: string]: unknown;
};

const texto = (valor: unknown) => String(valor ?? '').trim();

export function normalizarCodigoEstabelecimento(valor: unknown): string {
  const original = texto(valor);
  if (!original || original === '-' || /^0+$/.test(original)) return '';
  const digitos = original.replace(/\D/g, '');
  return digitos || original.toUpperCase();
}

function primeiro(dados: Record<string, unknown>, chaves: string[]): { valor: string; origem: string } | null {
  for (const chave of chaves) {
    const valor = normalizarCodigoEstabelecimento(dados[chave]);
    if (valor) return { valor, origem: chave };
  }
  return null;
}

/**
 * Resolve exclusivamente campos que representam a loja/merchant. Documentos do
 * pagador, portador, emissor e adquirente são deliberadamente ignorados.
 */
export function identificarEstabelecimentoVenda(venda: VendaComEstabelecimento) {
  const adquirente = texto(venda.adquirente).toUpperCase();
  const json = (venda.dados_json && typeof venda.dados_json === 'object') ? venda.dados_json : {};
  const dados: Record<string, unknown> = { ...json, ...venda };
  const explicito = primeiro(dados, ['codigo_estabelecimento']);
  if (explicito) return explicito;

  const chavesPorAdquirente: Record<string, string[]> = {
    CIELO: ['estabelecimento_submissor', 'numero_estabelecimento'],
    SIPAG: ['numero_estabelecimento', 'codigo_cliente', 'COLUNA_02', 'estabelecimento', 'merchantId', 'clientCode', 'branchClientCode', 'cpf_cnpj_estabelecimento', 'document'],
    SICREDI: ['merchantId', 'clientCode', 'branchClientCode', 'matrixClientCode', 'document'],
    CONVCARD: ['cnpj_loja'],
    COOPCERTO: ['numero_estabelecimento', 'estabelecimento_relatorio'],
    VR: ['codigo_filiacao', 'codigo_filiacao_original', 'cnpj_loja'],
    ALELO: ['ec_filial', 'cnpj_estabelecimento'],
    PLUXEE: ['codigo_estabelecimento', 'cnpj_estabelecimento_principal', 'cnpj'],
    TICKET: ['identificacao_estabelecimento'],
  };
  const encontrado = primeiro(dados, chavesPorAdquirente[adquirente] || []);
  if (encontrado) return encontrado;

  // Último recurso apenas para o CNPJ canônico, que já foi validado pelo parser.
  const cnpj = normalizarCodigoEstabelecimento(venda.cnpj_estabelecimento);
  return cnpj ? { valor: cnpj, origem: 'cnpj_estabelecimento' } : null;
}

export function enriquecerEstabelecimentoVenda<T extends VendaComEstabelecimento>(venda: T): T & VendaComEstabelecimento {
  const identificado = identificarEstabelecimentoVenda(venda);
  if (!identificado || venda.codigo_estabelecimento === identificado.valor) return venda as T & VendaComEstabelecimento;
  return {
    ...venda,
    codigo_estabelecimento: identificado.valor,
    dados_json: {
      ...(venda.dados_json || {}),
      codigo_estabelecimento_original: texto((venda.dados_json || {})[identificado.origem] ?? venda.cnpj_estabelecimento),
      codigo_estabelecimento_origem: identificado.origem,
    },
  } as T & VendaComEstabelecimento;
}
