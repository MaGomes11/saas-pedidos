'use strict';

const db = require('./db');
const { nowIso } = require('./util');

// ---------------------------------------------------------------------------
// Hub SSE
// ---------------------------------------------------------------------------
const clients = new Set();

function sseHandler(req, res) {
  // No Vercel (serverless) conexões longas não funcionam — o frontend detecta
  // o conteúdo não-SSE e passa para polling.
  if (process.env.VERCEL === '1') {
    res.status(200).type('text/plain').send('SSE indisponível no modo serverless; o app usa polling.');
    return;
  }

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
async function notify({ type, title, message = '', partyId = null, orderId = null, audience = '*' }) {
  const info = await db.run(
    'INSERT INTO notifications (type, title, message, party_id, order_id, audience, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
    type, title, message, partyId, orderId, audience, nowIso()
  );
  const id = info.lastInsertRowid;
  broadcast('notification', { id, type, title, message, partyId, orderId, audience, createdAt: nowIso() });
  return id;
}

async function markRead(id, userId) {
  // Cozinha/entrega/atendente podem marcar como lidas as do seu público/alvo
  const row = await db.get('SELECT * FROM notifications WHERE id = ?', id);
  if (!row) return null;
  await db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', id);
  return row;
}

async function unreadCountFor(role) {
  const row = await db.get(
    `SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0 AND (audience = '*' OR audience = ? OR audience = 'cozinha')`,
    role
  );
  return row.c;
}

module.exports = { sseHandler, broadcast, notify, markRead, unreadCountFor };