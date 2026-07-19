// V3/G34 — save schema v3 + v2 → v3 AND v1 → v3 migrations (PLAN3 §B1,
// binding). Fixtures under test/fixtures/ prove losslessness:
//   (a) v2-midgame.json — a rich v2 save (garden crops mid-growth, queasy
//       health, weight 63.5, active quests, collections, 3 skins, music OFF)
//   (b) v1-fresh/v1-midgame/v1-extra-keys.json — the v2-era chain fixtures
// Asserts: post-load v === 3; EVERY legacy leaf identical (field-diff walk);
// every §B1 addition at its exact default (stickers/nougat slices,
// settings.uiScale/volumes/devUnlocked, outfits.equipped.back, the 9 new
// counters); whatsNew3Seen false for migrants / true for fresh; the §B1-2
// honesty rule (music:false boots muted with the slider at its default 70);
// validate() clamps (uiScale stops, volumes 0–100 ints, strict booleans,
// nougat.lastGlobAt); forward-version v4 refusal; and a ≥ 300-mutation seeded
// hostile fuzz battery (wrong-typed new slices, truncations, junk splices)
// where every load() lands in a valid playable state without throwing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// --- localStorage shim (installed BEFORE the module is exercised) -----------
const backing = new Map();
globalThis.localStorage = {
  /** @param {string} k */ getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  /** @param {string} k @param {string} v */ setItem: (k, v) => backing.set(k, String(v)),
  /** @param {string} k */ removeItem: (k) => backing.delete(k),
};

const { defaultState, migrations, load, persist, clear, hasNewerSave } = await import('../src/core/save.js');
const { createStore } = await import('../src/core/store.js'); // V3/FIX-A P0-2 policy tests
const { cooldownRemainingMs } = await import('../src/systems/nougat.logic.js'); // V3/FIX-A P2-1
const { SAVE } = await import('../src/data/constants.js');

/** V3/FIX-A (P0-2): the write-generation counter key (kept OUT of the payload). */
const GEN_KEY = `${SAVE.KEY}.gen`;

const wipe = () => backing.clear();

/** @param {string} name @returns {object} parsed fixture JSON */
const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

/** Inject a raw save payload and load it. */
function loadRaw(payload) {
  wipe();
  backing.set(SAVE.KEY, typeof payload === 'string' ? payload : JSON.stringify(payload));
  return load();
}

/**
 * Field-diff walk: every leaf present in `expected` must be identical in
 * `actual` (extra keys in `actual` — the migrated additions — are allowed).
 * Arrays compare exactly (legacy arrays must pass through verbatim).
 */
function assertSubset(actual, expected, path = '$') {
  if (expected != null && typeof expected === 'object' && !Array.isArray(expected)) {
    assert.ok(
      actual != null && typeof actual === 'object' && !Array.isArray(actual),
      `${path} must stay an object`
    );
    for (const [k, v] of Object.entries(expected)) assertSubset(actual[k], v, `${path}.${k}`);
  } else {
    assert.deepEqual(actual, expected, `${path} must survive the migration verbatim`);
  }
}

// --- §B1 defaults, hardcoded as an independent spec copy --------------------

const B1_SLICE_DEFAULTS = () => ({
  stickers: { unlocked: {}, seen: {} },
  nougat: { lastGlobAt: 0, installed: false },
});

const B1_SETTINGS_DEFAULTS = {
  uiScale: 100,
  volumes: { master: 80, sfx: 100, music: 70, voice: 100, ambience: 80 },
  devUnlocked: false,
};

const B1_NEW_COUNTERS = {
  nougatGlobs: 0, cakesServed: 0, perfectCakes: 0, surfRuns: 0, surfDistanceM: 0,
  races: 0, ghostsCaught: 0, rescues: 0, cratesShipped: 0,
};

// ------------------------------------------------------------------ schema

