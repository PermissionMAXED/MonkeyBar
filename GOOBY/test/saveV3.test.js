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

const { defaultState, migrations, load, persist } = await import('../src/core/save.js');
const { SAVE } = await import('../src/data/constants.js');

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
