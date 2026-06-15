import fs from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import SftpClient from 'ssh2-sftp-client';
import { entradaDir, logsDir, remoteEdiDir } from '../database/paths.js';
import { calcularHashArquivo, validarExtensao } from '../utils.js';
import { buscarImportacaoPorHash, criarImportacao } from '../repositories/repositorio.js';

type ProviderKey = 'cielo' | 'sipag' | 'sicredi' | 'convcard';
type ProcessarArquivoLocal = (importacaoId: string, caminhoArquivo: string, nomeOriginal: string) => Promise<void>;

type PullOptions = {
  cielo?: boolean;
  sipag?: boolean;
  sicredi?: boolean;
  convcard?: boolean;
  dryRun?: boolean;
  moveUnknownToError?: boolean;
};

type RemoteProviderConfig = {
  key: ProviderKey;
  nome: 'CIELO' | 'SIPAG' | 'SICREDI' | 'CONVCARD';
  usuario: string;
  inDir: string;
  processedDir: string;
  errorDir: string;
  allowRegex: RegExp;
};

type ColetaArquivoResultado = {
  nome_arquivo: string;
  acao: 'IGNORADO' | 'BAIXADO_IMPORTADO' | 'DUPLICADO' | 'DRY_RUN' | 'ERRO';
  importacao_id?: string;
  hash_arquivo?: string;
  mensagem?: string;
};

type ColetaProviderResultado = {
  provider: string;
  sucesso: boolean;
  total_remoto: number;
  total_candidatos: number;
  arquivos: ColetaArquivoResultado[];
  erro?: string;
};

let isRunning = false;

