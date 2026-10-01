# v0.1.218 — reconsulta SICOOB da filial

Inclui os ajustes da v0.1.217: fuso America/La_Paz, comparação ERP × Adquirente por ícone na coluna Conciliação e NSU compacto.

A coleta automática SFTP agora reconhece `sicoob_pix_<CNPJ>_reconsulta_<AAAA-MM-DD>_a_<AAAA-MM-DD>.json`, além dos nomes diários e das reconsultas antigas sem CNPJ. O importador usa o CNPJ do nome nas reconsultas com CNPJ, preservando a distinção entre matriz e filial. A navegação manual pelo SFTP não depende desse filtro, por isso antes podia listar o arquivo enquanto a coleta mostrava zero candidatos.

Arquivos já importados não são alterados. Se `REMOTE_EDI_SICOOB_ALLOW_REGEX` estiver definido no backend, esse valor sobrescreve o filtro padrão e deve ser atualizado separadamente.
