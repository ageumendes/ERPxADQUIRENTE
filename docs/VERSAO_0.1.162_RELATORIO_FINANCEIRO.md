# ERPxADQUIRENTE v0.1.162 — Modularização do relatório financeiro e otimização das consultas

## Entregas

- Página `RelatoriosAdquirentesPage` extraída do `main.tsx`, preservando filtros, atalhos de período, análises, CSV, Excel e impressão/PDF.
- Contratos do relatório centralizados em `frontend/src/types/relatorios.ts`.
- Estado e carregamento isolados em `useRelatorioFinanceiro`, com filtros persistentes na URL e cancelamento da requisição anterior.
- Seis agrupamentos financeiros passaram a reutilizar uma única CTE `MATERIALIZED` em uma consulta com `UNION ALL`.
- Índices dedicados para período/adquirente, status da transação e duplicidade.
- Migração `0.1.162` registrada e teste estrutural cobrindo versão, modularização e otimizações.

## Impacto nas consultas

Antes, resumo diário, adquirente, forma, modalidade, bandeira e terminal executavam seis consultas independentes sobre a mesma base filtrada. Agora esses seis agrupamentos são calculados em um único round-trip ao PostgreSQL, cuja base filtrada é materializada uma vez dentro da instrução.

As consultas com semânticas diferentes — resumo executivo, análise detalhada, histórico de bandeiras e opções encadeadas — permanecem independentes e paralelas para preservar exatamente seus filtros e resultados.

## Compatibilidade

- PostgreSQL continua sendo a única persistência operacional; não há leitura ou gravação de JSON local.
- A rota `/api/relatorios-adquirentes` e o formato da resposta foram mantidos.
- Bancos já existentes recebem os novos índices no bootstrap por `CREATE INDEX IF NOT EXISTS`.
