function escaparHtml(valor: unknown) {
  return String(valor ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));
}

export function imprimirTabelaAtual(titulo: string, cabecalhos: string[], linhas: unknown[][], subtitulo = '') {
  const janela = window.open('', '_blank');
  if (!janela) {
    window.alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente novamente.');
    return;
  }
  const agora = new Date().toLocaleString('pt-BR');
  janela.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title><style>
    @page{size:landscape;margin:8mm}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:9px}h1{font-size:15px;margin:0 0 3px}p{margin:0 0 8px;color:#555}table{width:100%;border-collapse:collapse;table-layout:auto}th,td{border:1px solid #bbb;padding:4px 5px;text-align:left;white-space:nowrap}th{background:#eee;font-weight:700}tr:nth-child(even){background:#fafafa}.meta{display:flex;justify-content:space-between;margin-bottom:8px}.no-print{margin-bottom:10px}@media print{.no-print{display:none}}
  </style></head><body><button class="no-print" onclick="window.print()">Imprimir / Salvar como PDF</button><h1>${escaparHtml(titulo)}</h1><div class="meta"><span>${escaparHtml(subtitulo)}</span><span>Gerado em ${escaparHtml(agora)}</span></div><table><thead><tr>${cabecalhos.map((h) => `<th>${escaparHtml(h)}</th>`).join('')}</tr></thead><tbody>${linhas.map((linha) => `<tr>${linha.map((v) => `<td>${escaparHtml(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
  janela.document.close();
}
