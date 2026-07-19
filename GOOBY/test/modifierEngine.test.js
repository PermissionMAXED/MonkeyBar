// V4/G54 — modifier engine suite (PLAN4 §C-SYS4.7, ≥ 35 tests): frozen
// timing/type/matrix tables, schedule determinism per seed, cadence bounds
// (1000 rolls ∈ [50, 120] min), the no-repeat guard, eligibility filtering
// at levels 1/5/15/40, consume/expire/refund transitions, offline catch-up,
// payout math per type incl. day-cap behavior and the §E0.1-2 daily-×2/
// code-buff stacking order, and the save round-trip of `current`.
//
// The engine is pure (§B4) — most tests drive plain state objects; the
// payout block exercises the REAL economy.awardMinigame path on isolated
// stores with the clock pinned (core/clock.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODIFIER_TIMING,
  MODIFIER_CAPS,
  MODIFIER_TYPES,
  MODIFIER_ELIGIBLE,
  rand01,
  defaultSlice,
  initialSeed,
  eligiblePairs,
  tick,
  consume,
  refund,
  getActiveFor,
  launchParams,
  rollGlueckspilz,
  forceEvent,
  clearEvent,
} from '../src/systems/modifierEngine.js';
import { award, awardMinigame, resetLedgerForTests } from '../src/systems/economy.js';
import { MODIFIER, COIN_TABLE, MINIGAME } from '../src/data/constants.js';
import { MINIGAME_IDS } from '../src/data/minigames.js';
import { isMinigameUnlocked } from '../src/systems/leveling.js';
import * as clock from '../src/core/clock.js';
import { defaultState, persist, load } from '../src/core/save.js';
import { createStore } from '../src/core/store.js';

const MIN = 60000;

/** Local-noon epoch ms for a YYYY-MM-DD day string (like economy.test.js). */
function dayMs(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}
const T0 = dayMs('2026-07-16');
const pin = (ms) => clock.configure({ now: ms });

/** Full-state factory around a modifiers slice (level 40 = everything rolls). */
function stateWith(m, over = {}) {
  return { createdAt: T0, level: 40, modifiers: m, ...over };
}

/** A slice with a known seed and a due nextAt (rolls on the next tick). */
function dueSlice(seed = 12345, nextAt = T0) {
  return { ...defaultSlice(), seed, nextAt };
}

/** isolated store per payout test (autosave off — no timers keep node alive) */
const makeStore = () => createStore(defaultState(), { autosave: false });

// ------------------------------------------------ frozen tables (§C-SYS4.2/4.3)

test('§B4 timing numbers are frozen: grace 30, window 45, cadence [50, 120]', () => {
  assert.equal(MODIFIER_TIMING.GRACE_MIN, 30);
  assert.equal(MODIFIER_TIMING.WINDOW_MIN, 45);
  assert.deepEqual([...MODIFIER_TIMING.CADENCE_MIN], [50, 120]);
  assert.ok(Object.isFrozen(MODIFIER_TIMING));
});

test('§C-SYS11 caps: day cap reads G53\'s constants (150), endless 100, roll 10–60', () => {
  assert.equal(MODIFIER_CAPS.DAY_COIN_CAP, MODIFIER.DAY_COIN_CAP);
  assert.equal(MODIFIER_CAPS.DAY_COIN_CAP, 150);
  assert.equal(MODIFIER_CAPS.ENDLESS_DAY_CAP, 100);
  assert.equal(MODIFIER_CAPS.GLUECKSPILZ_MIN, 10);
  assert.equal(MODIFIER_CAPS.GLUECKSPILZ_MAX, 60);
});

