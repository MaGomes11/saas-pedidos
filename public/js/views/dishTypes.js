'use strict';

import { api } from '../api.js';
import { esc, formatDT, toast, confirmModal, spinner, emptyState, modal, debounce } from '../ui.js';

export const title = 'Tipos de cardápio';

export function render(container) {
  container.innerHTML = `
    <div class="flex-between mb-2">
      <h1>Tipos de cardápio</h1>
      <button class="btn" id="btn-new">＋ Novo tipo</button>
    </div>
    <div class="toolbar">
      <div class="input-group" style="flex:1; min-width:180px;"><input class="input" id="f-q" placeholder="🔎 Buscar..." /></div>
      <label class="check-row"><input type="checkbox" id="f-inactive" /> Incluir inativos</label>
    </div>
    <div id="types-list">${spinner()}</div>
  `;

  const q = container.querySelector('#f-q');
  q.addEventListener('input', debounce(load, 300));
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
    const types = await api.get(`/dish-types?${query}`);
    root.querySelector('#types-list').innerHTML = types.length ? `
      <div class="grid" style="max-width:900px;">
        ${types.map((t) => `
          <div class="card" data-id="${t.id}">
            <div class="flex-between">
              <h3 style="margin:0;">${esc(t.name)}</h3>
              ${t.active ? '<span class="badge b-ok">Ativo</span>' : '<span class="badge b-muted">Inativo</span>'}
            </div>
            <p class="text-2" style="margin:.3rem 0;">${esc(t.description || '—')}</p>
            <div class="text-3" style="font-size:.8rem;">
              ${t.dish_count} prato(s) · Criado ${esc(formatDT(t.created_at))} · Atualizado ${esc(formatDT(t.updated_at))}
            </div>
            <div class="flex gap-1 mt-1" style="flex-wrap:wrap;">
              <button class="btn btn-sm btn-ghost" data-act="items">🍽️ Gerenciar pratos</button>
              <button class="btn btn-sm btn-ghost" data-act="edit">✏️ Editar</button>
              <button class="btn btn-sm ${t.active ? 'btn-danger-ghost' : 'btn-ok'}" data-act="toggle">${t.active ? 'Inativar' : 'Ativar'}</button>
            </div>
          </div>`).join('')}
      </div>` : emptyState('📒', 'Nenhum tipo de cardápio encontrado.');
    bindActions(root);
  } catch (e) {
    root.querySelector('#types-list').innerHTML = emptyState('⚠️', e.message);
  }
}

function bindActions(root) {
  root.querySelectorAll('#types-list .card').forEach((card) => {
    const id = Number(card.dataset.id);
    card.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.dataset.act;
        if (act === 'edit') {
          const d = await api.get(`/dish-types/${id}`);
          openForm(root, d, id);
        } else if (act === 'items') {
          const d = await api.get(`/dish-types/${id}`);
          openItems(root, d);
        } else if (act === 'toggle') {
          const t = await api.get(`/dish-types/${id}`);
          const ok = await confirmModal({
            title: t.active ? 'Inativar cardápio' : 'Ativar cardápio',
            message: t.active
              ? `O cardápio "${t.name}" ficará oculto para novos vínculos, mas permanecerá no histórico das festas já realizadas.`
              : `O cardápio "${t.name}" voltará a ficar disponível para vínculo.`,
          });
          if (!ok) return;
          await api.put(`/dish-types/${id}`, { active: !t.active });
          toast(t.active ? 'Cardápio inativado.' : 'Cardápio ativado.');
          load();
        }
      });
    });
  });
}

