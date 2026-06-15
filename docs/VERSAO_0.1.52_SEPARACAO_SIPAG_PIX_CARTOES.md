# Versão 0.1.52 - Separação SIPAG S por PIX e Cartões

## Objetivo

Evitar que registros PIX e registros de cartão dos arquivos `S` do SIPAG fiquem misturados em uma mesma tabela bruta com colunas de significados diferentes.

## Alterações

- `sipag_layout_2_0_s` foi separado em:
  - `sipag_layout_2_0_s_pix`
  - `sipag_layout_2_0_s_cartoes`
- `sipag_fiserv_layout_7_6_s` foi separado em:
  - `sipag_fiserv_layout_7_6_s_pix`
  - `sipag_fiserv_layout_7_6_s_cartoes`
- Registro `001` é tratado como PIX.
- Registros diferentes de `001` no arquivo `S` são gravados na tabela de cartões.
- A tabela canônica `vendas_adquirentes` continua recebendo os registros normalizados para telas e relatórios.

## Observação

As tabelas antigas dos arquivos `S` deixam de ser usadas para novas importações. Os arquivos `P` e `R` permanecem sem alteração.
