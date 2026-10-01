BEGIN;

CREATE TABLE IF NOT EXISTS "auditoria_duplicidades" (
  id BIGSERIAL PRIMARY KEY,
  execucao_id TEXT NOT NULL,
  tabela TEXT NOT NULL,
  chave_duplicidade TEXT NOT NULL,
  registro_mantido_id TEXT NOT NULL,
  registro_removido_id TEXT,
  conciliacao_preservada_id TEXT,
  criterio_manutencao TEXT NOT NULL,
  status TEXT NOT NULL,
  detalhes JSONB NOT NULL,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_duplicidades_execucao
  ON "auditoria_duplicidades" (execucao_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_duplicidades_tabela_criado
  ON "auditoria_duplicidades" (tabela, criado_em DESC);

COMMIT;
