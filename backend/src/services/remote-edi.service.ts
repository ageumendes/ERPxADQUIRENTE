import { validarSegredo } from '../config/producao.js';
import { resolveSftpFolder, validateSftpFilename, withSftpBrowser, listSftpFolder, copySftpFile, SftpBrowserError } from './sftp-browser.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import SftpClient from 'ssh2-sftp-client';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { entradaDir, remoteEdiDir } from '../database/paths.js';
import { calcularHashArquivo, validarExtensao } from '../utils.js';
import { buscarImportacaoPorHash, criarImportacao } from '../repositories/importacoes.repository.js';
import { getPool } from '../database/pool.js';

type ProviderKey = 'alelo' | 'cielo' | 'sipag' | 'sicredi' | 'convcard' | 'pluxee' | 'sicoob' | 'ticket' | 'vr';
type ProcessarArquivoLocal = (importacaoId: string, caminhoArquivo: string, nomeOriginal: string) => Promise<string>;

type PullOptions = {
  alelo?: boolean;
  cielo?: boolean;
  sipag?: boolean;
  sicredi?: boolean;
  convcard?: boolean;
  pluxee?: boolean;
  sicoob?: boolean;
  ticket?: boolean;
  vr?: boolean;
  dryRun?: boolean;
  moveUnknownToError?: boolean;
};

type RemoteProviderConfig = {
  key: ProviderKey;
  nome: 'ALELO' | 'CIELO' | 'SIPAG' | 'SICREDI' | 'CONVCARD' | 'PLUXEE' | 'SICOOB' | 'TICKET' | 'VR';
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
const db = getPool;

function chaveCriptografia(segredoInformado?: string) {
  const segredo = String(segredoInformado || process.env.SFTP_ENCRYPTION_KEY || '');
  validarSegredo('SFTP_ENCRYPTION_KEY', segredo);
  return createHash('sha256').update(segredo).digest();
}
function criptografar(valor: string) { const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',chaveCriptografia(),iv);const data=Buffer.concat([cipher.update(valor,'utf8'),cipher.final()]);return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.'); }
function descriptografarComSegredo(valor: string, segredo?: string) { const [iv,tag,data]=valor.split('.');if(!iv||!tag||!data)throw new Error('Credencial SFTP armazenada em formato inválido.');const decipher=createDecipheriv('aes-256-gcm',chaveCriptografia(segredo),Buffer.from(iv,'base64'));decipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8'); }
export async function obterStatusCredencialSftp(){const row=(await db().query(`SELECT atualizado_em FROM configuracoes_segurancas WHERE chave='SFTP_PRIVATE_KEY'`)).rows[0];return {configurada:Boolean(row),atualizado_em:row?.atualizado_em||null};}
export async function salvarCredencialSftp(privateKey:string,usuarioId?:string){if(!/-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/.test(privateKey))throw new Error('O arquivo selecionado não contém uma chave privada SSH válida.');await db().query(`INSERT INTO configuracoes_segurancas(chave,valor_criptografado,atualizado_em,atualizado_por) VALUES('SFTP_PRIVATE_KEY',$1,NOW(),$2) ON CONFLICT(chave) DO UPDATE SET valor_criptografado=EXCLUDED.valor_criptografado,atualizado_em=NOW(),atualizado_por=EXCLUDED.atualizado_por`,[criptografar(privateKey),usuarioId||null]);return obterStatusCredencialSftp();}
export async function removerCredencialSftp(){await db().query(`DELETE FROM configuracoes_segurancas WHERE chave='SFTP_PRIVATE_KEY'`);}
async function lerCredencialSftp(){
  const row=(await db().query(`SELECT valor_criptografado FROM configuracoes_segurancas WHERE chave='SFTP_PRIVATE_KEY'`)).rows[0];
  if(!row)return undefined;
  try{return descriptografarComSegredo(row.valor_criptografado);}catch(error){
    const legado=String(process.env.AUTH_SECRET||'');
    if(legado.length<32)throw error;
    const chave=descriptografarComSegredo(row.valor_criptografado,legado);
    await db().query(`UPDATE configuracoes_segurancas SET valor_criptografado=$1,atualizado_em=NOW() WHERE chave='SFTP_PRIVATE_KEY'`,[criptografar(chave)]);
    return chave;
  }
}

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
  const extensoesEdiPermitidas = /\.(csv|txt|xls|xlsx|edi|ret|rem|json|026)$/i;
  const providers = [
    providerEnv('ALELO', 'alelo_sftp', extensoesEdiPermitidas, 'alelo', 'ALELO'),
    providerEnv('CIELO', 'cielo_sftp', /^CIELO(03|04|16).*\.(txt|ret|edi)$/i, 'cielo', 'CIELO'),
    providerEnv('SIPAG', 'sipag_sftp', /^(SIPAG-EDI-[SPR].*|BRCDSE00-EDI-[SP].*)\.(csv|txt|json)$/i, 'sipag', 'SIPAG'),
    providerEnv('SICREDI', 'sicredi_sftp', /^EDI-[SPR]-.*\.json$/i, 'sicredi', 'SICREDI'),
    providerEnv('CONVCARD', 'convcard_sftp', /^(CONVCARD.*|.*CONVCARD.*|A0.*)\.(txt|ret|edi|csv)$/i, 'convcard', 'CONVCARD'),
    providerEnv('PLUXEE', 'pluxee_sftp', extensoesEdiPermitidas, 'pluxee', 'PLUXEE'),
    providerEnv('SICOOB', 'sicoob_sftp', /^sicoob_pix_(?:\d{14}_)?(?:\d{4}-\d{2}-\d{2}|reconsulta_\d{4}-\d{2}-\d{2}_a_\d{4}-\d{2}-\d{2})\.json$/i, 'sicoob', 'SICOOB'),
    providerEnv('TICKET', 'ticket_sftp', extensoesEdiPermitidas, 'ticket', 'TICKET'),
    providerEnv('VR', 'vr_sftp', /^VR_[A-Z0-9_-]+_\d{14}_\d{8}_\d{6}\.txt$/i, 'vr', 'VR'),
  ];
  const chaves = providers.map((provider) => provider.key);
  const recebeuFiltroExplicito = chaves.some((chave) => typeof options[chave] === 'boolean');
  if (!recebeuFiltroExplicito) return providers;
  return providers.filter((provider) => Boolean(options[provider.key]));
}

