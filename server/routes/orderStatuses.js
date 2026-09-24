'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission, PERMISSION_LABELS } = require('../auth');
const { audit } = require('../audit');
const { nowIso, toInt } = require('../util');

const router = express.Router();
router.use(requireAuth);

const COLORS = ['primary', 'warn', 'ok', 'muted', 'danger'];

async function listAll() {
  return db.all('SELECT * FROM order_statuses ORDER BY sort, id');
}

async function getOne(id) {
  return db.get('SELECT * FROM order_statuses WHERE id = ?', id);
}

// ---------------------------------------------------------------------------
// Listar (qualquer usuário autenticado — badges e filtros dependem disso)
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  res.json(await listAll());
});

// ---------------------------------------------------------------------------
// Criar status
// ---------------------------------------------------------------------------
router.post('/', requirePermission('statuses_gerenciar'), async (req, res) => {
  const { key, label, color = 'primary', advance_perm = '', active = 1 } = req.body || {};
  const k = String(key || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(k)) {
    return res.status(400).json({ error: 'A chave deve começar com letra e usar apenas a-z, 0-9 ou _.' });
  }
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'O nome do status é obrigatório.' });
  if (!COLORS.includes(color)) return res.status(400).json({ error: 'Cor inválida.' });
  if (advance_perm && !PERMISSION_LABELS[advance_perm]) return res.status(400).json({ error: 'Permissão inválida.' });
  const dup = await db.get('SELECT id FROM order_statuses WHERE key = ?', k);
  if (dup) return res.status(409).json({ error: `Já existe um status com a chave "${k}".` });

  const maxSort = await db.get("SELECT COALESCE(MAX(sort), 0) AS m FROM order_statuses WHERE key != 'cancelado'");
  const info = await db.run(
    'INSERT INTO order_statuses (key, label, color, sort, advance_perm, active, is_system, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    k, String(label).trim(), color, maxSort.m + 1, advance_perm, active ? 1 : 0, nowIso()
  );
  await audit('order_status', info.lastInsertRowid, 'created', `Status "${k}" criado (${label}).`, req.user.id);
  res.status(201).json(await getOne(info.lastInsertRowid));
});

// ---------------------------------------------------------------------------
// Editar status (label, cor, permissão p/ avançar, ativo)
// ---------------------------------------------------------------------------
router.patch('/:id', requirePermission('statuses_gerenciar'), async (req, res) => {
  const id = toInt(req.params.id);
  const st = await getOne(id);
  if (!st) return res.status(404).json({ error: 'Status não encontrado.' });

  const { label, color, advance_perm, active } = req.body || {};
  if (label !== undefined && !String(label).trim()) {
    return res.status(400).json({ error: 'O nome do status não pode ficar vazio.' });
  }
  if (color !== undefined && !COLORS.includes(color)) return res.status(400).json({ error: 'Cor inválida.' });
  if (advance_perm !== undefined && advance_perm && !PERMISSION_LABELS[advance_perm]) {
    return res.status(400).json({ error: 'Permissão inválida.' });
  }
  if (active !== undefined && !active && st.is_system) {
    return res.status(400).json({ error: 'Status de sistema não pode ser inativado.' });
  }

  await db.run(
    'UPDATE order_statuses SET label = ?, color = ?, advance_perm = ?, active = ? WHERE id = ?',
    label !== undefined ? String(label).trim() : st.label,
    color !== undefined ? color : st.color,
    advance_perm !== undefined ? advance_perm : st.advance_perm,
    active !== undefined ? (active ? 1 : 0) : st.active,
    id
  );
  await audit('order_status', id, 'updated', `Status "${st.key}" atualizado.`, req.user.id);
  res.json(await getOne(id));
});

// ---------------------------------------------------------------------------
// Excluir status (bloqueado para sistema e para status em uso)
// ---------------------------------------------------------------------------
router.delete('/:id', requirePermission('statuses_gerenciar'), async (req, res) => {
  const id = toInt(req.params.id);
  const st = await getOne(id);
  if (!st) return res.status(404).json({ error: 'Status não encontrado.' });
  if (st.is_system) {
    return res.status(400).json({ error: 'Este status é de sistema (novo/cancelado) e não pode ser excluído.' });
  }
  const inUse = await db.get('SELECT COUNT(*) AS c FROM orders WHERE status = ?', st.key);
  if (inUse.c > 0) {
    return res.status(400).json({ error: `Não é possível excluir: ${inUse.c} pedido(s) estão com o status "${st.label}".` });
  }
  await db.run('DELETE FROM order_statuses WHERE id = ?', id);
  await audit('order_status', id, 'deleted', `Status "${st.key}" excluído.`, req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Reordenar (▲▼): troca a posição com o vizinho. Sistema (novo/cancelado) fixo.
// ---------------------------------------------------------------------------
router.post('/:id/move', requirePermission('statuses_gerenciar'), async (req, res) => {
  const id = toInt(req.params.id);
  const dir = parseInt(req.body?.dir, 10);
  if (dir !== -1 && dir !== 1) return res.status(400).json({ error: 'Informe dir = -1 ou 1.' });
  const st = await getOne(id);
  if (!st) return res.status(404).json({ error: 'Status não encontrado.' });
  if (st.is_system) return res.status(400).json({ error: 'Status de sistema não pode ser reordenado.' });

  const list = await db.all('SELECT * FROM order_statuses WHERE is_system = 0 ORDER BY sort, id');
  const idx = list.findIndex((s) => s.id === id);
  const target = list[idx + dir];
  if (!target) {
    return res.status(400).json({ error: dir === -1 ? 'Este status já está no início da ordem.' : 'Este status já está no fim da ordem.' });
  }

  await db.tx(async () => {
    await db.run('UPDATE order_statuses SET sort = ? WHERE id = ?', target.sort, st.id);
    await db.run('UPDATE order_statuses SET sort = ? WHERE id = ?', st.sort, target.id);
  });
  await audit('order_status', id, 'moved', `Status "${st.key}" reposicionado.`, req.user.id);
  res.json(await listAll());
});

module.exports = router;