// IndexedDB photo store (PLAN4 §B7 — agent V4/G59). Guarded wrapper in the
// same never-hard-require spirit as the Capacitor adapters: DB `gooby.photos`
// v1, object store `photos` (keyPath `id`, autoIncrement), record
// `{ id, blob, thumb, at, w, h, frame, bytes }` (`thumb` is a G59 addition —
// a ≤256px cover-crop JPEG generated at add() time for the §C-SYS9.2 grid;
// null where canvas APIs are unavailable, get/getThumb fall back gracefully).
//
// EVERY entry point is promise-based and exception-safe: when IndexedDB is
// missing/broken the API resolves null/false/[] and warns ONCE — the game
// never breaks without it (§B7). add() enforces cap 40 (deletes oldest-by-at
// first, systems/gallery.logic.js owns the plan); on QuotaExceededError it
// evicts 4 oldest and retries ONCE, else resolves {ok:false, reason:'quota'}.
// The `gallery` save slice mirrors count/lastAddedAt synchronously — the
// CALLERS write that mirror (photoMode/albumScreen), this module is store-free.
//
// Test seam (§C-SYS9.5): everything reaches IndexedDB through globalThis
// .indexedDB at call time — test/gallery.test.js installs a minimal fake.

import { GALLERY, evictionIdsForAdd, quotaEvictionIds, normalizeMeta } from '../systems/gallery.logic.js';

/** §B7 names (frozen). */
export const PHOTO_DB_NAME = 'gooby.photos';
export const PHOTO_DB_VERSION = 1;
export const PHOTO_STORE = 'photos';

/** @type {Promise<IDBDatabase|null>|null} cached open handle */
let dbPromise = null;
let warnedUnavailable = false;

function warnOnce(reason) {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(`[photoStore] IndexedDB unavailable — photos will not persist (${reason})`);
}

/** Promisify one IDBRequest. @param {IDBRequest} req */
function requested(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('request failed'));
  });
}

/**
 * Open (and cache) the database; resolves null when IDB is missing or the
 * open fails (private-mode/storage-pressure browsers) — never throws.
 * @returns {Promise<IDBDatabase|null>}
 */
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    const idb = globalThis.indexedDB;
    if (!idb?.open) {
      warnOnce('no indexedDB global');
      resolve(null);
      return;
    }
    let req;
    try {
      req = idb.open(PHOTO_DB_NAME, PHOTO_DB_VERSION);
    } catch (err) {
      warnOnce(err?.message ?? 'open threw');
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE, { keyPath: 'id', autoIncrement: true });
        }
      } catch (err) {
        console.warn('[photoStore] upgrade failed:', err?.message);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      warnOnce(req.error?.message ?? 'open failed');
      resolve(null);
    };
    req.onblocked = () => {
      warnOnce('open blocked');
      resolve(null);
    };
  });
  return dbPromise;
}

/**
 * Run `fn(objectStore)` in a transaction; resolves `fallback` on ANY failure.
 * @template T
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => Promise<T>} fn
 * @param {T} fallback
 * @returns {Promise<T>}
 */
async function withStore(mode, fn, fallback) {
  const db = await open();
  if (!db) return fallback;
  try {
    return await fn(db.transaction(PHOTO_STORE, mode).objectStore(PHOTO_STORE));
  } catch (err) {
    console.warn('[photoStore] operation failed:', err?.message);
    return fallback;
  }
}

/** Full records (blobs included) — internal only; list() strips blobs. */
async function allRecords() {
  return withStore('readonly', (store) => requested(store.getAll()), []);
}

/**
 * Generate the grid thumbnail: square THUMB_PX cover-crop JPEG. Guarded —
 * resolves null wherever canvas/bitmap APIs are missing (node, old WebViews)
 * or decoding fails; consumers fall back to the full blob.
 * @param {Blob} blob
 * @returns {Promise<Blob|null>}
 */
async function makeThumb(blob) {
  try {
    if (typeof globalThis.createImageBitmap !== 'function') return null;
    const bmp = await globalThis.createImageBitmap(blob);
    const edge = GALLERY.THUMB_PX;
    const scale = Math.max(edge / bmp.width, edge / bmp.height);
    const sw = edge / scale;
    const sh = edge / scale;
    let thumb = null;
    if (typeof globalThis.OffscreenCanvas === 'function') {
      const canvas = new globalThis.OffscreenCanvas(edge, edge);
      const g = canvas.getContext('2d');
      g.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, edge, edge);
      thumb = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = edge;
      canvas.height = edge;
      const g = canvas.getContext('2d');
      g.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, edge, edge);
      thumb = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82));
    }
    bmp.close?.();
    return thumb;
  } catch (err) {
    console.warn('[photoStore] thumb generation failed:', err?.message);
    return null;
  }
}

