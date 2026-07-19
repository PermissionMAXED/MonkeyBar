// V4/G59 — photo gallery (PLAN4 §B7/§C-SYS9.5, binding): the pure decision
// table (cap/LRU eviction, quota-retry plan, badge stamp rule, meta clamps,
// mirror slice, first-photo hint) + the photoStore IndexedDB wrapper driven
// over a minimal fake-indexedDB seam (globalThis.indexedDB is read at call
// time — §B7 exception-safety: null/false/[] + ONE warn when unavailable),
// incl. LRU eviction at cap 40 (45 adds → 40 remain, oldest evicted), meta
// persistence, QuotaExceededError evict-4-and-retry-ONCE, and the §C-SYS9.4
// guarded-import proof (no static @capacitor imports in the export path).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Blob } from 'node:buffer';

const {
  GALLERY, tG, toastG, normalizeMeta, sortOldestFirst, sortNewestFirst,
  evictionIdsForAdd, quotaEvictionIds, mirrorSlice, shouldShowAlbumBadge,
  shouldShowFirstPhotoHint, markGallerySeen, gallerySeenStamp,
  resetGallerySeenForTests,
} = await import('../src/systems/gallery.logic.js');
const { EN: GALLERY_EN } = await import('../src/data/strings/v4-gallery.js');
const { t } = await import('../src/data/strings.js');
const photoStore = await import('../src/core/photoStore.js');

// ---------------------------------------------------------------- fake IDB
// Minimal seam (§C-SYS9.5): exactly the surface photoStore touches. Errors
// travel the real path (request.onerror + request.error); `failAddsWithQuota`
// makes the next N add()s reject with a QuotaExceededError.
function createFakeIndexedDB() {
  const state = { records: new Map(), nextId: 1, failAddsWithQuota: 0 };
  const request = (fn) => {
    const req = { onsuccess: null, onerror: null, result: undefined, error: null };
    queueMicrotask(() => {
      try {
        req.result = fn();
        req.onsuccess?.();
      } catch (err) {
        req.error = err;
        req.onerror?.();
      }
    });
    return req;
  };
  const objectStore = {
    add: (record) => request(() => {
      if (state.failAddsWithQuota > 0) {
        state.failAddsWithQuota -= 1;
        const err = new Error('quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      const id = state.nextId++;
      state.records.set(id, { ...record, id });
      return id;
    }),
    getAll: () => request(() => [...state.records.values()]),
    get: (id) => request(() => state.records.get(id)),
    delete: (id) => request(() => { state.records.delete(id); }),
    count: () => request(() => state.records.size),
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => objectStore,
    transaction: () => ({ objectStore: () => objectStore }),
  };
  const idb = {
    open: () => {
      const req = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null, result: db };
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { idb, state };
}

/** Install a fresh fake IDB + reset the store's cached handle. */
function freshStore() {
  const fake = createFakeIndexedDB();
  globalThis.indexedDB = fake.idb;
  photoStore.resetPhotoStoreForTests();
  return fake;
}

function dropIdb() {
  delete globalThis.indexedDB;
  photoStore.resetPhotoStoreForTests();
}

const blobOf = (bytes = 64) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

// ------------------------------------------------------------- pure logic

test('GALLERY consts are the §B7/§C-SYS9 numbers and frozen', () => {
  assert.equal(GALLERY.CAP, 40);
  assert.equal(GALLERY.QUOTA_EVICT, 4);
  assert.ok(Object.isFrozen(GALLERY));
});

test('evictionIdsForAdd: under cap → no eviction', () => {
  const metas = [{ id: 1, at: 10 }, { id: 2, at: 20 }];
  assert.deepEqual(evictionIdsForAdd(metas, 40), []);
  assert.deepEqual(evictionIdsForAdd([], 40), []);
});

test('evictionIdsForAdd: at cap → exactly the oldest id', () => {
  const metas = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, at: 1000 + i }));
  assert.deepEqual(evictionIdsForAdd(metas, 40), [1]);
});

test('evictionIdsForAdd: oversized store heals in one pass, oldest-by-at first', () => {
  const metas = Array.from({ length: 44 }, (_, i) => ({ id: i + 1, at: 5000 - i })); // newest first ids
  const ids = evictionIdsForAdd(metas, 40);
  assert.equal(ids.length, 5); // 44 − 40 + 1 room for the incoming photo
  assert.deepEqual(ids, [44, 43, 42, 41, 40]); // the 5 SMALLEST at values
});

test('sortOldestFirst/sortNewestFirst: at then id tiebreak, inputs untouched', () => {
  const metas = [{ id: 3, at: 7 }, { id: 1, at: 7 }, { id: 2, at: 3 }];
  assert.deepEqual(sortOldestFirst(metas).map((m) => m.id), [2, 1, 3]);
  assert.deepEqual(sortNewestFirst(metas).map((m) => m.id), [3, 1, 2]);
  assert.deepEqual(metas.map((m) => m.id), [3, 1, 2]); // untouched
});

