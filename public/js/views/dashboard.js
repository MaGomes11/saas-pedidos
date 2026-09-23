'use strict';

import { api } from '../api.js';
import { esc, statusBadge, partyStatusBadge, spinner, toast, timeAgo } from '../ui.js';

export const title = 'Dashboard';

let timer = null;

export function render(container, params) {
  container.innerHTML = `<div id="dash-root">${spinner()}</div>`;
  const root = container.querySelector('#dash-root');
  load(root);
  timer = setInterval(() => load(root, true), 30000);
  container._cleanup = () => clearInterval(timer);
}

async function load(root, silent) {
  try {
    const d = await api.get('/dashboard');
    root.innerHTML = renderDashboard(d);
  } catch (e) {
    if (!silent) {
      root.innerHTML = `<div class="empty"><div class="empty-ico">⚠️</div><p>${esc(e.message)}</p></div>`;
    }
  }
}

function renderDashboard(d) {
  const COLOR_VARS = { primary: 'var(--primary)', warn: 'var(--warn)', ok: 'var(--ok)', muted: 'var(--text-2)', danger: 'var(--danger)' };
  const acc = (c) => COLOR_VARS[c] || 'var(--primary)';
  const byStatus = (d.statuses || []).filter((s) => s.active === 1);
  const totalAbertos = d.abertos || 0;
  const kpis = `
    ${byStatus.map((s) => `
      <div class="kpi" style="border-top:4px solid ${acc(s.color)};">
        <div class="kpi-num">${s.count}</div><div class="kpi-label">${esc(s.label)}</div>
      </div>`).join('')}
    <div class="kpi"><div class="kpi-num">${d.partiesAtivas}</div><div class="kpi-label">Festas ativas</div></div>
    <div class="kpi"><div class="kpi-num">${d.occupiedTables}<small class="text-3">/${d.tableTotal}</small></div><div class="kpi-label">Mesas ocupadas</div></div>
    <div class="kpi"><div class="kpi-num">${d.avgPrepMinutes == null ? '—' : d.avgPrepMinutes + '′'}</div><div class="kpi-label">Tempo médio de preparo</div></div>
  `;

  const waiting = d.waiting.length
    ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Pedido</th><th>Mesa</th><th>Status</th><th>Desde</th><th>Aguardando</th></tr></thead>
        <tbody>${d.waiting.map((w) => `
          <tr>
            <td><a href="#/orders/${w.id}" class="mono">${esc(w.code)}</a> ${w.priority ? '<span class="badge b-danger">Alta</span>' : ''}</td>
            <td>${esc(w.table_label)}</td>
            <td>${statusBadge(w.status)}</td>
            <td>${esc(new Date(w.created_at.replace(' ', 'T')).toLocaleString('pt-BR'))}</td>
            <td><strong style="color:${w.elapsed_min > 30 ? 'var(--danger)' : w.elapsed_min > 15 ? 'var(--warn)' : 'inherit'}">${w.elapsed_min} min</strong></td>
          </tr>`).join('')}
        </tbody></table></div>`
    : `<p class="text-3">Nenhum pedido aguardando. 🎉</p>`;

  const byParty = d.byParty.map((p) => `
    <div class="card">
      <div class="flex-between">
        <div><strong>${esc(p.name)}</strong> ${partyStatusBadge(p.status)}</div>
        <a href="#/parties/${p.id}" class="btn btn-sm btn-ghost">Ver festa</a>
      </div>
      <div class="mt-1 flex gap-2 text-2" style="flex-wrap:wrap;">
        <span>🆕 ${p.abertos} abertos</span>
        <span>✅ ${p.prontos} prontos</span>
        <span>🚚 ${p.entregues} entregues</span>
        <span>🏁 ${p.finalizados} finalizados</span>
      </div>
    </div>`).join('') || '<p class="text-3">Nenhuma festa ativa ou planejada.</p>';

  return `
    <div class="flex-between mb-2">
      <h1>Painel geral</h1>
      <div class="flex gap-1">
        <a class="btn btn-ghost" href="#/orders">Lista de pedidos</a>
        <a class="btn" href="#/orders/new">🧾 Lançar pedido</a>
      </div>
    </div>
    <div class="kpi-grid">${kpis}</div>

    <div class="grid grid-2 mt-2" style="align-items:start;">
      <div class="card">
        <div class="card-title"><h2>⏱ Aguardando há mais tempo</h2><span class="badge b-warn">${totalAbertos} abertos</span></div>
        ${waiting}
      </div>
      <div class="card">
        <div class="card-title"><h2>🎉 Por festa</h2></div>
        <div class="grid" style="gap:.6rem;">${byParty}</div>
      </div>
    </div>
  `;
}