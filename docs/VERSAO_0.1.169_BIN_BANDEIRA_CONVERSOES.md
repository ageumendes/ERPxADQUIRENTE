# v0.1.169 — BIN na bandeira e conversões administráveis

O layout `SIPAG_EXTRATO_TRANSACOES_AUTORIZADAS` grava os seis primeiros dígitos do cartão mascarado diretamente em `vendas_adquirentes.bandeira`.

Exemplos:

- `604220` permanece `604220` até a aplicação da conversão `604220 → CABAL`;
- `603389` permanece `603389` até a aplicação da conversão `603389 → PLUXEE`;
- `439267` pode ser convertido para `VISA`.

O importador não traduz nem presume a bandeira. Assim, o valor original permanece auditável e as associações podem ser cadastradas, corrigidas ou desfeitas pelo módulo de conversões sem mudança de código.

O `dados_json` preserva também `bin_cartao` e `criterio_bandeira`.
