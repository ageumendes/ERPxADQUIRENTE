# ERPxADQUIRENTE v0.1.238

Ajuste isolado de responsividade da tela **Importações**.

- O histórico de importações passa a ocupar apenas a altura útil restante do workspace.
- Scroll vertical fica interno à tabela, sem estourar a viewport em telas grandes.
- O cabeçalho permanece sticky.
- A paginação responsiva passa a medir a altura real da tabela de importações (`db-data-table`) em vez de depender do fallback da janela.
- Nenhuma regra de importação, SFTP, conciliação ou permissão foi alterada.
