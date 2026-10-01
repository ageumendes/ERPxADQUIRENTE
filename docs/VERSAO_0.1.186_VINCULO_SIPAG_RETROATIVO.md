# v0.1.186 — Vínculo SIPAG retroativo

## Problema
Na v0.1.185 o mecanismo de complementaridade consultava somente vendas já criadas pelos novos layouts de extratos SIPAG. Vendas SIPAG preexistentes, importadas por layouts anteriores, ficavam fora do índice de correspondência. Assim, uma reimportação podia mostrar 0 novos registros e ainda não enriquecer as vendas existentes.

## Correção
- A busca de candidatos agora considera qualquer registro canônico com adquirente SIPAG.
- A chave de vínculo continua restritiva: estabelecimento + autorização + data + hora + valor.
- Um registro SIPAG legado pode atuar como lado financeiro quando recebe uma autorização nova compatível.
- Registros já complementados preservam `sipag_autorizacao` e `sipag_financeiro` em reprocessamentos posteriores.
- O vínculo confirmado recebe `dados_json.vinculo_complementar_sipag = SIM` e `fontes_complementares`.
- Nenhuma nova venda é criada quando uma linha existente pode ser enriquecida; o mesmo `row_id` é mantido.
