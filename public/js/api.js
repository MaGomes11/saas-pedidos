'use strict';

/**
 * Wrapper da API REST.
 * - Injeta JSON, trata 401 (redireciona para login), converte erros do servidor em exceções.
 */

let sessionUser = null; // { id, name, email, role, active }
let sessionPermissions = []; // strings

export function setSession(user, permissions) {
  sessionUser = user || null;
  sessionPermissions = Array.isArray(permissions) ? permissions : [];
}

export function currentUser() {
  return sessionUser;
}

export function hasPerm(perm) {
  if (!sessionUser) return false;
  if (sessionUser.role === 'administrador') return true;
  return sessionPermissions.includes(perm);
}

export function isAdmin() {
  return !!sessionUser && sessionUser.role === 'administrador';
}

async function request(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch('/api' + path, opts);
  } catch (e) {
    throw new Error('Falha de conexão com o servidor. Verifique se ele está rodando.');
  }
  if (res.status === 401) {
    setSession(null, []);
    const isLogin = /^\/auth\/login/.test(path);
    if (!isLogin && location.hash !== '#/login') {
      location.hash = '#/login';
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Não autenticado.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    throw new Error((data && data.error) ? data.error : `Erro ${res.status} na requisição.`);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};