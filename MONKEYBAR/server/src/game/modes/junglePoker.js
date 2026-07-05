// Jungle Poker — 3-card blind poker with banana-chip stakes (R6).
// PLAN.md §4.3 rules sketch + §10.3 snapshot/verb contract (binding).
//
// A PURE, SEEDABLE state machine mirroring monkeyLies.js conventions: no
// sockets, no timers. The engine mutates the table, emits §3.3 events plus
// `modeEvent` (kinds in shared/modeEvents.js POKER_EVENTS) through `onEvent`,
// and exposes deadlines via getTimer(); the driver (game/gameRoom.js) owns
// real clocks and calls onTimeout(kind).
//
// Rules implemented exactly (RELEASE_PLAN R6):
//  - Stacks start at POKER_START_STACK (per-seat `stack`).
//  - Each hand: alive players ante POKER_ANTE (ANTE event), receive 3 private
//    cards from shared/poker.js (YOUR_CARDS, seat-private — other players'
//    cards are NEVER sent), then ONE betting rotation from the hand's first
//    seat: `turn` carries actions ['fold','call','raise'] (call = match
//    toCall, may be 0 = check; raise {amount} 1–3 chips, POKER_MAX_RAISES per
//    hand; all-in allowed when short). The rotation continues until every
//    non-folded player has matched the highest bet (or is all-in).
//  - One player left → wins the pot uncontested: NO reveal, folds stay muck.
//  - Otherwise SHOWDOWN reveals the contenders' hands with evaluateHand
//    names; the best hand takes the pot (ties split, odd chip to the
//    earliest seat).
//  - A player who cannot ante faces the Coconut Cannon (ML penalty/chip/
//    cannon/eliminated shapes + the table's chambers): survive → stack
//    refunds to POKER_BUST_REFUND chips; hit → eliminated.
//  - Turn timeout: check if free, else fold. Last monkey standing wins.

