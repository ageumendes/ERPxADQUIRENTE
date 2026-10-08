# v0.1.252 — desempenho e falhas da conciliação

A busca de candidatos agora materializa o lote ERP e os adquirentes elegíveis antes do cruzamento. Filtra adquirentes pela loja e pelo intervalo de datas do lote, calcula valores em centavos uma vez por registro e conserva a tolerância de um dia, status autorizado, bloqueios NÃO APLICA, duplicidades, PIX e revisão COOPCERTO. A avaliação e a priorização dos pares permanecem as mesmas.

O agrupamento SIPAG reserva as parcelas numa consulta em lote e limpa os grupos obsoletos em lote. Continua verificando as fontes em cada execução: não usa cache que possa ignorar alterações. As parcelas continuam sendo revalidadas sob bloqueio, e dados originais permanecem preservados.

Uma falha da conciliação automática após importação agora se propaga ao controle do lote. O lote permanece pendente em vez de ser marcado como concluído. O log final distingue sucesso de falha. Uma execução pode ter confirmado pares de lotes anteriores antes de uma falha; não se promete reversão global da execução.

A consulta registra ERP, quantidade de pares e tempo por lote em `[conciliacao:candidatos]`. O timeout do banco permanece inalterado.

Inclui as correções já utilizadas na implantação: shell-quote 1.11.0, proxy-addr 2.0.8 e conexão explícita do pg_dump com os parâmetros PostgreSQL.

## Validação

- 209 testes: 207 aprovados, 2 dispensados por fixtures não distribuídas, zero falhas.
- Teste de SQL real em PostgreSQL embarcado (PGlite): 600 ERP, 6.000 adquirentes, 595 pares esperados. Exclui casos com loja, status, documento NÃO APLICA, valor e data incompatíveis; simulação não grava conciliações.
- Nesse cenário sintético, execução aproximada de 2,3 segundos. Não é uma medição da base ou do hardware do servidor.
- Builds de backend/frontend e verificação dos imports ESM aprovados.
- Auditoria dos três arquivos de dependências sem vulnerabilidades detectadas nesta validação.

## Homologação no DEV

Instale com Node 22.12 ou superior compatível com engines do pacote:

```bash
npm run setup
npm test
npm run build
npm run dev
```

Use a configuração local existente, sem publicar segredos no Git. Teste a conciliação com os mesmos dados e filtros que apresentaram falha. Compare quantidade de pares e acompanhe `[conciliacao:candidatos]`, o resultado HTTP e o agrupamento SIPAG. Nenhum tempo da base real foi confirmado aqui: essa validação precisa ser feita no DEV e depois no servidor.

Não reimporte arquivos para testar esta correção. Na atualização, preserve banco, storage, certificados e segredos; faça backup antes da troca. Não execute a configuração DEV na instalação de produção. O Nginx, HTTPS e o processo PM2 da implantação atual não são alterados automaticamente por este ZIP.
