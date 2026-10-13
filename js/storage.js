// A tiny IndexedDB key/value store shared by every Photocrap page.

const DB_NAME = "photocrap";
const DB_VERSION = 2;
const STORE = "kv";

let dbPromise = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const kvGet = (key) => run("readonly", (s) => s.get(key));
export const kvSet = (key, value) => run("readwrite", (s) => s.put(value, key));
export const kvDelete = (key) => run("readwrite", (s) => s.delete(key));
