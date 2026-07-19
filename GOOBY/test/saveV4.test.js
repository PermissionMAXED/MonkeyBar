// V4/G53 — save schema v4 + v3 → v4 AND v1 → v4 migrations (PLAN4 §B1,
// binding). Fixtures under test/fixtures/ prove losslessness:
//   (a) v3-midgame.json — a rich v3 save (level 23, 16 game boards, stickers,
//       nougat installed, devUnlocked, uiScale 115, unknown mod keys)
//   (b) v1-fresh/v1-midgame/v1-extra-keys.json + v2-midgame.json — chain
// Asserts: post-load v === 4; EVERY legacy leaf identical (field-diff walk)
// EXCEPT the ONE sanctioned §B1 furniture delta (the migrations[3] radio
// gift); every §B1 v4 addition at its exact default (radio/codes/modifiers/
// recap/gallery slices, settings.gyro/controls/goobyWeltQuality, §G5.5
// minigame containers, the 5 new counters); recap retro-safety init
// (lastRecapLevel = ⌊level/5⌋·5, §C-SYS2.4 baseline FROM the migrating
// state); radio-grant idempotence; §B1 #5 validate() clamps incl. the
// ≤ now() + 24 h hostile-timestamp collapses; whatsNew4Seen arming; and a
// ≥ 100-seed hostile fuzz battery targeting the SIX new v4 slices.
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

// --- §B1 v4 defaults, hardcoded as an independent spec copy -----------------

const B1_V4_SLICE_DEFAULTS = () => ({
  radio: {
    station: 'bordmusik', playing: false, shuffle: true,
    replaceContext: true, lastTrack: '', trims: {},
  },
  codes: { redeemed: {}, lockUntil: 0, buffs: { doubleCoinsUntil: 0 } },
  modifiers: {
    nextAt: 0, seed: 0, current: null, lastGameId: '', dayCoins: 0, dayCoinsDay: '',
  },
  recap: { lastRecapLevel: 0, baseline: {}, baselineAt: 0, pendingLevel: 0, history: [] },
  gallery: { count: 0, lastAddedAt: 0, hintShown: false },
});

const B1_V4_SETTINGS_DEFAULTS = {
  gyro: false,
  controls: { invertX: false, invertY: false },
  goobyWeltQuality: 'high',
};

const G55_V4_MINIGAME_DEFAULTS = {
  difficulty: {}, beaten: {}, bestByDiff: {}, endlessBest: {},
};

const B1_V4_COUNTERS = {
  codesRedeemed: 0, modifierPlays: 0, recapsSeen: 0, radioMinutes: 0, galleryPhotos: 0,
};

/** §C-SYS2.4 snapshot keys (recap baseline shape — independent copy). */
const SNAPSHOT_KEYS = [
  'snapshotAtMs', 'level', 'coinsEarned', 'coinsSpent', 'distanceM', 'photos',
  'playsTotal', 'stickerCount',
  'feeds', 'washes', 'sleeps', 'tickles', 'trips', 'harvests', 'plantings',
  'waterings', 'questsDone', 'deliveries', 'cures', 'nougatGlobs',
  'cakesServed', 'surfRuns',
];

// ------------------------------------------------------------------ schema

test('SAVE.VERSION is 4 and the chain has one migration per step (§B1)', () => {
  assert.equal(SAVE.VERSION, 4);
  assert.equal(migrations.length, 4); // v0→1, v1→2, v2→3, v3→4
});

test('fresh defaultState: §B1 v4 slices/settings/counters at exact defaults', () => {
  const s = defaultState();
  assert.equal(s.v, 4);
  const defaults = B1_V4_SLICE_DEFAULTS();
  for (const slice of ['radio', 'codes', 'recap', 'gallery']) {
    assert.deepEqual(s[slice], defaults[slice], `defaultState().${slice}`);
  }
  // modifiers: seed is pre-derived on fresh saves (§B1: createdAt-stable)
  assert.deepEqual(s.modifiers, {
    ...defaults.modifiers,
    seed: Math.floor(s.createdAt) % 4294967296,
  });
  assert.equal(s.settings.gyro, false);
  assert.deepEqual(s.settings.controls, B1_V4_SETTINGS_DEFAULTS.controls);
  assert.equal(s.settings.goobyWeltQuality, 'high');
  for (const [k, def] of Object.entries(G55_V4_MINIGAME_DEFAULTS)) {
    assert.deepEqual(s.minigames[k], def, `minigames.${k}`);
  }
  assertSubset(s.achievements.counters, B1_V4_COUNTERS, '$.achievements.counters');
  // fresh saves never see the "What's new in 4.0" panel (§B1)
  assert.equal(s.onboarding.whatsNew4Seen, true);
});

