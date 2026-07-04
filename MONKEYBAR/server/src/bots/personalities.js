// The 7 bot archetypes — PLAN.md §5 table (binding parameter values), plus
// per-personality emote / quickPhrase reaction tables keyed to game events.
//
// Numbers in the §5 table map like this:
//   bluffRate      probability a bot lies when it holds a truthful option
//                  ('ev' = Mathematical derives it from game state each turn)
//   callThreshold  call "MONKEY LIES!" iff P(lie) + noise > callThreshold
//   risk           0..1 appetite scalar (play size, chip timing); 'random' =
//                  Chaotic re-rolls it every round
//   memErr         probability a counted fact is corrupted when recalled
//   chatty         0..1 probability scalar for emote/quickPhrase reactions
//
// Signature behaviors carried as extra flags the brain/manager honor:
//   reroll         Chaotic: per-round parameter re-rolls (jitter widths)
//   tilt           Emotional: tilt state shifts bluffRate up / callThreshold down
//   blunderRate    Mathematical: 10% deliberate blunder
//   evenDelays     Mathematical: constant (non-jittered) decision delays
//   trueCallRate   Trollish: 5% "true-call" trolling (calls it believes true)
//   emoteSpam      Trollish: reacts to other players' plays too, short cooldown
//   playSizeStyle  'slam' (Aggressive 3-card slams) | 'single' (Cautious
//                  1-card truths) | 'wild' | 'measured'

import { pick } from '@monkeybar/shared/rng.js';

/** Chattiness levels → probability scalar for firing a reaction. */
export const CHATTY = Object.freeze({ NONE: 0, LOW: 0.12, MED: 0.35, HIGH: 0.6, MAX: 0.9 });

/** Risk appetite levels (Chaotic uses 'random' instead). */
export const RISK = Object.freeze({ LOW: 0.2, MED: 0.5, HIGH: 0.8 });

/**
 * Reaction table entry: candidate emote ids (shared/emotes.js EMOTES) and
 * quick-phrase ids (QUICK_PHRASES) for one game event. `boost` multiplies the
 * personality's chatty scalar for that event (big moments get shouted about).
 * @typedef {{emotes?: string[], phrases?: string[], boost?: number}} Reaction
 */

/**
 * Reaction event keys (fired by botBrain.observe):
 *   surviveShot        own cannon shot missed
 *   gotShot            own cannon shot hit (about to be eliminated)
 *   catchLiar          own call revealed a lie
 *   wrongCall          own call was wrong (claim was true)
 *   gotCaught          own bluff was called and revealed
 *   selfPenalty        staring down the cannon (own penalty window)
 *   othersPenalty      someone else faces the cannon
 *   someoneEliminated  another monkey got coconutted
 *   bigPlay            an opponent slammed a 3-card play
 *   bigWin             won the match
 *   matchLost          match ended, someone else won
 */

/**
 * @typedef {Object} Personality
 * @property {string} id
 * @property {string} label
 * @property {number|'ev'} bluffRate
 * @property {number} callThreshold
 * @property {number|'random'} risk
 * @property {number} memErr
 * @property {number} chatty
 * @property {number} sloppiness       scales the ±0.15 call-decision noise
 * @property {number} chipThreshold    spend the Lucky Banana Chip iff hit-prob ≥ this
 * @property {'slam'|'single'|'wild'|'measured'} playSizeStyle
 * @property {{bluffJitter: number, callJitter: number}} [reroll]
 * @property {{bluffShift: number, callShift: number, chipShift: number}} [tilt]
 * @property {number} [blunderRate]
 * @property {boolean} [evenDelays]
 * @property {number} [trueCallRate]
 * @property {boolean} [emoteSpam]
 * @property {Record<string, Reaction>} reactions
 */

