'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission, hasPermission, isAdmin } = require('../auth');
const { audit } = require('../audit');
const { notify, broadcast } = require('../realtime');
const { nowIso, toInt, formatCode, stripFinancial } = require('../util');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------------
// Status configuráveis (vêm de order_statuses)
// ---------------------------------------------------------------------------
async function statusRows() {
  return db.all('SELECT * FROM order_statuses ORDER BY sort, id');
}

/** Fluxo ativo (exclui cancelado), ordenado — a ordem define o "próximo status". */
function flowKeys(statuses) {
  return statuses
    .filter((s) => s.key !== 'cancelado' && s.active === 1)
    .sort((a, b) => a.sort - b.sort || a.id - b.id);
}

/** Próximo status do fluxo (ou null se não houver). */
function nextOf(current, statuses) {
  const flow = flowKeys(statuses);
  const idx = flow.findIndex((s) => s.key === current);
  if (idx === -1 || idx === flow.length - 1) return null;
  return flow[idx + 1] || null;
}

/** Status terminal (último do fluxo ativo). */
function terminalOf(statuses) {
  const flow = flowKeys(statuses);
  return flow.length ? flow[flow.length - 1] : null;
}

function labelOf(key, statuses) {
  const s = statuses.find((x) => x.key === key);
  return s ? s.label : key;
}

