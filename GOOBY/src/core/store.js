// State store (§E2): wraps the save-schema state (§E3). get/set/update/on with
// per-frame coalesced 'change' events plus specific events, debounced autosave
// (1 s trailing) and forced flush on visibilitychange/pagehide. Pure module:
// no three.js/DOM imports (window/document usage is guarded for node:test).

import { ENGINE } from '../data/constants.js';
// V3/FIX-A (E20 P0-2): + load/hasNewerSave for the multi-tab guard below.
import { persist, load, hasNewerSave } from './save.js';
// V3/FIX-A: bilingual stale-tab notice text (pure data import; store.js owns
// no strings/* module, so the two strings live inline below — documented
// deviation from the t(key) rule, scoped to this one notice).
import { getLang } from '../data/strings.js';
// V2/G20: weight tier mapping for the §B5 'weightChanged' granularity rule
// (emit only when the integer value or the tier changes). Pure import.
import { tierOf } from '../systems/weight.js';

/**
 * Specific store events (§E2). 'change' fires (coalesced) on any mutation.
 * 'levelUp' payload: { level }. 'achievementUnlocked' payload: id (string).
 * V3/FIX-A: runtime-only 'saveConflict' ({ reason: 'stale' }) fires when this
 * tab's persist was refused because another tab holds a newer save (P0-2).
 */
const EVENTS = [
  'change',
  'statsChanged',
  'coinsChanged',
  'xpChanged',
  'levelUp',
  'sleepChanged',
  'inventoryChanged',
  'outfitChanged',
  'decorChanged',
  'achievementUnlocked',
  // V2/G20: §B3 persisted-slice events (payload = the slice, v1 style).
  // 'weightChanged' fires only when Math.round(value) or tierOf(value)
  // changes (§B5); the others fire on any slice change. Runtime-only events
  // ('dayBandChanged'/'weatherChanged', §B3) go through store.emit() and are
  // never diffed/persisted.
  'gardenChanged',
  'healthChanged',
  'weightChanged',
  'questsChanged',
  'collectionsChanged',
  'skinChanged',
  'itemsChanged',
  'profileChanged',
];

/** @type {ReturnType<typeof createStore>|null} */
let singleton = null;

/**
 * Create the store singleton wrapping a loaded save state.
 * @param {object} state save-schema state (§E3), from core/save.js load()
 * @param {{autosave?: boolean}} [opts] autosave defaults to true
 */
