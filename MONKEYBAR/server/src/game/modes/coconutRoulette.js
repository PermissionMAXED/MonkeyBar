// Coconut Roulette — the pure-nerve rules engine (R5). PLAN.md §4.3 sketch,
// §10.3 snapshot extension, RELEASE_PLAN.md R5 rules (binding):
//
//  - Everyone starts the MATCH with ROULETTE_START_CHIPS chips (the seat
//    `chips` field, roulette semantics).
//  - Each round a rigged coconut ARMS at a random alive seat (modeEvent
//    ROULETTE_EVENTS.HOLDER). On the holder's turn (`actions:['shake','pass']`):
//      SHAKE → explode with p = ROULETTE_BASE_P + ROULETTE_STEP_P × total
//        shakes this round (seeded rng). Survive → +1 chip, keep holding,
//        your turn again (SHAKE event). Explode → EXPLODE + `eliminated`
//        (no cannon — the coconut IS the boom), then the round ends and the
//        coconut re-arms among survivors with the shake counter reset.
//      PASS → pay 1 chip, coconut moves clockwise (PASS + HOLDER events).
//        At 0 chips PASS is illegal (server-enforced) — you must shake.
//  - Timeout: pass if legal, else shake.
//  - Last alive wins; standings by elimination order.
//
// Same shape as monkeyLies.js: a PURE, SEEDABLE state machine — no sockets,
// no timers. The driver (game/gameRoom.js) owns real clocks, calls
// onTimeout(kind) when deadlines pass, and routes `modeAction` verbs here.
// Engine contract per modes/index.js: start, onTimeout, getTimer, snapshotFor,
// modeAction, phase, turnSeat, lastHolderPending (constant false), winnerSeat,
// inspect().

