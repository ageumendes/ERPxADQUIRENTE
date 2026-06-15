import { URLSearchParams } from 'node:url';
import { createSicoobHttpsAgent, sicoobPixConfig } from './config.js';
import { requestJson } from './http.js';

let cachedToken: string | null = null;
let expiresAt = 0;

export function clearSicoobTokenCache() {
  cachedToken = null;
  expiresAt = 0;
}

export async function getSicoobAccessToken(forceRefresh = false) {
  if (!sicoobPixConfig.clientId) throw new Error('SICOOB_CLIENT_ID não configurado no .env');

  const now = Date.now();
  if (!forceRefresh && cachedToken && now < expiresAt - 15000) return cachedToken;

  const body = new URLSearchParams();
  body.append('grant_type', 'client_credentials');
  body.append('client_id', sicoobPixConfig.clientId);
  if (sicoobPixConfig.scope) body.append('scope', sicoobPixConfig.scope);

  const response = await requestJson<{ access_token: string; expires_in?: number }>(sicoobPixConfig.authUrl, {
    method: 'POST',
    agent: createSicoobHttpsAgent(),
    body: body.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(Buffer.byteLength(body.toString())),
      client_id: sicoobPixConfig.clientId,
    },
    timeoutMs: 30000,
  });

  cachedToken = response.data.access_token;
  const expiresIn = Number(response.data.expires_in || 300);
  expiresAt = Date.now() + expiresIn * 1000;
  return cachedToken as string;
}
