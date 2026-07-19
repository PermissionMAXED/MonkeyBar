// V4/G77 — modifier system e2e integration suite (PLAN4 §E G77): closes the
// loop across every seam that G54's engine-unit suite (modifierEngine.test.js)
// leaves to integration —
//   · full scheduled lifecycle state walks (schedule → roll → consume →
//     refund → expire → reschedule) against the real clock plumbing,
//   · the scheduler across SIMULATED DAYS (cadence/window/no-repeat/
//     one-at-a-time invariants over a 3-day 1-min-tick walk),
//   · eligibility × unlock levels through the REAL leveling tables,
//   · offline/reload robustness (mid-window persist→load survival,
//     expired-while-away cleanup, passed-nextAt catch-up on boot),
//   · notification id 8 scheduling HONESTY (§B10): computeSchedule places
//     id 8 exactly at the engine's persisted nextAt (quiet-hours shifted),
//     stable across consume/refund so it fires at most once per event,
//     cap-8/min-spacing pipeline intact, EN+DE copy resolves,
//   · persistence fuzz: seeded junk modifiers slices → load() always yields
//     a sanitized, tick-able slice (never a crash, never junk retained),
//   · the §E0.1-3 cityDrive muenzregen hook + trip-exclusion seam pins
//     (source-scanned — cityDrive.js/framework.js import three/DOM, so the
//     marked blocks are pinned as text like framework2.test.js does).
//
// Pure imports only (§E9 test rule): engine/notifyRules/leveling/save are
// all DOM-free; save.js falls back to its in-memory store under node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MODIFIER_TIMING,
  MODIFIER_TYPES,
  MODIFIER_ELIGIBLE,
  defaultSlice,
  eligiblePairs,
  tick,
  consume,
  refund,
  getActiveFor,
  launchParams,
  forceEvent,
  rand01,
} from '../src/systems/modifierEngine.js';
import { computeSchedule, quietShift, isQuietTime } from '../src/systems/notifyRules.js';
import { NOTIFY, DRIVE_TUNING } from '../src/data/constants.js';
import { isMinigameUnlocked } from '../src/systems/leveling.js';
import { MINIGAMES_BY_ID } from '../src/data/minigames.js';
import { defaultState, persist, load } from '../src/core/save.js';
import * as clock from '../src/core/clock.js';
import { EN as STRINGS_EN, DE as STRINGS_DE } from '../src/data/strings.js';

const MIN = 60000;
/** Local-time timestamp on the fixed test day (2026-07-16, like notifyRules). */
const at = (h, m = 0, dayOffset = 0) => new Date(2026, 6, 16 + dayOffset, h, m, 0, 0).getTime();
/** Noon T0 — comfortably outside the 22:00–08:00 quiet window. */
const T0 = at(12, 0);
const pin = (ms) => clock.configure({ now: ms });

/**
 * Full-state fixture that BOTH the engine (level/createdAt/modifiers) and
 * notifyRules (stats/daily/garden/care quiet by default) can read. Stats sit
 * at/below their thresholds so no stat notification schedules unless a test
 * overrides them (same recipe as notifyRules.test.js).
 */
function fixture({ level = 40, modifiers, stats = {} } = {}) {
  const s = defaultState();
  s.createdAt = T0;
  s.level = level;
  s.stats = { hunger: 20, energy: 100, hygiene: 15, fun: 15, ...stats };
  s.daily = { lastClaimDay: '', streak: 0 };
  if (modifiers) s.modifiers = modifiers;
  return s;
}

/** Apply one engine tick to a state IN PLACE (the timeEngine block's job). */
function applyTick(state, nowMs) {
  const r = tick(state, nowMs);
  if (r.changes) state.modifiers = r.changes;
  return r;
}

const byId = (items, id) => items.find((n) => n.id === id);

// ════════════════════════════════ 1 · full-cycle lifecycle walks (§C-SYS4.1/4.4)

