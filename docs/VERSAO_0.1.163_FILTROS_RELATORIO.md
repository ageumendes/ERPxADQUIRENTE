# ERPxADQUIRENTE v0.1.163 — Simplificação dos filtros financeiros e períodos automáticos

## Alterações

- Removidos da tela do relatório financeiro os filtros **Duplicidade** e **Conciliação**.
- Esses campos também deixaram de compor o estado, a URL e as requisições do relatório.
- Os atalhos **Hoje**, **Ontem**, **Últimos 7 dias**, **Mês atual** e **Mês anterior** agora atualizam as duas datas e executam a consulta imediatamente.
- Uma consulta anterior ainda em andamento é cancelada pelo mecanismo introduzido na v0.1.162, evitando resultados fora do período selecionado.
- CSV, Excel e impressão passam a exibir somente os filtros que continuam disponíveis na tela.

## Comportamento dos dados

Sem os filtros removidos, o relatório não restringe vendas pelo estado de duplicidade nem pelo estado de conciliação. Permanecem disponíveis os filtros de período, adquirente, forma de pagamento, modalidade, bandeira e status.