test('fresh defaultState: the §C-SYS1.4 radio gift is owned AND placed', () => {
  const s = defaultState();
  assert.deepEqual(s.furniture, {
    owned: ['radio'], placed: { 'living:shelf1': 'radio' },
  });
});

// ----------------------------------------------- v3 → v4 fixture migration

test('v3-midgame.json: v → 4, EVERY v3 leaf intact, §B1 additions at defaults', () => {
  const v3 = fixture('v3-midgame.json');
  assert.equal(v3.v, 3, 'fixture must be a v3 save');
  const { state, fresh, recovered } = loadRaw(v3);
  assert.equal(fresh, false);
  assert.equal(recovered, false);
  assert.equal(state.v, 4);

  // 1. lossless: every v3 leaf passes through verbatim (field-diff walk);
  //    furniture is the ONE sanctioned delta (§B1 radio gift), recap is
  //    initialized (asserted below) — everything else byte-identical.
  const { v: _v, furniture: v3Furniture, ...v3Values } = v3;
  assertSubset(state, v3Values);
  assert.deepEqual(state.furniture.owned, [...v3Furniture.owned, 'radio']);
  assert.deepEqual(state.furniture.placed, {
    ...v3Furniture.placed, 'living:shelf1': 'radio',
  });

  // 2. new slices at exact §B1 defaults (recap/modifiers asserted separately)
  const defaults = B1_V4_SLICE_DEFAULTS();
  for (const slice of ['radio', 'codes', 'gallery']) {
    assert.deepEqual(state[slice], defaults[slice], `v3 → ${slice}`);
  }
  // modifiers: defaults except the derived seed (§B1: 0 → createdAt-derived)
  assert.deepEqual(state.modifiers, {
    ...defaults.modifiers,
    seed: v3.createdAt % 4294967296,
  });

  // 3. settings additions defaults-first; every v1–v3 key verbatim
  assert.equal(state.settings.gyro, false);
  assert.deepEqual(state.settings.controls, { invertX: false, invertY: false });
  assert.equal(state.settings.goobyWeltQuality, 'high');
  assert.equal(state.settings.uiScale, 115);
  assert.equal(state.settings.devUnlocked, true);
  assert.equal(state.settings.music, false);
  assert.equal(state.settings.lang, 'de');

  // 4. §G5.5 minigame containers at defaults; v3 boards verbatim
  for (const [k, def] of Object.entries(G55_V4_MINIGAME_DEFAULTS)) {
    assert.deepEqual(state.minigames[k], def, `minigames.${k}`);
  }
  assert.deepEqual(state.minigames.best, v3.minigames.best);

  // 5. counters gain the §B1 additions at 0 — every v3 value untouched
  assertSubset(state.achievements.counters, B1_V4_COUNTERS);
  assert.equal(state.achievements.counters.feeds, 55);
  assert.equal(state.achievements.counters.surfRuns, 9);

  // 6. migrated veterans get the one-time 4.0 panel; older flags untouched
  assert.equal(state.onboarding.whatsNew4Seen, false);
  assert.equal(state.onboarding.whatsNew3Seen, true);
  assert.equal(state.onboarding.whatsNew2Seen, true);

  // 7. unknown keys survive (forward-compatible merge)
  assert.deepEqual(state.futureFeature, { hello: 'from a mod', nested: [1, 2, 3] });
});

