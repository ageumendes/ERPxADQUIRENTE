# v0.1.195 — Vouchers complementares entre adquirentes

Base: v0.1.194 enviada nesta conversa.

## Comportamento

O pós-processamento do lote vincula vendas VOUCHER de SIPAG, SICREDI e CIELO às vendas de ALELO, PLUXEE, TICKET, VR e COOPCERTO. O suporte anterior a LECARD e CONVCARD foi mantido. A alteração está no serviço central de consolidação, compartilhado pelos layouts; os campos brutos dos arquivos não foram reinterpretados.

A venda econômica permanece como registro canônico: adquirente, bruto, taxa, líquido, pagamento e identificadores financeiros são preservados. Autorização e terminal ausentes são complementados pela captura. São registrados ID da captura, importação, estabelecimento, NSU, horário, campos originais e evidência do vínculo. A captura fica preservada fisicamente para auditoria, marcada `suprimido_por_vinculo_voucher=true`; as telas e totais operacionais existentes já excluem essa marca. Portanto há uma venda operacional, com duas fontes rastreáveis.

A consolidação roda após as conversões do lote, mesmo sem ERP, e considera as duas fontes no período processado. Pode-se importar primeiro a captura ou primeiro a adquirente econômica. O destino já vinculado fica reservado nas execuções seguintes. Vínculos antigos são preservados, não reavaliados silenciosamente.

## Critérios

- Modalidade VOUCHER na captura, mesma data, bruto positivo e exatamente igual em centavos; parcelas compatíveis quando informadas.
- Bandeira textual, quando reconhecida, restringe a adquirente. CABAL corresponde a COOPCERTO; SODEXO a PLUXEE. Bandeira vazia ou BIN não impede a busca entre as adquirentes econômicas.
- Mesma loja: código canônico de estabelecimento (após conversões) ou CNPJ completo compatível. Na SIPAG, documento mascarado compatível com o CNPJ da adquirente só é aceito junto com identificador forte e horário presente.
- Autorização igual após normalizar zeros à esquerda; alternativamente NSU igual. Para TICKET, o identificador repetido preservado no CEADM40 também pode ser comparado à autorização da captura, com critério próprio no histórico.
- Se as duas autorizações estiverem presentes e forem diferentes, o vínculo é bloqueado mesmo quando NSU/horário coincidem.
- Horários presentes devem ficar dentro de 60 segundos por padrão. `VOUCHER_CONSOLIDACAO_TOLERANCIA_SEGUNDOS` permite ajustar entre 1 e 300 segundos. Campo ausente não vira meia-noite.
- Sem autorização/NSU, exige loja exata, BIN e últimos quatro dígitos do cartão compatíveis, além de horário presente. Valor/data/hora sozinhos não bastam.
- Não se afirma que finais divergentes sejam tokenização: a comparação do cartão fica registrada como incompatível, e o vínculo depende dos demais critérios.
- Negativas, cancelamentos, estornos, devoluções, pendências e registros não úteis não são absorvidos. Situações vazias/desconhecidas também não são promovidas a autorizadas; normalize os códigos de status por conversão quando necessário.
- Exige unicidade nas duas pontas, inclusive quando o NSU coincide. Ambiguidades ficam visíveis com os IDs candidatos, sem supressão.

## Estabelecimentos

Códigos de afiliação de redes diferentes não devem ser equiparados por semelhança numérica. Quando não há CNPJ/documento suficiente, configure as conversões de `vendas_adquirentes.codigo_estabelecimento`, por adquirente, para o mesmo código interno da loja.

Exemplo baseado nos pares já confrontados (use os códigos internos reais do cadastro): SIPAG `106145980001` e COOPCERTO `14211625000` devem convergir para a mesma loja; SIPAG `116403700001` e COOPCERTO `142116250001` convergem para outra. Nenhum desses códigos de cliente foi fixado no código do app. Sem identificação compatível de loja, a venda permanece sem vínculo.

## Conciliações ERP existentes e gravação

Se apenas a captura possuir conciliação, o ID e os campos de conciliação acompanham a venda econômica, e o registro em `conciliacoes` passa a apontar para ela, preservando o ID anterior no JSON. Se ambas possuírem conciliações diferentes, a união é ambígua e não ocorre automaticamente.

A atualização das duas fontes e da referência ERP usa uma transação PostgreSQL. As linhas são bloqueadas em ordem estável; se o conteúdo mudou desde a leitura, a operação aborta para evitar sobrescrever conversões/conciliações concorrentes. As escritas são feitas em lotes dentro da mesma transação. Solicitações de consolidação sobrepostas aguardam e executam o próprio escopo, em vez de descartar o segundo pedido.

## Como utilizar

1. Instale as dependências como nas versões anteriores e inicie a v0.1.195.
2. Importe os arquivos normalmente: após finalizar o lote e aplicar conversões, a consolidação acontece automaticamente.
3. Para vendas já importadas: em `/banco`, aplique as conversões de estabelecimento/modalidade necessárias e execute o botão **Consolidação VOUCHER**. Endpoint já existente: `POST /api/banco/jobs/consolidacao-voucher`, com sessão autenticada. Não é necessário apagar ou reimportar as vendas existentes.
4. Consulte os contadores de vínculos, ambiguidades e vendas sem correspondência. As quatro vendas sem EDI correspondente continuam pendentes de identificação; não são ocultadas por suposição.

## Validação

- Builds do backend e do frontend concluídos com as dependências dos lockfiles. TypeScript do backend compilado e 13 testes novos executados também no JavaScript compilado.
- Combinações sintéticas das três capturadoras com as cinco adquirentes solicitadas; zeros à esquerda, NSU, lojas diferentes, valores/datas/parcelas diferentes, limites de horário, ambiguidades 1×N e N×1, cancelamentos, destino já utilizado e conciliações ERP conflitantes.
- Parsers reais + motor reproduziram 11 correspondências entre as 15 vendas da amostra: VR 7, TICKET 1, PLUXEE 3. Restaram `702726`, `013759`, `702727`, `402409`.
- Testes de regressão dos parsers SIPAG/PLUXEE/COOPCERTO passaram. Um teste antigo de VR é ignorado pelo próprio pacote por depender de outro conjunto de fixtures; os arquivos VR desta conversa são exercitados pelo novo teste.
- A suíte completa em TypeScript apresentou três falhas preexistentes, reproduzidas sem alterações na v0.1.194: um teste antigo de preservação de conversões e dois testes de backfill SIPAG com caminho incorreto. Não foram alterados para mascarar o resultado.
- Não foi executado teste integrado contra PostgreSQL: não há banco de testes configurado neste ambiente. A transferência de referências e a transação deverão ser verificadas na instalação do usuário.