/** Audiência de notificação conforme a permissão necessária para entrar no status. */
function audienceOf(perm) {
  if (perm === 'pedidos_cozinha_status') return 'cozinha';
  if (perm === 'pedidos_entrega_status') return 'entrega';
  return '*';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function itemDetail(itemId) {
  const removed = await db.all(
    'SELECT id, ingredient_id, ingredient_name, note FROM order_item_removed WHERE order_item_id = ?',
    itemId
  );
  const added = await db.all(
    'SELECT id, ingredient_id, ingredient_name, quantity, note FROM order_item_added WHERE order_item_id = ?',
    itemId
  );
  return { removed, added };
}

async function orderFull(id) {
  const order = await db.get(
    `SELECT o.*, p.name AS party_name, p.status AS party_status, pt.label AS table_label, pt.status AS table_status,
            u.name AS created_by_name
     FROM orders o
     JOIN parties p ON p.id = o.party_id
     JOIN party_tables pt ON pt.id = o.table_id
     JOIN users u ON u.id = o.created_by
     WHERE o.id = ?`,
    id
  );
  if (!order) return null;
  const itemsRows = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort, id', id);
  const items = [];
  for (const it of itemsRows) {
    items.push({ ...it, ...(await itemDetail(it.id)) });
  }
  const history = await db.all(
    `SELECT oh.*, u.name AS user_name FROM order_history oh JOIN users u ON u.id = oh.user_id
     WHERE oh.order_id = ? ORDER BY oh.id`,
    id
  );
  return { ...order, items, history };
}

function digestItems(items) {
  return (items || []).map((it) => {
    const removed = Array.isArray(it.removed) ? it.removed : [];
    const added = Array.isArray(it.added) ? it.added : [];
    return {
      id: it.id || null,
      dish_id: toInt(it.dish_id),
      quantity: Math.max(1, toInt(it.quantity, 1)),
      notes: String(it.notes || '').trim(),
      removed: removed.map((r) => ({ ingredient_id: toInt(r.ingredient_id), note: String(r.note || '').trim() })).filter((r) => r.ingredient_id > 0),
      added: added.map((a) => ({ ingredient_id: toInt(a.ingredient_id), quantity: String(a.quantity || '').trim(), note: String(a.note || '').trim() })).filter((a) => a.ingredient_id > 0),
    };
  });
}

/** Valida se todos os pratos pertencem e estão disponíveis no cardápio da festa. */
async function validateMenu(partyId, items) {
  const errors = [];
  for (const it of items) {
    const row = await db.get(
      `SELECT d.name FROM party_dishes pd JOIN dishes d ON d.id = pd.dish_id
       WHERE pd.party_id = ? AND pd.dish_id = ? AND pd.available = 1 AND d.active = 1`,
      partyId, it.dish_id
    );
    if (!row) errors.push(`Prato #${it.dish_id} não está disponível no cardápio desta festa.`);
  }
  return errors;
}

async function insertItem(orderId, it, sort) {
  const dish = await db.get('SELECT name, category FROM dishes WHERE id = ?', it.dish_id);
  const info = await db.run(
    'INSERT INTO order_items (order_id, dish_id, dish_name, dish_category, quantity, notes, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
    orderId, it.dish_id, dish?.name || `Prato #${it.dish_id}`, dish?.category || '', it.quantity, it.notes, sort
  );
  const itemId = info.lastInsertRowid;
  for (const r of it.removed) {
    const ing = await db.get('SELECT name FROM ingredients WHERE id = ?', r.ingredient_id);
    if (ing) await db.run('INSERT INTO order_item_removed (order_item_id, ingredient_id, ingredient_name, note) VALUES (?, ?, ?, ?)', itemId, r.ingredient_id, ing.name, r.note);
  }
  for (const a of it.added) {
    const ing = await db.get('SELECT name FROM ingredients WHERE id = ?', a.ingredient_id);
    if (ing) await db.run('INSERT INTO order_item_added (order_item_id, ingredient_id, ingredient_name, quantity, note) VALUES (?, ?, ?, ?, ?)', itemId, a.ingredient_id, ing.name, a.quantity, a.note);
  }
  return itemId;
}

// ---------------------------------------------------------------------------
// Lista com filtros (Kanban / lista de pedidos / busca)
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const {
    party_id, table_id, status, q, dish, user, date_from, date_to, ingredient, category, limit,
  } = req.query;

  let sql = `SELECT o.id, o.code, o.party_id, p.name AS party_name, o.table_id, pt.label AS table_label, pt.status AS table_status,
                    o.status, o.priority, o.notes, o.created_by, u.name AS created_by_name,
                    o.created_at, o.updated_at, o.finished_at
             FROM orders o
             JOIN parties p ON p.id = o.party_id
             JOIN party_tables pt ON pt.id = o.table_id
             JOIN users u ON u.id = o.created_by
             WHERE 1=1`;
  const params = [];
  if (party_id) { sql += ' AND o.party_id = ?'; params.push(toInt(party_id)); }
  if (table_id) { sql += ' AND o.table_id = ?'; params.push(toInt(table_id)); }
  if (status) {
    const list = String(status).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) { sql += ` AND o.status IN (${list.map(() => '?').join(',')})`; params.push(...list); }
  }
  if (q) { sql += ' AND o.code LIKE ?'; params.push(`%${q}%`); }
  if (dish) {
    sql += ' AND o.id IN (SELECT oi.order_id FROM order_items oi WHERE oi.dish_name LIKE ?)';
    params.push(`%${dish}%`);
  }
  if (user) { sql += ' AND o.created_by = ?'; params.push(toInt(user)); }
  if (date_from) { sql += ' AND o.created_at >= ?'; params.push(`${date_from} 00:00:00`); }
  if (date_to) { sql += ' AND o.created_at <= ?'; params.push(`${date_to} 23:59:59`); }
  if (ingredient) {
    sql += ` AND o.id IN (
       SELECT oi.order_id FROM order_item_removed r JOIN order_items oi ON oi.id = r.order_item_id WHERE r.ingredient_name LIKE ?
       UNION
       SELECT oi.order_id FROM order_item_added a JOIN order_items oi ON oi.id = a.order_item_id WHERE a.ingredient_name LIKE ?
    )`;
    params.push(`%${ingredient}%`, `%${ingredient}%`);
  }
  if (category) {
    sql += ' AND o.id IN (SELECT oi.order_id FROM order_items oi WHERE oi.dish_category = ?)';
    params.push(String(category));
  }
  sql += ' ORDER BY o.created_at DESC, o.id DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(Math.min(toInt(limit, 50), 500)); }

  const rows = await db.all(sql, ...params);
  const orders = [];
  for (const o of rows) {
    const items = await db.all('SELECT dish_name, dish_category, quantity, notes FROM order_items WHERE order_id = ? ORDER BY sort', o.id);
    orders.push({ ...o, items });
  }
  res.json(stripFinancial(orders));
});

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const order = await orderFull(toInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  res.json(stripFinancial(order));
});