test('v3 → v4 recap retro-safety: L23 → lastRecapLevel 20, baseline FROM the save (§B1 #3)', () => {
  const v3 = fixture('v3-midgame.json');
  const before = Date.now();
  const { state } = loadRaw(v3);
  const after = Date.now();
  const r = state.recap;
  assert.equal(r.lastRecapLevel, 20); // ⌊23/5⌋·5 — no instant recap spam
  assert.equal(r.pendingLevel, 0);
  assert.deepEqual(r.history, []);
  assert.ok(r.baselineAt >= before && r.baselineAt <= after, 'baselineAt = migration now()');
  // the §C-SYS2.4 snapshot is taken from the MIGRATING state, verbatim
  assert.deepEqual(Object.keys(r.baseline).sort(), [...SNAPSHOT_KEYS].sort());
  assert.equal(r.baseline.level, 23);
  assert.equal(r.baseline.coinsEarned, 9876);
  assert.equal(r.baseline.coinsSpent, 6666);
  assert.equal(r.baseline.distanceM, 15300);
  assert.equal(r.baseline.photos, 5);
  assert.equal(
    r.baseline.playsTotal,
    Object.values(v3.minigames.plays).reduce((a, b) => a + b, 0)
  );
  assert.equal(r.baseline.stickerCount, Object.keys(v3.stickers.unlocked).length);
  assert.equal(r.baseline.feeds, 55);
  assert.equal(r.baseline.nougatGlobs, 3);
  assert.equal(r.baseline.surfRuns, 9);
  assert.equal(r.baseline.snapshotAtMs, r.baselineAt);
});

test('recap baseline init math: levels 1/4/5/23/40 → ⌊level/5⌋·5 (§B1 #3)', () => {
  for (const [level, want] of [[1, 0], [4, 0], [5, 5], [23, 20], [40, 40]]) {
    const v3 = { ...fixture('v3-midgame.json'), level, xp: 0 };
    const { state, recovered } = loadRaw(v3);
    assert.equal(recovered, false, `level ${level}`);
    assert.equal(state.recap.lastRecapLevel, want, `level ${level} → ${want}`);
    assert.equal(state.recap.baseline.level, Math.max(1, level));
  }
});

// ------------------------------------------- v1/v2 → v4 whole-chain migrations

for (const name of ['v1-fresh.json', 'v1-midgame.json', 'v1-extra-keys.json', 'v2-midgame.json']) {
  test(`${name} chain: v → 4, every legacy leaf intact, v4 additions at defaults`, () => {
    const legacy = fixture(name);
    const { state, recovered } = loadRaw(legacy);
    assert.equal(recovered, false);
    assert.equal(state.v, 4);

    // lossless (furniture = the sanctioned radio delta)
    const { v: _v, furniture: legacyFurniture, ...legacyValues } = legacy;
    assertSubset(state, legacyValues);
    assert.deepEqual(state.furniture.owned, [...(legacyFurniture?.owned ?? []), 'radio']);
    assert.deepEqual(state.furniture.placed, {
      ...legacyFurniture?.placed, 'living:shelf1': 'radio',
    });

    // v4 slices at defaults (modifiers.seed derived from createdAt)
    const defaults = B1_V4_SLICE_DEFAULTS();
    for (const slice of ['radio', 'codes', 'gallery']) {
      assert.deepEqual(state[slice], defaults[slice], `${name} → ${slice}`);
    }
    assert.equal(state.modifiers.seed, Math.floor(state.createdAt) % 4294967296);
    assertSubset(state.achievements.counters, B1_V4_COUNTERS);
    assert.equal(state.onboarding.whatsNew4Seen, false);
    // recap initialized from the migrating state's level
    const level = Math.floor(Number(legacy.level) || 1);
    assert.equal(state.recap.lastRecapLevel, Math.floor(Math.min(40, level) / 5) * 5);
    assert.ok(state.recap.baselineAt > 0);
  });
}

// ---------------------------------------------- radio-grant idempotence (§B1)

test('radio grant is idempotent: migrating twice never duplicates (§B1)', () => {
  // hop 1: v3 → v4
  const first = loadRaw(fixture('v3-midgame.json')).state;
  assert.deepEqual(first.furniture.owned.filter((id) => id === 'radio'), ['radio']);
  // hop 2: re-feed the MIGRATED state through migrations[3] directly
  const again = migrations[3]({ ...structuredClone(first), v: 3 });
  assert.deepEqual(again.furniture.owned.filter((id) => id === 'radio'), ['radio']);
  assert.equal(again.furniture.placed['living:shelf1'], 'radio');
  // …and a plain reload of the persisted v4 state changes nothing
  persist(first);
  const reload = load();
  assert.equal(reload.recovered, false);
  assert.deepEqual(reload.state.furniture, first.furniture);
});

