# v0.1.177 — Proteção do pool PostgreSQL

## Causa da queda

O explorador `GET /api/banco/tabelas` executava um `COUNT(*)` por tabela dentro de `Promise.all`. Com aproximadamente quarenta tabelas, a rota disputava simultaneamente todas as conexões do pool com conversões e conciliação pós-importação. Um timeout de aquisição escapava do handler assíncrono do Express 4 e encerrava o backend.

## Correção

- As contagens exatas agora são reunidas em uma única consulta `UNION ALL`, usando somente uma conexão do pool.
- As rotas de lista e detalhe do explorador capturam falhas temporárias do PostgreSQL.
- Em saturação excepcional, a API responde HTTP 503 com `BANCO_TEMPORARIAMENTE_OCUPADO`, sem encerrar o processo Node.
- A consulta automática de BINs e os layouts COOPCERTO da v0.1.176 permanecem preservados.
