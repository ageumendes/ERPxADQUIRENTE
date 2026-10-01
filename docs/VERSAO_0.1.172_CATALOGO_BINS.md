# v0.1.172 — Catálogo de BINs e conversões automáticas

Foi criada a tabela PostgreSQL `catalogo_bins`, com BIN único, bandeira, status, origem, ativação, observação e datas de controle.

Na inicialização e nas consultas do catálogo:

- conversões existentes de BIN são migradas como identificações confirmadas;
- BINs observados nas vendas SIPAG são incluídos sem duplicação;
- BINs sem bandeira ficam com status `PENDENTE`;
- decisões já existentes nunca são substituídas por descoberta automática.

Na tela da tabela `conversoes`, a seção **Catálogo de BINs** exibe quantidades, modalidades e situação. Ao identificar ou atualizar um BIN, o backend cria ou atualiza uma conversão exata para `vendas_adquirentes.bandeira`, com escopo SIPAG quando uma regra compatível ainda não existe.

O botão **Aplicar conversões** continua sendo o comando explícito que transforma os registros já importados.
