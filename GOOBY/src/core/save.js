// Persistence adapter + save schema v1 (§E3). localStorage on web, mirrored to
// Capacitor Preferences on native (G13; migrations extended by G6). Corrupt or
// forward-version saves are backed up to `gooby.save.corrupt` and replaced with
// a fresh state — load() never crashes. Pure module: no three.js/DOM imports
// (localStorage access is guarded so node:test can run it headlessly).

import { SAVE, ECONOMY, LEVELING } from '../data/constants.js'; // V2/G16: + LEVELING (§B2.4)
import { now } from './clock.js';
// V4/G53 (§B1 step 5): pure catalog lookups for validate()'s v4 clamps —
// radio.station against the frozen §C-SYS1.2 station ids, modifiers.current
// against known game ids. Both modules are pure data (no DOM/three).
import { STATION_IDS } from '../systems/musicRegistry.js';
import { MINIGAMES_BY_ID } from '../data/minigames.js';

// --- storage backend (swappable for tests / Capacitor Preferences later) ---

// V3/FIX-A (E20 P0-1): every localStorage touch is exception-safe. Browsers
// can make ANY access throw (Safari-private-style SecurityError on the
// window.localStorage getter itself, enterprise policies overriding
// Storage.prototype, disabled cookies) — previously load()'s first getItem
// threw before the parse/migrate try-block and bricked boot to a blank page.
// Now every op falls back to the in-memory session store: the game always
// boots and plays, progress simply doesn't survive the tab when real storage
// is unusable. Reads prefer REAL storage when it works (so a transient write
// failure — e.g. quota — never hides newer on-disk data); the memory map only
// answers when real storage is unreadable or a write fell back to it.

/** In-memory fallback when localStorage is unavailable (node tests, P0-1). */
const memory = new Map();

/** Warn once per session when real storage proves unusable. */
let storageWarned = false;

/** @param {unknown} err */
function warnStorageUnavailable(err) {
  if (storageWarned) return;
  storageWarned = true;
  console.warn(
    '[save] localStorage unavailable, using in-memory session store:',
    /** @type {{message?: string}} */ (err)?.message ?? err
  );
}

const storage = {
  /** @param {string} key @returns {string|null} */
  getItem(key) {
    try {
      if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
    } catch (err) {
      warnStorageUnavailable(err);
    }
    return memory.has(key) ? memory.get(key) : null;
  },
  /**
   * @param {string} key @param {string} value
   * @returns {boolean} true when the REAL backend took the write (false =
   *   in-memory fallback only — persist() uses this to keep the multi-tab
   *   write-generation in lock-step with what other tabs can actually see).
   */
  setItem(key, value) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        memory.delete(key); // drop a stale shadow from an earlier failed write
        return true;
      }
    } catch (err) {
      warnStorageUnavailable(err);
    }
    memory.set(key, value);
    return false;
  },
  /** @param {string} key */
  removeItem(key) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
    } catch (err) {
      warnStorageUnavailable(err);
    }
    memory.delete(key);
  },
};

// --- V3/FIX-A (E20 P0-2): multi-tab write-generation guard -------------------
// Whole-state last-writer-wins persistence let a STALE second tab clobber
// fields another tab had just saved (repro: tab A saves coins 211, stale tab
// B flushes a uiScale change and rewrites coins 100). Design (least invasive
// correct option per the E20 finding):
//   - Every successful persist bumps a monotonic write counter stored under
//     its own key (SAVE.KEY + '.gen'). It lives OUTSIDE the save payload on
//     purpose: the payload bytes stay exactly what they were (byte-stable
//     persist→load→persist roundtrips and the §E3 schema are untouched).
//   - persist() first compares the stored counter against the generation this
//     tab last loaded/wrote (`knownGen`). If storage holds a NEWER write from
//     another tab, the write is SKIPPED (returns false) — a stale tab can
//     never blind-overwrite newer data. core/store.js turns that refusal into
//     a sticky "stale tab" state with a one-time notice.
//   - core/store.js also listens to the window 'storage' event and ADOPTS the
//     newer save while this tab is idle (document hidden), via load() +
//     hasNewerSave() below; the visible tab is always the single writer.
// Old builds that never bump the counter keep working: a missing/junk counter
// reads as 0, so their tabs simply behave like before (last write wins).