test('SAVE.VERSION is 3 and the chain has one migration per step', () => {
  assert.equal(SAVE.VERSION, 3);
  assert.equal(migrations.length, 3); // v0→1, v1→2, v2→3
});

test('fresh defaultState: §B1 slices/settings/counters at exact defaults', () => {
  const s = defaultState();
  assert.equal(s.v, 3);
  for (const [slice, def] of Object.entries(B1_SLICE_DEFAULTS())) {
    assert.deepEqual(s[slice], def, `defaultState().${slice}`);
  }
  assert.equal(s.settings.uiScale, 100);
  assert.deepEqual(s.settings.volumes, B1_SETTINGS_DEFAULTS.volumes);
  assert.equal(s.settings.devUnlocked, false);
  // v1/v2 settings keys untouched by the v3 additions
  assert.equal(s.settings.lang, 'auto');
  assert.equal(s.settings.sfx, true);
  assert.equal(s.settings.notifications, 'unasked');
  // §C13: 4th equip slot at null
  assert.deepEqual(s.outfits.equipped, { hat: null, glasses: null, neck: null, back: null });
  assertSubset(s.achievements.counters, B1_NEW_COUNTERS, '$.achievements.counters');
  // fresh saves never see the "What's new in 3.0" panel (§E0.1-8)
  assert.equal(s.onboarding.whatsNew3Seen, true);
  assert.equal(s.onboarding.whatsNew2Seen, true);
});

// ----------------------------------------------- v2 → v3 fixture migration

test('v2-midgame.json: v → 3, EVERY v2 leaf intact, §B1 additions at defaults', () => {
  const v2 = fixture('v2-midgame.json');
  assert.equal(v2.v, 2, 'fixture must be a v2 save');
  const { state, fresh, recovered } = loadRaw(v2);
  assert.equal(fresh, false);
  assert.equal(recovered, false);
  assert.equal(state.v, 3);

  // 1. lossless: every v2 leaf passes through verbatim (field-diff walk)
  const { v: _v, ...v2Values } = v2;
  assertSubset(state, v2Values);

  // 2. new slices at exact §B1 defaults
  for (const [slice, def] of Object.entries(B1_SLICE_DEFAULTS())) {
    assert.deepEqual(state[slice], def, `v2 → ${slice}`);
  }

  // 3. settings additions defaults-first; §B1-2 honesty rule: music:false
  //    passes through (boots muted) with the slider at its default 70
  assert.equal(state.settings.music, false);
  assert.equal(state.settings.volumes.music, 70);
  assert.deepEqual(state.settings.volumes, B1_SETTINGS_DEFAULTS.volumes);
  assert.equal(state.settings.uiScale, 100);
  assert.equal(state.settings.devUnlocked, false);
  assert.equal(state.settings.lang, 'de'); // v2 value verbatim

  // 4. outfits gains ONLY the back key (null); v2 equips verbatim
  assert.deepEqual(state.outfits.equipped, {
    hat: 'strawHat', glasses: null, neck: 'bowtie', back: null,
  });

  // 5. counters gain the §B1 additions at 0 — every v2 value untouched
  assertSubset(state.achievements.counters, B1_NEW_COUNTERS);
  assert.equal(state.achievements.counters.feeds, 55);
  assert.equal(state.achievements.counters.balls, 27);

  // 6. migrated veterans get the one-time 3.0 panel; the v2 flag is untouched
  assert.equal(state.onboarding.whatsNew3Seen, false);
  assert.equal(state.onboarding.whatsNew2Seen, true);

  // 7. unknown keys survive (forward-compatible merge)
  assert.deepEqual(state.futureFeature, { hello: 'from a mod', nested: [1, 2, 3] });
});

// ------------------------------------------- v1 → v3 whole-chain migrations

