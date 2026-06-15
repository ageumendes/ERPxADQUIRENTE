## v0.1.69 - Filtros nas telas de vendas

- Adiciona filtros no padrão gerencial em `/adquirentes-vendas`.
- Adiciona filtros no padrão gerencial em `/erp-vendas`.
- Mantém data inicial como primeiro dia do mês atual e data final como dia atual em cada abertura da página.
- Aplica regras de redundância entre Forma de pagamento, Modalidade e Bandeira.
- Cria endpoints de opções para popular os filtros das telas de vendas.
- Aplica filtros no backend antes da paginação de 1000 em 1000.


## v0.1.68 - Ajustes de filtros gerenciais

- Data inicial agora inicia automaticamente no primeiro dia do mês atual.
- Data final agora inicia automaticamente no dia atual.
- Filtro Forma de pagamento integrado com Modalidade e Bandeira.
- Ao selecionar PIX, Modalidade fica em PIX e Bandeira fica bloqueada.
- Ao selecionar CARTÃO, Modalidade e Bandeira ocultam a opção PIX.
- Mantida liberdade para filtrar qualquer intervalo de datas informado pelo usuário.

# v0.1.66 - Correção filtro forma de pagamento e gráfico CARTÃO x PIX

- Corrige o endpoint `/api/relatorios-adquirentes` para repassar `forma_pagamento` ao repositório.
- Mantém a regra gerencial: `PIX` filtra `modalidade = PIX`; `CARTAO` filtra tudo que é diferente de `PIX`.
- Adiciona o agrupamento `por_forma_pagamento` no relatório.
- Adiciona o gráfico de barras "Vendas por forma de pagamento" entre adquirente e modalidade.
- Mantém os demais filtros: adquirente, modalidade, bandeira, terminal e status.

# v0.1.64 - Percentual de taxa em vendas_adquirentes

- Adiciona o campo canônico `percentual_taxa` na tabela lógica `vendas_adquirentes`.
- Calcula `percentual_taxa = valor_taxa / valor_bruto * 100` na gravação das novas importações.
- Cria endpoint `POST /api/vendas-adquirentes/recalcular-percentual-taxa` para preencher/corrigir dados já importados.
- Mantém o endpoint `POST /api/vendas-adquirentes/normalizar` também recalculando o percentual.
- Exibe a coluna `% taxa` na página `/adquirentes-vendas`.

# v0.1.62 - Ajustes de consistência e paginação do banco

- Alinha versões do projeto para `0.1.62` no backend, frontend, raiz e tema.
- Corrige imports das logos SIPAG e SICOOB no frontend.
- Ajusta a tela SFTP para deixar SICOOB PSP PIX como coleta via API integrada ao pipeline, separada dos providers SFTP comuns.
- Adiciona paginação de 1000 em 1000 no explorador técnico `/banco`.
- Remove `.env` do pacote distribuído e mantém `.env.example` como referência.
- Atualiza documentação SQL para refletir a remoção da tabela `linhas_importadas`.

# v0.1.59 - Conversões canônicas em vendas_adquirentes

- Aplica a tabela `conversoes` na gravação central de `vendas_adquirentes` para todos os layouts.
- Inclui suporte para conversão da própria coluna `adquirente`, preservando `adquirente_original`.
- Mantém campos técnicos fora da conversão.

# v0.1.58 - Sicoob PSP PIX somente via entrada

- Ajusta as rotas `/api/sicoob/psp-pix/importar` e `/api/sicoob/psp-pix/importar-d1` para apenas salvar o JSON em `storage/importacoes/entrada`.
- Remove gravação direta/imediata no banco a partir da rota de consulta PIX.
- A persistência em `sicoob_layout_psp_pix` e `vendas_adquirentes` fica centralizada no importador de layouts/watch da pasta entrada.


## v0.1.54

- Cadastrado novo layout CONVCARD Layout Padrão Conciliação Financeira v2.0.3.
- Adicionado parser posicional fixo para registros A0, L0, CV, CP, CC, TB, L9 e A9.
- Criadas tabelas brutas separadas por grupo: convcard_layout_2_0_3_cv, cp, cc, tb e controle.
- Registro CV passa a alimentar vendas_adquirentes com adquirente CONVCARD.
- Adicionado suporte à importação manual e endpoint direto /api/importacoes/convcard_layout_2_0_3.
- Adicionado provider SFTP CONVCARD com usuário padrão convcard_sftp e diretório /in.
- Adicionado checkbox CONVCARD na tela SFTP EDI.


## v0.1.51

- Separa a importação bruta do SICREDI/Fiserv Layout 7.4 arquivo S em duas tabelas:
  - `sicredi_fiserv_layout_7_4_s_pix` para transações PIX, registro `001`;
  - `sicredi_fiserv_layout_7_4_s_cartoes` para transações de cartão, registros `011`, `013`, `014` e relacionados.
- Mantém a tabela canônica `vendas_adquirentes` recebendo PIX e cartões de forma normalizada para as telas de vendas e relatórios.
- Atualiza o `layout_origem` das vendas SICREDI para apontar para a origem bruta correta: PIX ou cartões.


