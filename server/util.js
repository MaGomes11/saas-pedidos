'use strict';

const crypto = require('crypto');

/** Timestamp ISO local (YYYY-MM-DD HH:MM:SS) — padrão do banco. */
function nowIso() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** UUID v4 */
function uuid() {
  return crypto.randomUUID();
}

/** Token aleatório hex */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Converte qualquer valor para inteiro >= 0, ou fallback. */
function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Aplica máscara simples em número de pedido (P-0001). */
function formatCode(n) {
  return `P-${String(n).padStart(4, '0')}`;
}

/** Remove campos financeiros (defesa em profundidade) de qualquer objeto.
 *  Usa correspondência por termo com limites de palavra: não remove chaves de
 *  contagem como "tableTotal", "partiesTotal" ou "order_stats.total", mas remove
 *  qualquer chave que contenha termos financeiros (preco, valor, pagamento...). */
function stripFinancial(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripFinancial);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const kl = k.toLowerCase();
    if (/(^|[^a-z0-9])(preco|preço|price|valor|custo|cost|subtotal|desconto|discount|pagamento|payment|pago|caixa|taxa|fee|financeiro|finance)([^a-z0-9]|$)/.test(kl)) continue;
    out[k] = v && typeof v === 'object' ? stripFinancial(v) : v;
  }
  return out;
}

module.exports = { nowIso, uuid, randomToken, toInt, formatCode, stripFinancial };