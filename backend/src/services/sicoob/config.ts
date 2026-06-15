import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';

function getSicoobEnv() {
  return process.env.SICOOB_ENV || 'sandbox';
}

function getSicoobPixBaseUrl() {
  return getSicoobEnv() === 'production'
    ? (process.env.SICOOB_PIX_PRODUCTION_URL || 'https://api.sicoob.com.br/pix/api/v2')
    : (process.env.SICOOB_PIX_SANDBOX_URL || 'https://sandbox.sicoob.com.br/sicoob/sandbox/pix/api/v2');
}

// Mantém compatibilidade com os imports existentes, mas lê process.env somente na hora do uso.
// Isso é importante porque o server.ts carrega o .env automaticamente após os imports ESM.
export const sicoobPixConfig = {
  get env() { return getSicoobEnv(); },
  get clientId() { return process.env.SICOOB_CLIENT_ID || ''; },
  get scope() { return process.env.SICOOB_SCOPE || ''; },
  get authUrl() { return process.env.SICOOB_AUTH_URL || 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token'; },
  get pixBaseUrl() { return getSicoobPixBaseUrl(); },
};

function resolveMaybe(filePath?: string) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function readFileIfExists(filePath?: string) {
  const resolved = resolveMaybe(filePath);
  if (!resolved || !fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved);
}

export function createSicoobHttpsAgent() {
  const passphrase = process.env.SICOOB_CERT_PASSPHRASE || undefined;
  const pfx = readFileIfExists(process.env.SICOOB_PFX_PATH);
  if (pfx) return new https.Agent({ pfx, passphrase, rejectUnauthorized: true });

  const cert = readFileIfExists(process.env.SICOOB_CERT_PATH);
  const key = readFileIfExists(process.env.SICOOB_KEY_PATH);
  if (cert && key) return new https.Agent({ cert, key, passphrase, rejectUnauthorized: true });

  return undefined;
}

export function sicoobConfigDiagnostics() {
  return {
    env: sicoobPixConfig.env,
    pixBaseUrl: sicoobPixConfig.pixBaseUrl,
    authUrl: sicoobPixConfig.authUrl,
    clientIdConfigurado: Boolean(sicoobPixConfig.clientId),
    scopeConfigurado: sicoobPixConfig.scope || '',
    certPaths: {
      pfxPathConfigurado: Boolean(process.env.SICOOB_PFX_PATH),
      certPathConfigurado: Boolean(process.env.SICOOB_CERT_PATH),
      keyPathConfigurado: Boolean(process.env.SICOOB_KEY_PATH),
      pfxExiste: Boolean(readFileIfExists(process.env.SICOOB_PFX_PATH)),
      certExiste: Boolean(readFileIfExists(process.env.SICOOB_CERT_PATH)),
      keyExiste: Boolean(readFileIfExists(process.env.SICOOB_KEY_PATH)),
    },
  };
}