## v0.1.49 - Formatação monetária brasileira nas vendas

- Mantém os ajustes de frontend recebidos na v0.1.48.
- Formata Valor bruto, Valor taxa e Valor líquido no padrão brasileiro BRL em Vendas Adquirentes.
- Formata Valor bruto no padrão brasileiro BRL em Vendas ERP.
- Normaliza valores numéricos recebidos como `1234.56`, `1234,56` ou `1.234,56` antes da exibição.


## v0.1.46 - Correção definitiva da ordenação por data/hora compacta

- Corrigida a ordenação de vendas das adquirentes quando `data_venda` vem no formato compacto `DDMMYYYY` (`19052026`, `31032026`, etc.).
- Corrigida a interpretação de `hora_venda` compacta `HHMMSS` junto com `HH:mm:ss`.
- Reforçada a ordenação no backend antes da paginação e no frontend depois do carregamento.
- Ajustados botões laterais de paginação para ficarem flutuantes no centro vertical da tela.
- Reforçado o cabeçalho fixo da tabela durante a rolagem.


## v0.1.45

- Corrige ordenação global das vendas de adquirentes por data/hora, mesclando CIELO, SIPAG e SICREDI.
- Adiciona ordenação defensiva no frontend para evitar agrupamento visual por adquirente.
- Mantém cabeçalho da tabela fixo durante a rolagem.
- Ajusta botões de paginação para formato circular flutuante nas laterais da tabela.

# v0.1.41

- Ajusta ordem das colunas em `/erp-vendas`: NSU agora fica após Status venda.
- Normaliza Data venda em `/adquirentes-vendas` para formato `dd/mm/aaaa` antes de concatenar com hora.



## v0.1.38 - polling leve e fila mais responsiva

- Adicionado `GET /api/poll/status` para polling leve do frontend sem depender de listagens pesadas.
- Adicionado `GET /api/importacoes/poll` com fila, SFTP e contadores das pastas.
- Fila passa a ceder o event loop entre arquivos para manter frontend e SFTP responsivos.
- Recuperação automática do boot agora roda em lote limitado por `IMPORTACOES_RECUPERAR_MAX_BOOT` (padrão: 50).
- Coleta SFTP enfileira arquivos sem aguardar o processamento completo da fila.
- Arquivos baixados via SFTP preservam o nome original no arquivo salvo.
# v0.1.35 - Arquivamento por status sem renomear arquivos

- Duplicidades agora são arquivadas em storage/importacoes/erro/duplicidades/ sem prefixar duplicado- no nome do arquivo.
- Layouts não reconhecidos agora são arquivados em storage/importacoes/erro/layout_desconhecido/.
- Falhas técnicas de importação agora são arquivadas em storage/importacoes/erro/falha_importacao/.
- Extensões bloqueadas agora são arquivadas em storage/importacoes/erro/extensao_bloqueada/.
- O frontend recebe status ARQUIVO_DUPLICADO e LAYOUT_DESCONHECIDO de forma explícita no histórico.
- Quando há colisão de nomes no filesystem, o app cria subpasta técnica _nomes_repetidos/.../ mantendo o nome original do arquivo.

# v0.1.35 - Arquivamento por status sem renomear arquivos

- Duplicidades agora são arquivadas em `storage/importacoes/erro/duplicidades/` sem prefixar `duplicado-` no nome do arquivo.
- Layouts não reconhecidos agora são arquivados em `storage/importacoes/erro/layout_desconhecido/`.
- Falhas técnicas de importação agora são arquivadas em `storage/importacoes/erro/falha_importacao/`.
- Extensões bloqueadas agora são arquivadas em `storage/importacoes/erro/extensao_bloqueada/`.
- O frontend recebe status `ARQUIVO_DUPLICADO` e `LAYOUT_DESCONHECIDO` de forma explícita no histórico.
- Quando há colisão de nomes no filesystem, o app cria subpasta técnica `_nomes_repetidos/.../` mantendo o nome original do arquivo.

# v0.1.34 - Recuperação automática da fila

- Ao iniciar o backend, arquivos presos em `storage/importacoes/processando/` voltam para `storage/importacoes/entrada/`.
- Importações pendentes com o mesmo hash são retomadas em vez de tratadas como duplicadas finais.
- Mantém nomes originais sempre que possível; sufixo só é usado em colisão de nome.

## 0.1.28

- Adicionado bootstrap automático do PostgreSQL.
- Criada migração inicial com as mesmas nomenclaturas de tabelas já usadas pelos importadores.
- Adicionado seed das conversões padrão na tabela `conversoes`.
- Adicionado script `npm run db:bootstrap` para criar usuário/banco local via PostgreSQL do Ubuntu.

# Changelog

## 0.1.27
- Persistência principal migrada para PostgreSQL via Prisma quando `DATABASE_URL` está configurado.
- Mantido fallback em JSON local quando PostgreSQL não estiver configurado ou `PERSISTENCIA_POSTGRES=false`.
- Explorador de banco e endpoints existentes preservados.


