'use strict';

import { api } from '../api.js';
import { el, toast, esc } from '../ui.js';

export const title = 'Login';

export async function render(container) {
  // Identidade pública: /settings/public não exige login (fallback "Saas Pedidos").
  let systemName = 'Saas Pedidos';
  try {
    const s = await api.get('/settings/public');
    if (s.system_name) systemName = s.system_name;
  } catch { /* segue com o padrão */ }
  const parts = systemName.trim().split(/\s+/);
  const brandHtml = parts.length > 1
    ? `${esc(parts[0])} <span style="color:var(--primary)">${esc(parts.slice(1).join(' '))}</span>`
    : `<span style="color:var(--primary)">${esc(systemName)}</span>`;

  container.innerHTML = `
    <div class="login-wrap">
      <div class="card login-card">
        <div style="text-align:center; margin-bottom:1rem;">
          <div style="font-size:2.4rem;">🍽️</div>
          <h1>${brandHtml}</h1>
          <p class="text-2">Sistema de pedidos — sem controle financeiro</p>
        </div>
        <form id="login-form" novalidate>
          <div class="field">
            <label for="email">E-mail</label>
            <input class="input" type="email" id="email" name="email" required autocomplete="username" placeholder="seu@email.com" />
          </div>
          <div class="field">
            <label for="password">Senha</label>
            <input class="input" type="password" id="password" name="password" required autocomplete="current-password" placeholder="••••••" />
          </div>
          <button class="btn btn-lg btn-block" type="submit">Entrar</button>
          <p class="hint" style="margin-top:.8rem; text-align:center;">Demonstração: admin@buffet.local / admin123</p>
        </form>
      </div>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const err = el('<p class="text-danger" style="margin-top:.6rem;"></p>');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const email = container.querySelector('#email').value.trim();
    const password = container.querySelector('#password').value;
    if (!email || !password) {
      err.textContent = 'Informe e-mail e senha.';
      form.after(err);
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Entrando...';
    try {
      await window.__app.doLogin(email, password);
      toast(`Bem-vindo(a)!`);
    } catch (ex) {
      err.textContent = ex.message;
      form.after(err);
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });
}