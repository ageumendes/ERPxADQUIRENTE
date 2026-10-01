# ERPxADQUIRENTE v0.1.187 — Estabilidade pós-importação SIPAG

## Correções

- impede concorrência entre o worker de importação e o pós-processamento automático de conversões;
- adiciona retry com espera incremental para deadlocks PostgreSQL (`40P01` / `deadlock detected`);
- falha no pós-processamento deixa de encerrar o processo Node e de abandonar a fila;
- evita retry recursivo infinito quando o pós-processamento falha;
- log SIPAG passa a separar registros brutos inseridos, vendas inseridas, vendas existentes atualizadas/vinculadas e duplicadas;
- coluna **Processados** dos extratos SIPAG considera vínculos/updates efetivos quando os registros brutos já existiam;
- versão exibida pelo backend e frontend sincronizada para `0.1.187`.

## Motivo

Na v0.1.186 um pós-processamento iniciado após um lote podia continuar executando enquanto novos arquivos começavam a ser importados. As duas rotinas atualizavam `vendas_adquirentes` simultaneamente e podiam entrar em deadlock, especialmente em regras de `codigo_estabelecimento`. A exceção era relançada pelo worker e encerrava o backend.
