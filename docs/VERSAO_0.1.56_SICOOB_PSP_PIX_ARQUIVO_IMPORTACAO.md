# v0.1.56 - SICOOB PSP PIX via fila de importação

Ajustes:

- A consulta SICOOB PSP PIX agora salva o JSON retornado em `storage/importacoes/entrada`.
- O classificador reconhece JSON com array `pix` como `SICOOB_LAYOUT_PSP_PIX_JSON`.
- O novo parser `sicoob_layout_psp_pix` grava:
  - tabela bruta `sicoob_layout_psp_pix`;
  - dados canônicos em `vendas_adquirentes`.
- Cada PIX usa `endToEndId` como chave de deduplicação.
- Em `vendas_adquirentes`, o PIX entra com:
  - adquirente: `SICOOB`;
  - modalidade: `PIX PSP`;
  - bandeira: `PIX`;
  - terminal: `PSP_PIX`;
  - valor_taxa: `0.00`;
  - nsu: `endToEndId`;
  - codigo_autorizacao: `txid` ou `endToEndId`.

Endpoints:

```bash
POST /api/sicoob/psp-pix/importar-d1
POST /api/sicoob/psp-pix/importar
```

Agora esses endpoints consultam o Sicoob, geram o JSON e mandam o arquivo para a fila de importação.