test('quotaEvictionIds: the 4 oldest; short stores return everything', () => {
  const metas = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, at: 100 + i }));
  assert.deepEqual(quotaEvictionIds(metas), [1, 2, 3, 4]);
  assert.deepEqual(quotaEvictionIds(metas.slice(0, 2)), [1, 2]);
  assert.deepEqual(quotaEvictionIds([], 4), []);
});

test('normalizeMeta: hostile shapes clamp to the §B7 record fields', () => {
  const m = normalizeMeta({ at: -5, w: NaN, h: '1440', frame: 42 }, -3, 777);
  assert.deepEqual(m, { at: 777, w: 0, h: 1440, frame: 'none', bytes: 0 });
  const long = normalizeMeta({ frame: 'x'.repeat(99), at: 5 }, 10, 1);
  assert.equal(long.frame.length, 32);
  assert.equal(long.bytes, 10);
  assert.equal(long.at, 5);
});

test('mirrorSlice clamps count/lastAddedAt to non-negative ints', () => {
  assert.deepEqual(mirrorSlice(3.9, 100.2), { count: 3, lastAddedAt: 100 });
  assert.deepEqual(mirrorSlice(-2, NaN), { count: 0, lastAddedAt: 0 });
});

test('shouldShowAlbumBadge: dot only while lastAddedAt is newer than seen', () => {
  assert.equal(shouldShowAlbumBadge(0, 0), false); // never added
  assert.equal(shouldShowAlbumBadge(500, 0), true); // added, never visited
  assert.equal(shouldShowAlbumBadge(500, 500), false); // visited at add time
  assert.equal(shouldShowAlbumBadge(500, 900), false); // visited later
  assert.equal(shouldShowAlbumBadge(undefined, 0), false); // hostile
});

test('session-seen stamp: monotonic, resettable', () => {
  resetGallerySeenForTests();
  assert.equal(gallerySeenStamp(), 0);
  markGallerySeen(1000);
  markGallerySeen(400); // never regresses
  assert.equal(gallerySeenStamp(), 1000);
  assert.equal(shouldShowAlbumBadge(900, gallerySeenStamp()), false);
  assert.equal(shouldShowAlbumBadge(1400, gallerySeenStamp()), true);
  resetGallerySeenForTests();
  assert.equal(gallerySeenStamp(), 0);
});

test('shouldShowFirstPhotoHint: one-time persisted guard (§C-SYS9.3-3)', () => {
  assert.equal(shouldShowFirstPhotoHint(undefined), true);
  assert.equal(shouldShowFirstPhotoHint({ hintShown: false }), true);
  assert.equal(shouldShowFirstPhotoHint({ hintShown: true }), false);
});

test('tG/toastG: §E0.1-11 seam resolves gallery keys pre/post-spread', () => {
  assert.equal(tG('gallery.full'), GALLERY_EN['gallery.full']);
  assert.ok(tG('profile.galleryRow', { n: 7 }).includes('7'));
  assert.equal(tG('totally.unknown.key'), 'totally.unknown.key');
  const toasts = [];
  toastG({ toast: (key) => toasts.push(key) }, 'gallery.full');
  assert.equal(toasts.length, 1);
  // Pre-spread the seam hands ui.toast the pre-translated TEXT; once the
  // global table resolves the key (the strings.js spread landed) it hands the
  // raw KEY and ui.toast translates. Either way the user sees the real string.
  const seen = toasts[0] === 'gallery.full' ? t('gallery.full') : toasts[0];
  assert.equal(seen, GALLERY_EN['gallery.full']);
});

// --------------------------------------------------- photoStore (fake IDB)

test('photoStore: add/list/get/count round-trip persists §B7 meta, list has no blobs', async () => {
  freshStore();
  const blob = blobOf(128);
  const res = await photoStore.add(blob, { at: 123, w: 1080, h: 1440, frame: 'polaroid' });
  assert.equal(res.ok, true);
  assert.equal(typeof res.id, 'number');
  const metas = await photoStore.list();
  assert.equal(metas.length, 1);
  const m = metas[0];
  assert.equal(m.at, 123);
  assert.equal(m.w, 1080);
  assert.equal(m.h, 1440);
  assert.equal(m.frame, 'polaroid');
  assert.equal(m.bytes, 128);
  assert.equal('blob' in m, false); // §B7: list() → meta only
  assert.equal(m.hasThumb, false); // no canvas APIs in node → thumb null
  const back = await photoStore.get(res.id);
  assert.equal(back, blob);
  assert.equal(await photoStore.count(), 1);
});

