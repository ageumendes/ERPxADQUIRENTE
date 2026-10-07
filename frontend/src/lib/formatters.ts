export function valorTabela(valor: unknown) {
  if (valor === null || valor === undefined || valor === '') return '-';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}


export function formatarMoedaBrasil(valor: unknown) {
  if (valor === null || valor === undefined || valor === '') return '-';
  if (typeof valor === 'object') return valorTabela(valor);

  let texto = String(valor).trim();
  if (!texto || texto === '-') return '-';

  const negativo = /^-/.test(texto) || /\-$/.test(texto);
  texto = texto.replace(/[^\d,.-]/g, '');

  if (!texto || texto === '-' || texto === ',' || texto === '.') return '-';

  const temVirgula = texto.includes(',');
  const temPonto = texto.includes('.');

  if (temVirgula && temPonto) {
    // Padrão BR recebido como texto: 1.234,56
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (temVirgula) {
    // Decimal com vírgula: 1234,56
    texto = texto.replace(',', '.');
  } else if ((texto.match(/\./g) || []).length > 1) {
    // Pontos como separador de milhar: 1.234.567
    texto = texto.replace(/\./g, '');
  }

  const numero = Number(texto);
  if (!Number.isFinite(numero)) return valorTabela(valor);

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(negativo ? -Math.abs(numero) : numero);
}

export const COLUNAS_MOEDA = new Set(['valor_bruto', 'valor_taxa', 'valor_liquido']);
export const COLUNAS_PERCENTUAL = new Set(['percentual_taxa']);

export function primeiroValor(...valores: unknown[]) {
  for (const valor of valores) {
    if (valor !== null && valor !== undefined && String(valor).trim() !== '') return valor;
  }
  return '';
}

export function normalizarData(data?: unknown) {
  const dataTexto = valorTabela(data).trim();
  if (dataTexto === '-') return '-';

  const somenteDigitos = dataTexto.replace(/\D/g, '');
  if (/^\d{8}$/.test(somenteDigitos)) {
    const inicio = Number(somenteDigitos.slice(0, 2));
    const meio = Number(somenteDigitos.slice(2, 4));
    const fim = Number(somenteDigitos.slice(4, 8));

    // ddmmaaaa, exemplo 15032026 -> 15/03/2026
    if (inicio >= 1 && inicio <= 31 && meio >= 1 && meio <= 12 && fim >= 1900) {
      return `${somenteDigitos.slice(0, 2)}/${somenteDigitos.slice(2, 4)}/${somenteDigitos.slice(4, 8)}`;
    }

    // aaaammdd, exemplo 20260315 -> 15/03/2026
    const ano = Number(somenteDigitos.slice(0, 4));
    const mes = Number(somenteDigitos.slice(4, 6));
    const dia = Number(somenteDigitos.slice(6, 8));
    if (ano >= 1900 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) {
      return `${somenteDigitos.slice(6, 8)}/${somenteDigitos.slice(4, 6)}/${somenteDigitos.slice(0, 4)}`;
    }
  }

  const iso = dataTexto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;

  const separado = dataTexto.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{2,4})(?:[ T].*)?$/);
  if (separado) {
    const dia = separado[1].padStart(2, '0');
    const mes = separado[2].padStart(2, '0');
    const ano = separado[3].length === 2 ? `20${separado[3]}` : separado[3];
    return `${dia}/${mes}/${ano}`;
  }

  return dataTexto;
}

export function normalizarDataHora(data?: unknown, hora?: unknown) {
  const dataTexto = normalizarData(data);
  const horaTexto = valorTabela(hora).trim();
  if (dataTexto === '-' && horaTexto === '-') return '-';
  if (dataTexto === '-') return horaTexto;
  if (horaTexto === '-') return dataTexto;
  const horaJaContemData = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(horaTexto);
  return horaJaContemData ? horaTexto : `${dataTexto} ${horaTexto}`;
}


/** Exibição somente: não altera a hora usada pelo motor de conciliação. */
export function formatarHoraVenda(valor: unknown): string {
  const texto = String(valor ?? '').trim();
  if (!texto || texto === '-') return '00:00:00';
  const separado = texto.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
    || texto.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const compacto = /^\d{1,6}$/.test(texto) ? texto.padStart(6,'0') : '';
  const partes = separado ? [separado[1], separado[2], separado[3] || '00']
    : compacto ? [compacto.slice(0,2), compacto.slice(2,4), compacto.slice(4,6)] : null;
  if (!partes || Number(partes[0]) > 23 || Number(partes[1]) > 59 || Number(partes[2]) > 59) return texto;
  return partes.map(p => p.padStart(2,'0')).join(':');
}

/** Líquido ausente/zero da adquirente usa bruto apenas na apresentação. */
export function formatarLiquidoAdquirente(venda: {valor_liquido?: unknown; valor_bruto?: unknown}): string {
  const liquido = venda.valor_liquido;
  const texto = String(liquido ?? '').trim();
  const zerado = /^[-+]?0+(?:[.,]0+)*$/.test(texto.replace(/^R\$\s*/, '').replace(/\s/g,''));
  return formatarMoedaBrasil(!texto || texto === '-' || zerado ? venda.valor_bruto : liquido);
}
