# ERPxADQUIRENTE v0.1.235

Ajuste pontual sobre a v0.1.234.

- `/erp-vendas` e `/adquirentes-vendas`: quantidade de linhas por página agora é calculada pela altura útil real do viewport interno da tabela.
- O cálculo mede o cabeçalho e uma linha renderizada, adaptando-se automaticamente à resolução e à escala responsiva do app.
- `ResizeObserver` recalcula quando a área da tabela muda; `MutationObserver` refina o cálculo quando as linhas chegam da API.
- Mantidos os limites de segurança de 5 a 100 registros por página.
- Preservadas impressão/PDF, filtros, regras de conciliação/importação e correção de scroll da v0.1.234.
