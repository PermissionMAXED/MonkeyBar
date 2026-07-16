// Persistence adapter + save schema v1 (§E3). localStorage on web, mirrored to
// Capacitor Preferences on native (G13; migrations extended by G6). Corrupt or
// forward-version saves are backed up to `gooby.save.corrupt` and replaced with
// a fresh state — load() never crashes. Pure module: no three.js/DOM imports
// (localStorage access is guarded so node:test can run it headlessly).

import { SAVE, ECONOMY } from '../data/constants.js';
import { now } from './clock.js';

// --- storage backend (swappable for tests / Capacitor Preferences later) ---

/** In-memory fallback when localStorage is unavailable (node tests). */
const memory = new Map();

const storage = {
  /** @param {string} key @returns {string|null} */
  getItem(key) {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    return memory.has(key) ? memory.get(key) : null;
  },
  /** @param {string} key @param {string} value */
  setItem(key, value) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    else memory.set(key, value);
  },
  /** @param {string} key */
  removeItem(key) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    else memory.delete(key);
  },
};

// --- G13: guarded Capacitor Preferences mirror (§E3/§F1) ---
// On native, WKWebView localStorage works but iOS may evict it under storage
// pressure, so every persist is mirrored to @capacitor/preferences (durable).
// Same dynamic-import guard pattern as core/notifications.js: the web build
// never hard-requires the plugin. If localStorage lost the save but the mirror
// still has it, restore + reload once (the already-booted fresh state must not
// clobber the recovered save — load() is synchronous and has already run).

/** @type {object|null} the Preferences plugin once resolved on native */
let prefs = null;

async function initPreferencesMirror() {
  const cap = globalThis.Capacitor;
  if (!cap?.isNativePlatform?.()) return;
  try {
    let plugin = cap.Plugins?.Preferences ?? null;
    if (!plugin) {
      // Non-literal specifier so Rollup/Vite never resolve it at build time.
      const specifier = '@capacitor/preferences';
      const mod = await import(/* @vite-ignore */ specifier);
      plugin = mod?.Preferences ?? null;
    }
    if (!plugin) return;
    if (storage.getItem(SAVE.KEY) == null) {
      const { value } = await plugin.get({ key: SAVE.KEY });
      if (value != null) {
        storage.setItem(SAVE.KEY, value);
        prefs = plugin;
        globalThis.location?.reload?.();
        return;
      }
    }
    prefs = plugin;
  } catch (err) {
    console.warn('[save] preferences mirror unavailable:', err?.message);
    prefs = null;
  }
}
initPreferencesMirror();
// --- end G13 ---

// --- schema ---

/**
 * Fresh save-state per schema v1 (§E3).
 * @returns {object}
 */
export function defaultState() {
  const ts = now();
  return {
    v: SAVE.VERSION,
    createdAt: ts,
    lastTickAt: ts,
    stats: { ...SAVE.DEFAULT_STATS },
    sleep: { sleeping: false, startedAt: 0, wakeAt: 0 },
    grumpyUntil: 0,
    coins: ECONOMY.STARTING_COINS,
    xp: 0,
    level: 1,
    inventory: { ...ECONOMY.STARTER_INVENTORY },
    furniture: { owned: [], placed: {} },
    decor: { wallpaper: {}, floor: {} },
    outfits: { owned: [], equipped: { hat: null, glasses: null, neck: null } },
    minigames: { best: {}, plays: {}, lastPlayDay: {} },
    achievements: {
      unlocked: {},
      counters: { feeds: 0, washes: 0, sleeps: 0, trips: 0, tickles: 0, petsToday: 0, petsDay: '' },
    },
    daily: { lastClaimDay: '', streak: 0 },
    quickDelivery: false,
    settings: { lang: 'auto', sfx: true, music: true, haptics: true, notifications: 'unasked' },
    onboarding: { done: false, step: 0 },
  };
}

/**
 * Migrations, applied in order while state.v < SAVE.VERSION.
 * Each entry migrates v = index → index + 1. G6 extends this list.
 * @type {Array<(state: object) => object>}
 */
export const migrations = [
  // v0 → v1: pre-versioned saves get defaults merged in.
  (state) => ({ ...state, v: 1 }),
];

/**
 * Deep-merge `src` over `defaults` (objects only — arrays/primitives replace).
 * Guarantees every schema key exists after load.
 * @param {object} defaults
 * @param {object} src
 * @returns {object}
 */
function mergeDefaults(defaults, src) {
  if (src == null || typeof src !== 'object' || Array.isArray(src)) return src ?? defaults;
  const out = { ...defaults };
  for (const [k, v] of Object.entries(src)) {
    if (
      v != null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] != null &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = mergeDefaults(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Validate/clamp a loaded state: numeric coercion + stat range clamps.
 * @param {object} state
 * @returns {object}
 */
function validate(state) {
  const s = mergeDefaults(defaultState(), state);
  for (const k of Object.keys(SAVE.DEFAULT_STATS)) {
    const v = Number(s.stats[k]);
    s.stats[k] = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : SAVE.DEFAULT_STATS[k];
  }
  s.coins = Math.max(0, Math.floor(Number(s.coins) || 0));
  s.xp = Math.max(0, Number(s.xp) || 0);
  s.level = Math.min(30, Math.max(1, Math.floor(Number(s.level) || 1)));
  return s;
}

/**
 * Load the save. Never throws: corrupt JSON and forward-version saves are
 * backed up under `gooby.save.corrupt` and replaced with a fresh state.
 * @returns {{state: object, fresh: boolean, recovered: boolean}}
 *   fresh: no prior save existed; recovered: prior save was corrupt/unreadable.
 */
export function load() {
  const raw = storage.getItem(SAVE.KEY);
  if (raw == null) {
    return { state: defaultState(), fresh: true, recovered: false };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('save is not an object');
    }
    if (Number(parsed.v) > SAVE.VERSION) {
      throw new Error(`forward version ${parsed.v} > ${SAVE.VERSION}`);
    }
  } catch (err) {
    console.warn('[save] corrupt save, starting fresh:', err?.message);
    try {
      storage.setItem(SAVE.CORRUPT_KEY, raw);
    } catch { /* backup is best-effort */ }
    return { state: defaultState(), fresh: false, recovered: true };
  }
  let state = parsed;
  let v = Number(state.v) || 0;
  while (v < SAVE.VERSION) {
    state = migrations[v](state);
    v = Number(state.v);
  }
  return { state: validate(state), fresh: false, recovered: false };
}

/**
 * Persist the state (synchronous; store debounces calls — §E2).
 * @param {object} state
 */
export function persist(state) {
  try {
    const json = JSON.stringify(state);
    storage.setItem(SAVE.KEY, json);
    // G13: mirror to Capacitor Preferences on native (fire-and-forget).
    prefs?.set({ key: SAVE.KEY, value: json })?.catch?.(() => {});
  } catch (err) {
    console.warn('[save] persist failed:', err?.message);
  }
}

/** Wipe the save (dev harness ?reset=1 — §E9). */
export function clear() {
  storage.removeItem(SAVE.KEY);
  // G13: clear the native Preferences mirror too.
  prefs?.remove({ key: SAVE.KEY })?.catch?.(() => {});
}