/** Storage key of the monotonic write counter (payload stays byte-stable). */
const GEN_KEY = `${SAVE.KEY}.gen`;

/** Write generation this tab last loaded or successfully wrote. */
let knownGen = 0;

/** @returns {number} the stored write counter (missing/junk → 0) */
function readGen() {
  const n = Number(storage.getItem(GEN_KEY));
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * True when another tab persisted a newer save than this tab has seen —
 * store.js polls this from its 'storage'-event/visibility handlers.
 * @returns {boolean}
 */
export function hasNewerSave() {
  return readGen() > knownGen;
}
// --- end V3/FIX-A P0-2 guard ---

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

// --- V3/G34: schema v3 slice factories (PLAN3 §B1, exact defaults) ---------

/** The v3 top-level slices at their exact §B1 defaults. @returns {object} */
function v3SliceDefaults() {
  return {
    stickers: { unlocked: {}, seen: {} }, // id → unlock epoch-ms / id → true (§C5)
    nougat: { lastGlobAt: 0, installed: false }, // §C6 Nougatschleuse
  };
}

/** §B1 v3 additions to settings (v1/v2 keys unchanged). @returns {object} */
function v3SettingsDefaults() {
  return {
    uiScale: 100, // 85|100|115|130 (§C1)
    volumes: { master: 80, sfx: 100, music: 70, voice: 100, ambience: 80 }, // 0–100 ints (§C2)
    devUnlocked: false, // §C4 gate — persisted
  };
}

/** §B1 additions to achievements.counters (v1/v2 keys unchanged). */
const V3_COUNTER_DEFAULTS = Object.freeze({
  nougatGlobs: 0, cakesServed: 0, perfectCakes: 0, surfRuns: 0, surfDistanceM: 0,
  races: 0, ghostsCaught: 0, rescues: 0, cratesShipped: 0,
});

/** Legal §C1 uiScale stops; validate() coerces anything else to 100. */
const UI_SCALE_STOPS = Object.freeze([85, 100, 115, 130]);
// --- end V3/G34 slice factories ---

// --- V4/G53: schema v4 slice factories (PLAN4 §B1, exact defaults) ---------

/** The v4 top-level slices at their exact §B1 defaults. @returns {object} */
function v4SliceDefaults() {
  return {
    radio: {
      station: 'bordmusik', // §C-SYS1.4 station id; validate() coerces unknown → 'bordmusik'
      playing: false, // radio ON/OFF — persists; resumes after the first gesture on boot
      shuffle: true, // shuffled station order vs. manifest order
      replaceContext: true, // radio replaces medley context music everywhere
      lastTrack: '', // resume point ('' = station start)
      trims: {}, // trackId → { vol: 100, on: true } — ONLY non-default entries (open map)
    },
    codes: {
      redeemed: {}, // codeId → epoch-ms
      lockUntil: 0, // §C-SYS5.3 rate-limit lockout end (epoch-ms)
      buffs: { doubleCoinsUntil: 0 }, // 'UpdateLiebe' expiry (epoch-ms; 0 = inactive)
    },
    modifiers: {
      nextAt: 0, // epoch-ms of the next event; 0 = unscheduled
      seed: 0, // mulberry32 stream position; 0 = derive from createdAt (validate() fills)
      current: null, // null | { gameId, type, startedAt, endsAt, playsLeft }
      lastGameId: '', // no-repeat guard for the next roll
      dayCoins: 0, dayCoinsDay: '', // §C-SYS11 daily modifier-surplus ledger
    },
    recap: {
      lastRecapLevel: 0, // highest milestone already recapped (migration initializes)
      baseline: {}, // §C-SYS2.4 counter snapshot at last recap
      baselineAt: 0, // epoch-ms of the snapshot
      pendingLevel: 0, // queued-but-not-yet-played milestone (0 = none)
      history: [], // last ≤ 8 of { level, at, stats } (§C-SYS2.8)
    },
    gallery: { count: 0, lastAddedAt: 0, hintShown: false }, // meta only (§B7: blobs in IndexedDB)
  };
}

/** §B1/§G3.3/§G6.6 v4 additions to settings (v1–v3 keys unchanged). @returns {object} */
function v4SettingsDefaults() {
  return {
    gyro: false, // §C-SYS8 — strict-boolean validated like devUnlocked
    controls: { invertX: false, invertY: false }, // §G3.3 global invert toggles
    goobyWeltQuality: 'high', // §G6.6 'high' (Schön) | 'low' (Flüssig)
  };
}

/** §G5.5 v4 additions to minigames (best/plays/lastPlayDay unchanged). @returns {object} */
function v4MinigameDefaults() {
  return {
    difficulty: {}, // gameId → 'easy'|'normal'|'hard' (last-selected)
    beaten: {}, // gameId → { easy?, normal?, hard? } cleared markers
    bestByDiff: {}, // gameId → { easy?, hard? } (Mittel stays in `best`)
    endlessBest: {}, // gameId → n (local endless highscore)
  };
}

/** §B1 v4 additions to achievements.counters (v1–v3 keys unchanged). */
const V4_COUNTER_DEFAULTS = Object.freeze({
  codesRedeemed: 0, modifierPlays: 0, recapsSeen: 0, radioMinutes: 0, galleryPhotos: 0,
});

/** §C-SYS4.2 modifier type ids (validate() checks modifiers.current.type). */
const MODIFIER_TYPES = Object.freeze([
  'doppelGold', 'muenzregen', 'turbo', 'riesenGooby', 'stickerChance', 'glueckspilz',
]);

/**
 * §B1: modifiers.seed 0 = "derive from createdAt". One shared formula so
 * defaultState() (fresh saves) and validate() (migrated/hostile saves) fill
 * the identical, per-save-stable mulberry32 stream position.
 * @param {number} createdAt
 * @returns {number} uint32 seed (0 only for junk createdAt)
 */
function deriveModifierSeed(createdAt) {
  return Math.floor(Number(createdAt) || 0) % 4294967296;
}

/** §B1 #5: timestamp fields collapse when > now() + 24 h (hostile far-future). */
const FUTURE_STAMP_SLACK_MS = 24 * 3600000;

/**
 * §C-SYS2.4 baseline snapshot for migrations[3] (§B1 #3). Prefers G55's
 * recapEngine implementation when it has resolved (lazy dynamic import per
 * §E0.1-11 — migrations run synchronously, so the inline fallback below
 * mirrors the §C-SYS2.4 shape EXACTLY and both produce identical output).
 * @type {((state: object, nowMs?: number) => object)|null}
 */
let recapSnapshotFn = null;
{
  // Non-literal specifier so Rollup/Vite never hard-require G55's same-wave
  // module at build time (the guarded-import pattern from the G13 mirror).
  const specifier = new URL('../systems/recap.js', import.meta.url).href;
  import(/* @vite-ignore */ specifier).then(
    (mod) => { recapSnapshotFn = typeof mod?.snapshot === 'function' ? mod.snapshot : null; },
    () => { recapSnapshotFn = null; }
  );
}

/** §C-SYS2.4 counter keys copied verbatim (petsToday excluded — daily). */
const SNAPSHOT_COUNTERS = Object.freeze([
  'feeds', 'washes', 'sleeps', 'tickles', 'trips', 'harvests', 'plantings',
  'waterings', 'questsDone', 'deliveries', 'cures', 'nougatGlobs',
  'cakesServed', 'surfRuns',
]);

/**
 * Inline §C-SYS2.4 snapshot fallback (mirrors systems/recap.js `snapshot`):
 * snapshotAtMs, level, coinsEarned/coinsSpent/distanceM/photos (profile),
 * playsTotal (Σ minigames.plays), the listed counters verbatim, stickerCount.
 * Missing/corrupt inputs snapshot as 0 (the diff side clamps ≥ 0 too).
 * @param {object} state @param {number} nowMs
 * @returns {object}
 */
function recapBaselineSnapshot(state, nowMs) {
  if (recapSnapshotFn) return recapSnapshotFn(state, nowMs);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const s = state ?? {};
  const profile = s.profile ?? {};
  const counters = s.achievements?.counters ?? {};
  const plays = s.minigames?.plays;
  let playsTotal = 0;
  if (plays != null && typeof plays === 'object' && !Array.isArray(plays)) {
    for (const v of Object.values(plays)) playsTotal += num(v);
  }
  const unlocked = s.stickers?.unlocked;
  const stickerCount =
    unlocked != null && typeof unlocked === 'object' && !Array.isArray(unlocked)
      ? Object.keys(unlocked).length
      : 0;
  const out = {
    snapshotAtMs: num(nowMs),
    level: Math.max(1, Math.floor(num(s.level)) || 1),
    coinsEarned: num(profile.coinsEarned),
    coinsSpent: num(profile.coinsSpent),
    distanceM: num(profile.distanceM),
    photos: num(profile.photos),
    playsTotal,
    stickerCount,
  };
  for (const k of SNAPSHOT_COUNTERS) out[k] = num(counters[k]);
  return out;
}
// --- end V4/G53 slice factories ---

/**
 * Fresh save-state per schema v4 (§E3 + PLAN2 §B2 + PLAN3 §B1 + PLAN4 §B1).
 * @returns {object}
 */
export function defaultState() {
  const ts = now();
  const state = {
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
    // V4/G53 (§B1/§E0.1-15): fresh saves get the free radio gift owned AND
    // placed on the living-room shelf (migrated saves get it in migrations[3]).
    furniture: { owned: ['radio'], placed: { 'living:shelf1': 'radio' } },
    decor: { wallpaper: {}, floor: {} },
    // V3/G34: 4th equip slot 'back' (§B1/§C13 — G40 ships the items, wave 2)
    outfits: { owned: [], equipped: { hat: null, glasses: null, neck: null, back: null } },
    minigames: {
      best: {}, plays: {}, lastPlayDay: {},
      ...v4MinigameDefaults(), // V4/G53 (§G5.5: difficulty/beaten/bestByDiff/endlessBest)
    },
    achievements: {
      unlocked: {},
      counters: {
        feeds: 0, washes: 0, sleeps: 0, trips: 0, tickles: 0, petsToday: 0, petsDay: '',
        ...V2_COUNTER_DEFAULTS, // V2/G16 (§B2)
        ...V3_COUNTER_DEFAULTS, // V3/G34 (§B1)
        ...V4_COUNTER_DEFAULTS, // V4/G53 (§B1)
      },
    },
    daily: { lastClaimDay: '', streak: 0 },
    quickDelivery: false,
    settings: {
      lang: 'auto', sfx: true, music: true, haptics: true, notifications: 'unasked',
      ...v3SettingsDefaults(), // V3/G34 (§B1: uiScale/volumes/devUnlocked)
      ...v4SettingsDefaults(), // V4/G53 (§B1/§G3.3/§G6.6: gyro/controls/goobyWeltQuality)
    },
    // V2/G16: whatsNew2Seen true for FRESH saves — only migrated v1 veterans
    // get false and see the one-time "What's new" panel (§E0.1-6; G30 builds it).
    // V3/G34: whatsNew3Seen mirrors the rule for 3.0 (§E0.1-8; G48 builds it).
    // V4/G53: whatsNew4Seen mirrors the rule for 4.0 (§B1; G82 builds it).
    onboarding: { done: false, step: 0, whatsNew2Seen: true, whatsNew3Seen: true, whatsNew4Seen: true },
    ...v2SliceDefaults(), // V2/G16 (§B2)
    ...v3SliceDefaults(), // V3/G34 (§B1)
    ...v4SliceDefaults(), // V4/G53 (§B1)
  };
  // V4/G53: fresh saves derive the modifier seed immediately (§B1 — validate()
  // fills the SAME value for migrated saves), so an untouched defaultState()
  // roundtrips persist → load with full deep equality.
  state.modifiers.seed = deriveModifierSeed(ts);
  return state;
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
  // V3/G34 — v2 → v3 (PLAN3 §B1 steps 1–5, exact behavior):
  //  1. spread the new top-level slices (stickers/nougat) ONLY when absent,
  //  2. settings gains uiScale/volumes/devUnlocked defaults-first — existing
  //     keys (sfx/music/haptics/lang/notifications) pass through verbatim;
  //     a v2 save with music:false boots muted with the slider at its
  //     default 70 (muting stays honest, nothing is lost — §B1 step 2),
  //  3. outfits.equipped.back = null when the key is absent (§C13 4th slot),
  //  4. achievements.counters merged defaults-first (existing values win),
  //  5. never rewrite any existing key; validate() (not this migration)
  //     clamps uiScale/volumes to their legal ranges (§B1 step 5),
  //  plus onboarding.whatsNew3Seen = false so v1/v2 veterans see the
  //  one-time "What's new in 3.0" panel (§E0.1-8; fresh saves default true).
  //  Same corruption-guard style as migrations[1]: wrong-typed containers
  //  are left untouched so validate()'s mergeDefaults throws → F2 recovery.
  (state) => {
    const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
    const out = { ...v3SliceDefaults(), ...state, v: 3 };
    if (out.settings == null || isObj(out.settings)) {
      out.settings = { ...v3SettingsDefaults(), ...out.settings };
    }
    if (isObj(out.outfits) && (out.outfits.equipped == null || isObj(out.outfits.equipped))) {
      const equipped = { ...out.outfits.equipped };
      if (!('back' in equipped)) equipped.back = null;
      out.outfits = { ...out.outfits, equipped };
    }
    if (isObj(out.achievements) && (out.achievements.counters == null || isObj(out.achievements.counters))) {
      out.achievements = {
        ...out.achievements,
        counters: { ...V3_COUNTER_DEFAULTS, ...out.achievements.counters },
      };
    }
    if (out.onboarding == null || isObj(out.onboarding)) {
      out.onboarding = { ...out.onboarding, whatsNew3Seen: false };
    }
    return out;
  },
  // V4/G53 — v3 → v4 (PLAN4 §B1 #1–5, exact behavior):
  //  1. spread the new top-level slices (radio/codes/modifiers/recap/gallery)
  //     ONLY when absent ({...defaults, ...state} ordering); wrong-typed
  //     containers are left for validate()/F2 recovery,
  //  2. settings gains gyro/controls/goobyWeltQuality defaults-first — every
  //     v1–v3 settings key passes through verbatim (§B1 step 2 + §G3.3/§G6.6
  //     per §E0.1-14); minigames gains the §G5.5 difficulty/beaten/bestByDiff/
  //     endlessBest containers the same way,
  //  3. recap retro-safety (§B1 #3, binding): lastRecapLevel = ⌊level/5⌋·5
  //     (an L23 save → 20; L4 → 0) and baseline = the §C-SYS2.4 snapshot taken
  //     FROM THE MIGRATING STATE, baselineAt = now() — no instant recap spam;
  //     the first post-update recap counts only what happened since the update,
  //  4. counters merged defaults-first (guarded); the radio furniture grant
  //     (§C-SYS1.4/§E0.1-15): push 'radio' into furniture.owned when absent,
  //     set furniture.placed['living:shelf1'] = 'radio' ONLY when that slot
  //     key is absent (never overwrite a player's placement);
  //     whatsNew4Seen = false so v1–v3 veterans see the one-time 4.0 panel,
  //  5. never rewrite any existing key; validate() (not this migration)
  //     clamps the v4 leaves (§B1 #5 — station ids, trims, the ≤ now + 24 h
  //     timestamp collapses, modifiers.current shape, history cap, gallery).
  //  Same corruption-guard style as migrations[1]/[2]: wrong-typed containers
  //  are left untouched so validate()'s mergeDefaults throws → F2 recovery.
  (state) => {
    const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
    const out = { ...v4SliceDefaults(), ...state, v: 4 };
    if (out.settings == null || isObj(out.settings)) {
      out.settings = { ...v4SettingsDefaults(), ...out.settings };
    }
    if (isObj(out.minigames)) {
      out.minigames = { ...v4MinigameDefaults(), ...out.minigames };
    }
    // §B1 #3: initialize recap ONLY when the slice came from the defaults
    // spread (a v3 save never carries one; a forward-written object is an
    // existing key and is never rewritten).
    if (isObj(out.recap) && !isObj(state?.recap)) {
      const ts = now();
      const level = Math.floor(Number(out.level) || 1);
      out.recap = {
        ...out.recap,
        lastRecapLevel: Math.floor(Math.min(40, Math.max(0, level)) / 5) * 5,
        baseline: recapBaselineSnapshot(out, ts),
        baselineAt: ts,
      };
    }
    if (isObj(out.achievements) && (out.achievements.counters == null || isObj(out.achievements.counters))) {
      out.achievements = {
        ...out.achievements,
        counters: { ...V4_COUNTER_DEFAULTS, ...out.achievements.counters },
      };
    }
    if (isObj(out.furniture)) {
      const furniture = { ...out.furniture };
      if (Array.isArray(furniture.owned) && !furniture.owned.includes('radio')) {
        furniture.owned = [...furniture.owned, 'radio'];
      }
      if (isObj(furniture.placed) && !('living:shelf1' in furniture.placed)) {
        furniture.placed = { ...furniture.placed, 'living:shelf1': 'radio' };
      }
      out.furniture = furniture;
    }
    if (out.onboarding == null || isObj(out.onboarding)) {
      out.onboarding = { ...out.onboarding, whatsNew4Seen: false };
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
  // --- V3/G34: v3 slice validation (§B1 step 5) ---
  // uiScale: one of the 4 legal §C1 stops, anything else → 100.
  if (!UI_SCALE_STOPS.includes(s.settings.uiScale)) s.settings.uiScale = 100;
  // volumes: integer 0–100 per bus; anything that isn't a finite NUMBER
  // (strings/booleans/null — incl. JSON's NaN→null round-trip) → that bus's
  // default, per §B1 step 5 "int 0–100 else default". A lenient Number()
  // here would silently turn null into volume 0 and mute a bus forever.
  // (mergeDefaults already guarantees the container + all 5 keys exist and
  //  throws on wrong-typed containers — F2 recovery contract.)
  {
    const volDefaults = v3SettingsDefaults().volumes;
    for (const [bus, def] of Object.entries(volDefaults)) {
      const v = s.settings.volumes[bus];
      s.settings.volumes[bus] = typeof v === 'number' && Number.isFinite(v)
        ? Math.min(100, Math.max(0, Math.round(v)))
        : def;
    }
  }
  // devUnlocked: strict boolean — junk-typed truthy values never open the gate.
  s.settings.devUnlocked = s.settings.devUnlocked === true;
  // nougat: finite non-negative cooldown timestamp; installed strict boolean.
  // V3/FIX-A (E2 P2-1): additionally clamped to now() — a far-future
  // lastGlobAt (hostile 9e15) used to survive validate() and soft-lock the
  // Nougatschleuse behind a ~285k-year cooldown. A glob can never legitimately
  // have happened in the future, so future stamps collapse to "just globbed"
  // (worst case: one full 30-min cooldown from load).
  {
    const at = Number(s.nougat.lastGlobAt);
    s.nougat.lastGlobAt = Number.isFinite(at) && at > 0 ? Math.min(at, now()) : 0;
    s.nougat.installed = s.nougat.installed === true;
  }
  // outfits.equipped.back exists via mergeDefaults (defaultState carries it).
  // stickers.unlocked/seen are open id-maps: wrong-typed CONTAINERS throw in
  // mergeDefaults (F2); entries pass through verbatim (engine reads guarded).
  // --- end V3/G34 ---
  // --- V4/G53: v4 slice validation (PLAN4 §B1 #5) ---
  {
    /** finite ms ≥ 0, collapsed to ≤ now() + 24 h (§B1 #5: hostile far-future
     * stamps — an over-future doubleCoinsUntil would grant a permanent ×2). */
    const clampStamp = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.min(n, now() + FUTURE_STAMP_SLACK_MS);
    };
    // furniture.placed is taken VERBATIM when the save has one (same rule
    // class as the V2/FIX-A inventory fix: defaultState now carries the
    // radio gift at living:shelf1, and mergeDefaults would resurrect a
    // removed placement on every load). Missing/null slices keep defaults;
    // wrong-typed containers still throw in mergeDefaults (F2).
    if (state.furniture != null && typeof state.furniture === 'object' && !Array.isArray(state.furniture)
        && state.furniture.placed != null && typeof state.furniture.placed === 'object'
        && !Array.isArray(state.furniture.placed)) {
      s.furniture.placed = { ...state.furniture.placed };
    }
    // settings: gyro/invert toggles strict booleans; quality one of 2 stops.
    s.settings.gyro = s.settings.gyro === true;
    s.settings.controls.invertX = s.settings.controls.invertX === true;
    s.settings.controls.invertY = s.settings.controls.invertY === true;
    if (s.settings.goobyWeltQuality !== 'high' && s.settings.goobyWeltQuality !== 'low') {
      s.settings.goobyWeltQuality = 'high';
    }
    // radio: station must be a known §C-SYS1.2 id (else 'bordmusik');
    // booleans keep their defaults when junk-typed; trims entries normalize
    // to { vol: int 0–150 (else 100), on: boolean (junk → true) } — non-object
    // entries are dropped (trims only stores non-default rows anyway).
    if (!STATION_IDS.includes(s.radio.station)) s.radio.station = 'bordmusik';
    s.radio.playing = s.radio.playing === true;
    s.radio.shuffle = typeof s.radio.shuffle === 'boolean' ? s.radio.shuffle : true;
    s.radio.replaceContext = typeof s.radio.replaceContext === 'boolean' ? s.radio.replaceContext : true;
    if (typeof s.radio.lastTrack !== 'string') s.radio.lastTrack = '';
    {
      const trims = {};
      for (const [id, row] of Object.entries(s.radio.trims ?? {})) {
        if (row == null || typeof row !== 'object' || Array.isArray(row)) continue;
        const vol = Number(row.vol);
        trims[id] = {
          ...row,
          vol: Number.isFinite(vol) ? Math.min(150, Math.max(0, Math.round(vol))) : 100,
          on: row.on === false ? false : true,
        };
      }
      s.radio.trims = trims;
    }
    // codes: lockUntil/doubleCoinsUntil are §B1 #5 clamped stamps; redeemed
    // entries normalize to a TRUTHY finite epoch-ms (junk collapses to 1, not
    // 0 — the id must stay redeemed so single-use holds).
    s.codes.lockUntil = clampStamp(s.codes.lockUntil);
    s.codes.buffs.doubleCoinsUntil = clampStamp(s.codes.buffs.doubleCoinsUntil);
    for (const [id, at] of Object.entries(s.codes.redeemed ?? {})) {
      const n = Number(at);
      s.codes.redeemed[id] = Number.isFinite(n) && n > 0 ? n : 1;
    }
    // modifiers: nextAt clamped stamp; seed int ≥ 0 (0 → derived from
    // createdAt so G54's mulberry32 stream is stable per save); current →
    // null unless a well-formed row with a known gameId/type and a future
    // endsAt (§B1 #5); day ledger normalized.
    s.modifiers.nextAt = clampStamp(s.modifiers.nextAt);
    {
      const seed = Number(s.modifiers.seed);
      s.modifiers.seed = Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : 0;
      if (s.modifiers.seed === 0) {
        s.modifiers.seed = deriveModifierSeed(s.createdAt); // §B1: 0 = derive
      }
      const cur = s.modifiers.current;
      const wellFormed =
        cur != null && typeof cur === 'object' && !Array.isArray(cur) &&
        typeof cur.gameId === 'string' && MINIGAMES_BY_ID[cur.gameId] != null &&
        MODIFIER_TYPES.includes(cur.type) &&
        Number.isFinite(Number(cur.endsAt)) && Number(cur.endsAt) > now() &&
        Number.isFinite(Number(cur.startedAt)) && Number(cur.startedAt) >= 0 &&
        Number.isInteger(Number(cur.playsLeft)) && Number(cur.playsLeft) >= 0;
      if (!wellFormed) s.modifiers.current = null;
      if (typeof s.modifiers.lastGameId !== 'string') s.modifiers.lastGameId = '';
      const dayCoins = Number(s.modifiers.dayCoins);
      s.modifiers.dayCoins = Number.isFinite(dayCoins) ? Math.max(0, Math.floor(dayCoins)) : 0;
      if (typeof s.modifiers.dayCoinsDay !== 'string') s.modifiers.dayCoinsDay = '';
    }
    // recap: milestone ints 0–40; baselineAt finite ≥ 0; history ≤ 8
    // well-formed rows ({ level, at, stats } — junk rows dropped, §B1 #5).
    {
      const mile = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.min(40, Math.max(0, Math.floor(n))) : 0;
      };
      s.recap.lastRecapLevel = mile(s.recap.lastRecapLevel);
      s.recap.pendingLevel = mile(s.recap.pendingLevel);
      const at = Number(s.recap.baselineAt);
      s.recap.baselineAt = Number.isFinite(at) && at > 0 ? at : 0;
      s.recap.history = (Array.isArray(s.recap.history) ? s.recap.history : [])
        .filter((row) => row != null && typeof row === 'object' && !Array.isArray(row)
          && Number.isFinite(Number(row.level)) && Number.isFinite(Number(row.at)))
        .slice(-8);
    }
    // gallery: count int 0–40 (§B7 cap); lastAddedAt finite ≥ 0; strict bool.
    {
      const count = Number(s.gallery.count);
      s.gallery.count = Number.isFinite(count) ? Math.min(40, Math.max(0, Math.floor(count))) : 0;
      const at = Number(s.gallery.lastAddedAt);
      s.gallery.lastAddedAt = Number.isFinite(at) && at > 0 ? at : 0;
      s.gallery.hintShown = s.gallery.hintShown === true;
    }
  }
  // --- end V4/G53 ---
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
  // V3/FIX-A (P0-2): adopt the stored write generation — after load() this
  // tab is allowed to persist on top of exactly what it just read.
  knownGen = readGen();
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
    // V3/FIX-A (E2 P2-2): "present" junk includes null/''/false/[] — the old
    // Number(parsed.v) coerced those to 0 and re-ran the WHOLE migration
    // chain over an already-migrated save (re-arming the whatsNew panels)
    // instead of taking the corruption path this comment promises. A PRESENT
    // v must now BE a number; only a truly absent key still counts as v0.
    let v = 0;
    if (parsed.v !== undefined) {
      if (typeof parsed.v !== 'number' || !Number.isInteger(parsed.v) || parsed.v < 0) {
        throw new Error(`absurd save version ${JSON.stringify(parsed.v)}`);
      }
      v = parsed.v;
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
 * V3/FIX-A (E20 P0-2): refuses to blind-overwrite a NEWER save written by
 * another tab — see the write-generation guard block up top. Returns false
 * ONLY for that stale-tab refusal (serialization/quota errors still resolve
 * true after the existing graceful warn, so callers don't confuse a full
 * disk with a foreign newer write).
 * @param {object} state
 * @returns {boolean} false when skipped because storage holds a newer save
 */
export function persist(state) {
  const storedGen = readGen();
  if (storedGen > knownGen) {
    console.warn(`[save] persist skipped: storage holds a newer save (gen ${storedGen} > ${knownGen})`);
    return false;
  }
  try {
    const json = JSON.stringify(state);
    // Bump the write counter only when the REAL backend took the payload —
    // an in-memory fallback write is invisible to other tabs and must not
    // advance the shared generation.
    if (storage.setItem(SAVE.KEY, json)) {
      knownGen = Math.max(knownGen, storedGen) + 1;
      storage.setItem(GEN_KEY, String(knownGen));
    }
    // G13: mirror to Capacitor Preferences on native (fire-and-forget).
    prefs?.set({ key: SAVE.KEY, value: json })?.catch?.(() => {});
  } catch (err) {
    console.warn('[save] persist failed:', err?.message);
  }
  return true;
}

/** Wipe the save (dev harness ?reset=1 — §E9). */
export function clear() {
  storage.removeItem(SAVE.KEY);
  // G13: clear the native Preferences mirror too.
  prefs?.remove({ key: SAVE.KEY })?.catch?.(() => {});
}
