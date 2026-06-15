# Versão 0.1.44 - Ordenação global e paginação lateral de vendas

- Corrige `/api/vendas-adquirentes` para ordenar todas as adquirentes em uma única lista por data/hora de venda decrescente.
- Corrige `/api/vendas-erp` para ordenar por data/hora de venda decrescente antes da paginação.
- Adiciona suporte a `offset` nos endpoints de vendas para navegação de 1000 em 1000.
- Ajusta as telas `Vendas ERP` e `Vendas Adquirentes` com botões circulares laterais: `<` para 1000 anteriores e `>` para próximos 1000.
- Normaliza horas compactas como `193708` para `19:37:08` durante a ordenação.
