'use strict';

import { api } from '../api.js';
import { esc, toast, confirmModal, spinner, emptyState, modal, debounce } from '../ui.js';

export const title = 'Usuários e permissões';

const STATE = { q: '' };

export function render(container) {
  container.innerHTML = `
    <div class="flex-between mb-2">
      <h1>Usuários e permissões</h1>
      <button class="btn" id="btn-new">＋ Novo usuário</button>
    </div>
    <div class="toolbar">
      <div class="input-group" style="flex:1; min-width:180px;"><input class="input" id="f-q" placeholder="🔎 Buscar usuário..." /></div>
    </div>
    <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); align-items:start;">
      <div>
        <div class="card">
          <div class="card-title"><h2>Usuários</h2></div>
          <div id="users-list">${spinner()}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title"><h2>Permissões por perfil</h2></div>
        <div class="field"><label>Perfil</label>
          <select class="select" id="role-sel"></select></div>
        <div id="perms-box">${spinner()}</div>
      </div>
    </div>
  `;

  container.querySelector('#f-q').addEventListener('input', debounce(loadUsers, 300));
  container.querySelector('#btn-new').addEventListener('click', () => openUserForm(container, null));

  loadRoles(container);
  loadUsers(container);
}

async function loadRoles(root) {
  try {
    const roles = await api.get('/users/roles');
    const sel = root.querySelector('#role-sel');
    sel.innerHTML = roles.map((r) => `<option value="${esc(r.key)}">${esc(r.name)}</option>`).join('');
    sel.addEventListener('change', () => loadPerms(root, sel.value));
    loadPerms(root, sel.value);
  } catch (e) { root.querySelector('#perms-box').innerHTML = emptyState('⚠️', e.message); }
}

async function loadPerms(root, role) {
  root.querySelector('#perms-box').innerHTML = spinner();
  try {
    const r = await api.get(`/users/roles/${role}/permissions`);
    const all = Object.entries(r.labels);
    root.querySelector('#perms-box').innerHTML = `
      <p class="hint">${role === 'administrador' ? 'O perfil Administrador sempre possui todas as permissões e não é editável.' : 'Marque as permissões concedidas a este perfil.'}</p>
      ${role === 'administrador' ? `<div class="grid" style="grid-template-columns:repeat(2,1fr); gap:.3rem;">${all.map(([k, l]) => `<label class="check-row"><input type="checkbox" checked disabled /><span style="font-size:.86rem;">${esc(l)}</span></label>`).join('')}</div>` : `
      <div class="grid" style="grid-template-columns:repeat(2,1fr); gap:.3rem;">
        ${all.map(([k, l]) => `<label class="check-row"><input type="checkbox" value="${esc(k)}" ${r.permissions.includes(k) ? 'checked' : ''} /><span style="font-size:.86rem;">${esc(l)}</span></label>`).join('')}
      </div>
      <button class="btn mt-2" id="btn-save-perms">💾 Salvar permissões</button>`}
    `;
    const save = root.querySelector('#btn-save-perms');
    if (save) {
      save.addEventListener('click', async () => {
        const permissions = [...root.querySelectorAll('#perms-box input:checked')].map((c) => c.value);
        try {
          await api.put(`/users/roles/${role}/permissions`, { permissions });
          toast('Permissões salvas.');
        } catch (e) { toast(e.message, 'error'); }
      });
    }
  } catch (e) { root.querySelector('#perms-box').innerHTML = emptyState('⚠️', e.message); }
}

