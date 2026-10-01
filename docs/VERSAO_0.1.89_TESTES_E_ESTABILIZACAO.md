# Versão 0.1.89 — Testes e estabilização

Esta versão inaugura a suíte automatizada do backend e encerra o ciclo de blindagem iniciado na 0.1.82.

## Cobertura adicionada

- classificação de JSON Sicoob recebido por SFTP;
- parser diário e rejeição de arquivos inválidos;
- reconsulta PIX com identidade determinística por `endToEndId`;
- atualização de devolução sem criar uma nova identidade;
- conciliação segura por NSU;
- proibição de confirmação automática por valor e data isolados;
- rejeição por CNPJ incompatível;
- conflito entre NSU e autorização;
- perfis de escrita e bloqueio do perfil Auditor;
- migrações 0.1.84 e 0.1.85 sem `TRUNCATE`.

## Execução

```bash
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend run build
```

Testes integrados com PostgreSQL devem usar exclusivamente um banco descartável:

```bash
TEST_DATABASE_URL=postgresql://usuario:senha@localhost:5432/erpxadquirente_test npm --prefix backend run test:postgres
```

Nunca use a URL do banco de produção em `TEST_DATABASE_URL`.
