# ERPxADQUIRENTE v0.1.69

Versão com bootstrap automático do PostgreSQL e tabelas compatíveis com os importadores atuais.

## Setup local do PostgreSQL

```bash
npm run db:bootstrap
cp backend/.env.example backend/.env
npm run dev
```

O backend cria/garante as tabelas usadas pelo app: importações, linhas importadas, vendas ERP/INTERDATA, vendas adquirentes, conversões e tabelas brutas SIPAG/CIELO/SICREDI.
