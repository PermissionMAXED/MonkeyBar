// V2/G16 — save schema v2 + v1 → v2 migration (PLAN2 §B2, binding).
// Committed v1 fixtures under test/fixtures/ prove losslessness:
//   (a) v1-fresh.json      — a fresh v1 defaultState() dump
//   (b) v1-midgame.json    — level 12, 5000c, 7 outfits, 40 feeds, streak 6,
//                            furniture placed, best scores for all 12 v1 games
//   (c) v1-extra-keys.json — unknown keys at several depths (must survive)
// Asserts: post-load v === 2; EVERY v1 value identical; every new slice at its
// exact §B2 default; whatsNew2Seen false for migrants / true for fresh saves;
// forward-version (v:3) still refuses; corrupt payloads still recover; v2
// loads are idempotent (load → persist → load is byte-stable).
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
 * Every leaf present in `expected` must be identical in `actual` (extra keys
 * in `actual` — the migrated v2 additions — are allowed). Arrays compare
 * exactly (v1 arrays must pass through verbatim).
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

// --- §B2 defaults, hardcoded as an independent spec copy --------------------

const defaultPlot = () => ({
  crop: null, plantedAt: 0, progressMin: 0, wateredUntil: 0, waterings: 0, fertilized: false,
});

const B2_SLICE_DEFAULTS = () => ({
  garden: { plotsOwned: 4, plots: Array.from({ length: 6 }, defaultPlot), lastTickAt: 0 },
  health: { state: 'healthy', junkScore: 0, neglectMin: 0, recoverMin: 0, since: 0 },
  weight: { value: 50 },
  quests: { day: '', active: [], rerolledDay: '', completedTotal: 0 },
  collections: { entries: {}, claimedSets: {} },
  skins: { owned: ['cream'], equipped: 'cream' },
  items: { medicine: 0, fertilizer: 0 },
  profile: { playtimeMin: 0, coinsEarned: 0, coinsSpent: 0, distanceM: 0, photos: 0 },
});

const B2_NEW_COUNTERS = {
  harvests: 0, plantings: 0, waterings: 0, sells: 0, cures: 0, vetTrips: 0,
  deliveries: 0, questsDone: 0, photosTaken: 0, nightPlays: 0, medsGiven: 0, balls: 0,
};

// ------------------------------------------------------------------ schema

test('SAVE.VERSION is 2 and the migration chain has one entry per step', () => {
  assert.equal(SAVE.VERSION, 2);
  assert.equal(migrations.length, 2); // v0→1, v1→2
});

test('fresh defaultState: v2 slices at §B2 defaults, whatsNew2Seen true', () => {
  const s = defaultState();
  assert.equal(s.v, 2);
  for (const [slice, def] of Object.entries(B2_SLICE_DEFAULTS())) {
    assert.deepEqual(s[slice], def, `defaultState().${slice}`);
  }
  assertSubset(s.achievements.counters, B2_NEW_COUNTERS, '$.achievements.counters');
  // fresh saves never see the "What's new in 2.0" panel (§E0.1-6)
  assert.equal(s.onboarding.whatsNew2Seen, true);
});

// -------------------------------------------------- fixture migrations (§B2)

for (const name of ['v1-fresh.json', 'v1-midgame.json', 'v1-extra-keys.json']) {
  test(`migration ${name}: v → 2, every v1 value intact, new slices at defaults`, () => {
    const v1 = fixture(name);
    assert.equal(v1.v, 1, 'fixture must be a v1 save');
    const { state, fresh, recovered } = loadRaw(v1);
    assert.equal(fresh, false);
    assert.equal(recovered, false);
    assert.equal(state.v, 2);

    // 1. every v1 value passes through verbatim (§B2 migration step 2)
    const { v: _v, ...v1Values } = v1;
    assertSubset(state, v1Values);

    // 2. every new top-level slice lands at its exact §B2 default
    for (const [slice, def] of Object.entries(B2_SLICE_DEFAULTS())) {
      assert.deepEqual(state[slice], def, `${name} → ${slice}`);
    }

    // 3. counters gain the §B2 additions at 0 — existing values untouched
    assertSubset(state.achievements.counters, B2_NEW_COUNTERS);

    // 4. migrated v1 veterans get the one-time "What's new" panel (§E0.1-6)
    assert.equal(state.onboarding.whatsNew2Seen, false);

    // 5. §B2 deviation (deliberate, documented in save.js): furniture.placed
    //    stays a FLAT 'room:slot' map — no object-valued 'garden' key is
    //    injected (garden decor appears as 'garden:<slot>' keys, wave 2).
    assert.equal('garden' in state.furniture.placed, false);
  });
}

