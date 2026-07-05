// Monkey Lies — THE rules engine. PLAN.md §4.1–§4.2 (binding contract).
//
// A PURE, SEEDABLE state machine: no sockets, no timers. The engine mutates
// the table, emits §3.3 game events through `onEvent`, and exposes deadlines
// via getTimer(); the driver (game/gameRoom.js) owns real clocks and calls
// onTimeout(kind) when a deadline passes. This keeps the engine unit-testable
// headlessly with scripted seat policies.
//
// Rules implemented exactly:
//  - Deck via shared buildDeck(aliveCount); deal 5; Table Fruit chosen AFTER deal.
//  - PLAY 1–3 face-down cards, implicit claim "all Table Fruit".
//  - Only the next player with cards may CALL the unresolved play.
//  - Reveal: every card Table Fruit or Golden Banana (wild) → truth, caller
//    loses; otherwise the player lied and loses. Loser faces the cannon.
//  - Coconut Cannon: hit chance = coconuts / chambers; survive → permanently
//    lose one empty chamber (floor 1); Lucky Banana Chip = +2 temporary
//    chambers for ONE shot, 1 chip per match, 5 s decision window.
//  - Empty hand = safe for the round.
//  - Last Monkey Holding: when everyone else has emptied their hand, the last
//    holder must fire the cannon at themselves once. If the pending play is
//    another player's, they may still CALL it as their escape hatch (rule 2
//    grants exactly them the call); playing more cards is disallowed.
//  - Round ends after every cannon shot → intermission → reshuffle/redeal to
//    survivors. Coconut hit eliminates. Last monkey standing wins.
//
// R7 parameterization (PURE EXTRACTION — defaults are byte-identical to the
// original constants): the engine accepts an optional `rules` object plus a
// per-round `roundRules(roundNo)` hook so King of the Bar (per-round Bar Rule
// mutators) and Custom Chaos (host knobs) can reconfigure the SAME engine
// without forking the rules. Per-round chamber/coconut overrides are applied
// as EFFECTIVE values for that round's cannon math only — the permanent
// chamber track on the table seats is never clobbered. See MonkeyLiesRules.

import {
  CHIP_BONUS_CHAMBERS,
  CHIPS_PER_MATCH,
  DECK_FRUIT_RATIO,
  HAND_SIZE,
  MAX_PLAY,
  MIN_PLAY,
  PENALTY_WINDOW_MS,
  ROUND_INTERMISSION_MS,
  START_CHAMBERS,
  START_COCONUTS,
  TURN_SECONDS_DEFAULT,
} from '@monkeybar/shared/constants.js';
import { BASIC_FRUITS, FRUITS, buildDeck, cardMatchesTableFruit } from '@monkeybar/shared/cards.js';
import { ERROR_CODES } from '@monkeybar/shared/protocol.js';
import { mulberry32, shuffle } from '@monkeybar/shared/rng.js';

export const MONKEY_LIES_MODE_ID = 'monkeyLies';

/** Royal Decree modeAction verb (mirrors shared/modeEvents.js KING_ACTIONS). */
export const PICK_FRUIT_ACTION = 'pickFruit';
/** Royal Decree pick window (ms). */
export const DECREE_WINDOW_MS = 5000;
/** Engine-level modeEvent kinds (wrappers may rename/decorate them). */
export const ENGINE_EVENTS = Object.freeze({
  /** `{ fruit, roundNo }` — mid-round Table Fruit re-roll (Sour Table). */
  FRUIT_FLIP: 'fruitFlip',
  /** `{ seat, fruit }` — Royal Decree: the challenge winner picked the next Table Fruit. */
  FRUIT_PICKED: 'fruitPicked',
});

