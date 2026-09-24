'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const {
  COOKIE_NAME, createSession, destroySession, permissionsOf, PERMISSION_LABELS, requireAuth,
} = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Informe e-mail e senha.' });
  }
  const user = await db.get('SELECT * FROM users WHERE email = ?', String(email).trim().toLowerCase());
  if (!user || user.active !== 1 || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Credenciais inválidas ou usuário inativo.' });
  }
  const token = await createSession(user.id);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
  return res.json({ user: publicUser(user), permissions: await permissionsOf(user.role) });
});

router.post('/logout', async (req, res) => {
  await destroySession(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: publicUser(req.user), permissions: await permissionsOf(req.user.role) });
});

router.get('/permission-labels', requireAuth, (req, res) => {
  res.json(PERMISSION_LABELS);
});

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active };
}

module.exports = router;