# ERPxADQUIRENTE v0.1.220

Base: v0.1.219 fornecida pelo usuário.

## Novo layout ERP INTERDATA — movimento D-29 + hoje

- Detecta o relatório com colunas `Bandeira`, `Prclas`, `Espeie Pag`, `Vlr. Parcela`, `Emissão`, `Vencimento`, `Código`, `Cód. Venda` e `Data/Hora`.
- Identifica a loja pelo CNPJ presente no rodapé do arquivo. Se o layout for reconhecido e o CNPJ não existir, a importação é bloqueada para evitar atribuição à loja errada.
- Preserva as colunas originais em `dados_originais`.
- Usa `Data/Hora` como data/hora da venda quando disponível e `Emissão` como data de fallback para movimentos sem Data/Hora.
- Usa `Código` do ERP + CNPJ da loja como identidade estável da linha.
- O `hash_linha` não depende do ID da importação nem do número da linha neste layout. Assim, arquivos sobrepostos de 30 dias podem ser importados diariamente sem duplicar itens já gravados.
- O comportamento dos layouts INTERDATA anteriores foi mantido.
