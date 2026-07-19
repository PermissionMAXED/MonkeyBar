// Notification schedule rules (§C7): predicted trigger times vs the §C1 rates
// (hand-computed), quiet-hour shifts, wake exemption, 30-min spacing cascade,
// the 5-notification cap, guards and determinism.
//
// All timestamps are built with the LOCAL Date constructor, matching the
// device-local quiet-hour logic — the suite is timezone-independent.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSchedule,
  isQuietTime,
  quietShift,
  minutesToThreshold,
  lastClaimMs,
  // V2/G20 (ids 6/7 — §C2.4/§C3.5)
  earliestReadyAt,
  sameLocalDay,
  HARVEST_MIN_LEAD_MIN,
  SICK_AFTER_H,
  READY_CHECK_SLACK_MS, // V2/FIX-B (E14)
} from '../src/systems/notifyRules.js';
import { NOTIFY, CROP_TABLE } from '../src/data/constants.js';
import { readyAt as gardenReadyAt } from '../src/systems/garden.js'; // V2/FIX-B (E14)
import { defaultState } from '../src/core/save.js';

const MIN = 60000;
/** Local-time timestamp on a fixed test day (2026-07-16). */
const at = (h, m = 0, dayOffset = 0) => new Date(2026, 6, 16 + dayOffset, h, m, 0, 0).getTime();

/**
 * State fixture: stats chosen so no stat trigger fires unless overridden
 * (hunger/fun/hygiene at 100 all predict crossings, so tests that need
 * silence pass explicit low-but-not-scheduling values).
 */
function state(stats = {}, extra = {}) {
  const s = defaultState();
  // Defaults that produce NO stat notifications: already at/below thresholds.
  s.stats = { hunger: 20, energy: 100, hygiene: 15, fun: 15, ...stats };
  s.daily = { lastClaimDay: '', streak: 0 };
  return Object.assign(s, extra);
}

const byId = (items, id) => items.find((n) => n.id === id);

// ------------------------------------------------------------ stat predictions

test('hunger: predicted crossing to 20 at the §C1 awake rate (hand-computed)', () => {
  const now = at(10, 0);
  const items = computeSchedule(state({ hunger: 50 }), now);
  const expected = Math.round(now + ((50 - 20) / 0.35) * MIN); // 85.714… min
  assert.deepEqual(items, [
    { id: 2, at: expected, titleKey: 'notify.hunger.title', bodyKey: 'notify.hunger.body' },
  ]);
});

test('fun: 80 → 15 at −0.5/min = exactly 130 min out', () => {
  const now = at(10, 0);
  const n = byId(computeSchedule(state({ fun: 80 }), now), NOTIFY.IDS.fun);
  assert.equal(n.at, now + 130 * MIN);
  assert.equal(n.bodyKey, 'notify.fun.body');
});

test('hygiene: 80 → 15 at −0.15/min ≈ 433.33 min out', () => {
  const now = at(9, 0);
  const n = byId(computeSchedule(state({ hygiene: 80 }), now), NOTIFY.IDS.hygiene);
  assert.equal(n.at, Math.round(now + ((80 - 15) / 0.15) * MIN));
});

test('lead rule: crossings < 30 min in the future are not scheduled', () => {
  // hunger 30 → (30−20)/0.35 = 28.57 min < 30 → skip
  assert.equal(computeSchedule(state({ hunger: 30 }), at(10, 0)).length, 0);
  // hunger 30.5 → exactly 30.0 min → scheduled
  assert.equal(computeSchedule(state({ hunger: 30.5 }), at(10, 0)).length, 1);
});

test('already-low stats are skipped entirely (the app is open — no nag)', () => {
  const items = computeSchedule(state({ hunger: 12, fun: 15, hygiene: 3 }), at(10, 0));
  assert.equal(items.length, 0);
});

test('energy never produces a notification (§C7 has no energy trigger)', () => {
  const items = computeSchedule(state({ energy: 100 }), at(10, 0));
  assert.equal(items.some((n) => n.titleKey.includes('energy')), false);
});

