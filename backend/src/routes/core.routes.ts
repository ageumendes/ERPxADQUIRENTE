import type { Express } from 'express';
import {
  listarImportacoes,
  listarTabelasBanco,
  obterDadosTabela,
  resumoImportacoes,
  limparTabelaBanco,
  listarVendasErpComExibicao,
  listarVendasAdquirentesComExibicao,
  obterOpcoesVendasAdquirentes,
  obterOpcoesVendasErp,
  gerarRelatorioAdquirentes,
  normalizarVendasAdquirentesExistentes,
  obterCoberturaCodigosEstabelecimento,
  recalcularPercentualTaxaVendasAdquirentes,
  obterTipoPersistenciaAtual,
  verificarDuplicidadesImportacao,
  removerDuplicidadesImportacao,
  listarConciliacoesComExibicao,
  executarConciliacaoAutomatica,
  confirmarConciliacao,
  tratarRevisaoCoopcerto,
  desfazerConciliacao,
  obterDetalhesConciliacao,
  operarConciliacoesEmLote,
  listarCandidatosConciliacaoManual,
  criarConciliacaoManual,
  obterDataMaisRecenteErpParaConciliacao,
  obterInicializacaoConciliacoes,
  obterRelatorioRegrasConciliacaoAutomatica,
  tabelasSistema,
} from '../repositorio.js';
import { simularCorrecao, aplicarCorrecao, resumoPlano, desfazerCorrecao } from '../services/correcao-vendas.js';
import { obterStatusRemoteEdi } from '../remote-edi.js';
import { registerAuditoriaRoutes } from './auditoria.routes.js';
import { registerConversoesRoutes } from './conversoes.routes.js';
import { checklistImportacoesDiarias } from '../config/importacoes-diarias.js';
import { autorizar } from '../security/auth.js';
import { getPool } from '../database/pool.js';
import { excluirImportacaoFalhaOuDuplicada } from '../repositories/importacoes.repository.js';
import { executarComAtividadeSegundoPlano } from '../services/atividade-segundo-plano.js';

type StatusPastasImportacao = {
  entrada: number;
  processando: number;
  processados: number;
  erro_raiz: number;
  duplicidades: number;
  layout_desconhecido: number;
  falha_importacao: number;
};

type CoreRoutesDeps = {
  versao: string;
  obterStatusPastasImportacao: () => Promise<StatusPastasImportacao>;
  obterStatusFilaImportacao: () => unknown;
  filaImportacaoLivre: () => boolean;
  recuperarArquivosProcessando: (limite: number, origem: 'manual' | 'boot') => Promise<unknown>;
  logErroImportacao: (contexto: string, error: unknown) => void;
};

function dataBrasilAtualIso() {
  const agora = new Date();
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora);
  const mapa = Object.fromEntries(partes.map((parte) => [parte.type, parte.value]));
  return `${mapa.year}-${mapa.month}-${mapa.day}`;
}

