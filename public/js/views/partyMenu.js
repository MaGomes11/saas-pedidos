'use strict';

import { api, hasPerm } from '../api.js';
import { esc, toast, confirmModal, spinner, emptyState, modal } from '../ui.js';

export const title = 'Cardápio da festa';

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
  const availableCount = party.menu.filter((m) => m.available && m.dish_active).length;

  container.innerHTML = `
    <div class="flex-between mb-2">
      <div>
        <h1>Cardápio · ${esc(party.name)}</h1>
        <div class="text-2">Tipo vinculado: <strong>${esc(party.dish_type?.name || '—')}</strong> · ${availableCount} prato(s) disponível(is) para pedidos</div>
      </div>
      <a class="btn btn-ghost" href="#/parties/${party.id}">← Voltar</a>
    </div>

    <div class="tabs">
      <a href="#/parties/${party.id}">📋 Pedidos</a>
      <a href="#/parties/${party.id}/menu" class="active">🍽️ Cardápio</a>
      <a href="#/parties/${party.id}/tables">🪑 Mesas</a>
    </div>

    <div id="menu-list" class="grid" style="gap:.5rem; max-width: 900px;">${spinner()}</div>

    ${admin ? `
    <div class="card mt-2" style="max-width:900px;">
      <h3>Adicionar pratos à festa</h3>
      <div class="flex gap-1 mb-1" style="flex-wrap:wrap;">
        <button class="btn btn-ghost" id="btn-add-existing">📚 Vincular prato existente</button>
        <button class="btn" id="btn-quick-create">✨ Criar prato exclusivo</button>
        <button class="btn btn-ghost" id="btn-sync">🔁 Sincronizar com o cardápio vinculado</button>
      </div>
      <p class="hint">Pratos exclusivos aparecem somente nesta festa — nunca nos cardápios padrão.</p>
    </div>` : ''}
  `;

  renderMenu(container, party);

  container.querySelector('#btn-add-existing')?.addEventListener('click', () => openAddExisting(container, party));
  container.querySelector('#btn-quick-create')?.addEventListener('click', () => openQuickCreate(container, party));
  container.querySelector('#btn-sync')?.addEventListener('click', async () => {
    try {
      const r = await api.post(`/parties/${party.id}/menu/sync`);
      toast(`${r.synced} prato(s) sincronizado(s).`);
      location.reload();
    } catch (e) { toast(e.message, 'error'); }
  });
}

