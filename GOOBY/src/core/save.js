// Persistence adapter + save schema v1 (§E3). localStorage on web, mirrored to
// Capacitor Preferences on native (G13; migrations extended by G6). Corrupt or
// forward-version saves are backed up to `gooby.save.corrupt` and replaced with
// a fresh state — load() never crashes. Pure module: no three.js/DOM imports
// (localStorage access is guarded so node:test can run it headlessly).

import { SAVE, ECONOMY, LEVELING } from '../data/constants.js'; // V2/G16: + LEVELING (§B2.4)
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

// --- V2/G16: schema v2 slice factories (PLAN2 §B2, exact defaults) ---------
// Factories (not shared literals) so defaultState(), migrations[1] and
// validate() each get fresh, un-aliased objects.

/** One empty garden plot (§B2). @returns {object} */
function defaultPlot() {
  return { crop: null, plantedAt: 0, progressMin: 0, wateredUntil: 0, waterings: 0, fertilized: false };
}

/** The v2 top-level slices at their exact §B2 defaults. @returns {object} */
function v2SliceDefaults() {
  return {
    garden: {
      plotsOwned: 4, // plots 5/6 purchasable (§B6 gating)
      plots: Array.from({ length: 6 }, defaultPlot), // ALWAYS length 6
      lastTickAt: 0, // growth accrual bookkeeping (offline-aware)
    },
    health: { state: 'healthy', junkScore: 0, neglectMin: 0, recoverMin: 0, since: 0 },
    weight: { value: 50 }, // 5–95 clamp (§C4)
    quests: { day: '', active: [], rerolledDay: '', completedTotal: 0 },
    collections: { entries: {}, claimedSets: {} },
    skins: { owned: ['cream'], equipped: 'cream' },
    items: { medicine: 0, fertilizer: 0 }, // non-food consumables (NOT in `inventory`)
    profile: { playtimeMin: 0, coinsEarned: 0, coinsSpent: 0, distanceM: 0, photos: 0 },
  };
}

/** §B2 additions to achievements.counters (v1 keys unchanged). */
const V2_COUNTER_DEFAULTS = Object.freeze({
  harvests: 0, plantings: 0, waterings: 0, sells: 0, cures: 0, vetTrips: 0,
  deliveries: 0, questsDone: 0, photosTaken: 0, nightPlays: 0, medsGiven: 0, balls: 0,
});
// --- end V2/G16 slice factories ---

/**
 * Fresh save-state per schema v2 (§E3 + PLAN2 §B2).
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
      counters: {
        feeds: 0, washes: 0, sleeps: 0, trips: 0, tickles: 0, petsToday: 0, petsDay: '',
        ...V2_COUNTER_DEFAULTS, // V2/G16 (§B2)
      },
    },
    daily: { lastClaimDay: '', streak: 0 },
    quickDelivery: false,
    settings: { lang: 'auto', sfx: true, music: true, haptics: true, notifications: 'unasked' },
    // V2/G16: whatsNew2Seen true for FRESH saves — only migrated v1 veterans
    // get false and see the one-time "What's new" panel (§E0.1-6; G30 builds it).
    onboarding: { done: false, step: 0, whatsNew2Seen: true },
    ...v2SliceDefaults(), // V2/G16 (§B2)
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
  // V2/G16 — v1 → v2 (PLAN2 §B2, exact behavior):
  //  1. spread the new top-level slices ONLY when absent ({...defaults,
  //     ...state} ordering — v1 saves never contain them),
  //  2. never rewrite any existing key (every v1 field passes through
  //     verbatim; mergeDefaults in validate() fills nested gaps),
  //  3. set v = 2,
  //  plus the §B2 explicit slice extensions: the new achievements counters
  //  (defaults first — existing v1 counter values win) and
  //  onboarding.whatsNew2Seen = false so v1 veterans see the one-time
  //  "What's new" panel (§E0.1-6).
  //  NOTE (§B2 deviation, deliberate): furniture.placed does NOT gain a
  //  'garden' key — v1's placed map is FLAT ('roomId:slotId' → itemId, see
  //  systems/furniturePlacement.js §E3 header), so garden decor slots need no
  //  schema change ('garden:<slot>' keys just appear); an object-valued
  //  'garden' key would corrupt that invariant (placedNonDefaultCount etc.).
  (state) => {
    // Corruption guard: spreading a wrong-typed container (e.g. counters:
    // "many") would silently object-ify it and defeat the F2 recovery
    // contract — leave such payloads untouched so validate()'s mergeDefaults
    // still throws and load() backs up + recovers.
    const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
    const out = { ...v2SliceDefaults(), ...state, v: 2 };
    if (isObj(out.achievements) && (out.achievements.counters == null || isObj(out.achievements.counters))) {
      out.achievements = {
        ...out.achievements,
        counters: { ...V2_COUNTER_DEFAULTS, ...out.achievements.counters },
      };
    }
    if (out.onboarding == null || isObj(out.onboarding)) {
      out.onboarding = { ...out.onboarding, whatsNew2Seen: false };
    }
    return out;
  },
];

/**
 * Deep-merge `src` over `defaults`. Guarantees every schema key exists after
 * load. F2 (E12): structural type mismatches against the schema (a container
 * that should be an object/array arriving as a string/number, or a primitive
 * arriving as an object — e.g. `stats: "nope"`, `coins: {}`) THROW so load()
 * treats the payload as corrupt and recovers (backup + fresh state) instead
 * of booting into a state that crashes later. `null` never clobbers a
 * structured default; primitive leaves keep the lenient Number() coercion in
 * validate().
 * @param {object} defaults
 * @param {object} src
 * @param {string} [path] error-message breadcrumb
 * @returns {object}
 */
