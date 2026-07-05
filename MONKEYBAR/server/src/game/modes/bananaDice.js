// Banana Dice — liar's-dice under coconut shells (R4). PLAN.md §4.3 sketch,
// §10.3 snapshot extension, RELEASE_PLAN.md R4 rules (binding):
//
//  - Every alive player starts the MATCH with DICE_START dice. Each round all
//    survivors' dice re-roll PRIVATELY (seat-private modeEvent YOUR_DICE — a
//    seat only ever sees its own dice; others get per-seat counts).
//  - Bidding rotates clockwise from the round's first seat (rotates like ML).
//    On your turn (`actions:['bid','challenge']` — challenge only once a bid
//    exists, bid only while a legal raise exists) you either bid {count,face}
//    STRICTLY beating the current bid via shared bidBeats, or challenge.
//  - Challenge → REVEAL (all dice public): matching = countMatching(all dice,
//    bid.face) — 1s are wild. Bid stood (matching ≥ count) → challenger loses
//    a die; else the bidder does (DIE_LOST).
//  - Hitting 0 dice → the Coconut Cannon: the SAME penalty/chipUsed/cannon/
//    eliminated §3.3 event shapes and the chambers/chips seat state as Monkey
//    Lies. Survive → chamber shrinks (ML parity) and the bar spots you one
//    die (DIE_REGAINED, back to 1). Hit → eliminated.
//  - After every challenge → roundEnd → intermission → re-roll survivors.
//  - Turn timeout: auto minimal legal raise, else auto-challenge (also the
//    sane default that drives brainless bot seats via the gameRoom fallback).
//  - Last monkey standing wins; standings by elimination order.
//
// Same shape as monkeyLies.js: a PURE, SEEDABLE state machine — no sockets,
// no timers. The driver (game/gameRoom.js) owns real clocks, calls
// onTimeout(kind) when deadlines pass, and routes `modeAction` verbs here.
// Engine contract per modes/index.js: start, onTimeout, getTimer, snapshotFor,
// modeAction, useChip, resolvePenalty, phase, turnSeat, lastHolderPending
// (constant false), winnerSeat, inspect().

