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
} from '../src/systems/notifyRules.js';
import { NOTIFY } from '../src/data/constants.js';
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
  assert.equal(NOTIFY.MAX_SCHEDULED, 7);
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
