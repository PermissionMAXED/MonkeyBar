// BotBrain — the per-seat decision core. PLAN.md §5.
//
// A brain consumes ONLY the filtered event stream a client seated there would
// receive (gameRoom.subscribeSeat: all public events + that seat's private
// `hand`). It never touches the table, the engine, or other hands — bots
// CANNOT cheat by construction.
//
// Decision surface (called by bots/botManager.js after a humanized delay, or
// directly by headless tests using brains as seat policies):
//   observe(envelope)  -> optional social reaction {emoteId?/phraseId?/key}
//   decideTurn()       -> {type:'call'} | {type:'play', cardIds} | null
//   onOwnActionApplied(action)   commit hook after the engine accepted a play
//   decidePenalty()    -> {useChip: boolean} | null
//
// Suspicion model (§5): P(lie) for the pending play is estimated from
//   (a) remaining-table-fruit feasibility — how many Table Fruit + Golden
//       Bananas can still be out there given the bot's own hand, its own
//       plays, and any reveals this round (hard bound: k > remaining ⇒ lie);
//   (b) a play-size prior (3-card plays skew toward lies);
//   (c) a per-opponent bluff prior updated on observed reveals.
// Call iff P(lie) + noise(±0.15 × sloppiness) > callThreshold. Counted facts
// are corrupted with probability memErr (imperfect memory).

import { DECK_FRUIT_RATIO, HAND_SIZE } from '@monkeybar/shared/constants.js';
import { FRUITS, cardMatchesTableFruit } from '@monkeybar/shared/cards.js';
import { MSG } from '@monkeybar/shared/protocol.js';
import { randInt } from '@monkeybar/shared/rng.js';

import { getPersonality } from './personalities.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Play-size prior (§5): 3-card plays skew toward lies, singles toward truth. */
const SIZE_PRIOR = Object.freeze({ 1: -0.05, 2: 0.05, 3: 0.15 });

/**
 * §4.1 deck math for the current round's survivor count (public knowledge).
 * @param {number} aliveCount
 */
function deckInfo(aliveCount) {
  const total = aliveCount * HAND_SIZE;
  const perFruit = Math.floor(total * DECK_FRUIT_RATIO);
  return { total, perFruit, golden: total - perFruit * 3 };
}

/**
 * @param {Object} options
 * @param {number} options.seat
 * @param {string} [options.personalityId]
 * @param {() => number} [options.rng]
 */