function openForm(root, data, id) {
  modal({
    title: data ? `Editar: ${data.name}` : 'Novo tipo de cardápio',
    htmlBody: `
      <div class="field"><label>Nome <span class="req">*</span></label><input class="input" id="f-name" value="${esc(data?.name || '')}" /></div>
      <div class="field"><label>Descrição</label><textarea class="textarea" id="f-desc">${esc(data?.description || '')}</textarea></div>
      <label class="check-row"><input type="checkbox" id="f-active" ${!data || data.active ? 'checked' : ''} /> Ativo</label>`,
    footButtons: [{ label: data ? 'Salvar' : 'Criar', class: '' }],
    onOpen: (m) => {
      m.querySelector('#f-name').focus();
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const name = m.querySelector('#f-name').value.trim();
        if (!name) return toast('Informe o nome.', 'error');
        try {
          if (id) {
            await api.put(`/dish-types/${id}`, { name, description: m.querySelector('#f-desc').value, active: m.querySelector('#f-active').checked });
            toast('Cardápio atualizado.');
          } else {
            await api.post('/dish-types', { name, description: m.querySelector('#f-desc').value, active: m.querySelector('#f-active').checked });
            toast('Tipo de cardápio criado.');
          }
          load();
          m.querySelector('[data-close]')?.click();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}

async function openItems(root, type) {
  const all = await api.get('/dishes?all=1');
  const linkedIds = type.dishes.map((d) => d.id);
  modal({
    title: `Pratos · ${type.name}`,
    size: 'modal-lg',
    htmlBody: `
      <div id="item-list" style="max-height:60vh; overflow-y:auto; display:grid; gap:.4rem;">
        ${type.dishes.map((d, i) => `
          <div class="card" style="display:flex; align-items:center; gap:.6rem;" data-dish="${d.id}">
            <span class="text-3">${i + 1}</span>
            <div style="flex:1;"><strong>${esc(d.name)}</strong> <small class="text-3">· ${esc(d.category)}</small></div>
            <button class="btn btn-sm btn-ghost" data-up ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn btn-sm btn-ghost" data-down ${i === type.dishes.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn btn-sm btn-danger-ghost" data-remove>✖</button>
          </div>`).join('') || '<p class="text-3">Nenhum prato neste cardápio.</p>'}
      </div>
      <div class="field mt-2"><label>Adicionar prato</label>
        <input class="input" id="d-search" placeholder="🔎 Buscar prato para adicionar..." />
        <div id="d-suggest" style="display:grid; gap:.3rem; margin-top:.4rem; max-height:180px; overflow-y:auto;"></div>
      </div>`,
    footButtons: [{ label: 'Salvar ordenação', class: '' }],
    onOpen: (m) => {
      let order = type.dishes.map((d) => d.id);
      const listEl = m.querySelector('#item-list');

      const applyOrder = () => {
        listEl.querySelectorAll('.card').forEach((card, i) => {
          card.querySelector('span.text-3').textContent = i + 1;
          card.querySelector('[data-up]').disabled = i === 0;
          card.querySelector('[data-down]').disabled = i === listEl.querySelectorAll('.card').length - 1;
        });
      };
      listEl.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
        const card = b.closest('.card'); const prev = card.previousElementSibling;
        if (prev) { listEl.insertBefore(card, prev); applyOrder(); }
      }));
      listEl.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => {
        const card = b.closest('.card'); const next = card.nextElementSibling;
        if (next) { listEl.insertBefore(next, card); applyOrder(); }
      }));
      listEl.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
        b.closest('.card').remove(); applyOrder();
      }));

      const search = m.querySelector('#d-search');
      const suggest = m.querySelector('#d-suggest');
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase();
        const current = [...listEl.querySelectorAll('.card')].map((c) => Number(c.dataset.dish));
        const opts = all.filter((d) => d.name.toLowerCase().includes(q) && !current.includes(d.id)).slice(0, 12);
        suggest.innerHTML = opts.length ? opts.map((d) => `
          <button class="btn btn-sm btn-ghost" data-add="${d.id}" style="justify-content:flex-start;">
            ＋ ${esc(d.name)} <small class="text-3">· ${esc(d.category)}</small></button>`).join('')
          : '<small class="text-3">Nenhum resultado.</small>';
        suggest.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
          const d = all.find((x) => x.id === Number(b.dataset.add));
          const card = document.createElement('div');
          card.className = 'card';
          card.dataset.dish = d.id;
          card.style.cssText = 'display:flex;align-items:center;gap:.6rem;';
          card.innerHTML = `<span class="text-3">${listEl.querySelectorAll('.card').length + 1}</span>
            <div style="flex:1;"><strong>${esc(d.name)}</strong> <small class="text-3">· ${esc(d.category)}</small></div>
            <button class="btn btn-sm btn-ghost" data-up>↑</button>
            <button class="btn btn-sm btn-ghost" data-down>↓</button>
            <button class="btn btn-sm btn-danger-ghost" data-remove>✖</button>`;
          card.querySelector('[data-up]').onclick = () => { const p = card.previousElementSibling; if (p) { listEl.insertBefore(card, p); applyOrder(); } };
          card.querySelector('[data-down]').onclick = () => { const n = card.nextElementSibling; if (n) { listEl.insertBefore(n, card); applyOrder(); } };
          card.querySelector('[data-remove]').onclick = () => { card.remove(); applyOrder(); };
          listEl.appendChild(card);
          applyOrder();
          search.value = ''; suggest.innerHTML = '';
        }));
      });

      m.querySelector('[data-foot="0"]').onclick = async () => {
        const ids = [...listEl.querySelectorAll('.card')].map((c) => Number(c.dataset.dish));
        try {
          await api.put(`/dish-types/${type.id}/items`, { dishes: ids.map((dish_id) => ({ dish_id })) });
          toast('Cardápio atualizado.');
          load();
          m.querySelector('[data-close]')?.click();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}