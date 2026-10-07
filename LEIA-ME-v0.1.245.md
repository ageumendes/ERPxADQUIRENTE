# ERPxADQUIRENTE v0.1.245

Remove carga, arquivo de referência, funções locais/online e estilos do catálogo BIN. Nenhuma identificação de bandeira pelo número do cartão. A bandeira permanece a recebida no arquivo; ausente no arquivo, permanece vazia. Os campos originais dos layouts continuam preservados.

Ao iniciar, remove somente catalogo_bins e catalogo_bins_referencia, conforme solicitado. Não exclui vendas, conciliações ou originais. Regras antigas de bandeira numérica de seis posições permanecem desativadas para auditoria. Não desfaz automaticamente conversões históricas já aplicadas.

Extraia em pasta nova. Copie seu backend/.env da instalação anterior, mantendo os mesmos segredos. Pare o app antigo, execute npm run setup e npm run dev. Para produção, siga deploy/ubuntu/INSTALACAO.md. Faça backup antes de atualizar o banco.
