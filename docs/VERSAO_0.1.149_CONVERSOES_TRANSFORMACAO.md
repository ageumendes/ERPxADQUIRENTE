# v0.1.149 — Conversões por transformação

## Novo tipo de regra

O formulário de conversões agora aceita:

- **Valor exato**: comportamento existente.
- **Transformação de data**: aplica uma transformação reutilizável a todos os valores compatíveis.

Exemplo recomendado:

- Tabela: `vendas_adquirentes`
- Coluna: `data_venda`
- Tipo: `Transformação de data`
- Formato origem: `DDMMYYYY`
- Formato destino: `YYYY-MM-DD`
- Adquirente: `Todas / não se aplica`

A regra converte automaticamente valores como `20082026` para `2026-08-20`.

## Segurança da transformação

A transformação valida dia, mês e ano. Valores que não formem uma data válida não são alterados.

Quando aplicada a `vendas_adquirentes.data_venda`, o valor anterior é preservado em `data_venda_original`.

## Valor original vazio

Regras do tipo **Valor exato** aceitam `valor_original` vazio. Tanto campo vazio quanto somente espaços são normalizados para `''`.

Isso permite regras como:

`'' → VALOR_REAL`

sem bloquear o cadastro no backend.

## Compatibilidade

Conversões existentes que não possuam `tipo_conversao` continuam sendo interpretadas como `VALOR_EXATO`.
