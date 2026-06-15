# v0.1.38 - Importações em tempo real e logo Tigre

- Adiciona logo do Supermercado Tigre no frontend.
- Atualiza `/api/importacoes/poll` para retornar fila, SFTP, pastas, resumo e lista recente de importações.
- Atualiza `/imports` com polling a cada 2 segundos.
- Exibe status por arquivo: recebido, fila, classificando, processando, processado, duplicado, layout desconhecido e falha.
- Exibe pasta física final: `processados`, `erro/duplicidades`, `erro/layout_desconhecido`, `erro/falha_importacao`.
- Exibe contadores de registros, processados, erros e detalhe da mensagem.
