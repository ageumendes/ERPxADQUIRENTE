function prepararImpressao() {
  document.querySelectorAll('[data-imprimir]').forEach(botao => {
    botao.addEventListener('click', () => window.print());
  });
  if (document.body.hasAttribute('data-imprimir-automaticamente')) {
    const imprimir = () => { window.focus(); window.print(); };
    if (document.readyState === 'complete') imprimir();
    else window.addEventListener('load', imprimir, { once: true });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', prepararImpressao, { once: true });
else prepararImpressao();
