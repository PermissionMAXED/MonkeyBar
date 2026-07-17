// Sickness state machine (§B5/§C3) vs the binding numbers: every transition
// at its exact threshold (junkScore 5/8, neglect 120/360), junk decay 1/120
// min, healthy-food −0.5, the 60-clean-min recovery window (resets on junk),
// medicine from both states, vet cure/checkup resets, offline 0.3× rules,
// the minigame refusal flag and the §C3.2 tummy warning.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HEALTH,
  onEat,
  tick,
  useMedicine,
  vetCure,
  vetCheckup,
  canPlayMinigame,
} from '../src/systems/health.js';

const JUNK = { id: 'donut-sprinkles', junk: true };
const VEGGIE = { id: 'carrot', junk: false };

/** Fresh §B2 health slice with overrides. */
function slice(over = {}) {
  return { state: 'healthy', junkScore: 0, neglectMin: 0, recoverMin: 0, since: 0, ...over };
}

/** n junk feedings in a row. */
function eatJunk(h, n) {
  for (let i = 0; i < n; i++) h = onEat(h, JUNK);
  return h;
}

// ------------------------------------------------------------------- consts

test('HEALTH consts are the §B5 numbers verbatim and frozen', () => {
  assert.equal(HEALTH.JUNK_EAT, 1);
  assert.equal(HEALTH.HEALTHY_EAT, -0.5);
  assert.equal(HEALTH.JUNK_DECAY_PER_MIN, 1 / 120);
  assert.equal(HEALTH.NEGLECT_MIN_STATS, 2);
  assert.equal(HEALTH.NEGLECT_STAT_BELOW, 15);
  assert.equal(HEALTH.QUEASY_JUNK, 5);
  assert.equal(HEALTH.QUEASY_NEGLECT_MIN, 120);
  assert.equal(HEALTH.SICK_JUNK, 8);
  assert.equal(HEALTH.SICK_NEGLECT_MIN, 360);
  assert.equal(HEALTH.RECOVER_MIN, 60);
  assert.equal(HEALTH.RECOVER_JUNK_BELOW, 3);
  assert.equal(HEALTH.WARN_JUNK, 4);
  assert.equal(HEALTH.QUEASY_FUN_DECAY_MULT, 1.25);
  assert.equal(HEALTH.VET_CURE_STAT_BONUS, 10);
  assert.deepEqual([...HEALTH.STATES], ['healthy', 'queasy', 'sick']);
  assert.ok(Object.isFrozen(HEALTH));
});

// -------------------------------------------------------------------- onEat

test('junk food: junkScore +1 per §B5', () => {
  assert.equal(onEat(slice(), JUNK).junkScore, 1);
  assert.equal(eatJunk(slice(), 3).junkScore, 3);
});

test('healthy food: junkScore −0.5, floored at 0', () => {
  assert.equal(onEat(slice({ junkScore: 2 }), VEGGIE).junkScore, 1.5);
  assert.equal(onEat(slice({ junkScore: 0.4 }), VEGGIE).junkScore, 0);
  assert.equal(onEat(slice(), VEGGIE).junkScore, 0);
});

test('junk resets the recovery window (§C3.6), healthy food does not', () => {
  const q = slice({ state: 'queasy', junkScore: 1, recoverMin: 45 });
  assert.equal(onEat(q, JUNK).recoverMin, 0);
  assert.equal(onEat(q, VEGGIE).recoverMin, 45);
});

test('onEat is pure (input slice untouched)', () => {
  const before = slice({ junkScore: 2 });
  const snapshot = JSON.stringify(before);
  onEat(before, JUNK);
  assert.equal(JSON.stringify(before), snapshot);
});

// --------------------------------------------------------------- tick decay

test('junkScore decays 1 per 120 min (§B5): 4 → 3 after 120 min', () => {
  const { h } = tick(slice({ junkScore: 4 }), 120, 0);
  assert.equal(h.junkScore, 3);
});

test('junk decay is proportional: 60 min → −0.5, floored at 0', () => {
  assert.equal(tick(slice({ junkScore: 4 }), 60, 0).h.junkScore, 3.5);
  assert.equal(tick(slice({ junkScore: 0.2 }), 120, 0).h.junkScore, 0);
});

test('offline junk decay uses the 0.3× multiplier (§C3.6 / §E4 rules)', () => {
  // 480 sim-min cap is the CALLER's job (same contract as stats.applyTick).
  const { h } = tick(slice({ junkScore: 4 }), 480, 0, { mult: 0.3 });
  assert.equal(h.junkScore, 4 - (480 * 0.3) / 120); // −1.2
});

