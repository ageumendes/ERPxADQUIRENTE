# ERPxADQUIRENTE v0.1.158 — Estabilização dos testes e modularização

## Objetivo

Reduzir testes frágeis baseados em trechos exatos de implementação e iniciar a separação do backend por domínio sem alterar as regras financeiras, parsers ou critérios do motor de conciliação.

## Alterações

- correção da fixture PLUXEE CEADM10 para respeitar o campo fixo de oito posições;
- testes de bootstrap atualizados para validar o comportamento de preservação, não um recorte textual instável;
- testes de conversões alinhados à implementação PostgreSQL/JSONB atual;
- teste de CSP alinhado à separação real entre desenvolvimento e preview/produção;
- nova suíte da v0.1.158 para versão, checklist, autorização, modularização e consulta de hash;
- rotas de auditoria extraídas para `routes/auditoria.routes.ts`;
- rotas de conversões extraídas para `routes/conversoes.routes.ts`;
- checklist de importações extraído para `config/importacoes-diarias.ts`;
- `core.routes.ts` reduzido e mantido como agregador temporário dos demais domínios.

## Escopo preservado

Não foram alteradas as regras dos layouts, cálculos financeiros, critérios de duplicidade ou motor de conciliação. A divisão futura de `repositories/repositorio.ts` e `frontend/src/main.tsx` deverá ocorrer em versões próprias, com testes de caracterização antes de cada extração.

## Validação

- compilação TypeScript do backend aprovada;
- compilação TypeScript da suíte aprovada;
- sintaxe dos módulos do frontend aprovada;
- 52 testes executados: 51 aprovados, 0 falhas e 1 ignorado por ausência das fixtures reais VR no pacote distribuído.
