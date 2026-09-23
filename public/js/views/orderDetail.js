'use strict';

import { api, hasPerm, isAdmin } from '../api.js';
import { esc, formatDT, statusBadge, toast, spinner, emptyState, confirmModal, modal, timeAgo, flowStatuses, nextOf, statusLabel, ensureStatusMeta } from '../ui.js';

export const title = 'Pedido';

export async function render(container, params) {
  container.innerHTML = spinner();
  await ensureStatusMeta();
  let order;
  try {
    order = await api.get(`/orders/${params.id}`);
  } catch (e) {
    container.innerHTML = emptyState('⚠️', e.message);
    return;
  }

  const flow = flowStatuses();
  const editableKeys = flow.slice(0, 2).map((s) => s.key);
  const editable = editableKeys.includes(order.status) && (hasPerm('pedidos_editar') || isAdmin());
  const terminal = flow.length ? flow[flow.length - 1] : null;
  const adminEdit = isAdmin() && !!terminal && order.status === terminal.key;
  const canCancel = hasPerm('pedidos_cancelar') || isAdmin();
  const n = nextOf(order.status);
  const canAdvance = n && (isAdmin() || !n.advance_perm || hasPerm(n.advance_perm));
  const hideCancel = order.status === 'cancelado' || (!!terminal && order.status === terminal.key);

  const elapsed = Math.max(0, Math.round((Date.now() - new Date(order.created_at.replace(' ', 'T')).getTime()) / 60000));
  const warning = order.status === 'novo' && elapsed > 30;
  const medium = order.status === 'em_preparo' && elapsed > 20;

  container.innerHTML = `
    <div class="flex-between mb-2">
      <div>
        <div class="flex gap-1" style="align-items:center;">
          <h1 class="mono">${esc(order.code)}</h1>
          ${statusBadge(order.status)}
          ${order.priority ? '<span class="badge b-danger">🔺 Alta prioridade</span>' : ''}
        </div>
        <div class="flex gap-1 mt-1" style="flex-wrap:wrap;">
          <a class="badge b-primary" href="#/parties/${order.party_id}" style="text-decoration:none;">🎉 ${esc(order.party_name)}</a>
          <a class="badge b-primary" href="#/parties/${order.party_id}/tables" style="text-decoration:none;">🪑 ${esc(order.table_label)}</a>
          <span class="badge b-muted">🧑‍🍳 ${esc(order.created_by_name)}</span>
          <span class="badge b-muted">🕐 ${esc(formatDT(order.created_at))}</span>
          <span class="badge ${warning ? 'b-danger' : medium ? 'b-warn' : 'b-muted'}">⏱ ${elapsed} min decorridos</span>
        </div>
      </div>
      <div class="flex gap-1" style="flex-wrap:wrap; justify-content:flex-end;">
        ${canAdvance && n ? `<button class="btn" data-status="${esc(n.key)}">→ ${esc(n.label)}</button>` : ''}
        ${editable || adminEdit ? `<button class="btn btn-ghost" id="btn-edit">✏️ Editar pedido</button>` : ''}
        ${canCancel && !hideCancel ? `<button class="btn btn-danger-ghost" id="btn-cancel">✖ Cancelar</button>` : ''}
      </div>
    </div>

    <div class="grid grid-2" style="align-items:start;">
      <div>
        <div class="card">
          <div class="card-title"><h2>Itens</h2></div>
          <div id="order-items">${order.items.map(itemHTML).join('')}</div>
          ${order.notes ? `<div class="mt-2" style="background:var(--warn-soft); border-radius:8px; padding:.6rem .8rem; font-size:.9rem; color:var(--warn);"><strong>📝 Observações gerais:</strong><br/>${esc(order.notes)}</div>` : ''}
          ${order.cancel_justification ? `<div class="mt-2" style="background:var(--danger-soft); border-radius:8px; padding:.6rem .8rem; font-size:.9rem; color:var(--danger);"><strong>✖ Justificativa do cancelamento:</strong> ${esc(order.cancel_justification)}</div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-title"><h2>🕓 Histórico</h2></div>
        <ul class="timeline">
          ${order.history.map((h) => `
            <li>
              <strong>${esc(h.description)}</strong>
              <div class="tl-who">${esc(h.user_name)}</div>
              <div class="tl-time">${esc(formatDT(h.created_at))}</div>
            </li>`).join('')}
        </ul>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-status]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.status;
      if (status === 'cancelado') return;
      try {
        const r = await api.patch(`/orders/${order.id}/status`, { status });
        toast(`Pedido ${r.order.code}: ${statusLabel(r.order.status)}.`);
        location.reload();
      } catch (e) { toast(e.message, 'error'); }
    });
  });

  container.querySelector('#btn-cancel')?.addEventListener('click', async () => {
    const html = `
      <div class="field"><label>Justificativa do cancelamento <span class="req">*</span></label>
        <textarea class="textarea" id="cancel-just" placeholder="Ex.: cliente desistiu, prato errado..."></textarea></div>`;
    modal({
      title: `Cancelar ${order.code}`,
      htmlBody: html,
      footButtons: [{ label: 'Cancelar pedido', class: 'btn-danger' }],
      onOpen: (m) => {
        m.querySelector('[data-foot="0"]').onclick = async () => {
          const justification = m.querySelector('#cancel-just').value.trim();
          try {
            await api.patch(`/orders/${order.id}/status`, { status: 'cancelado', justification });
            toast('Pedido cancelado.');
            location.reload();
          } catch (e) { toast(e.message, 'error'); }
        };
      },
    });
  });

  container.querySelector('#btn-edit')?.addEventListener('click', () => openEditModal(container, order));
  container._cleanup = () => { clearInterval(container._timer); };
}

