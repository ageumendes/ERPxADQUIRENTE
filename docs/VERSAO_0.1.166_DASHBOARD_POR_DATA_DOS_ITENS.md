# v0.1.166 — Dashboard por data dos itens

- O dia do relatório vem de `data_venda` ou da data de negócio equivalente do registro bruto.
- A data de importação continua visível apenas como informação operacional.
- Somente adquirentes com registros na data selecionada são exibidas.
- Arquivos ficam agrupados em uma linha por adquirente e podem ser expandidos.
- Layouts técnicos recebem nomes amigáveis, incluindo CIELO03 = VENDAS, CIELO04 = PAGAMENTOS e CIELO16 = PIX.
- Registros brutos têm prioridade na contagem por arquivo; a tabela consolidada é usada como fallback.
