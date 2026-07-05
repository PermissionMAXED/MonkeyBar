// Coconut Roulette bot brain (R5) — the per-seat decision core for the
// rigged-coconut mode, plugged into botManager via bots/brains/index.js
// (R2 brain convention: createBrain({seat, personalityId, rng}) → brain).
//
// EV comparison (RELEASE_PLAN R5):
//   PASS  = a certain −1 chip (plus a hoarding sting when chips run low —
//           chipThreshold is the hoarding instinct: reluctance to bleed the
//           last chips grows with it).
//   SHAKE = pExplode × (elimination cost scaled by personality `risk`,
//           inflated as fewer players remain — heads-up, a boom IS the match)
//           vs +1 chip for surviving.
// Shake iff EV(shake) + noise > EV(pass). The recalled shake count is
// corrupted with probability memErr (imperfect memory), so reads are human.
// Signatures: Trollish shakes gratuitously (and emote-spams via chatty MAX +
// emoteSpam), Cautious passes while affordable (low risk ⇒ huge perceived
// elimination cost), Chaotic re-rolls risk each round, Mathematical is
// near-exact with 10% deliberate blunders, Emotional tilts on survived shakes.
//
// A brain consumes ONLY the filtered per-seat event stream a client would get
// (public events — roulette has no private ones). Reactions reuse the existing
// react() keys: selfPenalty→holding the coconut, surviveShot→survived shake,
// gotShot→exploded, someoneEliminated/othersPenalty/bigPlay/bigWin/matchLost.

