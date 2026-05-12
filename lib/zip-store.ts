/**
 * Persistencia de ZIPs gerados (Lipsync History) em IndexedDB.
 *
 * Blob URLs nao sobrevivem reload (browser revoga). Pra que o user
 * possa baixar ZIPs gerados em sessoes anteriores, persistimos os
 * bytes do ZIP em IndexedDB e reconstruimos a Blob URL on-demand.
 *
 * Limite tipico IndexedDB: alguns GB (depende do browser).
 * Quota check via navigator.storage.estimate() pra avisar se cheia.
 */

const DB_NAME = 'darkolab-zip-store';
const DB_VERSION = 1;
const STORE = 'zips';

type ZipRecord = {
  key: string;          // chave unica (ex 'batch:<taskId>:takes' / ':montado' / ':camo' / 'va:<taskId>:zip')
  filename: string;
  bytes: Uint8Array;
  size: number;
  createdAt: number;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponivel (server-side ou navegador antigo)'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Falha abrindo IndexedDB'));
  });
}

export async function saveZip(key: string, blob: Blob, filename: string): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const rec: ZipRecord = { key, filename, bytes, size: bytes.length, createdAt: Date.now() };
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function loadZip(key: string): Promise<{ blobUrl: string; filename: string; size: number } | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      db.close();
      const rec = req.result as ZipRecord | undefined;
      if (!rec) return resolve(null);
      const blob = new Blob([rec.bytes as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      resolve({ blobUrl: url, filename: rec.filename, size: rec.size });
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function listZipKeys(): Promise<Array<{ key: string; filename: string; size: number; createdAt: number }>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out: Array<{ key: string; filename: string; size: number; createdAt: number }> = [];
    const tx = db.transaction(STORE, 'readonly');
    const cur = tx.objectStore(STORE).openCursor();
    cur.onsuccess = (e: any) => {
      const c = e.target.result as IDBCursorWithValue | null;
      if (c) {
        const v = c.value as ZipRecord;
        out.push({ key: v.key, filename: v.filename, size: v.size, createdAt: v.createdAt });
        c.continue();
      } else {
        db.close();
        resolve(out.sort((a, b) => b.createdAt - a.createdAt));
      }
    };
    cur.onerror = () => { db.close(); reject(cur.error); };
  });
}

export async function deleteZip(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage || 0, quota: e.quota || 0 };
}
