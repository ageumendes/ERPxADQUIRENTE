# Validação v0.1.247

195 testes: 193 aprovados, nenhuma falha, dois ignorados por fixtures reais ausentes. Build backend/frontend, verificação ESM e worker Excel aprovados.

Regressões: grupo completo e precisão do líquido; incompletude; parcela repetida; lojas/datas/vendas/modalidades divergentes; bruto incompatível; NÃO APLICA; parcela já vinculada; adquirente diferente; duas SIPAG correspondentes; dois grupos disputando uma adquirente; parcela isolada coincidente com o total bloqueada.

Fluxo SQL real isolado em PGlite: criação e repetição sem duplicar; uma linha operacional e bruto 549,86; líquido 526,98; confirmação automática com SIPAG 549,86/535,50; IDs das parcelas no vínculo e auditoria; confirmação automática repetida sem outro vínculo; originais e hashes preservados; inspeção de duplicidades conserva parcelas; desfazer libera os vínculos; confirmação manual do grupo; alteração de parcela impede nova confirmação; grupo inválido sem vínculo libera originais.

Índices para seleção de parcelas, grupos e reservas. Bloqueio transacional compartilhado por importação, agrupamento e confirmação/reversão. Não houve teste de concorrência PostgreSQL nativo nem medição com volume do banco do usuário.

Sem acesso ao banco/Ubuntu do usuário e sem homologação visual em navegador do usuário. Testar cópia do banco/storage e restauração real antes de operação financeira. A aprovação dos testes isolados não certifica a instalação real de produção.
