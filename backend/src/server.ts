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
import { entradaDir, processandoDir, processadosDir, erroDir, desconhecidosDir } from './paths.js';
import { calcularHashArquivo, garantirPastas, validarExtensao } from './utils.js';
import { coletarRemoteEdi, pingRemoteEdi, obterStatusRemoteEdi } from './remote-edi.js';
import { parseLayoutInterdata } from './parsers/interdata.js';
import { parseSipagLayout20 } from './parsers/sipag-layout-2-0.js';
import { parseSipagFiserv76 } from './parsers/sipag-fiserv-layout-7-6.js';
import { parseCieloLayout1515 } from './parsers/cielo-layout-15-15.js';
import { parseSicrediFiserv74 } from './parsers/sicredi-fiserv-layout-7-4.js';
import { parseConvcard203 } from './parsers/convcard-layout-2-0-3.js';
import { parseSicoobPspPixJson } from './parsers/sicoob-psp-pix-json.js';
import {
  atualizarImportacao,
  buscarImportacaoPorHash,
  buscarImportacaoPendentePorHash,
  criarImportacao,
  listarImportacoes,
  listarTabelasBanco,
  obterDadosTabela,
  resumoImportacoes,
  removerLinhasImportadasLegadas,
  salvarVendasErp,
  listarVendasErpComExibicao,
  listarConversoes,
  limparTabelaBanco,
  criarConversaoManual,
  atualizarConversaoManual,
  excluirConversaoManual,
  salvarSipagLayout20,
  salvarSipagFiserv76,
  salvarCieloLayout1515Cielo03,
  salvarCieloLayout1515Cielo04,
  salvarCieloLayout1515Cielo16,
  salvarSicrediFiserv74,
  salvarConvcard203,
  salvarVendasAdquirentes,
  salvarSicoobLayoutPspPix,
  listarVendasAdquirentesComExibicao,
  obterOpcoesVendasAdquirentes,
  obterOpcoesVendasErp,
  gerarRelatorioAdquirentes,
  normalizarVendasAdquirentesExistentes,
  recalcularPercentualTaxaVendasAdquirentes,
  obterTipoPersistenciaAtual,
} from './repositorio.js';
import { bootstrapDatabase } from './database/bootstrap.js';
import { consultarPixRecebidos, mapPixParaTabelaSicoob, periodoD1Sicoob } from './services/sicoob/pix.js';
import { sicoobConfigDiagnostics } from './services/sicoob/config.js';


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
const port = Number(process.env.PORT || 3333);
const versao = '0.1.68';

app.use(cors({ origin: true }));
app.use(express.json());

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
await bootstrapDatabase();
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

function caminhoComNomeUnicoSync(destinoDir: string, nomeArquivo: string): string {
  const nomeSeguro = nomeSeguroArquivo(nomeArquivo);
  const ext = path.extname(nomeSeguro);
  const base = path.basename(nomeSeguro, ext);
  let destino = path.join(destinoDir, nomeSeguro);
  let contador = 1;
  while (fsSync.existsSync(destino)) {
    destino = path.join(destinoDir, `${base}-${contador}${ext}`);
    contador += 1;
  }
  return destino;
}

