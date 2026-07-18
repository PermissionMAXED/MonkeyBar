// V3/G35 — §C12.1 wake-up fix: pure pose-track assertions on the sleep →
// wakeUp sequence (no three.js/DOM — clips are pure pose-channel writers).
//
// The binding fix spec: sleep-enter tweens TO the lying pose over 0.8 s;
// wakeUp restores lying → rest over 0.4 s FIRST, then plays the §D2.4
// stretch from rest. After a simulated full wake sequence every animated
// pose channel must sit within ε = 0.001 of the rest pose, and no single
// frame may jump the root rotX by more than a small continuous step (the
// pre-fix bug snapped rotX by 1.22 rad in one frame).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLIPS,
  createClipPlayer,
  restPose,
  SLEEP_POSE,
  SLEEP_SETTLE_SEC,
  WAKE_RESTORE_SEC,
} from '../src/character/goobyAnims.js';

const DT = 1 / 60;
const EPS = 0.001;

/** Run the player for `seconds`, returning the last composed pose. */
function run(player, seconds, frames) {
  let pose = restPose();
  for (let t = 0; t < seconds; t += DT) {
    pose = restPose();
    player.update(DT, pose, { event: () => {} });
    frames?.push({ rotX: pose.rotX, posY: pose.posY, armL: pose.armL });
  }
  return pose;
}

test('wakeUp clip exists: composite restore + stretch (§C12.1)', () => {
  assert.ok(CLIPS.wakeUp, 'wakeUp registered');
  assert.equal(CLIPS.wakeUp.loop, false, 'one-shot');
  assert.equal(CLIPS.wakeUp.duration, WAKE_RESTORE_SEC + CLIPS.wake.duration);
  assert.equal(SLEEP_SETTLE_SEC, 0.8, 'sleep-enter tween 0.8 s (§C12.1)');
  assert.equal(WAKE_RESTORE_SEC, 0.4, 'pose-restore tween 0.4 s (§C12.1)');
});

test('sleep settles into the SLEEP_POSE lying offsets over 0.8 s', () => {
  const player = createClipPlayer();
  player.play('sleep', { loop: true });
  const pose = run(player, 1.2); // past the 0.8 s settle
  // rotX/posY/posZ/arm channels carry the full lying offsets (breathe only
  // touches scale/mouth channels)
  assert.ok(Math.abs(pose.rotX - SLEEP_POSE.rotX) < EPS, `rotX lying (${pose.rotX})`);
  assert.ok(Math.abs(pose.posY - SLEEP_POSE.posY) < EPS, `posY lying (${pose.posY})`);
  assert.ok(Math.abs(pose.posZ - SLEEP_POSE.posZ) < EPS, `posZ lying (${pose.posZ})`);
  assert.ok(Math.abs(pose.armL - SLEEP_POSE.armL) < EPS, `armL lying (${pose.armL})`);
  // mid-settle (0.4 s) the pose must be BETWEEN rest and lying (tween, no pop)
  const p2 = createClipPlayer();
  p2.play('sleep', { loop: true });
  const mid = run(p2, 0.4);
  assert.ok(mid.rotX < -0.1 && mid.rotX > SLEEP_POSE.rotX + 0.1, `mid-settle tween (${mid.rotX})`);
});

test('after the full wakeUp sequence every channel is within ε of rest (§C12.1)', async () => {
  const player = createClipPlayer();
  player.play('sleep', { loop: true });
  run(player, 2.0); // settled + breathing
  player.stop('sleep');
  const done = player.play('wakeUp');
  const frames = [];
  run(player, CLIPS.wakeUp.duration + 0.1, frames);
  await done; // one-shot resolved by the update loop
  // final composed pose == rest pose on every numeric channel
  const finalPose = restPose();
  player.update(0, finalPose, { event: () => {} });
  const rest = restPose();
  for (const key of Object.keys(rest)) {
    if (key === 'mouth' || key === 'lids') continue; // id overrides, not tracks
    assert.ok(
      Math.abs((finalPose[key] ?? 0) - (rest[key] ?? 0)) < EPS,
      `channel '${key}' at rest after wakeUp (${finalPose[key]} vs ${rest[key]})`
    );
  }
});

test('no single-frame rotX snap across sleep → wakeUp (the pre-fix bug)', () => {
  const player = createClipPlayer();
  player.play('sleep', { loop: true });
  const frames = [];
  run(player, 2.0, frames);
  player.stop('sleep');
  player.play('wakeUp');
  run(player, CLIPS.wakeUp.duration + 0.1, frames);
  let maxJump = 0;
  for (let i = 1; i < frames.length; i += 1) {
    maxJump = Math.max(maxJump, Math.abs(frames[i].rotX - frames[i - 1].rotX));
  }
  // restore covers 1.22 rad over 0.4 s → per-frame steps stay well below the
  // pre-fix single-frame snap of 1.22; smoothstep peaks ≈ 1.22*1.5/0.4*DT
  assert.ok(maxJump < 0.09, `rotX continuous across the wake (max Δ/frame ${maxJump})`);
});

test('wakeUp phase 1 starts at the exact lying pose (no hand-off pop)', () => {
  // First wakeUp frame (t≈0) must equal the settled sleep pose on the
  // restored channels — this is the §C12.1 "restore what sleep applied" rule.
  const pose = restPose();
  CLIPS.wakeUp.apply(pose, 1e-6, { rawT: 1e-6, dt: DT, dir: null, event: () => {} });
  assert.ok(Math.abs(pose.rotX - SLEEP_POSE.rotX) < 0.01, `starts lying (${pose.rotX})`);
  assert.ok(Math.abs(pose.posY - SLEEP_POSE.posY) < 0.01, `starts at bed height (${pose.posY})`);
});
