/** Identity, cloning and small shared helpers. No Three.js, no DOM. */

/**
 * Human-readable, typed, unique entity IDs.
 * Format: <PREFIX>-<NNN>  e.g. WALL-014, TV-023, CABLE-SDI-087, ROOM-U05.
 * Counters are kept per prefix on the project document so IDs stay stable
 * and readable across save/load rather than being random UUIDs.
 */
export function makeIdFactory(counters = {}) {
  return {
    counters,
    next(prefix, pad = 3) {
      const key = String(prefix).toUpperCase();
      const n = (counters[key] || 0) + 1;
      counters[key] = n;
      return `${key}-${String(n).padStart(pad, '0')}`;
    },
    /** Register an externally supplied id so future generated ids don't clash. */
    observe(id) {
      const m = /^([A-Z0-9-]+)-(\d+)$/.exec(String(id || ''));
      if (!m) return;
      const key = m[1];
      const n = parseInt(m[2], 10);
      if (!Number.isFinite(n)) return;
      if (!counters[key] || counters[key] < n) counters[key] = n;
    },
  };
}

/** Deep clone that works for the plain-JSON project document. */
export function deepClone(o) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(o); } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(o));
}

/** Tiny topic-based event bus. */
export function createBus() {
  const map = new Map();
  return {
    on(topic, fn) {
      if (!map.has(topic)) map.set(topic, new Set());
      map.get(topic).add(fn);
      return () => map.get(topic)?.delete(fn);
    },
    off(topic, fn) { map.get(topic)?.delete(fn); },
    emit(topic, payload) {
      const s = map.get(topic);
      if (!s) return;
      for (const fn of Array.from(s)) {
        try { fn(payload); } catch (e) { console.error(`[bus:${topic}]`, e); }
      }
    },
  };
}

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...a) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...a); }, ms);
  };
  wrapped.cancel = () => { if (t) clearTimeout(t); t = null; };
  wrapped.flush = (...a) => { if (t) { clearTimeout(t); t = null; fn(...a); } };
  return wrapped;
}

export const byId = (arr) => {
  const m = new Map();
  for (const it of arr || []) m.set(it.id, it);
  return m;
};

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const it of arr || []) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

/** Format a length in metres for UI display. */
export function fmtLen(m) {
  if (m == null || !Number.isFinite(m)) return '—';
  if (m < 1) return `${(m * 100).toFixed(0)} cm`;
  return `${m.toFixed(2)} m`;
}

export function fmtArea(m2) {
  if (m2 == null || !Number.isFinite(m2)) return '—';
  return `${m2.toFixed(1)} m²`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Case-insensitive fuzzy subsequence match; returns a score or -1. */
export function fuzzyScore(needle, haystack) {
  if (!needle) return 0;
  const n = needle.toLowerCase();
  const h = String(haystack || '').toLowerCase();
  const exact = h.indexOf(n);
  if (exact === 0) return 1000;
  if (exact > 0) return 800 - exact;
  let hi = 0, score = 0, streak = 0;
  for (let i = 0; i < n.length; i++) {
    const idx = h.indexOf(n[i], hi);
    if (idx === -1) return -1;
    streak = idx === hi ? streak + 1 : 0;
    score += 10 + streak * 4 - Math.min(idx - hi, 10);
    hi = idx + 1;
  }
  return score;
}

export function slug(s) {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Stable sort by a key extractor. */
export function sortBy(arr, fn, dir = 1) {
  return arr.slice().sort((a, b) => {
    const x = fn(a), y = fn(b);
    if (x === y) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x > y ? 1 : -1) * dir;
  });
}

export function uniq(arr) { return Array.from(new Set(arr)); }

/** Mix a hex colour toward white/black. amount>0 lightens. */
export function shade(hex, amount) {
  const h = hex.replace('#', '');
  const num = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  const t = amount < 0 ? 0 : 255;
  const p = Math.abs(amount);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
