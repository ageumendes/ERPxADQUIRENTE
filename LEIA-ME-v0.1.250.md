# ERPxADQUIRENTE v0.1.250

## Complementação COOPCERTO/Cabal

A importação procura tanto a chave semântica gravada quanto o ID Venda/RRN original. Assim, registros legados sem chave persistida podem ser encontrados e complementados. A chave é recalculada com estabelecimento original, ID Venda/RRN e parcela; a identificação do layout CSV também funciona quando falta tipo_arquivo. Não considera status, taxa, líquido ou NSU como identidade da venda.

Uma pendência completa com a autorização sem trocar o ID principal. Reimportação pendente não rebaixa autorização, cancelamento/estorno conserva a precedência existente. O histórico de atualização guarda também NSU, autorização, bruto, taxa e líquido anteriores quando esses dados mudam. As tabelas brutas, linhas originais e fontes permanecem preservadas.

Bloqueia atualização automática se o mesmo identificador apresentar bruto ou data divergentes, ou houver múltiplos registros protegidos por conciliação/sugestão/vínculo. Um índice PostgreSQL auxilia a busca RRN legada. Não usa correspondência somente por valor/data e não inventa identidade para vendas sem ID suficiente.

## Captura SIPAG e venda financeira COOPCERTO

Quando uma conversão muda SIPAG para COOPCERTO, a combinação de layout original SIPAG com bandeira CABAL continua identificando uma captura. Essa linha deixa de ser tratada como fonte financeira COOPCERTO. A vinculação ocorre no pós-processamento, depois das conversões, com as verificações existentes de loja, valor, data, parcelas e identificador/cartão/horário. Ambas as pontas precisam ser elegíveis e a correspondência única. Casos ambíguos permanecem sem vinculação.

A fonte financeira COOPCERTO conserva taxa e líquido. A captura é preservada e suprimida operacionalmente depois da vinculação. A consulta de candidatos manuais foi corrigida para excluir tanto registros NAO_UTIL quanto capturas já suprimidas, inclusive quando o filtro de status permite todos os itens.

Não altera os originais nem relaxa a exigência de evidência. Uma captura pendente/negada ou sem identidade suficiente pode continuar aguardando revisão.

## Duplicados antigos: prévia sem aplicar

Há uma fase adicional de correção histórica chamada coopcerto. Agrupa apenas registros CSV COOPCERTO de mesma chave estável. Bloqueia dados divergentes, duas fontes autorizadas com taxa/líquido divergentes e múltiplos registros referenciados. Conserva o registro protegido, complementa com a fonte adequada e marca a cópia como NAO_UTIL; não exclui as linhas físicas.

Esta entrega não acessou nem corrigiu seu banco real. Faça backup e execute, na raiz da versão extraída:

```bash
npm run setup
npm run build
npm --prefix backend run corrigir:vendas -- simular --fase coopcerto --limite 1000 --saida plano-coopcerto-v250.json
```

O arquivo estará em backend/plano-coopcerto-v250.json. A simulação não grava alterações. Revise os campos manter/substituir, valores resultantes e bloqueados antes de aplicar. O arquivo de saída não é sobrescrito se já existir; use outro nome para nova prévia.

Depois de revisar o plano:

```bash
npm --prefix backend run corrigir:vendas -- aplicar --plano plano-coopcerto-v250.json
```

A aplicação revalida o banco e o plano, registra auditoria e retorna uma execução UUID. Pode desfazer com:

```bash
npm --prefix backend run corrigir:vendas -- desfazer --execucao UUID_DA_EXECUCAO
```

A reversão bloqueia alterações posteriores nas vendas/conciliações ou novos vínculos, protegendo trabalhos mais recentes. Feche/reinicie ou atualize as telas após aplicar a correção. Não execute simultaneamente com importações. A fase vouchers já existente permite analisar capturas SIPAG/COOPCERTO e demais redes separadamente; não é aplicada automaticamente pela correção coopcerto.

## Atualizar o app

Extraia em pasta nova e preserve backend/.env, os mesmos segredos, banco e storage operacional atuais. Execute npm run setup e npm run dev no DEV. Para Ubuntu use build/start e deploy/ubuntu/INSTALACAO.md. Mantidas as melhorias v248 e v249. Não exige reimportação para a prévia histórica. Se reenviar relatório já conhecido, o controle de hash de arquivo pode dispensar a importação; use a prévia para analisar os registros já presentes.

## Validação

Build backend/frontend aprovado; suíte com 201 testes: 199 aprovados, nenhuma falha e dois ignorados por fixtures não distribuídas. Novos testes cobrem complementação sem chave legada, preservação de ID, reimportação pendente, conflitos de identidade/vínculos, captura SIPAG convertida, ambiguidade e lojas distintas. Teste SQL com PGlite cobre importação real pelo repositório, simulação sem gravação, aplicação sem excluir originais, exclusão da cópia nos candidatos manuais e desfazer. Smoke ESM e worker Excel aprovados. Não foi medido em PostgreSQL nativo nem identificado o par específico do exemplo, pois seus registros completos ainda não foram fornecidos.
