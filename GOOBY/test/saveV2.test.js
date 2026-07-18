// V2/G16 — save schema v2 + v1 → v2 migration (PLAN2 §B2, binding).
// Committed v1 fixtures under test/fixtures/ prove losslessness:
//   (a) v1-fresh.json      — a fresh v1 defaultState() dump
//   (b) v1-midgame.json    — level 12, 5000c, 7 outfits, 40 feeds, streak 6,
//                            furniture placed, best scores for all 12 v1 games
//   (c) v1-extra-keys.json — unknown keys at several depths (must survive)
// Asserts: post-load v === SAVE.VERSION (V3/G34: the chain continues to v3 —
// v3-specific coverage lives in saveV3.test.js); EVERY v1 value identical;
// every new v2 slice at its exact §B2 default; whatsNew2Seen false for
// migrants / true for fresh saves; forward-version (v > current) refuses;
// corrupt payloads recover; loads are idempotent (persist → load byte-stable).
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
// V2/FIX-A (E20): the real inventory op that deletes zero-count keys
const { remove: removeInv } = await import('../src/systems/inventory.js');

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

test('SAVE.VERSION is 3 and the migration chain has one entry per step', () => {
  assert.equal(SAVE.VERSION, 3); // V3/G34: schema v3 (§B1) — was 2
  assert.equal(migrations.length, 3); // v0→1, v1→2, v2→3
});

test('fresh defaultState: v2 slices at §B2 defaults, whatsNew2Seen true', () => {
  const s = defaultState();
  assert.equal(s.v, SAVE.VERSION);
  for (const [slice, def] of Object.entries(B2_SLICE_DEFAULTS())) {
    assert.deepEqual(s[slice], def, `defaultState().${slice}`);
  }
  assertSubset(s.achievements.counters, B2_NEW_COUNTERS, '$.achievements.counters');
  // fresh saves never see the "What's new in 2.0" panel (§E0.1-6)
  assert.equal(s.onboarding.whatsNew2Seen, true);
});

// -------------------------------------------------- fixture migrations (§B2)

