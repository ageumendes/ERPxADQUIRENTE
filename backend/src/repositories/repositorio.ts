import fs from 'node:fs/promises';
import path from 'node:path';
import {
  dbDir,
  importacoesJsonPath,
  vendasErpJsonPath,
  vendasInterdataJsonPath,
  vendasAdquirentesJsonPath,
  sicoobLayoutPspPixJsonPath,
  sipagLayout20SPixJsonPath,
  sipagLayout20SCartoesJsonPath,
  sipagLayout20PJsonPath,
  sipagLayout20RJsonPath,
  sipagFiserv76SPixJsonPath,
  sipagFiserv76SCartoesJsonPath,
  sipagFiserv76PJsonPath,
  cieloLayout1515Cielo03JsonPath,
  cieloLayout1515Cielo16JsonPath,
  cieloLayout1515Cielo04JsonPath,
  sicrediFiserv74SPixJsonPath,
  sicrediFiserv74SCartoesJsonPath,
  sicrediFiserv74PJsonPath,
  sicrediFiserv74RJsonPath,
  convcard203CvJsonPath,
  convcard203CpJsonPath,
  convcard203CcJsonPath,
  convcard203TbJsonPath,
  convcard203ControleJsonPath,
  conciliacoesJsonPath,
  conversoesJsonPath,
} from '../database/paths.js';
import { conversoesSeed } from '../database/conversoes-seed.js';



type DatabaseLike = {
  $executeRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown>;
  $queryRawUnsafe: (sql: string, ...params: unknown[]) => Promise<unknown[]>;
  $transaction: <T>(callback: (tx: DatabaseLike) => Promise<T>) => Promise<T>;
};

let databasePromise: Promise<DatabaseLike> | null = null;

async function getDatabase(): Promise<DatabaseLike> {
  if (!databasePromise) {
    databasePromise = import('pg').then(({ Pool }) => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });

      const adapter: DatabaseLike = {
        $executeRawUnsafe: async (sql: string, ...params: unknown[]) => {
          await pool.query(sql, params);
        },
        $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
          const result = await pool.query(sql, params);
          return result.rows;
        },
        $transaction: async <T>(callback: (tx: DatabaseLike) => Promise<T>) => {
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
        },
      };

      return adapter;
    });
  }
  return databasePromise;
}

const usarPostgres = () => Boolean(process.env.DATABASE_URL && !['false', '0', 'json'].includes(String(process.env.PERSISTENCIA_POSTGRES || 'true').toLowerCase()));
const nomesTabelasGarantidas = new Set<string>();

function nomeTabelaSeguro(nome: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nome)) {
    throw new Error(`Nome de tabela inválido: ${nome}`);
  }
  return `"${nome}"`;
}

function tabelaPorArquivo(arquivo: string) {
  const normalizado = path.normalize(arquivo);
  const tabela = tabelasSistema.find((item) => path.normalize(item.arquivo) === normalizado);
  if (!tabela) return null;
  return tabela.nome;
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
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_${nomeTabela}_dados_gin ON ${tabela} USING GIN (dados)`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_${nomeTabela}_data_criacao ON ${tabela} (data_criacao)`);
  nomesTabelasGarantidas.add(nomeTabela);
}

async function removerTabelaLinhasImportadasLegadaPostgres() {
  const prisma = await getDatabase();
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "linhas_importadas"');
  nomesTabelasGarantidas.delete('linhas_importadas');
}

async function garantirDbPostgres() {
  await removerTabelaLinhasImportadasLegadaPostgres();
  for (const tabela of tabelasSistema) {
    await garantirTabelaPostgres(tabela.nome);
  }
}

async function lerTabelaPostgres<T>(arquivo: string, fallback: T): Promise<T> {
  const nomeTabela = tabelaPorArquivo(arquivo);
  if (!nomeTabela) return fallback;
  await garantirTabelaPostgres(nomeTabela);
  const tabela = nomeTabelaSeguro(nomeTabela);
  const prisma = await getDatabase();
  const rows = await (prisma.$queryRawUnsafe(`SELECT dados FROM ${tabela} ORDER BY pk ASC`) as Promise<Array<{ dados: unknown }>>);
  return rows.map((row: { dados: unknown }) => row.dados) as T;
}

async function gravarTabelaPostgres<T>(arquivo: string, data: T): Promise<void> {
  const nomeTabela = tabelaPorArquivo(arquivo);
  if (!nomeTabela) return;
  await garantirTabelaPostgres(nomeTabela);
  const tabela = nomeTabelaSeguro(nomeTabela);
  const registros = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const prisma = await getDatabase();
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(`TRUNCATE TABLE ${tabela} RESTART IDENTITY`);
    for (const [index, registro] of registros.entries()) {
      const rowId = rowIdDoRegistro(registro, String(index + 1));
      const hashLinha = registro.hash_linha ? String(registro.hash_linha) : null;
      const hashArquivo = registro.hash_arquivo ? String(registro.hash_arquivo) : null;
      await tx.$executeRawUnsafe(
        `INSERT INTO ${tabela} (row_id, hash_linha, hash_arquivo, dados, data_criacao, data_atualizacao)
         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
         ON CONFLICT (row_id) DO UPDATE SET dados = EXCLUDED.dados, data_atualizacao = NOW()`,
        rowId,
        hashLinha,
        hashArquivo,
        stringifyJsonbSeguro(registro),
      );
    }
  });
}

