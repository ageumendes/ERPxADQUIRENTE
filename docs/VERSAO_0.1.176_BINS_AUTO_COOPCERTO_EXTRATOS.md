# v0.1.176 — BINs automáticos e extratos COOPCERTO

## Consulta automática de BINs

- O backend agenda internamente a consulta dos BINs pendentes.
- O primeiro ciclo ocorre após 120 segundos e os seguintes, por padrão, a cada 65 minutos.
- O intervalo nunca pode ser inferior a 60 minutos.
- Cada rodada consulta no máximo `BIN_LOOKUP_LIMIT_PER_RUN` códigos (padrão: 5).
- Uma trava impede rodadas simultâneas.
- BINs resolvidos pela base local ou anteriormente pela internet não são consultados novamente.
- O BIN bruto permanece armazenado; a bandeira identificada é usada na apresentação e nos filtros.

Configuração:

```env
BIN_LOOKUP_BASE_URL=https://lookup.binlist.net
BIN_LOOKUP_LIMIT_PER_RUN=5
BIN_LOOKUP_AUTO_ENABLED=true
BIN_LOOKUP_AUTO_INTERVAL_MINUTES=65
BIN_LOOKUP_AUTO_INITIAL_DELAY_SECONDS=120
BIN_LOOKUP_API_KEY=
```

## COOPCERTO

Foram separados três layouts do portal:

1. `COOPCERTO_CABAL_VENDAS_CSV`: vendas realizadas; continua gerando `vendas_adquirentes`.
2. `COOPCERTO_EXTRATO_VENDAS_A_RECEBER`: recebíveis futuros; grava somente a tabela bruta `coopcerto_extrato_vendas_a_receber`.
3. `COOPCERTO_EXTRATO_VENDAS_RECEBIDAS`: valores liquidados com dados bancários; grava somente `coopcerto_extrato_vendas_recebidas`.

Os dois extratos financeiros são identificados explicitamente como **EXTRATO**, nunca como EDI. Eles não geram vendas canônicas novamente, evitando duplicação das vendas realizadas.
