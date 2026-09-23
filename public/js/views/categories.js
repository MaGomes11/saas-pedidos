'use strict';

import { api } from '../api.js';
import { esc, toast, spinner, emptyState, modal, confirmModal } from '../ui.js';

export const title = 'Categorias de pratos';

const state = { list: [] };

export async function render(container) {
  container.innerHTML = spinner();
  try {
    state.list = await api.get('/categories');
  } catch (e) {
    container.innerHTML = emptyState('⚠️', e.message);
    return;
  }
  container.innerHTML = view();
  wire(container);
}

function view() {
  const rows = [...state.list].sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key)).map((c, i, arr) => {
    const canUp = i > 0;
    const canDown = i < arr.length - 1;
    return `
      <tr>
        <td class="mono">${esc(c.key)}</td>
        <td><strong>${esc(c.name)}</strong></td>
        <td>
          ${c.dish_count > 0
            ? `<span class="badge b-ok">${c.dish_count} prato(s)</span>`
            : '<span class="badge b-muted">sem pratos</span>'}
        </td>
        <td class="nowrap">
          <button class="icon-btn" data-move="${esc(c.key)}" data-dir="-1" ${canUp ? '' : 'disabled'} title="Mover para cima">▲</button>
          <button class="icon-btn" data-move="${esc(c.key)}" data-dir="1" ${canDown ? '' : 'disabled'} title="Mover para baixo">▼</button>
          <button class="icon-btn" data-edit="${esc(c.key)}" title="Editar categoria">✏️</button>
          <button class="icon-btn" data-del="${esc(c.key)}" title="Excluir categoria">🗑</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="flex-between mb-2">
      <h1>Categorias de pratos</h1>
      <button class="btn" id="btn-new">＋ Nova categoria</button>
    </div>
    <div class="card mb-2" style="padding:.75rem 1rem;">
      <p class="text-3" style="margin:0;">As categorias organizam o cardápio (ex.: entrada, prato principal, sobremesa). Cada prato pertence a uma categoria — para excluir, primeiro mova ou remova os pratos dela.</p>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Chave</th><th>Nome</th><th>Uso</th><th>Ações</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function wire(container) {
  container.querySelector('#btn-new').onclick = () => openForm(container, null);
  container.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => openForm(container, b.dataset.edit);
  });
  container.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const cat = state.list.find((c) => c.key === b.dataset.del);
      if (!cat) return;
      if (cat.dish_count > 0) {
        toast(`A categoria "${cat.name}" tem ${cat.dish_count} prato(s) e não pode ser excluída.`, 'error');
        return;
      }
      const ok = await confirmModal({
        title: 'Excluir categoria',
        message: `Excluir a categoria "${cat.name}"?`,
        confirmText: 'Excluir', danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/categories/${encodeURIComponent(cat.key)}`);
        toast(`Categoria "${cat.name}" excluída.`);
        await reload(container);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
  container.querySelectorAll('[data-move]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api.post(`/categories/${encodeURIComponent(b.dataset.move)}/move`, { dir: Number(b.dataset.dir) });
        await reload(container);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
  });
}

async function openForm(container, key) {
  const existing = key ? state.list.find((c) => c.key === key) : null;
  const htmlBody = `
    ${existing ? '' : `
    <label class="form-label">Chave (usada nas receitas — não pode mudar depois)</label>
    <input class="input" id="f-key" placeholder="ex.: grelhados" pattern="[a-z][a-z0-9_]*" required>
    <small class="text-3">Letras minúsculas, números e _ (ex.: grelhados).</small>
    `}
    <label class="form-label mt-2">Nome</label>
    <input class="input" id="f-name" value="${existing ? esc(existing.name) : ''}" required placeholder="ex.: Grelhados">
  `;

  await modal({
    title: existing ? `Editar categoria "${existing.name}"` : 'Nova categoria',
    htmlBody,
    footButtons: [
      { label: 'Cancelar', class: 'btn-ghost' },
      { label: existing ? 'Salvar' : 'Criar', class: '', preventClose: true, onClick: async (m) => handleSave(container, m, existing) },
    ],
  });
}

async function handleSave(container, modalEl, existing) {
  const name = (modalEl.querySelector('#f-name')?.value || '').trim();
  if (!name) { toast('Informe o nome da categoria.', 'error'); return; }
  try {
    if (existing) {
      await api.patch(`/categories/${encodeURIComponent(existing.key)}`, { name });
      toast('Categoria atualizada.');
    } else {
      const key = (modalEl.querySelector('#f-key')?.value || '').trim().toLowerCase();
      if (!/^[a-z][a-z0-9_]*$/.test(key)) { toast('Chave inválida: use letras minúsculas, números e _.', 'error'); return; }
      await api.post('/categories', { key, name });
      toast(`Categoria "${name}" criada.`);
    }
    modalEl.remove();
    await reload(container);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function reload(container) {
  state.list = await api.get('/categories');
  container.innerHTML = view();
  wire(container);
}