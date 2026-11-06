// Small helpers: escaped HTML templates, icons, ids.

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Mark a string as trusted HTML. */
export const raw = (s) => new Raw(String(s));

function fmt(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(fmt).join('');
  return esc(v);
}

/** Tagged template: interpolations are escaped unless they are html`` results or raw(). */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += fmt(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export const icon = (name, cls = '') =>
  raw(`<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`);

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const nowISO = () => new Date().toISOString();

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** "3" or "3–4" */
export const range = (a, b) => (a === b || b == null ? `${a}` : `${a}–${b}`);

export const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