function renderMenu(container, party) {
  const box = container.querySelector('#menu-list');
  const items = party.menu_all || party.menu;
  box.innerHTML = items.length ? items.map((m, idx) => `
    <div class="card" data-dish="${m.dish_id}" data-idx="${idx}" style="display:flex; gap:.8rem; align-items:flex-start;">
      <div style="flex:1; min-width:0;">
        <div class="flex gap-1" style="flex-wrap:wrap; align-items:center;">
          <strong style="font-size:1.02rem;">${esc(m.name)}</strong>
          <span class="badge ${m.source === 'evento_exclusivo' ? 'b-warn' : 'b-primary'}">${m.source === 'evento_exclusivo' ? 'Exclusivo da festa' : 'Cardápio padrão'}</span>
          <span class="badge b-muted">${esc(m.category)}</span>
          ${m.available && m.dish_active ? '<span class="badge b-ok">Disponível</span>' : '<span class="badge b-danger">Indisponível</span>'}
        </div>
        ${m.description ? `<p class="text-2" style="margin:.25rem 0; font-size:.9rem;">${esc(m.description)}</p>` : ''}
        ${m.event_notes ? `<div class="text-warn" style="background:var(--warn-soft); border-radius:6px; padding:.3rem .6rem; font-size:.84rem; display:inline-block;">📝 ${esc(m.event_notes)}</div>` : ''}
      </div>
      ${hasPerm('festas_gerenciar') ? `
      <div class="flex gap-1" style="flex-wrap:wrap; justify-content:flex-end;">
        <button class="btn btn-sm btn-ghost" data-act="toggle" title="${m.available ? 'Marcar indisponível' : 'Marcar disponível'}">${m.available ? '🚫' : '✅'}</button>
        <button class="btn btn-sm btn-ghost" data-act="up" ${idx === 0 ? 'disabled' : ''} title="Mover para cima">↑</button>
        <button class="btn btn-sm btn-ghost" data-act="down" ${idx === items.length - 1 ? 'disabled' : ''} title="Mover para baixo">↓</button>
        <button class="btn btn-sm btn-ghost" data-act="notes" title="Observações do prato na festa">✏️</button>
        <button class="btn btn-sm btn-danger-ghost" data-act="unlink" title="Remover do cardápio da festa">✖</button>
      </div>` : ''}
    </div>`).join('') : emptyState('🍽️', 'Nenhum prato no cardápio desta festa.');

  if (!hasPerm('festas_gerenciar')) return;
  box.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.act;
      const card = btn.closest('.card');
      const menuItem = items.find((x) => x.dish_id === Number(card.dataset.dish));
      if (!menuItem) return;
      try {
        if (act === 'toggle') {
          await api.patch(`/parties/${party.id}/dishes/${menuItem.dish_id}`, { available: menuItem.available ? false : true });
          toast(menuItem.available ? 'Prato marcado como indisponível.' : 'Prato disponível novamente.');
        } else if (act === 'unlink') {
          const ok = await confirmModal({
            title: 'Remover prato do cardápio',
            message: `Remover "${menuItem.name}" do cardápio desta festa? Ele continuará no cadastro geral.`,
            confirmText: 'Remover', danger: true,
          });
          if (!ok) return;
          await api.del(`/parties/${party.id}/dishes/${menuItem.dish_id}`);
          toast('Prato removido do cardápio da festa.');
        } else if (act === 'notes') {
          openNotes(container, party, menuItem);
          return;
        } else if (act === 'up' || act === 'down') {
          const list = items.map((x) => x.dish_id);
          const i = list.indexOf(menuItem.dish_id);
          const j = act === 'up' ? i - 1 : i + 1;
          if (j < 0 || j >= list.length) return;
          [list[i], list[j]] = [list[j], list[i]];
          await api.put(`/parties/${party.id}/dishes/order`, { order: list });
          toast('Ordem atualizada.');
        }
        location.reload();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

function openNotes(container, party, menuItem) {
  modal({
    title: `Observações · ${menuItem.name}`,
    htmlBody: `
      <div class="field"><label>Observações do prato nesta festa</label>
        <textarea class="textarea" id="event-notes">${esc(menuItem.event_notes || '')}</textarea></div>`,
    footButtons: [{ label: 'Salvar', class: '' }],
    onOpen: (m) => {
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const value = m.querySelector('#event-notes').value;
        try {
          await api.patch(`/parties/${party.id}/dishes/${menuItem.dish_id}`, { event_notes: value });
          toast('Observações salvas.');
          location.reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

async function openAddExisting(container, party) {
  const dishes = (await api.get('/dishes?all=1')).filter((d) => !party.menu_all.some((m) => m.dish_id === d.id));
  modal({
    title: 'Vincular pratos existentes',
    htmlBody: `
      <div class="field"><input class="input" id="add-search" placeholder="🔎 Buscar prato..." /></div>
      <div id="add-list" style="max-height:40vh; overflow-y:auto; display:grid; gap:.4rem;">${dishes.length ? dishes.map((d, i) => `
        <label class="check-row card" style="padding:.5rem .7rem;">
          <input type="checkbox" value="${d.id}" data-name="${esc(d.name)}" ${i < 8 ? 'checked' : ''} />
          <span><strong>${esc(d.name)}</strong> <small class="text-3">· ${esc(d.category)}</small>
          ${d.active ? '' : ' <span class="badge b-danger">inativo</span>'}</span>
        </label>`).join('') : '<p class="text-3">Todos os pratos cadastrados já estão na festa.</p>'}</div>`,
    footButtons: [{ label: 'Vincular selecionados', class: '' }],
    onOpen: (m) => {
      const search = m.querySelector('#add-search');
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase();
        m.querySelectorAll('#add-list .check-row').forEach((row) => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const ids = [...m.querySelectorAll('#add-list input:checked')].map((c) => Number(c.value));
        if (!ids.length) return toast('Selecione ao menos um prato.', 'error');
        try {
          const r = await api.put(`/parties/${party.id}/dishes`, { dishIds: ids });
          toast(`${r.linked} prato(s) vinculado(s).`);
          location.reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

async function openQuickCreate(container, party) {
  const cats = await api.get('/ingredients/categories');
  modal({
    title: 'Criar prato exclusivo da festa',
    htmlBody: `
      <div class="form-grid">
        <div class="field"><label>Nome <span class="req">*</span></label><input class="input" id="qc-name" /></div>
        <div class="field"><label>Categoria <span class="req">*</span></label>
          <select class="select" id="qc-cat">${cats.map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field" style="grid-column:1/-1;"><label>Descrição</label><input class="input" id="qc-desc" /></div>
        <div class="field" style="grid-column:1/-1;"><label>Observações de preparo</label><input class="input" id="qc-prep" /></div>
        <div class="field" style="grid-column:1/-1;"><label>Observações específicas para esta festa</label><input class="input" id="qc-notes" /></div>
      </div>`,
    footButtons: [{ label: 'Criar prato', class: '' }],
    onOpen: (m) => {
      m.querySelector('#qc-name').focus();
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const name = m.querySelector('#qc-name').value.trim();
        const category = m.querySelector('#qc-cat').value;
        if (!name) return toast('Informe o nome do prato.', 'error');
        try {
          await api.post(`/parties/${party.id}/dishes`, {
            name, category,
            description: m.querySelector('#qc-desc').value,
            prep_notes: m.querySelector('#qc-prep').value,
            event_notes: m.querySelector('#qc-notes').value,
          });
          toast('Prato exclusivo criado e vinculado à festa.');
          location.reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}