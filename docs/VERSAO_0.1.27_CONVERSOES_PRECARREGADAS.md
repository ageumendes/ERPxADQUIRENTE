# Versão 0.1.27 - Conversões pré-carregadas

Esta versão inclui a tabela local `storage/db/conversoes.json` já preenchida com 70 regras de conversão fornecidas no arquivo `conversoes.json`.

## Observação

O script `npm run preparar:pastas` preserva arquivos JSON já existentes em `storage/db`. Portanto, ao iniciar esta versão em um diretório limpo, a tabela de conversões já aparece preenchida no frontend em `/imports` ou na tela de banco/tabelas.

## Compatibilidade

Foram mantidas as correções da versão anterior:

- backend separado em camadas;
- build TypeScript corrigido;
- PostgreSQL usando `pg`, sem exigir `prisma generate`;
- modo JSON/local funcionando sem banco.
