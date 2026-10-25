// Local cache in IndexedDB.
//
// Every network response the app uses is stored here with a timestamp.
//  - "final" entries (completed games, past seasons) are never refetched.
//  - other entries are reused until their TTL expires.
//  - if the network fails, the last saved copy is returned (marked stale), so the
//    app still works offline or when a data source has a hiccup.

const DB_NAME = 'podium';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

export const cache = {
  /** Returns { key, value, savedAt, ttlMs, final } or undefined. */
  async getEntry(key) {
    try { return await tx('readonly', (s) => s.get(key)); } catch { return undefined; }
  },
  async get(key) { return (await cache.getEntry(key))?.value; },
  async set(key, value, { ttlMs = 0, final = false } = {}) {
    try { await tx('readwrite', (s) => s.put({ key, value, savedAt: Date.now(), ttlMs, final })); } catch { /* quota or private mode */ }
  },
  async delete(key) { try { await tx('readwrite', (s) => s.delete(key)); } catch { /* ignore */ } },
  async clear() { try { await tx('readwrite', (s) => s.clear()); } catch { /* ignore */ } },
  async count() { try { return await tx('readonly', (s) => s.count()); } catch { return 0; } },
};

function isFresh(entry) {
  if (!entry) return false;
  if (entry.final) return true;
  return Date.now() - entry.savedAt < entry.ttlMs;
}

const inflight = new Map();

/**
 * Fetch JSON through the cache.
 *   ttlMs:   how long a saved copy counts as fresh
 *   final:   true, or a function (json) => boolean, to mark the response permanent
 *   force:   skip the fresh-copy check (used by live polling)
 * Resolves to { data, savedAt, stale, fromCache }.
 */
export async function cachedJSON(url, { key = url, ttlMs = 5 * 60_000, final = false, force = false, parse = 'json' } = {}) {
  const entry = await cache.getEntry(key);
  if (!force && isFresh(entry)) return { data: entry.value, savedAt: entry.savedAt, stale: false, fromCache: true };

  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const res = await fetch(url, { headers: parse === 'json' ? { Accept: 'application/json' } : {} });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
      const data = parse === 'json' ? await res.json() : await res.text();
      const isFinal = typeof final === 'function' ? !!final(data) : !!final;
      await cache.set(key, data, { ttlMs, final: isFinal });
      return { data, savedAt: Date.now(), stale: false, fromCache: false };
    } catch (err) {
      if (entry) return { data: entry.value, savedAt: entry.savedAt, stale: true, fromCache: true, error: err };
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
