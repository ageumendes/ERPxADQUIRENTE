# v0.1.59 - Conversões na gravação canônica das adquirentes

A gravação em `vendas_adquirentes` agora aplica a tabela `conversoes` de forma centralizada para todos os layouts importados pela pasta `storage/importacoes/entrada`.

## Regras

- A função central `salvarVendasAdquirentes` consulta `conversoes` antes de persistir.
- As conversões são aplicadas aos campos convertíveis da venda canônica, incluindo `adquirente`, `modalidade`, `bandeira`, `status_transacao`, `terminal`, etc.
- Quando houver conversão, o valor anterior é preservado em `<campo>_original`.
- Campos técnicos como `id`, `importacao_id`, `layout_origem`, `hash_linha`, `linha_original`, `dados_json` e datas internas não são convertidos.
- Regras com `adquirente_aplicacao` continuam sendo respeitadas.

## Benefício

Qualquer layout que alimente `vendas_adquirentes` passa pela mesma régua de conversão, incluindo SICOOB PSP PIX, CIELO, SIPAG, SICREDI e CONVCARD.
