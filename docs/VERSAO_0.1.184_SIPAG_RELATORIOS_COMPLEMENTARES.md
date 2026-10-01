# v0.1.184 — SIPAG: relatórios complementares sem ordem de importação

- `Relatório de vendas` passa a gerar a venda financeira canônica SIPAG.
- `Relatório de autorizações` continua aceitando aprovadas/recusadas.
- A chave complementar é estabelecimento + autorização + data + hora + valor total.
- Se qualquer arquivo chegar primeiro, cria-se o registro disponível; quando o outro chegar, o mesmo registro é enriquecido via upsert.
- Vendas parceladas criam uma única venda canônica (primeira parcela), mantendo todas as parcelas na tabela bruta.
- Status de autorização e status de processamento são preservados separadamente em `dados_json`.
- Recusadas e aprovadas sem venda financeira permanecem válidas como tentativas/autorização.
