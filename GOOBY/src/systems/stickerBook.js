// Sticker-book engine (PLAN3 §B5/§C5 — agent V3/G34): condition evaluation,
// once-only unlock latching, the queued "Neuer Sticker!" toast (max 1 per 3 s
// — §C5.5) and the §E0.1-7 'stickerHook' event contract. The pure core
// (stickerProgress / isStickerSatisfied / applyStickerUnlocks) has no
// three.js/DOM imports (§B rule) and is unit-tested in test/stickerBook.test.js;
// initStickerBook() wires it to the live store (single marked V3/G34 block in
// main.js).
//
// HOW CONDITIONS ARE FED (wiring map):
//   counters      feeds/washes/balls/sleeps/vetTrips/harvests/photosTaken/
//                 trips/holeInOnes/deliveries — v1/v2 systems already bump
//                 them; sickEver is latched by achievementsEngine's health
//                 watcher; nougatGlobs (G35), perfectCakes (G36), surfRuns
//                 (G37) land with their features and flow through the SAME
//                 counter plumbing (engine.track / direct store bumps).
//   specials      level / fullOutfit / weightMax / setsClaimed / skinsOwned /
//                 gameBest / collectionEntry — read from live state.
//   events        the 4 §C5.4 one-shot hooks. CONTRACT (§E0.1-7): hook firers
//                 call  store.emit('stickerHook', { id: '<hookId>' })  with
//                 id ∈ {grumpyWake, rainCanopy, nightStars, towed} — G35 owns
//                 the 4 fire sites; later agents may reuse the same channel.
// Every counter/special mutation flows through store.update → the coalesced
// 'change' event (§E2) → checkNow(), so unlocks need no per-feature calls.
//
// Unlock flow (§B5): detect → stickers.unlocked[id] = now() → runtime store
// event 'stickersChanged' (payload {id}) → queued toast „Neuer Sticker! 🏷️"
// + audio.play('sticker.get'). stickers.seen[id] is set when the detail
// sheet first opens (albumScreen calls markSeen — drives the „NEU" dot).

import { STICKERS } from '../data/stickers.js';
import { now } from '../core/clock.js';

/** §C5.5: bulk unlocks show at most 1 sticker toast per 3 s (queued). */
export const STICKER_TOAST_THROTTLE_MS = 3000;

/** §C13.3: fullFit counts the 3 ORIGINAL equip slots (back not required). */
const FULL_FIT_SLOTS = Object.freeze(['hat', 'glasses', 'neck']);

/**
 * Progress of one sticker condition against the live state (§B5 shapes).
 * Event-type stickers have no readable progress — they report 1/1 once
 * unlocked (the hook is the only unlock path), else 0/1.
 * @param {import('../data/stickers.js').StickerDef} def
 * @param {object} state save state (§E3/§B1)
 * @returns {{current: number, target: number}} current clamped to target
 */
export function stickerProgress(def, state) {
  const cond = def.cond ?? {};
  const target = Math.max(1, Math.floor(Number(cond.target) || 1));
  let current = 0;
  if (cond.counter) {
    current = Math.floor(Number(state?.achievements?.counters?.[cond.counter]) || 0);
  } else if (cond.event) {
    current = state?.stickers?.unlocked?.[def.id] ? 1 : 0;
  } else {
    switch (cond.special) {
      case 'level':
        current = Math.floor(Number(state?.level) || 0);
        break;
      case 'fullOutfit': {
        const eq = state?.outfits?.equipped ?? {};
        current = FULL_FIT_SLOTS.filter((slot) => eq[slot] != null).length;
        break;
      }
      case 'weightMax':
        current = Math.floor(Number(state?.weight?.value) || 0);
        break;
      case 'setsClaimed':
        current = Object.keys(state?.collections?.claimedSets ?? {}).length;
        break;
      case 'skinsOwned': {
        const owned = state?.skins?.owned;
        current = Array.isArray(owned) ? owned.length : 0;
        break;
      }
      case 'gameBest':
        current = Math.floor(Number(state?.minigames?.best?.[cond.game]) || 0);
        break;
      case 'collectionEntry':
        current = Math.floor(
          Number(state?.collections?.entries?.[`${cond.set}.${cond.entry}`]) || 0
        );
        break;
      default:
        current = 0;
    }
  }
  return { current: Math.max(0, Math.min(target, current)), target };
}

