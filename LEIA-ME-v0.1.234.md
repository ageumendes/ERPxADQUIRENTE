# ERPxADQUIRENTE v0.1.234

Ajuste focado nas telas **Vendas ERP** e **Vendas Adquirentes**.

- A listagem passa a ocupar a altura real disponível dentro do `.page`, sem cálculo por `100vh` que conflitava com a escala responsiva da raiz em telas de 1280–1450 px.
- O painel e o viewport da tabela usam a cadeia flex (`height: 100%`, `min-height: 0`, `flex: 1`) e mantêm a rolagem dentro da tabela.
- A paginação não executa mais `scrollIntoView()` no painel. Ao trocar de página, somente o scroll interno da tabela volta ao topo/esquerda, evitando deslocar/descentralizar o app inteiro.
- Impressão/PDF e regras de importação/conciliação não foram alteradas.
