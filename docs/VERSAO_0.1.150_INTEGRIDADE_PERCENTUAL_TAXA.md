# v0.1.150 — Integridade do Percentual de Taxa

`percentual_taxa` é um campo derivado de `valor_bruto` e `valor_taxa`.

## Regras

1. Novas vendas recebem o percentual calculado na persistência.
2. Após todas as conversões cadastradas, o percentual é recalculado por último.
3. `vendas_adquirentes.percentual_taxa` não aceita conversão manual.
4. O recálculo histórico ocorre pelo fluxo de normalização já existente.
5. Quando `valor_bruto` é zero ou inválido, o percentual canônico é `0.0000`.

Fórmula: `abs(valor_taxa) / abs(valor_bruto) * 100`.
