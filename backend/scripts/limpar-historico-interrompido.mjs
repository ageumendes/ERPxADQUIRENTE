import '../dist/config/env.js';
import fs from 'node:fs/promises';
import { getPool, closePool } from '../dist/database/pool.js';
const aplicar=process.argv.includes('--aplicar');
try {
  const pool=getPool();
  const rows=(await pool.query(`SELECT row_id,dados FROM importacoes
    WHERE dados->>'status_importacao' IN ('RECEBIDO','ENFILEIRADO','CLASSIFICANDO','PROCESSANDO','PROCESSANDO_FILA','RECUPERADO_REENFILEIRADO')
      AND data_atualizacao<NOW()-INTERVAL '24 hours' ORDER BY pk`)).rows;
  const ausentes=[];
  for(const row of rows) {
    try {await fs.access(row.dados.caminho_arquivo);} catch(error) {
      if(error.code==='ENOENT') ausentes.push(row.row_id); else throw error;
    }
  }
  // Não apaga dados: encerra somente estados órfãos. Rode com o serviço parado.
  if(aplicar&&ausentes.length) await pool.query(`UPDATE importacoes SET dados=dados ||
    '{"status_importacao":"ERRO","mensagem_erro":"Arquivo ausente; estado interrompido encerrado manualmente."}'::jsonb,
    data_atualizacao=NOW() WHERE row_id=ANY($1::text[])`,[ausentes]);
  console.log(JSON.stringify({modo:aplicar?'APLICAR':'PREVIA',interrompidas:rows.length,arquivos_ausentes:ausentes},null,2));
} finally {await closePool();}
