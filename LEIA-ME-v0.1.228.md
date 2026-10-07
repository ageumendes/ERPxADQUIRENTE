# ERPxADQUIRENTE v0.1.228

Correções focadas na Central de Conciliações:

- recarrega os candidatos manuais sempre com o período/filtros atualmente aplicados, evitando listas antigas;
- usa `conciliacao_id IS NULL` como vínculo autoritativo para candidatos manuais, evitando ocultar registros por `status_conciliacao` histórico;
- mantém adquirentes restritos a `AUTORIZADO`, agora via coluna técnica indexável `status_filtro`;
- usa colunas técnicas de estabelecimento/adquirente nos filtros;
- adiciona índices parciais e compostos para pendências por data/estabelecimento/status em `vendas_interdata` e `vendas_adquirentes`;
- nenhuma regra de match automático (`NSU_NORMALIZADO`, `MATCH_CONTEXTO_HORA` etc.) foi alterada;
- dados originais JSONB/EDI/ERP permanecem intactos.