test('§C-SYS4.2 type table: exactly the 6 types with the exact play budgets', () => {
  assert.deepEqual(Object.keys(MODIFIER_TYPES).sort(), [
    'doppelGold', 'glueckspilz', 'muenzregen', 'riesenGooby', 'stickerChance', 'turbo',
  ]);
  const plays = Object.fromEntries(
    Object.values(MODIFIER_TYPES).map((d) => [d.id, d.plays])
  );
  assert.deepEqual(plays, {
    doppelGold: 2, muenzregen: 3, turbo: 3,
    riesenGooby: 3, stickerChance: 2, glueckspilz: 3,
  });
  for (const def of Object.values(MODIFIER_TYPES)) {
    assert.equal(typeof def.nameKey, 'string');
    assert.match(def.color, /^#[0-9A-F]{6}$/i, def.id);
  }
});

test('§C-SYS4.2 tuning params are exact (the ctx.params.modifier payload numbers)', () => {
  assert.equal(MODIFIER_TYPES.doppelGold.coinMult, 2);
  assert.deepEqual({ ...MODIFIER_TYPES.doppelGold.params }, {});
  assert.deepEqual({ ...MODIFIER_TYPES.muenzregen.params }, { coinRate: 1.5 });
  assert.deepEqual({ ...MODIFIER_TYPES.turbo.params }, { speedMult: 1.25, scoreMult: 1.5 });
  assert.deepEqual({ ...MODIFIER_TYPES.riesenGooby.params }, { scale: 1.6, hitboxMult: 1.3 });
  assert.deepEqual({ ...MODIFIER_TYPES.stickerChance.params }, { forceDrop: true });
  assert.deepEqual({ ...MODIFIER_TYPES.glueckspilz.params }, { bonusMin: 10, bonusMax: 60 });
});

test('§C-SYS4.3 all-games rows: 27 arcade games, goobyWelt NEVER included', () => {
  const arcade = MINIGAME_IDS.filter((id) => id !== 'goobyWelt').sort();
  assert.equal(arcade.length, 27);
  for (const type of ['doppelGold', 'glueckspilz', 'stickerChance']) {
    assert.deepEqual([...MODIFIER_ELIGIBLE[type]].sort(), arcade, type);
  }
});

test('§C-SYS4.3 targeted rows: muenzregen/turbo/riesenGooby lists verbatim', () => {
  assert.deepEqual([...MODIFIER_ELIGIBLE.muenzregen], [
    'shoppingSurf', 'cityDrive', 'deliveryRush', 'starHopper', 'harborHopper',
    'rocketRescue', 'toyRacer', 'bunnyHop', 'runner',
  ]);
  assert.deepEqual([...MODIFIER_ELIGIBLE.turbo], [
    'shoppingSurf', 'runner', 'bunnyHop', 'starHopper', 'toyRacer',
    'harborHopper', 'veggieChop', 'carrotCatch',
  ]);
  assert.deepEqual([...MODIFIER_ELIGIBLE.riesenGooby], [
    'shoppingSurf', 'runner', 'bunnyHop', 'trampoline', 'danceParty',
    'goalieGooby', 'starHopper', 'harborHopper',
  ]);
  // every matrix entry is a real minigame id
  for (const [type, row] of Object.entries(MODIFIER_ELIGIBLE)) {
    for (const id of row) assert.ok(MINIGAME_IDS.includes(id), `${type}: ${id}`);
  }
});

// ---------------------------------------------------------- PRNG + slice/seed

test('rand01 is deterministic per position and stays in [0, 1)', () => {
  for (const seed of [0, 1, 42, 123456789, -7, 2 ** 31]) {
    const a = rand01(seed);
    assert.equal(a, rand01(seed), `seed ${seed} re-draw`);
    assert.ok(a >= 0 && a < 1, `seed ${seed} → ${a}`);
  }
  assert.notEqual(rand01(1), rand01(2));
});

test('initialSeed derives from createdAt (uint32) with a non-zero fallback', () => {
  assert.equal(initialSeed({ createdAt: 1234567 }), 1234567);
  assert.equal(initialSeed({ createdAt: 2 ** 32 + 5 }), 5); // same mod as save.js
  assert.equal(initialSeed({ createdAt: 0 }), 1); // sentinel 0 never sticks
  assert.equal(initialSeed({}), 1);
  assert.equal(initialSeed({ createdAt: 'junk' }), 1);
});

test('defaultSlice mirrors the §B1 save shape (incl. the endless day ledger)', () => {
  assert.deepEqual(defaultSlice(), {
    nextAt: 0, seed: 0, current: null, lastGameId: '',
    dayCoins: 0, dayCoinsDay: '', endlessCoins: 0, endlessCoinsDay: '',
  });
});

// -------------------------------------------------------------- scheduling

test('tick on a missing/unscheduled slice sets the 30 min first-boot grace', () => {
  const state = stateWith(undefined);
  const r = tick(state, T0);
  assert.equal(r.event, 'scheduled');
  assert.equal(r.changes.nextAt, T0 + 30 * MIN);
  assert.equal(r.changes.current, null);
  assert.ok(r.changes.seed !== 0, 'seed derived');
  assert.equal(state.modifiers, undefined, 'tick is pure — input untouched');
});

test('tick before nextAt changes nothing (changes: null, no event)', () => {
  const m = { ...defaultSlice(), seed: 7, nextAt: T0 + 10 * MIN };
  const r = tick(stateWith(m), T0);
  assert.deepEqual(r, { changes: null, event: null });
});

test('schedule determinism: the same seed/now/level rolls the identical event', () => {
  const a = tick(stateWith(dueSlice(999)), T0);
  const b = tick(stateWith(dueSlice(999)), T0);
  assert.equal(a.event, 'started');
  assert.deepEqual(a.changes, b.changes);
  const c = tick(stateWith(dueSlice(1000)), T0); // different stream position
  assert.notDeepEqual(
    [c.changes.current.gameId, c.changes.current.type, c.changes.nextAt],
    [a.changes.current.gameId, a.changes.current.type, a.changes.nextAt]
  );
});

test('a roll starts a well-formed §B4 event and advances the seed by 2 draws', () => {
  const r = tick(stateWith(dueSlice(555)), T0);
  const cur = r.changes.current;
  assert.equal(r.event, 'started');
  assert.ok(MODIFIER_TYPES[cur.type], 'known type');
  assert.ok(MODIFIER_ELIGIBLE[cur.type].includes(cur.gameId), 'matrix row');
  assert.equal(cur.startedAt, T0);
  assert.equal(cur.endsAt, T0 + 45 * MIN);
  assert.equal(cur.playsLeft, MODIFIER_TYPES[cur.type].plays);
  assert.equal(r.changes.seed, 557, 'pair draw + cadence draw');
  const cadMin = (r.changes.nextAt - T0) / MIN;
  assert.ok(cadMin >= 50 && cadMin <= 120, `cadence ${cadMin} min`);
});

test('cadence bounds: 1000 seeded rolls all reschedule within [50, 120] min', () => {
  let m = dueSlice(31337);
  let nowMs = T0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 1000; i += 1) {
    const r = tick(stateWith(m), nowMs);
    assert.equal(r.event, 'started', `roll ${i}`);
    const cadMin = (r.changes.nextAt - nowMs) / MIN;
    assert.ok(cadMin >= 50 && cadMin <= 120, `roll ${i}: ${cadMin} min`);
    lo = Math.min(lo, cadMin);
    hi = Math.max(hi, cadMin);
    nowMs = r.changes.nextAt; // jump to the next event (window long expired)
    m = { ...r.changes, current: null };
  }
  assert.ok(lo < 60 && hi > 110, `uniform spread (saw [${lo}, ${hi}])`);
});

