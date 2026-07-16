// Persistence (§E3): roundtrip, migration chain, corruption → backup + fresh
// state, forward-version refusal, validation clamps. Uses a localStorage shim
// (save.js resolves the backend per call) so raw garbage can be injected.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- localStorage shim (installed BEFORE the module is exercised) -----------
const backing = new Map();
globalThis.localStorage = {
  /** @param {string} k */ getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  /** @param {string} k @param {string} v */ setItem: (k, v) => backing.set(k, String(v)),
  /** @param {string} k */ removeItem: (k) => backing.delete(k),
};

const { defaultState, migrations, load, persist, clear } = await import('../src/core/save.js');
const { SAVE, ECONOMY } = await import('../src/data/constants.js');

function wipe() {
  backing.clear();
}

// ---------------------------------------------------------------- fresh state

test('fresh load: no prior save → defaults per §E3', () => {
  wipe();
  const { state, fresh, recovered } = load();
  assert.equal(fresh, true);
  assert.equal(recovered, false);
  assert.equal(state.v, SAVE.VERSION);
  assert.deepEqual(state.stats, { hunger: 80, energy: 90, hygiene: 85, fun: 70 });
  assert.deepEqual(state.sleep, { sleeping: false, startedAt: 0, wakeAt: 0 });
  assert.equal(state.grumpyUntil, 0);
  assert.equal(state.coins, ECONOMY.STARTING_COINS);
  assert.deepEqual(state.inventory, { carrot: 3, apple: 1, cupcake: 1 });
  assert.equal(state.settings.notifications, 'unasked');
  assert.deepEqual(state.daily, { lastClaimDay: '', streak: 0 });
  assert.deepEqual(state.achievements.counters, {
    feeds: 0, washes: 0, sleeps: 0, trips: 0, tickles: 0, petsToday: 0, petsDay: '',
  });
  assert.equal(state.onboarding.done, false);
});

// ---------------------------------------------------------------- roundtrip

test('roundtrip: persist → load preserves G6-owned fields exactly', () => {
  wipe();
  const s = defaultState();
  s.stats = { hunger: 43.21, energy: 12.5, hygiene: 99.999, fun: 0 };
  s.sleep = { sleeping: true, startedAt: 1780000000000, wakeAt: 1780000000000 + 27 * 60000 };
  s.grumpyUntil = 1780000123456;
  s.settings.notifications = 'later:1780000000000';
  s.settings.lang = 'de';
  s.achievements.counters.sleeps = 7;
  s.daily = { lastClaimDay: '2026-07-15', streak: 4 };
  persist(s);
  const { state, fresh, recovered } = load();
  assert.equal(fresh, false);
  assert.equal(recovered, false);
  assert.deepEqual(state.stats, s.stats); // floats survive (§C1: float internally)
  assert.deepEqual(state.sleep, s.sleep);
  assert.equal(state.grumpyUntil, s.grumpyUntil);
  assert.equal(state.settings.notifications, 'later:1780000000000');
  assert.equal(state.settings.lang, 'de');
  assert.equal(state.achievements.counters.sleeps, 7);
  assert.deepEqual(state.daily, s.daily);
});

test('roundtrip: full-state deep equality for an untouched default state', () => {
  wipe();
  const s = defaultState();
  persist(s);
  assert.deepEqual(load().state, s);
});

// ---------------------------------------------------------------- corruption

test('corrupt JSON → fresh state + raw backup under gooby.save.corrupt', () => {
  wipe();
  const garbage = '{"v":1, this is not json!!!';
  backing.set(SAVE.KEY, garbage);
  const { state, fresh, recovered } = load();
  assert.equal(recovered, true);
  assert.equal(fresh, false);
  assert.equal(state.coins, ECONOMY.STARTING_COINS); // fresh defaults
  assert.equal(backing.get(SAVE.CORRUPT_KEY), garbage); // exact raw preserved
});