export function createBotBrain({ seat, personalityId = 'cautious', rng = Math.random }) {
  const params = getPersonality(personalityId);

  // ---- knowledge (own hand + public events only) ------------------------------
  /** @type {import('@monkeybar/shared/protocol.js').Card[]} current hand */
  let hand = [];
  /** @type {import('@monkeybar/shared/protocol.js').Card[]} own cards played this round (identities known to self) */
  let myPlayed = [];
  /** @type {import('@monkeybar/shared/protocol.js').Card[]} publicly revealed cards this round */
  let revealed = [];
  let tableFruit = null;
  let deck = deckInfo(4);
  /** @type {Map<number, {alive: boolean, handCount: number}>} public seat facts */
  const seats = new Map();
  /** @type {{seat: number, count: number, emptied: boolean}|null} unresolved play */
  let lastPlay = null;
  /** @type {{callerSeat: number, targetSeat: number}|null} */
  let lastCalled = null;
  /** @type {{canCall: boolean}|null} set while it is this bot's turn */
  let pendingTurn = null;
  /** @type {{chambers: number, coconuts: number, chipUsable: boolean}|null} */
  let pendingPenalty = null;
  /** @type {Map<number, {reveals: number, lies: number}>} per-opponent bluff stats (persist across rounds) */
  const opponentStats = new Map();
  /** @type {string[]|null} card ids of the last play this brain committed */
  let lastCommittedIds = null;

  // ---- personality dynamics ------------------------------------------------------
  let tilt = 0; // Emotional: rises on survive/caught, decays each round
  let dyn = { bluffRate: numericBluffBase(), callThreshold: params.callThreshold, risk: numericRisk(), chipThreshold: params.chipThreshold };

  function numericBluffBase() {
    return params.bluffRate === 'ev' ? 0.35 : params.bluffRate;
  }

  function numericRisk() {
    return params.risk === 'random' ? rng() : params.risk;
  }

  /** Chaotic signature: re-roll parameters every round (§5). */
  function rerollForRound() {
    if (params.reroll) {
      dyn.bluffRate = clamp01(numericBluffBase() + (rng() * 2 - 1) * params.reroll.bluffJitter);
      dyn.callThreshold = clamp(params.callThreshold + (rng() * 2 - 1) * params.reroll.callJitter, 0.15, 0.95);
      dyn.chipThreshold = clamp(params.chipThreshold + (rng() * 2 - 1) * 0.2, 0.15, 0.7);
    }
    dyn.risk = numericRisk();
  }

  /** Emotional signature: tilt shifts bluffRate up and callThreshold down. */
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

  // ---- imperfect memory (§5 memErr) ---------------------------------------------

  /** Recall a counted fact; with probability memErr it comes back corrupted. */
  function recall(value) {
    if (rng() < params.memErr) return Math.max(0, value + randInt(-2, 2, rng));
    return value;
  }

  // ---- suspicion model -------------------------------------------------------------

  const isTruthy = (card) => cardMatchesTableFruit(card, tableFruit);

  /** Table Fruit + wild cards whose location this bot actually knows. */
  function truthySeen() {
    let n = 0;
    for (const c of hand) if (isTruthy(c)) n++;
    for (const c of myPlayed) if (isTruthy(c)) n++;
    for (const c of revealed) if (isTruthy(c)) n++;
    return n;
  }

  function knownCount() {
    return hand.length + myPlayed.length + revealed.length;
  }

  /** Smoothed per-opponent bluff prior, updated on observed reveals. */
  function bluffPriorOf(targetSeat) {
    const s = opponentStats.get(targetSeat);
    if (!s) return 0.5;
    return (s.lies + 1) / (s.reveals + 2);
  }

  /**
   * Estimate P(the pending play is a lie) from public info + own hand.
   * Exposed for tests; deterministic given the injected rng.
   */
  function estimateLieProbability() {
    if (!lastPlay || tableFruit === null) return 0;
    const k = lastPlay.count;
    const truthyTotal = deck.perFruit + deck.golden; // table fruit + wilds in this round's deck
    const truthyElsewhere = recall(Math.max(0, truthyTotal - truthySeen()));
    if (k > truthyElsewhere) return 1; // infeasible claim — certain lie (as remembered)
    const hiddenPool = Math.max(1, deck.total - knownCount());
    let pAllRandom = 1;
    for (let i = 0; i < k; i++) {
      pAllRandom *= Math.max(0, truthyElsewhere - i) / Math.max(1, hiddenPool - i);
    }
    // Players pick truths deliberately, not at random — boost small random-draw
    // probabilities, more for bigger plays (they were chosen, not dealt).
    const pTruth = clamp01(Math.pow(pAllRandom, 0.45 / Math.sqrt(k)));
    const sizePrior = SIZE_PRIOR[k] ?? 0.15;
    const emptied = lastPlay.emptied ? 0.08 : 0; // dumping the last cards smells like an escape
    return clamp01(0.4 * (1 - pTruth) + 0.2 * bluffPriorOf(lastPlay.seat) + sizePrior + emptied);
  }

  // ---- play selection helpers ---------------------------------------------------------

  /** Everyone else already shed → Last-Monkey-Holding looms for this bot. */
  function isSoleHolder() {
    if (hand.length === 0) return false;
    for (const [s, info] of seats) {
      if (s !== seat && info.alive && info.handCount > 0) return false;
    }
    return true;
  }

  /** 0..1 fear of being the Last Monkey Holding (others racing to empty). */
  function shedPressure() {
    let minOther = Infinity;
    for (const [s, info] of seats) {
      if (s !== seat && info.alive) minOther = Math.min(minOther, info.handCount);
    }
    if (!Number.isFinite(minOther)) return 0;
    return clamp01((hand.length - minOther) / 4);
  }

  /** Mathematical signature: bluff rate derived from the state, not a constant. */
  function evBluffRate(truthyRatio, pressure) {
    // Lie more when truths are scarce or the shed race demands volume, less
    // when the hand can carry the round honestly.
    return clamp01(0.08 + 0.4 * (1 - truthyRatio) + 0.25 * pressure);
  }

  function chooseCount(maxAvail, pressure, bluffing) {
    const cap = Math.min(3, maxAvail);
    if (cap <= 1) return cap;
    switch (params.playSizeStyle) {
      case 'slam': // Aggressive: slam 3-card plays whenever possible
        return rng() < 0.75 ? cap : Math.max(1, cap - 1);
      case 'single': // Cautious: 1-card truths (dumps a little under real pressure)
        return pressure > 0.6 && rng() < pressure ? Math.min(2, cap) : 1;
      case 'wild': // Chaotic / Trollish: anything goes
        return 1 + Math.floor(rng() * cap);
      default: {
        // 'measured': sized by risk appetite + Last-Monkey fear
        const p2 = 0.3 + 0.45 * pressure + 0.25 * dyn.risk;
        const p3 = 0.1 + 0.4 * pressure + 0.3 * dyn.risk + (bluffing ? 0.05 : 0);
        let n = 1;
        if (rng() < p2) n++;
        if (n === 2 && rng() < p3) n++;
        return Math.min(n, cap);
      }
    }
  }

  /** Truth cards ordered exact-fruit-first (hoard wild Golden Bananas). */
  function orderedTruth(truthy) {
    return [...truthy].sort((a, b) => (a.fruit === FRUITS.GOLDEN ? 1 : 0) - (b.fruit === FRUITS.GOLDEN ? 1 : 0));
  }

  function choosePlayCards() {
    // Mathematical signature: 10% deliberate blunder — a careless random play.
    if (params.blunderRate && rng() < params.blunderRate * 0.5) {
      const n = 1 + Math.floor(rng() * Math.min(3, hand.length));
      const shuffled = [...hand].sort(() => rng() - 0.5);
      return shuffled.slice(0, n).map((c) => c.id);
    }
    const truthy = hand.filter(isTruthy);
    const liars = hand.filter((c) => !isTruthy(c));
    const pressure = shedPressure();
    let bluffing;
    if (truthy.length === 0) bluffing = true; // forced lie
    else if (liars.length === 0) bluffing = false; // forced truth
    else {
      const rate = params.bluffRate === 'ev' ? evBluffRate(truthy.length / hand.length, pressure) : effBluffRate();
      bluffing = rng() < rate;
    }
    const pool = bluffing ? liars : orderedTruth(truthy);
    const count = chooseCount(pool.length, pressure, bluffing);
    return pool.slice(0, count).map((c) => c.id);
  }

  function shouldCall() {
    // Trollish signature: 5% true-call trolling — calls it *believes* are true.
    if (params.trueCallRate && rng() < params.trueCallRate) return true;
    const pLie = estimateLieProbability();
    const noise = (rng() * 2 - 1) * 0.15 * params.sloppiness;
    let call = pLie + noise > effCallThreshold();
    // Mathematical signature: 10% deliberate blunder — flip the read.
    if (params.blunderRate && rng() < params.blunderRate * 0.5) call = !call;
    return call;
  }

  // ---- public decision API ----------------------------------------------------------------

  /**
   * Decide the pending turn. Returns null when the brain does not believe it
   * is its turn (stale timer) — the caller must then do nothing.
   * @returns {{type: 'call'}|{type: 'play', cardIds: string[]}|null}
   */
  function decideTurn() {
    if (!pendingTurn || hand.length === 0) return null;
    const { canCall } = pendingTurn;
    if (isSoleHolder()) {
      // Last Monkey Holding: playing is forbidden. Calling the pending play is
      // the only escape hatch — and it weakly dominates the certain self-shot
      // (worst case is the same cannon), so every archetype takes it.
      return canCall ? { type: 'call' } : null;
    }
    if (canCall && shouldCall()) return { type: 'call' };
    const cardIds = choosePlayCards();
    if (cardIds.length === 0) return canCall ? { type: 'call' } : null;
    return { type: 'play', cardIds };
  }

  /**
   * Commit hook: the engine ACCEPTED the returned action. Only now does the
   * brain move played cards out of its tracked hand (keeps state exact even
   * if a race got the action rejected).
   * @param {{type: string, cardIds?: string[]}} action
   */
  function onOwnActionApplied(action) {
    pendingTurn = null;
    if (action.type === 'play' && Array.isArray(action.cardIds)) {
      lastCommittedIds = action.cardIds;
      const chosen = new Set(action.cardIds);
      for (const c of hand) if (chosen.has(c.id)) myPlayed.push(c);
      hand = hand.filter((c) => !chosen.has(c.id));
    }
  }

  /**
   * Decide the own penalty window: spend the Lucky Banana Chip? Risk-based,
   * personality-scaled (§5). Null when no penalty is pending (stale timer).
   * @returns {{useChip: boolean}|null}
   */
  function decidePenalty() {
    if (!pendingPenalty) return null;
    const { chambers, coconuts, chipUsable } = pendingPenalty;
    if (!chipUsable) return { useChip: false };
    const pHit = coconuts / Math.max(1, chambers);
    return { useChip: pHit >= effChipThreshold() };
  }

  // ---- reactions ------------------------------------------------------------------------------

  /**
   * Roll a personality-keyed reaction for an event key.
   * @param {string} key
   * @returns {{key: string, emoteId?: string, phraseId?: string}|null}
   */
  function react(key) {
    if (params.chatty <= 0) return null; // Quiet / Mathematical: zero chat
    const entry = params.reactions[key];
    if (!entry) return null;
    const p = clamp01(params.chatty * (entry.boost ?? 1));
    const out = { key };
    if (entry.emotes?.length && rng() < p) out.emoteId = entry.emotes[Math.floor(rng() * entry.emotes.length)];
    if (entry.phrases?.length && rng() < p * 0.55) out.phraseId = entry.phrases[Math.floor(rng() * entry.phrases.length)];
    return out.emoteId || out.phraseId ? out : null;
  }

  // ---- event intake -----------------------------------------------------------------------------

  /**
   * Feed one envelope from this seat's event stream (gameRoom.subscribeSeat).
   * Returns an optional social reaction for the manager to broadcast.
   * @param {{t: string, p: Object}} envelope
   * @returns {{key: string, emoteId?: string, phraseId?: string}|null}
   */
  function observe(envelope) {
    const { t, p } = envelope;
    switch (t) {
      case MSG.HAND:
        hand = p.cards.map((c) => ({ ...c }));
        myPlayed = [];
        lastCommittedIds = null;
        return null;

      case MSG.ROUND_START: {
        tableFruit = p.tableFruit;
        revealed = [];
        myPlayed = [];
        lastPlay = null;
        lastCalled = null;
        pendingTurn = null;
        pendingPenalty = null;
        seats.clear();
        let alive = 0;
        for (const s of p.seats) {
          seats.set(s.seat, { alive: s.alive, handCount: s.handCount });
          if (s.alive) alive++;
        }
        deck = deckInfo(Math.max(2, alive));
        rerollForRound(); // Chaotic re-roll (no-op for others; risk refresh for 'random')
        if (params.tilt) tilt *= 0.55; // Emotional: tilt cools between rounds
        return null;
      }

      case MSG.TURN:
        pendingTurn = p.seat === seat ? { canCall: !!p.canCall } : null;
        return null;

      case MSG.PLAYED: {
        const info = seats.get(p.seat);
        if (info) info.handCount = p.handCount;
        lastPlay = { seat: p.seat, count: p.count, emptied: p.handCount === 0 };
        if (p.seat === seat) {
          // Normally our commit already moved the cards. If the server acted
          // for us (timeout race), reconcile what we can — identities of the
          // consumed cards are unknowable until the next deal fixes it.
          if (lastCommittedIds) lastCommittedIds = null;
        } else if (params.emoteSpam && p.count === 3) {
          return react('bigPlay');
        }
        return null;
      }

      case MSG.CALLED:
        lastCalled = { callerSeat: p.callerSeat, targetSeat: p.targetSeat };
        pendingTurn = null;
        return null;

      case MSG.REVEAL: {
        for (const c of p.cards) revealed.push({ ...c });
        const s = opponentStats.get(p.targetSeat) ?? { reveals: 0, lies: 0 };
        s.reveals += 1;
        if (p.lie) s.lies += 1;
        opponentStats.set(p.targetSeat, s);
        if (p.targetSeat === seat && p.lie) {
          bumpTilt(0.35); // caught lying
          return react('gotCaught');
        }
        if (lastCalled?.callerSeat === seat) {
          if (p.lie) {
            bumpTilt(-0.2);
            return react('catchLiar');
          }
          bumpTilt(0.3); // called wrong
          return react('wrongCall');
        }
        return null;
      }

      case MSG.PENALTY:
        if (p.seat === seat) {
          pendingPenalty = { chambers: p.chambers, coconuts: p.coconuts, chipUsable: !!p.chipUsable };
          return react('selfPenalty');
        }
        pendingPenalty = null;
        return react('othersPenalty');

      case MSG.CHIP_USED:
        return null;

      case MSG.CANNON:
        pendingPenalty = null;
        if (p.seat === seat) {
          if (p.hit) return react('gotShot');
          bumpTilt(0.25); // survived — adrenaline tilt (§5)
          return react('surviveShot');
        }
        return null;

      case MSG.ELIMINATED: {
        const info = seats.get(p.seat);
        if (info) {
          info.alive = false;
          info.handCount = 0;
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

  /**
   * Prime from a reconnect-style snapshot (gameRoom.snapshotFor for this
   * seat's playerId) — used when a brain takes over a seat MID-match
   * (disconnect-hold expiry / player left). Same information a rejoining
   * client would get; nothing hidden.
   * @param {import('@monkeybar/shared/protocol.js').Snapshot} snap
   */
  function primeFromSnapshot(snap) {
    if (!snap || snap.roundNo === 0) return;
    tableFruit = snap.tableFruit;
    hand = Array.isArray(snap.yourHand) ? snap.yourHand.map((c) => ({ ...c })) : [];
    myPlayed = [];
    revealed = [];
    seats.clear();
    let alive = 0;
    for (const s of snap.seats) {
      seats.set(s.seat, { alive: s.alive, handCount: s.handCount });
      if (s.alive) alive++;
    }
    deck = deckInfo(Math.max(2, alive));
    lastPlay = snap.lastPlay ? { seat: snap.lastPlay.seat, count: snap.lastPlay.count, emptied: false } : null;
    if (snap.phase === 'playing' && snap.turnSeat === seat) {
      pendingTurn = { canCall: lastPlay !== null && lastPlay.seat !== seat };
    }
    rerollForRound();
  }

  /** Mid-match takeover of a seat already in its penalty window. */
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
    estimateLieProbability,
    /** Test/inspection hooks (server-side only — never sent to clients). */
    inspect() {
      return {
        handSize: hand.length,
        tilt,
        dyn: { ...dyn },
        pendingTurn: pendingTurn ? { ...pendingTurn } : null,
        pendingPenalty: pendingPenalty ? { ...pendingPenalty } : null,
        opponentStats: new Map(opponentStats),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Disconnect-hold auto-play policy (§3.4) — the "Cautious bot policy"
// ---------------------------------------------------------------------------

/**
 * Build the stateless auto-play policy installed via sessions.setAutoPlayPolicy.
 * Held (disconnected) human seats and engine turn-timeouts play through this:
 * a single truthful card when possible (exact Table Fruit first, hoarding
 * wild Golden Bananas), else one card at random — it NEVER calls. The chip is
 * hoarded Cautious-style: spent only once the hit odds reach chipThreshold.
 *
 * @param {string} [personalityId]
 * @param {() => number} [fallbackRng]
 */
export function createAutoPlayPolicy(personalityId = 'cautious', fallbackRng = Math.random) {
  const params = getPersonality(personalityId);
  return Object.freeze({
    chooseTimeoutPlay({ hand, tableFruit, rng = fallbackRng }) {
      if (!Array.isArray(hand) || hand.length === 0) return [];
      const exact = hand.find((c) => c.fruit === tableFruit);
      if (exact) return [exact.id];
      const golden = hand.find((c) => c.fruit === FRUITS.GOLDEN);
      if (golden) return [golden.id];
      return [hand[Math.floor(rng() * hand.length)].id];
    },
    choosePenaltyChip({ chips, chambersLeft, coconuts }) {
      if (!chips || chips <= 0) return false;
      return coconuts / Math.max(1, chambersLeft) >= params.chipThreshold;
    },
  });
}
