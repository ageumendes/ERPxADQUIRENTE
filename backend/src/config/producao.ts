import path from 'node:path';
import { createHash } from 'node:crypto';
import { obterOpcoesPool } from './postgres.js';

// Hashes dos valores demonstrativos distribuídos anteriormente. Não repete os segredos.
const demonstrativos = new Set([
  'bfb733832743ca8b7e3cf9d688030ad3b6e5c89a4cb8143351fe35bfb9c6e399',
  '47e0fb82edecb8e9a5e63708b219d6e5e941bd8bdc0a4f12ca5ea89f72f13de9',
]);
export function validarSegredo(nome: string, valor: unknown) {
  const segredo = String(valor || '');
  if (segredo.length < 32 || /^(SUBSTITUA_|CHANGE_ME|EXEMPLO)/i.test(segredo) || demonstrativos.has(createHash('sha256').update(segredo).digest('hex'))) {
    throw new Error(`${nome} deve ser configurada com um segredo exclusivo de pelo menos 32 caracteres.`);
  }
  return segredo;
}

export function validarConfiguracaoProducao(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') return;
  obterOpcoesPool(env);
  if (!env.STORAGE_DIR || !path.isAbsolute(env.STORAGE_DIR)) throw new Error('STORAGE_DIR deve apontar para um diretório absoluto persistente.');
  if (env.HOST && env.HOST !== '127.0.0.1') throw new Error('HOST de produção deve ser 127.0.0.1 para o Nginx local.');
  validarSegredo('AUTH_SECRET', env.AUTH_SECRET);
  validarSegredo('SFTP_ENCRYPTION_KEY', env.SFTP_ENCRYPTION_KEY);
  if (env.AUTH_SECRET === env.SFTP_ENCRYPTION_KEY) throw new Error('AUTH_SECRET e SFTP_ENCRYPTION_KEY devem ser diferentes.');
  const senha = String(env.ADMIN_INITIAL_PASSWORD || '');
  if (senha && (senha.length < 12 || /^(12345678|SUBSTITUA_|CHANGE_ME)/i.test(senha))) throw new Error('A senha inicial de produção deve ter pelo menos 12 caracteres e ser exclusiva.');
  const origens = String(env.CORS_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
  if (!origens.length || origens.some(origem => { try { const url=new URL(origem); return url.protocol !== 'https:' || url.origin !== origem || /SEU_DOMINIO|SUBSTITUA/i.test(url.hostname); } catch { return true; } })) throw new Error('CORS_ORIGINS de produção deve conter origens HTTPS explícitas.');
  if (env.TRUST_PROXY && env.TRUST_PROXY !== 'loopback') throw new Error('TRUST_PROXY aceita somente loopback para o proxy local.');
}
