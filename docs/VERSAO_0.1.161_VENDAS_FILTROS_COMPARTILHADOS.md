# ERPxADQUIRENTE v0.1.161 — Modularização das páginas de vendas e filtros compartilhados

## Frontend

- `VendasErpPage` e `VendasAdquirentesPage` foram extraídas para `frontend/src/pages`;
- tipos de vendas foram centralizados em `frontend/src/types/vendas.ts`;
- filtros, paginação responsiva, renderizadores de logos e utilitários de paginação agora são módulos compartilhados;
- filtros permanecem na URL, permitindo atualizar, compartilhar e retornar à consulta;
- busca textual por NSU, autorização, terminal ou ID utiliza debounce de 350 ms;
- cada nova consulta cancela a anterior com `AbortController`.

## Backend

- endpoints de vendas aceitam o parâmetro `busca`;
- a pesquisa ocorre diretamente no PostgreSQL, combinada com os demais filtros e paginação;
- o valor pesquisado é parametrizado, sem interpolação de entrada do usuário no SQL;
- a busca cobre `nsu`, `codigo_autorizacao`, `terminal`, `id_venda_erp` e `id`.

## Estrutura

O `frontend/src/main.tsx` foi reduzido de aproximadamente 3.169 para 2.370 linhas. Rotas e formatos de resposta existentes foram preservados.
