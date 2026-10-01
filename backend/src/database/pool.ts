import { Pool } from 'pg';

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Math.max(2, Number(process.env.POSTGRES_POOL_MAX || 10)),
      idleTimeoutMillis: Math.max(1_000, Number(process.env.POSTGRES_IDLE_TIMEOUT_MS || 30_000)),
      connectionTimeoutMillis: Math.max(1_000, Number(process.env.POSTGRES_CONNECTION_TIMEOUT_MS || 10_000)),
    });
    pool.on('error', (error) => console.error('[database] Erro inesperado em conexão ociosa:', error.message));
  }
  return pool;
}

export async function closePool() {
  const atual = pool;
  pool = null;
  if (atual) await atual.end();
}