function envBool(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'sim', 'on'].includes(value.toLowerCase());
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envString(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

function providerEnv(prefix: string, fallbackUser: string, allowRegex: RegExp, key: ProviderKey, nome: RemoteProviderConfig['nome']): RemoteProviderConfig {
  return {
    key,
    nome,
    usuario: envString(`REMOTE_EDI_${prefix}_USER`, fallbackUser),
    inDir: envString(`REMOTE_EDI_${prefix}_IN_DIR`, '/in'),
    processedDir: envString(`REMOTE_EDI_${prefix}_PROCESSED_DIR`, '/processed'),
    errorDir: envString(`REMOTE_EDI_${prefix}_ERROR_DIR`, '/error'),
    allowRegex: process.env[`REMOTE_EDI_${prefix}_ALLOW_REGEX`] ? new RegExp(process.env[`REMOTE_EDI_${prefix}_ALLOW_REGEX`] as string, 'i') : allowRegex,
  };
}

function montarProviders(options: PullOptions): RemoteProviderConfig[] {
  const providers = [
    providerEnv('CIELO', 'cielo_sftp', /^CIELO(03|04|16).*\.(txt|ret|edi)$/i, 'cielo', 'CIELO'),
    providerEnv('SIPAG', 'sipag_sftp', /^(SIPAG-EDI-[SPR].*|BRCDSE00-EDI-[SP].*)\.(csv|txt|json)$/i, 'sipag', 'SIPAG'),
    providerEnv('SICREDI', 'sicredi_sftp', /^EDI-[SPR]-.*\.json$/i, 'sicredi', 'SICREDI'),
    providerEnv('CONVCARD', 'convcard_sftp', /^(CONVCARD.*|.*CONVCARD.*|A0.*)\.(txt|ret|edi|csv)$/i, 'convcard', 'CONVCARD'),
  ];
  const chaves = providers.map((provider) => provider.key);
  const recebeuFiltroExplicito = chaves.some((chave) => typeof options[chave] === 'boolean');
  if (!recebeuFiltroExplicito) return providers;
  return providers.filter((provider) => Boolean(options[provider.key]));
}

async function logRemoteEdi(message: string): Promise<void> {
  await fs.mkdir(logsDir, { recursive: true });
  const line = `${new Date().toISOString()} ${message}\n`;
  await fs.appendFile(path.join(logsDir, 'remote-edi.log'), line, 'utf8').catch(() => undefined);
}

async function criarSftp(provider: RemoteProviderConfig): Promise<SftpClient> {
  const host = envString('REMOTE_EDI_HOST');
  const port = envNumber('REMOTE_EDI_PORT', 22);
  const privateKeyPath = envString('REMOTE_EDI_PRIVATE_KEY_PATH');
  const password = envString(`REMOTE_EDI_${provider.nome}_PASSWORD`) || envString('REMOTE_EDI_PASSWORD');

  if (!host) throw new Error('REMOTE_EDI_HOST não configurado.');
  if (!provider.usuario) throw new Error(`Usuário SFTP não configurado para ${provider.nome}.`);

  const privateKey = privateKeyPath ? await fs.readFile(path.resolve(privateKeyPath), 'utf8') : undefined;
  if (!privateKey && !password) throw new Error('Configure REMOTE_EDI_PRIVATE_KEY_PATH ou uma senha REMOTE_EDI_*_PASSWORD.');

  const client = new SftpClient(`erpxadquirente-${provider.key}`);
  await client.connect({
    host,
    port,
    username: provider.usuario,
    privateKey,
    password: password || undefined,
    readyTimeout: envNumber('REMOTE_EDI_READY_TIMEOUT_MS', 20000),
  });
  return client;
}

function isArquivoValido(nomeArquivo: string, provider: RemoteProviderConfig): boolean {
  if (nomeArquivo.startsWith('.') || nomeArquivo.endsWith('.tmp') || nomeArquivo.endsWith('.part')) return false;
  return provider.allowRegex.test(nomeArquivo);
}

async function moverRemotoSeguro(client: SftpClient, origem: string, destinoDir: string, nomeArquivo: string): Promise<void> {
  if (!destinoDir) return;
  const destino = `${destinoDir.replace(/\/$/, '')}/${nomeArquivo}`;
  await client.mkdir(destinoDir, true).catch(() => undefined);
  await client.rename(origem, destino);
}

async function registrarArquivoBaixado(params: {
  provider: RemoteProviderConfig;
  caminhoLocal: string;
  nomeOriginal: string;
  processarArquivoLocal: ProcessarArquivoLocal;
}): Promise<ColetaArquivoResultado> {
  const { caminhoLocal, nomeOriginal, processarArquivoLocal } = params;
  validarExtensao(nomeOriginal);

  const hash_arquivo = await calcularHashArquivo(caminhoLocal);
  const duplicada = await buscarImportacaoPorHash(hash_arquivo);
  if (duplicada) {
    return {
      nome_arquivo: nomeOriginal,
      acao: 'DUPLICADO',
      importacao_id: duplicada.id,
      hash_arquivo,
      mensagem: 'Arquivo já importado anteriormente; reprocessamento bloqueado.',
    };
  }

  const nomeSalvo = nomeOriginal.replace(/[^a-zA-Z0-9._ -]+/g, '_').trim().slice(0, 180) || `arquivo-${Date.now()}`;
  const sftpEntradaDir = path.join(entradaDir, '_sftp', params.provider.key, String(Date.now()), uuidv4());
  const caminhoEntrada = path.join(sftpEntradaDir, nomeSalvo);
  await fs.mkdir(sftpEntradaDir, { recursive: true });
  await fs.copyFile(caminhoLocal, caminhoEntrada);
  const stat = await fs.stat(caminhoEntrada);

  const importacao = await criarImportacao({
    nome_arquivo_original: nomeOriginal,
    nome_arquivo_salvo: nomeSalvo,
    caminho_arquivo: caminhoEntrada,
    tamanho_bytes: stat.size,
    tipo_mime: 'application/octet-stream',
    hash_arquivo,
    origem_detectada: 'DESCONHECIDO',
    layout_detectado: 'AGUARDANDO_CLASSIFICACAO',
    status_importacao: 'ENFILEIRADO',
    quantidade_registros: 0,
    quantidade_processados: 0,
    quantidade_erros: 0,
    mensagem_erro: null,
  });

  await processarArquivoLocal(importacao.id, caminhoEntrada, nomeOriginal);
  return {
    nome_arquivo: nomeOriginal,
    acao: 'BAIXADO_IMPORTADO',
    importacao_id: importacao.id,
    hash_arquivo,
    mensagem: 'Arquivo baixado do SFTP e enviado ao classificador/importador.',
  };
}

async function coletarProvider(provider: RemoteProviderConfig, options: PullOptions, processarArquivoLocal: ProcessarArquivoLocal): Promise<ColetaProviderResultado> {
  const resultado: ColetaProviderResultado = {
    provider: provider.nome,
    sucesso: true,
    total_remoto: 0,
    total_candidatos: 0,
    arquivos: [],
  };

  let client: SftpClient | undefined;
  try {
    await logRemoteEdi(`[${provider.nome}] iniciando coleta em ${provider.inDir}`);
    client = await criarSftp(provider);
    const lista = await client.list(provider.inDir);
    resultado.total_remoto = lista.length;

    const candidatos = lista.filter((item) => item.type === '-' && isArquivoValido(item.name, provider));
    resultado.total_candidatos = candidatos.length;

    for (const item of candidatos) {
      const remoto = `${provider.inDir.replace(/\/$/, '')}/${item.name}`;
      if (options.dryRun) {
        resultado.arquivos.push({ nome_arquivo: item.name, acao: 'DRY_RUN', mensagem: 'Arquivo identificado; dryRun ativo, nada foi baixado.' });
        continue;
      }

      const providerPulledDir = path.join(remoteEdiDir, provider.key, 'pulled');
      await fs.mkdir(providerPulledDir, { recursive: true });
      const caminhoLocal = path.join(providerPulledDir, `${Date.now()}-${item.name}`);

      try {
        await client.fastGet(remoto, caminhoLocal);
        const registro = await registrarArquivoBaixado({ provider, caminhoLocal, nomeOriginal: item.name, processarArquivoLocal });
        resultado.arquivos.push(registro);
        if (registro.acao === 'BAIXADO_IMPORTADO' || registro.acao === 'DUPLICADO') {
          await moverRemotoSeguro(client, remoto, provider.processedDir, item.name).catch((error) => {
            resultado.arquivos.push({ nome_arquivo: item.name, acao: 'ERRO', mensagem: `Importado, mas falhou ao mover remoto para processed: ${error instanceof Error ? error.message : String(error)}` });
          });
        }
      } catch (error) {
        const mensagem = error instanceof Error ? error.message : 'Erro desconhecido ao processar arquivo remoto.';
        resultado.arquivos.push({ nome_arquivo: item.name, acao: 'ERRO', mensagem });
        if (options.moveUnknownToError) {
          await moverRemotoSeguro(client, remoto, provider.errorDir, item.name).catch(() => undefined);
        }
      }
    }

    await logRemoteEdi(`[${provider.nome}] coleta finalizada: ${resultado.arquivos.length} arquivo(s).`);
  } catch (error) {
    resultado.sucesso = false;
    resultado.erro = error instanceof Error ? error.message : 'Erro desconhecido na coleta SFTP.';
    await logRemoteEdi(`[${provider.nome}] erro: ${resultado.erro}`);
  } finally {
    await client?.end().catch(() => undefined);
  }

  return resultado;
}

export async function pingRemoteEdi(): Promise<{ sucesso: boolean; habilitado: boolean; providers: Array<{ provider: string; sucesso: boolean; mensagem: string }> }> {
  const habilitado = envBool('REMOTE_EDI_ENABLED', false);
  const providers = montarProviders({ cielo: true, sipag: true, sicredi: true, convcard: true });
  const resultados = [] as Array<{ provider: string; sucesso: boolean; mensagem: string }>;

  if (!habilitado) {
    return { sucesso: false, habilitado, providers: providers.map((p) => ({ provider: p.nome, sucesso: false, mensagem: 'REMOTE_EDI_ENABLED=false' })) };
  }

  for (const provider of providers) {
    let client: SftpClient | undefined;
    try {
      client = await criarSftp(provider);
      await client.list(provider.inDir);
      resultados.push({ provider: provider.nome, sucesso: true, mensagem: `Conexão OK em ${provider.inDir}.` });
    } catch (error) {
      resultados.push({ provider: provider.nome, sucesso: false, mensagem: error instanceof Error ? error.message : 'Falha desconhecida.' });
    } finally {
      await client?.end().catch(() => undefined);
    }
  }

  return { sucesso: resultados.every((r) => r.sucesso), habilitado, providers: resultados };
}

export function obterStatusRemoteEdi() {
  return {
    habilitado: envBool('REMOTE_EDI_ENABLED', false),
    coletando: isRunning,
  };
}

export async function coletarRemoteEdi(options: PullOptions, processarArquivoLocal: ProcessarArquivoLocal) {
  if (!envBool('REMOTE_EDI_ENABLED', false)) {
    throw new Error('Coleta SFTP desabilitada. Configure REMOTE_EDI_ENABLED=true no .env.');
  }
  if (isRunning) {
    throw new Error('Já existe uma coleta SFTP em andamento. Aguarde finalizar para iniciar outra.');
  }

  isRunning = true;
  try {
    const providers = montarProviders(options);
    const resultados = [] as ColetaProviderResultado[];
    for (const provider of providers) {
      resultados.push(await coletarProvider(provider, options, processarArquivoLocal));
    }
    return {
      sucesso: resultados.every((r) => r.sucesso),
      dryRun: Boolean(options.dryRun),
      providers: resultados,
    };
  } finally {
    isRunning = false;
  }
}
