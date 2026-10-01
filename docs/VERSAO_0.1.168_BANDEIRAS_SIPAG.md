# v0.1.168 — Bandeiras nos extratos SIPAG

As vendas do layout `SIPAG_EXTRATO_TRANSACOES_AUTORIZADAS` agora identificam a bandeira pelo BIN (seis primeiros dígitos preservados no cartão mascarado).

Critérios aplicados:

- Visa, Mastercard, Elo e Amex por faixas de BIN;
- Cabal (`604220`) e Pluxee (`603389`) por BINs comprovados pelos layouts já existentes no sistema;
- exceções Mastercard confirmadas pela coluna `Bandeira` dos extratos detalhados SIPAG;
- voucher sem BIN comprovado permanece como `VOUCHER`, sem atribuição especulativa.

A bandeira é gravada em `vendas_adquirentes.bandeira` e no registro bruto. O `dados_json` também preserva `bin_cartao` e `criterio_bandeira`, permitindo auditoria e inclusão segura de novos BINs.