/**
 * @param {import('../data/stickers.js').StickerDef} def
 * @param {object} state
 * @returns {boolean} condition currently satisfied (event stickers: only
 *   true once their hook has latched the unlock)
 */
export function isStickerSatisfied(def, state) {
  const p = stickerProgress(def, state);
  return p.current >= p.target;
}

/**
 * Detect + latch every not-yet-unlocked counter/special sticker whose
 * condition holds (event stickers unlock ONLY via their §C5.4 hook). Pure —
 * returns a new state; unchanged input → same reference back (mirrors
 * achievementsEngine.applyUnlocks).
 * @param {object} state save state (§E3/§B1)
 * @param {number} [nowMs] unlock timestamp (defaults to clock now())
 * @param {import('../data/stickers.js').StickerDef[]} [defs] catalog override (tests)
 * @returns {{state: object, unlocked: import('../data/stickers.js').StickerDef[]}}
 */
export function applyStickerUnlocks(state, nowMs = now(), defs = STICKERS) {
  const already = state?.stickers?.unlocked ?? {};
  const newly = defs.filter(
    (def) => !def.cond?.event && !already[def.id] && isStickerSatisfied(def, state)
  );
  if (newly.length === 0) return { state, unlocked: [] };
  const next = {
    ...state,
    stickers: {
      seen: {}, // overwritten below when the slice exists
      ...state.stickers,
      unlocked: {
        ...already,
        ...Object.fromEntries(newly.map((def) => [def.id, nowMs])),
      },
    },
  };
  return { state: next, unlocked: newly };
}

/**
 * Book progress counts for badges/headers (§C5.3: header n/28, „NEU" dot).
 * @param {object} state
 * @param {import('../data/stickers.js').StickerDef[]} [defs]
 * @returns {{unlocked: number, total: number, unseen: number}}
 */
export function stickerCounts(state, defs = STICKERS) {
  const unlockedMap = state?.stickers?.unlocked ?? {};
  const seenMap = state?.stickers?.seen ?? {};
  let unlocked = 0;
  let unseen = 0;
  for (const def of defs) {
    if (unlockedMap[def.id]) {
      unlocked += 1;
      if (seenMap[def.id] !== true) unseen += 1;
    }
  }
  return { unlocked, total: defs.length, unseen };
}

// ---------------------------------------------------------------------------
// Runtime wiring (store subscription; DOM/audio only via injected deps)
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof initStickerBook>|null} */
let engineSingleton = null;

/** Disposer for the toast-queue timer (test hygiene). */
let queueCleanup = null;

/**
 * Wire the sticker-book engine to the live store (idempotent — singleton).
 * Subscribes to the coalesced 'change' event (§E2) for counter/special
 * conditions and to the runtime-only 'stickerHook' event (§E0.1-7) for the
 * §C5.4 one-shot moments. Every unlock happens exactly once (latched in
 * stickers.unlocked), emits 'stickersChanged' ({id}) and queues the §C5.5
 * throttled toast + 'sticker.get' jingle.
 *
 * @param {{store: object, ui?: object, audio?: object,
 *   defs?: import('../data/stickers.js').StickerDef[]}} deps
 *   ui/audio optional (headless tests); defs overrides the catalog (tests).
 * @returns {{checkNow: () => void,
 *   unlockByHook: (hookId: string) => boolean,
 *   markSeen: (stickerId: string) => void,
 *   counts: () => {unlocked: number, total: number, unseen: number},
 *   isUnlocked: (stickerId: string) => boolean,
 *   isSeen: (stickerId: string) => boolean}}
 */
