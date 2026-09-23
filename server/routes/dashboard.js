'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requirePermission } = require('../auth');
const { toInt, stripFinancial } = require('../util');

const router = express.Router();
router.use(requireAuth);
router.use(requirePermission('painel_visualizar'));

router.get('/', (req, res) => {
  const partyFilter = req.query.party_id ? toInt(req.query.party_id) : null;

  // Status configuráveis — fluxo ativo define terminais e etapas
  const statuses = db.prepare('SELECT * FROM order_statuses ORDER BY sort, id').all();
  const flow = statuses
    .filter((s) => s.key !== 'cancelado' && s.active === 1)
    .sort((a, b) => a.sort - b.sort || a.id - b.id);
  const terminal = flow.length ? flow[flow.length - 1].key : null;
  const readyStage = flow.length >= 3 ? flow[flow.length - 3].key : null; // "pronto" (etapa do preparo)
  const deliveryStage = flow.length >= 2 ? flow[flow.length - 2].key : null; // "entregue"
  const abExcl = ['cancelado'];
  if (terminal) abExcl.push(terminal);

  const count = (sql, params = []) => db.prepare(sql).get(...params).c;
  const pf = partyFilter ? ' AND party_id=?' : '';

  const partiesTotal = count("SELECT COUNT(*) AS c FROM parties WHERE status IN ('planejada','ativa')");
  const partiesAtivas = count("SELECT COUNT(*) AS c FROM parties WHERE status = 'ativa'");

  const statusCounts = {};
  for (const s of statuses) {
    statusCounts[s.key] = count('SELECT COUNT(*) AS c FROM orders WHERE status=?' + pf, [s.key].concat(partyFilter ? [partyFilter] : []));
  }
  const abertos = count(
    `SELECT COUNT(*) AS c FROM orders WHERE status NOT IN (${abExcl.map(() => '?').join(',')})` + pf,
    [...abExcl].concat(partyFilter ? [partyFilter] : [])
  );

  const occupiedBase = partyFilter
    ? 'SELECT COUNT(*) AS c FROM party_tables pt WHERE pt.party_id = ? AND pt.status = ?'
    : 'SELECT COUNT(*) AS c FROM party_tables pt WHERE pt.status = ?';
  const occupiedTables = count(occupiedBase, partyFilter ? [partyFilter, 'ocupada'] : ['ocupada']);
  const tableTotal = partyFilter
    ? count('SELECT COUNT(*) AS c FROM party_tables pt WHERE pt.party_id = ?', [partyFilter])
    : count('SELECT COUNT(*) AS c FROM party_tables pt');

  let avgPrepMinutes = null;
  if (readyStage) {
    const prep = db.prepare(`
      SELECT AVG(mins) AS avg_min FROM (
        SELECT o.id, MIN((julianday(substr(h.created_at,1,19)) - julianday(substr(o.created_at,1,19))) * 1440) AS mins
        FROM orders o
        JOIN order_history h ON h.order_id = o.id AND h.to_status = ?
        WHERE 1 = 1 ${partyFilter ? 'AND o.party_id = ?' : ''}
        GROUP BY o.id
      ) WHERE mins >= 0
    `).get(partyFilter ? [readyStage, partyFilter] : [readyStage]);
    avgPrepMinutes = prep.avg_min == null ? null : Math.round(prep.avg_min * 10) / 10;
  }

  const waiting = db.prepare(
    `SELECT o.id, o.code, o.status, o.priority, o.created_at, p.name AS party_name, pt.label AS table_label,
            (julianday('now','localtime') - julianday(substr(o.created_at,1,19))) * 1440 AS elapsed_min
     FROM orders o
     JOIN parties p ON p.id = o.party_id
     JOIN party_tables pt ON pt.id = o.table_id
     WHERE o.status NOT IN (${abExcl.map(() => '?').join(',')}) ${partyFilter ? 'AND o.party_id = ?' : ''}
     ORDER BY o.created_at ASC LIMIT 10`
  ).all([...abExcl].concat(partyFilter ? [partyFilter] : [])).map((w) => ({
    ...w, elapsed_min: Math.max(0, Math.round(w.elapsed_min)),
  }));

  const byParty = db.prepare(
    `SELECT p.id, p.name, p.status,
            (SELECT COUNT(*) FROM orders o WHERE o.party_id = p.id AND o.status NOT IN (${abExcl.map(() => '?').join(',')})) AS abertos,
            ${readyStage ? '(SELECT COUNT(*) FROM orders o WHERE o.party_id = p.id AND o.status = ?) AS prontos' : '0 AS prontos'},
            ${deliveryStage ? '(SELECT COUNT(*) FROM orders o WHERE o.party_id = p.id AND o.status = ?) AS entregues' : '0 AS entregues'},
            ${terminal ? '(SELECT COUNT(*) FROM orders o WHERE o.party_id = p.id AND o.status = ?) AS finalizados' : '0 AS finalizados'}
     FROM parties p WHERE p.status IN ('planejada','ativa') ORDER BY p.date DESC`
  ).all([...abExcl].concat(
    readyStage ? [readyStage] : [],
    deliveryStage ? [deliveryStage] : [],
    terminal ? [terminal] : []
  ));

  const byTable = partyFilter
    ? db.prepare(
        `SELECT pt.id, pt.label, pt.status AS table_mesa_status, pt.capacity,
                (SELECT COUNT(*) FROM orders o WHERE o.table_id = pt.id AND o.status NOT IN ('cancelado')) AS pedidos
         FROM party_tables pt WHERE pt.party_id = ? ORDER BY pt.label`
      ).all(partyFilter)
    : [];

  res.json(stripFinancial({
    partyFilter,
    partiesTotal, partiesAtivas, occupiedTables, tableTotal,
    statusCounts, abertos, statuses: statuses.map((s) => ({ ...s, count: statusCounts[s.key] })),
    avgPrepMinutes, waiting, byParty, byTable,
  }));
});

module.exports = router;