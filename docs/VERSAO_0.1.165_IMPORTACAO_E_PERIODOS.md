# v0.1.165 — Importação SFTP e períodos do relatório

- Os cards de resultado por adquirente ficam em uma única linha rolável.
- Nome da adquirente e status aparecem lado a lado.
- As quantidades exibidas são recontadas no diretório `/in` após a coleta.
- O arquivamento remoto tenta `rename` e usa upload confirmado + exclusão como fallback seguro.
- O atalho **Hoje** foi removido.
- A URL do relatório é atualizada sem navegação do React Router, impedindo uma consulta automática ao mês atual.