async function loadUsers() {
  const root = document.querySelector('#view');
  const q = root.querySelector('#f-q').value.trim();
  try {
    let users = await api.get('/users');
    if (q) users = users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));
    const roles = await api.get('/users/roles');
    const roleName = (k) => roles.find((r) => r.key === k)?.name || k;
    root.querySelector('#users-list').innerHTML = users.length ? `
      <div style="display:grid; gap:.5rem;">
        ${users.map((u) => `
          <div class="card" style="padding:.7rem .8rem;" data-id="${u.id}">
            <div class="flex-between">
              <div>
                <strong>${esc(u.name)}</strong> ${u.active ? '' : '<span class="badge b-danger">inativo</span>'}
                <div class="text-3" style="font-size:.82rem;">${esc(u.email)} · <span class="badge b-primary">${esc(roleName(u.role))}</span></div>
              </div>
              <div class="flex gap-1">
                <button class="btn btn-sm btn-ghost" data-edit>✏️</button>
                <button class="btn btn-sm ${u.active ? 'btn-danger-ghost' : 'btn-ok'}" data-toggle>${u.active ? 'Inativar' : 'Ativar'}</button>
              </div>
            </div>
          </div>`).join('')}
      </div>` : emptyState('👥', 'Nenhum usuário encontrado.');
    root.querySelectorAll('#users-list [data-edit]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = Number(b.closest('.card').dataset.id);
        openUserForm(root, users.find((u) => u.id === id));
      });
    });
    root.querySelectorAll('#users-list [data-toggle]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = Number(b.closest('.card').dataset.id);
        const u = users.find((x) => x.id === id);
        const ok = await confirmModal({
          title: u.active ? 'Inativar usuário' : 'Ativar usuário',
          message: `${u.active ? 'Inativar' : 'Ativar'} "${u.name}"? Usuários inativos não conseguem entrar no sistema.`,
        });
        if (!ok) return;
        try {
          await api.put(`/users/${id}/status`, { active: !u.active });
          toast('Status atualizado.');
          loadUsers();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
  } catch (e) {
    root.querySelector('#users-list').innerHTML = emptyState('⚠️', e.message);
  }
}

async function openUserForm(root, data) {
  const roles = await api.get('/users/roles');
  modal({
    title: data ? `Editar: ${data.name}` : 'Novo usuário',
    htmlBody: `
      <div class="field"><label>Nome <span class="req">*</span></label><input class="input" id="u-name" value="${esc(data?.name || '')}" /></div>
      <div class="field"><label>E-mail <span class="req">*</span></label><input class="input" type="email" id="u-email" value="${esc(data?.email || '')}" /></div>
      <div class="field"><label>Perfil <span class="req">*</span></label>
        <select class="select" id="u-role">${roles.map((r) => `<option value="${esc(r.key)}" ${data?.role === r.key ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field"><label>${data ? 'Nova senha (deixe vazio para manter)' : 'Senha <span class="req">*</span> (mín. 6)'}</label>
        <input class="input" type="password" id="u-pass" ${data ? '' : 'required'} /></div>
      <label class="check-row"><input type="checkbox" id="u-active" ${!data || data.active ? 'checked' : ''} /> Usuário ativo</label>`,
    footButtons: [{ label: data ? 'Salvar' : 'Criar usuário', class: '' }],
    onOpen: (m) => {
      m.querySelector('[data-foot="0"]').onclick = async () => {
        const name = m.querySelector('#u-name').value.trim();
        const email = m.querySelector('#u-email').value.trim();
        const role = m.querySelector('#u-role').value;
        const password = m.querySelector('#u-pass').value;
        if (!name || !email || !role) return toast('Preencha nome, e-mail e perfil.', 'error');
        if (!data && password.length < 6) return toast('Senha deve ter ao menos 6 caracteres.', 'error');
        const payload = { name, email, role, active: m.querySelector('#u-active').checked };
        try {
          if (data) {
            if (password) payload.password = password;
            await api.put(`/users/${data.id}`, payload);
            toast('Usuário atualizado.');
          } else {
            payload.password = password;
            await api.post('/users', payload);
            toast('Usuário criado.');
          }
          loadUsers();
          m.querySelector('[data-close]')?.click();
        } catch (e) { toast(e.message, 'error'); }
      };
    },
  });
}