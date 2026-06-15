# v0.1.29 - Correção importação XLS no PostgreSQL

Correções:

- Corrige erro PostgreSQL `unsupported Unicode escape sequence` durante importação de arquivos XLS/Excel antigos.
- Sanitiza caracteres NUL (`\u0000`) e substitutos Unicode inválidos antes de gravar em colunas JSONB.
- Mantém os nomes atuais das tabelas usados pelos importadores.
- Adiciona log completo no console para erros assíncronos de importação/parsers.

Motivo técnico:

Arquivos XLS antigos podem trazer caracteres invisíveis/controle no conteúdo das células. Ao gravar o registro inteiro em `dados JSONB`, o PostgreSQL rejeita JSON contendo `\u0000`.
