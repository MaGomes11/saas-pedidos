'use strict';

import { api, hasPerm } from '../api.js';
import { esc, formatDate, partyStatusBadge, spinner, debounce, emptyState } from '../ui.js';

export const title = 'Festas';

let root = null;
let state = { status: '', q: '' };

export function render(container) {
  root = container;
  container.innerHTML = `
    <div class="toolbar">
      <div class="input-group" style="flex:1; min-width:200px;">
        <input class="input" id="f-q" placeholder="🔎 Buscar por nome, cliente ou local..." value="${esc(state.q)}" />
      </div>
      <select class="select" id="f-status">
        <option value="">Todas</option>
        <option value="planejada" ${state.status === 'planejada' ? 'selected' : ''}>Planejada</option>
        <option value="ativa" ${state.status === 'ativa' ? 'selected' : ''}>Ativa</option>
        <option value="encerrada" ${state.status === 'encerrada' ? 'selected' : ''}>Encerrada</option>
        <option value="cancelada" ${state.status === 'cancelada' ? 'selected' : ''}>Cancelada</option>
      </select>
      ${hasPerm('festas_gerenciar') ? '<a class="btn" href="#/parties/new">＋ Nova festa</a>' : ''}
    </div>
    <div id="parties-list">${spinner()}</div>
  `;

  const qInput = container.querySelector('#f-q');
  qInput.addEventListener('input', debounce(() => { state.q = qInput.value; load(); }, 350));
  container.querySelector('#f-status').addEventListener('change', (e) => { state.status = e.target.value; load(); });

  load();
  container._cleanup = () => { root = null; };
}

async function load() {
  if (!root) return;
  try {
    const query = new URLSearchParams();
    query.set('all', '1');
    if (state.status) query.set('status', state.status);
    if (state.q) query.set('q', state.q);
    const partyList = await api.get(`/parties?${query}`);
    const list = root.querySelector('#parties-list');
    list.innerHTML = partyList.length ? `
      <div class="grid grid-auto" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
        ${partyList.map(partyCard).join('')}
      </div>` : emptyState('🎭', 'Nenhuma festa encontrada.');
  } catch (e) {
    root.querySelector('#parties-list').innerHTML = emptyState('⚠️', e.message);
  }
}

function partyCard(p) {
  const stats = p.order_stats || {};
  const total = stats.total || 0;
  return `
    <div class="card fade-in" style="display:flex; flex-direction:column; gap:.4rem;">
      <div class="flex-between">
        <span class="badge b-primary">${p.table_count} mesas</span>
        ${partyStatusBadge(p.status)}
      </div>
      <h3 style="margin:0;"><a href="#/parties/${p.id}">${esc(p.name)}</a></h3>
      <div class="text-2" style="font-size:.9rem;">
        <div>👤 ${esc(p.client_name || '—')}</div>
        <div>📅 ${esc(formatDate(p.date))} · ${esc(p.start_time || '—')}–${esc(p.end_time || '—')}</div>
        <div>📍 ${esc(p.location || '—')}</div>
        <div>📒 ${esc(p.dish_type_name || 'Sem cardápio')}</div>
      </div>
      <div class="flex gap-1 mt-1" style="flex-wrap:wrap;">
        <span class="badge b-muted">🆕 ${stats.abertos == null ? '—' : stats.abertos} abertos</span>
        <span class="badge b-muted">🚚 ${stats.entregues == null ? '—' : stats.entregues} entregues</span>
        <span class="badge b-muted">📦 ${total} total</span>
      </div>
      <div class="flex gap-1 mt-1" style="margin-top:auto;">
        <a class="btn btn-sm btn-ghost" href="#/parties/${p.id}">Detalhes</a>
        <a class="btn btn-sm btn-ghost" href="#/parties/${p.id}/menu">Cardápio</a>
        <a class="btn btn-sm btn-ghost" href="#/parties/${p.id}/tables">Mesas</a>
      </div>
    </div>`;
}