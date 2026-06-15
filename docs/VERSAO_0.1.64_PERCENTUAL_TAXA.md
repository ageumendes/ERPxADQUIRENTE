# v0.1.64 - Percentual da taxa em vendas_adquirentes

## Objetivo
Adicionar a coluna canônica `percentual_taxa` em `vendas_adquirentes`, calculada a partir dos valores já normalizados da venda.

## Fórmula

```txt
percentual_taxa = (valor_taxa / valor_bruto) * 100
```

- Quando `valor_bruto` estiver vazio, zero ou inválido, o percentual é gravado como `0.0000`.
- `valor_taxa` continua sendo normalizado como valor positivo antes do cálculo.
- A tela `/adquirentes-vendas` exibe a coluna como percentual brasileiro, por exemplo `1,5000%` ou `0,00%`.

## Endpoint de correção de dados antigos

```bash
curl -X POST http://localhost:3333/api/vendas-adquirentes/recalcular-percentual-taxa
```

Esse endpoint percorre todos os registros já existentes em `vendas_adquirentes`, recalcula `percentual_taxa` e grava novamente a tabela.

## Endpoint de normalização

O endpoint já existente também recalcula o percentual:

```bash
curl -X POST http://localhost:3333/api/vendas-adquirentes/normalizar
```
