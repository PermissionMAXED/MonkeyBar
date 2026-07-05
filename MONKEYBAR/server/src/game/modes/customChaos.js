// Custom Chaos — the Monkey Lies engine under host-tunable knobs (R7).
// PLAN.md §4.3; §10.3 snapshot = ML extension + `knobs: ChaosKnobs`.
//
// A thin CONFIG wrapper: the lobby room forwards the host's validated
// settings.chaos into the factory options as `knobs` (shared/chaos.js —
// already clamped through validateKnobs; we re-validate defensively so a
// direct factory call can never smuggle out-of-bounds values into the
// engine). Knobs map 1:1 onto MonkeyLiesRules fields; the knob set is
// announced once at match start via `modeEvent chaosKnobs {knobs}` and
// echoed in every snapshot for the HUD summary row.

import { validateKnobs } from '@monkeybar/shared/chaos.js';
import { CHAOS_EVENTS } from '@monkeybar/shared/modeEvents.js';

import { createMonkeyLiesEngine } from './monkeyLies.js';

export const MODE_ID = 'customChaos';
export const PLAYABLE = true;

/**
 * Map a validated knob set onto the Monkey Lies rule surface.
 * (minPlay/turnDirection/fruit-flip/decree/silent stay stock — knobs only
 * cover what shared/chaos.js promises the host.)
 * @param {import('@monkeybar/shared/chaos.js').ChaosKnobs} k
 * @returns {Partial<import('./monkeyLies.js').MonkeyLiesRules>}
 */
export function knobsToRules(k) {
  return {
    handSize: k.handSize,
    maxPlay: k.maxPlay,
    startChambers: k.startChambers,
    startCoconuts: k.startCoconuts,
    chipsPerMatch: k.chipsPerMatch,
    chipBonus: k.chipBonus,
    goldenPerPlayer: k.goldenPerPlayer,
  };
}

/**
 * Engine factory (mode module convention, see modes/index.js). Accepts every
 * createMonkeyLiesEngine option plus `knobs` (the room's validated
 * settings.chaos; missing/partial patches fall back to the schema defaults).
 *
 * @param {Object} [options]
 * @param {import('@monkeybar/shared/chaos.js').ChaosKnobs} [options.knobs]
 * @returns {Object} engine honoring the §10.3 engine contract
 */
export function createEngine(options = {}) {
  const { knobs = null, onEvent = () => {}, ...rest } = options;
  const k = validateKnobs(knobs ?? {});

  const engine = createMonkeyLiesEngine({
    ...rest,
    rules: knobsToRules(k),
    onEvent,
  });

  return {
    modeId: MODE_ID,
    start() {
      // §B.2 CHAOS_EVENTS.KNOBS: announced once at match start, before the
      // first deal hits the wire (clients also get them in the snapshot).
      onEvent({ t: 'modeEvent', p: { kind: CHAOS_EVENTS.KNOBS, knobs: { ...k } } });
      engine.start();
    },
    play: engine.play,
    callLiar: engine.callLiar,
    useChip: engine.useChip,
    fireSelf: engine.fireSelf,
    resolvePenalty: engine.resolvePenalty,
    onTimeout: engine.onTimeout,
    getTimer: engine.getTimer,
    /** §10.3 customChaos snapshot: ML extension + the active knobs. */
    snapshotFor(seat) {
      const snap = engine.snapshotFor(seat);
      snap.mode = MODE_ID;
      snap.knobs = { ...k };
      return snap;
    },
    get phase() {
      return engine.phase;
    },
    get roundNo() {
      return engine.roundNo;
    },
    get tableFruit() {
      return engine.tableFruit;
    },
    get turnSeat() {
      return engine.turnSeat;
    },
    get lastHolderPending() {
      return engine.lastHolderPending;
    },
    get lastPlay() {
      return engine.lastPlay;
    },
    get winnerSeat() {
      return engine.winnerSeat;
    },
    get socialMuted() {
      return engine.socialMuted;
    },
    /** The active knob set (server-internal: brains/tests). */
    get knobs() {
      return { ...k };
    },
    /** Server-internal/test inspection (never sent to clients). */
    inspect() {
      return { ...engine.inspect(), knobs: { ...k } };
    },
  };
}