/** Delete a batch of ids inside one readwrite transaction (best-effort). */
async function deleteIds(ids) {
  if (!ids?.length) return;
  await withStore('readwrite', async (store) => {
    for (const id of ids) await requested(store.delete(id));
    return true;
  }, false);
}

/**
 * Persist one captured photo (§B7). Enforces cap 40 (oldest-by-at eviction
 * BEFORE the write); on QuotaExceededError evicts 4 oldest and retries ONCE,
 * else resolves {ok:false, reason:'quota'}. The write path deliberately does
 * NOT go through withStore — quota errors must reach the retry logic here
 * instead of being swallowed.
 * @param {Blob} blob composed PNG from photo mode
 * @param {{at?: number, w?: number, h?: number, frame?: string}} [meta]
 * @returns {Promise<{ok: true, id: number, meta: object}
 *   |{ok: false, reason: 'unavailable'|'quota'|'error'}>}
 */
export async function add(blob, meta = {}) {
  const db = await open();
  if (!db || !blob) return { ok: false, reason: 'unavailable' };
  const norm = normalizeMeta(meta, blob.size ?? 0);
  const thumb = await makeThumb(blob);
  const record = { blob, thumb, ...norm };

  const put = async () => {
    const store = db.transaction(PHOTO_STORE, 'readwrite').objectStore(PHOTO_STORE);
    const id = await requested(store.add(record));
    return { ok: true, id: Number(id), meta: norm };
  };

  // Cap enforcement BEFORE the write (§B7: delete oldest-by-at first).
  await deleteIds(evictionIdsForAdd(await list(), GALLERY.CAP));
  try {
    return await put();
  } catch (err) {
    if (err?.name !== 'QuotaExceededError') {
      console.warn('[photoStore] add failed:', err?.message);
      return { ok: false, reason: 'error' };
    }
    // §B7 storage pressure: evict 4 oldest, retry exactly once.
    await deleteIds(quotaEvictionIds(await list(), GALLERY.QUOTA_EVICT));
    try {
      return await put();
    } catch (err2) {
      console.warn('[photoStore] add retry failed:', err2?.message);
      return { ok: false, reason: err2?.name === 'QuotaExceededError' ? 'quota' : 'error' };
    }
  }
}

/**
 * All photo metadata WITHOUT blobs (§B7 list contract) — grid/profile reads.
 * @returns {Promise<import('../systems/gallery.logic.js').PhotoMeta[]>}
 */
export async function list() {
  const records = await allRecords();
  return records.map((r) => ({
    id: r.id, at: r.at, w: r.w, h: r.h, frame: r.frame, bytes: r.bytes,
    hasThumb: !!r.thumb,
  }));
}

/**
 * Full-resolution blob for the viewer.
 * @param {number} id
 * @returns {Promise<Blob|null>}
 */
export async function get(id) {
  const rec = await withStore('readonly', (store) => requested(store.get(id)), null);
  return rec?.blob ?? null;
}

/**
 * Grid thumbnail blob (falls back to the full blob for thumb-less records).
 * @param {number} id
 * @returns {Promise<Blob|null>}
 */
export async function getThumb(id) {
  const rec = await withStore('readonly', (store) => requested(store.get(id)), null);
  return rec?.thumb ?? rec?.blob ?? null;
}

/**
 * Delete one photo.
 * @param {number} id
 * @returns {Promise<boolean>} false when IDB is unavailable/errored
 */
export async function remove(id) {
  return withStore('readwrite', async (store) => {
    await requested(store.delete(id));
    return true;
  }, false);
}

/** @returns {Promise<number>} photos currently stored (0 when unavailable) */
export async function count() {
  return withStore('readonly', (store) => requested(store.count()), 0);
}

/** Test hygiene: drop the cached handle + warn-once latch. */
export function resetPhotoStoreForTests() {
  dbPromise = null;
  warnedUnavailable = false;
}
