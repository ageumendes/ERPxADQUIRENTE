# ERPxADQUIRENTE v0.1.221

## Alterações

- Importador `INTERDATA_MOVIMENTO_30D`: antes de gravar, compara cada linha do novo layout com o histórico de `vendas_erp` usando uma chave comercial conservadora (CNPJ/loja + id_venda_erp + data + hora + valor + tipo + bandeira + NSU + parcelas). Linhas já existentes não são reinseridas. `id_venda_erp` isolado não é usado como chave única.
- O `hash_linha` estável do novo layout continua sendo usado para impedir reimportações do próprio layout novo.
- `/conciliacoes`: candidatos ERP marcados `DUPLICADO_PROVAVEL` são ocultados; candidatos de adquirentes também excluem duplicados e exigem `status_transacao = AUTORIZADO`.
- `/erp-vendas` e `/adquirentes-vendas`: Bandeira = 100px, Parcelas = 50px e Conciliação = 50px, sem reduzir a fonte. Cabeçalhos limitados usam reticências e `title` com o nome completo.
- Larguras configuráveis em `frontend/src/lib/columnWidths.ts`, aceitando px, percentual ou fração convertida para percentual.
- `/conciliacoes`: Bandeira = 100px e Parcelas = 50px nas tabelas manuais. Essa tabela não possui uma coluna chamada `Conciliação`.

## Segurança dos dados

A v0.1.221 não executa limpeza retroativa nem DELETE/UPDATE das duplicidades já existentes. A correção atua apenas nas próximas importações do novo layout e na filtragem visual/operacional da Central de Conciliações.
