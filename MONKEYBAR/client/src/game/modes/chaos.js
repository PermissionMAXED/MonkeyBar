// Custom Chaos choreography — the house-rules announcement beat, plugged into
// the gameClient.js SERIAL event queue (contract in game/modes/index.js).
// Base handling (the shared ML played/called/reveal/cannon paths this mode is
// derived from) stays in gameClient.js — this module adds only:
//
//   chaosKnobs — at match start the server announces the host's knob set. The
//                HUD pill (chaosHud.js) renders the numbers immediately via
//                screens.js; this is the queued 3D drama on top: a bass sting,
//                a table-shake, a neon flourish over the felt, and a sysFlavor
//                line calling out exactly which knobs were twisted away from
//                the defaults.
//
// tools.fastMode() is honored: the beat collapses to the sysFlavor line so a
// deep backlog catches up. No persistent props → resync is trivially
// idempotent.

import * as THREE from 'three';
import { CHAOS_EVENTS } from '@shared/modeEvents.js';
import { CHAOS_KNOB_SCHEMA, CHAOS_KNOB_KEYS, DEFAULT_KNOBS } from '@shared/chaos.js';
import { TABLE_TOP_Y } from '../../three/barScene.js';

/** "Label value" strings for every knob the host moved off its default. */
function twistedKnobs(knobs) {
  const out = [];
  for (const key of CHAOS_KNOB_KEYS) {
    const v = knobs?.[key];
    if (typeof v === 'number' && v !== DEFAULT_KNOBS[key]) {
      out.push(`${CHAOS_KNOB_SCHEMA[key].label} ${v}`);
    }
  }
  return out;
}

/**
 * The knob-announcement beat (match start).
 * @param {import('./index.js').ChoreoTools} tools
 * @param {{knobs: import('@shared/chaos.js').ChaosKnobs}} p
 */
async function knobsBeat(tools, p) {
  const { engine, fastMode, sysFlavor, wait } = tools;
  const twisted = twistedKnobs(p.knobs);
  sysFlavor(
    twisted.length
      ? `🎛️ House rules tonight: ${twisted.join(' · ')}. The rest is bar standard.`
      : '🎛️ House rules tonight: bar standard — the host left every knob alone.'
  );
  if (fastMode()) return;

  // the announcement lands: sting + a jolt + neon crackle over the felt
  engine.rig.lookAtTable?.();
  engine.audio.sfx.bassSting();
  engine.shake(0.25);
  const center = new THREE.Vector3(0, TABLE_TOP_Y + 0.25, 0);
  engine.particles.neonTrail(center);
  engine.particles.goldGlint(center);
  await wait(0.9); // a breath before the deal starts
}

// ---------------------------------------------------------------------------
// Choreographer contract (game/modes/index.js)
// ---------------------------------------------------------------------------

export default {
  /** No persistent chaos props — resync is a no-op (idempotent by nature). */
  resync(snapshot, tools) {
    void snapshot;
    void tools;
  },

  /**
   * One queued event — awaited in full by gameClient's serial queue.
   * @param {string} kind  modeEvent kind, or a §3.3 hook type (turn/penalty/cannon)
   */
  async handle(kind, p, tools) {
    if (kind === CHAOS_EVENTS.KNOBS) return knobsBeat(tools, p);
    // turn/penalty/cannon hooks ride the shared base drama — no extra beat.
  },
};