for (const name of ['v1-fresh.json', 'v1-midgame.json', 'v1-extra-keys.json']) {
  test(`${name} chain: v → 3, every v1 leaf intact, v2 AND v3 additions at defaults`, () => {
    const v1 = fixture(name);
    assert.equal(v1.v, 1, 'fixture must be a v1 save');
    const { state, recovered } = loadRaw(v1);
    assert.equal(recovered, false);
    assert.equal(state.v, 3);

    // lossless across BOTH hops (field-diff walk)
    const { v: _v, ...v1Values } = v1;
    assertSubset(state, v1Values);

    // v3 additions at defaults
    for (const [slice, def] of Object.entries(B1_SLICE_DEFAULTS())) {
      assert.deepEqual(state[slice], def, `${name} → ${slice}`);
    }
    assert.deepEqual(state.settings.volumes, B1_SETTINGS_DEFAULTS.volumes);
    assert.equal(state.settings.uiScale, 100);
    assert.equal(state.settings.devUnlocked, false);
    assert.equal(state.outfits.equipped.back, null);
    assertSubset(state.achievements.counters, B1_NEW_COUNTERS);
    // v1 veterans see BOTH what's-new panels (§E0.1-6 + §E0.1-8)
    assert.equal(state.onboarding.whatsNew2Seen, false);
    assert.equal(state.onboarding.whatsNew3Seen, false);
    // v2 slices at their §B2 defaults after the chain (spot check)
    assert.equal(state.garden.plotsOwned, 4);
    assert.deepEqual(state.skins, { owned: ['cream'], equipped: 'cream' });
  });
}

test('a CURRENT v3 save loads without a migration and without drift', () => {
  const s = defaultState();
  s.stickers.unlocked = { firstNom: 1780000000123, bigTen: 1780000000456 };
  s.stickers.seen = { firstNom: true };
  s.nougat = { lastGlobAt: 1784281000000, installed: true };
  s.settings.uiScale = 130;
  s.settings.volumes = { master: 55, sfx: 90, music: 0, voice: 100, ambience: 25 };
  s.settings.devUnlocked = true;
  s.outfits.equipped.back = 'cape';
  s.achievements.counters.nougatGlobs = 7;
  const { state, recovered } = loadRaw(s);
  assert.equal(recovered, false);
  assert.deepEqual(state.stickers, s.stickers);
  assert.deepEqual(state.nougat, s.nougat);
  assert.equal(state.settings.uiScale, 130);
  assert.deepEqual(state.settings.volumes, s.settings.volumes);
  assert.equal(state.settings.devUnlocked, true);
  assert.equal(state.outfits.equipped.back, 'cape');
  assert.equal(state.achievements.counters.nougatGlobs, 7);
});

// ---------------------------------------------------- validate() clamps (§B1)

test('validate: uiScale must be one of {85,100,115,130}, else 100', () => {
  for (const legal of [85, 100, 115, 130]) {
    const { state } = loadRaw({ ...defaultState(), settings: { ...defaultState().settings, uiScale: legal } });
    assert.equal(state.settings.uiScale, legal, `legal stop ${legal} preserved`);
  }
  for (const junk of [90, 0, -85, 1000, 99.9, 'big', true, null, NaN]) {
    const s = defaultState();
    s.settings.uiScale = junk;
    const { state, recovered } = loadRaw(s);
    assert.equal(recovered, false, `uiScale ${String(junk)} is not corruption`);
    assert.equal(state.settings.uiScale, 100, `uiScale ${String(junk)} → 100`);
  }
});

test('validate: volumes clamp to integer 0–100; junk → per-bus default', () => {
  const s = defaultState();
  s.settings.volumes = { master: -5, sfx: 999, music: 55.5, voice: 'loud', ambience: NaN };
  const { state, recovered } = loadRaw(s);
  assert.equal(recovered, false);
  assert.deepEqual(state.settings.volumes, {
    master: 0,      // clamped up
    sfx: 100,       // clamped down
    music: 56,      // rounded to int
    voice: 100,     // junk → default
    ambience: 80,   // NaN → default
  });
  // a MISSING volumes container gets full defaults (mergeDefaults)
  const noVol = defaultState();
  delete noVol.settings.volumes;
  assert.deepEqual(loadRaw(noVol).state.settings.volumes, B1_SETTINGS_DEFAULTS.volumes);
});