// ------------------------------------------------------------ neglect timer

test('neglectMin accrues 1:1 while ≥ 2 stats are < 15', () => {
  assert.equal(tick(slice(), 30, 2).h.neglectMin, 30);
  assert.equal(tick(slice({ neglectMin: 10 }), 5, 3).h.neglectMin, 15);
  assert.equal(tick(slice(), 30, 4).h.neglectMin, 30);
});

test('neglectMin resets to 0 the minute the condition clears (§B5)', () => {
  assert.equal(tick(slice({ neglectMin: 119 }), 1, 1).h.neglectMin, 0);
  assert.equal(tick(slice({ neglectMin: 359 }), 1, 0).h.neglectMin, 0);
});

test('offline neglect accrues at 0.3× (§C3.6)', () => {
  assert.equal(tick(slice(), 480, 2, { mult: 0.3 }).h.neglectMin, 144);
});

// --------------------------------------------- healthy → queasy transitions

test('healthy → queasy at junkScore ≥ 5 exactly (§B5)', () => {
  const below = tick(slice({ junkScore: 4.999 }), 0, 0);
  assert.equal(below.h.state, 'healthy');
  assert.deepEqual(below.events, []);
  const atThreshold = tick(slice({ junkScore: 5 }), 0, 0);
  assert.equal(atThreshold.h.state, 'queasy');
  assert.deepEqual(atThreshold.events, ['becameQueasy']);
});

test('healthy → queasy at neglectMin ≥ 120 exactly (§B5)', () => {
  const below = tick(slice({ neglectMin: 118 }), 1, 2); // → 119
  assert.equal(below.h.state, 'healthy');
  const atThreshold = tick(slice({ neglectMin: 119 }), 1, 2); // → 120
  assert.equal(atThreshold.h.state, 'queasy');
  assert.deepEqual(atThreshold.events, ['becameQueasy']);
});

test('five junk feedings then a tick make Gooby queasy', () => {
  const { h, events } = tick(eatJunk(slice(), 5), 0, 0);
  assert.equal(h.state, 'queasy');
  assert.ok(events.includes('becameQueasy'));
});

// ------------------------------------------------ queasy → sick transitions

test('queasy → sick at junkScore ≥ 8 exactly (§B5)', () => {
  const below = tick(slice({ state: 'queasy', junkScore: 7.999 }), 0, 0);
  assert.equal(below.h.state, 'queasy');
  const atThreshold = tick(slice({ state: 'queasy', junkScore: 8 }), 0, 0);
  assert.equal(atThreshold.h.state, 'sick');
  assert.deepEqual(atThreshold.events, ['becameSick']);
});

test('queasy → sick at neglectMin ≥ 360 exactly (§B5)', () => {
  const below = tick(slice({ state: 'queasy', neglectMin: 358 }), 1, 2); // → 359
  assert.equal(below.h.state, 'queasy');
  const atThreshold = tick(slice({ state: 'queasy', neglectMin: 359 }), 1, 2); // → 360
  assert.equal(atThreshold.h.state, 'sick');
});

test('escalation never skips a step: healthy with junkScore 9 → queasy first, sick next tick', () => {
  const first = tick(slice({ junkScore: 9 }), 0, 0);
  assert.equal(first.h.state, 'queasy');
  assert.deepEqual(first.events, ['becameQueasy']);
  const second = tick(first.h, 0, 0);
  assert.equal(second.h.state, 'sick');
  assert.deepEqual(second.events, ['becameSick']);
});

// -------------------------------------------------- queasy → healthy recovery

test('queasy recovers after 60 continuous clean minutes exactly (§B5)', () => {
  const q = slice({ state: 'queasy', junkScore: 2.9 });
  const at59 = tick(q, 59, 0);
  assert.equal(at59.h.state, 'queasy');
  assert.equal(at59.h.recoverMin, 59);
  const at60 = tick(at59.h, 1, 0);
  assert.equal(at60.h.state, 'healthy');
  assert.equal(at60.h.recoverMin, 0);
  assert.deepEqual(at60.events, ['recovered']);
});

test('recovery needs junkScore < 3: window does not accrue at 3 or above', () => {
  const { h } = tick(slice({ state: 'queasy', junkScore: 4 }), 30, 0);
  // decays to 3.75 — still ≥ 3 the whole 30 min → no clean minutes
  assert.equal(h.recoverMin, 0);
  assert.equal(h.state, 'queasy');
});

