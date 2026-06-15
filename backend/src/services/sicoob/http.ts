import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

export type HttpResponse<T = any> = { status: number; headers: http.IncomingHttpHeaders; data: T };

export class HttpRequestError extends Error {
  status?: number;
  data?: unknown;
  constructor(message: string, status?: number, data?: unknown) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = status;
    this.data = data;
  }
}

export function requestJson<T = any>(urlRaw: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  agent?: https.Agent;
  timeoutMs?: number;
} = {}): Promise<HttpResponse<T>> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlRaw);
    const req = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      agent: options.agent,
      timeout: options.timeoutMs || 30000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data: any = text;
        try { data = text ? JSON.parse(text) : null; } catch {}
        const status = res.statusCode || 0;
        if (status < 200 || status >= 300) {
          reject(new HttpRequestError(`HTTP ${status}`, status, data));
          return;
        }
        resolve({ status, headers: res.headers, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout na requisição Sicoob')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