test('radio grant never overwrites a player placement on living:shelf1 (§B1)', () => {
  const v3 = fixture('v3-midgame.json');
  v3.furniture.placed['living:shelf1'] = 'speaker'; // owned in the fixture
  const { state } = loadRaw(v3);
  assert.equal(state.furniture.placed['living:shelf1'], 'speaker', 'placement kept');
  assert.ok(state.furniture.owned.includes('radio'), 'ownership still granted');
});

test('a v3 save that already owns the old radio id is not double-granted', () => {
  const v3 = fixture('v3-midgame.json');
  v3.furniture.owned = [...v3.furniture.owned, 'radio']; // v2-catalog sideboard id
  const { state } = loadRaw(v3);
  assert.deepEqual(state.furniture.owned.filter((id) => id === 'radio'), ['radio']);
});

test('a CURRENT v4 save loads without a migration and without drift', () => {
  const s = defaultState();
  s.radio = {
    station: 'goobyfm', playing: true, shuffle: false, replaceContext: false,
    lastTrack: 'bordmusik-ragnar', trims: { 'bordmusik-ragnar': { vol: 55, on: false } },
  };
  s.codes.redeemed = { updateLiebe: 1784281000000 };
  s.codes.buffs.doubleCoinsUntil = Date.now() + 5 * 60000;
  s.modifiers.nextAt = Date.now() + 3600000;
  s.recap = {
    lastRecapLevel: 5, baseline: { level: 5, feeds: 3 }, baselineAt: 1784281000000,
    pendingLevel: 0, history: [{ level: 5, at: 1784281000000, stats: [] }],
  };
  s.gallery = { count: 7, lastAddedAt: 1784281000000, hintShown: true };
  s.settings.gyro = true;
  s.settings.controls = { invertX: true, invertY: false };
  s.settings.goobyWeltQuality = 'low';
  const { state, recovered } = loadRaw(s);
  assert.equal(recovered, false);
  // station id validity depends on the music registry — everything else must
  // pass through verbatim; 'goobyfm' is a §C-SYS1.2 station (GoobyMusic).
  assert.deepEqual(state.codes, s.codes);
  assert.deepEqual(state.modifiers, s.modifiers);
  assert.deepEqual(state.recap, s.recap);
  assert.deepEqual(state.gallery, s.gallery);
  assert.equal(state.settings.gyro, true);
  assert.deepEqual(state.settings.controls, { invertX: true, invertY: false });
  assert.equal(state.settings.goobyWeltQuality, 'low');
  assert.deepEqual(state.radio.trims, s.radio.trims);
  assert.equal(state.radio.playing, true);
  assert.equal(state.radio.shuffle, false);
  assert.equal(state.radio.replaceContext, false);
  assert.equal(state.radio.lastTrack, 'bordmusik-ragnar');
});

// ---------------------------------------------- validate() clamps (§B1 #5)

test('hostile far-future stamps collapse to ≤ now() + 24 h (§B1 #5)', () => {
  const cap = Date.now() + 24 * 3600000 + 5000; // small slack for test runtime
  const s = defaultState();
  s.codes.lockUntil = 9e15;
  s.codes.buffs.doubleCoinsUntil = 9e15; // would be a PERMANENT ×2 buff
  s.modifiers.nextAt = 9e15;
  const { state, recovered } = loadRaw(s);
  assert.equal(recovered, false, 'clamped, not corruption');
  assert.ok(state.codes.lockUntil <= cap, 'lockUntil collapsed');
  assert.ok(state.codes.lockUntil > Date.now(), 'not zeroed');
  assert.ok(state.codes.buffs.doubleCoinsUntil <= cap, 'doubleCoinsUntil collapsed');
  assert.ok(state.modifiers.nextAt <= cap, 'nextAt collapsed');
});

test('legitimate near-future stamps pass through unclamped (§B1 #5)', () => {
  const s = defaultState();
  const lock = Date.now() + 25000; // mid-lockout
  const buff = Date.now() + 9 * 60000; // mid-buff
  const next = Date.now() + 3 * 3600000; // modifier in 3 h
  s.codes.lockUntil = lock;
  s.codes.buffs.doubleCoinsUntil = buff;
  s.modifiers.nextAt = next;
  const { state } = loadRaw(s);
  assert.equal(state.codes.lockUntil, lock);
  assert.equal(state.codes.buffs.doubleCoinsUntil, buff);
  assert.equal(state.modifiers.nextAt, next);
});

