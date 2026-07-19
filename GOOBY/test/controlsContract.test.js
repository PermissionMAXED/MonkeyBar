// V4/G57 (PLAN4-GAMES §G3.2 + §G3.1-a/-b/-c + §G2.1): controls-direction
// regression guard. Locks (1) the 27-game `controls.invertible` declaration
// (§G2.1 rule 4 / §G3.3 values / §E0.1-18 one-liners), (2) the shoppingSurf
// logic→render WX mirror (§G3.1-b), (3) the carController screen-right steer
// contract — setSteer(v>0) = screen-right = heading DECREASES — via the
// carFeel sign contract, a pure headless heading integration and both
// autopilot call-site negations (§G3.1-a), and (4) the harborHopper input
// mirror (§G3.1-c). Game view modules import three.js/framework so the
// per-file mapping lines are pinned by source analysis (miscQuality.test.js
// pattern); everything numeric runs through the PURE carFeel/logic modules.
// Runtime screen-direction remains a §G10-1 CDP checklist item.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MINIGAME_IDS } from '../src/data/minigames.js';
import { FEEL, smoothSteer, steerYawRate } from '../src/city/carFeel.js';
import { DRIVE, DRIVE_TUNING } from '../src/data/constants.js';
import { SURF } from '../src/minigames/games/shoppingSurf.logic.js';
import { HARBOR } from '../src/minigames/games/harborHopper.logic.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const source = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const gameSource = (id) => source(path.join('src/minigames/games', `${id}.js`));

// ---------------------------------------------------------------------------
// §G3.3 / §G2.1 rule 4: per-game invertible declaration (verbatim table).
// true  = steer/lane games the global „Steuerung invertieren" flag applies to
//         (the two car games consume it via carController's invertSteer param);
// false = positional / pure-tap / semantic-swipe games (inverting taps, picks
//         and slingshot aiming is nonsense — §G2.1 rule 3 exemptions).
// ---------------------------------------------------------------------------
const EXPECTED_INVERTIBLE = {
  carrotCatch: true,
  bunnyHop: false,
  cityDrive: true,
  carrotGuard: false,
  goobySays: false,
  memoryMatch: false,
  basketBounce: true,
  gardenRush: false,
  pancakeTower: false,
  burgerBuild: true,
  shoppingSurf: true,
  runner: true,
  veggieChop: false,
  purblePlace: false,
  bubblePop: false,
  deliveryRush: true,
  fishingPond: false,
  danceParty: false,
  miniGolf: false,
  trampoline: false,
  goalieGooby: true,
  starHopper: true,
  pipeFlow: false,
  toyRacer: true,
  ghostHunt: false,
  rocketRescue: true,
  harborHopper: true,
  // V4/G53 registry row (PLAN4 §E0.1): §G3.3 „drag steer … screen-true by
  // spec" → invertible per §G2.1 rule 4. Module lands wave 2 (G65/G66).
  goobyWelt: true,
};

test('V4/G57 §G3.2: all 28 games declare controls.invertible (§G3.3 values)', () => {
  assert.equal(MINIGAME_IDS.length, 28);
  assert.deepEqual([...MINIGAME_IDS].sort(), Object.keys(EXPECTED_INVERTIBLE).sort());
  for (const id of MINIGAME_IDS) {
    // §E0.1-11: wave-2 modules (goobyWelt) may not be built yet — skip the
    // source pin until the file exists; the id/value row above stays locked.
    if (!fs.existsSync(path.join(ROOT, 'src/minigames/games', `${id}.js`))) continue;
    const src = gameSource(id);
    const m = src.match(/export const controls = Object\.freeze\(\{ invertible: (true|false) \}\);/);
    assert.ok(m, `${id}.js must declare the §E0.1-18 one-line controls export`);
    assert.equal(
      m[1] === 'true',
      EXPECTED_INVERTIBLE[id],
      `${id}: invertible must be ${EXPECTED_INVERTIBLE[id]} per §G3.3`
    );
    // exactly one declaration (rework agents preserve the line, never fork it)
    assert.equal(src.match(/export const controls =/g).length, 1, `${id}: single declaration`);
  }
});