test('valid JSON but non-object payloads are treated as corrupt', () => {
  for (const raw of ['[1,2,3]', '"hello"', '42', 'null', 'true']) {
    wipe();
    backing.set(SAVE.KEY, raw);
    const { recovered } = load();
    assert.equal(recovered, true, `raw=${raw} should recover`);
    assert.equal(backing.get(SAVE.CORRUPT_KEY), raw);
  }
});

test('load never throws even when the backup write itself fails', () => {
  wipe();
  backing.set(SAVE.KEY, 'garbage{');
  const originalSet = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = () => {
    throw new Error('quota exceeded');
  };
  try {
    const { recovered } = load();
    assert.equal(recovered, true);
  } finally {
    globalThis.localStorage.setItem = originalSet;
  }
});

// ---------------------------------------------------------------- forward version

test('forward-version save (v > current) is refused: backup + fresh state', () => {
  wipe();
  const future = JSON.stringify({ ...defaultState(), v: SAVE.VERSION + 1, coins: 9999 });
  backing.set(SAVE.KEY, future);
  const { state, recovered } = load();
  assert.equal(recovered, true);
  assert.equal(state.coins, ECONOMY.STARTING_COINS); // future coins NOT imported
  assert.equal(backing.get(SAVE.CORRUPT_KEY), future); // preserved for a newer build
});

// ---------------------------------------------------------------- migrations

test('migration chain: v0 (pre-versioned) save migrates to v1, keeps data, fills gaps', () => {
  wipe();
  backing.set(SAVE.KEY, JSON.stringify({ v: 0, coins: 55, stats: { hunger: 33 } }));
  const { state, recovered } = load();
  assert.equal(recovered, false); // migration is NOT a recovery
  assert.equal(state.v, SAVE.VERSION);
  assert.equal(state.coins, 55); // migrated data kept
  assert.equal(state.stats.hunger, 33);
  assert.equal(state.stats.energy, 90); // missing keys filled from defaults
  assert.deepEqual(state.sleep, { sleeping: false, startedAt: 0, wakeAt: 0 });
  assert.equal(state.settings.notifications, 'unasked');
});

test('missing v field counts as v0 and runs the whole chain', () => {
  wipe();
  backing.set(SAVE.KEY, JSON.stringify({ coins: 77 }));
  const { state } = load();
  assert.equal(state.v, SAVE.VERSION);
  assert.equal(state.coins, 77);
});

test('migrations array covers every version step up to SAVE.VERSION', () => {
  assert.equal(migrations.length, SAVE.VERSION);
  for (const [i, fn] of migrations.entries()) {
    assert.equal(typeof fn, 'function', `migrations[${i}] must be a function`);
    const out = fn({ v: i });
    assert.equal(Number(out.v), i + 1, `migrations[${i}] must bump v ${i} → ${i + 1}`);
  }
});

// ---------------------------------------------------------------- validation

test('validation clamps hostile numeric fields on load', () => {
  wipe();
  backing.set(
    SAVE.KEY,
    JSON.stringify({
      v: 1,
      stats: { hunger: 400, energy: -5, hygiene: 'wat', fun: 50 },
      coins: -20,
      level: 99,
      xp: -3,
    })
  );
  const { state } = load();
  assert.equal(state.stats.hunger, 100);
  assert.equal(state.stats.energy, 0);
  assert.equal(state.stats.hygiene, 85); // non-numeric → schema default
  assert.equal(state.stats.fun, 50);
  assert.equal(state.coins, 0);
  assert.equal(state.level, 30);
  assert.equal(state.xp, 0);
});

test('unknown extra keys survive a load (forward-compatible merges)', () => {
  wipe();
  const s = defaultState();
  s.futureFeature = { hello: 'world' };
  persist(s);
  assert.deepEqual(load().state.futureFeature, { hello: 'world' });
});

// ---------------------------------------------------------------- misc

test('clear() wipes the save → next load is fresh', () => {
  wipe();
  persist(defaultState());
  assert.equal(load().fresh, false);
  clear();
  assert.equal(load().fresh, true);
});

test('persist never throws (even on unserializable state)', () => {
  wipe();
  const circular = defaultState();
  circular.self = circular;
  assert.doesNotThrow(() => persist(circular));
});
