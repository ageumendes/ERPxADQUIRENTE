# v0.1.217 — horário SICOOB e consulta rápida de conciliação

- O parser SICOOB aceita o JSON com `beneficiario`, `consulta`, `resumo`, `geradoEm`, `ambiente`, `tipoColeta` e `raw`. Identifica a loja pelo CNPJ no nome do arquivo, como antes. O array `pix` continua obrigatório e não vazio.
- O timestamp `horario` do PIX, inclusive o `Z` e o JSON bruto, permanece original. `data_venda` e `hora_venda` da tabela SICOOB e da venda adquirente passam a usar `America/La_Paz`. Arquivos sem fuso explícito não geram hora derivada, evitando aplicar deslocamento presumido.
- Uma marca técnica (`horario_fuso_aplicado`) nas novas vendas SICOOB evita o desconto adicional de quatro horas na conciliação. O legado sem a marca mantém a regra antiga. Nenhuma migração ou alteração de vendas anteriores é executada.
- As telas ERP e Adquirentes limitam a coluna NSU a 50 px e exibem o valor completo no tooltip. O indicador verde abre a comparação dos dados vinculados via endpoint de detalhes; o indicador vermelho abre a venda isolada, sem presumir correspondência.

## Verificação

- Compilação backend e frontend concluídas.
- Testes de parser SICOOB e motor híbrido: 20 aprovações.
- JSON de exemplo com 104 PIX: 104 vendas processadas, nenhuma divergência entre as duas datas derivadas, uma virada de data para 23/09 no fuso La Paz.