function mergeDefaults(defaults, src, path = 'save') {
  const out = { ...defaults };
  for (const [k, v] of Object.entries(src)) {
    const d = defaults[k];
    const here = `${path}.${k}`;
    if (d != null && typeof d === 'object' && !Array.isArray(d)) {
      if (v == null) continue; // structured defaults survive null/undefined
      if (typeof v !== 'object' || Array.isArray(v)) {
        throw new TypeError(`${here} must be an object, got ${Array.isArray(v) ? 'array' : typeof v}`);
      }
      out[k] = mergeDefaults(d, v, here);
    } else if (Array.isArray(d)) {
      if (v == null) continue;
      if (!Array.isArray(v)) {
        throw new TypeError(`${here} must be an array, got ${typeof v}`);
      }
      out[k] = v;
    } else {
      // Primitive/null defaults and unknown keys. A non-null object where the
      // schema expects a primitive is structural corruption; everything else
      // passes through (validate() clamps/coerces the numeric leaves).
      if (d != null && typeof d !== 'object' && v != null && typeof v === 'object') {
        throw new TypeError(`${here} must be a ${typeof d}, got ${Array.isArray(v) ? 'array' : 'object'}`);
      }
      out[k] = v;
    }
  }
  return out;
}

/**
 * Validate/clamp a loaded state: numeric coercion + stat range clamps.
 * V2/G16 (§B2.4): level clamps to LEVELING.MAX_LEVEL (40); weight clamps to
 * [5, 95]; garden.plots is normalized to exactly 6 entries; health.state is
 * coerced to 'healthy' when not one of the 3 valid strings.
 * V2/FIX-A (E9/E20 hardening):
 *   - sleep leaves are normalized (sleeping → strict boolean; startedAt/
 *     wakeAt → finite ms or the whole slice resets to not-sleeping) so a
 *     wrong-typed slice can never feed NaN into offline.js/applyTick;
 *   - quests.active is normalized to an array of well-formed rows (non-object
 *     rows and non-string ids dropped; progress → finite number ≥ 0;
 *     claimed → strict boolean; `seen` kept only as a string[]) so
 *     quests.track/the quest board never meet malformed rows;
 *   - the inventory map is taken VERBATIM when the save has one (consumed-to-
 *     zero foods used to resurrect because mergeDefaults re-added missing
 *     STARTER_INVENTORY keys); a MISSING/null inventory slice still gets the
 *     defaults, and wrong-typed slices still throw in mergeDefaults (F2).
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
  s.level = Math.min(LEVELING.MAX_LEVEL, Math.max(1, Math.floor(Number(s.level) || 1)));
  // --- V2/FIX-A: sleep-slice normalization (E9 — NaN-poisoned offline sim) ---
  {
    const startedAt = Number(s.sleep.startedAt);
    const wakeAt = Number(s.sleep.wakeAt);
    if (!Number.isFinite(startedAt) || !Number.isFinite(wakeAt)) {
      s.sleep = { sleeping: false, startedAt: 0, wakeAt: 0 };
    } else {
      s.sleep = { ...s.sleep, sleeping: s.sleep.sleeping === true, startedAt, wakeAt };
    }
  }
  // --- V2/FIX-A: quests.active row sanitization (E9 — quest-board crash) ---
  s.quests.active = (Array.isArray(s.quests.active) ? s.quests.active : [])
    .filter((row) => row != null && typeof row === 'object' && !Array.isArray(row)
      && typeof row.id === 'string' && row.id !== '')
    .map((row) => {
      const progress = Number(row.progress);
      const entry = {
        ...row,
        progress: Number.isFinite(progress) ? Math.max(0, progress) : 0,
        // truthiness-coerced ON PURPOSE (unlike sleep.sleeping): a junk-typed
        // `claimed` must never re-open a paid quest for a second claim.
        claimed: Boolean(row.claimed),
      };
      if ('seen' in entry && !Array.isArray(entry.seen)) delete entry.seen;
      else if (Array.isArray(entry.seen)) entry.seen = entry.seen.map(String);
      return entry;
    });
  // --- V2/FIX-A: consumed inventory stays consumed (E20 resurrection) ---
  if (state.inventory != null && typeof state.inventory === 'object' && !Array.isArray(state.inventory)) {
    s.inventory = { ...state.inventory };
  }
  // --- V2/G16: v2 slice validation (§B2.4) ---
  const w = Number(s.weight.value);
  s.weight.value = Number.isFinite(w) ? Math.min(95, Math.max(5, w)) : 50;
  if (!['healthy', 'queasy', 'sick'].includes(s.health.state)) s.health.state = 'healthy';
  const plots = Array.isArray(s.garden.plots) ? s.garden.plots : [];
  s.garden.plots = Array.from({ length: 6 }, (_, i) =>
    plots[i] != null && typeof plots[i] === 'object' && !Array.isArray(plots[i])
      ? { ...defaultPlot(), ...plots[i] }
      : defaultPlot()
  );
  // --- end V2/G16 ---
  return s;
}

/**
 * Load the save. Never throws: the ENTIRE parse → version-check → migrate →
 * validate pipeline is exception-safe (F2/E12 — previously the migration loop
 * and validate() ran outside the try, so valid-JSON-wrong-types payloads like
 * `{"v":1,"stats":"nope"}` threw on every boot and permanently bricked the
 * game). On any failure the raw payload is backed up under
 * `gooby.save.corrupt` and a fresh state is returned (main.js surfaces the
 * 'boot.saveCorrupt' recovery toast via `recovered`).
 * @returns {{state: object, fresh: boolean, recovered: boolean}}
 *   fresh: no prior save existed; recovered: prior save was corrupt/unreadable.
 */
