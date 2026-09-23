'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { audit } = require('../audit');
const { nowIso, toInt, stripFinancial } = require('../util');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function partyMenuRows(partyId, onlyAvailable = false) {
  let sql = `SELECT pd.party_id, pd.event_notes, pd.sort, pd.available, pd.source,
                    d.id AS dish_id, d.name, d.description, d.category, d.prep_notes, d.image_data, d.active AS dish_active
             FROM party_dishes pd JOIN dishes d ON d.id = pd.dish_id
             WHERE pd.party_id = ?`;
  if (onlyAvailable) sql += ' AND pd.available = 1 AND d.active = 1';
  sql += ' ORDER BY pd.sort, d.name';
  return db.prepare(sql).all(partyId);
}

/** Status + fluxo ativo (a ordem define o próximo status). */
function statusMeta() {
  const statuses = db.prepare('SELECT * FROM order_statuses ORDER BY sort, id').all();
  const flow = statuses
    .filter((s) => s.key !== 'cancelado' && s.active === 1)
    .sort((a, b) => a.sort - b.sort || a.id - b.id);
  return { statuses, flow };
}

function tablesOf(partyId) {
  const { flow } = statusMeta();
  const terminal = flow.length ? flow[flow.length - 1].key : null;
  const excl = ['cancelado'];
  if (terminal) excl.push(terminal);
  const tables = db.prepare(
    `SELECT pt.*,
       (SELECT COUNT(*) FROM orders o WHERE o.table_id = pt.id AND o.status NOT IN ('cancelado')) AS order_count,
       (SELECT o.code FROM orders o WHERE o.table_id = pt.id AND o.status NOT IN (${excl.map(() => '?').join(',')}) ORDER BY o.id DESC LIMIT 1) AS last_order_code
     FROM party_tables pt WHERE pt.party_id = ? ORDER BY pt.label`
  ).all(...excl, partyId);
  return tables;
}

/** Sincroniza o cardápio da festa a partir do tipo de cardápio vinculado. */
function syncPartyMenu(partyId) {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(partyId);
  if (!party || !party.dish_type_id) return 0;
  const items = db.prepare(
    'SELECT dish_id FROM dish_type_items WHERE dish_type_id = ? ORDER BY sort'
  ).all(party.dish_type_id);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO party_dishes (party_id, dish_id, event_notes, sort, available, source)
     VALUES (?, ?, '', ?, 1, 'cardapio')`
  );
  items.forEach((it, i) => ins.run(partyId, it.dish_id, i));
  return items.length;
}

// ---------------------------------------------------------------------------
// Festas
// ---------------------------------------------------------------------------
router.get('/', (req, res) => {
  const { status, q, all } = req.query;
  let sql = 'SELECT * FROM parties WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (q) { sql += ' AND (name LIKE ? OR client_name LIKE ? OR location LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (all !== '1') { sql += " AND status IN ('planejada','ativa')"; }
  sql += ' ORDER BY date DESC, id DESC';
  const rows = db.prepare(sql).all(...params).map((p) => {
    const { flow } = statusMeta();
    const terminal = flow.length ? flow[flow.length - 1].key : null;
    const entregues = flow.length >= 2 ? flow[flow.length - 2].key : null;
    const abExcl = ['cancelado'];
    if (terminal) abExcl.push(terminal);
    const stats = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status NOT IN (${abExcl.map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS abertos,
              ${entregues ? 'SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS entregues' : '0 AS entregues'}
       FROM orders WHERE party_id = ?`
    ).get(...abExcl, ...(entregues ? [entregues] : []), p.id);
    const tableCount = db.prepare('SELECT COUNT(*) AS c FROM party_tables WHERE party_id = ?').get(p.id).c;
    const dt = p.dish_type_id ? db.prepare('SELECT name FROM dish_types WHERE id = ?').get(p.dish_type_id) : null;
    return { ...p, table_count: tableCount, dish_type_name: dt?.name || null, order_stats: stats };
  });
  res.json(stripFinancial(rows));
});

router.get('/:id', (req, res) => {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(toInt(req.params.id));
  if (!party) return res.status(404).json({ error: 'Festa não encontrada.' });
  const detail = {
    ...party,
    dish_type: party.dish_type_id ? db.prepare('SELECT id, name, description FROM dish_types WHERE id = ?').get(party.dish_type_id) : null,
    menu: partyMenuRows(party.id),
    tables: tablesOf(party.id),
    order_stats: db.prepare(
      `SELECT status, COUNT(*) AS qtd FROM orders WHERE party_id = ? GROUP BY status`
    ).all(party.id),
    dish_types_available: db.prepare('SELECT id, name FROM dish_types WHERE active = 1 ORDER BY name').all(),
  };
  res.json(stripFinancial(detail));
});