async function moverComNomeUnico(origem: string, destinoDir: string, nomeArquivo: string): Promise<string> {
  await fs.mkdir(destinoDir, { recursive: true });
  const origemExiste = await existeArquivo(origem);
  if (!origemExiste) {
    const erro = new Error(`Arquivo de origem não existe mais para mover: ${origem}`) as NodeJS.ErrnoException;
    erro.code = 'ENOENT';
    throw erro;
  }

  const nomeSeguro = nomeSeguroArquivo(nomeArquivo);
  const ext = path.extname(nomeSeguro);
  const base = path.basename(nomeSeguro, ext);
  let destino = path.join(destinoDir, nomeSeguro);
  let contador = 1;
  while (await existeArquivo(destino)) {
    destino = path.join(destinoDir, `${base}-${contador}${ext}`);
    contador += 1;
  }
  await fs.rename(origem, destino);
  return destino;
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
const caminhosEnfileiradosOuEmProcessamento = new Set<string>();

function obterStatusFilaImportacao() {
  return {
    rodando: filaRodando,
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

async function processarFilaImportacao(): Promise<void> {
  if (filaRodando) return;
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
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    try {
      validarExtensao(file.originalname);
      cb(null, true);
    } catch (error) {
      cb(error as Error);
    }
  },
});

app.get('/api/health', async (_req, res) => {
  res.json({
    app: 'ERPxADQUIRENTE',
    versao,
    status: 'online',
    armazenamento: obterTipoPersistenciaAtual(),
    mensagem: 'Backend online. Explorador de tabelas disponível em /api/banco/tabelas.',
  });
});

app.get('/api/poll/status', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const [pastas, resumo] = await Promise.all([
    obterStatusPastasImportacao(),
    resumoImportacoes().catch(() => null),
  ]);
  res.json({
    app: 'ERPxADQUIRENTE',
    versao,
    status: 'online',
    armazenamento: obterTipoPersistenciaAtual(),
    timestamp: new Date().toISOString(),
    fila_importacao: obterStatusFilaImportacao(),
    sftp: obterStatusRemoteEdi(),
    pastas_importacao: pastas,
    resumo_importacoes: resumo,
  });
});

app.get('/api/importacoes/poll', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const [pastas, resumo, importacoes] = await Promise.all([
    obterStatusPastasImportacao(),
    resumoImportacoes().catch(() => null),
    listarImportacoes().catch(() => []),
  ]);
  res.json({
    timestamp: new Date().toISOString(),
    fila_importacao: obterStatusFilaImportacao(),
    sftp: obterStatusRemoteEdi(),
    pastas_importacao: pastas,
    resumo_importacoes: resumo,
    importacoes,
  });
});


app.get('/api/importacoes', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await listarImportacoes());
});

app.get('/api/imports', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await listarImportacoes());
});

app.get('/api/importacoes/resumo', async (_req, res) => {
  res.json(await resumoImportacoes());
});

app.get('/api/importacoes/fila/status', async (_req, res) => {
  res.json(obterStatusFilaImportacao());
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
    const resultado = await recuperarArquivosProcessando(limite, 'manual');
    res.json({ ...resultado, fila_importacao: obterStatusFilaImportacao(), pastas_importacao: await obterStatusPastasImportacao() });
  } catch (error) {
    logErroImportacao('recovery-processando', error);
    res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao recuperar arquivos em processando/.' });
  }
});

app.get('/api/banco/tabelas', async (_req, res) => {
  res.json(await listarTabelasBanco());
});