test('validate: devUnlocked/nougat.installed strict booleans; lastGlobAt finite ≥ 0', () => {
  const cases = [
    [{ devUnlocked: 1 }, false], [{ devUnlocked: 'yes' }, false],
    [{ devUnlocked: true }, true], [{ devUnlocked: false }, false],
  ];
  for (const [patch, want] of cases) {
    const s = defaultState();
    Object.assign(s.settings, patch);
    assert.equal(loadRaw(s).state.settings.devUnlocked, want, JSON.stringify(patch));
  }
  for (const [nougat, want] of [
    [{ lastGlobAt: 'yesterday', installed: 'yes' }, { lastGlobAt: 0, installed: false }],
    [{ lastGlobAt: -500, installed: 1 }, { lastGlobAt: 0, installed: false }],
    [{ lastGlobAt: 1784281000000, installed: true }, { lastGlobAt: 1784281000000, installed: true }],
    [{ lastGlobAt: NaN, installed: false }, { lastGlobAt: 0, installed: false }],
  ]) {
    const s = defaultState();
    s.nougat = nougat;
    assert.deepEqual(loadRaw(s).state.nougat, want, JSON.stringify(nougat));
  }
});

// ------------------------------------------------ refusal + recovery (§B1)

test('forward version v:4 refuses: fresh state + corrupt backup', () => {
  const payload = JSON.stringify({ ...defaultState(), v: 4, coins: 424242 });
  const { state, fresh, recovered } = loadRaw(payload);
  assert.equal(fresh, false);
  assert.equal(recovered, true);
  assert.equal(state.v, 3);
  assert.notEqual(state.coins, 424242, 'future coins NOT imported');
  assert.equal(backing.get(SAVE.CORRUPT_KEY), payload);
});

test('wrong-typed NEW slices are corruption → recovery, never a crash', () => {
  const hostile = [
    { v: 3, stickers: 'lots' },
    { v: 3, stickers: [1, 2, 3] },
    { v: 3, stickers: { unlocked: 'all', seen: {} } },
    { v: 3, nougat: 'chocolate' },
    { v: 3, nougat: [] },
    { v: 3, settings: { volumes: 'loud' } },
    { v: 3, settings: { volumes: [80, 100, 70] } },
    { v: 2, stickers: 'pre-set junk in a v2 save' }, // migration must not object-ify
    { v: 2, nougat: 42 },
    { v: 1, stickers: 'junk from the future' },
  ];
  for (const payload of hostile) {
    const raw = JSON.stringify(payload);
    let result;
    assert.doesNotThrow(() => {
      result = loadRaw(raw);
    }, `load() must not throw for ${raw}`);
    assert.equal(result.recovered, true, `${raw} should recover`);
    assert.equal(result.state.v, 3);
    assert.equal(backing.get(SAVE.CORRUPT_KEY), raw, `${raw} backup preserved`);
  }
});

// ------------------------------------------------- seeded hostile fuzzing

/** mulberry32 — tiny deterministic PRNG so failures reproduce by seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Junk values a hostile save might carry at any path. */
const JUNK = [
  null, true, false, 0, -1, 42.5, NaN, Infinity, -Infinity, '', 'junk', 'yes',
  [], [1, 2, 3], {}, { a: 1 }, 'null', '💥', -9e15, 9e15,
];

