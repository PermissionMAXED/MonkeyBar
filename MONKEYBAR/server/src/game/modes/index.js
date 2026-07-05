// Mode registry → engine factory — PLAN.md §2 (server/src/game/modes/index.js).
//
// MODE MODULE CONVENTION (R2, binding for Wave 3 mode agents): every
// modes/<mode>.js exports
//   { MODE_ID: string, PLAYABLE: boolean, createEngine: Function|null }
// This file statically imports all six mode modules and registers each with
//   playable = module.PLAYABLE && !!module.createEngine
// isModePlayable() is the REGISTRY-ONLY truth the whole server trusts
// (welcome catalog decoration, lobby startGame gate, quickmatch gate). A mode
// agent edits ONLY its own module to flip PLAYABLE and provide createEngine —
// nothing in this file changes when a mode goes live.
//
// ENGINE CONTRACT (PLAN.md §10.3 addendum): every engine exposes
//   start, onTimeout(kind), getTimer(), snapshotFor(seat),
//   modeAction?(seat, action, data), phase, turnSeat,
//   lastHolderPending (may be constant false), winnerSeat, inspect().
// Timer kind strings are engine-owned; gameRoom.syncTimer passes them back
// verbatim. Engines emit only §3.3 event types plus `modeEvent`. Timeout
// defaults must be sane: bot seats without a brain (bots/brains/index.js →
// null) are driven exclusively through gameRoom's fallback → onTimeout.

import { createMonkeyLiesEngine, MONKEY_LIES_MODE_ID } from './monkeyLies.js';
import * as bananaDice from './bananaDice.js';
import * as coconutRoulette from './coconutRoulette.js';
import * as junglePoker from './junglePoker.js';
import * as kingOfTheBar from './kingOfTheBar.js';
import * as customChaos from './customChaos.js';
import { NOT_PLAYABLE, NotPlayableError } from './stubs.js';

export { NOT_PLAYABLE, NotPlayableError };

/** @type {Map<string, {factory: Function, playable: boolean}>} */
const registry = new Map();

/**
 * @param {string} id
 * @param {Function} factory  (options) => engine
 * @param {{playable?: boolean}} [meta]
 */
export function registerMode(id, factory, meta = {}) {
  registry.set(id, { factory, playable: meta.playable !== false });
}

/**
 * Register a convention-shaped mode module. Modules without an engine get a
 * throwing factory so nothing can ever start a locked mode by accident.
 * @param {{MODE_ID: string, PLAYABLE: boolean, createEngine: Function|null}} mod
 */
function registerModule({ MODE_ID, PLAYABLE, createEngine }) {
  const factory =
    createEngine ??
    (() => {
      throw new NotPlayableError(MODE_ID);
    });
  registerMode(MODE_ID, factory, { playable: !!PLAYABLE && !!createEngine });
}

/** @param {string} id @returns {Function|null} engine factory (throws NotPlayableError for stubs) */
export function getEngineFactory(id) {
  return registry.get(id)?.factory ?? null;
}

/** Registry-only playability truth (§10.5): registered AND live engine. */
export function isModePlayable(id) {
  const entry = registry.get(id);
  return !!entry && entry.playable;
}

/** Is this mode id known at all? */
export function isModeKnown(id) {
  return registry.has(id);
}

// Monkey Lies pre-dates the module convention (R7 parameterizes it in place);
// adapt its exports here instead of reshaping the engine file.
registerModule({
  MODE_ID: MONKEY_LIES_MODE_ID,
  PLAYABLE: true,
  createEngine: createMonkeyLiesEngine,
});
registerModule(bananaDice);
registerModule(coconutRoulette);
registerModule(junglePoker);
registerModule(kingOfTheBar);
registerModule(customChaos);
