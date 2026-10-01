# Relatório financeiro de impressão e exportação

Os botões CSV, Excel e Imprimir da tela `/relatorios-adquirentes` passam a gerar um relatório financeiro completo com os dados de `vendas_adquirentes`, respeitando os filtros efetivamente aplicados.

## Estrutura

- identificação do período, filtros e data/hora de emissão;
- resumo executivo com bruto, taxas, líquido, transações, ticket médio e taxa efetiva;
- quantidades por status financeiro;
- detalhamento hierárquico por adquirente, forma de pagamento, modalidade e bandeira;
- transações, valor bruto, valor das taxas, taxa efetiva e valor líquido em todos os níveis;
- evolução diária do período.

## Impressão

A impressão abre um documento próprio em A4 paisagem. Não é uma captura da página da aplicação. O documento possui cabeçalhos de tabela repetidos, linhas protegidas contra quebra, identificação da fonte e numeração de páginas quando suportada pelo navegador.

## Exportações

- CSV: contém resumo, detalhamento completo e evolução diária em seções sequenciais.
- Excel: recebe o mesmo relatório visual e hierárquico da impressão.

O conteúdo sempre inclui todas as adquirentes retornadas pelos filtros, independentemente da posição atual do painel rotativo.
