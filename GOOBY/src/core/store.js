// State store (§E2): wraps the save-schema state (§E3). get/set/update/on with
// per-frame coalesced 'change' events plus specific events, debounced autosave
// (1 s trailing) and forced flush on visibilitychange/pagehide. Pure module:
// no three.js/DOM imports (window/document usage is guarded for node:test).

import { ENGINE } from '../data/constants.js';
import { persist } from './save.js';

/**
 * Specific store events (§E2). 'change' fires (coalesced) on any mutation.
 * 'levelUp' payload: { level }. 'achievementUnlocked' payload: id (string).
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
    };
  }

  function emit(event, payload) {
    for (const cb of listeners.get(event) ?? []) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[store] listener error for '${event}':`, err);
      }
    }
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
    snapshot = next;
    emit('change', state);
  }

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
        persist(state);
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

    /** Force pending events + save to flush immediately (pagehide etc.). */
    flush() {
      if (flushScheduled) flushEvents();
      if (saveTimer != null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (autosave) persist(state);
    },
  };

  // Forced flush on hide/close (§E2). appStateChange (Capacitor) lands with G13.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') store.flush();
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => store.flush());
  }

  singleton = store;
  return store;
}

/** @returns {ReturnType<typeof createStore>} the store singleton (after createStore) */
export function getStore() {
  if (!singleton) throw new Error('store not created yet — call createStore(state) in boot');
  return singleton;
}
