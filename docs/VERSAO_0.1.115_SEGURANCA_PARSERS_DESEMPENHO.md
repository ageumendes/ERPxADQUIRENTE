# v0.1.115 — Segurança dos parsers e desempenho

## Parsers

Planilhas `.xls` e `.xlsx` continuam compatíveis com os arquivos históricos do ERP,
mas a dependência legada é executada somente em um processo filho. O processo principal
impõe timeout, limite de memória, linhas e células. Arquivos de texto também recebem
limites de linhas e comprimento de linha antes do parser específico.

Variáveis disponíveis:

```env
PARSER_TIMEOUT_MS=30000
PARSER_MEMORY_MB=256
PARSER_MAX_ROWS=200000
PARSER_MAX_CELLS=2000000
PARSER_MAX_LINE_LENGTH=1000000
```

## PostgreSQL

O explorador usa `COUNT(*)` separado e página SQL com `LIMIT/OFFSET`. A API aceita
opcionalmente `cursor_pk`, devolvendo `proximo_cursor`. As inserções são agrupadas em
lotes de 250 registros e o próprio `ON CONFLICT DO NOTHING RETURNING` contabiliza
inseridos e duplicados, eliminando o padrão N+1.

A migration `0.1.115` remove os índices GIN genéricos de todas as tabelas e os índices
de terminal que deixaram de atender filtros. Permanecem índices específicos das consultas
de vendas, conciliação, data, modalidade, bandeira, NSU e relacionamentos.

## Retenção

```env
RETENCAO_PROCESSADOS_DIAS=0
RETENCAO_ERROS_DIAS=0
RETENCAO_LOGS_DIAS=30
```

Zero desativa a exclusão. Assim, a atualização não apaga arquivos processados ou de erro
sem uma decisão explícita do administrador. A limpeza roda no boot e uma vez por dia.

## Frontend

A CSP rígida continua ativa em `npm run preview` e na implantação de produção. Ela não é
enviada por `npm run dev`, pois o React Fast Refresh do Vite requer um preâmbulo inline.
Isso corrige o erro `@vitejs/plugin-react can't detect preamble` observado na porta 5173.