test('full cycle: grace schedule → roll → consume through plays → pin → reschedule', () => {
  const s = fixture({ modifiers: { ...defaultSlice(), seed: 777 } });

  // (1) first tick schedules the 30-min first-boot grace (§C-SYS4.1)
  const r1 = applyTick(s, T0);
  assert.equal(r1.event, 'scheduled');
  assert.equal(s.modifiers.nextAt, T0 + MODIFIER_TIMING.GRACE_MIN * MIN);
  assert.equal(s.modifiers.current, null);

  // (2) before nextAt nothing moves
  assert.deepEqual(tick(s, s.modifiers.nextAt - 1), { changes: null, event: null });

  // (3) at nextAt the event rolls: well-formed §B4 row + cadence reschedule
  const rollAt = s.modifiers.nextAt;
  const r2 = applyTick(s, rollAt);
  assert.equal(r2.event, 'started');
  const cur = s.modifiers.current;
  const def = MODIFIER_TYPES[cur.type];
  assert.ok(def, 'rolled type is one of the 6');
  assert.ok(MODIFIER_ELIGIBLE[cur.type].includes(cur.gameId), 'pair obeys the matrix');
  assert.equal(cur.startedAt, rollAt);
  assert.equal(cur.endsAt, rollAt + MODIFIER_TIMING.WINDOW_MIN * MIN);
  assert.equal(cur.playsLeft, def.plays);
  const gapMin = (s.modifiers.nextAt - rollAt) / MIN;
  assert.ok(gapMin >= 50 && gapMin <= 120, `cadence ${gapMin} ∈ [50, 120]`);

  // (4) play through the full budget — the final consume clears + pins
  const gameId = cur.gameId;
  for (let i = def.plays; i >= 1; i--) {
    const t = rollAt + (def.plays - i + 1) * MIN;
    assert.ok(getActiveFor(s, gameId, t), `play ${def.plays - i + 1} sees the event`);
    const c = consume(s, gameId, t);
    assert.equal(c.ok, true);
    assert.equal(c.modifier.playsLeft, i, 'snapshot is pre-decrement');
  }
  assert.equal(s.modifiers.current, null, 'spent event cleared');
  assert.equal(s.modifiers.lastGameId, gameId, 'no-repeat guard pinned');

  // (5) the pre-rolled nextAt still stands; the next tick there re-rolls and
  // honors the pin
  const nextRollAt = s.modifiers.nextAt;
  const r3 = applyTick(s, nextRollAt);
  assert.equal(r3.event, 'started');
  assert.notEqual(s.modifiers.current.gameId, gameId, 'back-to-back repeat blocked');
});

test('early-quit refund works exactly once per event (anti-farming §C-SYS4.4)', () => {
  const s = fixture({ modifiers: { ...defaultSlice(), seed: 9, nextAt: T0 + 300 * MIN } });
  forceEvent(s, { gameId: 'runner', type: 'turbo' }, T0);
  const c1 = consume(s, 'runner', T0 + MIN);
  assert.equal(s.modifiers.current.playsLeft, 2);
  assert.equal(refund(s, c1.modifier, T0 + 2 * MIN).ok, true, 'first refund lands');
  assert.equal(s.modifiers.current.playsLeft, 3);
  assert.equal(refund(s, c1.modifier, T0 + 3 * MIN).ok, false, 'same snapshot re-refund refused');
  const c2 = consume(s, 'runner', T0 + 4 * MIN);
  assert.equal(refund(s, c2.modifier, T0 + 5 * MIN).ok, false, 'refundUsed latched for the event');
  assert.equal(s.modifiers.current.playsLeft, 2, 'second early quit costs the play');
});

test('nextAt stays put across consume/refund/expiry — only a roll moves it', () => {
  const s = fixture({ modifiers: { ...defaultSlice(), seed: 31 } });
  applyTick(s, T0); // grace
  applyTick(s, s.modifiers.nextAt); // roll
  const nextAt = s.modifiers.nextAt;
  const cur = s.modifiers.current;
  const c = consume(s, cur.gameId, cur.startedAt + MIN);
  assert.equal(s.modifiers.nextAt, nextAt, 'consume never reschedules');
  refund(s, c.modifier, cur.startedAt + 2 * MIN);
  assert.equal(s.modifiers.nextAt, nextAt, 'refund never reschedules');
  applyTick(s, cur.endsAt); // window over → expire (nextAt > endsAt: cadence ≥ 50 > 45)
  assert.equal(s.modifiers.current, null);
  assert.equal(s.modifiers.nextAt, nextAt, 'expiry keeps the schedule');
});