export function initStickerBook({ store, ui, audio, defs = STICKERS }) {
  if (engineSingleton) return engineSingleton;

  /** cond.event hook id → sticker def (grumpyWake → grumpMorning, …). */
  const hookMap = new Map(defs.filter((d) => d.cond?.event).map((d) => [d.cond.event, d]));

  // --- §C5.5 toast queue: max 1 sticker toast per 3 s (bulk-unlock safe) ---
  let lastToastAt = -Infinity;
  let pending = 0;
  let timer = null;

  function drainQueue() {
    timer = null;
    if (pending <= 0) return;
    pending -= 1;
    lastToastAt = Date.now();
    ui?.toast?.('stickerbook.unlockToast');
    audio?.play?.('sticker.get');
    if (pending > 0) {
      timer = setTimeout(drainQueue, STICKER_TOAST_THROTTLE_MS);
      if (typeof timer === 'object' && timer?.unref) timer.unref();
    }
  }

  function queueToast() {
    pending += 1;
    if (timer != null) return; // drain chain already scheduled
    const wait = Math.max(0, lastToastAt + STICKER_TOAST_THROTTLE_MS - Date.now());
    if (wait === 0) {
      drainQueue();
    } else {
      timer = setTimeout(drainQueue, wait);
      if (typeof timer === 'object' && timer?.unref) timer.unref();
    }
  }

  queueCleanup = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    pending = 0;
  };

  /** Announce one fresh unlock: runtime event + queued toast/jingle. */
  function announce(def) {
    store.emit('stickersChanged', { id: def.id });
    queueToast();
  }

  /** Evaluate counter/special conditions against the live state (latched). */
  function checkNow() {
    const result = applyStickerUnlocks(store.get(), now(), defs);
    if (result.unlocked.length === 0) return;
    store.update((state) => {
      // Re-apply against the live state (listener-safe): applyStickerUnlocks
      // is idempotent per sticker via the unlocked map.
      const again = applyStickerUnlocks(state, now(), defs);
      Object.assign(state, again.state);
    });
    for (const def of result.unlocked) announce(def);
  }

  /**
   * §E0.1-7 hook consumer: unlock the event-sticker mapped to a §C5.4 hook
   * id. Unknown hook ids and repeat fires are safe no-ops.
   * @param {string} hookId 'grumpyWake' | 'rainCanopy' | 'nightStars' | 'towed'
   * @returns {boolean} whether a NEW unlock happened
   */
  function unlockByHook(hookId) {
    const def = hookMap.get(hookId);
    if (!def) return false;
    if (store.get('stickers')?.unlocked?.[def.id]) return false;
    store.update((state) => {
      if (state.stickers == null || typeof state.stickers !== 'object') {
        state.stickers = { unlocked: {}, seen: {} };
      }
      if (state.stickers.unlocked == null || typeof state.stickers.unlocked !== 'object') {
        state.stickers.unlocked = {};
      }
      state.stickers.unlocked[def.id] = now();
    });
    announce(def);
    return true;
  }

  /**
   * Mark a sticker's detail sheet as opened (§B5: drives the „NEU" dot).
   * Only meaningful for unlocked stickers; repeat calls are no-ops.
   * @param {string} stickerId
   */
  function markSeen(stickerId) {
    const stickers = store.get('stickers');
    if (!stickers?.unlocked?.[stickerId] || stickers?.seen?.[stickerId] === true) return;
    store.update((state) => {
      if (state.stickers.seen == null || typeof state.stickers.seen !== 'object') {
        state.stickers.seen = {};
      }
      state.stickers.seen[stickerId] = true;
    });
  }

  store.on('change', checkNow);
  store.on('stickerHook', (payload) => {
    if (payload && typeof payload.id === 'string') unlockByHook(payload.id);
  });
  checkNow(); // catch conditions already met by the loaded save

  engineSingleton = {
    checkNow,
    unlockByHook,
    markSeen,
    counts: () => stickerCounts(store.get(), defs),
    isUnlocked: (id) => !!store.get('stickers')?.unlocked?.[id],
    isSeen: (id) => store.get('stickers')?.seen?.[id] === true,
  };
  return engineSingleton;
}

/** @returns {ReturnType<typeof initStickerBook>|null} engine after initStickerBook */
export function getStickerBook() {
  return engineSingleton;
}

/** Test-only: drop the singleton so initStickerBook can re-wire a fresh store. */
export function resetStickerBookForTests() {
  engineSingleton = null;
  queueCleanup?.();
  queueCleanup = null;
}
