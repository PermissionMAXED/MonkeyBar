// Banana Dice bot brain (R4) — the per-seat decision core for liar's dice,
// plugged into botManager via bots/brains/index.js (R2 brain convention:
// createBrain({seat, personalityId, rng}) → brain).
//
// Suspicion model (RELEASE_PLAN R4): BINOMIAL estimate of P(bid stands) from
// the bot's own dice plus the public history. Each unknown die matches the
// bid face with p = 1/3 (face + wild 1s; 1/6 when the bid IS on 1s, since
// only the wilds themselves count). P(stand) = P(Bin(unknown, p) ≥ still
// needed); challenge iff P(false) + noise(±0.15 × sloppiness) > callThreshold,
// nudged by a per-opponent bluff prior learned from reveals. The remembered
// table total is corrupted with probability memErr BEFORE estimating (reads
// stay human) — but legality math (bid caps) always uses the true tracked
// counts so the brain never sends an illegal action.
//
// Bid selection: minimal-raise baseline; held faces are preferred when their
// minimal candidate is meaningfully safer; bluffRate drives bids on UNHELD
// faces; 'slam'/'wild' playSizeStyle jumps counts on a risk-scaled coin;
// Mathematical blunders 10% of the time; Chaotic re-rolls parameters each
// round; Emotional tilts on caught bluffs / survived shots. The chip decision
// reuses chipThreshold exactly like the Monkey Lies brain.
//
// A brain consumes ONLY the filtered per-seat event stream a client would
// get: public events + its own private YOUR_DICE. It never sees other dice.

import { bidBeats, countMatching, DICE_FACES } from '@monkeybar/shared/dice.js';
import { DICE_ACTIONS, DICE_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { MSG } from '@monkeybar/shared/protocol.js';
import { randInt } from '@monkeybar/shared/rng.js';

import { getPersonality } from '../personalities.js';
import { minimalRaise } from '../../game/modes/bananaDice.js';

export const MODE_ID = 'bananaDice';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v) => clamp(v, 0, 1);

/** Per-die probability an UNKNOWN die counts toward `face` (wild 1s). */
export function faceProbability(face) {
  return face === 1 ? 1 / DICE_FACES : 2 / DICE_FACES;
}

/**
 * P(bid stands): at least `need` of `unknown` hidden dice match, each i.i.d.
 * with probability `p` — the binomial tail P(Bin(unknown, p) ≥ need).
 * @param {number} need     matches still needed beyond the own dice
 * @param {number} unknown  hidden dice count (everyone else's)
 * @param {number} p        per-die match probability (faceProbability)
 * @returns {number}
 */
export function binomialAtLeast(need, unknown, p) {
  if (need <= 0) return 1;
  if (need > unknown) return 0;
  let pmf = Math.pow(1 - p, unknown); // P(X = 0)
  let cdf = pmf;
  for (let k = 1; k < need; k++) {
    pmf *= ((unknown - k + 1) / k) * (p / (1 - p));
    cdf += pmf;
  }
  return clamp01(1 - cdf);
}

/** Binomial pmf row P(Bin(n, p) = k) for k = 0..n. */
function binomialPmf(n, p) {
  const row = new Array(n + 1);
  row[0] = Math.pow(1 - p, n);
  for (let k = 1; k <= n; k++) row[k] = row[k - 1] * (((n - k + 1) / k) * (p / (1 - p)));
  return row;
}

/**
 * P(bid stands) with a BIDDER SHADE: bidders tend to bid faces they hold, so
 * their `bidderDice` hidden dice match with elevated probability `pBidder`
 * while everyone else's stay at `p`. P(A + B ≥ need) by convolving the two
 * binomials. Used for CHALLENGE reads only (own-bid picks stay uniform —
 * nobody else's dice lean toward OUR face).
 * @param {number} need
 * @param {number} bidderDice  the bidder's hidden dice
 * @param {number} others      everyone else's hidden dice
 * @param {number} p
 * @param {number} pBidder
 */
export function binomialAtLeastShaded(need, bidderDice, others, p, pBidder) {
  if (need <= 0) return 1;
  if (need > bidderDice + others) return 0;
  const pmfA = binomialPmf(bidderDice, pBidder);
  let total = 0;
  for (let a = 0; a <= bidderDice; a++) {
    total += pmfA[a] * binomialAtLeast(need - a, others, p);
  }
  return clamp01(total);
}

/**
 * @param {Object} options
 * @param {number} options.seat
 * @param {string} [options.personalityId]
 * @param {() => number} [options.rng]
 */
