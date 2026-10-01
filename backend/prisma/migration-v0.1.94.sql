BEGIN;

CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_conciliacao_pendente ON vendas_adquirentes (pk) WHERE conciliacao_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendas_interdata_conciliacao_pendente ON vendas_interdata (pk) WHERE conciliacao_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_adquirente_pendente ON vendas_adquirentes (UPPER(COALESCE(dados->>'adquirente',''))) WHERE conciliacao_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_nsu_pendente ON vendas_adquirentes (UPPER(REGEXP_REPLACE(COALESCE(dados->>'nsu',''), '[^A-Za-z0-9]', '', 'g'))) WHERE conciliacao_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_vendas_interdata_nsu_pendente ON vendas_interdata (UPPER(REGEXP_REPLACE(COALESCE(dados->>'nsu',''), '[^A-Za-z0-9]', '', 'g'))) WHERE conciliacao_id IS NULL;

INSERT INTO schema_migrations (versao, descricao)
VALUES ('0.1.94', 'Motor híbrido: lotes, índices de candidatos e vínculos um para um')
ON CONFLICT (versao) DO NOTHING;

COMMIT;
