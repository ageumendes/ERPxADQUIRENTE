# Validação v0.1.245

190 testes: 188 aprovados, nenhuma falha, dois ignorados por fixtures reais ausentes. Build backend/frontend, verificação ESM e worker Excel aprovados.

Regressão SQL isolada em PGlite cria as duas tabelas BIN legadas, inclusive fonte obrigatória, executa bootstrap e confirma remoção. Reinicialização sem as tabelas também funciona. Não há inferência retroativa de bandeira pelo número do cartão. Original do cartão permanece preservado no extrato; sem bandeira explícita, bandeira fica vazia. Mantidas regressões de conciliação, NÃO APLICA e PIX.

Removidos quatro testes específicos das funcionalidades BIN descontinuadas; testes de importação atualizados para verificar o comportamento novo e preservação do original.

Nenhuma conexão ao banco real do usuário foi efetuada. Faça backup antes da atualização: ao iniciar, as duas tabelas auxiliares BIN serão removidas. Vendas, conciliações e registros brutos são preservados. Homologação PostgreSQL nativo/Ubuntu e restauração real continuam necessárias antes da operação financeira.
