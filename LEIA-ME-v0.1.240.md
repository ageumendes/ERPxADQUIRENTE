# ERPxADQUIRENTE v0.1.240

Correção isolada do ciclo de paginação das telas **Vendas ERP** e **Vendas Adquirentes**.

- A mudança do tamanho de página calculado pela responsividade não reinicia mais a listagem no offset 0.
- Ao refinar o número de linhas que cabem na viewport, a tela preserva o primeiro registro lógico da página atual e recarrega somente com o novo limite.
- Mudanças reais de busca/filtros continuam iniciando pela primeira página.
- Nenhuma regra de importação, conciliação, SFTP, permissões ou backend foi alterada.
