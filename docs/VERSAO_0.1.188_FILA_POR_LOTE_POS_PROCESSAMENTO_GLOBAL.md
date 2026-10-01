# ERPxADQUIRENTE v0.1.188 — Fila por lote e pós-processamento global

## Objetivo

A fila de importação consome todos os arquivos sequencialmente. As conversões automáticas deixam de ser disparadas imediatamente entre arquivos e passam a executar uma única vez após o fechamento do lote.

## Comportamento

- Enquanto houver arquivo atual ou `pendentes > 0`, não inicia pós-processamento.
- Ao zerar a fila, abre uma janela configurável de fechamento do lote (`IMPORTACOES_FECHAMENTO_LOTE_MS`, padrão 120000 ms).
- Se outro arquivo chegar durante essa janela, o timer é cancelado e o novo arquivo entra no mesmo lote.
- Quando a fila permanece vazia, as conversões automáticas executam uma única vez e depois a conciliação automática.
- Se um arquivo chegar com o pós-processamento já em execução, ele permanece enfileirado e o worker é retomado automaticamente no `finally`.
- Falhas no pós-processamento continuam isoladas da fila e não derrubam o backend.
- Coleta SFTP mantém fronteira explícita de lote e pode iniciar o pós-processamento imediatamente após todos os providers terminarem.

## Telemetria

Novos logs principais:

```text
[fila-importacao] fila vazia; pós-processamento do lote agendado em 120000ms.
[fila-importacao] novo arquivo recebido; pós-processamento agendado foi adiado para o fim do lote.
[fila-importacao] fila_vazia=true; iniciando_pos_processamento=true
[conversoes-automaticas] aplicando regras UMA vez após conclusão de TODOS os arquivos do lote.
[fila-importacao] pos_processamento_finalizado=true tempo_ms=...
```