test('no-repeat guard: lastGameId is never rolled again back-to-back', () => {
  // level 1 → only carrotCatch/bunnyHop/cityDrive are unlocked; pin one.
  // Each iteration jumps past window + schedule, so ONE tick expires the
  // running event (pinning lastGameId) and rolls the next — guard visible.
  let m = { ...dueSlice(1), lastGameId: 'carrotCatch' };
  let nowMs = T0;
  let prevGame = 'carrotCatch';
  for (let i = 0; i < 300; i += 1) {
    const r = tick(stateWith(m, { level: 1 }), nowMs);
    assert.equal(r.event, 'started', `roll ${i}`);
    assert.notEqual(r.changes.current.gameId, prevGame, `roll ${i}`);
    prevGame = r.changes.current.gameId;
    nowMs = Math.max(r.changes.nextAt, r.changes.current.endsAt) + MIN;
    m = r.changes;
  }
});

test('eligibility filtering at levels 1/5/15/40 (§C-SYS4.7 matrix × unlocks)', () => {
  const counts = {};
  for (const level of [1, 5, 15, 40]) {
    const pairs = eligiblePairs(level);
    counts[level] = pairs.length;
    for (const p of pairs) {
      assert.ok(isMinigameUnlocked(p.gameId, level), `${level}: ${p.gameId} locked`);
      assert.ok(MODIFIER_ELIGIBLE[p.type].includes(p.gameId), `${level}: matrix`);
    }
  }
  assert.ok(counts[1] < counts[5] && counts[5] < counts[15] && counts[15] < counts[40]);
  // level 1: exactly the three L1 games across the matrix rows
  const l1games = new Set(eligiblePairs(1).map((p) => p.gameId));
  assert.deepEqual([...l1games].sort(), ['bunnyHop', 'carrotCatch', 'cityDrive']);
  // level 40 all-games rows contribute all 27 (no goobyWelt anywhere)
  assert.equal(counts[40], 27 * 3 + 9 + 8 + 8);
  assert.ok(!eligiblePairs(40).some((p) => p.gameId === 'goobyWelt'));
});

