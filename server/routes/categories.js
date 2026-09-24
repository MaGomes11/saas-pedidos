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
async function listAll() {
  return db.all(
    `SELECT c.key, c.name, c.sort,
            (SELECT COUNT(*) FROM dishes d WHERE d.category = c.key) AS dish_count
     FROM categories c
     ORDER BY c.sort, c.key`
  );
}

async function getOne(key) {
  return db.get(
    `SELECT c.key, c.name, c.sort,
            (SELECT COUNT(*) FROM dishes d WHERE d.category = c.key) AS dish_count
     FROM categories c WHERE c.key = ?`,
    key
  );
}

// ---------------------------------------------------------------------------
// Listar (qualquer usuário autenticado — selects e filtros dependem disso)
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  res.json(await listAll());
});

// ---------------------------------------------------------------------------
// Criar categoria
// ---------------------------------------------------------------------------
router.post('/', requirePermission('categorias_gerenciar'), async (req, res) => {
  const { key, name } = req.body || {};
  const k = String(key || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(k)) {
    return res.status(400).json({ error: 'A chave deve começar com letra e usar apenas a-z, 0-9 ou _.' });
  }
  const nm = String(name || '').trim();
  if (!nm) return res.status(400).json({ error: 'O nome da categoria é obrigatório.' });
  const dup = await db.get('SELECT key FROM categories WHERE key = ?', k);
  if (dup) return res.status(409).json({ error: `Já existe uma categoria com a chave "${k}".` });

  const maxSort = await db.get('SELECT COALESCE(MAX(sort), 0) AS m FROM categories');
  await db.run('INSERT INTO categories (key, name, sort) VALUES (?, ?, ?)', k, nm, maxSort.m + 1);
  await audit('category', k, 'created', `Categoria "${nm}" criada.`, req.user.id);
  res.status(201).json(await getOne(k));
});

// ---------------------------------------------------------------------------
// Editar categoria (somente nome; a chave é referenciada por pratos)
// ---------------------------------------------------------------------------
router.patch('/:key', requirePermission('categorias_gerenciar'), async (req, res) => {
  const key = String(req.params.key || '');
  const cat = await getOne(key);
  if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.' });

  const { name } = req.body || {};
  if (name !== undefined) {
    const nm = String(name).trim();
    if (!nm) return res.status(400).json({ error: 'O nome da categoria é obrigatório.' });
    await db.run('UPDATE categories SET name = ? WHERE key = ?', nm, key);
    await audit('category', key, 'updated', `Categoria "${cat.name}" → "${nm}".`, req.user.id);
  }
  res.json(await getOne(key));
});

// ---------------------------------------------------------------------------
// Excluir categoria (bloqueado se houver pratos usando)
// ---------------------------------------------------------------------------
router.delete('/:key', requirePermission('categorias_gerenciar'), async (req, res) => {
  const key = String(req.params.key || '');
  const cat = await getOne(key);
  if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.' });
  if (cat.dish_count > 0) {
    return res.status(400).json({ error: `Não é possível excluir: ${cat.dish_count} prato(s) estão na categoria "${cat.name}".` });
  }
  await db.run('DELETE FROM categories WHERE key = ?', key);
  await audit('category', key, 'deleted', `Categoria "${cat.name}" excluída.`, req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Reordenar (▲▼): troca a posição com o vizinho.
// ---------------------------------------------------------------------------
router.post('/:key/move', requirePermission('categorias_gerenciar'), async (req, res) => {
  const key = String(req.params.key || '');
  const dir = parseInt(req.body?.dir, 10);
  if (dir !== -1 && dir !== 1) return res.status(400).json({ error: 'Informe dir = -1 ou 1.' });
  const cat = await getOne(key);
  if (!cat) return res.status(404).json({ error: 'Categoria não encontrada.' });

  const list = await db.all('SELECT key, sort FROM categories ORDER BY sort, key');
  const idx = list.findIndex((c) => c.key === key);
  const target = list[idx + dir];
  if (!target) {
    return res.status(400).json({ error: dir === -1 ? 'Esta categoria já está no início da ordem.' : 'Esta categoria já está no fim da ordem.' });
  }

  await db.tx(async () => {
    await db.run('UPDATE categories SET sort = ? WHERE key = ?', target.sort, key);
    await db.run('UPDATE categories SET sort = ? WHERE key = ?', cat.sort, target.key);
  });
  await audit('category', key, 'moved', `Categoria "${cat.name}" reposicionada.`, req.user.id);
  res.json(await listAll());
});

module.exports = router;