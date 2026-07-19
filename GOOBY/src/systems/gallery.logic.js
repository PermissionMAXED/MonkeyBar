// Gallery decision logic (PLAN4 §B7/§C-SYS9 — agent V4/G59). The PURE half of
// the photo gallery: cap/LRU eviction plans, quota-retry decisions, the HUD
// album-badge rule and the save-slice mirror shape. core/photoStore.js (the
// IndexedDB wrapper) consumes these plans; node tests hit THIS module plus the
// wrapper over a fake-indexedDB seam (test/gallery.test.js — §C-SYS9.5).
// No DOM/three imports (systems/ §B rule); strings.js is pure data.

import { t, getLang } from '../data/strings.js';
import { EN as G59_EN, DE as G59_DE } from '../data/strings/v4-gallery.js';

/** §B7/§C-SYS9 frozen gallery numbers (§E0.1-7: module-owned consts). */
export const GALLERY = Object.freeze({
  /** hard photo cap — oldest-first eviction beyond this (§B7) */
  CAP: 40,
  /** photos evicted on QuotaExceededError before the ONE retry (§B7) */
  QUOTA_EVICT: 4,
  /** square thumbnail edge in px (grid thumbs — §C-SYS9.2) */
  THUMB_PX: 256,
});

/**
 * §E0.1-11 seam: translate a gallery key through the global table, falling
 * back to the G59-owned v4-gallery module until G53's strings.js spread
 * lands (wave-1b concurrency). Once the spread exists, t() resolves and the
 * fallback is dead weight only for genuinely unknown keys.
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function tG(key, vars) {
  const global = t(key, vars);
  if (global !== key) return global;
  let s = (getLang() === 'de' ? G59_DE[key] : G59_EN[key]) ?? G59_EN[key];
  if (s == null) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/**
 * §E0.1-11 seam, toast flavor: ui.toast() translates keys itself — while the
 * global table misses a gallery key, hand it the pre-translated text instead
 * (t() passes unknown "keys" through verbatim). Collapses to a plain
 * ui.toast(key, vars) once G53's spread lands.
 * @param {{toast: Function}} ui
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 */
export function toastG(ui, key, vars) {
  ui?.toast?.(t(key, vars) === key ? tG(key, vars) : key, vars);
}

/**
 * @typedef {Object} PhotoMeta
 * @property {number} id    autoIncrement key (§B7 record)
 * @property {number} at    capture epoch ms
 * @property {number} w     composed width px
 * @property {number} h     composed height px
 * @property {string} frame PHOTO_FRAMES id at capture time
 * @property {number} bytes blob size
 */

/**
 * Clamp arbitrary/hostile meta into the §B7 record shape (never trusts the
 * caller: NaN/negative/foreign types collapse to safe values).
 * @param {object} [meta]
 * @param {number} [bytes] blob size (authoritative — overrides meta.bytes)
 * @param {number} [nowMs] fallback timestamp
 * @returns {{at: number, w: number, h: number, frame: string, bytes: number}}
 */
export function normalizeMeta(meta = {}, bytes = 0, nowMs = Date.now()) {
  const num = (v, fallback = 0) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    at: num(meta.at, num(nowMs)) || num(nowMs),
    w: num(meta.w),
    h: num(meta.h),
    frame: typeof meta.frame === 'string' ? meta.frame.slice(0, 32) : 'none',
    bytes: num(bytes),
  };
}

/**
 * Oldest-first ordering (§B7 "oldest-by-at"; id breaks ties — lower
 * autoIncrement id = earlier add).
 * @param {PhotoMeta[]} metas
 * @returns {PhotoMeta[]} new sorted array (input untouched)
 */
export function sortOldestFirst(metas) {
  return [...(metas ?? [])].sort((a, b) => (a.at - b.at) || (a.id - b.id));
}

/**
 * Grid ordering: newest first (§C-SYS9.2).
 * @param {PhotoMeta[]} metas
 * @returns {PhotoMeta[]} new sorted array (input untouched)
 */
export function sortNewestFirst(metas) {
  return sortOldestFirst(metas).reverse();
}

/**
 * Which ids must be deleted BEFORE adding one more photo so the store never
 * exceeds `cap` (§B7: delete oldest-by-at first). Normally 0 or 1 id; heals
 * oversized stores (e.g. cap lowered between versions) in one pass.
 * @param {PhotoMeta[]} metas current store contents
 * @param {number} [cap]
 * @returns {number[]} ids to delete, oldest first
 */
export function evictionIdsForAdd(metas, cap = GALLERY.CAP) {
  const n = metas?.length ?? 0;
  const excess = n - cap + 1; // +1: room for the incoming photo
  if (excess <= 0) return [];
  return sortOldestFirst(metas).slice(0, excess).map((m) => m.id);
}

/**
 * QuotaExceededError recovery plan (§B7): the `count` oldest photos to evict
 * before the single retry. Returns every id when fewer than `count` exist.
 * @param {PhotoMeta[]} metas
 * @param {number} [count]
 * @returns {number[]} ids to delete, oldest first
 */
export function quotaEvictionIds(metas, count = GALLERY.QUOTA_EVICT) {
  return sortOldestFirst(metas).slice(0, Math.max(0, count)).map((m) => m.id);
}

/**
 * The `gallery` save-slice mirror written synchronously on add/remove (§B7:
 * blobs live in IDB, the slice only mirrors count/lastAddedAt for badges).
 * @param {number} count photos in the store AFTER the mutation
 * @param {number} lastAddedAt epoch ms of the latest add (0 = keep existing)
 * @returns {{count: number, lastAddedAt: number}}
 */
export function mirrorSlice(count, lastAddedAt) {
  return {
    count: Math.max(0, Math.floor(Number(count) || 0)),
    lastAddedAt: Math.max(0, Math.floor(Number(lastAddedAt) || 0)),
  };
}

/**
 * §C-SYS9.3-1 HUD album badge rule: dot while a photo was added and the
 * gallery has not been visited since (gallery.lastAddedAt vs the runtime
 * session-seen stamp — a fresh session with existing lastAddedAt shows the
 * dot again, which is the intended "something new since you last looked").
 * @param {number} lastAddedAt gallery.lastAddedAt (persisted)
 * @param {number} seenStamp session-seen stamp (runtime)
 * @returns {boolean}
 */
export function shouldShowAlbumBadge(lastAddedAt, seenStamp) {
  const added = Math.floor(Number(lastAddedAt) || 0);
  return added > 0 && added > Math.floor(Number(seenStamp) || 0);
}

/**
 * §C-SYS9.3-3 one-time first-photo hint decision (persisted guard).
 * @param {{hintShown?: boolean}|null|undefined} gallery gallery save slice
 * @returns {boolean} true → show the toast and set hintShown
 */
export function shouldShowFirstPhotoHint(gallery) {
  return gallery?.hintShown !== true;
}

// --- runtime session-seen stamp (NOT persisted — §C-SYS9.3-1) ---------------
let sessionSeenAt = 0;

/** Record "the gallery was just visited" (album Fotos tab render). */
export function markGallerySeen(nowMs = Date.now()) {
  sessionSeenAt = Math.max(sessionSeenAt, Math.floor(Number(nowMs) || 0));
}

/** @returns {number} the runtime session-seen stamp (0 = never this session) */
export function gallerySeenStamp() {
  return sessionSeenAt;
}

/** Test hygiene: reset the runtime stamp. */
export function resetGallerySeenForTests() {
  sessionSeenAt = 0;
}
