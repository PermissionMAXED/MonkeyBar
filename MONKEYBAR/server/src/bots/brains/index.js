// Bot brain registry — R2 BRAIN CONVENTION (RELEASE_PLAN.md §D, binding for
// Wave 3 mode agents).
//
// Maps modeId → createBrain factory. Monkey Lies routes to the existing
// bots/botBrain.js; the other five ship as NULL stubs (bots/brains/<mode>.js),
// so botManager.attachSeat leaves those seats unclaimed and the gameRoom
// fallback drives them through engine.onTimeout — which is why every engine
// must ship sane timeout defaults.
//
// A mode agent edits ONLY its own brains/<mode>.js to provide
//   createBrain({ seat, personalityId, rng }) → brain
// implementing the botManager decision surface:
//   observe(envelope)      → social reaction | null   (fed the seat's event feed)
//   decideTurn()           → {type:'call'}
//                          | {type:'play', cardIds: string[]}
//                          | {type:'mode', action: string, data?: Object}
//                          | null (stale)
//   decidePenalty()        → {useChip: boolean} | null (stale)
//   onOwnActionApplied(action)   commit hook after the engine accepted it
//   primeFromSnapshot?(snap), primePenalty?(p), inspect?()   optional
// `{type:'mode'}` decisions are routed by botManager as
//   gameRoom.actForSeat(seat, MSG.MODE_ACTION, { action, data }).

import { createBotBrain } from '../botBrain.js';
import * as bananaDice from './bananaDice.js';
import * as coconutRoulette from './coconutRoulette.js';
import * as junglePoker from './junglePoker.js';
import * as kingOfTheBar from './kingOfTheBar.js';
import * as customChaos from './customChaos.js';

/** @type {Readonly<Record<string, ((opts: Object) => Object)|null>>} */
const BRAIN_FACTORIES = Object.freeze({
  monkeyLies: createBotBrain,
  [bananaDice.MODE_ID]: bananaDice.createBrain,
  [coconutRoulette.MODE_ID]: coconutRoulette.createBrain,
  [junglePoker.MODE_ID]: junglePoker.createBrain,
  [kingOfTheBar.MODE_ID]: kingOfTheBar.createBrain,
  [customChaos.MODE_ID]: customChaos.createBrain,
});

/**
 * The brain factory for a mode — null when the mode has no brain (yet), in
 * which case the seat is left to the gameRoom timeout fallback.
 * @param {string} modeId
 * @returns {((opts: {seat: number, personalityId?: string, rng?: () => number}) => Object)|null}
 */
export function getBrainFactory(modeId) {
  return BRAIN_FACTORIES[modeId] ?? null;
}