/**
 * The full configurable rule surface. Every default equals today's §4
 * constant so a bare `createMonkeyLiesEngine({table})` behaves EXACTLY as
 * before the parameterization.
 *
 * @typedef {Object} MonkeyLiesRules
 * @property {number} handSize               cards dealt per round
 * @property {number} minPlay                fewest cards per PLAY (hands holding
 *                                           fewer may still shed what they have)
 * @property {number} maxPlay                most cards per PLAY
 * @property {number} startChambers          cannon chambers at match start
 * @property {number} startCoconuts          coconuts loaded at match start
 * @property {number} chipsPerMatch          Lucky Banana Chips per match
 * @property {number} chipBonus              temp chambers a chip bolts on
 * @property {number|null} goldenPerPlayer   wilds per player in the deck (null → native §4.1 math)
 * @property {1|-1} turnDirection            +1 clockwise (native) / −1 reversed
 * @property {number} midRoundFruitFlipEvery re-roll Table Fruit after every Nth play (0 = off)
 * @property {boolean} decree                challenge winner picks the next round's Table Fruit
 * @property {boolean} silent                socialMuted: the room muzzles seated chat this round
 */

/** @type {Readonly<MonkeyLiesRules>} */
export const DEFAULT_RULES = Object.freeze({
  handSize: HAND_SIZE,
  minPlay: MIN_PLAY,
  maxPlay: MAX_PLAY,
  startChambers: START_CHAMBERS,
  startCoconuts: START_COCONUTS,
  chipsPerMatch: CHIPS_PER_MATCH,
  chipBonus: CHIP_BONUS_CHAMBERS,
  goldenPerPlayer: null,
  turnDirection: 1,
  midRoundFruitFlipEvery: 0,
  decree: false,
  silent: false,
});

const OK = Object.freeze({ ok: true });
const err = (code) => ({ ok: false, code });

/**
 * §3.4 timeout auto-play: 1 matching card if possible (exact Table Fruit
 * first, then a wild Golden Banana), else 1 random card. NEVER calls.
 * Also the trivial fallback policy for bot seats / disconnect holds until
 * P3's real bot brains plug in (see net/sessions.js).
 *
 * @param {import('@monkeybar/shared/protocol.js').Card[]} hand
 * @param {string} tableFruit
 * @param {() => number} [rng]
 * @returns {string[]} cardIds to play (always length 1)
 */
export function chooseAutoPlayCards(hand, tableFruit, rng = Math.random) {
  const exact = hand.find((c) => c.fruit === tableFruit);
  if (exact) return [exact.id];
  const golden = hand.find((c) => c.fruit === FRUITS.GOLDEN);
  if (golden) return [golden.id];
  return [hand[Math.floor(rng() * hand.length)].id];
}

/**
 * Is the implicit claim "these are all Table Fruit" truthful?
 * Golden Bananas are wild and always count as Table Fruit.
 * @param {import('@monkeybar/shared/protocol.js').Card[]} cards
 * @param {string} tableFruit
 */
export function isTruthfulPlay(cards, tableFruit) {
  return cards.every((c) => cardMatchesTableFruit(c, tableFruit));
}

/**
 * @typedef {Object} EngineEvent
 * @property {string} t          §3.3 message type
 * @property {Object} p          §3.3 payload
 * @property {number} [seat]     when present the event is PRIVATE to that seat
 */

/**
 * @param {Object} options
 * @param {ReturnType<import('../table.js').createTable>} options.table
 * @param {number} [options.seed]
 * @param {() => number} [options.rng]        deal/shuffle/fruit stream
 * @param {() => number} [options.cannonRng]  cannon roll stream (tests inject)
 * @param {number} [options.turnSeconds]
 * @param {number} [options.penaltyWindowMs]
 * @param {number} [options.intermissionMs]
 * @param {string} [options.mapId]
 * @param {() => number} [options.now]
 * @param {(evt: EngineEvent) => void} [options.onEvent]
 * @param {{chooseTimeoutPlay?: Function}|null} [options.autoPlayPolicy]
 * @param {Partial<MonkeyLiesRules>} [options.rules]  match-wide rule overrides
 * @param {((roundNo: number) => Partial<MonkeyLiesRules>|null)|null} [options.roundRules]
 *        per-round rule patch hook (King of the Bar's Bar Rules). Called at
 *        the top of every startRound; the returned patch is merged over the
 *        match rules FOR THAT ROUND ONLY. `startChambers`/`startCoconuts` in
 *        a round patch act as effective cannon values without touching the
 *        permanent per-seat tracks.
 */