async function appendTabelaPostgres<T extends Record<string, unknown>>(arquivo: string, registrosNovos: T[], chaveUnica: 'hash_linha' | 'hash_arquivo' | 'row_id' = 'hash_linha') {
  const nomeTabela = tabelaPorArquivo(arquivo);
  if (!nomeTabela) return { inseridos: 0, duplicados: 0 };
  if (registrosNovos.length === 0) return { inseridos: 0, duplicados: 0 };
  await garantirTabelaPostgres(nomeTabela);
  const tabela = nomeTabelaSeguro(nomeTabela);
  let inseridos = 0;
  let duplicados = 0;
  const prisma = await getDatabase();
  await prisma.$transaction(async (tx: any) => {
    for (const registro of registrosNovos) {
      const rowId = rowIdDoRegistro(registro);
      const hashLinha = registro.hash_linha ? String(registro.hash_linha) : null;
      const hashArquivo = registro.hash_arquivo ? String(registro.hash_arquivo) : null;
      const whereColumn = chaveUnica === 'hash_arquivo' ? 'hash_arquivo' : chaveUnica === 'row_id' ? 'row_id' : 'hash_linha';
      const whereValue = whereColumn === 'hash_arquivo' ? hashArquivo : whereColumn === 'row_id' ? rowId : hashLinha;
      if (whereValue) {
        const existe = await (tx.$queryRawUnsafe(`SELECT pk FROM ${tabela} WHERE ${whereColumn} = $1 LIMIT 1`, whereValue) as Promise<Array<{ pk: string }>>);
        if (existe.length > 0) {
          duplicados += 1;
          continue;
        }
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO ${tabela} (row_id, hash_linha, hash_arquivo, dados, data_criacao, data_atualizacao)
         VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())`,
        rowId,
        hashLinha,
        hashArquivo,
        stringifyJsonbSeguro(registro),
      );
      inseridos += 1;
    }
  });
  return { inseridos, duplicados };
}

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
};

export type VendaAdquirente = {
  id: string;
  importacao_id: string;
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
  dados_json: Record<string, string>;
  data_criacao: string;
};


export type SicoobLayoutPspPix = {
  [campo: string]: unknown;
  id: string;
  origem: 'SICOOB';
  layout_origem: 'SICOOB_PSP_PIX_API';
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
  dados_json: Record<string, unknown>;
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
  dados_json: Record<string, string>;
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
  dados_json: Record<string, string>;
  data_criacao: string;
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
  'devolucoes', 'hash_linha', 'dados_json', 'data_criacao'
];


export const tabelasSistema: TabelaSistema[] = [
  {
    nome: 'importacoes',
    titulo: 'Importações',
    descricao: 'Arquivos enviados pelo usuário, com hash, status e layout detectado.',
    arquivo: importacoesJsonPath,
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
    arquivo: vendasErpJsonPath,
    colunas: [
      'id', 'importacao_id', 'numero_linha', 'data_venda', 'hora_venda', 'terminal', 'nsu', 'valor_bruto',
      'forma_pagamento', 'bandeira', 'tipo_produto', 'parcelas', 'cnpj_estabelecimento', 'id_venda_erp',
      'status_venda', 'hash_linha', 'dados_originais', 'data_criacao',
    ],
  },
  {
    nome: 'vendas_interdata',
    titulo: 'Vendas INTERDATA',
    descricao: 'Tabela canônica do ERP INTERDATA. Recebe os dados de vendas_erp com regras ativas de conversão aplicadas na gravação, preservando o valor original em colunas *_original.',
    arquivo: vendasInterdataJsonPath,
    colunas: [
      'id', 'importacao_id', 'venda_erp_id', 'numero_linha', 'data_venda', 'hora_venda', 'terminal', 'nsu', 'valor_bruto',
      'forma_pagamento', 'forma_pagamento_original', 'bandeira', 'bandeira_original', 'tipo_produto', 'tipo_produto_original',
      'parcelas', 'cnpj_estabelecimento', 'id_venda_erp', 'status_venda', 'status_venda_original',
      'hash_linha', 'dados_originais', 'data_criacao',
    ],
  },
  {
    nome: 'vendas_adquirentes',
    titulo: 'Vendas Adquirentes',
    descricao: 'Tabela canônica das adquirentes. Regras ativas da tabela conversoes são aplicadas no momento da gravação, preservando o valor original em colunas *_original quando houver conversão.',
    arquivo: vendasAdquirentesJsonPath,
    colunas: [
      'id', 'importacao_id', 'adquirente', 'layout_origem', 'tipo_arquivo', 'codigo_registro', 'numero_linha',
      'data_venda', 'hora_venda', 'data_pagamento', 'valor_bruto', 'valor_liquido', 'valor_taxa', 'percentual_taxa',
      'nsu', 'codigo_autorizacao', 'terminal', 'bandeira', 'bandeira_original', 'modalidade', 'modalidade_original',
      'parcelas', 'status_transacao', 'status_transacao_original', 'codigo_produto', 'hash_linha', 'linha_original',
      'dados_json', 'data_criacao',
    ],
  },
  {
    nome: 'sicoob_layout_psp_pix',
    titulo: 'SICOOB Layout PSP PIX',
    descricao: 'Tabela bruta/normalizada dos PIX recebidos via API Sicoob PSP/TEF, usando endToEndId como chave única.',
    arquivo: sicoobLayoutPspPixJsonPath,
    colunas: COLUNAS_SICOOB_LAYOUT_PSP_PIX,
  },
  {
    nome: 'sipag_layout_2_0_s_pix',
    titulo: 'SIPAG Layout 2.0 - S PIX',
    descricao: 'Tabela bruta do arquivo S da SIPAG 2.0 contendo somente transações PIX (registro 001).',
    arquivo: sipagLayout20SPixJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_layout_2_0_s_cartoes',
    titulo: 'SIPAG Layout 2.0 - S Cartões',
    descricao: 'Tabela bruta do arquivo S da SIPAG 2.0 contendo somente transações de cartão (registros 011, 013, 014, 015, 017 e relacionados).',
    arquivo: sipagLayout20SCartoesJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_layout_2_0_p',
    titulo: 'SIPAG Layout 2.0 - P',
    descricao: 'Tabela bruta do arquivo P da SIPAG 2.0, preservando linha original e JSON por posição de coluna.',
    arquivo: sipagLayout20PJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_layout_2_0_r',
    titulo: 'SIPAG Layout 2.0 - R',
    descricao: 'Tabela bruta do arquivo R da SIPAG 2.0, preservando linha original e JSON por posição de coluna.',
    arquivo: sipagLayout20RJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_fiserv_layout_7_6_s_pix',
    titulo: 'SIPAG Fiserv Layout 7.6 - S PIX',
    descricao: 'Tabela bruta do arquivo S da SIPAG/Fiserv 7.6 contendo somente transações PIX (registro 001).',
    arquivo: sipagFiserv76SPixJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_fiserv_layout_7_6_s_cartoes',
    titulo: 'SIPAG Fiserv Layout 7.6 - S Cartões',
    descricao: 'Tabela bruta do arquivo S da SIPAG/Fiserv 7.6 contendo somente transações de cartão (registros 011, 013, 014, 015, 017 e relacionados).',
    arquivo: sipagFiserv76SCartoesJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sipag_fiserv_layout_7_6_p',
    titulo: 'SIPAG Fiserv Layout 7.6 - P',
    descricao: 'Tabela bruta do arquivo P da SIPAG/Fiserv 7.6. Este layout não possui arquivo R neste fluxo.',
    arquivo: sipagFiserv76PJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },


  {
    nome: 'convcard_layout_2_0_3_cv',
    titulo: 'CONVCARD Layout 2.0.3 - CV Vendas',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo comprovantes de venda autorizada (registro CV).',
    arquivo: convcard203CvJsonPath,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },
  {
    nome: 'convcard_layout_2_0_3_cp',
    titulo: 'CONVCARD Layout 2.0.3 - CP Pagamentos',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo comprovantes de pagamento (registro CP).',
    arquivo: convcard203CpJsonPath,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },
  {
    nome: 'convcard_layout_2_0_3_cc',
    titulo: 'CONVCARD Layout 2.0.3 - CC Cancelamentos',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo cancelamentos (registro CC).',
    arquivo: convcard203CcJsonPath,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },
  {
    nome: 'convcard_layout_2_0_3_tb',
    titulo: 'CONVCARD Layout 2.0.3 - TB Tarifas',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo tarifas bancárias (registro TB).',
    arquivo: convcard203TbJsonPath,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },
  {
    nome: 'convcard_layout_2_0_3_controle',
    titulo: 'CONVCARD Layout 2.0.3 - Controle',
    descricao: 'Tabela bruta do layout Convcard 2.0.3 contendo headers/trailers A0, L0, L9 e A9.',
    arquivo: convcard203ControleJsonPath,
    colunas: COLUNAS_CONVCARD_2_0_3,
  },


  {
    nome: 'sicredi_fiserv_layout_7_4_s_pix',
    titulo: 'SICREDI Fiserv Layout 7.4 - S PIX',
    descricao: 'Tabela bruta JSON do arquivo S do SICREDI/Fiserv 7.4 contendo somente transações PIX (registro 001).',
    arquivo: sicrediFiserv74SPixJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sicredi_fiserv_layout_7_4_s_cartoes',
    titulo: 'SICREDI Fiserv Layout 7.4 - S Cartões',
    descricao: 'Tabela bruta JSON do arquivo S do SICREDI/Fiserv 7.4 contendo somente transações de cartão (registros 011, 013, 014 e relacionados).',
    arquivo: sicrediFiserv74SCartoesJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sicredi_fiserv_layout_7_4_p',
    titulo: 'SICREDI Fiserv Layout 7.4 - P',
    descricao: 'Tabela bruta JSON do arquivo P do SICREDI/Fiserv 7.4, preservando movimentos financeiros.',
    arquivo: sicrediFiserv74PJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },
  {
    nome: 'sicredi_fiserv_layout_7_4_r',
    titulo: 'SICREDI Fiserv Layout 7.4 - R',
    descricao: 'Tabela bruta JSON do arquivo R do SICREDI/Fiserv 7.4, preservando recebíveis/UR.',
    arquivo: sicrediFiserv74RJsonPath,
    colunas: COLUNAS_BRUTAS_EDI_60,
  },

  {
    nome: 'cielo_layout_15_15_cielo03',
    titulo: 'CIELO Layout 15.15 - CIELO03',
    descricao: 'Tabela bruta dos registros E do arquivo CIELO03 (Captura/Previsão), preservando posições fixas do manual v15.15.',
    arquivo: cieloLayout1515Cielo03JsonPath,
    colunas: COLUNAS_CIELO_15_15_E,
  },
  {
    nome: 'cielo_layout_15_15_cielo16',
    titulo: 'CIELO Layout 15.15 - CIELO16 PIX',
    descricao: 'Tabela bruta dos registros 8 do arquivo CIELO16, com transações PIX preservadas por posições fixas.',
    arquivo: cieloLayout1515Cielo16JsonPath,
    colunas: COLUNAS_CIELO_15_15_PIX,
  },
  {
    nome: 'cielo_layout_15_15_cielo04',
    titulo: 'CIELO Layout 15.15 - CIELO04',
    descricao: 'Tabela bruta dos registros D e E do arquivo CIELO04 (Liquidação/Pagamento). Não alimenta vendas_adquirentes.',
    arquivo: cieloLayout1515Cielo04JsonPath,
    colunas: COLUNAS_CIELO_15_15_E,
  },
  {
    nome: 'conciliacoes',
    titulo: 'Conciliações',
    descricao: 'Tabela preparada para relacionar vendas ERP x vendas das adquirentes.',
    arquivo: conciliacoesJsonPath,
    colunas: [
      'id', 'venda_erp_id', 'venda_adquirente_id', 'status_conciliacao', 'pontuacao_match',
      'motivo_match', 'observacoes', 'conciliado_automaticamente', 'data_conciliacao',
    ],
  },
  {
    nome: 'conversoes',
    titulo: 'Conversões',
    descricao: 'Regras de normalização/exibição. Para vendas_adquirentes, as regras são aplicadas na gravação canônica; as tabelas brutas permanecem intactas.',
    arquivo: conversoesJsonPath,
    colunas: [
      'id', 'tabela_origem', 'coluna_origem', 'valor_original', 'valor_exibicao', 'adquirente_aplicacao', 'ativo',
      'observacao', 'data_criacao', 'data_atualizacao',
    ],
  },
];

const conversoesPadrao: Conversao[] = conversoesSeed;

async function garantirArquivoJson(arquivo: string) {
  await fs.mkdir(path.dirname(arquivo), { recursive: true });
  await fs.access(arquivo).catch(() => fs.writeFile(arquivo, '[]'));
}

async function garantirDb() {
  if (usarPostgres()) {
    await garantirDbPostgres();
    await semearConversoesPadrao();
    return;
  }
  await fs.mkdir(dbDir, { recursive: true });
  await Promise.all(tabelasSistema.map((tabela) => garantirArquivoJson(tabela.arquivo)));
  await semearConversoesPadrao();
}

async function lerJson<T>(arquivo: string, fallback: T): Promise<T> {
  if (usarPostgres()) return lerTabelaPostgres<T>(arquivo, fallback);
  await fs.mkdir(dbDir, { recursive: true });
  await garantirArquivoJson(arquivo);
  try {
    return JSON.parse(await fs.readFile(arquivo, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function gravarJson<T>(arquivo: string, data: T): Promise<void> {
  if (usarPostgres()) return gravarTabelaPostgres<T>(arquivo, data);
  await fs.mkdir(dbDir, { recursive: true });
  await garantirArquivoJson(arquivo);
  await fs.writeFile(arquivo, JSON.stringify(data, null, 2));
}

async function semearConversoesPadrao() {
  if (!usarPostgres()) await garantirArquivoJson(conversoesJsonPath);
  const registros = await lerJson<Conversao[]>(conversoesJsonPath, []);
  if (registros.length > 0) return;
  const agora = new Date().toISOString();
  const seed = conversoesPadrao.map((item, index) => ({
    ...item,
    id: item.id || `conv-${index + 1}`,
    data_criacao: item.data_criacao || agora,
    data_atualizacao: item.data_atualizacao || agora,
  }));
  await gravarJson(conversoesJsonPath, seed);
}

export async function listarImportacoes(): Promise<Importacao[]> {
  const registros = await lerJson<Importacao[]>(importacoesJsonPath, []);
  return registros.sort((a, b) => b.data_importacao.localeCompare(a.data_importacao)).slice(0, 200);
}

export async function criarImportacao(data: Omit<Importacao, 'id' | 'data_importacao' | 'data_atualizacao'>): Promise<Importacao> {
  const registros = await lerJson<Importacao[]>(importacoesJsonPath, []);
  const agora = new Date().toISOString();
  const importacao: Importacao = { id: String(Date.now()), ...data, data_importacao: agora, data_atualizacao: agora };
  registros.push(importacao);
  await gravarJson(importacoesJsonPath, registros);
  return importacao;
}

export async function buscarImportacaoPorHash(hash: string): Promise<Importacao | undefined> {
  const registros = await lerJson<Importacao[]>(importacoesJsonPath, []);
  return registros.find((item) => item.hash_arquivo === hash);
}

export async function buscarImportacaoPendentePorHash(hash: string): Promise<Importacao | undefined> {
  const registros = await lerJson<Importacao[]>(importacoesJsonPath, []);
  const statusPendentes = new Set([
    'RECEBIDO',
    'CLASSIFICANDO',
    'PROCESSANDO',
    'PROCESSANDO_FILA',
    'RECUPERADO_REENFILEIRADO',
  ]);
  return registros
    .filter((item) => item.hash_arquivo === hash && statusPendentes.has(item.status_importacao))
    .sort((a, b) => b.data_atualizacao.localeCompare(a.data_atualizacao))[0];
}

export async function atualizarImportacao(id: string, data: Partial<Importacao>): Promise<Importacao | undefined> {
  const registros = await lerJson<Importacao[]>(importacoesJsonPath, []);
  const index = registros.findIndex((item) => item.id === id);
  if (index < 0) return undefined;
  registros[index] = { ...registros[index], ...data, data_atualizacao: new Date().toISOString() };
  await gravarJson(importacoesJsonPath, registros);
  return registros[index];
}

export async function resumoImportacoes() {
  const registros = await lerJson<Importacao[]>(importacoesJsonPath, []);
  return {
    total: registros.length,
    processados: registros.filter((item) => item.status_importacao === 'PROCESSADO').length,
    erros: registros.filter((item) => item.status_importacao === 'ERRO').length,
    desconhecidos: registros.filter((item) => item.status_importacao === 'LAYOUT_DESCONHECIDO').length,
    classificados: registros.filter((item) => item.status_importacao === 'CLASSIFICADO').length,
  };
}

export async function removerLinhasImportadasLegadas(): Promise<void> {
  if (usarPostgres()) {
    await removerTabelaLinhasImportadasLegadaPostgres();
    return;
  }
  const arquivoLegado = path.join(dbDir, 'linhas-importadas.json');
  await fs.rm(arquivoLegado, { force: true }).catch(() => undefined);
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
      encontrarConversaoAtiva(conversoes, 'vendas_interdata', coluna, valor) ||
      encontrarConversaoAtiva(conversoes, 'vendas_erp', coluna, valor);
    if (!regra) continue;
    const valorOriginal = valor === null || valor === undefined ? '' : String(valor);
    if (valorOriginal === regra.valor_exibicao) continue;
    normalizada[`${coluna}_original`] = valorOriginal;
    normalizada[coluna] = regra.valor_exibicao;
  }

  return normalizada as VendaInterdata;
}

async function salvarVendasInterdata(vendasErp: VendaErp[]): Promise<{ inseridos: number; duplicados: number }> {
  if (vendasErp.length === 0) return { inseridos: 0, duplicados: 0 };
  const conversoes = await listarConversoes();
  const vendasInterdata = vendasErp.map((venda) => aplicarConversoesParaGravacaoVendaInterdata(venda, conversoes));
  return salvarRegistrosGenerico(vendasInterdataJsonPath, vendasInterdata);
}

export async function salvarVendasErp(vendas: VendaErp[]): Promise<{ inseridos: number; duplicados: number; interdata_inseridos: number; interdata_duplicados: number }> {
  if (vendas.length === 0) return { inseridos: 0, duplicados: 0, interdata_inseridos: 0, interdata_duplicados: 0 };
  const registros = await lerJson<VendaErp[]>(vendasErpJsonPath, []);
  const hashes = new Set(registros.map((item) => item.hash_linha));
  const novos: VendaErp[] = [];
  let duplicados = 0;
  for (const venda of vendas) {
    if (hashes.has(venda.hash_linha)) {
      duplicados += 1;
      continue;
    }
    hashes.add(venda.hash_linha);
    novos.push(venda);
  }
  await gravarJson(vendasErpJsonPath, registros.concat(novos));
  const gravacaoInterdata = await salvarVendasInterdata(novos);
  return {
    inseridos: novos.length,
    duplicados,
    interdata_inseridos: gravacaoInterdata.inseridos,
    interdata_duplicados: gravacaoInterdata.duplicados,
  };
}

async function salvarRegistrosGenerico<T extends { hash_linha: string }>(arquivo: string, registrosNovos: T[]): Promise<{ inseridos: number; duplicados: number }> {
  if (registrosNovos.length === 0) return { inseridos: 0, duplicados: 0 };
  const registros = await lerJson<T[]>(arquivo, []);
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
  await gravarJson(arquivo, registros.concat(novos));
  return { inseridos: novos.length, duplicados };
}

export async function salvarSipagLayout20(tipo: 'S' | 'P' | 'R', registros: RegistroSipagLayout20[]) {
  if (tipo === 'S') {
    const registrosPix = registros.filter((registro) => String(registro.codigo_registro || '') === '001');
    const registrosCartoes = registros.filter((registro) => String(registro.codigo_registro || '') !== '001');
    const gravacaoPix = await salvarRegistrosGenerico(sipagLayout20SPixJsonPath, registrosPix);
    const gravacaoCartoes = await salvarRegistrosGenerico(sipagLayout20SCartoesJsonPath, registrosCartoes);
    return {
      inseridos: gravacaoPix.inseridos + gravacaoCartoes.inseridos,
      duplicados: gravacaoPix.duplicados + gravacaoCartoes.duplicados,
    };
  }

  const arquivo = tipo === 'P' ? sipagLayout20PJsonPath : sipagLayout20RJsonPath;
  return salvarRegistrosGenerico(arquivo, registros);
}



export async function salvarSipagFiserv76(tipo: 'S' | 'P', registros: RegistroSipagFiserv76[]) {
  if (tipo === 'S') {
    const registrosPix = registros.filter((registro) => String(registro.codigo_registro || '') === '001');
    const registrosCartoes = registros.filter((registro) => String(registro.codigo_registro || '') !== '001');
    const gravacaoPix = await salvarRegistrosGenerico(sipagFiserv76SPixJsonPath, registrosPix);
    const gravacaoCartoes = await salvarRegistrosGenerico(sipagFiserv76SCartoesJsonPath, registrosCartoes);
    return {
      inseridos: gravacaoPix.inseridos + gravacaoCartoes.inseridos,
      duplicados: gravacaoPix.duplicados + gravacaoCartoes.duplicados,
    };
  }

  return salvarRegistrosGenerico(sipagFiserv76PJsonPath, registros);
}


export async function salvarSicrediFiserv74(tipo: 'S' | 'P' | 'R', registros: RegistroSicrediFiserv74[]) {
  if (tipo === 'S') {
    const registrosPix = registros.filter((registro) => String(registro.codigo_registro || '') === '001');
    const registrosCartoes = registros.filter((registro) => String(registro.codigo_registro || '') !== '001');
    const gravacaoPix = await salvarRegistrosGenerico(sicrediFiserv74SPixJsonPath, registrosPix);
    const gravacaoCartoes = await salvarRegistrosGenerico(sicrediFiserv74SCartoesJsonPath, registrosCartoes);
    return {
      inseridos: gravacaoPix.inseridos + gravacaoCartoes.inseridos,
      duplicados: gravacaoPix.duplicados + gravacaoCartoes.duplicados,
    };
  }

  const arquivo = tipo === 'P' ? sicrediFiserv74PJsonPath : sicrediFiserv74RJsonPath;
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
    salvarRegistrosGenerico(convcard203CvJsonPath, porGrupo.CV),
    salvarRegistrosGenerico(convcard203CpJsonPath, porGrupo.CP),
    salvarRegistrosGenerico(convcard203CcJsonPath, porGrupo.CC),
    salvarRegistrosGenerico(convcard203TbJsonPath, porGrupo.TB),
    salvarRegistrosGenerico(convcard203ControleJsonPath, porGrupo.CONTROLE),
  ]);
  return resultados.reduce((acc, item) => ({ inseridos: acc.inseridos + item.inseridos, duplicados: acc.duplicados + item.duplicados }), { inseridos: 0, duplicados: 0 });
}

export async function salvarCieloLayout1515Cielo03(registros: RegistroCieloLayout1515Cielo03[]) {
  return salvarRegistrosGenerico(cieloLayout1515Cielo03JsonPath, registros);
}

export async function salvarCieloLayout1515Cielo16(registros: RegistroCieloLayout1515Cielo16[]) {
  return salvarRegistrosGenerico(cieloLayout1515Cielo16JsonPath, registros);
}

export async function salvarCieloLayout1515Cielo04(registros: RegistroCieloLayout1515Cielo04[]) {
  return salvarRegistrosGenerico(cieloLayout1515Cielo04JsonPath, registros);
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
  if (canonico === 'S' || canonico === 'N' || canonico === '1' || canonico === 'APPROVED' || canonico.includes('COMPROVANTE') || canonico.includes('DETALHE') || canonico.includes('SUCESSO') || canonico === 'OK' || canonico.includes('PIX_POS')) return 'AUTORIZADO';
  if (canonico.includes('CANCEL') || canonico.includes('DESFEIT') || canonico.includes('UNDONE') || canonico.includes('ESTORN')) return 'CANCELADO';
  if (canonico.includes('NEGAD') || canonico.includes('REJEIT') || canonico.includes('RECUS')) return 'NEGADO';
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

  guardarOriginalSeAlterou(normalizada, 'data_venda', normalizarDataCanonica(normalizada.data_venda));
  guardarOriginalSeAlterou(normalizada, 'data_pagamento', normalizarDataCanonica(normalizada.data_pagamento));
  guardarOriginalSeAlterou(normalizada, 'modalidade', normalizarModalidadeCanonica(normalizada.modalidade, normalizada.codigo_registro, normalizada.layout_origem));
  guardarOriginalSeAlterou(normalizada, 'bandeira', normalizarBandeiraCanonica(normalizada.bandeira, normalizada.modalidade));
  guardarOriginalSeAlterou(normalizada, 'status_transacao', normalizarStatusCanonico(normalizada.status_transacao, normalizada.codigo_registro, normalizada.layout_origem));

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

function encontrarConversaoAtiva(
  conversoes: Conversao[],
  tabela: string,
  coluna: string,
  valor: unknown,
  adquirente?: string,
) {
  const valorTexto = valor === null || valor === undefined ? '' : String(valor);
  const adquirenteLinha = String(adquirente || '').trim().toUpperCase();
  return conversoes.find((item) => {
    if (!item.ativo || item.tabela_origem !== tabela || item.coluna_origem !== coluna || item.valor_original !== valorTexto) return false;
    const adquirenteRegra = String(item.adquirente_aplicacao || '').trim().toUpperCase();
    if (tabela !== 'vendas_adquirentes') return true;
    return !adquirenteRegra || adquirenteRegra === 'TODAS' || adquirenteRegra === adquirenteLinha;
  });
}

function aplicarConversoesParaGravacaoVendaAdquirente(venda: VendaAdquirente, conversoes: Conversao[]): VendaAdquirente {
  const normalizada: Record<string, unknown> = {
    ...venda,
    valor_taxa: normalizarValorTaxaPositivo(venda.valor_taxa) as string | undefined,
    percentual_taxa: calcularPercentualTaxa(venda.valor_bruto, venda.valor_taxa),
  };

  // A adquirente original é usada para filtrar regras específicas por adquirente.
  // Mesmo que exista uma regra convertendo a própria coluna "adquirente", as demais
  // regras continuam sendo avaliadas contra a adquirente recebida do layout.
  const adquirenteOriginal = String(venda.adquirente || '').trim().toUpperCase();
  const colunasIgnoradas = new Set([
    'id', 'importacao_id', 'layout_origem', 'tipo_arquivo', 'codigo_registro', 'numero_linha',
    'hash_linha', 'linha_original', 'dados_json', 'data_criacao',
  ]);

  for (const [coluna, valor] of Object.entries(normalizada)) {
    if (colunasIgnoradas.has(coluna) || coluna.endsWith('_original')) continue;
    const regra = encontrarConversaoAtiva(conversoes, 'vendas_adquirentes', coluna, valor, adquirenteOriginal);
    if (!regra) continue;
    const valorOriginal = valor === null || valor === undefined ? '' : String(valor);
    if (valorOriginal === regra.valor_exibicao) continue;
    normalizada[`${coluna}_original`] = valorOriginal;
    normalizada[coluna] = regra.valor_exibicao;
  }

  return aplicarNormalizacaoCanonicaVendaAdquirente(normalizada as VendaAdquirente);
}


export async function salvarSicoobLayoutPspPix(registros: SicoobLayoutPspPix[]): Promise<{ inseridos: number; duplicados: number }> {
  await garantirDb();
  return salvarRegistrosGenerico(sicoobLayoutPspPixJsonPath, registros);
}

export async function salvarVendasAdquirentes(vendas: VendaAdquirente[]): Promise<{ inseridos: number; duplicados: number }> {
  const conversoes = await listarConversoes();
  const normalizadas = vendas
    .filter(ehVendaCanonicaAdquirente)
    .map((venda) => aplicarConversoesParaGravacaoVendaAdquirente(venda, conversoes))
    .filter(ehVendaCanonicaAdquirente);
  return salvarRegistrosGenerico(vendasAdquirentesJsonPath, normalizadas);
}

export async function normalizarVendasAdquirentesExistentes(): Promise<{ sucesso: true; antes: number; depois: number; removidos_nao_canonicos: number; atualizados: number; percentual_taxa_recalculado: number }> {
  const conversoes = await listarConversoes();
  const vendas = await lerJson<VendaAdquirente[]>(vendasAdquirentesJsonPath, []);
  const normalizadas = vendas
    .filter(ehVendaCanonicaAdquirente)
    .map((venda) => aplicarConversoesParaGravacaoVendaAdquirente(venda, conversoes))
    .filter(ehVendaCanonicaAdquirente);
  let atualizados = 0;
  let percentualTaxaRecalculado = 0;
  for (let index = 0; index < Math.min(vendas.length, normalizadas.length); index += 1) {
    if (JSON.stringify(vendas[index]) !== JSON.stringify(normalizadas[index])) atualizados += 1;
    if (String((vendas[index] as any).percentual_taxa ?? '') !== String((normalizadas[index] as any).percentual_taxa ?? '')) percentualTaxaRecalculado += 1;
  }
  await gravarJson(vendasAdquirentesJsonPath, normalizadas);
  return {
    sucesso: true,
    antes: vendas.length,
    depois: normalizadas.length,
    removidos_nao_canonicos: vendas.length - normalizadas.length,
    atualizados,
    percentual_taxa_recalculado: percentualTaxaRecalculado,
  };
}

export async function recalcularPercentualTaxaVendasAdquirentes() {
  return normalizarVendasAdquirentesExistentes();
}

function ehVendaCanonicaAdquirente(item: VendaAdquirente) {
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

function somarAgrupado(mapa: Map<string, any>, chave: string, item: VendaAdquirente) {
  const nome = chave || 'NÃO INFORMADO';
  const atual = mapa.get(nome) || { chave: nome, bruto: 0, taxa: 0, liquido: 0, quantidade: 0, ticket_medio: 0, taxa_media_percentual: 0 };
  const bruto = numeroMoeda(item.valor_bruto);
  const taxa = Math.abs(numeroMoeda(normalizarValorTaxaPositivo(item.valor_taxa)));
  const liquido = numeroMoeda(item.valor_liquido) || (bruto - taxa);
  atual.bruto += bruto;
  atual.taxa += taxa;
  atual.liquido += liquido;
  atual.quantidade += 1;
  atual.ticket_medio = atual.quantidade ? atual.bruto / atual.quantidade : 0;
  atual.taxa_media_percentual = atual.bruto ? (atual.taxa / atual.bruto) * 100 : 0;
  mapa.set(nome, atual);
}

function topAgrupado(mapa: Map<string, any>, limite = 50) {
  return [...mapa.values()]
    .sort((a, b) => Number(b.bruto || 0) - Number(a.bruto || 0))
    .slice(0, limite);
}

export async function gerarRelatorioAdquirentes(filtros: Record<string, unknown> = {}) {
  const vendas = await lerJson<VendaAdquirente[]>(vendasAdquirentesJsonPath, []);
  const dataInicio = String(filtros.data_inicio || '').trim();
  const dataFim = String(filtros.data_fim || '').trim();
  const adquirenteFiltro = String(filtros.adquirente || '').trim().toUpperCase();
  const formaPagamentoFiltro = String(filtros.forma_pagamento || '').trim().toUpperCase();
  const modalidadeFiltro = String(filtros.modalidade || '').trim().toUpperCase();
  const bandeiraFiltro = String(filtros.bandeira || '').trim().toUpperCase();
  const terminalFiltro = String(filtros.terminal || '').trim().toUpperCase();
  const statusFiltro = String(filtros.status || '').trim().toUpperCase();

  const normalizadas = vendas
    .filter(ehVendaCanonicaAdquirente)
    .map((venda) => ({ ...venda, data_iso: chaveDataIsoVenda(venda.data_venda), valor_taxa: normalizarValorTaxaPositivo(venda.valor_taxa) as string | undefined }))
    .filter((venda) => {
      const dataIso = String((venda as any).data_iso || '');
      const modalidadeVenda = String(venda.modalidade || '').toUpperCase();

      if (dataInicio && (!dataIso || dataIso < dataInicio)) return false;
      if (dataFim && (!dataIso || dataIso > dataFim)) return false;
      if (adquirenteFiltro && String(venda.adquirente || '').toUpperCase() !== adquirenteFiltro) return false;

      if (formaPagamentoFiltro === 'PIX' && modalidadeVenda !== 'PIX') return false;
      if (formaPagamentoFiltro === 'CARTAO' && modalidadeVenda === 'PIX') return false;

      if (modalidadeFiltro && modalidadeVenda !== modalidadeFiltro) return false;
      if (bandeiraFiltro && String(venda.bandeira || '').toUpperCase() !== bandeiraFiltro) return false;
      if (terminalFiltro && String(venda.terminal || '').toUpperCase() !== terminalFiltro) return false;
      if (statusFiltro && String(venda.status_transacao || '').toUpperCase() !== statusFiltro) return false;

      return true;
    })
    .sort(ordenarPorDataVendaDecrescente as any);

  const porDia = new Map<string, any>();
  const porAdquirente = new Map<string, any>();
  const porModalidade = new Map<string, any>();
  const porFormaPagamento = new Map<string, any>();
  const porBandeira = new Map<string, any>();
  const porTerminal = new Map<string, any>();
  const recebiveis = new Map<string, any>();

  let totalBruto = 0;
  let totalTaxa = 0;
  let totalLiquido = 0;
  let autorizadas = 0;
  let canceladasOuNegadas = 0;

  for (const venda of normalizadas) {
    const bruto = numeroMoeda(venda.valor_bruto);
    const taxa = Math.abs(numeroMoeda(venda.valor_taxa));
    const liquido = numeroMoeda(venda.valor_liquido) || (bruto - taxa);
    totalBruto += bruto;
    totalTaxa += taxa;
    totalLiquido += liquido;
    const status = String(venda.status_transacao || '').toUpperCase();
    if (status.includes('AUTORIZ')) autorizadas += 1;
    if (status.includes('CANCEL') || status.includes('NEGAD') || status.includes('DESFEIT') || status.includes('UNDONE')) canceladasOuNegadas += 1;

    somarAgrupado(porDia, String((venda as any).data_iso || 'SEM DATA'), venda);
    const modalidadeAgrupada = String(venda.modalidade || 'NÃO INFORMADO').toUpperCase();
    const formaPagamentoAgrupada = modalidadeAgrupada === 'PIX' ? 'PIX' : 'CARTÃO';

    somarAgrupado(porAdquirente, String(venda.adquirente || 'NÃO INFORMADO').toUpperCase(), venda);
    somarAgrupado(porFormaPagamento, formaPagamentoAgrupada, venda);
    somarAgrupado(porModalidade, modalidadeAgrupada, venda);
    somarAgrupado(porBandeira, String(venda.bandeira || 'NÃO INFORMADO').toUpperCase(), venda);
    somarAgrupado(porTerminal, String(venda.terminal || 'NÃO INFORMADO').toUpperCase(), venda);

    const dataPagamentoIso = chaveDataIsoVenda(venda.data_pagamento || '');
    if (dataPagamentoIso) somarAgrupado(recebiveis, dataPagamentoIso, venda);
  }

  const porDiaLista = [...porDia.values()]
    .sort((a, b) => String(a.chave).localeCompare(String(b.chave)))
    .map((item) => ({ ...item, data: formatarDataBrRelatorio(item.chave) }));

  const recebiveisLista = [...recebiveis.values()]
    .sort((a, b) => String(a.chave).localeCompare(String(b.chave)))
    .map((item) => ({ ...item, data_pagamento: formatarDataBrRelatorio(item.chave) }));

  const opcoes = {
    adquirentes: [...new Set(vendas.map((v) => String(v.adquirente || '').toUpperCase()).filter(Boolean))].sort(),
    modalidades: [...new Set(vendas.map((v) => String(v.modalidade || '').toUpperCase()).filter(Boolean))].sort(),
    bandeiras: [...new Set(vendas.map((v) => String(v.bandeira || '').toUpperCase()).filter(Boolean))].sort(),
    terminais: [...new Set(vendas.map((v) => String(v.terminal || '').toUpperCase()).filter(Boolean))].sort(),
    status: [...new Set(vendas.map((v) => String(v.status_transacao || '').toUpperCase()).filter(Boolean))].sort(),
  };

    return {
      filtros_aplicados: {
      data_inicio: dataInicio,
      data_fim: dataFim,
      adquirente: adquirenteFiltro,
      forma_pagamento: formaPagamentoFiltro,
      modalidade: modalidadeFiltro,
      bandeira: bandeiraFiltro,
      terminal: terminalFiltro,
      status: statusFiltro
    },
    opcoes,
    resumo: {
      total_bruto: totalBruto,
      total_taxas: totalTaxa,
      total_liquido: totalLiquido,
      quantidade_transacoes: normalizadas.length,
      ticket_medio: normalizadas.length ? totalBruto / normalizadas.length : 0,
      taxa_media_percentual: totalBruto ? (totalTaxa / totalBruto) * 100 : 0,
      autorizadas,
      canceladas_ou_negadas: canceladasOuNegadas,
    },
    por_dia: porDiaLista,
    por_adquirente: topAgrupado(porAdquirente),
    por_forma_pagamento: topAgrupado(porFormaPagamento),
    por_modalidade: topAgrupado(porModalidade),
    por_bandeira: topAgrupado(porBandeira),
    por_terminal: topAgrupado(porTerminal, 20),
    recebiveis: recebiveisLista,
    ultimas_vendas: normalizadas.slice(0, 20),
  };
}

type FiltrosListagemVendas = Record<string, unknown>;

function textoFiltro(valor: unknown) {
  return String(valor || '').trim().toUpperCase();
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
  const formaPagamentoFiltro = textoFiltro(filtros.forma_pagamento);
  const modalidadeFiltro = textoFiltro(filtros.modalidade);
  const bandeiraFiltro = textoFiltro(filtros.bandeira);
  const terminalFiltro = textoFiltro(filtros.terminal);
  const statusFiltro = textoFiltro(filtros.status);

  const modalidadeVenda = textoFiltro(venda.modalidade);

  if (!vendaDentroDoPeriodo(venda.data_venda, dataInicio, dataFim)) return false;
  if (adquirenteFiltro && textoFiltro(venda.adquirente) !== adquirenteFiltro) return false;
  if (formaPagamentoFiltro === 'PIX' && modalidadeVenda !== 'PIX') return false;
  if (formaPagamentoFiltro === 'CARTAO' && modalidadeVenda === 'PIX') return false;
  if (modalidadeFiltro && modalidadeVenda !== modalidadeFiltro) return false;
  if (bandeiraFiltro && textoFiltro(venda.bandeira) !== bandeiraFiltro) return false;
  if (terminalFiltro && textoFiltro(venda.terminal) !== terminalFiltro) return false;
  if (statusFiltro && textoFiltro(venda.status_transacao) !== statusFiltro) return false;
  return true;
}

function filtrarVendaErp(venda: VendaInterdata, filtros: FiltrosListagemVendas = {}) {
  const dataInicio = String(filtros.data_inicio || '').trim();
  const dataFim = String(filtros.data_fim || '').trim();
  const formaPagamentoFiltro = textoFiltro(filtros.forma_pagamento);
  const modalidadeFiltro = textoFiltro(filtros.modalidade);
  const bandeiraFiltro = textoFiltro(filtros.bandeira);
  const terminalFiltro = textoFiltro(filtros.terminal);
  const statusFiltro = textoFiltro(filtros.status);

  const modalidadeVenda = textoFiltro((venda as any).tipo_produto || (venda as any).forma_pagamento);

  if (!vendaDentroDoPeriodo((venda as any).data_venda, dataInicio, dataFim)) return false;
  if (formaPagamentoFiltro === 'PIX' && modalidadeVenda !== 'PIX') return false;
  if (formaPagamentoFiltro === 'CARTAO' && modalidadeVenda === 'PIX') return false;
  if (modalidadeFiltro && modalidadeVenda !== modalidadeFiltro) return false;
  if (bandeiraFiltro && textoFiltro((venda as any).bandeira) !== bandeiraFiltro) return false;
  if (terminalFiltro && textoFiltro((venda as any).terminal) !== terminalFiltro) return false;
  if (statusFiltro && textoFiltro((venda as any).status_venda) !== statusFiltro) return false;
  return true;
}

export async function obterOpcoesVendasAdquirentes() {
  const vendas = await lerJson<VendaAdquirente[]>(vendasAdquirentesJsonPath, []);
  const somenteVendas = vendas.filter(ehVendaCanonicaAdquirente);
  return {
    adquirentes: [...new Set(somenteVendas.map((v) => textoFiltro(v.adquirente)).filter(Boolean))].sort(),
    modalidades: [...new Set(somenteVendas.map((v) => textoFiltro(v.modalidade)).filter(Boolean))].sort(),
    bandeiras: [...new Set(somenteVendas.map((v) => textoFiltro(v.bandeira)).filter(Boolean))].sort(),
    terminais: [...new Set(somenteVendas.map((v) => textoFiltro(v.terminal)).filter(Boolean))].sort(),
    status: [...new Set(somenteVendas.map((v) => textoFiltro(v.status_transacao)).filter(Boolean))].sort(),
  };
}

export async function obterOpcoesVendasErp() {
  const vendas = await lerJson<VendaInterdata[]>(vendasInterdataJsonPath, []);
  return {
    adquirentes: [],
    modalidades: [...new Set(vendas.map((v) => textoFiltro((v as any).tipo_produto || (v as any).forma_pagamento)).filter(Boolean))].sort(),
    bandeiras: [...new Set(vendas.map((v) => textoFiltro((v as any).bandeira)).filter(Boolean))].sort(),
    terminais: [...new Set(vendas.map((v) => textoFiltro((v as any).terminal)).filter(Boolean))].sort(),
    status: [...new Set(vendas.map((v) => textoFiltro((v as any).status_venda)).filter(Boolean))].sort(),
  };
}

export async function listarVendasAdquirentesComExibicao(limite = 500, offset = 0, filtros: FiltrosListagemVendas = {}) {
  const vendas = await lerJson<VendaAdquirente[]>(vendasAdquirentesJsonPath, []);
  const inicio = Math.max(0, Number(offset || 0));
  const tamanhoPagina = Math.max(1, Number(limite || 500));
  const somenteVendas = [...vendas]
    .filter(ehVendaCanonicaAdquirente)
    .map((venda) => ({ ...venda, valor_taxa: normalizarValorTaxaPositivo(venda.valor_taxa) as string | undefined, percentual_taxa: venda.percentual_taxa || calcularPercentualTaxa(venda.valor_bruto, venda.valor_taxa) }))
    .filter((venda) => filtrarVendaAdquirente(venda, filtros))
    .sort(ordenarPorDataVendaDecrescente);
  const fatia = somenteVendas.slice(inicio, inicio + tamanhoPagina);
  return Promise.all(fatia.map((item) => aplicarConversoesEmLinha('vendas_adquirentes', item)));
}

export async function listarConversoes(): Promise<Conversao[]> {
  await garantirDb();
  return lerJson<Conversao[]>(conversoesJsonPath, []);
}

export async function aplicarConversoesEmLinha(tabela: string, linha: Record<string, unknown>) {
  const conversoes = await listarConversoes();
  const saida: Record<string, unknown> = { ...linha };
  const valores_exibicao: Record<string, unknown> = {};
  for (const [coluna, valor] of Object.entries(linha)) {
    const valorTexto = valor === null || valor === undefined ? '' : String(valor);
    const adquirenteLinha = String((linha as Record<string, unknown>).adquirente || '').trim().toUpperCase();
    const regra = encontrarConversaoAtiva(conversoes, tabela, coluna, valorTexto, adquirenteLinha);
    valores_exibicao[coluna] = regra ? regra.valor_exibicao : valor;
  }
  saida.valores_exibicao = valores_exibicao;
  return saida;
}

export async function listarVendasErpComExibicao(limite = 500, offset = 0, filtros: FiltrosListagemVendas = {}) {
  const vendas = await lerJson<VendaInterdata[]>(vendasInterdataJsonPath, []);
  const inicio = Math.max(0, Number(offset || 0));
  const tamanhoPagina = Math.max(1, Number(limite || 500));
  return [...vendas]
    .filter((venda) => filtrarVendaErp(venda, filtros))
    .sort(ordenarPorDataVendaDecrescente)
    .slice(inicio, inicio + tamanhoPagina);
}

export async function listarTabelasBanco() {
  await garantirDb();
  const resultado = [];
  for (const tabela of tabelasSistema) {
    const linhas = await lerJson<Record<string, unknown>[]>(tabela.arquivo, []);
    resultado.push({
      nome: tabela.nome,
      titulo: tabela.titulo,
      descricao: tabela.descricao,
      quantidade_colunas: tabela.colunas.length,
      quantidade_linhas: linhas.length,
      colunas: tabela.colunas,
    });
  }
  return resultado;
}

export async function obterDadosTabela(nomeTabela: string, limite = 500, offset = 0) {
  const tabela = tabelasSistema.find((item) => item.nome === nomeTabela);
  if (!tabela) return null;
  let linhas = await lerJson<Record<string, unknown>[]>(tabela.arquivo, []);

  if (nomeTabela === 'vendas_adquirentes') {
    linhas = (linhas as VendaAdquirente[])
      .filter(ehVendaCanonicaAdquirente)
      .map((venda) => ({ ...venda, valor_taxa: normalizarValorTaxaPositivo(venda.valor_taxa) as string | undefined, percentual_taxa: venda.percentual_taxa || calcularPercentualTaxa(venda.valor_bruto, venda.valor_taxa) })) as unknown as Record<string, unknown>[];
  }

  const total_linhas = linhas.length;
  const inicio = Math.max(0, Number(offset || 0));
  const tamanhoPagina = Math.max(1, Number(limite || 500));
  let linhasLimitadas = linhas.slice(inicio, inicio + tamanhoPagina);

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
  };
}


export async function limparTabelaBanco(nomeTabela: string) {
  const tabela = tabelasSistema.find((item) => item.nome === nomeTabela);
  if (!tabela) return null;
  await garantirDb();
  await gravarJson(tabela.arquivo, []);

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
  const valor_original = String(data.valor_original || '').trim();
  const valor_exibicao = String(data.valor_exibicao || '').trim();
  const adquirente_aplicacao = String(data.adquirente_aplicacao || '').trim().toUpperCase();

  if (!tabela_origem || !coluna_origem || !valor_original || !valor_exibicao) {
    throw new Error('Preencha tabela_origem, coluna_origem, valor_original e valor_exibicao.');
  }

  const registros = await lerJson<Conversao[]>(conversoesJsonPath, []);
  const agora = new Date().toISOString();
  const conversao: Conversao = {
    id: `conv-${Date.now()}`,
    tabela_origem,
    coluna_origem,
    valor_original,
    valor_exibicao,
    adquirente_aplicacao,
    ativo: data.ativo === false ? false : true,
    observacao: String(data.observacao || '').trim(),
    data_criacao: agora,
    data_atualizacao: agora,
  };

  registros.push(conversao);
  await gravarJson(conversoesJsonPath, registros);
  return conversao;
}

export async function atualizarConversaoManual(id: string, data: Partial<Conversao>) {
  await garantirDb();
  const registros = await lerJson<Conversao[]>(conversoesJsonPath, []);
  const index = registros.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const atual = registros[index];
  registros[index] = {
    ...atual,
    tabela_origem: data.tabela_origem !== undefined ? String(data.tabela_origem).trim() : atual.tabela_origem,
    coluna_origem: data.coluna_origem !== undefined ? String(data.coluna_origem).trim() : atual.coluna_origem,
    valor_original: data.valor_original !== undefined ? String(data.valor_original).trim() : atual.valor_original,
    valor_exibicao: data.valor_exibicao !== undefined ? String(data.valor_exibicao).trim() : atual.valor_exibicao,
    adquirente_aplicacao: data.adquirente_aplicacao !== undefined ? String(data.adquirente_aplicacao || '').trim().toUpperCase() : atual.adquirente_aplicacao,
    ativo: data.ativo !== undefined ? Boolean(data.ativo) : atual.ativo,
    observacao: data.observacao !== undefined ? String(data.observacao || '').trim() : atual.observacao,
    data_atualizacao: new Date().toISOString(),
  };
  if (!registros[index].tabela_origem || !registros[index].coluna_origem || !registros[index].valor_original || !registros[index].valor_exibicao) {
    throw new Error('Preencha tabela_origem, coluna_origem, valor_original e valor_exibicao.');
  }
  await gravarJson(conversoesJsonPath, registros);
  return registros[index];
}

export async function excluirConversaoManual(id: string) {
  await garantirDb();
  const registros = await lerJson<Conversao[]>(conversoesJsonPath, []);
  const restante = registros.filter((item) => item.id !== id);
  if (restante.length === registros.length) return null;
  await gravarJson(conversoesJsonPath, restante);
  return { sucesso: true, id };
}

export function obterTipoPersistenciaAtual() {
  return usarPostgres() ? 'postgresql-prisma' : 'json-local';
}