// ═══════════════════════════════════════ 2 · the scheduler across simulated days

test('3 simulated days of 1-min ticks: cadence, window, eligibility and no-repeat hold', () => {
  const s = fixture({ level: 40, modifiers: { ...defaultSlice(), seed: 4242 } });
  const events = []; // {gameId, type, startedAt, endsAt}
  let expiries = 0;
  for (let m = 0; m <= 3 * 24 * 60; m++) {
    const nowMs = T0 + m * MIN;
    const r = applyTick(s, nowMs);
    if (r.event === 'started') {
      events.push({ ...s.modifiers.current });
    }
    if (r.event === 'expired') expiries += 1;
    assert.ok(
      s.modifiers.current === null || s.modifiers.current.endsAt > s.modifiers.current.startedAt,
      'at most ONE well-formed event at any time'
    );
  }
  // 72 h at one event per 50–120 min (window 45 < cadence 50 → no waiting):
  // between 72·60/120 = 36 and 72·60/50 ≈ 86 events.
  assert.ok(events.length >= 36 && events.length <= 86, `event count ${events.length} plausible`);
  assert.equal(expiries, events.length - (s.modifiers.current ? 1 : 0), 'every closed event expired (none consumed)');
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    assert.ok(MODIFIER_ELIGIBLE[ev.type].includes(ev.gameId), `event ${i} obeys the matrix`);
    assert.ok(isMinigameUnlocked(ev.gameId, 40), `event ${i} game unlocked`);
    assert.equal(ev.endsAt - ev.startedAt, MODIFIER_TIMING.WINDOW_MIN * MIN, `event ${i} window 45 min`);
    if (i > 0) {
      assert.notEqual(ev.gameId, events[i - 1].gameId, `event ${i} no-repeat guard`);
      const gapMin = (ev.startedAt - events[i - 1].startedAt) / MIN;
      // start-to-start gap = the seeded cadence (1-min tick resolution slack)
      assert.ok(gapMin >= 50 - 1 && gapMin <= 120 + 1, `event ${i} gap ${gapMin} ∈ [50, 120]`);
    }
  }
});

test('id-8 honesty across the walk: every dump puts id 8 at quietShift(nextAt)', () => {
  const s = fixture({ level: 12, modifiers: { ...defaultSlice(), seed: 555 } });
  let observations = 0;
  for (let m = 0; m <= 24 * 60; m += 5) {
    const nowMs = T0 + m * MIN;
    applyTick(s, nowMs);
    const items = computeSchedule(s, nowMs);
    const n = byId(items, NOTIFY.IDS.modifier);
    if (s.modifiers.nextAt > nowMs) {
      assert.ok(n, `id 8 present while nextAt is in the future (t+${m}m)`);
      assert.equal(n.at, quietShift(s.modifiers.nextAt), `id 8 at quietShift(nextAt) (t+${m}m)`);
      observations += 1;
    }
  }
  assert.ok(observations > 200, 'the walk actually observed the schedule');
});

// ══════════════════════════════════ 3 · eligibility × unlock levels + trip guard

test('eligibility × unlock levels 1/5/12/40: every pair unlocked, every roll from the pair set', () => {
  for (const level of [1, 5, 12, 40]) {
    const pairs = eligiblePairs(level);
    assert.ok(pairs.length > 0, `L${level} has eligible pairs`);
    for (const p of pairs) {
      assert.ok(isMinigameUnlocked(p.gameId, level), `L${level}: ${p.gameId} unlocked`);
      assert.ok(MODIFIER_ELIGIBLE[p.type].includes(p.gameId), `L${level}: ${p.gameId} in ${p.type} row`);
    }
    const key = (p) => `${p.gameId}|${p.type}`;
    const legal = new Set(pairs.map(key));
    for (let seed = 1; seed <= 50; seed++) {
      const s = fixture({ level, modifiers: { ...defaultSlice(), seed, nextAt: T0 } });
      const r = applyTick(s, T0);
      assert.equal(r.event, 'started');
      assert.ok(legal.has(key(s.modifiers.current)), `L${level} seed ${seed} rolls a legal pair`);
    }
  }
});

