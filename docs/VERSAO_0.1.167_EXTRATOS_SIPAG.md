# v0.1.167 — Extratos SIPAG e estabelecimento

Novos layouts, explicitamente identificados como **EXTRATO** e não como EDI:

- SIPAG - EXTRATO Transações autorizadas;
- SIPAG - EXTRATO Vendas PIX;
- SIPAG - EXTRATO Vendas a receber;
- SIPAG - EXTRATO Vendas recebidas.

`codigo_estabelecimento` é normalizado para dígitos, gravado nas vendas de autorizações/PIX, exposto na tela de vendas e materializado em uma coluna física indexada de `vendas_adquirentes`.

Os extratos financeiros a receber/recebidos ficam em tabelas brutas próprias e não geram novas vendas, impedindo duplicação de faturamento e conciliação.
