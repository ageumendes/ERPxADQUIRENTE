# v0.1.171 — Correção do PIX indevido nas autorizações SIPAG

Uma conversão histórica havia transformado bandeiras vazias em `PIX` antes da migração v0.1.170. Por isso, os 12.586 registros de crédito, débito e voucher foram ignorados pela primeira correção.

Na inicialização, a v0.1.171:

- limita a correção ao layout `SIPAG_EXTRATO_TRANSACOES_AUTORIZADAS`;
- exige modalidade `CREDITO`, `DEBITO` ou `VOUCHER`;
- substitui bandeira vazia ou `PIX` pelo BIN extraído do cartão mascarado;
- grava o BIN também em `bandeira_original`, impedindo reaplicação da conversão antiga;
- mantém os dados do cartão e o critério da correção em `dados_json`;
- não altera vendas dos layouts PIX reais.
