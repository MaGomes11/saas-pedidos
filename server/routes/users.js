'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requirePermission, PERMISSION_LABELS, isAdmin } = require('../auth');
const { audit } = require('../audit');
const { nowIso } = require('../util');

const router = express.Router();
router.use(requireAuth);

const USER_FIELDS = ['name', 'email', 'role', 'active', 'password'];

function cleanUserPayload(body) {
  const out = {};
  if (typeof body.name === 'string' && body.name.trim()) out.name = body.name.trim();
  if (typeof body.email === 'string' && body.email.trim()) out.email = body.email.trim().toLowerCase();
  if (typeof body.role === 'string' && body.role.trim()) out.role = body.role.trim();
  if (body.active !== undefined) out.active = body.active ? 1 : 0;
  if (typeof body.password === 'string' && body.password.length >= 6) out.password = body.password;
  return out;
}

// Listar usuários (admin) ou apenas o próprio perfil
router.get('/', requirePermission('usuarios_gerenciar'), async (req, res) => {
  const users = await db.all('SELECT id, name, email, role, active, created_at, updated_at FROM users ORDER BY name');
  res.json(users);
});

router.post('/', requirePermission('usuarios_gerenciar'), async (req, res) => {
  const data = cleanUserPayload(req.body);
  if (!data.name || !data.email || !data.role || !data.password) {
    return res.status(400).json({ error: 'Nome, e-mail, perfil e senha (mín. 6 caracteres) são obrigatórios.' });
  }
  const exists = await db.get('SELECT id FROM users WHERE email = ?', data.email);
  if (exists) return res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
  const now = nowIso();
  const info = await db.run(
    'INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    data.name, data.email, bcrypt.hashSync(data.password, 10), data.role, data.active ?? 1, now, now
  );
  await audit('user', info.lastInsertRowid, 'created', `Usuário "${data.name}" criado (perfil: ${data.role}).`, req.user.id);
  res.status(201).json({ id: info.lastInsertRowid, ...data });
});

router.put('/:id', requirePermission('usuarios_gerenciar'), async (req, res) => {
  const id = Number(req.params.id);
  const user = await db.get('SELECT * FROM users WHERE id = ?', id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const data = cleanUserPayload(req.body);
  if (!data.name && !data.email && !data.role && data.active === undefined && !data.password) {
    return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });
  }
  if (data.email && data.email !== user.email) {
    const dup = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', data.email, id);
    if (dup) return res.status(409).json({ error: 'E-mail já utilizado por outro usuário.' });
  }
  const now = nowIso();
  const changes = [];
  if (data.name && data.name !== user.name) { await db.run('UPDATE users SET name = ? WHERE id = ?', data.name, id); changes.push(`nome: ${user.name} → ${data.name}`); }
  if (data.email && data.email !== user.email) { await db.run('UPDATE users SET email = ? WHERE id = ?', data.email, id); changes.push(`e-mail: ${user.email} → ${data.email}`); }
  if (data.role && data.role !== user.role) { await db.run('UPDATE users SET role = ? WHERE id = ?', data.role, id); changes.push(`perfil: ${user.role} → ${data.role}`); }
  if (data.active !== undefined && data.active !== user.active) { await db.run('UPDATE users SET active = ? WHERE id = ?', data.active, id); changes.push(data.active ? 'usuário ativado' : 'usuário inativado'); }
  if (data.password) { await db.run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(data.password, 10), id); changes.push('senha redefinida'); }
  await db.run('UPDATE users SET updated_at = ? WHERE id = ?', now, id);
  await audit('user', id, 'updated', `Alterações em "${user.name}": ${changes.join('; ')}.`, req.user.id);
  res.json({ ok: true });
});

// Ativar/inativar
router.put('/:id/status', requirePermission('usuarios_gerenciar'), async (req, res) => {
  const id = Number(req.params.id);
  const user = await db.get('SELECT * FROM users WHERE id = ?', id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  if (user.id === req.user.id && req.body.active === 0) {
    return res.status(400).json({ error: 'Você não pode inativar o próprio usuário.' });
  }
  const active = req.body.active ? 1 : 0;
  await db.run('UPDATE users SET active = ?, updated_at = ? WHERE id = ?', active, nowIso(), id);
  await audit('user', id, active ? 'activated' : 'inactivated', `Usuário "${user.name}" ${active ? 'ativado' : 'inativado'}.`, req.user.id);
  res.json({ ok: true });
});

// ---- Perfis e permissões ----
router.get('/roles', requirePermission('usuarios_gerenciar'), async (req, res) => {
  const roles = await db.all('SELECT key, name FROM roles ORDER BY key');
  res.json(roles);
});

router.get('/roles/:role/permissions', requirePermission('usuarios_gerenciar'), async (req, res) => {
  const role = String(req.params.role);
  const permSet = (await db.all('SELECT permission FROM role_permissions WHERE role_key = ? ORDER BY permission', role)).map((r) => r.permission);
  res.json({ role, permissions: permSet, labels: PERMISSION_LABELS });
});

router.put('/roles/:role/permissions', requirePermission('usuarios_gerenciar'), async (req, res) => {
  const role = String(req.params.role);
  const roleRow = await db.get('SELECT * FROM roles WHERE key = ?', role);
  if (!roleRow) return res.status(404).json({ error: 'Perfil não encontrado.' });
  if (role === 'administrador') {
    return res.status(400).json({ error: 'O perfil Administrador sempre possui todas as permissões.' });
  }
  const permissions = Array.isArray(req.body.permissions) ? req.body.permissions.map(String) : [];
  const valid = new Set(Object.keys(PERMISSION_LABELS));
  const clean = [...new Set(permissions.filter((p) => valid.has(p)))];
  await db.run('DELETE FROM role_permissions WHERE role_key = ?', role);
  for (const p of clean) await db.run('INSERT INTO role_permissions (role_key, permission) VALUES (?, ?)', role, p);
  await audit('role', null, 'permissions', `Permissões do perfil "${roleRow.name}" atualizadas (${clean.length} permissões).`, req.user.id);
  res.json({ role, permissions: clean });
});

module.exports = router;