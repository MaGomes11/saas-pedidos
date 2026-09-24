'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { audit } = require('../audit');
const { nowIso, toInt } = require('../util');

const router = express.Router();
router.use(requireAuth);

async function itemsOf(typeId) {
  return db.all(
    `SELECT d.id, d.name, d.description, d.category, d.active AS dish_active, dti.sort
     FROM dish_type_items dti JOIN dishes d ON d.id = dti.dish_id
     WHERE dti.dish_type_id = ? ORDER BY dti.sort, d.name`,
    typeId
  );
}

// ---- Tipos de cardápio ----
router.get('/', async (req, res) => {
  const { q, active, all } = req.query;
  let sql = 'SELECT * FROM dish_types WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
  if (active !== undefined && active !== '') { sql += ' AND active = ?'; params.push(active === '1' || active === 'true' ? 1 : 0); }
  if (all !== '1') { sql += ' AND active = 1'; }
  sql += ' ORDER BY name';
  const rows = await db.all(sql, ...params);
  const types = [];
  for (const t of rows) {
    const c = await db.get('SELECT COUNT(*) AS c FROM dish_type_items WHERE dish_type_id = ?', t.id);
    types.push({ ...t, dish_count: c.c });
  }
  res.json(types);
});

router.get('/:id', async (req, res) => {
  const type = await db.get('SELECT * FROM dish_types WHERE id = ?', toInt(req.params.id));
  if (!type) return res.status(404).json({ error: 'Tipo de cardápio não encontrado.' });
  res.json({ ...type, dishes: await itemsOf(type.id) });
});

router.post('/', requirePermission('cardapios_gerenciar'), async (req, res) => {
  const { name, description = '', active = true, dishes = [] } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'O nome do cardápio é obrigatório.' });
  const dup = await db.get('SELECT id FROM dish_types WHERE name = ?', String(name).trim());
  if (dup) return res.status(409).json({ error: 'Já existe um tipo de cardápio com este nome.' });
  const now = nowIso();
  const info = await db.run(
    'INSERT INTO dish_types (name, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    String(name).trim(), String(description), active ? 1 : 0, now, now
  );
  const id = info.lastInsertRowid;
  const list = Array.isArray(dishes) ? dishes : [];
  for (let i = 0; i < list.length; i++) {
    await db.run('INSERT OR IGNORE INTO dish_type_items (dish_type_id, dish_id, sort) VALUES (?, ?, ?)', id, toInt(list[i].dish_id ?? list[i]), i);
  }
  await audit('dish_type', id, 'created', `Tipo de cardápio "${name}" criado.`, req.user.id);
  res.status(201).json(await db.get('SELECT * FROM dish_types WHERE id = ?', id));
});

router.put('/:id', requirePermission('cardapios_gerenciar'), async (req, res) => {
  const id = toInt(req.params.id);
  const type = await db.get('SELECT * FROM dish_types WHERE id = ?', id);
  if (!type) return res.status(404).json({ error: 'Tipo de cardápio não encontrado.' });
  const { name, description, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'O nome não pode ficar vazio.' });
  if (name !== undefined && String(name).trim() !== type.name) {
    const dup = await db.get('SELECT id FROM dish_types WHERE name = ? AND id != ?', String(name).trim(), id);
    if (dup) return res.status(409).json({ error: 'Já existe um tipo de cardápio com este nome.' });
  }
  await db.run('UPDATE dish_types SET name = ?, description = ?, active = ?, updated_at = ? WHERE id = ?',
    name !== undefined ? String(name).trim() : type.name,
    description !== undefined ? String(description) : type.description,
    active !== undefined ? (active ? 1 : 0) : type.active,
    nowIso(),
    id
  );
  await audit('dish_type', id, 'updated', `Tipo de cardápio "${type.name}" atualizado.`, req.user.id);
  res.json(await db.get('SELECT * FROM dish_types WHERE id = ?', id));
});

// Substituir lista de pratos do cardápio (com ordenação)
router.put('/:id/items', requirePermission('cardapios_gerenciar'), async (req, res) => {
  const id = toInt(req.params.id);
  const type = await db.get('SELECT * FROM dish_types WHERE id = ?', id);
  if (!type) return res.status(404).json({ error: 'Tipo de cardápio não encontrado.' });
  const entries = Array.isArray(req.body.dishes) ? req.body.dishes : [];
  await db.tx(async () => {
    await db.run('DELETE FROM dish_type_items WHERE dish_type_id = ?', id);
    for (let i = 0; i < entries.length; i++) {
      await db.run('INSERT OR IGNORE INTO dish_type_items (dish_type_id, dish_id, sort) VALUES (?, ?, ?)', id, toInt(entries[i].dish_id ?? entries[i]), i);
    }
  });
  await audit('dish_type', id, 'items', `Lista de pratos do cardápio "${type.name}" atualizada (${entries.length} pratos).`, req.user.id);
  res.json({ id, dishes: await itemsOf(id) });
});

module.exports = router;