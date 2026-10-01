import { ehSipagComplementar, planejarSipagComplementares, sipagChaveComplementar, sipagData } from '../services/sipag-complementacao.js';
import { ehVendaCoopcertoCabal, planejarAtualizacoesCoopcerto } from '../services/coopcerto-upsert.js';
import { chaveVenda, centavosVenda } from '../services/identidade-venda.js';
import { simularCorrecao, aplicarCorrecao, resumoPlano } from '../services/correcao-vendas.js';
import { capturaVoucher, economicaVoucher, selecionarParesVoucher, redeEsperadaVoucher, identificadorVoucher } from '../services/voucher-pares.js';
import {
  importacoesTabela,
  vendasErpTabela,
  vendasInterdataTabela,
  vendasAdquirentesTabela,
  sicoobLayoutPspPixTabela,
  sipagLayout20SPixTabela,
  sipagLayout20SCartoesTabela,
  sipagLayout20PTabela,
  sipagLayout20RTabela,
  sipagFiserv76SPixTabela,
  sipagFiserv76SCartoesTabela,
  sipagFiserv76PTabela,
  cieloLayout1515Cielo03Tabela,
  cieloLayout1515Cielo16Tabela,
  cieloLayout1515Cielo04Tabela,
  sicrediFiserv74SPixTabela,
  sicrediFiserv74SCartoesTabela,
  sicrediFiserv74PTabela,
  sicrediFiserv74RTabela,
  convcard203CvTabela,
  convcard203CpTabela,
  convcard203CcTabela,
  convcard203TbTabela,
  convcard203ControleTabela,
  vrLayout16apTabela,
  pluxeeLayoutTabela,
  aleloLayoutTabela,
  aleloPagamentosTabela,
  ticketCeAdm40VendasTabela,
  ticketCeAdm40PagamentosTabela,
  sipagVendasPixCsvTabela,
  sipagExtratoTransacoesAutorizadasTabela,
  sipagExtratoVendasPixTabela,
  sipagExtratoVendasAReceberTabela,
  sipagExtratoVendasRecebidasTabela,
  coopcertoCabalVendasCsvTabela,
  coopcertoExtratoVendasAReceberTabela,
  coopcertoExtratoVendasRecebidasTabela,
  conciliacoesTabela,
  conversoesTabela,
} from '../database/paths.js';
import { enriquecerEstabelecimentoVenda } from '../services/estabelecimento.service.js';
import { avaliarCandidatoHibrido, type VendaCandidata } from '../services/conciliacao-hibrida.js';
import { getPool } from '../database/pool.js';

// Compatibilidade para consumidores anteriores à modularização da v0.1.159.
// A implementação permanece isolada no repositório de importações.
export {
  atualizarImportacao,
  buscarImportacaoPendentePorHash,
  buscarImportacaoPorHash,
  criarImportacao,
  listarImportacoes,
  resumoImportacoes,
  type Importacao,
} from './importacoes.repository.js';



type DatabaseLike = {
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
  $transaction: <T>(callback: (tx: DatabaseLike) => Promise<T>) => Promise<T>;
};

type PgError = Error & { code?: string };

async function repetirTransacaoConcorrente<T>(operacao: () => Promise<T>, tentativas = 3): Promise<T> {
  let ultimaFalha: unknown;
  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    try {
      return await operacao();
    } catch (error) {
      ultimaFalha = error;
      const code = (error as PgError)?.code;
      if (!['40P01', '40001'].includes(String(code)) || tentativa === tentativas) throw error;
      await new Promise((resolve) => setTimeout(resolve, 75 * tentativa + Math.floor(Math.random() * 50)));
    }
  }
  throw ultimaFalha;
}

let databasePromise: Promise<DatabaseLike> | null = null;

async function getDatabase(): Promise<DatabaseLike> {
  if (!databasePromise) {
    databasePromise = Promise.resolve().then(() => {
      const pool = getPool();

      const adapter: DatabaseLike = {
        $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
          await pool.query(sql, params);
        },
        $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
          const result = await pool.query(sql, params);
          return result.rows;
        },
        $transaction: async <T>(callback: (tx: DatabaseLike) => Promise<T>) => repetirTransacaoConcorrente(async () => {
          const client = await pool.connect();
          const txAdapter: DatabaseLike = {
            $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
              await client.query(sql, params);
            },
            $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
              const result = await client.query(sql, params);
              return result.rows;
            },
            $transaction: async <U>(nestedCallback: (tx: DatabaseLike) => Promise<U>) => nestedCallback(txAdapter),
          };

          try {
            await client.query('BEGIN');
            const resultado = await callback(txAdapter);
            await client.query('COMMIT');
            return resultado;
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          } finally {
            client.release();
          }
        }),
      };

      return adapter;
    });
  }
  return databasePromise;
}

const usarPostgres = () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória na v0.1.106.');
  return true;
};
const nomesTabelasGarantidas = new Set<string>();

function nomeTabelaSeguro(nome: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nome)) {
    throw new Error(`Nome de tabela inválido: ${nome}`);
  }
  return `"${nome}"`;
}

function tabelaPorReferencia(referencia: string) {
  const tabela = tabelasSistema.find((item) => item.arquivo === referencia || item.nome === referencia);
  return tabela?.nome ?? null;
}

function sanitizarParaJsonb(valor: unknown): unknown {
  if (typeof valor === 'string') {
    // PostgreSQL JSONB rejeita \u0000 e caracteres NUL vindos de XLS/HTML antigo.
    // Também removemos substitutos Unicode isolados que podem gerar escapes inválidos.
    return valor
      .replace(/\u0000/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
      .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  }

  if (Array.isArray(valor)) return valor.map((item) => sanitizarParaJsonb(item));

  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
      saida[chave] = sanitizarParaJsonb(item);
    }
    return saida;
  }

  return valor;
}

function stringifyJsonbSeguro(registro: Record<string, unknown>) {
  return JSON.stringify(sanitizarParaJsonb(registro));
}

function rowIdDoRegistro(registro: Record<string, unknown>, fallback?: string) {
  return String(registro.id ?? registro.hash_linha ?? registro.hash_arquivo ?? fallback ?? `${Date.now()}-${Math.random()}`);
}

async function garantirTabelaPostgres(nomeTabela: string) {
  if (nomesTabelasGarantidas.has(nomeTabela)) return;
  const tabela = nomeTabelaSeguro(nomeTabela);
  const prisma = await getDatabase();
  await prisma.$executeRawUnsafe(`
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
  await prisma.$executeRawUnsafe(`ALTER TABLE ${tabela} DROP CONSTRAINT IF EXISTS "${nomeTabela}_hash_arquivo_key"`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_${nomeTabela}_data_criacao ON ${tabela} (data_criacao)`);
  nomesTabelasGarantidas.add(nomeTabela);
}

async function removerTabelaLinhasImportadasLegadaPostgres() {
  const prisma = await getDatabase();
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "linhas_importadas"');
  nomesTabelasGarantidas.delete('linhas_importadas');
}

let inicializacaoDbPostgres: Promise<void> | null = null;

async function garantirDbPostgres() {
  if (!inicializacaoDbPostgres) {
    inicializacaoDbPostgres = (async () => {
      await removerTabelaLinhasImportadasLegadaPostgres();
      for (const tabela of tabelasSistema) {
        await garantirTabelaPostgres(tabela.nome);
      }
      await garantirRelacionamentosConciliacaoPostgres();
    })().catch((error) => {
      inicializacaoDbPostgres = null;
      throw error;
    });
  }
  await inicializacaoDbPostgres;
}

export async function prepararConsultasOtimizadas() {
  await garantirDbPostgres();
}

async function sincronizarVinculosPixSipagSicoobTx(tx: any) {
  // v0.1.241: SIPAG PIX e SICOOB PIX com o mesmo EndToEndId representam a
  // mesma operação financeira. Os dois registros permanecem intactos; somente
  // um fica elegível à conciliação. Se um deles já está conciliado, preserva-se
  // esse vínculo. Sem vínculo prévio, SICOOB é a fonte primária.
  await tx.$executeRawUnsafe(`WITH base AS (
    SELECT row_id, conciliacao_id, dados,
           UPPER(TRIM(COALESCE(dados->>'adquirente',''))) AS adquirente,
           UPPER(TRIM(COALESCE(dados->>'modalidade',''))) AS modalidade,
           TRIM(COALESCE(NULLIF(dados->>'nsu',''), NULLIF(dados->'dados_json'->>'end_to_end_id',''), NULLIF(dados->'dados_json'->>'endToEndId',''))) AS e2e
      FROM vendas_adquirentes
     WHERE UPPER(TRIM(COALESCE(dados->>'modalidade','')))='PIX'
       AND UPPER(TRIM(COALESCE(dados->>'adquirente',''))) IN ('SIPAG','SICOOB')
  ), pares AS (
    SELECT s.row_id AS sipag_id, c.row_id AS sicoob_id, s.e2e,
           s.conciliacao_id AS sipag_conciliacao_id, c.conciliacao_id AS sicoob_conciliacao_id,
           CASE
             WHEN s.conciliacao_id IS NOT NULL AND c.conciliacao_id IS NOT NULL THEN 'CONFLITO'
             WHEN s.conciliacao_id IS NOT NULL THEN 'SIPAG'
             ELSE 'SICOOB'
           END AS primaria
      FROM base s
      JOIN base c ON c.adquirente='SICOOB' AND s.adquirente='SIPAG' AND c.e2e=s.e2e
     WHERE s.e2e<>''
  ), patches AS (
    SELECT sipag_id AS row_id,
           jsonb_build_object(
             'pix_operacao_compartilhada','SIM', 'pix_end_to_end_id',e2e,
             'pix_fonte_par','SICOOB', 'pix_registro_par_id',sicoob_id,
             'pix_vinculo_criterio','END_TO_END_ID_EXATO',
             'pix_fonte_primaria',CASE WHEN primaria='CONFLITO' THEN '' ELSE primaria END,
             'pix_redundante',CASE WHEN primaria='SICOOB' THEN 'SIM' ELSE 'NAO' END,
             'pix_vinculo_conflito',CASE WHEN primaria='CONFLITO' THEN 'AMBOS_CONCILIADOS' ELSE '' END
           ) AS patch
      FROM pares
    UNION ALL
    SELECT sicoob_id AS row_id,
           jsonb_build_object(
             'pix_operacao_compartilhada','SIM', 'pix_end_to_end_id',e2e,
             'pix_fonte_par','SIPAG', 'pix_registro_par_id',sipag_id,
             'pix_vinculo_criterio','END_TO_END_ID_EXATO',
             'pix_fonte_primaria',CASE WHEN primaria='CONFLITO' THEN '' ELSE primaria END,
             'pix_redundante',CASE WHEN primaria='SIPAG' THEN 'SIM' ELSE 'NAO' END,
             'pix_vinculo_conflito',CASE WHEN primaria='CONFLITO' THEN 'AMBOS_CONCILIADOS' ELSE '' END
           ) AS patch
      FROM pares
  )
  UPDATE vendas_adquirentes v
     SET dados=v.dados || patches.patch, data_atualizacao=NOW()
    FROM patches
   WHERE v.row_id=patches.row_id
     AND (v.dados->>'pix_operacao_compartilhada' IS DISTINCT FROM patches.patch->>'pix_operacao_compartilhada'
       OR v.dados->>'pix_registro_par_id' IS DISTINCT FROM patches.patch->>'pix_registro_par_id'
       OR v.dados->>'pix_fonte_primaria' IS DISTINCT FROM patches.patch->>'pix_fonte_primaria'
       OR v.dados->>'pix_redundante' IS DISTINCT FROM patches.patch->>'pix_redundante'
       OR v.dados->>'pix_vinculo_conflito' IS DISTINCT FROM patches.patch->>'pix_vinculo_conflito')`);
}

async function garantirRelacionamentosConciliacaoPostgres() {
  const db = await getDatabase();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE "conciliacoes" ADD COLUMN IF NOT EXISTS venda_adquirente_id TEXT`);
    await tx.$executeRawUnsafe(`ALTER TABLE "conciliacoes" ADD COLUMN IF NOT EXISTS venda_interdata_id TEXT`);
    await tx.$executeRawUnsafe(`ALTER TABLE "conciliacoes" ADD COLUMN IF NOT EXISTS status TEXT`);
    await tx.$executeRawUnsafe(`ALTER TABLE "vendas_adquirentes" ADD COLUMN IF NOT EXISTS conciliacao_id TEXT`);
    await tx.$executeRawUnsafe(`ALTER TABLE "vendas_interdata" ADD COLUMN IF NOT EXISTS conciliacao_id TEXT`);

    // Colunas técnicas derivadas: preservam o JSONB original e permitem que os
    // filtros usem índices, sem recalcular regex/CASE para cada linha consultada.
    await tx.$executeRawUnsafe(`ALTER TABLE "vendas_adquirentes"
      ADD COLUMN IF NOT EXISTS data_venda_filtro TEXT GENERATED ALWAYS AS (
        CASE
          WHEN dados->>'data_venda' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(dados->>'data_venda', 10)
          WHEN dados->>'data_venda' ~ '^\\d{8}$' THEN SUBSTRING(dados->>'data_venda', 5, 4) || '-' || SUBSTRING(dados->>'data_venda', 3, 2) || '-' || SUBSTRING(dados->>'data_venda', 1, 2)
          WHEN dados->>'data_venda' ~ '^\\d{2}/\\d{2}/\\d{4}' THEN SUBSTRING(dados->>'data_venda', 7, 4) || '-' || SUBSTRING(dados->>'data_venda', 4, 2) || '-' || SUBSTRING(dados->>'data_venda', 1, 2)
          ELSE ''
        END
      ) STORED,
      ADD COLUMN IF NOT EXISTS estabelecimento_filtro TEXT GENERATED ALWAYS AS (UPPER(TRIM(COALESCE(NULLIF(dados->>'codigo_estabelecimento',''), dados->>'cnpj_estabelecimento', '')))) STORED,
      ADD COLUMN IF NOT EXISTS estabelecimento_chave TEXT GENERATED ALWAYS AS (REGEXP_REPLACE(UPPER(TRIM(COALESCE(NULLIF(dados->>'codigo_estabelecimento',''), dados->>'cnpj_estabelecimento', ''))), '[^A-Z0-9]', '', 'g')) STORED,
      ADD COLUMN IF NOT EXISTS adquirente_filtro TEXT GENERATED ALWAYS AS (UPPER(TRIM(COALESCE(dados->>'adquirente','')))) STORED,
      ADD COLUMN IF NOT EXISTS modalidade_filtro TEXT GENERATED ALWAYS AS (UPPER(TRIM(COALESCE(dados->>'modalidade','')))) STORED,
      ADD COLUMN IF NOT EXISTS bandeira_filtro TEXT GENERATED ALWAYS AS (
        CASE WHEN TRIM(COALESCE(dados->>'bandeira','')) ~ '^[0-9]+$' THEN 'OUTRAS' ELSE UPPER(TRIM(COALESCE(dados->>'bandeira',''))) END
      ) STORED,
      ADD COLUMN IF NOT EXISTS status_filtro TEXT GENERATED ALWAYS AS (UPPER(TRIM(COALESCE(dados->>'status_transacao','')))) STORED,
      ADD COLUMN IF NOT EXISTS registro_nao_aplicavel BOOLEAN GENERATED ALWAYS AS (
        REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(dados->>'codigo_estabelecimento','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'
        OR REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(dados->>'cnpj_estabelecimento','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'
        OR REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(dados->>'pagador_cnpj','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'
        OR REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(dados->>'pagador_documento','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'
      ) STORED`);

    await tx.$executeRawUnsafe(`ALTER TABLE "vendas_interdata"
      ADD COLUMN IF NOT EXISTS data_venda_filtro TEXT GENERATED ALWAYS AS (
        CASE
          WHEN dados->>'data_venda' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(dados->>'data_venda', 10)
          WHEN dados->>'data_venda' ~ '^\\d{8}$' THEN SUBSTRING(dados->>'data_venda', 5, 4) || '-' || SUBSTRING(dados->>'data_venda', 3, 2) || '-' || SUBSTRING(dados->>'data_venda', 1, 2)
          WHEN dados->>'data_venda' ~ '^\\d{2}/\\d{2}/\\d{4}' THEN SUBSTRING(dados->>'data_venda', 7, 4) || '-' || SUBSTRING(dados->>'data_venda', 4, 2) || '-' || SUBSTRING(dados->>'data_venda', 1, 2)
          ELSE ''
        END
      ) STORED,
      ADD COLUMN IF NOT EXISTS estabelecimento_filtro TEXT GENERATED ALWAYS AS (UPPER(TRIM(COALESCE(NULLIF(dados->>'cnpj_estabelecimento',''), dados->>'codigo_estabelecimento', '')))) STORED,
      ADD COLUMN IF NOT EXISTS estabelecimento_chave TEXT GENERATED ALWAYS AS (REGEXP_REPLACE(UPPER(TRIM(COALESCE(NULLIF(dados->>'cnpj_estabelecimento',''), dados->>'codigo_estabelecimento', ''))), '[^A-Z0-9]', '', 'g')) STORED,
      ADD COLUMN IF NOT EXISTS modalidade_filtro TEXT GENERATED ALWAYS AS (UPPER(TRIM(COALESCE(dados->>'tipo_produto', dados->>'forma_pagamento', '')))) STORED,
      ADD COLUMN IF NOT EXISTS bandeira_filtro TEXT GENERATED ALWAYS AS (
        CASE WHEN TRIM(COALESCE(dados->>'bandeira','')) ~ '^[0-9]+$' THEN 'OUTRAS' ELSE UPPER(TRIM(COALESCE(dados->>'bandeira',''))) END
      ) STORED,
      ADD COLUMN IF NOT EXISTS status_filtro TEXT GENERATED ALWAYS AS (UPPER(TRIM(COALESCE(dados->>'status_venda','')))) STORED,
      ADD COLUMN IF NOT EXISTS registro_nao_aplicavel BOOLEAN GENERATED ALWAYS AS (
        REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(dados->>'codigo_estabelecimento','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'
        OR REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(dados->>'cnpj_estabelecimento','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'
        OR REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(dados->>'pagador_cnpj','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'
        OR REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(dados->>'pagador_documento','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'
      ) STORED`);

    // Migra vínculos já existentes no JSONB sem alterar a identidade dos registros.
    await tx.$executeRawUnsafe(`UPDATE "conciliacoes" SET venda_adquirente_id = NULLIF(dados->>'venda_adquirente_id', ''), venda_interdata_id = NULLIF(dados->>'venda_interdata_id', ''), status = COALESCE(NULLIF(dados->>'status', ''), 'SUGERIDO') WHERE venda_adquirente_id IS NULL OR venda_interdata_id IS NULL OR status IS NULL`);
    // O JSON pode conservar IDs de conciliações ambíguas, desfeitas ou antigas.
    // Só restaura uma relação confirmada, apontando de volta para esta venda,
    // quando nenhuma outra linha reivindica o mesmo ID no JSON nem na coluna.
    // Assim o bootstrap não recria vínculos duplicados após uma importação.
    await tx.$executeRawUnsafe(`WITH candidatos AS (
      SELECT v.row_id, NULLIF(v.dados->>'conciliacao_id','') AS id,
             COUNT(*) OVER (PARTITION BY NULLIF(v.dados->>'conciliacao_id','')) AS reivindicacoes
        FROM "vendas_adquirentes" v
       WHERE v.conciliacao_id IS NULL AND NULLIF(v.dados->>'conciliacao_id','') IS NOT NULL
    )
    UPDATE "vendas_adquirentes" v SET conciliacao_id=candidatos.id
      FROM candidatos JOIN "conciliacoes" c ON c.row_id=candidatos.id
     WHERE v.row_id=candidatos.row_id AND candidatos.reivindicacoes=1
       AND c.venda_adquirente_id=v.row_id
       AND COALESCE(NULLIF(c.status,''),c.dados->>'status')='CONCILIADO'
       AND NOT EXISTS (SELECT 1 FROM "vendas_adquirentes" outra WHERE outra.conciliacao_id=candidatos.id)`);
    await tx.$executeRawUnsafe(`WITH candidatos AS (
      SELECT v.row_id, NULLIF(v.dados->>'conciliacao_id','') AS id,
             COUNT(*) OVER (PARTITION BY NULLIF(v.dados->>'conciliacao_id','')) AS reivindicacoes
        FROM "vendas_interdata" v
       WHERE v.conciliacao_id IS NULL AND NULLIF(v.dados->>'conciliacao_id','') IS NOT NULL
    )
    UPDATE "vendas_interdata" v SET conciliacao_id=candidatos.id
      FROM candidatos JOIN "conciliacoes" c ON c.row_id=candidatos.id
     WHERE v.row_id=candidatos.row_id AND candidatos.reivindicacoes=1
       AND c.venda_interdata_id=v.row_id
       AND COALESCE(NULLIF(c.status,''),c.dados->>'status')='CONCILIADO'
       AND NOT EXISTS (SELECT 1 FROM "vendas_interdata" outra WHERE outra.conciliacao_id=candidatos.id)`);

    // Só depois de restaurar vínculos históricos decide qual fonte PIX é primária.
    await sincronizarVinculosPixSipagSicoobTx(tx);

    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_conciliacoes_venda_adquirente ON "conciliacoes" (venda_adquirente_id)`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_conciliacoes_venda_interdata ON "conciliacoes" (venda_interdata_id)`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_conciliacoes_status ON "conciliacoes" (status)`);
    await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_vendas_adquirentes_conciliacao_id ON "vendas_adquirentes" (conciliacao_id) WHERE conciliacao_id IS NOT NULL`);
    await tx.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_vendas_interdata_conciliacao_id ON "vendas_interdata" (conciliacao_id) WHERE conciliacao_id IS NOT NULL`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_data_filtro ON "vendas_adquirentes" (data_venda_filtro DESC) WHERE data_venda_filtro <> '' AND registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_data_estabelecimento ON "vendas_adquirentes" (data_venda_filtro, estabelecimento_filtro) WHERE registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_data_adquirente ON "vendas_adquirentes" (data_venda_filtro, adquirente_filtro) WHERE registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_estabelecimento_chave ON "vendas_adquirentes" (estabelecimento_chave, data_venda_filtro) WHERE registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_modalidade_filtro ON "vendas_adquirentes" (modalidade_filtro) WHERE registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_bandeira_filtro ON "vendas_adquirentes" (bandeira_filtro) WHERE registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_status_filtro ON "vendas_adquirentes" (status_filtro) WHERE registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_interdata_data_filtro ON "vendas_interdata" (data_venda_filtro DESC) WHERE data_venda_filtro <> '' AND registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_interdata_data_estabelecimento ON "vendas_interdata" (data_venda_filtro, estabelecimento_filtro) WHERE registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_interdata_estabelecimento_chave ON "vendas_interdata" (estabelecimento_chave, data_venda_filtro) WHERE registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_interdata_modalidade_filtro ON "vendas_interdata" (modalidade_filtro) WHERE registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_interdata_bandeira_filtro ON "vendas_interdata" (bandeira_filtro) WHERE registro_nao_aplicavel = FALSE`);
    // v0.1.229: índices específicos da Central de Conciliações. A tabela usada
    // pela Central para o ERP é vendas_interdata (não vendas_erp). Estes índices
    // cobrem período + pendência sem alterar os dados originais em JSONB.
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_interdata_pendente_data ON "vendas_interdata" (data_venda_filtro DESC, pk DESC) WHERE conciliacao_id IS NULL AND registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_interdata_pendente_estabelecimento_data ON "vendas_interdata" (estabelecimento_filtro, data_venda_filtro DESC) WHERE conciliacao_id IS NULL AND registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_pendente_status_data ON "vendas_adquirentes" (status_filtro, data_venda_filtro DESC, pk DESC) WHERE conciliacao_id IS NULL AND registro_nao_aplicavel = FALSE`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_vendas_adquirentes_pendente_estabelecimento_status_data ON "vendas_adquirentes" (estabelecimento_filtro, status_filtro, data_venda_filtro DESC) WHERE conciliacao_id IS NULL AND registro_nao_aplicavel = FALSE`);

    // As FKs são adicionadas depois da migração dos dados, para instalações antigas continuarem válidas.
    await tx.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendas_adquirentes_conciliacao') THEN ALTER TABLE "vendas_adquirentes" ADD CONSTRAINT fk_vendas_adquirentes_conciliacao FOREIGN KEY (conciliacao_id) REFERENCES "conciliacoes"(row_id) DEFERRABLE INITIALLY DEFERRED; END IF; END $$`);
    await tx.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vendas_interdata_conciliacao') THEN ALTER TABLE "vendas_interdata" ADD CONSTRAINT fk_vendas_interdata_conciliacao FOREIGN KEY (conciliacao_id) REFERENCES "conciliacoes"(row_id) DEFERRABLE INITIALLY DEFERRED; END IF; END $$`);
  });
}

async function lerTabelaPostgres<T>(arquivo: string, fallback: T): Promise<T> {
  const nomeTabela = tabelaPorReferencia(arquivo);
  if (!nomeTabela) return fallback;
  await garantirTabelaPostgres(nomeTabela);
  const tabela = nomeTabelaSeguro(nomeTabela);
  const prisma = await getDatabase();
  const rows = await (prisma.$queryRawUnsafe(`SELECT dados FROM ${tabela} ORDER BY pk ASC`) as Promise<Array<{ dados: unknown }>>);
  return rows.map((row: { dados: unknown }) => row.dados) as T;
}

async function gravarTabelaPostgres<T>(arquivo: string, data: T): Promise<void> {
  const nomeTabela = tabelaPorReferencia(arquivo);
  if (!nomeTabela) return;
  await garantirTabelaPostgres(nomeTabela);
  const tabela = nomeTabelaSeguro(nomeTabela);
  const registros = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const prisma = await getDatabase();
  await prisma.$transaction(async (tx: any) => {
    const rowIds: string[] = [];
    for (let inicio = 0; inicio < registros.length; inicio += 250) {
      const lote = registros.slice(inicio, inicio + 250);
      const valores: unknown[] = [];
      const placeholders = lote.map((registro, indice) => {
        const rowId = rowIdDoRegistro(registro, String(inicio + indice + 1));
        rowIds.push(rowId);
        valores.push(rowId, registro.hash_linha ? String(registro.hash_linha) : null, registro.hash_arquivo ? String(registro.hash_arquivo) : null, stringifyJsonbSeguro(registro));
        const base = indice * 4;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, NOW(), NOW())`;
      });
      await tx.$executeRawUnsafe(
        `INSERT INTO ${tabela} (row_id, hash_linha, hash_arquivo, dados, data_criacao, data_atualizacao)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (row_id) DO UPDATE SET
           hash_linha = EXCLUDED.hash_linha,
           hash_arquivo = EXCLUDED.hash_arquivo,
           dados = EXCLUDED.dados,
           data_atualizacao = NOW()`,
        ...valores,
      );
    }
    if (rowIds.length === 0) await tx.$executeRawUnsafe(`DELETE FROM ${tabela}`);
    else await tx.$executeRawUnsafe(`DELETE FROM ${tabela} WHERE NOT (row_id = ANY($1::text[]))`, rowIds);
  });
}

async function appendTabelaPostgres<T extends Record<string, unknown>>(arquivo: string, registrosNovos: T[], _chaveUnica: 'hash_linha' | 'hash_arquivo' | 'row_id' = 'hash_linha') {
  const nomeTabela = tabelaPorReferencia(arquivo);
  if (!nomeTabela) return { inseridos: 0, duplicados: 0 };
  if (registrosNovos.length === 0) return { inseridos: 0, duplicados: 0 };
  await garantirTabelaPostgres(nomeTabela);
  const tabela = nomeTabelaSeguro(nomeTabela);
  let inseridos = 0;
  let duplicados = 0;
  const prisma = await getDatabase();
  await prisma.$transaction(async (tx: any) => {
    for (let inicio = 0; inicio < registrosNovos.length; inicio += 250) {
      const lote = registrosNovos.slice(inicio, inicio + 250);
      const valores: unknown[] = [];
      const placeholders = lote.map((registro, indice) => {
        valores.push(rowIdDoRegistro(registro), registro.hash_linha ? String(registro.hash_linha) : null, registro.hash_arquivo ? String(registro.hash_arquivo) : null, stringifyJsonbSeguro(registro));
        const base = indice * 4;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, NOW(), NOW())`;
      });
      const inseridosLote = await (tx.$queryRawUnsafe(
        `INSERT INTO ${tabela} (row_id, hash_linha, hash_arquivo, dados, data_criacao, data_atualizacao)
         VALUES ${placeholders.join(',')} ON CONFLICT DO NOTHING RETURNING pk`, ...valores,
      ) as Promise<Array<{ pk: string }>>);
      inseridos += inseridosLote.length;
      duplicados += lote.length - inseridosLote.length;
    }
  });
  return { inseridos, duplicados };
}

export type VendaErp = {
  id: string;
  importacao_id: string;
  numero_linha: number;
  data_venda?: string;
  hora_venda?: string;
  terminal?: string;
  nsu?: string;
  valor_bruto?: string;
  forma_pagamento?: string;
  bandeira?: string;
  tipo_produto?: string;
  parcelas?: string;
  cnpj_estabelecimento?: string;
  id_venda_erp?: string;
  status_venda?: string;
  hash_linha: string;
  dados_originais: Record<string, string>;
  data_criacao: string;
};


export type VendaInterdata = {
  id: string;
  importacao_id: string;
  venda_erp_id: string;
  numero_linha: number;
  data_venda?: string;
  hora_venda?: string;
  terminal?: string;
  nsu?: string;
  codigo_autorizacao?: string;
  valor_bruto?: string;
  forma_pagamento?: string;
  forma_pagamento_original?: string;
  bandeira?: string;
  bandeira_original?: string;
  tipo_produto?: string;
  tipo_produto_original?: string;
  parcelas?: string;
  cnpj_estabelecimento?: string;
  id_venda_erp?: string;
  status_venda?: string;
  status_venda_original?: string;
  hash_linha: string;
  dados_originais: Record<string, string>;
  data_criacao: string;
  duplicidade_status?: string;
  duplicidade_grupo?: string;
  conciliacao_id?: string;
  status_conciliacao?: string;
  score_conciliacao?: number;
  tipo_match?: string;
};

export type VendaAdquirente = {
  id: string;
  importacao_id: string;
  ultima_importacao_id?: string;
  chave_semantica_coopcerto?: string;
  adquirente: string;
  adquirente_original?: string;
  layout_origem: string;
  tipo_arquivo: string;
  codigo_registro: string;
  numero_linha: number;
  data_venda?: string;
  hora_venda?: string;
  data_pagamento?: string;
  valor_bruto?: string;
  valor_liquido?: string;
  valor_taxa?: string;
  percentual_taxa?: string;
  nsu?: string;
  codigo_autorizacao?: string;
  terminal?: string;
  cnpj_estabelecimento?: string;
  codigo_estabelecimento?: string;
  bandeira?: string;
  bandeira_original?: string;
  modalidade?: string;
  modalidade_original?: string;
  parcelas?: string;
  status_transacao?: string;
  status_transacao_original?: string;
  codigo_produto?: string;
  hash_linha: string;
  linha_original: string;
  dados_json: Record<string, any>;
  data_criacao: string;
  duplicidade_status?: string;
  duplicidade_grupo?: string;
  conciliacao_id?: string;
  status_conciliacao?: string;
  score_conciliacao?: number;
  tipo_match?: string;
  pagador_documento?: string;
  utilidade_status?: 'UTIL' | 'NAO_UTIL';
  utilidade_motivo?: string;
  adquirente_captura?: string;
  vinculo_voucher_id?: string;
  status_vinculo_voucher?: 'SEM_VINCULO' | 'VINCULADO' | 'AMBIGUO';
  registro_canonico?: boolean;
  suprimido_por_vinculo_voucher?: boolean;
};


export type SicoobLayoutPspPix = {
  [campo: string]: unknown;
  id: string;
  origem: 'SICOOB';
  layout_origem: 'SICOOB_PSP_PIX_SFTP';
  end_to_end_id: string;
  txid?: string | null;
  valor?: string | null;
  valor_original?: string | null;
  horario?: string | null;
  data_venda?: string | null;
  hora_venda?: string | null;
  chave?: string | null;
  info_pagador?: string | null;
  nome_pagador?: string | null;
  pagador_nome?: string | null;
  pagador_cpf?: string | null;
  pagador_cnpj?: string | null;
  tem_devolucao: boolean;
  quantidade_devolucoes: number;
  devolucoes: unknown[];
  hash_linha: string;
  dados_json: Record<string, any>;
  data_criacao: string;
};

export type RegistroSipagLayout20 = {
  [campo: string]: unknown;
  id: string;
  importacao_id: string;
  tipo_arquivo: 'S' | 'P' | 'R';
  codigo_registro: string;
  numero_linha: number;
  linha_original: string;
  hash_linha: string;
  dados_json: Record<string, any>;
  data_criacao: string;
};


export type RegistroSipagFiserv76 = {
  [campo: string]: unknown;
  id: string;
  importacao_id: string;
  tipo_arquivo: 'S' | 'P';
  codigo_registro: string;
  numero_linha: number;
  linha_original: string;
  hash_linha: string;
  dados_json?: Record<string, string>;
  data_criacao: string;
};



export type RegistroSicrediFiserv74 = {
  [campo: string]: unknown;
  id: string;
  importacao_id: string;
  tipo_arquivo: 'S' | 'P' | 'R';
  codigo_registro: string;
  numero_linha: number;
  linha_original: string;
  hash_linha: string;
  dados_json?: Record<string, unknown>;
  data_criacao: string;
};

export type RegistroConvcard203 = {
  [campo: string]: unknown;
  id: string;
  importacao_id: string;
  tipo_arquivo: 'CONVCARD_2_0_3';
  codigo_registro: string;
  grupo_registro: 'CV' | 'CP' | 'CC' | 'TB' | 'CONTROLE';
  numero_linha: number;
  linha_original: string;
  hash_linha: string;
  dados_json: Record<string, any>;
  data_criacao: string;
};

export type RegistroVr16ap = {
  [campo: string]: unknown;
  id: string; importacao_id: string; tipo_arquivo: 'VR_16AP'; codigo_registro: string;
  numero_linha: number; linha_original: string; hash_linha: string;
  dados_json: Record<string, any>; data_criacao: string;
};

export type RegistroAlelo = {
  [campo: string]: unknown;
  id: string; importacao_id: string; tipo_arquivo: string; codigo_registro: string;
  numero_linha: number; linha_original: string; hash_linha: string;
  dados_json: Record<string, any>; data_criacao: string;
};

export type RegistroAleloPagamento = {
  [campo: string]: unknown;
  id: string; importacao_id: string; tipo_arquivo: string; codigo_registro: string; numero_linha: number;
  empresa_adquirente: string; ec_pagamento: string; chave_exclusiva_pagamento: string;
  identificador_pagamento_unificado: string; tipo_pagamento: string; status_pagamento: string;
  reenvio_pagamento: string; data_pagamento_original: string; data_pagamento: string;
  data_atualizacao_status_pagamento: string; valor_pagamento: string; chave_semantica: string;
  hash_linha: string; linha_original: string; dados_json: Record<string, string>; data_criacao: string;
};

export type RegistroTicketCeAdm40 = {
  [campo: string]: unknown;
  id: string; importacao_id: string; tipo_arquivo: 'TICKET_CEADM40'; codigo_registro: string;
  grupo_registro: 'VENDA' | 'PAGAMENTO'; numero_linha: number; linha_original: string; hash_linha: string;
  dados_json: Record<string, any>; data_criacao: string;
};

export type RegistroSipagVendasPixCsv = {
  [campo: string]: unknown;
  id: string; importacao_id: string; tipo_arquivo: 'SIPAG_VENDAS_PIX_CSV'; codigo_registro: 'VENDA_PIX';
  numero_linha: number; estabelecimento: string; data_venda: string; status: string; codigo_transacao: string;
  numero_terminal: string; nome_pagador: string; valor_reembolsado: string; valor_venda: string;
  linha_original: string; hash_linha: string; dados_json: Record<string, string>; data_criacao: string;
};

export type RegistroCoopcertoCabalVendasCsv = {
  [campo: string]: unknown;
  id: string; importacao_id: string; tipo_arquivo: 'COOPCERTO_CABAL_VENDAS_CSV'; codigo_registro: 'VENDA';
  numero_linha: number; numero_estabelecimento: string; data_transacao: string; numero_transacao: string; id_venda: string;
  bandeira: string; forma_pagamento: string; plano_venda: string; parcela: string; total_parcela: string; numero_autorizacao: string;
  tipo_cartao: string; numero_cartao: string; numero_terminal: string; tipo_captura: string; indicador_credito_debito: string;
  indicador_cancelamento: string; numero_resumo_venda: string; data_prevista_liquidacao: string; seu_numero: string; numero_ordem_pagamento: string;
  status: string; valor_parcela_bruto: string; desconto_parcela: string; valor_parcela_liquido: string; total_plano_venda: string;
  linha_original: string; hash_linha: string; dados_json: Record<string, string>; data_criacao: string;
};

export type RegistroPluxee = {
  [campo: string]: unknown;
  id: string; importacao_id: string; tipo_arquivo: 'CEADM10' | 'CONPGT01'; codigo_registro: string;
  numero_linha: number; linha_original: string; hash_linha: string;
  dados_json: Record<string, any>; data_criacao: string;
};

export type RegistroCieloLayout1515Cielo03 = {
  [campo: string]: unknown;
  id: string;
  importacao_id: string;
  tipo_arquivo: '03';
  codigo_registro: string;
  numero_linha: number;
  linha_original: string;
  hash_linha: string;
  data_criacao: string;
};

export type RegistroCieloLayout1515Cielo16 = {
  [campo: string]: unknown;
  id: string;
  importacao_id: string;
  tipo_arquivo: '16';
  codigo_registro: string;
  numero_linha: number;
  linha_original: string;
  hash_linha: string;
  data_criacao: string;
};

export type RegistroCieloLayout1515Cielo04 = {
  [campo: string]: unknown;
  id: string;
  importacao_id: string;
  tipo_arquivo: '04';
  codigo_registro: string;
  numero_linha: number;
  linha_original: string;
  hash_linha: string;
  data_criacao: string;
};

export type Conversao = {
  id: string;
  tabela_origem: string;
  coluna_origem: string;
  tipo_conversao?: 'VALOR_EXATO' | 'TRANSFORMACAO_DATA';
  formato_origem?: 'DDMMYYYY';
  formato_destino?: 'YYYY-MM-DD';
  valor_original: string;
  valor_exibicao: string;
  adquirente_aplicacao?: string;
  ativo: boolean;
  observacao?: string;
  data_criacao: string;
  data_atualizacao: string;
};

type TabelaSistema = {
  nome: string;
  titulo: string;
  descricao: string;
  arquivo: string;
  colunas: string[];
};

const COLUNAS_IMPORTACAO_BRUTA = ['id', 'importacao_id', 'tipo_arquivo', 'codigo_registro', 'numero_linha', 'linha_original', 'hash_linha'];
const COLUNAS_EDI_POSICOES_60 = Array.from({ length: 60 }, (_, index) => `COLUNA_${String(index + 1).padStart(2, '0')}`);
const COLUNAS_BRUTAS_EDI_60 = [...COLUNAS_IMPORTACAO_BRUTA, ...COLUNAS_EDI_POSICOES_60];

const COLUNAS_CIELO_15_15_E = [
  'id', 'importacao_id', 'tipo_arquivo', 'codigo_registro', 'numero_linha', 'linha_original', 'hash_linha',
  'estabelecimento_submissor', 'bandeira_liquidacao', 'tipo_liquidacao', 'parcela', 'total_parcelas',
  'codigo_autorizacao', 'tipo_lancamento', 'chave_ur', 'codigo_transacao_recebida', 'codigo_ajuste',
  'forma_pagamento', 'indicativo_cielo_promo', 'indicativo_dcc', 'indicativo_comissao_minima',
  'indicativo_ra_tc', 'indicativo_taxa_zero', 'indicativo_transacao_rejeitada', 'indicativo_venda_tardia',
  'bin_cartao', 'final_cartao', 'nsu_doc', 'numero_nota_fiscal', 'tid', 'codigo_pedido_referencia',
  'taxa_mdr', 'taxa_recebimento_automatico', 'taxa_venda', 'sinal_valor_total_venda', 'valor_total_venda',
  'sinal_valor_bruto_venda_parcela', 'valor_bruto_venda_parcela', 'sinal_valor_liquido_venda', 'valor_liquido_venda',
  'sinal_valor_comissao', 'valor_comissao', 'sinal_valor_comissao_minima', 'valor_comissao_minima',
  'sinal_valor_entrada', 'valor_entrada', 'sinal_valor_tarifa_mdr', 'valor_tarifa_mdr',
  'sinal_valor_receba_rapido', 'valor_recebimento_automatico', 'sinal_valor_saque', 'valor_saque',
  'sinal_valor_tarifa_embarque', 'valor_tarifa_embarque', 'sinal_valor_pendente', 'valor_pendente',
  'sinal_valor_total_divida', 'valor_total_divida', 'sinal_valor_cobrado', 'valor_cobrado',
  'sinal_valor_tarifa_administrativa', 'valor_tarifa_administrativa', 'sinal_valor_cielo_promo', 'valor_cielo_promo',
  'sinal_valor_dcc', 'valor_dcc', 'hora_transacao', 'grupo_cartoes', 'cpf_cnpj_recebedor',
  'bandeira_autorizacao', 'codigo_unico_venda', 'codigo_original_venda', 'identificador_efeito_negociacao',
  'canal_venda', 'numero_terminal', 'tipo_lancamento_original', 'tipo_transacao', 'uso_cielo_557_560',
  'codigo_modelo_precificacao_taxa', 'data_autorizacao_venda', 'data_captura', 'data_lancamento',
  'data_original_lancamento', 'numero_lote', 'numero_transacao_processada', 'motivo_rejeicao',
  'data_vencimento_original', 'matriz_pagamento', 'tipo_cartao', 'origem_cartao', 'indicativo_mdr_tipo_cartao',
  'indicativo_parcelado_cliente', 'banco', 'agencia', 'conta', 'digito_conta', 'arn',
  'indicativo_negociacao_recebiveis_cielo', 'tipo_captura', 'cpf_cnpj_negociador', 'uso_cielo',
  'dados_json', 'data_criacao'
];


const COLUNAS_CONVCARD_2_0_3 = [
  'id', 'importacao_id', 'tipo_arquivo', 'codigo_registro', 'grupo_registro', 'numero_linha',
  'linha_original', 'hash_linha', 'dados_json', 'data_criacao'
];

const COLUNAS_CIELO_15_15_PIX = [
  'id', 'importacao_id', 'tipo_arquivo', 'codigo_registro', 'numero_linha', 'linha_original', 'hash_linha',
  'estabelecimento_submissor', 'tipo_lancamento', 'data_venda', 'hora_venda', 'indicador_transacao',
  'codigo_autorizacao', 'data_confirmacao', 'hora_confirmacao', 'identificador_pix', 'nsu', 'data_processamento',
  'sinal_valor_bruto', 'valor_bruto', 'sinal_valor_taxa', 'valor_taxa', 'sinal_valor_liquido', 'valor_liquido',
  'codigo_banco', 'agencia', 'conta', 'data_pagamento', 'codigo_produto', 'terminal', 'data_terminal', 'hora_terminal',
  'status_pix', 'referencia_pix', 'indicativo_rejeicao', 'nome_adquirente', 'data_cielo', 'codigo_unico_pix',
  'end_to_end_id', 'dados_json', 'data_criacao'
];


const COLUNAS_SICOOB_LAYOUT_PSP_PIX = [
  'id', 'origem', 'layout_origem', 'end_to_end_id', 'txid', 'valor', 'valor_original',
  'horario', 'data_venda', 'hora_venda', 'chave', 'info_pagador', 'nome_pagador',
  'pagador_nome', 'pagador_cpf', 'pagador_cnpj', 'tem_devolucao', 'quantidade_devolucoes',
  'devolucoes', 'hash_linha', 'dados_json', 'data_criacao', 'pagador_documento', 'utilidade_status', 'utilidade_motivo'
];


export const tabelasSistema: TabelaSistema[] = [
  {
    nome: 'importacoes',
    titulo: 'Importações',
    descricao: 'Arquivos enviados pelo usuário, com hash, status e layout detectado.',
    arquivo: importacoesTabela,
    colunas: [
      'id', 'nome_arquivo_original', 'nome_arquivo_salvo', 'caminho_arquivo', 'tamanho_bytes', 'tipo_mime',
      'hash_arquivo', 'origem_detectada', 'layout_detectado', 'status_importacao', 'quantidade_registros',
      'quantidade_processados', 'quantidade_erros', 'mensagem_erro', 'data_importacao', 'data_atualizacao',
    ],
  },
  {
    nome: 'vendas_erp',
    titulo: 'Vendas ERP',
    descricao: 'Vendas do ERP INTERDATA preservadas em formato bruto, sem conversão automática de valores.',
    arquivo: vendasErpTabela,
    colunas: [
      'id', 'importacao_id', 'numero_linha', 'data_venda', 'hora_venda', 'terminal', 'nsu', 'valor_bruto',
      'forma_pagamento', 'bandeira', 'tipo_produto', 'parcelas', 'cnpj_estabelecimento', 'id_venda_erp',
      'status_venda', 'hash_linha', 'dados_originais', 'data_criacao', 'duplicidade_status', 'duplicidade_grupo',
    ],
  },
  {
    nome: 'vendas_interdata',
    titulo: 'Vendas INTERDATA',
    descricao: 'Tabela canônica do ERP INTERDATA. Recebe os dados de vendas_erp com regras ativas de conversão aplicadas na gravação, preservando o valor original em colunas *_original.',
    arquivo: vendasInterdataTabela,
    colunas: [
      'id', 'importacao_id', 'venda_erp_id', 'numero_linha', 'data_venda', 'hora_venda', 'terminal', 'nsu', 'valor_bruto',
      'forma_pagamento', 'forma_pagamento_original', 'bandeira', 'bandeira_original', 'tipo_produto', 'tipo_produto_original',
      'parcelas', 'cnpj_estabelecimento', 'id_venda_erp', 'status_venda', 'status_venda_original',
      'hash_linha', 'dados_originais', 'data_criacao', 'duplicidade_status', 'duplicidade_grupo',
    ],
  },
  {
    nome: 'vendas_adquirentes',
    titulo: 'Vendas Adquirentes',
    descricao: 'Tabela canônica das adquirentes. Regras ativas da tabela conversoes são aplicadas no momento da gravação, preservando o valor original em colunas *_original quando houver conversão.',
    arquivo: vendasAdquirentesTabela,
    colunas: [
      'id', 'importacao_id', 'adquirente', 'layout_origem', 'tipo_arquivo', 'codigo_registro', 'numero_linha',
      'ultima_importacao_id',
      'data_venda', 'data_venda_original', 'hora_venda', 'data_pagamento', 'valor_bruto', 'valor_liquido', 'valor_taxa', 'percentual_taxa',
      'nsu', 'codigo_autorizacao', 'terminal', 'codigo_estabelecimento', 'bandeira', 'bandeira_original', 'modalidade', 'modalidade_original',
      'parcelas', 'status_transacao', 'status_transacao_original', 'codigo_produto', 'hash_linha', 'linha_original',
      'dados_json', 'data_criacao', 'duplicidade_status', 'duplicidade_grupo', 'pagador_documento', 'utilidade_status', 'utilidade_motivo',
    ],
  },
  {
    nome: 'sicoob_layout_psp_pix',
    titulo: 'SICOOB Layout PSP PIX',
    descricao: 'Tabela bruta/normalizada dos PIX recebidos via API Sicoob PSP/TEF, usando endToEndId como chave única.',
    arquivo: sicoobLayoutPspPixTabela,
    colunas: COLUNAS_SICOOB_LAYOUT_PSP_PIX,
  },
  {
    nome: 'sipag_layout_2_0_s_pix',
    titulo: 'SIPAG Layout 2.0 - S PIX',
    descricao: 'Tabela bruta do arquivo S da SIPAG 2.0 contendo somente transações PIX (registro 001).',
    arquivo: sipagLayout20SPixTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_layout_2_0_s_cartoes',
    titulo: 'SIPAG Layout 2.0 - S Cartões',
    descricao: 'Tabela bruta do arquivo S da SIPAG 2.0 contendo somente transações de cartão (registros 011, 013, 014, 015, 017 e relacionados).',
    arquivo: sipagLayout20SCartoesTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_layout_2_0_p',
    titulo: 'SIPAG Layout 2.0 - P',
    descricao: 'Tabela bruta do arquivo P da SIPAG 2.0, preservando linha original e JSON por posição de coluna.',
    arquivo: sipagLayout20PTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_layout_2_0_r',
    titulo: 'SIPAG Layout 2.0 - R',
    descricao: 'Tabela bruta do arquivo R da SIPAG 2.0, preservando linha original e JSON por posição de coluna.',
    arquivo: sipagLayout20RTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_fiserv_layout_7_6_s_pix',
    titulo: 'SIPAG Fiserv Layout 7.6 - S PIX',
    descricao: 'Tabela bruta do arquivo S da SIPAG/Fiserv 7.6 contendo somente transações PIX (registro 001).',
    arquivo: sipagFiserv76SPixTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_fiserv_layout_7_6_s_cartoes',
    titulo: 'SIPAG Fiserv Layout 7.6 - S Cartões',
    descricao: 'Tabela bruta do arquivo S da SIPAG/Fiserv 7.6 contendo somente transações de cartão (registros 011, 013, 014, 015, 017 e relacionados).',
    arquivo: sipagFiserv76SCartoesTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_fiserv_layout_7_6_p',
    titulo: 'SIPAG Fiserv Layout 7.6 - P',
    descricao: 'Tabela bruta do arquivo P da SIPAG/Fiserv 7.6. Este layout não possui arquivo R neste fluxo.',
    arquivo: sipagFiserv76PTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },


  {
    nome: 'convcard_layout_2_0_3_cv',
    titulo: 'CONVCARD Layout 2.0.3 - CV Vendas',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo comprovantes de venda autorizada (registro CV).',
    arquivo: convcard203CvTabela,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },
  {
    nome: 'convcard_layout_2_0_3_cp',
    titulo: 'CONVCARD Layout 2.0.3 - CP Pagamentos',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo comprovantes de pagamento (registro CP).',
    arquivo: convcard203CpTabela,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },
  {
    nome: 'convcard_layout_2_0_3_cc',
    titulo: 'CONVCARD Layout 2.0.3 - CC Cancelamentos',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo cancelamentos (registro CC).',
    arquivo: convcard203CcTabela,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },
  {
    nome: 'convcard_layout_2_0_3_tb',
    titulo: 'CONVCARD Layout 2.0.3 - TB Tarifas',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo tarifas bancárias (registro TB).',
    arquivo: convcard203TbTabela,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },
  {
    nome: 'convcard_layout_2_0_3_controle',
    titulo: 'CONVCARD Layout 2.0.3 - Controle',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo headers/trailers A0, L0, L9 e A9.',
    arquivo: convcard203ControleTabela,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },


  {
    nome: 'vr_layout_16ap',
    titulo: 'VR Layout 16AP',
    descricao: 'Registros brutos H, V, E, A e T do arquivo de conciliação financeira VR 16AP.',
    arquivo: vrLayout16apTabela,
    colunas: ['id', 'importacao_id', 'tipo_arquivo', 'codigo_registro', 'numero_linha', 'linha_original', 'hash_linha', 'dados_json', 'data_criacao'],
  },
  {
    nome: 'alelo_layout',
    titulo: 'ALELO EDI 2.1 - 500 posições',
    descricao: 'Registros brutos dos extratos ALELO/NAIP 01, 02, 04, 05 e 06 conforme Manual Técnico EDI 2.1_3.',
    arquivo: aleloLayoutTabela,
    colunas: ['id', 'importacao_id', 'tipo_arquivo', 'codigo_registro', 'numero_linha', 'linha_original', 'hash_linha', 'dados_json', 'data_criacao'],
  },
  {
    nome: 'alelo_pagamentos',
    titulo: 'ALELO EDI 2.1 - Pagamentos',
    descricao: 'Pagamentos dos extratos 02, 05 e 06, separados de vendas_adquirentes e preparados para atualização de status/reenvio e conciliação financeira.',
    arquivo: aleloPagamentosTabela,
    colunas: ['id','importacao_id','tipo_arquivo','codigo_registro','numero_linha','empresa_adquirente','ec_pagamento','chave_exclusiva_pagamento','identificador_pagamento_unificado','tipo_pagamento','status_pagamento','reenvio_pagamento','data_pagamento_original','data_pagamento','data_atualizacao_status_pagamento','valor_pagamento','chave_semantica','hash_linha','linha_original','dados_json','data_criacao'],
  },

  {
    nome: 'ticket_ceadm40_vendas',
    titulo: 'TICKET CEADM40 - Vendas',
    descricao: 'Registros de negócio tipo 2 do EDI TICKET CEADM40, preservados exatamente como recebidos no arquivo.',
    arquivo: ticketCeAdm40VendasTabela,
    colunas: ['id','importacao_id','tipo_arquivo','codigo_registro','grupo_registro','numero_linha','identificacao_estabelecimento','lote','nsu','data_venda','hora_venda','cartao_mascarado','valor_bruto','valor_taxa','parcela_atual','quantidade_parcelas','valor_referencia','data_pagamento','identificador_repetido','canal_captura','codigo_rede_captura','rede_captura','indicador_operacao','linha_original','hash_linha','dados_json','data_criacao'],
  },
  {
    nome: 'ticket_ceadm40_pagamentos',
    titulo: 'TICKET CEADM40 - Pagamentos',
    descricao: 'Registros financeiros tipo 4 do EDI TICKET CEADM40. Headers, agrupamentos/subtotalizadores e trailers não são persistidos.',
    arquivo: ticketCeAdm40PagamentosTabela,
    colunas: ['id','importacao_id','tipo_arquivo','codigo_registro','grupo_registro','numero_linha','lote','data_pagamento','valor_financeiro','valor_financeiro_decimal','natureza','descricao','codigo_lancamento','taxa_percentual','taxa_percentual_decimal','linha_original','hash_linha','dados_json','data_criacao'],
  },

  {
    nome: 'sipag_vendas_pix_csv',
    titulo: 'SIPAG - Extrato legado de Vendas PIX',
    descricao: 'Tabela legada mantida para compatibilidade. Novas importações usam SIPAG - EXTRATO Vendas PIX.',
    arquivo: sipagVendasPixCsvTabela,
    colunas: ['id','importacao_id','tipo_arquivo','codigo_registro','numero_linha','estabelecimento','data_venda','status','codigo_transacao','numero_terminal','nome_pagador','valor_reembolsado','valor_venda','linha_original','hash_linha','dados_json','data_criacao'],
  },

  ...[
    { nome: sipagExtratoTransacoesAutorizadasTabela, titulo: 'SIPAG - EXTRATO Transações autorizadas', descricao: 'Extrato CSV do portal SIPAG com autorizações, recusas e identificação do estabelecimento.' },
    { nome: sipagExtratoVendasPixTabela, titulo: 'SIPAG - EXTRATO Vendas PIX', descricao: 'Extrato CSV do portal SIPAG com vendas PIX e identificação do estabelecimento.' },
    { nome: sipagExtratoVendasAReceberTabela, titulo: 'SIPAG - EXTRATO Vendas a receber', descricao: 'Extrato financeiro CSV do portal SIPAG. Não é arquivo EDI e não duplica vendas normalizadas.' },
    { nome: sipagExtratoVendasRecebidasTabela, titulo: 'SIPAG - EXTRATO Vendas recebidas', descricao: 'Extrato financeiro CSV do portal SIPAG. Não é arquivo EDI e não duplica vendas normalizadas.' },
  ].map((tabela) => ({
    ...tabela,
    arquivo: tabela.nome,
    colunas: ['id','importacao_id','tipo_arquivo','codigo_registro','numero_linha','codigo_estabelecimento','codigo_estabelecimento_original','data_venda','hora_venda','data_pagamento','data_prevista_liquidacao','numero_transacao','id_venda','bandeira','modalidade','terminal','codigo_autorizacao','status','linha_original','hash_linha','dados_json','data_criacao'],
  })),

  {
    nome: 'coopcerto_cabal_vendas_csv',
    titulo: 'COOPCERTO - Vendas realizadas CABAL CSV',
    descricao: 'Tabela bruta do relatório CSV de vendas realizadas COOPCERTO com bandeira CABAL. Preserva exatamente os campos recebidos; título, identificação e linha Total não são persistidos.',
    arquivo: coopcertoCabalVendasCsvTabela,
    colunas: ['id','importacao_id','tipo_arquivo','codigo_registro','numero_linha','numero_estabelecimento','data_transacao','numero_transacao','id_venda','bandeira','forma_pagamento','plano_venda','parcela','total_parcela','numero_autorizacao','tipo_cartao','numero_cartao','numero_terminal','tipo_captura','indicador_credito_debito','indicador_cancelamento','numero_resumo_venda','data_prevista_liquidacao','seu_numero','numero_ordem_pagamento','status','valor_parcela_bruto','desconto_parcela','valor_parcela_liquido','total_plano_venda','linha_original','hash_linha','dados_json','data_criacao'],
  },

  ...[
    { nome: coopcertoExtratoVendasAReceberTabela, titulo: 'COOPCERTO - EXTRATO Vendas a receber', descricao: 'Extrato financeiro CSV de recebíveis futuros COOPCERTO. Não é EDI e não cria novamente vendas_adquirentes.' },
    { nome: coopcertoExtratoVendasRecebidasTabela, titulo: 'COOPCERTO - EXTRATO Vendas recebidas', descricao: 'Extrato financeiro CSV de vendas liquidadas, incluindo pagamento, banco, agência e conta. Não é EDI e não cria novamente vendas_adquirentes.' },
  ].map((tabela) => ({
    ...tabela,
    arquivo: tabela.nome,
    colunas: ['id','importacao_id','tipo_arquivo','codigo_registro','numero_linha','codigo_estabelecimento','codigo_estabelecimento_original','estabelecimento_relatorio','data_venda','hora_venda','numero_transacao','id_venda','bandeira','modalidade','parcela','total_parcela','codigo_autorizacao','numero_cartao','terminal','data_prevista_liquidacao','status','data_pagamento','numero_banco','numero_agencia','numero_conta','valor_parcela_bruto','desconto_parcela','valor_parcela_liquido','total_plano_venda','linha_original','hash_linha','dados_json','data_criacao'],
  })),

  {
    nome: 'pluxee_layout',
    titulo: 'PLUXEE Layout SDX/SDXP',
    descricao: 'Registros brutos posicionais dos arquivos PLUXEE CEADM10 (vendas) e CONPGT01 (pagamentos, encargos, ajustes e liquidações).',
    arquivo: pluxeeLayoutTabela,
    colunas: ['id', 'importacao_id', 'tipo_arquivo', 'codigo_registro', 'numero_linha', 'linha_original', 'hash_linha', 'dados_json', 'data_criacao'],
  },

  {
    nome: 'sicredi_fiserv_layout_7_4_s_pix',
    titulo: 'SICREDI Fiserv Layout 7.4 - S PIX',
    descricao: 'Tabela bruta JSON do arquivo S do SICREDI/Fiserv 7.4 contendo somente transações PIX (registro 001).',
    arquivo: sicrediFiserv74SPixTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sicredi_fiserv_layout_7_4_s_cartoes',
    titulo: 'SICREDI Fiserv Layout 7.4 - S Cartões',
    descricao: 'Tabela bruta JSON do arquivo S do SICREDI/Fiserv 7.4 contendo somente transações de cartão (registros 011, 013, 014 e relacionados).',
    arquivo: sicrediFiserv74SCartoesTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sicredi_fiserv_layout_7_4_p',
    titulo: 'SICREDI Fiserv Layout 7.4 - P',
    descricao: 'Tabela bruta JSON do arquivo P do SICREDI/Fiserv 7.4, preservando movimentos financeiros.',
    arquivo: sicrediFiserv74PTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sicredi_fiserv_layout_7_4_r',
    titulo: 'SICREDI Fiserv Layout 7.4 - R',
    descricao: 'Tabela bruta JSON do arquivo R do SICREDI/Fiserv 7.4, preservando recebíveis/UR.',
    arquivo: sicrediFiserv74RTabela,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },

  {
    nome: 'cielo_layout_15_15_cielo03',
    titulo: 'CIELO Layout 15.15 - CIELO03',
    descricao: 'Tabela bruta dos registros E do arquivo CIELO03 (Captura/Previsão), preservando posições fixas do manual v15.15.',
    arquivo: cieloLayout1515Cielo03Tabela,
    colunas: COLUNAS_CIELO_15_15_E,
  },
  {
    nome: 'cielo_layout_15_15_cielo16',
    titulo: 'CIELO Layout 15.15 - CIELO16 PIX',
    descricao: 'Tabela bruta dos registros 8 do arquivo CIELO16, com transações PIX preservadas por posições fixas.',
    arquivo: cieloLayout1515Cielo16Tabela,
    colunas: COLUNAS_CIELO_15_15_PIX,
  },
  {
    nome: 'cielo_layout_15_15_cielo04',
    titulo: 'CIELO Layout 15.15 - CIELO04',
    descricao: 'Tabela bruta dos registros D e E do arquivo CIELO04 (Liquidação/Pagamento). Não alimenta vendas_adquirentes.',
    arquivo: cieloLayout1515Cielo04Tabela,
    colunas: COLUNAS_CIELO_15_15_E,
  },
  {
    nome: 'conciliacoes',
    titulo: 'Conciliações',
    descricao: 'Tabela preparada para relacionar vendas ERP x vendas das adquirentes.',
    arquivo: conciliacoesTabela,
    colunas: [
      'id', 'venda_interdata_id', 'venda_adquirente_id', 'status', 'tipo_match', 'score',
      'criterios_usados', 'diferenca_valor', 'diferenca_dias', 'automatico', 'data_conciliacao',
    ],
  },
  {
    nome: 'conversoes',
    titulo: 'Conversões',
    descricao: 'Regras de normalização/exibição aplicadas somente pelo job/endpoint pós-importação; os dados recém-importados permanecem com os valores do layout até a execução das conversões.',
    arquivo: conversoesTabela,
    colunas: [
      'id', 'tabela_origem', 'coluna_origem', 'tipo_conversao', 'formato_origem', 'formato_destino', 'valor_original', 'valor_exibicao', 'adquirente_aplicacao', 'ativo',
      'observacao', 'data_criacao', 'data_atualizacao',
    ],
  },
];

async function garantirDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL é obrigatória. A v0.1.152 utiliza exclusivamente PostgreSQL.');
  }
}

async function lerTabela<T>(referencia: string, fallback: T): Promise<T> {
  await garantirDb();
  return lerTabelaPostgres<T>(referencia, fallback);
}

async function gravarTabela<T>(referencia: string, data: T): Promise<void> {
  await garantirDb();
  return gravarTabelaPostgres<T>(referencia, data);
}

export async function removerLinhasImportadasLegadas(): Promise<void> {
  await removerTabelaLinhasImportadasLegadaPostgres();
}

function aplicarConversoesParaGravacaoVendaInterdata(venda: VendaErp, conversoes: Conversao[]): VendaInterdata {
  const normalizada: Record<string, unknown> = {
    ...venda,
    id: venda.id.replace('-erp-', '-interdata-'),
    venda_erp_id: venda.id,
  };

  const colunasConvertiveis = ['forma_pagamento', 'bandeira', 'tipo_produto', 'status_venda'];
  for (const coluna of colunasConvertiveis) {
    const valor = normalizada[coluna];
    const regra =
      encontrarConversaoAtiva(conversoes, 'vendas_interdata', coluna, valor);
    if (!regra) continue;
    const valorOriginal = valor === null || valor === undefined ? '' : String(valor);
    const valorNovo = valorConvertidoPelaRegra(regra, valorOriginal);
    if (valorNovo === null || valorOriginal === valorNovo) continue;
    normalizada[`${coluna}_original`] = valorOriginal;
    normalizada[coluna] = valorNovo;
  }

  return normalizada as VendaInterdata;
}


function chaveSemanticaVendaErp(venda: VendaErp) {
  const data = chaveDataIsoVenda(venda.data_venda || '');
  const valor = chaveValorMonetario(venda.valor_bruto);
  const nsu = chaveLimpaDuplicidade(venda.nsu);
  const idVenda = chaveLimpaDuplicidade(venda.id_venda_erp);
  const terminal = chaveLimpaDuplicidade(venda.terminal);
  const forma = chaveLimpaDuplicidade(venda.forma_pagamento || venda.tipo_produto);
  const identificador = nsu || idVenda || terminal;
  if (!data || !valor || valor === '0' || !identificador) return '';
  return [data, valor, identificador, terminal, forma].join('|');
}

function ehVendaMovimento30Dias(venda: VendaErp) {
  const originais = (venda.dados_originais || {}) as Record<string, unknown>;
  return String(originais.LAYOUT_ERP || '').trim().toUpperCase() === 'INTERDATA_MOVIMENTO_30D';
}

function assinaturaRetrocompativelMovimento30Dias(venda: VendaErp | VendaInterdata) {
  // Identidade comercial validada contra o histórico real do ERP. forma_pagamento
  // não participa: o layout antigo guardava bandeira/produto nesse campo, enquanto
  // o layout novo guarda a modalidade canônica. CNPJ é tratado separadamente para
  // permitir compatibilidade com históricos antigos sem estabelecimento preenchido.
  const idVenda = chaveLimpaDuplicidade(venda.id_venda_erp || (venda as VendaInterdata).venda_erp_id);
  const data = chaveDataIsoVenda(venda.data_venda || '');
  const hora = chaveLimpaDuplicidade(venda.hora_venda);
  const valor = chaveValorMonetario(venda.valor_bruto);
  const tipo = chaveLimpaDuplicidade(venda.tipo_produto);
  const bandeira = chaveLimpaDuplicidade(venda.bandeira);
  const nsu = chaveLimpaDuplicidade(venda.nsu);
  const parcelas = chaveLimpaDuplicidade(venda.parcelas);
  const terminal = chaveLimpaDuplicidade(venda.terminal);
  if (!idVenda || !data || !valor || valor === '0') return '';
  return [idVenda, data, hora, valor, tipo, bandeira, nsu, parcelas, terminal].join('|');
}

function cnpjRetrocompativelMovimento30Dias(venda: VendaErp | VendaInterdata) {
  return String(venda.cnpj_estabelecimento || '').replace(/\D/g, '');
}

async function filtrarMovimento30DiasJaExistente(vendas: VendaErp[]) {
  const candidatas = vendas.filter(ehVendaMovimento30Dias);
  if (!usarPostgres() || candidatas.length === 0) return { vendas, duplicadosRetrocompativeis: 0 };

  const assinaturasNovas = new Set(candidatas.map(assinaturaRetrocompativelMovimento30Dias).filter(Boolean));
  if (assinaturasNovas.size === 0) return { vendas, duplicadosRetrocompativeis: 0 };

  await garantirDbPostgres();
  const db = await getDatabase();
  const idsVenda = [...new Set(candidatas.map((venda) => chaveLimpaDuplicidade(venda.id_venda_erp)).filter(Boolean))];
  const datas = [...new Set(candidatas.map((venda) => String(venda.data_venda || '').trim()).filter(Boolean))];
  const existentes = await db.$queryRawUnsafe(
    `SELECT dados FROM vendas_erp
      WHERE UPPER(REGEXP_REPLACE(COALESCE(dados->>'id_venda_erp',''), '[^A-Za-z0-9]', '', 'g')) = ANY($1::text[])
        AND COALESCE(dados->>'data_venda','') = ANY($2::text[])`,
    idsVenda,
    datas,
  ) as Array<{ dados: VendaErp }>;

  const existentesPorAssinatura = new Map<string, Set<string>>();
  for (const row of existentes) {
    const assinatura = assinaturaRetrocompativelMovimento30Dias(row.dados);
    if (!assinatura) continue;
    const cnpjs = existentesPorAssinatura.get(assinatura) || new Set<string>();
    cnpjs.add(cnpjRetrocompativelMovimento30Dias(row.dados));
    existentesPorAssinatura.set(assinatura, cnpjs);
  }
  const aceitasNesteLote = new Map<string, Set<string>>();
  let duplicadosRetrocompativeis = 0;

  const compativelComCnpj = (cnpjNovo: string, cnpjs: Set<string> | undefined) => {
    if (!cnpjs) return false;
    // Se um dos lados não possui CNPJ, aceita a identidade comercial forte.
    // Quando ambos possuem CNPJ, exige a mesma loja para não misturar SRG/NBO.
    return [...cnpjs].some((cnpjAntigo) => !cnpjNovo || !cnpjAntigo || cnpjNovo === cnpjAntigo);
  };

  const filtradas = vendas.filter((venda) => {
    if (!ehVendaMovimento30Dias(venda)) return true;
    const assinatura = assinaturaRetrocompativelMovimento30Dias(venda);
    if (!assinatura) return true;
    const cnpj = cnpjRetrocompativelMovimento30Dias(venda);
    if (compativelComCnpj(cnpj, existentesPorAssinatura.get(assinatura)) || compativelComCnpj(cnpj, aceitasNesteLote.get(assinatura))) {
      duplicadosRetrocompativeis += 1;
      return false;
    }
    const cnpjs = aceitasNesteLote.get(assinatura) || new Set<string>();
    cnpjs.add(cnpj);
    aceitasNesteLote.set(assinatura, cnpjs);
    return true;
  });
  return { vendas: filtradas, duplicadosRetrocompativeis };
}

function chaveSemanticaVendaAdquirente(venda: VendaAdquirente) {
  const adquirente = chaveLimpaDuplicidade(venda.adquirente);
  const modalidade = chaveLimpaDuplicidade(venda.modalidade);
  const nsu = chaveLimpaDuplicidade(venda.nsu);
  const autorizacao = chaveLimpaDuplicidade(venda.codigo_autorizacao);
  const txid = chaveLimpaDuplicidade((venda as any).txid || (venda as any).end_to_end_id || (venda.dados_json as any)?.txid || (venda.dados_json as any)?.end_to_end_id || (venda.dados_json as any)?.endToEndId);
  const identificador = txid || nsu || autorizacao;
  const data = chaveDataIsoVenda(venda.data_venda || '');
  const valor = chaveValorMonetario(venda.valor_bruto);
  const terminal = chaveLimpaDuplicidade(venda.terminal);
  if (!adquirente || !data || !valor || valor === '0' || !identificador) return '';
  return [adquirente, data, valor, identificador, terminal, modalidade].join('|');
}

function mergeAtualizacaoPixAdquirente(existente: VendaAdquirente, novo: VendaAdquirente): VendaAdquirente {
  return {
    ...existente,
    status_transacao: novo.status_transacao || existente.status_transacao,
    status_transacao_original: novo.status_transacao_original || existente.status_transacao_original,
    valor_liquido: novo.valor_liquido || existente.valor_liquido,
    valor_taxa: novo.valor_taxa || existente.valor_taxa,
    percentual_taxa: novo.percentual_taxa || existente.percentual_taxa,
    pagador_documento: novo.pagador_documento || existente.pagador_documento,
    utilidade_status: novo.utilidade_status || existente.utilidade_status,
    utilidade_motivo: novo.utilidade_motivo || existente.utilidade_motivo,
    dados_json: { ...(existente.dados_json || {}), ...(novo.dados_json || {}) },
  };
}

async function salvarVendasInterdata(vendasErp: VendaErp[]): Promise<{ inseridos: number; duplicados: number }> {
  if (vendasErp.length === 0) return { inseridos: 0, duplicados: 0 };
  const conversoes = await listarConversoes();
  const vendasInterdata = vendasErp.map((venda) => aplicarConversoesParaGravacaoVendaInterdata(venda, conversoes));
  return appendTabelaPostgres(vendasInterdataTabela, vendasInterdata, 'hash_linha');
  const registros = await lerTabela<VendaInterdata[]>(vendasInterdataTabela, []);
  const hashes = new Set(registros.map((item) => item.hash_linha).filter(Boolean));
  const chaves = new Set(registros.map(chaveDuplicidadeInterdata).filter(Boolean));
  const novos: VendaInterdata[] = [];
  let duplicados = 0;
  for (const venda of vendasInterdata) {
    const chave = chaveDuplicidadeInterdata(venda);
    if (hashes.has(venda.hash_linha) || (chave && chaves.has(chave))) {
      duplicados += 1;
      continue;
    }
    hashes.add(venda.hash_linha);
    if (chave) chaves.add(chave);
    novos.push(venda);
  }
  await gravarTabela(vendasInterdataTabela, registros.concat(novos));
  return { inseridos: novos.length, duplicados };
}

export async function salvarVendasErp(vendas: VendaErp[]): Promise<{ inseridos: number; duplicados: number; interdata_inseridos: number; interdata_duplicados: number }> {
  if (vendas.length === 0) return { inseridos: 0, duplicados: 0, interdata_inseridos: 0, interdata_duplicados: 0 };
  if (usarPostgres()) {
    const retro = await filtrarMovimento30DiasJaExistente(vendas);
    const gravacao = await appendTabelaPostgres(vendasErpTabela, retro.vendas as unknown as Array<VendaErp & Record<string, unknown>>, 'hash_linha');
    const gravacaoInterdata = await salvarVendasInterdata(retro.vendas);
    invalidarCachesOpcoesVendas();
    return { inseridos: gravacao.inseridos, duplicados: gravacao.duplicados + retro.duplicadosRetrocompativeis, interdata_inseridos: gravacaoInterdata.inseridos, interdata_duplicados: gravacaoInterdata.duplicados + retro.duplicadosRetrocompativeis };
  }
  const registros = await lerTabela<VendaErp[]>(vendasErpTabela, []);
  const hashes = new Set(registros.map((item) => item.hash_linha).filter(Boolean));
  const chaves = new Set(registros.map(chaveSemanticaVendaErp).filter(Boolean));
  const novos: VendaErp[] = [];
  let duplicados = 0;
  for (const venda of vendas) {
    const chave = chaveSemanticaVendaErp(venda);
    if (hashes.has(venda.hash_linha) || (chave && chaves.has(chave))) {
      duplicados += 1;
      continue;
    }
    hashes.add(venda.hash_linha);
    if (chave) chaves.add(chave);
    novos.push(venda);
  }
  await gravarTabela(vendasErpTabela, registros.concat(novos));
  const gravacaoInterdata = await salvarVendasInterdata(novos);
  return {
    inseridos: novos.length,
    duplicados,
    interdata_inseridos: gravacaoInterdata.inseridos,
    interdata_duplicados: gravacaoInterdata.duplicados,
  };
}


async function salvarRegistrosGenericoComUpsert<T extends { hash_linha: string }>(
  arquivo: string,
  registrosNovos: T[],
  chaveFn: (registro: T) => string,
): Promise<{ inseridos: number; duplicados: number; atualizados: number }> {
  if (registrosNovos.length === 0) return { inseridos: 0, duplicados: 0, atualizados: 0 };
  const registros = await lerTabela<T[]>(arquivo, []);
  const indicePorChave = new Map<string, number>();
  registros.forEach((registro, index) => {
    const chave = chaveFn(registro) || registro.hash_linha;
    if (chave) indicePorChave.set(chave, index);
  });

  let inseridos = 0;
  let atualizados = 0;
  let duplicados = 0;
  for (const registro of registrosNovos) {
    const chave = chaveFn(registro) || registro.hash_linha;
    const indiceExistente = indicePorChave.get(chave);
    if (indiceExistente === undefined) {
      indicePorChave.set(chave, registros.length);
      registros.push(registro);
      inseridos += 1;
      continue;
    }

    duplicados += 1;
    const existente = registros[indiceExistente] as Record<string, unknown>;
    const novo = registro as Record<string, unknown>;
    const atualizado = {
      ...existente,
      ...novo,
      data_criacao: existente.data_criacao || novo.data_criacao,
    } as unknown as T;

    if (JSON.stringify(existente) !== JSON.stringify(atualizado)) {
      registros[indiceExistente] = atualizado;
      atualizados += 1;
    }
  }

  await gravarTabela(arquivo, registros);
  return { inseridos, duplicados, atualizados };
}

async function salvarRegistrosGenerico<T extends { hash_linha: string }>(arquivo: string, registrosNovos: T[]): Promise<{ inseridos: number; duplicados: number }> {
  if (registrosNovos.length === 0) return { inseridos: 0, duplicados: 0 };
  return appendTabelaPostgres(arquivo, registrosNovos as unknown as Array<T & Record<string, unknown>>, 'hash_linha');
  const registros = await lerTabela<T[]>(arquivo, []);
  const hashes = new Set(registros.map((item) => item.hash_linha));
  const novos: T[] = [];
  let duplicados = 0;
  for (const registro of registrosNovos) {
    if (hashes.has(registro.hash_linha)) {
      duplicados += 1;
      continue;
    }
    hashes.add(registro.hash_linha);
    novos.push(registro);
  }
  await gravarTabela(arquivo, registros.concat(novos));
  return { inseridos: novos.length, duplicados };
}

export async function salvarSipagLayout20(tipo: 'S' | 'P' | 'R', registros: RegistroSipagLayout20[]) {
  if (tipo === 'S') {
    const registrosPix = registros.filter((registro) => String(registro.codigo_registro || '') === '001');
    const registrosCartoes = registros.filter((registro) => String(registro.codigo_registro || '') !== '001');
    const gravacaoPix = await salvarRegistrosGenerico(sipagLayout20SPixTabela, registrosPix);
    const gravacaoCartoes = await salvarRegistrosGenerico(sipagLayout20SCartoesTabela, registrosCartoes);
    return {
      inseridos: gravacaoPix.inseridos + gravacaoCartoes.inseridos,
      duplicados: gravacaoPix.duplicados + gravacaoCartoes.duplicados,
    };
  }

  const arquivo = tipo === 'P' ? sipagLayout20PTabela : sipagLayout20RTabela;
  return salvarRegistrosGenerico(arquivo, registros);
}



export async function salvarSipagFiserv76(tipo: 'S' | 'P', registros: RegistroSipagFiserv76[]) {
  if (tipo === 'S') {
    const registrosPix = registros.filter((registro) => String(registro.codigo_registro || '') === '001');
    const registrosCartoes = registros.filter((registro) => String(registro.codigo_registro || '') !== '001');
    const gravacaoPix = await salvarRegistrosGenerico(sipagFiserv76SPixTabela, registrosPix);
    const gravacaoCartoes = await salvarRegistrosGenerico(sipagFiserv76SCartoesTabela, registrosCartoes);
    return {
      inseridos: gravacaoPix.inseridos + gravacaoCartoes.inseridos,
      duplicados: gravacaoPix.duplicados + gravacaoCartoes.duplicados,
    };
  }

  return salvarRegistrosGenerico(sipagFiserv76PTabela, registros);
}


export async function salvarSicrediFiserv74(tipo: 'S' | 'P' | 'R', registros: RegistroSicrediFiserv74[]) {
  if (tipo === 'S') {
    const registrosPix = registros.filter((registro) => String(registro.codigo_registro || '') === '001');
    const registrosCartoes = registros.filter((registro) => String(registro.codigo_registro || '') !== '001');
    const gravacaoPix = await salvarRegistrosGenerico(sicrediFiserv74SPixTabela, registrosPix);
    const gravacaoCartoes = await salvarRegistrosGenerico(sicrediFiserv74SCartoesTabela, registrosCartoes);
    return {
      inseridos: gravacaoPix.inseridos + gravacaoCartoes.inseridos,
      duplicados: gravacaoPix.duplicados + gravacaoCartoes.duplicados,
    };
  }

  const arquivo = tipo === 'P' ? sicrediFiserv74PTabela : sicrediFiserv74RTabela;
  return salvarRegistrosGenerico(arquivo, registros);
}


export async function salvarConvcard203(registros: RegistroConvcard203[]) {
  const porGrupo = {
    CV: registros.filter((registro) => registro.grupo_registro === 'CV'),
    CP: registros.filter((registro) => registro.grupo_registro === 'CP'),
    CC: registros.filter((registro) => registro.grupo_registro === 'CC'),
    TB: registros.filter((registro) => registro.grupo_registro === 'TB'),
    CONTROLE: registros.filter((registro) => registro.grupo_registro === 'CONTROLE'),
  };
  const resultados = await Promise.all([
    salvarRegistrosGenerico(convcard203CvTabela, porGrupo.CV),
    salvarRegistrosGenerico(convcard203CpTabela, porGrupo.CP),
    salvarRegistrosGenerico(convcard203CcTabela, porGrupo.CC),
    salvarRegistrosGenerico(convcard203TbTabela, porGrupo.TB),
    salvarRegistrosGenerico(convcard203ControleTabela, porGrupo.CONTROLE),
  ]);
  return resultados.reduce((acc, item) => ({ inseridos: acc.inseridos + item.inseridos, duplicados: acc.duplicados + item.duplicados }), { inseridos: 0, duplicados: 0 });
}

export async function salvarVrLayout16ap(registros: RegistroVr16ap[]) {
  return salvarRegistrosGenerico(vrLayout16apTabela, registros);
}

export async function salvarAleloLayout(registros: RegistroAlelo[]) {
  return salvarRegistrosGenerico(aleloLayoutTabela, registros);
}

export async function salvarAleloPagamentos(registros: RegistroAleloPagamento[]) {
  // A chave semântica permanece estável quando a Alelo reenvia o mesmo pagamento
  // apenas para atualizar o status. Assim o registro é atualizado, e não duplicado.
  return salvarRegistrosGenericoComUpsert(aleloPagamentosTabela, registros, (registro) => registro.chave_semantica || registro.hash_linha);
}

export async function salvarTicketCeAdm40(registrosVendas: RegistroTicketCeAdm40[], registrosPagamentos: RegistroTicketCeAdm40[]) {
  const [vendas, pagamentos] = await Promise.all([
    salvarRegistrosGenerico(ticketCeAdm40VendasTabela, registrosVendas),
    salvarRegistrosGenerico(ticketCeAdm40PagamentosTabela, registrosPagamentos),
  ]);
  return {
    inseridos: vendas.inseridos + pagamentos.inseridos,
    duplicados: vendas.duplicados + pagamentos.duplicados,
    vendas_inseridas: vendas.inseridos,
    pagamentos_inseridos: pagamentos.inseridos,
  };
}

export async function salvarSipagVendasPixCsv(registros: RegistroSipagVendasPixCsv[]) {
  return salvarRegistrosGenerico(sipagVendasPixCsvTabela, registros);
}

export async function salvarSipagExtrato(tipo: 'TRANSACOES_AUTORIZADAS' | 'VENDAS_REALIZADAS' | 'VENDAS_PIX' | 'VENDAS_A_RECEBER' | 'VENDAS_RECEBIDAS', registros: Array<Record<string, unknown> & { id: string; hash_linha: string }>) {
  const tabelas = {
    TRANSACOES_AUTORIZADAS: sipagExtratoTransacoesAutorizadasTabela,
    VENDAS_REALIZADAS: sipagExtratoVendasAReceberTabela,
    VENDAS_PIX: sipagExtratoVendasPixTabela,
    VENDAS_A_RECEBER: sipagExtratoVendasAReceberTabela,
    VENDAS_RECEBIDAS: sipagExtratoVendasRecebidasTabela,
  } as const;
  return salvarRegistrosGenerico(tabelas[tipo], registros);
}

export async function salvarCoopcertoCabalVendasCsv(registros: RegistroCoopcertoCabalVendasCsv[]) {
  return salvarRegistrosGenerico(coopcertoCabalVendasCsvTabela, registros);
}

export async function salvarCoopcertoExtrato(tipo: 'VENDAS_A_RECEBER' | 'VENDAS_RECEBIDAS', registros: Array<Record<string, unknown> & { id: string; hash_linha: string }>) {
  const tabelas = {
    VENDAS_A_RECEBER: coopcertoExtratoVendasAReceberTabela,
    VENDAS_RECEBIDAS: coopcertoExtratoVendasRecebidasTabela,
  } as const;
  return salvarRegistrosGenerico(tabelas[tipo], registros);
}

export async function salvarPluxeeLayout(registros: RegistroPluxee[]) {
  return salvarRegistrosGenerico(pluxeeLayoutTabela, registros);
}

export async function salvarCieloLayout1515Cielo03(registros: RegistroCieloLayout1515Cielo03[]) {
  return salvarRegistrosGenerico(cieloLayout1515Cielo03Tabela, registros);
}

export async function salvarCieloLayout1515Cielo16(registros: RegistroCieloLayout1515Cielo16[]) {
  return salvarRegistrosGenerico(cieloLayout1515Cielo16Tabela, registros);
}

export async function salvarCieloLayout1515Cielo04(registros: RegistroCieloLayout1515Cielo04[]) {
  return salvarRegistrosGenerico(cieloLayout1515Cielo04Tabela, registros);
}



function removerAcentos(valor: string) {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function textoCanonico(valor: unknown) {
  return removerAcentos(String(valor ?? '').trim()).toUpperCase();
}

function normalizarDataCanonica(valor: unknown) {
  const texto = String(valor ?? '').trim();
  if (!texto || texto === '-') return '';

  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const br = texto.match(/^(\d{2})[\/.-](\d{2})[\/.-](\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  const compacto = texto.replace(/\D/g, '');
  if (compacto.length === 8) {
    const dd = compacto.slice(0, 2);
    const mm = compacto.slice(2, 4);
    const yyyy = compacto.slice(4, 8);
    if (Number(dd) >= 1 && Number(dd) <= 31 && Number(mm) >= 1 && Number(mm) <= 12) return `${yyyy}-${mm}-${dd}`;

    const yyyyInicio = compacto.slice(0, 4);
    const mmInicio = compacto.slice(4, 6);
    const ddInicio = compacto.slice(6, 8);
    if (Number(yyyyInicio) >= 1900 && Number(mmInicio) >= 1 && Number(mmInicio) <= 12 && Number(ddInicio) >= 1 && Number(ddInicio) <= 31) return `${yyyyInicio}-${mmInicio}-${ddInicio}`;
  }

  if (compacto.length === 6) {
    const yy = Number(compacto.slice(4, 6));
    const yyyy = yy >= 70 ? `19${String(yy).padStart(2, '0')}` : `20${String(yy).padStart(2, '0')}`;
    const dd = compacto.slice(0, 2);
    const mm = compacto.slice(2, 4);
    if (Number(dd) >= 1 && Number(dd) <= 31 && Number(mm) >= 1 && Number(mm) <= 12) return `${yyyy}-${mm}-${dd}`;
  }

  return texto;
}

function normalizarBandeiraCanonica(valor: unknown, modalidade?: unknown) {
  const original = String(valor ?? '').trim();
  const canonico = textoCanonico(original);
  const modalidadeCanonica = textoCanonico(modalidade);
  if (!canonico || canonico === '-') return modalidadeCanonica === 'PIX' ? 'PIX' : '';
  if (canonico.includes('PIX')) return 'PIX';
  if (canonico.includes('VISA') || canonico === '001') return 'VISA';
  if (canonico.includes('MASTER') || canonico === '002' || canonico === 'M') return 'MASTERCARD';
  if (canonico.includes('ELO') || canonico === '005' || canonico === '007') return 'ELO';
  if (canonico.includes('AMEX') || canonico.includes('AMERICAN')) return 'AMEX';
  if (canonico.includes('HIPER')) return 'HIPER';
  if (canonico.includes('CONVCARD')) return 'CONVCARD';

  const parteDescricao = canonico.match(/^\d+\s*-\s*(.+)$/);
  if (parteDescricao?.[1]) return normalizarBandeiraCanonica(parteDescricao[1], modalidade);
  return canonico;
}

function normalizarModalidadeCanonica(valor: unknown, codigoRegistro?: unknown, layoutOrigem?: unknown) {
  const canonico = textoCanonico(valor);
  const codigo = textoCanonico(codigoRegistro);
  const layout = textoCanonico(layoutOrigem);
  if (!canonico || canonico === '-') return '';
  if (canonico.includes('PIX') || codigo === '001' || layout.includes('PIX')) return 'PIX';
  if (canonico.includes('DEBIT') || codigo === '011' || canonico === 'D' || canonico === '01') return 'DEBITO';
  if (canonico.includes('VOUCHER') || codigo === '017' || canonico === '04') return 'VOUCHER';
  if (canonico.includes('CRED') || codigo === '013' || codigo === '014' || codigo === '015' || canonico === 'C' || canonico === '02') return 'CREDITO';
  if (canonico === 'CARTAO' && layout.includes('CARTOES')) return 'CARTAO';
  return canonico;
}

function normalizarStatusCanonico(valor: unknown, codigoRegistro?: unknown, layoutOrigem?: unknown) {
  const canonico = textoCanonico(valor);
  const codigo = textoCanonico(codigoRegistro);
  const layout = textoCanonico(layoutOrigem);
  if (!canonico || canonico === '-') return '';

  // Status explícitos recebidos da adquirente têm precedência sobre qualquer
  // inferência pelo tipo de arquivo/layout. Em especial, registros SICREDI PIX
  // "UNAUTHORIZED - XX" não podem ser promovidos para AUTORIZADO só porque
  // pertencem a um arquivo S/PIX.
  if (canonico.includes('UNAUTHORIZED') || canonico.includes('NAO AUTORIZ') || canonico.includes('NÃO AUTORIZ')) return 'NEGADO';
  if (canonico.includes('NEGAD') || canonico.includes('REJEIT') || canonico.includes('RECUS')) return 'NEGADO';
  if (canonico.includes('DEVOLU') || canonico.includes('RECEBIDO_COM_DEVOLUCAO')) return 'DEVOLVIDO';
  if (canonico.includes('CANCEL') || canonico.includes('DESFEIT') || canonico.includes('UNDONE') || canonico.includes('ESTORN')) return 'ESTORNADO';
  if (canonico === 'S' || canonico === 'N' || canonico === '1' || canonico === 'APPROVED' || canonico.includes('COMPROVANTE') || canonico.includes('DETALHE') || canonico.includes('SUCESSO') || canonico === 'OK' || canonico.includes('PIX_POS')) return 'AUTORIZADO';
  if ((codigo === '011' || codigo === '013' || codigo === '014' || codigo === '017' || codigo === '001') && (layout.includes('_S_') || layout.endsWith('_S_CARTOES') || layout.endsWith('_S_PIX'))) return 'AUTORIZADO';
  return canonico;
}

function guardarOriginalSeAlterou(obj: Record<string, unknown>, coluna: string, valorNovo: unknown) {
  const valorAtual = obj[coluna];
  const atualTexto = String(valorAtual ?? '').trim();
  const novoTexto = String(valorNovo ?? '').trim();
  if (atualTexto === novoTexto) return;
  const colunaOriginal = `${coluna}_original`;
  if (!obj[colunaOriginal] && atualTexto) obj[colunaOriginal] = atualTexto;
  obj[coluna] = valorNovo;
}

function aplicarNormalizacaoCanonicaVendaAdquirente(venda: VendaAdquirente): VendaAdquirente {
  const normalizada: Record<string, unknown> = { ...venda };

  // O layout VR 16AP pertence sempre à adquirente VR. Esta correção também
  // repara registros históricos que foram persistidos como SICREDI.
  if (String(normalizada.layout_origem || '').trim().toLowerCase() === 'vr_layout_16ap') {
    guardarOriginalSeAlterou(normalizada, 'adquirente', 'VR');
  }

  guardarOriginalSeAlterou(normalizada, 'data_venda', normalizarDataCanonica(normalizada.data_venda));
  guardarOriginalSeAlterou(normalizada, 'data_pagamento', normalizarDataCanonica(normalizada.data_pagamento));
  guardarOriginalSeAlterou(normalizada, 'modalidade', normalizarModalidadeCanonica(normalizada.modalidade, normalizada.codigo_registro, normalizada.layout_origem));
  guardarOriginalSeAlterou(normalizada, 'bandeira', normalizarBandeiraCanonica(normalizada.bandeira, normalizada.modalidade));
  // Se já existe um status original explícito, ele é a fonte mais confiável
  // para reavaliar classificações históricas feitas por inferência do layout.
  // Isso permite reparar, por exemplo, AUTORIZADO + original UNAUTHORIZED - ZU.
  const statusOriginal = String(normalizada.status_transacao_original ?? '').trim();
  const statusFonte = /UNAUTHORIZED|N[ÃA]O\s+AUTORIZ|NEGAD|REJEIT|RECUS|UNDONE|ESTORN|CANCEL|DEVOLU/i.test(statusOriginal)
    ? statusOriginal
    : normalizada.status_transacao;
  guardarOriginalSeAlterou(normalizada, 'status_transacao', normalizarStatusCanonico(statusFonte, normalizada.codigo_registro, normalizada.layout_origem));

  return normalizada as VendaAdquirente;
}

function normalizarValorTaxaPositivo(valor: unknown) {
  if (valor === null || valor === undefined || valor === '') return valor;
  const texto = String(valor).trim();
  const numero = Number(texto.replace(',', '.'));
  if (Number.isNaN(numero)) return valor;
  return Math.abs(numero).toFixed(2);
}

function moedaParaNumeroCanonico(valor: unknown) {
  if (valor === null || valor === undefined || valor === '') return 0;
  let texto = String(valor).trim();
  if (!texto || texto === '-') return 0;
  const negativo = /^-/.test(texto) || /-$/.test(texto);
  texto = texto.replace(/[^\d,.-]/g, '');
  if (!texto || texto === '-' || texto === ',' || texto === '.') return 0;
  if (texto.includes(',') && texto.includes('.')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (texto.includes(',')) texto = texto.replace(',', '.');
  else if ((texto.match(/\./g) || []).length > 1) texto = texto.replace(/\./g, '');
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return 0;
  return negativo ? -Math.abs(numero) : numero;
}

function calcularPercentualTaxa(valorBruto: unknown, valorTaxa: unknown) {
  const bruto = Math.abs(moedaParaNumeroCanonico(valorBruto));
  const taxa = Math.abs(moedaParaNumeroCanonico(normalizarValorTaxaPositivo(valorTaxa)));
  if (!bruto || !Number.isFinite(bruto)) return '0.0000';
  return ((taxa / bruto) * 100).toFixed(4);
}

function escopoAdquirenteConversao(valor: unknown) {
  const texto = textoFiltro(valor);
  if (texto.includes('ALELO') || texto.includes('NAIP')) return 'ALELO';
  if (texto.includes('TICKET')) return 'TICKET';
  return texto;
}

function tipoConversao(regra: Conversao) {
  return regra.tipo_conversao === 'TRANSFORMACAO_DATA' ? 'TRANSFORMACAO_DATA' : 'VALOR_EXATO';
}

export function transformarDataPorFormato(valor: unknown, formatoOrigem?: string, formatoDestino?: string): string | null {
  const texto = String(valor ?? '').trim();
  if (formatoOrigem !== 'DDMMYYYY' || formatoDestino !== 'YYYY-MM-DD') return null;
  const match = /^(\d{2})(\d{2})(\d{4})$/.exec(texto);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const dia = Number(dd);
  const mes = Number(mm);
  const ano = Number(yyyy);
  if (ano < 1900 || ano > 2999 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) return null;
  return `${yyyy}-${mm}-${dd}`;
}

function valorConvertidoPelaRegra(regra: Conversao, valor: unknown): string | null {
  if (tipoConversao(regra) === 'TRANSFORMACAO_DATA') {
    return transformarDataPorFormato(valor, regra.formato_origem, regra.formato_destino);
  }
  return textoFiltro(regra.valor_original) === textoFiltro(valor) ? regra.valor_exibicao : null;
}

function encontrarConversaoAtiva(
  conversoes: Conversao[],
  tabela: string,
  coluna: string,
  valor: unknown,
  adquirente?: string,
) {
  const adquirenteLinha = escopoAdquirenteConversao(adquirente);
  const candidatas = conversoes.filter((item) => {
    if (!item.ativo || item.tabela_origem !== tabela || item.coluna_origem !== coluna) return false;
    const adquirenteRegra = escopoAdquirenteConversao(item.adquirente_aplicacao);
    if (tabela === 'vendas_adquirentes' && adquirenteRegra && adquirenteRegra !== 'TODAS' && adquirenteRegra !== adquirenteLinha) return false;
    return valorConvertidoPelaRegra(item, valor) !== null;
  });
  // Uma regra exata é sempre mais específica e deve prevalecer sobre transformações genéricas.
  return candidatas.find((item) => tipoConversao(item) === 'VALOR_EXATO') || candidatas[0];
}

export type RelatorioRegraConversao = {
  id: string;
  tabela: string;
  coluna: string;
  adquirente: string;
  tipo_conversao: 'VALOR_EXATO' | 'TRANSFORMACAO_DATA';
  formato_origem?: string;
  formato_destino?: string;
  valor_original: string;
  valor_exibicao: string;
  registros_encontrados: number;
  registros_alterados: number;
  status: 'APLICADA' | 'SEM_CORRESPONDENCIA' | 'ERRO';
  erro?: string;
};

async function aplicarConversoesCadastradasEmTabelasExistentes(conversoes: Conversao[], importacaoIds: string[] = []) {
  const regrasAtivas = conversoes.filter((item) => item.ativo && ['vendas_interdata','vendas_adquirentes'].includes(item.tabela_origem) && !(item.tabela_origem === 'vendas_adquirentes' && item.coluna_origem === 'percentual_taxa'));
  const resultado: Record<string, { antes: number; depois: number; atualizados: number }> = {};
  const relatorioRegras: RelatorioRegraConversao[] = regrasAtivas.map((regra) => ({
    id: regra.id,
    tabela: regra.tabela_origem,
    coluna: regra.coluna_origem,
    adquirente: regra.adquirente_aplicacao || 'TODAS',
    tipo_conversao: tipoConversao(regra),
    formato_origem: regra.formato_origem,
    formato_destino: regra.formato_destino,
    valor_original: regra.valor_original,
    valor_exibicao: regra.valor_exibicao,
    registros_encontrados: 0,
    registros_alterados: 0,
    status: 'SEM_CORRESPONDENCIA',
  }));
  const relatorioPorId = new Map(relatorioRegras.map((item) => [item.id, item]));

  for (const regra of regrasAtivas) {
    if (!tabelasSistema.some((tabela) => tabela.nome === regra.tabela_origem)) {
      const item = relatorioPorId.get(regra.id)!;
      item.status = 'ERRO';
      item.erro = `Tabela ${regra.tabela_origem} não existe no catálogo operacional.`;
    }
  }

  if (usarPostgres()) {
    await garantirAuditoriaOperacionalPostgres();
    const db = await getDatabase();

    for (const tabela of tabelasSistema) {
      const regrasTabela = regrasAtivas.filter((item) => item.tabela_origem === tabela.nome);
      if (regrasTabela.length === 0) continue;

      await garantirTabelaPostgres(tabela.nome);
      const nomeTabela = nomeTabelaSeguro(tabela.nome);
      const totalAntes = await db.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS total FROM ${nomeTabela}
          ${importacaoIds.length ? `WHERE COALESCE(NULLIF(dados->>'ultima_importacao_id',''),NULLIF(dados->'dados_json'->>'ultima_importacao_id',''),dados->>'importacao_id','') = ANY($1::text[])` : ''}`,
        ...(importacaoIds.length ? [importacaoIds] : []),
      ) as Array<{ total: number }>;
      let atualizados = 0;

      await db.$transaction(async (tx) => {
        for (const regra of regrasTabela) {
          const itemRelatorio = relatorioPorId.get(regra.id)!;
          if (itemRelatorio.status === 'ERRO') continue;

          await tx.$executeRawUnsafe('SAVEPOINT regra_conversao');
          try {
            const coluna = regra.coluna_origem;
            if (!tabela.colunas.includes(coluna) || coluna.endsWith('_original')) {
              itemRelatorio.status = 'ERRO';
              itemRelatorio.erro = `Coluna ${coluna} não pertence à tabela ${tabela.nome}.`;
              await tx.$executeRawUnsafe('RELEASE SAVEPOINT regra_conversao');
              continue;
            }

            const colunaOriginal = `${coluna}_original`;
            const preservaOriginal = tabela.colunas.includes(colunaOriginal);
            const fonteSql = `CASE WHEN dados ? $2 THEN COALESCE(dados->>$2, '') ELSE COALESCE(dados->>$1, '') END`;
            const filtroAdquirenteAtualizacaoSql = `AND ($4 = false OR $3 = '' OR $3 = 'TODAS' OR (CASE WHEN UPPER(COALESCE(dados->>'adquirente','')) LIKE '%ALELO%' OR UPPER(COALESCE(dados->>'adquirente_original','')) LIKE '%NAIP%' OR UPPER(COALESCE(dados->>'adquirente','')) LIKE '%NAIP%' THEN 'ALELO' WHEN UPPER(COALESCE(dados->>'adquirente','')) LIKE '%TICKET%' THEN 'TICKET' ELSE UPPER(TRIM(COALESCE(dados->>'adquirente',''))) END) = $3) AND NOT (COALESCE(dados->'conversoes_bloqueadas','[]'::jsonb) ? $5)`;
            const adquirenteRegra = escopoAdquirenteConversao(regra.adquirente_aplicacao);
            let alterados: Array<{ row_id: string; dados: Record<string, unknown> }> = [];

            if (tipoConversao(regra) === 'TRANSFORMACAO_DATA') {
              if (regra.formato_origem !== 'DDMMYYYY' || regra.formato_destino !== 'YYYY-MM-DD') {
                throw new Error(`Transformação de data não suportada: ${regra.formato_origem || '?'} → ${regra.formato_destino || '?'}.`);
              }
              // O REGEXP restringe a 8 dígitos e o round-trip com to_date impede datas inválidas
              // (ex.: 31022026) de serem normalizadas silenciosamente pelo PostgreSQL.
              const dataValidaSql = `${fonteSql} ~ '^[0-9]{8}$' AND to_char(to_date(${fonteSql}, 'DDMMYYYY'), 'DDMMYYYY') = ${fonteSql}`;
              const valorTransformadoSql = `to_char(to_date(${fonteSql}, 'DDMMYYYY'), 'YYYY-MM-DD')`;
              const dadosAtualizadosSql = preservaOriginal
                ? `jsonb_set(jsonb_set(dados, ARRAY[$2]::text[], to_jsonb(${fonteSql}), true), ARRAY[$1]::text[], to_jsonb(${valorTransformadoSql}), true)`
                : `jsonb_set(dados, ARRAY[$1]::text[], to_jsonb(${valorTransformadoSql}), true)`;
              alterados = await tx.$queryRawUnsafe(
                `UPDATE ${nomeTabela}
                 SET dados = ${dadosAtualizadosSql}, data_atualizacao = NOW()
                 WHERE ${dataValidaSql}
                   ${filtroAdquirenteAtualizacaoSql}
                   ${importacaoIds.length ? `AND COALESCE(NULLIF(dados->>'ultima_importacao_id',''),NULLIF(dados->'dados_json'->>'ultima_importacao_id',''),dados->>'importacao_id','') = ANY($6::text[])` : ''}
                   AND COALESCE(dados->>$1, '') IS DISTINCT FROM ${valorTransformadoSql}
                 RETURNING row_id, dados`,
                coluna, colunaOriginal, adquirenteRegra, tabela.nome === 'vendas_adquirentes', regra.id,
                ...(importacaoIds.length ? [importacaoIds] : []),
              ) as Array<{ row_id: string; dados: Record<string, unknown> }>;
            } else {
              // As regras exatas são cadastradas por pessoas e os layouts nem sempre usam a mesma
              // acentuação. A comparação usa a mesma chave canônica de textoFiltro. Valor vazio
              // também é legítimo: nesse caso $6 é simplesmente ''.
              const fonteNormalizadaSql = `REGEXP_REPLACE(TRANSLATE(
                UPPER(TRIM(${fonteSql})),
                'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                'AAAAAEEEEIIIIOOOOOUUUUC'
              ), '[[:space:]]+', ' ', 'g')`;
              const dadosAtualizadosSql = preservaOriginal
                ? `jsonb_set(jsonb_set(dados, ARRAY[$2]::text[], to_jsonb(${fonteSql}), true), ARRAY[$1]::text[], to_jsonb($7::text), true)`
                : `jsonb_set(dados, ARRAY[$1]::text[], to_jsonb($7::text), true)`;
              alterados = await tx.$queryRawUnsafe(
                `UPDATE ${nomeTabela}
                 SET dados = ${dadosAtualizadosSql}, data_atualizacao = NOW()
                 WHERE (${fonteNormalizadaSql} = $6 OR REGEXP_REPLACE(TRANSLATE(UPPER(TRIM(COALESCE(dados->>$1, ''))), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC'), '[[:space:]]+', ' ', 'g') = $6)
                   ${filtroAdquirenteAtualizacaoSql}
                   ${importacaoIds.length ? `AND COALESCE(NULLIF(dados->>'ultima_importacao_id',''),NULLIF(dados->'dados_json'->>'ultima_importacao_id',''),dados->>'importacao_id','') = ANY($8::text[])` : ''}
                   AND COALESCE(dados->>$1, '') IS DISTINCT FROM $7
                 RETURNING row_id, dados`,
                coluna, colunaOriginal, adquirenteRegra, tabela.nome === 'vendas_adquirentes', regra.id,
                textoFiltro(regra.valor_original), regra.valor_exibicao,
                ...(importacaoIds.length ? [importacaoIds] : []),
              ) as Array<{ row_id: string; dados: Record<string, unknown> }>;
            }
            for (const alterado of alterados) {
              const anterior = tipoConversao(regra) === 'TRANSFORMACAO_DATA'
                ? String(alterado.dados?.[colunaOriginal] ?? '')
                : String(alterado.dados?.[colunaOriginal] ?? regra.valor_original ?? '');
              const valorNovoAuditoria = String(alterado.dados?.[coluna] ?? regra.valor_exibicao ?? '');
              await tx.$executeRawUnsafe(
                `INSERT INTO auditoria_conversoes_itens (tabela,row_id,regra_id,coluna,valor_anterior,valor_novo,adquirente,data_conversao,origem)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),'APLICACAO')
                 ON CONFLICT (tabela,row_id,regra_id,coluna) DO UPDATE SET valor_anterior=EXCLUDED.valor_anterior,valor_novo=EXCLUDED.valor_novo,adquirente=EXCLUDED.adquirente,data_conversao=NOW(),desfeito_em=NULL,origem='APLICACAO'`,
                tabela.nome, alterado.row_id, regra.id, coluna, anterior, valorNovoAuditoria, String(alterado.dados?.adquirente || '')
              );
            }
            itemRelatorio.registros_encontrados = alterados.length;
            itemRelatorio.registros_alterados = alterados.length;
            itemRelatorio.status = alterados.length > 0 ? 'APLICADA' : 'SEM_CORRESPONDENCIA';
            atualizados += alterados.length;
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT regra_conversao');
          } catch (error) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT regra_conversao');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT regra_conversao');
            itemRelatorio.status = 'ERRO';
            itemRelatorio.erro = error instanceof Error ? error.message : String(error);
          }
        }
      });

      resultado[tabela.nome] = {
        antes: Number(totalAntes[0]?.total || 0),
        depois: Number(totalAntes[0]?.total || 0),
        atualizados,
      };
    }

    return { tabelas: resultado, regras: relatorioRegras };
  }

  for (const tabela of tabelasSistema) {
    const regrasTabela = regrasAtivas.filter((item) => item.tabela_origem === tabela.nome);
    if (regrasTabela.length === 0) continue;

    const linhas = await lerTabela<Record<string, unknown>[]>(tabela.arquivo, []);
    let atualizados = 0;

    const linhasConvertidas = linhas.map((linha) => {
      const saida: Record<string, unknown> = tabela.nome === 'vendas_adquirentes'
        ? { ...aplicarNormalizacaoCanonicaVendaAdquirente(linha as VendaAdquirente) }
        : { ...linha };
      if (tabela.nome === 'vendas_adquirentes') {
        saida.valor_taxa = normalizarValorTaxaPositivo(saida.valor_taxa);
        saida.percentual_taxa = calcularPercentualTaxa(saida.valor_bruto, saida.valor_taxa);
      }
      const adquirenteLinha = escopoAdquirenteConversao(saida.adquirente_original || saida.adquirente);

      for (const regra of regrasTabela) {
        const coluna = regra.coluna_origem;
        const itemRelatorio = relatorioPorId.get(regra.id)!;
        if (!(coluna in saida)) continue;
        if (coluna.endsWith('_original')) continue;

        const valorAtual = saida[coluna] === null || saida[coluna] === undefined ? '' : String(saida[coluna]);
        const colunaOriginal = `${coluna}_original`;
        const possuiOriginal = Object.prototype.hasOwnProperty.call(saida, colunaOriginal);
        const valorFonte = possuiOriginal ? String(saida[colunaOriginal] ?? '') : valorAtual;
        const adquirenteRegra = escopoAdquirenteConversao(regra.adquirente_aplicacao);
        const adquirenteCompativel = !adquirenteRegra || adquirenteRegra === 'TODAS' || adquirenteRegra === adquirenteLinha;
        const valorNovo = valorConvertidoPelaRegra(regra, valorFonte);
        if (!adquirenteCompativel || valorNovo === null) continue;
        itemRelatorio.registros_encontrados += 1;
        itemRelatorio.status = 'APLICADA';
        if (valorAtual === valorNovo) continue;

        if (!possuiOriginal) {
          saida[colunaOriginal] = valorFonte;
        }
        saida[coluna] = valorNovo;
        itemRelatorio.registros_alterados += 1;
      }

      if (JSON.stringify(saida) !== JSON.stringify(linha)) atualizados += 1;
      return saida;
    });

    if (atualizados > 0) {
      await gravarTabela(tabela.arquivo, linhasConvertidas);
    }

    resultado[tabela.nome] = {
      antes: linhas.length,
      depois: linhasConvertidas.length,
      atualizados,
    };
  }

  return { tabelas: resultado, regras: relatorioRegras };
}


export async function salvarSicoobLayoutPspPix(registros: SicoobLayoutPspPix[]): Promise<{ inseridos: number; duplicados: number; atualizados?: number }> {
  await garantirDb();
  return salvarRegistrosGenericoComUpsert(
    sicoobLayoutPspPixTabela,
    registros,
    (registro) => String((registro as any).end_to_end_id || registro.hash_linha || ''),
  );
}

async function salvarVendasSipagComplementaresPostgres(vendas: VendaAdquirente[]): Promise<{ inseridos: number; duplicados: number; atualizados: number; conflitos: number }> {
  if (!vendas.length) return { inseridos: 0, duplicados: 0, atualizados: 0, conflitos: 0 };
  await garantirDbPostgres();
  const db = await getDatabase();
  return db.$transaction(async (tx) => {
    // A leitura e todas as gravações compartilham a conexão e o lock transacional.
    // Duas importações SIPAG simultâneas não podem observar a mesma venda ausente.
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(197, 20)');
    const datas = [...new Set(vendas.map(sipagData).filter(Boolean))];
    const existentes = await tx.$queryRawUnsafe(`
      SELECT row_id, dados, conciliacao_id FROM vendas_adquirentes
       WHERE UPPER(COALESCE(dados->>'adquirente',''))='SIPAG'
         AND UPPER(COALESCE(dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'
         AND ${dataVendaSql()} = ANY($1::text[])
    `, datas) as Array<{ row_id: string; dados: VendaAdquirente; conciliacao_id: string | null }>;
    const grupos = new Map<string, Map<string, string>>();
    for (const item of existentes) {
      const chave = sipagChaveComplementar(item.dados);
      if (!chave || !item.conciliacao_id) continue;
      if (!grupos.has(chave)) grupos.set(chave, new Map());
      grupos.get(chave)!.set(item.row_id, item.conciliacao_id);
    }
    const chavesComConflito = new Set([...grupos]
      .filter(([, itens]) => new Set(itens.values()).size > 1)
      .map(([chave]) => chave));
    const plano = planejarSipagComplementares(existentes, vendas, chavesComConflito);
    if (plano.conflitos) {
      console.warn(`[sipag] ${plano.conflitos} linha(s) ignorada(s) em ${chavesComConflito.size} grupo(s) com conciliações diferentes. Vendas e vínculos preservados para revisão.`);
      for (const chave of chavesComConflito) {
        const itens = grupos.get(chave)!;
        console.warn(`[sipag] revisão necessária: ${[...itens].map(([id, conciliacao]) => `${id} (${conciliacao})`).join(', ')}`);
      }
    }
    let atualizados = 0, inseridos = 0;

    // Preserva a linha redundante como histórico, mas retira sua utilidade e
    // move referências para a venda principal. Se duas cópias já estiverem
    // conciliadas de formas diferentes, a consolidação é interrompida.
    for (const [redundanteId, principalId] of plano.substituidos.entries()) {
      const estados = await tx.$queryRawUnsafe(`
        SELECT row_id, conciliacao_id FROM vendas_adquirentes
         WHERE row_id = ANY($1::text[]) FOR UPDATE
      `, [principalId, redundanteId]) as Array<{ row_id: string; conciliacao_id: string | null }>;
      const principal = estados.find((item) => item.row_id === principalId);
      const redundante = estados.find((item) => item.row_id === redundanteId);
      if (principal?.conciliacao_id && redundante?.conciliacao_id && principal.conciliacao_id !== redundante.conciliacao_id) {
        throw new Error(`SIPAG: duplicidades históricas ${principalId} e ${redundanteId} possuem conciliações diferentes. Revise-as antes de consolidar.`);
      }
      const conciliacaoId = principal?.conciliacao_id || redundante?.conciliacao_id || null;
      await tx.$executeRawUnsafe(`
        UPDATE conciliacoes
           SET venda_adquirente_id=$1,
               dados=dados || jsonb_build_object('venda_adquirente_id',$1::text),
               data_atualizacao=NOW()
         WHERE venda_adquirente_id=$2
      `, principalId, redundanteId);
      await tx.$executeRawUnsafe(`
        UPDATE vendas_adquirentes
           SET conciliacao_id=NULL,
               dados=dados || jsonb_build_object(
                 'utilidade_status','NAO_UTIL',
                 'utilidade_motivo','SIPAG_DUPLICIDADE_HISTORICA_CONSOLIDADA',
                 'sipag_consolidada_em_id',$1::text,
                 'sipag_consolidada_em',NOW()::text
               ),
               data_atualizacao=NOW()
         WHERE row_id=$2
      `, principalId, redundanteId);
      if (conciliacaoId) {
        await tx.$executeRawUnsafe(`UPDATE vendas_adquirentes SET conciliacao_id=$1 WHERE row_id=$2`, conciliacaoId, principalId);
      }
    }
    // Uma varredura para todos os vínculos substituídos, em vez de uma
    // varredura completa da tabela para cada duplicidade histórica.
    if (plano.substituidos.size) {
      const substituicoes = JSON.stringify(Object.fromEntries(plano.substituidos));
      await tx.$executeRawUnsafe(`
        UPDATE vendas_adquirentes AS venda
           SET dados=jsonb_set(venda.dados,'{vinculo_voucher_id}',
                 to_jsonb($1::jsonb ->> (venda.dados->>'vinculo_voucher_id')),true),
               data_atualizacao=NOW()
         WHERE $1::jsonb ? (venda.dados->>'vinculo_voucher_id')
      `, substituicoes);
    }
    const updates = [...plano.updates.entries()];
    for (let inicio = 0; inicio < updates.length; inicio += 250) {
      const params: unknown[] = [];
      const valores = updates.slice(inicio, inicio + 250).map(([id, dados], i) => {
        params.push(id, stringifyJsonbSeguro(dados as any));
        return `($${i * 2 + 1}::text, $${i * 2 + 2}::jsonb)`;
      });
      const alterados = await tx.$queryRawUnsafe(`UPDATE vendas_adquirentes AS destino
        SET dados=origem.dados, data_atualizacao=NOW()
        FROM (VALUES ${valores.join(',')}) AS origem(row_id,dados)
        WHERE destino.row_id=origem.row_id RETURNING destino.pk`, ...params);
      atualizados += alterados.length;
    }
    for (let inicio = 0; inicio < plano.novos.length; inicio += 250) {
      const params: unknown[] = [];
      const valores = plano.novos.slice(inicio, inicio + 250).map((v, i) => {
        params.push(v.id, v.hash_linha, stringifyJsonbSeguro(v as any));
        return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3}::jsonb, NOW(), NOW())`;
      });
      const gravados = await tx.$queryRawUnsafe(`INSERT INTO vendas_adquirentes
        (row_id,hash_linha,dados,data_criacao,data_atualizacao) VALUES ${valores.join(',')}
        ON CONFLICT DO NOTHING RETURNING pk`, ...params);
      inseridos += gravados.length;
    }
    return { inseridos, atualizados, duplicados: plano.duplicados + plano.novos.length - inseridos, conflitos: plano.conflitos };
  });
}

async function salvarVendasCoopcertoPostgres(vendas: VendaAdquirente[]): Promise<{ inseridos: number; duplicados: number; atualizados: number; conflitos: number }> {
  if (!vendas.length) return { inseridos: 0, duplicados: 0, atualizados: 0, conflitos: 0 };
  await garantirDbPostgres();
  const db = await getDatabase();
  return db.$transaction(async (tx) => {
    // Serializa somente as vendas COOPCERTO. Dois arquivos dos últimos 30 dias
    // não podem observar a mesma chave como ausente e inserir duas cópias.
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(207, 155)');
    const chaves = [...new Set(vendas.map((venda) => String(venda.chave_semantica_coopcerto || (venda.dados_json as any)?.chave_semantica_coopcerto || '')).filter(Boolean))];
    const existentes = chaves.length ? await tx.$queryRawUnsafe(`
      SELECT row_id, dados
        FROM vendas_adquirentes
       WHERE UPPER(COALESCE(dados->>'adquirente',''))='COOPCERTO'
         AND UPPER(COALESCE(dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'
         AND COALESCE(NULLIF(dados->>'chave_semantica_coopcerto',''), dados->'dados_json'->>'chave_semantica_coopcerto','') = ANY($1::text[])
       ORDER BY pk ASC
    `, chaves) as Array<{ row_id: string; dados: VendaAdquirente }> : [];

    const plano = planejarAtualizacoesCoopcerto(existentes, vendas);
    let atualizados = 0;
    for (const [rowId, dadosAtualizados] of plano.updates) {
      const alterados = await tx.$queryRawUnsafe(`
        UPDATE vendas_adquirentes
           SET dados=$2::jsonb, data_atualizacao=NOW()
         WHERE row_id=$1
         RETURNING pk
      `, rowId, stringifyJsonbSeguro(dadosAtualizados as any));
      atualizados += alterados.length;
    }

    for (const [rowId, principalId] of plano.substituidos) {
      await tx.$executeRawUnsafe(`
        UPDATE vendas_adquirentes
           SET dados = dados || jsonb_build_object(
                 'utilidade_status','NAO_UTIL',
                 'utilidade_motivo','COOPCERTO_ATUALIZACAO_SUBSTITUIDA',
                 'coopcerto_substituida_por_id',$2::text,
                 'coopcerto_consolidada_em',NOW()::text
               ),
               data_atualizacao=NOW()
         WHERE row_id=$1
      `, rowId, principalId);
    }

    let inseridos = 0;
    for (let inicio = 0; inicio < plano.novos.length; inicio += 250) {
      const lote = plano.novos.slice(inicio, inicio + 250);
      const params: unknown[] = [];
      const valores = lote.map((venda, indice) => {
        params.push(venda.id, venda.hash_linha, stringifyJsonbSeguro(venda as any));
        const base = indice * 3;
        return `($${base + 1},$${base + 2},$${base + 3}::jsonb,NOW(),NOW())`;
      });
      const gravados = await tx.$queryRawUnsafe(`
        INSERT INTO vendas_adquirentes (row_id,hash_linha,dados,data_criacao,data_atualizacao)
        VALUES ${valores.join(',')}
        ON CONFLICT DO NOTHING RETURNING pk
      `, ...params);
      inseridos += gravados.length;
    }
    const conflitosInsercao = plano.novos.length - inseridos;
    return {
      inseridos,
      atualizados,
      duplicados: plano.duplicados + conflitosInsercao,
      conflitos: plano.conflitos + conflitosInsercao,
    };
  });
}

export async function salvarVendasAdquirentes(vendas: VendaAdquirente[]): Promise<{ inseridos: number; duplicados: number; atualizados?: number; conflitos?: number }> {
  // v0.1.145: a importação persiste os valores entregues pelo parser/layout.
  // Regras cadastradas em Conversões NÃO são aplicadas aqui. Elas são executadas
  // exclusivamente pelo job/endpoint /api/vendas-adquirentes/normalizar após o lote.
  const normalizadas = vendas
    .filter(ehVendaCanonicaAdquirente)
    .map((venda) => enriquecerEstabelecimentoVenda(venda))
    .map((venda) => {
      const valorTaxa = normalizarValorTaxaPositivo(venda.valor_taxa) as string | undefined;
      return {
        ...venda,
        valor_taxa: valorTaxa,
        percentual_taxa: calcularPercentualTaxa(venda.valor_bruto, valorTaxa),
      };
    })
    .filter(ehVendaCanonicaAdquirente);

  if (usarPostgres()) {
    const sipagComplementares = normalizadas.filter(ehSipagComplementar);
    const coopcerto = normalizadas.filter(ehVendaCoopcertoCabal);
    const demais = normalizadas.filter((venda) => !ehSipagComplementar(venda) && !ehVendaCoopcertoCabal(venda));
    const gravacaoSipag = await salvarVendasSipagComplementaresPostgres(sipagComplementares);
    const gravacaoCoopcerto = await salvarVendasCoopcertoPostgres(coopcerto);
    const gravacaoDemais = await appendTabelaPostgres(vendasAdquirentesTabela, demais as unknown as Array<VendaAdquirente & Record<string, unknown>>, 'hash_linha');
    const db = await getDatabase();
    await db.$transaction(async (tx) => sincronizarVinculosPixSipagSicoobTx(tx));
    invalidarCachesOpcoesVendas();
    return {
      inseridos: gravacaoSipag.inseridos + gravacaoCoopcerto.inseridos + gravacaoDemais.inseridos,
      duplicados: gravacaoSipag.duplicados + gravacaoCoopcerto.duplicados + gravacaoDemais.duplicados,
      atualizados: gravacaoSipag.atualizados + gravacaoCoopcerto.atualizados,
      conflitos: gravacaoSipag.conflitos + gravacaoCoopcerto.conflitos,
    };
  }

  const registros = await lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []);
  const hashes = new Set(registros.map((item) => item.hash_linha).filter(Boolean));
  const indicePorChave = new Map<string, number>();
  registros.forEach((registro, index) => {
    const chave = chaveSemanticaVendaAdquirente(registro) || registro.hash_linha;
    if (chave) indicePorChave.set(chave, index);
  });

  let inseridos = 0;
  let duplicados = 0;
  let atualizados = 0;
  for (const venda of normalizadas) {
    const chave = chaveSemanticaVendaAdquirente(venda) || venda.hash_linha;
    const existenteIndex = chave ? indicePorChave.get(chave) : undefined;
    if (existenteIndex === undefined && !hashes.has(venda.hash_linha)) {
      indicePorChave.set(chave || venda.hash_linha, registros.length);
      hashes.add(venda.hash_linha);
      registros.push(venda);
      inseridos += 1;
      continue;
    }

    duplicados += 1;
    const index = existenteIndex ?? registros.findIndex((item) => item.hash_linha === venda.hash_linha);
    const existente = index >= 0 ? registros[index] : undefined;
    const ehPix = String(venda.modalidade || '').toUpperCase() === 'PIX';
    if (existente && ehPix) {
      const atualizado = mergeAtualizacaoPixAdquirente(existente, venda);
      if (JSON.stringify(existente) !== JSON.stringify(atualizado)) {
        registros[index] = atualizado;
        atualizados += 1;
      }
    }
  }

  await gravarTabela(vendasAdquirentesTabela, registros);
  return { inseridos, duplicados, atualizados };
}

async function recalcularPercentualTaxaPostgres(importacaoIds: string[] = []): Promise<number> {
  const db = await getDatabase();
  // Os parsers persistem valores monetários canônicos, mas a expressão também aceita vírgula decimal.
  // percentual_taxa é campo derivado: nunca depende de conversão manual.
  const brutoSql = `CASE
    WHEN REPLACE(COALESCE(dados->>'valor_bruto',''), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      THEN ABS(REPLACE(dados->>'valor_bruto', ',', '.')::numeric)
    ELSE 0::numeric
  END`;
  const taxaSql = `CASE
    WHEN REPLACE(COALESCE(dados->>'valor_taxa',''), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$'
      THEN ABS(REPLACE(dados->>'valor_taxa', ',', '.')::numeric)
    ELSE 0::numeric
  END`;
  const percentualSql = `CASE
    WHEN (${brutoSql}) > 0
      THEN TO_CHAR(((${taxaSql}) / (${brutoSql})) * 100, 'FM999999990.0000')
    ELSE '0.0000'
  END`;
  const alterados = await db.$queryRawUnsafe(
    `UPDATE vendas_adquirentes
        SET dados = jsonb_set(dados, '{percentual_taxa}', to_jsonb((${percentualSql})::text), true),
            data_atualizacao = NOW()
      WHERE COALESCE(dados->>'percentual_taxa','') IS DISTINCT FROM (${percentualSql})
        ${importacaoIds.length ? `AND COALESCE(NULLIF(dados->>'ultima_importacao_id',''),NULLIF(dados->'dados_json'->>'ultima_importacao_id',''),dados->>'importacao_id','') = ANY($1::text[])` : ''}
      RETURNING pk`,
    ...(importacaoIds.length ? [importacaoIds] : []),
  ) as Array<{ pk: bigint }>;
  return alterados.length;
}

export async function normalizarVendasAdquirentesExistentes(opcoes: { modo?: 'GLOBAL' | 'LOTE'; importacaoIds?: string[] } = {}) {
  const modo = opcoes.modo || (opcoes.importacaoIds ? 'LOTE' : 'GLOBAL');
  const importacaoIds = [...new Set((opcoes.importacaoIds || []).filter(Boolean))];
  if (modo === 'LOTE' && importacaoIds.length === 0) {
    throw new Error('O processamento incremental do lote exige pelo menos um importacao_id.');
  }
  const idsEscopo = modo === 'GLOBAL' ? [] : importacaoIds;
  const conversoes = await listarConversoes();
  let antes = 0;
  let depois = 0;
  let dataInicial = '';
  let dataFinal = '';
  if (usarPostgres()) {
    await garantirDbPostgres();
    const db = await getDatabase();
    const contagem = await db.$queryRawUnsafe(
      `WITH adquirente AS (
         SELECT ${dataVendaSql()} data_venda FROM vendas_adquirentes
          ${idsEscopo.length ? `WHERE COALESCE(NULLIF(dados->>'ultima_importacao_id',''),NULLIF(dados->'dados_json'->>'ultima_importacao_id',''),dados->>'importacao_id','') = ANY($1::text[])` : ''}
       ), periodo AS (
         SELECT data_venda FROM adquirente
         UNION ALL
         SELECT ${dataVendaSql()} FROM vendas_interdata
          ${idsEscopo.length ? `WHERE COALESCE(NULLIF(dados->>'ultima_importacao_id',''),NULLIF(dados->'dados_json'->>'ultima_importacao_id',''),dados->>'importacao_id','') = ANY($1::text[])` : ''}
       )
       SELECT (SELECT COUNT(*) FROM adquirente)::int total,
              COALESCE(MIN(data_venda),'') data_inicial,
              COALESCE(MAX(data_venda),'') data_final
         FROM periodo`,
      ...(idsEscopo.length ? [idsEscopo] : []),
    ) as Array<{ total:number; data_inicial:string; data_final:string }>;
    antes = Number(contagem[0]?.total || 0);
    depois = antes;
    dataInicial = String(contagem[0]?.data_inicial || '');
    dataFinal = String(contagem[0]?.data_final || '');
  } else {
    const vendas = await lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []);
    const escopo = idsEscopo.length ? vendas.filter((v) => idsEscopo.includes(String(v.importacao_id || ''))) : vendas;
    antes = escopo.length;
    depois = escopo.filter(ehVendaCanonicaAdquirente).length;
  }
  const conversoesAplicadas = await aplicarConversoesCadastradasEmTabelasExistentes(conversoes, idsEscopo);
  // v0.1.150: recalcula por último, depois de TODAS as conversões, para impedir que
  // qualquer regra sobrescreva o valor matemático derivado de valor_bruto e valor_taxa.
  const percentualTaxaRecalculado = usarPostgres() ? await recalcularPercentualTaxaPostgres(idsEscopo) : 0;
  const atualizados = (conversoesAplicadas.tabelas.vendas_adquirentes?.atualizados || 0) + percentualTaxaRecalculado;
  if (atualizados > 0) invalidarCachesOpcoesVendas();
  return {
    sucesso: true,
    modo_escopo: modo,
    antes,
    depois,
    removidos_nao_canonicos: antes - depois,
    escopo_importacoes: idsEscopo,
    escopo_periodo: { data_inicial: dataInicial, data_final: dataFinal },
    atualizados,
    percentual_taxa_recalculado: percentualTaxaRecalculado,
    conversoes_aplicadas: conversoesAplicadas.tabelas,
    relatorio_regras: conversoesAplicadas.regras,
    resumo_conversoes: {
      regras_ativas: conversoesAplicadas.regras.length,
      regras_aplicadas: conversoesAplicadas.regras.filter((item) => item.status === 'APLICADA').length,
      regras_sem_correspondencia: conversoesAplicadas.regras.filter((item) => item.status === 'SEM_CORRESPONDENCIA').length,
      regras_com_erro: conversoesAplicadas.regras.filter((item) => item.status === 'ERRO').length,
      registros_encontrados: conversoesAplicadas.regras.reduce((total, item) => total + item.registros_encontrados, 0),
      registros_alterados: conversoesAplicadas.regras.reduce((total, item) => total + item.registros_alterados, 0),
    },
  };
}

export async function obterCoberturaCodigosEstabelecimento() {
  await garantirDb();
  const db = await getDatabase();
  const itens = await db.$queryRawUnsafe(`
    SELECT UPPER(COALESCE(dados->>'adquirente','NÃO INFORMADA')) adquirente,
           COUNT(*)::int total,
           COUNT(*) FILTER (WHERE COALESCE(TRIM(dados->>'codigo_estabelecimento'),'')<>'')::int identificados,
           COUNT(*) FILTER (WHERE COALESCE(TRIM(dados->>'codigo_estabelecimento'),'')='')::int pendentes,
           COUNT(DISTINCT NULLIF(TRIM(dados->>'codigo_estabelecimento'),''))::int estabelecimentos
      FROM vendas_adquirentes GROUP BY 1 ORDER BY 1
  `) as Array<{adquirente:string;total:number;identificados:number;pendentes:number;estabelecimentos:number}>;
  return {
    itens,
    total: itens.reduce((s,item)=>s+Number(item.total),0),
    identificados: itens.reduce((s,item)=>s+Number(item.identificados),0),
    pendentes: itens.reduce((s,item)=>s+Number(item.pendentes),0),
  };
}

export async function recalcularPercentualTaxaVendasAdquirentes() {
  return normalizarVendasAdquirentesExistentes({ modo: 'GLOBAL' });
}

function ehVendaCanonicaAdquirente(item: VendaAdquirente) {
  if (item.suprimido_por_vinculo_voucher === true || String((item as any).suprimido_por_vinculo_voucher || '').toLowerCase() === 'true') return false;
  // vendas_adquirentes deve guardar somente eventos de venda/autorização úteis para conciliação.
  // Headers, trailers, totalizadores, pagamentos e recebíveis ficam nas tabelas brutas de cada layout.
  const adquirente = String(item.adquirente || '').toUpperCase();
  const layout = String(item.layout_origem || '').toLowerCase();
  const tipoArquivo = String(item.tipo_arquivo || '').toUpperCase();
  const codigo = String(item.codigo_registro || '').trim();

  if (adquirente === 'SIPAG' && layout.startsWith('sipag_layout_2_0_')) {
    return tipoArquivo === 'S' && ['001', '011', '013', '014'].includes(codigo);
  }
  if (adquirente === 'SIPAG' && layout.startsWith('sipag_fiserv_layout_7_6_')) {
    return tipoArquivo === 'S' && ['001', '011', '013', '014', '017'].includes(codigo);
  }
  if (adquirente === 'SICREDI' && layout.startsWith('sicredi_fiserv_layout_7_4_')) {
    return tipoArquivo === 'S' && ['001', '011', '013', '014'].includes(codigo);
  }
  return true;
}

function normalizarHoraParaOrdenacao(hora?: string) {
  const texto = String(hora || '').trim();
  if (!texto) return '00:00:00';

  const compacto = texto.replace(/\D/g, '');
  if (compacto.length === 6 && !texto.includes(':')) {
    return `${compacto.slice(0, 2)}:${compacto.slice(2, 4)}:${compacto.slice(4, 6)}`;
  }

  const partes = texto.split(':').map((parte) => parte.replace(/\D/g, '').padStart(2, '0'));
  const [hh = '00', mm = '00', ss = '00'] = partes;
  return `${hh.slice(0, 2)}:${mm.slice(0, 2)}:${ss.slice(0, 2)}`;
}

function timestampVendaParaOrdenacao(data?: string, hora?: string) {
  const dataTexto = String(data || '').trim();
  const horaTexto = String(hora || '').trim();
  if (!dataTexto && !horaTexto) return 0;

  const horaNormalizada = normalizarHoraParaOrdenacao(horaTexto);

  // Alguns parsers deixam a data completa em data_venda (ISO) e outros separam data + hora.
  // Para ordenar todas as adquirentes juntas, sempre montamos um timestamp único e comparável.
  const isoData = dataTexto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoData) {
    const timestamp = Date.parse(`${isoData[1]}-${isoData[2]}-${isoData[3]}T${horaNormalizada}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const dataCompactaBr = dataTexto.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (dataCompactaBr) {
    const dia = dataCompactaBr[1];
    const mes = dataCompactaBr[2];
    const ano = dataCompactaBr[3];
    const timestamp = Date.parse(`${ano}-${mes}-${dia}T${horaNormalizada}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const dataBr = dataTexto.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (dataBr) {
    const ano = dataBr[3].length === 2 ? `20${dataBr[3]}` : dataBr[3];
    const mes = dataBr[2].padStart(2, '0');
    const dia = dataBr[1].padStart(2, '0');
    const timestamp = Date.parse(`${ano}-${mes}-${dia}T${horaNormalizada}`);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  const timestamp = Date.parse(dataTexto || horaTexto);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function ordenarPorDataVendaDecrescente<T extends { data_venda?: string; hora_venda?: string; data_criacao?: string; numero_linha?: number; adquirente?: string }>(a: T, b: T) {
  const dataB = timestampVendaParaOrdenacao(b.data_venda, b.hora_venda);
  const dataA = timestampVendaParaOrdenacao(a.data_venda, a.hora_venda);
  if (dataB !== dataA) return dataB - dataA;

  const criacaoB = Date.parse(String(b.data_criacao || '')) || 0;
  const criacaoA = Date.parse(String(a.data_criacao || '')) || 0;
  if (criacaoB !== criacaoA) return criacaoB - criacaoA;

  // Só usa adquirente como desempate quando data/hora são idênticas. Nunca agrupa antes da data.
  const adquirenteA = String(a.adquirente || '');
  const adquirenteB = String(b.adquirente || '');
  const desempateAdquirente = adquirenteA.localeCompare(adquirenteB);
  if (desempateAdquirente !== 0) return desempateAdquirente;

  return Number(b.numero_linha || 0) - Number(a.numero_linha || 0);
}


function numeroMoeda(valor?: unknown) {
  if (valor === null || valor === undefined || valor === '') return 0;
  let texto = String(valor).trim();
  if (!texto || texto === '-') return 0;
  const negativo = /^-/.test(texto) || /-$/.test(texto);
  texto = texto.replace(/[^\d,.-]/g, '');
  if (!texto || texto === '-' || texto === ',' || texto === '.') return 0;
  if (texto.includes(',') && texto.includes('.')) texto = texto.replace(/\./g, '').replace(',', '.');
  else if (texto.includes(',')) texto = texto.replace(',', '.');
  else if ((texto.match(/\./g) || []).length > 1) texto = texto.replace(/\./g, '');
  const numero = Number(texto);
  if (!Number.isFinite(numero)) return 0;
  return negativo ? -Math.abs(numero) : numero;
}

function chaveDataIsoVenda(data?: string) {
  const dataTexto = String(data || '').trim();
  const isoData = dataTexto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoData) return `${isoData[1]}-${isoData[2]}-${isoData[3]}`;
  const dataCompactaBr = dataTexto.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (dataCompactaBr) return `${dataCompactaBr[3]}-${dataCompactaBr[2]}-${dataCompactaBr[1]}`;
  const dataBr = dataTexto.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (dataBr) {
    const ano = dataBr[3].length === 2 ? `20${dataBr[3]}` : dataBr[3];
    return `${ano}-${dataBr[2].padStart(2, '0')}-${dataBr[1].padStart(2, '0')}`;
  }
  const timestamp = Date.parse(dataTexto);
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString().slice(0, 10);
  return '';
}

function formatarDataBrRelatorio(dataIso: string) {
  const match = String(dataIso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : dataIso || '-';
}

type LinhaRelatorioSql = {
  dimensao?: string;
  chave: string;
  bruto: number | string;
  taxa: number | string;
  liquido: number | string;
  quantidade: number | string;
  ticket_medio: number | string;
  taxa_media_percentual: number | string;
};

function numeroRelatorioSql(valor: unknown) {
  const numero = Number(valor || 0);
  return Number.isFinite(numero) ? numero : 0;
}

function normalizarLinhaRelatorioSql(linha: LinhaRelatorioSql) {
  return {
    chave: String(linha.chave || 'NÃO INFORMADO'),
    bruto: numeroRelatorioSql(linha.bruto),
    taxa: numeroRelatorioSql(linha.taxa),
    liquido: numeroRelatorioSql(linha.liquido),
    quantidade: numeroRelatorioSql(linha.quantidade),
    ticket_medio: numeroRelatorioSql(linha.ticket_medio),
    taxa_media_percentual: numeroRelatorioSql(linha.taxa_media_percentual),
  };
}

export async function gerarRelatorioAdquirentes(filtros: Record<string, unknown> = {}) {
  await garantirDbPostgres();
  const db = await getDatabase();
  const config: ConfigListagemSql = { tabela: 'vendas_adquirentes', adquirente: true, estabelecimento: 'estabelecimento_filtro', modalidade: 'modalidade_filtro', status: 'status_filtro' };
  const { where, parametros } = construirWhereListagem(filtros, config);
  const dataVenda = dataVendaSql();
  const moeda = (campo: string) => `CASE WHEN REPLACE(COALESCE(dados->>'${campo}','0'), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN REPLACE(dados->>'${campo}', ',', '.')::numeric ELSE 0 END`;
  const bruto = moeda('valor_bruto');
  const taxa = `ABS(${moeda('valor_taxa')})`;
  const liquidoInformado = moeda('valor_liquido');
  const liquido = `CASE WHEN ${liquidoInformado} <> 0 THEN ${liquidoInformado} ELSE ${bruto} - ${taxa} END`;
  const modalidade = `UPPER(COALESCE(NULLIF(TRIM(dados->>'modalidade'),''), 'NÃO INFORMADO'))`;
  const bandeiraBase = `UPPER(COALESCE(NULLIF(TRIM(${bandeiraListagemSql(config)}),''), 'NÃO INFORMADO'))`;
  const chaveBandeira = `REGEXP_REPLACE(TRANSLATE(${bandeiraBase}, 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g')`;
  const bandeira = `CASE WHEN ${chaveBandeira} IN ('NAOINFORMADO','OUTRA','OUTRAS') THEN 'OUTRAS' ELSE ${bandeiraBase} END`;
  const status = `UPPER(COALESCE(dados->>'status_transacao',''))`;
  const financeiramenteValida = `NOT (
    ${status} LIKE '%CANCEL%' OR ${status} LIKE '%NEGAD%' OR ${status} LIKE '%RECUS%' OR
    ${status} LIKE '%ESTORN%' OR ${status} LIKE '%DESFEIT%' OR ${status} LIKE '%UNDONE%' OR
    ${status} LIKE '%NÃO AUTORIZ%' OR ${status} LIKE '%NAO AUTORIZ%' OR
    ${status} LIKE '%PENDENTE_PROCESSAMENTO%'
  )`;
  const base = `WITH base AS (
    SELECT dados, ${dataVenda} AS data_venda_iso, ${bruto} AS bruto, ${taxa} AS taxa,
      ${liquido} AS liquido, ${modalidade} AS modalidade, ${bandeira} AS bandeira, ${status} AS status,
      (${financeiramenteValida}) AS financeiramente_valida
    FROM "vendas_adquirentes" ${where}
  )`;
  const colunasResumo = `COALESCE(SUM(CASE WHEN financeiramente_valida THEN bruto ELSE 0 END),0)::float8 AS bruto,
    COALESCE(SUM(CASE WHEN financeiramente_valida THEN taxa ELSE 0 END),0)::float8 AS taxa,
    COALESCE(SUM(CASE WHEN financeiramente_valida THEN liquido ELSE 0 END),0)::float8 AS liquido,
    COUNT(*)::int AS quantidade,
    COALESCE(SUM(CASE WHEN financeiramente_valida THEN bruto ELSE 0 END) / NULLIF(COUNT(*) FILTER (WHERE financeiramente_valida),0),0)::float8 AS ticket_medio,
    COALESCE(SUM(CASE WHEN financeiramente_valida THEN taxa ELSE 0 END) * 100 / NULLIF(SUM(CASE WHEN financeiramente_valida THEN bruto ELSE 0 END),0),0)::float8 AS taxa_media_percentual`;
  const baseMaterializada = base.replace('WITH base AS (', 'WITH base AS MATERIALIZED (');
  const agrupamento = (dimensao: string, expressao: string, ordem: string, limite: number) =>
    `SELECT * FROM (SELECT '${dimensao}' AS dimensao, ${expressao} AS chave, ${colunasResumo}
      FROM base GROUP BY 2 ORDER BY ${ordem} LIMIT ${limite}) AS grupo_${dimensao}`;
  const consultaAgrupamentos = `${baseMaterializada}
    ${[
      agrupamento('dia', `COALESCE(NULLIF(data_venda_iso,''), 'SEM DATA')`, 'chave ASC', 400),
      agrupamento('adquirente', `UPPER(COALESCE(NULLIF(TRIM(dados->>'adquirente'),''), 'NÃO INFORMADO'))`, 'bruto DESC', 50),
      agrupamento('forma_pagamento', `CASE WHEN modalidade = 'CARTEIRA DIGITAL' THEN 'CARTEIRA DIGITAL' ELSE 'CARTÃO' END`, 'bruto DESC', 50),
      agrupamento('modalidade', 'modalidade', 'bruto DESC', 50),
      agrupamento('bandeira', 'bandeira', 'bruto DESC', 50),
      agrupamento('terminal', `UPPER(COALESCE(NULLIF(TRIM(dados->>'terminal'),''), 'NÃO INFORMADO'))`, 'bruto DESC', 20),
    ].join('\nUNION ALL\n')}`;

  const inicioMedicao = process.hrtime.bigint();
  const adquirenteHistorico = String(filtros.adquirente || '').trim().toUpperCase();
  const parametrosHistorico = adquirenteHistorico ? [adquirenteHistorico] : [];
  const whereHistoricoBase = `UPPER(COALESCE(dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'
    AND LOWER(COALESCE(dados->>'suprimido_por_vinculo_voucher','false')) <> 'true'
    AND NOT (${sqlRegistroNaoAplicavel('vendas_adquirentes')})`;
  const whereHistorico = adquirenteHistorico
    ? `WHERE ${whereHistoricoBase} AND UPPER(COALESCE(NULLIF(TRIM(dados->>'adquirente'),''), 'NÃO INFORMADO')) = $1`
    : `WHERE ${whereHistoricoBase}`;
  const [resumos, agrupamentos, analiseAdquirentes, historicoAdquirentes, opcoes] = await Promise.all([
    db.$queryRawUnsafe(`${base} SELECT ${colunasResumo},
      COUNT(*) FILTER (WHERE ((status LIKE '%AUTORIZ%' AND status NOT LIKE '%NÃO AUTORIZ%' AND status NOT LIKE '%NAO AUTORIZ%') OR status IN ('APROVADO','APROVADA')))::int AS autorizadas,
      COUNT(*) FILTER (WHERE status LIKE '%CANCEL%')::int AS canceladas,
      COUNT(*) FILTER (WHERE status LIKE '%NEGAD%' OR status LIKE '%RECUS%' OR status LIKE '%NÃO AUTORIZ%' OR status LIKE '%NAO AUTORIZ%')::int AS negadas,
      COUNT(*) FILTER (WHERE status LIKE '%ESTORN%' OR status LIKE '%DESFEIT%' OR status LIKE '%UNDONE%')::int AS estornadas
      FROM base`, ...parametros),
    db.$queryRawUnsafe(consultaAgrupamentos, ...parametros),
    db.$queryRawUnsafe(`${base} SELECT
      UPPER(COALESCE(NULLIF(TRIM(dados->>'adquirente'),''), 'NÃO INFORMADO')) AS adquirente,
      modalidade,
      bandeira,
      ${colunasResumo}
      FROM base GROUP BY 1, 2, 3 ORDER BY 1, 2, bruto DESC`, ...parametros),
    db.$queryRawUnsafe(`SELECT DISTINCT
      UPPER(COALESCE(NULLIF(TRIM(dados->>'adquirente'),''), 'NÃO INFORMADO')) AS adquirente,
      ${bandeira} AS bandeira
      FROM "vendas_adquirentes" ${whereHistorico} ORDER BY 1, 2`, ...parametrosHistorico),
    obterOpcoesVendasAdquirentes(filtros),
  ]);
  const grupos = new Map<string, ReturnType<typeof normalizarLinhaRelatorioSql>[]>();
  for (const linha of agrupamentos as LinhaRelatorioSql[]) {
    const dimensao = String(linha.dimensao || '');
    const lista = grupos.get(dimensao) || [];
    lista.push(normalizarLinhaRelatorioSql(linha));
    grupos.set(dimensao, lista);
  }
  const porDia = grupos.get('dia') || [];
  const porAdquirente = grupos.get('adquirente') || [];
  const porFormaPagamento = grupos.get('forma_pagamento') || [];
  const porModalidade = grupos.get('modalidade') || [];
  const porBandeira = grupos.get('bandeira') || [];
  const porTerminal = grupos.get('terminal') || [];
  const resumo = (resumos as Array<Record<string, unknown>>)[0] || {};
  const quantidade = numeroRelatorioSql(resumo.quantidade);
  const analisePorAdquirente = new Map<string, Map<string, Array<Record<string, unknown>>>>();
  const bandeirasHistoricas = new Map<string, string[]>();
  for (const linha of historicoAdquirentes as Array<Record<string, unknown>>) {
    const adquirente = String(linha.adquirente || 'NÃO INFORMADO');
    if (!analisePorAdquirente.has(adquirente)) analisePorAdquirente.set(adquirente, new Map());
    const lista = bandeirasHistoricas.get(adquirente) || [];
    lista.push(String(linha.bandeira || 'NÃO INFORMADO'));
    bandeirasHistoricas.set(adquirente, lista);
  }
  for (const linha of analiseAdquirentes as Array<Record<string, unknown>>) {
    const adquirente = String(linha.adquirente || 'NÃO INFORMADO');
    const modalidadeLinha = String(linha.modalidade || 'NÃO INFORMADO');
    if (!analisePorAdquirente.has(adquirente)) analisePorAdquirente.set(adquirente, new Map());
    const modalidadesAdquirente = analisePorAdquirente.get(adquirente)!;
    if (!modalidadesAdquirente.has(modalidadeLinha)) modalidadesAdquirente.set(modalidadeLinha, []);
    modalidadesAdquirente.get(modalidadeLinha)!.push({
      bandeira: String(linha.bandeira || 'NÃO INFORMADO'),
      bruto: numeroRelatorioSql(linha.bruto),
      taxa: numeroRelatorioSql(linha.taxa),
      liquido: numeroRelatorioSql(linha.liquido),
      quantidade: numeroRelatorioSql(linha.quantidade),
    });
  }
  const duracaoRelatorioMs = Number(process.hrtime.bigint() - inicioMedicao) / 1_000_000;
  const periodoLog = `${String(filtros.data_inicio || '*')}..${String(filtros.data_fim || '*')}`;
  console.log(`[sql] relatório adquirentes ${duracaoRelatorioMs.toFixed(1)}ms linhas=${quantidade} periodo=${periodoLog}`);

  return {
    filtros_aplicados: filtros,
    gerado_em: new Date().toISOString(),
    opcoes,
    resumo: {
      total_bruto: numeroRelatorioSql(resumo.bruto), total_taxas: numeroRelatorioSql(resumo.taxa),
      total_liquido: numeroRelatorioSql(resumo.liquido), quantidade_transacoes: quantidade,
      ticket_medio: numeroRelatorioSql(resumo.ticket_medio), taxa_media_percentual: numeroRelatorioSql(resumo.taxa_media_percentual),
      autorizadas: numeroRelatorioSql(resumo.autorizadas), canceladas: numeroRelatorioSql(resumo.canceladas),
      negadas: numeroRelatorioSql(resumo.negadas), estornadas: numeroRelatorioSql(resumo.estornadas),
      canceladas_ou_negadas: numeroRelatorioSql(resumo.canceladas) + numeroRelatorioSql(resumo.negadas),
    },
    por_dia: porDia.map((item) => ({ ...item, data: formatarDataBrRelatorio(item.chave) })),
    por_adquirente: porAdquirente, por_forma_pagamento: porFormaPagamento, por_modalidade: porModalidade,
    por_bandeira: porBandeira, por_terminal: porTerminal,
    analise_adquirentes: Array.from(analisePorAdquirente, ([adquirente, modalidadesMap]) => ({
      adquirente,
      bandeiras_historicas: bandeirasHistoricas.get(adquirente) || [],
      modalidades: Array.from(modalidadesMap, ([nome, bandeiras]) => ({
        nome,
        bruto: bandeiras.reduce((total, item) => total + numeroRelatorioSql(item.bruto), 0),
        taxa: bandeiras.reduce((total, item) => total + numeroRelatorioSql(item.taxa), 0),
        liquido: bandeiras.reduce((total, item) => total + numeroRelatorioSql(item.liquido), 0),
        quantidade: bandeiras.reduce((total, item) => total + numeroRelatorioSql(item.quantidade), 0),
        bandeiras,
      })),
    })),
  };
}

type FiltrosListagemVendas = Record<string, unknown>;

type ConfigListagemSql = {
  tabela: 'vendas_adquirentes' | 'vendas_interdata';
  adquirente?: boolean;
  estabelecimento: string;
  modalidade: string;
  status: string;
};

function dataVendaSql() {
  return 'data_venda_filtro';
}

function bandeiraListagemSql(_config: ConfigListagemSql) {
  // Códigos numéricos preservados na base são agrupados apenas na camada de
  // consulta. A coluna deriva exclusivamente de dados->>'bandeira'; o valor
  // original continua intacto e auditável no PostgreSQL.
  return 'bandeira_filtro';
}

function sqlValorNaoAplica(aliasConversao = 'cv') {
  return `REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(${aliasConversao}.dados->>'valor_exibicao','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'`;
}

function sqlCodigoEstabelecimento(_tabela: 'vendas_adquirentes' | 'vendas_interdata', alias: string) {
  return `${alias}.estabelecimento_chave`;
}

function sqlRegistroNaoAplicavel(tabela: 'vendas_adquirentes' | 'vendas_interdata', aliasRegistro = '') {
  if (!aliasRegistro) return `"${tabela}".registro_nao_aplicavel`;
  const dadosRegistro = aliasRegistro ? `${aliasRegistro}.dados` : `"${tabela}".dados`;
  const valorAtualConversao = `${dadosRegistro}->>(cv.dados->>'coluna_origem')`;
  const origem = tabela === 'vendas_adquirentes'
    ? `UPPER(COALESCE(${dadosRegistro}->>'adquirente',''))`
    : `'INTERDATA'`;
  const literalNaoAplica = ['codigo_estabelecimento', 'cnpj_estabelecimento', 'pagador_cnpj', 'pagador_documento']
    .map((coluna) => `REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(${dadosRegistro}->>'${coluna}','')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'`)
    .join(' OR ');
  return `((${literalNaoAplica}) OR EXISTS (
    SELECT 1 FROM "conversoes" cv
     WHERE cv.dados->>'tabela_origem' = '${tabela}'
       AND COALESCE(TRIM(cv.dados->>'coluna_origem'),'') <> ''
       AND UPPER(COALESCE(cv.dados->>'ativo','TRUE')) IN ('TRUE','1','SIM')
       AND ${sqlValorNaoAplica('cv')}
       AND (
         UPPER(TRIM(COALESCE(cv.dados->>'valor_original',''))) = UPPER(TRIM(COALESCE(${valorAtualConversao},'')))
         OR REGEXP_REPLACE(TRANSLATE(UPPER(COALESCE(${valorAtualConversao},'')), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'
       )
       AND (COALESCE(TRIM(cv.dados->>'adquirente_aplicacao'),'') = '' OR UPPER(cv.dados->>'adquirente_aplicacao') = ${origem})
  ))`;
}

function sqlEstabelecimentoLiteralNaoAplica(tabela: 'vendas_adquirentes' | 'vendas_interdata', aliasRegistro: string) {
  const valor = tabela === 'vendas_adquirentes'
    ? `COALESCE(NULLIF(${aliasRegistro}.dados->>'codigo_estabelecimento',''),${aliasRegistro}.dados->>'cnpj_estabelecimento','')`
    : `COALESCE(NULLIF(${aliasRegistro}.dados->>'cnpj_estabelecimento',''),${aliasRegistro}.dados->>'codigo_estabelecimento','')`;
  return `REGEXP_REPLACE(TRANSLATE(UPPER(TRIM(${valor})), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z0-9]', '', 'g') = 'NAOAPLICA'`;
}

function estabelecimentoLiteralNaoAplica(valor: unknown) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase() === 'NAOAPLICA';
}

function registroContemNaoAplica(registro: Record<string, unknown>) {
  return Object.values(registro).some((valor) => typeof valor === 'string' && estabelecimentoLiteralNaoAplica(valor));
}

function bandeiraParaExibicao(valor: unknown) {
  const texto = String(valor ?? '').trim();
  return /^\d+$/.test(texto) ? 'Outras' : valor;
}

function aplicarBandeiraParaExibicao<T extends Record<string, unknown>>(registro: T): T {
  const bandeira = bandeiraParaExibicao(registro.bandeira);
  if (bandeira === registro.bandeira) return registro;
  return { ...registro, bandeira_original: registro.bandeira_original || registro.bandeira, bandeira };
}

function construirWhereListagem(filtros: FiltrosListagemVendas, config: ConfigListagemSql) {
  const clausulas: string[] = [];
  const parametros: unknown[] = [];
  const add = (sql: string, valor: unknown) => {
    parametros.push(valor);
    clausulas.push(sql.replace('?', `$${parametros.length}`));
  };
  const texto = (chave: string) => String(filtros[chave] || '').trim().toUpperCase();
  const inicio = String(filtros.data_inicio || '').trim();
  const fim = String(filtros.data_fim || '').trim();
  if (config.tabela === 'vendas_adquirentes') {
    clausulas.push(`UPPER(COALESCE(dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'`);
    clausulas.push(`LOWER(COALESCE(dados->>'suprimido_por_vinculo_voucher','false')) <> 'true'`);
  }
  clausulas.push(`NOT (${sqlRegistroNaoAplicavel(config.tabela)})`);
  if (inicio) add(`${dataVendaSql()} >= ?`, inicio);
  if (fim) add(`${dataVendaSql()} <= ?`, fim);
  if (texto('estabelecimento')) add(`UPPER(TRIM(COALESCE(${config.estabelecimento},''))) = ?`, texto('estabelecimento'));
  const busca = texto('busca');
  if (busca) {
    parametros.push(`%${busca}%`);
    const parametroBusca = `$${parametros.length}`;
    const buscaMoeda = busca.replace(/[^0-9,.-]/g, '').replace(/\.(?=.*[,])/g, '').replace(',', '.');
    let parametroBuscaMoeda = '';
    if (buscaMoeda) {
      parametros.push(`%${buscaMoeda}%`);
      parametroBuscaMoeda = `$${parametros.length}`;
    }
    const moedaNormalizada = (campo: string) => `CASE
      WHEN COALESCE(dados->>'${campo}','') LIKE '%,%'
        THEN REGEXP_REPLACE(REPLACE(REPLACE(COALESCE(dados->>'${campo}',''), '.', ''), ',', '.'), '[^0-9.\-]', '', 'g')
      ELSE REGEXP_REPLACE(COALESCE(dados->>'${campo}',''), '[^0-9.\-]', '', 'g')
    END`;
    clausulas.push(`(
      UPPER(COALESCE(dados->>'codigo_estabelecimento','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'adquirente','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'data_venda','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'hora_venda','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'nsu','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'codigo_autorizacao','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'terminal','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'id_venda_erp','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'id','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'modalidade','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'bandeira','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'parcelas','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'status_transacao','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'valor_bruto','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'valor_taxa','')) LIKE ${parametroBusca}
      OR UPPER(COALESCE(dados->>'valor_liquido','')) LIKE ${parametroBusca}
      ${parametroBuscaMoeda ? `OR ${moedaNormalizada('valor_bruto')} LIKE ${parametroBuscaMoeda}
      OR ${moedaNormalizada('valor_taxa')} LIKE ${parametroBuscaMoeda}
      OR ${moedaNormalizada('valor_liquido')} LIKE ${parametroBuscaMoeda}` : ''}
    )`);
  }
  if (config.adquirente && texto('adquirente')) add(`adquirente_filtro = ?`, texto('adquirente'));
  const modalidade = texto('modalidade');
  const forma = texto('forma_pagamento');
  if (modalidade) add(`UPPER(COALESCE(${config.modalidade},'')) = ?`, modalidade);
  if (forma === 'CARTEIRA DIGITAL') clausulas.push(`UPPER(COALESCE(${config.modalidade},'')) = 'CARTEIRA DIGITAL'`);
  if (forma === 'CARTAO') clausulas.push(`UPPER(COALESCE(${config.modalidade},'')) <> 'CARTEIRA DIGITAL'`);
  if (texto('bandeira')) add(`UPPER(COALESCE(${bandeiraListagemSql(config)},'')) = ?`, texto('bandeira'));
  if (texto('status')) add(`UPPER(COALESCE(${config.status},'')) = ?`, texto('status'));
  const duplicidade = texto('duplicidade');
  if (duplicidade === 'SEM_DUPLICADOS') clausulas.push(`UPPER(COALESCE(dados->>'duplicidade_status','')) <> 'DUPLICADO_PROVAVEL'`);
  if (duplicidade === 'APENAS_DUPLICADOS') clausulas.push(`UPPER(COALESCE(dados->>'duplicidade_status','')) = 'DUPLICADO_PROVAVEL'`);
  const conciliacao = texto('conciliacao');
  if (conciliacao === 'CONCILIADO') clausulas.push(`UPPER(COALESCE(dados->>'status_conciliacao','')) = 'CONCILIADO'`);
  if (conciliacao === 'NAO_CONCILIADO') clausulas.push(`UPPER(COALESCE(dados->>'status_conciliacao','')) <> 'CONCILIADO'`);
  if (conciliacao && !['CONCILIADO', 'NAO_CONCILIADO'].includes(conciliacao)) add(`UPPER(COALESCE(NULLIF(dados->>'status_conciliacao',''), 'PENDENTE')) = ?`, conciliacao);
  return { where: clausulas.length ? `WHERE ${clausulas.join(' AND ')}` : '', parametros };
}

async function listarVendasPostgres(limite: number, offset: number, filtros: FiltrosListagemVendas, config: ConfigListagemSql) {
  await garantirDbPostgres();
  const db = await getDatabase();
  const tamanhoPagina = Math.min(500, Math.max(1, Number(limite || 100)));
  const inicio = Math.max(0, Number(offset || 0));
  const { where, parametros } = construirWhereListagem(filtros, config);
  const inicioMedicao = Date.now();
  const [linhas, contagem] = await Promise.all([
    db.$queryRawUnsafe(`SELECT dados FROM "${config.tabela}" ${where} ORDER BY ${dataVendaSql()} DESC, COALESCE(dados->>'hora_venda','') DESC, pk DESC LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`, ...parametros, tamanhoPagina, inicio),
    db.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM "${config.tabela}" ${where}`, ...parametros),
  ]) as [Array<{ dados: Record<string, unknown> }>, Array<{ total: number }>];
  const duracao = Date.now() - inicioMedicao;
  console.log(`[sql] listar ${config.tabela} ${duracao}ms linhas=${linhas.length} total=${Number(contagem[0]?.total || 0)}`);
  return { linhas: linhas.map((row) => aplicarBandeiraParaExibicao(row.dados)), total_linhas: Number(contagem[0]?.total || 0), limite: tamanhoPagina, offset: inicio };
}

function textoFiltro(valor: unknown) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function vendaDentroDoPeriodo(dataVenda: unknown, dataInicio: string, dataFim: string) {
  const dataIso = chaveDataIsoVenda(String(dataVenda || ''));
  if (dataInicio && (!dataIso || dataIso < dataInicio)) return false;
  if (dataFim && (!dataIso || dataIso > dataFim)) return false;
  return true;
}

function filtrarVendaAdquirente(venda: VendaAdquirente, filtros: FiltrosListagemVendas = {}) {
  const dataInicio = String(filtros.data_inicio || '').trim();
  const dataFim = String(filtros.data_fim || '').trim();
  const adquirenteFiltro = textoFiltro(filtros.adquirente);
  const estabelecimentoFiltro = textoFiltro(filtros.estabelecimento);
  const formaPagamentoFiltro = textoFiltro(filtros.forma_pagamento);
  const modalidadeFiltro = textoFiltro(filtros.modalidade);
  const bandeiraFiltro = textoFiltro(filtros.bandeira);
  const statusFiltro = textoFiltro(filtros.status);
  const duplicidadeFiltro = textoFiltro((filtros as any).duplicidade);
  const conciliacaoFiltro = textoFiltro((filtros as any).conciliacao);
  const buscaFiltro = textoFiltro(filtros.busca);

  const modalidadeVenda = textoFiltro(venda.modalidade);

  if (textoFiltro((venda as any).utilidade_status) === 'NAO_UTIL' || registroContemNaoAplica(venda as unknown as Record<string, unknown>)) return false;
  if (buscaFiltro && ![venda.codigo_estabelecimento, venda.adquirente, venda.data_venda, venda.hora_venda, venda.valor_bruto, venda.valor_taxa, venda.percentual_taxa, venda.valor_liquido, venda.modalidade, venda.bandeira, venda.status_transacao, venda.parcelas, venda.nsu, venda.codigo_autorizacao, venda.terminal, venda.id].some((valor) => textoFiltro(valor).includes(buscaFiltro) || textoFiltro(String(valor || '').replace('.', ',')).includes(buscaFiltro))) return false;
  if (!vendaDentroDoPeriodo(venda.data_venda, dataInicio, dataFim)) return false;
  if (adquirenteFiltro && textoFiltro(venda.adquirente) !== adquirenteFiltro) return false;
  if (estabelecimentoFiltro && textoFiltro(venda.codigo_estabelecimento) !== estabelecimentoFiltro) return false;
  if (formaPagamentoFiltro === 'CARTEIRA DIGITAL' && modalidadeVenda !== 'CARTEIRA DIGITAL') return false;
  if (formaPagamentoFiltro === 'CARTAO' && modalidadeVenda === 'CARTEIRA DIGITAL') return false;
  if (modalidadeFiltro && modalidadeVenda !== modalidadeFiltro) return false;
  if (bandeiraFiltro && textoFiltro(bandeiraParaExibicao(venda.bandeira)) !== bandeiraFiltro) return false;
  if (statusFiltro && textoFiltro(venda.status_transacao) !== statusFiltro) return false;
  if (duplicidadeFiltro === 'SEM_DUPLICADOS' && textoFiltro(venda.duplicidade_status) === 'DUPLICADO_PROVAVEL') return false;
  if (duplicidadeFiltro === 'APENAS_DUPLICADOS' && textoFiltro(venda.duplicidade_status) !== 'DUPLICADO_PROVAVEL') return false;
  if (conciliacaoFiltro === 'PENDENTE' && textoFiltro((venda as any).status_conciliacao) !== 'PENDENTE') return false;
  if (conciliacaoFiltro === 'CONCILIADO' && textoFiltro((venda as any).status_conciliacao) !== 'CONCILIADO') return false;
  if (conciliacaoFiltro === 'SUGERIDO' && textoFiltro((venda as any).status_conciliacao) !== 'SUGERIDO') return false;
  if (conciliacaoFiltro === 'AMBIGUO' && textoFiltro((venda as any).status_conciliacao) !== 'AMBIGUO') return false;
  return true;
}

function filtrarVendaErp(venda: VendaInterdata, filtros: FiltrosListagemVendas = {}) {
  const dataInicio = String(filtros.data_inicio || '').trim();
  const dataFim = String(filtros.data_fim || '').trim();
  const estabelecimentoFiltro = textoFiltro(filtros.estabelecimento);
  const formaPagamentoFiltro = textoFiltro(filtros.forma_pagamento);
  const modalidadeFiltro = textoFiltro(filtros.modalidade);
  const bandeiraFiltro = textoFiltro(filtros.bandeira);
  const statusFiltro = textoFiltro(filtros.status);
  const duplicidadeFiltro = textoFiltro((filtros as any).duplicidade);
  const conciliacaoFiltro = textoFiltro((filtros as any).conciliacao);
  const buscaFiltro = textoFiltro(filtros.busca);

  const modalidadeVenda = textoFiltro((venda as any).tipo_produto || (venda as any).forma_pagamento);

  if (registroContemNaoAplica(venda as unknown as Record<string, unknown>)) return false;
  if (buscaFiltro && ![(venda as any).nsu, (venda as any).codigo_autorizacao, (venda as any).terminal, (venda as any).id_venda_erp, (venda as any).id, (venda as any).valor_bruto, (venda as any).valor_taxa, (venda as any).valor_liquido].some((valor) => textoFiltro(valor).includes(buscaFiltro) || textoFiltro(String(valor || '').replace('.', ',')).includes(buscaFiltro))) return false;
  if (!vendaDentroDoPeriodo((venda as any).data_venda, dataInicio, dataFim)) return false;
  if (estabelecimentoFiltro && textoFiltro((venda as any).cnpj_estabelecimento || (venda as any).codigo_estabelecimento) !== estabelecimentoFiltro) return false;
  if (formaPagamentoFiltro === 'CARTEIRA DIGITAL' && modalidadeVenda !== 'CARTEIRA DIGITAL') return false;
  if (formaPagamentoFiltro === 'CARTAO' && modalidadeVenda === 'CARTEIRA DIGITAL') return false;
  if (modalidadeFiltro && modalidadeVenda !== modalidadeFiltro) return false;
  if (bandeiraFiltro && textoFiltro(bandeiraParaExibicao((venda as any).bandeira)) !== bandeiraFiltro) return false;
  if (statusFiltro && textoFiltro((venda as any).status_venda) !== statusFiltro) return false;
  if (duplicidadeFiltro === 'SEM_DUPLICADOS' && textoFiltro((venda as any).duplicidade_status) === 'DUPLICADO_PROVAVEL') return false;
  if (duplicidadeFiltro === 'APENAS_DUPLICADOS' && textoFiltro((venda as any).duplicidade_status) !== 'DUPLICADO_PROVAVEL') return false;
  if (conciliacaoFiltro === 'PENDENTE' && textoFiltro((venda as any).status_conciliacao) !== 'PENDENTE') return false;
  if (conciliacaoFiltro === 'CONCILIADO' && textoFiltro((venda as any).status_conciliacao) !== 'CONCILIADO') return false;
  if (conciliacaoFiltro === 'SUGERIDO' && textoFiltro((venda as any).status_conciliacao) !== 'SUGERIDO') return false;
  if (conciliacaoFiltro === 'AMBIGUO' && textoFiltro((venda as any).status_conciliacao) !== 'AMBIGUO') return false;
  return true;
}

function semFiltrosPosteriores(filtros: FiltrosListagemVendas, nivel: 'adquirente' | 'modalidade' | 'bandeira' | 'status') {
  const resultado = { ...filtros };
  if (nivel === 'adquirente') {
    delete resultado.adquirente;
    delete resultado.forma_pagamento;
    delete resultado.modalidade;
    delete resultado.bandeira;
    delete resultado.status;
  } else if (nivel === 'modalidade') {
    delete resultado.modalidade;
    delete resultado.bandeira;
    delete resultado.status;
  } else if (nivel === 'bandeira') {
    delete resultado.bandeira;
    delete resultado.status;
  } else {
    delete resultado.status;
  }
  delete resultado.terminal;
  return resultado;
}

async function valoresDistintosPostgres(config: ConfigListagemSql, expressao: string, filtros: FiltrosListagemVendas) {
  const db = await getDatabase();
  const { where, parametros } = construirWhereListagem(filtros, config);
  const linhas = await db.$queryRawUnsafe(
    `SELECT DISTINCT ${expressao} AS valor FROM "${config.tabela}" ${where} AND ${expressao} <> '' ORDER BY valor`,
    ...parametros,
  ) as Array<{ valor: string }>;
  return linhas.map((linha) => linha.valor).filter(Boolean);
}

type OpcoesAdquirentesCache = { expira: number; valor: { estabelecimentos: string[]; adquirentes: string[]; modalidades: string[]; bandeiras: string[]; status: string[] } };
const opcoesAdquirentesCache = new Map<string, OpcoesAdquirentesCache>();
const opcoesAdquirentesEmAndamento = new Map<string, Promise<OpcoesAdquirentesCache['valor']>>();
type OpcoesErpCache = { expira: number; valor: { estabelecimentos: string[]; adquirentes: string[]; modalidades: string[]; bandeiras: string[]; status: string[] } };
const opcoesErpCache = new Map<string, OpcoesErpCache>();
const opcoesErpEmAndamento = new Map<string, Promise<OpcoesErpCache['valor']>>();

function invalidarCachesOpcoesVendas() {
  opcoesAdquirentesCache.clear();
  opcoesErpCache.clear();
}

function chaveOpcoesAdquirentes(filtros: FiltrosListagemVendas) {
  return JSON.stringify({
    busca: filtros.busca || '', data_inicio: filtros.data_inicio || '', data_fim: filtros.data_fim || '',
    adquirente: filtros.adquirente || '', estabelecimento: filtros.estabelecimento || '',
    forma_pagamento: filtros.forma_pagamento || '', modalidade: filtros.modalidade || '',
    bandeira: filtros.bandeira || '', status: filtros.status || '',
  });
}

export async function obterOpcoesVendasAdquirentes(filtros: FiltrosListagemVendas = {}) {
  const config: ConfigListagemSql = { tabela: 'vendas_adquirentes', adquirente: true, estabelecimento: 'estabelecimento_filtro', modalidade: 'modalidade_filtro', status: 'status_filtro' };
  if (usarPostgres()) {
    await garantirDbPostgres();
    const chave = chaveOpcoesAdquirentes(filtros);
    const cacheado = opcoesAdquirentesCache.get(chave);
    if (cacheado && cacheado.expira > Date.now()) return cacheado.valor;
    const existente = opcoesAdquirentesEmAndamento.get(chave);
    if (existente) return existente;
    const trabalho = (async () => {
      // Uma consulta por vez evita que cada abertura da tela consuma cinco
      // conexões simultaneamente. O cache curto também absorve re-renderizações
      // e chamadas duplicadas do relatório financeiro.
      const estabelecimentos = await valoresDistintosPostgres(config, config.estabelecimento, { ...filtros, estabelecimento: '' });
      const adquirentes = await valoresDistintosPostgres(config, 'adquirente_filtro', semFiltrosPosteriores(filtros, 'adquirente'));
      const modalidades = await valoresDistintosPostgres(config, 'modalidade_filtro', semFiltrosPosteriores(filtros, 'modalidade'));
      const bandeiras = await valoresDistintosPostgres(config, bandeiraListagemSql(config), semFiltrosPosteriores(filtros, 'bandeira'));
      const status = await valoresDistintosPostgres(config, 'status_filtro', semFiltrosPosteriores(filtros, 'status'));
      return { estabelecimentos, adquirentes, modalidades, bandeiras, status };
    })();
    opcoesAdquirentesEmAndamento.set(chave, trabalho);
    try {
      const valor = await trabalho;
      opcoesAdquirentesCache.set(chave, { valor, expira: Date.now() + 60_000 });
      return valor;
    } finally {
      opcoesAdquirentesEmAndamento.delete(chave);
    }
  }
  const vendas = await lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []);
  const somenteVendas = vendas.filter(ehVendaCanonicaAdquirente);
  const valores = <T,>(nivel: 'adquirente' | 'modalidade' | 'bandeira' | 'status', obter: (venda: VendaAdquirente) => T) =>
    [...new Set(somenteVendas.filter((venda) => filtrarVendaAdquirente(venda, semFiltrosPosteriores(filtros, nivel))).map(obter).map(textoFiltro).filter(Boolean))].sort();
  return {
    estabelecimentos: [...new Set(somenteVendas.filter((venda) => filtrarVendaAdquirente(venda, { ...filtros, estabelecimento: '' })).map((venda) => textoFiltro(venda.codigo_estabelecimento)).filter(Boolean))].sort(),
    adquirentes: valores('adquirente', (v) => v.adquirente),
    modalidades: valores('modalidade', (v) => v.modalidade),
    bandeiras: valores('bandeira', (v) => bandeiraParaExibicao(v.bandeira)),
    status: valores('status', (v) => v.status_transacao),
  };
}

export async function obterOpcoesVendasErp(filtros: FiltrosListagemVendas = {}) {
  const config: ConfigListagemSql = { tabela: 'vendas_interdata', estabelecimento: 'estabelecimento_filtro', modalidade: 'modalidade_filtro', status: 'status_filtro' };
  if (usarPostgres()) {
    await garantirDbPostgres();
    const chave = chaveOpcoesAdquirentes(filtros);
    const cacheado = opcoesErpCache.get(chave);
    if (cacheado && cacheado.expira > Date.now()) return cacheado.valor;
    const existente = opcoesErpEmAndamento.get(chave);
    if (existente) return existente;
    const trabalho = (async () => {
      // Executar em série impede que um único carregamento da página reserve
      // três conexões simultâneas do pool para filtros auxiliares.
      const estabelecimentos = await valoresDistintosPostgres(config, config.estabelecimento, { ...filtros, estabelecimento: '' });
      const modalidades = await valoresDistintosPostgres(config, config.modalidade, semFiltrosPosteriores(filtros, 'modalidade'));
      const bandeiras = await valoresDistintosPostgres(config, bandeiraListagemSql(config), semFiltrosPosteriores(filtros, 'bandeira'));
      return { estabelecimentos, adquirentes: [], modalidades, bandeiras, status: [] };
    })();
    opcoesErpEmAndamento.set(chave, trabalho);
    try {
      const valor = await trabalho;
      opcoesErpCache.set(chave, { valor, expira: Date.now() + 60_000 });
      return valor;
    } finally {
      opcoesErpEmAndamento.delete(chave);
    }
  }
  const vendas = await lerTabela<VendaInterdata[]>(vendasInterdataTabela, []);
  const valores = <T,>(nivel: 'modalidade' | 'bandeira', obter: (venda: VendaInterdata) => T) =>
    [...new Set(vendas.filter((venda) => filtrarVendaErp(venda, semFiltrosPosteriores(filtros, nivel))).map(obter).map(textoFiltro).filter(Boolean))].sort();
  return {
    estabelecimentos: [...new Set(vendas.filter((venda) => filtrarVendaErp(venda, { ...filtros, estabelecimento: '' })).map((venda) => textoFiltro(venda.cnpj_estabelecimento || (venda as any).codigo_estabelecimento)).filter(Boolean))].sort(),
    adquirentes: [],
    modalidades: valores('modalidade', (v) => (v as any).tipo_produto || (v as any).forma_pagamento),
    bandeiras: valores('bandeira', (v) => bandeiraParaExibicao((v as any).bandeira)),
    status: [],
  };
}

export async function listarVendasAdquirentesComExibicao(limite = 500, offset = 0, filtros: FiltrosListagemVendas = {}) {
  if (usarPostgres()) {
    return listarVendasPostgres(limite, offset, filtros, { tabela: 'vendas_adquirentes', adquirente: true, estabelecimento: 'estabelecimento_filtro', modalidade: 'modalidade_filtro', status: 'status_filtro' });
  }
  const vendas = await lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []);
  const inicio = Math.max(0, Number(offset || 0));
  const tamanhoPagina = Math.max(1, Number(limite || 500));
  const somenteVendas = [...vendas]
    .filter(ehVendaCanonicaAdquirente)
    .filter((venda) => filtrarVendaAdquirente(venda, filtros))
    .sort(ordenarPorDataVendaDecrescente);
  const fatia = somenteVendas.slice(inicio, inicio + tamanhoPagina);
  return {
    linhas: fatia.map((venda) => aplicarBandeiraParaExibicao(venda as unknown as Record<string, unknown>)),
    total_linhas: somenteVendas.length,
    limite: tamanhoPagina,
    offset: inicio,
  };
}

export async function listarConversoes(): Promise<Conversao[]> {
  await garantirDb();
  return lerTabela<Conversao[]>(conversoesTabela, []);
}

export async function listarOrigensDisponiveisParaConversao() {
  await garantirDb();
  if (usarPostgres()) {
    const prisma = await getDatabase();
    const [adquirentes, erps] = await Promise.all([
      prisma.$queryRawUnsafe(
        `SELECT DISTINCT UPPER(TRIM(dados->>'adquirente')) AS nome FROM "vendas_adquirentes"
          WHERE NULLIF(TRIM(dados->>'adquirente'), '') IS NOT NULL ORDER BY nome`,
      ),
      prisma.$queryRawUnsafe(
        `SELECT DISTINCT UPPER(TRIM(COALESCE(NULLIF(dados->>'erp', ''), NULLIF(dados->>'sistema_erp', ''), NULLIF(dados->>'origem', ''), 'INTERDATA'))) AS nome
           FROM "vendas_interdata" ORDER BY nome`,
      ),
    ]);
    return Array.from(new Set(([...erps, ...adquirentes] as Array<{ nome: string }>).map((item) => item.nome).filter(Boolean))).sort();
  }
  const [interdata, adquirentes] = await Promise.all([
    lerTabela<Array<Record<string, unknown>>>(vendasInterdataTabela, []),
    lerTabela<Array<Record<string, unknown>>>(vendasAdquirentesTabela, []),
  ]);
  const nomes = new Set<string>();
  interdata.forEach((venda) => {
    const nome = String(venda.erp || venda.sistema_erp || venda.origem || 'INTERDATA').trim().toUpperCase();
    if (nome) nomes.add(nome);
  });
  adquirentes.forEach((venda) => {
    const nome = String(venda.adquirente || '').trim().toUpperCase();
    if (nome) nomes.add(nome);
  });
  return Array.from(nomes).sort();
}

export async function aplicarConversoesEmLinha(tabela: string, linha: Record<string, unknown>) {
  const conversoes = await listarConversoes();
  return aplicarConversoesEmLinhaComRegras(tabela, linha, conversoes);
}

function aplicarConversoesEmLinhaComRegras(tabela: string, linha: Record<string, unknown>, conversoes: Conversao[]) {
  const saida: Record<string, unknown> = { ...linha };
  const valores_exibicao: Record<string, unknown> = {};
  for (const [coluna, valor] of Object.entries(linha)) {
    const valorTexto = valor === null || valor === undefined ? '' : String(valor);
    const adquirenteLinha = String((linha as Record<string, unknown>).adquirente || '').trim().toUpperCase();
    const bloqueadas = Array.isArray((linha as Record<string, unknown>).conversoes_bloqueadas) ? ((linha as Record<string, unknown>).conversoes_bloqueadas as unknown[]).map(String) : [];
    const regra = encontrarConversaoAtiva(conversoes, tabela, coluna, valorTexto, adquirenteLinha);
    const valorNovo = regra ? valorConvertidoPelaRegra(regra, valorTexto) : null;
    valores_exibicao[coluna] = regra && valorNovo !== null && !bloqueadas.includes(regra.id) ? valorNovo : valor;
  }
  saida.valores_exibicao = valores_exibicao;
  return saida;
}


type GrupoDuplicidade = {
  grupo: string;
  tabela: 'vendas_adquirentes' | 'vendas_interdata';
  chave: string;
  criterio: string;
  quantidade: number;
  registros: Array<Record<string, unknown>>;
};

function chaveValorMonetario(valor: unknown) {
  return Math.round(numeroMoeda(valor) * 100).toString();
}

function chaveLimpaDuplicidade(valor: unknown) {
  return textoFiltro(valor).replace(/[^A-Z0-9]/g, '');
}

function chaveParcelasDuplicidade(valor: unknown) {
  const texto = String(valor ?? '').trim();
  if (!texto) return '';
  const numero = Number(texto.replace(',', '.'));
  return Number.isFinite(numero) && numero >= 0 ? String(numero) : chaveLimpaDuplicidade(texto);
}

function chaveDuplicidadeAdquirente(venda: VendaAdquirente) { return chaveVenda(venda); }

function chaveDuplicidadeInterdata(venda: VendaInterdata) {
  const data = chaveDataIsoVenda(venda.data_venda || '');
  const valor = chaveValorMonetario(venda.valor_bruto);
  const nsu = chaveLimpaDuplicidade(venda.nsu);
  const idVenda = chaveLimpaDuplicidade(venda.id_venda_erp || venda.venda_erp_id);
  const terminal = chaveLimpaDuplicidade(venda.terminal);
  const modalidade = chaveLimpaDuplicidade((venda as any).tipo_produto || (venda as any).forma_pagamento);
  const parcelas = chaveParcelasDuplicidade(venda.parcelas);
  const identificador = nsu || idVenda || terminal;
  if (!data || !valor || valor === '0' || !identificador) return '';
  return [data, valor, identificador, terminal, modalidade, parcelas].join('|');
}

function resumoRegistroDuplicidade(registro: Record<string, unknown>, tabela: 'vendas_adquirentes' | 'vendas_interdata') {
  return {
    id: registro.id,
    data_venda: registro.data_venda,
    hora_venda: registro.hora_venda,
    valor_bruto: registro.valor_bruto,
    nsu: registro.nsu,
    codigo_autorizacao: registro.codigo_autorizacao,
    terminal: registro.terminal,
    adquirente: tabela === 'vendas_adquirentes' ? registro.adquirente : 'ERP INTERDATA',
    modalidade: tabela === 'vendas_adquirentes' ? registro.modalidade : (registro.tipo_produto || registro.forma_pagamento),
    parcelas: registro.parcelas,
    importacao_id: registro.importacao_id,
    hash_linha: registro.hash_linha,
    duplicidade_status: registro.duplicidade_status,
    duplicidade_grupo: registro.duplicidade_grupo,
  };
}

function montarGruposDuplicidade<T extends Record<string, unknown>>(
  tabela: 'vendas_adquirentes' | 'vendas_interdata',
  registros: T[],
  chaveFn: (registro: T) => string,
  prefixoGrupo: string,
) {
  const mapa = new Map<string, T[]>();
  for (const registro of registros) {
    const chave = chaveFn(registro);
    if (!chave) continue;
    const grupo = mapa.get(chave) || [];
    grupo.push(registro);
    mapa.set(chave, grupo);
  }

  let indice = 0;
  const grupos: GrupoDuplicidade[] = [];
  for (const [chave, itens] of mapa.entries()) {
    if (itens.length < 2) continue;
    indice += 1;
    const grupoId = `${prefixoGrupo}-${String(indice).padStart(5, '0')}`;
    grupos.push({
      grupo: grupoId,
      tabela,
      chave,
      criterio: tabela === 'vendas_adquirentes'
        ? 'adquirente + estabelecimento + data/hora + valor + autorização/NSU + modalidade + parcelas + status (candidatos; remoção verifica referências e finanças)'
        : 'data_venda + valor_bruto + NSU/id_venda_erp/terminal + modalidade + parcelas',
      quantidade: itens.length,
      registros: itens.map((item) => resumoRegistroDuplicidade(item, tabela)),
    });
  }
  return grupos;
}

function aplicarMarcacoesDuplicidade<T extends Record<string, unknown>>(registros: T[], grupos: GrupoDuplicidade[]) {
  const porId = new Map<string, string>();
  for (const grupo of grupos) {
    for (const registro of grupo.registros) {
      const id = String(registro.id || registro.hash_linha || '');
      if (id) porId.set(id, grupo.grupo);
    }
  }
  let atualizados = 0;
  const marcados = registros.map((registro) => {
    const id = String((registro as any).id || (registro as any).hash_linha || '');
    const grupo = porId.get(id);
    if (!grupo) return registro;
    if (registro.duplicidade_status === 'DUPLICADO_PROVAVEL' && registro.duplicidade_grupo === grupo) return registro;
    atualizados += 1;
    return { ...registro, duplicidade_status: 'DUPLICADO_PROVAVEL', duplicidade_grupo: grupo, duplicidade_marcada_em: new Date().toISOString() } as T;
  });
  return { registros: marcados, atualizados };
}

async function aplicarMarcacoesDuplicidadePostgres(
  tabela: 'vendas_adquirentes' | 'vendas_interdata',
  registros: Array<Record<string, unknown>>,
  grupos: GrupoDuplicidade[],
) {
  const marcado = aplicarMarcacoesDuplicidade(registros, grupos);
  if (marcado.atualizados === 0) return 0;
  await garantirDbPostgres();
  const db = await getDatabase();
  await db.$transaction(async (tx) => {
    for (const registro of marcado.registros) {
      if (registro.duplicidade_status !== 'DUPLICADO_PROVAVEL') continue;
      await tx.$executeRawUnsafe(
        `UPDATE ${nomeTabelaSeguro(tabela)} SET dados = dados || $1::jsonb, data_atualizacao = NOW() WHERE row_id = $2`,
        stringifyJsonbSeguro({ duplicidade_status: registro.duplicidade_status, duplicidade_grupo: registro.duplicidade_grupo, duplicidade_marcada_em: registro.duplicidade_marcada_em || new Date().toISOString() }),
        rowIdDoRegistro(registro),
      );
    }
  });
  return marcado.atualizados;
}

export async function verificarDuplicidadesImportacao({ aplicar = true }: { aplicar?: boolean } = {}) {
  const [vendasAdquirentes, vendasInterdata] = await Promise.all([
    lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []),
    lerTabela<VendaInterdata[]>(vendasInterdataTabela, []),
  ]);

  const gruposAdquirentes = montarGruposDuplicidade('vendas_adquirentes', vendasAdquirentes.filter((venda) => ehVendaCanonicaAdquirente(venda) && textoFiltro((venda as any).utilidade_status) !== 'NAO_UTIL' && !registroContemNaoAplica(venda as unknown as Record<string, unknown>)), chaveDuplicidadeAdquirente, 'ADQ-DUP');
  const gruposInterdata = montarGruposDuplicidade('vendas_interdata', vendasInterdata.filter((venda) => !registroContemNaoAplica(venda as unknown as Record<string, unknown>)), chaveDuplicidadeInterdata, 'ERP-DUP');

  let atualizadosAdquirentes = 0;
  let atualizadosInterdata = 0;

  if (aplicar) {
    if (usarPostgres()) {
      [atualizadosAdquirentes, atualizadosInterdata] = await Promise.all([
        aplicarMarcacoesDuplicidadePostgres('vendas_adquirentes', vendasAdquirentes as unknown as Record<string, unknown>[], gruposAdquirentes),
        aplicarMarcacoesDuplicidadePostgres('vendas_interdata', vendasInterdata as unknown as Record<string, unknown>[], gruposInterdata),
      ]);
    } else {
      const marcadoAdquirentes = aplicarMarcacoesDuplicidade(vendasAdquirentes as unknown as Record<string, unknown>[], gruposAdquirentes);
      const marcadoInterdata = aplicarMarcacoesDuplicidade(vendasInterdata as unknown as Record<string, unknown>[], gruposInterdata);
      atualizadosAdquirentes = marcadoAdquirentes.atualizados;
      atualizadosInterdata = marcadoInterdata.atualizados;
      await Promise.all([
        gravarTabela(vendasAdquirentesTabela, marcadoAdquirentes.registros as unknown as VendaAdquirente[]),
        gravarTabela(vendasInterdataTabela, marcadoInterdata.registros as unknown as VendaInterdata[]),
      ]);
    }
  }

  return {
    sucesso: true,
    aplicado: aplicar,
    atualizado_em: new Date().toISOString(),
    resumo: {
      grupos_total: gruposAdquirentes.length + gruposInterdata.length,
      vendas_adquirentes: gruposAdquirentes.length,
      vendas_interdata: gruposInterdata.length,
      registros_adquirentes_em_grupos: gruposAdquirentes.reduce((total, grupo) => total + grupo.quantidade, 0),
      registros_interdata_em_grupos: gruposInterdata.reduce((total, grupo) => total + grupo.quantidade, 0),
      atualizados_adquirentes: atualizadosAdquirentes,
      atualizados_interdata: atualizadosInterdata,
    },
    grupos: [...gruposAdquirentes, ...gruposInterdata],
  };
}


type DecisaoRemocaoDuplicidade<T extends Record<string, unknown>> = {
  chave: string;
  base: T;
  removidos: T[];
  conflito: boolean;
  motivo: string;
};

function idConciliacaoRegistro(registro: Record<string, unknown>) {
  return String(registro.conciliacao_id || '').trim();
}

function dataOrdenacaoDuplicidade(registro: Record<string, unknown>) {
  return String(registro.data_criacao || registro.data_importacao || registro.id || registro.hash_linha || '');
}

function planejarRemocaoDuplicados<T extends Record<string, unknown>>(
  registros: T[],
  chaveFn: (registro: T) => string,
  manter: 'mais_antigo' | 'mais_recente',
) {
  const grupos = new Map<string, T[]>();
  const semChave: T[] = [];
  for (const registro of registros) {
    const chave = chaveFn(registro);
    if (!chave) {
      semChave.push(registro);
      continue;
    }
    const grupo = grupos.get(chave) || [];
    grupo.push(registro);
    grupos.set(chave, grupo);
  }

  const decisoes: Array<DecisaoRemocaoDuplicidade<T>> = [];
  let removidos = 0;
  let gruposRemovidos = 0;
  let gruposConflito = 0;
  for (const [chave, grupo] of grupos.entries()) {
    if (grupo.length < 2) continue;
    const conciliacoes = [...new Set(grupo.map(idConciliacaoRegistro).filter(Boolean))];
    const ordenado = [...grupo].sort((a, b) => dataOrdenacaoDuplicidade(a).localeCompare(dataOrdenacaoDuplicidade(b)) || rowIdDoRegistro(a).localeCompare(rowIdDoRegistro(b)));
    const conciliados = ordenado.filter((item) => idConciliacaoRegistro(item));
    const base = conciliados[0] || (manter === 'mais_recente' ? ordenado[ordenado.length - 1] : ordenado[0]);
    if (conciliacoes.length > 1) {
      gruposConflito += 1;
      decisoes.push({ chave, base, removidos: ordenado.filter((item) => rowIdDoRegistro(item) !== rowIdDoRegistro(base)), conflito: true, motivo: 'DUPLICADOS_COM_CONCILIACOES_DIFERENTES' });
      continue;
    }
    const itensRemovidos = ordenado.filter((item) => rowIdDoRegistro(item) !== rowIdDoRegistro(base));
    gruposRemovidos += 1;
    removidos += itensRemovidos.length;
    decisoes.push({
      chave,
      base,
      removidos: itensRemovidos,
      conflito: false,
      motivo: conciliados.length ? 'PRESERVADO_REGISTRO_CONCILIADO' : manter === 'mais_recente' ? 'PRESERVADO_MAIS_RECENTE' : 'PRESERVADO_MAIS_ANTIGO',
    });
  }
  const idsRemovidos = new Set(decisoes.filter((item) => !item.conflito).flatMap((item) => item.removidos.map((registro) => rowIdDoRegistro(registro))));
  const mantidos = [...semChave, ...registros.filter((item) => Boolean(chaveFn(item)) && !idsRemovidos.has(rowIdDoRegistro(item)))].map((item) => {
    const ehBase = decisoes.some((grupo) => !grupo.conflito && rowIdDoRegistro(grupo.base) === rowIdDoRegistro(item));
    return ehBase ? { ...item, duplicidade_status: undefined, duplicidade_grupo: undefined } as T : item;
  });
  return { registros: mantidos, removidos, grupos: gruposRemovidos, grupos_conflito: gruposConflito, decisoes };
}

async function removerDuplicidadesPostgres<T extends Record<string, unknown>>(
  tabela: 'vendas_adquirentes' | 'vendas_interdata',
  plano: ReturnType<typeof planejarRemocaoDuplicados<T>>,
  manter: 'mais_antigo' | 'mais_recente',
) {
  await garantirDbPostgres();
  const db = await getDatabase();
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "auditoria_duplicidades" (id BIGSERIAL PRIMARY KEY, execucao_id TEXT NOT NULL, tabela TEXT NOT NULL, chave_duplicidade TEXT NOT NULL, registro_mantido_id TEXT NOT NULL, registro_removido_id TEXT, conciliacao_preservada_id TEXT, criterio_manutencao TEXT NOT NULL, status TEXT NOT NULL, detalhes JSONB NOT NULL, criado_em TIMESTAMPTZ DEFAULT NOW())`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_auditoria_duplicidades_execucao ON "auditoria_duplicidades" (execucao_id)`);
    await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_auditoria_duplicidades_tabela_criado ON "auditoria_duplicidades" (tabela, criado_em DESC)`);
    const execucaoId = `DEDUP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    for (const decisao of plano.decisoes) {
      const baseId = rowIdDoRegistro(decisao.base);
      if (decisao.conflito) {
        await tx.$executeRawUnsafe(`INSERT INTO "auditoria_duplicidades" (execucao_id, tabela, chave_duplicidade, registro_mantido_id, conciliacao_preservada_id, criterio_manutencao, status, detalhes) VALUES ($1,$2,$3,$4,$5,$6,'CONFLITO',$7::jsonb)`, execucaoId, tabela, decisao.chave, baseId, idConciliacaoRegistro(decisao.base) || null, decisao.motivo, stringifyJsonbSeguro({ ids_grupo: [baseId, ...decisao.removidos.map((registro) => rowIdDoRegistro(registro))] }));
        continue;
      }
      const baseAtual = await tx.$queryRawUnsafe(`SELECT row_id, conciliacao_id FROM ${nomeTabelaSeguro(tabela)} WHERE row_id = $1 FOR UPDATE`, baseId) as Array<{ row_id: string; conciliacao_id: string | null }>;
      if (!baseAtual[0]) throw new Error(`Registro principal ${baseId} não foi encontrado durante a deduplicação.`);
      for (const removido of decisao.removidos) {
        const removidoId = rowIdDoRegistro(removido);
        const removidoAtual = await tx.$queryRawUnsafe(`SELECT row_id, conciliacao_id FROM ${nomeTabelaSeguro(tabela)} WHERE row_id = $1 FOR UPDATE`, removidoId) as Array<{ row_id: string; conciliacao_id: string | null }>;
        if (!removidoAtual[0]) continue;
        if (removidoAtual[0].conciliacao_id && removidoAtual[0].conciliacao_id !== baseAtual[0].conciliacao_id) throw new Error(`O registro ${removidoId} recebeu uma conciliação durante a deduplicação; nenhuma exclusão foi aplicada.`);
        await tx.$executeRawUnsafe(`DELETE FROM ${nomeTabelaSeguro(tabela)} WHERE row_id = $1`, removidoId);
        await tx.$executeRawUnsafe(`INSERT INTO "auditoria_duplicidades" (execucao_id, tabela, chave_duplicidade, registro_mantido_id, registro_removido_id, conciliacao_preservada_id, criterio_manutencao, status, detalhes) VALUES ($1,$2,$3,$4,$5,$6,$7,'REMOVIDO',$8::jsonb)`, execucaoId, tabela, decisao.chave, baseId, removidoId, baseAtual[0].conciliacao_id, decisao.motivo, stringifyJsonbSeguro({ manter, hash_linha: removido.hash_linha || null, importacao_id: removido.importacao_id || null }));
      }
      await tx.$executeRawUnsafe(`UPDATE ${nomeTabelaSeguro(tabela)} SET dados = dados - 'duplicidade_status' - 'duplicidade_grupo', data_atualizacao = NOW() WHERE row_id = $1`, baseId);
    }
  });
}

export async function removerDuplicidadesImportacao({ tabela = 'ambas', manter = 'mais_antigo' }: { tabela?: 'vendas_adquirentes' | 'vendas_interdata' | 'ambas'; manter?: 'mais_antigo' | 'mais_recente' } = {}) {
  const resultado = {
    sucesso: true,
    manter,
    atualizado_em: new Date().toISOString(),
    vendas_adquirentes: { removidos: 0, grupos: 0, grupos_conflito: 0 },
    vendas_interdata: { removidos: 0, grupos: 0, grupos_conflito: 0 },
  };

  if (tabela === 'ambas' || tabela === 'vendas_adquirentes') {
    const plano = await simularCorrecao('duplicidades', 200);
    const aplicado = await aplicarCorrecao(resumoPlano(plano));
    resultado.vendas_adquirentes = { removidos: aplicado.removidos || 0, grupos: aplicado.grupos, grupos_conflito: plano.bloqueados.length };
    Object.assign(resultado, { execucao_correcao: aplicado.execucao, limite_grupos: 200 });
  }

  if (tabela === 'ambas' || tabela === 'vendas_interdata') {
    const registros = await lerTabela<VendaInterdata[]>(vendasInterdataTabela, []);
    const limpeza = planejarRemocaoDuplicados(registros, chaveDuplicidadeInterdata, manter);
    await removerDuplicidadesPostgres('vendas_interdata', limpeza, manter);
    resultado.vendas_interdata = { removidos: limpeza.removidos, grupos: limpeza.grupos, grupos_conflito: limpeza.grupos_conflito };
  }

  return resultado;
}



export type ConciliacaoVenda = {
  id: string;
  venda_adquirente_id: string;
  venda_interdata_id: string;
  status: 'CONCILIADO' | 'SUGERIDO' | 'AMBIGUO' | 'DIVERGENTE' | 'DESFEITO';
  tipo_match: 'NSU' | 'AUTORIZACAO' | 'VALOR_DATA' | 'MANUAL' | 'MANUAL_RECEBIMENTO' | 'NSU_VALOR_DATA' | 'HORARIO_NORMALIZADO' | 'HORARIO_FORTE_UNICO' | 'VOUCHER_HORARIO_FORTE' | 'VOUCHER_UNICO_DATA_VALOR_PARCELAS' | 'CANDIDATO_UNICO_JANELA_8H' | 'NSU_NORMALIZADO' | 'MATCH_CONTEXTO_HORA';
  score: number;
  criterios_usados: string[];
  diferenca_valor: number;
  diferenca_dias: number;
  automatico: boolean;
  data_conciliacao: string;
  observacoes?: string;
  segundo_melhor_score?: number;
  diferenca_para_segundo?: number;
  quantidade_candidatos_equivalentes?: number;
  estrategia?: string;
  classificacao?: string;
  diferenca_horario_segundos?: number;
  ajuste_horario_minutos?: number;
  versao_motor?: string;
};

function valorCentavos(valor: unknown) {
  return Math.round(numeroMoeda(valor) * 100);
}

function limparIdentificadorMatch(valor: unknown) {
  return String(valor || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function dataVendaMs(valor: unknown) {
  const iso = chaveDataIsoVenda(String(valor || ''));
  if (!iso) return NaN;
  return Date.parse(`${iso}T00:00:00.000Z`);
}

function diferencaDiasVenda(a: unknown, b: unknown) {
  const ma = dataVendaMs(a);
  const mb = dataVendaMs(b);
  if (!Number.isFinite(ma) || !Number.isFinite(mb)) return 9999;
  return Math.round(Math.abs(ma - mb) / 86400000);
}

function statusConciliacaoVenda(registro: Record<string, unknown>) {
  return textoFiltro(registro.status_conciliacao || 'PENDENTE') || 'PENDENTE';
}

export function pontuarMatchConciliacao(adq: VendaAdquirente, erp: VendaInterdata) {
  const criterios: string[] = [];
  const estabelecimentoAdq = limparIdentificadorMatch(adq.codigo_estabelecimento || adq.cnpj_estabelecimento);
  const estabelecimentoErp = limparIdentificadorMatch((erp as any).cnpj_estabelecimento || (erp as any).codigo_estabelecimento);
  // Regra zero: sem estabelecimento em ambos os lados, ou com valores diferentes, o par nem chega à pontuação.
  if (!estabelecimentoAdq || !estabelecimentoErp || estabelecimentoAdq !== estabelecimentoErp) return null;
  criterios.push('Estabelecimento igual');
  const nsuAdq = limparIdentificadorMatch(adq.nsu);
  const nsuErp = limparIdentificadorMatch(erp.nsu);
  const autAdq = limparIdentificadorMatch(adq.codigo_autorizacao);
  const autErp = limparIdentificadorMatch((erp as any).codigo_autorizacao || (erp as any).autorizacao);
  const valorAdq = valorCentavos(adq.valor_bruto);
  const valorErp = valorCentavos(erp.valor_bruto);
  const diffValor = Math.abs(valorAdq - valorErp) / 100;
  const diffDias = diferencaDiasVenda(adq.data_venda, erp.data_venda);
  const terminalAdq = limparIdentificadorMatch(adq.terminal);
  const terminalErp = limparIdentificadorMatch(erp.terminal);
  const modalidadeAdq = textoFiltro(adq.modalidade);
  const modalidadeErp = textoFiltro((erp as any).tipo_produto || (erp as any).forma_pagamento);
  const bandeiraAdq = textoFiltro(adq.bandeira);
  const bandeiraErp = textoFiltro((erp as any).bandeira);
  const parcelasAdq = chaveParcelasDuplicidade(adq.parcelas);
  const parcelasErp = chaveParcelasDuplicidade(erp.parcelas);
  if (parcelasAdq && parcelasErp && parcelasAdq !== parcelasErp) return null;

  let score = 0;
  let tipo: ConciliacaoVenda['tipo_match'] | '' = '';
  let identificadoresConflitantes = false;

  if (nsuAdq && nsuErp && nsuAdq === nsuErp) {
    score = 70;
    tipo = 'NSU';
    criterios.push('NSU igual');
  } else if (autAdq && autErp && autAdq === autErp) {
    score = 65;
    tipo = 'AUTORIZACAO';
    criterios.push('Autorização igual');
  } else if (valorAdq > 0 && valorAdq === valorErp && diffDias <= 1) {
    score = 55;
    tipo = 'VALOR_DATA';
    criterios.push('Valor igual', diffDias === 0 ? 'Data igual' : 'Data próxima');
  }

  if (!tipo) return null;
  if (tipo === 'NSU' && autAdq && autErp && autAdq !== autErp) {
    identificadoresConflitantes = true;
    criterios.push('Autorização divergente');
    score -= 25;
  }
  if (tipo === 'AUTORIZACAO' && nsuAdq && nsuErp && nsuAdq !== nsuErp) {
    identificadoresConflitantes = true;
    criterios.push('NSU divergente');
    score -= 25;
  }
  if (valorAdq > 0 && valorAdq === valorErp) { score += 20; if (!criterios.includes('Valor igual')) criterios.push('Valor igual'); }
  else if (diffValor > 0 && diffValor <= 0.05) { score += 12; criterios.push('Valor com diferença pequena'); }
  else if (diffValor > 0.05) score -= 20;
  if (diffDias === 0) { score += 10; if (!criterios.includes('Data igual')) criterios.push('Data igual'); }
  else if (diffDias === 1) score += 5;
  else score -= 15;
  if (terminalAdq && terminalErp && terminalAdq === terminalErp) { score += 5; criterios.push('Terminal igual'); }
  if (modalidadeAdq && modalidadeErp && modalidadeAdq === modalidadeErp) { score += 5; criterios.push('Modalidade igual'); }
  else if (modalidadeAdq && modalidadeErp && modalidadeAdq !== modalidadeErp) { score -= 5; criterios.push('Modalidade divergente'); }
  if (bandeiraAdq && bandeiraErp && bandeiraAdq === bandeiraErp) { score += 3; criterios.push('Bandeira igual'); }
  else if (bandeiraAdq && bandeiraErp && bandeiraAdq !== bandeiraErp) { score -= 10; criterios.push('Bandeira divergente'); }
  if (parcelasAdq && parcelasErp) { score += 5; criterios.push('Parcelas iguais'); }
  score = Math.max(0, Math.min(100, score));
  const identificadorForte = tipo === 'NSU' || tipo === 'AUTORIZACAO';
  const elegivelAutomatico = identificadorForte && !identificadoresConflitantes && valorAdq > 0 && valorAdq === valorErp && diffDias <= 1;
  return { score, tipo, criterios, diferenca_valor: diffValor, diferenca_dias: diffDias, elegivelAutomatico };
}

export type FiltroStatusConciliacao = 'PENDENTE' | 'CONCILIADO' | 'SUGERIDO' | 'AMBIGUO' | 'TODOS';

export type FiltrosCentralConciliacao = {
  status?: FiltroStatusConciliacao;
  busca?: string;
  estabelecimento?: string;
  adquirente?: string;
  dataInicial?: string;
  dataFinal?: string;
  scoreMinimo?: number;
  scoreMaximo?: number;
  tipoMatch?: string;
};

export type AtorConciliacao = { id?: string; nome?: string; login?: string };

function classificacaoConfianca(score: unknown) {
  const valor = Number(score || 0);
  if (valor >= 90) return 'MUITO_ALTA';
  if (valor >= 75) return 'ALTA';
  if (valor >= 55) return 'MEDIA';
  return 'BAIXA';
}

async function registrarHistoricoConciliacao(
  conciliacaoId: string,
  acao: string,
  statusAnterior: string | null,
  statusNovo: string | null,
  motivo: string,
  ator: AtorConciliacao = {},
  detalhes: Record<string, unknown> = {},
) {
  await garantirDbPostgres();
  const db = await getDatabase();
  await db.$executeRawUnsafe(
    `INSERT INTO historico_conciliacoes (conciliacao_id, acao, status_anterior, status_novo, motivo, usuario_id, usuario_nome, detalhes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    conciliacaoId, acao, statusAnterior, statusNovo, motivo, ator.id || null, ator.nome || ator.login || null, stringifyJsonbSeguro(detalhes),
  );
}

function chaveOrdenacaoVendaDesc(venda?: { data_venda?: unknown; hora_venda?: unknown } | null) {
  const data = chaveDataIsoVenda(String(venda?.data_venda || ''));
  const hora = String(venda?.hora_venda || '').replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
  return `${data || '0000-00-00'}T${hora}`;
}

export async function listarConciliacoesComExibicao(
  limite = 500,
  offset = 0,
  status: FiltroStatusConciliacao = 'PENDENTE',
  filtros: FiltrosCentralConciliacao = {},
  incluirContadores = true,
) {
  if (usarPostgres()) {
    await garantirDbPostgres();
    const db = await getDatabase();
    const tamanhoPagina = Math.max(1, Math.min(Number(limite || 100), 500));
    const inicio = Math.max(0, Number(offset || 0));
    const params: unknown[] = [];
    const add = (valor: unknown) => { params.push(valor); return `$${params.length}`; };
    const busca = String(filtros.busca || '').trim();
    const estabelecimento = String(filtros.estabelecimento || '').trim().toUpperCase();
    const adquirente = String(filtros.adquirente || '').trim().toUpperCase();
    const tipo = String(filtros.tipoMatch || '').trim().toUpperCase();
    const comuns: string[] = [];
    if (busca) {
      const p = add(`%${busca}%`);
      comuns.push(`(
        COALESCE(e.dados->>'nsu','') ILIKE ${p}
        OR COALESCE(a.dados->>'nsu','') ILIKE ${p}
        OR COALESCE(e.dados->>'codigo_autorizacao',e.dados->>'autorizacao','') ILIKE ${p}
        OR COALESCE(a.dados->>'codigo_autorizacao','') ILIKE ${p}
        OR COALESCE(e.dados->>'terminal','') ILIKE ${p}
        OR COALESCE(a.dados->>'terminal','') ILIKE ${p}
        OR COALESCE(e.dados->>'valor_bruto','') ILIKE ${p}
        OR COALESCE(a.dados->>'valor_bruto','') ILIKE ${p}
        OR REPLACE(COALESCE(e.dados->>'valor_bruto',''),'.',',') ILIKE ${p}
        OR REPLACE(COALESCE(a.dados->>'valor_bruto',''),'.',',') ILIKE ${p}
      )`);
    }
    if (estabelecimento) comuns.push(`UPPER(TRIM(COALESCE(NULLIF(e.dados->>'cnpj_estabelecimento',''),e.dados->>'codigo_estabelecimento',''))) = ${add(estabelecimento)}`);
    if (adquirente && status !== 'PENDENTE') comuns.push(`UPPER(COALESCE(a.dados->>'adquirente','')) = ${add(adquirente)}`);
    if (filtros.dataInicial) comuns.push(`${sqlDataNormalizada('e')} >= ${add(filtros.dataInicial)}`);
    if (filtros.dataFinal) comuns.push(`${sqlDataNormalizada('e')} <= ${add(filtros.dataFinal)}`);
    if (status !== 'PENDENTE' && Number.isFinite(filtros.scoreMinimo)) comuns.push(`COALESCE((c.dados->>'score')::numeric,0) >= ${add(filtros.scoreMinimo)}`);
    if (status !== 'PENDENTE' && Number.isFinite(filtros.scoreMaximo)) comuns.push(`COALESCE((c.dados->>'score')::numeric,0) <= ${add(filtros.scoreMaximo)}`);
    if (status !== 'PENDENTE' && tipo) comuns.push(`UPPER(COALESCE(c.dados->>'tipo_match','')) = ${add(tipo)}`);
    const whereComum = comuns.length ? ` AND ${comuns.join(' AND ')}` : '';
    const parametrosPendente: unknown[] = [];
    const parametrosConciliacao: unknown[] = [];
    const addPendente = (valor: unknown) => { parametrosPendente.push(valor); return `$${parametrosPendente.length}`; };
    const addConciliacao = (valor: unknown) => { parametrosConciliacao.push(valor); return `$${parametrosConciliacao.length}`; };
    const escopoPendente: string[] = [];
    const escopoConciliacao: string[] = [];
    if (estabelecimento) {
      escopoPendente.push(`UPPER(TRIM(COALESCE(NULLIF(e.dados->>'cnpj_estabelecimento',''),e.dados->>'codigo_estabelecimento',''))) = ${addPendente(estabelecimento)}`);
      escopoConciliacao.push(`UPPER(TRIM(COALESCE(NULLIF(e.dados->>'cnpj_estabelecimento',''),e.dados->>'codigo_estabelecimento',''))) = ${addConciliacao(estabelecimento)}`);
    }
    if (filtros.dataInicial) {
      escopoPendente.push(`${sqlDataNormalizada('e')} >= ${addPendente(filtros.dataInicial)}`);
      escopoConciliacao.push(`${sqlDataNormalizada('e')} >= ${addConciliacao(filtros.dataInicial)}`);
    }
    if (filtros.dataFinal) {
      escopoPendente.push(`${sqlDataNormalizada('e')} <= ${addPendente(filtros.dataFinal)}`);
      escopoConciliacao.push(`${sqlDataNormalizada('e')} <= ${addConciliacao(filtros.dataFinal)}`);
    }
    if (adquirente) escopoConciliacao.push(`UPPER(COALESCE(a.dados->>'adquirente','')) = ${addConciliacao(adquirente)}`);
    const whereEscopoPendente = escopoPendente.length ? ` AND ${escopoPendente.join(' AND ')}` : '';
    const whereEscopoConciliacao = escopoConciliacao.length ? ` AND ${escopoConciliacao.join(' AND ')}` : '';
    let contadores: { pendente: number; conciliado: number; sugerido: number; ambiguo: number } | undefined;
    if (incluirContadores) {
      const [pendentesRows, conciliacoesRows] = await Promise.all([
        db.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS pendente FROM vendas_interdata e
           WHERE e.conciliacao_id IS NULL
             AND COALESCE(NULLIF(e.dados->>'status_conciliacao',''),'PENDENTE')='PENDENTE'
             AND NOT (${sqlRegistroNaoAplicavel('vendas_interdata','e')})
             AND NOT (${sqlEstabelecimentoLiteralNaoAplica('vendas_interdata','e')})${whereEscopoPendente}`,
          ...parametrosPendente,
        ) as Promise<Array<{ pendente: number }>>,
        db.$queryRawUnsafe(
          `SELECT
             COUNT(*) FILTER (WHERE c.status='CONCILIADO')::int AS conciliado,
             COUNT(*) FILTER (WHERE c.status='SUGERIDO')::int AS sugerido,
             COUNT(*) FILTER (WHERE c.status='AMBIGUO')::int AS ambiguo
           FROM conciliacoes c
           LEFT JOIN vendas_adquirentes a ON a.row_id=c.venda_adquirente_id
           LEFT JOIN vendas_interdata e ON e.row_id=c.venda_interdata_id
           WHERE c.status <> 'DESFEITO'
             AND NOT (${sqlRegistroNaoAplicavel('vendas_adquirentes','a')})
             AND NOT (${sqlRegistroNaoAplicavel('vendas_interdata','e')})
             AND NOT (${sqlEstabelecimentoLiteralNaoAplica('vendas_adquirentes','a')})
             AND NOT (${sqlEstabelecimentoLiteralNaoAplica('vendas_interdata','e')})${whereEscopoConciliacao}`,
          ...parametrosConciliacao,
        ) as Promise<Array<{ conciliado: number; sugerido: number; ambiguo: number }>>,
      ]);
      contadores = {
        pendente: Number(pendentesRows[0]?.pendente || 0),
        conciliado: Number(conciliacoesRows[0]?.conciliado || 0),
        sugerido: Number(conciliacoesRows[0]?.sugerido || 0),
        ambiguo: Number(conciliacoesRows[0]?.ambiguo || 0),
      };
    }
    if (status === 'PENDENTE') {
      const where = `e.conciliacao_id IS NULL AND COALESCE(NULLIF(e.dados->>'status_conciliacao',''),'PENDENTE')='PENDENTE' AND NOT (${sqlRegistroNaoAplicavel('vendas_interdata','e')}) AND NOT (${sqlEstabelecimentoLiteralNaoAplica('vendas_interdata','e')})${whereComum}`;
      const totalRows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM vendas_interdata e LEFT JOIN vendas_adquirentes a ON FALSE LEFT JOIN conciliacoes c ON FALSE WHERE ${where}`, ...params) as Array<{total:number}>;
      const rows = await db.$queryRawUnsafe(
        `SELECT e.row_id AS id, e.dados AS venda_interdata FROM vendas_interdata e LEFT JOIN vendas_adquirentes a ON FALSE LEFT JOIN conciliacoes c ON FALSE
         WHERE ${where} ORDER BY ${sqlDataNormalizada('e')} DESC, e.pk DESC LIMIT ${add(tamanhoPagina)} OFFSET ${add(inicio)}`,
        ...params,
      ) as Array<{id:string; venda_interdata:VendaInterdata}>;
      return { linhas: rows.map(r => ({ id:`PENDENTE:${r.id}`, venda_adquirente_id:'', venda_interdata_id:r.id, status:'PENDENTE', tipo_match:'', score:0, confianca:'BAIXA', criterios_usados:[], diferenca_valor:0, diferenca_dias:0, automatico:false, data_conciliacao:'', venda_adquirente:null, venda_interdata:aplicarBandeiraParaExibicao({...r.venda_interdata,id:r.id}) })), total_linhas:Number(totalRows[0]?.total||0), limite:tamanhoPagina, offset:inicio, status, contadores };
    }
    const statusSql = status === 'TODOS' ? `c.status <> 'DESFEITO'` : `c.status = ${add(status)}`;
    const from = `FROM conciliacoes c LEFT JOIN vendas_adquirentes a ON a.row_id=c.venda_adquirente_id LEFT JOIN vendas_interdata e ON e.row_id=c.venda_interdata_id WHERE ${statusSql} AND NOT (${sqlRegistroNaoAplicavel('vendas_adquirentes','a')}) AND NOT (${sqlRegistroNaoAplicavel('vendas_interdata','e')}) AND NOT (${sqlEstabelecimentoLiteralNaoAplica('vendas_adquirentes','a')}) AND NOT (${sqlEstabelecimentoLiteralNaoAplica('vendas_interdata','e')})${whereComum}`;
    const totalRows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS total ${from}`, ...params) as Array<{total:number}>;
    const rows = await db.$queryRawUnsafe(
      `SELECT c.row_id AS id, c.status, c.dados, a.dados AS venda_adquirente, e.dados AS venda_interdata ${from}
       ORDER BY ${sqlDataNormalizada('e')} DESC NULLS LAST, c.data_atualizacao DESC LIMIT ${add(tamanhoPagina)} OFFSET ${add(inicio)}`,
      ...params,
    ) as Array<{id:string;status:string;dados:Record<string,unknown>;venda_adquirente:VendaAdquirente|null;venda_interdata:VendaInterdata|null}>;
    return { linhas: rows.map(r => ({...r.dados,id:r.id,status:r.status,confianca:classificacaoConfianca(r.dados.score),venda_adquirente:r.venda_adquirente?aplicarBandeiraParaExibicao({...r.venda_adquirente,id:String((r.venda_adquirente as any).id||r.dados.venda_adquirente_id||'')}):null,venda_interdata:r.venda_interdata?aplicarBandeiraParaExibicao({...r.venda_interdata,id:String((r.venda_interdata as any).id||r.dados.venda_interdata_id||'')}):null})), total_linhas:Number(totalRows[0]?.total||0), limite:tamanhoPagina, offset:inicio, status, contadores };
  }
  const [conciliacoes, vendasAdq, vendasErp] = await Promise.all([
    lerTabela<ConciliacaoVenda[]>(conciliacoesTabela, []),
    lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []),
    lerTabela<VendaInterdata[]>(vendasInterdataTabela, []),
  ]);
  const mapaAdq = new Map(vendasAdq.map((venda) => [venda.id, venda]));
  const mapaErp = new Map(vendasErp.map((venda) => [venda.id, venda]));
  const inicio = Math.max(0, Number(offset || 0));
  const tamanhoPagina = Math.max(1, Number(limite || 500));
  if (status === 'PENDENTE') {
    const pendentes = vendasErp
      .filter((venda) => !String(venda.conciliacao_id || '').trim())
      .filter((venda) => !registroContemNaoAplica(venda as unknown as Record<string, unknown>))
      .sort((a, b) => {
        const porData = chaveOrdenacaoVendaDesc(b).localeCompare(chaveOrdenacaoVendaDesc(a));
        return porData || Number(b.numero_linha || 0) - Number(a.numero_linha || 0);
      });
    const linhas = pendentes
      .slice(inicio, inicio + tamanhoPagina)
      .map((venda) => ({
        id: `PENDENTE:${venda.id}`,
        venda_adquirente_id: '',
        venda_interdata_id: venda.id,
        status: 'PENDENTE',
        tipo_match: '',
        score: 0,
        criterios_usados: [],
        diferenca_valor: 0,
        diferenca_dias: 0,
        automatico: false,
        data_conciliacao: '',
        venda_adquirente: null,
        venda_interdata: aplicarBandeiraParaExibicao(venda as unknown as Record<string, unknown>),
      }));
    return { linhas, total_linhas: pendentes.length, limite: tamanhoPagina, offset: inicio, status };
  }
  const ativas = conciliacoes
    .filter((item) => item.status !== 'DESFEITO')
    .filter((item) => status === 'TODOS' || item.status === status)
    .map((item) => ({ ...item, venda_adquirente: mapaAdq.get(item.venda_adquirente_id) || null, venda_interdata: mapaErp.get(item.venda_interdata_id) || null }))
    .filter((item) => !item.venda_adquirente || !registroContemNaoAplica(item.venda_adquirente as unknown as Record<string, unknown>))
    .filter((item) => !item.venda_interdata || !registroContemNaoAplica(item.venda_interdata as unknown as Record<string, unknown>))
    .sort((a, b) => {
      const vendaA = a.venda_interdata || a.venda_adquirente;
      const vendaB = b.venda_interdata || b.venda_adquirente;
      const porVenda = chaveOrdenacaoVendaDesc(vendaB).localeCompare(chaveOrdenacaoVendaDesc(vendaA));
      return porVenda || String(b.data_conciliacao || '').localeCompare(String(a.data_conciliacao || ''));
    });
  const linhas = ativas
    .slice(inicio, inicio + tamanhoPagina)
    .map((item) => ({
      ...item,
      venda_adquirente: item.venda_adquirente ? aplicarBandeiraParaExibicao(item.venda_adquirente as unknown as Record<string, unknown>) : null,
      venda_interdata: item.venda_interdata ? aplicarBandeiraParaExibicao(item.venda_interdata as unknown as Record<string, unknown>) : null,
    }));
  return { linhas, total_linhas: ativas.length, limite: tamanhoPagina, offset: inicio, status };
}

function dadosVendaComConciliacao(conciliacao: ConciliacaoVenda, status: string) {
  return {
    conciliacao_id: status === 'PENDENTE' ? '' : conciliacao.id,
    status_conciliacao: status,
    score_conciliacao: status === 'PENDENTE' ? 0 : conciliacao.score,
    tipo_match: status === 'PENDENTE' ? '' : conciliacao.tipo_match,
  };
}

async function criarConciliacoesPostgres(candidatos: ConciliacaoVenda[]) {
  if (candidatos.length === 0) return;
  await garantirDbPostgres();
  const db = await getDatabase();
  await db.$transaction(async (tx) => {
    for (const conciliacaoOriginal of candidatos) {
      const existentes = await tx.$queryRawUnsafe(
        `SELECT row_id, status, dados FROM conciliacoes
         WHERE venda_adquirente_id=$1 AND venda_interdata_id=$2
           AND status IN ('AMBIGUO','SUGERIDO')
         ORDER BY CASE status WHEN 'AMBIGUO' THEN 0 ELSE 1 END, data_atualizacao DESC
         LIMIT 1 FOR UPDATE`,
        conciliacaoOriginal.venda_adquirente_id, conciliacaoOriginal.venda_interdata_id,
      ) as Array<{row_id:string;status:string;dados:Record<string,unknown>}>;
      const existente = existentes[0];
      const conciliacao: ConciliacaoVenda = existente
        ? { ...conciliacaoOriginal, id: existente.row_id }
        : conciliacaoOriginal;

      const adq = await tx.$queryRawUnsafe(`SELECT row_id, conciliacao_id FROM "vendas_adquirentes" WHERE row_id = $1 FOR UPDATE`, conciliacao.venda_adquirente_id) as Array<{ row_id: string; conciliacao_id: string | null }>;
      const erp = await tx.$queryRawUnsafe(`SELECT row_id, conciliacao_id FROM "vendas_interdata" WHERE row_id = $1 FOR UPDATE`, conciliacao.venda_interdata_id) as Array<{ row_id: string; conciliacao_id: string | null }>;
      if (!adq[0] || !erp[0]) throw new Error(`Venda não encontrada ao persistir a conciliação ${conciliacao.id}.`);
      if ((adq[0].conciliacao_id && adq[0].conciliacao_id !== conciliacao.id) || (erp[0].conciliacao_id && erp[0].conciliacao_id !== conciliacao.id)) {
        continue; // Outro candidato de maior prioridade venceu durante esta execução.
      }

      if (existente) {
        await tx.$executeRawUnsafe(
          `UPDATE conciliacoes SET status=$1, dados=$2::jsonb, data_atualizacao=NOW() WHERE row_id=$3`,
          conciliacao.status, stringifyJsonbSeguro(conciliacao as unknown as Record<string, unknown>), conciliacao.id,
        );
      } else {
        await tx.$executeRawUnsafe(
          `INSERT INTO "conciliacoes" (row_id, dados, venda_adquirente_id, venda_interdata_id, status, data_criacao, data_atualizacao) VALUES ($1, $2::jsonb, $3, $4, $5, NOW(), NOW())`,
          conciliacao.id, stringifyJsonbSeguro(conciliacao as unknown as Record<string, unknown>), conciliacao.venda_adquirente_id, conciliacao.venda_interdata_id, conciliacao.status,
        );
      }
      const dadosVenda = stringifyJsonbSeguro(dadosVendaComConciliacao(conciliacao, conciliacao.status));
      await tx.$executeRawUnsafe(`UPDATE "vendas_adquirentes" SET conciliacao_id = $1, dados = dados || $2::jsonb, data_atualizacao = NOW() WHERE row_id = $3`, conciliacao.id, dadosVenda, conciliacao.venda_adquirente_id);
      await tx.$executeRawUnsafe(`UPDATE "vendas_interdata" SET conciliacao_id = $1, dados = dados || $2::jsonb, data_atualizacao = NOW() WHERE row_id = $3`, conciliacao.id, dadosVenda, conciliacao.venda_interdata_id);

      if (conciliacao.status === 'CONCILIADO') {
        await tx.$executeRawUnsafe(
          `UPDATE conciliacoes SET status='DESFEITO',
             dados=jsonb_set(jsonb_set(dados,'{status}','"DESFEITO"'::jsonb),'{observacoes}',to_jsonb($1::text)),
             data_atualizacao=NOW()
           WHERE row_id<>$2 AND status IN ('AMBIGUO','SUGERIDO')
             AND (venda_adquirente_id=$3 OR venda_interdata_id=$4)`,
          `Alternativa encerrada automaticamente: ${conciliacao.id} venceu a disputa por prioridade de confiança.`,
          conciliacao.id, conciliacao.venda_adquirente_id, conciliacao.venda_interdata_id,
        );
        if (existente?.status === 'AMBIGUO') {
          await tx.$executeRawUnsafe(
            `INSERT INTO historico_conciliacoes (conciliacao_id,acao,status_anterior,status_novo,motivo,usuario_nome,detalhes)
             VALUES ($1,'AUTO_RESOLVER_AMBIGUIDADE','AMBIGUO','CONCILIADO',$2,'Sistema',$3::jsonb)`,
            conciliacao.id,
            `Ambiguidade resolvida automaticamente por prioridade global; score ${conciliacao.score}.`,
            stringifyJsonbSeguro({score:conciliacao.score,tipo_match:conciliacao.tipo_match,criterios:conciliacao.criterios_usados}),
          );
        }
      }
    }
  });
}

async function criarAmbiguidadesPostgres(candidatos: ConciliacaoVenda[]) {
  if (!candidatos.length) return { criadas: 0, atualizadas: 0, ignoradas_conciliadas: 0 };
  await garantirDbPostgres();
  const db = await getDatabase();
  let criados = 0;
  let atualizados = 0;
  let ignoradosConciliados = 0;
  await db.$transaction(async tx => {
    for (const conciliacao of candidatos) {
      const existentes = await tx.$queryRawUnsafe(
        `SELECT row_id,status FROM conciliacoes WHERE venda_adquirente_id=$1 AND venda_interdata_id=$2 AND status IN ('AMBIGUO','SUGERIDO','CONCILIADO') ORDER BY data_atualizacao DESC LIMIT 1 FOR UPDATE`,
        conciliacao.venda_adquirente_id, conciliacao.venda_interdata_id,
      ) as Array<{row_id:string;status:string}>;
      const existente = existentes[0];
      if (existente?.status === 'CONCILIADO') { ignoradosConciliados += 1; continue; }
      if (existente) {
        const atualizada = { ...conciliacao, id:existente.row_id, status:'AMBIGUO' as const };
        await tx.$executeRawUnsafe(
          `UPDATE conciliacoes SET status='AMBIGUO', dados=$1::jsonb, data_atualizacao=NOW() WHERE row_id=$2`,
          stringifyJsonbSeguro(atualizada as unknown as Record<string,unknown>), existente.row_id,
        );
        atualizados += 1;
        continue;
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO conciliacoes (row_id,dados,venda_adquirente_id,venda_interdata_id,status,data_criacao,data_atualizacao) VALUES ($1,$2::jsonb,$3,$4,'AMBIGUO',NOW(),NOW())`,
        conciliacao.id, stringifyJsonbSeguro(conciliacao as unknown as Record<string,unknown>), conciliacao.venda_adquirente_id, conciliacao.venda_interdata_id,
      );
      criados++;
    }
  });
  return { criadas: criados, atualizadas: atualizados, ignoradas_conciliadas: ignoradosConciliados };
}

async function liberarAmbiguidadesParaReavaliacaoPostgres(escopo: { dataInicial?: string; dataFinal?: string } = {}) {
  await garantirDbPostgres();
  const db = await getDatabase();
  const pendente = stringifyJsonbSeguro({ conciliacao_id:'', status_conciliacao:'PENDENTE', score_conciliacao:0, tipo_match:'' });
  return db.$transaction(async (tx) => {
    const adq = await tx.$executeRawUnsafe(
      `UPDATE vendas_adquirentes a
          SET conciliacao_id=NULL, dados=a.dados || $1::jsonb, data_atualizacao=NOW()
        WHERE a.conciliacao_id IS NOT NULL
          AND ($2::text = '' OR ${sqlDataNormalizada('a')} >= $2)
          AND ($3::text = '' OR ${sqlDataNormalizada('a')} <= $3)
          AND EXISTS (SELECT 1 FROM conciliacoes c WHERE c.row_id=a.conciliacao_id AND c.status='AMBIGUO')`,
      pendente, escopo.dataInicial || '', escopo.dataFinal || '',
    );
    const erp = await tx.$executeRawUnsafe(
      `UPDATE vendas_interdata e
          SET conciliacao_id=NULL, dados=e.dados || $1::jsonb, data_atualizacao=NOW()
        WHERE e.conciliacao_id IS NOT NULL
          AND ($2::text = '' OR ${sqlDataNormalizada('e')} >= $2)
          AND ($3::text = '' OR ${sqlDataNormalizada('e')} <= $3)
          AND EXISTS (SELECT 1 FROM conciliacoes c WHERE c.row_id=e.conciliacao_id AND c.status='AMBIGUO')`,
      pendente, escopo.dataInicial || '', escopo.dataFinal || '',
    );
    return { vendas_adquirentes_liberadas:Number(adq || 0), vendas_interdata_liberadas:Number(erp || 0) };
  });
}

async function sanearAmbiguidadesPostgres(paresAtuais: ParAvaliado[], erpIdsAvaliados: string[]) {
  await garantirDbPostgres();
  const db = await getDatabase();
  const chavesValidas = new Set(paresAtuais.map((par) => `${par.erp.id}::${par.adq.id}`));
  const erpsAvaliados = new Set(erpIdsAvaliados);
  let desfeitas = 0;
  let invalidasRegraAtual = 0;
  let vinculoConsumido = 0;

  await db.$transaction(async (tx) => {
    const antigas = await tx.$queryRawUnsafe(
      `SELECT c.row_id, c.venda_adquirente_id, c.venda_interdata_id, c.dados,
              a.conciliacao_id AS adq_conciliacao_id, e.conciliacao_id AS erp_conciliacao_id
         FROM conciliacoes c
         LEFT JOIN vendas_adquirentes a ON a.row_id=c.venda_adquirente_id
         LEFT JOIN vendas_interdata e ON e.row_id=c.venda_interdata_id
        WHERE c.status='AMBIGUO'
          AND (c.venda_interdata_id = ANY($1::text[])
               OR (a.conciliacao_id IS NOT NULL AND a.conciliacao_id<>c.row_id)
               OR (e.conciliacao_id IS NOT NULL AND e.conciliacao_id<>c.row_id))
        FOR UPDATE OF c`,
      erpIdsAvaliados,
    ) as Array<{
      row_id:string; venda_adquirente_id:string; venda_interdata_id:string; dados:Record<string,unknown>;
      adq_conciliacao_id:string|null; erp_conciliacao_id:string|null;
    }>;

    for (const antiga of antigas) {
      const consumido = Boolean(
        (antiga.adq_conciliacao_id && antiga.adq_conciliacao_id !== antiga.row_id) ||
        (antiga.erp_conciliacao_id && antiga.erp_conciliacao_id !== antiga.row_id)
      );
      const chave = `${antiga.venda_interdata_id}::${antiga.venda_adquirente_id}`;
      const invalidaPelaRegraAtual = erpsAvaliados.has(antiga.venda_interdata_id) && !chavesValidas.has(chave);
      if (!consumido && !invalidaPelaRegraAtual) continue;

      const motivo = consumido
        ? 'Ambiguidade histórica encerrada automaticamente porque o ERP ou a venda da adquirente já foi consumido por um match vencedor.'
        : 'Ambiguidade histórica encerrada automaticamente porque este par não é mais candidato válido segundo as regras atuais do motor (valor/data/modalidade/parcelas/NSU/janela máxima de 8h).';
      const dadosAtualizados = { ...(antiga.dados || {}), status:'DESFEITO', observacoes:motivo, saneada_automaticamente:true, versao_saneamento:'v0.1.138' };
      await tx.$executeRawUnsafe(
        `UPDATE conciliacoes SET status='DESFEITO', dados=$1::jsonb, data_atualizacao=NOW() WHERE row_id=$2`,
        stringifyJsonbSeguro(dadosAtualizados), antiga.row_id,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO historico_conciliacoes (conciliacao_id,acao,status_anterior,status_novo,motivo,usuario_nome,detalhes)
         VALUES ($1,'AUTO_SANEAR_AMBIGUIDADE','AMBIGUO','DESFEITO',$2,'Sistema',$3::jsonb)`,
        antiga.row_id, motivo,
        stringifyJsonbSeguro({ consumido, invalida_regra_atual: invalidaPelaRegraAtual, versao_motor:'2.9-v0.1.226' }),
      );
      desfeitas++;
      if (consumido) vinculoConsumido++;
      else invalidasRegraAtual++;
    }
  });

  return { desfeitas, invalidas_regra_atual: invalidasRegraAtual, vinculo_consumido: vinculoConsumido };
}

async function alterarConciliacaoPostgres(conciliacao: ConciliacaoVenda, desfazer: boolean) {
  await garantirDbPostgres();
  const db = await getDatabase();
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe(`SELECT row_id FROM "conciliacoes" WHERE row_id = $1 FOR UPDATE`, conciliacao.id) as Array<{ row_id: string }>;
    if (!rows[0]) throw new Error('Conciliação não encontrada.');
    const adq = await tx.$queryRawUnsafe(`SELECT conciliacao_id, dados, ${sqlRegistroNaoAplicavel('vendas_adquirentes','a')} AS nao_aplica FROM "vendas_adquirentes" a WHERE row_id = $1 FOR UPDATE`, conciliacao.venda_adquirente_id) as Array<{ conciliacao_id: string | null; dados: Record<string, unknown>; nao_aplica: boolean }>;
    const erp = await tx.$queryRawUnsafe(`SELECT conciliacao_id, dados, ${sqlRegistroNaoAplicavel('vendas_interdata','e')} AS nao_aplica FROM "vendas_interdata" e WHERE row_id = $1 FOR UPDATE`, conciliacao.venda_interdata_id) as Array<{ conciliacao_id: string | null; dados: Record<string, unknown>; nao_aplica: boolean }>;
    if (!adq[0] || !erp[0]) throw new Error('Uma das vendas vinculadas à conciliação não existe mais.');
    if (!desfazer) {
      if (adq[0].nao_aplica || erp[0].nao_aplica) throw new Error('Conciliação bloqueada: o estabelecimento está marcado como NÃO APLICA.');
      const codigoAdq = limparIdentificadorMatch(adq[0].dados.codigo_estabelecimento || adq[0].dados.cnpj_estabelecimento);
      const codigoErp = limparIdentificadorMatch(erp[0].dados.cnpj_estabelecimento || erp[0].dados.codigo_estabelecimento);
      if (!codigoAdq || !codigoErp || codigoAdq !== codigoErp) throw new Error('Conciliação bloqueada: os códigos de estabelecimento devem existir e ser idênticos.');
    }
    if (!desfazer && ((adq[0].conciliacao_id && adq[0].conciliacao_id !== conciliacao.id) || (erp[0].conciliacao_id && erp[0].conciliacao_id !== conciliacao.id))) {
      throw new Error('Uma das vendas já pertence a outra conciliação.');
    }
    await tx.$executeRawUnsafe(`UPDATE "conciliacoes" SET status = $1, dados = $2::jsonb, data_atualizacao = NOW() WHERE row_id = $3`, conciliacao.status, stringifyJsonbSeguro(conciliacao as unknown as Record<string, unknown>), conciliacao.id);
    const statusVenda = desfazer ? 'PENDENTE' : 'CONCILIADO';
    const recebimentoManual = conciliacao.tipo_match === 'MANUAL_RECEBIMENTO';
    const dadosAdq = stringifyJsonbSeguro(dadosVendaComConciliacao(conciliacao, statusVenda));
    const statusErp = desfazer && recebimentoManual ? 'DESFEITO' : statusVenda;
    const dadosErp = stringifyJsonbSeguro(dadosVendaComConciliacao(conciliacao, statusErp));
    await tx.$executeRawUnsafe(`UPDATE "vendas_adquirentes" SET conciliacao_id = $1, dados = dados || $2::jsonb, data_atualizacao = NOW() WHERE row_id = $3 AND (conciliacao_id = $4 OR conciliacao_id IS NULL)`, desfazer ? null : conciliacao.id, dadosAdq, conciliacao.venda_adquirente_id, conciliacao.id);
    await tx.$executeRawUnsafe(`UPDATE "vendas_interdata" SET conciliacao_id = $1, dados = dados || $2::jsonb, data_atualizacao = NOW() WHERE row_id = $3 AND (conciliacao_id = $4 OR conciliacao_id IS NULL)`, desfazer && !recebimentoManual ? null : conciliacao.id, dadosErp, conciliacao.venda_interdata_id, conciliacao.id);
    if (!desfazer) {
      await tx.$executeRawUnsafe(
        `UPDATE conciliacoes SET status='DESFEITO', dados=jsonb_set(jsonb_set(dados,'{status}','"DESFEITO"'::jsonb),'{observacoes}',to_jsonb($1::text)), data_atualizacao=NOW()
         WHERE row_id<>$2 AND status IN ('AMBIGUO','SUGERIDO') AND (venda_adquirente_id=$3 OR venda_interdata_id=$4)`,
        `Alternativa encerrada automaticamente após confirmação de ${conciliacao.id}.`, conciliacao.id, conciliacao.venda_adquirente_id, conciliacao.venda_interdata_id,
      );
    }
  });
}

type OpcoesConciliacaoHibrida = {
  confirmarAutomatico?: boolean;
  incluirProvaveis?: boolean;
  simular?: boolean;
  tamanhoLote?: number;
  dataInicial?: string;
  dataFinal?: string;
  adquirentes?: string[];
};

type ParAvaliado = { adq: VendaCandidata; erp: VendaCandidata; avaliacao: NonNullable<ReturnType<typeof avaliarCandidatoHibrido>> };

const sqlDataNormalizada = (alias: string) => `${alias}.data_venda_filtro`;
const sqlValorCentavos = (alias: string) => `ROUND(CASE WHEN REPLACE(COALESCE(${alias}.dados->>'valor_bruto',''), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN REPLACE(${alias}.dados->>'valor_bruto', ',', '.')::numeric ELSE 0 END * 100)`;

async function executarConciliacaoHibridaPostgres(opcoes: OpcoesConciliacaoHibrida) {
  await garantirDbPostgres();
  const db = await getDatabase();
  const inicio = Date.now();
  const tamanhoLote = Math.max(100, Math.min(Number(opcoes.tamanhoLote || 500), 2000));
  const ambiguidadesLiberadas = opcoes.simular
    ? { vendas_adquirentes_liberadas:0, vendas_interdata_liberadas:0 }
    : await liberarAmbiguidadesParaReavaliacaoPostgres({ dataInicial: opcoes.dataInicial, dataFinal: opcoes.dataFinal });
  const filtros: string[] = [`e.conciliacao_id IS NULL`, `COALESCE(NULLIF(e.dados->>'status_conciliacao',''),'PENDENTE') = 'PENDENTE'`, `UPPER(COALESCE(e.dados->>'duplicidade_status','')) <> 'DUPLICADO_PROVAVEL'`, `NOT (${sqlRegistroNaoAplicavel('vendas_interdata','e')})`];
  const parametros: unknown[] = [];
  if (opcoes.dataInicial) { parametros.push(opcoes.dataInicial); filtros.push(`${sqlDataNormalizada('e')} >= $${parametros.length}`); }
  if (opcoes.dataFinal) { parametros.push(opcoes.dataFinal); filtros.push(`${sqlDataNormalizada('e')} <= $${parametros.length}`); }
  let ultimoPk = 0;
  const pares: ParAvaliado[] = [];
  const erpIdsAvaliados: string[] = [];
  let erpsAvaliados = 0;

  while (true) {
    const paramsLote = [...parametros, ultimoPk, tamanhoLote];
    const lote = await db.$queryRawUnsafe(
      `SELECT e.pk::bigint::text AS pk, e.row_id AS id, e.dados FROM "vendas_interdata" e
       WHERE ${filtros.join(' AND ')} AND e.pk > $${parametros.length + 1}
       ORDER BY CASE WHEN NULLIF(e.dados->>'parcelas','') IS NULL THEN 1 ELSE 0 END,
                CASE WHEN e.dados->>'parcelas' ~ '\\d+$' THEN (regexp_match(e.dados->>'parcelas','(\\d+)$'))[1]::int ELSE 0 END DESC,
                e.pk ASC LIMIT $${parametros.length + 2}`,
      ...paramsLote,
    ) as Array<{ pk: string; id: string; dados: Record<string, unknown> }>;
    if (lote.length === 0) break;
    erpsAvaliados += lote.length;
    ultimoPk = Number(lote[lote.length - 1].pk);
    const ids = lote.map((item) => item.id);
    erpIdsAvaliados.push(...ids);
    const adquirentes = (opcoes.adquirentes || []).map((item) => String(item).toUpperCase());
    const candidatos = await db.$queryRawUnsafe(
      `SELECT a.row_id AS adq_id, a.dados AS adq_dados, e.row_id AS erp_id, e.dados AS erp_dados
       FROM "vendas_interdata" e
       JOIN "vendas_adquirentes" a
        ON a.conciliacao_id IS NULL
        AND NOT (${sqlRegistroNaoAplicavel('vendas_adquirentes','a')})
        AND UPPER(COALESCE(a.dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'
        AND LOWER(COALESCE(a.dados->>'suprimido_por_vinculo_voucher','false')) <> 'true'
        AND COALESCE(NULLIF(a.dados->>'status_conciliacao',''),'PENDENTE') = 'PENDENTE'
        AND UPPER(COALESCE(a.dados->>'duplicidade_status','')) <> 'DUPLICADO_PROVAVEL'
        AND UPPER(COALESCE(a.dados->>'pix_redundante','NAO')) <> 'SIM'
        AND UPPER(TRIM(COALESCE(a.dados->>'status_transacao',''))) = 'AUTORIZADO'
        AND ${sqlDataNormalizada('a')} <> '' AND ${sqlDataNormalizada('e')} <> ''
        AND ABS((${sqlDataNormalizada('a')})::date - (${sqlDataNormalizada('e')})::date) <= 1
        AND ${sqlValorCentavos('a')} = ${sqlValorCentavos('e')}
        AND ${sqlCodigoEstabelecimento('vendas_adquirentes','a')} <> ''
        AND ${sqlCodigoEstabelecimento('vendas_interdata','e')} <> ''
        AND ${sqlCodigoEstabelecimento('vendas_adquirentes','a')} = ${sqlCodigoEstabelecimento('vendas_interdata','e')}
       WHERE e.row_id = ANY($1::text[])
         AND ($2::text[] = '{}'::text[] OR EXISTS (
           SELECT 1 FROM UNNEST($2::text[]) AS filtro(nome)
           WHERE UPPER(COALESCE(a.dados->>'adquirente','')) LIKE '%' || filtro.nome || '%'
         ))`,
      ids, adquirentes,
    ) as Array<{ adq_id: string; adq_dados: Record<string, unknown>; erp_id: string; erp_dados: Record<string, unknown> }>;
    for (const linha of candidatos) {
      const adq = { ...linha.adq_dados, id: linha.adq_id } as VendaCandidata;
      const erp = { ...linha.erp_dados, id: linha.erp_id } as VendaCandidata;
      const avaliacao = avaliarCandidatoHibrido(adq, erp);
      if (avaliacao) pares.push({ adq, erp, avaliacao });
    }
  }

  const prioridadeClassificacao = (par: ParAvaliado) => {
    if (par.avaliacao.classificacao === 'MATCH_EXATO_NSU') return 8;
    if (par.avaliacao.classificacao === 'RECUPERACAO_NSU_NORMALIZADO') return 3;
    if (par.avaliacao.classificacao === 'RECUPERACAO_CONTEXTO_HORA') return 2;
    if (par.avaliacao.classificacao === 'MATCH_EXATO_HORARIO') return 5;
    if (par.avaliacao.classificacao === 'MATCH_HORARIO_FORTE_DIVERGENTE') return 4;
    if (par.avaliacao.classificacao === 'VOUCHER_HORARIO_FORTE') return 4;
    if (par.avaliacao.classificacao === 'CANDIDATO_UNICO_JANELA_8H') return 3;
    if (par.avaliacao.classificacao === 'VOUCHER_UNICO_DATA_VALOR_PARCELAS') return 2;
    return 1;
  };
  const prioridadeEstrategia = (par: ParAvaliado) => {
    if (par.avaliacao.estrategia === 'NSU_VALOR_DATA') return 6;
    if (par.avaliacao.estrategia === 'RECUPERACAO_NSU_NORMALIZADO') return 2;
    if (par.avaliacao.estrategia === 'RECUPERACAO_CONTEXTO_HORA') return 1;
    if (par.avaliacao.estrategia === 'VALOR_DATA_MODALIDADE_HORARIO') return 3;
    if (par.avaliacao.estrategia === 'HORARIO_FORTE_DADOS_DIVERGENTES') return 2;
    if (par.avaliacao.estrategia === 'VOUCHER_DATA_VALOR_PARCELAS') return 1;
    return 0;
  };
  const compararPrioridade = (a: ParAvaliado, b: ParAvaliado) =>
    b.avaliacao.score - a.avaliacao.score ||
    prioridadeEstrategia(b) - prioridadeEstrategia(a) ||
    prioridadeClassificacao(b) - prioridadeClassificacao(a) ||
    a.avaliacao.diferenca_segundos - b.avaliacao.diferenca_segundos ||
    String(a.erp.id).localeCompare(String(b.erp.id)) ||
    String(a.adq.id).localeCompare(String(b.adq.id));
  const mesmaPrioridadeTecnica = (a: ParAvaliado, b: ParAvaliado) =>
    a.avaliacao.score === b.avaliacao.score &&
    prioridadeEstrategia(a) === prioridadeEstrategia(b) &&
    prioridadeClassificacao(a) === prioridadeClassificacao(b) &&
    a.avaliacao.diferenca_segundos === b.avaliacao.diferenca_segundos;

  // v0.1.133: resolve globalmente os candidatos do maior para o menor score e saneia ambiguidades históricas inválidas.
  // Um vínculo consumido nunca pode ser reutilizado. Empates técnicos reais continuam AMBIGUO.
  const usadosErp = new Set<string>();
  const usadosAdq = new Set<string>();
  const selecionadosAutomaticos: ParAvaliado[] = [];
  const ordenados = [...pares].sort(compararPrioridade);

  for (const par of ordenados) {
    if (opcoes.confirmarAutomatico === false || par.avaliacao.score < 80) continue;
    if (usadosErp.has(par.erp.id) || usadosAdq.has(par.adq.id)) continue;

    const disponiveis = ordenados.filter((outro) => !usadosErp.has(outro.erp.id) && !usadosAdq.has(outro.adq.id));
    const concorrentesDisponiveis = disponiveis.filter((outro) =>
      outro !== par && (outro.erp.id === par.erp.id || outro.adq.id === par.adq.id),
    );
    // Como a lista está ordenada, um concorrente tecnicamente superior impede este candidato.
    const superior = concorrentesDisponiveis.some((outro) => compararPrioridade(outro, par) < 0 && !mesmaPrioridadeTecnica(outro, par));
    if (superior) continue;
    // Empate técnico exato: não decidir de forma arbitrária.
    const empateReal = concorrentesDisponiveis.some((outro) => mesmaPrioridadeTecnica(outro, par));
    if (empateReal) continue;

    const exigeUnicidade1x1 = ['VOUCHER_UNICO_DATA_VALOR_PARCELAS', 'RECUPERACAO_NSU_NORMALIZADO', 'RECUPERACAO_CONTEXTO_HORA'].includes(par.avaliacao.classificacao);
    if (exigeUnicidade1x1) {
      const qtdMesmoErp = disponiveis.filter((outro) => outro.erp.id === par.erp.id).length;
      const qtdMesmaAdq = disponiveis.filter((outro) => outro.adq.id === par.adq.id).length;
      if (qtdMesmoErp !== 1 || qtdMesmaAdq !== 1) continue;
    }

    const exigeMelhorMutuo = ['MATCH_HORARIO_FORTE_DIVERGENTE', 'VOUCHER_HORARIO_FORTE'].includes(par.avaliacao.classificacao);
    if (exigeMelhorMutuo) {
      const candidatosMesmoErp = disponiveis.filter((outro) => outro.erp.id === par.erp.id).sort(compararPrioridade);
      const candidatosMesmaAdq = disponiveis.filter((outro) => outro.adq.id === par.adq.id).sort(compararPrioridade);
      const melhorDoErp = candidatosMesmoErp[0];
      const melhorDaAdq = candidatosMesmaAdq[0];
      const ehMelhorMutuo = melhorDoErp === par && melhorDaAdq === par;
      const empateNoErp = candidatosMesmoErp.slice(1).some((outro) => mesmaPrioridadeTecnica(outro, par));
      const empateNaAdq = candidatosMesmaAdq.slice(1).some((outro) => mesmaPrioridadeTecnica(outro, par));
      if (!ehMelhorMutuo || empateNoErp || empateNaAdq) continue;
    }

    selecionadosAutomaticos.push(par);
    usadosErp.add(par.erp.id);
    usadosAdq.add(par.adq.id);
  }

  const restantes = pares.filter((par) => !usadosErp.has(par.erp.id) && !usadosAdq.has(par.adq.id));
  const porErpRestante = new Map<string, ParAvaliado[]>();
  const porAdqRestante = new Map<string, ParAvaliado[]>();
  for (const par of restantes) {
    porErpRestante.set(par.erp.id, [...(porErpRestante.get(par.erp.id) || []), par]);
    porAdqRestante.set(par.adq.id, [...(porAdqRestante.get(par.adq.id) || []), par]);
  }

  const unicosRestantes: ParAvaliado[] = [];
  const paresAmbiguos: ParAvaliado[] = [];
  for (const par of restantes) {
    if ((porErpRestante.get(par.erp.id)?.length || 0) === 1 && (porAdqRestante.get(par.adq.id)?.length || 0) === 1) unicosRestantes.push(par);
    else paresAmbiguos.push(par);
  }

  const agora = new Date().toISOString();
  const construirConciliacao = (par: ParAvaliado, indice: number, automatico: boolean): ConciliacaoVenda => {
    const janela8h = par.avaliacao.classificacao === 'CANDIDATO_UNICO_JANELA_8H';
    const criterios = automatico
      ? [...par.avaliacao.criterios, 'Vencedor por prioridade global de confiança (score decrescente)']
      : janela8h ? [...par.avaliacao.criterios, 'Candidato exclusivo nos dois sentidos'] : par.avaliacao.criterios;
    return {
      id: `CONC-H3-${Date.now()}-${indice + 1}-${Math.random().toString(36).slice(2, 8)}`,
      venda_adquirente_id: par.adq.id,
      venda_interdata_id: par.erp.id,
      status: automatico ? 'CONCILIADO' : 'SUGERIDO',
      tipo_match: par.avaliacao.estrategia === 'NSU_VALOR_DATA'
        ? 'NSU_VALOR_DATA'
        : par.avaliacao.classificacao === 'RECUPERACAO_NSU_NORMALIZADO' ? 'NSU_NORMALIZADO'
        : par.avaliacao.classificacao === 'RECUPERACAO_CONTEXTO_HORA' ? 'MATCH_CONTEXTO_HORA'
        : par.avaliacao.classificacao === 'MATCH_HORARIO_FORTE_DIVERGENTE' ? 'HORARIO_FORTE_UNICO'
        : par.avaliacao.classificacao === 'VOUCHER_HORARIO_FORTE' ? 'VOUCHER_HORARIO_FORTE'
        : par.avaliacao.classificacao === 'VOUCHER_UNICO_DATA_VALOR_PARCELAS' ? 'VOUCHER_UNICO_DATA_VALOR_PARCELAS'
        : janela8h ? 'CANDIDATO_UNICO_JANELA_8H' : 'HORARIO_NORMALIZADO',
      score: par.avaliacao.score,
      criterios_usados: criterios,
      diferenca_valor: 0,
      diferenca_dias: 0,
      automatico,
      data_conciliacao: agora,
      estrategia: par.avaliacao.estrategia,
      classificacao: par.avaliacao.classificacao,
      diferenca_horario_segundos: par.avaliacao.diferenca_segundos,
      ajuste_horario_minutos: par.avaliacao.ajuste_horario_minutos,
      versao_motor: '2.9-v0.1.226',
      observacoes: automatico
        ? `Conciliado automaticamente por prioridade global; score ${par.avaliacao.score} (mínimo 80).`
        : 'Candidato único abaixo do piso automático; preservado para revisão.',
    };
  };

  const candidatosAutomaticos = selecionadosAutomaticos.map((par, indice) => construirConciliacao(par, indice, true));
  const candidatosSugeridos = unicosRestantes.map((par, indice) => construirConciliacao(par, candidatosAutomaticos.length + indice, false));
  const candidatos = [...candidatosAutomaticos, ...candidatosSugeridos];

  const candidatosAmbiguos: ConciliacaoVenda[] = paresAmbiguos.map((par, indice) => {
    const concorrentes = restantes
      .filter((outro) => outro !== par && (outro.erp.id === par.erp.id || outro.adq.id === par.adq.id))
      .sort(compararPrioridade);
    const qtdErp = porErpRestante.get(par.erp.id)?.length || 0;
    const qtdAdq = porAdqRestante.get(par.adq.id)?.length || 0;
    const principais = concorrentes.slice(0, 3).map((outro) =>
      `${outro.erp.id === par.erp.id ? 'mesmo ERP' : 'mesma adquirente'}: score ${outro.avaliacao.score}, ${outro.avaliacao.classificacao}, diferença ${outro.avaliacao.diferenca_segundos}s`
    );
    const motivoDisputa = `Disputa atual: ERP possui ${qtdErp} candidato(s) e adquirente possui ${qtdAdq} candidato(s).`;
    return {
      id:`AMB-H3-${Date.now()}-${indice+1}-${Math.random().toString(36).slice(2,8)}`,
      venda_adquirente_id:par.adq.id,venda_interdata_id:par.erp.id,status:'AMBIGUO',
      tipo_match:par.avaliacao.estrategia==='NSU_VALOR_DATA'?'NSU_VALOR_DATA':par.avaliacao.classificacao==='RECUPERACAO_NSU_NORMALIZADO'?'NSU_NORMALIZADO':par.avaliacao.classificacao==='RECUPERACAO_CONTEXTO_HORA'?'MATCH_CONTEXTO_HORA':par.avaliacao.classificacao==='MATCH_HORARIO_FORTE_DIVERGENTE'?'HORARIO_FORTE_UNICO':par.avaliacao.classificacao==='VOUCHER_HORARIO_FORTE'?'VOUCHER_HORARIO_FORTE':par.avaliacao.classificacao==='VOUCHER_UNICO_DATA_VALOR_PARCELAS'?'VOUCHER_UNICO_DATA_VALOR_PARCELAS':par.avaliacao.classificacao==='CANDIDATO_UNICO_JANELA_8H'?'CANDIDATO_UNICO_JANELA_8H':'HORARIO_NORMALIZADO',score:par.avaliacao.score,
      criterios_usados:[...par.avaliacao.criterios,motivoDisputa,...(principais.length ? [`Concorrentes principais — ${principais.join(' | ')}`] : []),'Conflito remanescente após priorização global; exige revisão humana'],
      diferenca_valor:0,diferenca_dias:0,automatico:false,
      data_conciliacao:agora,estrategia:par.avaliacao.estrategia,classificacao:par.avaliacao.classificacao,
      diferenca_horario_segundos:par.avaliacao.diferenca_segundos,ajuste_horario_minutos:par.avaliacao.ajuste_horario_minutos,
      versao_motor:'2.9-v0.1.226',
      observacoes:`Ambiguidade real após reavaliação. ${motivoDisputa}${principais.length ? ` Concorrentes: ${principais.join('; ')}.` : ''}`,
      quantidade_candidatos_equivalentes: Math.max(qtdErp, qtdAdq),
    };
  });
  const ambiguos = candidatosAmbiguos.length;
  let metricasAmbiguidades = { criadas: 0, atualizadas: 0, ignoradas_conciliadas: 0 };
  let saneamentoAmbiguidades = { desfeitas: 0, invalidas_regra_atual: 0, vinculo_consumido: 0 };
  if (!opcoes.simular) {
    await criarConciliacoesPostgres(candidatos);
    saneamentoAmbiguidades = await sanearAmbiguidadesPostgres(pares, erpIdsAvaliados);
    metricasAmbiguidades = await criarAmbiguidadesPostgres(candidatosAmbiguos);
  }
  return {
    sucesso: true,
    modo: opcoes.simular ? 'SIMULACAO' : 'EXECUCAO',
    versao_motor: '2.9-v0.1.226',
    avaliados: { vendas_interdata: erpsAvaliados, pares_candidatos: pares.length },
    criados: opcoes.simular ? 0 : candidatos.length,
    correspondencias_unicas: candidatos.length,
    conciliados: candidatosAutomaticos.length,
    sugeridos: candidatosSugeridos.length,
    ambiguos,
    ambiguidades_resolvidas_automaticamente: selecionadosAutomaticos.filter((par) => (pares.filter((outro) => outro.erp.id === par.erp.id || outro.adq.id === par.adq.id).length > 1)).length,
    ambiguidades_persistidas: metricasAmbiguidades.criadas + metricasAmbiguidades.atualizadas,
    ambiguidades_criadas: metricasAmbiguidades.criadas,
    ambiguidades_atualizadas: metricasAmbiguidades.atualizadas,
    ambiguidades_ignoradas_por_conciliacao: metricasAmbiguidades.ignoradas_conciliadas,
    ambiguidades_saneadas: saneamentoAmbiguidades.desfeitas,
    ambiguidades_invalidas_regra_atual: saneamentoAmbiguidades.invalidas_regra_atual,
    ambiguidades_encerradas_por_vinculo_consumido: saneamentoAmbiguidades.vinculo_consumido,
    ambiguidades_liberadas_para_reavaliacao: ambiguidadesLiberadas,
    por_classificacao: {
      match_exato_nsu: candidatos.filter((item) => item.classificacao === 'MATCH_EXATO_NSU').length,
      match_exato_horario: candidatos.filter((item) => item.classificacao === 'MATCH_EXATO_HORARIO').length,
      horario_forte_dados_divergentes: candidatos.filter((item) => item.classificacao === 'MATCH_HORARIO_FORTE_DIVERGENTE').length,
      voucher_horario_forte: candidatos.filter((item) => item.classificacao === 'VOUCHER_HORARIO_FORTE').length,
      voucher_unico_data_valor_parcelas: candidatos.filter((item) => item.classificacao === 'VOUCHER_UNICO_DATA_VALOR_PARCELAS').length,
      candidato_unico_janela_8h: candidatos.filter((item) => item.classificacao === 'CANDIDATO_UNICO_JANELA_8H').length,
      recuperacao_nsu_normalizado: candidatos.filter((item) => item.classificacao === 'RECUPERACAO_NSU_NORMALIZADO').length,
      recuperacao_contexto_hora: candidatos.filter((item) => item.classificacao === 'RECUPERACAO_CONTEXTO_HORA').length,
    },
    duracao_ms: Date.now() - inicio,
  };
}

async function executarConciliacaoAutomaticaLegada({ confirmarAutomatico = true, limiteCandidatos = 5000 }: { confirmarAutomatico?: boolean; limiteCandidatos?: number } = {}) {
  const [vendasAdqOriginais, vendasErpOriginais, conciliacoesOriginais] = await Promise.all([
    lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []),
    lerTabela<VendaInterdata[]>(vendasInterdataTabela, []),
    lerTabela<ConciliacaoVenda[]>(conciliacoesTabela, []),
  ]);

  const conciliacoesAtivas = conciliacoesOriginais.filter((item) => item.status !== 'DESFEITO');
  const idsAdqConciliados = new Set(conciliacoesAtivas.map((item) => item.venda_adquirente_id));
  const idsErpConciliados = new Set(conciliacoesAtivas.map((item) => item.venda_interdata_id));
  const vendasAdq = vendasAdqOriginais.filter((venda) => ehVendaCanonicaAdquirente(venda) && textoFiltro((venda as any).utilidade_status) !== 'NAO_UTIL' && textoFiltro((venda as any).pix_redundante) !== 'SIM' && !registroContemNaoAplica(venda as unknown as Record<string, unknown>) && statusConciliacaoVenda(venda as any) === 'PENDENTE' && !idsAdqConciliados.has(venda.id)).slice(0, limiteCandidatos);
  const vendasErp = vendasErpOriginais.filter((venda) => !registroContemNaoAplica(venda as unknown as Record<string, unknown>) && statusConciliacaoVenda(venda as any) === 'PENDENTE' && !idsErpConciliados.has(venda.id)).slice(0, limiteCandidatos);

  const candidatos: ConciliacaoVenda[] = [];
  const usadosAdq = new Set<string>();
  const usadosErp = new Set<string>();

  const diferencaMinimaParaEscolha = 10;
  for (const adq of vendasAdq) {
    const opcoes: Array<{ erp: VendaInterdata; score: number; tipo: ConciliacaoVenda['tipo_match']; criterios: string[]; diferenca_valor: number; diferenca_dias: number; elegivelAutomatico: boolean }> = [];
    for (const erp of vendasErp) {
      if (usadosErp.has(erp.id)) continue;
      const pontuacao = pontuarMatchConciliacao(adq, erp);
      if (!pontuacao || pontuacao.score <= 50) continue;
      opcoes.push({ erp, ...pontuacao });
    }
    opcoes.sort((a, b) => b.score - a.score || a.erp.id.localeCompare(b.erp.id));
    const melhor = opcoes[0] || null;
    if (!melhor) continue;
    const segundo = opcoes[1] || null;
    const diferencaParaSegundo = segundo ? melhor.score - segundo.score : 100;
    const equivalentes = opcoes.filter((opcao) => melhor.score - opcao.score < diferencaMinimaParaEscolha).length;
    const ambiguo = Boolean(segundo && diferencaParaSegundo < diferencaMinimaParaEscolha);
    const automaticoSeguro = confirmarAutomatico && melhor.score > 50 && melhor.elegivelAutomatico && !ambiguo;
    const status: ConciliacaoVenda['status'] = ambiguo ? 'AMBIGUO' : automaticoSeguro ? 'CONCILIADO' : 'SUGERIDO';
    const id = `CONC-${Date.now()}-${candidatos.length + 1}-${Math.random().toString(36).slice(2, 8)}`;
    candidatos.push({
      id,
      venda_adquirente_id: adq.id,
      venda_interdata_id: melhor.erp.id,
      status,
      tipo_match: melhor.tipo,
      score: melhor.score,
      criterios_usados: melhor.criterios,
      diferenca_valor: melhor.diferenca_valor,
      diferenca_dias: melhor.diferenca_dias,
      automatico: status === 'CONCILIADO',
      data_conciliacao: new Date().toISOString(),
      segundo_melhor_score: segundo?.score,
      diferenca_para_segundo: segundo ? diferencaParaSegundo : undefined,
      quantidade_candidatos_equivalentes: equivalentes,
      observacoes: status === 'CONCILIADO'
        ? 'Match automático seguro: identificador forte, valor e data compatíveis, sem ambiguidade.'
        : status === 'AMBIGUO'
          ? `Revisão obrigatória: ${equivalentes} candidatos com diferença inferior a ${diferencaMinimaParaEscolha} pontos.`
          : melhor.tipo === 'VALOR_DATA'
            ? 'Sugestão para revisão: valor e data nunca confirmam automaticamente.'
            : 'Sugestão de match para revisão.',
    });
    usadosAdq.add(adq.id);
    usadosErp.add(melhor.erp.id);
  }

  const mapaConciliacaoPorAdq = new Map(candidatos.map((item) => [item.venda_adquirente_id, item]));
  const mapaConciliacaoPorErp = new Map(candidatos.map((item) => [item.venda_interdata_id, item]));
  const vendasAdqAtualizadas = vendasAdqOriginais.map((venda) => {
    const conc = mapaConciliacaoPorAdq.get(venda.id);
    if (!conc) return venda.status_conciliacao ? venda : { ...venda, status_conciliacao: 'PENDENTE' };
    return { ...venda, conciliacao_id: conc.id, status_conciliacao: conc.status, score_conciliacao: conc.score, tipo_match: conc.tipo_match };
  });
  const vendasErpAtualizadas = vendasErpOriginais.map((venda) => {
    const conc = mapaConciliacaoPorErp.get(venda.id);
    if (!conc) return venda.status_conciliacao ? venda : { ...venda, status_conciliacao: 'PENDENTE' };
    return { ...venda, conciliacao_id: conc.id, status_conciliacao: conc.status, score_conciliacao: conc.score, tipo_match: conc.tipo_match };
  });

  if (usarPostgres()) {
    await criarConciliacoesPostgres(candidatos);
  } else {
    await Promise.all([
      gravarTabela(conciliacoesTabela, [...conciliacoesOriginais, ...candidatos]),
      gravarTabela(vendasAdquirentesTabela, vendasAdqAtualizadas),
      gravarTabela(vendasInterdataTabela, vendasErpAtualizadas),
    ]);
  }

  return {
    sucesso: true,
    avaliados: { vendas_adquirentes: vendasAdq.length, vendas_interdata: vendasErp.length },
    criados: candidatos.length,
    conciliados: candidatos.filter((item) => item.status === 'CONCILIADO').length,
    sugeridos: candidatos.filter((item) => item.status === 'SUGERIDO').length,
    ambiguos: candidatos.filter((item) => item.status === 'AMBIGUO').length,
    score_minimo_sugestao: 50,
    score_minimo_automatico: 51,
    diferenca_minima_para_escolha: diferencaMinimaParaEscolha,
  };
}

async function promoverSugestoesAltaConfiancaPostgres(scoreMinimo = 80, escopo: { dataInicial?: string; dataFinal?: string } = {}) {
  await garantirDbPostgres();
  const db = await getDatabase();
  const promovidas = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe(
      `SELECT c.row_id AS id, c.venda_adquirente_id, c.venda_interdata_id, COALESCE((c.dados->>'score')::numeric,0)::float8 AS score
       FROM conciliacoes c
       JOIN vendas_adquirentes a ON a.row_id=c.venda_adquirente_id AND a.conciliacao_id=c.row_id
       JOIN vendas_interdata e ON e.row_id=c.venda_interdata_id AND e.conciliacao_id=c.row_id
       WHERE c.status='SUGERIDO' AND COALESCE((c.dados->>'score')::numeric,0) >= $1
         AND ($2::text = '' OR ${sqlDataNormalizada('e')} >= $2)
         AND ($3::text = '' OR ${sqlDataNormalizada('e')} <= $3)
       FOR UPDATE OF c`, scoreMinimo,
      escopo.dataInicial || '', escopo.dataFinal || '',
    ) as Array<{id:string;venda_adquirente_id:string;venda_interdata_id:string;score:number}>;
    for (const row of rows) {
      await tx.$executeRawUnsafe(
        `UPDATE conciliacoes SET status='CONCILIADO', dados=jsonb_set(jsonb_set(jsonb_set(dados,'{status}','"CONCILIADO"'::jsonb),'{automatico}','true'::jsonb),'{observacoes}',to_jsonb($1::text)), data_atualizacao=NOW() WHERE row_id=$2`,
        `Conciliação automática por confiança alta (score >= ${scoreMinimo}).`, row.id,
      );
      const dadosVenda = JSON.stringify({conciliacao_id:row.id,status_conciliacao:'CONCILIADO',score_conciliacao:Number(row.score||0),tipo_match:'AUTO_ALTA_CONFIANCA'});
      await tx.$executeRawUnsafe(`UPDATE vendas_adquirentes SET dados=dados || $1::jsonb, data_atualizacao=NOW() WHERE row_id=$2 AND conciliacao_id=$3`, dadosVenda, row.venda_adquirente_id, row.id);
      await tx.$executeRawUnsafe(`UPDATE vendas_interdata SET dados=dados || $1::jsonb, data_atualizacao=NOW() WHERE row_id=$2 AND conciliacao_id=$3`, dadosVenda, row.venda_interdata_id, row.id);
      await tx.$executeRawUnsafe(
        `INSERT INTO historico_conciliacoes (conciliacao_id, acao, status_anterior, status_novo, motivo, usuario_nome, detalhes)
         VALUES ($1,'AUTO_CONFIRMAR_ALTA_CONFIANCA','SUGERIDO','CONCILIADO',$2,'Sistema',$3::jsonb)`,
        row.id, `Score ${Number(row.score||0)} atingiu o limite automático de ${scoreMinimo}.`, JSON.stringify({score:row.score,score_minimo:scoreMinimo}),
      );
    }
    return rows.length;
  });
  return promovidas;
}

export async function executarConciliacaoAutomatica(opcoes: (OpcoesConciliacaoHibrida & { limiteCandidatos?: number }) = {}) {
  if (usarPostgres()) {
    const resultado = await executarConciliacaoHibridaPostgres(opcoes);
    if (!opcoes.simular && opcoes.confirmarAutomatico !== false) {
      const promovidas = await promoverSugestoesAltaConfiancaPostgres(80, { dataInicial: opcoes.dataInicial, dataFinal: opcoes.dataFinal });
      return { ...resultado, promovidas_alta_confianca: promovidas, conciliados: Number((resultado as any).conciliados || 0) + promovidas };
    }
    return resultado;
  }
  return executarConciliacaoAutomaticaLegada({ confirmarAutomatico: opcoes.confirmarAutomatico, limiteCandidatos: opcoes.limiteCandidatos || 20000 });
}


export type ResultadoConsolidacaoVoucherPorAdquirente = {
  adquirente: string;
  bandeiras_captura: string[];
  capturas_analisadas: number;
  vinculos_criados: number;
  ja_vinculados: number;
  ambiguos: number;
  sem_correspondencia: number;
  duplicidades_internas_suprimidas: number;
};

export type ResultadoConsolidacaoVoucher = {
  sucesso: boolean;
  capturas_analisadas: number;
  vinculos_criados: number;
  ja_vinculados: number;
  ambiguos: number;
  sem_correspondencia: number;
  duplicidades_internas_suprimidas: number;
  tolerancia_segundos: number;
  por_adquirente: ResultadoConsolidacaoVoucherPorAdquirente[];
};


type EstrategiaVoucher = {
  adquirente: string;
  bandeirasCaptura: string[];
  priorizaNsu: boolean;
};

// v0.1.191: bandeira/rede e adquirente econômica não são necessariamente iguais.
// Ex.: SIPAG informa CABAL, enquanto a venda financeira pertence à COOPCERTO.
const ESTRATEGIAS_VOUCHER: EstrategiaVoucher[] = [
  { adquirente: 'PLUXEE', bandeirasCaptura: ['PLUXEE'], priorizaNsu: false },
  { adquirente: 'COOPCERTO', bandeirasCaptura: ['CABAL', 'COOPCERTO'], priorizaNsu: false },
  { adquirente: 'VR', bandeirasCaptura: ['VR'], priorizaNsu: true },
  { adquirente: 'ALELO', bandeirasCaptura: ['ALELO'], priorizaNsu: true },
  { adquirente: 'TICKET', bandeirasCaptura: ['TICKET'], priorizaNsu: true },
  { adquirente: 'LECARD', bandeirasCaptura: ['LECARD'], priorizaNsu: true },
  { adquirente: 'CONVCARD', bandeirasCaptura: ['CONVCARD'], priorizaNsu: true },
];

function normalizarChaveVoucher(valor: unknown) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

function centavosVoucher(valor: unknown) {
  return Math.round(Math.abs(moedaParaNumeroCanonico(valor)) * 100);
}

function estabelecimentoVoucher(venda: VendaAdquirente) {
  return normalizarChaveVoucher(venda.codigo_estabelecimento || venda.cnpj_estabelecimento).replace(/[^A-Z0-9]/g, '');
}

function dataIsoVoucher(venda: VendaAdquirente) {
  return chaveDataIsoVenda(String(venda.data_venda || ''));
}

function horarioVoucherMs(venda: VendaAdquirente) {
  return timestampVendaParaOrdenacao(venda.data_venda, venda.hora_venda);
}

function nsuVoucher(venda: VendaAdquirente) {
  return identificadorVoucher(venda.nsu);
}

function ehCapturaVoucher(venda: VendaAdquirente) { return capturaVoucher(venda); }
function ehVendaEconomicaVoucher(venda: VendaAdquirente) { return economicaVoucher(venda); }

function chaveDuplicidadeEconomicaVoucher(venda: VendaAdquirente) {
  const nsu = nsuVoucher(venda);
  const timestamp = horarioVoucherMs(venda);
  if (!nsu || !timestamp || !estabelecimentoVoucher(venda) || !identificadorVoucher(venda.codigo_autorizacao) || venda.status_vinculo_voucher === 'VINCULADO' || venda.conciliacao_id) return '';
  return [
    estabelecimentoVoucher(venda),
    normalizarChaveVoucher(venda.adquirente),
    dataIsoVoucher(venda),
    centavosVoucher(venda.valor_bruto),
    nsu,
    venda.codigo_autorizacao,
    venda.parcelas,
    timestamp,
    normalizarChaveVoucher(venda.status_transacao),
  ].join('|');
}

function dadosJsonObjeto(venda: VendaAdquirente): Record<string, unknown> {
  return venda.dados_json && typeof venda.dados_json === 'object' && !Array.isArray(venda.dados_json) ? venda.dados_json : {};
}

function patchVendaEconomicaVoucher(economica: VendaAdquirente, captura: VendaAdquirente, estrategia: EstrategiaVoucher): VendaAdquirente {
  const adquirenteCaptura = normalizarChaveVoucher(captura.adquirente);
  const dadosFinanceiros = dadosJsonObjeto(economica);
  const dadosCaptura = dadosJsonObjeto(captura);
  return {
    ...economica,
    ...(captura.conciliacao_id && !economica.conciliacao_id ? {
      conciliacao_id: captura.conciliacao_id, status_conciliacao: captura.status_conciliacao,
      score_conciliacao: captura.score_conciliacao, tipo_match: captura.tipo_match,
    } : {}),
    codigo_autorizacao: economica.codigo_autorizacao || captura.codigo_autorizacao,
    terminal: economica.terminal || captura.terminal,
    status_transacao: economica.status_transacao || captura.status_transacao,
    adquirente_captura: adquirenteCaptura,
    vinculo_voucher_id: economica.id,
    status_vinculo_voucher: 'VINCULADO',
    registro_canonico: true,
    suprimido_por_vinculo_voucher: false,
    dados_json: {
      ...dadosFinanceiros,
      voucher_mesclado: true,
      adquirente_economica: estrategia.adquirente,
      adquirente_captura: adquirenteCaptura,
      bandeira_captura: normalizarChaveVoucher(captura.bandeira),
      estrategia_voucher: estrategia.priorizaNsu ? 'NSU_VALOR_LOJA_COM_FALLBACK_HORARIO' : 'DATA_VALOR_HORARIO',
      nsu_adquirente: economica.nsu || '',
      nsu_captura: captura.nsu || '',
      codigo_autorizacao_captura: captura.codigo_autorizacao || '',
      terminal_captura: captura.terminal || '',
      data_venda_captura: captura.data_venda || '',
      hora_venda_captura: captura.hora_venda || '',
      fonte_financeira: dadosFinanceiros.fonte_financeira || dadosFinanceiros,
      fonte_captura: dadosCaptura,
      captura_id: captura.id,
      importacao_captura_id: captura.importacao_id,
      codigo_estabelecimento_captura: captura.codigo_estabelecimento || '',
    },
  };
}

function patchCapturaVoucher(captura: VendaAdquirente, economica: VendaAdquirente, estrategia: EstrategiaVoucher): VendaAdquirente {
  return {
    ...captura,
    conciliacao_id: '', status_conciliacao: '', score_conciliacao: undefined, tipo_match: '',
    adquirente_captura: normalizarChaveVoucher(captura.adquirente),
    vinculo_voucher_id: economica.id,
    status_vinculo_voucher: 'VINCULADO',
    registro_canonico: false,
    suprimido_por_vinculo_voucher: true,
    dados_json: {
      ...dadosJsonObjeto(captura),
      voucher_mesclado: true,
      conciliacao_id_captura_original: captura.conciliacao_id || '',
      adquirente_economica: estrategia.adquirente,
      adquirente_captura: normalizarChaveVoucher(captura.adquirente),
      bandeira_captura: normalizarChaveVoucher(captura.bandeira),
      nsu_adquirente: economica.nsu || '',
      nsu_captura: captura.nsu || '',
    },
  };
}

function patchDuplicidadeInternaVoucher(duplicada: VendaAdquirente, canonica: VendaAdquirente): VendaAdquirente {
  return {
    ...duplicada,
    vinculo_voucher_id: canonica.id,
    status_vinculo_voucher: 'VINCULADO',
    registro_canonico: false,
    suprimido_por_vinculo_voucher: true,
    dados_json: {
      ...dadosJsonObjeto(duplicada),
      voucher_suprimido_motivo: 'DUPLICIDADE_INTERNA',
      voucher_duplicidade_canonica_id: canonica.id,
      voucher_duplicidade_adquirente: normalizarChaveVoucher(duplicada.adquirente),
    },
  };
}

function escolherCanonicaDuplicidadeVoucher(vendas: VendaAdquirente[]) {
  return [...vendas].sort((a, b) => {
    const taxaA = Math.abs(moedaParaNumeroCanonico(a.valor_taxa));
    const taxaB = Math.abs(moedaParaNumeroCanonico(b.valor_taxa));
    if (taxaA !== taxaB) return taxaB - taxaA;
    const liquidoA = Math.abs(moedaParaNumeroCanonico(a.valor_liquido));
    const liquidoB = Math.abs(moedaParaNumeroCanonico(b.valor_liquido));
    if (liquidoA !== liquidoB) return liquidoB - liquidoA;
    return String(a.data_criacao || '').localeCompare(String(b.data_criacao || '')) || String(a.id).localeCompare(String(b.id));
  })[0];
}

export async function consolidarVendasVoucherCapturadas(
  toleranciaSegundos = Number(process.env.VOUCHER_CONSOLIDACAO_TOLERANCIA_SEGUNDOS || 60),
  escopo: { dataInicial?: string; dataFinal?: string } = {},
): Promise<ResultadoConsolidacaoVoucher> {
  await garantirDbPostgres();
  const toleranciaMs = (Number.isFinite(toleranciaSegundos) ? Math.max(1, Math.min(toleranciaSegundos, 300)) : 60) * 1000;
  const todasVendas = usarPostgres() && (escopo.dataInicial || escopo.dataFinal)
    ? (await (await getDatabase()).$queryRawUnsafe(
        `SELECT dados FROM vendas_adquirentes
          WHERE ($1::text = '' OR ${dataVendaSql()} >= $1)
            AND ($2::text = '' OR ${dataVendaSql()} <= $2)`,
        escopo.dataInicial || '', escopo.dataFinal || '',
      ) as Array<{ dados: VendaAdquirente }>).map((item) => item.dados)
    : await lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []);
  const vendas = todasVendas.filter(ehVendaCanonicaAdquirente);
  const atualizacoes = new Map<string, VendaAdquirente>();

  const estatisticas = new Map<string, ResultadoConsolidacaoVoucherPorAdquirente>();
  for (const estrategia of [...ESTRATEGIAS_VOUCHER, { adquirente: 'INDEFINIDA', bandeirasCaptura: [], priorizaNsu: false }]) {
    estatisticas.set(estrategia.adquirente, {
      adquirente: estrategia.adquirente,
      bandeiras_captura: estrategia.bandeirasCaptura,
      capturas_analisadas: 0,
      vinculos_criados: 0,
      ja_vinculados: 0,
      ambiguos: 0,
      sem_correspondencia: 0,
      duplicidades_internas_suprimidas: 0,
    });
  }

  // Etapa 1: deduplicação interna conservadora. Só suprime quando existe NSU válido,
  // mesma loja/adquirente/data/valor/status e timestamp exatamente iguais.
  const economicasOriginais = vendas.filter(ehVendaEconomicaVoucher);
  const porDuplicidade = new Map<string, VendaAdquirente[]>();
  for (const venda of economicasOriginais) {
    const chave = chaveDuplicidadeEconomicaVoucher(venda);
    if (!chave) continue;
    const lista = porDuplicidade.get(chave) || [];
    lista.push(venda);
    porDuplicidade.set(chave, lista);
  }

  const idsDuplicadosSuprimidos = new Set<string>();
  for (const grupo of porDuplicidade.values()) {
    if (grupo.length <= 1) continue;
    if (new Set(grupo.map(v => JSON.stringify([centavosVenda(v.valor_taxa),centavosVenda(v.valor_liquido)]))).size !== 1) continue;
    const canonica = escolherCanonicaDuplicidadeVoucher(grupo);
    for (const duplicada of grupo) {
      if (duplicada.id === canonica.id) continue;
      idsDuplicadosSuprimidos.add(duplicada.id);
      atualizacoes.set(duplicada.id, patchDuplicidadeInternaVoucher(duplicada, canonica));
      estatisticas.get(normalizarChaveVoucher(duplicada.adquirente))!.duplicidades_internas_suprimidas += 1;
    }
  }

  const economicas = economicasOriginais.filter((venda) => !idsDuplicadosSuprimidos.has(venda.id));
  // Inclui capturas já suprimidas para que a execução permaneça idempotente e
  // consiga contabilizar corretamente os vínculos já existentes.
  const capturas = todasVendas.filter(ehCapturaVoucher);
  for (const decisao of selecionarParesVoucher(capturas, economicas, toleranciaMs / 1000)) {
    const captura = decisao.captura;
    const rede = decisao.economica?.adquirente || dadosJsonObjeto(captura).adquirente_economica || redeEsperadaVoucher(captura) || 'INDEFINIDA';
    const resumo = estatisticas.get(normalizarChaveVoucher(rede)) || estatisticas.get('INDEFINIDA')!;
    resumo.capturas_analisadas += 1;
    if (decisao.status === 'JA_VINCULADO') { resumo.ja_vinculados += 1; continue; }
    if (decisao.status === 'VINCULADO' && decisao.economica) {
      const economica = decisao.economica;
      const estrategia = ESTRATEGIAS_VOUCHER.find(e => e.adquirente === normalizarChaveVoucher(economica.adquirente))!;
      const financeira = patchVendaEconomicaVoucher(economica, captura, estrategia);
      financeira.dados_json = { ...financeira.dados_json, estrategia_voucher: decisao.evidencia?.criterio, evidencia_voucher: decisao.evidencia };
      const origem = patchCapturaVoucher(captura, economica, estrategia);
      origem.dados_json = { ...origem.dados_json, estrategia_voucher: decisao.evidencia?.criterio, evidencia_voucher: decisao.evidencia };
      atualizacoes.set(economica.id, financeira);
      atualizacoes.set(captura.id, origem);
      resumo.vinculos_criados += 1;
      continue;
    }
    if (decisao.status === 'AMBIGUO') resumo.ambiguos += 1; else resumo.sem_correspondencia += 1;
    const status = decisao.status === 'AMBIGUO' ? 'AMBIGUO' : 'SEM_VINCULO';
    const candidatos = decisao.candidatos;
    // Não regrava vendas inalteradas a cada lote.
    if (captura.status_vinculo_voucher !== status || JSON.stringify(captura.dados_json?.voucher_candidatos || []) !== JSON.stringify(candidatos)) {
      atualizacoes.set(captura.id, { ...captura, status_vinculo_voucher: status,
        registro_canonico: true, suprimido_por_vinculo_voucher: false,
        dados_json: { ...dadosJsonObjeto(captura), voucher_candidatos: candidatos } });
    }
  }

  if (usarPostgres()) {
    const db = await getDatabase();
    const itens = [...atualizacoes.entries()];
    // Proteção otimista contra conversões/conciliação concorrentes. Adquire locks
    // em ordem estável e confirma que o snapshot ainda é válido antes de gravar.
    const originais = new Map(todasVendas.map(v => [v.id, v]));
    itens.sort(([a], [b]) => a.localeCompare(b));
    if (itens.length) await db.$transaction(async (tx) => {
      for (let i = 0; i < itens.length; i += 250) {
        const lote = itens.slice(i, i + 250).map(([id, dados]) => ({ id, dados, original: originais.get(id) }));
        const bloqueadas = await tx.$queryRawUnsafe(
          `SELECT v.row_id FROM vendas_adquirentes v
           JOIN jsonb_to_recordset($1::jsonb) AS x(id text, dados jsonb, original jsonb)
             ON v.row_id=x.id AND v.dados=x.original
           ORDER BY v.row_id FOR UPDATE OF v`, JSON.stringify(lote)) as Array<{row_id:string}>;
        if (bloqueadas.length !== lote.length) throw new Error('Vouchers alterados durante a consolidação; execute novamente o processamento.');
      }
      for (const [id, venda] of itens) {
        const original = originais.get(id)!;
        if (venda.suprimido_por_vinculo_voucher && original.conciliacao_id && venda.vinculo_voucher_id) {
          await tx.$executeRawUnsafe('UPDATE vendas_adquirentes SET conciliacao_id=NULL WHERE row_id=$1', id);
          await tx.$executeRawUnsafe(
            `UPDATE conciliacoes SET venda_adquirente_id=$1,
             dados=dados || jsonb_build_object('venda_adquirente_id',$1::text,'venda_adquirente_captura_id',$2::text),
             data_atualizacao=NOW() WHERE row_id=$3 AND venda_adquirente_id=$2`,
            venda.vinculo_voucher_id, id, original.conciliacao_id);
        }
      }
      for (let i = 0; i < itens.length; i += 250) {
        const lote = itens.slice(i, i + 250).map(([id, dados]) => ({ id, dados }));
        await tx.$executeRawUnsafe(
          `UPDATE vendas_adquirentes v SET dados=x.dados,
           conciliacao_id=NULLIF(x.dados->>'conciliacao_id',''), data_atualizacao=NOW()
           FROM jsonb_to_recordset($1::jsonb) AS x(id text, dados jsonb)
           WHERE v.row_id=x.id`, JSON.stringify(lote));
      }
    });
  } else if (atualizacoes.size > 0) {
    const todos = await lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []);
    const mescladas = todos.map((venda) => atualizacoes.get(venda.id) || venda);
    await gravarTabela(vendasAdquirentesTabela, mescladas);
  }

  const porAdquirente = [...estatisticas.values()];
  return {
    sucesso: true,
    capturas_analisadas: porAdquirente.reduce((soma, item) => soma + item.capturas_analisadas, 0),
    vinculos_criados: porAdquirente.reduce((soma, item) => soma + item.vinculos_criados, 0),
    ja_vinculados: porAdquirente.reduce((soma, item) => soma + item.ja_vinculados, 0),
    ambiguos: porAdquirente.reduce((soma, item) => soma + item.ambiguos, 0),
    sem_correspondencia: porAdquirente.reduce((soma, item) => soma + item.sem_correspondencia, 0),
    duplicidades_internas_suprimidas: porAdquirente.reduce((soma, item) => soma + item.duplicidades_internas_suprimidas, 0),
    tolerancia_segundos: Math.round(toleranciaMs / 1000),
    por_adquirente: porAdquirente,
  };
}

export async function verificarBasesDisponiveisParaConciliacao() {
  if (usarPostgres()) {
    await garantirDbPostgres();
    const db = await getDatabase();
    const [resultado] = await db.$queryRawUnsafe(
      `SELECT
         EXISTS (SELECT 1 FROM "vendas_interdata" LIMIT 1) AS possui_erp,
         EXISTS (SELECT 1 FROM "vendas_adquirentes" LIMIT 1) AS possui_adquirente`,
    ) as Array<{ possui_erp: boolean; possui_adquirente: boolean }>;
    return {
      possuiErp: Boolean(resultado?.possui_erp),
      possuiAdquirente: Boolean(resultado?.possui_adquirente),
    };
  }

  const [vendasErp, vendasAdquirentes] = await Promise.all([
    lerTabela<VendaInterdata[]>(vendasInterdataTabela, []),
    lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []),
  ]);
  return {
    possuiErp: vendasErp.length > 0,
    possuiAdquirente: vendasAdquirentes.some(ehVendaCanonicaAdquirente),
  };
}


export async function confirmarConciliacao(id: string, motivo = '', ator: AtorConciliacao = {}) {
  const motivoLimpo = String(motivo || '').trim();
  if (motivoLimpo.length < 3) throw new Error('Informe um motivo com pelo menos 3 caracteres.');
  const [conciliacoes, vendasAdqOriginais, vendasErpOriginais] = await Promise.all([
    lerTabela<ConciliacaoVenda[]>(conciliacoesTabela, []),
    lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []),
    lerTabela<VendaInterdata[]>(vendasInterdataTabela, []),
  ]);
  const conciliacao = conciliacoes.find((item) => item.id === id && item.status !== 'DESFEITO');
  if (!conciliacao) throw new Error('Conciliação não encontrada.');
  const atualizada: ConciliacaoVenda = {
    ...conciliacao,
    status: 'CONCILIADO',
    automatico: false,
    data_conciliacao: new Date().toISOString(),
    observacoes: motivoLimpo,
  };
  const conciliacoesAtualizadas = conciliacoes.map((item) => item.id === id ? atualizada : item);
  const vendasAdqAtualizadas = vendasAdqOriginais.map((venda) => venda.id === atualizada.venda_adquirente_id
    ? { ...venda, conciliacao_id: atualizada.id, status_conciliacao: 'CONCILIADO', score_conciliacao: atualizada.score, tipo_match: atualizada.tipo_match }
    : venda);
  const vendasErpAtualizadas = vendasErpOriginais.map((venda) => venda.id === atualizada.venda_interdata_id
    ? { ...venda, conciliacao_id: atualizada.id, status_conciliacao: 'CONCILIADO', score_conciliacao: atualizada.score, tipo_match: atualizada.tipo_match }
    : venda);
  if (usarPostgres()) await alterarConciliacaoPostgres(atualizada, false);
  else await Promise.all([
    gravarTabela(conciliacoesTabela, conciliacoesAtualizadas),
    gravarTabela(vendasAdquirentesTabela, vendasAdqAtualizadas),
    gravarTabela(vendasInterdataTabela, vendasErpAtualizadas),
  ]);
  await registrarHistoricoConciliacao(id, 'CONFIRMAR', conciliacao.status, 'CONCILIADO', motivoLimpo, ator, { score: conciliacao.score, tipo_match: conciliacao.tipo_match });
  return { sucesso: true, conciliacao: atualizada };
}

export async function desfazerConciliacao(id: string, motivo = '', ator: AtorConciliacao = {}) {
  const motivoLimpo = String(motivo || '').trim();
  if (motivoLimpo.length < 3) throw new Error('Informe um motivo com pelo menos 3 caracteres.');
  const [conciliacoes, vendasAdqOriginais, vendasErpOriginais] = await Promise.all([
    lerTabela<ConciliacaoVenda[]>(conciliacoesTabela, []),
    lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []),
    lerTabela<VendaInterdata[]>(vendasInterdataTabela, []),
  ]);
  const conciliacao = conciliacoes.find((item) => item.id === id && item.status !== 'DESFEITO');
  if (!conciliacao) throw new Error('Conciliação não encontrada ou já desfeita.');
  const desfeita: ConciliacaoVenda = {
    ...conciliacao,
    status: 'DESFEITO',
    automatico: false,
    data_conciliacao: new Date().toISOString(),
    observacoes: motivoLimpo,
  };
  const conciliacoesAtualizadas = conciliacoes.map((item) => item.id === id ? desfeita : item);
  const vendasAdqAtualizadas = vendasAdqOriginais.map((venda) => venda.id === conciliacao.venda_adquirente_id
    ? { ...venda, conciliacao_id: '', status_conciliacao: 'PENDENTE', score_conciliacao: 0, tipo_match: '' }
    : venda);
  const recebimentoManual = conciliacao.tipo_match === 'MANUAL_RECEBIMENTO';
  const vendasErpAtualizadas = vendasErpOriginais.map((venda) => venda.id === conciliacao.venda_interdata_id
    ? recebimentoManual
      ? { ...venda, conciliacao_id: conciliacao.id, status_conciliacao: 'DESFEITO', score_conciliacao: conciliacao.score, tipo_match: conciliacao.tipo_match }
      : { ...venda, conciliacao_id: '', status_conciliacao: 'PENDENTE', score_conciliacao: 0, tipo_match: '' }
    : venda);
  if (usarPostgres()) await alterarConciliacaoPostgres(desfeita, true);
  else await Promise.all([
    gravarTabela(conciliacoesTabela, conciliacoesAtualizadas),
    gravarTabela(vendasAdquirentesTabela, vendasAdqAtualizadas),
    gravarTabela(vendasInterdataTabela, vendasErpAtualizadas),
  ]);
  await registrarHistoricoConciliacao(id, 'DESFAZER', conciliacao.status, 'DESFEITO', motivoLimpo, ator, { score: conciliacao.score, tipo_match: conciliacao.tipo_match });
  return { sucesso: true, conciliacao: desfeita };
}

export async function obterDetalhesConciliacao(id: string) {
  if (!usarPostgres()) {
    const resultado = await listarConciliacoesComExibicao(2000, 0, 'TODOS');
    const conciliacao = resultado.linhas.find((item: any) => item.id === id);
    if (!conciliacao) throw new Error('Conciliação não encontrada.');
    return { conciliacao, historico: [] };
  }
  await garantirDbPostgres();
  const db = await getDatabase();
  const rows = await db.$queryRawUnsafe(
    `SELECT c.row_id AS id, c.status, c.dados, a.dados AS venda_adquirente, e.dados AS venda_interdata
     FROM conciliacoes c LEFT JOIN vendas_adquirentes a ON a.row_id=c.venda_adquirente_id LEFT JOIN vendas_interdata e ON e.row_id=c.venda_interdata_id
     WHERE c.row_id=$1`, id,
  ) as Array<any>;
  if (!rows[0]) throw new Error('Conciliação não encontrada.');
  const historico = await db.$queryRawUnsafe(
    `SELECT id::text, acao, status_anterior, status_novo, motivo, usuario_nome, detalhes, criado_em
     FROM historico_conciliacoes WHERE conciliacao_id=$1 ORDER BY criado_em DESC, id DESC`, id,
  );
  const r = rows[0];
  return { conciliacao: {...r.dados,id:r.id,status:r.status,confianca:classificacaoConfianca(r.dados.score),venda_adquirente:r.venda_adquirente?aplicarBandeiraParaExibicao(r.venda_adquirente):null,venda_interdata:r.venda_interdata?aplicarBandeiraParaExibicao(r.venda_interdata):null}, historico };
}

export async function operarConciliacoesEmLote(ids: string[], acao: 'confirmar'|'desfazer', motivo: string, ator: AtorConciliacao = {}) {
  const unicos = [...new Set(ids.map(String).map(item => item.trim()).filter(Boolean))];
  if (!unicos.length) throw new Error('Selecione ao menos uma conciliação.');
  if (unicos.length > 200) throw new Error('O limite é de 200 conciliações por operação.');
  const resultados: Array<{id:string;sucesso:boolean;mensagem?:string}> = [];
  for (const id of unicos) {
    try {
      if (acao === 'confirmar') await confirmarConciliacao(id, motivo, ator);
      else await desfazerConciliacao(id, motivo, ator);
      resultados.push({id,sucesso:true});
    } catch (error) {
      resultados.push({id,sucesso:false,mensagem:error instanceof Error?error.message:String(error)});
    }
  }
  return { sucesso: resultados.every(item=>item.sucesso), processados: resultados.filter(item=>item.sucesso).length, falhas: resultados.filter(item=>!item.sucesso).length, resultados };
}

export async function obterDataMaisRecenteErpParaConciliacao() {
  if (usarPostgres()) {
    await garantirDbPostgres();
    const db = await getDatabase();
    const rows = await db.$queryRawUnsafe(
      `SELECT e.data_venda_filtro AS data_mais_recente
         FROM vendas_interdata e
        WHERE e.data_venda_filtro <> ''
          AND e.registro_nao_aplicavel = FALSE
        ORDER BY e.data_venda_filtro DESC
        LIMIT 1`,
    ) as Array<{ data_mais_recente: string | null }>;
    return { data_mais_recente: String(rows[0]?.data_mais_recente || '') };
  }
  const vendas = await lerTabela<VendaInterdata[]>(vendasInterdataTabela, []);
  const datas = vendas
    .filter((venda) => !estabelecimentoLiteralNaoAplica((venda as any).cnpj_estabelecimento || (venda as any).codigo_estabelecimento))
    .map((venda) => chaveDataIsoVenda(String(venda.data_venda || '')))
    .filter(Boolean)
    .sort();
  return { data_mais_recente: datas.at(-1) || '' };
}

export async function obterInicializacaoConciliacoes(filtros: FiltrosCentralConciliacao = {}) {
  if (usarPostgres()) {
    await garantirDbPostgres();
    const db = await getDatabase();
    const rows = await db.$queryRawUnsafe(
      `WITH ultima_data AS (
         SELECT e.data_venda_filtro AS data
           FROM vendas_interdata e
          WHERE e.data_venda_filtro <> ''
            AND e.registro_nao_aplicavel = FALSE
          ORDER BY e.data_venda_filtro DESC
          LIMIT 1
       )
       SELECT
         COALESCE((SELECT data FROM ultima_data), '') AS data_mais_recente,
         ARRAY(
           SELECT valor
             FROM (
               SELECT DISTINCT e.estabelecimento_filtro AS valor
                 FROM vendas_interdata e
                 JOIN ultima_data u ON e.data_venda_filtro = u.data
                WHERE e.registro_nao_aplicavel = FALSE
                  AND e.estabelecimento_filtro <> ''
               UNION
               SELECT DISTINCT a.estabelecimento_filtro AS valor
                 FROM vendas_adquirentes a
                 JOIN ultima_data u ON a.data_venda_filtro = u.data
                WHERE a.registro_nao_aplicavel = FALSE
                  AND UPPER(COALESCE(a.dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'
                  AND LOWER(COALESCE(a.dados->>'suprimido_por_vinculo_voucher','false')) <> 'true'
                  AND a.estabelecimento_filtro <> ''
             ) estabelecimentos_validos
            ORDER BY valor
         ) AS estabelecimentos,
         ARRAY(
           SELECT DISTINCT a.adquirente_filtro
             FROM vendas_adquirentes a
             JOIN ultima_data u ON a.data_venda_filtro = u.data
            WHERE a.registro_nao_aplicavel = FALSE
              AND UPPER(COALESCE(a.dados->>'utilidade_status','UTIL')) <> 'NAO_UTIL'
              AND LOWER(COALESCE(a.dados->>'suprimido_por_vinculo_voucher','false')) <> 'true'
              AND a.adquirente_filtro <> ''
            ORDER BY a.adquirente_filtro
         ) AS adquirentes`,
    ) as Array<{ data_mais_recente: string; estabelecimentos: string[]; adquirentes: string[] }>;
    // v0.1.230: os cards usam exatamente o período/estabelecimento/adquirente aplicados.
    // A inicialização continua leve: não carrega nenhuma linha das tabelas de trabalho.
    const dataInicial = String(filtros.dataInicial || '').trim();
    const dataFinal = String(filtros.dataFinal || '').trim();
    const estabelecimento = String(filtros.estabelecimento || '').trim().toUpperCase();
    const adquirente = String(filtros.adquirente || '').trim().toUpperCase();
    const paramsPendentes: unknown[] = [];
    const condPendentes: string[] = [];
    const addP = (v: unknown) => { paramsPendentes.push(v); return `$${paramsPendentes.length}`; };
    if (dataInicial) condPendentes.push(`e.data_venda_filtro >= ${addP(dataInicial)}`);
    if (dataFinal) condPendentes.push(`e.data_venda_filtro <= ${addP(dataFinal)}`);
    if (estabelecimento) condPendentes.push(`e.estabelecimento_filtro = ${addP(estabelecimento)}`);

    const paramsConc: unknown[] = [];
    const condConc: string[] = [];
    const addC = (v: unknown) => { paramsConc.push(v); return `$${paramsConc.length}`; };
    if (dataInicial) condConc.push(`e.data_venda_filtro >= ${addC(dataInicial)}`);
    if (dataFinal) condConc.push(`e.data_venda_filtro <= ${addC(dataFinal)}`);
    if (estabelecimento) condConc.push(`e.estabelecimento_filtro = ${addC(estabelecimento)}`);
    if (adquirente) condConc.push(`a.adquirente_filtro = ${addC(adquirente)}`);

    const [pendentesRows, conciliacoesRows] = await Promise.all([
      db.$queryRawUnsafe(`SELECT COUNT(*)::int AS pendente FROM vendas_interdata e
        WHERE e.conciliacao_id IS NULL
          AND COALESCE(NULLIF(e.dados->>'status_conciliacao',''),'PENDENTE')='PENDENTE'
          AND e.registro_nao_aplicavel = FALSE
          ${condPendentes.length ? `AND ${condPendentes.join(' AND ')}` : ''}`, ...paramsPendentes),
      db.$queryRawUnsafe(`SELECT
          COUNT(*) FILTER (WHERE c.status='CONCILIADO')::int AS conciliado,
          COUNT(*) FILTER (WHERE c.status='SUGERIDO')::int AS sugerido,
          COUNT(*) FILTER (WHERE c.status='AMBIGUO')::int AS ambiguo
        FROM conciliacoes c
        LEFT JOIN vendas_adquirentes a ON a.row_id=c.venda_adquirente_id
        LEFT JOIN vendas_interdata e ON e.row_id=c.venda_interdata_id
        WHERE c.status <> 'DESFEITO'
          AND e.registro_nao_aplicavel = FALSE
          AND (a.row_id IS NULL OR a.registro_nao_aplicavel = FALSE)
          ${condConc.length ? `AND ${condConc.join(' AND ')}` : ''}`, ...paramsConc),
    ]) as [Array<{pendente:number}>, Array<{conciliado:number;sugerido:number;ambiguo:number}>];
    return {
      data_mais_recente: String(rows[0]?.data_mais_recente || ''),
      estabelecimentos: rows[0]?.estabelecimentos || [],
      adquirentes: rows[0]?.adquirentes || [],
      contadores: {
        pendente: Number(pendentesRows[0]?.pendente || 0),
        conciliado: Number(conciliacoesRows[0]?.conciliado || 0),
        sugerido: Number(conciliacoesRows[0]?.sugerido || 0),
        ambiguo: Number(conciliacoesRows[0]?.ambiguo || 0),
      },
    };
  }

  const { data_mais_recente } = await obterDataMaisRecenteErpParaConciliacao();
  const [erp, adquirentes] = await Promise.all([
    obterOpcoesVendasErp({ data_inicio: data_mais_recente, data_fim: data_mais_recente }),
    obterOpcoesVendasAdquirentes({ data_inicio: data_mais_recente, data_fim: data_mais_recente }),
  ]);
  return {
    data_mais_recente,
    estabelecimentos: [...new Set([...erp.estabelecimentos, ...adquirentes.estabelecimentos])].sort(),
    adquirentes: adquirentes.adquirentes,
  };
}


export type LadoConciliacaoManual = 'ERP' | 'ADQUIRENTE';

function segundosHoraManual(valor: unknown) {
  const match = String(valor || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0) : null;
}

const sqlSegundosHoraVenda = (alias: string) => {
  const hora = `SUBSTRING(COALESCE(${alias}.dados->>'hora_venda',${alias}.dados->>'data_venda_hora','') FROM '([0-9]{1,2}:[0-9]{2}(:[0-9]{2})?)')`;
  return `(CASE WHEN ${hora} IS NOT NULL THEN EXTRACT(EPOCH FROM (${hora})::time)::int ELSE NULL END)`;
};

export async function listarCandidatosConciliacaoManual(lado: LadoConciliacaoManual, limite = 80, offset = 0, busca = '', adquirente = '', dataInicial = '', dataFinal = '', estabelecimento = '', priorizarErpId = '') {
  const tamanho = Math.max(1, Math.min(Number(limite || 80), 200));
  const inicio = Math.max(0, Number(offset || 0));
  const termo = String(busca || '').trim();
  const filtroAdquirente = String(adquirente || '').trim().toUpperCase();
  const filtroEstabelecimento = String(estabelecimento || '').trim().toUpperCase();
  const inicioData = /^\d{4}-\d{2}-\d{2}$/.test(String(dataInicial || '').trim()) ? String(dataInicial).trim() : '';
  const fimData = /^\d{4}-\d{2}-\d{2}$/.test(String(dataFinal || '').trim()) ? String(dataFinal).trim() : '';
  const termoValor = /^\s*\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?\s*$/.test(termo) || /^\s*\d+(?:,\d{1,2})\s*$/.test(termo)
    ? termo.replace(/\./g, '').replace(',', '.')
    : '';
  if (usarPostgres()) {
    await garantirDbPostgres();
    const db = await getDatabase();
    let referenciaErp: VendaInterdata | null = null;
    const idReferencia = String(priorizarErpId || '').trim();
    if (lado === 'ADQUIRENTE' && idReferencia) {
      const referencias = await db.$queryRawUnsafe(
        `SELECT dados FROM vendas_interdata WHERE row_id=$1 LIMIT 1`,
        idReferencia,
      ) as Array<{ dados: VendaInterdata }>;
      referenciaErp = referencias[0]?.dados || null;
    }
    const tabela = lado === 'ERP' ? 'vendas_interdata' : 'vendas_adquirentes';
    const alias = lado === 'ERP' ? 'e' : 'a';
    const params: unknown[] = [];
    const condicoes = [
      `${alias}.conciliacao_id IS NULL`,
      // conciliacao_id é a relação autoritativa. status_conciliacao pode permanecer
      // historicamente preenchido mesmo depois de uma reversão e não deve esconder
      // uma venda realmente sem vínculo da conciliação manual.
      `${alias}.registro_nao_aplicavel = FALSE`,
      `NOT (${sqlRegistroNaoAplicavel(tabela, alias)})`,
      `UPPER(COALESCE(${alias}.dados->>'duplicidade_status','')) <> 'DUPLICADO_PROVAVEL'`,
    ];
    if (lado === 'ADQUIRENTE') {
      condicoes.push(`${alias}.status_filtro = 'AUTORIZADO'`);
      condicoes.push(`UPPER(COALESCE(${alias}.dados->>'pix_redundante','NAO')) <> 'SIM'`);
    }
    if (termo) {
      params.push(`%${termo}%`); const p=`$${params.length}`;
      if (termoValor && termoValor !== termo) {
        params.push(`%${termoValor}%`); const pv=`$${params.length}`;
        condicoes.push(`(COALESCE(${alias}.dados->>'nsu','') ILIKE ${p} OR COALESCE(${alias}.dados->>'codigo_autorizacao',${alias}.dados->>'autorizacao','') ILIKE ${p} OR COALESCE(${alias}.dados->>'valor_bruto','') ILIKE ${p} OR COALESCE(${alias}.dados->>'valor_bruto','') ILIKE ${pv})`);
      } else {
        condicoes.push(`(COALESCE(${alias}.dados->>'nsu','') ILIKE ${p} OR COALESCE(${alias}.dados->>'codigo_autorizacao',${alias}.dados->>'autorizacao','') ILIKE ${p} OR COALESCE(${alias}.dados->>'valor_bruto','') ILIKE ${p})`);
      }
    }
    if (inicioData) { params.push(inicioData); condicoes.push(`${sqlDataNormalizada(alias)} >= $${params.length}`); }
    if (fimData) { params.push(fimData); condicoes.push(`${sqlDataNormalizada(alias)} <= $${params.length}`); }
    if (filtroEstabelecimento) {
      params.push(filtroEstabelecimento);
      condicoes.push(`${alias}.estabelecimento_filtro=$${params.length}`);
    }
    if (lado === 'ADQUIRENTE' && filtroAdquirente) { params.push(filtroAdquirente); condicoes.push(`${alias}.adquirente_filtro=$${params.length}`); }
    const where=condicoes.join(' AND ');
    const totalRows=await db.$queryRawUnsafe(`SELECT COUNT(*)::int AS total FROM ${tabela} ${alias} WHERE ${where}`,...params) as Array<{total:number}>;
    let ordemPrioridade = '';
    if (lado === 'ADQUIRENTE' && referenciaErp) {
      const adicionarReferencia = (valor: unknown) => { params.push(valor); return `$${params.length}`; };
      const valorCentavosErp = Math.round(moedaParaNumeroCanonico(referenciaErp.valor_bruto) * 100);
      const valorReferencia = adicionarReferencia(valorCentavosErp);
      // Na conciliação manual o valor é deliberadamente o único critério de
      // relevância: valores idênticos vêm primeiro e, depois, a menor diferença.
      ordemPrioridade = `CASE WHEN ${sqlValorCentavos('a')}=${valorReferencia} THEN 0 ELSE 1 END, ABS(${sqlValorCentavos('a')}-${valorReferencia}),`;
    }
    params.push(tamanho, inicio);
    const rows=await db.$queryRawUnsafe(
      `SELECT ${alias}.row_id AS id, ${alias}.dados FROM ${tabela} ${alias} WHERE ${where}
       ORDER BY ${ordemPrioridade}${sqlDataNormalizada(alias)} DESC, COALESCE(${alias}.dados->>'hora_venda',${alias}.dados->>'data_venda_hora','') DESC, ${alias}.pk DESC
       LIMIT $${params.length-1} OFFSET $${params.length}`,...params,
    ) as Array<{id:string;dados:Record<string,unknown>}>;
    return { lado, linhas: rows.map(r=>aplicarBandeiraParaExibicao({...r.dados,id:r.id})), total_linhas:Number(totalRows[0]?.total||0), limite:tamanho, offset:inicio, priorizacao_erp_id: referenciaErp ? idReferencia : '' };
  }
  const dados = lado === 'ERP' ? await lerTabela<VendaInterdata[]>(vendasInterdataTabela, []) : await lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela, []);
  const referenciaErp = lado === 'ADQUIRENTE' && priorizarErpId
    ? (await lerTabela<VendaInterdata[]>(vendasInterdataTabela, [])).find((venda) => venda.id === priorizarErpId) || null
    : null;
  const termoUpper=termo.toUpperCase();
  const normalizarDataManual=(valor:any)=>{ const t=String(valor||'').trim(); const iso=t.match(/^(\d{4})-(\d{2})-(\d{2})/); if(iso)return `${iso[1]}-${iso[2]}-${iso[3]}`; const br=t.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return br?`${br[3]}-${br[2]}-${br[1]}`:''; };
  const filtrados=(dados as any[]).filter(v=>!String(v.conciliacao_id||'').trim() && statusConciliacaoVenda(v)==='PENDENTE')
    .filter(v=>!registroContemNaoAplica(v))
    .filter(v=>textoFiltro(v.duplicidade_status)!=='DUPLICADO_PROVAVEL')
    .filter(v=>lado==='ERP'||textoFiltro(v.pix_redundante)!=='SIM')
    .filter(v=>lado==='ERP'||textoFiltro(v.status_transacao)==='AUTORIZADO')
    .filter(v=>!termoUpper || [v.nsu,v.codigo_autorizacao,v.autorizacao,v.valor_bruto, termoValor ? String(v.valor_bruto||'').replace(',','.') : ''].some(x=>String(x||'').toUpperCase().includes(termoUpper) || (!!termoValor && String(x||'').includes(termoValor))))
    .filter(v=>!inicioData || normalizarDataManual(v.data_venda)>=inicioData)
    .filter(v=>!fimData || normalizarDataManual(v.data_venda)<=fimData)
    .filter(v=>!filtroEstabelecimento || textoFiltro(lado==='ERP' ? (v.cnpj_estabelecimento || v.codigo_estabelecimento) : (v.codigo_estabelecimento || v.cnpj_estabelecimento))===filtroEstabelecimento)
    .filter(v=>lado==='ERP'||!filtroAdquirente||textoFiltro(v.adquirente)===filtroAdquirente)
    .sort((a,b)=>{
      if (!referenciaErp) return chaveOrdenacaoVendaDesc(b).localeCompare(chaveOrdenacaoVendaDesc(a));
      const valorReferencia = moedaParaNumeroCanonico(referenciaErp.valor_bruto);
      const diffA = Math.abs(moedaParaNumeroCanonico(a.valor_bruto) - valorReferencia);
      const diffB = Math.abs(moedaParaNumeroCanonico(b.valor_bruto) - valorReferencia);
      if (diffA !== diffB) return diffA - diffB;
      return chaveOrdenacaoVendaDesc(b).localeCompare(chaveOrdenacaoVendaDesc(a));
    });
  return {lado,linhas:filtrados.slice(inicio,inicio+tamanho).map(v=>aplicarBandeiraParaExibicao(v)),total_linhas:filtrados.length,limite:tamanho,offset:inicio,priorizacao_erp_id:referenciaErp?priorizarErpId:''};
}

export async function criarConciliacaoManual(vendaInterdataId: string, vendaAdquirenteId: string, motivo = '', ator: AtorConciliacao = {}, recebimento = false) {
  let erpId=String(vendaInterdataId||'').trim();
  const adqId=String(vendaAdquirenteId||'').trim();
  const motivoLimpo=String(motivo||'').trim();
  const criarRecebimento=Boolean(recebimento);
  if (!adqId || (!erpId && !criarRecebimento)) throw new Error('Selecione uma venda da adquirente e uma venda do ERP ou marque Recebimento.');
  if (motivoLimpo.length < 3) throw new Error('Informe um motivo com pelo menos 3 caracteres.');
  const agora=new Date().toISOString();
  const sufixo=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  if (criarRecebimento) erpId=`RECEBIMENTO-${sufixo}`;
  const id=`MANUAL-${sufixo}`;
  const tipoMatch=criarRecebimento?'MANUAL_RECEBIMENTO':'MANUAL';
  const criterios=criarRecebimento?['Recebimento de contas criado a partir da adquirente selecionada']:['Seleção manual ERP x adquirente'];
  const conciliacao: ConciliacaoVenda={id,venda_adquirente_id:adqId,venda_interdata_id:erpId,status:'CONCILIADO',tipo_match:tipoMatch,score:100,criterios_usados:criterios,diferenca_valor:0,diferenca_dias:0,automatico:false,data_conciliacao:agora,observacoes:motivoLimpo,classificacao:criarRecebimento?'RECEBIMENTO':'MANUAL',versao_motor:'manual-v0.1.139'};
  if (usarPostgres()) {
    await garantirDbPostgres(); const db=await getDatabase();
    await db.$transaction(async tx=>{
      const adqRows=await tx.$queryRawUnsafe(`SELECT row_id,conciliacao_id,dados FROM vendas_adquirentes WHERE row_id=$1 FOR UPDATE`,adqId) as Array<any>;
      const adq=adqRows[0];
      if(!adq) throw new Error('A venda da adquirente selecionada não foi encontrada.');
      if(adq.conciliacao_id) throw new Error('A venda da adquirente já foi conciliada por outra operação. Atualize a tela e selecione novamente.');

      if(criarRecebimento){
        const dadosAdq=adq.dados||{};
        const recebimentoErp: VendaInterdata & {origem_erp:string} = {
          id:erpId,
          importacao_id:'RECEBIMENTO_MANUAL',
          venda_erp_id:erpId,
          numero_linha:0,
          data_venda:String(dadosAdq.data_venda||''),
          hora_venda:String(dadosAdq.hora_venda||dadosAdq.data_venda_hora||''),
          terminal:String(dadosAdq.terminal||''),
          nsu:String(dadosAdq.nsu||''),
          codigo_autorizacao:String(dadosAdq.codigo_autorizacao||dadosAdq.autorizacao||''),
          valor_bruto:String(dadosAdq.valor_bruto||''),
          forma_pagamento:String(dadosAdq.modalidade||''),
          forma_pagamento_original:String(dadosAdq.modalidade_original||dadosAdq.modalidade||''),
          bandeira:String(dadosAdq.bandeira||''),
          bandeira_original:String(dadosAdq.bandeira_original||dadosAdq.bandeira||''),
          tipo_produto:String(dadosAdq.modalidade||''),
          tipo_produto_original:String(dadosAdq.modalidade_original||dadosAdq.modalidade||''),
          parcelas:String(dadosAdq.parcelas||''),
          cnpj_estabelecimento:String(dadosAdq.cnpj_estabelecimento||''),
          id_venda_erp:erpId,
          status_venda:String(dadosAdq.status_transacao||'RECEBIMENTO'),
          status_venda_original:String(dadosAdq.status_transacao_original||dadosAdq.status_transacao||'RECEBIMENTO'),
          hash_linha:`RECEBIMENTO-${adqId}-${sufixo}`,
          dados_originais:{origem:'Recebimento de contas',adquirente_origem:String(dadosAdq.adquirente||'')},
          data_criacao:agora,
          origem_erp:'Recebimento de contas',
        };
        await tx.$executeRawUnsafe(`INSERT INTO vendas_interdata (row_id,hash_linha,dados,data_criacao,data_atualizacao) VALUES ($1,$2,$3::jsonb,NOW(),NOW())`,erpId,recebimentoErp.hash_linha,stringifyJsonbSeguro(recebimentoErp as any));
      } else {
        const erp=await tx.$queryRawUnsafe(`SELECT row_id,conciliacao_id FROM vendas_interdata WHERE row_id=$1 FOR UPDATE`,erpId) as Array<any>;
        if(!erp[0]) throw new Error('A venda do ERP selecionada não foi encontrada.');
        if(erp[0].conciliacao_id) throw new Error('A venda do ERP já foi conciliada por outra operação. Atualize a tela e selecione novamente.');
      }

      await tx.$executeRawUnsafe(`INSERT INTO conciliacoes (row_id,dados,venda_adquirente_id,venda_interdata_id,status,data_criacao,data_atualizacao) VALUES ($1,$2::jsonb,$3,$4,'CONCILIADO',NOW(),NOW())`,id,stringifyJsonbSeguro(conciliacao as any),adqId,erpId);
      const dadosVenda=stringifyJsonbSeguro(dadosVendaComConciliacao(conciliacao,'CONCILIADO'));
      await tx.$executeRawUnsafe(`UPDATE vendas_adquirentes SET conciliacao_id=$1,dados=dados||$2::jsonb,data_atualizacao=NOW() WHERE row_id=$3`,id,dadosVenda,adqId);
      await tx.$executeRawUnsafe(`UPDATE vendas_interdata SET conciliacao_id=$1,dados=dados||$2::jsonb,data_atualizacao=NOW() WHERE row_id=$3`,id,dadosVenda,erpId);
      await tx.$executeRawUnsafe(`INSERT INTO historico_conciliacoes (conciliacao_id,acao,status_anterior,status_novo,motivo,usuario_id,usuario_nome,detalhes) VALUES ($1,$2,'PENDENTE','CONCILIADO',$3,$4,$5,$6::jsonb)`,id,criarRecebimento?'CONCILIAR_RECEBIMENTO':'CONCILIAR_MANUALMENTE',motivoLimpo,ator.id||null,ator.nome||ator.login||null,JSON.stringify({venda_interdata_id:erpId,venda_adquirente_id:adqId,recebimento:criarRecebimento,erp_sintetico:criarRecebimento?'Recebimento de contas':null}));
    });
    return {sucesso:true,conciliacao,recebimento:criarRecebimento};
  }
  const [erps,adqs,concs]=await Promise.all([lerTabela<VendaInterdata[]>(vendasInterdataTabela,[]),lerTabela<VendaAdquirente[]>(vendasAdquirentesTabela,[]),lerTabela<ConciliacaoVenda[]>(conciliacoesTabela,[])]);
  const adq=adqs.find(v=>v.id===adqId);
  if(!adq) throw new Error('A venda da adquirente selecionada não foi encontrada.');
  if(String(adq.conciliacao_id||'').trim()) throw new Error('A venda da adquirente já está conciliada.');
  let erpsAtualizados=[...erps];
  if(criarRecebimento){
    const recebimentoErp: VendaInterdata & {origem_erp:string}={
      id:erpId,importacao_id:'RECEBIMENTO_MANUAL',venda_erp_id:erpId,numero_linha:0,data_venda:adq.data_venda,hora_venda:adq.hora_venda,terminal:adq.terminal,nsu:adq.nsu,codigo_autorizacao:adq.codigo_autorizacao,valor_bruto:adq.valor_bruto,forma_pagamento:adq.modalidade,forma_pagamento_original:adq.modalidade_original||adq.modalidade,bandeira:adq.bandeira,bandeira_original:adq.bandeira_original||adq.bandeira,tipo_produto:adq.modalidade,tipo_produto_original:adq.modalidade_original||adq.modalidade,parcelas:adq.parcelas,cnpj_estabelecimento:adq.cnpj_estabelecimento,id_venda_erp:erpId,status_venda:adq.status_transacao||'RECEBIMENTO',status_venda_original:adq.status_transacao_original||adq.status_transacao||'RECEBIMENTO',hash_linha:`RECEBIMENTO-${adqId}-${sufixo}`,dados_originais:{origem:'Recebimento de contas',adquirente_origem:adq.adquirente},data_criacao:agora,origem_erp:'Recebimento de contas'};
    erpsAtualizados.push(recebimentoErp);
  } else {
    const erp=erps.find(v=>v.id===erpId);
    if(!erp) throw new Error('A venda do ERP selecionada não foi encontrada.');
    if(String(erp.conciliacao_id||'').trim()) throw new Error('A venda do ERP já está conciliada.');
  }
  erpsAtualizados=erpsAtualizados.map(v=>v.id===erpId?{...v,...dadosVendaComConciliacao(conciliacao,'CONCILIADO')}:v);
  await Promise.all([
    gravarTabela(conciliacoesTabela,[...concs,conciliacao]),
    gravarTabela(vendasInterdataTabela,erpsAtualizados),
    gravarTabela(vendasAdquirentesTabela,adqs.map(v=>v.id===adqId?{...v,...dadosVendaComConciliacao(conciliacao,'CONCILIADO')}:v)),
  ]);
  return {sucesso:true,conciliacao,recebimento:criarRecebimento};
}

export function obterRelatorioRegrasConciliacaoAutomatica() {
  return {
    funcionando: true,
    tabelas: {
      adquirentes: 'vendas_adquirentes',
      erp: 'vendas_interdata',
      matches: 'conciliacoes',
    },
    campos_gravados: {
      conciliacoes: ['id', 'venda_adquirente_id', 'venda_interdata_id', 'status', 'tipo_match', 'score', 'criterios_usados', 'diferenca_valor', 'diferenca_dias', 'segundo_melhor_score', 'diferenca_para_segundo', 'quantidade_candidatos_equivalentes', 'automatico', 'data_conciliacao', 'observacoes'],
      vendas_adquirentes: ['conciliacao_id', 'status_conciliacao', 'score_conciliacao', 'tipo_match'],
      vendas_interdata: ['conciliacao_id', 'status_conciliacao', 'score_conciliacao', 'tipo_match'],
    },
    regras: [
      {
        nome: 'NSU',
        prioridade: 1,
        colunas_adquirente: ['nsu', 'valor_bruto', 'data_venda', 'terminal', 'modalidade'],
        colunas_interdata: ['nsu', 'valor_bruto', 'data_venda', 'terminal', 'tipo_produto/forma_pagamento'],
        descricao: 'Primeiro tenta NSU igual. Valor, data, terminal e modalidade aumentam o score.',
      },
      {
        nome: 'AUTORIZACAO',
        prioridade: 2,
        colunas_adquirente: ['codigo_autorizacao', 'valor_bruto', 'data_venda', 'terminal', 'modalidade'],
        colunas_interdata: ['codigo_autorizacao/autorizacao', 'valor_bruto', 'data_venda', 'terminal', 'tipo_produto/forma_pagamento'],
        descricao: 'Usada quando não há NSU igual. Autorização igual com valor/data compatíveis gera score alto.',
      },
      {
        nome: 'VALOR_DATA',
        prioridade: 3,
        colunas_adquirente: ['valor_bruto', 'data_venda', 'terminal', 'modalidade'],
        colunas_interdata: ['valor_bruto', 'data_venda', 'terminal', 'tipo_produto/forma_pagamento'],
        descricao: 'Usada como fallback para valor igual e data igual ou próxima. Nunca gera conciliação automática; exige revisão manual.',
      },
    ],
    limites_score: {
      sugestao_minima: 50,
      conciliacao_automatica: 51,
      diferenca_minima_primeiro_segundo: 10,
    },
    fluxo: [
      'Busca apenas vendas PENDENTES e ainda sem conciliacao_id.',
      'Ignora adquirentes que não são venda/autorização canônica.',
      'Avalia candidatos por NSU, autorização e valor + data.',
      'CONCILIADO automático exige NSU ou autorização, valor exato, data compatível e ausência de ambiguidade.',
      'VALOR_DATA sempre vira SUGERIDO, independentemente do score.',
      'Diferença inferior a 10 pontos entre os dois melhores candidatos vira AMBIGUO.',
      'Ao confirmar ou desfazer, atualiza conciliacao_id/status_conciliacao nas duas tabelas de venda.',
    ],
  };
}

export async function listarVendasErpComExibicao(limite = 500, offset = 0, filtros: FiltrosListagemVendas = {}) {
  return listarVendasPostgres(limite, offset, filtros, { tabela: 'vendas_interdata', estabelecimento: 'estabelecimento_filtro', modalidade: 'modalidade_filtro', status: 'status_filtro' });
  const vendas = await lerTabela<VendaInterdata[]>(vendasInterdataTabela, []);
  const inicio = Math.max(0, Number(offset || 0));
  const tamanhoPagina = Math.max(1, Number(limite || 500));
  const filtradas = [...vendas]
    .filter((venda) => filtrarVendaErp(venda, filtros))
    .sort(ordenarPorDataVendaDecrescente);
  return {
    linhas: filtradas.slice(inicio, inicio + tamanhoPagina),
    total_linhas: filtradas.length,
    limite: tamanhoPagina,
    offset: inicio,
  };
}

export async function listarTabelasBanco() {
  await garantirDb();
  const db = await getDatabase();
  // A antiga rajada paralela de uma consulta por tabela esgotava o pool quando conversões ou
  // conciliação estavam em execução. O UNION ALL usa uma única conexão e mantém
  // as contagens exatas sem criar uma rajada de aquisições simultâneas.
  const sqlContagens = tabelasSistema
    .map((tabela, indice) => `SELECT $${indice + 1}::text AS nome, COUNT(*)::bigint AS total FROM ${nomeTabelaSeguro(tabela.nome)}`)
    .join(' UNION ALL ');
  const contagens = await db.$queryRawUnsafe(sqlContagens, ...tabelasSistema.map((tabela) => tabela.nome)) as Array<{ nome: string; total: string }>;
  const totalPorTabela = new Map(contagens.map((item) => [item.nome, Number(item.total || 0)]));
  return tabelasSistema.map((tabela) => {
    return {
      nome: tabela.nome,
      titulo: tabela.titulo,
      descricao: tabela.descricao,
      quantidade_colunas: tabela.colunas.length,
      quantidade_linhas: totalPorTabela.get(tabela.nome) || 0,
      colunas: tabela.colunas,
    };
  });
}

export async function obterDadosTabela(nomeTabela: string, limite = 500, offset = 0, cursorPk?: number) {
  const tabela = tabelasSistema.find((item) => item.nome === nomeTabela);
  if (!tabela) return null;
  await garantirTabelaPostgres(nomeTabela);
  const db = await getDatabase();
  const tabelaSql = nomeTabelaSeguro(nomeTabela);
  const tamanhoPagina = Math.min(Math.max(1, Number(limite || 500)), 2_000);
  const inicio = Math.max(0, Number(offset || 0));
  const parametros: unknown[] = [];
  const condicoesBase: string[] = [];
  if (nomeTabela === 'vendas_adquirentes') {
    condicoesBase.push(`COALESCE(dados->>'tipo_registro','VENDA') = 'VENDA'`);
    condicoesBase.push(`NOT (${sqlRegistroNaoAplicavel('vendas_adquirentes')})`);
  }
  if (nomeTabela === 'vendas_interdata') condicoesBase.push(`NOT (${sqlRegistroNaoAplicavel('vendas_interdata')})`);
  let where = condicoesBase.length ? `WHERE ${condicoesBase.join(' AND ')}` : '';
  if (Number.isFinite(cursorPk) && Number(cursorPk) > 0) {
    parametros.push(Number(cursorPk));
    where += `${where ? ' AND' : 'WHERE'} pk < $${parametros.length}`;
  }
  const whereContagem = condicoesBase.length ? `WHERE ${condicoesBase.join(' AND ')}` : '';
  const totalRows = await db.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS total FROM ${tabelaSql} ${whereContagem}`) as Array<{ total: string }>;
  parametros.push(tamanhoPagina);
  const limitParam = `$${parametros.length}`;
  let paginacao = `LIMIT ${limitParam}`;
  if (!(Number.isFinite(cursorPk) && Number(cursorPk) > 0)) { parametros.push(inicio); paginacao += ` OFFSET $${parametros.length}`; }
  const rows = await db.$queryRawUnsafe(`SELECT pk, dados FROM ${tabelaSql} ${where} ORDER BY pk DESC ${paginacao}`, ...parametros) as Array<{ pk: string; dados: Record<string, unknown> }>;
  let linhas = rows.map((row) => row.dados);

  if (nomeTabela === 'vendas_adquirentes') {
    linhas = (linhas as VendaAdquirente[])
      .filter(ehVendaCanonicaAdquirente)
      .map((venda) => aplicarBandeiraParaExibicao({ ...venda, valor_taxa: normalizarValorTaxaPositivo(venda.valor_taxa) as string | undefined, percentual_taxa: venda.percentual_taxa || calcularPercentualTaxa(venda.valor_bruto, venda.valor_taxa) })) as unknown as Record<string, unknown>[];
  }
  if (nomeTabela === 'vendas_interdata') linhas = linhas.map((linha) => aplicarBandeiraParaExibicao(linha));

  const total_linhas = Number(totalRows[0]?.total || 0);
  let linhasLimitadas = linhas;

  if (nomeTabela === 'vendas_adquirentes') {
    linhasLimitadas = await Promise.all(linhasLimitadas.map((linha) => aplicarConversoesEmLinha(nomeTabela, linha)));
  }

  const tabelasComSchemaFixo = new Set(['sipag_fiserv_layout_7_6_s_pix', 'sipag_fiserv_layout_7_6_s_cartoes', 'sipag_fiserv_layout_7_6_p', 'sipag_layout_2_0_s_pix', 'sipag_layout_2_0_s_cartoes', 'sipag_layout_2_0_p', 'sipag_layout_2_0_r', 'sicredi_fiserv_layout_7_4_s_pix', 'sicredi_fiserv_layout_7_4_s_cartoes', 'sicredi_fiserv_layout_7_4_p', 'sicredi_fiserv_layout_7_4_r', 'cielo_layout_15_15_cielo03', 'cielo_layout_15_15_cielo16', 'cielo_layout_15_15_cielo04', 'convcard_layout_2_0_3_cv', 'convcard_layout_2_0_3_cp', 'convcard_layout_2_0_3_cc', 'convcard_layout_2_0_3_tb', 'convcard_layout_2_0_3_controle']);
  const colunasDinamicas = tabelasComSchemaFixo.has(nomeTabela)
    ? []
    : Array.from(new Set(linhasLimitadas.flatMap((linha) => Object.keys(linha).filter((coluna) => coluna !== 'valores_exibicao'))));
  const colunas = Array.from(new Set([...tabela.colunas, ...colunasDinamicas]));
  return {
    nome: tabela.nome,
    titulo: tabela.titulo,
    descricao: tabela.descricao,
    colunas,
    linhas: linhasLimitadas,
    total_linhas,
    limite: tamanhoPagina,
    offset: inicio,
    proximo_cursor: rows.length === tamanhoPagina ? Number(rows.at(-1)?.pk) : null,
  };
}


export async function limparTabelaBanco(nomeTabela: string) {
  const tabela = tabelasSistema.find((item) => item.nome === nomeTabela);
  if (!tabela) return null;
  await garantirDb();
  await gravarTabela(tabela.arquivo, []);

  // Se a tabela de conversões for limpa, não recriamos sementes automaticamente nesta chamada.
  // Assim o usuário tem controle total sobre as regras manuais cadastradas.
  return {
    sucesso: true,
    tabela: tabela.nome,
    mensagem: `Todos os registros da tabela ${tabela.nome} foram apagados com sucesso.`,
  };
}

export async function criarConversaoManual(data: Partial<Conversao>) {
  await garantirDb();
  const tabela_origem = String(data.tabela_origem || '').trim();
  const coluna_origem = String(data.coluna_origem || '').trim();
  const tipo_conversao: Conversao['tipo_conversao'] = data.tipo_conversao === 'TRANSFORMACAO_DATA' ? 'TRANSFORMACAO_DATA' : 'VALOR_EXATO';
  // Valor vazio é uma entrada legítima para conversão exata. Espaços informados no formulário
  // são normalizados para string vazia, permitindo regras como '' → 'VALOR REAL'.
  const valor_original = String(data.valor_original ?? '').trim();
  const valor_exibicao = String(data.valor_exibicao ?? '').trim();
  const adquirente_aplicacao = String(data.adquirente_aplicacao || '').trim().toUpperCase();
  const formato_origem = tipo_conversao === 'TRANSFORMACAO_DATA' ? String(data.formato_origem || '').trim().toUpperCase() : undefined;
  const formato_destino = tipo_conversao === 'TRANSFORMACAO_DATA' ? String(data.formato_destino || '').trim().toUpperCase() : undefined;

  if (!tabela_origem || !coluna_origem) {
    throw new Error('Preencha tabela_origem e coluna_origem.');
  }
  if (!['vendas_interdata','vendas_adquirentes'].includes(tabela_origem)) {
    throw new Error('Conversões só podem ser cadastradas para vendas_interdata ou vendas_adquirentes. Tabelas brutas de layout preservam o EDI original.');
  }
  if (tabela_origem === 'vendas_adquirentes' && coluna_origem === 'percentual_taxa') {
    throw new Error('percentual_taxa é um campo derivado de valor_bruto e valor_taxa e não aceita conversão manual.');
  }
  if (tipo_conversao === 'VALOR_EXATO' && !valor_exibicao) {
    throw new Error('Preencha valor_exibicao. O valor_original pode ser vazio.');
  }
  if (tipo_conversao === 'TRANSFORMACAO_DATA' && (formato_origem !== 'DDMMYYYY' || formato_destino !== 'YYYY-MM-DD')) {
    throw new Error('Para transformação de data, use DDMMYYYY → YYYY-MM-DD.');
  }

  const registros = await lerTabela<Conversao[]>(conversoesTabela, []);
  const agora = new Date().toISOString();
  const conversao: Conversao = {
    id: `conv-${Date.now()}`,
    tabela_origem,
    coluna_origem,
    tipo_conversao,
    formato_origem: formato_origem as Conversao['formato_origem'],
    formato_destino: formato_destino as Conversao['formato_destino'],
    valor_original: tipo_conversao === 'TRANSFORMACAO_DATA' ? '' : valor_original,
    valor_exibicao: tipo_conversao === 'TRANSFORMACAO_DATA' ? '' : valor_exibicao,
    adquirente_aplicacao,
    ativo: data.ativo === false ? false : true,
    observacao: String(data.observacao || '').trim(),
    data_criacao: agora,
    data_atualizacao: agora,
  };

  registros.push(conversao);
  await gravarTabela(conversoesTabela, registros);
  return conversao;
}

export async function atualizarConversaoManual(id: string, data: Partial<Conversao>) {
  await garantirDb();
  const registros = await lerTabela<Conversao[]>(conversoesTabela, []);
  const index = registros.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const atual = registros[index];
  const tipoNovo: Conversao['tipo_conversao'] = data.tipo_conversao !== undefined
    ? (data.tipo_conversao === 'TRANSFORMACAO_DATA' ? 'TRANSFORMACAO_DATA' : 'VALOR_EXATO')
    : tipoConversao(atual);
  registros[index] = {
    ...atual,
    tabela_origem: data.tabela_origem !== undefined ? String(data.tabela_origem).trim() : atual.tabela_origem,
    coluna_origem: data.coluna_origem !== undefined ? String(data.coluna_origem).trim() : atual.coluna_origem,
    tipo_conversao: tipoNovo,
    formato_origem: tipoNovo === 'TRANSFORMACAO_DATA' ? ((data.formato_origem !== undefined ? String(data.formato_origem).trim().toUpperCase() : atual.formato_origem) as Conversao['formato_origem']) : undefined,
    formato_destino: tipoNovo === 'TRANSFORMACAO_DATA' ? ((data.formato_destino !== undefined ? String(data.formato_destino).trim().toUpperCase() : atual.formato_destino) as Conversao['formato_destino']) : undefined,
    valor_original: tipoNovo === 'TRANSFORMACAO_DATA' ? '' : (data.valor_original !== undefined ? String(data.valor_original ?? '').trim() : atual.valor_original),
    valor_exibicao: tipoNovo === 'TRANSFORMACAO_DATA' ? '' : (data.valor_exibicao !== undefined ? String(data.valor_exibicao ?? '').trim() : atual.valor_exibicao),
    adquirente_aplicacao: data.adquirente_aplicacao !== undefined ? String(data.adquirente_aplicacao || '').trim().toUpperCase() : atual.adquirente_aplicacao,
    ativo: data.ativo !== undefined ? Boolean(data.ativo) : atual.ativo,
    observacao: data.observacao !== undefined ? String(data.observacao || '').trim() : atual.observacao,
    data_atualizacao: new Date().toISOString(),
  };
  const nova = registros[index];
  if (!nova.tabela_origem || !nova.coluna_origem) throw new Error('Preencha tabela_origem e coluna_origem.');
  if (!['vendas_interdata','vendas_adquirentes'].includes(nova.tabela_origem)) throw new Error('Conversões só podem ser cadastradas para vendas_interdata ou vendas_adquirentes. Tabelas brutas de layout preservam o EDI original.');
  if (nova.tabela_origem === 'vendas_adquirentes' && nova.coluna_origem === 'percentual_taxa') {
    throw new Error('percentual_taxa é um campo derivado de valor_bruto e valor_taxa e não aceita conversão manual.');
  }
  if (tipoConversao(nova) === 'VALOR_EXATO' && !nova.valor_exibicao) throw new Error('Preencha valor_exibicao. O valor_original pode ser vazio.');
  if (tipoConversao(nova) === 'TRANSFORMACAO_DATA' && (nova.formato_origem !== 'DDMMYYYY' || nova.formato_destino !== 'YYYY-MM-DD')) {
    throw new Error('Para transformação de data, use DDMMYYYY → YYYY-MM-DD.');
  }
  await gravarTabela(conversoesTabela, registros);
  return nova;
}

export async function excluirConversaoManual(id: string) {
  await garantirDb();
  const registros = await lerTabela<Conversao[]>(conversoesTabela, []);
  const restante = registros.filter((item) => item.id !== id);
  if (restante.length === registros.length) return null;
  await gravarTabela(conversoesTabela, restante);
  return { sucesso: true, id };
}

export type CatalogoBinItem = {
  bin: string;
  bandeira: string;
  status: 'IDENTIFICADO' | 'PENDENTE';
  origem: string;
  ativo: boolean;
  observacao: string;
  quantidade_transacoes: number;
  modalidades: string[];
  conversao_id: string;
  data_atualizacao: string;
  emissor?: string;
  pais?: string;
  tipo_cartao?: string;
  consulta_online_status?: string;
  consulta_online_em?: string;
  consulta_online_erro?: string;
};

async function sincronizarCatalogoBinsPostgres(importacaoIds: string[] = []) {
  const db = await getDatabase();
  await db.$executeRawUnsafe(`
    INSERT INTO catalogo_bins (bin,status,origem)
    SELECT DISTINCT COALESCE(NULLIF(dados->>'bandeira_original',''), dados->>'bandeira'),
           'PENDENTE', 'IMPORTACAO'
      FROM vendas_adquirentes
     WHERE UPPER(COALESCE(dados->>'adquirente','')) = 'SIPAG'
       AND COALESCE(NULLIF(dados->>'bandeira_original',''), dados->>'bandeira') ~ '^[0-9]{6}$'
       AND ($1::text[] = '{}'::text[] OR COALESCE(NULLIF(dados->>'ultima_importacao_id',''),NULLIF(dados->'dados_json'->>'ultima_importacao_id',''),dados->>'importacao_id','') = ANY($1::text[]))
    ON CONFLICT (bin) DO NOTHING
  `, importacaoIds);
  // A base local resolve primeiro os BINs realmente observados. Decisões manuais
  // existentes têm prioridade e não são sobrescritas.
  await db.$executeRawUnsafe(`
    INSERT INTO catalogo_bins (bin,bandeira,status,origem,ativo,observacao,emissor,pais,tipo_cartao,data_atualizacao)
    SELECT r.bin,r.bandeira,'IDENTIFICADO','BASE_LOCAL_CC_BY_4',TRUE,
           'Base brasileira CC BY 4.0; validar em caso de divergência',r.emissor,r.pais,r.tipo_cartao,NOW()
      FROM catalogo_bins_referencia r
     WHERE EXISTS (
       SELECT 1 FROM catalogo_bins c WHERE c.bin=r.bin
     )
    ON CONFLICT (bin) DO UPDATE SET bandeira=EXCLUDED.bandeira,status='IDENTIFICADO',origem='BASE_LOCAL_CC_BY_4',
      emissor=EXCLUDED.emissor,pais=EXCLUDED.pais,tipo_cartao=EXCLUDED.tipo_cartao,data_atualizacao=NOW()
    WHERE catalogo_bins.status='PENDENTE' OR COALESCE(TRIM(catalogo_bins.bandeira),'')=''
  `);
  await db.$executeRawUnsafe(`
    INSERT INTO conversoes (row_id,hash_linha,dados,data_criacao,data_atualizacao)
    SELECT 'conv-bin-local-'||r.bin,'conv-bin-local-'||r.bin,
      jsonb_build_object('id','conv-bin-local-'||r.bin,'tabela_origem','vendas_adquirentes','coluna_origem','bandeira',
        'tipo_conversao','VALOR_EXATO','valor_original',r.bin,'valor_exibicao',r.bandeira,'adquirente_aplicacao','SIPAG',
        'ativo',TRUE,'observacao','Criada pela base local brasileira de BINs (CC BY 4.0)',
        'data_criacao',NOW()::text,'data_atualizacao',NOW()::text),NOW(),NOW()
      FROM catalogo_bins_referencia r
     WHERE EXISTS (
       SELECT 1 FROM catalogo_bins b WHERE b.bin=r.bin
     )
       AND NOT EXISTS (
         SELECT 1 FROM conversoes c WHERE c.dados->>'tabela_origem'='vendas_adquirentes'
           AND c.dados->>'coluna_origem'='bandeira' AND TRIM(c.dados->>'valor_original')=r.bin
           AND UPPER(COALESCE(c.dados->>'adquirente_aplicacao','')) IN ('','TODAS','SIPAG')
       )
    ON CONFLICT DO NOTHING
  `);
}

export async function listarCatalogoBins(filtros: { status?: string; busca?: string; limite?: number; offset?: number } = {}) {
  await garantirDb();
  await sincronizarCatalogoBinsPostgres();
  const db = await getDatabase();
  const limite = Math.min(500, Math.max(1, Number(filtros.limite || 100)));
  const offset = Math.max(0, Number(filtros.offset || 0));
  const status = String(filtros.status || '').trim().toUpperCase();
  const busca = String(filtros.busca || '').trim().toUpperCase();
  const clausulas: string[] = ['c.ativo = TRUE'];
  const parametros: unknown[] = [];
  if (['IDENTIFICADO','PENDENTE'].includes(status)) { parametros.push(status); clausulas.push(`c.status = $${parametros.length}`); }
  if (busca) { parametros.push(`%${busca}%`); clausulas.push(`(c.bin LIKE $${parametros.length} OR UPPER(COALESCE(c.bandeira,'')) LIKE $${parametros.length})`); }
  const where = `WHERE ${clausulas.join(' AND ')}`;
  const baseObservada = `
    SELECT COALESCE(NULLIF(dados->>'bandeira_original',''), dados->>'bandeira') AS bin,
           COUNT(*)::int AS quantidade_transacoes,
           ARRAY_AGG(DISTINCT UPPER(COALESCE(dados->>'modalidade','')) ORDER BY UPPER(COALESCE(dados->>'modalidade',''))) AS modalidades
      FROM vendas_adquirentes
     WHERE UPPER(COALESCE(dados->>'adquirente','')) = 'SIPAG'
       AND COALESCE(NULLIF(dados->>'bandeira_original',''), dados->>'bandeira') ~ '^[0-9]{6}$'
     GROUP BY 1`;
  const totalRows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int total FROM catalogo_bins c ${where}`, ...parametros) as Array<{ total: number }>;
  const resumoRows = await db.$queryRawUnsafe(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='IDENTIFICADO')::int identificados, COUNT(*) FILTER (WHERE status='PENDENTE')::int pendentes FROM catalogo_bins WHERE ativo=TRUE`) as Array<{total:number;identificados:number;pendentes:number}>;
  const itens = await db.$queryRawUnsafe(
    `SELECT c.bin,COALESCE(c.bandeira,'') bandeira,c.status,c.origem,c.ativo,c.observacao,
            c.emissor,c.pais,c.tipo_cartao,c.consulta_online_status,c.consulta_online_em::text,c.consulta_online_erro,
            COALESCE(o.quantidade_transacoes,0)::int quantidade_transacoes,COALESCE(o.modalidades,ARRAY[]::text[]) modalidades,
            COALESCE(conv.dados->>'id','') conversao_id,c.data_atualizacao::text
       FROM catalogo_bins c
       LEFT JOIN (${baseObservada}) o ON o.bin=c.bin
       LEFT JOIN LATERAL (
         SELECT dados FROM conversoes
          WHERE dados->>'tabela_origem'='vendas_adquirentes' AND dados->>'coluna_origem'='bandeira'
            AND TRIM(dados->>'valor_original')=c.bin
          ORDER BY CASE WHEN UPPER(COALESCE(dados->>'adquirente_aplicacao',''))='SIPAG' THEN 0 ELSE 1 END, pk DESC LIMIT 1
       ) conv ON TRUE
       ${where}
       ORDER BY CASE c.status WHEN 'PENDENTE' THEN 0 ELSE 1 END, COALESCE(o.quantidade_transacoes,0) DESC, c.bin
       LIMIT ${limite} OFFSET ${offset}`,
    ...parametros,
  ) as CatalogoBinItem[];
  return { itens, total: Number(totalRows[0]?.total || 0), limite, offset, resumo: resumoRows[0] || { total: 0, identificados: 0, pendentes: 0 } };
}

export async function identificarBinCatalogo(binInput: string, dados: { bandeira?: string; observacao?: string }) {
  await garantirDb();
  const bin = String(binInput || '').replace(/\D/g, '');
  const bandeira = String(dados.bandeira || '').trim().toUpperCase();
  const observacao = String(dados.observacao || '').trim();
  if (!/^\d{6}$/.test(bin)) throw new Error('Informe um BIN com exatamente seis dígitos.');
  if (!bandeira) throw new Error('Informe o nome da bandeira.');

  const regras = await listarConversoes();
  const existente = regras.find((regra) => regra.ativo && regra.tabela_origem === 'vendas_adquirentes'
    && regra.coluna_origem === 'bandeira' && String(regra.valor_original).trim() === bin
    && ['', 'TODAS', 'SIPAG'].includes(String(regra.adquirente_aplicacao || '').trim().toUpperCase()));
  const conversao = existente
    ? await atualizarConversaoManual(existente.id, { valor_exibicao: bandeira, ativo: true })
    : await criarConversaoManual({ tabela_origem: 'vendas_adquirentes', coluna_origem: 'bandeira', tipo_conversao: 'VALOR_EXATO', valor_original: bin, valor_exibicao: bandeira, adquirente_aplicacao: 'SIPAG', ativo: true, observacao: observacao || 'Criada pelo catálogo de BINs' });

  const db = await getDatabase();
  const linhas = await db.$queryRawUnsafe(
    `INSERT INTO catalogo_bins (bin,bandeira,status,origem,ativo,observacao,data_criacao,data_atualizacao)
     VALUES ($1,$2,'IDENTIFICADO','MANUAL',TRUE,$3,NOW(),NOW())
     ON CONFLICT (bin) DO UPDATE SET bandeira=EXCLUDED.bandeira,status='IDENTIFICADO',origem='MANUAL',ativo=TRUE,observacao=EXCLUDED.observacao,data_atualizacao=NOW()
     RETURNING *`, bin, bandeira, observacao,
  ) as CatalogoBinItem[];
  return { sucesso: true, item: linhas[0], conversao, mensagem: `BIN ${bin} identificado como ${bandeira}; conversão pronta para aplicação.` };
}

const BANDEIRAS_BIN_ONLINE: Record<string,string> = {
  visa: 'VISA', mastercard: 'MASTERCARD', maestro: 'MASTERCARD', elo: 'ELO',
  amex: 'AMEX', 'american express': 'AMEX', cabal: 'CABAL', diners: 'DINERS',
  'diners club': 'DINERS', discover: 'DISCOVER', hipercard: 'HIPERCARD', jcb: 'JCB',
};

function bandeiraRespostaBinOnline(payload: Record<string, unknown>) {
  const candidata = String(payload.scheme || payload.brand || '').trim().toLowerCase();
  return BANDEIRAS_BIN_ONLINE[candidata] || (candidata ? candidata.toUpperCase() : '');
}

export async function identificarBinsPendentesOnline(limiteInput = 5) {
  await garantirDb();
  const limiteConfigurado = Math.max(1, Math.min(Number(process.env.BIN_LOOKUP_LIMIT_PER_RUN || 5), 50));
  const limite = Math.max(1, Math.min(Number(limiteInput || limiteConfigurado), limiteConfigurado));
  const base = String(process.env.BIN_LOOKUP_BASE_URL || 'https://lookup.binlist.net').replace(/\/$/, '');
  if (!base.startsWith('https://')) throw new Error('BIN_LOOKUP_BASE_URL deve usar HTTPS.');
  const db = await getDatabase();
  await sincronizarCatalogoBinsPostgres();
  const pendentes = await db.$queryRawUnsafe(
    `SELECT bin FROM catalogo_bins WHERE ativo=TRUE AND status='PENDENTE'
      AND COALESCE(consulta_online_status,'') <> 'NAO_ENCONTRADO'
      ORDER BY COALESCE(consulta_online_em,'1970-01-01'::timestamptz),bin LIMIT $1`, limite,
  ) as Array<{bin:string}>;
  const resultados: Array<{bin:string;status:string;bandeira?:string;erro?:string}> = [];
  for (const item of pendentes) {
    try {
      const headers: Record<string,string> = { 'Accept-Version': '3', Accept: 'application/json' };
      if (process.env.BIN_LOOKUP_API_KEY) headers.Authorization = `Bearer ${process.env.BIN_LOOKUP_API_KEY}`;
      const response = await fetch(`${base}/${item.bin}`, { headers, signal: AbortSignal.timeout(10000) });
      if (response.status === 429) {
        await db.$executeRawUnsafe(`UPDATE catalogo_bins SET consulta_online_status='LIMITE_ATINGIDO',consulta_online_em=NOW(),consulta_online_erro='Limite do provedor atingido',data_atualizacao=NOW() WHERE bin=$1`, item.bin);
        resultados.push({ bin:item.bin,status:'LIMITE_ATINGIDO',erro:'Limite do provedor atingido' });
        break;
      }
      if (response.status === 404) {
        await db.$executeRawUnsafe(`UPDATE catalogo_bins SET consulta_online_status='NAO_ENCONTRADO',consulta_online_em=NOW(),consulta_online_erro='BIN não encontrado no provedor',data_atualizacao=NOW() WHERE bin=$1`, item.bin);
        resultados.push({ bin:item.bin,status:'NAO_ENCONTRADO' });
        continue;
      }
      if (!response.ok) throw new Error(`Provedor respondeu HTTP ${response.status}`);
      const payload = await response.json() as Record<string, any>;
      const bandeira = bandeiraRespostaBinOnline(payload);
      if (!bandeira) throw new Error('Provedor não informou a bandeira');
      await identificarBinCatalogo(item.bin, { bandeira, observacao: 'Identificado por consulta online; revise antes de aplicar as conversões.' });
      await db.$executeRawUnsafe(
        `UPDATE catalogo_bins SET origem='ONLINE',emissor=$2,pais=$3,tipo_cartao=$4,consulta_online_status='IDENTIFICADO',consulta_online_em=NOW(),consulta_online_erro='',data_atualizacao=NOW() WHERE bin=$1`,
        item.bin,String(payload.bank?.name || ''),String(payload.country?.name || payload.country?.alpha2 || ''),String(payload.type || ''),
      );
      resultados.push({ bin:item.bin,status:'IDENTIFICADO',bandeira });
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : String(error);
      await db.$executeRawUnsafe(`UPDATE catalogo_bins SET consulta_online_status='ERRO',consulta_online_em=NOW(),consulta_online_erro=$2,data_atualizacao=NOW() WHERE bin=$1`, item.bin,mensagem.slice(0,500));
      resultados.push({ bin:item.bin,status:'ERRO',erro:mensagem });
    }
  }
  return { sucesso:true,consultados:resultados.length,identificados:resultados.filter((r)=>r.status==='IDENTIFICADO').length,resultados,provedor:'BINLIST' };
}


async function garantirAuditoriaOperacionalPostgres() {
  const db = await getDatabase();
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS auditoria_conversoes_itens (
    id BIGSERIAL PRIMARY KEY, tabela TEXT NOT NULL, row_id TEXT NOT NULL, regra_id TEXT NOT NULL,
    coluna TEXT NOT NULL, valor_anterior TEXT, valor_novo TEXT, adquirente TEXT,
    data_conversao TIMESTAMPTZ NOT NULL DEFAULT NOW(), desfeito_em TIMESTAMPTZ, origem TEXT NOT NULL DEFAULT 'INFERIDO')`);
  await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS uq_auditoria_conversao_item ON auditoria_conversoes_itens(tabela,row_id,regra_id,coluna)`);
  await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_auditoria_conversoes_data ON auditoria_conversoes_itens(data_conversao DESC)`);
}

async function inferirHistoricoConversoesAtuais() {
  await garantirAuditoriaOperacionalPostgres();
  const regras = (await listarConversoes()).filter((item) => ['vendas_interdata','vendas_adquirentes'].includes(item.tabela_origem));
  const db = await getDatabase();
  for (const regra of regras) {
    const tabela = nomeTabelaSeguro(regra.tabela_origem);
    const coluna = regra.coluna_origem;
    if (!/^[a-zA-Z0-9_]+$/.test(coluna)) continue;
    const original = `${coluna}_original`;
    const adq = textoFiltro(regra.adquirente_aplicacao);
    await db.$executeRawUnsafe(
      `INSERT INTO auditoria_conversoes_itens (tabela,row_id,regra_id,coluna,valor_anterior,valor_novo,adquirente,data_conversao,origem)
       SELECT $1::text,row_id,$2::text,$3::text,
              COALESCE(NULLIF(dados->>($5::text),''),$6::text),
              COALESCE(dados->>($3::text),''),
              COALESCE(dados->>'adquirente',''),data_atualizacao,'INFERIDO'
       FROM ${tabela}
       WHERE COALESCE(dados->>($3::text),'')=$7::text
         AND (
           $4::text = ''
           OR $4::text = 'TODAS'
           OR UPPER(TRIM(COALESCE(dados->>'adquirente',''))) = $4::text
           OR $1::text <> 'vendas_adquirentes'
         )
         AND NULLIF(dados->>($5::text),'') IS NOT NULL
         AND COALESCE(NULLIF(dados->>($5::text),''),$6::text) <> COALESCE(dados->>($3::text),'')
       ON CONFLICT (tabela,row_id,regra_id,coluna) DO NOTHING`,
      regra.tabela_origem, regra.id, coluna, adq, original, regra.valor_original, regra.valor_exibicao,
    );
  }
}

export async function listarAuditoriaDuplicidades(limite = 1000) {
  await garantirDb();
  const db = await getDatabase();
  const rows = await db.$queryRawUnsafe(
    `SELECT * FROM (
       SELECT 'vendas_interdata'::text tabela,row_id,dados,COALESCE(NULLIF(dados->>'duplicidade_marcada_em','')::timestamptz,data_atualizacao) marcado_em
       FROM vendas_interdata WHERE UPPER(COALESCE(dados->>'duplicidade_status',''))='DUPLICADO_PROVAVEL'
       UNION ALL
       SELECT 'vendas_adquirentes'::text tabela,row_id,dados,COALESCE(NULLIF(dados->>'duplicidade_marcada_em','')::timestamptz,data_atualizacao) marcado_em
       FROM vendas_adquirentes WHERE UPPER(COALESCE(dados->>'duplicidade_status',''))='DUPLICADO_PROVAVEL'
     ) x ORDER BY marcado_em DESC LIMIT $1`, Math.max(1, Math.min(Number(limite)||1000,5000)),
  ) as Array<{tabela:string;row_id:string;dados:Record<string,unknown>;marcado_em:string}>;
  return rows.map((row) => ({ tabela: row.tabela, row_id: row.row_id, marcado_em: row.marcado_em, ...row.dados }));
}

export async function desmarcarDuplicidadeItem(tabelaInput: string, rowId: string) {
  const tabela = tabelaInput === 'vendas_interdata' ? 'vendas_interdata' : tabelaInput === 'vendas_adquirentes' ? 'vendas_adquirentes' : '';
  if (!tabela || !rowId) throw new Error('Tabela ou item inválido.');
  await garantirDb();
  const db = await getDatabase();
  const rows = await db.$queryRawUnsafe(
    `UPDATE ${nomeTabelaSeguro(tabela)} SET dados=dados-'duplicidade_status'-'duplicidade_grupo'-'duplicidade_marcada_em',data_atualizacao=NOW()
     WHERE row_id=$1 AND UPPER(COALESCE(dados->>'duplicidade_status',''))='DUPLICADO_PROVAVEL' RETURNING row_id`, rowId,
  ) as Array<{row_id:string}>;
  return { sucesso: rows.length>0, tabela, row_id: rowId };
}

export async function listarAuditoriaConversoes(limite = 1000) {
  await garantirDb();
  await inferirHistoricoConversoesAtuais();
  const db = await getDatabase();
  const rows = await db.$queryRawUnsafe(
    `SELECT a.*, CASE WHEN a.tabela='vendas_interdata' THEN vi.dados ELSE va.dados END AS dados
       FROM auditoria_conversoes_itens a
       LEFT JOIN vendas_interdata vi ON a.tabela='vendas_interdata' AND vi.row_id=a.row_id
       LEFT JOIN vendas_adquirentes va ON a.tabela='vendas_adquirentes' AND va.row_id=a.row_id
      WHERE a.desfeito_em IS NULL ORDER BY a.data_conversao DESC LIMIT $1`, Math.max(1,Math.min(Number(limite)||1000,5000)),
  ) as Array<Record<string,unknown>>;
  return rows;
}

export async function desfazerConversaoItem(idInput: string) {
  const id = Number(idInput);
  if (!Number.isFinite(id)) throw new Error('Conversão inválida.');
  await garantirDb();
  await garantirAuditoriaOperacionalPostgres();
  const db = await getDatabase();
  return db.$transaction(async (tx) => {
    const itens = await tx.$queryRawUnsafe(`SELECT * FROM auditoria_conversoes_itens WHERE id=$1 AND desfeito_em IS NULL FOR UPDATE`, id) as Array<any>;
    const item = itens[0];
    if (!item) throw new Error('Conversão já desfeita ou não encontrada.');
    const tabela = item.tabela === 'vendas_interdata' ? 'vendas_interdata' : item.tabela === 'vendas_adquirentes' ? 'vendas_adquirentes' : '';
    if (!tabela) throw new Error('Tabela da conversão não suportada.');
    const coluna = String(item.coluna||'');
    if (!/^[a-zA-Z0-9_]+$/.test(coluna)) throw new Error('Coluna inválida.');
    await tx.$executeRawUnsafe(
      `UPDATE ${nomeTabelaSeguro(tabela)}
          SET dados=jsonb_set(jsonb_set(dados,ARRAY[$2]::text[],to_jsonb($3::text),true),'{conversoes_bloqueadas}',COALESCE(dados->'conversoes_bloqueadas','[]'::jsonb)||to_jsonb($4::text),true),data_atualizacao=NOW()
        WHERE row_id=$1`, item.row_id,coluna,String(item.valor_anterior??''),String(item.regra_id),
    );
    await tx.$executeRawUnsafe(`UPDATE auditoria_conversoes_itens SET desfeito_em=NOW() WHERE id=$1`, id);
    return { sucesso:true,id,tabela,row_id:item.row_id,coluna,valor_restaurado:item.valor_anterior };
  });
}

export function obterTipoPersistenciaAtual() {
  return 'postgresql';
}
