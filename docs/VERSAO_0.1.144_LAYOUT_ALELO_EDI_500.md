# v0.1.144 — Layout ALELO EDI 500 posições

Base: v0.1.143.

## Escopo

Suporte inicial aos arquivos EDI recebidos via SFTP do usuário `alelo_sftp`.

Subtipos reconhecidos:

- `ALELO01`
- `ALELO02`
- `NAIP04`
- `NAIP05`

Todos os arquivos observados usam registros posicionais de 500 caracteres, header `00` e trailer `99`.

## Importação canônica

Somente registros `02` de `ALELO02` e `NAIP05` são convertidos em `vendas_adquirentes` nesta etapa.

Campos canônicos principais:

- adquirente: `ALELO`
- bandeira: `ALELO`
- modalidade: `VOUCHER`
- parcelas: `1/1`
- data: posições 81-88 (`AAAAMMDD`)
- valor: sinal na posição 105 + posições 106-119, em centavos
- NSU/identificador transacional: posições 62-70
- EC filial: posições 8-17
- operação: posições 71-74

O layout observado não apresenta horário transacional inequívoco; nenhum horário é inventado.

## ECs mapeados

Conforme habilitação informada pela ALELO:

- `1096033906` → `27752608000129`
- `2787774975` → `27752608000129`
- `6000290924` → `27752608000200`
- `2762041915` → `27752608000129`

O registro bruto preserva o EC original e informa se houve mapeamento.

## Arquivos financeiros

`ALELO01` e `NAIP04` são reconhecidos e persistidos na tabela bruta `alelo_layout`, mas não geram venda canônica nesta versão. Isso evita misturar registros financeiros/resumos com transações de venda antes de existir documentação formal desses tipos.

Arquivos sem movimento (somente `00`/`99`) são classificados como `PROCESSADO` com zero vendas, em vez de `LAYOUT_DESCONHECIDO`.

## Validações

- 500 posições por linha;
- header `00` e trailer `99`;
- subtipo por header ou nome do arquivo;
- datas válidas;
- EC com 10 dígitos nos registros `02`;
- fechamento, por código de operação, entre resumo `06` e soma dos detalhes `02` para `ALELO02`/`NAIP05`.

## Amostras reais usadas na validação

- `ALELO02`: 6 vendas; resumos `R003` e `R001` fechando com os detalhes.
- `NAIP05`: 1 venda; resumo `R001` fechando com o detalhe.
- `ALELO01`: reconhecido e armazenado como bruto, sem venda canônica.
- `NAIP04`: reconhecido; amostras sem movimento, zero vendas.
