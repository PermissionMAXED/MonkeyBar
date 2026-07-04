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

import {
  CHIP_BONUS_CHAMBERS,
  HAND_SIZE,
  MAX_PLAY,
  MIN_PLAY,
  PENALTY_WINDOW_MS,
  ROUND_INTERMISSION_MS,
  TURN_SECONDS_DEFAULT,
} from '@monkeybar/shared/constants.js';
import { BASIC_FRUITS, FRUITS, buildDeck, cardMatchesTableFruit } from '@monkeybar/shared/cards.js';
import { ERROR_CODES } from '@monkeybar/shared/protocol.js';
import { mulberry32, shuffle } from '@monkeybar/shared/rng.js';

export const MONKEY_LIES_MODE_ID = 'monkeyLies';

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
} = {}) {
  if (!table) throw new TypeError('createMonkeyLiesEngine: table is required');

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

  const emit = (t, p, seat) => onEvent(seat === undefined ? { t, p } : { t, p, seat });

  // ---- round lifecycle ------------------------------------------------------

  function startRound() {
    roundNo += 1;
    phase = 'dealing';
    lastPlay = null;
    penalty = null;
    lastHolderPending = false;

    const alive = table.aliveSeats();
    // Deck sized to the survivors (§4.1: P×5 cards); deal consumes it fully.
    const deck = shuffle(buildDeck(alive.length), rng).map((card, i) => ({
      // Fresh opaque ids each round (anti-cheat §3.4: ids never map to fruits).
      id: `r${roundNo}c${i}`,
      fruit: card.fruit,
    }));
    for (let i = 0; i < alive.length; i++) {
      alive[i].hand = deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE);
    }
    // Table Fruit is chosen AFTER dealing (§4.1).
    tableFruit = BASIC_FRUITS[Math.floor(rng() * BASIC_FRUITS.length)];
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
    emit('turn', { seat, deadline: turnDeadline, canCall: canCallNow(seat) });
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
    if (
      !Array.isArray(cardIds) ||
      cardIds.length < MIN_PLAY ||
      cardIds.length > MAX_PLAY ||
      new Set(cardIds).size !== cardIds.length
    ) {
      return err(ERROR_CODES.INVALID_CARDS);
    }
    const s = table.get(seat);
    const cards = [];
    for (const id of cardIds) {
      const card = s.hand.find((c) => c.id === id);
      if (!card) return err(ERROR_CODES.INVALID_CARDS);
      cards.push(card);
    }
    s.hand = s.hand.filter((c) => !cardIds.includes(c.id));
    lastPlay = { seat, cards, count: cards.length };
    emit('played', { seat, count: cards.length, handCount: s.hand.length });
    advanceAfterPlay(seat);
    return OK;
  }

  function advanceAfterPlay(fromSeat) {
    const next = table.nextSeatWithCards(fromSeat);
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

    phase = 'revealing';
    lastHolderPending = false;
    emit('called', { callerSeat: seat, targetSeat: target });
    emit('reveal', { targetSeat: target, cards: cards.slice(), lie, loserSeat: loser });
    beginPenalty(loser, false);
    return OK;
  }

  function triggerLastHolder(seat) {
    lastHolderPending = false;
    emit('lastHolder', { seat });
    beginPenalty(seat, true);
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
      chambers: s.chambersLeft,
      coconuts: s.coconuts,
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
    penalty.bonus = CHIP_BONUS_CHAMBERS; // +2 temporary chambers, THIS shot only
    emit('chipUsed', { seat, chambersNow: s.chambersLeft + penalty.bonus });
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
    const chambers = s.chambersLeft + bonus;
    const hit = cannonRng() < s.coconuts / chambers;
    penalty = null;
    emit('cannon', { seat, hit });
    if (hit) {
      table.eliminate(seat);
      eliminatedOrder.push(seat);
      emit('eliminated', { seat });
    } else {
      // Survive → permanently lose one EMPTY chamber (6→5→…→1). The chip's
      // +2 chambers were temporary and do not persist.
      s.chambersLeft = Math.max(1, s.chambersLeft - 1);
    }
    if (table.aliveCount() <= 1) endMatch();
    else endRound();
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
   * @param {'turn'|'penalty'|'intermission'} kind
   * @returns {boolean} whether the timeout applied to the current state
   */
  function onTimeout(kind) {
    if (kind === 'turn') {
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
      const res = play(turnSeat, cardIds);
      if (!res.ok) {
        // Policy returned garbage — fall back to the default single card.
        play(turnSeat, chooseAutoPlayCards(s.hand, tableFruit, rng));
      }
      return true;
    }
    if (kind === 'penalty') {
      if (phase !== 'penalty') return false;
      fireCannon();
      return true;
    }
    if (kind === 'intermission') {
      if (phase !== 'roundEnd') return false;
      startRound();
      return true;
    }
    return false;
  }

  /** @returns {{kind: 'turn'|'penalty'|'intermission', deadline: number}|null} */
  function getTimer() {
    if (phase === 'playing') return { kind: 'turn', deadline: turnDeadline };
    if (phase === 'penalty' && penalty) return { kind: 'penalty', deadline: penalty.deadline };
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
      yourSeat: isSeat ? seat : null,
      yourHand: s ? s.hand.slice() : null,
      chipUsedByYou: s ? s.chips <= 0 : false,
    };
  }

  function start() {
    if (roundNo !== 0) throw new Error('engine already started');
    startRound();
  }

  return {
    modeId: MONKEY_LIES_MODE_ID,
    start,
    play,
    callLiar,
    useChip,
    resolvePenalty,
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
      };
    },
  };
}
