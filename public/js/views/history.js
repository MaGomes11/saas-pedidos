'use strict';

import { api } from '../api.js';
import { esc, formatDT, spinner, emptyState, debounce, statusBadge } from '../ui.js';

export const title = 'Histórico';

const state = { tab: 'orders', partyId: '', q: '', dateFrom: '', dateTo: '' };

export async function render(container, params, route) {
  const parties = await api.get('/parties?all=1').catch(() => []);
  container.innerHTML = `
    <h1 class="mb-2">Histórico</h1>
    <div class="tabs">
      <a href="#/history" data-tab="orders" class="${state.tab !== 'audit' ? 'active' : ''}">📦 Movimentações de pedidos</a>
      <a href="#/history" data-tab="audit" class="${state.tab === 'audit' ? 'active' : ''}">🛡️ Auditoria do sistema</a>
    </div>
    <div class="toolbar">
      <select class="select" id="f-party"><option value="">Todas as festas</option>${parties.map((p) => `<option value="${p.id}" ${state.partyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      <div class="input-group"><input class="input" id="f-q" placeholder="🔎 Texto..." value="${esc(state.q)}" /></div>
      <input class="input" type="date" id="f-d1" value="${esc(state.dateFrom)}" />
      <input class="input" type="date" id="f-d2" value="${esc(state.dateTo)}" />
    </div>
    <div id="hist-list">${spinner()}</div>
  `;

  container.querySelectorAll('.tabs a').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      state.tab = a.dataset.tab;
      location.hash = state.tab === 'audit' ? '#/history?tab=audit' : '#/history';
      location.reload();
    });
  });

  const qInput = container.querySelector('#f-q');
  qInput.addEventListener('input', debounce(() => { state.q = qInput.value.trim(); load(container); }, 350));
  container.querySelector('#f-party').addEventListener('change', (e) => { state.partyId = e.target.value ? Number(e.target.value) : ''; load(container); });
  container.querySelector('#f-d1').addEventListener('change', (e) => { state.dateFrom = e.target.value; load(container); });
  container.querySelector('#f-d2').addEventListener('change', (e) => { state.dateTo = e.target.value; load(container); });

  if (route.query.get('tab') === 'audit') {
    state.tab = 'audit';
    container.querySelector('.tabs a[data-tab="orders"]').classList.remove('active');
    container.querySelector('.tabs a[data-tab="audit"]').classList.add('active');
  }
  load(container);
}

async function load() {
  const root = document.querySelector('#view');
  const listEl = root.querySelector('#hist-list');
  try {
    const qs = new URLSearchParams();
    if (state.q) {
      if (state.tab === 'audit') qs.set('q', state.q); else qs.set('q', state.q);
    }
    if (state.partyId) {
      if (state.tab === 'orders') qs.set('party_id', state.partyId);
    }
    if (state.dateFrom) qs.set('date_from', state.dateFrom);
    if (state.dateTo) qs.set('date_to', state.dateTo);
    qs.set('limit', '300');
    const rows = state.tab === 'audit'
      ? await api.get(`/history?${qs}`)
      : await api.get(`/history/orders?${qs}`);

    listEl.innerHTML = rows.length ? `
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>${state.tab === 'audit' ? 'Entidade' : 'Pedido'}</th><th>Ação</th><th>Descrição</th><th>Usuário</th><th>Data/Hora</th></tr></thead>
        <tbody>${rows.map((r) => {
          const entanglement = state.tab === 'audit' ? esc(`${r.entity_type}${r.entity_id ? ' #' + r.entity_id : ''}`) : `<a class="mono" href="#/orders/${r.order_id}">${esc(r.order_code)}</a> · ${esc(r.party_name)}`;
          return `<tr>
            <td style="white-space:nowrap;">${entanglement}</td>
            <td>${statusBadge(r.to_status || '', 'b-muted')} <span class="text-3" style="font-size:.8rem;">${esc(r.action)}</span></td>
            <td style="max-width:420px;">${esc(r.description)}</td>
            <td>${esc(r.user_name || '—')}</td>
            <td style="white-space:nowrap;">${esc(formatDT(r.created_at))}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : emptyState('🗂️', 'Nenhum registro encontrado.');
  } catch (e) {
    listEl.innerHTML = emptyState('⚠️', e.message);
  }
}