/**
 * Local project store.
 *
 * IndexedDB is the primary backing store: a building with thousands of cables
 * outgrows localStorage's ~5 MB string quota, and localStorage is synchronous,
 * so writing a large document blocks the render loop.
 *
 * localStorage remains as a fallback for private windows and blocked storage,
 * and for small view preferences where a synchronous read at boot is simpler.
 *
 * Swapping in a real backend means reimplementing these five functions.
 */
const DB_NAME = 'twinfabric';
const DB_VERSION = 1;
const STORE = 'projects';
const FALLBACK_PREFIX = 'twinfabric/project/';

let dbPromise = null;
let idbUsable = null;   // null = untested, true/false once known

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('modifiedAt', 'modifiedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB blocked by another tab'));
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* ------------------------------------------------------------------ */
/* localStorage fallback                                               */
/* ------------------------------------------------------------------ */

const fallback = {
  put(key, record) {
    try {
      localStorage.setItem(FALLBACK_PREFIX + key, JSON.stringify(record));
      return true;
    } catch { return false; }
  },
  get(key) {
    try {
      const raw = localStorage.getItem(FALLBACK_PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  },
  remove(key) {
    try { localStorage.removeItem(FALLBACK_PREFIX + key); } catch { /* ignore */ }
  },
  list() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(FALLBACK_PREFIX)) continue;
        const rec = JSON.parse(localStorage.getItem(k));
        out.push({ key: rec.key, name: rec.name, modifiedAt: rec.modifiedAt, counts: rec.counts });
      }
    } catch { /* ignore */ }
    return out;
  },
};

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

/** Which store actually ended up being used — surfaced in the UI. */
export function backend() {
  return idbUsable === true ? 'indexeddb' : idbUsable === false ? 'localstorage' : 'unknown';
}

export async function putProject(key, container) {
  const record = {
    key,
    name: container?.meta?.name || 'Untitled project',
    building: container?.meta?.building || '',
    modifiedAt: container?.meta?.modifiedAt || new Date().toISOString(),
    counts: container?.meta?.counts || null,
    container,
  };
  try {
    const db = await openDb();
    await wrap(tx(db, 'readwrite').put(record));
    idbUsable = true;
    return true;
  } catch (e) {
    idbUsable = false;
    console.warn('[persist] IndexedDB write failed, using localStorage', e?.message || e);
    return fallback.put(key, record);
  }
}

export async function getProject(key) {
  try {
    const db = await openDb();
    const rec = await wrap(tx(db, 'readonly').get(key));
    idbUsable = true;
    if (rec) return rec.container;
  } catch (e) {
    idbUsable = false;
    console.warn('[persist] IndexedDB read failed, using localStorage', e?.message || e);
  }
  const rec = fallback.get(key);
  return rec ? rec.container : null;
}

export async function listProjects() {
  try {
    const db = await openDb();
    const all = await wrap(tx(db, 'readonly').getAll());
    idbUsable = true;
    return all
      .map(({ key, name, building, modifiedAt, counts }) => ({ key, name, building, modifiedAt, counts }))
      .sort((a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
  } catch {
    idbUsable = false;
    return fallback.list();
  }
}

export async function deleteProject(key) {
  try {
    const db = await openDb();
    await wrap(tx(db, 'readwrite').delete(key));
  } catch { /* fall through */ }
  fallback.remove(key);
}

/** Rough size of the stored document, for the storage readout. */
export async function estimateUsage() {
  try {
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage, quota };
    }
  } catch { /* ignore */ }
  return { usage: null, quota: null };
}
