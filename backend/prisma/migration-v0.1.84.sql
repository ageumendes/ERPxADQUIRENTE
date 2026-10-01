BEGIN;

ALTER TABLE "conciliacoes" ADD COLUMN IF NOT EXISTS venda_adquirente_id TEXT;
ALTER TABLE "conciliacoes" ADD COLUMN IF NOT EXISTS venda_interdata_id TEXT;
ALTER TABLE "conciliacoes" ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE "vendas_adquirentes" ADD COLUMN IF NOT EXISTS conciliacao_id TEXT;
ALTER TABLE "vendas_interdata" ADD COLUMN IF NOT EXISTS conciliacao_id TEXT;

UPDATE "conciliacoes"
SET venda_adquirente_id = NULLIF(dados->>'venda_adquirente_id', ''),
    venda_interdata_id = NULLIF(dados->>'venda_interdata_id', ''),
    status = COALESCE(NULLIF(dados->>'status', ''), 'SUGERIDO')
WHERE venda_adquirente_id IS NULL OR venda_interdata_id IS NULL OR status IS NULL;

UPDATE "vendas_adquirentes" SET conciliacao_id = NULLIF(dados->>'conciliacao_id', '')
WHERE conciliacao_id IS NULL AND NULLIF(dados->>'conciliacao_id', '') IS NOT NULL;
UPDATE "vendas_interdata" SET conciliacao_id = NULLIF(dados->>'conciliacao_id', '')
WHERE conciliacao_id IS NULL AND NULLIF(dados->>'conciliacao_id', '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conciliacoes_venda_adquirente ON "conciliacoes" (venda_adquirente_id);
CREATE INDEX IF NOT EXISTS idx_conciliacoes_venda_interdata ON "conciliacoes" (venda_interdata_id);
CREATE INDEX IF NOT EXISTS idx_conciliacoes_status ON "conciliacoes" (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendas_adquirentes_conciliacao_id ON "vendas_adquirentes" (conciliacao_id) WHERE conciliacao_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendas_interdata_conciliacao_id ON "vendas_interdata" (conciliacao_id) WHERE conciliacao_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendas_adquirentes_conciliacao') THEN
    ALTER TABLE "vendas_adquirentes"
      ADD CONSTRAINT fk_vendas_adquirentes_conciliacao
      FOREIGN KEY (conciliacao_id) REFERENCES "conciliacoes"(row_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendas_interdata_conciliacao') THEN
    ALTER TABLE "vendas_interdata"
      ADD CONSTRAINT fk_vendas_interdata_conciliacao
      FOREIGN KEY (conciliacao_id) REFERENCES "conciliacoes"(row_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

COMMIT;
