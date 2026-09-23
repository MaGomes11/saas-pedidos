'use strict';

import { api, hasPerm } from '../api.js';
import { esc, formatDate, formatDT, statusBadge, partyStatusBadge, tableStatusBadge, spinner, toast, confirmModal, emptyState, ensureStatusMeta, statusMeta } from '../ui.js';

export const title = 'Detalhes da festa';

export async function render(container, params) {
  container.innerHTML = spinner();
  await ensureStatusMeta();
  let party;
  try {
    party = await api.get(`/parties/${params.id}`);
  } catch (e) {
    container.innerHTML = emptyState('⚠️', e.message);
    return;
  }
  const linkOrder = party.status === 'ativa'
    ? `<a class="btn btn-lg" href="#/orders/new?party=${party.id}">🧾 Lançar pedido</a>`
    : `<span class="badge b-muted">Festa ${party.status} — novos pedidos bloqueados</span>`;

  const stats = {};
  (party.order_stats || []).forEach((s) => { stats[s.status] = s.qtd; });

  const kpis = (statusMeta().length ? statusMeta() : [])
    .filter((s) => s.active === 1)
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map((s) => `
      <div class="kpi" style="border-top:4px solid ${({ primary: 'var(--primary)', warn: 'var(--warn)', ok: 'var(--ok)', muted: 'var(--text-2)', danger: 'var(--danger)' })[s.color] || 'var(--primary)'};">
        <div class="kpi-num">${stats[s.key] || 0}</div><div class="kpi-label">${esc(s.label)}</div>
      </div>`).join('');

  container.innerHTML = `
    <div class="flex-between mb-2">
      <div>
        <h1>${esc(party.name)}</h1>
        <div class="flex gap-1 mt-1" style="flex-wrap:wrap;">
          ${partyStatusBadge(party.status)}
          <span class="badge b-primary">📒 ${esc(party.dish_type?.name || 'Sem cardápio')}</span>
          <span class="badge b-muted">📅 ${esc(formatDate(party.date))} ${party.start_time ? esc(`· ${party.start_time}–${party.end_time}`) : ''}</span>
          <span class="badge b-muted">👤 ${esc(party.client_name || '—')}</span>
          <span class="badge b-muted">📍 ${esc(party.location || '—')}</span>
        </div>
      </div>
      ${linkOrder}
    </div>

    <div class="tabs">
      <a href="#/parties/${party.id}" class="active">📋 Pedidos</a>
      <a href="#/parties/${party.id}/menu">🍽️ Cardápio</a>
      <a href="#/parties/${party.id}/tables">🪑 Mesas</a>
    </div>

    <div class="kpi-grid mb-2">
      ${kpis}
    </div>

    <div class="card">
      <div class="card-title"><h2>Pedidos da festa</h2>
        <a class="btn btn-sm btn-ghost" href="#/kanban?party=${party.id}">Ver na visão de pedidos</a>
      </div>
      <div id="party-orders">${spinner()}</div>
    </div>

    ${party.notes ? `<div class="card"><h3>📝 Observações</h3><p class="text-2">${esc(party.notes).replaceAll('\n', '<br>')}</p></div>` : ''}

    ${hasPerm('festas_gerenciar') ? `
      <div class="card">
        <h3>Gerenciar festa</h3>
        <div class="flex gap-1 mt-1" style="flex-wrap:wrap;">
          <a class="btn btn-ghost" href="#/parties/${party.id}/edit">✏️ Editar dados</a>
          <button class="btn btn-ghost" id="btn-sync-menu">🔁 Sincronizar cardápio</button>
          ${party.status !== 'ativa' ? `<button class="btn btn-ok" id="btn-status" data-status="ativa">▶️ Ativar festa</button>` : ''}
          ${party.status !== 'encerrada' ? `<button class="btn btn-warn" id="btn-status" data-status="encerrada">🏁 Encerrar festa</button>` : ''}
          ${party.status !== 'cancelada' ? `<button class="btn btn-danger-ghost" id="btn-status" data-status="cancelada">✖️ Cancelar festa</button>` : ''}
        </div>
      </div>` : ''}
  `;

  loadOrders(container, party.id);

  container.querySelector('#btn-sync-menu')?.addEventListener('click', async () => {
    try {
      const r = await api.post(`/parties/${party.id}/menu/sync`);
      toast(`${r.synced} pratos sincronizados do cardápio vinculado.`);
      location.reload();
    } catch (e) { toast(e.message, 'error'); }
  });

  container.querySelectorAll('#btn-status').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.status;
      const label = { ativa: 'ativar', encerrada: 'encerrar', cancelada: 'cancelar' }[status];
      const ok = await confirmModal({
        title: `${label === 'cancelar' ? 'Cancelar' : label === 'encerrar' ? 'Encerrar' : 'Ativar'} festa`,
        message: `Confirma ${label === 'cancelar' ? 'a' : label === 'encerrar' ? 'o' : 'a'} ${label} da festa "${party.name}"? ${status === 'encerrada' ? 'Novos pedidos serão bloqueados.' : ''}`,
        confirmText: 'Confirmar', danger: status !== 'ativa',
      });
      if (!ok) return;
      try {
        await api.put(`/parties/${party.id}/status`, { status });
        toast(`Festa ${status === 'ativa' ? 'ativada' : status === 'encerrada' ? 'encerrada' : 'cancelada'}.`);
        location.reload();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  container._cleanup = () => { clearInterval(container._timer); };
}

async function loadOrders(container, partyId) {
  try {
    const orders = await api.get(`/orders?party_id=${partyId}&limit=100`);
    const box = container.querySelector('#party-orders');
    if (!box) return;
    box.innerHTML = orders.length ? `
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Código</th><th>Mesa</th><th>Status</th><th>Itens</th><th>Lançado por</th><th>Data/Hora</th><th></th></tr></thead>
        <tbody>${orders.map((o) => `
          <tr>
            <td><a href="#/orders/${o.id}" class="mono">${esc(o.code)}</a> ${o.priority ? '<span class="badge b-danger">Alta</span>' : ''}</td>
            <td>${esc(o.table_label)}</td>
            <td>${statusBadge(o.status)}</td>
            <td>${esc(o.items.map((i) => `${i.quantity}x ${i.dish_name}`).join(', '))}</td>
            <td>${esc(o.created_by_name)}</td>
            <td>${esc(formatDT(o.created_at))}</td>
            <td class="actions"><a class="btn btn-sm btn-ghost" href="#/orders/${o.id}">Abrir</a></td>
          </tr>`).join('')}</tbody>
      </table></div>` : emptyState('📭', 'Nenhum pedido nesta festa ainda.');
  } catch (e) {
    container.querySelector('#party-orders').innerHTML = emptyState('⚠️', e.message);
  }
}