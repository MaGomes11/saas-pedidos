'use strict';
/**
 * Smoke test E2E da API — cobre os critérios de aceite principais.
 * Uso: node scripts/smoke.js
 */
const BASE = process.env.BASE || 'http://localhost:3000';

let cookie = '';
let pass = 0, fail = 0;
const results = [];

function check(name, cond, extra = '') {
  if (cond) { pass++; results.push(`  ✅ ${name}`); }
  else { fail++; results.push(`  ❌ ${name} ${extra}`); }
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers['Cookie'] = cookie;
  if (token) headers['Cookie'] = token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, setCookie: res.headers.get('set-cookie') };
}

async function login(email, pwd) {
  const r = await api('POST', '/api/auth/login', { email, password: pwd });
  const sc = r.setCookie;
  if (sc) cookie = sc.split(';')[0];
  return r;
}

/** Login sem alterar o cookie global (para testar múltiplos perfis). */
async function loginTok(email, pwd) {
  const r = await api('POST', '/api/auth/login', { email, password: pwd });
  const sc = r.setCookie;
  return sc ? sc.split(';')[0] : null;
}

async function main() {
  console.log('\n== 1. Autenticação ==');
  const bad = await api('POST', '/api/auth/login', { email: 'admin@buffet.local', password: 'errada' });
  check('Login com senha errada é rejeitado (401)', bad.status === 401);
  const adm = await login('admin@buffet.local', 'admin123');
  check('Login admin OK', adm.status === 200 && adm.data.user?.role === 'administrador');
  const me = await api('GET', '/api/auth/me');
  check('GET /me autenticado', me.status === 200 && me.data.user?.email === 'admin@buffet.local');

  console.log('\n== 2. Cadastro de ingrediente ==');
  const ing = await api('POST', '/api/ingredients', { name: 'Teste Alecrim', can_remove: false, can_add: true });
  check('Criar ingrediente', ing.status === 201 && ing.data.name === 'Teste Alecrim');
  const ingId = ing.data.id;

  console.log('\n== 3. Cadastro de prato + composição ==');
  const dish = await api('POST', '/api/dishes', {
    name: 'Prato Smoke Test', description: 'Criado para teste', category: 'principal', prep_notes: 'Teste',
  });
  check('Criar prato', dish.status === 201 && dish.data.id > 0);
  const dishId = dish.data.id;
  const comp = await api('PUT', `/api/dishes/${dishId}/composition`, {
    ingredients: [
      { id: ingId, is_default: true, can_remove: false, can_add: true, sort: 0 },
    ],
  });
  check('Composição do prato (ingrediente padrão)', comp.status === 200 && comp.data.composition.length === 1 && comp.data.composition[0].is_default === 1);

  console.log('\n== 4. Tipo de cardápio + vínculo de pratos ==');
  const dt = await api('POST', '/api/dish-types', {
    name: 'Cardápio Smoke Test', description: 'Teste', dishes: [{ dish_id: dishId }],
  });
  check('Criar tipo de cardápio', [200, 201].includes(dt.status) && dt.data.id);
  const dtId = dt.data.id;
  const dtGet = await api('GET', `/api/dish-types/${dtId}`);
  check('Cardápio com prato vinculado', dtGet.data.dishes?.length === 1);

  console.log('\n== 5. Festa + cardápio + prato exclusivo + mesas ==');
  const party = await api('POST', '/api/parties', {
    name: 'Festa Smoke Test', client_name: 'Cliente T', date: '2030-01-10', start_time: '19:00',
    end_time: '23:00', location: 'Salão T', dish_type_id: dtId, status: 'ativa', table_count: 3,
  });
  check('Criar festa ativa', party.status === 201 && party.data.id);
  const partyId = party.data.id;

  const partyDetail = await api('GET', `/api/parties/${partyId}`);
  check('Cardápio sincronizado na festa', partyDetail.data.menu?.some((m) => m.dish_id === dishId && m.source === 'cardapio'));

  const excl = await api('POST', `/api/parties/${partyId}/dishes`, {
    name: 'Drink Exclusivo', description: 'Só nesta festa', category: 'bebida', event_notes: 'Exclusivo',
  });
  check('Prato exclusivo da festa criado', excl.status === 201);
  const exclDishId = excl.data.dish_id;

  const otherParty = await api('POST', '/api/parties', {
    name: 'Outra Festa', date: '2030-02-10', status: 'planejada', dish_type_id: dtId,
  });
  const otherDetail = await api('GET', `/api/parties/${otherParty.data.id}`);
  check('Prato exclusivo NÃO vaza para outra festa', !otherDetail.data.menu?.some((m) => m.dish_id === exclDishId));

  const tbl = await api('POST', `/api/parties/${partyId}/tables`, { label: 'Mesa T1', capacity: 6 });
  check('Criar mesa', tbl.status === 201);
  const tblId = tbl.data.id;
  const tblDup = await api('POST', `/api/parties/${partyId}/tables`, { label: 'Mesa T1' });
  check('Duplicidade de mesa na festa é bloqueada (409)', tblDup.status === 409);

  console.log('\n== 6. Pedido (sem valores) ==');
  const order = await api('POST', '/api/orders', {
    party_id: partyId, table_id: tblId, notes: 'Sem cebola',
    items: [
      {
        dish_id: dishId, quantity: 2, notes: 'bem passado',
        removed: [{ ingredient_id: ingId, note: 'alergia' }],
        added: [],
      },
      { dish_id: exclDishId, quantity: 1 },
    ],
  });
  check('Criar pedido', order.status === 201 && order.data.order?.code);
  const orderId = order.data.order.id;
  const code = order.data.order.code;
  check('Pedido começa como Novo', order.data.order.status === 'novo');
  check('Pedido tem itens com snapshot', order.data.order.items?.length === 2 && order.data.order.items[0].dish_name === 'Prato Smoke Test');
  check('Ingrediente retirado registrado', order.data.order.items[0].removed?.some((r) => r.ingredient_name === 'Teste Alecrim'));
  const noMoney = JSON.stringify(order.data).toLowerCase();
  check('Nenhum campo financeiro no pedido', !/(preco|valor|custo|total|desconto|pagamento|caixa)/.test(noMoney), JSON.stringify(order.data).slice(0, 300));

  // Duplicidade
  const dup = await api('POST', '/api/orders', {
    client_request_id: 'smoke-123', party_id: partyId, table_id: tblId,
    items: [{ dish_id: dishId, quantity: 1 }],
  });
  const dup2 = await api('POST', '/api/orders', {
    client_request_id: 'smoke-123', party_id: partyId, table_id: tblId,
    items: [{ dish_id: dishId, quantity: 1 }],
  });
  check('Idempotência de pedido (mesmo client_request_id)', (await api('POST', '/api/orders', { client_request_id: 'smoke-123', party_id: partyId, table_id: tblId, items: [{ dish_id: dishId, quantity: 1 }] })).status === 200);

  console.log('\n== 7. Visão de pedidos (fluxo de status) ==');
  const s1 = await api('PATCH', `/api/orders/${orderId}/status`, { status: 'em_preparo' });
  check('novo → em_preparo (cozinha/admin)', s1.status === 200 && s1.data.order.status === 'em_preparo');
  const s2 = await api('PATCH', `/api/orders/${orderId}/status`, { status: 'pronto' });
  check('em_preparo → pronto', s2.status === 200 && s2.data.order.status === 'pronto');
  const s3 = await api('PATCH', `/api/orders/${orderId}/status`, { status: 'entregue' });
  check('pronto → entregue', s3.status === 200 && s3.data.order.status === 'entregue');
  const s4 = await api('PATCH', `/api/orders/${orderId}/status`, { status: 'finalizado' });
  check('entregue → finalizado', s4.status === 200 && s4.data.order.status === 'finalizado');
  const hist = await api('GET', `/api/orders/${orderId}/history`);
  check('Histórico do pedido registrado', hist.data.length >= 5);

  console.log('\n== 7b. Status de pedidos (configuráveis) ==');
  const stList = await api('GET', '/api/order-statuses');
  check('Lista status padrão (6, novo = sistema)', stList.status === 200 && stList.data.length === 6 && stList.data.some((s) => s.key === 'novo' && s.is_system === 1));
  const stNew = await api('POST', '/api/order-statuses', { key: 'separado', label: 'Separado', color: 'warn', advance_perm: 'pedidos_cozinha_status' });
  check('Criar status personalizado', stNew.status === 201 && stNew.data.key === 'separado' && stNew.data.advance_perm === 'pedidos_cozinha_status');
  const stDup = await api('POST', '/api/order-statuses', { key: 'separado', label: 'Outro' });
  check('Chave duplicada bloqueada (409)', stDup.status === 409);
  const ateTok2 = await loginTok('atendente@buffet.local', 'atendente123');
  const stAte = await api('POST', '/api/order-statuses', { key: 'x2', label: 'X2' }, ateTok2);
  check('Atendente não gerencia status (403)', stAte.status === 403);
  const stUpd = await api('PATCH', `/api/order-statuses/${stNew.data.id}`, { label: 'Separado na cozinha', color: 'danger' });
  check('Editar status (nome/cor)', stUpd.status === 200 && stUpd.data.label === 'Separado na cozinha' && stUpd.data.color === 'danger');
  const stMove = await api('POST', `/api/order-statuses/${stNew.data.id}/move`, { dir: -1 });
  const movedKeys = stMove.data.map((s) => s.key);
  check('Mover status na ordem (▲ antes do finalizado)', stMove.status === 200 && movedKeys.indexOf('separado') < movedKeys.indexOf('finalizado'));
  const sysDel = await api('DELETE', `/api/order-statuses/${stList.data.find((s) => s.key === 'novo').id}`);
  check('Excluir status de sistema bloqueado (400)', sysDel.status === 400);
  const finId = stList.data.find((s) => s.key === 'finalizado').id;
  const inUseDel = await api('DELETE', `/api/order-statuses/${finId}`);
  check('Excluir status em uso bloqueado (400)', inUseDel.status === 400);
  const stDel = await api('DELETE', `/api/order-statuses/${stNew.data.id}`);
  check('Excluir status personalizado', stDel.status === 200);

  console.log('\n== 7c. CRUD de categorias de pratos ==');
  const catList = await api('GET', '/api/categories');
  check('Listar categorias (7 seedadas + contagem de pratos)', catList.status === 200 && catList.data.length === 7 && 'dish_count' in catList.data[0]);
  const catNew = await api('POST', '/api/categories', { key: 'grelhados', name: 'Grelhados' });
  check('Criar categoria', catNew.status === 201 && catNew.data.key === 'grelhados' && catNew.data.dish_count === 0);
  const catDup = await api('POST', '/api/categories', { key: 'grelhados', name: 'Duplicada' });
  check('Chave duplicada bloqueada (409)', catDup.status === 409);
  const catBadKey = await api('POST', '/api/categories', { key: 'Grelhados!', name: 'Inválida' });
  check('Chave inválida bloqueada (400)', catBadKey.status === 400);
  const catNoName = await api('POST', '/api/categories', { key: 'sem_nome', name: '' });
  check('Nome obrigatório (400)', catNoName.status === 400);
  const catAteTok = await loginTok('atendente@buffet.local', 'atendente123');
  const catAte = await api('POST', '/api/categories', { key: 'xcat', name: 'X' }, catAteTok);
  check('Atendente não gerencia categorias (403)', catAte.status === 403);
  const catUpd = await api('PATCH', '/api/categories/grelhados', { name: 'Grelhados na brasa' });
  check('Editar categoria (nome)', catUpd.status === 200 && catUpd.data.name === 'Grelhados na brasa');
  const catMove = await api('POST', '/api/categories/grelhados/move', { dir: -1 });
  const catKeys = catMove.data.map((c) => c.key);
  check('Mover categoria na ordem (▲ antes de especial)', catMove.status === 200 && catKeys.indexOf('grelhados') < catKeys.indexOf('especial'));
  const catInUse = await api('DELETE', '/api/categories/entrada');
  check('Excluir categoria em uso bloqueado (400)', catInUse.status === 400);
  const catDel = await api('DELETE', '/api/categories/grelhados');
  check('Excluir categoria sem pratos', catDel.status === 200);

  console.log('\n== 7d. Configurações da empresa / branding ==');
  const sPub = await api('GET', '/api/settings/public');
  check('Branding público (Saas Pedidos)', sPub.status === 200 && sPub.data.system_name === 'Saas Pedidos');
  const sAll = await api('GET', '/api/settings');
  check('Listar configurações (6 chaves)', sAll.status === 200 && Object.keys(sAll.data).length === 6);
  const sAteTok = await loginTok('atendente@buffet.local', 'atendente123');
  const sAte = await api('PUT', '/api/settings', { system_name: 'X' }, sAteTok);
  check('Atendente não configura a empresa (403)', sAte.status === 403);
  const sUpd = await api('PUT', '/api/settings', { system_name: 'Saas Pedidos', company_name: 'Smoke Festas Ltda', company_address: 'Av. Teste, 1' });
  check('Salvar informações da empresa', sUpd.status === 200 && sUpd.data.company_name === 'Smoke Festas Ltda');
  const sEmpty = await api('PUT', '/api/settings', { system_name: '  ' });
  check('Nome do sistema vazio bloqueado (400)', sEmpty.status === 400);
  const sRestore = await api('PUT', '/api/settings', { system_name: 'Saas Pedidos', company_name: '', company_address: '' });
  check('Restaurar padrão demo', sRestore.status === 200 && sRestore.data.system_name === 'Saas Pedidos');

  console.log('\n== 8. Regras ==');
  const cancelNoJust = await api('POST', '/api/orders', { party_id: partyId, table_id: tblId, items: [{ dish_id: dishId, quantity: 1 }] });
  const cj = await api('PATCH', `/api/orders/${cancelNoJust.data.order.id}/status`, { status: 'cancelado', justification: '' });
  check('Cancelamento exige justificativa (400)', cj.status === 400);
  const cj2 = await api('PATCH', `/api/orders/${cancelNoJust.data.order.id}/status`, { status: 'cancelado', justification: 'Cliente desistiu' });
  check('Cancelamento com justificativa', cj2.status === 200 && cj2.data.order.status === 'cancelado');

  // Festa encerrada não aceita pedidos
  await api('PUT', `/api/parties/${partyId}/status`, { status: 'encerrada' });
  const blocked = await api('POST', '/api/orders', { party_id: partyId, table_id: tblId, items: [{ dish_id: dishId, quantity: 1 }] });
  check('Festa encerrada bloqueia novos pedidos (409)', blocked.status === 409);
  await api('PUT', `/api/parties/${partyId}/status`, { status: 'ativa' });

  console.log('\n== 8b. Notificações ==');
  const unread = await api('GET', '/api/notifications/unread-count');
  check('Notificação criada ao lançar pedido', unread.status === 200 && unread.data.count >= 1);
  const notifs = await api('GET', '/api/notifications');
  check('Lista de notificações contém novo pedido', notifs.data.some((n) => n.type === 'new_order' && n.order_id === orderId));

  console.log('\n== 8c. Permissões por perfil ==');
  const cozTok = await loginTok('cozinha@buffet.local', 'cozinha123');
  check('Login cozinha OK', !!cozTok);
  const cozOrder = await api('POST', '/api/orders', { party_id: partyId, table_id: tblId, items: [{ dish_id: dishId, quantity: 1 }] }, cozTok);
  check('Cozinha não pode criar pedido (403)', cozOrder.status === 403);
  const cozUsers = await api('GET', '/api/users', undefined, cozTok);
  check('Cozinha não gerencia usuários (403)', cozUsers.status === 403);
  const cozIng = await api('POST', '/api/ingredients', { name: 'Bloqueado' }, cozTok);
  check('Cozinha não gerencia ingredientes (403)', cozIng.status === 403);
  // Cozinha pode mover status no fluxo próprio (novo → em_preparo → pronto)
  const cozOrder2 = await api('POST', '/api/orders', { party_id: partyId, table_id: tblId, items: [{ dish_id: dishId, quantity: 1 }] });
  const cozMove = await api('PATCH', `/api/orders/${cozOrder2.data.order.id}/status`, { status: 'em_preparo' }, cozTok);
  check('Cozinha move novo → em_preparo', cozMove.status === 200);
  // Entrega não pode mover para em_preparo (fluxo da cozinha)
  const entTok = await loginTok('entrega@buffet.local', 'entrega123');
  const entMove = await api('PATCH', `/api/orders/${cozOrder2.data.order.id}/status`, { status: 'pronto' }, entTok);
  check('Entrega não move status da cozinha (403)', entMove.status === 403);

  console.log('\n== 8d. Perfis e permissões (admin) ==');
  const permGet = await api('GET', '/api/users/roles/atendente/permissions');
  check('Consulta permissões do perfil', permGet.status === 200 && Array.isArray(permGet.data.permissions));
  const adminGuard = await api('PUT', '/api/users/roles/administrador/permissions', { permissions: [] });
  check('Perfil admin não tem permissões alteráveis (400)', adminGuard.status === 400);
  const permChange = await api('PUT', '/api/users/roles/atendente/permissions', { permissions: permGet.data.permissions });
  check('Gravar permissões de um perfil', permChange.status === 200 && permChange.data.permissions.length === permGet.data.permissions.length);

  console.log('\n== 8e. Edição de pedidos ==');
  const editOrder = await api('POST', '/api/orders', { party_id: partyId, table_id: tblId, items: [{ dish_id: dishId, quantity: 1 }] });
  const editId = editOrder.data.order.id;
  const editOk = await api('PUT', `/api/orders/${editId}`, {
    notes: 'Sem molho', items: [{ id: editOrder.data.order.items[0].id, dish_id: dishId, quantity: 2, removed: [], added: [] }],
  });
  check('Editar pedido em "novo" (quantidade 1→2)', editOk.status === 200 && editOk.data.order.items[0].quantity === 2);
  for (const st of ['em_preparo', 'pronto', 'entregue', 'finalizado']) {
    await api('PATCH', `/api/orders/${editId}/status`, { status: st });
  }
  const ateTok = await loginTok('atendente@buffet.local', 'atendente123');
  const editBlocked = await api('PUT', `/api/orders/${editId}`, { notes: 'x', items: [{ dish_id: dishId, quantity: 1 }] }, ateTok);
  check('Editar pedido finalizado bloqueado (409)', editBlocked.status === 409);
  const adminEdit = await api('PUT', `/api/orders/${editId}`, { notes: 'Correção do admin', items: [{ dish_id: dishId, quantity: 1 }] });
  check('Admin edita pedido finalizado (pedidos_editar_finalizados)', adminEdit.status === 200);

  console.log('\n== 8f. Inativos preservam histórico ==');
  const deact = await api('PUT', `/api/dishes/${dishId}`, { active: false });
  check('Prato inativado (sem exclusão)', deact.status === 200 && deact.data.active === 0);
  const dishSearch = await api('GET', `/api/orders?dish=${encodeURIComponent('Prato Smoke Test')}`);
  check('Histórico mantém pedidos do prato inativo', dishSearch.data.some((o) => o.code === code));
  await api('PUT', `/api/dishes/${dishId}`, { active: true });
  const ingDeact = await api('PUT', `/api/ingredients/${ingId}`, { active: false });
  check('Ingrediente inativado', ingDeact.status === 200 && ingDeact.data.active === 0);
  const ingSearch2 = await api('GET', `/api/orders?ingredient=${encodeURIComponent('Teste Alecrim')}`);
  check('Snapshot preserva ingrediente inativo no pedido', ingSearch2.data.length >= 1);

  console.log('\n== 8g. Cardápio da festa e mesas ==');
  const unlink = await api('DELETE', `/api/parties/${partyId}/dishes/${exclDishId}`);
  check('Desvincular prato exclusivo do cardápio', unlink.status === 200);
  const orderUnlink = await api('POST', '/api/orders', { party_id: partyId, table_id: tblId, items: [{ dish_id: exclDishId, quantity: 1 }] });
  check('Pedido com prato desvinculado é bloqueado (400)', orderUnlink.status === 400);
  const relink = await api('PUT', `/api/parties/${partyId}/dishes`, { dishIds: [exclDishId] });
  check('Revincular prato ao cardápio', relink.status === 200 && relink.data.linked === 1);

  const tblDel = await api('DELETE', `/api/parties/${partyId}/tables/${tblId}`);
  check('Mesa com pedidos não pode ser excluída (409)', tblDel.status === 409);
  const freeTbl = await api('POST', `/api/parties/${partyId}/tables`, { label: 'Mesa Descartável' });
  check('Criar mesa sem pedidos', freeTbl.status === 201);
  const freeDel = await api('DELETE', `/api/parties/${partyId}/tables/${freeTbl.data.id}`);
  check('Mesa sem pedidos pode ser excluída', freeDel.status === 200);

  console.log('\n== 8h. Dashboard filtrado e auditoria ==');
  const dashFilt = await api('GET', `/api/dashboard?party_id=${partyId}`);
  check('Dashboard com filtro de festa', dashFilt.status === 200 && dashFilt.data.partyFilter === partyId && typeof dashFilt.data.statusCounts?.novo === 'number');
  const audits = await api('GET', '/api/history');
  check('Auditoria registra ações', Array.isArray(audits.data) && audits.data.length > 0);
  const byPartyTbl = await api('GET', `/api/orders?party_id=${partyId}&table_id=${tblId}`);
  check('Consultar pedidos por festa + mesa', byPartyTbl.data.some((o) => o.code === code));

  console.log('\n== 9. Dashboard / busca ==');
  const dash = await api('GET', '/api/dashboard');
  check('Dashboard responde', dash.status === 200 && typeof dash.data.statusCounts?.novo === 'number');
  const search = await api('GET', `/api/orders?q=${encodeURIComponent(code)}`);
  check('Busca por número do pedido', search.data.some((o) => o.code === code));
  const byIngredient = await api('GET', `/api/orders?ingredient=${encodeURIComponent('Alecrim')}`);
  check('Busca por ingrediente retirado', byIngredient.data.some((o) => o.code === code));
  const byCat = await api('GET', `/api/orders?category=principal`);
  check('Filtro por categoria (principal)', byCat.data.some((o) => o.code === code));
  const byCatEmpty = await api('GET', `/api/orders?category=salada`);
  check('Filtro por categoria sem itens (vazio)', !byCatEmpty.data.some((o) => o.code === code));

  console.log('\n== 10. Logout ==');
  const out = await api('POST', '/api/auth/logout');
  check('Logout', out.status === 200);
  cookie = '';
  const after = await api('GET', '/api/auth/me');
  check('Sessão encerrada após logout (401)', after.status === 401);

  console.log(`\n====================`);
  console.log(`RESULTADO: ${pass} passaram, ${fail} falharam`);
  results.forEach((r) => console.log(r));
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('ERRO no smoke test:', e); process.exit(1); });