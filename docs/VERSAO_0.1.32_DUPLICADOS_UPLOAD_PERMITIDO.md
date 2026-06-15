# v0.1.32 - Upload permite duplicados com arquivamento seguro

- O frontend não bloqueia mais a tentativa de envio quando o arquivo já foi importado.
- O backend aceita o arquivo duplicado com HTTP 202, move o arquivo físico para `storage/importacoes/processados` com prefixo `duplicado-` e não reprocessa registros.
- A fila continua protegendo contra duplicidade por hash.
- Mantido o fluxo transacional `entrada -> processando -> processados/erro/desconhecidos`.
