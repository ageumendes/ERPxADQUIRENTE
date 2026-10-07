import '../dist/config/env.js';
import { getPool, closePool } from '../dist/database/pool.js';
const index=process.argv.indexOf('--importacao');
const id=index>=0?process.argv[index+1]:'';
if(!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Informe --importacao UUID. Comando somente leitura.');
try {
  const pool=getPool();
  const resumo=await pool.query(`SELECT dados->>'status_importacao' AS status,
    dados->>'quantidade_registros' AS registros, dados->>'quantidade_processados' AS processados,
    dados->>'quantidade_erros' AS erros FROM importacoes WHERE row_id=$1`,[id]);
  const vendas=await pool.query(`SELECT dados->>'adquirente' AS adquirente,dados->>'status_transacao' AS status,
    COUNT(*)::int AS quantidade,COUNT(*) FILTER(WHERE conciliacao_id IS NOT NULL)::int AS vinculadas
    FROM vendas_adquirentes WHERE dados->>'importacao_id'=$1 GROUP BY 1,2 ORDER BY 1,2`,[id]);
  console.log(JSON.stringify({importacao:id,resumo:resumo.rows,vendas:vendas.rows},null,2));
} finally {await closePool();}
