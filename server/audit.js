'use strict';

const db = require('./db');
const { nowIso } = require('./util');

async function audit(entityType, entityId, action, description, userId = null) {
  await db.run(
    'INSERT INTO audit_log (entity_type, entity_id, action, description, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    entityType,
    entityId,
    action,
    description || '',
    userId,
    nowIso()
  );
}

module.exports = { audit };