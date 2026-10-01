# v0.1.179 — Estabelecimento no novo layout ERP INTERDATA

## Novo cabeçalho reconhecido

O relatório ERP pode trazer, na primeira linha, a razão social na primeira célula e o CNPJ do estabelecimento acima das vendas. Exemplo:

- Razão social: `COMERCIO VAREJISTA DE ALIMENTOS TIGRE LTDA`
- CNPJ: `27.752.608/0001-29`

## Comportamento

- O CNPJ é localizado nas primeiras linhas e validado pelos dígitos verificadores.
- A pontuação é removida e o valor é gravado como `27752608000129` em `cnpj_estabelecimento` de cada item do arquivo.
- O mesmo valor chega à tabela canônica `vendas_interdata`.
- A razão social e o CNPJ do relatório são preservados em `dados_originais` para auditoria.
- O layout posicional anterior continua aceito; quando não houver CNPJ no cabeçalho, o campo mantém o comportamento anterior.
- Um CNPJ apenas parecido, mas inválido, não é propagado.

## Reimportação

Arquivos já importados não são alterados automaticamente por esta versão. Para preencher o estabelecimento em registros antigos, é necessário excluir/reimportar o arquivo correspondente ou executar uma migração retroativa específica após confirmar a relação entre arquivo e estabelecimento.