// ---------------------------------------------------------------------------
// §G3.1-b: shoppingSurf logic→render mirror. Camera looks down world +z, so
// screen x ∝ −world x (§G2.1 rule 1); the WX(x) = −x helper mirrors at the
// ONE logic→render boundary. Chain: swipe left ⇒ lane−1 ⇒ logic x −1.6 ⇒
// world +1.6 ⇒ screen LEFT.
// ---------------------------------------------------------------------------
test('V4/G57 §G3.1-b: surf LANE_X monotone + WX render mirror = screen-true lanes', () => {
  // lane index → logic x strictly ascending (logic „left" = smaller x)
  assert.equal(SURF.LANE_X.length, SURF.LANES);
  for (let i = 1; i < SURF.LANE_X.length; i += 1) {
    assert.ok(SURF.LANE_X[i] > SURF.LANE_X[i - 1], 'LANE_X strictly ascending');
  }
  // the module-local mirror the source-analysis below pins into the game
  const WX = (x) => -x;
  // +z-looking camera: screen x ∝ −world x (three.js right axis = −x world)
  const screenX = (worldX) => -worldX;
  for (let lane = 1; lane < SURF.LANES; lane += 1) {
    const scrLo = screenX(WX(SURF.LANE_X[lane - 1]));
    const scrHi = screenX(WX(SURF.LANE_X[lane]));
    // swiping left (lane−1) must land LEFT on screen: smaller screen x
    assert.ok(scrLo < scrHi, `lane ${lane - 1} renders left of lane ${lane} on screen`);
  }
});

test('V4/G57 §G3.1-b: shoppingSurf.js applies WX at every render site', () => {
  const src = gameSource('shoppingSurf');
  assert.match(src, /const WX = \(x\) => -x;/, 'the single WX mapping helper');
  for (const site of [
    'S.gooby.group.position.set(WX(px)', //          player
    '(WX(SURF.LANE_X[run.lane]) - WX(px))', //       lean sign
    'S.shieldVis.position.set(WX(px)', //            shield bubble
    'vis.position.set(WX(ob.x)', //                  obstacles
    'slot.line.position.x = -WX(ob.x)', //           NPC dotted line
    'setPosition(WX(c.x)', //                        coin instances
    'vis.position.set(WX(p.x)', //                   powerups
    'const camX = WX(px) * 0.35', //                 camera follow
    'new THREE.Vector3(WX(ev.x)', //                 coin sparkle/floater
  ]) {
    assert.ok(src.includes(site), `render site mirrored: ${site}`);
  }
  // NPC rig 180° flip: mirrored render walks toward world −x (§G3.1-b)
  assert.match(src, /model\.rotation\.y = -Math\.PI \/ 2;/);
});

// ---------------------------------------------------------------------------
// §G3.1-a: carController screen-right steer contract.
// ---------------------------------------------------------------------------
const T = DRIVE_TUNING;

/** Wrap an angle to (−π, π] — mirrors carController.wrapAngle (pure). */
function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Headless heading integration replicating carController.update()'s yaw
 * application VERBATIM (the source assert below pins the negation into the
 * real module): steerSmoothed low-pass → damp → single −negation → cap.
 */
function stepHeading(state, steer, speed, dt) {
  state.smoothed = smoothSteer(state.smoothed, steer, dt);
  const damp = 1 - 0.25 * Math.min(1, speed / DRIVE.MAX_SPEED);
  state.heading = wrapAngle(state.heading + steerYawRate(-state.smoothed, T.STEER_RATE, damp) * dt);
  return state;
}

test('V4/G57 §G3.1-a: carFeel stays sign-preserving; carController holds the single negation', () => {
  // carFeel pure map unchanged: positive filtered steer ⇒ positive yaw
  assert.ok(steerYawRate(1, T.STEER_RATE, 1) > 0);
  assert.ok(steerYawRate(-1, T.STEER_RATE, 1) < 0);
  assert.equal(steerYawRate(1, T.STEER_RATE, 1), FEEL.STEER_RATE_CAP_RAD_S);
  // the ONE negation lives at carController's yaw application site
  const ctl = source('src/city/carController.js');
  assert.equal(
    ctl.match(/steerYawRate\(-steerSmoothed, T\.STEER_RATE, damp\)/g)?.length,
    1,
    'exactly one steer-sign negation at the application site'
  );
  assert.ok(!ctl.includes('steerYawRate(steerSmoothed'), 'no unnegated application site remains');
});

