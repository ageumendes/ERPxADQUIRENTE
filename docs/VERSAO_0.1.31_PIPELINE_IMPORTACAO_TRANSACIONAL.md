# v0.1.31 - Pipeline de importação transacional

Ajustes principais:

- Watcher passa a tratar também arquivos com nomes gerados pelo sistema que ficaram acumulados em `storage/importacoes/entrada`.
- Endpoints específicos de importação agora apenas registram e enfileiram; o processamento real passa pela fila única.
- Todo arquivo deve seguir o fluxo físico: `entrada -> processando -> processados|erro|desconhecidos`.
- Arquivos duplicados por hash são bloqueados e movidos para `processados` com prefixo `duplicado-`.
- Controle em memória evita enfileirar duas vezes o mesmo caminho enquanto ele já está na fila ou em processamento.
- Mantidos os nomes de tabelas compatíveis com os importadores atuais.

Endpoint de monitoramento:

```txt
GET /api/importacoes/fila/status
```

Observação: ao subir esta versão com arquivos antigos acumulados em `entrada`, o watcher vai arquivando aos poucos conforme `IMPORTACOES_WATCHER_MAX_POR_VARREDURA`.
