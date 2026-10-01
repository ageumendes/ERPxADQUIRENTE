# v0.1.170 — Correção dos BINs SIPAG já importados

Ao iniciar o backend, uma migração idempotente corrige as vendas antigas do layout `SIPAG_EXTRATO_TRANSACOES_AUTORIZADAS` cuja bandeira esteja vazia.

A migração:

- lê `dados_json["Nº cartão"]`;
- remove a máscara e preserva os seis primeiros dígitos;
- grava o BIN em `bandeira`;
- registra `bin_cartao` e `criterio_bandeira` dentro de `dados_json`;
- não altera registros com bandeira já preenchida;
- não afeta outros layouts ou adquirentes;
- pode ser executada novamente sem produzir alterações adicionais.

Depois da migração, as regras cadastradas para `vendas_adquirentes.bandeira` podem ser aplicadas normalmente pela tela de conversões/normalização.
