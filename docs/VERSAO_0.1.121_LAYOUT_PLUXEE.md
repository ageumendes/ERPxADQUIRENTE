# Versão 0.1.121 — Layout PLUXEE SDX/SDXP

- Detecta arquivos posicionais PLUXEE de 200 caracteres pelo identificador interno `CEADM10` ou `CONPGT01`.
- `SDX/CEADM10`: o registro 2 alimenta `vendas_adquirentes` como PLUXEE/VOUCHER.
- `SDXP/CONPGT01`: pagamentos, encargos, ajustes e liquidações permanecem somente na tabela bruta, evitando vendas duplicadas.
- Preserva NSU da administradora e NTT Host (`nsu_tef`) separadamente.
- Valida header, trailer, largura das linhas, tipos de registro, datas, horas, valores, RV pai e fechamento bruto por RV.
- Aceita a extensão operacional `.026` usada nos arquivos recebidos.
- Mantém códigos de produto, forma e rede sem tradução especulativa em `dados_json`.