router.post('/', requirePermission('festas_gerenciar'), (req, res) => {
  const {
    name, client_name = '', date = null, start_time = '', end_time = '',
    location = '', table_count = 0, dish_type_id = null, status = 'planejada', notes = '',
  } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'O nome da festa é obrigatório.' });
  if (!date) return res.status(400).json({ error: 'A data da festa é obrigatória.' });
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO parties (name, client_name, date, start_time, end_time, location, table_count, dish_type_id, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(name).trim(), String(client_name), date, String(start_time), String(end_time),
    String(location), toInt(table_count), dish_type_id ? toInt(dish_type_id) : null,
    status || 'planejada', String(notes), now, now
  );
  const id = info.lastInsertRowid;
  syncPartyMenu(id);
  audit('party', id, 'created', `Festa "${name}" criada.`, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM parties WHERE id = ?').get(id));
});

router.put('/:id', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
  if (!party) return res.status(404).json({ error: 'Festa não encontrada.' });
  const {
    name, client_name, date, start_time, end_time, location, table_count,
    dish_type_id, status, notes,
  } = req.body || {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'O nome da festa não pode ficar vazio.' });
  if (date !== undefined && !date) return res.status(400).json({ error: 'A data da festa é obrigatória.' });
  if (dish_type_id !== undefined && dish_type_id) {
    const dt = db.prepare('SELECT id FROM dish_types WHERE id = ? AND active = 1').get(toInt(dish_type_id));
    if (!dt) return res.status(400).json({ error: 'O tipo de cardápio vinculado está inativo ou não existe.' });
  }
  const allowed = ['planejada', 'ativa', 'encerrada', 'cancelada'];
  if (status !== undefined && !allowed.includes(status)) return res.status(400).json({ error: 'Status inválido.' });

  db.prepare(
    `UPDATE parties SET name = ?, client_name = ?, date = ?, start_time = ?, end_time = ?, location = ?,
       table_count = ?, dish_type_id = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`
  ).run(
    name !== undefined ? String(name).trim() : party.name,
    client_name !== undefined ? String(client_name) : party.client_name,
    date !== undefined ? date : party.date,
    start_time !== undefined ? String(start_time) : party.start_time,
    end_time !== undefined ? String(end_time) : party.end_time,
    location !== undefined ? String(location) : party.location,
    table_count !== undefined ? toInt(table_count) : party.table_count,
    dish_type_id !== undefined ? (dish_type_id ? toInt(dish_type_id) : null) : party.dish_type_id,
    status !== undefined ? status : party.status,
    notes !== undefined ? String(notes) : party.notes,
    nowIso(),
    id
  );
  if (dish_type_id !== undefined) syncPartyMenu(id);
  const updated = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
  audit('party', id, 'updated', `Festa "${updated.name}" atualizada (status: ${updated.status}).`, req.user.id);
  res.json(updated);
});

// Mudança de status da festa (encerrar, cancelar...)
router.put('/:id/status', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
  if (!party) return res.status(404).json({ error: 'Festa não encontrada.' });
  const { status } = req.body || {};
  const allowed = ['planejada', 'ativa', 'encerrada', 'cancelada'];
  if (!status || !allowed.includes(status)) return res.status(400).json({ error: 'Status inválido.' });
  db.prepare('UPDATE parties SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  audit('party', id, 'status', `Festa "${party.name}" alterada para "${status}".`, req.user.id);
  res.json(db.prepare('SELECT * FROM parties WHERE id = ?').get(id));
});

// ---------------------------------------------------------------------------
// Cardápio da festa
// ---------------------------------------------------------------------------
// Lista de pratos disponíveis para pedidos (usada no lançamento)
router.get('/:id/menu', (req, res) => {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(toInt(req.params.id));
  if (!party) return res.status(404).json({ error: 'Festa não encontrada.' });
  res.json(stripFinancial({
    party,
    menu: partyMenuRows(party.id, true),
    menu_all: partyMenuRows(party.id),
  }));
});

