# v0.1.81 - Revisão de Conciliação Automática

## O que foi adicionado

- Ações na tela `/conciliacoes` para confirmar sugestão de match.
- Ação para desfazer uma conciliação e devolver os dois registros para `PENDENTE`.
- Endpoint `/api/conciliacoes/relatorio-regras` com o relatório técnico das regras usadas no match ERP x Adquirente.

## Funcionamento atual da conciliação automática

A conciliação automática já está funcionando usando a tabela central `conciliacoes`, que liga uma venda da tabela `vendas_adquirentes` com uma venda da tabela `vendas_interdata`.

Quando existe match, o app grava:

- `conciliacoes.venda_adquirente_id`
- `conciliacoes.venda_interdata_id`
- `conciliacoes.tipo_match`
- `conciliacoes.score`
- `conciliacoes.criterios_usados`
- `conciliacoes.diferenca_valor`
- `conciliacoes.diferenca_dias`
- `vendas_adquirentes.conciliacao_id`
- `vendas_interdata.conciliacao_id`
- `status_conciliacao`, `score_conciliacao` e `tipo_match` nas duas tabelas de venda.

## Colunas usadas no match

### Regra 1 - NSU

Adquirente:

- `nsu`
- `valor_bruto`
- `data_venda`
- `terminal`
- `modalidade`

ERP/INTERDATA:

- `nsu`
- `valor_bruto`
- `data_venda`
- `terminal`
- `tipo_produto` ou `forma_pagamento`

### Regra 2 - Autorização

Adquirente:

- `codigo_autorizacao`
- `valor_bruto`
- `data_venda`
- `terminal`
- `modalidade`

ERP/INTERDATA:

- `codigo_autorizacao` ou `autorizacao`
- `valor_bruto`
- `data_venda`
- `terminal`
- `tipo_produto` ou `forma_pagamento`

### Regra 3 - Valor + Data

Adquirente:

- `valor_bruto`
- `data_venda`
- `terminal`
- `modalidade`

ERP/INTERDATA:

- `valor_bruto`
- `data_venda`
- `terminal`
- `tipo_produto` ou `forma_pagamento`

## Score

- `>= 90`: vira `CONCILIADO` automático.
- `60 até 89`: vira `SUGERIDO` para revisão manual.
- `< 60`: não cria match.