async function logRemoteEdi(message: string): Promise<void> {
  await db().query(`INSERT INTO historico_coletas_sftp(id,provider,sucesso,resumo) VALUES($1,$2,$3,$4::jsonb)`,[randomUUID(),(message.match(/^\[([^\]]+)\]/)?.[1]||'SISTEMA'),!message.includes('erro'),JSON.stringify({mensagem:message})]).catch(()=>undefined);
}

function mensagemPublicaSftp(error: unknown) {
  const mensagem = error instanceof Error ? error.message : String(error || '');
  if (mensagem.includes('Fingerprint SFTP não configurada')) return mensagem;
  if (mensagem.includes('Fingerprint SFTP inválida')) return mensagem;
  if (mensagem === 'CREDENCIAL_SFTP_AUSENTE') return 'Credencial SFTP não configurada.';
  return 'Falha na operação SFTP. Consulte o log do servidor.';
}

async function criarSftp(provider: RemoteProviderConfig): Promise<SftpClient> {
  const host = envString('REMOTE_EDI_HOST');
  const port = envNumber('REMOTE_EDI_PORT', 22);
  const password = envString(`REMOTE_EDI_${provider.nome}_PASSWORD`) || envString('REMOTE_EDI_PASSWORD');
  const fingerprint = envString(`REMOTE_EDI_${provider.nome}_HOST_FINGERPRINT`) || envString('REMOTE_EDI_HOST_FINGERPRINT');

  if (!host) throw new Error('REMOTE_EDI_HOST não configurado.');
  if (!provider.usuario) throw new Error(`Usuário SFTP não configurado para ${provider.nome}.`);
  if (!fingerprint) throw new Error(`Fingerprint SFTP não configurada para ${provider.nome}.`);

  let fingerprintHex = fingerprint.replace(/^SHA256:/i, '').trim();
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(fingerprintHex) && !/^[a-f0-9]{64}$/i.test(fingerprintHex)) {
    fingerprintHex = Buffer.from(fingerprintHex, 'base64').toString('hex');
  }
  if (!/^[a-f0-9]{64}$/i.test(fingerprintHex)) throw new Error(`Fingerprint SFTP inválida para ${provider.nome}; use SHA256 em base64 ou hexadecimal.`);

  const privateKey = await lerCredencialSftp();
  if (!privateKey && !password) throw new Error('CREDENCIAL_SFTP_AUSENTE');

  const client = new SftpClient(`erpxadquirente-${provider.key}`);
  await client.connect({
    host,
    port,
    username: provider.usuario,
    privateKey,
    password: password || undefined,
    hostHash: 'sha256',
    hostVerifier: (hash: string) => {
      const recebido = Buffer.from(hash.toLowerCase(), 'utf8');
      const esperado = Buffer.from(fingerprintHex.toLowerCase(), 'utf8');
      return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
    },
    readyTimeout: envNumber('REMOTE_EDI_READY_TIMEOUT_MS', 20000),
  });
  return client;
}

