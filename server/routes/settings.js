'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { audit } = require('../audit');
const { nowIso } = require('../util');

const router = express.Router();

// Chaves editáveis pela tela de configurações.
const EDITABLE_KEYS = [
  'system_name',
  'company_name',
  'company_phone',
  'company_email',
  'company_address',
  'company_cnpj',
];

// Limites de tamanho por chave (nome pequeno, endereço maior).
const MAX_LEN = { system_name: 60, company_name: 120, company_cnpj: 20, company_email: 120, company_phone: 30, company_address: 300 };

function getSettings(keys) {
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).all(...keys);
  const out = {};
  for (const k of keys) out[k] = '';
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ---------------------------------------------------------------------------
// GET /public — branding público (sem autenticação): usado na tela de login.
// ---------------------------------------------------------------------------
router.get('/public', (req, res) => {
  const s = getSettings(['system_name', 'company_name']);
  res.json({ system_name: s.system_name || 'Saas Pedidos', company_name: s.company_name });
});

// ---------------------------------------------------------------------------
// Demais rotas exigem autenticação.
// ---------------------------------------------------------------------------
router.use(requireAuth);

// GET / — todas as configurações (qualquer usuário autenticado)
router.get('/', (req, res) => {
  res.json(getSettings(EDITABLE_KEYS));
});

// PUT / — gravar configurações (somente admin com configuracoes_gerenciar)
router.put('/', requirePermission('configuracoes_gerenciar'), (req, res) => {
  const body = req.body || {};
  const now = nowIso();
  const tx = db.transaction(() => {
    for (const key of EDITABLE_KEYS) {
      if (body[key] === undefined) continue;
      const val = String(body[key]).trim();
      if (key === 'system_name' && !val) {
        throw Object.assign(new Error('O nome do sistema não pode ficar vazio.'), { status: 400 });
      }
      if (val.length > (MAX_LEN[key] || 120)) {
        throw Object.assign(new Error(`O campo "${key}" excede o limite de ${MAX_LEN[key] || 120} caracteres.`), { status: 400 });
      }
      db.prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).run(key, val, now);
    }
  });
  try {
    tx();
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
  audit('settings', 'company', 'updated', 'Configurações da empresa atualizadas.', req.user.id);
  res.json(getSettings(EDITABLE_KEYS));
});

module.exports = router;