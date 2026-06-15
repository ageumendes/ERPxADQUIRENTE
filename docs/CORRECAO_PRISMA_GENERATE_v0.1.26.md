# Correção Prisma generate - v0.1.26

## Problema

O backend tinha `postinstall: prisma generate`, mas o arquivo `backend/prisma/schema.prisma` não possuía nenhum `model`.

Com isso, durante `npm --prefix backend install`, o Prisma falhava com:

```txt
You don't have any models defined in your schema.prisma, so nothing will be generated.
```

Depois disso o backend iniciava quebrando em runtime com:

```txt
@prisma/client did not initialize yet. Please run "prisma generate"
```

## Solução aplicada

Foi adicionado um model técnico mínimo `AppMetadata` no schema Prisma.

A versão v0.1.26 ainda usa SQL manual com tabelas dinâmicas JSONB, portanto esse model não muda a lógica de importação, parsers, rotas ou conciliação. Ele apenas permite que o Prisma Client seja gerado corretamente durante o install.

Tabela criada em futuro `prisma db push`:

```txt
app_metadata
```

Essa tabela é técnica e pode ser mantida até a migração relacional definitiva.
