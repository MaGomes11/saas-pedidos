'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { audit } = require('../audit');
const { nowIso, toInt } = require('../util');

const router = express.Router();
router.use(requireAuth);

router.get('/categories', (req, res) => {
  const cats = db.prepare('SELECT key, name FROM categories ORDER BY sort').all();
  res.json(cats);
});

// ---- Ingredientes ----
router.get('/', (req, res) => {
  const { q, active, all } = req.query;
  let sql = 'SELECT * FROM ingredients WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
  if (active !== undefined) { sql += ' AND active = ?'; params.push(active === '1' || active === 'true' ? 1 : 0); }
  if (all !== '1') { sql += ' AND active = 1'; }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

router.post('/', requirePermission('ingredientes_gerenciar'), (req, res) => {
  const { name, description = '', can_remove = true, can_add = true, notes = '', active = true } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'O nome do ingrediente é obrigatório.' });
  }
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO ingredients (name, description, can_remove, can_add, notes, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(String(name).trim(), String(description), can_remove ? 1 : 0, can_add ? 1 : 0, String(notes), active ? 1 : 0, now, now);
  const ing = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(info.lastInsertRowid);
  audit('ingredient', ing.id, 'created', `Ingrediente "${ing.name}" criado.`, req.user.id);
  res.status(201).json(ing);
});

router.put('/:id', requirePermission('ingredientes_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const ing = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
  if (!ing) return res.status(404).json({ error: 'Ingrediente não encontrado.' });
  const { name, description, can_remove, can_add, notes, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'O nome do ingrediente não pode ficar vazio.' });
  }
  db.prepare(
    `UPDATE ingredients SET name = ?, description = ?, can_remove = ?, can_add = ?, notes = ?, active = ?, updated_at = ? WHERE id = ?`
  ).run(
    name !== undefined ? String(name).trim() : ing.name,
    description !== undefined ? String(description) : ing.description,
    can_remove !== undefined ? (can_remove ? 1 : 0) : ing.can_remove,
    can_add !== undefined ? (can_add ? 1 : 0) : ing.can_add,
    notes !== undefined ? String(notes) : ing.notes,
    active !== undefined ? (active ? 1 : 0) : ing.active,
    nowIso(),
    id
  );
  const updated = db.prepare('SELECT * FROM ingredients WHERE id = ?').get(id);
  audit('ingredient', id, 'updated', `Ingrediente "${updated.name}" atualizado.`, req.user.id);
  res.json(updated);
});

module.exports = router;