test('eligiblePairs honors the no-repeat guard and empties at hostile level 0', () => {
  assert.deepEqual(eligiblePairs(0), []);
  const without = eligiblePairs(40, 'shoppingSurf');
  assert.ok(!without.some((p) => p.gameId === 'shoppingSurf'));
  assert.equal(without.length, 26 * 3 + 8 + 7 + 7); // shoppingSurf sits in all 6 rows
});

test('one event at a time: a due nextAt waits while a window is active', () => {
  const started = tick(stateWith(dueSlice(42)), T0).changes;
  // jump past nextAt but stay inside the 45-min window
  const later = Math.min(started.nextAt + 1, started.current.endsAt - MIN);
  const r = tick(stateWith(started), later);
  assert.deepEqual(r, { changes: null, event: null }, 'no double roll');
});

// ------------------------------------------------------ offline catch-up (§C-SYS4.1)

test('offline catch-up: a nextAt that passed while closed starts NOW', () => {
  const m = dueSlice(77, T0 - 10 * 3600000); // due 10 h ago
  const r = tick(stateWith(m), T0);
  assert.equal(r.event, 'started');
  assert.equal(r.changes.current.startedAt, T0, 'starts at boot, not in the past');
  assert.equal(r.changes.current.endsAt, T0 + 45 * MIN);
  assert.ok(r.changes.nextAt > T0, 'reschedule is anchored at now');
});

test('offline catch-up: expired window + due nextAt resolve in ONE tick', () => {
  const started = tick(stateWith(dueSlice(88)), T0).changes;
  const nowMs = Math.max(started.nextAt, started.current.endsAt) + MIN;
  const r = tick(stateWith(started), nowMs);
  assert.equal(r.event, 'started', 'expire, then roll, same tick');
  assert.equal(r.changes.lastGameId, started.current.gameId, 'expiry pinned the guard');
  assert.notEqual(r.changes.current.gameId, started.current.gameId, 'guard respected');
  assert.equal(r.changes.current.startedAt, nowMs);
});

// ------------------------------------------------------------------- expiry

test('expire: now ≥ endsAt clears current, pins lastGameId, keeps the schedule', () => {
  const started = tick(stateWith(dueSlice(3)), T0).changes;
  const m = { ...started, nextAt: T0 + 300 * MIN }; // schedule far out
  const r = tick(stateWith(m), started.current.endsAt);
  assert.equal(r.event, 'expired');
  assert.equal(r.changes.current, null);
  assert.equal(r.changes.lastGameId, started.current.gameId);
  assert.equal(r.changes.nextAt, T0 + 300 * MIN, 'schedule survives');
});

// --------------------------------------------------- consume / refund (§C-SYS4.4)

test('consume decrements playsLeft and snapshots the pre-decrement event', () => {
  const state = stateWith(tick(stateWith(dueSlice(1234)), T0).changes);
  const { gameId, type } = state.modifiers.current;
  const plays = MODIFIER_TYPES[type].plays;
  const r = consume(state, gameId, T0 + MIN);
  assert.equal(r.ok, true);
  assert.equal(r.cleared, plays === 1);
  assert.equal(r.modifier.playsLeft, plays, 'snapshot is pre-decrement');
  assert.equal(state.modifiers.current.playsLeft, plays - 1);
  const active = getActiveFor(state, gameId, T0 + MIN);
  assert.equal(active.remainingPlays, plays - 1);
});

test('the final consume clears the event and pins lastGameId (§B4)', () => {
  const state = stateWith(tick(stateWith(dueSlice(1234)), T0).changes);
  const { gameId, type } = state.modifiers.current;
  let last = null;
  for (let i = 0; i < MODIFIER_TYPES[type].plays; i += 1) {
    last = consume(state, gameId, T0 + MIN);
    assert.equal(last.ok, true, `play ${i + 1}`);
  }
  assert.equal(last.cleared, true);
  assert.equal(state.modifiers.current, null);
  assert.equal(state.modifiers.lastGameId, gameId);
  assert.deepEqual(consume(state, gameId, T0 + 2 * MIN), { ok: false }, 'spent');
});

test('consume refuses the wrong game, no event, and an expired window', () => {
  const fresh = stateWith(tick(stateWith(dueSlice(66)), T0).changes);
  const { gameId, endsAt } = fresh.modifiers.current;
  const other = MINIGAME_IDS.find((id) => id !== gameId && id !== 'goobyWelt');
  assert.deepEqual(consume(fresh, other, T0 + MIN), { ok: false });
  assert.deepEqual(consume(fresh, gameId, endsAt), { ok: false }, 'window over');
  assert.deepEqual(consume(stateWith(defaultSlice()), gameId, T0), { ok: false });
  assert.equal(fresh.modifiers.current.playsLeft, MODIFIER_TYPES[fresh.modifiers.current.type].plays);
});

