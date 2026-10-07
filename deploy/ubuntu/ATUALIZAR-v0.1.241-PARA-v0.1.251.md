# Atualizar v0.1.241 → v0.1.251 no Ubuntu

Execute primeiro em homologação com uma cópia do banco e do storage. Os comandos não foram executados no seu servidor. O ZIP v0.1.241 foi conferido e não contém os units `deploy/ubuntu` da versão atual; confirme o gerenciador de serviço, usuário, caminho do Node, ambiente e storage que o servidor realmente utiliza.

## Antes de interromper a operação

1. Anote a versão atual, caminho do código e serviço. Verifique `systemctl status erpxadquirente` se esse for o nome utilizado; não inicie outro backend sobre o mesmo banco.
2. Localize o arquivo de ambiente e o storage real. Confira se contém originais, estados de recuperação, arquivos processando e diretórios SFTP. A atualização não deve criar um storage vazio paralelo.
3. Preserve a configuração original em backup protegido. Não coloque `.env`, banco, storage, chaves ou planos contendo dados reais no GitHub.
4. Preserve AUTH_SECRET e SFTP_ENCRYPTION_KEY válidos. O nome correto da chave de cifragem é SFTP_ENCRYPTION_KEY. Se a credencial legada só abre com AUTH_SECRET antigo, mantenha essa chave até migrar/recadastrar a credencial. Se o segredo antigo for demonstrativo e recusado, faça recadastro explícito da chave privada pelo administrador antes de habilitar a coleta; guarde a configuração antiga somente no backup protegido.
5. Prepare a release `0.1.251` separadamente, mantendo a release antiga. O guia `INSTALACAO.md` contém instalação, build, configuração e HTTPS. Instale dependências com `npm ci`, compile e teste antes de apontar o serviço para a release nova.
6. Valide o upgrade na cópia de homologação: usuários/conversões existentes, credencial SFTP e fingerprint, datas/lojas, NÃO APLICA, parcelas SIPAG, duplicidades, importação e conciliação. As tabelas auxiliares BIN são removidas pelo bootstrap, conforme a mudança solicitada; as fontes originais não são removidas por essa alteração.

## Backup antes da migração

Pause entradas externas e uploads. Pare o serviço existente e confirme que nenhum outro processo escreve no banco/storage. Faça um dump PostgreSQL em formato custom e copie o ambiente original e o storage inteiro, com permissões restritas. Se utilizar o script de backup novo antes de trocar o código, execute-o a partir da release 0.1.251 apontando ENV_FILE e STORAGE_DIR para os caminhos reais atuais; não presuma que a v0.1.241 já possua esse script.

O backup deve terminar com `manifest.json`, ser legível pelo usuário de recuperação e ter o dump íntegro. Restaure em banco separado vazio e storage separado; confira os dados e o reinício do app. O script usa a versão do executável que produz a cópia; registre também que a aplicação de origem ainda era v0.1.241. Não trate um dump não restaurado como recuperação comprovada.

## Troca de release

Só depois do backup e da homologação:

- Mantenha o serviço parado durante a alteração do ambiente, caminhos e release.
- Aponte STORAGE_DIR absoluto para o mesmo conteúdo persistente, com proprietário/permissões compatíveis com o usuário do novo unit. Não apague a origem ao copiar.
- Remova ADMIN_INITIAL_PASSWORD em atualização de banco com usuários existentes. Configure HTTPS, HOST=127.0.0.1, CORS exato e POSTGRES_POOL_MAX válido (exemplo: 12).
- Ajuste o serviço atual ou instale o unit novo depois de desabilitar o anterior. Configure Nginx para o `frontend/dist` da release nova e valide `nginx -t`.
- Inicie uma única instância. O bootstrap aplica as migrações; confira os logs e `/api/ready`. Aguarde o agrupamento SIPAG inicial concluir.
- Confirme login, conversões, usuários, SFTP, importação de amostra, totais, conciliação e consultas antes de retomar entradas reais.

## Verificação de dados e duplicidades históricas

Na pasta da release, com o ambiente correto:

```bash
npm --prefix backend run verificar:producao
```

Este comando só lê. Se retornar código 2, revise os vínculos COOPCERTO apontados antes de liberar a operação. Vínculos históricos incompatíveis não são apagados na atualização; o relatório permite identificá-los. Cancelamentos exigem decisão humana e desfazimento com motivo.

Gere o plano histórico com o banco do servidor, sem reaproveitar o plano DEV:

```bash
npm --prefix backend run corrigir:vendas -- simular --fase coopcerto --limite 1000 --saida plano-coopcerto-servidor-v251.json
```

Leia o plano e confirme identidade, principal/substituída e vínculos. Grupos bloqueados permanecem bloqueados até análise individual. Só após essa revisão e o backup execute, se aplicável:

```bash
npm --prefix backend run corrigir:vendas -- aplicar --plano plano-coopcerto-servidor-v251.json
```

A quantidade de remoções físicas pode ser zero: as cópias COOPCERTO são preservadas e marcadas como não úteis. Guarde o plano e identificador da execução em local protegido para rastreabilidade.

## Se precisar retornar

Pare entradas e serviço, preserve separadamente as operações ocorridas depois da atualização e restaure banco, storage e ambiente do mesmo backup. Só então retome a versão anterior validada. Voltar apenas o symlink não reverte alterações de schema ou dados. O timer de backup reinicia o app ao terminar; se utilizá-lo antes da troca de versão, pare o serviço novamente antes de mudar a release.

## Aprovação da operação

Liberar somente após testes de migração e restauração, revisão financeira sem pendências impeditivas e medição dos tempos de ERP/conciliação no servidor. Meça primeira abertura, reabertura, filtros e acesso durante importação. A compilação e os testes do pacote não medem a infraestrutura real nem a distribuição de dados da produção.
