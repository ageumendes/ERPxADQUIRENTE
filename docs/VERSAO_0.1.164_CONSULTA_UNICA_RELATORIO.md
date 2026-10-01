# ERPxADQUIRENTE v0.1.164 — Consulta única nos atalhos do relatório

## Falha corrigida

Na v0.1.163, a função `carregarRelatorio` dependia diretamente do atualizador de parâmetros do React Router. Depois que uma consulta terminava, a gravação dos filtros na URL podia recriar essa função. O efeito responsável pelo carregamento inicial interpretava a recriação como uma nova inicialização e consultava novamente usando o período original.

O resultado observável era uma consulta correta para **Hoje**, **Ontem**, **Últimos 7 dias**, **Mês atual** ou **Mês anterior**, seguida por outra consulta que frequentemente retornava ao período padrão do mês.

## Solução

- O atualizador da URL passou a ser acessado por uma referência estável.
- `carregarRelatorio` não muda de identidade quando a URL é atualizada.
- O efeito de inicialização executa somente no primeiro ciclo de vida da página.
- Os atalhos continuam realizando a consulta imediatamente.
- O cancelamento de uma requisição anterior continua ativo para cliques rápidos em períodos diferentes.
- O log SQL agora informa `periodo=data_inicio..data_fim`, facilitando a conferência do intervalo realmente executado.

Com isso, cada clique em um atalho gera apenas uma requisição de relatório e mantém na tela exatamente o período selecionado.