test('midgame fixture details: coins/level/outfits/bests/streak survive exactly', () => {
  const v1 = fixture('v1-midgame.json');
  const { state } = loadRaw(v1);
  assert.equal(state.coins, 5000);
  assert.equal(state.level, 12);
  assert.equal(state.xp, 340);
  assert.equal(state.outfits.owned.length, 7);
  assert.deepEqual(state.outfits.owned, v1.outfits.owned);
  assert.equal(state.achievements.counters.feeds, 40);
  assert.equal(state.daily.streak, 6);
  assert.equal(Object.keys(state.minigames.best).length, 12); // all 12 v1 games
  assert.deepEqual(state.minigames.best, v1.minigames.best);
  assert.deepEqual(state.furniture.placed, v1.furniture.placed);
  assert.equal(state.quickDelivery, true);
  assert.equal(state.settings.lang, 'de');
});

test('extra-keys fixture: unknown keys at every depth survive', () => {
  const { state } = loadRaw(fixture('v1-extra-keys.json'));
  assert.deepEqual(state.futureFeature, { hello: 'world', nested: [1, 2, 3] });
  assert.equal(state.modLoader, 'gooby-mods v9');
  assert.equal(state.stats.swagger, 9001); // unknown stat passes through unclamped
  assert.equal(state.inventory.mysteryMeat, 1);
  assert.equal(state.achievements.counters.highFives, 3);
  assert.equal(state.settings.experimentalShaders, true);
});

// ------------------------------------------------ refusal + recovery (§B2)

test('forward version v:3 still refuses: fresh state + corrupt backup', () => {
  const payload = JSON.stringify({ ...defaultState(), v: 3 });
  const { state, fresh, recovered } = loadRaw(payload);
  assert.equal(fresh, false);
  assert.equal(recovered, true);
  assert.equal(state.v, 2); // fresh v2 state
  assert.equal(backing.get(SAVE.CORRUPT_KEY), payload);
});

test('corrupt payloads still recover (v1 wrong-typed containers incl. v2 paths)', () => {
  const hostile = [
    '{"v":1, nope',
    JSON.stringify({ v: 1, achievements: { counters: 'many' } }), // migration must not object-ify
    JSON.stringify({ v: 1, onboarding: 'done' }),
    JSON.stringify({ v: 2, garden: 'weeds' }),
    JSON.stringify({ v: 2, items: [1, 2] }),
    JSON.stringify({ v: 2, profile: 'me' }),
  ];
  for (const payload of hostile) {
    const { state, recovered } = loadRaw(payload);
    assert.equal(recovered, true, `${payload.slice(0, 40)} should recover`);
    assert.equal(state.v, 2);
    assert.equal(backing.get(SAVE.CORRUPT_KEY), payload);
  }
});

test('validate() clamps the v2 slices (§B2.4)', () => {
  const cases = [
    // weight → [5, 95], non-finite → 50
    [{ weight: { value: 9999 } }, (s) => assert.equal(s.weight.value, 95)],
    [{ weight: { value: -5 } }, (s) => assert.equal(s.weight.value, 5)],
    [{ weight: { value: 'chonky' } }, (s) => assert.equal(s.weight.value, 50)],
    // health.state coerced to 'healthy' when invalid
    [{ health: { state: 'zombie' } }, (s) => assert.equal(s.health.state, 'healthy')],
    [{ health: { state: 'queasy' } }, (s) => assert.equal(s.health.state, 'queasy')],
    // garden.plots normalized to exactly 6 entries
    [
      { garden: { plotsOwned: 4, plots: [{ crop: 'radish' }], lastTickAt: 0 } },
      (s) => {
        assert.equal(s.garden.plots.length, 6);
        assert.equal(s.garden.plots[0].crop, 'radish');
        assert.equal(s.garden.plots[0].waterings, 0); // gaps filled from the default plot
        assert.deepEqual(s.garden.plots[5], defaultPlot());
      },
    ],
    [
      { garden: { plotsOwned: 4, plots: Array.from({ length: 9 }, defaultPlot), lastTickAt: 0 } },
      (s) => assert.equal(s.garden.plots.length, 6),
    ],
    // level clamps to LEVELING.MAX_LEVEL (40) now
    [{ level: 99 }, (s) => assert.equal(s.level, 40)],
  ];
  for (const [patch, check] of cases) {
    const { state, recovered } = loadRaw({ ...defaultState(), ...patch });
    assert.equal(recovered, false, JSON.stringify(patch));
    check(state);
  }
});

// ----------------------------------------------------------- idempotency

test('loading a v2 save is idempotent (load → persist → load, byte-stable)', () => {
  const first = loadRaw(fixture('v1-midgame.json')).state;
  persist(first);
  const bytes1 = backing.get(SAVE.KEY);
  const second = load();
  assert.equal(second.fresh, false);
  assert.equal(second.recovered, false);
  assert.deepEqual(second.state, first);
  persist(second.state);
  assert.equal(backing.get(SAVE.KEY), bytes1); // byte-stable roundtrip
});