// ------------------------------------------------------------ wake trigger

test('wake: scheduled exactly at wakeAt while sleeping', () => {
  const now = at(14, 0);
  const wakeAt = now + 27 * MIN;
  const s = state({}, { sleep: { sleeping: true, startedAt: now, wakeAt } });
  const items = computeSchedule(s, now);
  assert.deepEqual(items, [
    { id: 1, at: wakeAt, titleKey: 'notify.wake.title', bodyKey: 'notify.wake.body' },
  ]);
});

test('wake: not scheduled when awake or when wakeAt already passed', () => {
  assert.equal(computeSchedule(state(), at(14, 0)).length, 0);
  const stale = state({}, { sleep: { sleeping: true, startedAt: at(13, 0), wakeAt: at(13, 30) } });
  assert.equal(computeSchedule(stale, at(14, 0)).length, 0);
});

test('wake is EXEMPT from quiet hours: 23:30 wake fires at 23:30 (§C1.4)', () => {
  const now = at(23, 0);
  const wakeAt = at(23, 30);
  const s = state({}, { sleep: { sleeping: true, startedAt: now, wakeAt } });
  assert.equal(byId(computeSchedule(s, now), 1).at, wakeAt);
});

// ------------------------------------------------------------ quiet hours

test('quiet-hour shift: 21:50 now, hunger crossing 22:30 → 08:05 next morning', () => {
  const now = at(21, 50);
  // hunger 34 → crossing in 40 min = 22:30, inside quiet hours
  const n = byId(computeSchedule(state({ hunger: 34 }), now), 2);
  assert.equal(n.at, at(8, 5, 1));
});

test('quiet-hour shift: early-morning crossing (03:00) → same day 08:05', () => {
  const now = at(2, 0);
  // fun 45 → crossing in 60 min = 03:00
  const n = byId(computeSchedule(state({ fun: 45 }), now), 3);
  assert.equal(n.at, at(8, 5));
});

test('isQuietTime boundaries: 22:00 quiet, 08:00 not, 07:59 quiet', () => {
  assert.equal(isQuietTime(at(22, 0)), true);
  assert.equal(isQuietTime(at(21, 59)), false);
  assert.equal(isQuietTime(at(7, 59)), true);
  assert.equal(isQuietTime(at(8, 0)), false);
  assert.equal(isQuietTime(at(0, 30)), true);
  assert.equal(isQuietTime(at(12, 0)), false);
});

test('quietShift: 23:10 → next-day 08:05; 06:00 → same-day 08:05; noon unchanged', () => {
  assert.equal(quietShift(at(23, 10)), at(8, 5, 1));
  assert.equal(quietShift(at(6, 0)), at(8, 5));
  assert.equal(quietShift(at(12, 0)), at(12, 0));
});

// ------------------------------------------------------------ spacing

test('30-min spacing cascade: 3 crossings 10 min apart spread to +30 steps', () => {
  const now = at(9, 0);
  // hunger 34 → +40 min (09:40); fun 40 → +50 (09:50); hygiene 23.25 → +55 (09:55)
  const items = computeSchedule(state({ hunger: 34, fun: 40, hygiene: 23.25 }), now);
  assert.equal(items.length, 3);
  assert.equal(byId(items, 2).at, at(9, 40)); // hunger keeps its slot
  assert.equal(byId(items, 3).at, at(10, 10)); // fun: 09:50 → 09:40+30
  assert.equal(byId(items, 4).at, at(10, 40)); // hygiene: 09:55 → 10:10+30 (cascade)
  // returned sorted by time
  assert.deepEqual(items.map((n) => n.id), [2, 3, 4]);
});

test('wake is never moved by spacing; a later stat shifts around it', () => {
  const now = at(9, 0);
  const wakeAt = now + 45 * MIN; // 09:45
  // hunger 34 → 09:40, five minutes before the wake
  const s = state({ hunger: 34 }, { sleep: { sleeping: true, startedAt: now, wakeAt } });
  const items = computeSchedule(s, now);
  assert.equal(byId(items, 1).at, wakeAt); // wake untouched (fires on time)
  assert.equal(byId(items, 2).at, at(9, 40)); // earlier item untouched too
});

