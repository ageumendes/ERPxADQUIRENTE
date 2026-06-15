# Correção PostgreSQL sem dependência obrigatória do Prisma - v0.1.26

## Problema

A versão anterior tinha `postinstall: prisma generate`, mas o `schema.prisma` não possuía modelos reais. Isso fazia `npm --prefix backend install` falhar e deixava o backend quebrando ao importar `PrismaClient`.

## Solução aplicada

O backend passou a usar `pg` diretamente para a camada PostgreSQL dinâmica já existente.

Com isso:

- `npm --prefix backend install` não executa mais `prisma generate`.
- O backend sobe em modo JSON/local sem exigir Prisma Client gerado.
- Quando `DATABASE_URL` estiver configurado e `PERSISTENCIA_POSTGRES` não estiver `false`, `0` ou `json`, o app usa PostgreSQL via `pg`.
- As tabelas dinâmicas JSONB continuam sendo criadas automaticamente pelo repositório.

## Observação

O arquivo `backend/prisma/schema.prisma` foi mantido apenas como referência temporária da migração, mas não é mais necessário para rodar a aplicação nesta etapa.
