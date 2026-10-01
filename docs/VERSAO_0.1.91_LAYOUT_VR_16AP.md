# Versão 0.1.91 — Layout VR 16AP

- Classificação automática de `VR_*.txt` como `VR_LAYOUT_16AP`.
- Parser posicional dos registros H (76), V (164), E (195), A (139) e T (13).
- Validação de Header, Trailer, tipos, comprimentos e total geral de registros.
- Gravação bruta integral em `vr_layout_16ap`.
- Normalização de vendas e estornos na tabela `vendas_adquirentes`.
- Mapeamento de produto, rede e meio de captura conforme manual VR 16AP.
- Arquivos sem movimento são processados normalmente com zero vendas.
- Provedor VR incluído no checklist diário e integrado ao download SFTP já existente.