test('stat after a wake shifts +30 from the wake time', () => {
  const now = at(9, 0);
  const wakeAt = now + 45 * MIN; // 09:45
  // hunger 37.5 → crossing +50 min = 09:50, 5 min after the wake → 10:15
  const s = state({ hunger: 37.5 }, { sleep: { sleeping: true, startedAt: now, wakeAt } });
  const items = computeSchedule(s, now);
  assert.equal(byId(items, 1).at, wakeAt);
  assert.equal(byId(items, 2).at, wakeAt + 30 * MIN);
});

test('spacing shift landing in quiet hours re-shifts to 08:05', () => {
  const now = at(21, 0);
  // hunger 34 → 21:40 (kept, not quiet); fun 40 → 21:50 → +30 = 22:10 (quiet) → 08:05
  const items = computeSchedule(state({ hunger: 34, fun: 40 }), now);
  assert.equal(byId(items, 2).at, at(21, 40));
  assert.equal(byId(items, 3).at, at(8, 5, 1));
});

// ------------------------------------------------------------ daily bonus

test('daily: 24 h after the claim day midnight, quiet-shifted to 08:05', () => {
  const now = at(9, 0);
  const s = state({}, { daily: { lastClaimDay: '2026-07-16', streak: 2 } });
  const n = byId(computeSchedule(s, now), 5);
  // claim midnight 07-16 + 24 h = 07-17 00:00 (quiet) → 07-17 08:05
  assert.equal(n.at, at(8, 5, 1));
  assert.equal(n.bodyKey, 'notify.daily.body');
});

test('daily: past-due reminders are skipped (app open)', () => {
  const s = state({}, { daily: { lastClaimDay: '2026-07-10', streak: 1 } });
  assert.equal(computeSchedule(s, at(9, 0)).length, 0);
});

test('daily guards: missing/empty/malformed claim data → no notification', () => {
  assert.equal(computeSchedule(state({}, { daily: undefined }), at(9, 0)).length, 0);
  assert.equal(computeSchedule(state({}, { daily: { lastClaimDay: '' } }), at(9, 0)).length, 0);
  assert.equal(computeSchedule(state({}, { daily: { lastClaimDay: 'garbage' } }), at(9, 0)).length, 0);
  assert.equal(computeSchedule(state({}, { daily: null }), at(9, 0)).length, 0);
});

test('daily: numeric lastClaimAt (future wave) is honoured over lastClaimDay', () => {
  const claimAt = at(11, 0, -1); // yesterday 11:00
  const s = state({}, { daily: { lastClaimDay: '2026-07-15', lastClaimAt: claimAt, streak: 1 } });
  const n = byId(computeSchedule(s, at(9, 0)), 5);
  assert.equal(n.at, claimAt + 24 * 3600000); // today 11:00, not quiet-shifted
});

test('lastClaimMs parses YYYY-MM-DD as local midnight', () => {
  assert.equal(lastClaimMs({ daily: { lastClaimDay: '2026-07-16' } }), at(0, 0));
  assert.equal(lastClaimMs({ daily: { lastClaimDay: '' } }), null);
  assert.equal(lastClaimMs({}), null);
});

// ------------------------------------------------------------ cap + determinism

test('all 5 triggers live: cap holds, one per id, sorted by time', () => {
  const now = at(9, 0);
  const s = state(
    { hunger: 40, fun: 50, hygiene: 40 },
    {
      sleep: { sleeping: true, startedAt: now, wakeAt: now + 27 * MIN },
      daily: { lastClaimDay: '2026-07-16', streak: 3 },
    }
  );
  const items = computeSchedule(s, now);
  // V2/G16: MAX_SCHEDULED is 7 in 2.0 (§B3 — ids harvest:6/sick:7), but only
  // the 5 v1 triggers exist until G20 wires the new rules; 5 < cap holds.
  assert.equal(items.length, 5);
  assert.ok(items.length <= NOTIFY.MAX_SCHEDULED, 'cap holds');
  assert.equal(NOTIFY.MAX_SCHEDULED, 8); // V4/G53 (PLAN4 §B10): +modifier id 8
  assert.equal(new Set(items.map((n) => n.id)).size, 5);
  for (let i = 1; i < items.length; i++) assert.ok(items[i].at >= items[i - 1].at, 'sorted');
});