test('recovery needs neglectMin == 0: window does not accrue under neglect', () => {
  const { h } = tick(slice({ state: 'queasy' }), 30, 2);
  assert.equal(h.recoverMin, 0);
  assert.equal(h.state, 'queasy');
});

test('recovery window resets on junk (§C3.6) and restarts from 0', () => {
  const q = tick(slice({ state: 'queasy', junkScore: 0 }), 45, 0).h; // recoverMin 45
  assert.equal(q.recoverMin, 45);
  const afterJunk = onEat(q, JUNK); // junkScore 1 — still "clean", but window resets
  assert.equal(afterJunk.recoverMin, 0);
  const later = tick(afterJunk, 59, 0);
  assert.equal(later.h.state, 'queasy'); // 59 < 60 — the old 45 min are gone
  const done = tick(later.h, 1, 0);
  assert.equal(done.h.state, 'healthy');
});

test('recovery window resets when the clean condition breaks mid-way', () => {
  const q = tick(slice({ state: 'queasy' }), 45, 0).h; // recoverMin 45
  const broken = tick(q, 10, 2); // neglect kicks in → not clean
  assert.equal(broken.h.recoverMin, 0);
});

test('sick NEVER auto-recovers (§B5)', () => {
  const { h, events } = tick(slice({ state: 'sick' }), 100000, 0);
  assert.equal(h.state, 'sick');
  assert.deepEqual(events, []);
});

// -------------------------------------------------------- §C3.2 tummy warning

test("junkScore hitting 4 emits 'tummyWarning' on the next tick, once", () => {
  const h3 = eatJunk(slice(), 3);
  assert.deepEqual(tick(h3, 0, 0).events, []); // 3 < 4 — no warning
  const h4 = onEat(h3, JUNK); // crosses 4
  const warned = tick(h4, 0, 0);
  assert.deepEqual(warned.events, ['tummyWarning']);
  assert.deepEqual(tick(warned.h, 1, 0).events, []); // not repeated
});

test('tummyWarning is superseded when the same tick reaches queasy', () => {
  const h = eatJunk(slice({ junkScore: 3.5 }), 2); // 3.5 → 4.5 (warn) → 5.5
  const { h: after, events } = tick(h, 0, 0);
  assert.equal(after.state, 'queasy');
  assert.deepEqual(events, ['becameQueasy']);
});

// ----------------------------------------------------------------- medicine

test('medicine: sick → queasy, ok, recovery window restarted (§B5)', () => {
  const sick = slice({ state: 'sick', junkScore: 6, neglectMin: 200, recoverMin: 30 });
  const { h, ok } = useMedicine(sick);
  assert.equal(ok, true);
  assert.equal(h.state, 'queasy');
  assert.equal(h.recoverMin, 0);
  // counters are NOT reset — that is the vet's job (§C3.5)
  assert.equal(h.junkScore, 6);
  assert.equal(h.neglectMin, 200);
});

test('medicine: queasy → healthy, ok (§B5)', () => {
  const { h, ok } = useMedicine(slice({ state: 'queasy', junkScore: 2 }));
  assert.equal(ok, true);
  assert.equal(h.state, 'healthy');
  assert.equal(h.junkScore, 2);
});

test('medicine while healthy: ok false, nothing changes (do not consume)', () => {
  const { h, ok } = useMedicine(slice({ junkScore: 1 }));
  assert.equal(ok, false);
  assert.equal(h.state, 'healthy');
  assert.equal(h.junkScore, 1);
});

test('medicine does not mutate its input', () => {
  const before = slice({ state: 'sick' });
  const snapshot = JSON.stringify(before);
  useMedicine(before);
  assert.equal(JSON.stringify(before), snapshot);
});

test('§B5 exactness: residual junkScore ≥ 5 re-queasies on the tick after medicine', () => {
  // Medicine treats the symptom, not the diet — with junkScore still 6 the
  // healthy state does not stick (only vetCure resets the counters).
  const cured = useMedicine(slice({ state: 'queasy', junkScore: 6 })).h;
  assert.equal(cured.state, 'healthy');
  const { h, events } = tick(cured, 0, 0);
  assert.equal(h.state, 'queasy');
  assert.deepEqual(events, ['becameQueasy']);
});

// ---------------------------------------------------------------------- vet

