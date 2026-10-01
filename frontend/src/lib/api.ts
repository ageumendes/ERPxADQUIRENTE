export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3333';

const nativeFetch = window.fetch.bind(window);
let requisicoesAtivas = 0;

function notificarAtividade() {
  window.dispatchEvent(new CustomEvent('erp:atividade-http', { detail: { ativas: requisicoesAtivas } }));
}

async function executarFetch(input: RequestInfo | URL, init: RequestInit, autenticado: boolean, exibirAtividade: boolean) {
  const headers = new Headers(init.headers || {});
  if (autenticado) {
    const token = sessionStorage.getItem('erp_auth_token');
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  if (exibirAtividade) {
    requisicoesAtivas += 1;
    notificarAtividade();
  }
  try {
    const response = await nativeFetch(input, { ...init, headers });
    if (autenticado && response.status === 401) {
      sessionStorage.removeItem('erp_auth_token');
      sessionStorage.removeItem('erp_auth_user');
      window.dispatchEvent(new Event('erp:sessao-expirada'));
    }
    return response;
  } finally {
    if (exibirAtividade) {
      requisicoesAtivas = Math.max(0, requisicoesAtivas - 1);
      notificarAtividade();
    }
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return executarFetch(input, init, true, true);
}

export async function apiFetchSilencioso(input: RequestInfo | URL, init: RequestInit = {}) {
  return executarFetch(input, init, true, false);
}

export function publicApiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return executarFetch(input, init, false, true);
}
