'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { toInt } = require('../util');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission('historico_visualizar'));

// Histórico/auditoria geral
router.get('/', (req, res) => {
  const { entity_type, entity_id, user, date_from, date_to, q, limit } = req.query;
  let sql = `SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1`;
  const params = [];
  if (entity_type) { sql += ' AND a.entity_type = ?'; params.push(entity_type); }
  if (entity_id) { sql += ' AND a.entity_id = ?'; params.push(toInt(entity_id)); }
  if (user) { sql += ' AND a.user_id = ?'; params.push(toInt(user)); }
  if (date_from) { sql += ' AND a.created_at >= ?'; params.push(`${date_from} 00:00:00`); }
  if (date_to) { sql += ' AND a.created_at <= ?'; params.push(`${date_to} 23:59:59`); }
  if (q) { sql += ' AND a.description LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY a.id DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Math.min(toInt(limit, 200), 1000)); }
  res.json(db.prepare(sql).all(...params));
});

// Histórico de pedidos (todos, com filtros)
router.get('/orders', (req, res) => {
  const { party_id, q, date_from, date_to, limit } = req.query;
  let sql = `SELECT oh.*, u.name AS user_name, o.code AS order_code, p.name AS party_name
             FROM order_history oh
             JOIN users u ON u.id = oh.user_id
             JOIN orders o ON o.id = oh.order_id
             JOIN parties p ON p.id = o.party_id
             WHERE 1=1`;
  const params = [];
  if (party_id) { sql += ' AND o.party_id = ?'; params.push(toInt(party_id)); }
  if (q) { sql += ' AND (o.code LIKE ? OR oh.description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (date_from) { sql += ' AND oh.created_at >= ?'; params.push(`${date_from} 00:00:00`); }
  if (date_to) { sql += ' AND oh.created_at <= ?'; params.push(`${date_to} 23:59:59`); }
  sql += ' ORDER BY oh.id DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Math.min(toInt(limit, 200), 1000)); }
  res.json(db.prepare(sql).all(...params));
});

module.exports = router;