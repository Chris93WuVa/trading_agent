// Netzwerk, Formatierung und kleine DOM-Helfer.

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-Trading-Board'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api/${path}`, {
    method, headers, credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* leere Antwort */ }
  if (res.status === 401 && path !== 'login') window.dispatchEvent(new Event('tb:logout'));
  if (!res.ok) {
    const detail = Array.isArray(data?.detail) ? data.detail.map((d) => d.msg).join(', ') : data?.detail;
    throw new ApiError(res.status, detail || `Fehler ${res.status}`);
  }
  return data;
}

const nf = new Map();
function fmt(min, max, extra = {}) {
  const key = `${min}|${max}|${JSON.stringify(extra)}`;
  if (!nf.has(key)) nf.set(key, new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max, ...extra }));
  return nf.get(key);
}

const CCY = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF', JPY: '¥', DKK: 'kr', SEK: 'kr', GBp: 'p', CNY: '¥' };
export const ccySymbol = (c) => CCY[c] ?? c ?? '';

export function decimalsFor(v) {
  const a = Math.abs(v);
  if (a === 0) return 2;
  if (a < 0.01) return 6;
  if (a < 1) return 4;
  if (a < 10) return 3;
  return 2;
}

export function price(v, currency, { yield: isYield = false } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  if (isYield) return `${fmt(3, 3).format(v)} %`;
  const d = decimalsFor(v);
  const s = fmt(d === 2 ? 2 : Math.min(d, 2), d).format(v);
  return currency ? `${s} ${ccySymbol(currency)}` : s;
}

export function money(v, currency = 'EUR', signed = false) {
  if (v == null || Number.isNaN(v)) return '—';
  const s = fmt(2, 2, signed ? { signDisplay: 'exceptZero' } : {}).format(v);
  return `${s} ${ccySymbol(currency)}`;
}

export function pct(v, digits = 2, signed = true) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${fmt(digits, digits, signed ? { signDisplay: 'exceptZero' } : {}).format(v * 100)} %`;
}

export const num = (v, digits = 2) => (v == null || Number.isNaN(v) ? '—' : fmt(digits, digits).format(v));

export function compact(v, currency) {
  if (v == null) return '—';
  const s = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
  return currency ? `${s} ${ccySymbol(currency)}` : s;
}

export const tone = (v) => (v == null || Math.abs(v) < 1e-9 ? '' : v > 0 ? 'up' : 'down');

export function dateTime(ms, intraday) {
  const d = new Date(ms);
  return intraday
    ? d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Tagged template: interpolierte Werte werden escaped, außer sie sind mit raw() markiert.
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: true, s: String(s) });
export function html(strings, ...values) {
  return strings.reduce((out, str, i) => {
    if (i >= values.length) return out + str;
    const v = values[i];
    const part = Array.isArray(v) ? v.map((x) => (x?.[RAW] ? x.s : esc(x))).join('')
      : v?.[RAW] ? v.s : v == null ? '' : esc(v);
    return out + str + part;
  }, '');
}
export const h = (...args) => raw(html(...args));

export const ICONS = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
  theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>',
};

export function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
