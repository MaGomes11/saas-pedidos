'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { audit } = require('../audit');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function listAll() {
  return db.prepare(
    `SELECT c.key, c.name, c.sort,
            (SELECT COUNT(*) FROM dishes d WHERE d.category = c.key) AS dish_count
     FROM categories c
     ORDER BY c.sort, c.key`
  ).all();
}

function getOne(key) {
  return db.prepare(
    `SELECT c.key, c.name, c.sort,
            (SELECT COUNT(*) FROM dishes d WHERE d.category = c.key) AS dish_count
     FROM categories c WHERE c.key = ?`
  ).get(key);
}

// ---------------------------------------------------------------------------
// Listar (qualquer usuário autenticado — selects e filtros dependem disso)
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  res.json(listAll());
});

// ---------------------------------------------------------------------------
// Criar categoria
// ---------------------------------------------------------------------------
router.post('/', requirePermission('categorias_gerenciar'), (req, res) => {
  const { key, name } = req.body || {};
  const k = String(key || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(k)) {
    return res.status(400).json({ error: 'A chave deve começar com letra e usar apenas a-z, 0-9 ou _.' });
  }
  const nm = String(name || '').trim();
  if (!nm) return res.status(400).json({ error: 'O nome da categoria é obrigatório.' });
  const dup = db.prepare('SELECT key FROM categories WHERE key = ?').get(k);
  if (dup) return res.status(409).json({ error: `Já existe uma categoria com a chave "${k}".` });

  const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM categories').get().m;
  db.prepare('INSERT INTO categories (key, name, sort) VALUES (?, ?, ?)').run(k, nm, maxSort + 1);
  audit('category', k, 'created', `Categoria "${nm}" criada.`, req.user.id);
  res.status(201).json(getOne(k));
});

// ---------------------------------------------------------------------------
// Editar categoria (somente nome; a chave é referenciada por pratos)
// ---------------------------------------------------------------------------
router.patch('/:key', requirePermission('categorias_gerenciar'), (req, res) => {
  const key = String(req.params.key || '');
  const cat = getOne(key);
  if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.' });

  const { name } = req.body || {};
  if (name !== undefined) {
    const nm = String(name).trim();
    if (!nm) return res.status(400).json({ error: 'O nome da categoria é obrigatório.' });
    db.prepare('UPDATE categories SET name = ? WHERE key = ?').run(nm, key);
    audit('category', key, 'updated', `Categoria "${cat.name}" → "${nm}".`, req.user.id);
  }
  res.json(getOne(key));
});

// ---------------------------------------------------------------------------
// Excluir categoria (bloqueado se houver pratos usando)
// ---------------------------------------------------------------------------
router.delete('/:key', requirePermission('categorias_gerenciar'), (req, res) => {
  const key = String(req.params.key || '');
  const cat = getOne(key);
  if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.' });
  if (cat.dish_count > 0) {
    return res.status(400).json({ error: `Não é possível excluir: ${cat.dish_count} prato(s) estão na categoria "${cat.name}".` });
  }
  db.prepare('DELETE FROM categories WHERE key = ?').run(key);
  audit('category', key, 'deleted', `Categoria "${cat.name}" excluída.`, req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Reordenar (▲▼): troca a posição com o vizinho.
// ---------------------------------------------------------------------------
router.post('/:key/move', requirePermission('categorias_gerenciar'), (req, res) => {
  const key = String(req.params.key || '');
  const dir = parseInt(req.body?.dir, 10);
  if (dir !== -1 && dir !== 1) return res.status(400).json({ error: 'Informe dir = -1 ou 1.' });
  const cat = getOne(key);
  if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.' });

  const list = db.prepare('SELECT key, sort FROM categories ORDER BY sort, key').all();
  const idx = list.findIndex((c) => c.key === key);
  const target = list[idx + dir];
  if (!target) {
    return res.status(400).json({ error: dir === -1 ? 'Esta categoria já está no início da ordem.' : 'Esta categoria já está no fim da ordem.' });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE categories SET sort = ? WHERE key = ?').run(target.sort, key);
    db.prepare('UPDATE categories SET sort = ? WHERE key = ?').run(cat.sort, target.key);
  });
  tx();
  audit('category', key, 'moved', `Categoria "${cat.name}" reposicionada.`, req.user.id);
  res.json(listAll());
});

module.exports = router;