test('goobyWelt can never roll and never reads active (§G8-5 catalog rule)', () => {
  for (const row of Object.values(MODIFIER_ELIGIBLE)) {
    assert.ok(!row.includes('goobyWelt'), 'goobyWelt in no matrix row');
  }
  assert.ok(!eligiblePairs(99).some((p) => p.gameId === 'goobyWelt'));
  // even a hostile hand-crafted current for goobyWelt reads null
  const s = fixture({
    modifiers: {
      ...defaultSlice(),
      current: { gameId: 'goobyWelt', type: 'doppelGold', startedAt: T0, endsAt: T0 + 45 * MIN, playsLeft: 2 },
    },
  });
  assert.equal(getActiveFor(s, 'goobyWelt', T0 + MIN), null);
});

test('trip exclusion: ALL trip modes read null from the accessor while arcade reads the event', () => {
  const s = fixture({ modifiers: { ...defaultSlice(), seed: 5, nextAt: T0 + 300 * MIN } });
  forceEvent(s, { gameId: 'cityDrive', type: 'muenzregen' }, T0);
  const t = T0 + MIN;
  // arcade launch (no mode) sees the descriptor + the ×1.5 tuning payload
  const active = getActiveFor(s, 'cityDrive', t);
  assert.equal(active?.type, 'muenzregen');
  assert.deepEqual(launchParams(active), { type: 'muenzregen', coinRate: 1.5 });
  // every trip/travel mode of the SAME game reads null (§C-SYS4.3)
  for (const mode of ['shopTrip', 'vetTrip', 'surfTravel', 'travel']) {
    assert.equal(getActiveFor(s, 'cityDrive', t, { mode }), null, `${mode} never modified`);
  }
  // and no play was consumed by any of those reads
  assert.equal(s.modifiers.current.playsLeft, 3);
});

// ═══════════════════════════════════════════════ 4 · offline/reload robustness

test('reload mid-window: current, playsLeft and nextAt survive persist → load', () => {
  pin(T0);
  const s = fixture({ modifiers: { ...defaultSlice(), seed: 88, nextAt: T0 - MIN } });
  applyTick(s, T0); // roll now (offline catch-up path: passed nextAt starts NOW)
  const cur = s.modifiers.current;
  consume(s, cur.gameId, T0 + MIN); // one play used before the reload
  const before = JSON.parse(JSON.stringify(s.modifiers));
  persist(s);
  pin(T0 + 5 * MIN); // reload 5 min into the window
  const { state: loaded, recovered } = load();
  assert.equal(recovered, false);
  assert.deepEqual(loaded.modifiers, before, 'modifiers slice survives byte-for-value');
  const active = getActiveFor(loaded, cur.gameId, T0 + 5 * MIN);
  assert.equal(active.remainingPlays, cur.playsLeft - 1, 'plays-remaining persists');
  // the boot tick mid-window leaves the event alone
  const r = tick(loaded, T0 + 5 * MIN);
  assert.equal(r.event, null);
});

test('expired-while-away: load() cleans the stale window, schedule survives', () => {
  pin(T0);
  const s = fixture({ modifiers: { ...defaultSlice(), seed: 77, nextAt: T0 - MIN } });
  applyTick(s, T0);
  const nextAt = s.modifiers.nextAt;
  assert.ok(s.modifiers.current, 'event active at persist time');
  persist(s);
  // …the app stays closed until AFTER endsAt (45 min window + slack)
  const back = T0 + 50 * MIN;
  pin(back);
  const { state: loaded, recovered } = load();
  assert.equal(recovered, false);
  assert.equal(loaded.modifiers.current, null, 'validate() drops the expired window');
  assert.equal(loaded.modifiers.nextAt, nextAt, 'nextAt survives (cadence ≤ 120 min < the 24 h clamp)');
  // boot tick: nextAt is still in the future here → nothing rolls early
  assert.equal(tick(loaded, back).event, null);
});