router.get('/:id/history', async (req, res) => {
  const order = await db.get('SELECT id FROM orders WHERE id = ?', toInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const history = await db.all(
    `SELECT oh.*, u.name AS user_name FROM order_history oh JOIN users u ON u.id = oh.user_id
     WHERE oh.order_id = ? ORDER BY oh.id DESC`,
    order.id
  );
  res.json(history);
});

// ---------------------------------------------------------------------------
// Criar pedido
// ---------------------------------------------------------------------------
router.post('/', requirePermission('pedidos_criar'), async (req, res) => {
  const { client_request_id, party_id, table_id, notes = '', priority = 0, items = [], mark_table_occupied = true } = req.body || {};

  // Prevenção de envio duplicado
  if (client_request_id) {
    const existing = await db.get('SELECT order_id FROM idempotency_keys WHERE key = ?', String(client_request_id).trim());
    if (existing) {
      const order = await orderFull(existing.order_id);
      return res.status(200).json({ order, duplicate: true });
    }
  }

  if (!party_id || !table_id) return res.status(400).json({ error: 'Selecione a festa e a mesa.' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Adicione ao menos um prato ao pedido.' });

  const party = await db.get('SELECT * FROM parties WHERE id = ?', toInt(party_id));
  if (!party) return res.status(404).json({ error: 'Festa não encontrada.' });
  if (party.status !== 'ativa') {
    return res.status(409).json({ error: `Não é possível lançar pedidos: a festa está "${party.status}".` });
  }
  const table = await db.get('SELECT * FROM party_tables WHERE id = ? AND party_id = ?', toInt(table_id), party.id);
  if (!table) return res.status(404).json({ error: 'A mesa não pertence a esta festa.' });
  if (table.status === 'bloqueada' || table.status === 'encerrada') {
    return res.status(409).json({ error: `A mesa "${table.label}" está ${table.status === 'bloqueada' ? 'bloqueada' : 'encerrada'} e não aceita pedidos.` });
  }

  const cleanItems = digestItems(items);
  const menuErrors = await validateMenu(party.id, cleanItems);
  if (menuErrors.length) return res.status(400).json({ error: menuErrors.join(' ') });

  const now = nowIso();
  const seqRow = await db.get('SELECT COALESCE(MAX(id), 0) AS m FROM orders');
  const seq = seqRow.m + 1;
  const code = formatCode(seq);

  let orderId;
  try {
    orderId = await db.tx(async () => {
      const info = await db.run(
        `INSERT INTO orders (code, party_id, table_id, status, priority, notes, cancel_justification, created_by, created_at, updated_at)
         VALUES (?, ?, ?, 'novo', ?, ?, '', ?, ?, ?)`,
        code, party.id, table.id, priority ? 1 : 0, String(notes).trim(), req.user.id, now, now
      );
      const newId = info.lastInsertRowid;
      for (let i = 0; i < cleanItems.length; i++) await insertItem(newId, cleanItems[i], i);
      await db.run(
        'INSERT INTO order_history (order_id, action, description, from_status, to_status, user_id, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
        newId, 'created', `Pedido ${code} criado na ${table.label}.`, 'novo', req.user.id, now
      );
      if (client_request_id) {
        await db.run('INSERT OR IGNORE INTO idempotency_keys (key, order_id, created_at) VALUES (?, ?, ?)',
          String(client_request_id).trim(), newId, now);
      }
      if (mark_table_occupied !== false) {
        await db.run("UPDATE party_tables SET status = 'ocupada' WHERE id = ? AND status = 'livre'", table.id);
      }
      await audit('order', newId, 'created', `Pedido ${code} criado (${party.name}, ${table.label}).`, req.user.id);
      return newId;
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Pedido duplicado detectado. Tente novamente.' });
    }
    throw e;
  }

  await notify({
    type: 'new_order', title: `Novo pedido ${code}`,
    message: `${party.name} · ${table.label} · ${cleanItems.length} item(ns)`,
    partyId: party.id, orderId, audience: 'cozinha',
  });
  broadcast('order:new', { orderId, partyId: party.id, code, tableLabel: table.label });

  res.status(201).json({ order: await orderFull(orderId) });
});

// ---------------------------------------------------------------------------
// Editar pedido (itens, notas, prioridade)
// ---------------------------------------------------------------------------
router.put('/:id', async (req, res) => {
  const id = toInt(req.params.id);
  const order = await db.get('SELECT * FROM orders WHERE id = ?', id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });

  const statuses = await statusRows();
  const flow = flowKeys(statuses);
  const editableKeys = flow.slice(0, 2).map((s) => s.key);
  const editable = editableKeys.includes(order.status) && order.status !== 'cancelado';
  const adminAllows = isAdmin(req.user) && (await hasPermission(req.user, 'pedidos_editar_finalizados'));
  if (!editable && !adminAllows) {
    return res.status(409).json({ error: 'Este pedido não está mais editável (status: ' + labelOf(order.status, statuses) + ').' });
  }
  if (editable && !(await hasPermission(req.user, 'pedidos_editar'))) {
    return res.status(403).json({ error: 'Seu perfil não permite editar pedidos.' });
  }
  if (order.status === 'cancelado') {
    return res.status(409).json({ error: 'Pedidos cancelados não podem ser editados.' });
  }

  const { notes, priority, items } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Envie a lista de itens do pedido.' });

  const cleanItems = digestItems(items);
  const menuErrors = await validateMenu(order.party_id, cleanItems);
  if (menuErrors.length) return res.status(400).json({ error: menuErrors.join(' ') });

  const now = nowIso();
  const changes = [];

  await db.tx(async () => {
    const existingItems = await db.all('SELECT * FROM order_items WHERE order_id = ?', order.id);
    const incomingIds = new Set(cleanItems.filter((it) => it.id).map((it) => it.id));

    // Itens removidos do pedido
    for (const ex of existingItems) {
      if (!incomingIds.has(ex.id)) {
        await db.run('DELETE FROM order_items WHERE id = ?', ex.id);
        changes.push(`removido: ${ex.quantity}x ${ex.dish_name}`);
      }
    }

    for (let i = 0; i < cleanItems.length; i++) {
      const it = cleanItems[i];
      if (it.id) {
        const ex = await db.get('SELECT * FROM order_items WHERE id = ? AND order_id = ?', it.id, order.id);
        if (ex) {
          if (ex.dish_id !== it.dish_id) {
            // Trocou o prato → trata como remoção + inclusão
            await db.run('DELETE FROM order_items WHERE id = ?', ex.id);
            changes.push(`removido: ${ex.quantity}x ${ex.dish_name}`);
            const dish = await db.get('SELECT name, category FROM dishes WHERE id = ?', it.dish_id);
            const info2 = await db.run(
              'INSERT INTO order_items (order_id, dish_id, dish_name, dish_category, quantity, notes, sort) VALUES (?, ?, ?, ?, ?, ?, ?)',
              order.id, it.dish_id, dish?.name || 'Prato', dish?.category || '', it.quantity, it.notes, i
            );
            const nid = info2.lastInsertRowid;
            for (const r of it.removed) {
              const ing = await db.get('SELECT name FROM ingredients WHERE id = ?', r.ingredient_id);
              if (ing) await db.run('INSERT INTO order_item_removed (order_item_id, ingredient_id, ingredient_name, note) VALUES (?, ?, ?, ?)', nid, r.ingredient_id, ing.name, r.note);
            }
            for (const a of it.added) {
              const ing = await db.get('SELECT name FROM ingredients WHERE id = ?', a.ingredient_id);
              if (ing) await db.run('INSERT INTO order_item_added (order_item_id, ingredient_id, ingredient_name, quantity, note) VALUES (?, ?, ?, ?, ?)', nid, a.ingredient_id, ing.name, a.quantity, a.note);
            }
            changes.push(`adicionado: ${it.quantity}x ${dish?.name || 'Prato'}`);
          } else {
            const dish = await db.get('SELECT name, category FROM dishes WHERE id = ?', it.dish_id);
            if (ex.quantity !== it.quantity) changes.push(`${ex.dish_name}: quantidade ${ex.quantity} → ${it.quantity}`);
            if (ex.notes !== it.notes) changes.push(`${ex.dish_name}: observação alterada`);
            await db.run('UPDATE order_items SET quantity = ?, notes = ?, dish_name = ?, dish_category = ? WHERE id = ?',
              it.quantity, it.notes, dish?.name || ex.dish_name, dish?.category || ex.dish_category, ex.id);
            await db.run('DELETE FROM order_item_removed WHERE order_item_id = ?', ex.id);
            await db.run('DELETE FROM order_item_added WHERE order_item_id = ?', ex.id);
            for (const r of it.removed) {
              const ing = await db.get('SELECT name FROM ingredients WHERE id = ?', r.ingredient_id);
              if (ing) await db.run('INSERT INTO order_item_removed (order_item_id, ingredient_id, ingredient_name, note) VALUES (?, ?, ?, ?)', ex.id, r.ingredient_id, ing.name, r.note);
            }
            for (const a of it.added) {
              const ing = await db.get('SELECT name FROM ingredients WHERE id = ?', a.ingredient_id);
              if (ing) await db.run('INSERT INTO order_item_added (order_item_id, ingredient_id, ingredient_name, quantity, note) VALUES (?, ?, ?, ?, ?)', ex.id, a.ingredient_id, ing.name, a.quantity, a.note);
            }
          }
        } else {
          await insertItem(order.id, it, i);
          changes.push(`adicionado: ${it.quantity}x ${it.dish_id}`);
        }
      } else {
        await insertItem(order.id, it, i);
        const dish = await db.get('SELECT name FROM dishes WHERE id = ?', it.dish_id);
        changes.push(`adicionado: ${it.quantity}x ${dish?.name || 'Prato'}`);
      }
    }

    // Notas e prioridade
    if (notes !== undefined && String(notes) !== order.notes) {
      changes.push('observações do pedido alteradas');
      await db.run('UPDATE orders SET notes = ? WHERE id = ?', String(notes), order.id);
    }
    if (priority !== undefined && (priority ? 1 : 0) !== order.priority) {
      changes.push(priority ? 'prioridade marcada como alta' : 'prioridade removida');
      await db.run('UPDATE orders SET priority = ? WHERE id = ?', priority ? 1 : 0, order.id);
    }
    await db.run('UPDATE orders SET updated_at = ? WHERE id = ?', now, order.id);

    await db.run(
      'INSERT INTO order_history (order_id, action, description, from_status, to_status, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      order.id, 'edited', changes.length ? `Alteração: ${changes.join('; ')}.` : 'Edição sem alterações efetivas.', order.status, order.status, req.user.id, now
    );
    await audit('order', order.id, 'edited', `Pedido ${order.code} editado: ${changes.slice(0, 8).join('; ')}.`, req.user.id);
  });

  broadcast('order:edited', { orderId: order.id, code: order.code, partyId: order.party_id });
  res.json({ order: await orderFull(order.id), changes });
});

// ---------------------------------------------------------------------------
// Mudança de status
// ---------------------------------------------------------------------------
router.patch('/:id/status', async (req, res) => {
  const id = toInt(req.params.id);
  const order = await db.get('SELECT * FROM orders WHERE id = ?', id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  const { status, justification = '' } = req.body || {};
  if (!status) return res.status(400).json({ error: 'Informe o novo status.' });

  const statuses = await statusRows();
  const target = statuses.find((s) => s.key === status);
  if (!target) return res.status(400).json({ error: 'Status inválido.' });

  const current = order.status;
  if (current === status) return res.status(400).json({ error: 'O pedido já está neste status.' });

  const terminal = terminalOf(statuses);
  const next = nextOf(current, statuses);

  let allowed = false;
  if (isAdmin(req.user)) {
    allowed = true; // administrador pode mover qualquer status (cancelamento exige justificativa)
  } else if (status === 'cancelado') {
    allowed = (await hasPermission(req.user, 'pedidos_cancelar'))
      && current !== 'cancelado'
      && (!terminal || current !== terminal.key);
  } else if (next && next.key === status && target.active === 1) {
    // Avanço normal: apenas para o próximo status da ordem, se o alvo estiver ativo
    allowed = !target.advance_perm || (await hasPermission(req.user, target.advance_perm));
  }

  if (!allowed) {
    return res.status(403).json({ error: `Seu perfil não permite mover o pedido de "${labelOf(current, statuses)}" para "${labelOf(status, statuses)}".` });
  }
  if (status === 'cancelado' && !justification.trim()) {
    return res.status(400).json({ error: 'Para cancelar um pedido é obrigatório informar a justificativa.' });
  }

  const now = nowIso();
  await db.run(
    `UPDATE orders SET status = ?, cancel_justification = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
    status,
    status === 'cancelado' ? justification.trim() : '',
    status === 'cancelado' || (terminal && status === terminal.key) ? now : null,
    now,
    id
  );

  const verb = status === 'cancelado'
    ? `Pedido cancelado (${justification.trim()})`
    : `Status alterado para "${labelOf(status, statuses)}"`;

  await db.run(
    'INSERT INTO order_history (order_id, action, description, from_status, to_status, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, status === 'cancelado' ? 'cancelado' : 'status_changed', verb, current, status, req.user.id, now
  );
  await audit('order', id, 'status', `Pedido ${order.code}: ${current} → ${status}.`, req.user.id);

  // Notificações
  if (status === 'cancelado') {
    await notify({ type: 'warning', title: `Pedido ${order.code} cancelado`, message: justification.trim(), partyId: order.party_id, orderId: id, audience: '*' });
  } else {
    await notify({
      type: 'status', title: `Pedido ${order.code} agora é "${labelOf(status, statuses)}"`,
      message: `${order.code} · ${labelOf(status, statuses)}`,
      partyId: order.party_id, orderId: id, audience: audienceOf(target.advance_perm),
    });
  }
  broadcast('order:status', { orderId: id, code: order.code, from: current, to: status, partyId: order.party_id });

  res.json({ order: await orderFull(id) });
});

module.exports = router;