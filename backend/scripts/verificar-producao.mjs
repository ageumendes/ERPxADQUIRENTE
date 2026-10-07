import '../dist/config/env.js';
import { validarConfiguracaoProducao } from '../dist/config/producao.js';
import { getPool, closePool } from '../dist/database/pool.js';
import { APP_VERSION } from '../dist/version.js';

// Apenas leitura: não faz bootstrap, não executa correções e não modifica o banco.
let client;
try {
  validarConfiguracaoProducao();
  client = await getPool().connect();
  await client.query('BEGIN READ ONLY');
  const resultado = await client.query(`
    SELECT c.row_id AS conciliacao_id, c.status AS status_conciliacao,
           a.row_id AS venda_adquirente_id, a.dados->>'status_transacao' AS status_transacao,
           a.dados->'revisao_coopcerto'->>'status' AS revisao
      FROM conciliacoes c JOIN vendas_adquirentes a ON a.row_id=c.venda_adquirente_id
     WHERE c.status <> 'DESFEITO' AND UPPER(a.dados->>'adquirente')='COOPCERTO'
       AND (a.dados->'revisao_coopcerto'->>'status'='PENDENTE'
         OR UPPER(TRIM(COALESCE(a.dados->>'status_transacao',''))) <> 'AUTORIZADO')
     ORDER BY c.row_id`);
  const pendentes = await client.query(`SELECT COUNT(*)::int AS total FROM vendas_adquirentes
    WHERE dados->'revisao_coopcerto'->>'status'='PENDENTE'`);
  await client.query('ROLLBACK');
  const total = pendentes.rows[0].total;
  console.log(JSON.stringify({ versao: APP_VERSION, somente_leitura: true,
    revisoes_coopcerto_pendentes: total, vinculos_coopcerto_para_revisar: resultado.rowCount,
    amostra_vinculos: resultado.rows.slice(0, 100),
    mensagem: total || resultado.rowCount
      ? 'Revise estes casos antes de liberar a operação financeira. Nenhum registro foi alterado.'
      : 'Verificação COOPCERTO sem pendências detectadas. Conclua também os testes de homologação e restauração.'
  }, null, 2));
  if (total || resultado.rowCount) process.exitCode = 2;
} catch (error) {
  // Não imprime URLs de conexão, conteúdo do ambiente nem mensagens com credenciais.
  console.error('Verificação não concluída. Confira a configuração de produção, o build e a conexão com o banco.');
  process.exitCode = 1;
} finally {
  if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
  await closePool();
}