test('photoStore: cap 40 LRU — 45 adds keep 40, the 5 oldest evicted', async () => {
  freshStore();
  for (let i = 0; i < 45; i += 1) {
    const res = await photoStore.add(blobOf(8), { at: 1000 + i, w: 4, h: 4, frame: 'none' });
    assert.equal(res.ok, true, `add ${i} ok`);
  }
  assert.equal(await photoStore.count(), 40);
  const ats = (await photoStore.list()).map((m) => m.at).sort((a, b) => a - b);
  assert.equal(ats.length, 40);
  assert.equal(ats[0], 1005); // 1000–1004 evicted oldest-first
  assert.equal(ats[39], 1044);
});

test('photoStore: remove() deletes one photo', async () => {
  freshStore();
  const a = await photoStore.add(blobOf(8), { at: 1 });
  const b = await photoStore.add(blobOf(8), { at: 2 });
  assert.equal(await photoStore.remove(a.id), true);
  assert.equal(await photoStore.count(), 1);
  assert.equal(await photoStore.get(a.id), null);
  assert.deepEqual((await photoStore.list()).map((m) => m.id), [b.id]);
});

test('photoStore: QuotaExceededError → evict 4 oldest + retry ONCE (§B7)', async () => {
  const fake = freshStore();
  for (let i = 0; i < 10; i += 1) await photoStore.add(blobOf(8), { at: 100 + i });
  fake.state.failAddsWithQuota = 1; // first attempt fails, the retry lands
  const res = await photoStore.add(blobOf(8), { at: 999 });
  assert.equal(res.ok, true);
  assert.equal(await photoStore.count(), 7); // 10 − 4 evicted + 1 new
  const ats = (await photoStore.list()).map((m) => m.at).sort((a, b) => a - b);
  assert.deepEqual(ats, [104, 105, 106, 107, 108, 109, 999]); // 100–103 gone
});

test('photoStore: persistent quota failure resolves {ok:false, reason:quota}', async () => {
  const fake = freshStore();
  for (let i = 0; i < 10; i += 1) await photoStore.add(blobOf(8), { at: 100 + i });
  fake.state.failAddsWithQuota = 2; // attempt + the single retry both fail
  const res = await photoStore.add(blobOf(8), { at: 999 });
  assert.deepEqual(res, { ok: false, reason: 'quota' });
  assert.equal(await photoStore.count(), 6); // 4 evicted, nothing added
});

test('photoStore: getThumb falls back to the full blob when thumb missing', async () => {
  freshStore();
  const blob = blobOf(32);
  const res = await photoStore.add(blob, { at: 1 });
  assert.equal(await photoStore.getThumb(res.id), blob); // node → thumb null
  assert.equal(await photoStore.getThumb(98765), null);
});

test('photoStore: exception-safe without IndexedDB — resolves, warns ONCE (§B7)', async () => {
  dropIdb();
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.deepEqual(await photoStore.add(blobOf(8), { at: 1 }), { ok: false, reason: 'unavailable' });
    assert.deepEqual(await photoStore.list(), []);
    assert.equal(await photoStore.get(1), null);
    assert.equal(await photoStore.getThumb(1), null);
    assert.equal(await photoStore.remove(1), false);
    assert.equal(await photoStore.count(), 0);
  } finally {
    console.warn = origWarn;
  }
  const unavailable = warnings.filter((w) => w.includes('[photoStore] IndexedDB unavailable'));
  assert.equal(unavailable.length, 1); // warn ONCE, then silent no-ops
});

test('photoStore: add() without a blob is a safe no-op', async () => {
  freshStore();
  const res = await photoStore.add(null, { at: 1 });
  assert.deepEqual(res, { ok: false, reason: 'unavailable' });
  assert.equal(await photoStore.count(), 0);
});

// ------------------------------------------------------ §C-SYS9.4 guards

test('guard: export path never statically imports @capacitor/* (§C-SYS9.4)', async () => {
  for (const file of ['src/ui/shareImage.js', 'src/core/photoStore.js', 'src/systems/gallery.logic.js']) {
    const src = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal(
      /^\s*import\s[^;]*['"]@capacitor\//m.test(src), false,
      `${file} must not hard-require Capacitor plugins`
    );
  }
});

test('guard: v4-gallery strings exist in BOTH EN and DE (§E0.1-8)', async () => {
  const { EN, DE } = await import('../src/data/strings/v4-gallery.js');
  const enKeys = Object.keys(EN).sort();
  const deKeys = Object.keys(DE).sort();
  assert.deepEqual(enKeys, deKeys);
  assert.ok(enKeys.length >= 12);
  for (const k of enKeys) {
    assert.ok(EN[k].length > 0, `EN ${k}`);
    assert.ok(DE[k].length > 0, `DE ${k}`);
  }
});
