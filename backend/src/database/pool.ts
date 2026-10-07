import { Pool } from 'pg';
import { obterOpcoesPool } from '../config/postgres.js';

let pool: Pool | null = null;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ...obterOpcoesPool(),
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
