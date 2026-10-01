# Versão 0.1.87 — Limpeza e modularização do backend

## Objetivo

Eliminar implementações duplicadas e resíduos da integração direta com a API PIX Sicoob antes da etapa de segurança operacional.

## Rotas

As rotas de saúde, painel, importações, banco, vendas, relatórios, conciliações, duplicidades e conversões ficam registradas exclusivamente por `routes/core.routes.ts`.

O `server.ts` mantém somente a inicialização, o pipeline de processamento/upload e as rotas SFTP e upload que dependem diretamente desse pipeline.

## Sicoob PIX

Foram removidos os módulos de OAuth, HTTPS/mTLS, configuração e consulta à API. Permanecem:

- provider SFTP Sicoob;
- classificador do JSON;
- parser `sicoob-psp-pix-json.ts`;
- normalizador puro `services/sicoob/pix-normalizer.ts`;
- persistência e atualização pelo `endToEndId`;
- upload manual do JSON.

Clientes antigos que chamarem `/api/sicoob/psp-pix/*` recebem HTTP 410 por um módulo isolado, sem acesso a credenciais ou rede bancária.

## Compatibilidade

Os contratos HTTP ativos foram preservados. Nenhuma migração de banco é necessária nesta versão.

## Validação

- referências à antiga API removidas;
- endpoints duplicados removidos;
- versões dos pacotes e da interface unificadas;
- ZIP verificado sem `.env`, certificado ou chave privada.

O build completo depende da instalação das dependências npm e deve ser executado no ambiente de desenvolvimento/deploy com acesso funcional ao registro.
