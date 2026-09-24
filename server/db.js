'use strict';

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { nowIso } = require('./util');

// ---------------------------------------------------------------------------
// Dois modos de execução (mesmo dialeto SQL — SQLite):
//  - Local / Render:  better-sqlite3 (arquivo SQLite em DB_PATH)
//  - Vercel:          libSQL hospedado (Turso) via TURSO_URL/TURSO_AUTH_TOKEN
// ---------------------------------------------------------------------------
const IS_LIBSQL = !!(process.env.TURSO_URL && process.env.TURSO_AUTH_TOKEN);

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'buffet.db');

// Reset opcional: node server/db.js --reset (recria o banco local com dados de exemplo)
if (!IS_LIBSQL && process.argv.includes('--reset') && fs.existsSync(DB_PATH)) {
  fs.rmSync(DB_PATH, { force: true });
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(DB_PATH + suffix, { force: true });
  }
}

let sqlite = null;   // instância better-sqlite3 (modo local)
let libsql = null;   // client @libsql/client (modo serverless/turso)
let activeTx = null; // transação interativa ativa (apenas libsql)
let ready = null;    // Promise de init()

// Tabela de pedidos — status é livre (os valores válidos vêm de order_statuses).
const ORDERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  party_id INTEGER NOT NULL REFERENCES parties(id),
  table_id INTEGER NOT NULL REFERENCES party_tables(id),
  status TEXT NOT NULL DEFAULT 'novo',
  priority INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  cancel_justification TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_key TEXT NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_key, permission)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES roles(key),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dish_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  can_remove INTEGER NOT NULL DEFAULT 1,
  can_add INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL REFERENCES categories(key),
  prep_notes TEXT NOT NULL DEFAULT '',
  image_data TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dish_ingredients (
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  is_default INTEGER NOT NULL DEFAULT 0,
  can_remove INTEGER NOT NULL DEFAULT 0,
  can_add INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dish_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS dish_type_items (
  dish_type_id INTEGER NOT NULL REFERENCES dish_types(id) ON DELETE CASCADE,
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dish_type_id, dish_id)
);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  client_name TEXT NOT NULL DEFAULT '',
  date TEXT,
  start_time TEXT,
  end_time TEXT,
  location TEXT NOT NULL DEFAULT '',
  table_count INTEGER NOT NULL DEFAULT 0,
  dish_type_id INTEGER REFERENCES dish_types(id),
  status TEXT NOT NULL DEFAULT 'planejada' CHECK(status IN ('planejada','ativa','encerrada','cancelada')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'primary',
  sort INTEGER NOT NULL DEFAULT 0,
  advance_perm TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS party_dishes (
  party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  event_notes TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  available INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'cardapio',
  PRIMARY KEY (party_id, dish_id)
);

CREATE TABLE IF NOT EXISTS party_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  capacity INTEGER,
  status TEXT NOT NULL DEFAULT 'livre' CHECK(status IN ('livre','ocupada','encerrada','bloqueada')),
  created_at TEXT NOT NULL,
  UNIQUE (party_id, label)
);