test('V4/G57 §G3.1-a: setSteer(+1) held 1 s from h=0 ⇒ heading < 0 (screen-right)', () => {
  const dt = 1 / 60;
  const state = { heading: 0, smoothed: 0 };
  for (let t = 0; t < 1; t += dt) stepHeading(state, 1, 9, dt);
  // heading DECREASES: under the chase cam (forward = (sin h, cos h)) that
  // rotates the nose toward −x from +z-facing, i.e. a RIGHT turn on screen.
  assert.ok(state.heading < 0, `heading ${state.heading} must fall below 0`);
  // symmetric: steer −1 (screen-left) raises the heading
  const left = { heading: 0, smoothed: 0 };
  for (let t = 0; t < 1; t += dt) stepHeading(left, -1, 9, dt);
  assert.ok(left.heading > 0);
});

/**
 * Waypoint-chasing autopilot in the games' EXACT control law (the source
 * assert pins `setSteer(…, -err * 2.4)` into cityDrive + deliveryRush):
 * drives a 4-corner square route; returns the corners reached.
 */
function pilotSquare(steerSign) {
  const corners = [
    { x: 40, z: 0 },
    { x: 40, z: 40 },
    { x: 0, z: 40 },
    { x: 0, z: 0 },
  ];
  const dt = 1 / 60;
  const speed = 9;
  const state = { heading: 0, smoothed: 0 };
  const p = { x: 0, z: 0 };
  let next = 0;
  let reached = 0;
  for (let t = 0; t < 90 && next < corners.length; t += dt) {
    const target = corners[next];
    const desired = Math.atan2(target.x - p.x, target.z - p.z);
    const err = wrapAngle(desired - state.heading);
    const steer = Math.max(-1, Math.min(1, steerSign * err * 2.4));
    stepHeading(state, steer, speed, dt);
    p.x += Math.sin(state.heading) * speed * dt;
    p.z += Math.cos(state.heading) * speed * dt;
    if (Math.hypot(target.x - p.x, target.z - p.z) < 3.5) {
      reached += 1;
      next += 1;
    }
  }
  return reached;
}

test('V4/G57 §G3.1-a: autopilot 4-corner convergence with the negated command', () => {
  // both call sites carry the marked negation (no double-negation missed)
  for (const file of ['src/minigames/games/cityDrive.js', 'src/minigames/games/deliveryRush.js']) {
    assert.match(
      source(file),
      /setSteer\(Math\.max\(-1, Math\.min\(1, -err \* 2\.4\)\)\); \/\/ V4\/G57/,
      `${file}: autopilot negation one-liner`
    );
  }
  // the negated law rounds all 4 corners …
  assert.equal(pilotSquare(-1), 4, 'negated autopilot reaches all 4 corners');
  // … while the pre-§G3.1-a (positive-feedback) sign spins out and never does
  assert.ok(pilotSquare(1) < 4, 'unnegated autopilot must NOT converge');
});

// ---------------------------------------------------------------------------
// §G3.1-c: harborHopper input mirror.
// ---------------------------------------------------------------------------
test('V4/G57 §G3.1-c: harborHopper mirrors analog input at the drag boundary', () => {
  const src = gameSource('harborHopper');
  assert.ok(
    src.includes('this.dragX = -p.nx * HARBOR.CHANNEL_HALF_W * 1.25;'),
    'the one-line §G3.1-c input mirror'
  );
  // pure chain: drag right (nx +1) → target world −x → +z camera renders
  // screen x ∝ −world x → positive screen x = SCREEN RIGHT ✅
  const nx = 1;
  const targetX = -nx * HARBOR.CHANNEL_HALF_W * 1.25;
  const screenX = (worldX) => -worldX;
  assert.ok(targetX < 0 && screenX(targetX) > 0, 'drag right steers screen-right');
  // the logic bot keeps commanding in logic space (no mirror on its path)
  assert.ok(src.includes('this.bot.control(state'), 'bot path untouched');
});
