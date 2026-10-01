import { registerSftpBrowserRoutes } from './routes/sftp-browser.routes.js';
import { simularCorrecao, aplicarCorrecao, resumoPlano } from './services/correcao-vendas.js';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { randomUUID } from 'node:crypto';
import { classificarArquivo } from './classifier.js';
import { entradaDir, processandoDir, processadosDir, erroDir } from './paths.js';
import { calcularHashArquivo, garantirPastas, validarExtensao } from './utils.js';
import { coletarRemoteEdi, pingRemoteEdi, obterStatusCredencialSftp, salvarCredencialSftp, removerCredencialSftp } from './remote-edi.js';
import { parseLayoutInterdata } from './parsers/interdata.js';
import { parseSipagLayout20 } from './parsers/sipag-layout-2-0.js';
import { parseSipagFiserv76 } from './parsers/sipag-fiserv-layout-7-6.js';
import { parseCieloLayout1515 } from './parsers/cielo-layout-15-15.js';
import { parseSicrediFiserv74 } from './parsers/sicredi-fiserv-layout-7-4.js';
import { parseConvcard203 } from './parsers/convcard-layout-2-0-3.js';
import { parseSicoobPspPixJson } from './parsers/sicoob-psp-pix-json.js';
import { parseVrLayout16ap } from './parsers/vr-layout-16ap.js';
import { parsePluxeeLayout } from './parsers/pluxee-layout.js';
import { parseAleloLayout } from './parsers/alelo-layout.js';
import { parseTicketCeAdm40 } from './parsers/ticket-ceadm40.js';
import { parseSipagVendasPixCsv } from './parsers/sipag-vendas-pix-csv.js';
import { parseSipagExtratoCsv, validarLayoutExtratoSipagPermitido } from './parsers/sipag-extratos-csv.js';
import { parseCoopcertoCabalVendasCsv } from './parsers/coopcerto-cabal-vendas-csv.js';
import { parseCoopcertoExtratoCsv, type TipoExtratoCoopcerto } from './parsers/coopcerto-extratos-csv.js';
import {
  atualizarImportacao,
  buscarImportacaoPorHash,
  buscarImportacaoPendentePorHash,
  criarImportacao,
  removerLinhasImportadasLegadas,
  salvarVendasErp,
  salvarSipagLayout20,
  salvarSipagFiserv76,
  salvarCieloLayout1515Cielo03,
  salvarCieloLayout1515Cielo04,
  salvarCieloLayout1515Cielo16,
  salvarSicrediFiserv74,
  salvarConvcard203,
  salvarVendasAdquirentes,
  salvarSicoobLayoutPspPix,
  salvarVrLayout16ap,
  salvarPluxeeLayout,
  salvarAleloLayout,
  salvarAleloPagamentos,
  salvarTicketCeAdm40,
  salvarSipagVendasPixCsv,
  salvarSipagExtrato,
  salvarCoopcertoCabalVendasCsv,
  salvarCoopcertoExtrato,
  normalizarVendasAdquirentesExistentes,
  executarConciliacaoAutomatica,
  verificarBasesDisponiveisParaConciliacao,
  consolidarVendasVoucherCapturadas,
  prepararConsultasOtimizadas,
} from './repositorio.js';
import { bootstrapDatabase } from './database/bootstrap.js';
import { registerCoreRoutes } from './routes/core.routes.js';
import { obterAtividadesSegundoPlano } from './services/atividade-segundo-plano.js';
import { erroBancoTemporariamenteIndisponivel, protegerRotasAssincronas } from './http/async-routes.js';
import { registerDeprecatedSicoobApiRoutes } from './routes/deprecated-sicoob-api.routes.js';
import { alterarPropriaSenha, autenticar, atualizarUsuario, criarUsuario, exigirAdmin, exigirEscrita, inicializarSeguranca, listarUsuariosSeguros, login, middlewareAuditoria, autorizar, auditar } from './security/auth.js';
import { cabecalhosSeguranca, limitarRequisicoes, limitarLogin, liberarLimiteLogin } from './security/security.middleware.js';
import { agendarRetencaoArquivos } from './services/retencao-arquivos.js';
import readline from 'node:readline';
import { APP_VERSION } from './version.js';
import { closePool } from './database/pool.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function carregarEnvAutomaticamente() {
  const candidatos = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../backend/.env'),
  ];

  for (const envPath of candidatos) {
    try {
      const conteudo = await fs.readFile(envPath, 'utf8');
      for (const linhaOriginal of conteudo.split(/\r?\n/)) {
        const linha = linhaOriginal.trim();
        if (!linha || linha.startsWith('#')) continue;
        const indice = linha.indexOf('=');
        if (indice <= 0) continue;
        const chave = linha.slice(0, indice).trim();
        let valor = linha.slice(indice + 1).trim();
        if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
          valor = valor.slice(1, -1);
        }
        if (process.env[chave] === undefined) process.env[chave] = valor;
      }
      console.log(`.env carregado automaticamente de ${envPath}`);
      return envPath;
    } catch {
      // tenta próximo caminho
    }
  }
  console.log('Nenhum arquivo .env encontrado automaticamente. Usando variáveis de ambiente do processo.');
  return null;
}

await carregarEnvAutomaticamente();

const app = express();
protegerRotasAssincronas(app);
const port = Number(process.env.PORT || 3333);
const versao = APP_VERSION;

const origensPermitidas = String(process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((item) => item.trim()).filter(Boolean);
app.disable('x-powered-by');
app.use(cabecalhosSeguranca);
app.use(limitarRequisicoes);
app.use(cors({ origin(origin, callback) { if (!origin || origensPermitidas.includes(origin)) return callback(null, true); callback(new Error('Origem não permitida pelo CORS.')); }, credentials: false }));
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    const duracaoMs = Number(process.hrtime.bigint() - inicio) / 1_000_000;
    if (req.path.startsWith('/api/')) {
      const nivel = duracaoMs >= 1000 ? 'http:lenta' : 'http';
      console.log(`[${nivel}] ${req.method} ${req.path} ${res.statusCode} ${duracaoMs.toFixed(1)}ms`);
    }
  });
  next();
});

await bootstrapDatabase();
console.log('[database] Verificando índices de consulta e conciliação...');
await prepararConsultasOtimizadas();
console.log('[database] Índices de consulta e conciliação prontos.');
await inicializarSeguranca();

