// V4/G67 — speedFx pure-math tests (PLAN4-GAMES §G4 numbers as shipped).
// Only the pure helpers are exercised here (no renderer); the runtime
// factories (createSpeedLines / createGhostTrail) are proven over CDP.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SURF_FX,
  RUNNER_FX,
  RACER_FX,
  HOPPER_FX,
  speedFovTarget,
  fovLerp,
  streakRate,
  topSpeedShake,
  windGain,
  crossedMilestones,
  ghostStrength,
} from '../src/gfx/speedFx.js';

// ------------------------------------------------------------ §G4.1 FOV kick

test('§G4.1 speedFovTarget: 62 → 72 over the 8→16 m/s band, clamped', () => {
  const f = (speed) => speedFovTarget(62, SURF_FX.FOV_KICK, speed, SURF_FX.BAND[0], SURF_FX.BAND[1]);
  assert.equal(f(0), 62);
  assert.equal(f(8), 62);
  assert.equal(f(12), 67);
  assert.equal(f(16), 72);
  assert.equal(f(22), 72); // clamped above the band (endless Schwer speeds)
});

test('§G4.1 turbo is ADDITIVE (+8) with a hard 78 cap', () => {
  const ramp = speedFovTarget(62, SURF_FX.FOV_KICK, 16, ...SURF_FX.BAND);
  assert.equal(Math.min(SURF_FX.FOV_CAP, ramp + SURF_FX.TURBO_ADD), 78); // 72+8=80 → 78
  const mid = speedFovTarget(62, SURF_FX.FOV_KICK, 10, ...SURF_FX.BAND); // 64.5
  assert.equal(Math.min(SURF_FX.FOV_CAP, mid + SURF_FX.TURBO_ADD), 72.5); // under the cap
});

test('§G4.1 fovLerp: k = 5/s easing, clamped at the target', () => {
  assert.equal(fovLerp(62, 72, 0.1, 5), 67); // 62 + 10·0.5
  assert.equal(fovLerp(62, 72, 1, 5), 72); //  min(1, dt·k) clamp
  const down = fovLerp(72, 62, 0.1, 5);
  assert.equal(down, 67); // symmetric on the way down
});

// -------------------------------------------------------- §G4.2 streak rate

test('§G4.2 streakRate: 0/s below 10 → 6/s at 12 → 14/s at 16 (linear segments)', () => {
  const r = (speed) => streakRate(speed, SURF_FX.RATE);
  assert.equal(r(8), 0);
  assert.equal(r(10), 0);
  assert.equal(r(11), 3); //  midpoint of segment 1
  assert.equal(r(12), 6);
  assert.equal(r(14), 10); // midpoint of segment 2
  assert.equal(r(16), 14);
  assert.equal(r(20), 14); // flat above the table (endless speeds)
});

test('streakRate: degenerate tables are safe', () => {
  assert.equal(streakRate(10, []), 0);
  assert.equal(streakRate(10, null), 0);
  assert.equal(streakRate(5, [[10, 7]]), 7);
});

// ---------------------------------------------------------- §G4.3 top shake

test('§G4.3 topSpeedShake: fades in over 15→16 m/s, amp 0.035, never pops', () => {
  const s = (speed) => topSpeedShake(speed, SURF_FX.SHAKE_FROM, SURF_FX.SHAKE_TO, SURF_FX.SHAKE_AMP);
  assert.equal(s(14.9), 0);
  assert.equal(s(15), 0);
  assert.ok(Math.abs(s(15.5) - 0.0175) < 1e-9);
  assert.equal(s(16), 0.035);
  assert.equal(s(18), 0.035);
});

// ----------------------------------------------------------- §G4.5 wind gain

test('§G4.5 windGain: speed 10→16 maps to gain 0→0.5', () => {
  const g = (speed) => windGain(speed, ...SURF_FX.WIND);
  assert.equal(g(8), 0);
  assert.equal(g(10), 0);
  assert.equal(g(13), 0.25);
  assert.equal(g(16), 0.5);
  assert.equal(g(19), 0.5);
});

// ---------------------------------------------------------- §G4.7 milestones

