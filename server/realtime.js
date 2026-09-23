'use strict';

const db = require('./db');
const { nowIso } = require('./util');

// ---------------------------------------------------------------------------
// Hub SSE
// ---------------------------------------------------------------------------
const clients = new Set();

function sseHandler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const client = { res, id: Date.now() };
  clients.add(client);

  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const ping = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch (_) { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

/** type: 'order:new' | 'order:update' | 'order:status' | 'order:edited' | 'notification' | 'party:update' */
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const c of clients) {
    try { c.res.write(payload); } catch (_) { clients.delete(c); }
  }
}

// ---------------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------------
function notify({ type, title, message = '', partyId = null, orderId = null, audience = '*' }) {
  const info = db.prepare(
    'INSERT INTO notifications (type, title, message, party_id, order_id, audience, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(type, title, message, partyId, orderId, audience, nowIso());
  const id = info.lastInsertRowid;
  broadcast('notification', { id, type, title, message, partyId, orderId, audience, createdAt: nowIso() });
  return id;
}

function markRead(id, userId) {
  // Cozinha/entrega/atendente podem marcar como lidas as do seu público/alvo
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(id);
  return row;
}

function unreadCountFor(role) {
  const row = db.prepare(
    `SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0 AND (audience = '*' OR audience = ? OR audience = 'cozinha')`
  ).get(role);
  return row.c;
}

module.exports = { sseHandler, broadcast, notify, markRead, unreadCountFor };