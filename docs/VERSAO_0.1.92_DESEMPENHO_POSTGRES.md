# ERPxADQUIRENTE v0.1.92 — Desempenho e concorrência

## Correções

- Filtros, ordenação, contagem e paginação de `vendas_adquirentes` e `vendas_interdata` executados diretamente no PostgreSQL.
- Listagens limitadas a 100 registros por página por padrão e 500 no máximo.
- Migração `0.1.92` executada uma única vez no bootstrap, sem DDL nas requisições comuns.
- Índices de data, adquirente, modalidade, bandeira, terminal e situação de conciliação.
- Conversões carregadas uma vez por resposta, eliminando leituras repetidas por registro.
- Gravações integrais feitas em lotes de 250 registros, sem `TRUNCATE`.
- Repetição automática limitada para deadlock (`40P01`) e falha de serialização (`40001`).
- Cancelamento da requisição anterior nas telas ERP e adquirentes.
- Log de duração e quantidade das consultas paginadas.

## Primeiro início

O primeiro início pode levar mais tempo porque executa a migração e cria índices. Os inícios seguintes apenas verificam o registro em `schema_migrations`.

## Log esperado

```text
[sql] listar vendas_adquirentes 120ms linhas=100 total=3117
```

## Compatibilidade

Mantidos os layouts existentes, VR 16AP, SICOOB PIX, conciliação automática, deduplicação, autenticação e telas atuais.
