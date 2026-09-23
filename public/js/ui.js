'use strict';

/** Helpers de UI: formatação, toasts, modais, DOM seguro. */

export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function formatDT(str) {
  if (!str) return '—';
  const d = new Date(str.replace(' ', 'T'));
  if (isNaN(d)) return str;
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str + 'T00:00:00');
  if (isNaN(d)) return str;
  return d.toLocaleDateString('pt-BR');
}

export function timeAgo(iso) {
  if (!iso) return '—';
  const then = new Date(iso.replace(' ', 'T')).getTime();
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (h < 24) return m ? `${h}h ${m}min` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const STATUS = {
  novo: { label: 'Novo', cls: 'st-novo' },
  em_preparo: { label: 'Em preparo', cls: 'st-em_preparo' },
  pronto: { label: 'Pronto', cls: 'st-pronto' },
  entregue: { label: 'Entregue', cls: 'st-entregue' },
  finalizado: { label: 'Finalizado', cls: 'st-finalizado' },
  cancelado: { label: 'Cancelado', cls: 'st-cancelado' },
};

// ---------------------------------------------------------------------------
// Status configuráveis (registry dinâmico vindo de GET /order-statuses)
// ---------------------------------------------------------------------------
let ORDER_STATUS = [];        // [{key,label,color,sort,advance_perm,active,is_system}]
let ORDER_STATUS_MAP = null;  // key -> status

export function setStatusMeta(list) {
  ORDER_STATUS = Array.isArray(list) ? list : [];
  ORDER_STATUS_MAP = {};
  for (const s of ORDER_STATUS) ORDER_STATUS_MAP[s.key] = s;
  return ORDER_STATUS;
}

export function statusMeta() {
  return ORDER_STATUS;
}

export function statusByKey(key) {
  return (ORDER_STATUS_MAP && ORDER_STATUS_MAP[key]) || null;
}

export function statusLabel(key) {
  const meta = statusByKey(key);
  return (meta && meta.label) || STATUS[key]?.label || key;
}

/** Fluxo ativo (exclui cancelado), ordenado por sort — a ordem define o próximo status. */
export function flowStatuses() {
  return ORDER_STATUS
    .filter((s) => s.key !== 'cancelado' && s.active === 1)
    .sort((a, b) => a.sort - b.sort || a.id - b.id);
}

/** Próximo status do fluxo para `current` (ou null). */
export function nextOf(current) {
  const flow = flowStatuses();
  const i = flow.findIndex((s) => s.key === current);
  if (i === -1) return null;
  return flow[i + 1] || null;
}

/** Garante que o registry está carregado (fetch único do servidor). */
export async function ensureStatusMeta() {
  if (ORDER_STATUS.length) return ORDER_STATUS;
  try {
    const { api } = await import('./api.js');
    const list = await api.get('/order-statuses');
    return setStatusMeta(list);
  } catch {
    return [];
  }
}

export function statusBadge(status, extra = '', color) {
  const meta = statusByKey(status);
  const label = (meta && meta.label) || STATUS[status]?.label || status;
  let cls = 'b-muted';
  if (color) cls = color.startsWith('b-') ? color : `b-${color}`;
  else if (meta && meta.color) cls = meta.color.startsWith('b-') ? meta.color : `b-${meta.color}`;
  else if (STATUS[status]) cls = STATUS[status].cls;
  return `<span class="badge ${cls} ${extra}">${esc(label)}</span>`;
}

export function partyStatusBadge(status) {
  const map = {
    planejada: ['b-primary', 'Planejada'],
    ativa: ['b-ok', 'Ativa'],
    encerrada: ['b-muted', 'Encerrada'],
    cancelada: ['b-danger', 'Cancelada'],
  };
  const [cls, label] = map[status] || ['b-muted', status];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function tableStatusBadge(status) {
  const map = { livre: ['b-ok', 'Livre'], ocupada: ['b-warn', 'Ocupada'], encerrada: ['b-muted', 'Encerrada'], bloqueada: ['b-danger', 'Bloqueada'] };
  const [cls, label] = map[status] || ['b-muted', status];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

export function toast(msg, type = 'ok') {
  const icons = { ok: '✅', error: '⚠️', warn: '❗', info: 'ℹ️' };
  const root = document.getElementById('toast-root');
  const t = el(`<div class="toast ${type}" role="status"><span class="t-ico">${icons[type] || ''}</span><span>${esc(msg)}</span></div>`);
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, type === 'error' ? 6000 : 3500);
}

export function confirmModal({ title, message, confirmText = 'Confirmar', danger = false, onConfirm, htmlBody = '' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const modal = el(`
      <div class="modal-backdrop" role="dialog" aria-modal="true">
        <div class="modal">
          <div class="modal-head"><h3>${esc(title)}</h3>
            <button class="icon-btn" data-close aria-label="Fechar">✕</button>
          </div>
          <div class="modal-body">${htmlBody || `<p>${esc(message || '')}</p>`}</div>
          <div class="modal-foot">
            <button class="btn btn-ghost" data-cancel>Cancelar</button>
            <button class="btn ${danger ? 'btn-danger' : ''}" data-ok>${esc(confirmText)}</button>
          </div>
        </div>
      </div>`);
    root.appendChild(modal);
    const close = (val) => { modal.remove(); resolve(val); };
    modal.querySelector('[data-close]').onclick = () => close(false);
    modal.querySelector('[data-cancel]').onclick = () => close(false);
    modal.querySelector('[data-ok]').onclick = () => close(true);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(false); });
  });
}

