# Versão 0.1.127 — novos provedores SFTP e redirecionamento ao login

## Provedores SFTP

O coletor centralizado passa a consultar nove usuários no mesmo servidor:

- `alelo_sftp`
- `cielo_sftp`
- `convcard_sftp`
- `pluxee_sftp`
- `sicoob_sftp`
- `sicredi_sftp`
- `sipag_sftp`
- `ticket_sftp`
- `vr_sftp`

Todos usam, por padrão, as pastas `/in`, `/processed` e `/error`. A chave privada e a fingerprint do host continuam centralizadas; cada provedor pode sobrescrever usuário, senha, fingerprint e diretórios pelas variáveis `REMOTE_EDI_<PROVEDOR>_*`.

ALELO, PLUXEE e TICKET aceitam na triagem as extensões suportadas pelo pipeline. A identificação do conteúdo continua sendo feita pelo classificador antes da gravação.

## Autenticação do frontend

- A raiz e qualquer rota protegida redirecionam para `/login` quando não existe sessão completa.
- Uma sessão local só é aceita quando usuário e token estão presentes.
- Respostas HTTP `401` sempre removem usuário e token locais.
- Após login válido, `/login` é substituída pela rota inicial protegida.