/** Dot-paths biased toward the NEW v3 slices plus classic hot spots. */
const FUZZ_PATHS = [
  'stickers', 'stickers.unlocked', 'stickers.seen', 'stickers.unlocked.firstNom',
  'nougat', 'nougat.lastGlobAt', 'nougat.installed',
  'settings', 'settings.uiScale', 'settings.volumes', 'settings.volumes.master',
  'settings.volumes.music', 'settings.devUnlocked',
  'outfits.equipped', 'outfits.equipped.back',
  'achievements.counters.nougatGlobs', 'achievements.counters.surfRuns',
  'achievements.counters', 'achievements',
  'onboarding.whatsNew3Seen', 'onboarding',
  'v', 'stats', 'sleep', 'coins', 'level', 'inventory', 'garden.plots',
  'quests.active', 'collections.entries', 'skins.owned', 'weight.value',
];

/** Set a dot-path on a plain object (creating parents as objects). */
function setPath(obj, path, value) {
  const keys = path.split('.');
  let at = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (at[keys[i]] == null || typeof at[keys[i]] !== 'object') return; // path junked earlier
    at = at[keys[i]];
  }
  at[keys[keys.length - 1]] = value;
}

test('fuzz battery: ≥ 300 seeded mutations (new-slice targets, truncations, splices) never crash', () => {
  const rng = mulberry32(0x0B15BA5E); // deterministic — failures reproduce
  const bases = [
    () => defaultState(),                       // v3
    () => fixture('v2-midgame.json'),           // v2
    () => fixture('v1-midgame.json'),           // v1
  ];
  let runs = 0;
  let recoveries = 0;

  // 1. path-targeted junk mutations: 3 bases × 30 paths-ish × junk values
  for (let i = 0; i < 240; i += 1) {
    const base = bases[i % bases.length]();
    const nMut = 1 + Math.floor(rng() * 3);
    for (let m = 0; m < nMut; m += 1) {
      const path = FUZZ_PATHS[Math.floor(rng() * FUZZ_PATHS.length)];
      const junk = JUNK[Math.floor(rng() * JUNK.length)];
      setPath(base, path, junk);
    }
    const raw = JSON.stringify(base);
    let result;
    assert.doesNotThrow(() => {
      result = loadRaw(raw);
    }, `mutation #${i} must not throw: ${raw.slice(0, 120)}`);
    assert.ok(result.state, `mutation #${i} yields a state`);
    assert.equal(result.state.v, 3, `mutation #${i} lands on v3`);
    assert.equal(typeof result.state.stats, 'object');
    assert.deepEqual(Object.keys(result.state.stickers).sort(), ['seen', 'unlocked'],
      `mutation #${i} stickers slice is structurally sound`);
    runs += 1;
    if (result.recovered) recoveries += 1;
  }

  // 2. truncations: valid JSON cut at random byte offsets
  const full = JSON.stringify(fixture('v2-midgame.json'));
  for (let i = 0; i < 40; i += 1) {
    const cut = 1 + Math.floor(rng() * (full.length - 1));
    const raw = full.slice(0, cut);
    let result;
    assert.doesNotThrow(() => {
      result = loadRaw(raw);
    }, `truncation @${cut} must not throw`);
    assert.equal(result.state.v, 3);
    runs += 1;
    if (result.recovered) recoveries += 1;
  }

  // 3. byte splices: random garbage characters injected mid-JSON
  for (let i = 0; i < 40; i += 1) {
    const at = Math.floor(rng() * full.length);
    const glyph = String.fromCharCode(33 + Math.floor(rng() * 90));
    const raw = full.slice(0, at) + glyph + full.slice(at + 1);
    let result;
    assert.doesNotThrow(() => {
      result = loadRaw(raw);
    }, `splice @${at} must not throw`);
    assert.equal(result.state.v, 3);
    runs += 1;
    if (result.recovered) recoveries += 1;
  }

  assert.ok(runs >= 300, `fuzz corpus size ${runs} ≥ 300`);
  assert.ok(recoveries > 0, 'battery exercised the corrupt-recovery path');
  assert.ok(recoveries < runs, 'battery also exercised the clamp-not-recover path');
});

// ----------------------------------------------------------- idempotency

