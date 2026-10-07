# Instalação Ubuntu — v0.1.251

Use Ubuntu LTS atualizado, Node.js 22.12+ ou 24 LTS, PostgreSQL suportado, Nginx e cliente pg_dump da mesma versão principal do servidor (ou compatível). Há somente uma instância do backend por banco. Estes comandos são um roteiro para o administrador e precisam de domínio e credenciais reais; não foram executados no seu servidor.

## Preparar arquivos e banco

```bash
sudo apt update
sudo apt install nginx postgresql postgresql-client unzip openssl
sudo useradd --system --home /var/lib/erpxadquirente --shell /usr/sbin/nologin erpxadquirente
sudo install -d -o erpxadquirente -g erpxadquirente -m 750 /var/lib/erpxadquirente/storage /var/log/erpxadquirente /var/backups/erpxadquirente
sudo install -d -o root -g erpxadquirente -m 750 /etc/erpxadquirente
sudo install -d -m 755 /opt/erpxadquirente/releases
```

Instale Node por método oficial e confirme `node --version` e `command -v node`. O unit usa `/usr/bin/node`; ajuste esse caminho se necessário. Extraia o pacote para `/opt/erpxadquirente/releases/0.1.251`, de modo que backend/frontend fiquem diretamente nessa pasta. Faça o build como usuário de implantação, não como usuário do serviço:

```bash
cd /opt/erpxadquirente/releases/0.1.251
npm ci
npm --prefix backend ci
npm --prefix frontend ci
npm run build
npm test
npm run test:startup
npm --prefix backend prune --omit=dev
npm --prefix backend run check:release
sudo ln -sfn /opt/erpxadquirente/releases/0.1.251 /opt/erpxadquirente/current
```

Na atualização, pare o serviço, faça backup e copie o storage antigo inteiro para o diretório persistente, incluindo originais e estados de recuperação. Ajuste proprietário para erpxadquirente. Preserve banco e usuários existentes. Em instalação nova, crie usuário exclusivo sem privilégios de superusuário e banco de sua propriedade; por exemplo no psql administrativo:

```sql
CREATE ROLE erpxadquirente LOGIN;
\password erpxadquirente
CREATE DATABASE erpxadquirente OWNER erpxadquirente;
```

O aplicativo migra o esquema ao iniciar; em produção ele não cria o banco automaticamente. Teste essa migração em cópia antes de atualizar. Não execute testes PostgreSQL destrutivos no banco de produção.

## Ambiente e HTTPS

Copie `backend.env.example` para `/etc/erpxadquirente/backend.env`; proprietário root, grupo erpxadquirente, modo 640. Configure DATABASE_URL com senha devidamente codificada para URL, domínio HTTPS real em CORS_ORIGINS e segredos distintos. Gere cada segredo com `openssl rand -hex 32`. Defina senha inicial forte somente na instalação nova. Não deixe os placeholders. Em banco existente, remova ADMIN_INITIAL_PASSWORD do ambiente: ela só deve ser utilizada para criar o primeiro administrador. POSTGRES_POOL_MAX deve ser um inteiro de 4 a 100 (exemplo: 12); timeout inválido gera erro claro de configuração.

Configure DNS e certificado TLS válido para o domínio. Copie/adapte `nginx.conf.example` para `/etc/nginx/sites-available/erpxadquirente`, substituindo SEU_DOMINIO e caminhos de certificado, e habilite o link em sites-enabled. Obtenha o certificado pelo seu processo ACME antes de ativar o bloco TLS; o modelo supõe certificados existentes. Execute `sudo nginx -t` e somente depois recarregue Nginx. Sirva exclusivamente frontend/dist. A API deve ficar em 127.0.0.1:3333, acessível publicamente apenas por Nginx. Libere 80/443 e acesso SSH conforme sua política; não exponha 3333 ou 5432.

```bash
sudo install -m 644 deploy/ubuntu/erpxadquirente.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now erpxadquirente
sudo systemctl status erpxadquirente
curl --fail http://127.0.0.1:3333/api/ready
sudo journalctl -u erpxadquirente -n 100 --no-pager
```

Verifique também HTTPS público, login, permissões de administrador, upload, Excel, SFTP com fingerprint confirmado, fila, relatório e reinício durante importação usando dados de homologação. Compare totais e conciliações com referências conhecidas, inclusive PIX compartilhado e parcelas SIPAG/CONVCARD. Só então libere operação financeira real.

## Revisão financeira e verificação de liberação

Atualizações COOPCERTO de vendas vinculadas que mudem valores, identificadores ou status são sinalizadas como revisão pendente, sem apagar a conciliação histórica. Contradições entre autorização e negativa não substituem silenciosamente os dados atuais. A revisão bloqueia novas conciliações e novos vínculos voucher. Veja o alerta nas tabelas e em Conciliações → Conciliados. Administrador ou Financeiro pode justificar a manutenção dos dados atuais pelo modal da venda; venda não autorizada com conciliação exige desfazimento com motivo.

