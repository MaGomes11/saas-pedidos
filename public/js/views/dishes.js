'use strict';

import { api } from '../api.js';
import { esc, toast, confirmModal, spinner, emptyState, modal, debounce } from '../ui.js';

export const title = 'Pratos';

export function render(container) {
  container.innerHTML = `
    <div class="flex-between mb-2">
      <h1>Pratos</h1>
      <button class="btn" id="btn-new">＋ Novo prato</button>
    </div>
    <div class="toolbar">
      <div class="input-group" style="flex:1; min-width:180px;"><input class="input" id="f-q" placeholder="🔎 Buscar prato..." /></div>
      <select class="select" id="f-cat"><option value="">Todas as categorias</option></select>
      <label class="check-row"><input type="checkbox" id="f-inactive" /> Incluir inativos</label>
    </div>
    <div id="dishes-list">${spinner()}</div>
  `;

  const q = container.querySelector('#f-q');
  q.addEventListener('input', debounce(load, 300));
  container.querySelector('#f-inactive').addEventListener('change', load);
  container.querySelector('#f-cat').addEventListener('change', load);
  container.querySelector('#btn-new').addEventListener('click', () => openForm(container, null));
  api.get('/ingredients/categories').then((cats) => {
    container.querySelector('#f-cat').innerHTML += cats.map((c) => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('');
  });
  load(container);
}

async function load() {
  const root = document.querySelector('#view');
  const q = root.querySelector('#f-q').value.trim();
  const cat = root.querySelector('#f-cat').value;
  const inactive = root.querySelector('#f-inactive').checked;
  const query = new URLSearchParams();
  if (inactive) query.set('all', '1');
  if (q) query.set('q', q);
  if (cat) query.set('category', cat);
  try {
    const dishes = await api.get(`/dishes?${query}`);
    root.querySelector('#dishes-list').innerHTML = dishes.length ? `
      <div class="grid grid-2" style="grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));">
        ${dishes.map((d) => `
          <div class="card" data-id="${d.id}">
            <div class="flex gap-2" style="align-items:flex-start;">
              ${d.image_data ? `<img src="${d.image_data}" alt="" style="width:64px; height:64px; object-fit:cover; border-radius:8px;" />` : ''}
              <div style="flex:1; min-width:0;">
                <div class="flex-between">
                  <strong>${esc(d.name)}</strong>
                  ${d.active ? '<span class="badge b-ok">Ativo</span>' : '<span class="badge b-muted">Inativo</span>'}
                </div>
                <span class="badge b-primary" style="margin-top:.25rem;">${esc(d.category)}</span>
                ${d.description ? `<p class="text-2" style="margin:.3rem 0; font-size:.86rem;">${esc(d.description)}</p>` : ''}
                <div class="text-3" style="font-size:.8rem;">🧩 ${d.composition.filter((c) => c.is_default).length} ingredientes padrão</div>
              </div>
            </div>
            <div class="flex gap-1 mt-1" style="flex-wrap:wrap;">
              <button class="btn btn-sm btn-ghost" data-act="comp">🧩 Composição</button>
              <button class="btn btn-sm btn-ghost" data-act="edit">✏️ Editar</button>
              <button class="btn btn-sm ${d.active ? 'btn-danger-ghost' : 'btn-ok'}" data-act="toggle">${d.active ? 'Inativar' : 'Ativar'}</button>
            </div>
          </div>`).join('')}
      </div>` : emptyState('🍲', 'Nenhum prato encontrado.');
    bindActions(root);
  } catch (e) {
    root.querySelector('#dishes-list').innerHTML = emptyState('⚠️', e.message);
  }
}

function bindActions(root) {
  root.querySelectorAll('#dishes-list .card').forEach((card) => {
    const id = Number(card.dataset.id);
    card.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        const d = await api.get(`/dishes/${id}`);
        if (act === 'edit') openForm(root, d);
        else if (act === 'comp') openComposition(root, d);
        else if (act === 'toggle') {
          const ok = await confirmModal({
            title: d.active ? 'Inativar prato' : 'Ativar prato',
            message: `${d.active ? 'Inativar' : 'Ativar'} "${d.name}"? O histórico de pedidos continua preservado.`,
          });
          if (!ok) return;
          await api.put(`/dishes/${id}`, { active: !d.active });
          toast(d.active ? 'Prato inativado.' : 'Prato ativado.');
          load();
        }
      });
    });
  });
}

