// Custom Chaos bot brain (R7) — a THIN wrapper over the Monkey Lies botBrain
// with knob awareness, plugged into botManager via bots/brains/index.js
// (R2 brain convention: createBrain({seat, personalityId, rng}) → brain).
//
// The inner ML brain does all the real thinking; the wrapper only adapts its
// output to the host's knobs (announced via `modeEvent chaosKnobs` and echoed
// in snapshots):
//   maxPlay          → clamp the inner pick to the knob (the inner brain
//                      natively sizes plays for the stock 1–3 band).
//   deck composition → handSize/goldenPerPlayer rebuild the deck, so the
//                      wrapper recomputes the knob deck's truthy total; a
//                      pending claim that is INFEASIBLE under the knob deck
//                      (count > truthy cards this bot cannot see) is a
//                      certain lie — call it regardless of the inner read.
//   chambers/coconuts → nothing to do here: `penalty` events already carry
//                      the knob-true numbers, so the inner chip math adapts.

import { DEFAULT_KNOBS, validateKnobs } from '@monkeybar/shared/chaos.js';
import { cardMatchesTableFruit } from '@monkeybar/shared/cards.js';
import { CHAOS_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { MSG } from '@monkeybar/shared/protocol.js';

import { createBotBrain } from '../botBrain.js';

export const MODE_ID = 'customChaos';

/**
 * Truthy card total (Table Fruit + wilds) of a knob-built deck — mirrors the
 * engine's local buildDeck wrapper math.
 * @param {import('@monkeybar/shared/chaos.js').ChaosKnobs} knobs
 * @param {number} aliveCount
 */
export function knobDeckTruthyTotal(knobs, aliveCount) {
  const total = aliveCount * knobs.handSize;
  const golden = Math.max(0, Math.min(total, knobs.goldenPerPlayer * aliveCount));
  const perFruit = Math.floor((total - golden) / 3);
  return perFruit + golden;
}

/**
 * @param {Object} options
 * @param {number} options.seat
 * @param {string} [options.personalityId]
 * @param {() => number} [options.rng]
 */
export function createBrain({ seat, personalityId = 'cautious', rng = Math.random }) {
  const inner = createBotBrain({ seat, personalityId, rng });

  // ---- wrapper knowledge (same per-seat feed the inner brain gets) ----------
  /** @type {import('@monkeybar/shared/chaos.js').ChaosKnobs} */
  let knobs = { ...DEFAULT_KNOBS };
  /** @type {import('@monkeybar/shared/protocol.js').Card[]} own tracked hand */
  let hand = [];
  let tableFruit = null;
  let aliveCount = 4;
  /** @type {{seat: number, count: number}|null} the unresolved play */
  let lastPlay = null;
  /** Own turn pending + whether a call is legal (from the `turn` frame). */
  let myTurn = null;

  const isTruthy = (c) => cardMatchesTableFruit(c, tableFruit);

  /**
   * Deck-composition awareness: is the pending claim IMPOSSIBLE under the
   * knob deck given the truthy cards this bot holds itself? (Conservative
   * bound — reveals/own plays are ignored, which only loosens it.)
   */
  function claimInfeasible() {
    if (!lastPlay || lastPlay.seat === seat || tableFruit === null) return false;
    const truthyHeld = hand.filter(isTruthy).length;
    return lastPlay.count > knobDeckTruthyTotal(knobs, aliveCount) - truthyHeld;
  }

  // ---- decision surface -------------------------------------------------------

  function decideTurn() {
    const action = inner.decideTurn();
    if (!action) return null;
    // A knob-deck-infeasible claim is a certain lie — call it (unless the
    // inner brain already wants to, or a call is not legal right now).
    if (action.type === 'play' && myTurn?.canCall && claimInfeasible()) {
      return { type: 'call' };
    }
    if (action.type === 'play' && action.cardIds.length > knobs.maxPlay) {
      return { ...action, cardIds: action.cardIds.slice(0, knobs.maxPlay) };
    }
    return action;
  }

  const decidePenalty = () => inner.decidePenalty();

  function onOwnActionApplied(action) {
    myTurn = null;
    if (action?.type === 'play' && Array.isArray(action.cardIds)) {
      const chosen = new Set(action.cardIds);
      hand = hand.filter((c) => !chosen.has(c.id));
    }
    inner.onOwnActionApplied(action);
  }

  // ---- event intake -------------------------------------------------------------

  /**
   * Feed one envelope from this seat's event stream (gameRoom.subscribeSeat).
   * @param {{t: string, p: Object}} envelope
   */
  function observe(envelope) {
    const { t, p } = envelope;
    switch (t) {
      case MSG.HAND:
        hand = p.cards.map((c) => ({ ...c }));
        break;
      case MSG.ROUND_START: {
        tableFruit = p.tableFruit;
        lastPlay = null;
        myTurn = null;
        aliveCount = Math.max(2, (p.seats ?? []).filter((s) => s.alive).length);
        break;
      }
      case MSG.TURN:
        myTurn = p.seat === seat ? { canCall: !!p.canCall } : null;
        break;
      case MSG.PLAYED:
        lastPlay = { seat: p.seat, count: p.count };
        break;
      case MSG.CALLED:
      case MSG.ROUND_END:
      case MSG.MATCH_END:
        lastPlay = null;
        myTurn = null;
        break;
      case MSG.ELIMINATED:
        aliveCount = Math.max(1, aliveCount - 1);
        break;
      case MSG.MODE_EVENT:
        if (p.kind === CHAOS_EVENTS.KNOBS) knobs = validateKnobs(p.knobs ?? {});
        // The inner ML brain has no modeEvent vocabulary — nothing to forward.
        return null;
      default:
        break;
    }
    return inner.observe(envelope);
  }

  /** Mid-match takeover: prime the inner brain AND the wrapper's bookkeeping. */
  function primeFromSnapshot(snap) {
    inner.primeFromSnapshot(snap);
    if (!snap || snap.roundNo === 0) return;
    if (snap.knobs) knobs = validateKnobs(snap.knobs);
    tableFruit = snap.tableFruit ?? tableFruit;
    hand = Array.isArray(snap.yourHand) ? snap.yourHand.map((c) => ({ ...c })) : [];
    aliveCount = Math.max(2, (snap.seats ?? []).filter((s) => s.alive).length);
    lastPlay = snap.lastPlay ? { seat: snap.lastPlay.seat, count: snap.lastPlay.count } : null;
    myTurn =
      snap.phase === 'playing' && snap.turnSeat === seat
        ? { canCall: lastPlay !== null && lastPlay.seat !== seat }
        : null;
  }

  return {
    seat,
    personalityId: inner.personalityId,
    params: inner.params,
    observe,
    decideTurn,
    decidePenalty,
    onOwnActionApplied,
    primeFromSnapshot,
    primePenalty: inner.primePenalty,
    estimateLieProbability: inner.estimateLieProbability,
    /** Test/inspection hooks (server-side only — never sent to clients). */
    inspect() {
      return {
        ...inner.inspect(),
        wrapperHandSize: hand.length,
        knobs: { ...knobs },
        aliveCount,
        lastPlay: lastPlay ? { ...lastPlay } : null,
      };
    },
  };
}