import {
  CHIP_BONUS_CHAMBERS,
  DICE_START,
  PENALTY_WINDOW_MS,
  ROUND_INTERMISSION_MS,
  TURN_SECONDS_DEFAULT,
} from '@monkeybar/shared/constants.js';
import { bidBeats, countMatching, DICE_FACES, isFace, rollDice } from '@monkeybar/shared/dice.js';
import { DICE_ACTIONS, DICE_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { ERROR_CODES } from '@monkeybar/shared/protocol.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';

export const MODE_ID = 'bananaDice';
export const PLAYABLE = true;

const OK = Object.freeze({ ok: true });
const err = (code) => ({ ok: false, code });

/**
 * The minimal legal raise over `bid` with at most `totalDice` dice in play
 * (bids above the table total are never legal — the order is finite so
 * bidding always terminates in a challenge). Null when nothing beats `bid`.
 * Exposed for the timeout auto-raise, the bot brain and tests.
 *
 * The helper SKIPS face 1: 1s are wild (they count toward every face), so a
 * face-1 raise is the weakest possible claim — the opener is {1, 2}, and a
 * count bump lands on face 2, not 1. Face-1 bids stay perfectly LEGAL via
 * bidBeats — only this helper (opener / timeout auto-raise) avoids them.
 * @param {{count: number, face: number}|null} bid  current bid (null → opener)
 * @param {number} totalDice  dice in play across all alive seats
 * @returns {{count: number, face: number}|null}
 */
export function minimalRaise(bid, totalDice) {
  if (!bid) return totalDice >= 1 ? { count: 1, face: 2 } : null;
  if (bid.face < DICE_FACES) return { count: bid.count, face: bid.face + 1 };
  if (bid.count < totalDice) return { count: bid.count + 1, face: 2 };
  return null;
}

/**
 * @param {Object} options
 * @param {ReturnType<import('../table.js').createTable>} options.table
 * @param {number} [options.seed]
 * @param {() => number} [options.rng]        dice-roll/first-seat stream
 * @param {() => number} [options.cannonRng]  cannon roll stream (tests inject)
 * @param {number} [options.turnSeconds]
 * @param {number} [options.penaltyWindowMs]
 * @param {number} [options.intermissionMs]
 * @param {string} [options.mapId]
 * @param {() => number} [options.now]
 * @param {(evt: import('./monkeyLies.js').EngineEvent) => void} [options.onEvent]
 */
export function createEngine({
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
} = {}) {
  if (!table) throw new TypeError('bananaDice.createEngine: table is required');

  /** Mode-scoped phases (§10.3): 'dealing' | 'playing' | 'revealing' | 'penalty' | 'roundEnd' | 'matchEnd'. */
  let phase = 'dealing';
  let roundNo = 0;
  let turnSeat = -1;
  let turnDeadline = 0;
  let intermissionDeadline = 0;
  /** @type {{seat: number, count: number, face: number}|null} highest bid so far this round */
  let bid = null;
  /** @type {{seat: number, bonus: number, chipUsed: boolean, deadline: number}|null} */
  let penalty = null;
  /** @type {Map<number, number>} seat → dice COUNT (persists across rounds) */
  const diceCount = new Map();
  /** @type {Map<number, number[]>} seat → this round's rolled faces (private) */
  const rolls = new Map();
  /** Seat numbers in elimination order (first eliminated first). */
  const eliminatedOrder = [];
  let firstSeatOfRound = -1;
  let winnerSeat = -1;

  for (const s of table.seats) diceCount.set(s.seat, DICE_START);

  const emit = (t, p, seat) => onEvent(seat === undefined ? { t, p } : { t, p, seat });
  const modeEvent = (kind, payload, seat) => emit('modeEvent', { kind, ...payload }, seat);

  /** Dice in play across all alive seats (bids are capped at this). */
  function totalDice() {
    let n = 0;
    for (const s of table.aliveSeats()) n += diceCount.get(s.seat) ?? 0;
    return n;
  }

  /** §B.3 per-seat extension: SeatPublic + `dice:number` (count only, never faces). */
  function publicSeatsWithDice() {
    return table.publicSeats().map((p) => ({ ...p, dice: p.alive ? (diceCount.get(p.seat) ?? 0) : 0 }));
  }

  // ---- round lifecycle ------------------------------------------------------

  function startRound() {
    roundNo += 1;
    phase = 'dealing';
    bid = null;
    penalty = null;
    rolls.clear();

    const alive = table.aliveSeats();
    // Everyone's dice roll privately — a seat only ever learns its OWN faces.
    for (const s of alive) rolls.set(s.seat, rollDice(diceCount.get(s.seat), rng));
    firstSeatOfRound =
      roundNo === 1
        ? alive[Math.floor(rng() * alive.length)].seat
        : table.nextAliveSeat(firstSeatOfRound);

    // §3.3 roundStart, minus tableFruit (dice has none — the fruit banner
    // hides itself). seats carries fresh authoritative per-seat dice counts.
    emit('roundStart', { roundNo, firstSeat: firstSeatOfRound, seats: publicSeatsWithDice() });
    for (const s of alive) {
      modeEvent(DICE_EVENTS.YOUR_DICE, { dice: rolls.get(s.seat).slice() }, s.seat);
    }

    phase = 'playing';
    setTurn(firstSeatOfRound);
  }

  /** Legal modeAction verbs for the turn seat right now (§10.3 turn.actions). */
  function legalActions() {
    const actions = [];
    if (minimalRaise(bid, totalDice())) actions.push(DICE_ACTIONS.BID);
    if (bid) actions.push(DICE_ACTIONS.CHALLENGE);
    return actions;
  }

  function setTurn(seat) {
    turnSeat = seat;
    turnDeadline = now() + turnSeconds * 1000;
    emit('turn', {
      seat,
      deadline: turnDeadline,
      canCall: false,
      lastHolder: false,
      actions: legalActions(),
    });
  }

  // ---- actions ----------------------------------------------------------------

  /**
   * §10.1 modeAction router (gameRoom.actForSeat → engine.modeAction).
   * @param {number} seat
   * @param {string} action  'bid' | 'challenge'
   * @param {Object} [data]  bid: {count, face}; challenge: {}
   */
  function modeAction(seat, action, data = {}) {
    if (phase !== 'playing') return err(ERROR_CODES.BAD_STATE);
    if (seat !== turnSeat) return err(ERROR_CODES.NOT_YOUR_TURN);
    if (action === DICE_ACTIONS.BID) return placeBid(seat, data);
    if (action === DICE_ACTIONS.CHALLENGE) return challenge(seat);
    return err(ERROR_CODES.BAD_MSG);
  }

  /** BID {count, face}: must STRICTLY beat the current bid (bidBeats). */
  function placeBid(seat, data) {
    const count = data?.count;
    const face = data?.face;
    if (!Number.isInteger(count) || count < 1 || !isFace(face)) return err(ERROR_CODES.BAD_MSG);
    if (count > totalDice()) return err(ERROR_CODES.BAD_STATE); // can't outbid the table
    if (bid && !bidBeats({ count, face }, bid)) return err(ERROR_CODES.BAD_STATE);
    bid = { seat, count, face };
    modeEvent(DICE_EVENTS.BID, { seat, count, face });
    setTurn(table.nextAliveSeat(seat));
    return OK;
  }

  /** CHALLENGE: reveal everything, count face + wild 1s, someone loses a die. */
  function challenge(seat) {
    if (!bid || bid.seat === seat) return err(ERROR_CODES.BAD_STATE);
    const target = bid.seat;
    phase = 'revealing';
    turnSeat = -1;
    modeEvent(DICE_EVENTS.CHALLENGE, {
      callerSeat: seat,
      targetSeat: target,
      bid: { count: bid.count, face: bid.face },
    });

    const revealed = table.aliveSeats().map((s) => ({ seat: s.seat, dice: rolls.get(s.seat).slice() }));
    const allDice = revealed.flatMap((r) => r.dice);
    const matching = countMatching(allDice, bid.face);
    const stood = matching >= bid.count; // the table held at least `count` of `face`
    const loser = stood ? seat : target;
    modeEvent(DICE_EVENTS.REVEAL, { dice: revealed, face: bid.face, matching, loserSeat: loser });
    loseDie(loser);
    return OK;
  }

  function loseDie(seat) {
    const left = Math.max(0, (diceCount.get(seat) ?? 0) - 1);
    diceCount.set(seat, left);
    modeEvent(DICE_EVENTS.DIE_LOST, { seat, diceLeft: left });
    if (left === 0) beginPenalty(seat);
    else endRound();
  }

  // ---- the Coconut Cannon (ML event shapes + chambers/chips state) -------------

  function beginPenalty(seat) {
    const s = table.get(seat);
    phase = 'penalty';
    penalty = { seat, bonus: 0, chipUsed: false, deadline: now() + penaltyWindowMs };
    emit('penalty', {
      seat,
      chambers: s.chambersLeft,
      coconuts: s.coconuts,
      chipUsable: s.chips > 0,
      deadline: penalty.deadline,
    });
  }

  /** §3.2 useChip: +2 temporary chambers for THIS shot (1 chip per match). */
  function useChip(seat) {
    if (phase !== 'penalty' || !penalty || penalty.seat !== seat) return err(ERROR_CODES.BAD_STATE);
    const s = table.get(seat);
    if (penalty.chipUsed || s.chips <= 0) return err(ERROR_CODES.BAD_STATE);
    s.chips -= 1;
    penalty.chipUsed = true;
    penalty.bonus = CHIP_BONUS_CHAMBERS;
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
      diceCount.set(seat, 0);
      table.eliminate(seat);
      eliminatedOrder.push(seat);
      emit('eliminated', { seat });
    } else {
      // Survive → permanently lose one EMPTY chamber (ML parity) and the bar
      // spots you one die: back in the game with a single die.
      s.chambersLeft = Math.max(1, s.chambersLeft - 1);
      diceCount.set(seat, 1);
      modeEvent(DICE_EVENTS.DIE_REGAINED, { seat, diceLeft: 1 });
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
    for (const seat of reversed) {
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
      // §B rules: auto minimal legal raise, else auto-challenge. Also the
      // sane default that drives brainless bot seats (fallback → onTimeout).
      const raise = minimalRaise(bid, totalDice());
      if (raise) placeBid(turnSeat, raise);
      else challenge(turnSeat);
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
   * §10.3 bananaDice snapshot: Base + `yourDice:number[]|null` (OWNER ONLY —
   * spectators/others get only per-seat `dice` counts), `bid`, `totalDice`,
   * `penalty` (ML shape). §3.1 private filtering exactly like `yourHand`.
   * @param {number|null} seat
   */
  function snapshotFor(seat) {
    const isSeat = typeof seat === 'number' && seat >= 0 && seat < table.size;
    const victim = penalty ? table.get(penalty.seat) : null;
    return {
      mode: MODE_ID,
      mapId,
      phase,
      roundNo,
      seats: publicSeatsWithDice(),
      turnSeat,
      deadline: getTimer()?.deadline ?? 0,
      bid: bid ? { ...bid } : null,
      totalDice: totalDice(),
      penalty: penalty
        ? {
            seat: penalty.seat,
            chambers: victim.chambersLeft,
            coconuts: victim.coconuts,
            chipUsable: victim.chips > 0 && !penalty.chipUsed,
            deadline: penalty.deadline,
          }
        : null,
      yourSeat: isSeat ? seat : null,
      yourDice: isSeat && rolls.has(seat) ? rolls.get(seat).slice() : null,
      chipUsedByYou: isSeat ? table.get(seat).chips <= 0 : false,
    };
  }

  function start() {
    if (roundNo !== 0) throw new Error('engine already started');
    startRound();
  }

  // ---- §3.2 legacy verbs not in this mode: reject, never throw ------------------
  const rejectVerb = () => err(ERROR_CODES.BAD_STATE);

  return {
    modeId: MODE_ID,
    start,
    modeAction,
    useChip,
    resolvePenalty,
    onTimeout,
    getTimer,
    snapshotFor,
    play: rejectVerb,
    callLiar: rejectVerb,
    fireSelf: rejectVerb,
    get phase() {
      return phase;
    },
    get roundNo() {
      return roundNo;
    },
    get turnSeat() {
      return turnSeat;
    },
    /** Engine contract: dice has no Last-Monkey-Holding rule. */
    lastHolderPending: false,
    get winnerSeat() {
      return winnerSeat;
    },
    get bid() {
      return bid ? { ...bid } : null;
    },
    /** Server-internal/test inspection (never sent to clients). */
    inspect() {
      return {
        phase,
        roundNo,
        turnSeat,
        bid: bid ? { ...bid } : null,
        totalDice: totalDice(),
        diceCounts: Object.fromEntries(diceCount),
        rolls: Object.fromEntries([...rolls].map(([k, v]) => [k, v.slice()])),
        penalty: penalty ? { ...penalty } : null,
        eliminatedOrder: eliminatedOrder.slice(),
      };
    },
  };
}
