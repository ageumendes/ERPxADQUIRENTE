# ERPxADQUIRENTE v0.1.106

## Mudanças operacionais

- PostgreSQL passou a ser obrigatório. A aplicação não inicia sem `DATABASE_URL`.
- Usuários, auditoria, metadados de segurança, chave SFTP e histórico de coletas são persistidos no PostgreSQL.
- A chave privada SFTP é enviada somente por usuário administrador, validada e protegida com AES-256-GCM derivado de `AUTH_SECRET`.
- O conteúdo da chave nunca é devolvido pela API.
- Após importação confirmada e movimento remoto para `/processed`, as cópias locais temporária e processada do EDI são excluídas.
- Em qualquer falha, o arquivo é preservado para diagnóstico e o provider retorna falha parcial.

## Conciliação

- Janela de data: D-1, D e D+1.
- Candidatos com parcelas diferentes são rejeitados quando os dois lados informam parcelas.
- Registros parcelados são avaliados antes dos registros à vista/sem parcelas.
- Candidato bilateralmente único e sem conflito, com score maior que 50, é conciliado automaticamente.
- Empates e relações um-para-muitos continuam bloqueados como ambíguos.

## Conversões

- O seed contém 97 regras válidas provenientes do cadastro aprovado.
- A sincronização é idempotente por `row_id` e atualiza regras oficiais já existentes.
- Regras com coluna `A EXCLUIR` e a regra inválida de `tem_devolucao` são removidas.
- **Aplicar conversões** percorre todas as tabelas configuradas e usa `<coluna>_original` quando presente, permitindo corrigir uma conversão já aplicada anteriormente.

## Primeiro boot

Configure no mínimo:

```env
DATABASE_URL=postgresql://USUARIO:SENHA@localhost:5432/erpxadquirente
POSTGRES_ADMIN_URL=postgresql://USUARIO:SENHA@localhost:5432/postgres
AUTH_SECRET=<resultado de openssl rand -hex 48>
ADMIN_INITIAL_PASSWORD=<senha temporária com 12 ou mais caracteres>
REMOTE_EDI_ENABLED=true
REMOTE_EDI_HOST=<host do servidor>
```

Ao clicar pela primeira vez em **Coletar arquivos**, selecione a nova chave privada. Ela não deve ser copiada para a pasta do aplicativo.