test('refund restores ONE play and latches refundUsed (max once per event)', () => {
  const state = stateWith(tick(stateWith(dueSlice(2020)), T0).changes);
  const { gameId, type } = state.modifiers.current;
  const plays = MODIFIER_TYPES[type].plays;
  const snap = consume(state, gameId, T0 + MIN).modifier;
  assert.deepEqual(refund(state, snap, T0 + 2 * MIN), { ok: true });
  assert.equal(state.modifiers.current.playsLeft, plays);
  assert.equal(state.modifiers.current.refundUsed, true);
  // a second early quit in the same event refunds nothing (anti-farming)
  const snap2 = consume(state, gameId, T0 + 3 * MIN).modifier;
  assert.equal(snap2.refundUsed, true, 'latch rides the snapshot');
  assert.deepEqual(refund(state, snap2, T0 + 4 * MIN), { ok: false });
  assert.equal(state.modifiers.current.playsLeft, plays - 1);
});

test('refund revives an event the final consume just cleared (inside the window)', () => {
  const state = stateWith(tick(stateWith(dueSlice(4711)), T0).changes);
  const { gameId, type } = state.modifiers.current;
  let snap = null;
  for (let i = 0; i < MODIFIER_TYPES[type].plays; i += 1) {
    snap = consume(state, gameId, T0 + MIN).modifier;
  }
  assert.equal(state.modifiers.current, null);
  assert.deepEqual(refund(state, snap, T0 + 2 * MIN), { ok: true });
  assert.equal(state.modifiers.current.playsLeft, 1);
  assert.equal(state.modifiers.current.refundUsed, true);
  assert.equal(state.modifiers.current.endsAt, snap.endsAt, 'original window');
});

test('refund refuses once the 45-min window is over', () => {
  const state = stateWith(tick(stateWith(dueSlice(9)), T0).changes);
  const { gameId } = state.modifiers.current;
  const snap = consume(state, gameId, T0 + MIN).modifier;
  assert.deepEqual(refund(state, snap, snap.endsAt), { ok: false });
  assert.deepEqual(refund(state, null, T0), { ok: false });
});

// -------------------------------------------- getActiveFor / launchParams (§G8)

test('getActiveFor returns the full §G8 descriptor for the modified game', () => {
  const state = stateWith(defaultSlice());
  assert.equal(forceEvent(state, { gameId: 'runner', type: 'doppelGold' }, T0).ok, true);
  const a = getActiveFor(state, 'runner', T0 + MIN);
  assert.equal(a.id, 'doppelGold');
  assert.equal(a.type, 'doppelGold');
  assert.equal(a.nameKey, 'modifier.name.doppelGold');
  assert.equal(a.coinMult, 2);
  assert.equal(a.remainingPlays, 2);
  assert.equal(a.endsAt, T0 + 45 * MIN);
  assert.equal(typeof a.icon, 'string');
  // non-coin types expose tuning params but no coinMult
  const s2 = stateWith(defaultSlice());
  forceEvent(s2, { gameId: 'runner', type: 'turbo' }, T0);
  const t2 = getActiveFor(s2, 'runner', T0 + MIN);
  assert.equal(t2.coinMult, undefined);
  assert.deepEqual({ ...t2.params }, { speedMult: 1.25, scoreMult: 1.5 });
});

test('getActiveFor nulls: goobyWelt, trips, other games, expired, spent (§G8-5)', () => {
  const state = stateWith(defaultSlice());
  forceEvent(state, { gameId: 'shoppingSurf', type: 'muenzregen' }, T0);
  assert.equal(getActiveFor(state, 'goobyWelt', T0 + MIN), null);
  assert.equal(getActiveFor(state, 'runner', T0 + MIN), null, 'different game');
  for (const mode of ['shopTrip', 'vetTrip', 'surfTravel', 'travel']) {
    assert.equal(getActiveFor(state, 'shoppingSurf', T0 + MIN, { mode }), null, mode);
  }
  assert.ok(getActiveFor(state, 'shoppingSurf', T0 + MIN, { mode: 'arcade' }));
  assert.equal(getActiveFor(state, 'shoppingSurf', T0 + 45 * MIN), null, 'expired');
  state.modifiers.current = { ...state.modifiers.current, playsLeft: 0 };
  assert.equal(getActiveFor(state, 'shoppingSurf', T0 + MIN), null, 'spent');
  assert.equal(getActiveFor({}, 'shoppingSurf', T0), null, 'no slice');
});

