# Auditoria de `vendas_adquirentes` — base enviada com a v0.1.191

Foram lidos integralmente 140.591 registros do arquivo `vendas_adquirentes.txt`.

## Integridade e duplicidades

- IDs repetidos: **0**.
- `hash_linha` repetidos: **0**.
- Chaves comerciais repetidas: **1.755 grupos / 3.539 registros**.
- Excesso estimado se cada grupo representar uma única venda: **1.784 registros**.

Distribuição dos grupos candidatos:

- SIPAG complementada + vendas realizadas: **1.463**.
- SIPAG complementada repetida: **226**.
- VR 16AP: **59**.
- CONVCARD: **7**.

Os hashes não detectaram esses casos porque reimportações diferentes geraram IDs e hashes diferentes. A v0.1.192 corrige a causa principal no SIPAG: a chave complementar agora usa o código de estabelecimento original preservado no dado bruto, mesmo quando a coluna canônica já foi convertida para `SRG` ou `NBO`.

Os registros históricos devem ser revisados em `/duplicidades`. A remoção existente preserva preferencialmente o registro conciliado, registra auditoria e bloqueia grupos com conciliações conflitantes.

## Campos vazios

- `codigo_estabelecimento`: **35.791** — 22.555 no SIPAG S 2.0, 13.115 no SIPAG Fiserv 7.6 e 121 em registros PIX SIPAG.
- `parcelas`: **73**, todos no SIPAG S 2.0 PIX.
- `valor_liquido`: **73**, todos no SIPAG S 2.0 PIX.
- `data_venda` e `hora_venda`: **8** cada, em registros PIX Fiserv SIPAG/SICREDI.

O código do estabelecimento já existia no conteúdo bruto dos layouts S. A v0.1.192 passa a reconhecer `codigo_cliente` e `COLUNA_02`; a rotina idempotente de inicialização pode projetar esses valores na coluna canônica histórica.

## Formatos e valores

- **3.172** horários estão no formato compacto `HHMMSS`. Esse formato é previsto nos layouts CONVCARD, VR, TICKET e PIX Fiserv e já é interpretado pelo frontend; não foi classificado como corrupção.
- **23** taxas negativas pertencem a registros ALELO antigos. O fluxo atual de persistência e o endpoint de normalização usam o valor absoluto da taxa.
- **47** registros não satisfazem diretamente `bruto - |taxa| = líquido`: 28 SIPAG S 2.0, 15 ALELO e 4 COOPCERTO. No ALELO há casos com tarifa administrativa adicional de R$ 0,99 preservada no bruto; por isso nenhum valor foi alterado automaticamente sem validar a semântica de cada layout.

## Consulta no frontend

Em `/adquirentes-vendas`, cada filtro e célula passa a consultar o campo canônico correspondente de `vendas_adquirentes`. Em especial, Bandeira usa exclusivamente `dados->>'bandeira'` e Loja usa exclusivamente `dados->>'codigo_estabelecimento'`. Conversões e catálogo de BINs não substituem os valores nessa tela.
