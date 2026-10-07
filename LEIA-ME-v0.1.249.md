# ERPxADQUIRENTE v0.1.249

## Ajustes de apresentação

- Vendas adquirentes: líquido vazio, ausente, “-” ou numericamente zerado passa a mostrar o bruto. Exemplo SIPAG PIX: bruto 4,41 e líquido ausente exibem líquido R$ 4,41. Líquidos informados diferentes de zero, inclusive negativos, são preservados na apresentação.
- Hora compacta HHMMSS de CONVCARD/FACER, EDENRED/TICKET, SIPAG e outras adquirentes passa a HH:MM:SS. Exemplos: 120325 → 12:03:25; 171229 → 17:12:29; 183432 → 18:34:32; 095514 → 09:55:14.
- Hora vazia/ausente ou “-” passa a 00:00:00. Horas já formatadas permanecem padronizadas, incluindo segundos. Uma hora compacta válida é exibida corretamente, sem ser confundida com ausência de hora. Valores inválidos não são convertidos silenciosamente em horas fictícias.
- Aplicação nas listagens ERP/adquirentes, comparações e conciliação. Líquido com substituição somente no lado adquirente; líquido ERP permanece como informado. Impressão da listagem de adquirentes usa a mesma apresentação.

Tudo é formatação do frontend. Não altera o banco, dados originais EDI/EXTRATOS, taxas, cálculos dos relatórios, importadores, conversões ou critérios de conciliação. A exibição 00:00:00 para ausência não fornece uma hora real ao motor de conciliação. Não precisa reimportar os arquivos. Mantidas as correções de desempenho e o modal de parcelas da v0.1.248.

## Atualização

Extraia em pasta nova, preserve backend/.env com os mesmos segredos e banco, mantenha o storage atual e execute npm run setup e npm run dev. Faça backup antes da atualização. Para produção: npm run build e instruções de deploy/ubuntu/INSTALACAO.md.

## Validação

Build backend/frontend aprovado. Suite existente: 196 testes, 194 aprovados, nenhuma falha, dois ignorados por ausência de fixtures. Verificações diretas dos formatadores aprovadas para exemplos dos prints, horas vazias, zeros em formatos decimal brasileiro/decimal com ponto, líquido informado/negativo e preservação do objeto original. Prints enviados inspecionados. Não houve teste visual da versão nova em navegador nem acesso ao banco/servidor do usuário.