app.get('/api/banco/tabelas/:nome', async (req, res) => {
  const limite = Math.min(Number(req.query.limite || 500), 2000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const tabela = await obterDadosTabela(req.params.nome, limite, offset);
  if (!tabela) return res.status(404).json({ sucesso: false, mensagem: 'Tabela não encontrada.' });
  res.json(tabela);
});

app.delete('/api/banco/tabelas/:nome/limpar', async (req, res) => {
  const resultado = await limparTabelaBanco(req.params.nome);
  if (!resultado) return res.status(404).json({ sucesso: false, mensagem: 'Tabela não encontrada.' });
  res.json(resultado);
});

app.get('/api/vendas-erp/opcoes', async (_req, res) => {
  res.json(await obterOpcoesVendasErp());
});

app.get('/api/vendas-erp', async (req, res) => {
  const limite = Math.min(Number(req.query.limite || 500), 2000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const filtros = {
    data_inicio: req.query.data_inicio,
    data_fim: req.query.data_fim,
    forma_pagamento: req.query.forma_pagamento,
    modalidade: req.query.modalidade,
    bandeira: req.query.bandeira,
    terminal: req.query.terminal,
    status: req.query.status,
  };
  res.json(await listarVendasErpComExibicao(limite, offset, filtros));
});

app.get('/api/vendas-adquirentes/opcoes', async (_req, res) => {
  res.json(await obterOpcoesVendasAdquirentes());
});

app.get('/api/vendas-adquirentes', async (req, res) => {
  const limite = Math.min(Number(req.query.limite || 500), 2000);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const filtros = {
    data_inicio: req.query.data_inicio,
    data_fim: req.query.data_fim,
    adquirente: req.query.adquirente,
    forma_pagamento: req.query.forma_pagamento,
    modalidade: req.query.modalidade,
    bandeira: req.query.bandeira,
    terminal: req.query.terminal,
    status: req.query.status,
  };
  res.json(await listarVendasAdquirentesComExibicao(limite, offset, filtros));
});

app.post('/api/vendas-adquirentes/normalizar', async (_req, res) => {
  try {
    res.json(await normalizarVendasAdquirentesExistentes());
  } catch (error) {
    res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao normalizar vendas_adquirentes.' });
  }
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
    data_inicio: req.query.data_inicio,
    data_fim: req.query.data_fim,
    adquirente: req.query.adquirente,
    forma_pagamento: req.query.forma_pagamento,
    modalidade: req.query.modalidade,
    bandeira: req.query.bandeira,
    terminal: req.query.terminal,
    status: req.query.status,
  });
  res.json(relatorio);
});



function nomeArquivoSicoobPspPix(dataReferencia?: string) {
  const data = dataReferencia || new Date().toISOString().slice(0, 10);
  return `sicoob-psp-pix-${data}.json`;
}

async function salvarResultadoSicoobPixNaEntrada(resultado: Awaited<ReturnType<typeof consultarPixRecebidos>>, dataReferencia?: string) {
  await fs.mkdir(entradaDir, { recursive: true });
  const nomeArquivo = nomeArquivoSicoobPspPix(dataReferencia);
  const caminhoFinal = caminhoComNomeUnicoSync(entradaDir, nomeArquivo);
  const payload = {
    geradoEm: new Date().toISOString(),
    origem: 'SICOOB',
    layout: 'sicoob_layout_psp_pix',
    ambiente: sicoobConfigDiagnostics().env,
    consulta: resultado.parametros,
    resumo: {
      totalPix: resultado.pix.length,
      quantidadeDePaginas: resultado.parametros?.paginacao?.quantidadeDePaginas ?? null,
      quantidadeTotalDeItensApi: resultado.parametros?.paginacao?.quantidadeTotalDeItens ?? null,
    },
    pix: resultado.pix,
  };
  await fs.writeFile(caminhoFinal, JSON.stringify(payload, null, 2), 'utf8');
  return { nomeArquivo: path.basename(caminhoFinal), caminho: caminhoFinal, quantidadePix: resultado.pix.length };
}

app.get('/api/sicoob/psp-pix/debug/config', async (_req, res) => {
  res.json({ sucesso: true, ...sicoobConfigDiagnostics() });
});

app.post('/api/sicoob/psp-pix/consultar', async (req, res) => {
  try {
    const params = req.body || {};
    const resultado = await consultarPixRecebidos(params);
    res.json({
      sucesso: true,
      consulta: resultado.parametros,
      resumo: { totalPix: resultado.pix.length },
      pix: resultado.pix,
    });
  } catch (error) {
    res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao consultar PIX Sicoob.' });
  }
});

