'use strict';

import { api } from '../api.js';
import { esc, formatDT, statusBadge, spinner, emptyState, ensureStatusMeta } from '../ui.js';

export const title = 'Pedidos';

const state = {
  partyId: '',
  category: '',
  q: '', // filtro oculto preenchido via ?code= (link "último pedido" da mesa)
};

export async function render(container, params, route) {
  await ensureStatusMeta();
  const parties = await api.get('/parties?all=1');
  const categories = await api.get('/categories').catch(() => []);

  const qCode = route.query.get('code');
  if (qCode) state.q = qCode;

  container.innerHTML = `
    <div class="flex-between mb-2">
      <h1>Pedidos</h1>
      <a class="btn" href="#/orders/new">🧾 Novo pedido</a>
    </div>
    <div class="card mb-2">
      <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:.6rem;">
        <div class="field" style="margin:0;"><label>Festa</label>
          <select class="select" id="f-party"><option value="">Todas</option>${parties.map((p) => `<option value="${p.id}" ${state.partyId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field" style="margin:0;"><label>Categoria</label>
          <select class="select" id="f-cat"><option value="">Todas</option>${categories.map((c) => `<option value="${esc(c.key)}" ${state.category === c.key ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      </div>
      <div class="flex gap-1 mt-1">
        <button class="btn btn-ghost" id="btn-clear">Limpar filtros</button>
      </div>
    </div>
    <div id="orders-list">${spinner()}</div>
  `;

  const partySel = container.querySelector('#f-party');
  const catSel = container.querySelector('#f-cat');

  const collect = () => {
    state.partyId = partySel.value ? Number(partySel.value) : '';
    state.category = catSel.value;
  };

  partySel.addEventListener('change', () => { collect(); load(); });
  catSel.addEventListener('change', () => { collect(); load(); });
  container.querySelector('#btn-clear').addEventListener('click', () => { location.hash = '#/orders'; location.reload(); });

  load(container);
}

async function load() {
  const root = document.querySelector('#view');
  const listEl = root.querySelector('#orders-list');
  try {
    const qs = new URLSearchParams();
    if (state.q) qs.set('q', state.q);
    if (state.partyId) qs.set('party_id', state.partyId);
    if (state.category) qs.set('category', state.category);
    qs.set('limit', '200');
    const orders = await api.get(`/orders?${qs}`);
    listEl.innerHTML = orders.length ? `
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Código</th><th>Festa</th><th>Mesa</th><th>Status</th><th>Prato(s)</th><th>Lançado por</th><th>Data/Hora</th><th></th></tr></thead>
        <tbody>${orders.map((o) => `
          <tr>
            <td><a class="mono" href="#/orders/${o.id}">${esc(o.code)}</a> ${o.priority ? '<span class="badge b-danger">🔺</span>' : ''}</td>
            <td>${esc(o.party_name)}</td>
            <td>${esc(o.table_label)}</td>
            <td>${statusBadge(o.status)}</td>
            <td style="max-width:260px;">${esc((o.items || []).map((i) => `${i.quantity}x ${i.dish_name || 'Prato'}`).join(', ') || '—')}</td>
            <td>${esc(o.created_by_name || '—')}</td>
            <td style="white-space:nowrap;">${esc(formatDT(o.created_at))}</td>
            <td class="actions"><a class="btn btn-sm btn-ghost" href="#/orders/${o.id}">Abrir</a></td>
          </tr>`).join('')}</tbody>
      </table></div>` : emptyState('📭', 'Nenhum pedido encontrado com os filtros.');
  } catch (e) {
    listEl.innerHTML = emptyState('⚠️', e.message);
  }
}