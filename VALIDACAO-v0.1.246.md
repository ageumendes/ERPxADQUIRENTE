# Validação v0.1.246

191 testes: 189 aprovados, zero falhas, dois ignorados por fixtures ausentes. Build backend/frontend, imports ESM e worker Excel aprovados.

Arquivo real Arquivosrg.xls: 11.745 registros. Todos os líquidos correspondem ao original Vlr. Liquido; todos os valores brutos, hashes e dados originais são iguais aos produzidos na v245. Arquivo do usuário não incluído no pacote.

Regressão SQL isolada em PGlite valida recuperação do líquido histórico, precisão de cinco casas, zero informado, ausência de líquido, preservação do líquido já preenchido, bruto/hash/original/conciliation e repetição sem alteração adicional.

Não houve conexão ao banco ou servidor do usuário. Homologação Ubuntu/PostgreSQL nativo e restauração real permanecem necessárias antes da operação financeira.