// Vincular pratos existentes à festa
router.put('/:id/dishes', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
  if (!party) return res.status(404).json({ error: 'Festa não encontrada.' });
  const dishIds = Array.isArray(req.body.dishIds) ? req.body.dishIds.map((d) => toInt(d)) : [];
  const max = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM party_dishes WHERE party_id = ?').get(id).m;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO party_dishes (party_id, dish_id, event_notes, sort, available, source)
     VALUES (?, ?, '', ?, 1, 'evento_exclusivo')`
  );
  let n = 0;
  dishIds.forEach((did, i) => {
    const d = db.prepare('SELECT id FROM dishes WHERE id = ? AND active = 1').get(did);
    if (d) { ins.run(id, did, max + i + 1); n++; }
  });
  audit('party_dish', id, 'linked', `${n} prato(s) vinculado(s) à festa "${party.name}".`, req.user.id);
  res.json({ linked: n, menu: partyMenuRows(id) });
});

// Criar rapidamente prato exclusivo da festa + vincular
router.post('/:id/dishes', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
  if (!party) return res.status(404).json({ error: 'Festa não encontrada.' });
  const { name, description = '', category, prep_notes = '', event_notes = '', available = true } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Informe o nome do prato exclusivo.' });
  if (!category) return res.status(400).json({ error: 'Selecione a categoria.' });
  const now = nowIso();
  const info = db.prepare(
    'INSERT INTO dishes (name, description, category, prep_notes, image_data, active, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 1, ?, ?)'
  ).run(String(name).trim(), String(description), category, String(prep_notes), now, now);
  const dishId = info.lastInsertRowid;
  const max = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM party_dishes WHERE party_id = ?').get(id).m;
  db.prepare(
    `INSERT OR IGNORE INTO party_dishes (party_id, dish_id, event_notes, sort, available, source)
     VALUES (?, ?, ?, ?, ?, 'evento_exclusivo')`
  ).run(id, dishId, String(event_notes), max + 1, available ? 1 : 0);
  audit('party_dish', id, 'created', `Prato exclusivo "${name}" adicionado à festa "${party.name}".`, req.user.id);
  res.status(201).json({ dish_id: dishId, menu: partyMenuRows(id) });
});

// Atualizar item do cardápio da festa (observação, disponível, ordem)
router.patch('/:partyId/dishes/:dishId', requirePermission('festas_gerenciar'), (req, res) => {
  const partyId = toInt(req.params.partyId);
  const dishId = toInt(req.params.dishId);
  const row = db.prepare('SELECT * FROM party_dishes WHERE party_id = ? AND dish_id = ?').get(partyId, dishId);
  if (!row) return res.status(404).json({ error: 'Prato não está no cardápio desta festa.' });
  const { event_notes, available, sort } = req.body || {};
  db.prepare('UPDATE party_dishes SET event_notes = ?, available = ?, sort = ? WHERE party_id = ? AND dish_id = ?').run(
    event_notes !== undefined ? String(event_notes) : row.event_notes,
    available !== undefined ? (available ? 1 : 0) : row.available,
    sort !== undefined ? toInt(sort) : row.sort,
    partyId, dishId
  );
  res.json({ ok: true, menu: partyMenuRows(partyId) });
});

// Desvincular prato da festa (sem excluir do cadastro geral)
router.delete('/:partyId/dishes/:dishId', requirePermission('festas_gerenciar'), (req, res) => {
  const partyId = toInt(req.params.partyId);
  const dishId = toInt(req.params.dishId);
  const row = db.prepare('SELECT * FROM party_dishes WHERE party_id = ? AND dish_id = ?').get(partyId, dishId);
  if (!row) return res.status(404).json({ error: 'Prato não está no cardápio desta festa.' });
  const party = db.prepare('SELECT name FROM parties WHERE id = ?').get(partyId);
  db.prepare('DELETE FROM party_dishes WHERE party_id = ? AND dish_id = ?').run(partyId, dishId);
  audit('party_dish', partyId, 'unlinked', `Prato removido do cardápio da festa "${party.name}".`, req.user.id);
  res.json({ ok: true, menu: partyMenuRows(partyId) });
});

// Reordenar pratos do cardápio da festa
router.put('/:id/dishes/order', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const ids = Array.isArray(req.body.order) ? req.body.order.map((x) => toInt(x)) : [];
  const tx = db.transaction(() => {
    const upd = db.prepare('UPDATE party_dishes SET sort = ? WHERE party_id = ? AND dish_id = ?');
    ids.forEach((did, i) => upd.run(i, id, did));
  });
  tx();
  res.json({ ok: true, menu: partyMenuRows(id) });
});

// Sincronizar cardápio a partir do tipo vinculado
router.post('/:id/menu/sync', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const n = syncPartyMenu(id);
  res.json({ synced: n, menu: partyMenuRows(id) });
});

// ---------------------------------------------------------------------------
// Mesas
// ---------------------------------------------------------------------------
router.get('/:id/tables', (req, res) => {
  const id = toInt(req.params.id);
  res.json(tablesOf(id));
});

router.post('/:id/tables', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
  if (!party) return res.status(404).json({ error: 'Festa não encontrada.' });
  const { label, capacity = null } = req.body || {};
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'Informe a identificação da mesa.' });
  const dup = db.prepare('SELECT id FROM party_tables WHERE party_id = ? AND label = ?').get(id, String(label).trim());
  if (dup) return res.status(409).json({ error: 'Já existe uma mesa com esta identificação nesta festa.' });
  const info = db.prepare(
    'INSERT INTO party_tables (party_id, label, capacity, status, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, String(label).trim(), capacity ? toInt(capacity) : null, 'livre', nowIso());
  audit('table', info.lastInsertRowid, 'created', `Mesa "${label}" criada na festa "${party.name}".`, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM party_tables WHERE id = ?').get(info.lastInsertRowid));
});

// Criação em lote
router.post('/:id/tables/bulk', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const { labels, capacity = null } = req.body || {};
  if (!Array.isArray(labels) || !labels.length) return res.status(400).json({ error: 'Informe ao menos uma mesa.' });
  const tx = db.transaction(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO party_tables (party_id, label, capacity, status, created_at) VALUES (?, ?, ?, ?, ?)');
    for (const l of labels) {
      if (l && String(l).trim()) ins.run(id, String(l).trim(), capacity ? toInt(capacity) : null, 'livre', nowIso());
    }
  });
  tx();
  audit('table', id, 'bulk_created', `${labels.length} mesas criadas (festa #${id}).`, req.user.id);
  res.json(tablesOf(id));
});

