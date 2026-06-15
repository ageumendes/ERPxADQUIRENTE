import { Pool } from 'pg';
import { tabelasSistema } from '../repositories/repositorio.js';
import { conversoesSeed } from './conversoes-seed.js';

type DatabaseUrlInfo = {
  databaseUrl: string;
  databaseName: string;
  adminUrl: string;
};

function postgresAtivo() {
  return Boolean(process.env.DATABASE_URL && !['false', '0', 'json'].includes(String(process.env.PERSISTENCIA_POSTGRES || 'true').toLowerCase()));
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

async function ensureAppTables(info: DatabaseUrlInfo) {
  const pool = new Pool({ connectionString: info.databaseUrl });
  try {
    await pool.query('CREATE SCHEMA IF NOT EXISTS public');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGSERIAL PRIMARY KEY,
        versao TEXT NOT NULL UNIQUE,
        descricao TEXT,
        executado_em TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query('DROP TABLE IF EXISTS "linhas_importadas"');

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
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabelaSistema.nome}_dados_gin ON ${tabela} USING GIN (dados)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tabelaSistema.nome}_data_criacao ON ${tabela} (data_criacao)`);
    }

    const conversoes = quoteIdent('conversoes');
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM ${conversoes}`);
    if (Number(count.rows[0]?.total || 0) === 0) {
      for (const [index, conversao] of conversoesSeed.entries()) {
        const rowId = conversao.id || `conv-${index + 1}`;
        await pool.query(
          `INSERT INTO ${conversoes} (row_id, dados, data_criacao, data_atualizacao)
           VALUES ($1, $2::jsonb, NOW(), NOW())
           ON CONFLICT (row_id) DO NOTHING`,
          [rowId, JSON.stringify(conversao)],
        );
      }
      console.log(`[database] ${conversoesSeed.length} conversões padrão inseridas.`);
    }

    await pool.query(
      `INSERT INTO schema_migrations (versao, descricao)
       VALUES ($1, $2)
       ON CONFLICT (versao) DO NOTHING`,
      ['0.1.47', 'Remove tabela linhas_importadas e mantém somente resumo em importacoes'],
    );
  } finally {
    await pool.end();
  }
}

export async function bootstrapDatabase() {
  if (!postgresAtivo()) {
    console.log('[database] PostgreSQL desativado. Usando persistência JSON/local.');
    return;
  }

  const info = parseDatabaseUrl();
  if (!info) return;

  try {
    await ensureDatabaseExists(info);
    await ensureAppTables(info);
    console.log(`[database] PostgreSQL pronto: ${info.databaseName}`);
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : String(error);
    console.error(`[database] Falha no bootstrap PostgreSQL: ${mensagem}`);
    throw error;
  }
}