test('launchParams builds the §E0.1-3 ctx.params.modifier payload per type', () => {
  assert.deepEqual(launchParams({ type: 'doppelGold' }), { type: 'doppelGold', coinMult: 2 });
  assert.deepEqual(launchParams({ type: 'muenzregen' }), { type: 'muenzregen', coinRate: 1.5 });
  assert.deepEqual(launchParams({ type: 'turbo' }), { type: 'turbo', speedMult: 1.25, scoreMult: 1.5 });
  assert.deepEqual(launchParams({ type: 'riesenGooby' }), { type: 'riesenGooby', scale: 1.6, hitboxMult: 1.3 });
  assert.deepEqual(launchParams({ type: 'stickerChance' }), { type: 'stickerChance', forceDrop: true });
  assert.deepEqual(launchParams({ type: 'glueckspilz' }), { type: 'glueckspilz', bonusMin: 10, bonusMax: 60 });
  assert.equal(launchParams({ type: 'nope' }), null);
  assert.equal(launchParams(null), null);
});

// ------------------------------------------------------- glueckspilz roll

test('rollGlueckspilz: seeded 10–60 c, deterministic, advances the stream', () => {
  const a = stateWith({ ...defaultSlice(), seed: 500 });
  const b = stateWith({ ...defaultSlice(), seed: 500 });
  const bonusA = rollGlueckspilz(a);
  assert.equal(bonusA, rollGlueckspilz(b), 'same position, same roll');
  assert.equal(a.modifiers.seed, 501, 'one draw consumed');
  assert.notEqual(rollGlueckspilz(a), undefined);
  assert.equal(a.modifiers.seed, 502);
});

test('rollGlueckspilz: 1000 rolls stay in [10, 60] and reach both bounds', () => {
  const state = stateWith({ ...defaultSlice(), seed: 1 });
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 1000; i += 1) {
    const bonus = rollGlueckspilz(state);
    assert.ok(bonus >= 10 && bonus <= 60, `roll ${i}: ${bonus}`);
    assert.ok(Number.isInteger(bonus));
    lo = Math.min(lo, bonus);
    hi = Math.max(hi, bonus);
  }
  assert.equal(lo, 10);
  assert.equal(hi, 60);
});

// --------------------------------------------------- dev panel force / clear

test('forceEvent starts an event NOW but only for §C-SYS4.3-legal pairs', () => {
  const state = stateWith(defaultSlice());
  assert.deepEqual(
    forceEvent(state, { gameId: 'memoryMatch', type: 'turbo' }, T0),
    { ok: false, reason: 'ineligible' } // memoryMatch is not a speed-loop game
  );
  assert.deepEqual(forceEvent(state, { gameId: 'runner', type: 'nope' }, T0), { ok: false, reason: 'unknown' });
  assert.equal(state.modifiers.current, null);
  assert.equal(forceEvent(state, { gameId: 'trampoline', type: 'riesenGooby' }, T0).ok, true);
  assert.equal(state.modifiers.current.playsLeft, 3);
  assert.equal(state.modifiers.current.endsAt, T0 + 45 * MIN);
  assert.ok(state.modifiers.nextAt > T0, 'schedule initialized');
});

test('clearEvent drops the event, pins the guard, keeps the schedule', () => {
  const state = stateWith(defaultSlice());
  assert.deepEqual(clearEvent(state), { ok: false }, 'nothing to clear');
  forceEvent(state, { gameId: 'bunnyHop', type: 'stickerChance' }, T0);
  const nextAt = state.modifiers.nextAt;
  assert.deepEqual(clearEvent(state), { ok: true });
  assert.equal(state.modifiers.current, null);
  assert.equal(state.modifiers.lastGameId, 'bunnyHop');
  assert.equal(state.modifiers.nextAt, nextAt);
});

// ----------------------------------------------------- save round-trip (§C-SYS4.7)

