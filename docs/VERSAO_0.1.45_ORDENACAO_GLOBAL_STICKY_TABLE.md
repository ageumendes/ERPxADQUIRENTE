# Versão 0.1.45 — Ordenação global e tabela sticky

## Ajustes

- Reforçada a ordenação global de `vendas_adquirentes` por timestamp único `data_venda + hora_venda`, sem agrupamento por adquirente.
- Adicionado reforço de ordenação também no frontend antes de renderizar a tabela.
- Suporte mantido para horas compactas como `193708` => `19:37:08`.
- Header das tabelas de vendas fica fixo durante a rolagem.
- Botões `<` e `>` de paginação ficaram circulares e flutuantes nas laterais da tabela.

## Validação

- Frontend validado com TypeScript e build Vite.
- Backend validado e compilado com TypeScript.
