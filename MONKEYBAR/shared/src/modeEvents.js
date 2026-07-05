// Mode event kinds + mode action-verb registry — RELEASE_PLAN.md §B.1/§B.2,
// transcribed into PLAN.md §10 (binding contract).
//
// New modes talk over two generic channels:
//   client → server  `modeAction { aid, action, data? }`  — verbs listed in MODE_ACTIONS
//   server → client  `modeEvent  { kind, ...payload }`    — kinds listed below
//
// modeEvent rides the same onEvent channel as §3.3 events, so `evt.seat`
// targeting gives private delivery (e.g. your dice) exactly like `hand`.

// ---------------------------------------------------------------------------
// modeEvent kinds (server → client), grouped per mode
// ---------------------------------------------------------------------------

/**
 * Banana Dice modeEvent kinds.
 * Payloads (in addition to `kind`):
 *   YOUR_DICE    — PRIVATE, per seat: `{ dice: number[] }` (your dice under the shell)
 *   BID          — `{ seat, count, face }`
 *   CHALLENGE    — `{ callerSeat, targetSeat, bid: {count, face} }`
 *   REVEAL       — `{ dice: Array<{seat, dice: number[]}>, face, matching, loserSeat }`
 *   DIE_LOST     — `{ seat, diceLeft }`
 *   DIE_REGAINED — `{ seat, diceLeft }` (survived the cannon at 0 dice — the bar
 *                  spots you one die, back to 1)
 */
export const DICE_EVENTS = Object.freeze({
  YOUR_DICE: 'diceYourDice',
  BID: 'diceBid',
  CHALLENGE: 'diceChallenge',
  REVEAL: 'diceReveal',
  DIE_LOST: 'diceDieLost',
  DIE_REGAINED: 'diceDieRegained',
});

/**
 * Coconut Roulette modeEvent kinds.
 * Payloads:
 *   HOLDER  — `{ seat, shakes, pExplode }` (the coconut is handed over)
 *   SHAKE   — `{ seat, shakes, pExplode, chips }` (survived a shake, chip earned)
 *   PASS    — `{ seat, toSeat, chips }` (paid a chip to pass)
 *   EXPLODE — `{ seat }`
 */
export const ROULETTE_EVENTS = Object.freeze({
  HOLDER: 'rouletteHolder',
  SHAKE: 'rouletteShake',
  PASS: 'roulettePass',
  EXPLODE: 'rouletteExplode',
});

/**
 * Jungle Poker modeEvent kinds.
 * Payloads:
 *   YOUR_CARDS — PRIVATE, per seat: `{ cards: PokerCard[] }`
 *   ANTE       — `{ pot, antes: Array<{seat, amount}> }`
 *   ACTION     — `{ seat, action: "fold"|"call"|"raise", amount?, pot, toCall }`
 *   SHOWDOWN   — `{ hands: Array<{seat, cards, rankClass, name}>, winnerSeat,
 *                  winnerSeats: number[], winners: Array<{seat, amount}>,
 *                  refunds: Array<{seat, amount}>, pot }` (winnerSeat = the
 *                  top winner for HUD compat; winners/refunds sum to pot)
 *   BUST       — `{ seat }`
 */
export const POKER_EVENTS = Object.freeze({
  YOUR_CARDS: 'pokerYourCards',
  ANTE: 'pokerAnte',
  ACTION: 'pokerAction',
  SHOWDOWN: 'pokerShowdown',
  BUST: 'pokerBust',
});

/**
 * King of the Bar modeEvent kinds.
 * Payloads:
 *   BAR_RULE     — `{ ruleId, name, desc, roundNo }` (this round's mutator)
 *   FRUIT_PICKED — `{ seat, fruit }` (Royal Decree: round winner picked next Table Fruit)
 *   FRUIT_FLIP   — `{ fruit, roundNo }` (Sour Table: mid-round Table Fruit re-roll)
 */
export const KING_EVENTS = Object.freeze({
  BAR_RULE: 'kingBarRule',
  FRUIT_PICKED: 'kingFruitPicked',
  FRUIT_FLIP: 'fruitFlip',
});

/**
 * Custom Chaos modeEvent kinds.
 * Payloads:
 *   KNOBS — `{ knobs: ChaosKnobs }` (announced at match start)
 */
export const CHAOS_EVENTS = Object.freeze({
  KNOBS: 'chaosKnobs',
});

/** All modeEvent kind tables, keyed by mode id (Monkey Lies emits none). */
export const MODE_EVENT_KINDS = Object.freeze({
  bananaDice: DICE_EVENTS,
  coconutRoulette: ROULETTE_EVENTS,
  junglePoker: POKER_EVENTS,
  kingOfTheBar: KING_EVENTS,
  customChaos: CHAOS_EVENTS,
});

// ---------------------------------------------------------------------------
// modeAction verbs (client → server), fixed registry per §B.1
// ---------------------------------------------------------------------------

/** Banana Dice verbs. `bid` data: `{count, face}`; `challenge` data: `{}`. */
export const DICE_ACTIONS = Object.freeze({
  BID: 'bid',
  CHALLENGE: 'challenge',
});

/** Coconut Roulette verbs. Both take empty data: `{}`. */
export const ROULETTE_ACTIONS = Object.freeze({
  SHAKE: 'shake',
  PASS: 'pass',
});

/** Jungle Poker verbs. `raise` data: `{amount}`; `fold`/`call` data: `{}`. */
export const POKER_ACTIONS = Object.freeze({
  FOLD: 'fold',
  CALL: 'call',
  RAISE: 'raise',
});

/** King of the Bar verbs. `pickFruit` data: `{fruit}` (Royal Decree rounds only). */
export const KING_ACTIONS = Object.freeze({
  PICK_FRUIT: 'pickFruit',
});

/**
 * Legal modeAction verbs per mode id. Monkey Lies and Custom Chaos use the
 * native §3.2 verbs (`play`/`callLiar`/`useChip`/`fireCannon`) and list none.
 * King of the Bar also uses the native verbs plus `pickFruit`.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const MODE_ACTIONS = Object.freeze({
  monkeyLies: Object.freeze([]),
  bananaDice: Object.freeze([DICE_ACTIONS.BID, DICE_ACTIONS.CHALLENGE]),
  coconutRoulette: Object.freeze([ROULETTE_ACTIONS.SHAKE, ROULETTE_ACTIONS.PASS]),
  junglePoker: Object.freeze([POKER_ACTIONS.FOLD, POKER_ACTIONS.CALL, POKER_ACTIONS.RAISE]),
  kingOfTheBar: Object.freeze([KING_ACTIONS.PICK_FRUIT]),
  customChaos: Object.freeze([]),
});

/**
 * Is `action` a registered modeAction verb for `modeId`?
 * (Wire-shape validation lives in protocol.js; this checks the registry.)
 * @param {string} modeId
 * @param {string} action
 * @returns {boolean}
 */
export function isModeAction(modeId, action) {
  const verbs = MODE_ACTIONS[modeId];
  return !!verbs && verbs.includes(action);
}
