# Versão 0.1.94 — Motor híbrido de conciliação

## Resultado

A conciliação automática deixa de cortar a pesquisa nos primeiros 5.000 registros. No PostgreSQL, as vendas ERP pendentes são percorridas em lotes e cada lote pesquisa candidatos em toda a base de adquirentes.

## Regras

- SIPAG e CONVCARD: NSU normalizado + valor em centavos + data.
- CIELO, SICREDI, VR e demais: valor + data + modalidade + horário normalizado.
- SICOOB PIX: mesma regra temporal, com correção de quatro horas.
- CIELO, SICREDI, SIPAG, CONVCARD e VR: correção de uma hora.
- Até 120 segundos: match seguro.
- De 121 a 300 segundos: `MATCH_PROVAVEL`, sem confirmação automática por padrão.
- Mais de 300 segundos: candidato descartado.
- Um candidato só é aceito se for exclusivo nos dois sentidos (1 ERP ↔ 1 adquirente).

## Endpoints

### Simular sem gravar

`POST /api/conciliacoes/automaticas/simular`

### Executar

`POST /api/conciliacoes/automaticas/executar`

Corpo opcional:

```json
{
  "dataInicial": "2026-07-01",
  "dataFinal": "2026-07-31",
  "adquirentes": ["SIPAG", "CONVCARD", "CIELO", "SICREDI", "VR", "SICOOB"],
  "tamanhoLote": 500,
  "confirmarAutomatico": true,
  "incluirProvaveis": false
}
```

O modo de simulação não cria conciliações nem altera vendas. A execução preserva vínculos existentes e processa somente registros pendentes.

## Banco de dados

A inicialização aplica a migração `0.1.94` e cria índices parciais para registros pendentes, data, valor, adquirente e NSU. As restrições e transações já existentes continuam protegendo o vínculo um para um.

Antes de atualizar em produção, faça backup do PostgreSQL. Não use `docker compose down -v`.
