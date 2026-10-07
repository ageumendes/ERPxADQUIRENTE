# ERPxADQUIRENTE v0.1.236

## Controle de acesso administrativo

- `Duplicidades`, `Auditoria / Reversões`, `Banco de Dados` e `Usuários` são exclusivos do perfil `ADMINISTRADOR`.
- Para os demais perfis, os itens administrativos não aparecem no menu.
- Acesso direto às rotas `/duplicidades`, `/auditoria-reversoes`, `/banco` e `/users` redireciona para `/conciliacoes`.
- O backend também bloqueia os endpoints `/api/duplicidades`, `/api/auditoria`, `/api/banco` e `/api/usuarios` para usuários não administradores.
- Demais áreas e regras de conciliação/importação permanecem inalteradas.
