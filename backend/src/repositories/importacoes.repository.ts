import { randomUUID } from 'node:crypto';
import { getPool } from '../database/pool.js';

export type Importacao = {
  id: string;
  nome_arquivo_original: string;
  nome_arquivo_salvo: string;
  caminho_arquivo: string;
  tamanho_bytes: number;
  tipo_mime?: string;
  hash_arquivo: string;
  origem_detectada: string;
  layout_detectado: string;
  status_importacao: string;
  quantidade_registros: number;
  quantidade_processados: number;
  quantidade_erros: number;
  mensagem_erro?: string | null;
  data_importacao: string;
  data_atualizacao: string;
};

type LinhaImportacao = { dados: Importacao };

const statusPendentes = [
  'RECEBIDO',
  'CLASSIFICANDO',
  'PROCESSANDO',
  'PROCESSANDO_FILA',
  'RECUPERADO_REENFILEIRADO',
];

function serializarJsonb(valor: unknown) {
  return JSON.stringify(valor, (_chave, item) => typeof item === 'bigint' ? item.toString() : item);
}

export async function listarImportacoes(limite = 500, offset = 0): Promise<Importacao[]> {
  const tamanhoPagina = Math.max(1, Math.min(Number(limite) || 500, 5000));
  const inicio = Math.max(0, Number(offset) || 0);
  const result = await getPool().query<LinhaImportacao>(
    `SELECT dados FROM "importacoes" ORDER BY data_criacao DESC, pk DESC LIMIT $1 OFFSET $2`,
    [tamanhoPagina, inicio],
  );
  return result.rows.map((row) => row.dados);
}

export async function excluirImportacaoFalhaOuDuplicada(id: string, permitirInterrompidas = false): Promise<'EXCLUIDA' | 'NAO_ENCONTRADA' | 'STATUS_BLOQUEADO'> {
  const resultado = await getPool().query(
    `DELETE FROM "importacoes"
      WHERE row_id=$1 AND (
        dados->>'status_importacao' IN ('ERRO','ARQUIVO_DUPLICADO')
        OR ($2::boolean AND dados->>'status_importacao' IN ('RECEBIDO','ENFILEIRADO','CLASSIFICANDO','PROCESSANDO','PROCESSANDO_FILA','RECUPERADO_REENFILEIRADO')
            AND data_atualizacao < NOW() - INTERVAL '5 minutes')
      )
      RETURNING row_id`,
    [id, permitirInterrompidas],
  );
  if (resultado.rowCount) return 'EXCLUIDA';
  const existente = await getPool().query(`SELECT 1 FROM "importacoes" WHERE row_id=$1`, [id]);
  return existente.rowCount ? 'STATUS_BLOQUEADO' : 'NAO_ENCONTRADA';
}

export async function criarImportacao(data: Omit<Importacao, 'id' | 'data_importacao' | 'data_atualizacao'>): Promise<Importacao> {
  const agora = new Date().toISOString();
  const importacao: Importacao = { id: randomUUID(), ...data, data_importacao: agora, data_atualizacao: agora };
  await getPool().query(
    `INSERT INTO "importacoes" (row_id, hash_arquivo, dados, data_criacao, data_atualizacao)
     VALUES ($1, $2, $3::jsonb, NOW(), NOW())`,
    [importacao.id, importacao.hash_arquivo || null, serializarJsonb(importacao)],
  );
  return importacao;
}

export async function buscarImportacaoPorHash(hash: string): Promise<Importacao | undefined> {
  const result = await getPool().query<LinhaImportacao>(
    `SELECT dados FROM "importacoes" WHERE hash_arquivo = $1
      AND COALESCE(dados->>'status_importacao','') NOT IN ('ERRO','ARQUIVO_DUPLICADO','LAYOUT_DESCONHECIDO','EXTENSAO_BLOQUEADA')
      ORDER BY data_criacao DESC LIMIT 1`,
    [hash],
  );
  return result.rows[0]?.dados;
}

export async function buscarImportacaoPendentePorHash(hash: string): Promise<Importacao | undefined> {
  const result = await getPool().query<LinhaImportacao>(
    `SELECT dados FROM "importacoes"
     WHERE hash_arquivo = $1 AND COALESCE(dados->>'status_importacao','') = ANY($2::text[])
     ORDER BY data_atualizacao DESC LIMIT 1`,
    [hash, statusPendentes],
  );
  return result.rows[0]?.dados;
}

export async function atualizarImportacao(id: string, data: Partial<Importacao>): Promise<Importacao | undefined> {
  const pool = getPool();
  const atual = await pool.query<LinhaImportacao>(`SELECT dados FROM "importacoes" WHERE row_id = $1 LIMIT 1`, [id]);
  if (!atual.rows[0]) return undefined;

  const atualizada = { ...atual.rows[0].dados, ...data, data_atualizacao: new Date().toISOString() };
  await pool.query(
    `UPDATE "importacoes" SET dados = $2::jsonb, hash_linha = $3, hash_arquivo = $4, data_atualizacao = NOW() WHERE row_id = $1`,
    [id, serializarJsonb(atualizada), (atualizada as Importacao & { hash_linha?: string }).hash_linha || null, atualizada.hash_arquivo || null],
  );
  return atualizada;
}

export async function resumoImportacoes() {
  const result = await getPool().query<Record<string, number>>(`SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE dados->>'status_importacao' = 'PROCESSADO')::int AS processados,
    COUNT(*) FILTER (WHERE dados->>'status_importacao' = 'ERRO')::int AS erros,
    COUNT(*) FILTER (WHERE dados->>'status_importacao' = 'LAYOUT_DESCONHECIDO')::int AS desconhecidos,
    COUNT(*) FILTER (WHERE dados->>'status_importacao' = 'CLASSIFICADO')::int AS classificados
    FROM "importacoes"`);
  return result.rows[0] || { total: 0, processados: 0, erros: 0, desconhecidos: 0, classificados: 0 };
}
