# ERPxADQUIRENTE v0.1.241

Correção isolada para reconhecer PIX SIPAG e SICOOB que representam a mesma operação financeira.

- Regra forte: SIPAG PIX + SICOOB PIX com o mesmo EndToEndId = mesma operação.
- Os dois registros continuam preservados em `vendas_adquirentes`; nenhum registro original é apagado ou mesclado.
- O vínculo é registrado somente como metadado derivado no JSON (`pix_operacao_compartilhada`, `pix_end_to_end_id`, `pix_registro_par_id`, `pix_fonte_par`, `pix_vinculo_criterio`, `pix_fonte_primaria`, `pix_redundante`).
- Se um dos dois já estiver conciliado, ele permanece como fonte primária, preservando o histórico.
- Se nenhum estiver conciliado, SICOOB é a fonte primária e SIPAG fica como fonte redundante/complementar.
- Se ambos já estiverem conciliados, nenhum é ocultado da conciliação por esta regra e ambos recebem `pix_vinculo_conflito=AMBOS_CONCILIADOS` para auditoria.
- Registros marcados `pix_redundante=SIM` deixam de disputar conciliação automática e manual 1x1 com o ERP.
- A sincronização roda no bootstrap para alcançar dados históricos e após novas gravações em `vendas_adquirentes`.
- Nenhuma regra de importação original, horário/fuso, SFTP, paginação ou frontend foi alterada.
