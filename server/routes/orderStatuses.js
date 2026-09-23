'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission, PERMISSION_LABELS } = require('../auth');
const { audit } = require('../audit');
const { nowIso, toInt } = require('../util');

const router = express.Router();
router.use(requireAuth);

const COLORS = ['primary', 'warn', 'ok', 'muted', 'danger'];

function listAll() {
  return db.prepare('SELECT * FROM order_statuses ORDER BY sort, id').all();
}

function getOne(id) {
  return db.prepare('SELECT * FROM order_statuses WHERE id = ?').get(id);
}

// ---------------------------------------------------------------------------
// Listar (qualquer usuário autenticado — badges e filtros dependem disso)
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  res.json(listAll());
});

// ---------------------------------------------------------------------------
// Criar status
// ---------------------------------------------------------------------------
router.post('/', requirePermission('statuses_gerenciar'), (req, res) => {
  const { key, label, color = 'primary', advance_perm = '', active = 1 } = req.body || {};
  const k = String(key || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(k)) {
    return res.status(400).json({ error: 'A chave deve começar com letra e usar apenas a-z, 0-9 ou _.' });
  }
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'O nome do status é obrigatório.' });
  if (!COLORS.includes(color)) return res.status(400).json({ error: 'Cor inválida.' });
  if (advance_perm && !PERMISSION_LABELS[advance_perm]) return res.status(400).json({ error: 'Permissão inválida.' });
  const dup = db.prepare('SELECT id FROM order_statuses WHERE key = ?').get(k);
  if (dup) return res.status(409).json({ error: `Já existe um status com a chave "${k}".` });

  const maxSort = db.prepare("SELECT COALESCE(MAX(sort), 0) AS m FROM order_statuses WHERE key != 'cancelado'").get().m;
  const info = db.prepare(
    'INSERT INTO order_statuses (key, label, color, sort, advance_perm, active, is_system, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(k, String(label).trim(), color, maxSort + 1, advance_perm, active ? 1 : 0, nowIso());
  audit('order_status', info.lastInsertRowid, 'created', `Status "${k}" criado (${label}).`, req.user.id);
  res.status(201).json(getOne(info.lastInsertRowid));
});

// ---------------------------------------------------------------------------
// Editar status (label, cor, permissão p/ avançar, ativo)
// ---------------------------------------------------------------------------
router.patch('/:id', requirePermission('statuses_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const st = getOne(id);
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

  db.prepare(
    'UPDATE order_statuses SET label = ?, color = ?, advance_perm = ?, active = ? WHERE id = ?'
  ).run(
    label !== undefined ? String(label).trim() : st.label,
    color !== undefined ? color : st.color,
    advance_perm !== undefined ? advance_perm : st.advance_perm,
    active !== undefined ? (active ? 1 : 0) : st.active,
    id
  );
  audit('order_status', id, 'updated', `Status "${st.key}" atualizado.`, req.user.id);
  res.json(getOne(id));
});

// ---------------------------------------------------------------------------
// Excluir status (bloqueado para sistema e para status em uso)
// ---------------------------------------------------------------------------
router.delete('/:id', requirePermission('statuses_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const st = getOne(id);
  if (!st) return res.status(404).json({ error: 'Status não encontrado.' });
  if (st.is_system) {
    return res.status(400).json({ error: 'Este status é de sistema (novo/cancelado) e não pode ser excluído.' });
  }
  const inUse = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE status = ?').get(st.key).c;
  if (inUse > 0) {
    return res.status(400).json({ error: `Não é possível excluir: ${inUse} pedido(s) estão com o status "${st.label}".` });
  }
  db.prepare('DELETE FROM order_statuses WHERE id = ?').run(id);
  audit('order_status', id, 'deleted', `Status "${st.key}" excluído.`, req.user.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Reordenar (▲▼): troca a posição com o vizinho. Sistema (novo/cancelado) fixo.
// ---------------------------------------------------------------------------
router.post('/:id/move', requirePermission('statuses_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const dir = parseInt(req.body?.dir, 10);
  if (dir !== -1 && dir !== 1) return res.status(400).json({ error: 'Informe dir = -1 ou 1.' });
  const st = getOne(id);
  if (!st) return res.status(404).json({ error: 'Status não encontrado.' });
  if (st.is_system) return res.status(400).json({ error: 'Status de sistema não pode ser reordenado.' });

  const list = db.prepare('SELECT * FROM order_statuses WHERE is_system = 0 ORDER BY sort, id').all();
  const idx = list.findIndex((s) => s.id === id);
  const target = list[idx + dir];
  if (!target) {
    return res.status(400).json({ error: dir === -1 ? 'Este status já está no início da ordem.' : 'Este status já está no fim da ordem.' });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE order_statuses SET sort = ? WHERE id = ?').run(target.sort, st.id);
    db.prepare('UPDATE order_statuses SET sort = ? WHERE id = ?').run(st.sort, target.id);
  });
  tx();
  audit('order_status', id, 'moved', `Status "${st.key}" reposicionado.`, req.user.id);
  res.json(listAll());
});

module.exports = router;