test('computeSchedule is deterministic and does not mutate the state', () => {
  const now = at(9, 0);
  const s = state(
    { hunger: 40, fun: 50, hygiene: 40 },
    { daily: { lastClaimDay: '2026-07-16', streak: 3 } }
  );
  const snapshot = JSON.stringify(s);
  const a = computeSchedule(s, now);
  const b = computeSchedule(s, now);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(s), snapshot);
});

test('minutesToThreshold: hand math + non-decaying stats never cross', () => {
  assert.equal(minutesToThreshold(50, 20, -0.35), (50 - 20) / 0.35);
  assert.equal(minutesToThreshold(50, 20, 0), Infinity);
  assert.equal(minutesToThreshold(50, 20, 3.334), Infinity);
});

test('every item carries the §C7 title/body key pair for its id', () => {
  const now = at(9, 0);
  const s = state(
    { hunger: 40, fun: 50, hygiene: 40 },
    {
      sleep: { sleeping: true, startedAt: now, wakeAt: now + 27 * MIN },
      daily: { lastClaimDay: '2026-07-16', streak: 3 },
    }
  );
  const stems = { 1: 'wake', 2: 'hunger', 3: 'fun', 4: 'hygiene', 5: 'daily' };
  for (const n of computeSchedule(s, now)) {
    assert.equal(n.titleKey, `notify.${stems[n.id]}.title`);
    assert.equal(n.bodyKey, `notify.${stems[n.id]}.body`);
  }
});

// ======================================= V2/G20: harvest (id 6) + sick (id 7)

/** Planted-plot fixture: watered through `wateredMin`, `progress` accrued. */
function plot(crop, now, { progress = 0, wateredMin = 0 } = {}) {
  return {
    crop,
    plantedAt: now - 60 * MIN,
    progressMin: progress,
    wateredUntil: now + wateredMin * MIN,
    waterings: 1,
    fertilized: false,
  };
}

/**
 * V2/FIX-B (E14): pin the slice bookkeeping to `now` — these fixtures encode
 * ALREADY-CURRENT progress (progressMin as of `now`), and earliestReadyAt now
 * runs garden.tick to `now` on a copy first, so a stale default lastTickAt
 * (0) would accrue the whole plantedAt→now stretch on top of the fixture.
 */
function gardenCurrent(s, now) {
  s.garden.lastTickAt = now;
  return s;
}

test('harvest: scheduled at the EARLIEST readyAt across planted plots (§C2.4)', () => {
  const now = at(10, 0);
  const s = gardenCurrent(state(), now);
  // corn: 90 grow, 10 done, watered 90 min → ready now+80; radish: ready now+10
  s.garden.plots[0] = plot('corn', now, { progress: 10, wateredMin: 90 });
  s.garden.plots[1] = plot('radish', now, { progress: 0, wateredMin: 10 });
  const items = computeSchedule(s, now);
  const n = byId(items, NOTIFY.IDS.harvest);
  assert.equal(n.at, now + 10 * MIN); // earliest wins; exactly 10 min lead is OK
  assert.equal(n.titleKey, 'notify.harvest.title');
  assert.equal(n.bodyKey, 'notify.harvest.body');
  assert.equal(items.filter((i) => i.id === NOTIFY.IDS.harvest).length, 1, 'only ONE harvest');
});

