# SIPAG, versão 0.1.215

O relatório `TRANSACOES_AUTORIZADAS` grava todas as linhas originais na tabela bruta. Na tabela `vendas_adquirentes`, somente as linhas de situação `RECUSADA`, `NEGADA` ou `REJEITADA` criam vendas com status `NEGADO`. As linhas aprovadas permanecem disponíveis no extrato bruto; as vendas autorizadas são obtidas do EDI.

## Antes de reimportar o relatório já processado

No diretório raiz do projeto, execute o diagnóstico somente de leitura:

```bash
npm --prefix backend run auditar:sipag -- --importacao 43685f51-a081-417a-9b4d-80e31f834812
```

Confirme o identificador na linha correspondente do histórico caso o seu banco tenha um ID diferente. Envie o resultado para preparar a limpeza preservando vendas EDI, conciliações e vouchers.

O relatório anterior acrescentou vendas e atualizou vendas antigas. A base não guarda uma cópia completa anterior àquelas atualizações; excluir todas as vendas pelo ID da importação ou excluir apenas o registro do histórico **não reverte** o efeito da importação. Não reimporte o arquivo original antes de concluir a limpeza das vendas e do histórico ou ele será identificado como duplicado.
