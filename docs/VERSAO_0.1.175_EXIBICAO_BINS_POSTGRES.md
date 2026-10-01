# v0.1.175 — Exibição de BINs no PostgreSQL

## Correção

- A listagem `vendas_adquirentes` no PostgreSQL passa a aplicar as conversões de exibição, como já ocorria no modo legado.
- A abertura da listagem sincroniza os BINs observados com a base local, inclusive após atualização de uma instalação existente.
- O filtro e as opções de bandeira usam o nome identificado no catálogo para transações SIPAG cujo valor armazenado permanece sendo o BIN.
- O BIN original continua preservado no registro e códigos ausentes da base local permanecem visíveis para identificação on-line ou manual.

## Resultado esperado

Um valor como `439267`, quando identificado no catálogo como `VISA`, é exibido e filtrado como `VISA`, sem alterar o dado bruto importado.
