// State store (§E2): wraps the save-schema state (§E3). get/set/update/on with
// per-frame coalesced 'change' events plus specific events, debounced autosave
// (1 s trailing) and forced flush on visibilitychange/pagehide. Pure module:
// no three.js/DOM imports (window/document usage is guarded for node:test).

import { ENGINE } from '../data/constants.js';
import { persist } from './save.js';
// V2/G20: weight tier mapping for the §B5 'weightChanged' granularity rule
// (emit only when the integer value or the tier changes). Pure import.
import { tierOf } from '../systems/weight.js';

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