app.get('/api/health', (_req, res) => res.json({ app: 'ERPxADQUIRENTE', versao, status: 'online', autenticacao: 'obrigatoria' }));
app.post('/api/auth/login', limitarLogin, async (req, res) => {
  const resultado = await login(req.body?.login, req.body?.senha);
  if (!resultado) {
    void auditar(req, 401, { evento: 'LOGIN_REJEITADO', login: String(req.body?.login || '').trim().toLowerCase().slice(0, 80) }).catch((error) => console.error('[auditoria] Falha ao registrar login rejeitado:', error instanceof Error ? error.message : String(error)));
    return res.status(401).json({ sucesso: false, mensagem: 'Login ou senha inválidos.' });
  }
  req.usuario = resultado.usuario;
  liberarLimiteLogin(req);
  void auditar(req, 200, { evento: 'LOGIN_ACEITO' }).catch((error) => console.error('[auditoria] Falha ao registrar login aceito:', error instanceof Error ? error.message : String(error)));
  res.json({ sucesso: true, ...resultado });
});
app.use('/api', autenticar);
app.use('/api', (req, res, next) => {
  if (!req.usuario?.trocar_senha || req.path === '/auth/alterar-senha' || req.path === '/auth/me') return next();
  return res.status(403).json({ sucesso: false, codigo: 'TROCA_SENHA_OBRIGATORIA', mensagem: 'Altere a senha antes de acessar as demais funções.' });
});
app.use('/api', middlewareAuditoria);
app.get('/api/auth/me', (req, res) => res.json({ usuario: req.usuario }));
app.post('/api/auth/alterar-senha', async (req, res) => { try { await alterarPropriaSenha(req.usuario!.id, req.body?.senha_atual, req.body?.nova_senha); res.json({ sucesso: true, mensagem: 'Senha alterada.' }); } catch (error) { res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao alterar senha.' }); } });
app.get('/api/usuarios', exigirAdmin, async (_req, res) => res.json({ usuarios: await listarUsuariosSeguros() }));
app.post('/api/usuarios', exigirAdmin, async (req, res) => { try { res.status(201).json({ sucesso: true, usuario: await criarUsuario(req.body) }); } catch (error) { res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao criar usuário.' }); } });
app.patch('/api/usuarios/:id', exigirAdmin, async (req, res) => { try { res.json({ sucesso: true, usuario: await atualizarUsuario(req.params.id, req.body, req.usuario!.id) }); } catch (error) { res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao atualizar usuário.' }); } });

// Autorização é aplicada no servidor, independentemente do que o frontend exiba.
app.use('/api/banco', exigirAdmin);
app.use('/api/conversoes', (req, res, next) => req.method === 'GET' ? next() : exigirAdmin(req, res, next));
app.use('/api/conciliacoes', (req, res, next) => req.method === 'GET' ? next() : autorizar(['ADMINISTRADOR', 'FINANCEIRO'])(req, res, next));
app.use('/api/duplicidades', exigirAdmin);
app.use('/api/auditoria', exigirAdmin);
app.use('/api/vendas-adquirentes/normalizar', exigirAdmin);
app.use('/api/vendas-adquirentes/recalcular-percentual-taxa', exigirAdmin);
app.use('/api/correcao-vendas', exigirAdmin);
app.use('/api/importacoes', (req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : exigirEscrita(req, res, next));
app.use('/api/imports', (req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : exigirEscrita(req, res, next));

// Desde a v0.1.82 o app não consulta mais a API PIX Sicoob. Os JSONs são
// produzidos externamente e entram exclusivamente pelo provider SFTP SICOOB.
registerDeprecatedSicoobApiRoutes(app);

function logErroImportacao(contexto: string, error: unknown) {
  const erro = error instanceof Error ? error : new Error(String(error));
  console.error(`[importacao:${contexto}] ${erro.message}`);
  if (erro.stack) console.error(erro.stack);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function contarArquivosDiretorio(dir: string): Promise<number> {
  const itens = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return itens.filter((item) => item.isFile()).length;
}

async function obterStatusPastasImportacao() {
  const [entrada, processando, processados, erro, duplicidades, layoutDesconhecido, falhaImportacao] = await Promise.all([
    contarArquivosDiretorio(entradaDir),
    contarArquivosDiretorio(processandoDir),
    contarArquivosDiretorio(processadosDir),
    contarArquivosDiretorio(erroDir),
    contarArquivosDiretorio(erroDuplicidadesDir),
    contarArquivosDiretorio(erroLayoutDesconhecidoDir),
    contarArquivosDiretorio(erroFalhaImportacaoDir),
  ]);
  return { entrada, processando, processados, erro_raiz: erro, duplicidades, layout_desconhecido: layoutDesconhecido, falha_importacao: falhaImportacao };
}

await garantirPastas();
removerLinhasImportadasLegadas().catch((error) => console.warn(`[database] Não foi possível remover linhas_importadas legada: ${error instanceof Error ? error.message : String(error)}`));

const erroDuplicidadesDir = path.join(erroDir, 'duplicidades');
const erroLayoutDesconhecidoDir = path.join(erroDir, 'layout_desconhecido');
const erroFalhaImportacaoDir = path.join(erroDir, 'falha_importacao');
const erroExtensaoBloqueadaDir = path.join(erroDir, 'extensao_bloqueada');
await Promise.all([
  erroDuplicidadesDir,
  erroLayoutDesconhecidoDir,
  erroFalhaImportacaoDir,
  erroExtensaoBloqueadaDir,
].map((dir) => fs.mkdir(dir, { recursive: true })));

function nomeArquivoTemporario(nomeArquivo: string): boolean {
  const lower = nomeArquivo.toLowerCase();
  return nomeArquivo.startsWith('.') || lower.endsWith('.tmp') || lower.endsWith('.part') || lower.endsWith('.crdownload');
}

function nomeSeguroArquivo(nomeArquivo: string): string {
  const ext = path.extname(nomeArquivo);
  const base = path.basename(nomeArquivo, ext).replace(/[^a-zA-Z0-9._ -]+/g, '_').trim().slice(0, 160) || 'arquivo';
  const extSeguro = ext.replace(/[^a-zA-Z0-9.]+/g, '').slice(0, 20);
  return `${base}${extSeguro}`;
}

async function existeArquivo(caminho: string): Promise<boolean> {
  try {
    await fs.access(caminho);
    return true;
  } catch {
    return false;
  }
}

async function moverPreservandoNome(origem: string, destinoDir: string, nomeArquivo: string): Promise<string> {
  await fs.mkdir(destinoDir, { recursive: true });
  const origemExiste = await existeArquivo(origem);
  if (!origemExiste) {
    const erro = new Error(`Arquivo de origem não existe mais para mover: ${origem}`) as NodeJS.ErrnoException;
    erro.code = 'ENOENT';
    throw erro;
  }

  const nomeSeguro = nomeSeguroArquivo(nomeArquivo);
  let destino = path.join(destinoDir, nomeSeguro);
  if (await existeArquivo(destino)) {
    // Preserva o nome do arquivo. Quando já existe arquivo com o mesmo nome,
    // isola em uma subpasta de colisão em vez de renomear para "-1" ou "duplicado-*".
    const pastaColisao = path.join(destinoDir, '_nomes_repetidos', String(Date.now()), randomUUID());
    await fs.mkdir(pastaColisao, { recursive: true });
    destino = path.join(pastaColisao, nomeSeguro);
  }
  await fs.rename(origem, destino);
  return destino;
}

async function registrarArquivoDuplicado(params: {
  caminhoArquivo: string;
  nomeArquivo: string;
  nomeOriginal?: string;
  tipoMime?: string;
  hashArquivo: string;
  tamanhoBytes?: number;
  importacaoExistente?: any;
  contexto: 'watcher' | 'upload' | 'endpoint';
}) {
  const stat = params.tamanhoBytes === undefined ? await fs.stat(params.caminhoArquivo).catch(() => null) : null;
  const destino = await moverPreservandoNome(params.caminhoArquivo, erroDuplicidadesDir, params.nomeArquivo);
  const existente = params.importacaoExistente;
  const importacao = await criarImportacao({
    nome_arquivo_original: params.nomeOriginal || params.nomeArquivo,
    nome_arquivo_salvo: path.basename(destino),
    caminho_arquivo: destino,
    tamanho_bytes: params.tamanhoBytes ?? stat?.size ?? 0,
    tipo_mime: params.tipoMime || 'application/octet-stream',
    hash_arquivo: params.hashArquivo,
    origem_detectada: existente?.origem_detectada || 'DESCONHECIDO',
    layout_detectado: existente?.layout_detectado || 'DUPLICIDADE_DE_ARQUIVO',
    status_importacao: 'ARQUIVO_DUPLICADO',
    quantidade_registros: 0,
    quantidade_processados: 0,
    quantidade_erros: 0,
    mensagem_erro: `Arquivo duplicado detectado por hash. Importação original: ${existente?.id || 'não identificada'}. Arquivado em erro/duplicidades sem alterar o nome do arquivo.`,
  });
  console.log(`[fila-importacao] duplicidade detectada (${params.contexto}): ${path.basename(destino)} -> erro/duplicidades/`);
  return { importacao, destino };
}

async function processarArquivoManualDaEntrada(caminhoEntrada: string, nomeArquivo: string): Promise<void> {
  try {
    validarExtensao(nomeArquivo);
  } catch {
    await moverPreservandoNome(caminhoEntrada, erroExtensaoBloqueadaDir, nomeArquivo).catch(() => undefined);
    return;
  }

  const hash_arquivo = await calcularHashArquivo(caminhoEntrada);

  // Se o backend reiniciou durante uma importação, o arquivo pode voltar de
  // processando/ para entrada/. Nesse caso já existe uma importação pendente
  // com o mesmo hash, e ela deve ser retomada, não tratada como duplicada final.
  const pendente = await buscarImportacaoPendentePorHash(hash_arquivo);
  if (pendente) {
    const caminhoProcessando = await moverPreservandoNome(caminhoEntrada, processandoDir, nomeArquivo);
    await atualizarImportacao(pendente.id, {
      caminho_arquivo: caminhoProcessando,
      nome_arquivo_salvo: path.basename(caminhoProcessando),
      status_importacao: 'RECUPERADO_REENFILEIRADO',
      mensagem_erro: null,
    });
    enfileirarImportacao({
      importacaoId: pendente.id,
      caminhoArquivo: caminhoProcessando,
      nomeOriginal: pendente.nome_arquivo_original || nomeArquivo,
      origemFila: 'watcher',
    }).catch((error) => logErroImportacao(`fila-recuperada:${pendente.id}`, error));
    return;
  }

  const duplicada = await buscarImportacaoPorHash(hash_arquivo);
  if (duplicada) {
    await registrarArquivoDuplicado({
      caminhoArquivo: caminhoEntrada,
      nomeArquivo,
      hashArquivo: hash_arquivo,
      importacaoExistente: duplicada,
      contexto: 'watcher',
    });
    return;
  }

  // Move imediatamente para PROCESSANDO para liberar a pasta ENTRADA.
  // A fila controla a importação real, um arquivo por vez.
  const caminhoProcessando = await moverPreservandoNome(caminhoEntrada, processandoDir, nomeArquivo);
  const stat = await fs.stat(caminhoProcessando);
  const importacao = await criarImportacao({
    nome_arquivo_original: nomeArquivo,
    nome_arquivo_salvo: path.basename(caminhoProcessando),
    caminho_arquivo: caminhoProcessando,
    tamanho_bytes: stat.size,
    tipo_mime: 'application/octet-stream',
    hash_arquivo,
    origem_detectada: 'DESCONHECIDO',
    layout_detectado: 'AGUARDANDO_CLASSIFICACAO',
    status_importacao: 'RECEBIDO',
    quantidade_registros: 0,
    quantidade_processados: 0,
    quantidade_erros: 0,
    mensagem_erro: null,
  });

  enfileirarImportacao({
    importacaoId: importacao.id,
    caminhoArquivo: caminhoProcessando,
    nomeOriginal: nomeArquivo,
    origemFila: 'watcher',
  }).catch((error) => logErroImportacao(`fila:${importacao.id}`, error));
}

type TarefaImportacao = {
  importacaoId: string;
  caminhoArquivo: string;
  nomeOriginal: string;
  origemFila: 'upload' | 'watcher' | 'sftp' | 'endpoint';
  resolve: (statusFinal: string) => void;
  reject: (error: unknown) => void;
};

const filaImportacao: TarefaImportacao[] = [];
let filaRodando = false;
let tarefaAtual: TarefaImportacao | null = null;
let lotePossuiNovaImportacaoConciliavel = false;
const importacoesPendentesPosProcessamento = new Set<string>();
let bloqueiosPosProcessamentoImportacao = 0;
let posProcessamentoImportacaoRodando: Promise<void> | null = null;
let etapaPosProcessamentoImportacao: '' | 'conversoes' | 'conciliacao' = '';
let temporizadorPosProcessamentoImportacao: NodeJS.Timeout | null = null;
let conciliacaoAutomaticaRodando: Promise<void> | null = null;
let conciliacaoAutomaticaPendente = false;
let consolidacaoVoucherRodando: Promise<Awaited<ReturnType<typeof consolidarVendasVoucherCapturadas>>> | null = null;
const caminhosEnfileiradosOuEmProcessamento = new Set<string>();

async function executarConsolidacaoVoucherComLock(origem: 'automatica' | 'manual', escopo: { dataInicial?: string; dataFinal?: string } = {}) {
  if (consolidacaoVoucherRodando) {
    console.log(`[voucher-consolidacao] execução já em andamento; origem=${origem} aguardando a execução atual.`);
    await consolidacaoVoucherRodando;
    return executarConsolidacaoVoucherComLock(origem, escopo);
  }

  consolidacaoVoucherRodando = (async () => {
    const inicio = Date.now();
    console.log(`[voucher-consolidacao] iniciando origem=${origem}.`);
    const resultado = await consolidarVendasVoucherCapturadas(undefined, escopo);
    console.log(`[voucher-consolidacao] capturas_analisadas=${resultado.capturas_analisadas} vinculos_criados=${resultado.vinculos_criados} ja_vinculados=${resultado.ja_vinculados} ambiguos=${resultado.ambiguos} sem_correspondencia=${resultado.sem_correspondencia} duplicidades_internas_suprimidas=${resultado.duplicidades_internas_suprimidas} tolerancia_segundos=${resultado.tolerancia_segundos} tempo_ms=${Date.now() - inicio}`);
    for (const item of resultado.por_adquirente || []) {
      if (item.capturas_analisadas || item.vinculos_criados || item.duplicidades_internas_suprimidas) {
        console.log(`[voucher-consolidacao:${item.adquirente}] capturas=${item.capturas_analisadas} vinculadas=${item.vinculos_criados} ja_vinculadas=${item.ja_vinculados} ambiguas=${item.ambiguos} sem_vinculo=${item.sem_correspondencia} duplicidades_internas=${item.duplicidades_internas_suprimidas}`);
      }
    }
    return resultado;
  })().finally(() => {
    consolidacaoVoucherRodando = null;
  });

  return consolidacaoVoucherRodando;
}

async function acionarConciliacaoAutomaticaAposImportacao(escopo: { dataInicial?: string; dataFinal?: string } = {}): Promise<void> {
  conciliacaoAutomaticaPendente = true;
  if (conciliacaoAutomaticaRodando) {
    console.log('[conciliacao-automatica] execução já em andamento; nova passagem agendada.');
    return conciliacaoAutomaticaRodando;
  }

  conciliacaoAutomaticaRodando = (async () => {
    while (conciliacaoAutomaticaPendente) {
      conciliacaoAutomaticaPendente = false;
      // A consolidação entre adquirentes independe da presença de vendas ERP.
      await executarConsolidacaoVoucherComLock('automatica', escopo);
      const bases = await verificarBasesDisponiveisParaConciliacao();
      if (!bases.possuiErp || !bases.possuiAdquirente) {
        console.log(`[conciliacao-automatica] aguardando as duas origens (ERP=${bases.possuiErp}, adquirente=${bases.possuiAdquirente}).`);
        continue;
      }

      console.log('[conciliacao-automatica] consolidação VOUCHER concluída; iniciando conciliação.');
      const resultado = await executarConciliacaoAutomatica({
        confirmarAutomatico: true,
        incluirProvaveis: false,
        simular: false,
        tamanhoLote: 500,
        dataInicial: escopo.dataInicial,
        dataFinal: escopo.dataFinal,
      });
      console.log(`[conciliacao-automatica] concluída: ${JSON.stringify(resultado)}`);
    }
  })()
    .catch((error) => logErroImportacao('conciliacao-automatica-pos-importacao', error))
    .finally(() => {
      conciliacaoAutomaticaRodando = null;
    });

  return conciliacaoAutomaticaRodando;
}

function obterStatusFilaImportacao() {
  const atividadesManuais = obterAtividadesSegundoPlano();
  const importando = filaRodando || Boolean(tarefaAtual) || filaImportacao.length > 0;
  const convertendo = etapaPosProcessamentoImportacao === 'conversoes' || atividadesManuais.conversoes;
  const conciliando = etapaPosProcessamentoImportacao === 'conciliacao' || Boolean(conciliacaoAutomaticaRodando) || atividadesManuais.conciliacao;
  const consolidandoVoucher = Boolean(consolidacaoVoucherRodando);
  return {
    rodando: filaRodando,
    atividade_em_segundo_plano: importando || convertendo || conciliando || consolidandoVoucher,
    etapa: importando
      ? 'Importando arquivos'
      : convertendo
        ? 'Aplicando conversões'
        : conciliando
          ? 'Executando conciliação automática'
          : consolidandoVoucher
            ? 'Consolidando vendas voucher'
            : '',
    servicos: {
      importacao: importando,
      conversoes: convertendo,
      conciliacao: conciliando,
      consolidacao_voucher: consolidandoVoucher,
      fechamento_lote_agendado: Boolean(temporizadorPosProcessamentoImportacao),
    },
    modo: 'worker_unico_sequencial',
    atual: tarefaAtual
      ? {
          importacao_id: tarefaAtual.importacaoId,
          nome_arquivo_original: tarefaAtual.nomeOriginal,
          origem_fila: tarefaAtual.origemFila,
        }
      : null,
    pendentes: filaImportacao.length,
  };
}

function pastaFinalPorStatus(statusFinal: string): string {
  if (statusFinal === 'PROCESSADO' || statusFinal === 'CLASSIFICADO') return processadosDir;
  if (statusFinal === 'ARQUIVO_DUPLICADO') return erroDuplicidadesDir;
  if (statusFinal === 'LAYOUT_DESCONHECIDO') return erroLayoutDesconhecidoDir;
  return erroFalhaImportacaoDir;
}

async function moverParaProcessandoSeNecessario(caminhoAtual: string, nomeOriginal: string): Promise<string> {
  if (path.resolve(path.dirname(caminhoAtual)) === path.resolve(processandoDir)) return caminhoAtual;
  return moverPreservandoNome(caminhoAtual, processandoDir, nomeOriginal || path.basename(caminhoAtual));
}

function enfileirarImportacao(params: Omit<TarefaImportacao, 'resolve' | 'reject'>): Promise<string> {
  return new Promise((resolve, reject) => {
    // A chegada de um novo arquivo reabre o lote. Se a fila havia zerado e o
    // pós-processamento estava apenas AGENDADO, cancela o disparo para consumir
    // primeiro todos os arquivos do lote.
    if (temporizadorPosProcessamentoImportacao) {
      clearTimeout(temporizadorPosProcessamentoImportacao);
      temporizadorPosProcessamentoImportacao = null;
      console.log('[fila-importacao] novo arquivo recebido; pós-processamento agendado foi adiado para o fim do lote.');
    }

    const caminhoNormalizado = path.resolve(params.caminhoArquivo);
    if (caminhosEnfileiradosOuEmProcessamento.has(caminhoNormalizado)) {
      resolve('JA_ENFILEIRADO');
      return;
    }
    caminhosEnfileiradosOuEmProcessamento.add(caminhoNormalizado);
    filaImportacao.push({ ...params, caminhoArquivo: caminhoNormalizado, resolve, reject });
    // Persiste o estado "ENFILEIRADO" imediatamente. Assim o frontend deixa de
    // mostrar o arquivo como apenas "Recebido/entrada" quando ele já está na fila,
    // mesmo que existam outros arquivos sendo processados antes dele.
    void atualizarImportacao(params.importacaoId, {
      status_importacao: 'ENFILEIRADO',
      caminho_arquivo: caminhoNormalizado,
      nome_arquivo_salvo: path.basename(caminhoNormalizado),
      mensagem_erro: null,
    }).catch((error) => logErroImportacao(`enfileirar:${params.importacaoId}`, error));
    console.log(`[fila-importacao] enfileirado ${params.importacaoId} (${params.nomeOriginal}). Pendentes: ${filaImportacao.length}`);
    void processarFilaImportacao();
  });
}

function bloquearPosProcessamentoImportacoes(contexto: string): void {
  bloqueiosPosProcessamentoImportacao += 1;
  console.log(`[pos-importacao] pós-processamento bloqueado (${contexto}). Bloqueios ativos: ${bloqueiosPosProcessamentoImportacao}`);
}

async function liberarPosProcessamentoImportacoes(contexto: string): Promise<void> {
  bloqueiosPosProcessamentoImportacao = Math.max(0, bloqueiosPosProcessamentoImportacao - 1);
  console.log(`[pos-importacao] pós-processamento liberado (${contexto}). Bloqueios ativos: ${bloqueiosPosProcessamentoImportacao}`);
  if (bloqueiosPosProcessamentoImportacao === 0) {
    // SFTP possui fronteira explícita de lote: coletarRemoteEdi só retorna após todos
    // os arquivos baixados concluírem. Nesse caso não é necessária janela adicional.
    if (!filaRodando && !tarefaAtual && filaImportacao.length === 0) {
      await executarPosProcessamentoImportacoesSeNecessario();
    }
  }
}

function resultadoConversoesTemDeadlock(resultado: Awaited<ReturnType<typeof normalizarVendasAdquirentesExistentes>>): boolean {
  return resultado.relatorio_regras.some((regra) =>
    regra.status === 'ERRO' && /deadlock detected|40P01/i.test(String(regra.erro || '')),
  );
}

async function normalizarVendasComRetryDeadlock(importacaoIds: string[] = []) {
  const maxTentativas = Math.max(1, Number(process.env.CONVERSOES_DEADLOCK_MAX_TENTATIVAS || 3));
  let ultimoResultado: Awaited<ReturnType<typeof normalizarVendasAdquirentesExistentes>> | null = null;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    ultimoResultado = await normalizarVendasAdquirentesExistentes({ modo: 'LOTE', importacaoIds });
    if (!resultadoConversoesTemDeadlock(ultimoResultado)) return ultimoResultado;
    if (tentativa >= maxTentativas) return ultimoResultado;

    const esperaMs = 250 * tentativa;
    console.warn(`[conversoes-automaticas] deadlock detectado; nova tentativa ${tentativa + 1}/${maxTentativas} em ${esperaMs}ms.`);
    await sleep(esperaMs);
  }

  return ultimoResultado!;
}

function cancelarAgendamentoPosProcessamentoImportacoes(): void {
  if (!temporizadorPosProcessamentoImportacao) return;
  clearTimeout(temporizadorPosProcessamentoImportacao);
  temporizadorPosProcessamentoImportacao = null;
}

function agendarPosProcessamentoImportacoes(delayMs?: number): void {
  if (bloqueiosPosProcessamentoImportacao > 0) return;
  if (!lotePossuiNovaImportacaoConciliavel) return;
  if (filaRodando || tarefaAtual || filaImportacao.length > 0) return;
  if (posProcessamentoImportacaoRodando) return;

  cancelarAgendamentoPosProcessamentoImportacoes();
  const esperaMs = Math.max(
    0,
    Number(delayMs ?? process.env.IMPORTACOES_FECHAMENTO_LOTE_MS ?? 120000),
  );

  console.log(`[fila-importacao] fila vazia; pós-processamento do lote agendado em ${esperaMs}ms.`);
  temporizadorPosProcessamentoImportacao = setTimeout(() => {
    temporizadorPosProcessamentoImportacao = null;
    // Revalida o estado no momento do disparo. Qualquer arquivo recebido durante
    // a janela de fechamento pertence ao mesmo lote e precisa ser consumido antes.
    if (filaRodando || tarefaAtual || filaImportacao.length > 0 || bloqueiosPosProcessamentoImportacao > 0) {
      console.log('[fila-importacao] pós-processamento adiado: lote recebeu novos arquivos ou está bloqueado.');
      return;
    }
    void executarPosProcessamentoImportacoesSeNecessario();
  }, esperaMs);
}

async function executarPosProcessamentoImportacoesSeNecessario(): Promise<void> {
  cancelarAgendamentoPosProcessamentoImportacoes();
  if (bloqueiosPosProcessamentoImportacao > 0) return;
  if (filaRodando || tarefaAtual || filaImportacao.length > 0) return;
  if (!lotePossuiNovaImportacaoConciliavel) return;
  if (posProcessamentoImportacaoRodando) return posProcessamentoImportacaoRodando;

  let posProcessamentoConcluido = false;
  const inicio = Date.now();
  posProcessamentoImportacaoRodando = (async () => {
    lotePossuiNovaImportacaoConciliavel = false;
    const importacaoIds = [...importacoesPendentesPosProcessamento];
    importacaoIds.forEach((id) => importacoesPendentesPosProcessamento.delete(id));

    try {
      console.log('[fila-importacao] fila_vazia=true; iniciando_pos_processamento=true');
      console.log('[conversoes-automaticas] aplicando regras UMA vez após conclusão de TODOS os arquivos do lote.');
      etapaPosProcessamentoImportacao = 'conversoes';
      const resultadoConversoes = await normalizarVendasComRetryDeadlock(importacaoIds);
      const regrasComErro = resultadoConversoes.resumo_conversoes.regras_com_erro;
      if (regrasComErro > 0) {
        const detalhes = resultadoConversoes.relatorio_regras
          .filter((regra) => regra.status === 'ERRO')
          .map((regra) => `${regra.tabela}.${regra.coluna}: ${regra.erro || 'erro desconhecido'}`)
          .join('; ');
        throw new Error(`Aplicação automática de conversões terminou com ${regrasComErro} regra(s) em erro: ${detalhes}`);
      }

      console.log(`[conversoes-automaticas] concluída: regras=${resultadoConversoes.resumo_conversoes.regras_ativas}, encontradas=${resultadoConversoes.resumo_conversoes.registros_encontrados}, alteradas=${resultadoConversoes.resumo_conversoes.registros_alterados}.`);
      // Opt-in after reviewing the historical repair. One bounded batch per import lot.
      if (process.env.CORRECAO_VENDAS_AUTOMATICA === 'true') {
        const plano = await simularCorrecao('duplicidades', 200);
        const correcao = await aplicarCorrecao(resumoPlano(plano));
        console.log('[deduplicacao] lote concluído', correcao, 'bloqueados:', plano.bloqueados.length);
      }
      const dataInicial = resultadoConversoes.escopo_periodo.data_inicial;
      const dataFinal = resultadoConversoes.escopo_periodo.data_final;
      if (dataInicial && dataFinal) {
        console.log(`[pos-importacao] conversões concluídas; pipeline incremental no período ${dataInicial} a ${dataFinal}.`);
        etapaPosProcessamentoImportacao = 'conciliacao';
        await acionarConciliacaoAutomaticaAposImportacao({ dataInicial, dataFinal });
      } else {
        console.log('[pos-importacao] lote sem vendas conciliáveis; consolidação e conciliação dispensadas.');
      }
      posProcessamentoConcluido = true;
    } catch (error) {
      lotePossuiNovaImportacaoConciliavel = true;
      importacaoIds.forEach((id) => importacoesPendentesPosProcessamento.add(id));
      logErroImportacao('pos-processamento-importacoes', error);
      console.warn('[pos-importacao] falha isolada; backend e fila permanecerão ativos.');
    }
  })().finally(() => {
    etapaPosProcessamentoImportacao = '';
    posProcessamentoImportacaoRodando = null;
    console.log(`[fila-importacao] pos_processamento_finalizado=true tempo_ms=${Date.now() - inicio}`);

    // Se arquivos chegaram enquanto as conversões estavam em andamento, eles
    // ficaram apenas enfileirados. Retoma o worker automaticamente ao liberar o lock.
    if (filaImportacao.length > 0) {
      console.log(`[fila-importacao] retomando fila após pós-processamento. Pendentes: ${filaImportacao.length}`);
      void processarFilaImportacao();
    } else if (posProcessamentoConcluido && lotePossuiNovaImportacaoConciliavel) {
      // Um novo lote pode ter sido concluído enquanto a passagem anterior terminava.
      agendarPosProcessamentoImportacoes();
    }
  });

  await posProcessamentoImportacaoRodando;
}

async function processarFilaImportacao(): Promise<void> {
  if (filaRodando) return;

  // Se um arquivo chegar depois de o lote anterior já ter entrado nas conversões,
  // ele permanece enfileirado. O finally do pós-processamento retoma o worker.
  // Não aguardamos a Promise aqui, evitando chamadas de fila presas indefinidamente.
  if (posProcessamentoImportacaoRodando) {
    console.log(`[fila-importacao] pós-processamento em andamento; ${filaImportacao.length} arquivo(s) aguardam o próximo lote.`);
    return;
  }

  cancelarAgendamentoPosProcessamentoImportacoes();
  filaRodando = true;
  try {
    while (filaImportacao.length > 0) {
      const tarefa = filaImportacao.shift()!;
      tarefaAtual = tarefa;
      let caminhoAtual = tarefa.caminhoArquivo;
      try {
        caminhoAtual = await moverParaProcessandoSeNecessario(caminhoAtual, tarefa.nomeOriginal);
        await atualizarImportacao(tarefa.importacaoId, {
          caminho_arquivo: caminhoAtual,
          nome_arquivo_salvo: path.basename(caminhoAtual),
          status_importacao: 'PROCESSANDO_FILA',
        });

        console.log(`[fila-importacao] processando ${tarefa.importacaoId} (${tarefa.nomeOriginal})`);
        const statusFinal = await processarClassificacao(tarefa.importacaoId, caminhoAtual, tarefa.nomeOriginal);
        const destinoFinal = await moverPreservandoNome(caminhoAtual, pastaFinalPorStatus(statusFinal), tarefa.nomeOriginal).catch(() => undefined);
        if (destinoFinal) {
          await atualizarImportacao(tarefa.importacaoId, {
            caminho_arquivo: destinoFinal,
            nome_arquivo_salvo: path.basename(destinoFinal),
          });
        }
        console.log(`[fila-importacao] concluído ${tarefa.importacaoId} status=${statusFinal}`);
        if (statusFinal === 'PROCESSADO') {
          lotePossuiNovaImportacaoConciliavel = true;
          importacoesPendentesPosProcessamento.add(tarefa.importacaoId);
        }
        tarefa.resolve(statusFinal);
      } catch (error) {
        const codigo = typeof error === 'object' && error !== null && 'code' in error ? String((error as NodeJS.ErrnoException).code) : '';
        if (codigo === 'ENOENT') {
          console.warn(`[fila-importacao] arquivo já foi movido/removido antes da fila processar: ${caminhoAtual}`);
          tarefa.resolve('ARQUIVO_JA_MOVEDO');
        } else {
          logErroImportacao(`fila:${tarefa.importacaoId}`, error);
          await atualizarImportacao(tarefa.importacaoId, {
            status_importacao: 'ERRO',
            quantidade_erros: 1,
            mensagem_erro: error instanceof Error ? error.message : 'Erro desconhecido na fila de importação.',
          }).catch(() => undefined);
          await moverPreservandoNome(caminhoAtual, erroFalhaImportacaoDir, tarefa.nomeOriginal).catch(() => undefined);
          tarefa.reject(error);
        }
      } finally {
        caminhosEnfileiradosOuEmProcessamento.delete(path.resolve(tarefa.caminhoArquivo));
        caminhosEnfileiradosOuEmProcessamento.delete(path.resolve(caminhoAtual));
        tarefaAtual = null;
        // Cede o event loop entre arquivos para que polling do frontend, healthcheck e SFTP
        // continuem respondendo mesmo durante importações grandes em lote.
        await sleep(Number(process.env.IMPORTACOES_FILA_PAUSA_ENTRE_ARQUIVOS_MS || 25));
      }
    }
  } finally {
    filaRodando = false;
    // Um upload pode chegar enquanto o worker anterior está encerrando. Nesse
    // caso ele já está na fila, mas a chamada inicial viu filaRodando=true.
    if (filaImportacao.length > 0) {
      void processarFilaImportacao();
    } else {
      // A fila foi completamente drenada. Não executa conversões neste mesmo tick:
      // abre uma janela de fechamento para absorver arquivos que ainda pertencem ao
      // lote atual. Se outro arquivo chegar, enfileirarImportacao cancela este timer.
      agendarPosProcessamentoImportacoes();
    }
  }
}


async function recuperarArquivosProcessando(limite: number, contexto: 'boot' | 'manual') {
  await fs.mkdir(processandoDir, { recursive: true });
  await fs.mkdir(entradaDir, { recursive: true });

  const itens = await fs.readdir(processandoDir, { withFileTypes: true }).catch(() => []);
  const arquivos = itens.filter((item) => item.isFile() && !nomeArquivoTemporario(item.name));
  const maxRecuperar = Math.max(0, Number(limite || 0));
  const selecionados = maxRecuperar === 0 ? [] : arquivos.slice(0, maxRecuperar);
  const recuperadosDetalhes: { nome: string; destino: string }[] = [];
  const erros: { nome: string; mensagem: string }[] = [];
  let exibidos = 0;

  for (const item of selecionados) {
    const caminhoProcessando = path.join(processandoDir, item.name);
    try {
      const destinoEntrada = await moverPreservandoNome(caminhoProcessando, entradaDir, item.name);
      recuperadosDetalhes.push({ nome: item.name, destino: path.basename(destinoEntrada) });
      if (exibidos < 10) {
        console.log(`[fila-importacao] recuperação ${contexto}: ${item.name} voltou de processando/ para entrada/ como ${path.basename(destinoEntrada)}`);
        exibidos += 1;
      }
    } catch (error) {
      const codigo = typeof error === 'object' && error !== null && 'code' in error ? String((error as NodeJS.ErrnoException).code) : '';
      if (codigo !== 'ENOENT') logErroImportacao(`recuperacao-${contexto}:${item.name}`, error);
      erros.push({ nome: item.name, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao recuperar arquivo.' });
    }
  }

  const recuperados = recuperadosDetalhes.length;
  const restantes = Math.max(0, arquivos.length - recuperados);
  if (recuperados > 0 || arquivos.length > 0) {
    console.log(`[fila-importacao] recuperação ${contexto} concluída: ${recuperados}/${arquivos.length} arquivo(s) reenviado(s) para entrada/. Restantes em processando/: ${restantes}. Limite: ${maxRecuperar}.`);
  }

  return {
    sucesso: true,
    contexto,
    limite: maxRecuperar,
    encontrados_em_processando: arquivos.length,
    recuperados,
    restantes_em_processando: restantes,
    recuperados_detalhes: recuperadosDetalhes,
    erros,
    mensagem: recuperados > 0
      ? `${recuperados} arquivo(s) retornaram de processando/ para entrada/. O watcher irá enfileirar automaticamente.`
      : 'Nenhum arquivo foi recuperado de processando/.',
  };
}

async function recuperarImportacoesInterrompidasNoBoot() {
  await recuperarArquivosProcessando(Number(process.env.IMPORTACOES_RECUPERAR_MAX_BOOT || 50), 'boot');
}


function iniciarWatcherImportacoesEntrada() {
  const habilitado = !['0', 'false', 'no', 'nao', 'não', 'off'].includes(String(process.env.IMPORTACOES_WATCHER_ENABLED ?? 'true').toLowerCase());
  if (!habilitado) {
    console.log('Watcher de storage/importacoes/entrada desabilitado por IMPORTACOES_WATCHER_ENABLED=false.');
    return;
  }

  const observados = new Map<string, { size: number; mtimeMs: number; stableSince: number }>();
  const emProcessamento = new Set<string>();
  let rodando = false;

  async function varrerEntrada() {
    if (rodando) return;
    rodando = true;
    try {
      await fs.mkdir(entradaDir, { recursive: true });
      const itens = await fs.readdir(entradaDir, { withFileTypes: true });
      const agora = Date.now();

      const maxPorVarredura = Math.max(1, Number(process.env.IMPORTACOES_WATCHER_MAX_POR_VARREDURA || 10));
      let enfileiradosNestaVarredura = 0;

      for (const item of itens) {
        if (enfileiradosNestaVarredura >= maxPorVarredura) break;
        if (!item.isFile()) continue;
        if (nomeArquivoTemporario(item.name)) continue;

        const caminho = path.join(entradaDir, item.name);
        const caminhoNormalizado = path.resolve(caminho);
        // O watcher só enfileira arquivos manuais. Se o upload/SFTP já enfileirou o mesmo caminho,
        // não deve mover nem classificar novamente, evitando race condition e ENOENT.
        if (emProcessamento.has(caminho) || caminhosEnfileiradosOuEmProcessamento.has(caminhoNormalizado)) continue;

        const stat = await fs.stat(caminho).catch(() => null);
        if (!stat || !stat.isFile()) continue;

        const anterior = observados.get(caminho);
        if (!anterior || anterior.size !== stat.size || anterior.mtimeMs !== stat.mtimeMs) {
          observados.set(caminho, { size: stat.size, mtimeMs: stat.mtimeMs, stableSince: agora });
          continue;
        }

        if (agora - anterior.stableSince < 2500) continue;

        emProcessamento.add(caminho);
        observados.delete(caminho);
        try {
          console.log(`Watcher importações: enfileirando arquivo manual ${item.name}`);
          await processarArquivoManualDaEntrada(caminho, item.name);
          enfileiradosNestaVarredura += 1;
        } catch (error) {
          console.error(`Watcher importações: erro ao processar ${item.name}`, error);
          await moverPreservandoNome(caminho, erroFalhaImportacaoDir, item.name).catch(() => undefined);
        } finally {
          emProcessamento.delete(caminho);
        }
      }
    } catch (error) {
      console.error('Watcher importações: erro na varredura da pasta entrada.', error);
    } finally {
      rodando = false;
    }
  }

  setTimeout(varrerEntrada, 3000);
  setInterval(varrerEntrada, Number(process.env.IMPORTACOES_WATCHER_INTERVAL_MS || 5000));
  console.log(`Watcher ativo em ${entradaDir}. Arquivos colados manualmente serão importados automaticamente.`);
}



async function salvarBrutosCieloLayout1515(resultadoCielo: Awaited<ReturnType<typeof parseCieloLayout1515>>) {
  if (resultadoCielo.tipo_arquivo === '16') return salvarCieloLayout1515Cielo16(resultadoCielo.registros_brutos as any);
  if (resultadoCielo.tipo_arquivo === '04') return salvarCieloLayout1515Cielo04(resultadoCielo.registros_brutos as any);
  return salvarCieloLayout1515Cielo03(resultadoCielo.registros_brutos as any);
}

function layoutDetectadoCieloLayout1515(tipoArquivo: string) {
  if (tipoArquivo === '16') return 'CIELO_LAYOUT_15_15_CIELO16';
  if (tipoArquivo === '04') return 'CIELO_LAYOUT_15_15_CIELO04';
  return 'CIELO_LAYOUT_15_15_CIELO03';
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      // Cada upload fica em uma subpasta técnica para evitar colisão no filesystem.
      // O nome do arquivo em si permanece preservado.
      const destinoUpload = path.join(entradaDir, '_uploads', String(Date.now()), randomUUID());
      await fs.mkdir(destinoUpload, { recursive: true });
      cb(null, destinoUpload);
    },
    filename: (_req, file, cb) => {
      cb(null, nomeSeguroArquivo(file.originalname));
    },
  }),
  limits: { fileSize: Math.min(Math.max(Number(process.env.UPLOAD_MAX_MB || 50), 1), 50) * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    try {
      validarExtensao(file.originalname);
      cb(null, true);
    } catch (error) {
      cb(error as Error);
    }
  },
});

async function validarAssinaturaArquivoUpload(arquivo: Express.Multer.File) {
  const ext = path.extname(arquivo.originalname).toLowerCase();
  if (!['.xlsx', '.xls'].includes(ext)) return;
  const handle = await fs.open(arquivo.path, 'r');
  try {
    const inicio = Buffer.alloc(8);
    const { bytesRead } = await handle.read(inicio, 0, inicio.length, 0);
    const assinatura = inicio.subarray(0, bytesRead);
    const xlsxValido = ext === '.xlsx' && assinatura.length >= 4 && assinatura[0] === 0x50 && assinatura[1] === 0x4b && assinatura[2] === 0x03 && assinatura[3] === 0x04;
    const xlsValido = ext === '.xls' && assinatura.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    if (!xlsxValido && !xlsValido) throw new Error('O conteúdo do arquivo não corresponde à extensão informada.');
  } finally {
    await handle.close();
  }
}

app.post('/api/banco/jobs/consolidacao-voucher', async (_req, res) => {
  try {
    const resultado = await executarConsolidacaoVoucherComLock('manual');
    res.json({
      ...resultado,
      mensagem: `Consolidação VOUCHER concluída: ${resultado.vinculos_criados} vínculo(s) criado(s), ${resultado.ja_vinculados} já vinculado(s), ${resultado.duplicidades_internas_suprimidas} duplicidade(s) interna(s) suprimida(s), ${resultado.ambiguos} ambíguo(s) e ${resultado.sem_correspondencia} sem correspondência.`,
    });
  } catch (error) {
    logErroImportacao('voucher-consolidacao-manual', error);
    res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao executar a Consolidação VOUCHER.' });
  }
});

registerCoreRoutes(app, {
  versao,
  obterStatusPastasImportacao,
  obterStatusFilaImportacao,
  recuperarArquivosProcessando,
  filaImportacaoLivre: () => !filaRodando && !tarefaAtual && filaImportacao.length === 0,
  logErroImportacao,
});

async function contarLinhasNaoVaziasArquivo(caminhoArquivo: string): Promise<number> {
  if (['.xls', '.xlsx'].includes(path.extname(caminhoArquivo).toLowerCase())) return 0;
  const maxLinhas = Math.min(Math.max(Number(process.env.PARSER_MAX_ROWS || 200_000), 100), 1_000_000);
  const maxTamanhoLinha = Math.min(Math.max(Number(process.env.PARSER_MAX_LINE_LENGTH || 1_000_000), 1_000), 5_000_000);
  let quantidade = 0;
  const leitor = readline.createInterface({ input: fsSync.createReadStream(caminhoArquivo), crlfDelay: Infinity });
  for await (const linha of leitor) {
    if (linha.length > maxTamanhoLinha) { leitor.close(); throw new Error(`Arquivo contém linha acima do limite de ${maxTamanhoLinha} caracteres.`); }
    if (linha.trim()) quantidade += 1;
    if (quantidade > maxLinhas) { leitor.close(); throw new Error(`Arquivo excede o limite de ${maxLinhas} linhas.`); }
  }
  return quantidade;
}


async function processarClassificacao(importacaoId: string, caminhoArquivo: string, nomeOriginal: string): Promise<string> {
  try {
    await atualizarImportacao(importacaoId, { status_importacao: 'CLASSIFICANDO' });
    const resultado = await classificarArquivo(caminhoArquivo, nomeOriginal);
    // v0.1.185: persiste a classificação assim que ela é conhecida. Em arquivos grandes,
    // o frontend não deve continuar exibindo DESCONHECIDO/AGUARDANDO enquanto a
    // persistência dos registros ainda está em andamento.
    await atualizarImportacao(importacaoId, {
      origem_detectada: resultado.origem_detectada,
      layout_detectado: resultado.layout_detectado,
      status_importacao: resultado.origem_detectada === 'DESCONHECIDO' ? 'CLASSIFICANDO' : 'CLASSIFICADO',
    });
    validarLayoutExtratoSipagPermitido(resultado.layout_detectado);
    const quantidadeLinhas = await contarLinhasNaoVaziasArquivo(caminhoArquivo);

    let quantidadeProcessados = quantidadeLinhas;
    let statusFinal = resultado.origem_detectada === 'DESCONHECIDO' ? 'LAYOUT_DESCONHECIDO' : 'CLASSIFICADO';
    let avisoConflitos = '';

    if (resultado.layout_detectado === 'LAYOUT_INTERDATA') {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const vendasErp = await parseLayoutInterdata(importacaoId, caminhoArquivo);
      const gravacao = await salvarVendasErp(vendasErp);
      quantidadeProcessados = gravacao.inseridos;
      resultado.quantidade_registros = vendasErp.length;
      statusFinal = 'PROCESSADO';
    }



    if (resultado.origem_detectada === 'COOPCERTO' && resultado.layout_detectado === 'COOPCERTO_CABAL_VENDAS_CSV') {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoCabal = await parseCoopcertoCabalVendasCsv(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarCoopcertoCabalVendasCsv(resultadoCabal.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoCabal.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos;
      resultado.quantidade_registros = resultadoCabal.registros_brutos.length;
      resultado.layout_detectado = 'COOPCERTO_CABAL_VENDAS_CSV';
      const pendentes = resultadoCabal.vendas_adquirentes.filter((venda) => venda.status_transacao === 'PENDENTE_PROCESSAMENTO').length;
      console.log(`[coopcerto-cabal] CSV: vendas_raw=${gravacaoBruta.inseridos}, vendas_canonicas=${gravacaoCanonica.inseridos}, atualizadas=${gravacaoCanonica.atualizados || 0}, duplicadas=${gravacaoCanonica.duplicados}, conflitos=${gravacaoCanonica.conflitos || 0}, pendentes=${pendentes}, totalizador=${resultadoCabal.totalizador ? 'validado' : 'ausente'}`);
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'COOPCERTO' && resultado.layout_detectado.startsWith('COOPCERTO_EXTRATO_')) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const tipo = resultado.layout_detectado.replace('COOPCERTO_EXTRATO_', '') as TipoExtratoCoopcerto;
      const extrato = await parseCoopcertoExtratoCsv(importacaoId, caminhoArquivo, nomeOriginal, tipo);
      const gravacao = await salvarCoopcertoExtrato(extrato.tipo, extrato.registros_brutos);
      quantidadeProcessados = gravacao.inseridos;
      resultado.quantidade_registros = extrato.quantidade_registros;
      resultado.layout_detectado = `COOPCERTO_EXTRATO_${extrato.tipo}`;
      console.log(`[coopcerto-extrato] tipo=${extrato.tipo}, brutos=${gravacao.inseridos}, totalizador=${extrato.totalizador ? 'validado' : 'ausente'}, vendas_canonicas=0`);
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'SIPAG' && resultado.layout_detectado.startsWith('SIPAG_EXTRATO_')) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const extrato = await parseSipagExtratoCsv(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarSipagExtrato(extrato.tipo, extrato.registros_brutos);
      const gravacaoCanonica = extrato.vendas_adquirentes.length
        ? await salvarVendasAdquirentes(extrato.vendas_adquirentes)
        : { inseridos: 0, duplicados: 0, atualizados: 0 };
      const vendasAtualizadas = gravacaoCanonica.atualizados || 0;
      if (gravacaoCanonica.conflitos) avisoConflitos = `${gravacaoCanonica.conflitos} linha(s) SIPAG com conciliações distintas foram preservadas sem alteração; revisar as vendas correspondentes no log do backend.`;
      // PROCESSADOS representa trabalho efetivo do arquivo sem somar duas vezes
      // bruto + canônico. Assim um extrato totalmente repetido, mas que vinculou
      // milhares de vendas existentes, deixa de aparecer falsamente como "0".
      quantidadeProcessados = Math.max(gravacaoBruta.inseridos, gravacaoCanonica.inseridos + vendasAtualizadas);
      resultado.quantidade_registros = extrato.quantidade_registros;
      resultado.layout_detectado = `SIPAG_EXTRATO_${extrato.tipo}`;
      console.log(`[sipag-extrato] tipo=${extrato.tipo}, brutos_inseridos=${gravacaoBruta.inseridos}, vendas_inseridas=${gravacaoCanonica.inseridos}, vendas_vinculadas_atualizadas=${vendasAtualizadas}, correspondencias_reutilizadas=${gravacaoCanonica.duplicados}`);
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'SIPAG' && resultado.layout_detectado === 'SIPAG_VENDAS_PIX_CSV') {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoPix = await parseSipagVendasPixCsv(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarSipagVendasPixCsv(resultadoPix.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoPix.vendas_adquirentes);
      // A linha Total é apenas validada. O histórico contabiliza somente as vendas persistidas.
      quantidadeProcessados = gravacaoBruta.inseridos;
      resultado.quantidade_registros = resultadoPix.registros_brutos.length;
      resultado.layout_detectado = 'SIPAG_VENDAS_PIX_CSV';
      console.log(`[sipag-pix] CSV: vendas_raw=${gravacaoBruta.inseridos}, vendas_canonicas=${gravacaoCanonica.inseridos}, totalizador=${resultadoPix.totalizador ? 'validado' : 'ausente'}`);
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'SIPAG' && resultado.layout_detectado.startsWith('SIPAG_LAYOUT_2_0')) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoSipag = await parseSipagLayout20(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarSipagLayout20(resultadoSipag.tipo_arquivo, resultadoSipag.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoSipag.vendas_adquirentes);
      quantidadeProcessados = Math.max(gravacaoBruta.inseridos, gravacaoCanonica.inseridos + (gravacaoCanonica.atualizados || 0));
      console.log(`[sipag-edi-2.0] tipo=${resultadoSipag.tipo_arquivo}, brutos_inseridos=${gravacaoBruta.inseridos}, vendas_inseridas=${gravacaoCanonica.inseridos}, vendas_vinculadas_atualizadas=${gravacaoCanonica.atualizados || 0}, correspondencias_reutilizadas=${gravacaoCanonica.duplicados}`);
      resultado.quantidade_registros = resultadoSipag.registros_brutos.length;
      resultado.layout_detectado = `SIPAG_LAYOUT_2_0_${resultadoSipag.tipo_arquivo}`;
      statusFinal = 'PROCESSADO';
    }



    if (resultado.origem_detectada === 'CIELO' && (resultado.layout_detectado === 'CIELO_LAYOUT_15_15_CIELO03' || resultado.layout_detectado === 'CIELO_LAYOUT_15_15_CIELO04' || resultado.layout_detectado === 'CIELO_LAYOUT_15_15_CIELO16')) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoCielo = await parseCieloLayout1515(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarBrutosCieloLayout1515(resultadoCielo);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoCielo.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos + gravacaoCanonica.inseridos;
      resultado.quantidade_registros = resultadoCielo.registros_brutos.length;
      resultado.layout_detectado = layoutDetectadoCieloLayout1515(resultadoCielo.tipo_arquivo);
      statusFinal = 'PROCESSADO';
    }



    if (resultado.origem_detectada === 'SICREDI' && resultado.layout_detectado.startsWith('SICREDI_FISERV_LAYOUT_7_4')) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoSicredi = await parseSicrediFiserv74(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarSicrediFiserv74(resultadoSicredi.tipo_arquivo, resultadoSicredi.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoSicredi.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos + gravacaoCanonica.inseridos;
      resultado.quantidade_registros = resultadoSicredi.registros_brutos.length;
      resultado.layout_detectado = `SICREDI_FISERV_LAYOUT_7_4_${resultadoSicredi.tipo_arquivo}`;
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'SIPAG' && resultado.layout_detectado.startsWith('SIPAG_FISERV_LAYOUT_7_6')) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoFiserv = await parseSipagFiserv76(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarSipagFiserv76(resultadoFiserv.tipo_arquivo, resultadoFiserv.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoFiserv.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos + gravacaoCanonica.inseridos;
      resultado.quantidade_registros = resultadoFiserv.registros_brutos.length;
      resultado.layout_detectado = `SIPAG_FISERV_LAYOUT_7_6_${resultadoFiserv.tipo_arquivo}`;
      statusFinal = 'PROCESSADO';
    }


    if (resultado.origem_detectada === 'CONVCARD' && resultado.layout_detectado.startsWith('CONVCARD_LAYOUT_2_0_3')) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoConvcard = await parseConvcard203(importacaoId, caminhoArquivo);
      const gravacaoBruta = await salvarConvcard203(resultadoConvcard.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoConvcard.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos + gravacaoCanonica.inseridos;
      resultado.quantidade_registros = resultadoConvcard.registros_brutos.length;
      resultado.layout_detectado = 'CONVCARD_LAYOUT_2_0_3';
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'SICOOB' && resultado.layout_detectado === 'SICOOB_LAYOUT_PSP_PIX_JSON') {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoSicoob = await parseSicoobPspPixJson(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarSicoobLayoutPspPix(resultadoSicoob.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoSicoob.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos + gravacaoCanonica.inseridos;
      resultado.quantidade_registros = resultadoSicoob.registros_brutos.length;
      resultado.layout_detectado = 'SICOOB_LAYOUT_PSP_PIX_JSON';
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'VR' && resultado.layout_detectado === 'VR_LAYOUT_16AP') {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoVr = await parseVrLayout16ap(importacaoId, caminhoArquivo);
      const gravacaoBruta = await salvarVrLayout16ap(resultadoVr.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoVr.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos + gravacaoCanonica.inseridos;
      resultado.quantidade_registros = resultadoVr.registros_brutos.length;
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'ALELO' && resultado.layout_detectado.startsWith('ALELO_EDI_500_')) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoAlelo = await parseAleloLayout(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarAleloLayout(resultadoAlelo.registros_brutos);
      const gravacaoPagamentos = await salvarAleloPagamentos(resultadoAlelo.pagamentos_alelo);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoAlelo.vendas_adquirentes);
      // O contador da tela representa linhas EDI efetivamente tratadas, sem somar
      // novamente as projeções em vendas_adquirentes/alelo_pagamentos.
      quantidadeProcessados = gravacaoBruta.inseridos;
      resultado.quantidade_registros = resultadoAlelo.registros_brutos.length;
      console.log(`[alelo] ${resultadoAlelo.tipo_arquivo}: raw=${gravacaoBruta.inseridos}, vendas=${gravacaoCanonica.inseridos}, pagamentos=${gravacaoPagamentos.inseridos}, pagamentos_atualizados=${gravacaoPagamentos.atualizados || 0}`);
      resultado.layout_detectado = `ALELO_EDI_500_${resultadoAlelo.tipo_arquivo}`;
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'TICKET' && resultado.layout_detectado === 'TICKET_CEADM40') {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoTicket = await parseTicketCeAdm40(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarTicketCeAdm40(resultadoTicket.registros_vendas, resultadoTicket.registros_pagamentos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoTicket.vendas_adquirentes);
      // Contabiliza apenas registros de negócio persistidos no layout TICKET (2 e 4).
      // Header 0, agrupamentos/subtotalizadores 1 e trailer 9 são validados, mas não armazenados.
      quantidadeProcessados = gravacaoBruta.inseridos;
      resultado.quantidade_registros = resultadoTicket.registros_vendas.length + resultadoTicket.registros_pagamentos.length;
      resultado.layout_detectado = 'TICKET_CEADM40';
      console.log(`[ticket] CEADM40: vendas_raw=${gravacaoBruta.vendas_inseridas}, pagamentos_raw=${gravacaoBruta.pagamentos_inseridos}, vendas_canonicas=${gravacaoCanonica.inseridos}`);
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'PLUXEE' && ['PLUXEE_CEADM10', 'PLUXEE_CONPGT01'].includes(resultado.layout_detectado)) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoPluxee = await parsePluxeeLayout(importacaoId, caminhoArquivo);
      const gravacaoBruta = await salvarPluxeeLayout(resultadoPluxee.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoPluxee.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos + gravacaoCanonica.inseridos;
      resultado.quantidade_registros = resultadoPluxee.registros_brutos.length;
      resultado.layout_detectado = resultadoPluxee.tipo_arquivo === 'CEADM10' ? 'PLUXEE_CEADM10' : 'PLUXEE_CONPGT01';
      statusFinal = 'PROCESSADO';
    }

    await atualizarImportacao(importacaoId, {
      origem_detectada: resultado.origem_detectada,
      layout_detectado: resultado.layout_detectado,
      quantidade_registros: resultado.quantidade_registros || quantidadeLinhas,
      quantidade_processados: quantidadeProcessados,
      quantidade_erros: statusFinal === 'LAYOUT_DESCONHECIDO' ? 1 : 0,
      mensagem_erro: statusFinal === 'LAYOUT_DESCONHECIDO'
        ? 'Layout não reconhecido pelos importadores configurados. Arquivo arquivado em erro/layout_desconhecido sem alteração do nome.'
        : avisoConflitos || null,
      status_importacao: statusFinal,
    });
    return statusFinal;
  } catch (error) {
    logErroImportacao(`classificacao:${importacaoId}`, error);
    await atualizarImportacao(importacaoId, {
      status_importacao: 'ERRO',
      quantidade_erros: 1,
      mensagem_erro: error instanceof Error ? error.message : 'Erro desconhecido na classificação.',
    });
    return 'ERRO';
  }
}

async function receberUpload(req: Request, res: Response) {
  if (!req.file) {
    return res.status(400).json({ sucesso: false, mensagem: 'Nenhum arquivo foi enviado.' });
  }

  try {
    await validarAssinaturaArquivoUpload(req.file);
    const hash_arquivo = await calcularHashArquivo(req.file.path);
    const duplicada = await buscarImportacaoPorHash(hash_arquivo);

    if (duplicada) {
      const registroDuplicado = await registrarArquivoDuplicado({
        caminhoArquivo: req.file.path,
        nomeArquivo: req.file.filename,
        nomeOriginal: req.file.originalname,
        tipoMime: req.file.mimetype,
        hashArquivo: hash_arquivo,
        tamanhoBytes: req.file.size,
        importacaoExistente: duplicada,
        contexto: 'upload',
      });
      return res.status(202).json({
        sucesso: true,
        importacao_id: registroDuplicado.importacao.id,
        status_importacao: 'ARQUIVO_DUPLICADO',
        mensagem: 'Arquivo duplicado detectado por hash. Arquivado em erro/duplicidades sem alterar o nome do arquivo.',
        importacao_existente_id: duplicada.id,
      });
    }

    const importacao = await criarImportacao({
      nome_arquivo_original: req.file.originalname,
      nome_arquivo_salvo: req.file.filename,
      caminho_arquivo: req.file.path,
      tamanho_bytes: req.file.size,
      tipo_mime: req.file.mimetype,
      hash_arquivo,
      origem_detectada: 'DESCONHECIDO',
      layout_detectado: 'AGUARDANDO_CLASSIFICACAO',
      status_importacao: 'ENFILEIRADO',
      quantidade_registros: 0,
      quantidade_processados: 0,
      quantidade_erros: 0,
      mensagem_erro: null,
    });

    res.json({
      sucesso: true,
      importacao_id: importacao.id,
      status_importacao: 'ENFILEIRADO',
      mensagem: 'Arquivo recebido com sucesso e enviado para classificação automática.',
    });

    enfileirarImportacao({
      importacaoId: importacao.id,
      caminhoArquivo: req.file.path,
      nomeOriginal: req.file.originalname,
      origemFila: 'upload',
    }).catch((error) => logErroImportacao(`upload-fila:${importacao.id}`, error));
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => undefined);
    return res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido no upload.' });
  }
}


async function receberUploadLayoutDireto(
  req: Request,
  res: Response,
  metadados: { origem: string; layout: string; mensagem: string; origemFila: 'upload' | 'endpoint' }
) {
  if (!req.file) return res.status(400).json({ sucesso: false, mensagem: 'Nenhum arquivo foi enviado.' });

  try {
    await validarAssinaturaArquivoUpload(req.file);
    const hash_arquivo = await calcularHashArquivo(req.file.path);
    const duplicada = await buscarImportacaoPorHash(hash_arquivo);
    if (duplicada) {
      const registroDuplicado = await registrarArquivoDuplicado({
        caminhoArquivo: req.file.path,
        nomeArquivo: req.file.filename,
        nomeOriginal: req.file.originalname,
        tipoMime: req.file.mimetype,
        hashArquivo: hash_arquivo,
        tamanhoBytes: req.file.size,
        importacaoExistente: duplicada,
        contexto: 'upload',
      });
      return res.status(202).json({
        sucesso: true,
        importacao_id: registroDuplicado.importacao.id,
        status_importacao: 'ARQUIVO_DUPLICADO',
        mensagem: 'Arquivo duplicado detectado por hash. Arquivado em erro/duplicidades sem alterar o nome do arquivo.',
        importacao_existente_id: duplicada.id,
      });
    }

    const importacao = await criarImportacao({
      nome_arquivo_original: req.file.originalname,
      nome_arquivo_salvo: req.file.filename,
      caminho_arquivo: req.file.path,
      tamanho_bytes: req.file.size,
      tipo_mime: req.file.mimetype,
      hash_arquivo,
      origem_detectada: metadados.origem,
      layout_detectado: metadados.layout,
      status_importacao: 'ENFILEIRADO',
      quantidade_registros: 0,
      quantidade_processados: 0,
      quantidade_erros: 0,
      mensagem_erro: null,
    });

    res.json({
      sucesso: true,
      importacao_id: importacao.id,
      status_importacao: 'ENFILEIRADO',
      mensagem: metadados.mensagem,
    });

    enfileirarImportacao({
      importacaoId: importacao.id,
      caminhoArquivo: req.file.path,
      nomeOriginal: req.file.originalname,
      origemFila: metadados.origemFila,
    }).catch((error) => logErroImportacao(`upload-direto-fila:${importacao.id}`, error));
  } catch (error) {
    await fs.unlink(req.file.path).catch(() => undefined);
    return res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido no upload direto.' });
  }
}


async function receberUploadSipagLayout20(req: Request, res: Response) {
  return receberUploadLayoutDireto(req, res, {
    origem: 'SIPAG',
    layout: 'SIPAG_LAYOUT_2_0',
    origemFila: 'endpoint',
    mensagem: 'Arquivo recebido e enfileirado para processamento sipag_layout_2_0.',
  });
}




async function receberUploadSipagFiserv76(req: Request, res: Response) {
  return receberUploadLayoutDireto(req, res, {
    origem: 'SIPAG',
    layout: 'SIPAG_FISERV_LAYOUT_7_6',
    origemFila: 'endpoint',
    mensagem: 'Arquivo recebido e enfileirado para processamento sipag_fiserv_layout_7_6.',
  });
}




async function receberUploadConvcard203(req: Request, res: Response) {
  return receberUploadLayoutDireto(req, res, {
    origem: 'CONVCARD',
    layout: 'CONVCARD_LAYOUT_2_0_3',
    origemFila: 'endpoint',
    mensagem: 'Arquivo recebido e enfileirado para processamento convcard_layout_2_0_3.',
  });
}



async function receberUploadCieloLayout1515(req: Request, res: Response) {
  const nome = req.file?.originalname.toUpperCase() || '';
  const layout = nome.includes('CIELO16')
    ? 'CIELO_LAYOUT_15_15_CIELO16'
    : nome.includes('CIELO04')
      ? 'CIELO_LAYOUT_15_15_CIELO04'
      : 'CIELO_LAYOUT_15_15_CIELO03';
  return receberUploadLayoutDireto(req, res, {
    origem: 'CIELO',
    layout,
    origemFila: 'endpoint',
    mensagem: 'Arquivo recebido e enfileirado para processamento cielo_layout_15_15.',
  });
}



registerSftpBrowserRoutes(app);

app.get('/api/importacoes/sftp/ping', async (_req, res) => {
  try {
    res.json(await pingRemoteEdi());
  } catch (error) {
    logErroImportacao('sftp-ping', error);
    res.status(500).json({ sucesso: false, codigo: 'FALHA_CONEXAO_SFTP', mensagem: 'Não foi possível testar a conexão SFTP. Verifique a configuração e a fingerprint do servidor.' });
  }
});

const uploadCredencialSftp = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024, files: 1 } });
app.get('/api/importacoes/sftp/credencial', async (_req, res) => res.json(await obterStatusCredencialSftp()));
app.post('/api/importacoes/sftp/credencial', exigirAdmin, uploadCredencialSftp.single('chave'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ sucesso: false, mensagem: 'Selecione o arquivo da chave privada.' });
    const status = await salvarCredencialSftp(req.file.buffer.toString('utf8'), req.usuario?.id);
    res.json({ sucesso: true, ...status, mensagem: 'Credencial SFTP protegida e armazenada no PostgreSQL.' });
  } catch (error) { res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Falha ao armazenar credencial.' }); }
});
app.delete('/api/importacoes/sftp/credencial', exigirAdmin, async (_req, res) => { await removerCredencialSftp(); res.json({ sucesso: true, mensagem: 'Credencial SFTP removida.' }); });

app.post('/api/importacoes/sftp/coletar', async (req, res) => {
  const contextoLote = `sftp-${Date.now()}`;
  bloquearPosProcessamentoImportacoes(contextoLote);
  try {
    const body = req.body || {};
    const resultado: any = await coletarRemoteEdi(body, async (importacaoId, caminhoArquivo, nomeOriginal) => {
      return enfileirarImportacao({ importacaoId, caminhoArquivo, nomeOriginal, origemFila: 'sftp' });
    });

    // coletarRemoteEdi só retorna depois que cada arquivo baixado terminou sua
    // importação local. Agora liberamos o lote: conversões rodam UMA vez e,
    // somente após concluírem, a conciliação automática roda UMA vez.
    await liberarPosProcessamentoImportacoes(contextoLote);
    res.json(resultado);
  } catch (error) {
    logErroImportacao('sftp-coleta', error);
    res.status(400).json({ sucesso: false, codigo: 'FALHA_COLETA_SFTP', mensagem: 'Não foi possível concluir a coleta SFTP. Consulte o log do servidor.' });
  } finally {
    // Se a coleta falhar antes da liberação normal, evita deixar o bloqueio preso.
    if (bloqueiosPosProcessamentoImportacao > 0) {
      await liberarPosProcessamentoImportacoes(`${contextoLote}-finally`).catch((error) =>
        logErroImportacao('sftp-pos-processamento-finally', error),
      );
    }
  }
});

app.post('/api/importacoes/upload', upload.single('file'), receberUpload);
app.post('/api/imports/upload', upload.single('file'), receberUpload);
app.post('/api/importacoes/sipag_layout_2_0', upload.single('file'), receberUploadSipagLayout20);
app.post('/api/importacoes/sipag_fiserv_layout_7_6', upload.single('file'), receberUploadSipagFiserv76);
app.post('/api/importacoes/cielo_layout_15_15', upload.single('file'), receberUploadCieloLayout1515);
app.post('/api/importacoes/convcard_layout_2_0_3', upload.single('file'), receberUploadConvcard203);

await recuperarImportacoesInterrompidasNoBoot();
iniciarWatcherImportacoesEntrada();
agendarRetencaoArquivos();

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  logErroImportacao('middleware', error);
  const uploadGrande = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
  const bancoTemporariamenteIndisponivel = erroBancoTemporariamenteIndisponivel(error);
  res.status(uploadGrande ? 413 : bancoTemporariamenteIndisponivel ? 503 : 400).json({
    sucesso: false,
    status_importacao: 'ERRO',
    codigo: uploadGrande ? 'ARQUIVO_MUITO_GRANDE' : bancoTemporariamenteIndisponivel ? 'BANCO_TEMPORARIAMENTE_OCUPADO' : 'REQUISICAO_INVALIDA',
    mensagem: uploadGrande
      ? 'O arquivo excede o limite máximo permitido de 50 MB.'
      : bancoTemporariamenteIndisponivel
        ? 'O banco está concluindo outras consultas. Tente novamente em alguns segundos.'
        : 'Não foi possível processar a solicitação enviada.',
  });
});

const servidor = app.listen(port, '0.0.0.0', () => {
  console.log(`ERPxADQUIRENTE backend v${versao} online em http://localhost:${port}`);
});

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    servidor.close(() => void closePool().finally(() => process.exit(0)));
  });
}