Execute a verificação somente de leitura após a migração:

```bash
sudo -u erpxadquirente env ENV_FILE=/etc/erpxadquirente/backend.env /usr/bin/node /opt/erpxadquirente/current/backend/scripts/verificar-producao.mjs
```

Código de saída 0: nenhum caso COOPCERTO detectado por essa verificação; 2: revisões/vínculos a examinar; 1: verificação não concluída. Isso não substitui o ensaio completo de homologação. O comando também detecta vínculos históricos de vendas não autorizadas sem a marca nova. Não limpa nem desfaz registros.

`/api/ready` informa acesso ao banco, estado do agrupamento SIPAG inicial e ocupação do pool. Aguarde `agrupamento_sipag.status=CONCLUIDA`; se FALHOU, examine os logs e reprocesse na homologação. O endpoint continua respondendo às consultas enquanto o agrupamento trabalha.

As rotas SFTP de operação/navegação/download ficam limitadas a ADMINISTRADOR, FINANCEIRO e OPERADOR. AUDITOR e CONSULTA continuam consultando os dados permitidos no app, sem acesso aos arquivos SFTP brutos.

## Backup, restauração e retorno

Instale os units de backup, mas habilite o timer apenas após validar execução, monitoramento, espaço livre e restauração em banco separado. O script copia banco, ambiente e storage, sem apagar backups antigos. As cópias incluem senhas: restrinja acesso, criptografe a cópia externa e defina retenção. Falhas deixam uma pasta incompleta sem manifest.json de conclusão; não trate essa pasta como backup válido.

Para backup consistente antes de atualizar, interrompa entradas SFTP/uploads, pare o aplicativo e execute:

```bash
sudo systemctl stop erpxadquirente
sudo install -m 644 deploy/ubuntu/erpxadquirente-backup.service deploy/ubuntu/erpxadquirente-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start erpxadquirente-backup.service
sudo journalctl -u erpxadquirente-backup.service -n 30 --no-pager
sudo systemctl start erpxadquirente
```

O serviço de backup para o aplicativo, executa a cópia como usuário erpxadquirente e inicia o aplicativo novamente, inclusive após falha. O timer diário causa uma breve indisponibilidade programada. O script exige o mesmo bloqueio exclusivo do backend, impedindo backup enquanto uma instância estiver ativa. Pause também qualquer processo externo que escreva no banco ou storage. Habilite o timer somente depois de testar restauração: `sudo systemctl enable --now erpxadquirente-backup.timer`. Para atualização, execute o backup e pare novamente o aplicativo antes de mudar a versão, pois o unit de backup o reinicia.

Restaure primeiro em banco separado criado vazio: `pg_restore --no-owner --no-acl --dbname=URL_DO_BANCO_VAZIO database.dump`, usando conexão protegida (evite senha no histórico/argumentos). Restaure storage e ambiente correspondente, ajuste permissões e valide antes de apontar o serviço. Não sobrescreva o banco atual durante um teste. As migrações não têm downgrade automático: voltar apenas o link de código não é um rollback completo. Para reverter uma atualização, pare entradas e serviço, preserve os dados posteriores e restaure banco, storage e ambiente do mesmo backup, com avaliação das operações ocorridas após ele.

## Particularidades da v0.1.251

O pacote não inclui credenciais nem dados de operação. O frontend usa a API no mesmo domínio; não configure VITE_API_URL com localhost para produção. STORAGE_DIR deve ser absoluto e apontar para /var/lib/erpxadquirente/storage. CORS_ORIGINS deve conter somente origens HTTPS exatas, sem caminho ou barra final. HOST deve ser 127.0.0.1. Em instalação nova, gere AUTH_SECRET e SFTP_ENCRYPTION_KEY exclusivos e distintos. Em atualização, preserve os segredos válidos existentes; não faça rotação junto da troca de versão. Antes de trocar a chave SFTP em banco existente, preserve a chave antiga em backup protegido e recadastre as credenciais SFTP cifradas com ela; confirme o fingerprint do servidor. A troca de AUTH_SECRET invalida sessões existentes. Não envie backend.env junto do código.

Conciliações já confirmadas não são desfeitas automaticamente. Revise os conflitos PIX sinalizados e eventuais vínculos históricos suspeitos na homologação. A confirmação atual revalida elegibilidade, loja e regras do motor. As regras SIPAG/CONVCARD de NSU, valor e data foram preservadas.

## Atualização de v0.1.241

Veja `ATUALIZAR-v0.1.241-PARA-v0.1.251.md` antes de executar os comandos acima no servidor existente. A v0.1.241 anexada não contém os units de implantação desta versão; confira o serviço e os caminhos reais antes de substituí-los. Nunca aplique ao servidor o plano JSON COOPCERTO criado no DEV.