test('an active event survives the persist → load round-trip intact', () => {
  pin(T0);
  const store = makeStore();
  store.update((s) => {
    forceEvent(s, { gameId: 'starHopper', type: 'muenzregen' }, T0);
    s.modifiers = { ...s.modifiers, seed: 424242, lastGameId: 'runner' };
  });
  persist(store.get());
  const { state, recovered } = load();
  assert.equal(recovered, false);
  assert.deepEqual(state.modifiers.current, {
    gameId: 'starHopper', type: 'muenzregen',
    startedAt: T0, endsAt: T0 + 45 * MIN, playsLeft: 3,
  });
  assert.equal(state.modifiers.seed, 424242, 'stream position survives');
  assert.equal(state.modifiers.lastGameId, 'runner');
  // …and the reloaded event is immediately consumable
  const s2 = state;
  assert.equal(consume(s2, 'starHopper', T0 + MIN).ok, true);
  assert.equal(s2.modifiers.current.playsLeft, 2);
});

// ═══════════════════════════════ payout math per type (§C-SYS4.7 / §E0.1-2) ═══
// The REAL economy.awardMinigame path on isolated stores; carrotCatch row:
// divisor 3, min 4, max 25 (§C6) — clock pinned, daily ×2 controlled per test.

const DAY = '2026-07-16';
const noDaily = (store, id = 'carrotCatch') =>
  store.set(`minigames.lastPlayDay.${id}`, DAY); // repeat play → daily ×1

test('doppelGold pays ×2 after the base chain and books the surplus (§E0.1-2)', () => {
  pin(dayMs(DAY));
  resetLedgerForTests();
  const store = makeStore();
  noDaily(store);
  // base 15 (45/3) → unmodified 15 → doppelGold +15 → paid 30 ≤ 2 × 25
  const r = awardMinigame(store, 'carrotCatch', 45, { modifier: 'doppelGold' });
  assert.equal(r.coins, 30);
  assert.equal(r.modifierType, 'doppelGold');
  assert.equal(r.modifierBonus, 15);
  assert.equal(r.dayCapReached, false);
  assert.equal(store.get('modifiers.dayCoins'), 15, 'surplus booked (§C-SYS11.1 row 5)');
  assert.equal(store.get('modifiers.dayCoinsDay'), DAY);
  assert.equal(store.get('achievements.counters.modifierPlays'), 1);
});

test('doppelGold caps paid ≤ 2 × rowMax — the cap limits the ADDITION only', () => {
  pin(dayMs(DAY));
  const store = makeStore();
  noDaily(store);
  // base clamps to rowMax 25 → wanted min(25, 50−25) = 25 → paid exactly 50
  const atMax = awardMinigame(store, 'carrotCatch', 1_000_000, { modifier: 'doppelGold' });
  assert.equal(atMax.coins, 50);
  assert.equal(atMax.modifierBonus, 25);
  // FIRST play (daily ×2): unmodified 50 already sits AT the cap → bonus 0,
  // paid never drops below the pre-modifier chain (§E0.1-2)
  const store2 = makeStore();
  const daily = awardMinigame(store2, 'carrotCatch', 1_000_000, { modifier: 'doppelGold' });
  assert.equal(daily.firstToday, true);
  assert.equal(daily.coins, 50);
  assert.equal(daily.modifierBonus, 0);
  assert.equal(daily.dayCapReached, false, 'row cap ≠ day cap');
});

test('the frozen stacking order: base × daily(×2) × codeBuff(×2) × doppelGold', () => {
  pin(dayMs(DAY));
  const store = makeStore();
  store.set('codes.buffs.doubleCoinsUntil', dayMs(DAY) + 600000); // 10-min buff
  noDaily(store);
  // repeat play: base 10 (30/3) → buff ×2 = 20 → doppelGold min(20, 50−20)=20 → 40
  const buffed = awardMinigame(store, 'carrotCatch', 30, { modifier: 'doppelGold' });
  assert.equal(buffed.doubleCoinsBuff, true);
  assert.equal(buffed.coins, 40);
  assert.equal(buffed.modifierBonus, 20);
  assert.equal(buffed.xp, 10 + Math.min(15, Math.floor(40 / 2)), 'XP reads the PAID coins');
  // theoretical ×8 is triple-gated: first play → 10 ×2 ×2 = 40, doppelGold
  // tops out at 2 × rowMax = 50 (never 80)
  const store2 = makeStore();
  store2.set('codes.buffs.doubleCoinsUntil', dayMs(DAY) + 600000);
  const triple = awardMinigame(store2, 'carrotCatch', 30, { modifier: 'doppelGold' });
  assert.equal(triple.firstToday, true);
  assert.equal(triple.coins, 50);
  assert.equal(triple.modifierBonus, 10);
});

