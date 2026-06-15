# v0.1.30 - Fila segura de importação

Ajustes principais:

- Adicionada fila sequencial de importação para evitar travamentos quando `storage/importacoes/entrada` tiver muitos arquivos.
- Fluxo de arquivos padronizado:
  - `storage/importacoes/entrada`
  - `storage/importacoes/processando`
  - `storage/importacoes/processados`
  - `storage/importacoes/erro`
  - `storage/importacoes/desconhecidos`
- Upload manual pelo frontend agora enfileira a importação e move o arquivo após a classificação.
- Watcher processa apenas uma quantidade limitada por varredura, configurável por `IMPORTACOES_WATCHER_MAX_POR_VARREDURA`.
- Coleta SFTP passa pela mesma fila de importação.
- Novo endpoint de diagnóstico:
  - `GET /api/importacoes/fila/status`

Variáveis úteis:

```env
IMPORTACOES_WATCHER_ENABLED=true
IMPORTACOES_WATCHER_INTERVAL_MS=5000
IMPORTACOES_WATCHER_MAX_POR_VARREDURA=10
```
