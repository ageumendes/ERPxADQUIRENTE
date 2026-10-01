# v0.1.178 — Catálogo de BINs em sobreposição

## Objetivo

Evitar que o Catálogo de BINs desloque para fora da tela o formulário e a tabela de conversões no explorador do banco de dados.

## Alterações

- O catálogo fica minimizado por padrão em uma barra com os totais e o botão **Abrir catálogo**.
- O conteúdo completo abre em um diálogo sobreposto, amplo e com rolagem própria.
- O diálogo pode ser fechado pelo botão, pela tecla `Esc` ou por clique na área escura externa.
- A rolagem da tela de fundo fica bloqueada enquanto o diálogo estiver aberto.
- Filtros, identificação manual, consulta online e criação de conversões foram preservados.
- Em telas pequenas, o catálogo ocupa a tela inteira para manter a tabela utilizável.

## Banco de dados

Esta atualização não altera tabelas nem dados operacionais. A versão é registrada em `schema_migrations` apenas para rastreabilidade.