test('v2 → v3 load is idempotent (load → persist → load, byte-stable)', () => {
  const first = loadRaw(fixture('v2-midgame.json')).state;
  persist(first);
  const bytes1 = backing.get(SAVE.KEY);
  const second = load();
  assert.equal(second.fresh, false);
  assert.equal(second.recovered, false);
  assert.deepEqual(second.state, first);
  persist(second.state);
  assert.equal(backing.get(SAVE.KEY), bytes1); // byte-stable roundtrip
});

// ============================================================================
// V3/FIX-A extensions (E20 P0-1/P0-2 + E2 P2-1/P2-2)
// ============================================================================

// ------------------------------------- P0-1: storage disabled → boot survives

test('P0-1: SecurityError on every storage access — load/persist never throw, session runs in memory', () => {
  wipe();
  const original = {
    getItem: globalThis.localStorage.getItem,
    setItem: globalThis.localStorage.setItem,
    removeItem: globalThis.localStorage.removeItem,
  };
  const deny = () => {
    const err = new Error('The operation is insecure.');
    err.name = 'SecurityError';
    throw err;
  };
  globalThis.localStorage.getItem = deny;
  globalThis.localStorage.setItem = deny;
  globalThis.localStorage.removeItem = deny;
  try {
    let first;
    assert.doesNotThrow(() => {
      first = load();
    }, 'load() must not throw when storage is disabled (the E20 blank-boot)');
    assert.equal(first.fresh, true);
    assert.equal(first.recovered, false);
    assert.equal(first.state.v, 3, 'fully playable default state');
    // the session keeps its own progress via the in-memory fallback store
    first.state.coins = 321;
    assert.doesNotThrow(() => persist(first.state));
    const again = load();
    assert.equal(again.fresh, false, 'in-memory save readable within the session');
    assert.equal(again.state.coins, 321);
    assert.doesNotThrow(() => clear(), 'clear() survives disabled storage too');
    assert.equal(load().fresh, true);
  } finally {
    globalThis.localStorage.getItem = original.getItem;
    globalThis.localStorage.setItem = original.setItem;
    globalThis.localStorage.removeItem = original.removeItem;
    clear(); // scrub the in-memory fallback so later tests read real backing
  }
});

test('P0-1: reads prefer REAL storage once it works — the memory fallback never shadows it', () => {
  const s = defaultState();
  s.coins = 777;
  const { state, fresh } = loadRaw(s); // real backing, normal path
  assert.equal(fresh, false);
  assert.equal(state.coins, 777);
});

// --------------------------- P0-2: stale tab never blind-overwrites (save.js)

test('P0-2: persist refuses when storage holds a newer generation — the newer write survives', () => {
  const base = defaultState();
  base.coins = 100;
  const { state: tabState } = loadRaw(base); // this "tab" loads at gen 0
  assert.equal(persist(tabState), true);
  assert.equal(backing.get(GEN_KEY), '1', 'successful persist bumps the counter');
  assert.equal(hasNewerSave(), false);

  // a foreign tab lands a NEWER write (coins 211 @ gen 2)
  const foreign = JSON.parse(backing.get(SAVE.KEY));
  foreign.coins = 211;
  backing.set(SAVE.KEY, JSON.stringify(foreign));
  backing.set(GEN_KEY, '2');
  assert.equal(hasNewerSave(), true);

  // the stale tab acts (uiScale) and tries to flush its whole old state
  tabState.settings.uiScale = 85;
  assert.equal(persist(tabState), false, 'stale write must be refused');
  assert.equal(JSON.parse(backing.get(SAVE.KEY)).coins, 211, 'newer coins survive');
  assert.equal(backing.get(GEN_KEY), '2', 'counter untouched by the refused write');

  // adopting the newer save (a fresh load) re-arms this tab as a writer
  const adopted = load();
  assert.equal(adopted.state.coins, 211);
  assert.equal(hasNewerSave(), false);
  adopted.state.coins = 260;
  assert.equal(persist(adopted.state), true);
  assert.equal(JSON.parse(backing.get(SAVE.KEY)).coins, 260);
  assert.equal(backing.get(GEN_KEY), '3', 'counter stays monotonic');
});

