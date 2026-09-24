'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { toInt } = require('../util');

const router = express.Router();
router.use(requireAuth);

router.get('/', requirePermission('notificacoes_visualizar'), async (req, res) => {
  const { unread, limit } = req.query;
  let sql = `SELECT n.*, p.name AS party_name FROM notifications n LEFT JOIN parties p ON p.id = n.party_id
             WHERE (n.audience = '*' OR n.audience = ? OR n.audience = 'cozinha')
             ${unread === '1' ? 'AND n.is_read = 0' : ''}
             ORDER BY n.id DESC`;
  const params = [req.user.role];
  if (limit) { sql += ' LIMIT ?'; params.push(Math.min(toInt(limit, 100), 500)); }
  res.json(await db.all(sql, ...params));
});

router.get('/unread-count', requirePermission('notificacoes_visualizar'), async (req, res) => {
  const row = await db.get(
    `SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0 AND (audience = '*' OR audience = ? OR audience = 'cozinha')`,
    req.user.role
  );
  res.json({ count: row.c });
});

router.put('/:id/read', requirePermission('notificacoes_visualizar'), async (req, res) => {
  await db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', toInt(req.params.id));
  res.json({ ok: true });
});

router.put('/read-all', requirePermission('notificacoes_visualizar'), async (req, res) => {
  await db.run('UPDATE notifications SET is_read = 1 WHERE is_read = 0 AND (audience = ? OR audience = ? OR audience = ?)',
    req.user.role, '*', 'cozinha');
  res.json({ ok: true });
});

module.exports = router;