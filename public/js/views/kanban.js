'use strict';

import { api, hasPerm, isAdmin } from '../api.js';
import { esc, toast, spinner, emptyState, statusBadge, tableStatusBadge, ensureStatusMeta, statusMeta, statusLabel, nextOf } from '../ui.js';

export const title = 'Visão de pedidos';

/** Fallback estático usado APENAS se o registry ainda não carregou. */
const FALLBACK_STATUSES = [
  { key: 'novo', label: 'Novo', active: 1 },
  { key: 'em_preparo', label: 'Em preparo', active: 1 },
  { key: 'pronto', label: 'Pronto', active: 1 },
  { key: 'entregue', label: 'Entregue', active: 1 },
  { key: 'finalizado', label: 'Finalizado', active: 1 },
  { key: 'cancelado', label: 'Cancelado', active: 1 },
];

const state = {
  partyId: '',
  statuses: [],
  reloadTimer: null,
};

export async function render(container, params, route) {
  await ensureStatusMeta();
  container.innerHTML = `
    <div class="flex-between mb-2">
      <h1>Visão de pedidos</h1>
      <div class="flex gap-1">
        <a class="btn" href="#/orders/new">🧾 Novo pedido</a>
        <button class="btn btn-ghost" id="btn-refresh">🔄</button>
      </div>
    </div>
    <div class="toolbar">
      <select class="select" id="f-party"><option value="">Todas as festas</option></select>
      <select class="select" id="f-status" style="min-width:160px;">
        <option value="">Todos os status</option>
        ${statusOptions()}
      </select>
    </div>
    <div id="orders-list">${spinner()}</div>
  `;

  const parties = await api.get('/parties?all=1');
  const partySel = container.querySelector('#f-party');
  partySel.innerHTML = `<option value="">Todas as festas</option>` + parties.map((p) => `<option value="${p.id}" ${state.partyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  if (route.query.get('party')) {
    state.partyId = Number(route.query.get('party'));
    partySel.value = state.partyId;
  }

  const onSel = () => {
    state.partyId = partySel.value ? Number(partySel.value) : '';
    state.statuses = container.querySelector('#f-status').value ? [container.querySelector('#f-status').value] : [];
    load();
  };

  partySel.addEventListener('change', onSel);
  container.querySelector('#f-status').addEventListener('change', onSel);
  container.querySelector('#btn-refresh').addEventListener('click', load);

  load();
  state.reloadTimer = setInterval(load, 30000);
  container._cleanup = () => { clearInterval(state.reloadTimer); };
}

async function load() {
  const root = document.querySelector('#view #orders-list');
  if (!root) return;
  try {
    const qs = new URLSearchParams();
    if (state.partyId) qs.set('party_id', state.partyId);
    if (state.statuses.length) qs.set('status', state.statuses.join(','));
    qs.set('limit', '200');
    const orders = await api.get(`/orders?${qs}`);
    root.innerHTML = renderList(orders);
    bindActions(root);
  } catch (e) {
    root.innerHTML = emptyState('⚠️', e.message);
  }
}

/** Opções do filtro de status: ativos do registry (fallback estático se vazio). */
function statusOptions() {
  const list = (statusMeta().length ? statusMeta() : FALLBACK_STATUSES)
    .filter((s) => s.active === 1)
    .sort((a, b) => a.sort - b.sort || a.id - b.id);
  return list.map((s) => `<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('');
}

function renderList(orders) {
  const filtered = orders.map((o) => {
    const now = Date.now();
    o._elapsed = Math.max(0, Math.round((now - new Date(o.created_at.replace(' ', 'T')).getTime()) / 60000));
    return o;
  });
  filtered.sort((a, b) => (b.priority - a.priority) || (b._elapsed - a._elapsed));

  if (!filtered.length) {
    const label = state.statuses.length ? `no status "${statusLabel(state.statuses[0])}"` : '';
    return emptyState('📭', `Nenhum pedido encontrado${label ? ` ${label}` : ''} com os filtros.`);
  }

  return `
    <div class="grid grid-auto orders-grid" style="gap:.7rem;">
      ${filtered.map(rowHTML).join('')}
    </div>`;
}

/** Botão para avançar ao próximo status configurado (ou vazio quando não permitido/término). */
function nextButton(o) {
  const n = nextOf(o.status);
  if (!n) return '';
  const can = isAdmin() || !n.advance_perm || hasPerm(n.advance_perm);
  if (!can) return '';
  return `<button class="btn btn-sm btn-next" data-id="${o.id}" data-to="${n.key}" title="Mover para ${esc(n.label)}">→ ${esc(n.label)}</button>`;
}

function rowHTML(o) {
  const waitCls = o._elapsed > 30 ? 'k-row-late' : o._elapsed > 15 ? 'k-row-warn' : '';
  const items = (o.items || []).map((i) => `
    <div class="k-item" title="${esc(i.notes || '')}">
      <span class="qty">${i.quantity}×</span>
      <span style="flex:1; min-width:0;">${esc(i.dish_name || 'Prato')}</span>
      ${i.notes ? '<span class="text-3" title="Possui observação">📝</span>' : ''}
    </div>`).join('');

  return `
    <div class="card order-card ${waitCls} ${o.priority ? 'priority' : ''}" data-id="${o.id}" style="min-width:0;">
      <div class="flex-between" style="gap:.4rem; align-items:center; flex-wrap:wrap;">
        <a class="mono" style="font-weight:800; font-size:1.02rem;" href="#/orders/${o.id}">${esc(o.code)}</a>
        <div class="flex gap-1" style="align-items:center; flex-wrap:wrap;">
          ${statusBadge(o.status)}
          ${o.priority ? '<span class="badge b-danger" title="Prioridade alta">🔺</span>' : ''}
        </div>
      </div>
      <div class="text-2 mt-1" style="font-size:.85rem;">
        <div>🪑 ${esc(o.table_label)} ${o.table_status ? tableStatusBadge(o.table_status) : ''}</div>
        <div title="${esc(o.party_name)}">🎉 ${esc(o.party_name)}</div>
      </div>
      <div class="k-items">${items}</div>
      ${o.notes ? `<div class="k-notes">📝 ${esc(o.notes)}</div>` : ''}
      <div class="text-3 mt-1" style="font-size:.75rem;">🧑‍🍳 ${esc(o.created_by_name || '—')} · <span class="badge ${_waitBadge(o)}">⏱ ${o._elapsed} min</span></div>
      <div class="flex gap-1 mt-1" style="flex-wrap:wrap;">
        <a class="btn btn-sm btn-ghost" href="#/orders/${o.id}">Detalhes</a>
        ${nextButton(o)}
      </div>
    </div>`;
}

function _waitBadge(o) {
  if (o._elapsed > 30) return 'b-danger';
  if (o._elapsed > 15) return 'b-warn';
  return 'b-muted';
}

function bindActions(root) {
  root.querySelectorAll('.btn-next').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      const to = btn.dataset.to;
      btn.disabled = true;
      try {
        await api.patch(`/orders/${id}/status`, { status: to });
        toast(`Pedido movido para "${statusLabel(to)}".`);
        load();
      } catch (e) {
        toast(e.message, 'error');
        btn.disabled = false;
      }
    });
  });
}