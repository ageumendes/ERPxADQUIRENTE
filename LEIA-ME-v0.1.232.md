# ERPxADQUIRENTE v0.1.232

## Responsividade na raiz

- Mantém 1880 px como referência visual em 100%.
- Escala continuamente o workspace completo em telas desktop menores.
- Em 1326 px a escala fica aproximadamente em 75%, equivalente ao comportamento validado com zoom manual do navegador.
- Usa `transform: scale()` com compensação da largura e altura lógica, evitando o corte lateral causado pela estratégia anterior com `zoom`.
- Sidebar, cabeçalho, cards, filtros, fontes, botões e conteúdo reduzem juntos e preservam as proporções.
- Scroll horizontal permanece restrito às tabelas largas.
- Abaixo de 980 px permanece o layout estrutural/mobile existente.

Nenhuma regra de conciliação, importação, banco de dados ou backend foi alterada por este ajuste.