export function createStore(state, opts = {}) {
  const listeners = new Map(EVENTS.map((e) => [e, new Set()]));
  const autosave = opts.autosave !== false;
  let flushScheduled = false;
  let saveTimer = null;
  // V3/FIX-A (E20 P0-2): sticky "stale tab" latch. True while another tab
  // owns a newer save than this tab's state — all persists are skipped so
  // the newer write can never be lost. Cleared only when this tab becomes
  // the visible (single-writer) tab again, after adopting the newest save.
  let staleTab = false;
  let snapshot = takeSnapshot();

  function takeSnapshot() {
    return {
      stats: JSON.stringify(state.stats),
      coins: state.coins,
      xp: state.xp,
      level: state.level,
      sleep: JSON.stringify(state.sleep),
      inventory: JSON.stringify(state.inventory),
      outfits: JSON.stringify(state.outfits),
      decor: JSON.stringify(state.decor) + JSON.stringify(state.furniture),
      achievements: Object.keys(state.achievements?.unlocked ?? {}).join(','),
      // V2/G20: §B3 slice snapshots (weight per the §B5 int|tier rule)
      garden: JSON.stringify(state.garden),
      health: JSON.stringify(state.health),
      weight: `${Math.round(Number(state.weight?.value) || 0)}|${tierOf(state.weight?.value)}`,
      quests: JSON.stringify(state.quests),
      collections: JSON.stringify(state.collections),
      skins: JSON.stringify(state.skins),
      items: JSON.stringify(state.items),
      profile: JSON.stringify(state.profile),
    };
  }

  function emit(event, payload) {
    // V2/G20: returns the listener count so runtime-event emitters (careSheet
    // vet button → G21 trip flow) can detect "nobody is listening" fallbacks.
    let called = 0;
    for (const cb of listeners.get(event) ?? []) {
      try {
        cb(payload);
        called += 1;
      } catch (err) {
        console.error(`[store] listener error for '${event}':`, err);
      }
    }
    return called;
  }

  /** Diff vs the last snapshot and emit specific events + coalesced 'change'. */
  function flushEvents() {
    flushScheduled = false;
    const next = takeSnapshot();
    if (next.stats !== snapshot.stats) emit('statsChanged', state.stats);
    if (next.coins !== snapshot.coins) emit('coinsChanged', state.coins);
    if (next.xp !== snapshot.xp || next.level !== snapshot.level) emit('xpChanged', { xp: state.xp, level: state.level });
    if (state.level > snapshot.level) emit('levelUp', { level: state.level });
    if (next.sleep !== snapshot.sleep) emit('sleepChanged', state.sleep);
    if (next.inventory !== snapshot.inventory) emit('inventoryChanged', state.inventory);
    if (next.outfits !== snapshot.outfits) emit('outfitChanged', state.outfits);
    if (next.decor !== snapshot.decor) emit('decorChanged', undefined);
    const prevUnlocked = new Set(snapshot.achievements ? snapshot.achievements.split(',') : []);
    for (const id of Object.keys(state.achievements?.unlocked ?? {})) {
      if (!prevUnlocked.has(id)) emit('achievementUnlocked', id);
    }
    // V2/G20: §B3 persisted-slice events (payload = the live slice)
    if (next.garden !== snapshot.garden) emit('gardenChanged', state.garden);
    if (next.health !== snapshot.health) emit('healthChanged', state.health);
    if (next.weight !== snapshot.weight) emit('weightChanged', state.weight);
    if (next.quests !== snapshot.quests) emit('questsChanged', state.quests);
    if (next.collections !== snapshot.collections) emit('collectionsChanged', state.collections);
    if (next.skins !== snapshot.skins) emit('skinChanged', state.skins);
    if (next.items !== snapshot.items) emit('itemsChanged', state.items);
    if (next.profile !== snapshot.profile) emit('profileChanged', state.profile);
    snapshot = next;
    emit('change', state);
  }

  // --- V3/FIX-A (E20 P0-2): stale-tab persistence policy --------------------
  // persist() (core/save.js) refuses to overwrite a NEWER save written by
  // another tab (write-generation guard) and returns false. This wrapper
  // turns that refusal into a sticky stale state: the tab stops persisting,
  // shows a one-time notice and emits the runtime 'saveConflict' event
  // (payload { reason: 'stale' }) for any future UI wiring.

  /**
   * One-time (per staleness episode) "save updated in another tab" notice.
   * The 'saveConflict' event always fires; the DOM toast renders only for a
   * VISIBLE tab — a hidden tab going stale is the normal, silent writership
   * handover (it adopts the newer save and recovers on its own).
   */
  function showStaleNotice() {
    emit('saveConflict', { reason: 'stale' });
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') return;
    const root = document.getElementById('ui');
    if (!root) return;
    // Mirrors ui.js's transient toast markup (styles.css .toast). Inline
    // EN/DE because store.js owns no strings/* module (see import note).
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = getLang() === 'de'
      ? 'Spielstand in einem anderen Tab aktualisiert — zum Weiterspielen hier neu laden.'
      : 'Save updated in another tab — reload here to keep playing.';
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 300);
    }, 5000);
  }

  /** Guarded persist: no-ops while stale; latches stale on a refused write. */
  function persistNow() {
    if (staleTab) return;
    if (persist(state) === false) {
      staleTab = true;
      showStaleNotice();
    }
  }

  /**
   * Adopt the newer save another tab persisted: reload through the full
   * §E3 pipeline and swap the state IN PLACE (same object identity — every
   * holder of store.get() sees the adopted data), then flush so the snapshot
   * diff emits the regular §E2 events for everything that changed. The tab
   * stays read-only (stale) until it is the visible tab again. A foreign
   * wipe/corruption (fresh/recovered load) is NOT adopted — this tab keeps
   * its live state rather than clobbering memory with a recovery state.
   */
  function adoptNewerSave() {
    const result = load();
    if (result.fresh || result.recovered) return;
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, result.state);
    staleTab = true;
    scheduleFlush();
  }

  /** 'storage' event: another same-origin tab wrote. Adopt when idle. */
  function onForeignWrite() {
    if (!hasNewerSave()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      adoptNewerSave(); // idle tab: silently follow the active writer
    } else if (!staleTab) {
      staleTab = true; // visible dual-tab play: freeze writes + tell the user
      showStaleNotice();
    }
  }

  /**
   * Becoming visible again: catch up if needed, then CLAIM writership by
   * persisting a fresh generation right away. The claim matters because a
   * still-open background tab keeps autosaving its time-engine ticks (1 Hz)
   * without ever being refused — bumping the generation here makes that
   * tab's next autosave the refused one, so it latches stale and starts
   * adopting instead. One retry absorbs a background write racing into the
   * adopt→claim window; losing twice keeps this tab stale with the notice.
   */
  function onBecameVisible() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (hasNewerSave()) adoptNewerSave();
      staleTab = false;
      if (!autosave) return; // never write for an autosave-less store
      if (persist(state) !== false) return;
      staleTab = true;
    }
    showStaleNotice();
  }
  // --- end V3/FIX-A P0-2 policy ---

  function scheduleFlush() {
    if (!flushScheduled) {
      flushScheduled = true;
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(flushEvents);
      else setTimeout(flushEvents, 0);
    }
    if (autosave && saveTimer == null) {
      // Trailing (non-resetting) debounce: at most one write per second even
      // while the time engine mutates stats every tick.
      saveTimer = setTimeout(() => {
        saveTimer = null;
        persistNow(); // V3/FIX-A: stale-guarded (was a bare persist(state))
      }, ENGINE.AUTOSAVE_DEBOUNCE_MS);
    }
  }

  /**
   * Resolve a dot path ('stats.energy') to [parentObject, lastKey].
   * @param {string} path
   */
  function resolve(path) {
    const keys = path.split('.');
    let obj = state;
    for (let i = 0; i < keys.length - 1; i++) {
      if (obj[keys[i]] == null || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    return [obj, keys[keys.length - 1]];
  }

  const store = {
    /**
     * Read a value by dot path; no path returns the whole state (do not mutate
     * the result — use set/update).
     * @param {string} [path]
     */
    get(path) {
      if (!path) return state;
      let obj = state;
      for (const key of path.split('.')) {
        if (obj == null) return undefined;
        obj = obj[key];
      }
      return obj;
    },

    /**
     * Set a value by dot path.
     * @param {string} path
     * @param {*} value
     */
    set(path, value) {
      const [obj, key] = resolve(path);
      obj[key] = value;
      scheduleFlush();
    },

    /**
     * Batched mutation: fn receives the state and mutates it directly. Events
     * are coalesced into a single per-frame flush.
     * @param {(state: object) => void} fn
     */
    update(fn) {
      fn(state);
      scheduleFlush();
    },

    /**
     * Subscribe to a store event (§E2).
     * @param {string} event
     * @param {(payload: *) => void} cb
     */
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => store.off(event, cb);
    },

    /** @param {string} event @param {(payload: *) => void} cb */
    off(event, cb) {
      listeners.get(event)?.delete(cb);
    },

    /**
     * V2/G20: emit a RUNTIME-ONLY event (§B3: 'dayBandChanged',
     * 'weatherChanged'; plus 'healthEvent' and 'vetTripRequested' — see
     * timeEngine/careSheet). Never used for persisted-slice events (those
     * flush from snapshot diffs). Returns how many listeners ran, so callers
     * can offer graceful "not built yet" fallbacks.
     * @param {string} event
     * @param {*} [payload]
     * @returns {number} listener count that received the event
     */
    emit(event, payload) {
      return emit(event, payload);
    },

    /** Force pending events + save to flush immediately (pagehide etc.). */
    flush() {
      if (flushScheduled) flushEvents();
      if (saveTimer != null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (autosave) persistNow(); // V3/FIX-A: stale-guarded (see P0-2 block)
    },
  };

  // Forced flush on hide/close (§E2). appStateChange (Capacitor) lands with G13.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') store.flush();
      // V3/FIX-A (P0-2): the visible tab is the single writer — resync/unlatch.
      else if (document.visibilityState === 'visible') onBecameVisible();
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => store.flush());
    // V3/FIX-A (P0-2): follow foreign same-origin writes (fires per changed
    // key; the handler is idempotent and key-agnostic on purpose — it just
    // asks save.js whether storage is ahead of this tab).
    window.addEventListener('storage', onForeignWrite);
  }

  singleton = store;
  return store;
}

/** @returns {ReturnType<typeof createStore>} the store singleton (after createStore) */
export function getStore() {
  if (!singleton) throw new Error('store not created yet — call createStore(state) in boot');
  return singleton;
}