export function load() {
  const raw = storage.getItem(SAVE.KEY);
  if (raw == null) {
    return { state: defaultState(), fresh: true, recovered: false };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('save is not an object');
    }
    // Version sanity (F2): a missing v counts as v0 (pre-versioned save); an
    // absurd PRESENT v (negative, fractional, non-numeric junk) is corruption
    // — never index migrations[] with it or loop on it.
    let v = 0;
    if (parsed.v !== undefined) {
      v = Number(parsed.v);
      if (!Number.isInteger(v) || v < 0) {
        throw new Error(`absurd save version ${JSON.stringify(parsed.v)}`);
      }
      if (v > SAVE.VERSION) {
        throw new Error(`forward version ${parsed.v} > ${SAVE.VERSION}`);
      }
    }
    let state = parsed;
    while (v < SAVE.VERSION) {
      state = migrations[v](state);
      const next = Number(state?.v);
      // Guard against a stuck chain: every migration must advance v.
      if (!Number.isInteger(next) || next <= v) {
        throw new Error(`migration from v${v} did not advance (got ${state?.v})`);
      }
      v = next;
    }
    return { state: validate(state), fresh: false, recovered: false };
  } catch (err) {
    console.warn('[save] corrupt save, starting fresh:', err?.message);
    try {
      storage.setItem(SAVE.CORRUPT_KEY, raw);
    } catch { /* backup is best-effort */ }
    return { state: defaultState(), fresh: false, recovered: true };
  }
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
