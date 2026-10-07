function inteiro(env: NodeJS.ProcessEnv, nome: string, padrao: number, minimo: number, maximo: number) {
  const bruto = env[nome];
  const numero = bruto === undefined ? padrao : Number(bruto);
  if (!String(bruto ?? padrao).trim() || !Number.isSafeInteger(numero) || numero < minimo || numero > maximo)
    throw new Error(`${nome} deve ser um inteiro entre ${minimo} e ${maximo}.`);
  return numero;
}

export function obterOpcoesPool(env: NodeJS.ProcessEnv = process.env) {
  return {
    // Exclusividade da instância + tarefa de fundo + consultas HTTP.
    max: inteiro(env, 'POSTGRES_POOL_MAX', 10, 4, 100),
    statement_timeout: inteiro(env, 'POSTGRES_STATEMENT_TIMEOUT_MS', 120_000, 1_000, 2_147_483_647),
    idle_in_transaction_session_timeout: inteiro(env, 'POSTGRES_TRANSACTION_IDLE_TIMEOUT_MS', 120_000, 1_000, 2_147_483_647),
    idleTimeoutMillis: inteiro(env, 'POSTGRES_IDLE_TIMEOUT_MS', 30_000, 1_000, 2_147_483_647),
    connectionTimeoutMillis: inteiro(env, 'POSTGRES_CONNECTION_TIMEOUT_MS', 10_000, 1_000, 2_147_483_647),
  };
}