import {
  CHIP_BONUS_CHAMBERS,
  PENALTY_WINDOW_MS,
  POKER_ANTE,
  POKER_BUST_REFUND,
  POKER_MAX_RAISES,
  POKER_START_STACK,
  ROUND_INTERMISSION_MS,
  TURN_SECONDS_DEFAULT,
} from '@monkeybar/shared/constants.js';
import { buildPokerDeck, compareHands, evaluateHand } from '@monkeybar/shared/poker.js';
import { POKER_ACTIONS, POKER_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { ERROR_CODES } from '@monkeybar/shared/protocol.js';
import { mulberry32, shuffle } from '@monkeybar/shared/rng.js';

export const MODE_ID = 'junglePoker';
export const PLAYABLE = true;

/** Raise sizing bounds (chips ON TOP of the call amount). */
export const RAISE_MIN = 1;
export const RAISE_MAX = 3;
/** Hole cards per hand. */
export const POKER_HAND_SIZE = 3;

const OK = Object.freeze({ ok: true });
const err = (code) => ({ ok: false, code });

/**
 * Split `pot` between `winnerSeats` — equal shares, odd chips one at a time
 * to the EARLIEST seats (ascending seat number). Pure, exported for tests.
 * @param {number} pot
 * @param {number[]} winnerSeats
 * @returns {Array<{seat: number, amount: number}>}
 */
export function splitPot(pot, winnerSeats) {
  const ordered = [...winnerSeats].sort((a, b) => a - b);
  const share = Math.floor(pot / ordered.length);
  let odd = pot - share * ordered.length;
  return ordered.map((seat) => ({ seat, amount: share + (odd-- > 0 ? 1 : 0) }));
}

/**
 * @param {Object} options
 * @param {ReturnType<import('../table.js').createTable>} options.table
 * @param {number} [options.seed]
 * @param {() => number} [options.rng]        shuffle/deal stream
 * @param {() => number} [options.cannonRng]  cannon roll stream (tests inject)
 * @param {number} [options.turnSeconds]
 * @param {number} [options.penaltyWindowMs]
 * @param {number} [options.intermissionMs]
 * @param {number} [options.startStack]       tests only
 * @param {string} [options.mapId]
 * @param {() => number} [options.now]
 * @param {(evt: {t: string, p: Object, seat?: number}) => void} [options.onEvent]
 */
export function createEngine({
  table,
  seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
  rng = mulberry32(seed),
  cannonRng = mulberry32((seed ^ 0x9e3779b9) >>> 0),
  turnSeconds = TURN_SECONDS_DEFAULT,
  penaltyWindowMs = PENALTY_WINDOW_MS,
  intermissionMs = ROUND_INTERMISSION_MS,
  startStack = POKER_START_STACK,
  mapId = 'peeling_parrot',
  now = Date.now,
  onEvent = () => {},
} = {}) {
  if (!table) throw new TypeError('junglePoker.createEngine: table is required');

  /** @type {'dealing'|'playing'|'penalty'|'roundEnd'|'matchEnd'} */
  let phase = 'dealing';
  let roundNo = 0; // hand number
  let turnSeat = -1;
  let turnDeadline = 0;
  let intermissionDeadline = 0;
  let winnerSeat = -1;
  /** Monotonic event sequence — lets clients order snapshot vs modeEvents. */
  let seq = 0;

  // ---- per-seat poker state (engine-owned; table keeps chips/chambers) ------
  /** @type {Map<number, number>} banana-chip stacks */
  const stacks = new Map();
  /** @type {Map<number, number>} chips committed to the CURRENT betting round */
  const bets = new Map();
  /** @type {Set<number>} folded this hand */
  const folded = new Set();
  /** @type {Map<number, import('@monkeybar/shared/poker.js').PokerCard[]>} hole cards */
  const holeCards = new Map();
  /** @type {Set<number>} seats dealt into the current hand */
  const inHand = new Set();
  for (const s of table.seats) stacks.set(s.seat, startStack);

  // ---- per-hand betting state ------------------------------------------------
  let pot = 0;
  let currentBet = 0;
  let raisesUsed = 0;
  /** @type {Set<number>} seats that still owe an action this rotation */
  const needAct = new Set();
  let firstSeatOfRound = -1;

  // ---- bust-cannon state (ML penalty shapes) ----------------------------------
  /** @type {{seat: number, bonus: number, chipUsed: boolean, deadline: number}|null} */
  let penalty = null;
  /** @type {number[]} seats waiting for their bust cannon this hand-start */
  const bustQueue = [];
  /** Seat numbers in elimination order (first eliminated first). */
  const eliminatedOrder = [];

  const emit = (t, p, seat) => onEvent(seat === undefined ? { t, p } : { t, p, seat });
  const emitMode = (kind, payload, seat) => emit('modeEvent', { kind, seq: ++seq, ...payload }, seat);

  // ---- views -------------------------------------------------------------------

  /** §10.3 SeatPublic + per-seat poker extension {stack, bet, folded}. */
  function pokerSeats() {
    return table.publicSeats().map((ps) => ({
      ...ps,
      stack: stacks.get(ps.seat) ?? 0,
      bet: bets.get(ps.seat) ?? 0,
      folded: folded.has(ps.seat),
    }));
  }

  const toCallOf = (seat) => Math.max(0, currentBet - (bets.get(seat) ?? 0));
  /** Contenders: dealt in, still alive, not folded. */
  const contenders = () => [...inHand].filter((s) => table.get(s).alive && !folded.has(s));

  function legalActions(seat) {
    const actions = [POKER_ACTIONS.FOLD, POKER_ACTIONS.CALL];
    const stack = stacks.get(seat) ?? 0;
    // A raise must actually top the current bet, respect the per-hand cap,
    // and leave at least one opponent who could put more chips in (no side
    // pots — raising into all-all-in opponents would just donate dead money).
    const someoneCanPay = contenders().some((s) => s !== seat && (stacks.get(s) ?? 0) > 0);
    if (raisesUsed < POKER_MAX_RAISES && stack > toCallOf(seat) && someoneCanPay) {
      actions.push(POKER_ACTIONS.RAISE);
    }
    return actions;
  }

  // ---- hand lifecycle -------------------------------------------------------------

  function startRound() {
    roundNo += 1;
    phase = 'dealing';
    penalty = null;
    pot = 0;
    currentBet = 0;
    raisesUsed = 0;
    bets.clear();
    folded.clear();
    holeCards.clear();
    inHand.clear();
    needAct.clear();
    turnSeat = -1;

    const alive = table.aliveSeats();
    firstSeatOfRound =
      roundNo === 1
        ? alive[Math.floor(rng() * alive.length)].seat
        : table.nextAliveSeat(firstSeatOfRound);

    // Busted monkeys (cannot ante) face the cannon BEFORE the deal, one at a
    // time, in seat order from the hand's first seat.
    for (let i = 0; i < table.size; i++) {
      const seat = (firstSeatOfRound + i) % table.size;
      const s = table.seats[seat];
      if (s.alive && (stacks.get(seat) ?? 0) < POKER_ANTE) bustQueue.push(seat);
    }
    processBustsOrDeal();
  }

  function processBustsOrDeal() {
    while (bustQueue.length) {
      const seat = bustQueue.shift();
      if (!table.get(seat).alive) continue; // defensive: already gone
      emitMode(POKER_EVENTS.BUST, { seat });
      beginPenalty(seat);
      return; // wait for the chip window / cannon
    }
    dealHand();
  }

  function dealHand() {
    // Ante — every alive player can cover it now (bust refunds guarantee ≥ ante).
    const antes = [];
    for (const s of table.aliveSeats()) {
      const seat = s.seat;
      inHand.add(seat);
      bets.set(seat, 0);
      stacks.set(seat, (stacks.get(seat) ?? 0) - POKER_ANTE);
      pot += POKER_ANTE;
      antes.push({ seat, amount: POKER_ANTE });
    }
    emitMode(POKER_EVENTS.ANTE, {
      pot,
      antes,
      currentBet,
      raisesUsed,
      seats: pokerSeats(),
    });

    // Deal 3 private cards each from a fresh shuffled 52-card jungle deck.
    // Ids are re-minted per hand (anti-cheat §3.4: opaque, never map to
    // suit/rank across hands).
    const deck = shuffle(buildPokerDeck(), rng).map((c, i) => ({
      id: `h${roundNo}c${i}`,
      suit: c.suit,
      rank: c.rank,
    }));
    let next = 0;
    for (const seat of inHand) {
      const cards = deck.slice(next, next + POKER_HAND_SIZE);
      next += POKER_HAND_SIZE;
      holeCards.set(seat, cards);
      emitMode(POKER_EVENTS.YOUR_CARDS, { cards: cards.map((c) => ({ ...c })) }, seat);
    }

    emit('roundStart', {
      roundNo,
      tableFruit: null,
      firstSeat: firstSeatOfRound,
      seats: pokerSeats(),
    });

    phase = 'playing';
    // Everyone with chips owes one action; ante all-ins ride along for free.
    for (const seat of inHand) {
      if ((stacks.get(seat) ?? 0) > 0) needAct.add(seat);
    }
    const first = nextActor(firstSeatOfRound - 1);
    if (first === -1) {
      resolveHand(); // everyone all-in from the ante — straight to showdown
      return;
    }
    setTurn(first);
  }

  /** Next seat strictly after `from` (clockwise) that still owes an action. */
  function nextActor(from) {
    for (let i = 1; i <= table.size; i++) {
      const seat = (from + i) % table.size;
      if (needAct.has(seat)) return seat;
    }
    return -1;
  }

  function setTurn(seat) {
    turnSeat = seat;
    turnDeadline = now() + turnSeconds * 1000;
    emit('turn', {
      seat,
      deadline: turnDeadline,
      canCall: false,
      lastHolder: false,
      actions: legalActions(seat),
      toCall: toCallOf(seat),
    });
  }

  function advanceAfterAction() {
    if (contenders().length === 1) {
      resolveHand();
      return;
    }
    const next = nextActor(turnSeat);
    if (next === -1) {
      resolveHand(); // everyone matched (or is all-in) — rotation complete
      return;
    }
    setTurn(next);
  }

  // ---- betting actions (§10.1 modeAction verbs) -------------------------------------

  /**
   * @param {number} seat
   * @param {string} action  'fold' | 'call' | 'raise'
   * @param {Object} [data]  raise: {amount}
   */
  function modeAction(seat, action, data = {}) {
    if (phase !== 'playing') return err(ERROR_CODES.BAD_STATE);
    if (seat !== turnSeat) return err(ERROR_CODES.NOT_YOUR_TURN);

    if (action === POKER_ACTIONS.FOLD) return doFold(seat);
    if (action === POKER_ACTIONS.CALL) return doCall(seat);
    if (action === POKER_ACTIONS.RAISE) return doRaise(seat, data);
    return err(ERROR_CODES.BAD_MSG);
  }

  function actionEvent(seat, action, amount, extra = {}) {
    const next = nextActor(seat);
    emitMode(POKER_EVENTS.ACTION, {
      seat,
      action,
      amount,
      pot,
      toCall: next === -1 ? 0 : toCallOf(next),
      currentBet,
      raisesUsed,
      allIn: (stacks.get(seat) ?? 0) === 0 && !folded.has(seat),
      seats: pokerSeats(),
      ...extra,
    });
  }

  function doFold(seat) {
    folded.add(seat);
    needAct.delete(seat);
    holeCards.delete(seat); // fold-and-muck: identities never leave the engine
    actionEvent(seat, POKER_ACTIONS.FOLD, 0);
    advanceAfterAction();
    return OK;
  }

  function doCall(seat) {
    const owed = toCallOf(seat);
    const pay = Math.min(owed, stacks.get(seat) ?? 0); // short stack → all-in call
    stacks.set(seat, (stacks.get(seat) ?? 0) - pay);
    bets.set(seat, (bets.get(seat) ?? 0) + pay);
    pot += pay;
    needAct.delete(seat);
    actionEvent(seat, POKER_ACTIONS.CALL, pay);
    advanceAfterAction();
    return OK;
  }

  function doRaise(seat, data) {
    if (raisesUsed >= POKER_MAX_RAISES) return err(ERROR_CODES.BAD_STATE);
    const amount = data?.amount;
    if (!Number.isInteger(amount) || amount < RAISE_MIN || amount > RAISE_MAX) {
      return err(ERROR_CODES.BAD_MSG);
    }
    const stack = stacks.get(seat) ?? 0;
    const owed = toCallOf(seat);
    if (stack <= owed) return err(ERROR_CODES.BAD_STATE); // can't top the bet — call or fold
    const rise = Math.min(amount, stack - owed); // all-in allowed when short
    const pay = owed + rise;
    stacks.set(seat, stack - pay);
    bets.set(seat, (bets.get(seat) ?? 0) + pay);
    pot += pay;
    currentBet = bets.get(seat);
    raisesUsed += 1;
    // Everyone else still in (and not all-in) must respond to the new bet.
    needAct.delete(seat);
    for (const other of contenders()) {
      if (other !== seat && (stacks.get(other) ?? 0) > 0) needAct.add(other);
    }
    actionEvent(seat, POKER_ACTIONS.RAISE, rise);
    advanceAfterAction();
    return OK;
  }

  // ---- resolution ----------------------------------------------------------------------

  function resolveHand() {
    turnSeat = -1;
    needAct.clear();
    const live = contenders();
    const potWon = pot;

    if (live.length === 1) {
      // Uncontested — NO reveal, folds stay private (hands: []).
      const seat = live[0];
      stacks.set(seat, (stacks.get(seat) ?? 0) + potWon);
      pot = 0;
      emitMode(POKER_EVENTS.SHOWDOWN, {
        uncontested: true,
        hands: [],
        winnerSeat: seat,
        winners: [{ seat, amount: potWon }],
        pot: potWon,
        seats: pokerSeats(),
      });
      endRound();
      return;
    }

    // Showdown: evaluate every contender, best hand(s) take the pot.
    const ranked = live.map((seat) => {
      const cards = holeCards.get(seat) ?? [];
      const rank = evaluateHand(cards);
      return { seat, cards, rank };
    });
    let best = ranked[0].rank;
    for (const r of ranked) if (compareHands(r.rank, best) > 0) best = r.rank;
    const winnerSeats = ranked.filter((r) => compareHands(r.rank, best) === 0).map((r) => r.seat);
    const winners = splitPot(potWon, winnerSeats);
    for (const w of winners) stacks.set(w.seat, (stacks.get(w.seat) ?? 0) + w.amount);
    pot = 0;

    emitMode(POKER_EVENTS.SHOWDOWN, {
      uncontested: false,
      hands: ranked.map((r) => ({
        seat: r.seat,
        cards: r.cards.map((c) => ({ ...c })),
        rankClass: r.rank.rankClass,
        name: r.rank.name,
      })),
      winnerSeat: winners[0].seat,
      winners,
      pot: potWon,
      seats: pokerSeats(),
    });
    endRound();
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
    penalty = null;
    winnerSeat = table.aliveSeats()[0]?.seat ?? -1;
    const standings = [];
    if (winnerSeat !== -1) {
      standings.push({ seat: winnerSeat, name: table.get(winnerSeat).name, place: 1 });
    }
    const reversed = eliminatedOrder.slice().reverse();
    for (const seat of reversed) {
      standings.push({ seat, name: table.get(seat).name, place: standings.length + 1 });
    }
    emit('matchEnd', { winnerSeat, standings });
  }

  // ---- bust cannon (ML §4.2 shapes, table chambers) ---------------------------------------

  function beginPenalty(seat) {
    const s = table.get(seat);
    phase = 'penalty';
    turnSeat = -1;
    penalty = { seat, bonus: 0, chipUsed: false, deadline: now() + penaltyWindowMs };
    emit('penalty', {
      seat,
      chambers: s.chambersLeft,
      coconuts: s.coconuts,
      chipUsable: s.chips > 0,
      deadline: penalty.deadline,
    });
  }

  /** §3.2 useChip — only during your own bust penalty window. */
  function useChip(seat) {
    if (phase !== 'penalty' || !penalty || penalty.seat !== seat) return err(ERROR_CODES.BAD_STATE);
    const s = table.get(seat);
    if (penalty.chipUsed || s.chips <= 0) return err(ERROR_CODES.BAD_STATE);
    s.chips -= 1;
    penalty.chipUsed = true;
    penalty.bonus = CHIP_BONUS_CHAMBERS;
    emit('chipUsed', { seat, chambersNow: s.chambersLeft + penalty.bonus });
    fireCannon();
    return OK;
  }

  /** Fire the cannon now (driver: penalty window expired / bot declined the chip). */
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
      stacks.set(seat, 0);
      emit('eliminated', { seat });
    } else {
      // Survive → permanently lose one empty chamber, and the bar fronts you
      // POKER_BUST_REFUND chips to keep playing.
      s.chambersLeft = Math.max(1, s.chambersLeft - 1);
      stacks.set(seat, POKER_BUST_REFUND);
    }
    if (table.aliveCount() <= 1) {
      bustQueue.length = 0;
      endMatch();
      return;
    }
    phase = 'dealing';
    processBustsOrDeal(); // next bust in the queue, or on with the hand
  }

  // ---- timeouts (driver calls when a deadline passes) ----------------------------------------

  /**
   * @param {'turn'|'penalty'|'intermission'} kind
   * @returns {boolean} whether the timeout applied to the current state
   */
  function onTimeout(kind) {
    if (kind === 'turn') {
      if (phase !== 'playing') return false;
      // §B/R6: timeout = check if free, else fold.
      if (toCallOf(turnSeat) === 0) doCall(turnSeat);
      else doFold(turnSeat);
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

  // ---- snapshots -------------------------------------------------------------------------------

  /**
   * §10.3 junglePoker snapshot: Base + pot/toCall/yourCards(owner-only)/penalty,
   * per-seat stack/bet/folded. Spectators pass null → yourSeat/yourCards null.
   * @param {number|null} seat
   */
  function snapshotFor(seat) {
    const isSeat = typeof seat === 'number' && seat >= 0 && seat < table.size;
    const victim = penalty ? table.get(penalty.seat) : null;
    const mine = isSeat && !folded.has(seat) ? holeCards.get(seat) ?? null : null;
    // toCall is viewer-relative for seated players (folded/out-of-hand owe 0);
    // spectators see the acting seat's toCall.
    const toCall = isSeat
      ? inHand.has(seat) && !folded.has(seat)
        ? toCallOf(seat)
        : 0
      : turnSeat !== -1
        ? toCallOf(turnSeat)
        : 0;
    return {
      mode: MODE_ID,
      mapId,
      phase,
      roundNo,
      tableFruit: null,
      seats: pokerSeats(),
      turnSeat,
      deadline: getTimer()?.deadline ?? 0,
      pot,
      toCall,
      currentBet,
      raisesUsed,
      seq,
      yourSeat: isSeat ? seat : null,
      yourCards: mine ? mine.map((c) => ({ ...c })) : null,
      penalty: penalty
        ? {
            seat: penalty.seat,
            chambers: victim.chambersLeft,
            coconuts: victim.coconuts,
            chipUsable: victim.chips > 0 && !penalty.chipUsed,
            deadline: penalty.deadline,
          }
        : null,
    };
  }

  function start() {
    if (roundNo !== 0) throw new Error('engine already started');
    startRound();
  }

  return {
    modeId: MODE_ID,
    start,
    modeAction,
    useChip,
    resolvePenalty,
    onTimeout,
    getTimer,
    snapshotFor,
    // ML-native verbs are not part of Jungle Poker — reject, never crash.
    play: () => err(ERROR_CODES.BAD_MSG),
    callLiar: () => err(ERROR_CODES.BAD_MSG),
    fireSelf: () => err(ERROR_CODES.BAD_MSG),
    get phase() {
      return phase;
    },
    get roundNo() {
      return roundNo;
    },
    get turnSeat() {
      return turnSeat;
    },
    /** Engine contract: constant false (no Last-Monkey-Holding in poker). */
    get lastHolderPending() {
      return false;
    },
    get winnerSeat() {
      return winnerSeat;
    },
    /** Server-internal/test inspection (never sent to clients). */
    inspect() {
      return {
        phase,
        roundNo,
        turnSeat,
        pot,
        currentBet,
        raisesUsed,
        firstSeat: firstSeatOfRound,
        stacks: new Map(stacks),
        bets: new Map(bets),
        folded: new Set(folded),
        inHand: new Set(inHand),
        needAct: new Set(needAct),
        penalty: penalty ? { ...penalty } : null,
        bustQueue: bustQueue.slice(),
        eliminatedOrder: eliminatedOrder.slice(),
      };
    },
  };
}