test('passed-nextAt-while-away: the first boot tick starts the event NOW', () => {
  pin(T0);
  const s = fixture({ modifiers: { ...defaultSlice(), seed: 66, nextAt: T0 + 60 * MIN } });
  persist(s);
  const back = T0 + 5 * 60 * MIN; // away 5 h — nextAt long passed
  pin(back);
  const { state: loaded } = load();
  assert.equal(loaded.modifiers.nextAt, T0 + 60 * MIN, 'past nextAt persists un-clamped');
  const r = applyTick(loaded, back);
  assert.equal(r.event, 'started');
  assert.equal(loaded.modifiers.current.startedAt, back, 'catch-up starts NOW, not backdated');
  assert.equal(loaded.modifiers.current.endsAt, back + 45 * MIN, 'full window from boot');
  const gapMin = (loaded.modifiers.nextAt - back) / MIN;
  assert.ok(gapMin >= 50 && gapMin <= 120, 'reschedule counts from NOW');
});

test('open-app catch-up: expiry + due nextAt in one tick honors the fresh no-repeat pin', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const s = fixture({
      modifiers: {
        ...defaultSlice(),
        seed,
        nextAt: T0 + 60 * MIN,
        current: { gameId: 'runner', type: 'turbo', startedAt: T0, endsAt: T0 + 45 * MIN, playsLeft: 3 },
      },
    });
    const r = applyTick(s, T0 + 61 * MIN); // one tick spans expire AND roll
    assert.equal(r.event, 'started');
    assert.notEqual(s.modifiers.current.gameId, 'runner', `seed ${seed}: same-tick pin honored`);
    assert.equal(s.modifiers.lastGameId, 'runner', 'the pin persists until the NEXT expiry re-pins');
  }
});

// ═════════════════════════ 5 · notification id 8 — §B10 scheduling honesty

test('id 8 lands exactly at the engine nextAt after the first-boot grace', () => {
  const s = fixture({ modifiers: { ...defaultSlice(), seed: 3 } });
  applyTick(s, T0); // grace → nextAt = T0 + 30 min (noon: not quiet)
  const n = byId(computeSchedule(s, T0), NOTIFY.IDS.modifier);
  assert.deepEqual(n, {
    id: 8,
    at: T0 + 30 * MIN,
    titleKey: 'notify.modifier.title',
    bodyKey: 'notify.modifier.body',
  });
});

test('quiet hours: an engine-rolled nextAt inside 22:00–08:00 shifts to 08:05', () => {
  // Walk seeds until the engine itself rolls a nextAt inside the quiet window
  // (evening roll at 21:30 + 50–120 min cadence lands 22:20–23:30 often).
  const evening = at(21, 30);
  let found = null;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    const s = fixture({ modifiers: { ...defaultSlice(), seed, nextAt: evening } });
    applyTick(s, evening);
    if (isQuietTime(s.modifiers.nextAt)) found = { s, seed };
  }
  assert.ok(found, 'a seeded cadence landed inside quiet hours');
  const { s } = found;
  const n = byId(computeSchedule(s, evening + MIN), NOTIFY.IDS.modifier);
  assert.equal(n.at, quietShift(s.modifiers.nextAt), 'shifted, not dropped');
  const d = new Date(n.at);
  assert.equal(d.getHours(), 8);
  assert.equal(d.getMinutes(), 5);
});

test('consume/refund mid-window never move the id-8 trigger (fires once per event)', () => {
  const s = fixture({ modifiers: { ...defaultSlice(), seed: 21 } });
  applyTick(s, T0);
  applyTick(s, s.modifiers.nextAt); // roll
  const cur = s.modifiers.current;
  const t1 = cur.startedAt + MIN;
  const before = byId(computeSchedule(s, t1), NOTIFY.IDS.modifier).at;
  const c = consume(s, cur.gameId, t1);
  assert.equal(byId(computeSchedule(s, t1), NOTIFY.IDS.modifier).at, before, 'consume: stable');
  refund(s, c.modifier, t1 + MIN);
  assert.equal(byId(computeSchedule(s, t1), NOTIFY.IDS.modifier).at, before, 'refund: stable');
});

test('cap-8/min-spacing pipeline: id 8 joins a busy board and every gap ≥ 30 min', () => {
  assert.equal(NOTIFY.MAX_SCHEDULED, 8, '§B10: cap raised 7 → 8');
  assert.equal(NOTIFY.IDS.modifier, 8, '§B10: id 8');
  const s = fixture({ stats: { hunger: 60, fun: 80, hygiene: 80 } });
  s.daily = { lastClaimDay: '2026-07-16', streak: 3 };
  applyTick(s, T0); // engine schedules nextAt = T0 + 30 min
  const items = computeSchedule(s, T0);
  assert.ok(items.length >= 5, 'busy board (3 stats + daily + modifier)');
  assert.ok(items.length <= NOTIFY.MAX_SCHEDULED, 'cap holds');
  assert.ok(byId(items, NOTIFY.IDS.modifier), 'modifier survives the pipeline');
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i].at - items[i - 1].at >= 30 * MIN - 1, `spacing ${i} ≥ 30 min`);
  }
});