test('the 150 c day cap truncates the doppelGold surplus („Tagesbonus erreicht")', () => {
  pin(dayMs(DAY));
  const store = makeStore();
  noDaily(store);
  store.update((s) => {
    s.modifiers.dayCoins = 145;
    s.modifiers.dayCoinsDay = DAY;
  });
  // wants +15, headroom 5 → paid 15 + 5, flagged
  const r = awardMinigame(store, 'carrotCatch', 45, { modifier: 'doppelGold' });
  assert.equal(r.modifierBonus, 5);
  assert.equal(r.coins, 20);
  assert.equal(r.dayCapReached, true);
  assert.equal(store.get('modifiers.dayCoins'), 150);
  // cap saturated → doppelGold pays the base chain (§C-SYS11.1 row 5)
  const capped = awardMinigame(store, 'carrotCatch', 45, { modifier: 'doppelGold' });
  assert.equal(capped.coins, 15);
  assert.equal(capped.modifierBonus, 0);
  assert.equal(capped.dayCapReached, true);
});

test('the day ledger rolls over on the next local day (dayCoinsDay)', () => {
  pin(dayMs(DAY));
  const store = makeStore();
  noDaily(store);
  store.update((s) => {
    s.modifiers.dayCoins = 150;
    s.modifiers.dayCoinsDay = DAY;
  });
  assert.equal(awardMinigame(store, 'carrotCatch', 45, { modifier: 'doppelGold' }).modifierBonus, 0);
  pin(dayMs('2026-07-17'));
  noDaily(store); // repeat play on the new day too
  store.set('minigames.lastPlayDay.carrotCatch', '2026-07-17');
  const fresh = awardMinigame(store, 'carrotCatch', 45, { modifier: 'doppelGold' });
  assert.equal(fresh.modifierBonus, 15, 'headroom reset');
  assert.equal(store.get('modifiers.dayCoins'), 15);
  assert.equal(store.get('modifiers.dayCoinsDay'), '2026-07-17');
});

test('non-coin types pay the unmodified chain (muenzregen/turbo/riesenGooby/stickerChance)', () => {
  pin(dayMs(DAY));
  for (const type of ['muenzregen', 'turbo', 'riesenGooby', 'stickerChance']) {
    const store = makeStore();
    noDaily(store);
    const r = awardMinigame(store, 'carrotCatch', 45, { modifier: type });
    assert.equal(r.coins, 15, type); // §C-SYS11.1 row 3: rowMax clamp unchanged
    assert.equal(r.modifierBonus, 0, type);
    assert.equal(r.modifierType, type);
    assert.equal(store.get('modifiers.dayCoins') ?? 0, 0, type);
    assert.equal(store.get('achievements.counters.modifierPlays'), 1, type);
  }
});

test('glueckspilz pays via award(reason) against the same day cap (§C-SYS11.1 row 2)', () => {
  pin(dayMs(DAY));
  const store = makeStore();
  const coins0 = store.get('coins');
  assert.equal(award(store, 35, 'glueckspilz'), 35);
  assert.equal(store.get('modifiers.dayCoins'), 35);
  store.update((s) => { s.modifiers.dayCoins = 150; });
  assert.equal(award(store, 42, 'glueckspilz'), 0, 'capped roll pays 0 („Tagesbonus erreicht")');
  assert.equal(store.get('coins'), coins0 + 35);
  // the 'modifier' reason shares the ledger; 'endless' books separately
  store.update((s) => { s.modifiers.dayCoins = 149; });
  assert.equal(award(store, 10, 'modifier'), 1);
  assert.equal(award(store, 10, 'endless'), 10);
  assert.equal(store.get('modifiers.endlessCoins'), 10);
});

test('the modifier snapshot flows consume → awardMinigame like the framework does', () => {
  pin(dayMs(DAY));
  const store = makeStore();
  noDaily(store, 'runner');
  store.update((s) => { forceEvent(s, { gameId: 'runner', type: 'doppelGold' }, dayMs(DAY)); });
  let snapshot = null;
  store.update((s) => { snapshot = consume(s, 'runner', dayMs(DAY) + MIN).modifier; });
  // runner row: divisor 15, max 30 → base 20 (300/15) → +20 → 40 ≤ 60
  const r = awardMinigame(store, 'runner', 300, { modifier: snapshot });
  assert.equal(r.modifierType, 'doppelGold');
  assert.equal(r.coins, 20 + r.modifierBonus);
  assert.ok(r.coins <= 2 * COIN_TABLE.runner.max);
  assert.equal(store.get('modifiers.current.playsLeft'), 1);
  assert.equal(MINIGAME.DAILY_FIRST_PLAY_MULT, 2, 'stacking constant pinned');
});
