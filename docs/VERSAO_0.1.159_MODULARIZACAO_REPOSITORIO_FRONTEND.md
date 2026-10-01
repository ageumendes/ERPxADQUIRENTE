# ERPxADQUIRENTE v0.1.159 — Modularização do repositório e frontend

## Alterações

- extração das operações de importação para `backend/src/repositories/importacoes.repository.ts`;
- manutenção de uma fachada compatível em `backend/src/repositorio.ts`;
- manutenção de reexportações no caminho legado `repositories/repositorio.ts`, evitando que consumidores ESM anteriores quebrem durante a transição;
- correção do import do serviço Remote EDI para o novo repositório de importações;
- IDs de novas importações agora usam UUID, evitando colisões em inclusões concorrentes;
- extração dos tipos de importação e dashboard para `frontend/src/types/importacoes.ts`;
- extração de formatação e rótulos para `frontend/src/lib/importacoes.ts`;
- extração dos assets e mapas de adquirentes/bandeiras para `frontend/src/lib/payment-logos.ts`;
- teste arquitetural para impedir o retorno dessas responsabilidades ao repositório e ao `main.tsx` monolíticos.

## Compatibilidade

As assinaturas públicas do repositório foram preservadas pela fachada existente. Não há migração destrutiva de banco de dados e a persistência continua exclusivamente em PostgreSQL.