test('id 8 payload copy resolves through the shipped strings spread (EN + DE, §B10 verbatim)', () => {
  assert.equal(STRINGS_EN['notify.modifier.title'], 'Bonus game! ✨');
  assert.equal(STRINGS_EN['notify.modifier.body'], 'A bonus game is waiting in the arcade! ✨');
  assert.equal(STRINGS_DE['notify.modifier.title'], 'Bonus-Spiel! ✨');
  assert.equal(STRINGS_DE['notify.modifier.body'], 'Ein Bonus-Spiel wartet in der Arcade! ✨');
});

// ═══════════════════════════ 6 · persistence fuzz: junk slices → sanitized

/** The junk-value pool (JSON-serializable — NaN/Infinity become null). */
const JUNK = [
  null, 'banana', -1, 0, 3.7, 1e18, [], [1, 2], { nested: true }, '', true, false,
  Number.NaN, Number.POSITIVE_INFINITY, -99999, '2026-07-16', { gameId: 'runner' },
];

/** Seeded junk pick (mulberry32 via the engine's own rand01). */
const pick = (seed, i) => JUNK[Math.floor(rand01(seed * 131 + i) * JUNK.length)];

/** Assert a loaded modifiers slice satisfies every §B1 #5 invariant. */
function assertSanitized(m, label) {
  assert.ok(m != null && typeof m === 'object' && !Array.isArray(m), `${label}: slice is an object`);
  assert.ok(Number.isFinite(m.nextAt) && m.nextAt >= 0, `${label}: nextAt finite ≥ 0`);
  assert.ok(m.nextAt <= clock.now() + 24 * 3600000, `${label}: nextAt ≤ now + 24 h`);
  assert.ok(Number.isInteger(m.seed) && m.seed >= 1, `${label}: seed int ≥ 1 (derived when junk)`);
  assert.equal(typeof m.lastGameId, 'string', `${label}: lastGameId string`);
  assert.ok(Number.isInteger(m.dayCoins) && m.dayCoins >= 0, `${label}: dayCoins int ≥ 0`);
  assert.equal(typeof m.dayCoinsDay, 'string', `${label}: dayCoinsDay string`);
  if (m.current !== null) {
    assert.ok(MINIGAMES_BY_ID[m.current.gameId], `${label}: current.gameId known`);
    assert.ok(MODIFIER_TYPES[m.current.type], `${label}: current.type known`);
    assert.ok(Number(m.current.endsAt) > clock.now(), `${label}: current.endsAt in the future`);
    assert.ok(Number(m.current.playsLeft) >= 0, `${label}: playsLeft ≥ 0`);
  }
}

test('fuzz: 40 seeded junk modifiers slices load sanitized and stay tick-able', () => {
  pin(T0);
  for (let seed = 1; seed <= 40; seed++) {
    const s = defaultState();
    s.createdAt = T0;
    // whole-slice junk every 8th seed; field-level junk otherwise
    if (seed % 8 === 0) {
      s.modifiers = pick(seed, 0);
    } else {
      s.modifiers = {
        nextAt: pick(seed, 1),
        seed: pick(seed, 2),
        current: seed % 3 === 0
          ? { gameId: pick(seed, 3), type: pick(seed, 4), startedAt: pick(seed, 5), endsAt: pick(seed, 6), playsLeft: pick(seed, 7) }
          : pick(seed, 8),
        lastGameId: pick(seed, 9),
        dayCoins: pick(seed, 10),
        dayCoinsDay: pick(seed, 11),
      };
    }
    persist(s);
    const { state: loaded } = load(); // recovered fresh state is fine too — it must just be SANE
    assertSanitized(loaded.modifiers, `seed ${seed}`);
    // …and the engine keeps running on whatever load() produced
    const r = tick(loaded, T0);
    if (r.changes) assertSanitized({ ...loaded.modifiers, ...r.changes }, `seed ${seed} post-tick`);
    const due = { ...loaded, modifiers: { ...(r.changes ?? loaded.modifiers), nextAt: T0, current: null } };
    assert.equal(tick(due, T0).event, 'started', `seed ${seed}: sanitized slice still rolls`);
  }
});

