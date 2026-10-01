# v0.1.174 — Base local brasileira de BINs

A aplicação carrega 7.719 BINs brasileiros de 6 dígitos em `catalogo_bins_referencia`.

Ordem de resolução:

1. conversão manual já cadastrada;
2. `catalogo_bins_referencia` local;
3. BINLIST apenas quando o BIN observado não existir localmente.

Somente os BINs realmente encontrados nas importações SIPAG geram registros em `catalogo_bins` e `conversoes`. A base completa não polui a tabela operacional.

Fonte: https://github.com/venelinkochev/bin-list-data

Licença: Creative Commons Attribution 4.0 International (CC BY 4.0).

A base é comunitária e serve como cache inicial. Ela não substitui dados atuais das bandeiras; divergências podem ser corrigidas manualmente e decisões manuais têm prioridade.
