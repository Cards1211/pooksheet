// IndexedDB persistence. The app keeps everything in memory (store.js) and
// writes through to these object stores. Every record has an `id` key.

const DB_NAME = 'training-app';
const DB_VERSION = 1;

export const STORES = [
  'profiles', 'exercises', 'cycles', 'days', 'slots', 'sessions', 'sets', 'notes', 'bodyweights',
];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' }).createIndex('ownerId', 'ownerId');
        }
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The database is open in another tab. Close it and try again.'));
  });
  return dbPromise;
}

const done = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error || new Error('Save was cancelled'));
});

const all = (store) => new Promise((resolve, reject) => {
  const r = store.getAll();
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

/** Everything, for the in-memory cache. */
export async function readAll() {
  const db = await openDB();
  const tx = db.transaction([...STORES, 'meta'], 'readonly');
  const out = { stores: {}, meta: {} };
  await Promise.all([
    ...STORES.map(async (s) => { out.stores[s] = await all(tx.objectStore(s)); }),
    all(tx.objectStore('meta')).then((rows) => { for (const r of rows) out.meta[r.key] = r.value; }),
  ]);
  await done(tx);
  return out;
}

/** Write many records across stores in one transaction. items: [storeName, record][] */
export async function putMany(items) {
  if (!items.length) return;
  const db = await openDB();
  const names = [...new Set(items.map(([s]) => s))];
  const tx = db.transaction(names, 'readwrite');
  for (const [s, rec] of items) tx.objectStore(s).put(rec);
  await done(tx);
}

export async function setMeta(key, value) {
  const db = await openDB();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  await done(tx);
}

/** Atomically replace all data (restore from backup). */
export async function replaceAll(data, meta) {
  const db = await openDB();
  const tx = db.transaction([...STORES, 'meta'], 'readwrite');
  for (const s of STORES) {
    const os = tx.objectStore(s);
    os.clear();
    for (const rec of data[s] || []) os.put(rec);
  }
  const m = tx.objectStore('meta');
  m.clear();
  for (const [key, value] of Object.entries(meta)) m.put({ key, value });
  await done(tx);
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported; installed home-screen apps are exempt from eviction on iOS anyway */ }
}
