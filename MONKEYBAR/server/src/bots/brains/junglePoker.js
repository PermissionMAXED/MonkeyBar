// Jungle Poker bot brain (R6) — the R2 brain convention for mode 'junglePoker'.
//
// createBrain({seat, personalityId, rng}) → brain implementing the botManager
// decision surface (see bots/brains/index.js). A brain consumes ONLY the
// filtered per-seat event feed a client would receive (its own YOUR_CARDS +
// public events) — bots cannot cheat by construction.
//
// Strength model (§5 adapted, per RELEASE_PLAN R6): hand-strength PERCENTILE
// from shared/poker.js — the full C(52,3)=22100 rank distribution is
// precomputed once per process (no monte-carlo needed), then a hand's
// percentile is "fraction of possible 3-card hands it beats". Decisions:
//   fold / call / raise thresholds scaled by callThreshold + risk;
//   bluffRate = raise-with-air frequency;
//   Mathematical plays near-optimal pot-odds poker with a 10% blunder;
//   memErr fuzzes the perceived pot odds;
//   Chaotic re-rolls per hand, Emotional tilts on showdown losses/survivals.

import { POKER_MAX_RAISES } from '@monkeybar/shared/constants.js';
import { buildPokerDeck, evaluateHand } from '@monkeybar/shared/poker.js';
import { POKER_ACTIONS, POKER_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { MSG } from '@monkeybar/shared/protocol.js';

import { getPersonality } from '../personalities.js';
import { RAISE_MAX, RAISE_MIN } from '../../game/modes/junglePoker.js';

export const MODE_ID = 'junglePoker';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------------------
// Precomputed rank-class distribution (lazy, once per process)
// ---------------------------------------------------------------------------

/** Comparable scalar for a HandRank (tiebreak < 100000 always). */
const handKey = (rank) => rank.rankClass * 100000 + rank.tiebreak;

/** @type {number[]|null} sorted keys of every possible 3-card hand */
let DISTRIBUTION = null;

function distribution() {
  if (DISTRIBUTION) return DISTRIBUTION;
  const deck = buildPokerDeck();
  const keys = [];
  for (let i = 0; i < deck.length; i++) {
    for (let j = i + 1; j < deck.length; j++) {
      for (let k = j + 1; k < deck.length; k++) {
        keys.push(handKey(evaluateHand([deck[i], deck[j], deck[k]])));
      }
    }
  }
  keys.sort((a, b) => a - b);
  DISTRIBUTION = keys;
  return keys;
}

/** First index in sorted `arr` where arr[i] >= x (binary search). */
function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Percentile of a 3-card hand among ALL possible 3-card hands: the fraction
 * it beats, counting ties as half. Exported for tests.
 * @param {import('@monkeybar/shared/poker.js').PokerCard[]} cards3
 * @returns {number} 0..1
 */
export function handPercentile(cards3) {
  const keys = distribution();
  const key = handKey(evaluateHand(cards3));
  const below = lowerBound(keys, key);
  const equal = lowerBound(keys, key + 1) - below;
  return (below + equal / 2) / keys.length;
}

// ---------------------------------------------------------------------------
// Brain factory
// ---------------------------------------------------------------------------

/**
 * @param {Object} options
 * @param {number} options.seat
 * @param {string} [options.personalityId]
 * @param {() => number} [options.rng]
 */
export function createBrain({ seat, personalityId = 'cautious', rng = Math.random }) {
  const params = getPersonality(personalityId);

  // ---- tracked state (own cards + public betting facts only) ----------------
  /** @type {import('@monkeybar/shared/poker.js').PokerCard[]} */
  let myCards = [];
  let strength = 0; // percentile of myCards
  let pot = 0;
  let currentBet = 0;
  let raisesUsed = 0;
  /** @type {Map<number, {stack: number, bet: number, folded: boolean, alive: boolean}>} */
  const seats = new Map();
  /** @type {{actions: string[], toCall: number}|null} set while it is this bot's turn */
  let pendingTurn = null;
  /** @type {{chambers: number, coconuts: number, chipUsable: boolean}|null} */
  let pendingPenalty = null;
  /** true while this seat is a live contender in the current hand */
  let inHand = false;

  // ---- personality dynamics ---------------------------------------------------
  let tilt = 0; // Emotional: rises on showdown losses / cannon survivals
  let dyn = {
    bluffRate: numericBluffBase(),
    callThreshold: params.callThreshold,
    risk: numericRisk(),
    chipThreshold: params.chipThreshold,
  };

  function numericBluffBase() {
    return params.bluffRate === 'ev' ? 0.18 : params.bluffRate;
  }

  function numericRisk() {
    return params.risk === 'random' ? rng() : params.risk;
  }

  /** Chaotic signature: re-roll parameters every hand. */
  function rerollForHand() {
    if (params.reroll) {
      dyn.bluffRate = clamp01(numericBluffBase() + (rng() * 2 - 1) * params.reroll.bluffJitter);
      dyn.callThreshold = clamp(params.callThreshold + (rng() * 2 - 1) * params.reroll.callJitter, 0.15, 0.95);
      dyn.chipThreshold = clamp(params.chipThreshold + (rng() * 2 - 1) * 0.2, 0.15, 0.7);
    }
    dyn.risk = numericRisk();
  }

  function effBluffRate() {
    const t = params.tilt ? tilt * params.tilt.bluffShift : 0;
    return clamp01(dyn.bluffRate + t);
  }

  function effCallThreshold() {
    const t = params.tilt ? tilt * params.tilt.callShift : 0;
    return clamp(dyn.callThreshold - t, 0.15, 0.95);
  }

  function effChipThreshold() {
    const t = params.tilt ? tilt * params.tilt.chipShift : 0;
    return clamp(dyn.chipThreshold - t, 0.1, 1);
  }

  function bumpTilt(delta) {
    if (!params.tilt) return;
    tilt = clamp(tilt + delta, 0, 1);
  }

  // ---- helpers ------------------------------------------------------------------

  function applySeats(list) {
    if (!Array.isArray(list)) return;
    for (const s of list) {
      seats.set(s.seat, {
        stack: s.stack ?? 0,
        bet: s.bet ?? 0,
        folded: !!s.folded,
        alive: s.alive !== false,
      });
    }
  }

  const mySeat = () => seats.get(seat) ?? { stack: 0, bet: 0, folded: false, alive: true };
  const myStack = () => mySeat().stack;

  /** §5 memErr: the perceived pot is fuzzed — pot odds come out wrong. */
  function perceivedPotOdds(toCall) {
    if (toCall <= 0) return 0;
    let seenPot = pot;
    if (params.memErr > 0 && rng() < params.memErr * 2) {
      seenPot = Math.max(toCall, Math.round(pot * (1 + (rng() * 2 - 1) * 0.6)));
    }
    return toCall / Math.max(1, seenPot + toCall);
  }

  // ---- decisions -------------------------------------------------------------------

  /**
   * Decide the pending betting turn. Null when the brain does not believe it
   * is its turn (stale timer).
   * @returns {{type: 'mode', action: string, data?: Object}|null}
   */
  function decideTurn() {
    if (!pendingTurn) return null;
    const legal = pendingTurn.actions?.length ? pendingTurn.actions : [POKER_ACTIONS.FOLD, POKER_ACTIONS.CALL];
    const toCall = Math.max(0, pendingTurn.toCall ?? 0);
    const canRaise = legal.includes(POKER_ACTIONS.RAISE);

    const raise = (amount) => ({
      type: 'mode',
      action: POKER_ACTIONS.RAISE,
      data: { amount: clamp(Math.round(amount), RAISE_MIN, RAISE_MAX) },
    });
    const call = () => ({ type: 'mode', action: POKER_ACTIONS.CALL, data: {} });
    const fold = () => ({ type: 'mode', action: POKER_ACTIONS.FOLD, data: {} });

    // Mathematical signature: 10% deliberate blunder — a careless random line.
    if (params.blunderRate && rng() < params.blunderRate) {
      const roll = rng();
      if (canRaise && roll < 0.34) return raise(1 + Math.floor(rng() * RAISE_MAX));
      if (roll < 0.67 || toCall === 0) return call();
      return fold();
    }

    // Read: percentile strength + personality-scaled noise.
    const s = clamp01(strength + (rng() * 2 - 1) * 0.06 * params.sloppiness);
    const risk = dyn.risk;
    const callBar = effCallThreshold();

    // Raise sizing: risk appetite + hand strength drive the amount.
    const raiseAmount = () => {
      let n = 1;
      if (rng() < risk) n++;
      if (s > 0.82 && rng() < 0.35 + risk * 0.5) n++;
      return n;
    };

    if (toCall === 0) {
      // Free look: never fold. Value-raise strong hands; bluff-raise air at
      // the personality's raise-with-air frequency.
      const valueCut = 0.86 - 0.28 * risk - 0.08 * tilt;
      if (canRaise && s >= valueCut) return raise(raiseAmount());
      if (canRaise && s < 0.45 && rng() < effBluffRate() * 0.3) {
        return raise(1 + (rng() < risk ? Math.floor(rng() * RAISE_MAX) : 0)); // the bluff
      }
      return call(); // check
    }

    // Facing a bet: compare equity to (memErr-fuzzed) pot odds, with the
    // required margin scaled by callThreshold (cautious folds more).
    const potOdds = perceivedPotOdds(toCall);
    let needed = clamp01(potOdds + (callBar - 0.5) * 0.5);
    if (toCall >= myStack()) needed = clamp01(needed + 0.12); // calling for your whole stack
    // Trollish signature: occasionally hero-calls anything.
    const heroCall = params.trueCallRate ? rng() < params.trueCallRate : false;

    if (s < needed && !heroCall) {
      // Air can still fight back: re-raise bluff at the raise-with-air rate.
      if (canRaise && rng() < effBluffRate() * 0.15) return raise(1);
      return fold();
    }
    const raiseCut = Math.max(0.9 - 0.3 * risk, needed + 0.22);
    if (canRaise && s >= raiseCut) return raise(raiseAmount());
    return call();
  }

  /**
   * Own bust-penalty window: spend the Lucky Banana Chip? Risk-based,
   * personality-scaled (same policy shape as the ML brain).
   * @returns {{useChip: boolean}|null}
   */
  function decidePenalty() {
    if (!pendingPenalty) return null;
    const { chambers, coconuts, chipUsable } = pendingPenalty;
    if (!chipUsable) return { useChip: false };
    const pHit = coconuts / Math.max(1, chambers);
    return { useChip: pHit >= effChipThreshold() };
  }

  /** Commit hook: the engine accepted the returned action. */
  function onOwnActionApplied(action) {
    pendingTurn = null;
    if (action?.action === POKER_ACTIONS.FOLD) inHand = false;
  }

  // ---- reactions ---------------------------------------------------------------------

  function react(key) {
    if (params.chatty <= 0) return null; // Quiet / Mathematical: zero chat
    const entry = params.reactions[key];
    if (!entry) return null;
    const p = clamp01(params.chatty * (entry.boost ?? 1));
    const out = { key };
    if (entry.emotes?.length && rng() < p) out.emoteId = entry.emotes[Math.floor(rng() * entry.emotes.length)];
    if (entry.phrases?.length && rng() < p * 0.55) {
      out.phraseId = entry.phrases[Math.floor(rng() * entry.phrases.length)];
    }
    return out.emoteId || out.phraseId ? out : null;
  }

  // ---- event intake --------------------------------------------------------------------

  /**
   * Feed one envelope from this seat's event stream (gameRoom.subscribeSeat).
   * @param {{t: string, p: Object}} envelope
   * @returns {{key: string, emoteId?: string, phraseId?: string}|null}
   */
  function observe(envelope) {
    const { t, p } = envelope;
    switch (t) {
      case MSG.MODE_EVENT:
        return observeModeEvent(p);

      case MSG.TURN:
        pendingTurn =
          p.seat === seat
            ? { actions: Array.isArray(p.actions) ? p.actions.slice() : [], toCall: p.toCall ?? 0 }
            : null;
        return null;

      case MSG.PENALTY:
        if (p.seat === seat) {
          pendingPenalty = { chambers: p.chambers, coconuts: p.coconuts, chipUsable: !!p.chipUsable };
          return react('selfPenalty');
        }
        pendingPenalty = null;
        return react('othersPenalty');

      case MSG.CANNON:
        pendingPenalty = null;
        if (p.seat === seat) {
          if (p.hit) return react('gotShot');
          bumpTilt(0.3); // survived the bust cannon — adrenaline tilt
          return react('surviveShot');
        }
        return null;

      case MSG.ELIMINATED: {
        const info = seats.get(p.seat);
        if (info) {
          info.alive = false;
          info.folded = true;
        }
        return p.seat === seat ? null : react('someoneEliminated');
      }

      case MSG.ROUND_END:
        pendingTurn = null;
        pendingPenalty = null;
        return null;

      case MSG.MATCH_END:
        pendingTurn = null;
        pendingPenalty = null;
        return p.winnerSeat === seat ? react('bigWin') : react('matchLost');

      default:
        return null;
    }
  }

  /** @param {{kind: string} & Object} p  full modeEvent payload */
  function observeModeEvent(p) {
    switch (p.kind) {
      case POKER_EVENTS.YOUR_CARDS:
        // PRIVATE — only ever delivered to this seat's feed.
        myCards = (p.cards ?? []).map((c) => ({ ...c }));
        strength = myCards.length === 3 ? handPercentile(myCards) : 0;
        inHand = true;
        return null;

      case POKER_EVENTS.ANTE:
        pot = p.pot ?? 0;
        currentBet = p.currentBet ?? 0;
        raisesUsed = p.raisesUsed ?? 0;
        applySeats(p.seats);
        inHand = mySeat().alive;
        rerollForHand(); // Chaotic re-roll (risk refresh for 'random')
        if (params.tilt) tilt *= 0.6; // Emotional: tilt cools between hands
        return null;

      case POKER_EVENTS.ACTION: {
        pot = p.pot ?? pot;
        currentBet = p.currentBet ?? currentBet;
        raisesUsed = p.raisesUsed ?? raisesUsed;
        applySeats(p.seats);
        if (p.seat !== seat && p.action === POKER_ACTIONS.RAISE && (p.amount ?? 0) >= 2) {
          return react('bigPlay'); // a big slam across the felt
        }
        return null;
      }

      case POKER_EVENTS.SHOWDOWN: {
        applySeats(p.seats);
        const wasContender = inHand;
        const won = (p.winners ?? []).some((w) => w.seat === seat);
        pot = 0;
        currentBet = 0;
        if (won && !p.uncontested) {
          bumpTilt(-0.2);
          return react('catchLiar'); // dragged the pot at showdown — gloat
        }
        if (wasContender && !won && !p.uncontested) {
          bumpTilt(0.3);
          return react('wrongCall'); // paid to see it and lost
        }
        return null;
      }

      case POKER_EVENTS.BUST:
        return null; // the §3.3 penalty/cannon pair carries the reactions

      default:
        return null;
    }
  }

  // ---- mid-match takeover ------------------------------------------------------------------

  /**
   * Prime from a reconnect-style snapshot (gameRoom.snapshotFor for this
   * seat's playerId) — same information a rejoining client would get.
   * @param {Object} snap  §10.3 junglePoker snapshot
   */
  function primeFromSnapshot(snap) {
    if (!snap || snap.mode !== MODE_ID || snap.roundNo === 0) return;
    myCards = Array.isArray(snap.yourCards) ? snap.yourCards.map((c) => ({ ...c })) : [];
    strength = myCards.length === 3 ? handPercentile(myCards) : 0;
    pot = snap.pot ?? 0;
    currentBet = snap.currentBet ?? 0;
    raisesUsed = snap.raisesUsed ?? 0;
    applySeats(snap.seats);
    const me = mySeat();
    inHand = me.alive && !me.folded && myCards.length > 0;
    if (snap.phase === 'playing' && snap.turnSeat === seat) {
      const actions = [POKER_ACTIONS.FOLD, POKER_ACTIONS.CALL];
      if (raisesUsed < POKER_MAX_RAISES && me.stack > (snap.toCall ?? 0)) {
        actions.push(POKER_ACTIONS.RAISE);
      }
      pendingTurn = { actions, toCall: snap.toCall ?? 0 };
    } else {
      pendingTurn = null;
    }
    rerollForHand();
  }

  /** Mid-match takeover of a seat already in its bust-penalty window. */
  function primePenalty({ chambers, coconuts, chipUsable }) {
    pendingPenalty = { chambers, coconuts, chipUsable: !!chipUsable };
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
    primePenalty,
    handPercentile,
    /** Test/inspection hooks (server-side only — never sent to clients). */
    inspect() {
      return {
        handSize: myCards.length,
        strength,
        pot,
        currentBet,
        raisesUsed,
        tilt,
        dyn: { ...dyn },
        inHand,
        pendingTurn: pendingTurn ? { ...pendingTurn } : null,
        pendingPenalty: pendingPenalty ? { ...pendingPenalty } : null,
      };
    },
  };
}
