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
  janela.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparando impressão...</title></head><body style="font-family:Arial,sans-serif;padding:24px">Preparando todos os registros para impressão...</body></html>');
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
  janela.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title><style>
    @page{size:landscape;margin:8mm}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:9px}h1{font-size:15px;margin:0 0 3px}.meta{display:flex;justify-content:space-between;gap:12px;margin-bottom:5px;color:#555}.filters{display:flex;flex-wrap:wrap;gap:4px 14px;border:1px solid #bbb;background:#f6f6f6;padding:6px;margin:0 0 8px}.filters span{white-space:nowrap}table{width:100%;border-collapse:collapse;table-layout:auto}thead{display:table-header-group}th,td{border:1px solid #bbb;padding:4px 5px;text-align:left;white-space:nowrap}th{background:#eee;font-weight:700}tr:nth-child(even){background:#fafafa}.no-print{margin-bottom:10px}@media print{.no-print{display:none}}
  </style></head><body><button class="no-print" onclick="window.print()">Imprimir / Salvar como PDF</button><h1>${escaparHtml(titulo)}</h1><div class="meta"><span>${escaparHtml(subtitulo)}</span><span>Gerado em ${escaparHtml(agora)}</span></div>${filtrosHtml}<table><thead><tr>${cabecalhos.map((h) => `<th>${escaparHtml(h)}</th>`).join('')}</tr></thead><tbody>${linhas.map((linha) => `<tr>${linha.map((v) => `<td>${escaparHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
  janela.document.close();
}
