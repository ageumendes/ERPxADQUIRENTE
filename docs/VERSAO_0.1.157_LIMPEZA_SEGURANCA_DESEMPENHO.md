# ERPxADQUIRENTE v0.1.157 — Limpeza, segurança e desempenho

## Esclarecimento sobre PostgreSQL JSONB

O aplicativo permanece com persistência exclusivamente em PostgreSQL. JSONB é um tipo de coluna do PostgreSQL usado nas tabelas para preservar os campos originais e canônicos de cada registro; não representa retorno à persistência em arquivos JSON.

## Alterações principais

- autorização explícita nas reversões de duplicidades e conversões;
- versão unificada em backend, frontend e pacotes;
- segredos removidos do `.env.example` e placeholders rejeitados em execução;
- dashboard diário ampliado para COOPCERTO, ALELO, PLUXEE e TICKET;
- pool PostgreSQL compartilhado entre repositório, autenticação e SFTP;
- busca de importação por hash executada diretamente no PostgreSQL;
- índices para hash e status/data das importações;
- histórico do polling limitado a 500 itens;
- polling alterado para 7 segundos, sem sobreposição e pausado em aba oculta;
- encerramento gracioso do servidor e do pool;
- restauração do seletor de chave privada e do teste SFTP na interface;
- remoção de código, assets e artefatos comprovadamente sem uso no pacote final.

## Segurança operacional

Antes de iniciar a versão, configure valores reais e independentes para `AUTH_SECRET`, `SFTP_ENCRYPTION_KEY` e `ADMIN_INITIAL_PASSWORD`. Valores com o prefixo `SUBSTITUA_` são deliberadamente rejeitados.
