'use strict';

const bcrypt = require('bcryptjs');
const db = require('./db');
const { nowIso, randomToken, toInt } = require('./util');

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const COOKIE_NAME = 'sb_session';

// ---------------------------------------------------------------------------
// Sessões
// ---------------------------------------------------------------------------
async function createSession(userId) {
  const token = randomToken(32);
  const created = nowIso();
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, userId, created, expires);
  return token;
}

async function destroySession(token) {
  if (!token) return;
  await db.run('DELETE FROM sessions WHERE token = ?', token);
}

async function getSessionUser(token) {
  if (!token) return null;
  const row = await db.get(
    `SELECT s.token, u.id, u.name, u.email, u.role, u.active
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?`,
    token
  );
  if (!row) return null;
  if (row.active !== 1) return null;
  return row;
}

// ---------------------------------------------------------------------------
// Permissões
// ---------------------------------------------------------------------------
const PERMISSION_LABELS = {
  usuarios_gerenciar: 'Gerenciar usuários e permissões',
  cardapios_gerenciar: 'Gerenciar tipos de cardápio',
  pratos_gerenciar: 'Gerenciar pratos e composição',
  categorias_gerenciar: 'Gerenciar categorias de pratos (incluir, editar, excluir, ordem)',
  ingredientes_gerenciar: 'Gerenciar ingredientes',
  festas_gerenciar: 'Criar e editar festas, cardápio da festa e mesas',
  festas_visualizar: 'Visualizar festas e cardápios',
  pedidos_criar: 'Criar pedidos',
  pedidos_editar: 'Editar pedidos abertos (Novo / Em preparo)',
  pedidos_editar_finalizados: 'Editar pedidos finalizados',
  pedidos_cancelar: 'Cancelar pedidos',
  statuses_gerenciar: 'Gerenciar status de pedidos (incluir, editar, excluir, ordem)',
  configuracoes_gerenciar: 'Gerenciar identidade e informações da empresa',
  pedidos_cozinha_status: 'Mover pedidos no fluxo da cozinha',
  pedidos_entrega_status: 'Marcar pedidos como Entregue',
  pedidos_finalizar: 'Marcar pedidos como Finalizados',
  painel_visualizar: 'Visualizar painel (dashboard)',
  historico_visualizar: 'Visualizar histórico e auditoria',
  notificacoes_visualizar: 'Visualizar notificações',
};

const ADMIN_ROLE = 'administrador';

async function permissionsOf(role) {
  const rows = await db.all('SELECT permission FROM role_permissions WHERE role_key = ?', role);
  return rows.map((r) => r.permission);
}

async function hasPermission(user, perm) {
  if (!user) return false;
  if (user.role === ADMIN_ROLE) return true;
  return (await permissionsOf(user.role)).includes(perm);
}

// ---------------------------------------------------------------------------
// Middlewares Express
// ---------------------------------------------------------------------------
async function attachUser(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    req.user = token ? await getSessionUser(token) : null;
    next();
  } catch (e) {
    next(e);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Não autenticado. Faça login para continuar.' });
  }
  next();
}

function requirePermission(perm) {
  return async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
      if (!(await hasPermission(req.user, perm))) {
        return res.status(403).json({ error: 'Acesso negado: você não tem permissão para esta ação.' });
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Admin sempre passa; senão, exige qualquer um dos roles. */
function requireAnyRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    if (req.user.role === ADMIN_ROLE || roles.includes(req.user.role)) return next();
    return res.status(403).json({ error: 'Acesso negado para o seu perfil.' });
  };
}

function isAdmin(user) {
  return !!user && user.role === ADMIN_ROLE;
}

module.exports = {
  COOKIE_NAME,
  PERMISSION_LABELS,
  ADMIN_ROLE,
  createSession,
  destroySession,
  getSessionUser,
  permissionsOf,
  hasPermission,
  attachUser,
  requireAuth,
  requirePermission,
  requireAnyRole,
  isAdmin,
  toInt,
};