/** Abre modal com conteúdo HTML e retorna promessa resolvendo no clique do botão principal (ou null se fechado). */
export function modal({ title, htmlBody, footButtons = [], size = '', onOpen } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    const foot = footButtons.length
      ? footButtons.map((b, i) => `<button class="btn ${b.class || ''}" data-foot="${i}">${esc(b.label || 'OK')}</button>`).join('')
      : `<button class="btn" data-foot="0">OK</button>`;
    const modal = el(`
      <div class="modal-backdrop" role="dialog" aria-modal="true">
        <div class="modal ${size}">
          <div class="modal-head"><h3>${esc(title)}</h3>
            <button class="icon-btn" data-close aria-label="Fechar">✕</button>
          </div>
          <div class="modal-body">${htmlBody}</div>
          <div class="modal-foot">${foot}</div>
        </div>
      </div>`);
    root.appendChild(modal);
    let closed = false;
    const close = (val) => { if (closed) return; closed = true; modal.remove(); resolve(val); };
    modal.querySelector('[data-close]').onclick = () => close(null);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(null); });
    modal.querySelectorAll('[data-foot]').forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.foot);
        const b = footButtons[idx];
        if (b && b.preventClose) { b.onClick && b.onClick(modal); return; }
        if (b && b.onClick) b.onClick(modal);
        close(idx);
      };
    });
    if (onOpen) onOpen(modal);
  });
}

/** Escape simplificado para uso em atributos onclick inline com JSON. */
export function qjson(obj) {
  return esc(JSON.stringify(obj)).replaceAll('&quot;', '&quot;');
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function spinner() {
  return `<div class="empty"><div class="empty-ico">⏳</div><p>Carregando...</p></div>`;
}

export function emptyState(icon, text) {
  return `<div class="empty"><div class="empty-ico">${icon}</div><p>${esc(text)}</p></div>`;
}

export function val(formOrParent) {
  const obj = {};
  formOrParent.querySelectorAll('[name]').forEach((f) => {
    if (f.type === 'checkbox') obj[f.name] = f.checked;
    else if (f.type === 'number') obj[f.name] = f.value === '' ? null : Number(f.value);
    else obj[f.name] = f.value;
  });
  return obj;
}

/** Reproduz alerta sonoro simples via Web Audio (sem arquivo externo). */
export function beep(times = 2) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.28);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.28 + 0.22);
      osc.start(ctx.currentTime + i * 0.28);
      osc.stop(ctx.currentTime + i * 0.28 + 0.24);
    }
    setTimeout(() => ctx.close(), 1000);
  } catch { /* áudio indisponível */ }
}