test('P0-2: the write counter lives OUTSIDE the payload — save bytes stay byte-stable', () => {
  const first = loadRaw(fixture('v2-midgame.json')).state;
  persist(first);
  const bytes = backing.get(SAVE.KEY);
  assert.ok(!bytes.includes('"gen"'), 'no counter key inside the payload');
  persist(load().state);
  assert.equal(backing.get(SAVE.KEY), bytes, 'roundtrip stays byte-stable with the guard on');
  assert.equal(backing.get(GEN_KEY), '2', 'only the external counter moved');
});

// ------------------- P0-2: store policy (stale latch, idle adoption, resume)

test('P0-2: two-writer store sequence — stale tab skips, hidden tab adopts, visible tab resumes', () => {
  // window/document shims so createStore wires its storage/visibility handlers
  const handlers = { window: new Map(), document: new Map() };
  globalThis.window = {
    addEventListener: (ev, cb) => handlers.window.set(ev, cb),
  };
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (ev, cb) => handlers.document.set(ev, cb),
    getElementById: () => null, // no #ui in node — the notice DOM is skipped
  };
  try {
    // tab B boots on the shared profile (coins 100) and flushes once
    const base = defaultState();
    base.coins = 100;
    wipe();
    backing.set(SAVE.KEY, JSON.stringify(base));
    const storeB = createStore(load().state); // autosave ON (flush persists)
    let conflicts = 0;
    storeB.on('saveConflict', () => {
      conflicts += 1;
    });
    storeB.flush();
    assert.equal(JSON.parse(backing.get(SAVE.KEY)).coins, 100);
    assert.equal(backing.get(GEN_KEY), '1');

    // tab A (foreign) saves coins 211 — tab B is VISIBLE: latch stale + event
    const foreign = { ...JSON.parse(backing.get(SAVE.KEY)), coins: 211 };
    backing.set(SAVE.KEY, JSON.stringify(foreign));
    backing.set(GEN_KEY, '2');
    handlers.window.get('storage')();
    assert.equal(conflicts, 1, 'saveConflict fired once');

    // the stale tab acts (the E20 repro: uiScale change) and flushes
    storeB.set('settings.uiScale', 85);
    storeB.set('coins', 100);
    storeB.flush();
    assert.equal(JSON.parse(backing.get(SAVE.KEY)).coins, 211, 'tab A\u2019s newer coins survive');
    assert.equal(JSON.parse(backing.get(SAVE.KEY)).settings.uiScale, 100, 'no partial clobber either');

    // tab B goes hidden; tab A writes again → B adopts silently while idle
    globalThis.document.visibilityState = 'hidden';
    backing.set(SAVE.KEY, JSON.stringify({ ...foreign, coins: 300 }));
    backing.set(GEN_KEY, '3');
    handlers.window.get('storage')();
    assert.equal(storeB.get('coins'), 300, 'hidden tab adopted the newer save in place');
    // hidden post-adoption mutations (time-engine ticks) stay LOCAL for now —
    // a hidden tab never writes, so the active writer can't be clobbered…
    storeB.set('coins', 301);
    storeB.flush();
    assert.equal(JSON.parse(backing.get(SAVE.KEY)).coins, 300, 'hidden tab stays read-only');

    // tab B becomes the visible tab again → it CLAIMS writership: its state
    // (adopted gen-3 lineage + its own post-adoption progress — causally
    // consistent, NOT stale data) persists at a fresh generation so the
    // other tab's next autosave is the one that gets refused
    globalThis.document.visibilityState = 'visible';
    handlers.document.get('visibilitychange')();
    assert.equal(JSON.parse(backing.get(SAVE.KEY)).coins, 301, 'claim persists the adopted lineage');
    assert.equal(backing.get(GEN_KEY), '4', 'claim bumps the generation');
    storeB.set('coins', 305);
    storeB.flush();
    assert.equal(JSON.parse(backing.get(SAVE.KEY)).coins, 305, 'resumed tab persists again');
    assert.equal(backing.get(GEN_KEY), '5', 'counter monotonic across the whole sequence');
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test('P0-2: a foreign wipe/corruption is NOT adopted — the live tab keeps its state', () => {
  const handlers = { window: new Map(), document: new Map() };
  globalThis.window = { addEventListener: (ev, cb) => handlers.window.set(ev, cb) };
  globalThis.document = {
    visibilityState: 'hidden',
    addEventListener: (ev, cb) => handlers.document.set(ev, cb),
    getElementById: () => null,
  };
  try {
    const base = defaultState();
    base.coins = 555;
    wipe();
    backing.set(SAVE.KEY, JSON.stringify(base));
    const store = createStore(load().state);
    store.flush(); // gen 1
    // another tab writes GARBAGE at a newer generation
    backing.set(SAVE.KEY, 'garbage{{{');
    backing.set(GEN_KEY, '2');
    handlers.window.get('storage')();
    assert.equal(store.get('coins'), 555, 'live memory survives foreign corruption');
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    wipe(); // the corrupt-backup key etc.
  }
});

// ----------------------------- P2-1: far-future nougat cooldown is defused

test('P2-1: far-future nougat.lastGlobAt (9e15) clamps to now() in validate', () => {
  const s = defaultState();
  s.nougat = { lastGlobAt: 9e15, installed: true };
  const before = Date.now();
  const { state, recovered } = loadRaw(s);
  assert.equal(recovered, false, 'hostile timestamp is clamped, not corruption');
  assert.ok(state.nougat.lastGlobAt <= Date.now() + 1000, 'clamped down to ~now');
  assert.ok(state.nougat.lastGlobAt >= before - 1000, 'not zeroed — reads as "just globbed"');
  assert.equal(state.nougat.installed, true, 'installed flag untouched');
  // worst case ONE 30-min cooldown instead of ~285k years
  assert.ok(cooldownRemainingMs(state, Date.now()) <= 30 * 60000);
});

test('P2-1: legitimate past lastGlobAt values still pass through unclamped', () => {
  const s = defaultState();
  const past = Date.now() - 10 * 60000; // mid-cooldown, 10 min ago
  s.nougat = { lastGlobAt: past, installed: true };
  assert.equal(loadRaw(s).state.nougat.lastGlobAt, past);
});

// ------------------------- P2-2: present-but-junk v is corruption recovery

test('P2-2: v:null (and other PRESENT non-number v) → corruption recovery, whatsNew never re-arms', () => {
  const v2 = fixture('v2-midgame.json');
  for (const junkV of [null, '', false, true, [], '2', '0']) {
    const raw = JSON.stringify({ ...v2, v: junkV });
    const { state, fresh, recovered } = loadRaw(raw);
    assert.equal(recovered, true, `v=${JSON.stringify(junkV)} must take the corruption path`);
    assert.equal(fresh, false);
    assert.equal(backing.get(SAVE.CORRUPT_KEY), raw, 'raw payload backed up for inspection');
    // fresh state: the migration chain did NOT re-run over the v2 save…
    assert.equal(state.onboarding.whatsNew2Seen, true, 'no 2.0 panel re-arm');
    assert.equal(state.onboarding.whatsNew3Seen, true, 'no 3.0 panel re-arm');
    assert.notEqual(state.settings.lang, 'de', 'v2 fields not half-imported');
  }
  // a truly ABSENT v still counts as v0 and migrates losslessly (unchanged)
  const { v: _v, ...noV } = v2;
  const chained = loadRaw(noV);
  assert.equal(chained.recovered, false);
  assert.equal(chained.state.v, 3);
  assert.equal(chained.state.coins, v2.coins);
});
