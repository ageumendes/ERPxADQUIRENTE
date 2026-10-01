# ERPxADQUIRENTE v0.1.93

## Alterações

- menu principal recolhível, com preferência preservada no navegador;
- paginação do Banco de Dados ajustada à altura disponível da tela;
- remoção dos botões textuais de 1.000 registros e navegação pelos controles laterais;
- remoção do scroll vertical interno da tabela do Banco, mantendo apenas o horizontal quando necessário;
- ordenação decrescente por `data_venda` nas tabelas que possuem esse campo;
- importações PostgreSQL principais feitas por inserções pontuais com `ON CONFLICT DO NOTHING`;
- criação e atualização de importações sem regravar a tabela inteira;
- normalização e recálculo de taxas restritos ao perfil `ADMINISTRADOR`;
- usuário com troca obrigatória de senha impedido de acessar outras APIs;
- coleta SFTP aguarda o resultado real da importação antes de mover o arquivo;
- sucesso move `in → processed`; falha move `in → error`;
- arquivos remotos de mesmo nome não são sobrescritos silenciosamente.

## Regra SFTP

`processed` significa arquivo validado e importado com status `PROCESSADO` ou `CLASSIFICADO`. O simples download ou enfileiramento não é mais considerado sucesso.