app.post('/api/sicoob/psp-pix/importar', async (req, res) => {
  try {
    const params = req.body || {};
    const resultado = await consultarPixRecebidos(params);
    const arquivo = await salvarResultadoSicoobPixNaEntrada(resultado, params.dataReferencia);
    res.json({
      sucesso: true,
      consulta: resultado.parametros,
      arquivo: {
        nome: arquivo.nomeArquivo,
        pasta: entradaDir,
        quantidadePix: arquivo.quantidadePix,
        status: 'SALVO_EM_ENTRADA_AGUARDANDO_IMPORTADOR',
      },
      resumo: {
        recebidosApi: resultado.pix.length,
        mensagem: 'JSON salvo em storage/importacoes/entrada. A gravação no banco será feita somente pelo importador de layouts da pasta entrada.',
      },
    });
  } catch (error) {
    res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao importar PIX Sicoob.' });
  }
});

async function importarSicoobPixD1ParaFila(options: { dataReferencia?: string; itensPorPagina?: number | string } = {}) {
  const periodo = periodoD1Sicoob(options.dataReferencia);
  const resultado = await consultarPixRecebidos({
    ...periodo,
    itensPorPagina: options.itensPorPagina || 100,
    buscarTodasPaginas: true,
  });
  const arquivo = await salvarResultadoSicoobPixNaEntrada(resultado, periodo.dataReferencia);
  return {
    sucesso: true,
    periodo,
    consulta: resultado.parametros,
    arquivo: {
      nome: arquivo.nomeArquivo,
      pasta: entradaDir,
      quantidadePix: arquivo.quantidadePix,
      status: 'SALVO_EM_ENTRADA_AGUARDANDO_IMPORTADOR',
    },
    resumo: {
      recebidosApi: resultado.pix.length,
      mensagem: 'JSON D-1 salvo em storage/importacoes/entrada. A gravação no banco será feita somente pelo importador de layouts da pasta entrada.',
    },
  };
}

app.post('/api/sicoob/psp-pix/importar-d1', async (req, res) => {
  try {
    const resultado = await importarSicoobPixD1ParaFila({
      dataReferencia: req.body?.dataReferencia || req.query.dataReferencia as string | undefined,
      itensPorPagina: req.body?.itensPorPagina || req.query.itensPorPagina || 100,
    });
    res.json(resultado);
  } catch (error) {
    res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao importar PIX Sicoob D-1.' });
  }
});

app.get('/api/conversoes', async (_req, res) => {
  res.json(await listarConversoes());
});

app.post('/api/conversoes', async (req, res) => {
  try {
    const conversao = await criarConversaoManual(req.body || {});
    res.status(201).json({ sucesso: true, mensagem: 'Conversão cadastrada com sucesso.', conversao });
  } catch (error) {
    res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao cadastrar conversão.' });
  }
});

app.put('/api/conversoes/:id', async (req, res) => {
  try {
    const conversao = await atualizarConversaoManual(req.params.id, req.body || {});
    if (!conversao) return res.status(404).json({ sucesso: false, mensagem: 'Conversão não encontrada.' });
    res.json({ sucesso: true, mensagem: 'Conversão atualizada com sucesso.', conversao });
  } catch (error) {
    res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro ao atualizar conversão.' });
  }
});

app.delete('/api/conversoes/:id', async (req, res) => {
  const resultado = await excluirConversaoManual(req.params.id);
  if (!resultado) return res.status(404).json({ sucesso: false, mensagem: 'Conversão não encontrada.' });
  res.json({ sucesso: true, mensagem: 'Conversão excluída com sucesso.', id: req.params.id });
});


async function contarLinhasNaoVaziasArquivo(caminhoArquivo: string): Promise<number> {
  const texto = await fs.readFile(caminhoArquivo, 'latin1');
  return texto.split(/\r?\n/).filter((linha) => linha.trim().length > 0).length;
}