export function createMonkeyLiesEngine({
  table,
  seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
  rng = mulberry32(seed),
  cannonRng = mulberry32((seed ^ 0x9e3779b9) >>> 0),
  turnSeconds = TURN_SECONDS_DEFAULT,
  penaltyWindowMs = PENALTY_WINDOW_MS,
  intermissionMs = ROUND_INTERMISSION_MS,
  mapId = 'peeling_parrot',
  now = Date.now,
  onEvent = () => {},
  autoPlayPolicy = null,
  rules = {},
  roundRules = null,
} = {}) {
  if (!table) throw new TypeError('createMonkeyLiesEngine: table is required');

  /** @type {MonkeyLiesRules} match-wide rules (defaults = the §4 constants) */
  const baseRules = { ...DEFAULT_RULES, ...(rules ?? {}) };
  /** @type {MonkeyLiesRules} the CURRENT round's effective rules */
  let cur = { ...baseRules };
  /** @type {Partial<MonkeyLiesRules>} the raw per-round patch (for effective-value checks) */
  let curPatch = {};

  /** @type {import('@monkeybar/shared/protocol.js').GamePhase} */
  let phase = 'dealing';
  let roundNo = 0;
  /** @type {string|null} */
  let tableFruit = null;
  let turnSeat = -1;
  let turnDeadline = 0;
  /** The current turn's seat is the only holder: PLAY disallowed, CALL-or-fire. */
  let lastHolderPending = false;
  /** @type {{seat: number, cards: import('@monkeybar/shared/protocol.js').Card[], count: number}|null} */
  let lastPlay = null;
  /** @type {{seat: number, self: boolean, bonus: number, chipUsed: boolean, deadline: number}|null} */
  let penalty = null;
  let intermissionDeadline = 0;
  /** Seat numbers in elimination order (first eliminated first). */
  const eliminatedOrder = [];
  let firstSeatOfRound = -1;
  let winnerSeat = -1;
  /** Plays landed this round (drives midRoundFruitFlipEvery). */
  let playsThisRound = 0;
  /** Royal Decree: winner of the round's challenge (-1 = none / self-shot round). */
  let decreeWinner = -1;
  /** Royal Decree: pick-window deadline while phase === 'decree'. */
  let decreeDeadline = 0;
  /** Royal Decree: the fruit forced onto the NEXT round's table (consumed on deal). */
  let forcedNextFruit = null;

  const emit = (t, p, seat) => onEvent(seat === undefined ? { t, p } : { t, p, seat });
  const modeEvent = (kind, payload) => emit('modeEvent', { kind, ...payload });

  // ---- configurable-rule helpers ---------------------------------------------

  /** Effective coconut count for this round's cannon (per-round override aware). */
  const effCoconuts = (s) => curPatch.startCoconuts ?? s.coconuts;
  /** Effective chamber count for this round's cannon (permanent track untouched). */
  const effChambers = (s) => curPatch.startChambers ?? s.chambersLeft;

  /**
   * Local deck wrapper (do NOT touch shared/cards.js): the native §4.1 math is
   * used verbatim whenever handSize/goldenPerPlayer are stock, so plain Monkey
   * Lies decks stay byte-identical. Custom sizes keep the ~30% ratio; a
   * non-null goldenPerPlayer pins the wild count and splits the rest evenly.
   */
  function buildEngineDeck(aliveCount) {
    if (cur.handSize === HAND_SIZE && cur.goldenPerPlayer === null) {
      return buildDeck(aliveCount);
    }
    const total = aliveCount * cur.handSize;
    const golden =
      cur.goldenPerPlayer === null
        ? total - Math.floor(total * DECK_FRUIT_RATIO) * BASIC_FRUITS.length
        : Math.max(0, Math.min(total, cur.goldenPerPlayer * aliveCount));
    const deck = [];
    let n = 0;
    for (let i = 0; i < total - golden; i++) {
      deck.push({ id: `c${n++}`, fruit: BASIC_FRUITS[i % BASIC_FRUITS.length] });
    }
    for (let i = 0; i < golden; i++) deck.push({ id: `c${n++}`, fruit: FRUITS.GOLDEN });
    return deck;
  }

  /** Direction-aware "next alive seat with cards" (−1 walks counterclockwise). */
  function nextSeatWithCards(from) {
    if (cur.turnDirection === 1) return table.nextSeatWithCards(from);
    const n = table.size;
    for (let i = 1; i <= n; i++) {
      const s = table.seats[(((from - i) % n) + n) % n];
      if (s.alive && s.hand.length > 0) return s.seat;
    }
    return -1;
  }

  /**
   * Clamp a card selection into this round's [minPlay, maxPlay] band (padding
   * with further hand cards when short). Only invoked when the band differs
   * from the stock 1–3 so default timeout auto-play stays byte-identical.
   */
  function fitPlayCount(hand, cardIds) {
    const effMin = Math.min(cur.minPlay, hand.length);
    const max = Math.min(cur.maxPlay, hand.length);
    let ids = cardIds.slice(0, Math.max(1, max));
    if (ids.length < effMin) {
      ids = ids.slice();
      for (const c of hand) {
        if (ids.length >= effMin) break;
        if (!ids.includes(c.id)) ids.push(c.id);
      }
    }
    return ids;
  }

  // ---- round lifecycle ------------------------------------------------------

  function startRound() {
    roundNo += 1;
    // Per-round rule patch (Bar Rules): merged over the match rules.
    const patch = typeof roundRules === 'function' ? roundRules(roundNo) : null;
    curPatch = patch && typeof patch === 'object' ? { ...patch } : {};
    cur = { ...baseRules, ...curPatch };

    phase = 'dealing';
    lastPlay = null;
    penalty = null;
    lastHolderPending = false;
    playsThisRound = 0;
    decreeWinner = -1;

    const alive = table.aliveSeats();
    // Deck sized to the survivors (§4.1: P×5 cards); deal consumes it fully.
    const deck = shuffle(buildEngineDeck(alive.length), rng).map((card, i) => ({
      // Fresh opaque ids each round (anti-cheat §3.4: ids never map to fruits).
      id: `r${roundNo}c${i}`,
      fruit: card.fruit,
    }));
    for (let i = 0; i < alive.length; i++) {
      alive[i].hand = deck.slice(i * cur.handSize, (i + 1) * cur.handSize);
    }
    // Table Fruit is chosen AFTER dealing (§4.1) — unless a Royal Decree
    // fruit is waiting (then no rng draw is consumed).
    if (forcedNextFruit !== null) {
      tableFruit = forcedNextFruit;
      forcedNextFruit = null;
    } else {
      tableFruit = BASIC_FRUITS[Math.floor(rng() * BASIC_FRUITS.length)];
    }
    firstSeatOfRound =
      roundNo === 1
        ? alive[Math.floor(rng() * alive.length)].seat
        : table.nextAliveSeat(firstSeatOfRound);

    for (const s of alive) emit('hand', { cards: s.hand.slice() }, s.seat);
    emit('roundStart', {
      roundNo,
      tableFruit,
      firstSeat: firstSeatOfRound,
      seats: table.publicSeats(),
    });

    phase = 'playing';
    setTurn(firstSeatOfRound);
  }

  function setTurn(seat) {
    turnSeat = seat;
    turnDeadline = now() + turnSeconds * 1000;
    emit('turn', {
      seat,
      deadline: turnDeadline,
      canCall: canCallNow(seat),
      lastHolder: lastHolderPending,
    });
  }

  function canCallNow(seat) {
    return lastPlay !== null && lastPlay.seat !== seat;
  }

  // ---- actions ----------------------------------------------------------------

  /** @param {number} seat @param {string[]} cardIds */
  function play(seat, cardIds) {
    if (phase !== 'playing') return err(ERROR_CODES.BAD_STATE);
    if (seat !== turnSeat) return err(ERROR_CODES.NOT_YOUR_TURN);
    // Last Monkey Holding: no more plays — call the pending play or face the cannon.
    if (lastHolderPending) return err(ERROR_CODES.BAD_STATE);
    const s = table.get(seat);
    // Happy Hour clause: a hand holding fewer than minPlay may still shed what
    // it has (stock minPlay 1 makes this the original MIN_PLAY check exactly).
    const effMin = Math.min(cur.minPlay, s.hand.length);
    if (
      !Array.isArray(cardIds) ||
      cardIds.length < effMin ||
      cardIds.length > cur.maxPlay ||
      new Set(cardIds).size !== cardIds.length
    ) {
      return err(ERROR_CODES.INVALID_CARDS);
    }
    const cards = [];
    for (const id of cardIds) {
      const card = s.hand.find((c) => c.id === id);
      if (!card) return err(ERROR_CODES.INVALID_CARDS);
      cards.push(card);
    }
    s.hand = s.hand.filter((c) => !cardIds.includes(c.id));
    lastPlay = { seat, cards, count: cards.length };
    emit('played', { seat, count: cards.length, handCount: s.hand.length });
    playsThisRound += 1;
    // Sour Table: the Table Fruit re-rolls after every Nth play (0 = off).
    if (cur.midRoundFruitFlipEvery > 0 && playsThisRound % cur.midRoundFruitFlipEvery === 0) {
      flipTableFruit();
    }
    advanceAfterPlay(seat);
    return OK;
  }

  /** Sour Table re-roll: always lands on a DIFFERENT basic fruit. */
  function flipTableFruit() {
    const others = BASIC_FRUITS.filter((f) => f !== tableFruit);
    tableFruit = others[Math.floor(rng() * others.length)];
    modeEvent(ENGINE_EVENTS.FRUIT_FLIP, { fruit: tableFruit, roundNo });
  }

  function advanceAfterPlay(fromSeat) {
    const next = nextSeatWithCards(fromSeat);
    if (next === -1) {
      // Defensive only: unreachable because sole-holder turns cannot play.
      endRound();
      return;
    }
    if (next === fromSeat) {
      // Everyone else is empty and the player who just played still holds:
      // nobody can ever call them — Last Monkey Holding fires immediately.
      triggerLastHolder(fromSeat);
      return;
    }
    lastHolderPending = table.holders().length === 1; // === [next]
    setTurn(next);
  }

  /** @param {number} seat */
  function callLiar(seat) {
    if (phase !== 'playing') return err(ERROR_CODES.BAD_STATE);
    if (seat !== turnSeat) return err(ERROR_CODES.NOT_YOUR_TURN);
    if (!canCallNow(seat)) return err(ERROR_CODES.BAD_STATE);

    const target = lastPlay.seat;
    const cards = lastPlay.cards;
    const lie = !isTruthfulPlay(cards, tableFruit);
    const loser = lie ? target : seat;
    // Royal Decree: the challenge WINNER (the non-loser side) earns the pick.
    decreeWinner = lie ? seat : target;

    phase = 'revealing';
    lastHolderPending = false;
    emit('called', { callerSeat: seat, targetSeat: target });
    emit('reveal', { targetSeat: target, cards: cards.slice(), lie, loserSeat: loser });
    beginPenalty(loser, false);
    return OK;
  }

  function triggerLastHolder(seat) {
    lastHolderPending = false;
    decreeWinner = -1; // self-shot round: no challenge, no decree
    emit('lastHolder', { seat });
    beginPenalty(seat, true);
  }

  /**
   * §3.2 fireCannon: the pending Last-Monkey-Holding player fires the cannon
   * at themselves immediately instead of waiting out the turn timer.
   * @param {number} seat
   */
  function fireSelf(seat) {
    if (phase !== 'playing') return err(ERROR_CODES.BAD_STATE);
    if (seat !== turnSeat) return err(ERROR_CODES.NOT_YOUR_TURN);
    if (!lastHolderPending) return err(ERROR_CODES.BAD_STATE);
    triggerLastHolder(seat);
    return OK;
  }

  function beginPenalty(seat, self) {
    const s = table.get(seat);
    phase = 'penalty';
    penalty = {
      seat,
      self,
      bonus: 0,
      chipUsed: false,
      deadline: now() + penaltyWindowMs,
    };
    emit('penalty', {
      seat,
      chambers: effChambers(s),
      coconuts: effCoconuts(s),
      chipUsable: s.chips > 0,
      deadline: penalty.deadline,
    });
  }

  /** @param {number} seat */
  function useChip(seat) {
    if (phase !== 'penalty' || !penalty || penalty.seat !== seat) return err(ERROR_CODES.BAD_STATE);
    const s = table.get(seat);
    if (penalty.chipUsed || s.chips <= 0) return err(ERROR_CODES.BAD_STATE);
    s.chips -= 1;
    penalty.chipUsed = true;
    penalty.bonus = cur.chipBonus; // temporary chambers, THIS shot only
    emit('chipUsed', { seat, chambersNow: effChambers(s) + penalty.bonus });
    fireCannon(); // decision made — the fuse burns now
    return OK;
  }

  /** Fire the cannon now (driver: penalty window expired / bot decided). */
  function resolvePenalty() {
    if (phase !== 'penalty' || !penalty) return err(ERROR_CODES.BAD_STATE);
    fireCannon();
    return OK;
  }

  function fireCannon() {
    const { seat, bonus } = penalty;
    const s = table.get(seat);
    const chambers = effChambers(s) + bonus;
    const hit = cannonRng() < effCoconuts(s) / chambers;
    penalty = null;
    emit('cannon', { seat, hit });
    if (hit) {
      table.eliminate(seat);
      eliminatedOrder.push(seat);
      emit('eliminated', { seat });
    } else {
      // Survive → permanently lose one EMPTY chamber (6→5→…→1). The chip's
      // temporary chambers (and per-round overrides) do not persist.
      s.chambersLeft = Math.max(1, s.chambersLeft - 1);
    }
    if (table.aliveCount() <= 1) {
      endMatch();
      return;
    }
    // Royal Decree: the surviving challenge winner picks the next Table Fruit.
    if (cur.decree && decreeWinner !== -1 && table.get(decreeWinner).alive) {
      beginDecree(decreeWinner);
      return;
    }
    endRound();
  }

  // ---- Royal Decree (challenge winner picks the next round's Table Fruit) ------

  function beginDecree(seat) {
    phase = 'decree';
    turnSeat = seat;
    decreeDeadline = now() + DECREE_WINDOW_MS;
    emit('turn', {
      seat,
      deadline: decreeDeadline,
      canCall: false,
      lastHolder: false,
      actions: [PICK_FRUIT_ACTION],
    });
  }

  /** The fruit the seat holds most of (basic fruits only; rng breaks empty hands). */
  function mostHeldFruit(seat) {
    const counts = new Map(BASIC_FRUITS.map((f) => [f, 0]));
    for (const c of table.get(seat).hand) {
      if (counts.has(c.fruit)) counts.set(c.fruit, counts.get(c.fruit) + 1);
    }
    let best = null;
    let bestN = -1;
    for (const f of BASIC_FRUITS) {
      if (counts.get(f) > bestN) {
        best = f;
        bestN = counts.get(f);
      }
    }
    if (bestN <= 0) return BASIC_FRUITS[Math.floor(rng() * BASIC_FRUITS.length)];
    return best;
  }

  function resolveDecree(seat, fruit) {
    forcedNextFruit = fruit;
    decreeWinner = -1;
    modeEvent(ENGINE_EVENTS.FRUIT_PICKED, { seat, fruit });
    endRound();
  }

  /**
   * §10.1 generic modeAction router — the only ML verb is Royal Decree's
   * `pickFruit {fruit}`, legal solely during the decree window.
   * @param {number} seat
   * @param {string} action
   * @param {Object} [data]
   */
  function modeAction(seat, action, data = {}) {
    if (action !== PICK_FRUIT_ACTION) return err(ERROR_CODES.BAD_MSG);
    if (phase !== 'decree') return err(ERROR_CODES.BAD_STATE);
    if (seat !== turnSeat) return err(ERROR_CODES.NOT_YOUR_TURN);
    if (!BASIC_FRUITS.includes(data?.fruit)) return err(ERROR_CODES.BAD_MSG);
    resolveDecree(seat, data.fruit);
    return OK;
  }

  function endRound() {
    phase = 'roundEnd';
    turnSeat = -1;
    intermissionDeadline = now() + intermissionMs;
    emit('roundEnd', { nextIn: intermissionMs });
  }

  function endMatch() {
    phase = 'matchEnd';
    turnSeat = -1;
    winnerSeat = table.aliveSeats()[0]?.seat ?? -1;
    const standings = [];
    if (winnerSeat !== -1) {
      standings.push({ seat: winnerSeat, name: table.get(winnerSeat).name, place: 1 });
    }
    // Last eliminated finished highest; first eliminated finished last.
    const reversed = eliminatedOrder.slice().reverse();
    for (let i = 0; i < reversed.length; i++) {
      const seat = reversed[i];
      standings.push({ seat, name: table.get(seat).name, place: standings.length + 1 });
    }
    emit('matchEnd', { winnerSeat, standings });
  }

  // ---- timeouts (driver calls when a deadline passes) -------------------------

  /**
   * @param {'turn'|'penalty'|'intermission'|'decree'} kind
   * @returns {boolean} whether the timeout applied to the current state
   */
  function onTimeout(kind) {
    if (kind === 'turn') {
      // The gameRoom bot fallback funnels ANY turn through here — during a
      // decree window that means "pick for me" (most-held fruit).
      if (phase === 'decree') {
        resolveDecree(turnSeat, mostHeldFruit(turnSeat));
        return true;
      }
      if (phase !== 'playing') return false;
      if (lastHolderPending) {
        // Declined (or slept through) the call — Last Monkey Holding self-shot.
        triggerLastHolder(turnSeat);
        return true;
      }
      const s = table.get(turnSeat);
      const choose = autoPlayPolicy?.chooseTimeoutPlay;
      let cardIds = null;
      if (choose) {
        try {
          cardIds = choose({ hand: s.hand.slice(), tableFruit, rng });
        } catch {
          cardIds = null;
        }
      }
      if (!Array.isArray(cardIds) || cardIds.length === 0) {
        cardIds = chooseAutoPlayCards(s.hand, tableFruit, rng);
      }
      // Non-stock play band (e.g. Happy Hour minPlay 2): pad/trim the pick.
      if (cur.minPlay !== MIN_PLAY || cur.maxPlay !== MAX_PLAY) {
        cardIds = fitPlayCount(s.hand, cardIds);
      }
      const res = play(turnSeat, cardIds);
      if (!res.ok) {
        // Policy returned garbage — fall back to the default single card.
        let fallback = chooseAutoPlayCards(s.hand, tableFruit, rng);
        if (cur.minPlay !== MIN_PLAY || cur.maxPlay !== MAX_PLAY) {
          fallback = fitPlayCount(s.hand, fallback);
        }
        play(turnSeat, fallback);
      }
      return true;
    }
    if (kind === 'penalty') {
      if (phase !== 'penalty') return false;
      fireCannon();
      return true;
    }
    if (kind === 'decree') {
      if (phase !== 'decree') return false;
      resolveDecree(turnSeat, mostHeldFruit(turnSeat));
      return true;
    }
    if (kind === 'intermission') {
      if (phase !== 'roundEnd') return false;
      startRound();
      return true;
    }
    return false;
  }

  /** @returns {{kind: 'turn'|'penalty'|'intermission'|'decree', deadline: number}|null} */
  function getTimer() {
    if (phase === 'playing') return { kind: 'turn', deadline: turnDeadline };
    if (phase === 'penalty' && penalty) return { kind: 'penalty', deadline: penalty.deadline };
    if (phase === 'decree') return { kind: 'decree', deadline: decreeDeadline };
    if (phase === 'roundEnd') return { kind: 'intermission', deadline: intermissionDeadline };
    return null;
  }

  // ---- snapshots ----------------------------------------------------------------

  /**
   * §3.1 Snapshot with private filtering: `yourHand` only for the owner seat;
   * spectators pass null → yourSeat/yourHand null.
   * @param {number|null} seat
   */
  function snapshotFor(seat) {
    const isSeat = typeof seat === 'number' && seat >= 0 && seat < table.size;
    const s = isSeat ? table.get(seat) : null;
    const victim = penalty ? table.get(penalty.seat) : null;
    return {
      mode: MONKEY_LIES_MODE_ID,
      mapId,
      phase,
      roundNo,
      tableFruit,
      seats: table.publicSeats(),
      turnSeat,
      deadline: getTimer()?.deadline ?? 0,
      lastPlay: lastPlay ? { seat: lastPlay.seat, count: lastPlay.count } : null,
      lastHolder: lastHolderPending,
      penalty: penalty
        ? {
            seat: penalty.seat,
            chambers: effChambers(victim),
            coconuts: effCoconuts(victim),
            chipUsable: victim.chips > 0 && !penalty.chipUsed,
            deadline: penalty.deadline,
          }
        : null,
      yourSeat: isSeat ? seat : null,
      yourHand: s ? s.hand.slice() : null,
      chipUsedByYou: s ? s.chips <= 0 : false,
    };
  }

  function start() {
    if (roundNo !== 0) throw new Error('engine already started');
    // Match-wide resource rules: only touch the seats when they differ from
    // the stock constants — tests (and the original flow) may pre-stage seat
    // state before start(), and stock matches must stay byte-identical.
    if (baseRules.startChambers !== START_CHAMBERS) {
      for (const s of table.seats) s.chambersLeft = baseRules.startChambers;
    }
    if (baseRules.startCoconuts !== START_COCONUTS) {
      for (const s of table.seats) s.coconuts = baseRules.startCoconuts;
    }
    if (baseRules.chipsPerMatch !== CHIPS_PER_MATCH) {
      for (const s of table.seats) s.chips = baseRules.chipsPerMatch;
    }
    startRound();
  }

  return {
    modeId: MONKEY_LIES_MODE_ID,
    start,
    play,
    callLiar,
    useChip,
    fireSelf,
    resolvePenalty,
    modeAction,
    onTimeout,
    getTimer,
    snapshotFor,
    get phase() {
      return phase;
    },
    get roundNo() {
      return roundNo;
    },
    get tableFruit() {
      return tableFruit;
    },
    get turnSeat() {
      return turnSeat;
    },
    get lastHolderPending() {
      return lastHolderPending;
    },
    get lastPlay() {
      return lastPlay ? { seat: lastPlay.seat, count: lastPlay.count } : null;
    },
    get winnerSeat() {
      return winnerSeat;
    },
    /** Silent-round rule: the lobby room muzzles seated chat while true. */
    get socialMuted() {
      return !!cur.silent && (phase === 'playing' || phase === 'revealing' || phase === 'penalty' || phase === 'decree');
    },
    /** The CURRENT round's effective rules (server-internal: wrappers/tests). */
    get roundRulesNow() {
      return { ...cur };
    },
    /** Server-internal/test inspection (never sent to clients). */
    inspect() {
      return {
        phase,
        roundNo,
        tableFruit,
        turnSeat,
        lastHolderPending,
        lastPlayCards: lastPlay ? lastPlay.cards.slice() : null,
        penalty: penalty ? { ...penalty } : null,
        eliminatedOrder: eliminatedOrder.slice(),
        rules: { ...cur },
        decreeWinner,
        forcedNextFruit,
      };
    },
  };
}
