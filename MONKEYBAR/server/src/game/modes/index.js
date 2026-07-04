// Mode registry → engine factory — PLAN.md §2 (server/src/game/modes/index.js).
// Every mode from shared/modes.js is registered; only playable ones have a
// real engine factory. gameRoom asks getEngineFactory(modeId) at match start.

import { getMode } from '@monkeybar/shared/modes.js';

import { createMonkeyLiesEngine, MONKEY_LIES_MODE_ID } from './monkeyLies.js';
import { NOT_PLAYABLE, NotPlayableError, registerStubModes } from './stubs.js';

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

/** @param {string} id @returns {Function|null} engine factory (throws NotPlayableError for stubs) */
export function getEngineFactory(id) {
  return registry.get(id)?.factory ?? null;
}

/** Is this mode id registered AND playable (both here and in the shared catalog)? */
export function isModePlayable(id) {
  const entry = registry.get(id);
  return !!entry && entry.playable && !!getMode(id)?.playable;
}

/** Is this mode id known at all? */
export function isModeKnown(id) {
  return registry.has(id);
}

registerMode(MONKEY_LIES_MODE_ID, createMonkeyLiesEngine, { playable: true });
registerStubModes(registerMode);