test('junk timestamp leaves → 0 (never NaN, never negative)', () => {
  for (const junk of ['soon', -5, NaN, Infinity, null, [], {}]) {
    const s = defaultState();
    s.codes.lockUntil = junk;
    s.codes.buffs.doubleCoinsUntil = junk;
    s.modifiers.nextAt = junk;
    const { state } = loadRaw(s);
    assert.equal(state.codes.lockUntil, 0, `lockUntil ${String(junk)}`);
    assert.equal(state.codes.buffs.doubleCoinsUntil, 0, `buff ${String(junk)}`);
    assert.equal(state.modifiers.nextAt, 0, `nextAt ${String(junk)}`);
  }
});

test('radio.station coerces to bordmusik on junk; booleans/trims normalize (§B1 #5)', () => {
  const s = defaultState();
  s.radio.station = 'pirateFm';
  s.radio.playing = 'yes';
  s.radio.shuffle = 0;
  s.radio.replaceContext = 'nope';
  s.radio.lastTrack = 42;
  s.radio.trims = {
    a: { vol: 999, on: false },   // vol clamps to 150
    b: { vol: -10, on: 'junk' },  // vol clamps to 0, junk on → true
    c: { vol: 'loud' },           // junk vol → 100, absent on → true
    d: 'nope',                    // non-object row dropped
    e: [1, 2],                    // array row dropped
  };
  const { state, recovered } = loadRaw(s);
  assert.equal(recovered, false);
  assert.equal(state.radio.station, 'bordmusik');
  assert.equal(state.radio.playing, false);
  assert.equal(state.radio.shuffle, true);
  assert.equal(state.radio.replaceContext, true);
  assert.equal(state.radio.lastTrack, '');
  assert.deepEqual(state.radio.trims, {
    a: { vol: 150, on: false },
    b: { vol: 0, on: true },
    c: { vol: 100, on: true },
  });
});

test('codes.redeemed junk entries collapse to a TRUTHY 1 — single-use holds (§B1 #5)', () => {
  const s = defaultState();
  s.codes.redeemed = { updateLiebe: 'yesterday', herzGooby: -3, other: 1784281000000 };
  const { state } = loadRaw(s);
  assert.equal(state.codes.redeemed.updateLiebe, 1, 'junk → 1 (still redeemed)');
  assert.equal(state.codes.redeemed.herzGooby, 1);
  assert.equal(state.codes.redeemed.other, 1784281000000, 'valid stamp verbatim');
  for (const v of Object.values(state.codes.redeemed)) assert.ok(v, 'every entry truthy');
});

test('modifiers.current: junk/expired/unknown rows → null; well-formed survives (§B1 #5)', () => {
  const good = {
    gameId: 'runner', type: 'doppelGold',
    startedAt: Date.now() - 60000, endsAt: Date.now() + 3600000, playsLeft: 3,
  };
  const bad = [
    'doppelGold',
    ['runner'],
    { gameId: 'notAGame', type: 'doppelGold', startedAt: 1, endsAt: Date.now() + 9e5, playsLeft: 1 },
    { gameId: 'runner', type: 'notAType', startedAt: 1, endsAt: Date.now() + 9e5, playsLeft: 1 },
    { gameId: 'runner', type: 'doppelGold', startedAt: 1, endsAt: Date.now() - 1000, playsLeft: 1 }, // expired
    { gameId: 'runner', type: 'doppelGold', startedAt: 1, endsAt: Date.now() + 9e5, playsLeft: 1.5 },
  ];
  for (const cur of bad) {
    const s = defaultState();
    s.modifiers.current = cur;
    assert.equal(loadRaw(s).state.modifiers.current, null, JSON.stringify(cur));
  }
  const s = defaultState();
  s.modifiers.current = good;
  assert.deepEqual(loadRaw(s).state.modifiers.current, good);
});

test('modifiers.seed: junk/0 derives from createdAt; valid seeds verbatim (§B1)', () => {
  for (const junk of [0, -7, NaN, 'seed', null]) {
    const s = defaultState();
    s.modifiers.seed = junk;
    const { state } = loadRaw(s);
    assert.equal(state.modifiers.seed, Math.floor(state.createdAt) % 4294967296, String(junk));
  }
  const s = defaultState();
  s.modifiers.seed = 123456789;
  assert.equal(loadRaw(s).state.modifiers.seed, 123456789);
});