function isArquivoValido(nomeArquivo: string, provider: RemoteProviderConfig): boolean {
  if (nomeArquivo.startsWith('.') || nomeArquivo.endsWith('.tmp') || nomeArquivo.endsWith('.part')) return false;
  return provider.allowRegex.test(nomeArquivo);
}

async function moverRemotoSeguro(client: SftpClient, origem: string, destinoDir: string, nomeArquivo: string, copiaLocal?: string): Promise<void> {
  if (!destinoDir) return;
  await client.mkdir(destinoDir, true).catch(() => undefined);
  const base = destinoDir.replace(/\/$/, '');
  let destino = `${base}/${nomeArquivo}`;
  if (await client.exists(destino)) {
    const ext = path.extname(nomeArquivo);
    const nome = path.basename(nomeArquivo, ext);
    destino = `${base}/${nome}-${new Date().toISOString().replace(/[:.]/g, '-')}${ext}`;
  }
  try {
    await client.rename(origem, destino);
  } catch (error) {
    if (!copiaLocal) throw error;
    // Alguns servidores SFTP/chroots recusam rename entre diretórios. Nesse caso,
    // publica a cópia já baixada no destino e só então remove a origem.
    await client.fastPut(copiaLocal, destino);
    await client.delete(origem);
  }
  if (await client.exists(origem)) throw new Error(`O arquivo permaneceu no diretório de entrada: ${nomeArquivo}`);
  if (!(await client.exists(destino))) throw new Error(`O arquivo não foi confirmado no diretório de destino: ${nomeArquivo}`);
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
  const sftpEntradaDir = path.join(entradaDir, '_sftp', params.provider.key, String(Date.now()), randomUUID());
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

  const statusFinal = await processarArquivoLocal(importacao.id, caminhoEntrada, nomeOriginal);
  if (!['PROCESSADO', 'CLASSIFICADO'].includes(statusFinal)) {
    throw new Error(`Importação não concluída com sucesso (status ${statusFinal}).`);
  }
  return {
    nome_arquivo: nomeOriginal,
    acao: 'BAIXADO_IMPORTADO',
    importacao_id: importacao.id,
    hash_arquivo,
    mensagem: `Arquivo baixado, importado com sucesso e pronto para arquivamento remoto (${statusFinal}).`,
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
        const maxBytes = Math.max(1, Number(process.env.UPLOAD_MAX_MB || 50)) * 1024 * 1024;
        if(item.size > maxBytes) throw new Error('Arquivo SFTP excede UPLOAD_MAX_MB.');
        await client.fastGet(remoto, caminhoLocal);
        if((await fs.stat(caminhoLocal)).size > maxBytes) throw new Error('Arquivo SFTP excede UPLOAD_MAX_MB após download.');
        const registro = await registrarArquivoBaixado({ provider, caminhoLocal, nomeOriginal: item.name, processarArquivoLocal });
        resultado.arquivos.push(registro);
        if (registro.acao === 'BAIXADO_IMPORTADO' || registro.acao === 'DUPLICADO') {
          let moveu = true;
          await moverRemotoSeguro(client, remoto, provider.processedDir, item.name, caminhoLocal).catch(async (error) => {
            moveu = false;
            resultado.sucesso = false;
            await logRemoteEdi(`[${provider.nome}] falha ao mover ${item.name} para processed: ${error instanceof Error ? error.message : String(error)}`);
            resultado.arquivos.push({ nome_arquivo: item.name, acao: 'ERRO', mensagem: 'Arquivo importado, mas não foi possível arquivá-lo remotamente em processed.' });
          });
          if (moveu) {
            await fs.unlink(caminhoLocal).catch(() => undefined);
            if (registro.hash_arquivo) {
              const importacaoConfirmada = await buscarImportacaoPorHash(registro.hash_arquivo);
              const caminhoImportado = String(importacaoConfirmada?.caminho_arquivo || '');
              // Preserva o original em processados para auditoria e backup local.
              void caminhoImportado;
            }
          }
        }
      } catch (error) {
        resultado.sucesso = false;
        const mensagem = error instanceof Error ? error.message : 'Erro desconhecido ao processar arquivo remoto.';
        await logRemoteEdi(`[${provider.nome}] erro ao processar ${item.name}: ${mensagem}`);
        resultado.arquivos.push({ nome_arquivo: item.name, acao: 'ERRO', mensagem: 'Não foi possível importar este arquivo remoto. Consulte o log do servidor.' });
        if (options.moveUnknownToError !== false) {
          await moverRemotoSeguro(client, remoto, provider.errorDir, item.name, caminhoLocal).catch(() => undefined);
        }
      }
    }

    const listaFinal = await client.list(provider.inDir);
    resultado.total_remoto = listaFinal.filter((item) => item.type === '-').length;
    resultado.total_candidatos = listaFinal.filter((item) => item.type === '-' && isArquivoValido(item.name, provider)).length;
    await logRemoteEdi(`[${provider.nome}] coleta finalizada: ${resultado.arquivos.length} processado(s), ${resultado.total_candidatos} candidato(s) restante(s) em ${provider.inDir}.`);
  } catch (error) {
    resultado.sucesso = false;
    const erroTecnico = error instanceof Error ? error.message : 'Erro desconhecido na coleta SFTP.';
    resultado.erro = mensagemPublicaSftp(error);
    await logRemoteEdi(`[${provider.nome}] erro: ${erroTecnico}`);
  } finally {
    await client?.end().catch(() => undefined);
  }

  return resultado;
}

