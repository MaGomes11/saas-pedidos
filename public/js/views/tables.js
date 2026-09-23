'use strict';

import { api, hasPerm } from '../api.js';
import { esc, toast, confirmModal, spinner, emptyState, modal, tableStatusBadge } from '../ui.js';

export const title = 'Mesas da festa';

export async function render(container, params) {
  container.innerHTML = spinner();
  let party;
  try {
    party = await api.get(`/parties/${params.id}`);
  } catch (e) {
    container.innerHTML = emptyState('⚠️', e.message);
    return;
  }
  const admin = hasPerm('festas_gerenciar');
  const tables = party.tables || [];

  const occupied = tables.filter((t) => t.status === 'ocupada').length;

  container.innerHTML = `
    <div class="flex-between mb-2">
      <div>
        <h1>Mesas · ${esc(party.name)}</h1>
        <div class="text-2">${tables.length} mesa(s) · ${occupied} ocupada(s)</div>
      </div>
      <a class="btn btn-ghost" href="#/parties/${party.id}">← Voltar</a>
    </div>

    <div class="tabs">
      <a href="#/parties/${party.id}">📋 Pedidos</a>
      <a href="#/parties/${party.id}/menu">🍽️ Cardápio</a>
      <a href="#/parties/${party.id}/tables" class="active">🪑 Mesas</a>
    </div>

    ${admin ? `
    <div class="toolbar">
      <button class="btn btn-ghost" id="btn-add">＋ Mesa</button>
      <button class="btn btn-ghost" id="btn-bulk">＋ várias mesas</button>
    </div>` : ''}

    <div id="table-grid">${spinner()}</div>
  `;

  renderTables(container, party);

  container.querySelector('#btn-add')?.addEventListener('click', () => openAdd(container, party));
  container.querySelector('#btn-bulk')?.addEventListener('click', () => openBulk(container, party));
}

function renderTables(container, party) {
  const grid = container.querySelector('#table-grid');
  const tables = party.tables || [];
  grid.innerHTML = tables.length ? `
    <div class="grid grid-auto">
      ${tables.map((t) => `
        <div class="card" data-id="${t.id}" data-label="${esc(t.label)}" style="min-width:0;">
          <div class="flex-between">
            <strong style="font-size:1.1rem;">🪑 ${esc(t.label)}</strong>
            ${tableStatusBadge(t.status)}
          </div>
          <div class="text-2 mt-1" style="font-size:.88rem;">
            <div>👥 Capacidade: ${t.capacity ? `${t.capacity} pessoas` : '—'}</div>
            <div>📦 Pedidos: ${t.order_count || 0}</div>
            ${t.last_order_code ? `<div>Último: <a class="mono" href="#/orders?code=${esc(t.last_order_code)}">${esc(t.last_order_code)}</a></div>` : ''}
          </div>
          ${hasPerm('festas_gerenciar') ? `
          <div class="flex gap-1 mt-1" style="flex-wrap:wrap;">
            <select class="select" data-status style="font-size:.85rem; padding:.3rem .5rem; min-width:110px;">
              ${['livre', 'ocupada', 'encerrada', 'bloqueada'].map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-ghost" data-edit title="Editar">✏️</button>
            <button class="btn btn-sm btn-danger-ghost" data-del title="Excluir">🗑</button>
          </div>` : ''}
        </div>`).join('')}
    </div>` : emptyState('🪑', 'Nenhuma mesa cadastrada.');

  if (!hasPerm('festas_gerenciar')) return;
  grid.querySelectorAll('.card').forEach((card) => {
    const id = Number(card.dataset.id);
    card.querySelector('[data-status]')?.addEventListener('change', async (e) => {
      try {
        await api.put(`/parties/${party.id}/tables/${id}`, { status: e.target.value });
        toast(`Status da mesa "${card.dataset.label}" atualizado.`);
        location.reload();
      } catch (ex) { toast(ex.message, 'error'); }
    });
    card.querySelector('[data-edit]')?.addEventListener('click', () => openEdit(container, party, id));
    card.querySelector('[data-del]')?.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Excluir mesa',
        message: `Excluir a mesa "${card.dataset.label}"? Esta ação não é possível se a mesa possuir pedidos históricos.`,
        confirmText: 'Excluir', danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/parties/${party.id}/tables/${id}`);
        toast('Mesa excluída.');
        location.reload();
      } catch (ex) { toast(ex.message, 'error'); }
    });
  });
}

function openAdd(container, party) {
  modal({
    title: 'Nova mesa',
    htmlBody: `
      <div class="field"><label>Identificação <span class="req">*</span></label>
        <input class="input" id="t-label" placeholder="Ex.: Mesa 11, A1, Área externa..." /></div>
      <div class="field"><label>Capacidade (opcional)</label>
        <input class="input" type="number" min="0" id="t-cap" placeholder="Ex.: 8" /></div>`,
    footButtons: [{ label: 'Criar mesa', class: '' }],
    onOpen: (m) => {
      m.querySelector('#t-label').focus();
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const label = m.querySelector('#t-label').value.trim();
        const capacity = m.querySelector('#t-cap').value;
        if (!label) return toast('Informe a identificação da mesa.', 'error');
        try {
          await api.post(`/parties/${party.id}/tables`, { label, capacity: capacity ? Number(capacity) : null });
          toast(`Mesa "${label}" criada.`);
          location.reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

function openBulk(container, party) {
  modal({
    title: 'Criar várias mesas',
    htmlBody: `
      <div class="field"><label>Rótulos (um por linha) <span class="req">*</span></label>
        <textarea class="textarea" id="t-labels" rows="6" placeholder="Mesa 01&#10;Mesa 02&#10;Mesa 03"></textarea></div>
      <div class="field"><label>Capacidade padrão (opcional)</label>
        <input class="input" type="number" min="0" id="t-cap" placeholder="Ex.: 8" /></div>`,
    footButtons: [{ label: 'Criar mesas', class: '' }],
    onOpen: (m) => {
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const labels = m.querySelector('#t-labels').value.split('\n').map((s) => s.trim()).filter(Boolean);
        const capacity = m.querySelector('#t-cap').value;
        if (!labels.length) return toast('Informe ao menos um rótulo.', 'error');
        try {
          await api.post(`/parties/${party.id}/tables/bulk`, { labels, capacity: capacity ? Number(capacity) : null });
          toast(`${labels.length} mesas criadas.`);
          location.reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

function openEdit(container, party, id) {
  const table = (party.tables || []).find((t) => t.id === id);
  if (!table) return;
  modal({
    title: `Editar mesa ${table.label}`,
    htmlBody: `
      <div class="field"><label>Identificação</label><input class="input" id="t-label" value="${esc(table.label)}" /></div>
      <div class="field"><label>Capacidade</label><input class="input" type="number" min="0" id="t-cap" value="${table.capacity ?? ''}" /></div>`,
    footButtons: [{ label: 'Salvar', class: '' }],
    onOpen: (m) => {
      m.querySelector('[data-foot="0"]').onclick = async () => {
        try {
          await api.put(`/parties/${party.id}/tables/${id}`, {
            label: m.querySelector('#t-label').value.trim(),
            capacity: m.querySelector('#t-cap').value ? Number(m.querySelector('#t-cap').value) : null,
          });
          toast('Mesa atualizada.');
          location.reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}