'use strict';

import { api, hasPerm } from '../api.js';
import { esc, toast, spinner, emptyState, modal, tableStatusBadge } from '../ui.js';

export const title = 'Lançar pedido';

const state = {
  partyId: null,
  tableId: null,
  items: [],     // { key, dish_id, name, category, quantity, removed:[ids], added:[{id, qty, note}], notes }
  notes: '',
  priority: false,
  markOccupied: true,
};

let party = null;

export async function render(container, params, route) {
  // Pré-seleciona festa vinda de query (?party=N)
  const qParty = Number(route.query.get('party'));
  if (qParty) state.partyId = qParty;

  // Festas ativas para seleção
  let parties = [];
  try {
    parties = await api.get('/parties?status=ativa');
  } catch (e) {
    container.innerHTML = emptyState('⚠️', e.message);
    return;
  }
  if (!state.partyId && parties.length === 1) state.partyId = parties[0].id;
  if (state.partyId && !parties.some((p) => p.id === state.partyId)) state.partyId = parties.length === 1 ? parties[0].id : null;

  container.innerHTML = `
    <div class="flex-between mb-2">
      <h1>🧾 Lançar pedido</h1>
      <a class="btn btn-ghost" href="#/kanban">Ver visão de pedidos</a>
    </div>

    <div class="card mb-2">
      <div class="field" style="margin:0; max-width:520px;">
        <label>Festa ativa <span class="req">*</span></label>
        <select class="select" id="o-party">
          <option value="">— Selecione —</option>
          ${parties.map((p) => `<option value="${p.id}" ${state.partyId === p.id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.date)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card mb-2">
      <div class="card-title"><h2>Escolha a mesa</h2>
        <div class="flex gap-1" style="align-items:center; flex-wrap:wrap;">
          <span class="text-2" id="o-tables-hint"></span>
          ${hasPerm('festas_gerenciar') ? '<button class="btn btn-sm btn-ghost" id="btn-add-tables">＋ Aumentar mesas</button>' : ''}
        </div>
      </div>
      <div id="o-tables">${spinner()}</div>
    </div>
  `;

  const partySel = container.querySelector('#o-party');
  partySel.addEventListener('change', async (e) => {
    state.partyId = e.target.value ? Number(e.target.value) : null;
    state.tableId = null;
    state.items = [];
    await loadParty(container);
    renderTables(container);
  });

  container.querySelector('#btn-add-tables')?.addEventListener('click', () => openAddTables(container));

  if (state.partyId) {
    await loadParty(container);
    renderTables(container);
  } else {
    container.querySelector('#o-tables').innerHTML = emptyState('🎉', 'Selecione uma festa ativa para ver as mesas.');
  }
}

async function loadParty(container) {
  if (!state.partyId) { party = null; return; }
  party = await api.get(`/parties/${state.partyId}`);
}

function renderTables(container) {
  const box = container.querySelector('#o-tables');
  if (!box) return;
  const hint = container.querySelector('#o-tables-hint');
  if (!party) { box.innerHTML = emptyState('🎉', 'Selecione uma festa ativa para ver as mesas.'); return; }
  const tables = party.tables || [];
  if (!tables.length) { box.innerHTML = emptyState('🪑', 'Nenhuma mesa cadastrada nesta festa.'); return; }

  const usable = tables.filter((t) => !['bloqueada', 'encerrada'].includes(t.status));
  if (!usable.length) { box.innerHTML = emptyState('🚫', 'Nenhuma mesa disponível para novos pedidos nesta festa.'); return; }

  if (state.tableId && !usable.some((t) => t.id === state.tableId)) state.tableId = null;
  hint.textContent = 'Selecione a mesa para abrir o popup do pedido.';

  box.innerHTML = `
    <div class="grid grid-auto" style="gap:.7rem;">
      ${tables.map((t) => {
        const on = usable.some((u) => u.id === t.id);
        return `
          <div class="card table-pick ${on ? '' : 'off'}" role="button" tabindex="0"
               data-id="${t.id}" data-label="${esc(t.label)}"
               style="cursor:${on ? 'pointer' : 'not-allowed'}; min-width:0;">
            <div class="flex-between">
              <strong style="font-size:1.05rem;">🪑 ${esc(t.label)}</strong>
              ${tableStatusBadge(t.status)}
            </div>
            <div class="text-2 mt-1" style="font-size:.85rem;">
              <div>👥 Capacidade: ${t.capacity ? `${t.capacity} pessoas` : '—'}</div>
              <div>📦 Pedidos: ${t.order_count || 0}</div>
              ${on ? '<div style="color:var(--primary);font-weight:800;margin-top:.25rem;">＋ Pedido nesta mesa</div>' : ''}
            </div>
          </div>`;
      }).join('')}
    </div>`;

  box.querySelectorAll('.table-pick').forEach((card) => {
    const id = Number(card.dataset.id);
    if (!usable.some((u) => u.id === id)) return;
    const pick = () => openOrderModal(container, id);
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
  });
}

// ---------------------------------------------------------------------------
// Aumentar quantidade de mesas da festa
// ---------------------------------------------------------------------------
function openAddTables(container) {
  if (!party) return toast('Selecione a festa primeiro.', 'error');
  modal({
    title: 'Aumentar mesas',
    htmlBody: `
      <div class="field"><label>Quantidade de mesas <span class="req">*</span></label>
        <input class="input" type="number" id="a-qty" min="1" max="50" value="1" />
      </div>
      <div class="field"><label>Prefixo das mesas</label>
        <input class="input" id="a-prefix" value="Mesa" placeholder="Ex.: Mesa, A, Área externa..." />
      </div>
      <div class="field"><label>Capacidade padrão (opcional)</label>
        <input class="input" type="number" min="0" id="a-cap" placeholder="Ex.: 8" />
      </div>
      <div class="field"><label>Serão criadas:</label>
        <div class="text-2" id="a-preview" style="border:1px dashed var(--border); border-radius:var(--radius-sm); padding:.5rem .7rem;"></div>
      </div>`,
    footButtons: [{ label: '＋ Criar mesas', class: '' }],
    onOpen: (m) => {
      const qtyEl = m.querySelector('#a-qty');
      const prefixEl = m.querySelector('#a-prefix');
      const previewEl = m.querySelector('#a-preview');
      const renderPreview = () => {
        const qty = Math.max(1, Math.min(50, Number(qtyEl.value) || 1));
        previewEl.textContent = nextLabels(prefixEl.value.trim() || 'Mesa', qty).join(', ');
      };
      qtyEl.addEventListener('input', renderPreview);
      prefixEl.addEventListener('input', renderPreview);
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const qty = Math.max(1, Math.min(50, Number(qtyEl.value) || 1));
        const prefix = prefixEl.value.trim() || 'Mesa';
        const capacity = m.querySelector('#a-cap').value;
        const labels = nextLabels(prefix, qty);
        try {
          await api.post(`/parties/${state.partyId}/tables/bulk`, { labels, capacity: capacity ? Number(capacity) : null });
          toast(`${labels.length} mesa(s) criada(s).`);
          await loadParty(container);
          renderTables(container);
          m.querySelector('[data-close]')?.click();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

/** Gera rótulos seguindo a numeração existente do prefixo (evita duplicados). */
function nextLabels(prefix, qty) {
  const existing = (party.tables || []).map((t) => t.label);
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(\\d+)$', 'i');
  let max = 0;
  existing.forEach((l) => { const mt = l.match(re); if (mt) max = Math.max(max, Number(mt[1])); });
  let n = max === 0 ? 1 : max + 1;
  const labels = [];
  for (let i = 0; i < qty; i++) {
    let label = `${prefix} ${String(n).padStart(2, '0')}`;
    while (existing.includes(label)) { n++; label = `${prefix} ${String(n).padStart(2, '0')}`; }
    labels.push(label);
    existing.push(label);
    n++;
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Popup de pedido: pratos do cardápio + resumo + envio
// ---------------------------------------------------------------------------
async function openOrderModal(container, tableId) {
  const table = (party.tables || []).find((t) => t.id === tableId);
  if (!table || !party) return;

  state.tableId = tableId;
  state.items = [];
  state.notes = '';
  state.priority = false;
  state.markOccupied = table.status === 'livre';

  const menu = (party.menu || []).filter((m) => m.available && m.dish_active);

  const htmlBody = `
    <div class="flex gap-1" style="align-items:center; flex-wrap:wrap; margin-bottom:.8rem;">
      <strong>🪑 ${esc(table.label)}</strong>
      ${tableStatusBadge(table.status)}
      ${table.status === 'livre' ? `
        <label class="check-row" style="margin:0;">
          <input type="checkbox" id="o-ocupada" checked />
          <span>Marcar a mesa como <strong>ocupada</strong> ao lançar</span>
        </label>` : `<span class="text-2">Mesa ${table.status === 'ocupada' ? 'já está ocupada' : `está "${table.status}"`} — sem opção de ocupação.</span>`}
    </div>
    <div class="input-group mb-2">
      <input class="input" id="o-search" placeholder="🔎 Buscar prato..." style="min-width:200px;" />
    </div>
    <div id="o-menu">${spinner()}</div>
    <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0;" />
    <div class="card-title"><h3>Resumo do pedido</h3>
      <label class="check-row" style="margin:0;"><input type="checkbox" id="o-priority" /> Alta prioridade</label>
    </div>
    <div id="o-summary"></div>
    <div class="field mt-1"><label>Observações gerais</label>
      <textarea class="textarea" id="o-notes" placeholder="Ex.: servir tudo junto, alergias..."></textarea></div>
  `;

  await modal({
    title: `Novo pedido · Mesa ${table.label}`,
    size: 'modal-lg',
    htmlBody,
    footButtons: [{ label: '🚀 Enviar para a cozinha', class: 'btn-lg btn-block', preventClose: true, onClick: (m) => submitOrder(m) }],
    onOpen: (m) => {
      m.querySelector('#o-ocupada')?.addEventListener('change', (e) => { state.markOccupied = e.target.checked; });
      m.querySelector('#o-search').addEventListener('input', (e) => {
        renderMenu(m, e.target.value.trim().toLowerCase());
      });
      m.querySelector('#o-notes').addEventListener('input', (e) => { state.notes = e.target.value; });
      m.querySelector('#o-priority').addEventListener('change', (e) => { state.priority = e.target.checked; });
      renderMenu(m);
      renderSummary(m);
    },
  });

  // Popup fechado sem envio → limpa seleção
  state.tableId = null;
  state.items = [];
}

function renderMenu(modalEl, q = '') {
  const box = modalEl.querySelector('#o-menu');
  if (!box) return;
  const menu = (party.menu || []).filter((m) => m.available && m.dish_active);
  if (!menu.length) { box.innerHTML = emptyState('🍽️', 'Nenhum prato disponível no cardápio desta festa.'); return; }
  const grouped = {};
  menu.forEach((m) => { (grouped[m.category] = grouped[m.category] || []).push(m); });

  box.innerHTML = Object.entries(grouped).map(([cat, items]) => {
    const filtered = items.filter((m) => !q || m.name.toLowerCase().includes(q));
    if (!filtered.length) return '';
    return `
      <h3 class="mt-2" style="text-transform:capitalize;">${esc(cat)}</h3>
      <div class="grid grid-2" style="grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap:.6rem;">
        ${filtered.map((m) => `
          <div class="dish-card">
            ${m.event_notes ? `<small class="text-3">📝 ${esc(m.event_notes)}</small>` : ''}
            <div class="dish-name">${esc(m.name)}</div>
            <div class="dish-cat">${esc(m.category)}</div>
            ${m.description ? `<div class="dish-desc">${esc(m.description)}</div>` : ''}
            <div class="dish-actions">
              <button class="btn btn-sm btn-ghost" data-add="${m.dish_id}" data-name="${esc(m.name)}" data-cat="${esc(m.category)}">＋ Adicionar</button>
            </div>
          </div>`).join('')}
      </div>`;
  }).join('') || emptyState('🔍', 'Nenhum prato encontrado para a busca.');

  box.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dishId = Number(btn.dataset.add);
      const existing = state.items.find((i) => i.dish_id === dishId);
      if (existing) { existing.quantity++; renderSummary(modalEl); return; }
      const comp = [];
      const item = {
        key: crypto.randomUUID(),
        dish_id: dishId,
        name: btn.dataset.name,
        category: btn.dataset.cat,
        quantity: 1,
        removed: [],
        added: [],
        notes: '',
        comp,
      };
      // Busca composição do prato para personalização
      api.get(`/dishes/${dishId}`).then((d) => { item.comp = d.composition || []; renderSummary(modalEl); }).catch(() => {});
      state.items.push(item);
      renderSummary(modalEl);
      toast(`"${btn.dataset.name}" adicionado.`, 'info');
    });
  });
}

function renderSummary(modalEl) {
  const box = modalEl.querySelector('#o-summary');
  if (!box) return;
  const totalQty = state.items.reduce((s, i) => s + i.quantity, 0);
  box.innerHTML = state.items.length
    ? state.items.map((it) => `
      <div class="order-summary-item">
        <div style="flex:1; min-width:0;">
          <div class="flex-between" style="gap:.4rem;">
            <strong style="font-size:.92rem;">${esc(it.name)}</strong>
            <button class="icon-btn" data-remove="${it.key}" title="Remover item">🗑</button>
          </div>
          <div class="qty-ctl mt-1">
            <button class="btn btn-sm btn-ghost" data-qty="${it.key}" data-d="-1">−</button>
            <span style="min-width:2rem; text-align:center; font-weight:800;">${it.quantity}</span>
            <button class="btn btn-sm btn-ghost" data-qty="${it.key}" data-d="1">＋</button>
            <button class="btn btn-sm btn-ghost" style="margin-left:auto;" data-custom="${it.key}">⚙️ Personalizar</button>
          </div>
          ${it.removed.length ? `<div style="font-size:.78rem; color:var(--danger); margin-top:.3rem;">Sem: ${it.removed.map((r) => esc(r.name)).join(', ')}</div>` : ''}
          ${it.added.length ? `<div style="font-size:.78rem; color:var(--ok);">Extra: ${it.added.map((a) => esc(a.name) + (a.qty ? ` x${esc(a.qty)}` : '')).join(', ')}</div>` : ''}
          ${it.notes ? `<div style="font-size:.78rem;" class="text-3">📝 ${esc(it.notes)}</div>` : ''}
        </div>
      </div>`).join('')
    : `<div class="empty" style="padding:1.5rem .5rem;"><div class="empty-ico">🧾</div><p class="text-3">Nenhum prato selecionado.</p></div>`;

  box.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    state.items = state.items.filter((i) => i.key !== b.dataset.remove);
    renderSummary(modalEl);
  }));
  box.querySelectorAll('[data-qty]').forEach((b) => b.addEventListener('click', () => {
    const it = state.items.find((i) => i.key === b.dataset.qty);
    if (!it) return;
    const d = Number(b.dataset.d);
    if (it.quantity + d <= 0) { state.items = state.items.filter((i) => i.key !== it.key); }
    else it.quantity += d;
    renderSummary(modalEl);
  }));
  box.querySelectorAll('[data-custom]').forEach((b) => b.addEventListener('click', () => {
    const it = state.items.find((i) => i.key === b.dataset.custom);
    if (it) openCustomize(modalEl, it);
  }));

  const btn = modalEl.querySelector('[data-foot="0"]');
  if (btn) btn.textContent = totalQty ? `🚀 Enviar (${totalQty} item${totalQty > 1 ? 's' : ''})` : '🚀 Enviar para a cozinha';
}

function openCustomize(modalEl, item) {
  const comp = item.comp || [];
  const removable = comp.filter((c) => c.is_default && c.can_remove);
  const addable = comp.filter((c) => c.can_add);

  modal({
    title: `Personalizar · ${item.name}`,
    htmlBody: `
      <div class="field">
        <label>Quantidade</label>
        <div class="qty-ctl">
          <button class="btn btn-sm btn-ghost" id="c-qty-d">−</button>
          <span id="c-qty" style="min-width:2.2rem; text-align:center; font-weight:800;">${item.quantity}</span>
          <button class="btn btn-sm btn-ghost" id="c-qty-u">＋</button>
        </div>
      </div>
      ${removable.length ? `
        <div class="field"><label>Retirar ingredientes</label>
          ${removable.map((c) => `<label class="check-row"><input type="checkbox" data-remove="${c.id}" ${item.removed.some((r) => r.id === c.id) ? 'checked' : ''} /> <span>${esc(c.name)}</span></label>`).join('')}
        </div>` : ''}
      ${addable.length ? `
        <div class="field"><label>Acrescentar ingredientes</label>
          ${addable.map((c) => {
            const ex = item.added.find((a) => a.id === c.id);
            return `<div class="check-row" style="align-items:center;">
              <input type="checkbox" data-add="${c.id}" ${ex ? 'checked' : ''} />
              <span style="flex:1;">${esc(c.name)}</span>
              <input class="input" data-add-qty="${c.id}" placeholder="qtd/obs" value="${esc(ex?.qty || '')}" style="width:110px; padding:.3rem .5rem;" />
            </div>`;
          }).join('')}
        </div>` : ''}
      <div class="field"><label>Observação do item</label>
        <textarea class="textarea" id="c-notes">${esc(item.notes)}</textarea></div>`,
    footButtons: [{ label: 'Salvar personalização', class: '' }],
    onOpen: (m) => {
      m.querySelector('#c-qty-u').onclick = () => { item.quantity++; m.querySelector('#c-qty').textContent = item.quantity; };
      m.querySelector('#c-qty-d').onclick = () => { if (item.quantity > 1) { item.quantity--; m.querySelector('#c-qty').textContent = item.quantity; } };
      m.querySelector('[data-foot="0"]').onclick = () => {
        item.removed = [...m.querySelectorAll('[data-remove]:checked')].map((c) => ({ id: Number(c.dataset.remove), name: c.closest('.check-row').querySelector('span').textContent }));
        item.added = [...m.querySelectorAll('[data-add]:checked')].map((c) => ({
          id: Number(c.dataset.add),
          name: c.closest('.check-row').querySelector('span').textContent,
          qty: m.querySelector(`[data-add-qty="${c.dataset.add}"]`)?.value || '',
        }));
        item.notes = m.querySelector('#c-notes').value;
        renderSummary(modalEl);
        toast('Personalização salva.');
        m.querySelector('[data-close]')?.click();
      };
    },
  });
}

async function submitOrder(m) {
  if (!state.tableId) return toast('Selecione a mesa do pedido.', 'error');
  if (!state.items.length) return toast('Adicione ao menos um prato ao pedido.', 'error');

  const btn = m.querySelector('[data-foot="0"]');
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const items = state.items.map((it) => ({
      dish_id: it.dish_id,
      quantity: it.quantity,
      notes: it.notes,
      removed: it.removed.map((r) => ({ ingredient_id: r.id, note: '' })),
      added: it.added.map((a) => ({ ingredient_id: a.id, quantity: a.qty, note: '' })),
    }));
    const r = await api.post('/orders', {
      client_request_id: crypto.randomUUID(),
      party_id: state.partyId,
      table_id: state.tableId,
      notes: state.notes,
      priority: state.priority,
      mark_table_occupied: state.markOccupied,
      items,
    });
    toast(`Pedido ${r.order.code} enviado para a cozinha! 🚀`);
    m.querySelector('[data-close]')?.click();
    state.partyId = null; state.tableId = null; state.items = []; state.notes = ''; state.priority = false;
    location.hash = `#/orders/${r.order.id}`;
  } catch (e) {
    toast(e.message, 'error');
    btn.disabled = false; btn.textContent = '🚀 Enviar para a cozinha';
  }
}