test('vet cure: any state → healthy with junk/neglect/recover reset (§B5)', () => {
  for (const state of ['healthy', 'queasy', 'sick']) {
    const h = vetCure(slice({ state, junkScore: 7, neglectMin: 400, recoverMin: 20 }));
    assert.equal(h.state, 'healthy');
    assert.equal(h.junkScore, 0);
    assert.equal(h.neglectMin, 0);
    assert.equal(h.recoverMin, 0);
  }
});

test('vet cure result is stable: a follow-up tick stays healthy', () => {
  const cured = vetCure(slice({ state: 'sick', junkScore: 9, neglectMin: 500 }));
  const { h, events } = tick(cured, 1, 0);
  assert.equal(h.state, 'healthy');
  assert.deepEqual(events, []);
});

test('vet checkup resets neglectMin ONLY (§C3.5)', () => {
  const h = vetCheckup(slice({ state: 'queasy', junkScore: 6, neglectMin: 100, recoverMin: 5 }));
  assert.equal(h.neglectMin, 0);
  assert.equal(h.state, 'queasy');
  assert.equal(h.junkScore, 6);
  assert.equal(h.recoverMin, 5);
});

// ------------------------------------------------------------- minigame gate

test('canPlayMinigame: false ONLY while sick (§C3.4 — queasy still plays)', () => {
  assert.equal(canPlayMinigame(slice()), true);
  assert.equal(canPlayMinigame(slice({ state: 'queasy' })), true);
  assert.equal(canPlayMinigame(slice({ state: 'sick' })), false);
});

// ------------------------------------------------------- misc slice hygiene

test('since is stamped on transitions when nowMs is provided', () => {
  const T = 1784300000000;
  const { h } = tick(slice({ junkScore: 5 }), 0, 0, { nowMs: T });
  assert.equal(h.since, T);
  const med = useMedicine(slice({ state: 'sick', since: 1 }), T + 1);
  assert.equal(med.h.since, T + 1);
  const cured = vetCure(slice({ state: 'sick', since: 1 }), T + 2);
  assert.equal(cured.since, T + 2);
});

test('since is preserved when no transition happens', () => {
  const { h } = tick(slice({ since: 123, junkScore: 1 }), 5, 0, { nowMs: 999 });
  assert.equal(h.since, 123);
});

test('tick normalizes a corrupt slice (bad state / NaN counters)', () => {
  const { h } = tick({ state: 'zombie', junkScore: NaN, neglectMin: -5 }, 0, 0);
  assert.equal(h.state, 'healthy');
  assert.equal(h.junkScore, 0);
  assert.equal(h.neglectMin, 0);
});

test('tick is pure (input slice untouched)', () => {
  const before = slice({ state: 'queasy', junkScore: 4 });
  const snapshot = JSON.stringify(before);
  tick(before, 30, 2);
  assert.equal(JSON.stringify(before), snapshot);
});

// -------------------------------------------------- full-cycle integration

test('full junk cycle: binge → queasy → sick → vet cure → healthy', () => {
  let h = slice();
  h = eatJunk(h, 5);
  let r = tick(h, 0, 0);
  assert.equal(r.h.state, 'queasy');
  r = tick(eatJunk(r.h, 3), 0, 0); // junkScore 8 → sick
  assert.equal(r.h.state, 'sick');
  assert.equal(canPlayMinigame(r.h), false);
  h = vetCure(r.h);
  assert.equal(h.state, 'healthy');
  assert.equal(canPlayMinigame(h), true);
});

test('full neglect cycle in 1-min ticks: 120 → queasy, 360 → sick', () => {
  let h = slice();
  const events = [];
  for (let m = 1; m <= 360; m++) {
    const r = tick(h, 1, 2);
    h = r.h;
    events.push(...r.events);
    if (m < 120) assert.equal(h.state, 'healthy', `minute ${m}`);
    else if (m < 360) assert.equal(h.state, 'queasy', `minute ${m}`);
  }
  assert.equal(h.state, 'sick');
  assert.deepEqual(events, ['becameQueasy', 'becameSick']);
});

test('full recovery cycle: queasy + medicine + clean hour stays healthy', () => {
  let h = tick(eatJunk(slice(), 5), 0, 0).h; // queasy, junkScore 5
  h = useMedicine(h).h; // healthy, junkScore 5 — would re-queasy…
  h = onEat(onEat(onEat(onEat(onEat(h, VEGGIE), VEGGIE), VEGGIE), VEGGIE), VEGGIE); // −2.5 → 2.5
  const { h: after, events } = tick(h, 60, 0);
  assert.equal(after.state, 'healthy');
  assert.deepEqual(events, []);
});