export async function pingRemoteEdi(): Promise<{ sucesso: boolean; habilitado: boolean; providers: Array<{ provider: string; sucesso: boolean; mensagem: string }> }> {
  const habilitado = envBool('REMOTE_EDI_ENABLED', false);
  const providers = montarProviders({ alelo: true, cielo: true, sipag: true, sicredi: true, convcard: true, pluxee: true, sicoob: true, ticket: true, vr: true });
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
      await logRemoteEdi(`[${provider.nome}] falha no teste: ${error instanceof Error ? error.message : String(error)}`);
      resultados.push({ provider: provider.nome, sucesso: false, mensagem: mensagemPublicaSftp(error) });
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


// Navegação e segunda via: não chama coleta, importador ou movimentação remota.
export function obterPastasNavegadorSftp() {
  return { habilitado: envBool('REMOTE_EDI_ENABLED', false), providers: montarProviders({}).map(p => ({
    key: p.key, nome: p.nome, usuario: p.usuario,
    pastas: [{ key: 'in', caminho: p.inDir }, { key: 'processed', caminho: p.processedDir }, { key: 'error', caminho: p.errorDir }],
  })) };
}
function alvoNavegadorSftp(provider: unknown, pasta: unknown) {
  if (!envBool('REMOTE_EDI_ENABLED', false)) throw new SftpBrowserError(400, 'SFTP desabilitado na configuração do app.');
  return resolveSftpFolder(montarProviders({}), provider, pasta);
}
export async function listarArquivosSftp(provider: unknown, pasta: unknown, signal?: AbortSignal) {
  const alvo = alvoNavegadorSftp(provider, pasta);
  const arquivos = await withSftpBrowser(() => criarSftp(alvo.provider as RemoteProviderConfig), client => listSftpFolder(client, alvo.dir), signal);
  return { provider: alvo.provider.key, usuario: alvo.provider.usuario, pasta: alvo.folder, caminho: alvo.dir, arquivos };
}
export async function baixarCopiaArquivoSftp(provider: unknown, pasta: unknown, nome: unknown, signal?: AbortSignal) {
  const alvo = alvoNavegadorSftp(provider, pasta);
  validateSftpFilename(nome);
  return withSftpBrowser(() => criarSftp(alvo.provider as RemoteProviderConfig), (client, operationSignal) => copySftpFile(client, alvo.dir, nome, operationSignal), signal);
}
