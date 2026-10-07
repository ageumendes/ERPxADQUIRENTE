# ERPxADQUIRENTE v0.1.246

Vlr. Parcela continua em valor_bruto e exibido como VALOR BRUTO. Vlr. Liquido passa também a valor_liquido, mantendo a precisão informada e os dados originais. Telas /erp-vendas e tabela ERP de /conciliacoes exibem ambos lado a lado. Comparações e impressão da tabela ERP incluem o líquido. Na comparação ele é informativo, sem alterar o motor.

Ao iniciar, preenche somente valor_liquido vazio a partir de dados_originais nos registros existentes em vendas_interdata. Não recalcula valores e não altera bruto, hashes, originais ou conciliações. Quando o original não informa líquido, o campo fica ausente/vazio e a interface mostra ausência, sem inventar zero. Não exige reimportação.

Inclui todas as correções anteriores, com catálogo BIN removido. Faça backup antes de atualizar. Extraia em pasta nova, copie backend/.env da versão anterior mantendo segredos, execute npm run setup e npm run dev. Para Ubuntu, consulte deploy/ubuntu/INSTALACAO.md. O banco real do usuário não foi acessado.
