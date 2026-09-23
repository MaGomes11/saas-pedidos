'use strict';

const db = require('./db');
const { nowIso } = require('./util');

function audit(entityType, entityId, action, description, userId = null) {
  db.prepare(
    'INSERT INTO audit_log (entity_type, entity_id, action, description, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(entityType, entityId, action, description || '', userId, nowIso());
}

module.exports = { audit };