async function openForm(root, data) {
  const cats = await api.get('/ingredients/categories');
  modal({
    title: data ? `Editar: ${data.name}` : 'Novo prato',
    size: 'modal-lg',
    htmlBody: `
      <div class="form-grid">
        <div class="field"><label>Nome <span class="req">*</span></label><input class="input" id="p-name" value="${esc(data?.name || '')}" /></div>
        <div class="field"><label>Categoria <span class="req">*</span></label>
          <select class="select" id="p-cat">${cats.map((c) => `<option value="${esc(c.key)}" ${data?.category === c.key ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field" style="grid-column:1/-1;"><label>Descrição</label><input class="input" id="p-desc" value="${esc(data?.description || '')}" /></div>
        <div class="field" style="grid-column:1/-1;"><label>Observações de preparo</label><textarea class="textarea" id="p-prep">${esc(data?.prep_notes || '')}</textarea></div>
        <div class="field" style="grid-column:1/-1;">
          <label>Imagem (opcional)</label>
          <input class="input" type="file" id="p-img" accept="image/*" />
          <div class="hint">Máx. ~2 MB. A imagem fica salva no sistema.</div>
          ${data?.image_data ? `<div style="margin-top:.4rem;"><img src="${data.image_data}" style="max-height:90px; border-radius:8px;" alt="prato" /></div>` : ''}
        </div>
        <label class="check-row" style="grid-column:1/-1;"><input type="checkbox" id="p-active" ${!data || data.active ? 'checked' : ''} /> Prato ativo</label>
      </div>`,
    footButtons: [{ label: data ? 'Salvar' : 'Criar prato', class: '' }],
    onOpen: (m) => {
      m.querySelector('#p-name').focus();
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const name = m.querySelector('#p-name').value.trim();
        const category = m.querySelector('#p-cat').value;
        if (!name) return toast('Informe o nome do prato.', 'error');
        if (!category) return toast('Selecione a categoria.', 'error');
        let image_data = data?.image_data || null;
        const file = m.querySelector('#p-img').files[0];
        if (file) {
          if (file.size > 2.5 * 1024 * 1024) return toast('Imagem muito grande (máx. ~2 MB).', 'error');
          image_data = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.readAsDataURL(file);
          });
        }
        const payload = {
          name, category,
          description: m.querySelector('#p-desc').value,
          prep_notes: m.querySelector('#p-prep').value,
          active: m.querySelector('#p-active').checked,
        };
        if (image_data) payload.image_data = image_data;
        try {
          if (data) {
            await api.put(`/dishes/${data.id}`, payload);
            toast('Prato atualizado.');
            m.querySelector('[data-close]')?.click();
          } else {
            const created = await api.post('/dishes', payload);
            toast('Prato criado. Configure a composição de ingredientes.');
            m.querySelector('[data-close]')?.click();
            openComposition(root, created);
          }
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

async function openComposition(root, dish) {
  const ings = await api.get('/ingredients');
  const comp = dish.composition || [];
  const byIng = new Map(comp.map((c) => [c.id, c]));
  modal({
    title: `Composição · ${dish.name}`,
    size: 'modal-lg',
    htmlBody: `
      <p class="hint">"Padrão" = entra na composição básica do prato. "Pode retirar" = cliente pode pedir sem. "Pode acrescentar" = cliente pode pedir a mais (mesmo que não seja padrão).</p>
      <div class="table-wrap" style="max-height:55vh; overflow-y:auto;">
        <table class="tbl">
          <thead><tr><th>Ingrediente</th><th style="text-align:center;">Padrão</th><th style="text-align:center;">Pode retirar</th><th style="text-align:center;">Pode acrescentar</th></tr></thead>
          <tbody>
            ${ings.length ? ings.map((ing) => {
              const c = byIng.get(ing.id) || {};
              return `<tr>
                <td>${esc(ing.name)} ${ing.active ? '' : '<span class="badge b-muted">inativo</span>'}</td>
                <td style="text-align:center;"><input type="checkbox" data-row="${ing.id}" data-flag="is_default" ${c.is_default ? 'checked' : ''} /></td>
                <td style="text-align:center;"><input type="checkbox" data-row="${ing.id}" data-flag="can_remove" ${c.can_remove ? 'checked' : ''} /></td>
                <td style="text-align:center;"><input type="checkbox" data-row="${ing.id}" data-flag="can_add" ${c.can_add ? 'checked' : ''} /></td>
              </tr>`;
            }).join('') : '<tr><td colspan="4">Cadastre ingredientes primeiro.</td></tr>'}
          </tbody>
        </table>
      </div>`,
    footButtons: [{ label: 'Salvar composição', class: '' }],
    onOpen: (m) => {
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const ingredients = ings.map((ing) => ({
          id: ing.id,
          is_default: m.querySelector(`[data-row="${ing.id}"][data-flag="is_default"]`).checked,
          can_remove: m.querySelector(`[data-row="${ing.id}"][data-flag="can_remove"]`).checked,
          can_add: m.querySelector(`[data-row="${ing.id}"][data-flag="can_add"]`).checked,
        }));
        try {
          await api.put(`/dishes/${dish.id}/composition`, { ingredients });
          toast('Composição salva.');
          m.querySelector('[data-close]')?.click();
          load();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}