${ORDERS_TABLE_SQL}

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  dish_id INTEGER NOT NULL REFERENCES dishes(id),
  dish_name TEXT NOT NULL,
  dish_category TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1,
  notes TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_item_removed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  ingredient_id INTEGER REFERENCES ingredients(id),
  ingredient_name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS order_item_added (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  ingredient_id INTEGER REFERENCES ingredients(id),
  ingredient_name TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  from_status TEXT,
  to_status TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  party_id INTEGER REFERENCES parties(id),
  order_id INTEGER REFERENCES orders(id),
  audience TEXT NOT NULL DEFAULT '*',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_party ON orders(party_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_history_order ON order_history(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_audience ON notifications(audience, is_read);
CREATE INDEX IF NOT EXISTS idx_party_dishes_party ON party_dishes(party_id, sort);
CREATE INDEX IF NOT EXISTS idx_party_tables_party ON party_tables(party_id);
CREATE INDEX IF NOT EXISTS idx_order_statuses_sort ON order_statuses(sort);
`;

// ---------------------------------------------------------------------------
// Conexões
// ---------------------------------------------------------------------------
function initLocalConnection() {
  const Database = require('better-sqlite3');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
}

function initLibsqlClient() {
  const { createClient } = require('@libsql/client');
  libsql = createClient({
    url: process.env.TURSO_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
}

// ---------------------------------------------------------------------------
// Adapter async (mesma API nos dois modos)
// ---------------------------------------------------------------------------
async function get(sql, ...params) {
  if (IS_LIBSQL) {
    const target = activeTx || libsql;
    const res = await target.execute({ sql, args: params });
    return res.rows[0] ?? undefined;
  }
  return sqlite.prepare(sql).get(...params);
}

async function all(sql, ...params) {
  if (IS_LIBSQL) {
    const target = activeTx || libsql;
    const res = await target.execute({ sql, args: params });
    return res.rows;
  }
  return sqlite.prepare(sql).all(...params);
}

async function run(sql, ...params) {
  if (IS_LIBSQL) {
    const target = activeTx || libsql;
    const res = await target.execute({ sql, args: params });
    return {
      lastInsertRowid: res.lastInsertRowid == null ? 0 : Number(res.lastInsertRowid),
      changes: res.rowsAffected ?? 0,
    };
  }
  return sqlite.prepare(sql).run(...params);
}

/** Múltiplos comandos (schema). No libsql executa statement a statement. */
async function exec(sql) {
  if (IS_LIBSQL) {
    const stmts = sql.split(';').map((s) => s.trim()).filter(Boolean);
    for (const s of stmts) await libsql.execute({ sql: s });
    return;
  }
  sqlite.exec(sql);
}

/** Transação atômica com função async. */
async function tx(fn) {
  if (activeTx) throw new Error('Transações aninhadas não são suportadas.');
  if (IS_LIBSQL) {
    const t = libsql.transaction('write');
    activeTx = t;
    try {
      const result = await fn();
      await t.commit();
      return result;
    } catch (e) {
      try { await t.rollback(); } catch (_) { /* ignore */ }
      throw e;
    } finally {
      activeTx = null;
      if (typeof t.close === 'function') { try { t.close(); } catch (_) { /* ignore */ } }
    }
  }
  sqlite.exec('BEGIN');
  try {
    const result = await fn();
    sqlite.exec('COMMIT');
    return result;
  } catch (e) {
    try { sqlite.exec('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// MIGRAÇÕES (apenas local — bancos antigos com CHECK fixo / FKs órfãs)
// ---------------------------------------------------------------------------
function migrateOrdersCheck() {
  if (IS_LIBSQL) return;
  const row = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get();
  if (!row || !/CHECK\s*\(\s*status\s+IN/i.test(row.sql)) return;
  const fkWasOn = sqlite.pragma('foreign_keys', { simple: true });
  sqlite.pragma('foreign_keys = OFF');
  // IMPORTANTE: legacy_alter_table=ON impede o SQLite de reescrever as FKs de
  // outras tabelas (order_items, order_history) para apontarem a orders_legacy.
  const legacyWasOn = sqlite.pragma('legacy_alter_table', { simple: true });
  sqlite.pragma('legacy_alter_table = ON');
  sqlite.transaction(() => {
    sqlite.exec('ALTER TABLE orders RENAME TO orders_legacy');
    sqlite.exec(ORDERS_TABLE_SQL);
    sqlite.exec(
      `INSERT INTO orders (id, code, party_id, table_id, status, priority, notes, cancel_justification, created_by, created_at, updated_at, finished_at)
       SELECT id, code, party_id, table_id, status, priority, notes, cancel_justification, created_by, created_at, updated_at, finished_at
       FROM orders_legacy`
    );
    sqlite.exec('DROP TABLE orders_legacy');
  })();
  sqlite.pragma(`legacy_alter_table = ${legacyWasOn ? 'ON' : 'OFF'}`);
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_orders_party ON orders(party_id)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)');
  sqlite.pragma(`foreign_keys = ${fkWasOn ? 'ON' : 'OFF'}`);
}

// REPAIR: bancos que passaram pelo RENAME de orders SEM legacy_alter_table=ON
// ficaram com FKs órfãs (order_items/order_history → "orders_legacy" inexistente).
function repairLegacyOrdersFks() {
  if (IS_LIBSQL) return;
  const bad = sqlite
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL")
    .all()
    .filter((t) => /REFERENCES\s*["']?orders_legacy["']?\s*\(/i.test(t.sql));
  if (!bad.length) return;
  const fkWasOn = sqlite.pragma('foreign_keys', { simple: true });
  sqlite.pragma('foreign_keys = OFF');
  const legacyWasOn = sqlite.pragma('legacy_alter_table', { simple: true });
  sqlite.pragma('legacy_alter_table = ON');
  sqlite.transaction(() => {
    for (const t of bad) {
      const name = t.name;
      const cols = sqlite.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name);
      const idxs = sqlite
        .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name = ? AND sql IS NOT NULL")
        .all(name);
      const newSql = t.sql.replace(/orders_legacy/gi, 'orders');
      const fixedName = `${name}__fixed`;
      sqlite.exec(newSql.replace(new RegExp(`\\b${name}\\b`), fixedName));
      sqlite.exec(
        `INSERT INTO "${fixedName}" (${cols.map((c) => `"${c}"`).join(',')})
         SELECT ${cols.map((c) => `"${c}"`).join(',')} FROM "${name}"`
      );
      sqlite.exec(`DROP TABLE "${name}"`);
      sqlite.exec(`ALTER TABLE "${fixedName}" RENAME TO "${name}"`);
      // recria os índices que foram dropados junto com a tabela antiga
      for (const ix of idxs) sqlite.exec(ix.sql);
    }
  })();
  sqlite.pragma(`legacy_alter_table = ${legacyWasOn ? 'ON' : 'OFF'}`);
  sqlite.pragma(`foreign_keys = ${fkWasOn ? 'ON' : 'OFF'}`);
}

// ---------------------------------------------------------------------------
// SEED (idempotente)
// ---------------------------------------------------------------------------
async function seed() {
  const now = nowIso();

  const usersCountRow = await get('SELECT COUNT(*) AS c FROM users');
  const hasUsers = usersCountRow.c > 0;

  // Roles
  const roles = [
    ['administrador', 'Administrador'],
    ['atendente', 'Atendente'],
    ['cozinha', 'Cozinha'],
    ['entrega', 'Entrega / Garçom'],
  ];
  for (const [k, n] of roles) await run('INSERT OR IGNORE INTO roles (key, name) VALUES (?, ?)', k, n);

  // Permissões
  const PERMISSIONS = {
    usuarios_gerenciar: 'Gerenciar usuários e permissões',
    cardapios_gerenciar: 'Gerenciar tipos de cardápio',
    pratos_gerenciar: 'Gerenciar pratos e composição',
    categorias_gerenciar: 'Gerenciar categorias de pratos (incluir, editar, excluir, ordem)',
    ingredientes_gerenciar: 'Gerenciar ingredientes',
    festas_gerenciar: 'Criar e editar festas, cardápio da festa e mesas',
    festas_visualizar: 'Visualizar festas e cardápios',
    pedidos_criar: 'Criar pedidos',
    pedidos_editar: 'Editar pedidos abertos (Novo / Em preparo)',
    pedidos_editar_finalizados: 'Editar pedidos finalizados',
    pedidos_cancelar: 'Cancelar pedidos',
    statuses_gerenciar: 'Gerenciar status de pedidos (incluir, editar, excluir, ordem)',
    configuracoes_gerenciar: 'Gerenciar identidade e informações da empresa',
    pedidos_cozinha_status: 'Mover pedidos no fluxo da cozinha (Novo → Em preparo → Pronto)',
    pedidos_entrega_status: 'Marcar pedidos como Entregue',
    pedidos_finalizar: 'Marcar pedidos como Finalizados',
    painel_visualizar: 'Visualizar painel (dashboard)',
    historico_visualizar: 'Visualizar histórico e auditoria',
    notificacoes_visualizar: 'Visualizar notificações',
  };

  const permissionSeeds = [
    ['administrador', Object.keys(PERMISSIONS)],
    ['atendente', ['festas_visualizar', 'pedidos_criar', 'pedidos_editar', 'pedidos_cancelar', 'painel_visualizar', 'historico_visualizar', 'notificacoes_visualizar']],
    ['cozinha', ['festas_visualizar', 'pedidos_cozinha_status', 'painel_visualizar', 'historico_visualizar', 'notificacoes_visualizar']],
    ['entrega', ['festas_visualizar', 'pedidos_entrega_status', 'pedidos_finalizar', 'painel_visualizar', 'historico_visualizar', 'notificacoes_visualizar']],
  ];
  for (const [role, perms] of permissionSeeds) {
    for (const p of perms) await run('INSERT OR IGNORE INTO role_permissions (role_key, permission) VALUES (?, ?)', role, p);
  }

  // Status de pedidos (configuráveis) — chaves padrão preservam dados existentes
  const statusSeeds = [
    ['novo', 'Novo', 'primary', 1, '', 1, 1],
    ['em_preparo', 'Em preparo', 'warn', 2, 'pedidos_cozinha_status', 1, 0],
    ['pronto', 'Pronto', 'ok', 3, 'pedidos_cozinha_status', 1, 0],
    ['entregue', 'Entregue', 'primary', 4, 'pedidos_entrega_status', 1, 0],
    ['finalizado', 'Finalizado', 'muted', 5, 'pedidos_finalizar', 1, 0],
    ['cancelado', 'Cancelado', 'danger', 999, '', 1, 1],
  ];
  for (const [key, label, color, sort, perm, active, system] of statusSeeds) {
    await run(
      'INSERT OR IGNORE INTO order_statuses (key, label, color, sort, advance_perm, active, is_system, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      key, label, color, sort, perm, active, system, now
    );
  }

  // Categorias
  const categories = [
    ['entrada', 'Entrada', 1],
    ['salada', 'Salada', 2],
    ['principal', 'Prato principal', 3],
    ['acompanhamento', 'Acompanhamento', 4],
    ['sobremesa', 'Sobremesa', 5],
    ['bebida', 'Bebida', 6],
    ['especial', 'Item especial', 7],
  ];
  for (const c of categories) await run('INSERT OR IGNORE INTO categories (key, name, sort) VALUES (?, ?, ?)', ...c);

  // Configurações da empresa / identidade
  const settingsSeeds = [
    ['system_name', 'Saas Pedidos'],
    ['company_name', ''],
    ['company_phone', ''],
    ['company_email', ''],
    ['company_address', ''],
    ['company_cnpj', ''],
  ];
  for (const [k, v] of settingsSeeds) await run('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', k, v, now);

  // Usuários iniciais (criados apenas no primeiro boot / banco vazio)
  if (!hasUsers) {
    const mk = async (name, email, pwd, role) =>
      await run(
        'INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
        name, email, bcrypt.hashSync(pwd, 10), role, now, now
      );
    // Em produção (Render/Railway), defina ADMIN_EMAIL/ADMIN_PASSWORD no primeiro boot.
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@buffet.local').trim().toLowerCase();
    const adminPwd = process.env.ADMIN_PASSWORD || 'admin123';
    if (!adminEmail || adminPwd.length < 8) {
      throw new Error('ADMIN_EMAIL e ADMIN_PASSWORD (mín. 8 caracteres) são obrigatórios no primeiro boot.');
    }
    await mk('Administrador', adminEmail, adminPwd, 'administrador');
    await mk('Atendente Demo', 'atendente@buffet.local', 'atendente123', 'atendente');
    await mk('Cozinha Demo', 'cozinha@buffet.local', 'cozinha123', 'cozinha');
    await mk('Entrega Demo', 'entrega@buffet.local', 'entrega123', 'entrega');
  }

  // Dados de exemplo (somente se o sistema estiver vazio)
  const dishesCountRow = await get('SELECT COUNT(*) AS c FROM dishes');
  const hasData = dishesCountRow.c > 0;
  if (!hasData) await seedSample(now);
}

async function seedSample(now) {
  const insIngSql = 'INSERT INTO ingredients (name, description, can_remove, can_add, notes, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)';
  const ing = async (n, remove, add) => {
    const info = await run(insIngSql, n, '', remove ? 1 : 0, add ? 1 : 0, '', now, now);
    return info.lastInsertRowid;
  };

  const arroz = await ing('Arroz', true, false);
  const feijao = await ing('Feijão', true, false);
  const salada = await ing('Salada verde', true, false);
  const frango = await ing('Frango grelhado', true, false);
  const filé = await ing('Filé mignon', true, false);
  const queijo = await ing('Queijo', true, true);
  const bacon = await ing('Bacon', true, true);
  const tomate = await ing('Tomate', true, true);
  const alface = await ing('Alface', true, true);
  const cebola = await ing('Cebola', true, true);
  const ovo = await ing('Ovo', true, true);
  const farofa = await ing('Farofa', true, false);
  const batata = await ing('Batata frita', true, false);
  const sorvete = await ing('Sorvete', false, false);
  const churros = await ing('Churros', false, false);
  const refrigerante = await ing('Refrigerante', false, false);
  const suco = await ing('Suco de laranja', false, false);
  const agua = await ing('Água', false, false);
  const molho = await ing('Molho especial', true, true);
  const pao = await ing('Pão francês', true, false);

  const insDishSql = 'INSERT INTO dishes (name, description, category, prep_notes, image_data, active, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 1, ?, ?)';
  const dish = async (n, cat, desc, prep) => {
    const info = await run(insDishSql, n, desc || '', cat, prep || '', now, now);
    return info.lastInsertRowid;
  };

  const insCompSql = 'INSERT INTO dish_ingredients (dish_id, ingredient_id, is_default, can_remove, can_add, sort) VALUES (?, ?, ?, ?, ?, ?)';
  const comp = (d, i, isD, cr, ca, s) => run(insCompSql, d, i, isD, cr, ca, s);
  const defaultDishIng = async (d, ...ings) => {
    for (let idx = 0; idx < ings.length; idx++) {
      await comp(d, ings[idx], 1, 1, 0, idx);
    }
  };

  // -------- Pratos de exemplo --------
  const ceasar = await dish('Salada Caesar', 'salada', 'Alface, croutons e molho especial.', 'Montar na hora do pedido.');
  await defaultDishIng(ceasar, alface, molho);
  await comp(ceasar, queijo, 0, 0, 1, 3); // queijo pode ser acrescentado

  const frangoGrelhado = await dish('Frango grelhado', 'principal', 'Peito de frango grelhado com ervas.', 'Grelhar ao ponto.');
  await defaultDishIng(frangoGrelhado, frango, arroz, salada);

  const filéComFritas = await dish('Filé com fritas', 'principal', 'Filé mignon com batata frita.', 'Ponto: malpassado, ao ponto ou bem passado.');
  await defaultDishIng(filéComFritas, filé, batata);
  await comp(filéComFritas, ovo, 0, 0, 1, 2);

  const churrasco = await dish('Churrasco misto', 'principal', 'Costela, picanha e linguiça.', 'Servir com farofa e vinagrete.');
  await defaultDishIng(churrasco, farofa, cebola, molho);

  const vegetariano = await dish('Escondidinho vegetariano', 'principal', 'Purê de batata com legumes salteados.', 'Sem carne; atenção a alergias.');
  await defaultDishIng(vegetariano, batata, queijo);

  const arrozComBrócolis = await dish('Arroz com brócolis', 'acompanhamento', 'Arroz soltinho com brócolis.', 'Levar para a mesa junto com o prato principal.');
  await defaultDishIng(arrozComBrócolis, arroz);

  const batataFrita = await dish('Batata frita', 'acompanhamento', 'Porção de batata frita crocante.', 'Servir quente.');
  await defaultDishIng(batataFrita, batata);

  const sorvetePote = await dish('Sorvete (pote)', 'sobremesa', 'Sorvete de creme e chocolate.', 'Retirar do freezer na hora de servir.');
  await defaultDishIng(sorvetePote, sorvete);

  const churrosDoce = await dish('Churros', 'sobremesa', 'Churros com açúcar e canela.', 'Rechear na hora.');
  await defaultDishIng(churrosDoce, churros);

  const refriLata = await dish('Refrigerante (lata)', 'bebida', 'Coca-Cola, Guaraná ou Fanta.', 'Perguntar o sabor na mesa.');
  await defaultDishIng(refriLata, refrigerante);

  const sucoLaranja = await dish('Suco de laranja', 'bebida', 'Suco natural de laranja.', 'Servir gelado.');
  await defaultDishIng(sucoLaranja, suco);

  const aguaGelada = await dish('Água', 'bebida', 'Água mineral (com ou sem gás).', 'Com ou sem gás.');
  await defaultDishIng(aguaGelada, agua);

  const canapés = await dish('Canapés variados', 'entrada', 'Seleção de canapés frios.', 'Montar em bandeja.');
  await defaultDishIng(canapés, pao, molho);

  // -------- Tipos de cardápio --------
  const insTypeSql = 'INSERT INTO dish_types (name, description, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)';
  const tTradicional = (await run(insTypeSql, 'Cardápio tradicional', 'Pratos clássicos para eventos.', now, now)).lastInsertRowid;
  const tInfantil = (await run(insTypeSql, 'Cardápio infantil', 'Opções leves e coloridas para crianças.', now, now)).lastInsertRowid;
  const tVegetariano = (await run(insTypeSql, 'Cardápio vegetariano', 'Opções sem carne.', now, now)).lastInsertRowid;
  const tCorporativo = (await run(insTypeSql, 'Cardápio corporativo', 'Almoço executivo rápido.', now, now)).lastInsertRowid;
  const tCasamento = (await run(insTypeSql, 'Cardápio para casamento', 'Menu elegante para cerimônias.', now, now)).lastInsertRowid;

  const insItemSql = 'INSERT OR IGNORE INTO dish_type_items (dish_type_id, dish_id, sort) VALUES (?, ?, ?)';
  const addTo = async (typeId, dishesArr) => {
    for (let i = 0; i < dishesArr.length; i++) await run(insItemSql, typeId, dishesArr[i], i);
  };

  await addTo(tTradicional, [canapés, frangoGrelhado, filéComFritas, arrozComBrócolis, batataFrita, sorvetePote, refriLata, sucoLaranja, aguaGelada]);
  await addTo(tInfantil, [batataFrita, frangoGrelhado, sorvetePote, churrosDoce, sucoLaranja, refriLata]);
  await addTo(tVegetariano, [ceasar, vegetariano, arrozComBrócolis, batataFrita, sorvetePote, sucoLaranja]);
  await addTo(tCorporativo, [frangoGrelhado, filéComFritas, arrozComBrócolis, salada, batataFrita, refriLata, aguaGelada, sorvetePote]);
  await addTo(tCasamento, [canapés, ceasar, churrasco, filéComFritas, churrosDoce, sorvetePote, refriLata, sucoLaranja, aguaGelada]);

  // -------- Festa de exemplo --------
  const insPartySql = `INSERT INTO parties (name, client_name, date, start_time, end_time, location, table_count, dish_type_id, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const partyDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const partyInfo = await run(
    insPartySql,
    'Festa de Aniversário do João', 'Maria Silva', partyDate, '19:00', '23:00',
    'Salão Espaço Verde', 10, tTradicional, 'ativa',
    'Festa infantil com recreação. Atenção a alergias a amendoim.',
    now, now
  );
  const partyId = partyInfo.lastInsertRowid;

  // Cardápio da festa
  const insPartyDishSql = 'INSERT OR IGNORE INTO party_dishes (party_id, dish_id, event_notes, sort, available, source) VALUES (?, ?, ?, ?, ?, ?)';
  const menuIds = [canapés, frangoGrelhado, filéComFritas, arrozComBrócolis, batataFrita, sorvetePote, churrosDoce, refriLata, sucoLaranja, aguaGelada];
  for (let i = 0; i < menuIds.length; i++) {
    await run(insPartyDishSql, partyId, menuIds[i], '', i, 1, 'cardapio');
  }

  // Prato exclusivo da festa
  const miniHamburger = await dish('Mini hambúrguer', 'especial', 'Mini hambúrguer com queijo (exclusivo da festa).', 'Montar em mini pão.');
  await defaultDishIng(miniHamburger, pao, queijo);
  await run(insPartyDishSql, partyId, miniHamburger, 'Favorito do aniversariante', 10, 1, 'evento_exclusivo');

  // Mesas
  const insTableSql = 'INSERT INTO party_tables (party_id, label, capacity, status, created_at) VALUES (?, ?, ?, ?, ?)';
  for (let i = 1; i <= 10; i++) {
    await run(insTableSql, partyId, `Mesa ${String(i).padStart(2, '0')}`, 8, 'livre', now);
  }

  // Usuários dos pedidos de exemplo. O admin é localizado pelo papel
  // (funciona mesmo com ADMIN_EMAIL personalizado no primeiro boot);
  // os demais são os usuários demo, sempre criados acima — com fallback para o admin.
  const admin = await get("SELECT id FROM users WHERE role = 'administrador' ORDER BY id LIMIT 1");
  if (!admin) throw new Error('Nenhum administrador encontrado para criar os dados de exemplo.');
  const demoUser = async (email) => (await get('SELECT id FROM users WHERE email = ?', email)) || admin;
  const atendente = await demoUser('atendente@buffet.local');
  const cozinheiro = await demoUser('cozinha@buffet.local');
  const entrega = await demoUser('entrega@buffet.local');

  // Pedidos de exemplo em vários status (para demonstrar o Kanban)
  const insOrderSql = `INSERT INTO orders (code, party_id, table_id, status, priority, notes, cancel_justification, created_by, created_at, updated_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const insOrderItemSql = 'INSERT INTO order_items (order_id, dish_id, dish_name, dish_category, quantity, notes, sort) VALUES (?, ?, ?, ?, ?, ?, ?)';
  const insRemovedSql = 'INSERT INTO order_item_removed (order_item_id, ingredient_id, ingredient_name, note) VALUES (?, ?, ?, ?)';
  const insAddedSql = 'INSERT INTO order_item_added (order_item_id, ingredient_id, ingredient_name, quantity, note) VALUES (?, ?, ?, ?, ?)';
  const insHistSql = 'INSERT INTO order_history (order_id, action, description, from_status, to_status, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)';

  const mkOrder = async (code, tableNo, status, user, at, notes = '', priority = 0, items, history = [], justification = '') => {
    const info = await run(insOrderSql, code, partyId, tableNo, status, priority, notes, justification, user, at, at, status === 'finalizado' || status === 'cancelado' ? at : null);
    const oid = info.lastInsertRowid;
    let sort = 0;
    for (const it of items) {
      const info2 = await run(insOrderItemSql, oid, it.dishId, it.name, it.cat, it.qty, it.notes || '', sort++);
      const iid = info2.lastInsertRowid;
      for (const r of (it.removed || [])) await run(insRemovedSql, iid, r.id, r.name, r.note || '');
      for (const a of (it.added || [])) await run(insAddedSql, iid, a.id, a.name, a.qty || '', a.note || '');
    }
    for (const h of history) {
      await run(insHistSql, oid, h.action, h.description, h.from || null, h.to || null, h.user, h.at);
    }
    if (!history.length) {
      await run(insHistSql, oid, 'created', `Pedido ${code} criado na Mesa ${tableNo}`, null, 'novo', user, at);
    }
    return oid;
  };

  const m1 = (await get('SELECT id FROM party_tables WHERE party_id = ? AND label = ?', partyId, 'Mesa 01')).id;
  const m2 = (await get('SELECT id FROM party_tables WHERE party_id = ? AND label = ?', partyId, 'Mesa 02')).id;
  const m3 = (await get('SELECT id FROM party_tables WHERE party_id = ? AND label = ?', partyId, 'Mesa 03')).id;
  const m4 = (await get('SELECT id FROM party_tables WHERE party_id = ? AND label = ?', partyId, 'Mesa 04')).id;

  const t0 = nowIso();
  // hora atual menos X minutos
  const ago = (mins) => {
    const d = new Date(Date.now() - mins * 60000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };

  await mkOrder('P-0001', m1, 'novo', atendente.id, ago(2), 'Cliente pediu molho à parte.', 1, [
    { dishId: filéComFritas, name: 'Filé com fritas', cat: 'principal', qty: 2,
      removed: [{ id: cebola, name: 'Cebola', note: '' }],
      added: [{ id: molho, name: 'Molho especial', qty: '2', note: 'à parte' }] },
    { dishId: refriLata, name: 'Refrigerante (lata)', cat: 'bebida', qty: 2, notes: '2 Guaraná' },
  ]);

  await mkOrder('P-0002', m2, 'em_preparo', atendente.id, ago(15), '', 0, [
    { dishId: frangoGrelhado, name: 'Frango grelhado', cat: 'principal', qty: 1, notes: 'Sem sal' },
    { dishId: batataFrita, name: 'Batata frita', cat: 'acompanhamento', qty: 1 },
  ], [
    { action: 'created', description: 'Pedido P-0002 criado na Mesa 02', from: null, to: 'novo', user: atendente.id, at: ago(15) },
    { action: 'status_changed', description: 'Cozinha iniciou o preparo', from: 'novo', to: 'em_preparo', user: cozinheiro.id, at: ago(12) },
  ]);

  await mkOrder('P-0003', m3, 'pronto', atendente.id, ago(30), 'Servir juntos', 0, [
    { dishId: miniHamburger, name: 'Mini hambúrguer', cat: 'especial', qty: 4 },
    { dishId: sucoLaranja, name: 'Suco de laranja', cat: 'bebida', qty: 2 },
  ], [
    { action: 'created', description: 'Pedido P-0003 criado na Mesa 03', from: null, to: 'novo', user: atendente.id, at: ago(30) },
    { action: 'status_changed', description: 'Cozinha iniciou o preparo', from: 'novo', to: 'em_preparo', user: cozinheiro.id, at: ago(27) },
    { action: 'status_changed', description: 'Cozinha finalizou o preparo', from: 'em_preparo', to: 'pronto', user: cozinheiro.id, at: ago(5) },
  ]);

  await mkOrder('P-0004', m4, 'entregue', atendente.id, ago(60), '', 0, [
    { dishId: ceasar, name: 'Salada Caesar', cat: 'salada', qty: 1,
      removed: [{ id: molho, name: 'Molho especial', note: 'alergia a mostarda' }],
      added: [{ id: tomate, name: 'Tomate', qty: '1', note: '' }] },
    { dishId: aguaGelada, name: 'Água', cat: 'bebida', qty: 1 },
  ], [
    { action: 'created', description: 'Pedido P-0004 criado na Mesa 04', from: null, to: 'novo', user: atendente.id, at: ago(60) },
    { action: 'status_changed', description: 'Cozinha iniciou o preparo', from: 'novo', to: 'em_preparo', user: cozinheiro.id, at: ago(55) },
    { action: 'status_changed', description: 'Cozinha finalizou o preparo', from: 'em_preparo', to: 'pronto', user: cozinheiro.id, at: ago(40) },
    { action: 'status_changed', description: 'Entregue à mesa', from: 'pronto', to: 'entregue', user: entrega.id, at: ago(35) },
  ]);

  // Histórico/auditoria inicial
  await run(
    'INSERT INTO audit_log (entity_type, entity_id, action, description, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    'system', null, 'seed', 'Dados de exemplo criados para demonstração.', admin.id, now
  );

  await run("UPDATE party_tables SET status = ? WHERE party_id = ? AND label IN (?, ?)", 'ocupada', partyId, 'Mesa 01', 'Mesa 02');
}

// ---------------------------------------------------------------------------
// init: schema + migrações + seed (idempotente — uma única execução)
// ---------------------------------------------------------------------------
let initPromise = null;
function init() {
  if (!initPromise) {
    initPromise = (async () => {
      if (IS_LIBSQL) {
        if (!libsql) initLibsqlClient();
      } else if (!sqlite) {
        initLocalConnection();
      }

      await exec(SCHEMA);
      if (!IS_LIBSQL) {
        migrateOrdersCheck();
        repairLegacyOrdersFks();
      }

      if (IS_LIBSQL) {
        // No serverless, evita rodar o seed completo a cada cold start:
        // só roda na primeira vez (banco vazio).
        const usersCountRow = await get('SELECT COUNT(*) AS c FROM users');
        if (!usersCountRow.c) await seed();
      } else {
        await seed();
      }
      return true;
    })();
  }
  return initPromise;
}

ready = init();

module.exports = {
  get,
  all,
  run,
  exec,
  tx,
  init,
  seed,
  seedSample,
  DB_PATH,
  IS_LIBSQL,
  ready,
};

// Execução direta: node server/db.js [--reset]
if (require.main === module) {
  init()
    .then(() => {
      console.log(`Banco pronto em ${IS_LIBSQL ? 'Turso (libsql)' : DB_PATH}`);
      process.exit(0);
    })
    .catch((e) => {
      console.error('Falha ao inicializar o banco:', e);
      process.exit(1);
    });
}