# Versão 0.1.182 — Ajustes finos de filtros e busca

- Removidos os filtros visuais **Duplicidade** e **Conciliação** das telas de vendas ERP e vendas das adquirentes.
- Removido o padrão oculto `SEM_DUPLICADOS`, evitando filtragem invisível após a retirada do seletor.
- Padronizada a ordem dos filtros: **Busca → Data inicial → Data final → Estabelecimento → Adquirente** (quando aplicável).
- Em Relatórios Adquirentes, adicionado o filtro **Busca** e movido **Estabelecimento** para antes de **Adquirente**.
- A busca agora também consulta **valor_bruto**, **valor_taxa** e **valor_liquido**, aceitando valores digitados com vírgula ou ponto decimal.
- O endpoint de relatórios passou a receber `busca` e deixou de encaminhar os antigos parâmetros de duplicidade/conciliação.