export function createBrain({ seat, personalityId = 'cautious', rng = Math.random }) {
  const params = getPersonality(personalityId);

  // ---- knowledge (own feed only: public events + own YOUR_DICE) --------------
  /** @type {number[]} own dice this round (private) */
  let myDice = [];
  /** @type {Map<number, {alive: boolean, dice: number}>} public per-seat facts */
  const seats = new Map();
  /** @type {{seat: number, count: number, face: number}|null} current bid */
  let bid = null;
  /** @type {Map<number, {reveals: number, busts: number}>} per-opponent bluff stats (reveals where their bid fell) */
  const opponentStats = new Map();
  /** @type {{chambers: number, coconuts: number, chipUsable: boolean}|null} */
  let pendingPenalty = null;
  /** @type {{callerSeat: number, targetSeat: number}|null} */
  let lastChallenge = null;
  /** Monotonic own-turn counter — guards the commit hook against races. */
  let turnId = 0;
  /** @type {{id: number}|null} set while it is this bot's turn */
  let pendingTurn = null;
  let decidedTurnId = -1;

  // ---- personality dynamics ---------------------------------------------------
  let tilt = 0; // Emotional: rises on caught bluffs / survived shots, cools per round
  let dyn = {
    bluffRate: numericBluffBase(),
    callThreshold: params.callThreshold,
    risk: numericRisk(),
    chipThreshold: params.chipThreshold,
  };

  function numericBluffBase() {
    return params.bluffRate === 'ev' ? 0.3 : params.bluffRate;
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

  function effBluffRate() {
    const t = params.tilt ? tilt * params.tilt.bluffShift : 0;
    return clamp01(dyn.bluffRate + t);
  }

  function effCallThreshold() {
    const t = params.tilt ? tilt * params.tilt.callShift : 0;
    // In liar's dice a challenge at pFalse ≈ 0.5 is a coin flip for a die, so
    // raw §5 thresholds (0.45–0.75) would bleed the eager callers dry. The
    // personality ORDER is preserved, compressed around the break-even point.
    const raw = clamp(dyn.callThreshold - t, 0.15, 0.95);
    return 0.53 + (raw - 0.5) * 0.4;
  }

  function effChipThreshold() {
    const t = params.tilt ? tilt * params.tilt.chipShift : 0;
    return clamp(dyn.chipThreshold - t, 0.1, 1);
  }

  function bumpTilt(delta) {
    if (!params.tilt) return;
    tilt = clamp(tilt + delta, 0, 1);
  }

  // ---- tracked totals (true) + imperfect recall (§5 memErr) --------------------

  /** True tracked total of dice in play (legality math uses THIS). */
  function totalDice() {
    let n = 0;
    for (const info of seats.values()) if (info.alive) n += info.dice;
    return n || myDice.length;
  }

  /** Recall the table total; with probability memErr it comes back corrupted. */
  function recallTotalDice() {
    const t = totalDice();
    if (rng() < params.memErr) return Math.max(myDice.length, t + randInt(-2, 2, rng));
    return t;
  }

  // ---- the binomial core --------------------------------------------------------

  /**
   * P(the CURRENT bid stands) from this seat's perspective: own matching dice
   * count for sure; every other die is an unknown with p = faceProbability.
   * `total` lets callers pass a (possibly mis-remembered) table total.
   * @param {{count: number, face: number}} b
   * @param {number} [total]
   */
  function pBidStands(b, total = totalDice()) {
    const own = countMatching(myDice, b.face);
    const unknown = Math.max(0, total - myDice.length);
    return binomialAtLeast(b.count - own, unknown, faceProbability(b.face));
  }

  /** Learned bluff prior for one opponent (their revealed bids that fell). */
  function opponentBluffPrior(oppSeat) {
    const s = opponentStats.get(oppSeat);
    if (!s || s.reveals === 0) return 0.5;
    return clamp((s.busts + 1) / (s.reveals + 2), 0.15, 0.85); // Laplace-smoothed
  }

  /**
   * P(the current bid is FALSE) — the challenge driver. The binomial read
   * SHADES the bidder's own hidden dice toward the bid face (people bid what
   * they hold; how much they can be trusted comes from the learned bluff
   * prior), then the remembered table total corrupts per memErr.
   */
  function estimateBidFalseProbability() {
    if (!bid) return 0;
    const total = recallTotalDice();
    const own = countMatching(myDice, bid.face);
    const bidderDice = Math.min(seats.get(bid.seat)?.dice ?? 0, Math.max(0, total - myDice.length));
    const others = Math.max(0, total - myDice.length - bidderDice);
    const p = faceProbability(bid.face);
    // Honest bidders hold their face; serial bluffers shade back toward p.
    const honesty = 1 - opponentBluffPrior(bid.seat); // 0.15..0.85
    const pBidder = clamp01(p + (0.5 - p) * honesty * 0.8);
    const stands = binomialAtLeastShaded(bid.count - own, bidderDice, others, p, pBidder);
    return clamp01(1 - stands);
  }

  // ---- bid selection --------------------------------------------------------------

  /** Minimal candidate on `face` that beats `cur` (null when impossible). */
  function candidateOn(face, cur, total) {
    const cand = !cur
      ? { count: 1, face }
      : face > cur.face
        ? { count: cur.count, face }
        : { count: cur.count + 1, face };
    if (cand.count > total) return null;
    if (cur && !bidBeats(cand, cur)) return null;
    return cand;
  }

  /** Faces this brain holds NO natural die of (wilds aside) — bluff targets. */
  function unheldFaces() {
    const held = new Set(myDice);
    const out = [];
    for (let f = 2; f <= DICE_FACES; f++) if (!held.has(f)) out.push(f);
    return out;
  }

  /**
   * Pick the raise this brain WOULD place right now (legal by construction,
   * null ⇒ nothing beats the current bid — must challenge). Exposed for tests.
   * @returns {{count: number, face: number}|null}
   */
  function chooseBid() {
    const total = totalDice(); // true total — the bid must be legal
    const base = minimalRaise(bid, total);
    if (!base) return null;

    // Mathematical signature: 10% deliberate blunder — just take the minimal
    // raise blind, whatever it is.
    if (params.blunderRate && rng() < params.blunderRate) return base;

    // Bluff (§5 bluffRate): bid the minimal candidate on an UNHELD face —
    // but even a bluffer skips outright-suicidal ones (a bark, not a plank).
    if (rng() < effBluffRate()) {
      const targets = unheldFaces();
      while (targets.length) {
        const f = targets.splice(Math.floor(rng() * targets.length), 1)[0];
        const cand = candidateOn(f, bid, total);
        if (cand && pBidStands(cand, total) > 0.35) return cand;
      }
    }

    // Honest baseline: among per-face minimal candidates, prefer the safest;
    // keep the plain minimal raise unless a held face is meaningfully safer.
    let best = base;
    let bestP = pBidStands(base, total);
    for (let f = 1; f <= DICE_FACES; f++) {
      const cand = candidateOn(f, bid, total);
      if (!cand) continue;
      const p = pBidStands(cand, total);
      if (p > bestP + 0.1) {
        best = cand;
        bestP = p;
      }
    }

    // Slam signature ('slam'/'wild'): risk-scaled count jumps over the pick —
    // theatrical, not kamikaze (hopeless jumps are skipped).
    if ((params.playSizeStyle === 'slam' || params.playSizeStyle === 'wild') && rng() < dyn.risk * 0.45) {
      const jump = { count: best.count + 1 + (rng() < 0.25 ? 1 : 0), face: best.face };
      if (jump.count <= total && pBidStands(jump, total) > 0.35) return jump;
    }
    return best;
  }

  /** The stand-chance of the SAFEST legal raise available right now. */
  function safestRaiseStand() {
    const total = totalDice();
    let best = -1;
    for (let f = 1; f <= DICE_FACES; f++) {
      const cand = candidateOn(f, bid, total);
      if (cand) best = Math.max(best, pBidStands(cand, total));
    }
    return best; // -1 ⇒ no legal raise at all
  }

  /** Would this brain challenge the current bid right now? Exposed for tests. */
  function wantsChallenge() {
    if (!bid || bid.seat === seat) return false;
    // Trollish signature: occasional true-calls — challenges it believes
    // stand. Even a troll won't clown with its last couple of dice.
    if (params.trueCallRate && myDice.length > 2 && rng() < params.trueCallRate) return true;
    const noise = (rng() * 2 - 1) * 0.15 * params.sloppiness;
    // Cornered pressure: when every raise left is a plank walk, challenging
    // the bid on the table beats owning an even worse one.
    const best = safestRaiseStand();
    const pressure = best < 0 ? 1 : Math.max(0, 0.35 - best) * 1.2;
    return estimateBidFalseProbability() + noise + pressure > effCallThreshold();
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
    if (wantsChallenge()) return { type: 'mode', action: DICE_ACTIONS.CHALLENGE, data: {} };
    const raise = chooseBid();
    if (!raise) return { type: 'mode', action: DICE_ACTIONS.CHALLENGE, data: {} }; // bid maxed out
    return { type: 'mode', action: DICE_ACTIONS.BID, data: { count: raise.count, face: raise.face } };
  }

  /**
   * Decide the own penalty window: spend the Lucky Banana Chip? Reuses the
   * §5 chipThreshold exactly like the ML brain. Null when stale.
   * @returns {{useChip: boolean}|null}
   */
  function decidePenalty() {
    if (!pendingPenalty) return null;
    const { chambers, coconuts, chipUsable } = pendingPenalty;
    if (!chipUsable) return { useChip: false };
    const pHit = coconuts / Math.max(1, chambers);
    return { useChip: pHit >= effChipThreshold() };
  }

  /**
   * Commit hook: the engine ACCEPTED the action. Only clear the pending turn
   * if a fresh own turn didn't arrive synchronously during the action.
   * @param {{type: string, action?: string}} action
   */
  function onOwnActionApplied(action) {
    void action; // bid/reveal state already tracked via the mode events
    if (pendingTurn && pendingTurn.id === decidedTurnId) pendingTurn = null;
  }

  // ---- reactions ------------------------------------------------------------------

  /** Roll a personality-keyed reaction for an event key (§5 chatty scaling). */
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

  // ---- event intake -----------------------------------------------------------------

  /** @param {{kind: string, [k: string]: any}} p  modeEvent payload */
  function observeModeEvent(p) {
    switch (p.kind) {
      case DICE_EVENTS.YOUR_DICE:
        myDice = (p.dice ?? []).slice();
        return null;

      case DICE_EVENTS.BID:
        bid = { seat: p.seat, count: p.count, face: p.face };
        // A big count jump reads like a table slam.
        return p.seat !== seat && p.count >= 2 && totalDice() > 0 && p.count / totalDice() > 0.45
          ? react('bigPlay')
          : null;

      case DICE_EVENTS.CHALLENGE:
        lastChallenge = { callerSeat: p.callerSeat, targetSeat: p.targetSeat };
        pendingTurn = null;
        return null;

      case DICE_EVENTS.REVEAL: {
        // Learn the bidder's bluff tendency from the public outcome.
        const target = lastChallenge?.targetSeat ?? bid?.seat ?? -1;
        if (target !== -1 && target !== seat) {
          const s = opponentStats.get(target) ?? { reveals: 0, busts: 0 };
          s.reveals += 1;
          if (p.loserSeat === target) s.busts += 1;
          opponentStats.set(target, s);
        }
        if (p.loserSeat === seat && target === seat) {
          bumpTilt(0.35); // caught overbidding
          return react('gotCaught');
        }
        if (lastChallenge?.callerSeat === seat) {
          if (p.loserSeat !== seat) {
            bumpTilt(-0.2);
            return react('catchLiar');
          }
          bumpTilt(0.3); // challenged a bid that stood
          return react('wrongCall');
        }
        return null;
      }

      case DICE_EVENTS.DIE_LOST: {
        const info = seats.get(p.seat);
        if (info) info.dice = p.diceLeft;
        if (p.seat === seat) myDice = myDice.slice(0, p.diceLeft);
        return null;
      }

      case DICE_EVENTS.DIE_REGAINED: {
        const info = seats.get(p.seat);
        if (info) info.dice = p.diceLeft;
        return null;
      }

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
        seats.clear();
        for (const s of p.seats ?? []) {
          seats.set(s.seat, { alive: !!s.alive, dice: s.dice ?? 0 });
        }
        bid = null;
        lastChallenge = null;
        pendingTurn = null;
        pendingPenalty = null;
        rerollForRound(); // Chaotic re-roll (risk refresh for 'random')
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
          bumpTilt(0.25); // survived — adrenaline tilt (§5)
          return react('surviveShot');
        }
        return null;

      case MSG.ELIMINATED: {
        const info = seats.get(p.seat);
        if (info) {
          info.alive = false;
          info.dice = 0;
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
   * Prime from a reconnect-style snapshot (mid-match seat takeover) — the
   * same public info + own dice a rejoining client would get (§10.3).
   * @param {Object} snap
   */
  function primeFromSnapshot(snap) {
    if (!snap || snap.roundNo === 0) return;
    seats.clear();
    for (const s of snap.seats ?? []) {
      seats.set(s.seat, { alive: !!s.alive, dice: s.dice ?? 0 });
    }
    myDice = Array.isArray(snap.yourDice) ? snap.yourDice.slice() : [];
    bid = snap.bid ? { ...snap.bid } : null;
    lastChallenge = null;
    if (snap.phase === 'playing' && snap.turnSeat === seat) {
      turnId += 1;
      pendingTurn = { id: turnId };
    } else {
      pendingTurn = null;
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
    // Exposed reads for tests (deterministic given the injected rng).
    wantsChallenge,
    chooseBid,
    estimateBidFalseProbability,
    pBidStands,
    /** Test/inspection hooks (server-side only — never sent to clients). */
    inspect() {
      return {
        myDice: myDice.slice(),
        bid: bid ? { ...bid } : null,
        totalDice: totalDice(),
        tilt,
        dyn: { ...dyn },
        pendingTurn: pendingTurn ? { ...pendingTurn } : null,
        pendingPenalty: pendingPenalty ? { ...pendingPenalty } : null,
        opponentStats: new Map(opponentStats),
      };
    },
  };
}
