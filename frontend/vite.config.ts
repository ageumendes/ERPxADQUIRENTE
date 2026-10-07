import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const commonSecurityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// O @vitejs/plugin-react injeta um pequeno preâmbulo inline para o Fast Refresh
// durante `vite dev`. Liberamos inline SOMENTE no servidor local de desenvolvimento.
// Scripts de produção são externos; estilos inline são usados pelas larguras das colunas.
const developmentSecurityHeaders = {
  ...commonSecurityHeaders,
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' http://localhost:3333 http://127.0.0.1:3333 ws://localhost:5173 ws://127.0.0.1:5173; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};

const productionSecurityHeaders = {
  ...commonSecurityHeaders,
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};

export default defineConfig({
  plugins: [react()],
  server: {
    headers: developmentSecurityHeaders,
    proxy: { '/api': 'http://127.0.0.1:3333' },
  },
  preview: {
    headers: productionSecurityHeaders,
  },
});