test('recap.history caps at 8 well-formed rows; junk rows dropped (§B1 #5)', () => {
  const s = defaultState();
  const row = (level) => ({ level, at: 1784281000000 + level, stats: [] });
  s.recap.history = [
    'junk', null, [1], { level: 'x', at: 1 }, { at: 2 }, // 5 junk rows dropped
    ...Array.from({ length: 10 }, (_, i) => row(5 * (i + 1) > 40 ? 40 : 5 * (i + 1))),
  ];
  const { state } = loadRaw(s);
  assert.equal(state.recap.history.length, 8, 'capped at the LAST 8');
  assert.deepEqual(state.recap.history[0], row(15), 'oldest surviving row');
  for (const r of state.recap.history) {
    assert.ok(Number.isFinite(Number(r.level)) && Number.isFinite(Number(r.at)));
  }
  // milestone ints clamp 0–40
  const t = defaultState();
  t.recap.lastRecapLevel = 99;
  t.recap.pendingLevel = -4;
  const { state: u } = loadRaw(t);
  assert.equal(u.recap.lastRecapLevel, 40);
  assert.equal(u.recap.pendingLevel, 0);
});

test('gallery: count int 0–40, lastAddedAt ≥ 0, hintShown strict boolean (§B1 #5)', () => {
  const cases = [
    [{ count: 99, lastAddedAt: -1, hintShown: 1 }, { count: 40, lastAddedAt: 0, hintShown: false }],
    [{ count: -3, lastAddedAt: 'never', hintShown: 'yes' }, { count: 0, lastAddedAt: 0, hintShown: false }],
    [{ count: 12.7, lastAddedAt: 1784281000000, hintShown: true }, { count: 12, lastAddedAt: 1784281000000, hintShown: true }],
  ];
  for (const [patch, want] of cases) {
    const s = defaultState();
    s.gallery = patch;
    assert.deepEqual(loadRaw(s).state.gallery, want, JSON.stringify(patch));
  }
});

test('gyro/invert toggles strict booleans; goobyWeltQuality one of 2 stops (§B1 #5)', () => {
  const s = defaultState();
  s.settings.gyro = 1;
  s.settings.controls = { invertX: 'yes', invertY: 1 };
  s.settings.goobyWeltQuality = 'ultra';
  const { state } = loadRaw(s);
  assert.equal(state.settings.gyro, false);
  assert.deepEqual(state.settings.controls, { invertX: false, invertY: false });
  assert.equal(state.settings.goobyWeltQuality, 'high');
});

test('furniture.placed is taken VERBATIM — unplacing the radio survives reloads', () => {
  const s = defaultState();
  s.furniture.placed = {}; // the player unplaced the radio gift
  const { state, recovered } = loadRaw(s);
  assert.equal(recovered, false);
  assert.deepEqual(state.furniture.placed, {}, 'no resurrection via mergeDefaults');
  persist(state);
  assert.deepEqual(load().state.furniture.placed, {});
});

// ------------------------------------------------ refusal + recovery (§B1)

test('forward version v:5 refuses: fresh state + corrupt backup', () => {
  const payload = JSON.stringify({ ...defaultState(), v: 5, coins: 424242 });
  const { state, fresh, recovered } = loadRaw(payload);
  assert.equal(fresh, false);
  assert.equal(recovered, true);
  assert.equal(state.v, 4);
  assert.notEqual(state.coins, 424242, 'future coins NOT imported');
  assert.equal(backing.get(SAVE.CORRUPT_KEY), payload);
});

