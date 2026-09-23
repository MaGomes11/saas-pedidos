'use strict';

import { api } from '../api.js';
import { esc, toast, spinner, emptyState, modal, confirmModal, statusBadge, setStatusMeta } from '../ui.js';

export const title = 'Status de pedidos';

const COLORS = [
  { value: 'primary', label: 'Azul', css: 'var(--primary)' },
  { value: 'warn', label: 'Âmbar', css: 'var(--warn)' },
  { value: 'ok', label: 'Verde', css: 'var(--ok)' },
  { value: 'muted', label: 'Cinza', css: 'var(--text-2)' },
  { value: 'danger', label: 'Vermelho', css: 'var(--danger)' },
];

const state = { list: [], perms: {} };

export async function render(container) {
  container.innerHTML = spinner();
  try {
    const [list, perms] = await Promise.all([
      api.get('/order-statuses'),
      api.get('/auth/permission-labels').catch(() => ({})),
    ]);
    state.list = list;
    state.perms = perms;
  } catch (e) {
    container.innerHTML = emptyState('⚠️', e.message);
    return;
  }
  container.innerHTML = view();
  wire(container);
}

function colorCss(color) {
  return (COLORS.find((c) => c.value === color) || COLORS[0]).css;
}

function permLabel(perm) {
  if (!perm) return '<span class="text-3">Qualquer usuário</span>';
  return state.perms[perm] || perm;
}

