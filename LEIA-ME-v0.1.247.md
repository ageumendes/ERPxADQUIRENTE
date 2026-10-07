# ERPxADQUIRENTE v0.1.247

Agrupamento de crédito parcelado ERP para conciliar com a venda completa SIPAG. Cria uma venda ERP derivada, sem alterar valores/hashes/dados_originais das parcelas. Elas permanecem no banco com reserva do grupo e ficam fora das listagens/totais operacionais. O grupo substitui as parcelas no total, sem somar ambos.

## Requisitos

Mesma loja, Código da Venda ERP, NSU, data, bandeira, modalidade crédito e horário ERP. Exige 1/N até N/N completos, sem repetição, vínculos existentes, NÃO APLICA ou duplicidade provável. Exige exatamente uma venda SIPAG autorizada com mesmo bruto total, NSU, data, loja, bandeira e número total de parcelas. Dois grupos disputando a mesma adquirente impedem o agrupamento. Vendas sem identificação ERP suficiente permanecem para revisão. Escopo somente SIPAG crédito; demais adquirentes/modalidades mantidas.

Parcelas ERP isoladas 1/N ou N/N, N>1, não podem conciliar com SIPAG crédito sem o grupo completo, mesmo se o bruto coincidir. ERP legado com campo contendo somente o total de parcelas, sem fração, segue a regra anterior. Não divide a venda SIPAG nem inventa taxas por parcela.

## Funcionamento

Consulta ERP, consulta de conciliações e execução automática atualizam os agrupamentos. A execução automática reavalia o grupo na transação. Mostra “N parcelas” expansível nas tabelas ERP e comparações; bruto e líquido consolidados visíveis. Líquidos são somados preservando a precisão dos originais e exibidos em duas casas; a diferença líquida é informativa. Regra SIPAG continua NSU + bruto + data sobre a venda consolidada.

Confirmação automática/manual e reversão atualizam atomicamente o vínculo derivado das parcelas, registrando seus IDs na conciliação e no histórico. Somente a venda derivada utiliza conciliacao_id principal, preservando restrições 1×1; parcelas utilizam conciliacao_agrupamento_id e status_agrupamento. Parcela reservada não pode ser conciliada à parte.

Desfazer limpa os vínculos das parcelas e deixa o grupo pendente. Se os originais mudarem ou a correspondência deixar de ser única, nova confirmação fica bloqueada. Na atualização seguinte, um grupo sem vínculo principal inválido fica inativo e libera suas parcelas. Grupos já vinculados/confirmados não são alterados automaticamente; revisar e desfazer quando necessário. Parcelas com sugestões/vínculos históricos existentes não são absorvidas: revise os vínculos antes. Simulação não cria grupos; analisa os já existentes.

## Atualização

Faça backup do banco e storage. Extraia em pasta nova; copie backend/.env da versão anterior mantendo segredos. Execute npm run setup e npm run dev no DEV. Não exige reimportação de dados elegíveis já presentes. Para Ubuntu, siga deploy/ubuntu/INSTALACAO.md. Mantidos valor_bruto, valor_liquido e remoção do catálogo BIN. Não foi acessado seu servidor/banco real.
