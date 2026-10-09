import cssUrl from './impressao-tabela.css?url';
const scriptUrl = '/impressao-relatorio-v254.js';
const recurso = (url: string) => escaparHtml(new URL(url, window.location.href).href);

function escaparHtml(valor: unknown) {
  return String(valor ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));
}

export type FiltroImpressao = { rotulo: string; valor: unknown };

export function abrirJanelaImpressao() {
  const janela = window.open('', '_blank');
  if (!janela) {
    window.alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.');
    return null;
  }
  janela.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Preparando impressão...</title><link rel="stylesheet" href="${recurso(cssUrl)}"></head><body class="preparando">Preparando todos os registros para impressão...</body></html>`);
  janela.document.close();
  return janela;
}

export function imprimirTabelaAtual(titulo: string, cabecalhos: string[], linhas: unknown[][], subtitulo = '', filtros: FiltroImpressao[] = [], janelaExistente?: Window | null) {
  const janela = janelaExistente || window.open('', '_blank');
  if (!janela) {
    window.alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.');
    return;
  }
  const agora = new Date().toLocaleString('pt-BR');
  const filtrosHtml = filtros.length ? `<div class="filters">${filtros.map((f) => `<span><b>${escaparHtml(f.rotulo)}:</b> ${escaparHtml(f.valor || 'Todos')}</span>`).join('')}</div>` : '';
  janela.document.open();
  janela.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title><link rel="stylesheet" href="${recurso(cssUrl)}"><script defer src="${recurso(scriptUrl)}"></script></head><body data-imprimir-automaticamente><button class="no-print" data-imprimir>Imprimir / Salvar como PDF</button><h1>${escaparHtml(titulo)}</h1><div class="meta"><span>${escaparHtml(subtitulo)}</span><span>Gerado em ${escaparHtml(agora)}</span></div>${filtrosHtml}<table><thead><tr>${cabecalhos.map((h) => `<th>${escaparHtml(h)}</th>`).join('')}</tr></thead><tbody>${linhas.map((linha) => `<tr>${linha.map((v) => `<td>${escaparHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`);
  janela.document.close();
}