import {
  ROULETTE_BASE_P,
  ROULETTE_START_CHIPS,
  ROULETTE_STEP_P,
  ROUND_INTERMISSION_MS,
  TURN_SECONDS_DEFAULT,
} from '@monkeybar/shared/constants.js';
import { ROULETTE_ACTIONS, ROULETTE_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { ERROR_CODES } from '@monkeybar/shared/protocol.js';
import { mulberry32 } from '@monkeybar/shared/rng.js';

export const MODE_ID = 'coconutRoulette';
export const PLAYABLE = true;

const OK = Object.freeze({ ok: true });
const err = (code) => ({ ok: false, code });

/**
 * Explosion probability of the NEXT shake after `shakes` completed shakes
 * this round: ROULETTE_BASE_P + ROULETTE_STEP_P × shakes, capped at 1.
 * Exposed for tests and the bot brain (single source of the progression).
 * @param {number} shakes  total completed (survived) shakes this round
 * @returns {number}
 */
export function explodeProbability(shakes) {
  return Math.min(1, ROULETTE_BASE_P + ROULETTE_STEP_P * Math.max(0, shakes));
}

/**
 * @param {Object} options
 * @param {ReturnType<import('../table.js').createTable>} options.table
 * @param {number} [options.seed]
 * @param {() => number} [options.rng]       arming/holder-selection stream
 * @param {() => number} [options.shakeRng]  explosion roll stream (tests inject)
 * @param {number} [options.turnSeconds]
 * @param {number} [options.intermissionMs]
 * @param {string} [options.mapId]
 * @param {() => number} [options.now]
 * @param {(evt: import('./monkeyLies.js').EngineEvent) => void} [options.onEvent]
 */
export function createEngine({
  table,
  seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
  rng = mulberry32(seed),
  shakeRng = mulberry32((seed ^ 0x9e3779b9) >>> 0),
  turnSeconds = TURN_SECONDS_DEFAULT,
  intermissionMs = ROUND_INTERMISSION_MS,
  mapId = 'peeling_parrot',
  now = Date.now,
  onEvent = () => {},
} = {}) {
  if (!table) throw new TypeError('coconutRoulette.createEngine: table is required');

  /** Mode-scoped phases (§10.3): 'dealing' (pre-start) | 'playing' | 'roundEnd' | 'matchEnd'. */
  let phase = 'dealing';
  let roundNo = 0;
  let turnSeat = -1;
  let turnDeadline = 0;
  let intermissionDeadline = 0;
  /** Seat currently holding the rigged coconut (-1 between rounds). */
  let holderSeat = -1;
  /** Total survived shakes THIS round (all players) — drives the odds. */
  let shakes = 0;
  /** Seat numbers in elimination order (first eliminated first). */
  const eliminatedOrder = [];
  let winnerSeat = -1;

  const emit = (t, p, seat) => onEvent(seat === undefined ? { t, p } : { t, p, seat });
  const modeEvent = (kind, payload) => emit('modeEvent', { kind, ...payload });

  // ---- round lifecycle ------------------------------------------------------

  function startRound() {
    roundNo += 1;
    shakes = 0;
    const alive = table.aliveSeats();
    // The rigged coconut arms at a random alive seat (seeded).
    holderSeat = alive[Math.floor(rng() * alive.length)].seat;

    // §3.3 roundStart, minus tableFruit (roulette has none — the shell's
    // fruit banner hides itself). seats carries fresh authoritative chips.
    emit('roundStart', { roundNo, firstSeat: holderSeat, seats: table.publicSeats() });
    modeEvent(ROULETTE_EVENTS.HOLDER, {
      seat: holderSeat,
      shakes,
      pExplode: explodeProbability(shakes),
    });

    phase = 'playing';
    setTurn(holderSeat);
  }

  /** Legal modeAction verbs for the holder right now (§10.3 turn.actions). */
  function legalActions(seat) {
    return table.get(seat).chips > 0
      ? [ROULETTE_ACTIONS.SHAKE, ROULETTE_ACTIONS.PASS]
      : [ROULETTE_ACTIONS.SHAKE];
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
    });
  }

  // ---- actions ----------------------------------------------------------------

  /**
   * §10.1 modeAction router (gameRoom.actForSeat → engine.modeAction).
   * @param {number} seat
   * @param {string} action  'shake' | 'pass'
   * @param {Object} [data]  both verbs take empty data
   */
  function modeAction(seat, action, data = {}) {
    void data;
    if (phase !== 'playing') return err(ERROR_CODES.BAD_STATE);
    if (seat !== turnSeat) return err(ERROR_CODES.NOT_YOUR_TURN);
    if (action === ROULETTE_ACTIONS.SHAKE) return shake(seat);
    if (action === ROULETTE_ACTIONS.PASS) return pass(seat);
    return err(ERROR_CODES.BAD_MSG);
  }

  /** SHAKE: risk the boom for +1 chip. Survive → hold on, your turn again. */
  function shake(seat) {
    const s = table.get(seat);
    const p = explodeProbability(shakes);
    if (shakeRng() < p) {
      // BOOM. No cannon phase — the coconut IS the penalty.
      modeEvent(ROULETTE_EVENTS.EXPLODE, { seat });
      table.eliminate(seat);
      eliminatedOrder.push(seat);
      emit('eliminated', { seat });
      holderSeat = -1;
      if (table.aliveCount() <= 1) endMatch();
      else endRound(); // intermission → re-arm among survivors, counter reset
      return OK;
    }
    // Survived: nerve pays a chip, the coconut stays put, odds climb.
    shakes += 1;
    s.chips += 1;
    modeEvent(ROULETTE_EVENTS.SHAKE, {
      seat,
      shakes,
      pExplode: explodeProbability(shakes),
      chips: s.chips,
    });
    setTurn(seat); // still holding — your call again
    return OK;
  }

  /** PASS: pay 1 chip, coconut moves clockwise. Illegal at 0 chips. */
  function pass(seat) {
    const s = table.get(seat);
    if (s.chips <= 0) return err(ERROR_CODES.BAD_STATE); // broke — must shake
    s.chips -= 1;
    const toSeat = table.nextAliveSeat(seat);
    holderSeat = toSeat;
    modeEvent(ROULETTE_EVENTS.PASS, { seat, toSeat, chips: s.chips });
    modeEvent(ROULETTE_EVENTS.HOLDER, {
      seat: toSeat,
      shakes,
      pExplode: explodeProbability(shakes),
    });
    setTurn(toSeat);
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
    holderSeat = -1;
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
   * @param {'turn'|'intermission'} kind
   * @returns {boolean} whether the timeout applied to the current state
   */
  function onTimeout(kind) {
    if (kind === 'turn') {
      if (phase !== 'playing') return false;
      // §B rules: timeout = pass if legal, else shake. Also the sane default
      // that drives brainless bot seats (gameRoom fallback → onTimeout).
      if (table.get(turnSeat).chips > 0) pass(turnSeat);
      else shake(turnSeat);
      return true;
    }
    if (kind === 'intermission') {
      if (phase !== 'roundEnd') return false;
      startRound();
      return true;
    }
    return false;
  }

  /** @returns {{kind: 'turn'|'intermission', deadline: number}|null} */
  function getTimer() {
    if (phase === 'playing') return { kind: 'turn', deadline: turnDeadline };
    if (phase === 'roundEnd') return { kind: 'intermission', deadline: intermissionDeadline };
    return null;
  }

  // ---- snapshots ----------------------------------------------------------------

  /**
   * §10.3 coconutRoulette snapshot: Base + `bomb:{holderSeat,shakes,pExplode}|null`;
   * per-seat `chips` rides SeatPublic (roulette semantics). Nothing is private
   * in this mode, but the yourSeat contract matches the other engines.
   * @param {number|null} seat
   */
  function snapshotFor(seat) {
    const isSeat = typeof seat === 'number' && seat >= 0 && seat < table.size;
    return {
      mode: MODE_ID,
      mapId,
      phase,
      roundNo,
      seats: table.publicSeats(),
      turnSeat,
      deadline: getTimer()?.deadline ?? 0,
      bomb:
        holderSeat !== -1
          ? { holderSeat, shakes, pExplode: explodeProbability(shakes) }
          : null,
      yourSeat: isSeat ? seat : null,
    };
  }

  function start() {
    if (roundNo !== 0) throw new Error('engine already started');
    // Roulette semantics of the seat `chips` field (§B.3): the table dealt
    // ML's CHIPS_PER_MATCH — re-stake everyone with ROULETTE_START_CHIPS.
    for (const s of table.seats) s.chips = ROULETTE_START_CHIPS;
    startRound();
  }

  // ---- §3.2 legacy verbs: not part of this mode — reject, never throw ---------
  const rejectVerb = () => err(ERROR_CODES.BAD_STATE);

  return {
    modeId: MODE_ID,
    start,
    modeAction,
    onTimeout,
    getTimer,
    snapshotFor,
    play: rejectVerb,
    callLiar: rejectVerb,
    useChip: rejectVerb,
    fireSelf: rejectVerb,
    resolvePenalty: rejectVerb,
    get phase() {
      return phase;
    },
    get roundNo() {
      return roundNo;
    },
    get turnSeat() {
      return turnSeat;
    },
    /** Engine contract: roulette has no Last-Monkey-Holding rule. */
    lastHolderPending: false,
    get winnerSeat() {
      return winnerSeat;
    },
    /** Server-internal/test inspection (never sent to clients). */
    inspect() {
      return {
        phase,
        roundNo,
        turnSeat,
        holderSeat,
        shakes,
        pExplode: explodeProbability(shakes),
        penalty: null, // gameRoom.resolvePenalty guard reads this
        eliminatedOrder: eliminatedOrder.slice(),
      };
    },
  };
}