test('fuzz: 100 seeded mutations of a VALID current row — never junk after load()', () => {
  pin(T0);
  const validCurrent = () => ({
    gameId: 'runner', type: 'turbo', startedAt: T0 - 5 * MIN, endsAt: T0 + 40 * MIN, playsLeft: 2,
  });
  const fields = ['gameId', 'type', 'startedAt', 'endsAt', 'playsLeft'];
  for (let seed = 1; seed <= 100; seed++) {
    const s = defaultState();
    s.createdAt = T0;
    s.modifiers = { ...defaultSlice(), seed: 1234, nextAt: T0 + 60 * MIN, current: validCurrent() };
    const field = fields[Math.floor(rand01(seed) * fields.length)];
    s.modifiers.current[field] = pick(seed, 12);
    persist(s);
    const { state: loaded } = load();
    assertSanitized(loaded.modifiers, `mutation ${seed} (${field})`);
    // whatever survived must be safely consumable-or-null
    if (loaded.modifiers.current) {
      const active = getActiveFor(loaded, loaded.modifiers.current.gameId, T0);
      if (active) assert.ok(active.remainingPlays >= 1);
    }
  }
});

// ═══════════════ 7 · cityDrive muenzregen hook + framework seam (source pins)

const cityDriveSrc = readFileSync(new URL('../src/minigames/games/cityDrive.js', import.meta.url), 'utf8');
const frameworkSrc = readFileSync(new URL('../src/minigames/framework.js', import.meta.url), 'utf8');

test('cityDrive V4/G77 block: coinRate is derived arcade-only and trips assert + drop', () => {
  assert.match(cityDriveSrc, /V4\/G77/, 'marked block present');
  assert.match(
    cityDriveSrc,
    /mod\?\.type === 'muenzregen' && rate > 0 \? rate : 1/,
    'coinRate only honors a muenzregen payload'
  );
  assert.match(
    cityDriveSrc,
    /ASSERT \(§C-SYS4\.3\): trip launch carried ctx\.params\.modifier/,
    'trip assert present'
  );
  assert.match(cityDriveSrc, /ctx\.params\.modifier = undefined;/, 'trip payload hard-dropped');
  assert.match(
    cityDriveSrc,
    /this\.arcadeCoinTarget = Math\.round\(T\.ARCADE_COINS_ACTIVE \* this\.coinRate\)/,
    'scaled coin target'
  );
  assert.match(
    cityDriveSrc,
    /this\.scatterCoins\(this\.arcadeCoinTarget\)/,
    'scatter site consumes the scaled target'
  );
  assert.match(
    cityDriveSrc,
    /this\.arcadeCoinTarget \+ 8/,
    'InstancedMesh capacity follows the scaled target'
  );
});

test('cityDrive ×1.5 identity: 26 base coins → 39 under the §C-SYS4.2 muenzregen rate', () => {
  assert.equal(DRIVE_TUNING.ARCADE_COINS_ACTIVE, 26, 'v1 arcade coin count unchanged');
  const rate = MODIFIER_TYPES.muenzregen.params.coinRate;
  assert.equal(rate, 1.5);
  assert.equal(Math.round(DRIVE_TUNING.ARCADE_COINS_ACTIVE * rate), 39);
  assert.equal(39 / 26, 1.5, 'the spawn-rate ratio is exactly ×1.5');
});

test('framework seam: modifier wiring gates on params.mode == null && !dev (trips excluded)', () => {
  assert.match(
    frameworkSrc,
    /if \(!params\.dev && !meta\.dev && params\.mode == null && modifierApi\)/,
    'launch wiring skips trips + dev launches'
  );
  assert.match(
    frameworkSrc,
    /getActiveFor\(store\.get\(\), id, now\(\), \{ mode: params\.mode \}\)/,
    'accessor consulted with the launch mode'
  );
});
