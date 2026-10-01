# v0.1.180 — Estabelecimento nas vendas e relatórios

## Interface

- A tela **Vendas ERP** passa a exibir a coluna **Estabelecimento**.
- As telas **Vendas ERP**, **Vendas Adquirentes** e **Relatórios Adquirentes** recebem o filtro **Estabelecimento**.
- O filtro é um seletor alimentado pelos estabelecimentos realmente presentes no banco.
- O valor selecionado é preservado na URL das três telas.
- Exportações do relatório registram o estabelecimento entre os filtros aplicados.

## Campos consultados

- `vendas_interdata`: `cnpj_estabelecimento`, com fallback para `codigo_estabelecimento`.
- `vendas_adquirentes`: `codigo_estabelecimento`, com fallback para `cnpj_estabelecimento`.

## Persistência

Não há alteração destrutiva ou migração dos registros. O filtro consulta diretamente os valores já armazenados no JSONB do PostgreSQL.