test('§G4.7 crossedMilestones: first crossings only — crash resets never re-banner', () => {
  const seen = new Set();
  assert.deepEqual(crossedMilestones(9.9, 10.0, SURF_FX.MILESTONES, seen), [10]);
  seen.add(10);
  // crash → speed resets to 8 → ramps past 10 again: already seen
  assert.deepEqual(crossedMilestones(9.75, 10.0, SURF_FX.MILESTONES, seen), []);
  // a turbo spike can cross several thresholds in one frame
  assert.deepEqual(crossedMilestones(11.9, 16.7, SURF_FX.MILESTONES, seen), [12, 14, 16]);
});

test('crossedMilestones: no crossing when speed sits below/on a threshold', () => {
  const seen = new Set();
  assert.deepEqual(crossedMilestones(10, 10, SURF_FX.MILESTONES, seen), []);
  assert.deepEqual(crossedMilestones(10.1, 11.9, SURF_FX.MILESTONES, seen), []);
});

// ------------------------------------------------------------- ghost trail

test('ghostStrength: fades in over the 13→16 m/s band', () => {
  assert.equal(ghostStrength(12, ...SURF_FX.GHOST_BAND), 0);
  assert.equal(ghostStrength(14.5, ...SURF_FX.GHOST_BAND), 0.5);
  assert.equal(ghostStrength(16, ...SURF_FX.GHOST_BAND), 1);
  assert.equal(ghostStrength(20, ...SURF_FX.GHOST_BAND), 1);
});

// --------------------------------------------- shipped tuning tables (§G4)

test('§G4 tuning tables pin the binding numbers as shipped', () => {
  // surf — §G4.1–4.7
  assert.equal(SURF_FX.FOV_KICK, 10);
  assert.deepEqual([...SURF_FX.BAND], [8, 16]);
  assert.equal(SURF_FX.TURBO_ADD, 8);
  assert.equal(SURF_FX.FOV_CAP, 78);
  assert.equal(SURF_FX.LERP_K, 5);
  assert.equal(SURF_FX.STREAK_POOL, 24);
  assert.deepEqual(SURF_FX.RATE.map((p) => [...p]), [[10, 0], [12, 6], [16, 14]]);
  assert.deepEqual([...SURF_FX.STREAK_RADIUS], [3.2, 4.2]);
  assert.deepEqual([...SURF_FX.STREAK_AHEAD], [4, 9]);
  assert.deepEqual([...SURF_FX.STREAK_SIZE], [0.06, 1.4]);
  assert.equal(SURF_FX.STREAK_LIFE, 0.35);
  assert.equal(SURF_FX.STREAK_VEL, 1.6);
  assert.equal(SURF_FX.SHAKE_AMP, 0.035);
  assert.equal(SURF_FX.GROUND_SCROLL_DIV, 4);
  assert.deepEqual([...SURF_FX.WIND], [10, 16, 0.5]);
  assert.equal(SURF_FX.WIND_UPDATE_SEC, 0.25);
  assert.equal(SURF_FX.SLOWMO_SCALE, 0.55);
  assert.equal(SURF_FX.SLOWMO_SEC, 0.18);
  assert.equal(SURF_FX.FLASH_SEC, 0.12);
  assert.deepEqual([...SURF_FX.MILESTONES], [10, 12, 14, 16]);
  assert.equal(SURF_FX.DIST_EVERY_M, 250);
  // runner — §G4.8 row
  assert.equal(RUNNER_FX.FOV_BASE, 60);
  assert.equal(RUNNER_FX.FOV_KICK, 8);
  assert.equal(RUNNER_FX.STREAK_POOL, 16);
  assert.equal(RUNNER_FX.SHAKE_AMP, 0.03);
  assert.equal(RUNNER_FX.MILESTONES.length, 3); // ramp thirds
  // toyRacer — §G4.8 row
  assert.equal(RACER_FX.FOV_KICK, 6);
  assert.equal(RACER_FX.BOOST_RATE, 10);
  // starHopper — lightest dose
  assert.equal(HOPPER_FX.FOV_KICK, 6);
  assert.equal(HOPPER_FX.STREAK_POOL, 12);
  for (const table of [SURF_FX, RUNNER_FX, RACER_FX, HOPPER_FX]) {
    assert.ok(Object.isFrozen(table), 'tables stay frozen');
  }
});
