# v0.1.253 — conciliação por período

O botão principal e a simulação analisam vendas ERP de hoje e dos seis dias anteriores, com limites inclusivos e referência de calendário em America/La_Paz. A mesma janela é usada automaticamente após importação e conversão, independentemente da idade dos arquivos importados. As conversões continuam preservando seu escopo original; esta mudança limita a conciliação e o agrupamento, não a importação nem as conversões.

Em “Outras opções”, “Conciliar por período” abre uma sobreposição com datas inicial e final obrigatórias. Permite um único dia ou um intervalo inclusivo. O backend rejeita datas inválidas, ausência de um dos limites e períodos invertidos. Sem um período explícito, as rotas de execução e simulação aplicam sete dias automaticamente.

O agrupamento SIPAG consulta apenas parcelas ERP na janela escolhida. A sincronização inicial também usa sete dias. Grupos fora da janela ficam preservados. As fontes adquirentes têm margem de um dia em cada extremidade para manter as regras existentes entre datas próximas. A confirmação de um agrupamento continua revalidando a integridade das parcelas e possíveis ambiguidades.

## Validação

211 testes: 209 aprovados, 2 dispensados por fixtures não distribuídas, zero falhas. Inclui virada do dia em La Paz, mudança de ano, datas inválidas, período de um dia, limites inclusivos no motor SQL e agrupamento restrito ao período sem desativar grupos históricos. Builds de backend e frontend e smoke test dos imports ESM aprovados.

Não temos acesso à base real do DEV ou do servidor. O tempo total ainda precisa ser medido com seus dados. Esta versão restringe a varredura padrão; não promete um tempo máximo ou elimina todos os possíveis custos de gravação/listagem.

## Homologação no DEV

Use o banco e a configuração local existentes e execute:

```bash
npm run setup
npm test
npm run build
npm run dev
```

Não reimporte arquivos para testar. Confira o botão padrão, depois abra “Outras opções” e teste um dia histórico conhecido. Em 08/10/2026, a janela padrão é 02/10/2026 a 08/10/2026. Confira o resumo de resultados e os logs `[agrupamento-sipag]`, `[conciliacao:candidatos]` e o tempo HTTP final. Vendas antigas podem continuar aparecendo nas listagens; o limite se aplica ao motor automático, não às tabelas de consulta.

A atualização do servidor deve preservar banco, storage, segredos, certificados, Nginx e HTTPS. Faça backup antes da troca e homologue no DEV primeiro. O ZIP não troca o processo PM2 nem publica automaticamente no GitHub.
