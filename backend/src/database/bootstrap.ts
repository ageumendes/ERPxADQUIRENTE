import { preencherValorLiquidoErp } from './erp-valor-liquido.js';
import { Pool, type PoolClient } from 'pg';
import { tabelasSistema } from '../repositories/repositorio.js';
import { conversoesSeed } from './conversoes-seed.js';
import { getPool } from './pool.js';

type DatabaseUrlInfo = {
  databaseUrl: string;
  databaseName: string;
  adminUrl: string;
};

function postgresAtivo() {
  return Boolean(process.env.DATABASE_URL);
}

function parseDatabaseUrl(): DatabaseUrlInfo | null {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  const databaseName = url.pathname.replace(/^\//, '') || 'postgres';
  const adminUrl = process.env.POSTGRES_ADMIN_URL || (() => {
    const admin = new URL(rawUrl);
    admin.pathname = '/postgres';
    return admin.toString();
  })();
  return { databaseUrl: rawUrl, databaseName, adminUrl };
}

function quoteIdent(identifier: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Identificador SQL inválido: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function ensureDatabaseExists(info: DatabaseUrlInfo) {
  const adminPool = new Pool({ connectionString: info.adminUrl });
  try {
    const exists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [info.databaseName]);
    if (exists.rowCount === 0) {
      await adminPool.query(`CREATE DATABASE ${quoteIdent(info.databaseName)}`);
      console.log(`[database] Banco ${info.databaseName} criado automaticamente.`);
    }
  } finally {
    await adminPool.end();
  }
}

export async function aplicarSchemaBanco(pool: Pick<PoolClient, 'query'>) {
    await pool.query('CREATE SCHEMA IF NOT EXISTS public');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        versao TEXT NOT NULL UNIQUE,
        descricao TEXT,
        executado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Preserva todas as estruturas e dados legados.

    await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (
      id UUID PRIMARY KEY, nome TEXT NOT NULL, login TEXT NOT NULL UNIQUE, perfil TEXT NOT NULL,
      senha_hash TEXT NOT NULL, senha_salt TEXT NOT NULL, ativo BOOLEAN NOT NULL DEFAULT TRUE,
      trocar_senha BOOLEAN NOT NULL DEFAULT TRUE, versao_sessao INTEGER NOT NULL DEFAULT 1,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS auditoria_seguranca (
      id UUID PRIMARY KEY, data TIMESTAMPTZ NOT NULL DEFAULT NOW(), usuario_id UUID NULL,
      login TEXT, perfil TEXT, metodo TEXT NOT NULL, rota TEXT NOT NULL, ip TEXT, status INTEGER NOT NULL,
      detalhes JSONB
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes_segurancas (
      chave TEXT PRIMARY KEY, valor_criptografado TEXT NOT NULL, atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_por UUID NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS historico_coletas_sftp (
      id UUID PRIMARY KEY, provider TEXT, sucesso BOOLEAN NOT NULL, resumo JSONB NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    // Remoção solicitada: somente tabelas auxiliares de identificação de cartões.
    await pool.query('DROP TABLE IF EXISTS catalogo_bins');
    await pool.query('DROP TABLE IF EXISTS catalogo_bins_referencia');
    for (const tabelaSistema of tabelasSistema) {
      const tabela = quoteIdent(tabelaSistema.nome);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS ${tabela} (
          pk BIGSERIAL PRIMARY KEY,
          row_id TEXT UNIQUE,
          hash_linha TEXT UNIQUE,
          hash_arquivo TEXT,
          dados JSONB NOT NULL,
          data_criacao TIMESTAMPTZ DEFAULT NOW(),
          data_atualizacao TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await pool.query(`ALTER TABLE ${tabela} DROP CONSTRAINT IF EXISTS "${tabelaSistema.nome}_hash_arquivo_key"`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabelaSistema.nome}_data_criacao ON ${tabela} (data_criacao)`);
      if (tabelaSistema.nome === 'importacoes') {
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_importacoes_hash_arquivo ON ${tabela} (hash_arquivo) WHERE hash_arquivo IS NOT NULL`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_importacoes_status_data ON ${tabela} ((dados->>'status_importacao'), data_criacao DESC)`);
      }
    }
    await pool.query(`ALTER TABLE "vendas_adquirentes" ADD COLUMN IF NOT EXISTS codigo_estabelecimento TEXT GENERATED ALWAYS AS (NULLIF(dados->>'codigo_estabelecimento','')) STORED`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_codigo_estabelecimento ON "vendas_adquirentes" (codigo_estabelecimento) WHERE codigo_estabelecimento IS NOT NULL`);
    await pool.query(`
      WITH candidatos AS (
        SELECT pk, CASE UPPER(COALESCE(dados->>'adquirente',''))
          WHEN 'CIELO' THEN COALESCE(dados->'dados_json'->>'estabelecimento_submissor',dados->'dados_json'->>'numero_estabelecimento')
          WHEN 'SIPAG' THEN COALESCE(dados->'dados_json'->>'numero_estabelecimento',dados->'dados_json'->>'codigo_cliente',dados->'dados_json'->>'COLUNA_02',dados->'dados_json'->>'estabelecimento',dados->'dados_json'->>'merchantId',dados->'dados_json'->>'clientCode',dados->'dados_json'->>'branchClientCode',dados->'dados_json'->>'cpf_cnpj_estabelecimento',dados->'dados_json'->>'document',dados->>'cnpj_estabelecimento')
          WHEN 'SICREDI' THEN COALESCE(dados->'dados_json'->>'merchantId',dados->'dados_json'->>'clientCode',dados->'dados_json'->>'branchClientCode',dados->'dados_json'->>'matrixClientCode',dados->'dados_json'->>'document',dados->>'cnpj_estabelecimento')
          WHEN 'CONVCARD' THEN COALESCE(dados->'dados_json'->>'cnpj_loja',dados->>'cnpj_estabelecimento')
          WHEN 'COOPCERTO' THEN COALESCE(dados->'dados_json'->>'numero_estabelecimento',dados->'dados_json'->>'estabelecimento_relatorio')
          WHEN 'VR' THEN COALESCE(dados->'dados_json'->>'codigo_filiacao',dados->'dados_json'->>'codigo_filiacao_original',dados->'dados_json'->>'cnpj_loja',dados->>'cnpj_estabelecimento')
          WHEN 'ALELO' THEN COALESCE(dados->>'cnpj_estabelecimento',dados->'dados_json'->>'raiz_cnpj')
          WHEN 'PLUXEE' THEN COALESCE(dados->'dados_json'->>'codigo_estabelecimento',dados->'dados_json'->>'cnpj_estabelecimento_principal',dados->>'cnpj_estabelecimento')
          WHEN 'TICKET' THEN COALESCE(dados->'dados_json'->>'identificacao_estabelecimento',dados->>'cnpj_estabelecimento')
          ELSE dados->>'cnpj_estabelecimento' END AS original
        FROM vendas_adquirentes WHERE COALESCE(TRIM(dados->>'codigo_estabelecimento'),'')=''
      ), normalizados AS (
        SELECT pk,original,REGEXP_REPLACE(COALESCE(original,''),'[^0-9]','','g') codigo
        FROM candidatos WHERE COALESCE(TRIM(original),'') NOT IN ('','-')
      )
      UPDATE vendas_adquirentes v SET
        dados=jsonb_set(jsonb_set(v.dados,'{codigo_estabelecimento}',to_jsonb(n.codigo),true),'{dados_json}',COALESCE(v.dados->'dados_json','{}'::jsonb)||jsonb_build_object('codigo_estabelecimento_original',n.original,'codigo_estabelecimento_origem','MIGRACAO_0.1.173'),true),
        data_atualizacao=NOW()
      FROM normalizados n WHERE v.pk=n.pk AND n.codigo<>'' AND n.codigo !~ '^0+$'
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS historico_conciliacoes (
      id BIGSERIAL PRIMARY KEY,
      conciliacao_id TEXT NOT NULL,
      acao TEXT NOT NULL,
      status_anterior TEXT,
      status_novo TEXT,
      motivo TEXT NOT NULL,
      usuario_id TEXT,
      usuario_nome TEXT,
      detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_historico_conciliacoes_conciliacao ON historico_conciliacoes (conciliacao_id, criado_em DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_historico_conciliacoes_criado_em ON historico_conciliacoes (criado_em DESC)`);

    const migrationAtual = await pool.query('SELECT 1 FROM schema_migrations WHERE versao = $1', ['0.1.92']);
    if (migrationAtual.rowCount === 0) {
      await pool.query('BEGIN');
      try {
        await pool.query(`ALTER TABLE "conciliacoes" ADD COLUMN IF NOT EXISTS venda_adquirente_id TEXT`);
        await pool.query(`ALTER TABLE "conciliacoes" ADD COLUMN IF NOT EXISTS venda_interdata_id TEXT`);
        await pool.query(`ALTER TABLE "conciliacoes" ADD COLUMN IF NOT EXISTS status TEXT`);
        await pool.query(`ALTER TABLE "vendas_adquirentes" ADD COLUMN IF NOT EXISTS conciliacao_id TEXT`);
        await pool.query(`ALTER TABLE "vendas_interdata" ADD COLUMN IF NOT EXISTS conciliacao_id TEXT`);
        await pool.query(`UPDATE "conciliacoes" SET venda_adquirente_id = NULLIF(dados->>'venda_adquirente_id', ''), venda_interdata_id = NULLIF(dados->>'venda_interdata_id', ''), status = COALESCE(NULLIF(dados->>'status', ''), 'SUGERIDO') WHERE venda_adquirente_id IS NULL OR venda_interdata_id IS NULL OR status IS NULL`);
        await pool.query(`UPDATE "vendas_adquirentes" SET conciliacao_id = NULLIF(dados->>'conciliacao_id', '') WHERE conciliacao_id IS NULL AND NULLIF(dados->>'conciliacao_id', '') IS NOT NULL`);
        await pool.query(`UPDATE "vendas_interdata" SET conciliacao_id = NULLIF(dados->>'conciliacao_id', '') WHERE conciliacao_id IS NULL AND NULLIF(dados->>'conciliacao_id', '') IS NOT NULL`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_conciliacoes_venda_adquirente ON "conciliacoes" (venda_adquirente_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_conciliacoes_venda_interdata ON "conciliacoes" (venda_interdata_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_conciliacoes_status ON "conciliacoes" (status)`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_vendas_adquirentes_conciliacao_id ON "vendas_adquirentes" (conciliacao_id) WHERE conciliacao_id IS NOT NULL`);
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_vendas_interdata_conciliacao_id ON "vendas_interdata" (conciliacao_id) WHERE conciliacao_id IS NOT NULL`);
        await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendas_adquirentes_conciliacao') THEN ALTER TABLE "vendas_adquirentes" ADD CONSTRAINT fk_vendas_adquirentes_conciliacao FOREIGN KEY (conciliacao_id) REFERENCES "conciliacoes"(row_id) DEFERRABLE INITIALLY DEFERRED; END IF; END $$`);
        await pool.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendas_interdata_conciliacao') THEN ALTER TABLE "vendas_interdata" ADD CONSTRAINT fk_vendas_interdata_conciliacao FOREIGN KEY (conciliacao_id) REFERENCES "conciliacoes"(row_id) DEFERRABLE INITIALLY DEFERRED; END IF; END $$`);
        for (const tabela of ['vendas_adquirentes', 'vendas_interdata']) {
          await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabela}_data_venda_normalizada ON "${tabela}" ((CASE WHEN dados->>'data_venda' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(dados->>'data_venda', 10) WHEN dados->>'data_venda' ~ '^\\d{2}/\\d{2}/\\d{4}' THEN SUBSTRING(dados->>'data_venda', 7, 4) || '-' || SUBSTRING(dados->>'data_venda', 4, 2) || '-' || SUBSTRING(dados->>'data_venda', 1, 2) ELSE '' END))`);
          await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabela}_bandeira ON "${tabela}" (UPPER(dados->>'bandeira'))`);
          await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabela}_status_conciliacao ON "${tabela}" (UPPER(COALESCE(NULLIF(dados->>'status_conciliacao',''), 'PENDENTE')))`);
        }
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_adquirente ON "vendas_adquirentes" (UPPER(dados->>'adquirente'))`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_modalidade ON "vendas_adquirentes" (UPPER(dados->>'modalidade'))`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_relatorio_data_adquirente ON "vendas_adquirentes" ((CASE WHEN dados->>'data_venda' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(dados->>'data_venda', 10) WHEN dados->>'data_venda' ~ '^\\d{2}/\\d{2}/\\d{4}' THEN SUBSTRING(dados->>'data_venda', 7, 4) || '-' || SUBSTRING(dados->>'data_venda', 4, 2) || '-' || SUBSTRING(dados->>'data_venda', 1, 2) ELSE '' END), UPPER(COALESCE(dados->>'adquirente',''))) WHERE UPPER(COALESCE(dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_status_transacao ON "vendas_adquirentes" (UPPER(COALESCE(dados->>'status_transacao','')))`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_duplicidade_status ON "vendas_adquirentes" (UPPER(COALESCE(dados->>'duplicidade_status','')))`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_interdata_modalidade ON "vendas_interdata" (UPPER(COALESCE(dados->>'tipo_produto', dados->>'forma_pagamento')))`);
        await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.92', 'Consultas paginadas, índices e relacionamentos fora das requisições')`);
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }

    const migration094 = await pool.query('SELECT 1 FROM schema_migrations WHERE versao = $1', ['0.1.94']);
    if (migration094.rowCount === 0) {
      await pool.query('BEGIN');
      try {
        for (const tabela of ['vendas_adquirentes', 'vendas_interdata']) {
          await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabela}_conciliacao_pendente ON "${tabela}" (pk) WHERE conciliacao_id IS NULL`);
          await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabela}_data_valor_match ON "${tabela}" (
            (CASE WHEN dados->>'data_venda' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(dados->>'data_venda', 10) WHEN dados->>'data_venda' ~ '^\\d{2}/\\d{2}/\\d{4}' THEN SUBSTRING(dados->>'data_venda', 7, 4) || '-' || SUBSTRING(dados->>'data_venda', 4, 2) || '-' || SUBSTRING(dados->>'data_venda', 1, 2) ELSE '' END),
            (ROUND(CASE WHEN REPLACE(COALESCE(dados->>'valor_bruto',''), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN REPLACE(dados->>'valor_bruto', ',', '.')::numeric ELSE 0 END * 100))
          ) WHERE conciliacao_id IS NULL`);
        }
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_adquirente_pendente ON "vendas_adquirentes" (UPPER(COALESCE(dados->>'adquirente',''))) WHERE conciliacao_id IS NULL`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_nsu_pendente ON "vendas_adquirentes" (UPPER(REGEXP_REPLACE(COALESCE(dados->>'nsu',''), '[^A-Za-z0-9]', '', 'g'))) WHERE conciliacao_id IS NULL`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_interdata_nsu_pendente ON "vendas_interdata" (UPPER(REGEXP_REPLACE(COALESCE(dados->>'nsu',''), '[^A-Za-z0-9]', '', 'g'))) WHERE conciliacao_id IS NULL`);
        await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.94', 'Motor híbrido: lotes, índices de candidatos e vínculos um para um')`);
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }

    const conversoes = quoteIdent('conversoes');
    for (const [index, conversao] of conversoesSeed.entries()) {
      const rowId = conversao.id || `conv-${index + 1}`;
      await pool.query(
        `INSERT INTO ${conversoes} (row_id, dados, data_criacao, data_atualizacao)
         VALUES ($1, $2::jsonb, NOW(), NOW())
         ON CONFLICT (row_id) DO NOTHING`,
        [rowId, JSON.stringify(conversao)],
      );
    }
    await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.106', 'PostgreSQL obrigatório, segurança/SFTP no banco e conversões idempotentes') ON CONFLICT (versao) DO NOTHING`);
    await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.107', 'Preserva conversões cadastradas pelo usuário durante o bootstrap') ON CONFLICT (versao) DO NOTHING`);
    await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.109', 'Conversões persistentes após normalização e correção histórica do layout VR') ON CONFLICT (versao) DO NOTHING`);
    await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.110', 'Conciliação exclusiva bidirecional na janela de 12 horas e horários padronizados') ON CONFLICT (versao) DO NOTHING`);
    await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.111', 'Filtros dinâmicos e encadeados por adquirente, forma de pagamento, modalidade e bandeira') ON CONFLICT (versao) DO NOTHING`);
    await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.112', 'Navegação diária do dashboard com data de referência persistida na URL') ON CONFLICT (versao) DO NOTHING`);
    await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.113', 'Relatório auditável de conversões e atualização segura de dependências') ON CONFLICT (versao) DO NOTHING`);
    await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.114', 'Blindagem urgente de banco, autenticação, SFTP, uploads e dados internos') ON CONFLICT (versao) DO NOTHING`);
    const migration115 = await pool.query('SELECT 1 FROM schema_migrations WHERE versao = $1', ['0.1.115']);
    if (migration115.rowCount === 0) {
      for (const tabelaSistema of tabelasSistema) {
        await pool.query(`DROP INDEX IF EXISTS idx_${tabelaSistema.nome}_dados_gin`);
      }
      for (const tabela of ['vendas_adquirentes', 'vendas_interdata']) {
        await pool.query(`DROP INDEX IF EXISTS idx_${tabela}_terminal`);
      }
      await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.115', 'Parsers isolados, paginação SQL, inserções em lote e índices enxutos')`);
    }

    // v0.1.148 — corrige somente classificações históricas inequívocas de status.
    // Nenhuma data é alterada nesta migração: datas continuam sob responsabilidade
    // das conversões cadastradas pelo usuário no frontend.
    const migration148 = await pool.query('SELECT 1 FROM schema_migrations WHERE versao = $1', ['0.1.148']);
    if (migration148.rowCount === 0) {
      await pool.query('BEGIN');
      try {
        const reparo = await pool.query(`
          UPDATE vendas_adquirentes
             SET dados = jsonb_set(dados, '{status_transacao}', to_jsonb('NEGADO'::text), true),
                 data_atualizacao = NOW()
           WHERE UPPER(COALESCE(dados->>'status_transacao','')) = 'AUTORIZADO'
             AND UPPER(COALESCE(dados->>'status_transacao_original','')) LIKE 'UNAUTHORIZED%'
        `);
        await pool.query(
          `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2)`,
          ['0.1.148', `Status explícito UNAUTHORIZED prevalece sobre inferência de layout; ${reparo.rowCount || 0} registro(s) histórico(s) reparado(s).`],
        );
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }

    await pool.query(`INSERT INTO schema_migrations (versao, descricao) VALUES ('0.1.149', 'Conversões por transformação de formato e suporte explícito a valor original vazio') ON CONFLICT (versao) DO NOTHING`);
    const migration150 = await pool.query('SELECT 1 FROM schema_migrations WHERE versao = $1', ['0.1.150']);
    if (migration150.rowCount === 0) {
      await pool.query('BEGIN');
      try {
        const recalculo = await pool.query(`
          WITH base AS (
            SELECT pk,
                   CASE
                     WHEN REPLACE(COALESCE(dados->>'valor_bruto',''), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                       THEN ABS(REPLACE(dados->>'valor_bruto', ',', '.')::numeric)
                     ELSE 0::numeric
                   END AS bruto,
                   CASE
                     WHEN REPLACE(COALESCE(dados->>'valor_taxa',''), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                       THEN ABS(REPLACE(dados->>'valor_taxa', ',', '.')::numeric)
                     ELSE 0::numeric
                   END AS taxa
              FROM vendas_adquirentes
          ), calc AS (
            SELECT pk,
                   CASE WHEN bruto > 0
                        THEN TO_CHAR((taxa / bruto) * 100, 'FM999999990.0000')
                        ELSE '0.0000'
                   END AS percentual
              FROM base
          )
          UPDATE vendas_adquirentes v
             SET dados = jsonb_set(v.dados, '{percentual_taxa}', to_jsonb(calc.percentual::text), true),
                 data_atualizacao = NOW()
            FROM calc
           WHERE v.pk = calc.pk
             AND COALESCE(v.dados->>'percentual_taxa','') IS DISTINCT FROM calc.percentual
        `);
        const regrasDesativadas = await pool.query(`
          UPDATE conversoes
             SET dados = jsonb_set(dados, '{ativo}', 'false'::jsonb, true),
                 data_atualizacao = NOW()
           WHERE dados->>'tabela_origem' = 'vendas_adquirentes'
             AND dados->>'coluna_origem' = 'percentual_taxa'
             AND COALESCE((dados->>'ativo')::boolean, true) = true
        `);
        await pool.query(
          `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2)`,
          ['0.1.150', `Integridade do percentual de taxa: ${recalculo.rowCount || 0} venda(s) recalculada(s) e ${regrasDesativadas.rowCount || 0} regra(s) manual(is) desativada(s).`],
        );
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }



    // v0.1.152 — PIX de mesma titularidade não útil + higiene das tabelas brutas.
    const migration152 = await pool.query('SELECT 1 FROM schema_migrations WHERE versao = $1', ['0.1.152']);
    if (migration152.rowCount === 0) {
      await pool.query('BEGIN');
      try {
        const pixNaoUteis = await pool.query(`
          WITH candidatos AS (
            SELECT pk,
                   REGEXP_REPLACE(
                     COALESCE(
                       NULLIF(dados->>'pagador_documento',''),
                       NULLIF(dados->'dados_json'->>'pagador_cnpj',''),
                       NULLIF(dados->'dados_json'->>'pagador_cpf',''),
                       CASE
                         WHEN LEFT(TRIM(COALESCE(dados->>'linha_original','')),1) = '{'
                           THEN COALESCE(
                             NULLIF((dados->>'linha_original')::jsonb #>> '{pagador,cnpj}',''),
                             NULLIF((dados->>'linha_original')::jsonb #>> '{pagador,cpf}','')
                           )
                         ELSE NULL
                       END,
                       ''
                     ),
                     '[^0-9]', '', 'g'
                   ) AS documento
              FROM vendas_adquirentes
             WHERE UPPER(COALESCE(dados->>'adquirente','')) = 'SICOOB'
               AND UPPER(COALESCE(dados->>'codigo_produto','')) = 'SICOOB_PSP_PIX'
          )
          UPDATE vendas_adquirentes v
             SET dados = jsonb_set(
                           jsonb_set(
                             jsonb_set(v.dados, '{pagador_documento}', to_jsonb(c.documento::text), true),
                             '{utilidade_status}', to_jsonb('NAO_UTIL'::text), true
                           ),
                           '{utilidade_motivo}', to_jsonb('PIX_MESMA_TITULARIDADE'::text), true
                         ),
                 data_atualizacao = NOW()
            FROM candidatos c
           WHERE v.pk = c.pk
             AND c.documento IN ('27752608000129','27752608000200','99271133234')
             AND UPPER(COALESCE(v.dados->>'utilidade_status','')) <> 'NAO_UTIL'
        `);

        const pixBrutosNaoUteis = await pool.query(`
          WITH candidatos AS (
            SELECT pk,
                   REGEXP_REPLACE(COALESCE(NULLIF(dados->>'pagador_cnpj',''), NULLIF(dados->>'pagador_cpf',''), ''), '[^0-9]', '', 'g') AS documento
              FROM sicoob_layout_psp_pix
          )
          UPDATE sicoob_layout_psp_pix s
             SET dados = jsonb_set(
                           jsonb_set(
                             jsonb_set(s.dados, '{pagador_documento}', to_jsonb(c.documento::text), true),
                             '{utilidade_status}', to_jsonb('NAO_UTIL'::text), true
                           ),
                           '{utilidade_motivo}', to_jsonb('PIX_MESMA_TITULARIDADE'::text), true
                         ),
                 data_atualizacao = NOW()
            FROM candidatos c
           WHERE s.pk = c.pk
             AND c.documento IN ('27752608000129','27752608000200','99271133234')
        `);

        // Cabeçalhos/totalizadores originais permanecem nas tabelas brutas.
        const limpezas: number[] = [];

        const regrasMigradas = await pool.query(`
          UPDATE conversoes
             SET dados = jsonb_set(dados, '{tabela_origem}', to_jsonb('vendas_interdata'::text), true),
                 data_atualizacao = NOW()
           WHERE dados->>'tabela_origem' = 'vendas_erp'
        `);
        const regrasBrutasDesativadas = await pool.query(`
          UPDATE conversoes
             SET dados = jsonb_set(dados, '{ativo}', 'false'::jsonb, true),
                 data_atualizacao = NOW()
           WHERE COALESCE(dados->>'tabela_origem','') NOT IN ('vendas_interdata','vendas_adquirentes','vendas_erp')
             AND COALESCE((dados->>'ativo')::boolean, true) = true
        `);

        await pool.query(
          `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2)`,
          ['0.1.152', `PIX mesma titularidade marcados como não úteis: ${pixNaoUteis.rowCount || 0} canônico(s) e ${pixBrutosNaoUteis.rowCount || 0} bruto(s); estruturas brutas removidas: ${limpezas.reduce((a,b)=>a+b,0)}; regras vendas_erp migradas: ${regrasMigradas.rowCount || 0}; regras de tabela bruta desativadas: ${regrasBrutasDesativadas.rowCount || 0}.`],
        );
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }

    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.153', 'Layout TICKET CEADM40: vendas tipo 2 e pagamentos tipo 4, sem headers/subtotalizadores/trailers'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.154', 'Layout SIPAG Vendas PIX CSV: tabela bruta original, projeção canônica e validação do totalizador'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.155', 'Layout COOPCERTO CABAL Vendas CSV: tabela bruta original, projeção canônica, status pendente e validação do totalizador'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.157', 'Saneamento estrutural, autorização de reversões, pool PostgreSQL compartilhado, índices de importação e polling otimizado'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.158', 'Estabilização dos testes e modularização inicial de auditoria, conversões e checklist de importações'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.159', 'Modularização do repositório de importações e dos tipos, utilitários e mapas de logos do frontend'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.160', 'Extração das páginas de duplicidades, auditoria e usuários, formatadores compartilhados e smoke test de contratos ESM'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.161', 'Modularização das páginas de vendas, filtros compartilhados, busca textual paginada, URL persistente e cancelamento de consultas'],
    );
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_relatorio_data_adquirente ON "vendas_adquirentes" ((CASE WHEN dados->>'data_venda' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(dados->>'data_venda', 10) WHEN dados->>'data_venda' ~ '^\\d{2}/\\d{2}/\\d{4}' THEN SUBSTRING(dados->>'data_venda', 7, 4) || '-' || SUBSTRING(dados->>'data_venda', 4, 2) || '-' || SUBSTRING(dados->>'data_venda', 1, 2) ELSE '' END), UPPER(COALESCE(dados->>'adquirente',''))) WHERE UPPER(COALESCE(dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_status_transacao ON "vendas_adquirentes" (UPPER(COALESCE(dados->>'status_transacao','')))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_duplicidade_status ON "vendas_adquirentes" (UPPER(COALESCE(dados->>'duplicidade_status','')))`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_erp_parcelas_sipag ON vendas_interdata(row_id)
      WHERE COALESCE(dados->>'parcelas','') ~ '^[0-9]+[ ]*/[ ]*[0-9]+$'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_erp_grupo_sipag ON vendas_interdata(row_id)
      WHERE dados->>'origem_erp'='AGRUPAMENTO_PARCELAS_SIPAG'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_erp_reserva_parcelas ON vendas_interdata((dados->>'agrupamento_erp_id'))`);
    await preencherValorLiquidoErp(pool);
    // v0.1.193: o pós-processamento incremental localiza as linhas do lote por
    // importacao_id (ou pelo último lote que complementou uma linha histórica).
    for (const tabela of ['vendas_adquirentes', 'vendas_interdata']) {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabela}_escopo_importacao ON "${tabela}" ((COALESCE(NULLIF(dados->>'ultima_importacao_id',''),dados->>'importacao_id','')))`);
    }
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.162', 'Modularização do relatório financeiro, consulta agrupada materializada, índices dedicados, filtros persistentes e cancelamento de requisições'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.193', 'Pós-processamento incremental por lote, período afetado e índices de escopo de importação'],
    );
    // Índice compatível com linhas SIPAG complementadas pela v0.1.193, que
    // guardavam ultima_importacao_id dentro de dados_json.
    for (const tabela of ['vendas_adquirentes', 'vendas_interdata']) {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabela}_escopo_importacao_v194 ON "${tabela}" ((COALESCE(NULLIF(dados->>'ultima_importacao_id',''),NULLIF(dados->'dados_json'->>'ultima_importacao_id',''),dados->>'importacao_id','')))`);
    }
    // v0.1.194: os arquivos de origem já informam a bandeira. Conversões cujo
    // valor original é um BIN de seis dígitos apenas aumentam o custo do job e
    // não devem voltar a ser criadas pelo catálogo descontinuado.
    // Preserva o histórico das regras BIN e apenas as desativa. A exclusão
    // física impediria auditoria e restauração das conversões antigas.
    await pool.query(`
      UPDATE conversoes
         SET dados = dados || jsonb_build_object('ativo', false, 'desativado_por', 'MIGRACAO_0.1.194'),
             data_atualizacao = NOW()
       WHERE dados->>'tabela_origem' = 'vendas_adquirentes'
         AND dados->>'coluna_origem' = 'bandeira'
         AND TRIM(COALESCE(dados->>'valor_original','')) ~ '^[0-9]{6}$'
    `);
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.194', 'Remoção das conversões e consultas de BIN; correção do escopo incremental de vendas SIPAG complementadas'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.163', 'Simplificação dos filtros do relatório financeiro e consulta automática pelos atalhos de período'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.164', 'Correção da consulta duplicada nos atalhos de período do relatório financeiro'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.165', 'Cards compactos de SFTP, arquivamento remoto resiliente e atalhos financeiros sem reconsulta'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.166', 'Dashboard agrupado por adquirente e pela data dos itens importados'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.167', 'Quatro layouts de EXTRATOS SIPAG e código físico de estabelecimento nas vendas das adquirentes'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.177', 'Proteção do pool PostgreSQL e tratamento de indisponibilidade temporária no explorador de tabelas'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.179', 'Novo cabeçalho ERP INTERDATA com CNPJ e razão social do estabelecimento'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.180', 'Coluna e filtros de estabelecimento nas vendas e no relatório financeiro'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.181', 'Estabelecimento SICOOB, lista negra NÃO APLICA e barreira de conciliação por estabelecimento'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.182', 'Ajustes de filtros, ordem por estabelecimento e busca por valores financeiros'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.187', 'Serialização do pós-processamento, retry de deadlock e telemetria de vínculos SIPAG'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.188', 'Fila por lote com janela de fechamento e pós-processamento global único'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.189', 'Consolidação VOUCHER entre adquirente econômica e rede de captura antes da conciliação automática'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.190', 'Acionamento manual da Consolidação VOUCHER e relatório de conversões em modal sobreposto'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.191', 'Motor de Consolidação VOUCHER por estratégia: COOPCERTO/CABAL, VR por NSU e deduplicação interna segura'],
    );
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.192', 'Consulta canônica de vendas, chave complementar SIPAG e recuperação de estabelecimentos legados'],
    );
    const migration202PagadorDocumento = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE versao = $1',
      ['0.1.202-pagador-documento-nao-aplica'],
    );
    if (migration202PagadorDocumento.rowCount === 0) {
      await pool.query('BEGIN');
      try {
        await pool.query(`
          UPDATE conversoes
             SET dados = jsonb_set(dados, '{coluna_origem}', to_jsonb('pagador_documento'::text), true),
                 data_atualizacao = NOW()
           WHERE dados->>'tabela_origem' = 'vendas_adquirentes'
             AND dados->>'coluna_origem' = 'pagador_cnpj'
             AND UPPER(TRIM(COALESCE(dados->>'adquirente_aplicacao',''))) = 'SICOOB'
             AND REGEXP_REPLACE(COALESCE(dados->>'valor_original',''), '[^0-9]', '', 'g')
                 IN ('27752608000129', '27752608000200')
             AND REGEXP_REPLACE(
                   TRANSLATE(UPPER(COALESCE(dados->>'valor_exibicao','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'),
                   '[^A-Z0-9]', '', 'g'
                 ) = 'NAOAPLICA'
        `);
        await pool.query(
          `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2)`,
          [
            '0.1.202-pagador-documento-nao-aplica',
            'Corrige para pagador_documento as regras NÃO APLICA dos CNPJs próprios SICOOB',
          ],
        );
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
    const migration207Coopcerto = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE versao = $1',
      ['0.1.207-coopcerto-upsert'],
    );
    if (migration207Coopcerto.rowCount === 0) {
      await pool.query('BEGIN');
      try {
        // O RRN/ID Venda existe ainda na pendência. NSU, taxa, líquido e status
        // mudam depois e, portanto, não podem compor a identidade da venda.
        await pool.query(`
          WITH chaves AS (
            SELECT pk,
                   'COOPCERTO|' || UPPER(TRIM(estabelecimento)) || '|' ||
                   UPPER(TRIM(id_venda)) || '|' || UPPER(TRIM(parcelas)) AS chave
              FROM (
                SELECT pk,
                       COALESCE(
                         NULLIF(dados->'dados_json'->>'Nº do estabelecimento',''),
                         NULLIF(dados->'dados_json'->>'numero_estabelecimento',''),
                         NULLIF(dados->'dados_json'->>'estabelecimento_relatorio',''),
                         NULLIF(dados->>'codigo_estabelecimento','')
                       ) AS estabelecimento,
                       COALESCE(
                         NULLIF(dados->'dados_json'->>'id_venda_rrn',''),
                         NULLIF(dados->'dados_json'->>'ID Venda',''),
                         NULLIF(dados->'dados_json'->>'id_venda','')
                       ) AS id_venda,
                       COALESCE(
                         NULLIF(dados->>'parcelas',''),
                         NULLIF(CONCAT(dados->'dados_json'->>'Parcela','/',dados->'dados_json'->>'Total de parcela'),'/')
                       ) AS parcelas
                  FROM vendas_adquirentes
                 WHERE UPPER(COALESCE(dados->>'adquirente',''))='COOPCERTO'
                   AND UPPER(COALESCE(dados->>'tipo_arquivo','')) IN ('COOPCERTO_CABAL_VENDAS_CSV','COOPCERTO_CABAL_ATUALIZADA')
              ) origem
             WHERE COALESCE(estabelecimento,'') <> ''
               AND COALESCE(id_venda,'') NOT IN ('','-')
               AND COALESCE(parcelas,'') NOT IN ('','-')
          )
          UPDATE vendas_adquirentes AS venda
             SET dados = jsonb_set(
                           jsonb_set(venda.dados, '{chave_semantica_coopcerto}', to_jsonb(chaves.chave), true),
                           '{dados_json}',
                           (CASE WHEN jsonb_typeof(venda.dados->'dados_json')='object'
                                 THEN venda.dados->'dados_json' ELSE '{}'::jsonb END)
                             || jsonb_build_object('chave_semantica_coopcerto',chaves.chave),
                           true
                         ),
                 data_atualizacao=NOW()
            FROM chaves
           WHERE venda.pk=chaves.pk
        `);

        await pool.query(`
          CREATE TEMP TABLE coopcerto_207_plano ON COMMIT DROP AS
          WITH candidatas AS (
            SELECT pk, row_id, dados, data_atualizacao,
                   dados->>'chave_semantica_coopcerto' AS chave,
                   NULLIF(TRIM(COALESCE(dados->>'conciliacao_id','')),'') AS conciliacao_id,
                   CASE
                     WHEN UPPER(COALESCE(dados->>'status_transacao','')) ~ '(CANCEL|ESTORN)' THEN 3
                     WHEN UPPER(COALESCE(dados->>'status_transacao','')) ~ '(AUTORIZ|PROCESSAD|APROVAD|NEGAD|RECUS|REJEIT)' THEN 2
                     WHEN UPPER(COALESCE(dados->>'status_transacao','')) LIKE '%PENDENTE%' THEN 0
                     ELSE 1
                   END AS prioridade_status
              FROM vendas_adquirentes
             WHERE UPPER(COALESCE(dados->>'adquirente',''))='COOPCERTO'
               AND UPPER(COALESCE(dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'
               AND COALESCE(dados->>'chave_semantica_coopcerto','') <> ''
          ), grupos AS (
            SELECT chave, COUNT(*) AS quantidade,
                   COUNT(DISTINCT conciliacao_id) FILTER (WHERE conciliacao_id IS NOT NULL) AS conciliacoes
              FROM candidatas GROUP BY chave HAVING COUNT(*) > 1
          )
          SELECT c.*,
                 FIRST_VALUE(c.pk) OVER (
                   PARTITION BY c.chave
                   ORDER BY (c.conciliacao_id IS NOT NULL) DESC, c.pk ASC
                 ) AS principal_pk,
                 FIRST_VALUE(c.pk) OVER (
                   PARTITION BY c.chave
                   ORDER BY c.prioridade_status DESC, c.data_atualizacao DESC, c.pk DESC
                 ) AS fonte_pk,
                 g.conciliacoes
            FROM candidatas c JOIN grupos g USING (chave)
        `);

        await pool.query(`
          WITH pares AS (
            SELECT DISTINCT chave, principal_pk, fonte_pk
              FROM coopcerto_207_plano WHERE conciliacoes <= 1
          )
          UPDATE vendas_adquirentes AS principal
             SET dados = principal.dados || fonte.dados ||
                         jsonb_build_object(
                           'id',principal.dados->>'id',
                           'importacao_id',principal.dados->>'importacao_id',
                           'data_criacao',principal.dados->>'data_criacao',
                           'chave_semantica_coopcerto',pares.chave,
                           'ultima_importacao_id',COALESCE(NULLIF(fonte.dados->>'ultima_importacao_id',''),fonte.dados->>'importacao_id'),
                           'coopcerto_consolidacao_retroativa',true
                         ) ||
                         CASE WHEN COALESCE(principal.dados->>'conciliacao_id','') <> ''
                           THEN jsonb_build_object(
                             'conciliacao_id',principal.dados->>'conciliacao_id',
                             'status_conciliacao',principal.dados->>'status_conciliacao',
                             'score_conciliacao',principal.dados->'score_conciliacao',
                             'tipo_match',principal.dados->>'tipo_match'
                           ) ELSE '{}'::jsonb END,
                 data_atualizacao=NOW()
            FROM pares
            JOIN vendas_adquirentes AS fonte ON fonte.pk=pares.fonte_pk
           WHERE principal.pk=pares.principal_pk
        `);

        const substituidas = await pool.query(`
          WITH pares AS (
            SELECT DISTINCT chave, principal_pk
              FROM coopcerto_207_plano WHERE conciliacoes <= 1
          )
          UPDATE vendas_adquirentes AS redundante
             SET dados = redundante.dados || jsonb_build_object(
                   'utilidade_status','NAO_UTIL',
                   'utilidade_motivo','COOPCERTO_ATUALIZACAO_SUBSTITUIDA',
                   'coopcerto_substituida_por_id',principal.row_id,
                   'coopcerto_consolidada_em',NOW()::text
                 ),
                 data_atualizacao=NOW()
            FROM pares
            JOIN vendas_adquirentes AS principal ON principal.pk=pares.principal_pk
           WHERE redundante.dados->>'chave_semantica_coopcerto'=pares.chave
             AND redundante.pk <> pares.principal_pk
          RETURNING redundante.pk
        `);

        const conflitos = await pool.query(`
          UPDATE vendas_adquirentes AS venda
             SET dados = venda.dados || jsonb_build_object(
                   'coopcerto_conflito_atualizacao',true,
                   'coopcerto_conflito_motivo','MULTIPLAS_CONCILIACOES'
                 ),
                 data_atualizacao=NOW()
            FROM (SELECT DISTINCT chave FROM coopcerto_207_plano WHERE conciliacoes > 1) conflito
           WHERE venda.dados->>'chave_semantica_coopcerto'=conflito.chave
          RETURNING venda.pk
        `);

        await pool.query(
          `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2)`,
          [
            '0.1.207-coopcerto-upsert',
            `Atualização idempotente COOPCERTO por RRN; ${substituidas.rowCount || 0} cópias históricas ocultadas e ${conflitos.rowCount || 0} registros conflitantes preservados`,
          ],
        );
        await pool.query('COMMIT');
      } catch (error) {
        await pool.query('ROLLBACK');
        throw error;
      }
    }
    // DDL precisa ocorrer fora da transação que atualiza vendas_adquirentes.
    // Triggers diferidos deixam eventos pendentes até o COMMIT e o PostgreSQL
    // rejeita CREATE INDEX nesse intervalo com o erro 55006.
    // A execução incondicional também recupera uma eventual falha isolada do
    // índice mesmo quando a migração de dados já tiver sido confirmada.
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_chave_coopcerto
      ON vendas_adquirentes ((COALESCE(NULLIF(dados->>'chave_semantica_coopcerto',''),dados->'dados_json'->>'chave_semantica_coopcerto','')))
      WHERE UPPER(COALESCE(dados->>'adquirente',''))='COOPCERTO'
        AND UPPER(COALESCE(dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_coopcerto_rrn_legado
      ON vendas_adquirentes ((UPPER(TRIM(COALESCE(NULLIF(dados->'dados_json'->>'id_venda_rrn',''),NULLIF(dados->'dados_json'->>'ID Venda',''),dados->'dados_json'->>'id_venda','')))))
      WHERE UPPER(COALESCE(dados->>'adquirente',''))='COOPCERTO'
        AND UPPER(COALESCE(dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'
    `);
    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao) VALUES ($1, $2) ON CONFLICT (versao) DO NOTHING`,
      ['0.1.47', 'Remove tabela linhas_importadas e mantém somente resumo em importacoes'],
    );
}

export async function bootstrapDatabase() {
  if (!postgresAtivo()) {
    throw new Error('DATABASE_URL é obrigatória. A persistência local em JSON foi removida; a aplicação exige PostgreSQL.');
  }

  const info = parseDatabaseUrl();
  if (!info) return;

  try {
    if (process.env.NODE_ENV !== 'production' || process.env.DATABASE_AUTO_CREATE === 'true') await ensureDatabaseExists(info);
    const client = await getPool().connect();
    try {
      await client.query('SELECT pg_advisory_lock(242, 2)');
      await aplicarSchemaBanco(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(242, 2)').catch(() => undefined);
      client.release();
    }
    console.log(`[database] PostgreSQL pronto: ${info.databaseName}`);
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error(`[database] Falha no bootstrap PostgreSQL: ${mensagem}`);
    throw error;
  }
}