/** @type {Readonly<Record<string, Personality>>} */
export const PERSONALITIES = Object.freeze({
  // §5: Aggressive | 0.55 | 0.45 | high | 0.15 | med | Slams 3-card plays, calls on gut
  aggressive: Object.freeze({
    id: 'aggressive',
    label: 'Aggressive',
    bluffRate: 0.55,
    callThreshold: 0.45,
    risk: RISK.HIGH,
    memErr: 0.15,
    chatty: CHATTY.MED,
    sloppiness: 1.0, // "calls on gut" — noisy reads
    chipThreshold: 0.34,
    playSizeStyle: 'slam',
    reactions: Object.freeze({
      surviveShot: { emotes: ['laugh', 'taunt'], phrases: ['too_easy'], boost: 1.4 },
      gotShot: { emotes: ['rage'], boost: 1.5 },
      catchLiar: { emotes: ['taunt'], phrases: ['youre_lying', 'nice_try'], boost: 1.5 },
      wrongCall: { emotes: ['rage'], boost: 1.2 },
      gotCaught: { emotes: ['rage', 'shrug'], boost: 1.0 },
      selfPenalty: { emotes: ['rage'], phrases: ['good_luck'], boost: 0.8 },
      othersPenalty: { phrases: ['cannon_hungers'], boost: 0.7 },
      someoneEliminated: { emotes: ['taunt'], boost: 0.9 },
      bigPlay: { phrases: ['smell_bluff'], boost: 0.5 },
      bigWin: { emotes: ['laugh'], phrases: ['too_easy'], boost: 2.0 },
      matchLost: { emotes: ['rage'], boost: 1.0 },
    }),
  }),

  // §5: Cautious | 0.15 | 0.75 | low | 0.10 | low | 1-card truths, hoards chip
  cautious: Object.freeze({
    id: 'cautious',
    label: 'Cautious',
    bluffRate: 0.15,
    callThreshold: 0.75,
    risk: RISK.LOW,
    memErr: 0.1,
    chatty: CHATTY.LOW,
    sloppiness: 0.5,
    chipThreshold: 0.5, // hoards the chip until the odds turn grim
    playSizeStyle: 'single',
    reactions: Object.freeze({
      surviveShot: { emotes: ['sweat'], phrases: ['oh_no'], boost: 1.5 },
      gotShot: { emotes: ['cry'], boost: 1.5 },
      catchLiar: { emotes: ['shrug'], phrases: ['youre_lying'], boost: 1.0 },
      wrongCall: { emotes: ['sweat'], boost: 1.0 },
      gotCaught: { emotes: ['sweat', 'cry'], phrases: ['oh_no'], boost: 1.2 },
      selfPenalty: { emotes: ['sweat'], phrases: ['oh_no'], boost: 1.5 },
      othersPenalty: { emotes: ['sweat'], boost: 0.6 },
      someoneEliminated: { emotes: ['shock'], boost: 1.0 },
      bigPlay: { emotes: ['sweat'], boost: 0.5 },
      bigWin: { emotes: ['heart'], phrases: ['gg'], boost: 2.0 },
      matchLost: { phrases: ['gg'], boost: 1.2 },
    }),
  }),

  // §5: Chaotic | 0.50 ±0.30/round | 0.55 ±0.25 | random | 0.30 | high | Params re-roll each round
  chaotic: Object.freeze({
    id: 'chaotic',
    label: 'Chaotic',
    bluffRate: 0.5,
    callThreshold: 0.55,
    risk: 'random',
    memErr: 0.3,
    chatty: CHATTY.HIGH,
    sloppiness: 1.5,
    chipThreshold: 0.4, // re-rolled per round too
    playSizeStyle: 'wild',
    reroll: Object.freeze({ bluffJitter: 0.3, callJitter: 0.25 }),
    reactions: Object.freeze({
      surviveShot: { emotes: ['mindblown', 'laugh'], phrases: ['oh_no'], boost: 1.4 },
      gotShot: { emotes: ['mindblown'], boost: 1.5 },
      catchLiar: { emotes: ['laugh', 'shock'], phrases: ['youre_lying', 'call_it'], boost: 1.3 },
      wrongCall: { emotes: ['shrug', 'laugh'], boost: 1.2 },
      gotCaught: { emotes: ['laugh', 'shrug'], phrases: ['never_lie'], boost: 1.2 },
      selfPenalty: { emotes: ['mindblown'], phrases: ['cannon_hungers'], boost: 1.2 },
      othersPenalty: { emotes: ['shock'], phrases: ['cannon_hungers'], boost: 0.8 },
      someoneEliminated: { emotes: ['shock', 'laugh'], boost: 1.0 },
      bigPlay: { emotes: ['shock'], phrases: ['call_it'], boost: 0.7 },
      bigWin: { emotes: ['mindblown'], phrases: ['gg'], boost: 2.0 },
      matchLost: { emotes: ['shrug'], phrases: ['gg'], boost: 1.0 },
    }),
  }),

  // §5: Mathematical | derived from EV | 0.60 exact | med | 0.02 | none | Near-optimal, 10% blunder
  mathematical: Object.freeze({
    id: 'mathematical',
    label: 'Mathematical',
    bluffRate: 'ev',
    callThreshold: 0.6,
    risk: RISK.MED,
    memErr: 0.02,
    chatty: CHATTY.NONE,
    sloppiness: 0.15, // "0.60 exact" — near-noiseless reads
    chipThreshold: 0.32,
    playSizeStyle: 'measured',
    blunderRate: 0.1,
    evenDelays: true, // even, metronomic decision timing
    reactions: Object.freeze({}), // chatty none — never reacts
  }),

  // §5: Emotional | 0.35 base | 0.60 base | med | 0.15 | high | Tilt state on survive/caught
  emotional: Object.freeze({
    id: 'emotional',
    label: 'Emotional',
    bluffRate: 0.35,
    callThreshold: 0.6,
    risk: RISK.MED,
    memErr: 0.15,
    chatty: CHATTY.HIGH,
    sloppiness: 1.0,
    chipThreshold: 0.4,
    playSizeStyle: 'measured',
    tilt: Object.freeze({ bluffShift: 0.25, callShift: 0.2, chipShift: 0.15 }),
    reactions: Object.freeze({
      surviveShot: { emotes: ['cry', 'heart'], phrases: ['oh_no'], boost: 1.6 },
      gotShot: { emotes: ['cry'], boost: 1.8 },
      catchLiar: { emotes: ['rage', 'taunt'], phrases: ['youre_lying', 'sweating'], boost: 1.4 },
      wrongCall: { emotes: ['cry', 'rage'], boost: 1.4 },
      gotCaught: { emotes: ['cry', 'rage'], phrases: ['oh_no'], boost: 1.5 },
      selfPenalty: { emotes: ['cry', 'sweat'], phrases: ['oh_no'], boost: 1.6 },
      othersPenalty: { emotes: ['shock'], boost: 0.8 },
      someoneEliminated: { emotes: ['cry', 'shock'], boost: 1.2 },
      bigPlay: { emotes: ['shock'], boost: 0.6 },
      bigWin: { emotes: ['cry', 'heart'], phrases: ['gg'], boost: 2.0 },
      matchLost: { emotes: ['cry'], phrases: ['gg'], boost: 1.4 },
    }),
  }),

  // §5: Trollish | 0.60 | 0.50 | high | 0.20 | max | Emote spam, 5% true-call troll
  trollish: Object.freeze({
    id: 'trollish',
    label: 'Trollish',
    bluffRate: 0.6,
    callThreshold: 0.5,
    risk: RISK.HIGH,
    memErr: 0.2,
    chatty: CHATTY.MAX,
    sloppiness: 1.2,
    chipThreshold: 0.34,
    playSizeStyle: 'wild',
    trueCallRate: 0.05,
    emoteSpam: true,
    reactions: Object.freeze({
      surviveShot: { emotes: ['taunt', 'laugh'], phrases: ['too_easy'], boost: 1.5 },
      gotShot: { emotes: ['shrug'], phrases: ['gg'], boost: 1.5 },
      catchLiar: { emotes: ['laugh', 'taunt'], phrases: ['nice_try', 'youre_lying'], boost: 1.5 },
      wrongCall: { emotes: ['laugh', 'shrug'], phrases: ['never_lie'], boost: 1.3 },
      gotCaught: { emotes: ['laugh', 'taunt'], phrases: ['never_lie', 'trust_me'], boost: 1.4 },
      selfPenalty: { emotes: ['taunt', 'sleepy'], phrases: ['too_easy'], boost: 1.3 },
      othersPenalty: { emotes: ['laugh'], phrases: ['cannon_hungers', 'good_luck'], boost: 1.2 },
      someoneEliminated: { emotes: ['laugh', 'taunt'], boost: 1.3 },
      bigPlay: { emotes: ['taunt', 'sleepy'], phrases: ['smell_bluff', 'sweating', 'call_it'], boost: 1.0 },
      bigWin: { emotes: ['taunt', 'laugh'], phrases: ['too_easy'], boost: 2.0 },
      matchLost: { emotes: ['taunt'], phrases: ['good_luck'], boost: 1.2 },
    }),
  }),

  // §5: Quiet | 0.30 | 0.62 | med | 0.05 | none | Mathematical-lite, zero chat
  quiet: Object.freeze({
    id: 'quiet',
    label: 'Quiet',
    bluffRate: 0.3,
    callThreshold: 0.62,
    risk: RISK.MED,
    memErr: 0.05,
    chatty: CHATTY.NONE,
    sloppiness: 0.4,
    chipThreshold: 0.38,
    playSizeStyle: 'measured',
    reactions: Object.freeze({}), // zero chat, ever
  }),
});

/** Archetype ids, in §5 table order (matches lobby/room.js BOT_PERSONALITIES). */
export const PERSONALITY_IDS = Object.freeze(Object.keys(PERSONALITIES));

/**
 * @param {string|null|undefined} id
 * @returns {Personality} the archetype, falling back to Cautious (the §3.4
 *   disconnect-hold default) for unknown/absent tags.
 */
export function getPersonality(id) {
  return PERSONALITIES[id] ?? PERSONALITIES.cautious;
}

/** @param {() => number} [rng] */
export function randomPersonalityId(rng = Math.random) {
  return pick(PERSONALITY_IDS, rng);
}
