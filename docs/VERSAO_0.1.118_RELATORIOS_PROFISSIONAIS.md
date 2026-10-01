# Versão 0.1.118 — Relatórios profissionais

## Objetivo

Transformar a tela `/relatorios-adquirentes` em uma visão financeira e operacional adequada ao crescimento do banco de dados.

## Alterações

- agregações, filtros e totais executados diretamente no PostgreSQL;
- aplicação dos filtros somente pelo botão, eliminando consultas duplicadas;
- filtros de situação da conciliação e de duplicidade;
- atalhos para hoje, ontem, últimos 7 dias, mês atual e mês anterior;
- indicadores separados para autorizadas, canceladas, negadas e estornadas/desfeitas;
- visão de conciliação com conciliadas, pendentes, sugeridas, ambíguas e percentual conciliado;
- identificação da quantidade de duplicados prováveis;
- evolução diária e recebíveis, incluindo registros sem data de pagamento;
- exportação do resumo diário em CSV e Excel, além de impressão;
- estados de carregamento, erro e ausência de dados preservados;
- versão corrigida para `0.1.118` nos três pacotes.

## Compatibilidade

O endpoint `GET /api/relatorios-adquirentes` preserva os campos já utilizados pela interface e acrescenta os novos indicadores. Em instalações configuradas sem PostgreSQL, o relatório anterior em JSON continua disponível como fallback.
