# v0.1.173 — BINs online e estabelecimentos

## BINs

- Consulta somente os seis dígitos do BIN por HTTPS; nunca envia o cartão completo.
- O resultado fica em `catalogo_bins` e cria/atualiza a conversão correspondente.
- O botão consulta até cinco BINs por execução por causa do limite público do BINLIST.
- As vendas só são alteradas quando o administrador usa **Aplicar conversões**.
- Configuração opcional: `BIN_LOOKUP_BASE_URL`, `BIN_LOOKUP_API_KEY` e `BIN_LOOKUP_LIMIT_PER_RUN`.

## Estabelecimentos

- O bootstrap preenche `codigo_estabelecimento` nos registros anteriores a partir dos campos específicos de cada layout.
- Novas importações passam pela mesma normalização central antes de serem gravadas.
- Documentos de pagador, portador, emissor e adquirente não são usados.
- O valor original e sua origem são preservados em `dados_json` para auditoria.
- Cobertura por adquirente: `GET /api/vendas-adquirentes/estabelecimentos/cobertura`.

Origens reconhecidas incluem CIELO (estabelecimento submissor), SIPAG/SICREDI (merchant/client/branch), CONVCARD e VR (loja/filiação), COOPCERTO (número do estabelecimento), ALELO (raiz CNPJ), PLUXEE (código do estabelecimento) e TICKET (identificação do estabelecimento). SICOOB PIX não usa o documento do pagador como loja.