for (const name of ['v1-fresh.json', 'v1-midgame.json', 'v1-extra-keys.json']) {
  test(`migration ${name}: v → current, every v1 value intact, new slices at defaults`, () => {
    const v1 = fixture(name);
    assert.equal(v1.v, 1, 'fixture must be a v1 save');
    const { state, fresh, recovered } = loadRaw(v1);
    assert.equal(fresh, false);
    assert.equal(recovered, false);
    // V3/G34: the chain now ends at v3 (v1→v2 behavior unchanged; the v3
    // additions are asserted fixture-by-fixture in saveV3.test.js).
    assert.equal(state.v, SAVE.VERSION);

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

test('forward version (v > current) still refuses: fresh state + corrupt backup', () => {
  // V3/G34: v3 is current now — the forward-refusal check moves to v4.
  const payload = JSON.stringify({ ...defaultState(), v: SAVE.VERSION + 1 });
  const { state, fresh, recovered } = loadRaw(payload);
  assert.equal(fresh, false);
  assert.equal(recovered, true);
  assert.equal(state.v, SAVE.VERSION); // fresh current-version state
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
    assert.equal(state.v, SAVE.VERSION);
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

// ═════════════════════════════════════════════════════════════ V2/FIX-A ═══
// Hardening regressions: E9 hostile sleep slice (NaN-poisoned stats), E9
// malformed quests.active rows (quest-board crash), E20 starter-food
// resurrection, E8 harvest-provenance persistence.

test('V2/FIX-A (E9): the exact hostile sleep payload boots to a usable state', async () => {
  // sleep:{sleeping:'yes',startedAt:'dawn',wakeAt:'tomorrow'} used to survive
  // validate() → offline.js computed NaN minutes → applyTick NaN'd ALL stats
  // forever (wakeAt was never rewritten, so every boot re-poisoned).
  const hostile = {
    ...defaultState(),
    sleep: { sleeping: 'yes', startedAt: 'dawn', wakeAt: 'tomorrow' },
    lastTickAt: Date.now() - 3600_000, // 1 h "offline"
  };
  const { state, recovered } = loadRaw(hostile);
  assert.equal(recovered, false, 'not a corruption recovery — normalized in place');
  assert.deepEqual(state.sleep, { sleeping: false, startedAt: 0, wakeAt: 0 });

  // …and the offline catch-up sim stays finite end-to-end
  const { simulateOffline } = await import('../src/systems/offline.js');
  const sim = simulateOffline(state, Date.now());
  for (const [k, v] of Object.entries(sim.state.stats)) {
    assert.ok(Number.isFinite(v), `stats.${k} finite after offline sim (got ${v})`);
  }
  // NaN can never persist: a re-load of the simulated state stays finite
  const again = loadRaw({ ...state, stats: sim.state.stats });
  for (const [k, v] of Object.entries(again.state.stats)) {
    assert.ok(Number.isFinite(v), `stats.${k} finite after reload (got ${v})`);
  }
});

test('V2/FIX-A (E9): sleep leaves normalize; valid sleeps survive untouched', () => {
  // wrong-typed sleeping with VALID times → sleeping coerced to false
  const junkFlag = loadRaw({ ...defaultState(), sleep: { sleeping: 'yes', startedAt: 5, wakeAt: 10 } });
  assert.deepEqual(junkFlag.state.sleep, { sleeping: false, startedAt: 5, wakeAt: 10 });
  // any non-finite time resets the whole slice to not-sleeping
  for (const sleep of [
    { sleeping: true, startedAt: 1, wakeAt: 'tomorrow' },
    { sleeping: true, startedAt: {}, wakeAt: 2 },
    { sleeping: true, startedAt: 'x', wakeAt: 'y' },
  ]) {
    const { state } = loadRaw({ ...defaultState(), sleep });
    assert.deepEqual(state.sleep, { sleeping: false, startedAt: 0, wakeAt: 0 }, JSON.stringify(sleep));
  }
  // a legitimate in-progress sleep passes through verbatim
  const real = { sleeping: true, startedAt: 1780000000000, wakeAt: 1780001620000 };
  assert.deepEqual(loadRaw({ ...defaultState(), sleep: real }).state.sleep, real);
});

test('V2/FIX-A (E9): malformed quests.active rows are sanitized on load', () => {
  const day = new Date().toISOString().slice(0, 10); // matches localDay format
  const hostile = {
    ...defaultState(),
    quests: {
      day, // day matches → rollDaily will NOT rebuild the board
      active: [
        { id: 42 },                                        // non-string id → dropped
        null,                                              // null row → dropped
        'x',                                               // primitive row → dropped
        [1, 2],                                            // array row → dropped
        { id: '' },                                        // empty id → dropped
        { id: 'q.feed3', progress: '2', claimed: 'yes' },  // coerced
        { id: 'q.wash1', progress: 'lots', claimed: 0, seen: 'abc' }, // junk progress/seen
        { id: 'q.play2distinct', progress: 1, claimed: false, seen: ['runner', 7] },
      ],
      rerolledDay: '',
      completedTotal: 0,
    },
  };
  const { state, recovered } = loadRaw(hostile);
  assert.equal(recovered, false);
  assert.deepEqual(state.quests.active, [
    { id: 'q.feed3', progress: 2, claimed: true },
    { id: 'q.wash1', progress: 0, claimed: false },
    { id: 'q.play2distinct', progress: 1, claimed: false, seen: ['runner', '7'] },
  ]);
});

test('V2/FIX-A (E20): consumed starter food stays consumed across reloads', () => {
  // consume all 3 starter carrots through the real inventory op (deletes the key)
  const s = defaultState();
  let inv = s.inventory;
  for (let i = 0; i < 3; i += 1) inv = removeInv(inv, 'carrot');
  s.inventory = inv;
  assert.equal('carrot' in s.inventory, false, 'fixture: key deleted at 0');
  const { state, recovered } = loadRaw(s);
  assert.equal(recovered, false);
  assert.equal(state.inventory.carrot ?? 0, 0, 'carrots must NOT resurrect');
  assert.equal(state.inventory.apple, 1, 'untouched foods survive');
  // …and the roundtrip stays stable
  persist(state);
  assert.equal(load().state.inventory.carrot ?? 0, 0);
  // a MISSING inventory slice still gets the §C5.1 starter defaults (F2)
  const { v: _v2, inventory: _inv, ...noInv } = defaultState();
  const fresh = loadRaw({ ...noInv, v: 2 });
  assert.equal(fresh.recovered, false);
  assert.deepEqual(fresh.state.inventory, { carrot: 3, apple: 1, cupcake: 1 });
  // wrong-typed inventory is still corruption → recovery (F2 intact)
  assert.equal(loadRaw({ ...defaultState(), inventory: 'nope' }).recovered, true);
});

test('V2/FIX-A (E8): harvested-provenance items keys persist and default to 0', () => {
  const s = defaultState();
  s.items['harvested:radish'] = 2;
  const { state, recovered } = loadRaw(s);
  assert.equal(recovered, false);
  assert.equal(state.items['harvested:radish'], 2, 'provenance counter survives');
  // pre-fix saves have no counters — they read as absent (economy treats as 0)
  const pre = loadRaw(fixture('v1-midgame.json')).state;
  assert.equal(Object.keys(pre.items).some((k) => k.startsWith('harvested:')), false);
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
