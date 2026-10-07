# ERPxADQUIRENTE v0.1.222

Base: v0.1.221.

- INTERDATA_MOVIMENTO_30D: deduplicação retrocompatível validada com id_venda_erp + data + hora + valor + tipo_produto + bandeira + NSU + parcelas + terminal. `forma_pagamento` não participa. CNPJ: se ambos existem precisam coincidir; histórico sem CNPJ pode casar pela assinatura forte.
- Larguras configuráveis por px, percentual ou fração. Colunas solicitadas receberam pesos 1fr/2fr/3fr; cabeçalhos truncam com reticências e title.
- Conciliação: filas manuais e motor automático excluem duplicados; adquirentes só entram no motor/candidatos quando status_transacao=AUTORIZADO.
- Conversões VALOR_EXATO: a aplicação em registros existentes considera também o valor atual da coluna, mesmo quando existe *_original. Isso permite NEGADO -> NÃO AUTORIZADO para SIPAG.
- Aviso/spinner de conciliação automática centralizado como sobreposição de toda a topbar.
- String de versão do backend atualizada.
