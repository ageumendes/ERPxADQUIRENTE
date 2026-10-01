# ERPxADQUIRENTE v0.1.160 — Modularização das páginas e testes de inicialização

## Frontend

- `DuplicidadesPage`, `AuditoriaReversoesPage` e `UsersPage` foram extraídas do `main.tsx` para `frontend/src/pages`;
- formatação monetária, datas e valores de tabela foi centralizada em `frontend/src/lib/formatters.ts`;
- o ponto de entrada foi reduzido de 3.562 para aproximadamente 3.169 linhas sem alterar rotas ou contratos de API;
- as próximas páginas podem ser migradas gradualmente usando a mesma estrutura.

## Inicialização e ESM

- adicionado `backend/scripts/verificar-imports-esm.mjs`;
- `npm run test:startup` percorre o grafo local do backend e verifica se cada import nomeado possui export correspondente;
- o teste detecta antes da execução a classe de erro que afetou o Remote EDI na primeira entrega da v0.1.159;
- a suíte automatizada inclui uma proteção arquitetural para as páginas extraídas.

## Compatibilidade

Não há alteração destrutiva no PostgreSQL, nas rotas HTTP ou no formato das respostas. A persistência permanece exclusivamente no banco de dados.