test('harvest lead rule: readyAt < 10 min in the future is not scheduled', () => {
  const now = at(10, 0);
  const s = gardenCurrent(state(), now);
  s.garden.plots[0] = plot('radish', now, { progress: 1, wateredMin: 9 }); // ready in 9 min
  assert.equal(byId(computeSchedule(s, now), NOTIFY.IDS.harvest), undefined);
  assert.equal(HARVEST_MIN_LEAD_MIN, 10);
});

test("harvest don't-lie rule: insufficient watering → no notification (§C2.4)", () => {
  const now = at(10, 0);
  const s = gardenCurrent(state(), now);
  // corn needs 90 more min but is only watered for 45 → progress halts first
  s.garden.plots[0] = plot('corn', now, { progress: 0, wateredMin: 45 });
  assert.equal(earliestReadyAt(s, now), null);
  assert.equal(byId(computeSchedule(s, now), NOTIFY.IDS.harvest), undefined);
});

test('harvest: already-ready plots never notify (the player will see them)', () => {
  const now = at(10, 0);
  const s = gardenCurrent(state(), now);
  s.garden.plots[0] = plot('radish', now, { progress: 10, wateredMin: 0 }); // ready NOW
  assert.equal(earliestReadyAt(s, now), null);
  assert.equal(byId(computeSchedule(s, now), NOTIFY.IDS.harvest), undefined);
});

test('harvest: quiet-hours shift applies (readyAt 23:00 → 08:05 next day)', () => {
  const now = at(21, 0);
  const s = gardenCurrent(state(), now);
  s.garden.plots[0] = plot('corn', now, { progress: 0, wateredMin: 180 }); // ready 22:30
  assert.equal(byId(computeSchedule(s, now), NOTIFY.IDS.harvest).at, at(8, 5, 1));
});

// -------------------- V2/FIX-B (E14): stale bookkeeping + zero-slack noise

test('harvest stale bookkeeping (E14): 1 s tick-lag no longer kills id 6', () => {
  const now = at(10, 0);
  const s = state();
  // REAL-PLAY shape: carrot (growthMin 20 == one 20-min watering — zero
  // slack by §C2.3 design) planted+watered 5 min ago; the 1 s ticker last
  // ran 1 s before `now`, so progressMin lags the clock by that tick-lag.
  const wateredAt = now - 5 * MIN;
  const lastTick = now - 1000;
  const staleProgress = (lastTick - wateredAt) / MIN; // current only to lastTick
  s.garden.lastTickAt = lastTick;
  s.garden.plots[0] = {
    crop: 'carrot',
    plantedAt: wateredAt,
    progressMin: staleProgress,
    wateredUntil: wateredAt + 20 * MIN, // minimal watering: ends exactly at readiness
    waterings: 1,
    fertilized: false,
  };
  // The RAW slice really is stale — asking garden.readyAt directly still
  // trips the don't-lie check (this was the E14 bug: id 6 never scheduled).
  assert.equal(gardenReadyAt(s.garden.plots[0], CROP_TABLE.carrot, now), null);
  // earliestReadyAt brings a COPY current first → the correct readyAt
  const expected = now + 15 * MIN;
  const got = earliestReadyAt(s, now);
  assert.ok(got != null, 'id 6 must schedule');
  assert.ok(Math.abs(got - expected) <= 1, `earliestReadyAt ${got} ≈ ${expected}`);
  const n = byId(computeSchedule(s, now), NOTIFY.IDS.harvest);
  assert.ok(n, 'computeSchedule carries id 6');
  assert.ok(Math.abs(n.at - expected) <= 1, `schedule at ${n.at} ≈ ${expected}`);
  // …and the store slice was NOT mutated (pure tick on a copy)
  assert.equal(s.garden.lastTickAt, lastTick);
  assert.equal(s.garden.plots[0].progressMin, staleProgress);
});

