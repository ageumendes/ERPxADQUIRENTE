-- ERPxADQUIRENTE - Modelo base em Português BR
-- v0.1.64

CREATE TABLE importacoes (
    id BIGSERIAL PRIMARY KEY,
    nome_arquivo_original VARCHAR(255) NOT NULL,
    nome_arquivo_salvo VARCHAR(255) NOT NULL,
    caminho_arquivo TEXT NOT NULL,
    tamanho_bytes BIGINT NOT NULL,
    tipo_mime VARCHAR(150),
    hash_arquivo VARCHAR(128),
    origem_detectada VARCHAR(100),
    layout_detectado VARCHAR(100),
    status_importacao VARCHAR(50) NOT NULL,
    quantidade_registros INTEGER DEFAULT 0,
    quantidade_processados INTEGER DEFAULT 0,
    quantidade_erros INTEGER DEFAULT 0,
    mensagem_erro TEXT,
    data_importacao TIMESTAMP DEFAULT NOW(),
    data_atualizacao TIMESTAMP DEFAULT NOW()
);

-- Desde a v0.1.47 a tabela linhas_importadas foi removida.
-- O app mantém apenas o resumo técnico na tabela importacoes.

-- Importante: esta tabela preserva os valores exatamente como vieram no arquivo.
-- Não aplicar conversões automáticas no armazenamento.
CREATE TABLE vendas_erp (
    id BIGSERIAL PRIMARY KEY,
    importacao_id BIGINT NOT NULL,
    numero_linha INTEGER,
    data_venda TEXT,
    hora_venda TEXT,
    terminal TEXT,
    nsu TEXT,
    valor_bruto TEXT,
    forma_pagamento TEXT,
    bandeira TEXT,
    tipo_produto TEXT,
    parcelas TEXT,
    cnpj_estabelecimento TEXT,
    id_venda_erp TEXT,
    status_venda TEXT,
    hash_linha VARCHAR(128),
    dados_originais JSONB,
    data_criacao TIMESTAMP DEFAULT NOW()
);

CREATE TABLE vendas_adquirentes (
    id BIGSERIAL PRIMARY KEY,
    importacao_id BIGINT,
    adquirente VARCHAR(50),
    data_venda TEXT,
    hora_venda TEXT,
    valor_bruto TEXT,
    valor_liquido TEXT,
    valor_taxa TEXT,
    percentual_taxa NUMERIC(10,4),
    nsu TEXT,
    codigo_autorizacao TEXT,
    terminal TEXT,
    bandeira TEXT,
    modalidade TEXT,
    parcelas TEXT,
    status_transacao TEXT,
    data_criacao TIMESTAMP DEFAULT NOW()
);

CREATE TABLE conciliacoes (
    id BIGSERIAL PRIMARY KEY,
    venda_erp_id BIGINT,
    venda_adquirente_id BIGINT,
    status_conciliacao VARCHAR(50),
    pontuacao_match NUMERIC(5,2),
    motivo_match VARCHAR(255),
    observacoes TEXT,
    conciliado_automaticamente BOOLEAN DEFAULT FALSE,
    data_conciliacao TIMESTAMP DEFAULT NOW()
);

-- Regras de exibição/conversão para o frontend.
-- O valor original permanece preservado na tabela de origem.
CREATE TABLE conversoes (
    id BIGSERIAL PRIMARY KEY,
    tabela_origem VARCHAR(100) NOT NULL,
    coluna_origem VARCHAR(100) NOT NULL,
    valor_original TEXT NOT NULL,
    valor_exibicao TEXT NOT NULL,
    ativo BOOLEAN DEFAULT TRUE,
    observacao TEXT,
    data_criacao TIMESTAMP DEFAULT NOW(),
    data_atualizacao TIMESTAMP DEFAULT NOW()
);


-- Migração v0.1.64 para bases já existentes:
ALTER TABLE vendas_adquirentes ADD COLUMN IF NOT EXISTS percentual_taxa NUMERIC(10,4);
UPDATE vendas_adquirentes
SET percentual_taxa = CASE
    WHEN NULLIF(REGEXP_REPLACE(valor_bruto, '[^0-9,.-]', '', 'g'), '') IS NULL THEN 0
    ELSE ROUND((ABS(COALESCE(NULLIF(REPLACE(REGEXP_REPLACE(valor_taxa, '[^0-9,.-]', '', 'g'), ',', '.'), '')::NUMERIC, 0)) / NULLIF(ABS(REPLACE(REGEXP_REPLACE(valor_bruto, '[^0-9,.-]', '', 'g'), ',', '.')::NUMERIC), 0)) * 100, 4)
END;
