# Versão 0.1.126 — conversões automáticas após importações

## Ajustes

- Executa todas as regras ativas da tabela `conversoes` ao final de cada lote de importações processadas.
- Aplica as regras em `vendas_interdata` e `vendas_adquirentes` antes de iniciar a conciliação automática.
- Aguarda a conclusão das conversões; a conciliação não inicia sobre dados ainda não normalizados.
- Registra no terminal as quantidades de regras, correspondências e alterações.
- Interrompe a etapa posterior e informa os detalhes se alguma regra terminar com status `ERRO`.
- Torna a correspondência tolerante a acentos, caixa e espaços repetidos, inclusive no PostgreSQL.

## Caso VR corrigido

As formas acentuadas preservadas em `modalidade_original`, como `VR ALIMENTAÇÃO PAT`, `VR BENEFÍCIOS AUX` e `VR REFEIÇÃO PAT`, passam a corresponder às regras cadastradas sem acentos e são convertidas para `VOUCHER`.