router.put('/:id/tables/:tableId', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const tableId = toInt(req.params.tableId);
  const table = db.prepare('SELECT * FROM party_tables WHERE id = ? AND party_id = ?').get(tableId, id);
  if (!table) return res.status(404).json({ error: 'Mesa não encontrada.' });
  const { label, capacity, status } = req.body || {};
  if (label !== undefined && String(label).trim() && label.trim() !== table.label) {
    const dup = db.prepare('SELECT id FROM party_tables WHERE party_id = ? AND label = ? AND id != ?').get(id, String(label).trim(), tableId);
    if (dup) return res.status(409).json({ error: 'Já existe uma mesa com esta identificação nesta festa.' });
  }
  const allowed = ['livre', 'ocupada', 'encerrada', 'bloqueada'];
  if (status !== undefined && !allowed.includes(status)) return res.status(400).json({ error: 'Status inválido para a mesa.' });
  db.prepare('UPDATE party_tables SET label = ?, capacity = ?, status = ? WHERE id = ?').run(
    label !== undefined && String(label).trim() ? String(label).trim() : table.label,
    capacity !== undefined ? (capacity ? toInt(capacity) : null) : table.capacity,
    status !== undefined ? status : table.status,
    tableId
  );
  audit('table', tableId, 'updated', `Mesa "${table.label}" atualizada.`, req.user.id);
  res.json(db.prepare('SELECT * FROM party_tables WHERE id = ?').get(tableId));
});

router.delete('/:id/tables/:tableId', requirePermission('festas_gerenciar'), (req, res) => {
  const id = toInt(req.params.id);
  const tableId = toInt(req.params.tableId);
  const table = db.prepare('SELECT * FROM party_tables WHERE id = ? AND party_id = ?').get(tableId, id);
  if (!table) return res.status(404).json({ error: 'Mesa não encontrada.' });
  const used = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE table_id = ?').get(tableId).c;
  if (used > 0) {
    return res.status(409).json({ error: 'Esta mesa possui pedidos históricos e não pode ser excluída. Marque-a como "encerrada" ou "bloqueada".' });
  }
  db.prepare('DELETE FROM party_tables WHERE id = ?').run(tableId);
  audit('table', tableId, 'deleted', `Mesa "${table.label}" excluída da festa #${id}.`, req.user.id);
  res.json({ ok: true });
});

module.exports = router;