'use strict';

import { api } from '../api.js';
import { esc, toast, confirmModal, spinner, emptyState, modal, debounce } from '../ui.js';

export const title = 'Ingredientes';

export function render(container) {
  container.innerHTML = `
    <div class="flex-between mb-2">
      <h1>Ingredientes</h1>
      <button class="btn" id="btn-new">＋ Novo ingrediente</button>
    </div>
    <div class="toolbar">
      <div class="input-group" style="flex:1; min-width:180px;"><input class="input" id="f-q" placeholder="🔎 Buscar ingrediente..." /></div>
      <label class="check-row"><input type="checkbox" id="f-inactive" /> Incluir inativos</label>
    </div>
    <div id="ings-list">${spinner()}</div>
  `;

  container.querySelector('#f-q').addEventListener('input', debounce(load, 300));
  container.querySelector('#f-inactive').addEventListener('change', load);
  container.querySelector('#btn-new').addEventListener('click', () => openForm(container, null));
  load(container);
}

async function load() {
  const root = document.querySelector('#view');
  const q = root.querySelector('#f-q').value.trim();
  const inactive = root.querySelector('#f-inactive').checked;
  const query = new URLSearchParams();
  if (inactive) query.set('all', '1');
  if (q) query.set('q', q);
  try {
    const ings = await api.get(`/ingredients?${query}`);
    root.querySelector('#ings-list').innerHTML = ings.length ? `
      <div class="table-wrap" style="max-width:900px;"><table class="tbl">
        <thead><tr><th>Ingrediente</th><th>Pode retirar</th><th>Pode acrescentar</th><th>Observações</th><th>Status</th><th></th></tr></thead>
        <tbody>${ings.map((i) => `
          <tr data-id="${i.id}">
            <td><strong>${esc(i.name)}</strong>${i.description ? `<div class="text-3" style="font-size:.8rem;">${esc(i.description)}</div>` : ''}</td>
            <td>${i.can_remove ? '✅' : '—'}</td>
            <td>${i.can_add ? '✅' : '—'}</td>
            <td class="text-3">${esc(i.notes || '—')}</td>
            <td>${i.active ? '<span class="badge b-ok">Ativo</span>' : '<span class="badge b-muted">Inativo</span>'}</td>
            <td class="actions">
              <button class="btn btn-sm btn-ghost" data-edit>✏️</button>
              <button class="btn btn-sm ${i.active ? 'btn-danger-ghost' : 'btn-ok'}" data-toggle>${i.active ? 'Inativar' : 'Ativar'}</button>
            </td>
          </tr>`).join('')}</tbody>
      </table></div>` : emptyState('🥕', 'Nenhum ingrediente encontrado.');
    bindActions(root);
  } catch (e) {
    root.querySelector('#ings-list').innerHTML = emptyState('⚠️', e.message);
  }
}

function bindActions(root) {
  root.querySelectorAll('#ings-list tr[data-id]').forEach((tr) => {
    const id = Number(tr.dataset.id);
    tr.querySelector('[data-edit]').addEventListener('click', () => {
      api.get('/ingredients?all=1').then((ings) => openForm(root, ings.find((x) => x.id === id), id));
    });
    tr.querySelector('[data-toggle]').addEventListener('click', async () => {
      const ings = await api.get('/ingredients?all=1');
      const ing = ings.find((x) => x.id === id);
      const ok = await confirmModal({
        title: ing.active ? 'Inativar ingrediente' : 'Ativar ingrediente',
        message: `${ing.active ? 'Inativar' : 'Ativar'} "${ing.name}"? O histórico de pedidos permanece preservado.`,
      });
      if (!ok) return;
      await api.put(`/ingredients/${id}`, { active: !ing.active });
      toast(ing.active ? 'Ingrediente inativado.' : 'Ingrediente ativado.');
      load();
    });
  });
}

function openForm(root, data, id) {
  modal({
    title: data ? `Editar: ${data.name}` : 'Novo ingrediente',
    htmlBody: `
      <div class="form-grid">
        <div class="field"><label>Nome <span class="req">*</span></label><input class="input" id="i-name" value="${esc(data?.name || '')}" /></div>
        <div class="field"><label>Descrição (opcional)</label><input class="input" id="i-desc" value="${esc(data?.description || '')}" /></div>
        <div class="field" style="grid-column:1/-1;"><label>Observações (opcional)</label><input class="input" id="i-notes" value="${esc(data?.notes || '')}" /></div>
        <label class="check-row"><input type="checkbox" id="i-remove" ${!data || data.can_remove ? 'checked' : ''} /> Pode ser retirado do prato</label>
        <label class="check-row"><input type="checkbox" id="i-add" ${!data || data.can_add ? 'checked' : ''} /> Pode ser acrescentado ao prato</label>
        <label class="check-row" style="grid-column:1/-1;"><input type="checkbox" id="i-active" ${!data || data.active ? 'checked' : ''} /> Ativo</label>
      </div>`,
    footButtons: [{ label: data ? 'Salvar' : 'Criar', class: '' }],
    onOpen: (m) => {
      m.querySelector('#i-name').focus();
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const name = m.querySelector('#i-name').value.trim();
        if (!name) return toast('Informe o nome.', 'error');
        const payload = {
          name,
          description: m.querySelector('#i-desc').value,
          notes: m.querySelector('#i-notes').value,
          can_remove: m.querySelector('#i-remove').checked,
          can_add: m.querySelector('#i-add').checked,
          active: m.querySelector('#i-active').checked,
        };
        try {
          if (id) { await api.put(`/ingredients/${id}`, payload); toast('Ingrediente atualizado.'); }
          else { await api.post('/ingredients', payload); toast('Ingrediente criado.'); }
          load();
          m.querySelector('[data-close]')?.click();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}