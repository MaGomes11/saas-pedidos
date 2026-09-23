'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { audit } = require('../audit');
const { nowIso, toInt } = require('../util');

const router = express.Router();
router.use(requireAuth);

function itemsOf(typeId) {
  return db.prepare(
    `SELECT d.id, d.name, d.description, d.category, d.active AS dish_active, dti.sort
     FROM dish_type_items dti JOIN dishes d ON d.id = dti.dish_id
     WHERE dti.dish_type_id = ? ORDER BY dti.sort, d.name`
  ).all(typeId);
}

// ---- Tipos de cardápio ----
router.get('/', (req, res) => {
  const { q, active, all } = req.query;
  let sql = 'SELECT * FROM dish_types WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
  if (active !== undefined && active !== '') { sql += ' AND active = ?'; params.push(active === '1' || active === 'true' ? 1 : 0); }
  if (all !== '1') { sql += ' AND active = 1'; }
  sql += ' ORDER BY name';
  const types = db.prepare(sql).all(...params).map((t) => {
    const c = db.prepare('SELECT COUNT(*) AS c FROM dish_type_items WHERE dish_type_id = ?').get(t.id).c;
    return { ...t, dish_count: c };
  });
  res.json(types);
});

router.get('/:id', (req, res) => {
  const type = db.prepare('SELECT * FROM dish_types WHERE id = ?').get(toInt(req.params.id));
  if (!type) return res.status(404).json({ error: 'Tipo de cardápio não encontrado.' });
  res.json({ ...type, dishes: itemsOf(type.id) });
});

router.post('/', requirePermission('cardapios_gerenciar'), (req, res) => {
  const { name, description = '', active = true, dishes = [] } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'O nome do cardápio é obrigatório.' });
  const dup = db.prepare('SELECT id FROM dish_types WHERE name = ?').get(String(name).trim());
  if (dup) return res.status(409).json({ error: 'Já existe um tipo de cardápio com este nome.' });
  const now = nowIso();
  const info = db.prepare(
    'INSERT INTO dish_types (name, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(String(name).trim(), String(description), active ? 1 : 0, now, now);
  const id = info.lastInsertRowid;
  const ins = db.prepare('INSERT OR IGNORE INTO dish_type_items (dish_type_id, dish_id, sort) VALUES (?, ?, ?)');
  (Array.isArray(dishes) ? dishes : []).forEach((d, i) => ins.run(id, toInt(d.dish_id ?? d), i));
  audit('dish_type', id, 'created', `Tipo de cardápio "${name}" criado.`, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM dish_types WHERE id = ?').get(id));
});

router.put('/:id', requirePermission('cardapios_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const type = db.prepare('SELECT * FROM dish_types WHERE id = ?').get(id);
  if (!type) return res.status(404).json({ error: 'Tipo de cardápio não encontrado.' });
  const { name, description, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'O nome não pode ficar vazio.' });
  if (name !== undefined && String(name).trim() !== type.name) {
    const dup = db.prepare('SELECT id FROM dish_types WHERE name = ? AND id != ?').get(String(name).trim(), id);
    if (dup) return res.status(409).json({ error: 'Já existe um tipo de cardápio com este nome.' });
  }
  db.prepare('UPDATE dish_types SET name = ?, description = ?, active = ?, updated_at = ? WHERE id = ?').run(
    name !== undefined ? String(name).trim() : type.name,
    description !== undefined ? String(description) : type.description,
    active !== undefined ? (active ? 1 : 0) : type.active,
    nowIso(),
    id
  );
  audit('dish_type', id, 'updated', `Tipo de cardápio "${type.name}" atualizado.`, req.user.id);
  res.json(db.prepare('SELECT * FROM dish_types WHERE id = ?').get(id));
});

// Substituir lista de pratos do cardápio (com ordenação)
router.put('/:id/items', requirePermission('cardapios_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const type = db.prepare('SELECT * FROM dish_types WHERE id = ?').get(id);
  if (!type) return res.status(404).json({ error: 'Tipo de cardápio não encontrado.' });
  const entries = Array.isArray(req.body.dishes) ? req.body.dishes : [];
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM dish_type_items WHERE dish_type_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO dish_type_items (dish_type_id, dish_id, sort) VALUES (?, ?, ?)');
    entries.forEach((e, i) => ins.run(id, toInt(e.dish_id ?? e), i));
  });
  tx();
  audit('dish_type', id, 'items', `Lista de pratos do cardápio "${type.name}" atualizada (${entries.length} pratos).`, req.user.id);
  res.json({ id, dishes: itemsOf(id) });
});

module.exports = router;