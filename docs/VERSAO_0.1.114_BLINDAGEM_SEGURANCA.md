# v0.1.114 — Blindagem de segurança urgente

## Mudanças incompatíveis de configuração

Antes de iniciar, defina uma senha PostgreSQL própria. O Compose não aceita mais
senha padrão e publica a porta somente em `127.0.0.1`.

A autenticação e a criptografia da chave SFTP usam segredos independentes:

- `AUTH_SECRET`: assinatura dos tokens;
- `SFTP_ENCRYPTION_KEY`: criptografia AES-256-GCM da chave privada SFTP.

Se uma chave SFTP já estiver armazenada, mantenha temporariamente o
`AUTH_SECRET` anterior. No primeiro uso, ela será descriptografada com o segredo
legado e recifrada automaticamente com `SFTP_ENCRYPTION_KEY`.

## Fingerprint SFTP

A conexão é recusada se `REMOTE_EDI_HOST_FINGERPRINT` não estiver configurada.
Use a fingerprint SHA-256 confirmada por um canal confiável com o administrador
do servidor. Também é possível configurar uma fingerprint por provider, por
exemplo `REMOTE_EDI_VR_HOST_FINGERPRINT`.

## Senhas de usuários

O cadastro, a senha inicial do administrador e a troca obrigatória aceitam
senhas com 8 ou mais caracteres. O valor 8 é mínimo, não tamanho fixo.

## Uploads

O limite padrão e máximo é 50 MB. Arquivos `.xls` e `.xlsx` têm a assinatura
binária conferida antes da classificação. A segurança avançada e o isolamento
do parser XLSX permanecem planejados para a v0.1.115.