function normalizarDataReferenciaDashboard(valor: unknown) {
  const hoje = dataBrasilAtualIso();
  const texto = String(valor || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return hoje;
  const [ano, mes, dia] = texto.split('-').map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const valida = data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
  return valida && texto <= hoje ? texto : hoje;
}

type DashboardPendenciaImportacao = {
  grupo: string;
  item: string;
  layout_esperado: string;
  status: 'IMPORTADO' | 'PENDENTE' | 'ERRO' | 'EM_PROCESSAMENTO';
  importado_hoje: boolean;
  ultima_importacao: string | null;
  quantidade_registros: number;
  arquivo: string | null;
  layout_detectado: string | null;
  mensagem: string;
};

type DashboardArquivoImportado = {
  importacao_id: string;
  tipo: string;
  data_itens: string;
  data_importacao: string | null;
  quantidade_registros: number;
  arquivo: string;
  layout_detectado: string;
  detalhe: string;
};

type DashboardGrupoImportado = {
  grupo: string;
  status: 'IMPORTADO';
  quantidade_registros: number;
  quantidade_arquivos: number;
  arquivos: DashboardArquivoImportado[];
};

type Importacao = Awaited<ReturnType<typeof listarImportacoes>>[number];

function ocultarCamposInternosImportacao<T extends Record<string, unknown>>(item: T) {
  const { caminho_arquivo: caminhoArquivo, ...seguro } = item;
  const caminho = String(caminhoArquivo || '').replaceAll('\\', '/');
  const pasta_arquivo = caminho.includes('/erro/duplicidades/') ? 'erro/duplicidades'
    : caminho.includes('/erro/layout_desconhecido/') ? 'erro/layout_desconhecido'
      : caminho.includes('/erro/falha_importacao/') ? 'erro/falha_importacao'
        : caminho.includes('/erro/extensao_bloqueada/') ? 'erro/extensao_bloqueada'
          : caminho.includes('/processados/') ? 'processados'
            : caminho.includes('/processando/') ? 'processando'
              : caminho.includes('/entrada/') ? 'entrada'
                : null;
  return { ...seguro, pasta_arquivo };
}

function textoImportacaoParaBusca(item: Importacao) {
  return [
    item.origem_detectada,
    item.layout_detectado,
    item.nome_arquivo_original,
    item.nome_arquivo_salvo,
    item.caminho_arquivo,
  ].map((valor) => String(valor || '').toUpperCase()).join(' ');
}

function dataIsoLocalImportacao(data?: string | null) {
  const texto = String(data || '');
  const iso = texto.match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : '';
}

function statusPendencia(statusImportacao?: string) {
  const status = String(statusImportacao || '').toUpperCase();
  if (status === 'PROCESSADO' || status === 'CLASSIFICADO') return 'IMPORTADO' as const;
  if (status === 'ERRO' || status === 'LAYOUT_DESCONHECIDO' || status === 'EXTENSAO_BLOQUEADA') return 'ERRO' as const;
  if (status === 'RECEBIDO' || status === 'ENFILEIRADO' || status.includes('PROCESSANDO') || status === 'CLASSIFICANDO') return 'EM_PROCESSAMENTO' as const;
  return 'PENDENTE' as const;
}

async function gerarDashboardPendenciasImportacao(dataReferencia = dataBrasilAtualIso()) {
  const dataNormalizada = (alias: string) => `(CASE
    WHEN ${alias}.dados->>'data_venda' ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(${alias}.dados->>'data_venda', 10)
    WHEN ${alias}.dados->>'data_venda' ~ '^\\d{2}/\\d{2}/\\d{4}' THEN SUBSTRING(${alias}.dados->>'data_venda', 7, 4) || '-' || SUBSTRING(${alias}.dados->>'data_venda', 4, 2) || '-' || SUBSTRING(${alias}.dados->>'data_venda', 1, 2)
    ELSE '' END)`;
  const camposDataBrutos = ['data_venda', 'data_transacao', 'data_autorizacao_venda', 'data_captura', 'data_pagamento', 'data_lancamento', 'data_referencia'];
  const tabelasBrutas = tabelasSistema.filter((tabela) =>
    tabela.nome !== 'vendas_adquirentes' && tabela.nome !== 'vendas_interdata'
    && tabela.colunas.includes('importacao_id')
    && camposDataBrutos.some((campo) => tabela.colunas.includes(campo))
    && /^[a-z0-9_]+$/.test(tabela.nome));
  const dataBruta = (alias: string) => `COALESCE(${camposDataBrutos.map((campo) => `${alias}.dados->>'${campo}'`).join(', ')}, '')`;
  const dataBrutaNormalizada = (alias: string) => `(CASE
    WHEN ${dataBruta(alias)} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN LEFT(${dataBruta(alias)}, 10)
    WHEN ${dataBruta(alias)} ~ '^\\d{2}/\\d{2}/\\d{4}' THEN SUBSTRING(${dataBruta(alias)}, 7, 4) || '-' || SUBSTRING(${dataBruta(alias)}, 4, 2) || '-' || SUBSTRING(${dataBruta(alias)}, 1, 2)
    WHEN ${dataBruta(alias)} ~ '^(19|20)\\d{6}$' THEN SUBSTRING(${dataBruta(alias)}, 1, 4) || '-' || SUBSTRING(${dataBruta(alias)}, 5, 2) || '-' || SUBSTRING(${dataBruta(alias)}, 7, 2)
    WHEN ${dataBruta(alias)} ~ '^\\d{8}$' THEN SUBSTRING(${dataBruta(alias)}, 5, 4) || '-' || SUBSTRING(${dataBruta(alias)}, 3, 2) || '-' || SUBSTRING(${dataBruta(alias)}, 1, 2)
    ELSE '' END)`;
  const registrosBrutosSql = tabelasBrutas.map((tabela) =>
    `SELECT dados->>'importacao_id' AS importacao_id, ${dataBrutaNormalizada('b')} AS data_itens FROM "${tabela.nome}" b`).join('\nUNION ALL\n');

  const resultado = await getPool().query<{ importacao: Importacao; data_itens: string; quantidade_registros: number }>(`
    WITH registros_finais AS (
      SELECT dados->>'importacao_id' AS importacao_id, ${dataNormalizada('v')} AS data_itens
      FROM vendas_adquirentes v WHERE v.registro_nao_aplicavel = FALSE
      UNION ALL
      SELECT dados->>'importacao_id' AS importacao_id, ${dataNormalizada('v')} AS data_itens
      FROM vendas_interdata v
    ), registros_brutos AS (
      ${registrosBrutosSql || `SELECT NULL::text AS importacao_id, NULL::text AS data_itens WHERE FALSE`}
    ), totais_brutos AS (
      SELECT importacao_id, data_itens, COUNT(*)::int AS quantidade_registros
      FROM registros_brutos
      WHERE data_itens = $1 AND NULLIF(importacao_id, '') IS NOT NULL
      GROUP BY importacao_id, data_itens
    ), totais_finais AS (
      SELECT importacao_id, data_itens, COUNT(*)::int AS quantidade_registros
      FROM registros_finais
      WHERE data_itens = $1 AND NULLIF(importacao_id, '') IS NOT NULL
      GROUP BY importacao_id, data_itens
    ), totais AS (
      SELECT * FROM totais_brutos
      UNION ALL
      SELECT f.* FROM totais_finais f
      WHERE NOT EXISTS (SELECT 1 FROM totais_brutos b WHERE b.importacao_id = f.importacao_id AND b.data_itens = f.data_itens)
    )
    SELECT i.dados AS importacao, t.data_itens, t.quantidade_registros
    FROM totais t
    JOIN importacoes i ON i.row_id = t.importacao_id
    WHERE COALESCE(i.dados->>'status_importacao', '') IN ('PROCESSADO', 'CLASSIFICADO')
    ORDER BY COALESCE(i.dados->>'data_importacao', '') DESC, i.pk DESC
  `, [dataReferencia]);

  const identificarGrupo = (importacao: Importacao) => {
    const texto = textoImportacaoParaBusca(importacao);
    return checklistImportacoesDiarias.find((check) => check.termos.some((termo) => texto.includes(termo)))?.grupo
      || String(importacao.origem_detectada || 'OUTROS').toUpperCase();
  };
  const tipoAmigavel = (importacao: Importacao) => {
    const texto = textoImportacaoParaBusca(importacao);
    if (texto.includes('CIELO16')) return 'PIX';
    if (texto.includes('CIELO03')) return 'VENDAS';
    if (texto.includes('CIELO04')) return 'PAGAMENTOS';
    if (/(?:^|[-_ ])S(?:[-_ ]|$)/.test(texto)) return 'VENDAS';
    if (/(?:^|[-_ ])P(?:[-_ ]|$)/.test(texto)) return 'PAGAMENTOS';
    if (/(?:^|[-_ ])R(?:[-_ ]|$)/.test(texto)) return 'RECEBIMENTOS';
    if (texto.includes('PIX')) return 'PIX';
    return 'VENDAS';
  };

  const mapa = new Map<string, DashboardGrupoImportado>();
  for (const linha of resultado.rows) {
    const grupo = identificarGrupo(linha.importacao);
    const arquivo: DashboardArquivoImportado = {
      importacao_id: linha.importacao.id,
      tipo: tipoAmigavel(linha.importacao),
      data_itens: linha.data_itens,
      data_importacao: linha.importacao.data_importacao || null,
      quantidade_registros: Number(linha.quantidade_registros || 0),
      arquivo: linha.importacao.nome_arquivo_original,
      layout_detectado: linha.importacao.layout_detectado,
      detalhe: `${Number(linha.quantidade_registros || 0)} registro(s) com data de venda ${linha.data_itens}.`,
    };
    const atual = mapa.get(grupo) || { grupo, status: 'IMPORTADO', quantidade_registros: 0, quantidade_arquivos: 0, arquivos: [] };
    atual.quantidade_registros += arquivo.quantidade_registros;
    atual.quantidade_arquivos += 1;
    atual.arquivos.push(arquivo);
    mapa.set(grupo, atual);
  }
  const grupos = Array.from(mapa.values()).sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt-BR'));
  const resumo = {
    total: grupos.length,
    importados: grupos.length,
    arquivos: grupos.reduce((total, grupo) => total + grupo.quantidade_arquivos, 0),
    registros: grupos.reduce((total, grupo) => total + grupo.quantidade_registros, 0),
  };
  return { data_referencia: dataReferencia, atualizado_em: new Date().toISOString(), resumo, grupos };
}

export function registerCoreRoutes(app: Express, deps: CoreRoutesDeps) {
  registerAuditoriaRoutes(app);
  registerConversoesRoutes(app);
  app.get('/api/poll/status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const [pastas, resumo] = await Promise.all([
      deps.obterStatusPastasImportacao(),
      resumoImportacoes().catch(() => null),
    ]);
    res.json({
      app: 'ERPxADQUIRENTE',
      versao: deps.versao,
      status: 'online',
      armazenamento: obterTipoPersistenciaAtual(),
      timestamp: new Date().toISOString(),
      fila_importacao: deps.obterStatusFilaImportacao(),
      sftp: obterStatusRemoteEdi(),
      pastas_importacao: pastas,
      resumo_importacoes: resumo,
    });
  });

  app.get('/api/dashboard/pendencias-importacao', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const dataReferencia = normalizarDataReferenciaDashboard(req.query.data);
      res.json(await gerarDashboardPendenciasImportacao(dataReferencia));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao gerar pendências de importação.' });
    }
  });

  app.get('/api/importacoes/poll', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const [pastas, resumo, importacoes] = await Promise.all([
      deps.obterStatusPastasImportacao(),
      resumoImportacoes().catch(() => null),
      listarImportacoes(500).catch(() => []),
    ]);
    res.json({
      timestamp: new Date().toISOString(),
      fila_importacao: deps.obterStatusFilaImportacao(),
      sftp: obterStatusRemoteEdi(),
      pastas_importacao: pastas,
      resumo_importacoes: resumo,
      importacoes: importacoes.map((item) => ocultarCamposInternosImportacao(item as unknown as Record<string, unknown>)),
    });
  });

  app.get('/api/importacoes', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json((await listarImportacoes()).map((item) => ocultarCamposInternosImportacao(item as unknown as Record<string, unknown>)));
  });

  app.delete('/api/importacoes/:id', async (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
      res.status(400).json({ mensagem: 'Identificador de importação inválido.' });
      return;
    }
    const resultado = await excluirImportacaoFalhaOuDuplicada(req.params.id, deps.filaImportacaoLivre());
    if (resultado === 'NAO_ENCONTRADA') {
      res.status(404).json({ mensagem: 'Registro de importação não encontrado.' });
      return;
    }
    if (resultado === 'STATUS_BLOQUEADO') {
      res.status(409).json({ mensagem: 'Aguarde a fila terminar. Registros em andamento só podem ser excluídos após cinco minutos sem atualização e com a fila parada.' });
      return;
    }
    res.json({ mensagem: 'Registro excluído do histórico de importações.' });
  });

  app.get('/api/imports', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json((await listarImportacoes()).map((item) => ocultarCamposInternosImportacao(item as unknown as Record<string, unknown>)));
  });

  app.get('/api/importacoes/resumo', async (_req, res) => {
    res.json(await resumoImportacoes());
  });

  app.get('/api/importacoes/fila/status', async (_req, res) => {
    res.json(deps.obterStatusFilaImportacao());
  });

  app.post('/api/importacoes/recovery/processando', async (req, res) => {
    try {
      const limiteBody = req.body && typeof req.body === 'object' ? Number((req.body as any).limite) : NaN;
      const limiteQuery = Number(req.query.limite);
      const limite = Number.isFinite(limiteBody) && limiteBody > 0
        ? limiteBody
        : Number.isFinite(limiteQuery) && limiteQuery > 0
          ? limiteQuery
          : Number(process.env.IMPORTACOES_RECUPERAR_MAX_MANUAL || 50);
      const resultado = await deps.recuperarArquivosProcessando(limite, 'manual');
      res.json({ ...resultado as object, fila_importacao: deps.obterStatusFilaImportacao(), pastas_importacao: await deps.obterStatusPastasImportacao() });
    } catch (error) {
      deps.logErroImportacao('recovery-processando', error);
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao recuperar arquivos em processando/.' });
    }
  });

  app.get('/api/banco/tabelas', async (_req, res) => {
    try {
      res.json(await listarTabelasBanco());
    } catch (error) {
      deps.logErroImportacao('banco-listar-tabelas', error);
      res.status(503).json({ sucesso: false, codigo: 'BANCO_TEMPORARIAMENTE_OCUPADO', mensagem: 'O banco está concluindo uma operação pesada. Tente atualizar a lista de tabelas em alguns segundos.' });
    }
  });

  app.get('/api/banco/tabelas/:nome', async (req, res) => {
    try {
      const limite = Math.min(Number(req.query.limite || 500), 2000);
      const offset = Math.max(Number(req.query.offset || 0), 0);
      const cursorPk = req.query.cursor_pk ? Number(req.query.cursor_pk) : undefined;
      const tabela = await obterDadosTabela(req.params.nome, limite, offset, cursorPk);
      if (!tabela) return res.status(404).json({ sucesso: false, mensagem: 'Tabela não encontrada.' });
      res.json(tabela);
    } catch (error) {
      deps.logErroImportacao(`banco-tabela:${req.params.nome}`, error);
      res.status(503).json({ sucesso: false, codigo: 'BANCO_TEMPORARIAMENTE_OCUPADO', mensagem: 'O banco está concluindo uma operação pesada. Tente novamente em alguns segundos.' });
    }
  });

  app.delete('/api/banco/tabelas/:nome/limpar', async (req, res) => {
    const resultado = await limparTabelaBanco(req.params.nome);
    if (!resultado) return res.status(404).json({ sucesso: false, mensagem: 'Tabela não encontrada.' });
    res.json(resultado);
  });

  app.get('/api/vendas-erp/opcoes', async (req, res) => {
    res.json(await obterOpcoesVendasErp(req.query));
  });

  app.get('/api/vendas-erp', async (req, res) => {
    const limite = Math.min(Number(req.query.limite || 100), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const filtros = {
      busca: req.query.busca,
      data_inicio: req.query.data_inicio,
      data_fim: req.query.data_fim,
      estabelecimento: req.query.estabelecimento,
      forma_pagamento: req.query.forma_pagamento,
      modalidade: req.query.modalidade,
      bandeira: req.query.bandeira,
      duplicidade: req.query.duplicidade ?? 'SEM_DUPLICADOS',
      conciliacao: req.query.conciliacao,
    };
    res.json(await listarVendasErpComExibicao(limite, offset, filtros));
  });

  app.post('/api/vendas-adquirentes/:id/revisao-coopcerto', autorizar(['ADMINISTRADOR', 'FINANCEIRO']), async (req, res) => {
    try {
      res.json(await tratarRevisaoCoopcerto(req.params.id, String(req.body?.hash_recebido || ''),
        String(req.body?.motivo || ''), req.usuario || {}));
    } catch (error) {
      res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Não foi possível tratar a revisão.' });
    }
  });

  app.get('/api/vendas-adquirentes/opcoes', async (req, res) => {
    try {
      res.json(await obterOpcoesVendasAdquirentes(req.query));
    } catch (error) {
      deps.logErroImportacao('vendas-adquirentes-opcoes', error);
      res.status(503).json({ sucesso: false, codigo: 'BANCO_TEMPORARIAMENTE_OCUPADO', mensagem: 'O banco está ocupado. Tente atualizar os filtros novamente em alguns segundos.' });
    }
  });

  app.get('/api/vendas-adquirentes', async (req, res) => {
    const limite = Math.min(Number(req.query.limite || 100), 500);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const filtros = {
      busca: req.query.busca,
      data_inicio: req.query.data_inicio,
      data_fim: req.query.data_fim,
      adquirente: req.query.adquirente,
      estabelecimento: req.query.estabelecimento,
      forma_pagamento: req.query.forma_pagamento,
      modalidade: req.query.modalidade,
      bandeira: req.query.bandeira,
      status: req.query.status,
      conciliacao: req.query.conciliacao,
    };
    res.json(await listarVendasAdquirentesComExibicao(limite, offset, filtros));
  });

  app.post('/api/vendas-adquirentes/normalizar', async (_req, res) => {
    try {
      // A ação administrativa da tela Banco é deliberadamente GLOBAL. Ela reaplica
      // todas as regras ativas em vendas_interdata e vendas_adquirentes, inclusive
      // sobre importações históricas. O worker pós-importação usa o modo LOTE.
      res.json(await executarComAtividadeSegundoPlano('conversoes', () => normalizarVendasAdquirentesExistentes({ modo: 'GLOBAL' })));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao normalizar vendas_adquirentes.' });
    }
  });

  app.get('/api/vendas-adquirentes/estabelecimentos/cobertura', async (_req, res) => {
    try { res.json(await obterCoberturaCodigosEstabelecimento()); }
    catch (error) { res.status(500).json({ sucesso:false,mensagem:error instanceof Error ? error.message : 'Erro ao medir códigos de estabelecimento.' }); }
  });

  app.post('/api/vendas-adquirentes/recalcular-percentual-taxa', async (_req, res) => {
    try {
      res.json(await recalcularPercentualTaxaVendasAdquirentes());
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao recalcular percentual_taxa.' });
    }
  });

  app.get('/api/relatorios-adquirentes', async (req, res) => {
    const relatorio = await gerarRelatorioAdquirentes({
      busca: req.query.busca,
      data_inicio: req.query.data_inicio,
      data_fim: req.query.data_fim,
      estabelecimento: req.query.estabelecimento,
      adquirente: req.query.adquirente,
      forma_pagamento: req.query.forma_pagamento,
      modalidade: req.query.modalidade,
      bandeira: req.query.bandeira,
      status: req.query.status,
    });
    res.json(relatorio);
  });



  app.get('/api/conciliacoes', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const limite = Math.min(Number(req.query.limite || 500), 2000);
      const offset = Math.max(Number(req.query.offset || 0), 0);
      const statusInformado = String(req.query.status || 'PENDENTE').toUpperCase();
      const status = ['PENDENTE', 'CONCILIADO', 'SUGERIDO', 'AMBIGUO', 'TODOS'].includes(statusInformado)
        ? statusInformado as 'PENDENTE' | 'CONCILIADO' | 'SUGERIDO' | 'AMBIGUO' | 'TODOS'
        : 'PENDENTE';
      res.json(await listarConciliacoesComExibicao(limite, offset, status, {
        busca: String(req.query.busca || ''),
        estabelecimento: String(req.query.estabelecimento || ''),
        adquirente: String(req.query.adquirente || ''),
        dataInicial: String(req.query.data_inicial || ''),
        dataFinal: String(req.query.data_final || ''),
        scoreMinimo: req.query.score_minimo === undefined || req.query.score_minimo === '' ? undefined : Number(req.query.score_minimo),
        scoreMaximo: req.query.score_maximo === undefined || req.query.score_maximo === '' ? undefined : Number(req.query.score_maximo),
        tipoMatch: String(req.query.tipo_match || ''),
      }, String(req.query.incluir_contadores ?? '1') !== '0'));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao listar conciliações.' });
    }
  });

  app.get('/api/conciliacoes/manual/candidatos', async (req, res) => {
    try {
      const lado = String(req.query.lado || 'ERP').toUpperCase() === 'ADQUIRENTE' ? 'ADQUIRENTE' : 'ERP';
      res.setHeader('Cache-Control', 'no-store');
      res.json(await listarCandidatosConciliacaoManual(lado, Number(req.query.limite || 80), Number(req.query.offset || 0), String(req.query.busca || ''), String(req.query.adquirente || ''), String(req.query.data_inicial || ''), String(req.query.data_final || ''), String(req.query.estabelecimento || ''), String(req.query.priorizar_erp_id || ''), req.query.status === undefined ? 'AUTORIZADO' : String(req.query.status)));
    } catch (error) { res.status(500).json({sucesso:false,mensagem:error instanceof Error?error.message:'Erro ao listar candidatos manuais.'}); }
  });

  app.get('/api/conciliacoes/data-mais-recente-erp', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await obterDataMaisRecenteErpParaConciliacao());
    } catch (error) {
      res.status(500).json({ sucesso:false, mensagem:error instanceof Error ? error.message : 'Erro ao obter a data mais recente do ERP.' });
    }
  });

  app.get('/api/conciliacoes/inicializacao', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await obterInicializacaoConciliacoes({
        estabelecimento: String(req.query.estabelecimento || ''),
        adquirente: String(req.query.adquirente || ''),
        dataInicial: String(req.query.data_inicial || ''),
        dataFinal: String(req.query.data_final || ''),
      }));
    } catch (error) {
      res.status(500).json({ sucesso:false, mensagem:error instanceof Error ? error.message : 'Erro ao inicializar a Central de Conciliações.' });
    }
  });

  app.post('/api/conciliacoes/manual', async (req, res) => {
    try {
      res.json(await executarComAtividadeSegundoPlano('conciliacao', () => criarConciliacaoManual(String(req.body?.venda_interdata_id || ''), String(req.body?.venda_adquirente_id || ''), String(req.body?.motivo || ''), req.usuario, Boolean(req.body?.recebimento))));
    } catch (error) { res.status(400).json({sucesso:false,mensagem:error instanceof Error?error.message:'Erro ao criar conciliação manual.'}); }
  });

  app.get('/api/conciliacoes/:id/detalhes', async (req, res) => {
    try { res.json(await obterDetalhesConciliacao(String(req.params.id || ''))); }
    catch (error) { res.status(404).json({ sucesso:false, mensagem:error instanceof Error?error.message:'Conciliação não encontrada.' }); }
  });


  app.get('/api/conciliacoes/relatorio-regras', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(obterRelatorioRegrasConciliacaoAutomatica());
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao gerar relatório da conciliação.' });
    }
  });

  app.post('/api/conciliacoes/:id/confirmar', async (req, res) => {
    try {
      res.json(await executarComAtividadeSegundoPlano('conciliacao', () => confirmarConciliacao(String(req.params.id || ''), req.body?.motivo, req.usuario)));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao confirmar conciliação.' });
    }
  });

  app.post('/api/conciliacoes/:id/desfazer', async (req, res) => {
    try {
      res.json(await executarComAtividadeSegundoPlano('conciliacao', () => desfazerConciliacao(String(req.params.id || ''), req.body?.motivo, req.usuario)));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao desfazer conciliação.' });
    }
  });

  app.post('/api/conciliacoes/lote', async (req, res) => {
    try {
      const acao = String(req.body?.acao || '').toLowerCase();
      if (!['confirmar','desfazer'].includes(acao)) return res.status(400).json({sucesso:false,mensagem:'Ação em lote inválida.'});
      res.json(await executarComAtividadeSegundoPlano('conciliacao', () => operarConciliacoesEmLote(Array.isArray(req.body?.ids)?req.body.ids:[], acao as 'confirmar'|'desfazer', req.body?.motivo, req.usuario)));
    } catch (error) { res.status(400).json({sucesso:false,mensagem:error instanceof Error?error.message:'Erro na operação em lote.'}); }
  });

  app.post('/api/conciliacoes/automaticas/executar', async (req, res) => {
    try {
      const confirmarAutomatico = req.body && typeof req.body === 'object' && 'confirmarAutomatico' in req.body ? Boolean((req.body as any).confirmarAutomatico) : true;
      const corpo = (req.body && typeof req.body === 'object' ? req.body : {}) as any;
      res.json(await executarComAtividadeSegundoPlano('conciliacao', () => executarConciliacaoAutomatica({
        confirmarAutomatico,
        incluirProvaveis: Boolean(corpo.incluirProvaveis),
        tamanhoLote: Math.max(100, Math.min(Number(corpo.tamanhoLote || 500), 2000)),
        dataInicial: corpo.dataInicial,
        dataFinal: corpo.dataFinal,
        adquirentes: Array.isArray(corpo.adquirentes) ? corpo.adquirentes : undefined,
      })));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao executar conciliação automática.' });
    }
  });

  app.post('/api/conciliacoes/automaticas/simular', async (req, res) => {
    try {
      const corpo = (req.body && typeof req.body === 'object' ? req.body : {}) as any;
      res.json(await executarComAtividadeSegundoPlano('conciliacao', () => executarConciliacaoAutomatica({
        confirmarAutomatico: false,
        simular: true,
        tamanhoLote: Math.max(100, Math.min(Number(corpo.tamanhoLote || 500), 2000)),
        dataInicial: corpo.dataInicial,
        dataFinal: corpo.dataFinal,
        adquirentes: Array.isArray(corpo.adquirentes) ? corpo.adquirentes : undefined,
      })));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao simular conciliação automática.' });
    }
  });

  app.post('/api/duplicidades/verificar', async (req, res) => {
    try {
      const aplicarParam = String(req.query.aplicar ?? (req.body && typeof req.body === 'object' ? (req.body as any).aplicar : 'true')).toLowerCase();
      const aplicar = !['false', '0', 'nao', 'não'].includes(aplicarParam);
      res.json(await verificarDuplicidadesImportacao({ aplicar }));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao verificar duplicidades.' });
    }
  });

  app.get('/api/duplicidades/verificar', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await verificarDuplicidadesImportacao({ aplicar: false }));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao consultar duplicidades.' });
    }
  });

  app.post('/api/correcao-vendas/simular', async (req, res) => {
    try {
      const corpo = (req.body && typeof req.body === 'object' ? req.body : {}) as any;
      const fase = corpo.fase === 'vouchers' ? 'vouchers' : 'duplicidades';
      const limite = Math.max(1, Math.min(Number(corpo.limite || 200), 1000));
      const plano = resumoPlano(await simularCorrecao(fase, limite));
      res.json({ sucesso: true, plano });
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao simular correção.' });
    }
  });

  app.post('/api/correcao-vendas/aplicar', async (req, res) => {
    try {
      const plano = (req.body && typeof req.body === 'object' ? (req.body as any).plano : null);
      if (!plano || plano.versao !== 1 || !plano.assinatura) return res.status(400).json({ sucesso: false, mensagem: 'Plano de correção revisado é obrigatório.' });
      res.json({ sucesso: true, resultado: await aplicarCorrecao(plano) });
    } catch (error) {
      res.status(409).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Plano desatualizado ou inválido.' });
    }
  });

  app.post('/api/correcao-vendas/desfazer', async (req, res) => {
    try {
      const execucao = String((req.body && typeof req.body === 'object' ? (req.body as any).execucao : '') || '').trim();
      if (!execucao) return res.status(400).json({ sucesso: false, mensagem: 'Execução de correção é obrigatória.' });
      res.json({ sucesso: true, resultado: await desfazerCorrecao(execucao) });
    } catch (error) {
      res.status(409).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Não foi possível desfazer a correção.' });
    }
  });


  app.post('/api/duplicidades/remover', async (req, res) => {
    try {
      const tabela = String((req.body && typeof req.body === 'object' ? (req.body as any).tabela : '') || 'ambas') as 'vendas_adquirentes' | 'vendas_interdata' | 'ambas';
      const manter = String((req.body && typeof req.body === 'object' ? (req.body as any).manter : '') || 'mais_antigo') as 'mais_antigo' | 'mais_recente';
      res.json(await removerDuplicidadesImportacao({ tabela, manter }));
    } catch (error) {
      res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao remover duplicidades.' });
    }
  });

}
