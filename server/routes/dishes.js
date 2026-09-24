'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { audit } = require('../audit');
const { nowIso, toInt } = require('../util');

const router = express.Router();
router.use(requireAuth);

async function withComposition(dish) {
  if (!dish) return null;
  const comp = await db.all(
    `SELECT di.is_default, di.can_remove, di.can_add, di.sort, i.id, i.name, i.description, i.notes, i.active AS ingredient_active
     FROM dish_ingredients di JOIN ingredients i ON i.id = di.ingredient_id
     WHERE di.dish_id = ? ORDER BY di.sort, i.name`,
    dish.id
  );
  return { ...dish, composition: comp };
}

// ---- Pratos ----
router.get('/', async (req, res) => {
  const { q, category, active, all } = req.query;
  let sql = 'SELECT * FROM dishes WHERE 1=1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (active !== undefined && active !== '') { sql += ' AND active = ?'; params.push(active === '1' || active === 'true' ? 1 : 0); }
  if (all !== '1') { sql += ' AND active = 1'; }
  sql += ' ORDER BY category, name';
  const dishes = await db.all(sql, ...params);
  const out = [];
  for (const d of dishes) out.push(await withComposition(d));
  res.json(out);
});

router.get('/:id', async (req, res) => {
  const dish = await db.get('SELECT * FROM dishes WHERE id = ?', toInt(req.params.id));
  if (!dish) return res.status(404).json({ error: 'Prato não encontrado.' });
  res.json(await withComposition(dish));
});

router.post('/', requirePermission('pratos_gerenciar'), async (req, res) => {
  const { name, description = '', category, prep_notes = '', image_data = null, active = true } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'O nome do prato é obrigatório.' });
  if (!category) return res.status(400).json({ error: 'Selecione a categoria do prato.' });
  const cat = await db.get('SELECT key FROM categories WHERE key = ?', category);
  if (!cat) return res.status(400).json({ error: 'Categoria inválida.' });
  const now = nowIso();
  const info = await db.run(
    `INSERT INTO dishes (name, description, category, prep_notes, image_data, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    String(name).trim(), String(description), category, String(prep_notes), image_data || null, active ? 1 : 0, now, now
  );
  const dish = await db.get('SELECT * FROM dishes WHERE id = ?', info.lastInsertRowid);
  await audit('dish', dish.id, 'created', `Prato "${dish.name}" criado (categoria: ${category}).`, req.user.id);
  res.status(201).json(await withComposition(dish));
});

router.put('/:id', requirePermission('pratos_gerenciar'), async (req, res) => {
  const id = toInt(req.params.id);
  const dish = await db.get('SELECT * FROM dishes WHERE id = ?', id);
  if (!dish) return res.status(404).json({ error: 'Prato não encontrado.' });
  const { name, description, category, prep_notes, image_data, active } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'O nome do prato não pode ficar vazio.' });
  if (category !== undefined) {
    const cat = await db.get('SELECT key FROM categories WHERE key = ?', category);
    if (!cat) return res.status(400).json({ error: 'Categoria inválida.' });
  }
  await db.run(
    `UPDATE dishes SET name = ?, description = ?, category = ?, prep_notes = ?, image_data = ?, active = ?, updated_at = ? WHERE id = ?`,
    name !== undefined ? String(name).trim() : dish.name,
    description !== undefined ? String(description) : dish.description,
    category !== undefined ? category : dish.category,
    prep_notes !== undefined ? String(prep_notes) : dish.prep_notes,
    image_data !== undefined ? (image_data || null) : dish.image_data,
    active !== undefined ? (active ? 1 : 0) : dish.active,
    nowIso(),
    id
  );
  const updated = await withComposition(await db.get('SELECT * FROM dishes WHERE id = ?', id));
  await audit('dish', id, 'updated', `Prato "${updated.name}" atualizado.`, req.user.id);
  res.json(updated);
});

// ---- Composição (ingredientes do prato) ----
router.get('/:id/composition', async (req, res) => {
  const dish = await db.get('SELECT * FROM dishes WHERE id = ?', toInt(req.params.id));
  if (!dish) return res.status(404).json({ error: 'Prato não encontrado.' });
  res.json(await withComposition(dish));
});

router.put('/:id/composition', requirePermission('pratos_gerenciar'), async (req, res) => {
  const id = toInt(req.params.id);
  const dish = await db.get('SELECT * FROM dishes WHERE id = ?', id);
  if (!dish) return res.status(404).json({ error: 'Prato não encontrado.' });
  const entries = Array.isArray(req.body.ingredients) ? req.body.ingredients : [];
  await db.tx(async () => {
    await db.run('DELETE FROM dish_ingredients WHERE dish_id = ?', id);
    for (let idx = 0; idx < entries.length; idx++) {
      const e = entries[idx];
      await db.run(
        'INSERT INTO dish_ingredients (dish_id, ingredient_id, is_default, can_remove, can_add, sort) VALUES (?, ?, ?, ?, ?, ?)',
        id, toInt(e.id), e.is_default ? 1 : 0, e.can_remove ? 1 : 0, e.can_add ? 1 : 0, toInt(e.sort, idx)
      );
    }
  });
  await audit('dish', id, 'composition', `Composição do prato "${dish.name}" atualizada (${entries.length} ingredientes).`, req.user.id);
  res.json(await withComposition(await db.get('SELECT * FROM dishes WHERE id = ?', id)));
});

module.exports = router;