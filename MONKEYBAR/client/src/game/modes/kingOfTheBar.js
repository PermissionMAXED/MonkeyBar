// King of the Bar choreography — the Bar Rule gong-and-signage flourish,
// plugged into the gameClient.js SERIAL event queue (contract in
// game/modes/index.js: every handle() is awaited in full, so the sign beat
// can never overlap other drama). Base handling (the shared ML
// played/called/reveal/cannon paths this mode is derived from) stays in
// gameClient.js — this module adds only the King-specific beats:
//
//   kingBarRule — the round's mutator lands like a royal decree: camera
//                 shake + royal-horn sting + a temporary neon sign over the
//                 table spelling the rule name (auto-removed) + sysFlavor.
//                 The HUD banner/pill (kingOfTheBarHud.js) is immediate via
//                 screens.js; this is the queued 3D drama on top.
//
// fruitFlip / kingFruitPicked stay HUD-only (kingOfTheBarHud toasts them) —
// no queued 3D beat needed. tools.fastMode() is honored: the sign beat snaps
// away entirely so a deep backlog catches up.

import * as THREE from 'three';
import { KING_EVENTS } from '@shared/modeEvents.js';
import { buildNeonSign } from '../../three/barScene.js';
import { disposeTransientObject } from '../../three/materials.js';
import { Ease } from '../../three/animations.js';

/** @type {THREE.Group|null} the temporary rule sign (one at most, ever) */
let ruleSign = null;
let wired = false;

/** Remove + dispose the temporary sign (safe to call repeatedly). */
function removeRuleSign() {
  if (!ruleSign) return;
  disposeTransientObject(ruleSign); // per-sign tubes/board/neon material
  ruleSign = null;
}

/** One-time global wiring: leaving the game screen must not strand a sign. */
function wire(tools) {
  if (wired) return;
  wired = true;
  tools.store.on('screen', (screen) => {
    if (screen !== 'game') removeRuleSign();
  });
}

/** Neon-sign text: GLYPHS cover ASCII only, so strip the name's emoji. */
function signText(name) {
  return (name ?? '').replace(/[^\x20-\x7E]/g, '').trim() || 'BAR RULE';
}

/**
 * The Bar Rule beat: gong (shake + sting) → a neon sign with the rule name
 * rises over the table, holds long enough to read, then snaps away.
 * @param {import('./index.js').ChoreoTools} tools
 * @param {{ruleId: string, name: string, desc: string, roundNo: number}} p
 */
async function barRuleBeat(tools, p) {
  const { engine, fastMode, sysFlavor, wait } = tools;
  sysFlavor(`👑 Round ${p.roundNo} Bar Rule — ${p.name}: ${p.desc}`);
  removeRuleSign(); // never two signs, even across weird resync races
  if (fastMode()) return;

  // the gong: the whole bar jumps and the horns blare
  engine.shake(0.4);
  engine.audio.sfx.royalHorn();

  // temporary neon sign across the table from the local camera, facing it
  const cam = engine.camera.position;
  const dir = new THREE.Vector3(-cam.x, 0, -cam.z);
  if (dir.lengthSq() < 0.01) dir.set(0, 0, -1); // overview cam near the axis
  dir.normalize();
  const sign = buildNeonSign(signText(p.name), { color: '#ffd23d', letterHeight: 0.15 });
  sign.position.set(dir.x * 2.1, 1.8, dir.z * 2.1);
  sign.lookAt(cam.x, sign.position.y, cam.z);
  sign.scale.setScalar(0.01);
  engine.scene.add(sign);
  ruleSign = sign;

  engine.rig.lookAtPoint?.(sign.position); // ease all eyes up to the decree
  engine.particles.goldGlint(sign.position.clone());
  await engine.anim.to(sign.scale, { x: 1, y: 1, z: 1 }, 0.4, { ease: Ease.backOut }).promise;
  await wait(1.5); // long enough to read the rule
  await engine.anim.to(sign.scale, { x: 0.01, y: 0.01, z: 0.01 }, 0.22, { ease: Ease.quadIn }).promise;
  removeRuleSign();
  engine.rig.lookAtTable?.(); // gaze back to the felt
}

// ---------------------------------------------------------------------------
// Choreographer contract (game/modes/index.js)
// ---------------------------------------------------------------------------

export default {
  /**
   * Nothing persistent to rebuild — the sign is strictly transient. Resync
   * (gameStart / reconnect / spectate) just guarantees no stale sign lingers,
   * so running it any number of times is a no-op after the first.
   */
  resync(snapshot, tools) {
    wire(tools);
    removeRuleSign();
    void snapshot;
  },

  /**
   * One queued event — awaited in full by gameClient's serial queue.
   * @param {string} kind  modeEvent kind, or a §3.3 hook type (turn/penalty/cannon)
   */
  async handle(kind, p, tools) {
    wire(tools);
    if (kind === KING_EVENTS.BAR_RULE) return barRuleBeat(tools, p);
    // fruitFlip / kingFruitPicked: HUD toasts cover them; turn/penalty/cannon
    // hooks ride the shared base drama — no extra King beat.
  },
};
