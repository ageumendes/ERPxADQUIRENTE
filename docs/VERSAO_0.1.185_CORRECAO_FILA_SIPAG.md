# v0.1.185 — Correção de fila SIPAG

## Problema
A v0.1.184 executava uma consulta e possível atualização por registro do relatório complementar SIPAG dentro de uma transação única. Relatórios com ~15 mil linhas podiam aparentar travamento da fila.

## Correção
- Carregamento único dos registros SIPAG complementares já existentes.
- Correspondência em memória pela chave estabelecimento + autorização + data + hora + valor.
- INSERT em lotes pelo mecanismo PostgreSQL já existente.
- UPDATE complementar em lotes de até 250 registros.
- A classificação do arquivo agora é persistida imediatamente, antes da gravação pesada, evitando DESCONHECIDO/AGUARDANDO_CLASSIFICACAO durante processamento.
- Mantida independência da ordem de importação entre autorizações e vendas realizadas.
