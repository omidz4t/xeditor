/**
 * Durable Y.Doc snapshot storage for **local-only** collab mode.
 * Used in both real WebXDC (local mode) and the browser IndexedDB mock.
 * Chat / realtime modes do not rely on this — they use WebXDC status / live channel.
 */

const DB_NAME = 'xeditor-local-ydoc'
const DB_VERSION = 1
const STORE = 'snapshots'

export type LocalDocSnapshot = {
  /** Storage key, typically `ydoc:${selfAddr}` */
  key: string
  /** Full Yjs encodeStateAsUpdateV2 payload */
  data: Uint8Array
  updatedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function runStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const store = tx.objectStore(STORE)
        const req = fn(store)
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
      }),
  )
}

/** Build a stable key per webxdc identity (and optional doc room). */
export function localDocStoreKey(selfAddr: string, room = 'default'): string {
  const addr = (selfAddr || 'anonymous').trim() || 'anonymous'
  return `ydoc:${addr}:${room}`
}

/** Load a full Yjs V2 state update, or null if none. */
export async function loadLocalYjsState(key: string): Promise<Uint8Array | null> {
  try {
    const row = await runStore<LocalDocSnapshot | undefined>('readonly', (store) =>
      store.get(key),
    )
    if (!row?.data) return null
    const data = row.data instanceof Uint8Array
      ? row.data
      : new Uint8Array(row.data as ArrayBuffer)
    return data.byteLength > 0 ? data : null
  } catch (error) {
    console.warn('[local-doc-idb] load failed', error)
    return null
  }
}

/** Persist a full Yjs V2 state snapshot (encodeStateAsUpdateV2). */
export async function saveLocalYjsState(key: string, data: Uint8Array): Promise<void> {
  if (!(data instanceof Uint8Array) || data.byteLength === 0) return
  // Copy so the IDB store owns its buffer (Yjs may reuse arrays).
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const row: LocalDocSnapshot = {
    key,
    data: copy,
    updatedAt: Date.now(),
  }
  try {
    await runStore('readwrite', (store) => store.put(row))
  } catch (error) {
    console.warn('[local-doc-idb] save failed', error)
  }
}

export async function clearLocalYjsState(key: string): Promise<void> {
  try {
    await runStore('readwrite', (store) => store.delete(key))
  } catch (error) {
    console.warn('[local-doc-idb] clear failed', error)
  }
}