test('harvest zero-slack float noise (E14): ULP-low progress still schedules', () => {
  const now = at(10, 0);
  const s = gardenCurrent(state(), now);
  // Hundreds of 1 s tick() float additions can leave progressMin a hair
  // under exact arithmetic; with zero watering slack that used to flip
  // readyAt's wateredRemain < remaining check. READY_CHECK_SLACK_MS (1 ms of
  // pretend watering) absorbs it without moving the predicted time.
  assert.ok(READY_CHECK_SLACK_MS >= 1);
  s.garden.plots[0] = plot('carrot', now, { progress: 5 - 1e-13, wateredMin: 15 });
  const n = byId(computeSchedule(s, now), NOTIFY.IDS.harvest);
  assert.ok(n, 'id 6 must survive ULP noise');
  assert.equal(n.at, now + 15 * MIN, 'predicted time unbiased by the slack');
});

test('sick: 4 h after backgrounding while sick; queasy/healthy never schedule (§C3.5)', () => {
  const now = at(10, 0);
  const sick = state({}, { health: { ...defaultState().health, state: 'sick' } });
  const n = byId(computeSchedule(sick, now), NOTIFY.IDS.sick);
  assert.equal(n.at, now + SICK_AFTER_H * 60 * MIN); // 14:00
  assert.equal(n.bodyKey, 'notify.sick.body');
  const queasy = state({}, { health: { ...defaultState().health, state: 'queasy' } });
  assert.equal(byId(computeSchedule(queasy, now), NOTIFY.IDS.sick), undefined);
  assert.equal(byId(computeSchedule(state(), now), NOTIFY.IDS.sick), undefined);
});

test('sick: trigger landing in quiet hours shifts to 08:05', () => {
  const now = at(20, 30); // + 4 h = 00:30 (quiet)
  const s = state({}, { health: { ...defaultState().health, state: 'sick' } });
  assert.equal(byId(computeSchedule(s, now), NOTIFY.IDS.sick).at, at(8, 5, 1));
});

test('sick max 1/day: a FIRED trigger earlier the same local day suppresses (§C3.5)', () => {
  const now = at(10, 0);
  const health = { ...defaultState().health, state: 'sick' };
  // fired at 09:00 today (recorded time is in the past) → no second one today
  const fired = state({}, { health, care: { sickNotifyAt: at(9, 0) } });
  assert.equal(byId(computeSchedule(fired, now), NOTIFY.IDS.sick), undefined);
  // fired YESTERDAY → today's schedule is allowed again
  const yesterday = state({}, { health, care: { sickNotifyAt: at(9, 0, -1) } });
  assert.equal(byId(computeSchedule(yesterday, now), NOTIFY.IDS.sick).at, at(14, 0));
  // recorded but still in the FUTURE (never fired — app came back first,
  // cancelAll removed it) → reschedule freely
  const pending = state({}, { health, care: { sickNotifyAt: at(13, 0) } });
  assert.equal(byId(computeSchedule(pending, now), NOTIFY.IDS.sick).at, at(14, 0));
});

test('sick cross-day: 21:00 backgrounding schedules tomorrow even after a morning fire', () => {
  const now = at(21, 0); // + 4 h → 01:00 quiet → 08:05 TOMORROW
  const s = state({}, {
    health: { ...defaultState().health, state: 'sick' },
    care: { sickNotifyAt: at(9, 0) }, // fired this morning — different local day than the new trigger
  });
  assert.equal(byId(computeSchedule(s, now), NOTIFY.IDS.sick).at, at(8, 5, 1));
});

test('sameLocalDay: calendar-day comparison is local', () => {
  assert.equal(sameLocalDay(at(0, 0), at(23, 59)), true);
  assert.equal(sameLocalDay(at(23, 59), at(0, 0, 1)), false);
});