test('wrong-typed NEW v4 slices are corruption → recovery, never a crash', () => {
  const hostile = [
    { v: 4, radio: 'loud' },
    { v: 4, radio: [1, 2] },
    { v: 4, codes: 'secret' },
    { v: 4, codes: { redeemed: 'all', lockUntil: 0, buffs: {} } },
    { v: 4, modifiers: 42 },
    { v: 4, recap: 'story' },
    { v: 4, gallery: [] },
    { v: 4, settings: { controls: 'inverted' } },
    { v: 3, radio: 'pre-set junk in a v3 save' }, // migration must not object-ify
    { v: 3, codes: [] },
    { v: 1, gallery: 'junk from the future' },
  ];
  for (const payload of hostile) {
    const raw = JSON.stringify(payload);
    let result;
    assert.doesNotThrow(() => {
      result = loadRaw(raw);
    }, `load() must not throw for ${raw}`);
    assert.equal(result.recovered, true, `${raw} should recover`);
    assert.equal(result.state.v, 4);
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

/** Dot-paths targeting the SIX new v4 slices (§B1) plus their hot leaves. */
const FUZZ_PATHS_V4 = [
  'radio', 'radio.station', 'radio.playing', 'radio.shuffle', 'radio.trims',
  'radio.trims.bordmusik-ragnar', 'radio.lastTrack', 'radio.replaceContext',
  'codes', 'codes.redeemed', 'codes.redeemed.updateLiebe', 'codes.lockUntil',
  'codes.buffs', 'codes.buffs.doubleCoinsUntil',
  'modifiers', 'modifiers.nextAt', 'modifiers.seed', 'modifiers.current',
  'modifiers.current.type', 'modifiers.dayCoins', 'modifiers.dayCoinsDay',
  'recap', 'recap.lastRecapLevel', 'recap.baseline', 'recap.baselineAt',
  'recap.pendingLevel', 'recap.history',
  'gallery', 'gallery.count', 'gallery.lastAddedAt', 'gallery.hintShown',
  'settings.gyro', 'settings.controls', 'settings.controls.invertX',
  'settings.goobyWeltQuality',
  'minigames.difficulty', 'minigames.beaten', 'minigames.bestByDiff',
  'minigames.endlessBest',
  'achievements.counters.codesRedeemed', 'achievements.counters.radioMinutes',
  'furniture.owned', 'furniture.placed', 'onboarding.whatsNew4Seen', 'v',
];

/** Set a dot-path on a plain object (parents must exist as objects). */
function setPath(obj, path, value) {
  const keys = path.split('.');
  let at = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (at[keys[i]] == null || typeof at[keys[i]] !== 'object') return;
    at = at[keys[i]];
  }
  at[keys[keys.length - 1]] = value;
}

test('v4 fuzz battery: ≥ 100 seeded mutations on the six new slices never crash', () => {
  const rng = mulberry32(0x60053B75); // deterministic — failures reproduce
  const bases = [
    () => defaultState(),                     // v4
    () => fixture('v3-midgame.json'),         // v3 (migration path)
  ];
  let runs = 0;
  let recoveries = 0;
  for (let i = 0; i < 120; i += 1) {
    const base = bases[i % bases.length]();
    const nMut = 1 + Math.floor(rng() * 3);
    for (let m = 0; m < nMut; m += 1) {
      const path = FUZZ_PATHS_V4[Math.floor(rng() * FUZZ_PATHS_V4.length)];
      const junk = JUNK[Math.floor(rng() * JUNK.length)];
      setPath(base, path, junk);
    }
    const raw = JSON.stringify(base);
    let result;
    assert.doesNotThrow(() => {
      result = loadRaw(raw);
    }, `mutation #${i} must not throw: ${raw.slice(0, 120)}`);
    assert.ok(result.state, `mutation #${i} yields a state`);
    assert.equal(result.state.v, 4, `mutation #${i} lands on v4`);
    // the codes slice must ALWAYS be structurally sound after load
    assert.deepEqual(
      Object.keys(result.state.codes).sort(), ['buffs', 'lockUntil', 'redeemed'],
      `mutation #${i} codes slice structurally sound`
    );
    assert.equal(typeof result.state.radio.station, 'string');
    assert.ok(Number.isFinite(result.state.modifiers.nextAt));
    assert.ok(Array.isArray(result.state.recap.history));
    assert.ok(Number.isFinite(result.state.gallery.count));
    runs += 1;
    if (result.recovered) recoveries += 1;
  }
  assert.ok(runs >= 100, `fuzz corpus size ${runs} ≥ 100`);
  assert.ok(recoveries > 0, 'battery exercised the corrupt-recovery path');
  assert.ok(recoveries < runs, 'battery also exercised the clamp-not-recover path');
});

// ----------------------------------------------------------- idempotency

test('v3 → v4 load is idempotent (load → persist → load, byte-stable)', () => {
  const first = loadRaw(fixture('v3-midgame.json')).state;
  persist(first);
  const bytes1 = backing.get(SAVE.KEY);
  const second = load();
  assert.equal(second.fresh, false);
  assert.equal(second.recovered, false);
  assert.deepEqual(second.state, first);
  persist(second.state);
  assert.equal(backing.get(SAVE.KEY), bytes1); // byte-stable roundtrip
});