async function processarClassificacao(importacaoId: string, caminhoArquivo: string, nomeOriginal: string): Promise<string> {
  try {
    await atualizarImportacao(importacaoId, { status_importacao: 'CLASSIFICANDO' });
    const resultado = await classificarArquivo(caminhoArquivo, nomeOriginal);
    const quantidadeLinhas = await contarLinhasNaoVaziasArquivo(caminhoArquivo);

    let quantidadeProcessados = quantidadeLinhas;
    let statusFinal = resultado.origem_detectada === 'DESCONHECIDO' ? 'LAYOUT_DESCONHECIDO' : 'CLASSIFICADO';

    if (resultado.layout_detectado === 'LAYOUT_INTERDATA') {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const vendasErp = await parseLayoutInterdata(importacaoId, caminhoArquivo);
      const gravacao = await salvarVendasErp(vendasErp);
      quantidadeProcessados = gravacao.inseridos;
      resultado.quantidade_registros = vendasErp.length;
      statusFinal = 'PROCESSADO';
    }

    if (resultado.origem_detectada === 'SIPAG' && resultado.layout_detectado.startsWith('SIPAG_LAYOUT_2_0')) {
      await atualizarImportacao(importacaoId, { status_importacao: 'PROCESSANDO' });
      const resultadoSipag = await parseSipagLayout20(importacaoId, caminhoArquivo, nomeOriginal);
      const gravacaoBruta = await salvarSipagLayout20(resultadoSipag.tipo_arquivo, resultadoSipag.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoSipag.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos + gravacaoCanonica.inseridos;
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
      const resultadoSicoob = await parseSicoobPspPixJson(importacaoId, caminhoArquivo);
      const gravacaoBruta = await salvarSicoobLayoutPspPix(resultadoSicoob.registros_brutos);
      const gravacaoCanonica = await salvarVendasAdquirentes(resultadoSicoob.vendas_adquirentes);
      quantidadeProcessados = gravacaoBruta.inseridos + gravacaoCanonica.inseridos;
      resultado.quantidade_registros = resultadoSicoob.registros_brutos.length;
      resultado.layout_detectado = 'SICOOB_LAYOUT_PSP_PIX_JSON';
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
        : null,
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



app.get('/api/importacoes/sftp/ping', async (_req, res) => {
  try {
    res.json(await pingRemoteEdi());
  } catch (error) {
    res.status(500).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao testar SFTP.' });
  }
});

app.post('/api/importacoes/sftp/coletar', async (req, res) => {
  try {
    const body = req.body || {};
    const resultado: any = await coletarRemoteEdi(body, async (importacaoId, caminhoArquivo, nomeOriginal) => {
      void enfileirarImportacao({ importacaoId, caminhoArquivo, nomeOriginal, origemFila: 'sftp' })
        .catch((error) => logErroImportacao(`sftp-fila:${importacaoId}`, error));
    });

    const deveColetarSicoobPix = !body.dryRun && body.coletarSicoobPix !== false && body.coletarSicoobPspPix !== false;
    if (deveColetarSicoobPix) {
      try {
        resultado.sicoob_psp_pix = await importarSicoobPixD1ParaFila({
          dataReferencia: body.dataReferenciaPix || body.dataReferenciaSicoobPix,
          itensPorPagina: body.itensPorPaginaPix || 100,
        });
      } catch (error) {
        resultado.sicoob_psp_pix = {
          sucesso: false,
          mensagem: error instanceof Error ? error.message : 'Erro desconhecido ao coletar PIX PSP Sicoob após SFTP.',
        };
        resultado.sucesso = false;
      }
    } else {
      resultado.sicoob_psp_pix = {
        sucesso: true,
        ignorado: true,
        mensagem: body.dryRun
          ? 'Coleta PIX PSP Sicoob ignorada porque dryRun=true.'
          : 'Coleta PIX PSP Sicoob desabilitada nesta chamada.',
      };
    }

    res.json(resultado);
  } catch (error) {
    res.status(400).json({ sucesso: false, mensagem: error instanceof Error ? error.message : 'Erro desconhecido na coleta SFTP.' });
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

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ sucesso: false, status_importacao: 'ERRO', mensagem: error.message });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`ERPxADQUIRENTE backend v${versao} online em http://localhost:${port}`);
});
