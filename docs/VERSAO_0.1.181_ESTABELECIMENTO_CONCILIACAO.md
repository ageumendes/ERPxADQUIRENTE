# v0.1.181 — Estabelecimento e segurança da conciliação

- O importador SICOOB PIX usa o CNPJ presente no nome do arquivo; no nome diário sem CNPJ, usa `27752608000129`.
- Conversões de estabelecimento com resultado `NAO APLICA` ou `NÃO APLICA` funcionam como lista negra lógica e auditável.
- Registros bloqueados não aparecem nas listagens de vendas, relatórios financeiros ou Central de Conciliações.
- Nenhum registro é apagado: desativar ou remover a conversão restaura sua elegibilidade.
- Todos os motores de conciliação exigem estabelecimento preenchido e idêntico antes de avaliar qualquer outra regra.
- A confirmação manual também recusa estabelecimentos bloqueados, ausentes ou divergentes.
