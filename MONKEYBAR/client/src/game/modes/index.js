// Client choreography registry (R3) — per-mode 3D drama plugged into the
// gameClient.js serial event queue WITHOUT touching the Monkey Lies paths
// (ML choreography stays hard-wired inside gameClient.js and is never
// registered here).
//
// ---------------------------------------------------------------------------
// Choreographer contract (consumed by game/gameClient.js)
// ---------------------------------------------------------------------------
// A mode choreography module's default export is either null (placeholder —
// base handling only) or an object:
//
/**
 * @typedef {Object} ChoreoTools
 * @property {ReturnType<import('../../three/engine.js').createEngine>} engine
 * @property {ReturnType<import('../../state/store.js').createStore>} store
 * @property {(seconds: number) => Promise<void>} wait   fast-mode-aware wait
 * @property {() => boolean} fastMode   true → skip long animations (hidden tab
 *                                      / deep backlog); ALWAYS honor this
 * @property {(text: string) => void} sysFlavor   system line into the chat log
 */
/**
 * @typedef {Object} ModeChoreographer
 * @property {(snapshot: Object, tools: ChoreoTools) => (void|Promise<void>)} [resync]
 *   rebuild mode-specific scene state from a snapshot. Runs AFTER the shared
 *   base resync (map, seats, ghosts, camera, audio) on gameStart/reconnect/
 *   spectate.
 * @property {(kind: string, p: Object, tools: ChoreoTools) => (void|Promise<void>)} [handle]
 *   choreograph one event. `kind` is the modeEvent kind (shared/modeEvents.js)
 *   for `modeEvent` frames, or the §3.3 message type for the extra per-mode
 *   turn/penalty/cannon hooks. Runs INSIDE the serial event queue — awaited in
 *   full, so animations never overlap; keep it fast when tools.fastMode().
 */

import bananaDice from './bananaDice.js';
import roulette from './roulette.js';
import poker from './poker.js';
import kingOfTheBar from './kingOfTheBar.js';
import chaos from './chaos.js';

/** @type {Record<string, ModeChoreographer|null>} */
const CHOREOGRAPHERS = {
  // monkeyLies: intentionally absent — its choreography lives in gameClient.js
  bananaDice,
  coconutRoulette: roulette,
  junglePoker: poker,
  kingOfTheBar,
  customChaos: chaos,
};

/**
 * Registered choreographer for a mode, or null (base handling only).
 * @param {string|undefined} modeId
 * @returns {ModeChoreographer|null}
 */
export function getModeChoreographer(modeId) {
  return (modeId && CHOREOGRAPHERS[modeId]) || null;
}