function view() {
  const rows = [...state.list].sort((a, b) => a.sort - b.sort || a.id - b.id).map((s, i, arr) => {
    const systemLock = s.is_system
      ? '<span class="badge b-muted" title="Status de sistema (fixo)">🔒 fixo</span>'
      : '';
    const isFirstMove = !s.is_system && i >= 1 && i <= arr.length - 1;
    const moveBtns = s.is_system
      ? ''
      : `
        <button class="icon-btn" data-move="${s.id}" data-dir="-1" title="Mover para cima (fica antes na ordem)">▲</button>
        <button class="icon-btn" data-move="${s.id}" data-dir="1" title="Mover para baixo (fica depois na ordem)">▼</button>`;
    const del = s.is_system
      ? ''
      : `<button class="icon-btn" data-del="${s.id}" title="Excluir status">🗑</button>`;
    const flowPos = s.key === 'cancelado' ? '<span class="badge b-muted">fora do fluxo</span>' : (s.active ? `<span class="badge b-ok">no fluxo</span>` : '<span class="badge b-warn">inativo</span>');
    return `
      <tr>
        <td class="mono">${esc(s.key)}</td>
        <td>${statusBadge(s.key)}</td>
        <td><span class="swatch" style="background:${colorCss(s.color)};display:inline-block;width:14px;height:14px;border-radius:50%;vertical-align:middle;"></span> ${esc(COLORS.find((c) => c.value === s.color)?.label || s.color)}</td>
        <td>${permLabel(s.advance_perm)}</td>
        <td>${flowPos} ${systemLock}</td>
        <td class="nowrap">${moveBtns} <button class="icon-btn" data-edit="${s.id}" title="Editar status">✏️</button> ${del}</td>
      </tr>`;
  }).join('');

  return `
    <div class="flex-between mb-2">
      <h1>Status de pedidos</h1>
      <button class="btn" id="btn-new">＋ Novo status</button>
    </div>
    <div class="card mb-2" style="padding:.75rem 1rem;">
      <p class="text-3" style="margin:0;">A <b>ordem</b> da lista define o <b>próximo status</b>: cada pedido avança para o status que vem logo depois do atual. "Novo" é sempre o primeiro (fixo) e "Cancelado" fica fora do fluxo. Para cada status você escolhe <b>quem pode avançar para ele</b> (permissão).</p>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Chave</th><th>Status</th><th>Cor</th><th>Permissão p/ avançar</th><th>Situação</th><th>Ações</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function wire(container) {
  container.querySelector('#btn-new').onclick = () => openForm(container, null);
  container.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => openForm(container, Number(b.dataset.edit));
  });
  container.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const status = state.list.find((s) => s.id === Number(b.dataset.del));
      if (!status) return;
      const ok = await confirmModal({
        title: 'Excluir status',
        message: `Excluir o status "${status.label}"? Pedidos que ainda usam esse status impedem a exclusão.`,
        confirmText: 'Excluir', danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/order-statuses/${status.id}`);
        toast(`Status "${status.label}" excluído.`);
        await reload(container);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
  container.querySelectorAll('[data-move]').forEach((b) => {
    b.onclick = async () => {
      const dir = Number(b.dataset.dir);
      try {
        await api.post(`/order-statuses/${b.dataset.move}/move`, { dir });
        await reload(container);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
}

function permOptions(selected) {
  const entries = Object.entries(state.perms).sort((a, b) => a[1].localeCompare(b[1]));
  return `
    <option value="">— qualquer usuário autenticado</option>
    ${entries.map(([k, l]) => `<option value="${esc(k)}" ${k === selected ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
}

function colorSwatches(color) {
  return COLORS.map((c) => `
    <label class="color-opt" style="display:inline-flex;align-items:center;gap:.4rem;margin-right:.75rem;cursor:pointer;">
      <input type="radio" name="color" value="${c.value}" ${c.value === color ? 'checked' : ''}>
      <span class="swatch" style="background:${c.css};display:inline-block;width:16px;height:16px;border-radius:50%;"></span> ${c.label}
    </label>`).join('');
}

async function openForm(container, id) {
  const existing = id ? state.list.find((s) => s.id === id) : null;
  const isSystem = !!(existing && existing.is_system);
  const htmlBody = `
    ${existing ? '' : `
    <label class="form-label">Chave (usada internamente — não muda depois)</label>
    <input class="input" id="f-key" placeholder="ex.: aguardando" pattern="[a-z][a-z0-9_]*" required>
    <small class="text-3">Letras minúsculas, números e _ (ex.: aguardando_chef).</small>
    `}
    <label class="form-label mt-2">Nome do status</label>
    <input class="input" id="f-label" value="${existing ? esc(existing.label) : ''}" required>
    <label class="form-label mt-2">Cor do selo</label>
    <div id="f-colors">${colorSwatches(existing ? existing.color : 'primary')}</div>
    <label class="form-label mt-2">Quem pode avançar PARA este status?</label>
    <select class="select" id="f-perm" style="width:100%;">${permOptions(existing ? existing.advance_perm : '')}</select>
    ${isSystem ? '' : `
    <label class="check mt-2" style="display:flex;align-items:center;gap:.5rem;">
      <input type="checkbox" id="f-active" ${!existing || existing.active ? 'checked' : ''}> Ativo (aparece em filtros e no fluxo)
    </label>`}
  `;

  const res = await modal({
    title: existing ? `Editar status "${existing.label}"` : 'Novo status',
    htmlBody,
    footButtons: [
      { label: 'Cancelar', class: 'btn-ghost' },
      { label: existing ? 'Salvar' : 'Criar', class: '', preventClose: true, onClick: async (m) => handleSave(container, m, existing) },
    ],
  });
}

async function handleSave(container, modalEl, existing) {
  const label = (modalEl.querySelector('#f-label')?.value || '').trim();
  if (!label) { toast('Informe o nome do status.', 'error'); return; }
  if (!existing) {
    const key = (modalEl.querySelector('#f-key')?.value || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) { toast('Chave inválida: use letras minúsculas, números e _.', 'error'); return; }
    try {
      await api.post('/order-statuses', {
        key, label,
        color: (modalEl.querySelector('input[name="color"]:checked')?.value || 'primary'),
        advance_perm: modalEl.querySelector('#f-perm')?.value || '',
        active: modalEl.querySelector('#f-active')?.checked ? 1 : 0,
      });
      toast(`Status "${label}" criado.`);
      modalEl.remove();
      await reload(container);
    } catch (e) { toast(e.message, 'error'); }
    return;
  }
  try {
    await api.patch(`/order-statuses/${existing.id}`, {
      label,
      color: (modalEl.querySelector('input[name="color"]:checked')?.value || existing.color),
      advance_perm: modalEl.querySelector('#f-perm')?.value || '',
      active: modalEl.querySelector('#f-active') ? (modalEl.querySelector('#f-active').checked ? 1 : 0) : existing.active,
    });
    toast('Status atualizado.');
    modalEl.remove();
    await reload(container);
  } catch (e) { toast(e.message, 'error'); }
}

async function reload(container) {
  const list = await api.get('/order-statuses');
  state.list = list;
  setStatusMeta(list); // atualiza badges em todas as telas
  container.innerHTML = view();
  wire(container);
}