import { ROULETTE_START_CHIPS } from '@monkeybar/shared/constants.js';
import { ROULETTE_ACTIONS, ROULETTE_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { MSG } from '@monkeybar/shared/protocol.js';
import { randInt } from '@monkeybar/shared/rng.js';

import { getPersonality } from '../personalities.js';
import { explodeProbability } from '../../game/modes/coconutRoulette.js';

export const MODE_ID = 'coconutRoulette';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Base elimination cost in chips-equivalent (tuned vs the +1 shake payoff). */
const ELIM_COST_BASE = 4;
/** Trollish signature: gratuitous shake probability, EV be damned. */
const TROLL_SHAKE_RATE = 0.3;

/**
 * @param {Object} options
 * @param {number} options.seat
 * @param {string} [options.personalityId]
 * @param {() => number} [options.rng]
 */
export function createBrain({ seat, personalityId = 'cautious', rng = Math.random }) {
  const params = getPersonality(personalityId);

  // ---- knowledge (public events only — nothing hidden in this mode) ---------
  let chips = ROULETTE_START_CHIPS;
  /** @type {Map<number, boolean>} seat → alive */
  const alive = new Map();
  let holderSeat = -1;
  /** Total survived shakes this round (drives the odds). */
  let shakes = 0;
  /** Monotonic own-turn counter — guards the commit hook against clearing a
   *  FRESH turn that arrived synchronously with the previous action (shake-
   *  survive hands the turn straight back to this seat). */
  let turnId = 0;
  /** @type {{id: number}|null} set while it is this bot's turn */
  let pendingTurn = null;
  let decidedTurnId = -1;

  // ---- personality dynamics ---------------------------------------------------
  let tilt = 0; // Emotional: rises on survived shakes, cools between rounds
  let risk = numericRisk();

  function numericRisk() {
    return params.risk === 'random' ? rng() : params.risk;
  }

  function effRisk() {
    const t = params.tilt ? tilt * 0.5 : 0; // tilted monkeys grip the coconut harder
    return clamp(risk + t, 0, 1);
  }

  function bumpTilt(delta) {
    if (!params.tilt) return;
    tilt = clamp(tilt + delta, 0, 1);
  }

  // ---- imperfect memory (§5 memErr) ---------------------------------------------

  /** Recall the shake count; with probability memErr it comes back corrupted. */
  function recallShakes() {
    if (rng() < params.memErr) return Math.max(0, shakes + randInt(-2, 2, rng));
    return shakes;
  }

  function aliveCount() {
    let n = 0;
    for (const a of alive.values()) if (a) n++;
    return n || 2;
  }

  // ---- the EV core ---------------------------------------------------------------

  /**
   * Would this brain shake right now? Deterministic given the injected rng.
   * Exposed for tests (mirrors decideTurn's choice without turn bookkeeping).
   */
  function wantsShake() {
    if (chips <= 0) return true; // broke — the server would refuse a pass anyway
    // Trollish signature: gratuitous shakes, the table must be entertained.
    if (params.emoteSpam && rng() < TROLL_SHAKE_RATE) return true;

    const p = explodeProbability(recallShakes());
    // Elimination cost: low risk appetite inflates it, and it balloons as
    // fewer players remain (heads-up, exploding simply loses the match).
    const aliveFactor = 1 + 2 / Math.max(1, aliveCount() - 1);
    const elimCost = ELIM_COST_BASE * (2 - 1.5 * effRisk()) * aliveFactor;
    // Hoarding instinct (chipThreshold): paying from a dwindling stack stings.
    const hoard = params.chipThreshold * Math.max(0, 3 - chips) * 0.6;
    // EV(shake) = (1−p)·1 − p·elimCost ; EV(pass) = −1 − hoard
    // shake ⟺ EV(shake) > EV(pass) ⟺ p < (2 + hoard) / (1 + elimCost)
    const threshold = (2 + hoard) / (1 + elimCost);
    const noise = (rng() * 2 - 1) * 0.05 * params.sloppiness;
    let shake = p + noise < threshold;
    // Mathematical signature: 10% deliberate blunder — flip the read.
    if (params.blunderRate && rng() < params.blunderRate * 0.5) shake = !shake;
    return shake;
  }

  // ---- public decision API ----------------------------------------------------------

  /**
   * Decide the pending turn. Null when the brain does not believe it is its
   * turn (stale timer) — the caller must then do nothing.
   * @returns {{type: 'mode', action: string, data: Object}|null}
   */
  function decideTurn() {
    if (!pendingTurn) return null;
    decidedTurnId = pendingTurn.id;
    const action = wantsShake() ? ROULETTE_ACTIONS.SHAKE : ROULETTE_ACTIONS.PASS;
    return { type: 'mode', action, data: {} };
  }

  /** Roulette has no penalty windows — stale timers get a null (no-op). */
  function decidePenalty() {
    return null;
  }

  /**
   * Commit hook: the engine ACCEPTED the action. Only clear the pending turn
   * if a fresh own turn didn't already arrive during the action (shake-survive
   * emits the next `turn` for this same seat synchronously).
   * @param {{type: string, action?: string}} action
   */
  function onOwnActionApplied(action) {
    void action; // chips already tracked via the (synchronous) mode events
    if (pendingTurn && pendingTurn.id === decidedTurnId) pendingTurn = null;
  }

  // ---- reactions ------------------------------------------------------------------

  /**
   * Roll a personality-keyed reaction for an event key (same tables and
   * chatty scaling as the Monkey Lies brain — Quiet/Mathematical stay mute).
   * @param {string} key
   */
  function react(key) {
    if (params.chatty <= 0) return null;
    const entry = params.reactions[key];
    if (!entry) return null;
    const p = clamp(params.chatty * (entry.boost ?? 1), 0, 1);
    const out = { key };
    if (entry.emotes?.length && rng() < p) out.emoteId = entry.emotes[Math.floor(rng() * entry.emotes.length)];
    if (entry.phrases?.length && rng() < p * 0.55) out.phraseId = entry.phrases[Math.floor(rng() * entry.phrases.length)];
    return out.emoteId || out.phraseId ? out : null;
  }

  // ---- event intake -----------------------------------------------------------------

  /** @param {{kind: string, [k: string]: any}} p  modeEvent payload */
  function observeModeEvent(p) {
    switch (p.kind) {
      case ROULETTE_EVENTS.HOLDER:
        holderSeat = p.seat;
        shakes = p.shakes ?? shakes;
        // selfPenalty ≙ staring down the rigged coconut in your own hands
        return p.seat === seat ? react('selfPenalty') : react('othersPenalty');

      case ROULETTE_EVENTS.SHAKE:
        shakes = p.shakes ?? shakes + 1;
        if (p.seat === seat) {
          if (typeof p.chips === 'number') chips = p.chips;
          bumpTilt(0.25); // survived — adrenaline tilt (§5)
          return react('surviveShot');
        }
        return react('bigPlay'); // an opponent gambling loudly

      case ROULETTE_EVENTS.PASS:
        if (p.seat === seat && typeof p.chips === 'number') chips = p.chips;
        return null; // the follow-up HOLDER event carries the reaction

      case ROULETTE_EVENTS.EXPLODE:
        holderSeat = -1;
        return p.seat === seat ? react('gotShot') : react('someoneEliminated');

      default:
        return null;
    }
  }

  /**
   * Feed one envelope from this seat's event stream (gameRoom.subscribeSeat).
   * Returns an optional social reaction for the manager to broadcast.
   * @param {{t: string, p: Object}} envelope
   */
  function observe(envelope) {
    const { t, p } = envelope;
    switch (t) {
      case MSG.ROUND_START: {
        alive.clear();
        for (const s of p.seats ?? []) {
          alive.set(s.seat, !!s.alive);
          if (s.seat === seat && typeof s.chips === 'number') chips = s.chips;
        }
        shakes = 0;
        pendingTurn = null;
        risk = numericRisk(); // Chaotic re-roll (refresh for 'random' risk)
        if (params.tilt) tilt *= 0.55; // Emotional: tilt cools between rounds
        return null;
      }

      case MSG.TURN:
        if (p.seat === seat) {
          turnId += 1;
          pendingTurn = { id: turnId };
        } else {
          pendingTurn = null;
        }
        return null;

      case MSG.MODE_EVENT:
        return observeModeEvent(p);

      case MSG.ELIMINATED:
        alive.set(p.seat, false);
        return null; // EXPLODE already carried the reaction

      case MSG.ROUND_END:
        pendingTurn = null;
        return null;

      case MSG.MATCH_END:
        pendingTurn = null;
        return p.winnerSeat === seat ? react('bigWin') : react('matchLost');

      default:
        return null;
    }
  }

  /**
   * Prime from a reconnect-style snapshot (mid-match seat takeover) — the
   * same public info + own seat a rejoining client would get (§10.3).
   * @param {Object} snap
   */
  function primeFromSnapshot(snap) {
    if (!snap || snap.roundNo === 0) return;
    alive.clear();
    for (const s of snap.seats ?? []) {
      alive.set(s.seat, !!s.alive);
      if (s.seat === seat && typeof s.chips === 'number') chips = s.chips;
    }
    holderSeat = snap.bomb?.holderSeat ?? -1;
    shakes = snap.bomb?.shakes ?? 0;
    if (snap.phase === 'playing' && snap.turnSeat === seat) {
      turnId += 1;
      pendingTurn = { id: turnId };
    } else {
      pendingTurn = null;
    }
    risk = numericRisk();
  }

  return {
    seat,
    personalityId: params.id,
    params,
    observe,
    decideTurn,
    decidePenalty,
    onOwnActionApplied,
    primeFromSnapshot,
    wantsShake,
    /** Test/inspection hooks (server-side only — never sent to clients). */
    inspect() {
      return {
        chips,
        shakes,
        holderSeat,
        aliveCount: aliveCount(),
        tilt,
        risk,
        pendingTurn: pendingTurn ? { ...pendingTurn } : null,
      };
    },
  };
}