function itemHTML(it) {
  const removed = it.removed || [];
  const added = it.added || [];
  const mods = [];
  if (removed.length) mods.push(`<div class="mod mod-rem">Sem: ${removed.map((r) => esc(r.ingredient_name) + (r.note ? ` (${esc(r.note)})` : '')).join(', ')}</div>`);
  if (added.length) mods.push(`<div class="mod mod-add">Extra: ${added.map((a) => esc(a.ingredient_name) + (a.quantity ? ` x${esc(a.quantity)}` : '') + (a.note ? ` (${esc(a.note)})` : '')).join(', ')}</div>`);
  return `
    <div class="order-summary-item">
      <div style="flex:1; min-width:0;">
        <div class="flex gap-1" style="align-items:baseline;">
          <span class="mono" style="font-weight:800; min-width:2rem;">${it.quantity}×</span>
          <span><strong>${esc(it.dish_name)}</strong> <small class="text-3">· ${esc(it.dish_category)}</small></span>
        </div>
        ${mods.join('')}
        ${it.notes ? `<div style="font-size:.84rem;" class="text-2">📝 ${esc(it.notes)}</div>` : ''}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Edição do pedido
// ---------------------------------------------------------------------------
async function openEditModal(container, order) {
  const party = await api.get(`/parties/${order.party_id}`);
  const terminal = flowStatuses().length ? flowStatuses()[flowStatuses().length - 1] : null;
  const editable = order.status !== 'cancelado' && flowStatuses().slice(0, 2).some((s) => s.key === order.status)
    ? (hasPerm('pedidos_editar') || isAdmin())
    : isAdmin() && !!terminal && order.status === terminal.key;
  if (!editable) { toast('Este pedido não pode ser editado no momento.', 'error'); return; }

  // itens de trabalho (cópias editáveis)
  let items = order.items.map((it) => ({
    id: it.id,
    dish_id: it.dish_id,
    name: it.dish_name,
    category: it.dish_category,
    quantity: it.quantity,
    notes: it.notes,
    removed: it.removed.map((r) => ({ id: r.ingredient_id, name: r.ingredient_name, note: r.note })),
    added: it.added.map((a) => ({ id: a.ingredient_id, name: a.ingredient_name, qty: a.quantity, note: a.note })),
  }));

  // composições dos pratos envolvidos
  const compMap = new Map();
  const dishIds = [...new Set(items.map((i) => i.dish_id))];
  await Promise.all(dishIds.map(async (id) => {
    try { compMap.set(id, (await api.get(`/dishes/${id}`)).composition || []); } catch { compMap.set(id, []); }
  }));

  // pratos disponíveis para adicionar (não já presentes)
  const menuAll = party.menu_all || [];
  const availableDishes = menuAll.filter((m) => m.available && m.dish_active && !dishIds.includes(m.dish_id));
  await Promise.all(availableDishes.map(async (m) => {
    try { m._comp = (await api.get(`/dishes/${m.dish_id}`)).composition || []; } catch { m._comp = []; }
  }));

  modal({
    title: `Editar ${order.code}`,
    size: 'modal-lg',
    htmlBody: `<div id="edit-root"></div>`,
    footButtons: [{ label: '💾 Salvar alterações', class: '' }],
    onOpen: (m) => {
      const root = m.querySelector('#edit-root');
      const render = () => {
        root.innerHTML = `
          <strong>Itens do pedido</strong>
          <div style="display:grid; gap:.4rem; margin:.5rem 0;">
            ${items.map((it, idx) => `
              <div class="card" data-i="${idx}">
                <div class="flex-between"><strong>${esc(it.name)}</strong>
                  <button class="icon-btn" data-del="${idx}" title="Remover item">🗑</button></div>
                <div class="flex gap-1 mt-1" style="align-items:center;">
                  <button class="btn btn-sm btn-ghost" data-qty="${idx}" data-d="-1">−</button>
                  <span style="min-width:2rem;text-align:center;font-weight:800;">${it.quantity}</span>
                  <button class="btn btn-sm btn-ghost" data-qty="${idx}" data-d="1">＋</button>
                  <button class="btn btn-sm btn-ghost" data-custom="${idx}" style="margin-left:auto;">⚙️ Personalizar</button>
                </div>
                ${it.removed.length ? `<div style="font-size:.78rem;color:var(--danger);">Sem: ${it.removed.map((r) => esc(r.name)).join(', ')}</div>` : ''}
                ${it.added.length ? `<div style="font-size:.78rem;color:var(--ok);">Extra: ${it.added.map((a) => esc(a.name) + (a.qty ? ` x${esc(a.qty)}` : '')).join(', ')}</div>` : ''}
                ${it.notes ? `<div style="font-size:.78rem;" class="text-3">📝 ${esc(it.notes)}</div>` : ''}
              </div>`).join('')}
          </div>

          <div class="field mb-2"><label>Observações gerais do pedido</label>
            <textarea class="textarea" id="edit-notes">${esc(order.notes || '')}</textarea></div>
          <label class="check-row"><input type="checkbox" id="edit-priority" ${order.priority ? 'checked' : ''} /> Alta prioridade</label>

          ${availableDishes.length ? `
          <hr style="border:none;border-top:1px solid var(--border);margin:1rem 0;" />
          <strong>Adicionar pratos</strong>
          <div class="field mt-1"><input class="input" id="edit-search" placeholder="🔎 Buscar prato do cardápio da festa..." /></div>
          <div id="edit-addlist" style="display:grid; gap:.4rem; max-height:200px; overflow-y:auto; margin-top:.5rem;"></div>` : '<p class="text-3 mt-2">Todos os pratos do cardápio já estão no pedido.</p>'}
        `;
        bindEditEvents(m);
      };
      const bindEditEvents = (m) => {
        root.querySelectorAll('[data-qty]').forEach((b) => b.addEventListener('click', () => {
          const it = items[Number(b.dataset.qty)]; const d = Number(b.dataset.d);
          if (it.quantity + d <= 0) { items = items.filter((_, i) => i !== Number(b.dataset.qty)); }
          else it.quantity += d;
          render();
        }));
        root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
          items = items.filter((_, i) => i !== Number(b.dataset.del)); render();
        }));
        root.querySelectorAll('[data-custom]').forEach((b) => b.addEventListener('click', () => {
          const idx = Number(b.dataset.custom);
          customizeItem(m, items[idx], compMap.get(items[idx].dish_id) || [], render);
        }));

        // busca de pratos para adicionar
        const search = root.querySelector('#edit-search');
        const list = root.querySelector('#edit-addlist');
        if (search) {
          const draw = () => {
            const q = search.value.trim().toLowerCase();
            const opts = availableDishes.filter((d) => d.name.toLowerCase().includes(q));
            list.innerHTML = opts.length ? opts.map((d, i) => `
              <div class="card" style="padding:.5rem .7rem; display:flex; align-items:center; gap:.6rem;">
                <span style="flex:1;"><strong>${esc(d.name)}</strong> <small class="text-3">· ${esc(d.category)}</small></span>
                <button class="btn btn-sm" data-add="${i}">＋ Add</button>
              </div>`).join('') : '<small class="text-3">Nenhum resultado.</small>';
            list.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
              const d = availableDishes[Number(b.dataset.add)];
              items.push({ id: null, dish_id: d.dish_id, name: d.name, category: d.category, quantity: 1, removed: [], added: [], notes: '' });
              compMap.set(d.dish_id, d._comp);
              render();
            }));
          };
          search.addEventListener('input', draw);
          draw();
        }
        root.querySelector('#edit-notes').addEventListener('input', () => {});
      };
      render();

      m.querySelector('[data-foot="0"]').onclick = async () => {
        const notes = m.querySelector('#edit-notes')?.value ?? order.notes;
        const priority = m.querySelector('#edit-priority')?.checked ?? !!order.priority;
        const payload = {
          notes,
          priority,
          items: items.map((it) => ({
            id: it.id,
            dish_id: it.dish_id,
            quantity: it.quantity,
            notes: it.notes,
            removed: it.removed.map((r) => ({ ingredient_id: r.id, note: r.note || '' })),
            added: it.added.map((a) => ({ ingredient_id: a.id, quantity: a.qty || '', note: a.note || '' })),
          })),
        };
        try {
          const r = await api.put(`/orders/${order.id}`, payload);
          toast(`Pedido ${r.order.code} atualizado.`);
          location.reload();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

function customizeItem(m, item, comp, after) {
  const removable = comp.filter((c) => c.is_default && c.can_remove);
  const addable = comp.filter((c) => c.can_add);
  const wrap = m.querySelector('#edit-root');
  // Reutiliza estrutura do modal atual: abre sub-modal
  modal({
    title: `Personalizar · ${item.name}`,
    htmlBody: `
      <div class="field"><label>Quantidade</label>
        <div class="qty-ctl">
          <button class="btn btn-sm btn-ghost" id="q-d">−</button><span id="q-v" style="min-width:2rem;text-align:center;font-weight:800;">${item.quantity}</span><button class="btn btn-sm btn-ghost" id="q-u">＋</button>
        </div></div>
      ${removable.length ? `<div class="field"><label>Retirar ingredientes</label>${removable.map((c) => `<label class="check-row"><input type="checkbox" data-rem="${c.id}" ${item.removed.some((r) => r.id === c.id) ? 'checked' : ''} /><span>${esc(c.name)}</span></label>`).join('')}</div>` : ''}
      ${addable.length ? `<div class="field"><label>Acrescentar ingredientes</label>${addable.map((c) => { const ex = item.added.find((a) => a.id === c.id); return `<div class="check-row"><input type="checkbox" data-add="${c.id}" ${ex ? 'checked' : ''} /><span style="flex:1;">${esc(c.name)}</span><input class="input" data-addq="${c.id}" placeholder="qtd/obs" value="${esc(ex?.qty || '')}" style="width:110px;padding:.3rem .5rem;" /></div>`; }).join('')}</div>` : ''}
      <div class="field"><label>Observação do item</label><textarea class="textarea" id="it-notes">${esc(item.notes)}</textarea></div>`,
    footButtons: [{ label: 'Salvar', class: '' }],
    onOpen: (sub) => {
      sub.querySelector('#q-u').onclick = () => { item.quantity++; sub.querySelector('#q-v').textContent = item.quantity; };
      sub.querySelector('#q-d').onclick = () => { if (item.quantity > 1) { item.quantity--; sub.querySelector('#q-v').textContent = item.quantity; } };
      sub.querySelector('[data-foot="0"]').onclick = () => {
        item.removed = [...sub.querySelectorAll('[data-rem]:checked')].map((c) => ({ id: Number(c.dataset.rem), name: c.closest('.check-row').querySelector('span').textContent }));
        item.added = [...sub.querySelectorAll('[data-add]:checked')].map((c) => ({ id: Number(c.dataset.add), name: c.closest('.check-row').querySelector('span').textContent, qty: sub.querySelector(`[data-addq="${c.dataset.add}"]`)?.value || '' }));
        item.notes = sub.querySelector('#it-notes').value;
        after();
        toast('Personalização salva.');
        sub.querySelector('[data-close]')?.click();
      };
    },
  });
}