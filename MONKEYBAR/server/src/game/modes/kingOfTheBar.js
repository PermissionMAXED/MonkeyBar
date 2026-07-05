// King of the Bar — Monkey Lies + per-round Bar Rule mutators (R7).
// PLAN.md §4.3; §10.3 snapshot = ML extension + `barRule:{ruleId,name,desc}|null`.
//
// A thin CONFIG wrapper over the parameterized Monkey Lies engine: every
// roundStart the engine's `roundRules` hook asks this module for the round's
// rule patch. The pick is SEEDED (own mulberry32 stream, independent of the
// deal stream) from the six mutators promised in shared/modes.js, and never
// repeats twice in a row. The active rule is announced right after each
// `roundStart` via `modeEvent kingBarRule {ruleId,name,desc,roundNo}` and
// echoed in every snapshot as `barRule`.
//
// The mutators themselves live INSIDE monkeyLies.js as plain rule knobs:
//   happy_hour   → minPlay 2 (hands under 2 cards may still shed their last)
//   silent_round → silent: engine.socialMuted true → room rejects seated chat
//   sticky_stool → turnDirection −1 for the round
//   sour_table   → midRoundFruitFlipEvery 3 (modeEvent 'fruitFlip')
//   hair_trigger → startCoconuts 2 as the round's EFFECTIVE cannon load only
//   royal_decree → decree: challenge winner gets a 5 s `turn` with
//                  actions:['pickFruit'] (modeAction `pickFruit {fruit}`)

import { KING_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';

import { ENGINE_EVENTS, createMonkeyLiesEngine } from './monkeyLies.js';

export const MODE_ID = 'kingOfTheBar';
export const PLAYABLE = true;

/**
 * The six Bar Rules (ids are the contract for brains/tests/HUD; name/desc
 * feed the client banner — same flavor as shared/modes.js `mutators`).
 * @type {ReadonlyArray<{id: string, name: string, desc: string, rules: Object}>}
 */
export const BAR_RULES = Object.freeze([
  Object.freeze({
    id: 'happy_hour',
    name: '🍺 Happy Hour',
    desc: 'Everyone plays 2+ cards — no singles (a last lonely card may still go).',
    rules: Object.freeze({ minPlay: 2 }),
  }),
  Object.freeze({
    id: 'silent_round',
    name: '🙊 Silent Round',
    desc: 'Chat, phrases & emotes disabled — poker faces only.',
    rules: Object.freeze({ silent: true }),
  }),
  Object.freeze({
    id: 'sticky_stool',
    name: '🔄 Sticky Stool',
    desc: 'The turn order runs backwards this round.',
    rules: Object.freeze({ turnDirection: -1 }),
  }),
  Object.freeze({
    id: 'sour_table',
    name: '🍋 Sour Table',
    desc: 'The Table Fruit re-rolls after every 3rd play.',
    rules: Object.freeze({ midRoundFruitFlipEvery: 3 }),
  }),
  Object.freeze({
    id: 'hair_trigger',
    name: '💣 Hair Trigger',
    desc: 'The cannon is loaded with 2 coconuts — this round only.',
    rules: Object.freeze({ startCoconuts: 2 }),
  }),
  Object.freeze({
    id: 'royal_decree',
    name: '👑 Royal Decree',
    desc: 'The challenge winner decrees the next round’s Table Fruit.',
    rules: Object.freeze({ decree: true }),
  }),
]);

/** Fast id → rule lookup (brains + tests). */
export const BAR_RULE_BY_ID = Object.freeze(
  Object.fromEntries(BAR_RULES.map((r) => [r.id, r]))
);

/**
 * Engine factory (mode module convention, see modes/index.js). Accepts every
 * createMonkeyLiesEngine option; `seed` also feeds the independent Bar Rule
 * pick stream so matches replay deterministically.
 *
 * @param {Object} [options]  createMonkeyLiesEngine options
 * @returns {Object} engine honoring the §10.3 engine contract
 */
export function createEngine(options = {}) {
  const {
    seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
    onEvent = () => {},
    knobs, // customChaos-only plumbing — a King room never sets it; drop it
    ...rest
  } = options;
  void knobs;

  // Own seeded stream (independent of the deal/cannon streams) so the rule
  // sequence is reproducible per seed without perturbing the card shuffle.
  const ruleRng = mulberry32((seed ^ 0x85ebca6b) >>> 0);

  /** @type {{ruleId: string, name: string, desc: string, roundNo: number}|null} */
  let current = null;
  let lastIdx = -1;

  /** Seeded pick — never the same mutator twice in a row. */
  function pickBarRule(roundNo) {
    let idx = Math.floor(ruleRng() * BAR_RULES.length);
    while (idx === lastIdx) idx = Math.floor(ruleRng() * BAR_RULES.length);
    lastIdx = idx;
    const rule = BAR_RULES[idx];
    current = { ruleId: rule.id, name: rule.name, desc: rule.desc, roundNo };
    return { ...rule.rules };
  }

  const engine = createMonkeyLiesEngine({
    ...rest,
    seed,
    roundRules: pickBarRule,
    onEvent: (evt) => {
      // §B.2 contract: the engine's internal `fruitPicked` kind ships to
      // clients as KING_EVENTS.FRUIT_PICKED ('kingFruitPicked').
      if (evt.t === 'modeEvent' && evt.p?.kind === ENGINE_EVENTS.FRUIT_PICKED) {
        onEvent({ ...evt, p: { ...evt.p, kind: KING_EVENTS.FRUIT_PICKED } });
        return;
      }
      onEvent(evt);
      // Announce the round's Bar Rule right after the §3.3 roundStart frame
      // (hands were already dealt privately; the banner rides the same queue).
      if (evt.t === 'roundStart') {
        onEvent({ t: 'modeEvent', p: { kind: KING_EVENTS.BAR_RULE, ...current } });
      }
    },
  });

  return {
    modeId: MODE_ID,
    start: engine.start,
    play: engine.play,
    callLiar: engine.callLiar,
    useChip: engine.useChip,
    fireSelf: engine.fireSelf,
    resolvePenalty: engine.resolvePenalty,
    modeAction: engine.modeAction, // Royal Decree pickFruit lives in the ML engine
    onTimeout: engine.onTimeout,
    getTimer: engine.getTimer,
    /** §10.3 kingOfTheBar snapshot: ML extension + the active barRule. */
    snapshotFor(seat) {
      const snap = engine.snapshotFor(seat);
      snap.mode = MODE_ID;
      snap.barRule = current
        ? { ruleId: current.ruleId, name: current.name, desc: current.desc }
        : null;
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
    /** Silent Round hook — the lobby room checks this before seated chat. */
    get socialMuted() {
      return engine.socialMuted;
    },
    /** The active Bar Rule (server-internal: brains/tests). */
    get barRule() {
      return current ? { ...current } : null;
    },
    /** Server-internal/test inspection (never sent to clients). */
    inspect() {
      return { ...engine.inspect(), barRule: current ? { ...current } : null };
    },
  };
}