test('all 7 triggers live: MAX_SCHEDULED 7 holds, ids 6/7 included, sorted', () => {
  const now = at(9, 0);
  const s = state(
    { hunger: 40, fun: 50, hygiene: 40 },
    {
      sleep: { sleeping: true, startedAt: now, wakeAt: now + 27 * MIN },
      daily: { lastClaimDay: '2026-07-16', streak: 3 },
      health: { ...defaultState().health, state: 'sick' },
    }
  );
  gardenCurrent(s, now);
  s.garden.plots[0] = plot('corn', now, { progress: 0, wateredMin: 90 });
  const items = computeSchedule(s, now);
  assert.equal(items.length, 7);
  assert.ok(items.length <= NOTIFY.MAX_SCHEDULED, 'cap holds');
  assert.deepEqual(new Set(items.map((n) => n.id)).size, 7, 'one per id');
  assert.ok(byId(items, NOTIFY.IDS.harvest), 'harvest present');
  assert.ok(byId(items, NOTIFY.IDS.sick), 'sick present');
  for (let i = 1; i < items.length; i++) assert.ok(items[i].at >= items[i - 1].at, 'sorted');
});

// ========================================= V4/G53: modifier event (id 8, §B10)

test('modifier: scheduled AT modifiers.nextAt with the v4-core copy keys (§B10)', () => {
  const now = at(10, 0);
  const s = state({}, { modifiers: { ...defaultState().modifiers, nextAt: at(14, 30) } });
  const items = computeSchedule(s, now);
  assert.deepEqual(items, [{
    id: 8, at: at(14, 30),
    titleKey: 'notify.modifier.title', bodyKey: 'notify.modifier.body',
  }]);
});

test('modifier guards: 0 / past / junk nextAt never schedule', () => {
  const now = at(10, 0);
  const mods = defaultState().modifiers;
  for (const nextAt of [0, now, now - MIN, NaN, Infinity, 'soon', null, undefined]) {
    const s = state({}, { modifiers: { ...mods, nextAt } });
    assert.equal(byId(computeSchedule(s, now), NOTIFY.IDS.modifier), undefined, `nextAt=${nextAt}`);
  }
  assert.equal(byId(computeSchedule(state({}, { modifiers: undefined }), now), 8), undefined);
});

test('modifier is NOT quiet-hours-exempt: 23:00 event shifts to 08:05', () => {
  const now = at(21, 0);
  const s = state({}, { modifiers: { ...defaultState().modifiers, nextAt: at(23, 0) } });
  assert.equal(byId(computeSchedule(s, now), NOTIFY.IDS.modifier).at, at(8, 5, 1));
});

test('modifier joins the spacing cascade like ids 2–7 (30-min rule)', () => {
  const now = at(9, 0);
  // hunger 40 → crossing at now + (40−20)/0.35 ≈ 57.14 min; put the modifier
  // 10 min after it → must shift to crossing + 30 min.
  const s = state({ hunger: 40 }, {});
  const hungerAt = byId(computeSchedule(s, now), NOTIFY.IDS.hunger).at;
  s.modifiers = { ...defaultState().modifiers, nextAt: hungerAt + 10 * MIN };
  const items = computeSchedule(s, now);
  const n = byId(items, NOTIFY.IDS.modifier);
  assert.equal(n.at, hungerAt + 30 * MIN);
});

test('all 8 triggers live: MAX_SCHEDULED 8 holds, id 8 included, sorted', () => {
  const now = at(9, 0);
  const s = state(
    { hunger: 40, fun: 50, hygiene: 40 },
    {
      sleep: { sleeping: true, startedAt: now, wakeAt: now + 27 * MIN },
      daily: { lastClaimDay: '2026-07-16', streak: 3 },
      health: { ...defaultState().health, state: 'sick' },
      modifiers: { ...defaultState().modifiers, nextAt: at(18, 0) },
    }
  );
  gardenCurrent(s, now);
  s.garden.plots[0] = plot('corn', now, { progress: 0, wateredMin: 90 });
  const items = computeSchedule(s, now);
  assert.equal(items.length, 8);
  assert.ok(items.length <= NOTIFY.MAX_SCHEDULED, 'cap holds');
  assert.deepEqual(new Set(items.map((n) => n.id)).size, 8, 'one per id');
  assert.ok(byId(items, NOTIFY.IDS.modifier), 'modifier present');
  for (let i = 1; i < items.length; i++) assert.ok(items[i].at >= items[i - 1].at, 'sorted');
});