## 0.1.25
- Tela SFTP EDI agora inicia com CIELO, SIPAG e SICREDI marcados.
- Opção Listar apenas/dryRun inicia desmarcada para operação real.
- Upload manual agora permite selecionar múltiplos arquivos.
- Watcher automático em storage/importacoes/entrada para arquivos colados manualmente.


## 0.1.24
- Carregamento automático do backend/.env.
- Tela SFTP para testar conexão e coletar arquivos CIELO/SIPAG/SICREDI.
- Mantém coleta pelo pipeline central de upload/classificação/importação.

## 0.1.22

- Ajusta a tela Vendas ERP (/erp-vendas) para exibir os campos convertidos de vendas_interdata.
- Mantém os valores originais apenas no tooltip (title) ao passar o mouse sobre campos convertidos.
- Remove o marcador visual "convertido" da tabela de Vendas ERP para manter a exibição limpa.

## 0.1.21

- Criada tabela canônica `vendas_interdata`.
- `vendas_erp` permanece como tabela bruta/auditável do INTERDATA.
- Importação INTERDATA agora grava em `vendas_erp` e também em `vendas_interdata` com conversões aplicadas.
- Tela **Vendas ERP** passa a exibir dados de `vendas_interdata`.
- Valores originais convertidos ficam preservados em colunas `*_original`.


## 0.1.19
- Implementada importação do arquivo `CIELO04` no layout `cielo_layout_15_15`.
- Classificador agora identifica `CIELO_LAYOUT_15_15_CIELO04` pelo upload central.
- Criada tabela bruta `cielo_layout_15_15_cielo04`.
- CIELO04 grava registros `D` e `E` como liquidação/pagamento.
- CIELO04 não alimenta `vendas_adquirentes`, evitando duplicidade com vendas capturadas.
- Build backend e frontend validados.

## 0.1.18
- Ajuste na importação SICREDI Fiserv Layout 7.4: tabela `sicredi_fiserv_layout_7_4_s` grava somente registros de venda (`001`, `011`, `013`, `014`).
- Headers, trailers, resumos, cancelamentos, chargebacks e detalhes de parcelas deixam de ser gravados na tabela S bruta.
- `vendas_adquirentes.modalidade` para SICREDI agora recebe `PIX`, `DEBITO` ou `CREDITO`, em vez de `005 - Compra`.


## 0.1.15

- Remove atualização completa da tela ao cadastrar, editar ou excluir conversões.
- Ajusta valores monetários do SIPAG Fiserv Layout 7.6 em vendas_adquirentes para duas casas decimais.
- Mantém os valores brutos preservados nas tabelas brutas do layout Fiserv 7.6.

# ERPxADQUIRENTE v0.1.14

## Novidades
- Importação CIELO16 PIX dentro do endpoint `POST /api/importacoes/cielo_layout_15_15`.
- Nova tabela bruta `cielo_layout_15_15_cielo16` para registros PIX tipo `8`.
- CIELO16 alimenta `vendas_adquirentes` com bandeira/modalidade PIX.
- `valor_taxa` permanece positivo em `vendas_adquirentes`.
- Tela de conversões com select de adquirente em tema dark.
- Botões para editar e excluir conversões individualmente.
- Endpoints `PUT /api/conversoes/:id` e `DELETE /api/conversoes/:id`.

## Mantido
- Dados brutos preservados.
- Conversões aplicadas somente na exibição.
- CIELO03 grava somente registros de venda.

## v0.1.17
- Adicionado identificador automático `SICREDI_FISERV_LAYOUT_7_4` no fluxo central `POST /api/importacoes/upload`.
- Adicionado parser JSON do Sicredi/Fiserv 7.4 para arquivos `EDI-S`, `EDI-P` e `EDI-R`.
- Criadas tabelas brutas `sicredi_fiserv_layout_7_4_s`, `sicredi_fiserv_layout_7_4_p` e `sicredi_fiserv_layout_7_4_r`.
- Arquivo `S` do Sicredi passa a alimentar `vendas_adquirentes` com PIX, débito, crédito à vista e parcelado.
- Extensão `.json` liberada para upload de EDI Sicredi 7.4.


## 0.1.20

- Aplica regras ativas da tabela conversoes ao gravar vendas_adquirentes.
- Preserva valores originais convertidos em colunas *_original.
- Mantém tabelas brutas intactas para auditoria.

## 0.1.23

- Adicionado coletor SFTP centralizado para arquivos EDI.
- Novos endpoints:
  - `GET /api/importacoes/sftp/ping`
  - `POST /api/importacoes/sftp/coletar`
- Coleta via SFTP para CIELO, SIPAG e SICREDI usando `.env`.
- Arquivos baixados são espelhados em `storage/remote-edi/{adquirente}/pulled`.
- Arquivos baixados entram no pipeline oficial `storage/importacoes/entrada` e usam o mesmo classificador/importador do upload manual.
- Suporte a `dryRun`, bloqueio de execução simultânea e bloqueio por hash duplicado.
- Estrutura `storage/keys` criada para chave `.pem`, sem empacotar chaves no ZIP.


## 0.1.32
- Upload de arquivos duplicados passa a ser aceito e arquivado automaticamente, sem reprocessar dados.
