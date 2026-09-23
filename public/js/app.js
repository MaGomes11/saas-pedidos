'use strict';

import { api, setSession, currentUser, hasPerm } from './api.js';
import { esc, toast, beep, el, setStatusMeta } from './ui.js';

const view = document.getElementById('view');
const navList = document.getElementById('nav-list');
const sidebar = document.getElementById('sidebar');
const backdrop = document.getElementById('sidebar-backdrop');

let currentRoute = null;
let eventSource = null;
let systemName = 'Saas Pedidos';

// ---------------------------------------------------------------------------
// Identidade / branding do sistema
// ---------------------------------------------------------------------------
function applyBrandName(name) {
  const clean = String(name || '').trim() || 'Saas Pedidos';
  systemName = clean;
  const parts = clean.split(/\s+/);
  const elBrand = document.getElementById('brand-name');
  if (elBrand) {
    elBrand.innerHTML = parts.length > 1
      ? `${esc(parts[0])} <strong>${esc(parts.slice(1).join(' '))}</strong>`
      : `<strong>${esc(clean)}</strong>`;
  }
}

/** Recarrega a identidade (nome do sistema) do backend e aplica no branding. */
async function refreshBranding() {
  try {
    const s = await api.get('/settings/public');
    applyBrandName(s.system_name);
  } catch {
    applyBrandName(systemName);
  }
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------
const ROUTES = [
  { pattern: '/login', view: 'login', public: true },
  { pattern: '/dashboard', view: 'dashboard' },
  { pattern: '/orders/new', view: 'orderNew', perm: 'pedidos_criar' },
  { pattern: '/orders/:id', view: 'orderDetail' },
  { pattern: '/orders', view: 'orders' },
  { pattern: '/kanban', view: 'kanban' },
  { pattern: '/order-statuses', view: 'orderStatuses', perm: 'statuses_gerenciar' },
  { pattern: '/categories', view: 'categories', perm: 'categorias_gerenciar' },
  { pattern: '/settings', view: 'settings', perm: 'configuracoes_gerenciar' },
  { pattern: '/parties/new', view: 'partyForm' },
  { pattern: '/parties/:id/edit', view: 'partyForm' },
  { pattern: '/parties/:id/menu', view: 'partyMenu' },
  { pattern: '/parties/:id/tables', view: 'tables' },
  { pattern: '/parties/:id', view: 'partyDetail' },
  { pattern: '/parties', view: 'parties' },
  { pattern: '/dish-types', view: 'dishTypes', perm: 'cardapios_gerenciar' },
  { pattern: '/dishes', view: 'dishes', perm: 'pratos_gerenciar' },
  { pattern: '/ingredients', view: 'ingredients', perm: 'ingredientes_gerenciar' },
  { pattern: '/history', view: 'history', perm: 'historico_visualizar' },
  { pattern: '/users', view: 'users', perm: 'usuarios_gerenciar' },
];

const NAV = [
  { label: 'Dashboard', icon: '📊', hash: '#/dashboard' },
  { label: 'Lançar pedido', icon: '🧾', hash: '#/orders/new', perm: 'pedidos_criar' },
  { label: 'Visão de pedidos', icon: '📋', hash: '#/kanban' },
  { label: 'Pedidos', icon: '📦', hash: '#/orders' },
  { label: 'Festas', icon: '🎉', hash: '#/parties' },
];

const NAV_ADMIN = [
  { label: 'Tipos de cardápio', icon: '📒', hash: '#/dish-types', perm: 'cardapios_gerenciar' },
  { label: 'Pratos', icon: '🍲', hash: '#/dishes', perm: 'pratos_gerenciar' },
  { label: 'Categorias', icon: '🗂️', hash: '#/categories', perm: 'categorias_gerenciar' },
  { label: 'Ingredientes', icon: '🥕', hash: '#/ingredients', perm: 'ingredientes_gerenciar' },
  { label: 'Status de pedidos', icon: '🏷️', hash: '#/order-statuses', perm: 'statuses_gerenciar' },
  { label: 'Configurações', icon: '🛠️', hash: '#/settings', perm: 'configuracoes_gerenciar' },
  { label: 'Usuários', icon: '👥', hash: '#/users', perm: 'usuarios_gerenciar' },
];

function matchRoute(hash) {
  const clean = hash.split('?')[0];
  const parts = clean.replace(/^#\//, '').split('/').filter(Boolean);
  for (const r of ROUTES) {
    const rp = r.pattern.replace(/^\//, '').split('/').filter(Boolean);
    if (rp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (rp[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) {
      const query = new URLSearchParams(hash.split('?')[1] || '');
      return { ...r, params, query };
    }
  }
  return null;
}

async function renderRoute() {
  const hash = location.hash || '#/dashboard';
  const route = matchRoute(hash);

  // Redireciona não autenticado
  if (!currentUser() && !(route && route.public)) {
    location.hash = '#/login';
    return;
  }
  if (currentUser() && route && route.pattern === '/login') {
    location.hash = '#/dashboard';
    return;
  }
  if (!route) {
    view.innerHTML = '<div class="empty"><div class="empty-ico">🧭</div><p>Página não encontrada.</p><button class="btn btn-ghost mt-2" data-goto="dashboard">Ir ao dashboard</button></div>';
    return;
  }
  if (route.perm && !hasPerm(route.perm)) {
    toast('Você não tem permissão para acessar esta tela.', 'error');
    location.hash = '#/dashboard';
    return;
  }

  currentRoute = route;
  view.dataset.loading = '1';
  try {
    const mod = await import(`./views/${route.view}.js`);
    document.title = `${mod.title || route.view} · ${systemName}`;
    view.classList.add('fade-in');
    view.innerHTML = '';
    if (view._cleanup) { try { view._cleanup(); } catch (e) { /* ignore */ } view._cleanup = null; }
    await mod.render(view, route.params, route);
    view.focus?.();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><div class="empty-ico">💥</div><p>Erro ao carregar a tela.</p><p class="text-3">${esc(e.message)}</p></div>`;
  }
  delete view.dataset.loading;
  buildNav(route);
  closeSidebar();
}

// ---------------------------------------------------------------------------
// Navegação
// ---------------------------------------------------------------------------
function buildNav(activeRoute) {
  const activeHash = location.hash.split('?')[0];
  const items = NAV.filter((n) => !n.perm || hasPerm(n.perm));
  const adminItems = NAV_ADMIN.filter((n) => hasPerm(n.perm));
  const html = `
    ${items.map((n) => `<li><a href="${n.hash}" class="${activeHash === n.hash ? 'active' : ''}"><span class="ico">${n.icon}</span>${esc(n.label)}</a></li>`).join('')}
    ${adminItems.length ? `<li class="nav-sec">Administração</li>
      ${adminItems.map((n) => `<li><a href="${n.hash}" class="${activeHash === n.hash ? 'active' : ''}"><span class="ico">${n.icon}</span>${esc(n.label)}</a></li>`).join('')}` : ''}
    ${hasPerm('historico_visualizar') ? `<li class="nav-sec">Acompanhamento</li>
      <li><a href="#/history" class="${activeHash === '#/history' ? 'active' : ''}"><span class="ico">🕓</span>Histórico</a></li>` : ''}
  `;
  navList.innerHTML = html;
}

function openSidebar() { sidebar.classList.add('open'); backdrop.hidden = false; }
function closeSidebar() { sidebar.classList.remove('open'); backdrop.hidden = true; }

// ---------------------------------------------------------------------------
// Notificações
// ---------------------------------------------------------------------------
const notifPanel = document.getElementById('notif-panel');
const notifList = document.getElementById('notif-list');
const notifCount = document.getElementById('notif-count');

async function refreshNotifBadge() {
  if (!currentUser() || !hasPerm('notificacoes_visualizar')) return;
  try {
    const r = await api.get('/notifications/unread-count');
    notifCount.hidden = r.count === 0;
    notifCount.textContent = r.count > 99 ? '99+' : r.count;
  } catch { /* ignore */ }
}

async function openNotifPanel() {
  if (!hasPerm('notificacoes_visualizar')) return;
  const rows = await api.get('/notifications?limit=50');
  notifPanel.hidden = !notifPanel.hidden;
  if (notifPanel.hidden) return;
  notifList.innerHTML = rows.length
    ? rows.map((n) => `<div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
        <strong>${esc(n.title)}</strong>
        <div>${esc(n.message)}</div>
        <small>${new Date(n.created_at.replace(' ', 'T')).toLocaleString('pt-BR')}</small>
      </div>`).join('')
    : '<div class="empty"><p>Nenhuma notificação.</p></div>';
  notifList.querySelectorAll('.notif-item').forEach((item) => {
    item.onclick = async () => {
      const id = Number(item.dataset.id);
      await api.put(`/notifications/${id}/read`).catch(() => {});
      item.classList.remove('unread');
      refreshNotifBadge();
      const orderId = rows.find((r) => r.id === id)?.order_id;
      if (orderId) { notifPanel.hidden = true; location.hash = `#/orders/${orderId}`; }
    };
  });
}

// ---------------------------------------------------------------------------
// SSE (tempo real)
// ---------------------------------------------------------------------------
function connectSSE() {
  if (eventSource) { eventSource.close(); eventSource = null; }
  if (!currentUser()) return;
  eventSource = new EventSource('/api/events');
  let lastNotifAt = Date.now();

  eventSource.addEventListener('order:new', (ev) => {
    const d = JSON.parse(ev.data || '{}');
    refreshNotifBadge();
    const onKanban = location.hash === '#/kanban';
    if (onKanban) {
      toast(`Novo pedido ${d.code || ''} · ${d.tableLabel || ''}`, 'info');
      beep(2);
    }
    maybeRefresh(d);
  });
  eventSource.addEventListener('order:status', (ev) => {
    const d = JSON.parse(ev.data || '{}');
    if (d.to === 'pronto' && (currentUser().role === 'entrega' || currentUser().role === 'administrador')) {
      toast(`Pedido ${d.code} pronto para entrega`, 'info');
    }
    if (location.hash === '#/kanban') renderRoute();
    maybeRefresh(d);
  });
  eventSource.addEventListener('order:edited', () => {
    if (['#/kanban', '#/orders'].includes(location.hash) || location.hash.startsWith('#/orders/')) renderRoute();
  });
  eventSource.addEventListener('notification', () => {
    refreshNotifBadge();
    // evita toast em cascata
    if (Date.now() - lastNotifAt > 5000) { lastNotifAt = Date.now(); if (location.hash === '#/kanban') beep(1); }
  });
}

function maybeRefresh(d) {
  const h = location.hash;
  if (h === '#/kanban' || h === '#/orders' || h === '#/dashboard' || h.startsWith('#/parties/')) {
    // Re-render apenas se já não estiver no meio de um render
    if (!view.dataset.loading) renderRoute();
  }
}

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------
async function doLogin(email, password) {
  const r = await api.post('/auth/login', { email, password });
  setSession(r.user, r.permissions);
  refreshStatusMeta();
  refreshBranding();
  refreshNotifBadge();
  connectSSE();
  location.hash = '#/dashboard';
  return r.user;
}

// Carrega o registry de status (badges, filtros, próximo status) uma vez
async function refreshStatusMeta() {
  if (!currentUser()) return;
  try {
    setStatusMeta(await api.get('/order-statuses'));
  } catch {
    // registry fica vazio; badges usam fallback estático
  }
}

async function doLogout() {
  await api.post('/auth/logout').catch(() => {});
  setSession(null, []);
  if (eventSource) { eventSource.close(); eventSource = null; }
  notifCount.hidden = true;
  notifPanel.hidden = true;
  location.hash = '#/login';
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------
function setupTopbar() {
  const chip = document.getElementById('user-chip');
  const menu = document.getElementById('user-menu');
  chip.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => { menu.hidden = true; notifPanel.hidden = true; });
  document.getElementById('btn-logout').onclick = (e) => { e.preventDefault(); doLogout(); };
  document.getElementById('btn-notif').onclick = (e) => { e.stopPropagation(); openNotifPanel(); };
  document.getElementById('btn-notif-all').onclick = async (e) => {
    e.stopPropagation();
    await api.put('/notifications/read-all').catch(() => {});
    refreshNotifBadge();
    notifList.querySelectorAll('.notif-item').forEach((i) => i.classList.remove('unread'));
    toast('Notificações marcadas como lidas.');
  };
  document.getElementById('btn-menu').onclick = () => {
    if (window.matchMedia('(max-width: 860px)').matches) {
      sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    } else {
      document.body.classList.toggle('nav-collapsed');
    }
  };
  backdrop.onclick = closeSidebar;
}

function renderUserChip() {
  const u = currentUser();
  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  const av = document.getElementById('user-avatar');
  const roleNames = { administrador: 'Administrador', atendente: 'Atendente', cozinha: 'Cozinha', entrega: 'Entrega' };
  if (!u) {
    nameEl.textContent = '—'; roleEl.textContent = ''; av.textContent = '?';
    return;
  }
  nameEl.textContent = u.name;
  roleEl.textContent = roleNames[u.role] || u.role;
  av.textContent = (u.name || '?').trim().charAt(0).toUpperCase();
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
async function boot() {
  setupTopbar();
  window.addEventListener('hashchange', renderRoute);

  applyBrandName(systemName);
  refreshBranding();

  // Restaura sessão
  try {
    const r = await api.get('/auth/me');
    setSession(r.user, r.permissions);
  } catch {
    setSession(null, []);
  }

  renderUserChip();
  if (currentUser()) {
    refreshStatusMeta();
    refreshNotifBadge();
    connectSSE();
  }
  if (!location.hash || location.hash === '#') location.hash = '#/dashboard';
  else renderRoute();
}

// Disponibiliza para as views
window.__app = { doLogin, doLogout, renderRoute, refreshBranding };

boot();