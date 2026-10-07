# ERPxADQUIRENTE v0.1.251 — preparação para produção

Base: v0.1.250 revisada. A v0.1.241 anexada foi utilizada para conferir a atualização do esquema, sem substituir as melhorias das versões seguintes. Nenhuma alteração foi aplicada ao banco DEV ou ao servidor do usuário nesta entrega.

## Correções financeiras

- Status COOPCERTO negativos são reconhecidos antes de autorização positiva, inclusive NÃO AUTORIZADO, NAO_AUTORIZADO, NOT_AUTHORIZED e UNAUTHORIZED.
- Pendente pode evoluir para autorizado na mesma identidade, sem duplicar. Um relatório pendente antigo não rebaixa uma venda concluída; autorizado antigo não reverte cancelamento.
- Contradições AUTORIZADO ↔ NEGADO, sem evidência temporal confiável, preservam os dados atuais e registram o recebido para revisão humana. Não se presume que a ordem de importação seja a ordem dos eventos financeiros.
- Mudança de status, valores ou identificadores em venda vinculada preserva a conciliação histórica e sinaliza revisão necessária. Bruto/data divergentes continuam bloqueando substituição automática; se houver vínculo protegido, também geram alerta.
- Revisão pendente bloqueia novas conciliações manuais, automáticas e vínculos voucher. Não desfaz conciliações existentes silenciosamente.
- Atualização, sinalização nas pontas vinculadas e histórico são gravados na mesma transação. Falha no histórico reverte a atualização financeira.
- Administrador/Financeiro pode justificar a manutenção dos dados atualmente armazenados pelo modal da venda. A tela envia a identidade do evento revisado; uma importação concorrente impede aprovar uma revisão desatualizada. A mesma informação já revisada não recria a pendência em reimportação.
- Venda não autorizada com conciliação exige desfazimento com justificativa. O estado recebido, a revisão e a decisão permanecem rastreáveis. Desfazer o vínculo não transforma a venda cancelada em autorizada.

As fontes originais e a finalidade das conversões pós-importação foram preservadas. O snapshot da revisão registra o recebido; não substitui o arquivo de origem.

## Interface

A coluna Conciliação mostra um alerta no lugar do ícone verde para registros com revisão pendente. O modal apresenta status e valores anteriores/recebidos. O histórico de Conciliados e seus detalhes também sinalizam a revisão, e o contador informa quantos vínculos exigem revisão no período. O total de conciliações confirmadas continua representando o vínculo histórico; o alerta identifica sua pendência de revisão.

Para cancelar uma conciliação: Conciliações → Conciliados → Ver detalhes → Desfazer conciliação, com motivo. Para manter os dados atuais após conferir os arquivos: abra o modal da venda da adquirente e registre a justificativa. Apenas ADMINISTRADOR/FINANCEIRO pode tratar a revisão.

## Operação Ubuntu

- Guia atualizado para v0.1.251 e nome correto SFTP_ENCRYPTION_KEY.
- Backup utiliza a versão do executável, sem número antigo fixo. Inclui banco, ambiente e storage; guarde também a versão da aplicação de origem ao fazer backup para upgrade.
- POSTGRES_POOL_MAX aceita apenas inteiros de 4 a 100; exemplo de produção: 12. Timeouts inválidos são recusados com identificação da variável. Isso evita uma capacidade mínima ocupada inteiramente pelo bloqueio de instância e uma tarefa de fundo.
- `/api/ready` informa estado do agrupamento SIPAG inicial e ocupação do pool, sem bloquear todas as consultas até o agrupamento terminar.
- HTML servido por Nginx revalida cache; assets com hash mantêm cache prolongado.
- Navegação, coleta e download SFTP limitados a ADMINISTRADOR, FINANCEIRO e OPERADOR. CONSULTA/AUDITOR não recebem os arquivos brutos por essas rotas.
- Novo comando `verificar:producao`: consulta somente de leitura para revisões COOPCERTO e vínculos históricos não autorizados. Não realiza bootstrap, correção ou desfazimento.

Leia os roteiros:

- `deploy/ubuntu/INSTALACAO.md`
- `deploy/ubuntu/ATUALIZAR-v0.1.241-PARA-v0.1.251.md`

**Atualização:** preserve os segredos válidos e o storage atual. Remova ADMIN_INITIAL_PASSWORD do ambiente ao atualizar banco que já possui usuários. Não utilize o plano COOPCERTO do DEV no servidor: simule novamente com os dados do destino e revise o plano antes de aplicar.

## Verificações executadas nesta entrega

| Verificação | Resultado |
|---|---|
| Instalação limpa `npm ci` na raiz/backend/frontend | Aprovada |
| Build backend/frontend | Aprovado |
| Suíte completa | 208 testes: 206 aprovados, 2 ignorados, zero falhas |
| Novas regressões COOPCERTO | Negativas, cancelamento, contradição, alterações financeiras, vínculos legados, idempotência e revisão humana aprovados |
| Falha induzida de histórico | Atualização e revisão humana revertidas transacionalmente |
| Smoke test de fontes ESM no ambiente de build | Aprovado |
| Verificação do pacote e worker Excel | Aprovada |
| Instalação apenas de dependências de produção em diretório separado | Aprovada |
| Worker Excel sem dependências de desenvolvimento | Aprovado |
| Imports estáticos do servidor sem dependências de desenvolvimento | Resolvidos; configuração placeholder rejeitada antes de acesso ao banco |
| Migração de esquema v0.1.241 → v0.1.251 | Aprovada em PGlite isolado com dados sintéticos: valores ERP, original adquirente, vínculo e conversões preservados; catálogos antigos removidos |
| Verificação de produção somente de leitura | Pendência detectada, saída 2 e dados inalterados no ensaio isolado |
| Renderização React do indicador | Alerta com descrição acessível; sem ícone verde na revisão pendente |
| npm audit raiz/backend/frontend | Zero vulnerabilidades reportadas |
| Sintaxe dos scripts backup/verificação | Aprovada |

O smoke test `test:startup` examina as fontes TypeScript e deve rodar antes de remover dependências de desenvolvimento. Para o pacote de produção, use `check:release` e a execução do servidor compilado. O ZIP inclui fontes, testes e builds; não inclui node_modules, segredos ou dados operacionais do usuário.

## Limites e liberação no servidor

Não foi executado PostgreSQL nativo, Nginx/TLS, SFTP real, dump/restore ou medição dos endpoints com o banco do servidor nesta sessão. PGlite valida SQL e transações dos cenários sintéticos; não mede concorrência entre conexões reais nem reproduz o volume da produção. Os dois testes ignorados dependem de fixtures reais ausentes na distribuição.

As correções do pacote passaram nas verificações disponíveis. Para liberar a operação financeira, ainda é necessário executar homologação com uma cópia protegida do banco/storage atuais, medir ERP/conciliação e restaurar um backup real em ambiente separado. O comando de verificação COOPCERTO não é uma auditoria financeira completa e não corrige inconsistências históricas automaticamente. Auditoria HTTP genérica continua assíncrona; falhas são registradas em log. Os registros financeiros de revisão/decisão desta correção são transacionais.

## Teste local

Na pasta extraída, utilize o ambiente DEV válido da versão anterior em `backend/.env`, sem publicar esse arquivo:

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm run preparar:pastas
npm run build
npm test
npm run test:startup
npm --prefix backend run check:release
npm run dev
```

Confira a operação local e depois siga o guia de homologação/Ubuntu. Não substitua o banco ou o storage por diretórios vazios. O agrupamento SIPAG e os ajustes anteriores de valores, horas, parcelas, status padrão e deduplicação foram mantidos.
