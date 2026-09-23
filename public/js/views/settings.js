'use strict';

import { api } from '../api.js';
import { esc, toast, spinner, emptyState } from '../ui.js';

export const title = 'Configurações';

const FIELDS = [
  { key: 'system_name', label: 'Nome do sistema', placeholder: 'Ex.: Saas Pedidos', hint: 'Aparece no topo do sistema e na tela de login.', maxlength: 60 },
  { key: 'company_name', label: 'Nome da empresa', placeholder: 'Razão social / nome fantasia', hint: 'Informações da sua empresa (opcional).', maxlength: 120 },
  { key: 'company_cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00', maxlength: 20 },
  { key: 'company_phone', label: 'Telefone', placeholder: '(00) 00000-0000', maxlength: 30 },
  { key: 'company_email', label: 'E-mail', placeholder: 'contato@empresa.com', maxlength: 120 },
  { key: 'company_address', label: 'Endereço', placeholder: 'Rua, número, bairro, cidade/UF', maxlength: 300 },
];

const state = { values: {}, saving: false };

export async function render(container) {
  container.innerHTML = spinner();
  try {
    state.values = await api.get('/settings');
  } catch (e) {
    container.innerHTML = emptyState('⚠️', e.message);
    return;
  }
  container.innerHTML = view();
  wire(container);
}

function view() {
  const fields = FIELDS.map((f) => `
    <div class="field">
      <label for="set-${esc(f.key)}">${esc(f.label)}</label>
      <input class="input" id="set-${esc(f.key)}" value="${esc(state.values[f.key] || '')}"
        placeholder="${esc(f.placeholder || '')}" maxlength="${f.maxlength || 120}" />
      ${f.hint ? `<small class="text-3">${esc(f.hint)}</small>` : ''}
    </div>`).join('');

  return `
    <div class="flex-between mb-2">
      <h1>Configurações da empresa</h1>
    </div>
    <div class="card mb-2" style="padding:.75rem 1rem;">
      <p class="text-3" style="margin:0;">Configure a identidade exibida no sistema (nome do sistema, topo e login) e os dados da sua empresa. Essas informações ficam salvas e podem ser usadas futuramente em documentos e relatórios.</p>
    </div>
    <form class="card" id="settings-form" novalidate>
      <div class="grid" style="grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:.6rem;">
        ${fields}
      </div>
      <div class="flex gap-1 mt-2">
        <button class="btn" type="submit" id="btn-save">💾 Salvar configurações</button>
        <span class="text-3" id="save-msg" style="align-self:center;"></span>
      </div>
    </form>`;
}

function wire(container) {
  container.querySelector('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.saving) return;
    state.saving = true;
    const btn = container.querySelector('#btn-save');
    btn.disabled = true;
    const payload = {};
    for (const f of FIELDS) {
      payload[f.key] = container.querySelector(`#set-${f.key}`).value.trim();
    }
    if (!payload.system_name) {
      toast('O nome do sistema é obrigatório.', 'error');
      btn.disabled = false; state.saving = false;
      return;
    }
    try {
      state.values = await api.put('/settings', payload);
      window.__app.refreshBranding?.();
      toast('Configurações salvas.');
      const msg = container.querySelector('#save-msg');
      if (msg) msg.textContent = `Salvo em ${new Date().toLocaleTimeString('pt-BR')} — nome do sistema: "${state.values.system_name}".`;
    } catch (ex) {
      toast(ex.message, 'error');
    }
    btn.disabled = false;
    state.saving = false;
  });
}