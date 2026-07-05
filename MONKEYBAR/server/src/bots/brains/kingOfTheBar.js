// King of the Bar bot brain (R7) — a THIN wrapper over the Monkey Lies
// botBrain with Bar Rule awareness, plugged into botManager via
// bots/brains/index.js (R2 brain convention: createBrain({seat,
// personalityId, rng}) → brain).
//
// The inner ML brain does all the real thinking (suspicion model, bluffing,
// personalities). This wrapper only bends its output where a Bar Rule bends
// the rules:
//   happy_hour   → pad plays up to the 2-card floor (truth-preserving cards
//                  first so honest plays stay honest); a 1-card hand still
//                  sheds its last single.
//   hair_trigger → 2 coconuts loaded: the chip threshold drops (×0.75) so
//                  bots reach for the Lucky Banana Chip sooner.
//   royal_decree → a `turn` carrying actions:['pickFruit'] is answered with
//                  `modeAction pickFruit {fruit}` — the most-held fruit.
//   sour_table   → `fruitFlip` modeEvents keep the wrapper's Table Fruit
//                  current (the pad-preference + decree picks use it).
//   silent_round → bots keep poker faces too: social reactions are muzzled
//                  while the silent round is live (bot chatter bypasses the
//                  room's seated-chat gate, so the brain self-censors).
//   sticky_stool → no change needed: the brain only ever acts on its own
//                  `turn` events, whatever order they arrive in.

import { BASIC_FRUITS, cardMatchesTableFruit } from '@monkeybar/shared/cards.js';
import { KING_ACTIONS, KING_EVENTS } from '@monkeybar/shared/modeEvents.js';
import { MSG } from '@monkeybar/shared/protocol.js';

import { createBotBrain } from '../botBrain.js';

export const MODE_ID = 'kingOfTheBar';

/** Happy Hour floor (mirrors the engine's minPlay 2 Bar Rule). */
const HAPPY_HOUR_MIN_PLAY = 2;
/** Hair Trigger: chip threshold multiplier (bots chip sooner under 2 coconuts). */
const HAIR_TRIGGER_CHIP_SCALE = 0.75;

/**
 * @param {Object} options
 * @param {number} options.seat
 * @param {string} [options.personalityId]
 * @param {() => number} [options.rng]
 */
export function createBrain({ seat, personalityId = 'cautious', rng = Math.random }) {
  const inner = createBotBrain({ seat, personalityId, rng });

  // ---- wrapper knowledge (same per-seat feed the inner brain gets) ----------
  /** @type {import('@monkeybar/shared/protocol.js').Card[]} own tracked hand */
  let hand = [];
  /** @type {string|null} CURRENT Table Fruit (fruitFlip-aware, unlike inner) */
  let tableFruit = null;
  /** @type {string|null} the active Bar Rule id (kingBarRule modeEvent) */
  let activeRuleId = null;
  /** Round in flight (silent-round self-censor window). */
  let roundActive = false;
  /** A Royal Decree pick window is open for THIS seat. */
  let decreePending = false;
  /** @type {{chambers: number, coconuts: number, chipUsable: boolean}|null} own pending penalty */
  let myPenalty = null;

  const isTruthy = (c) => cardMatchesTableFruit(c, tableFruit);

  /** The basic fruit this seat holds most of (rng breaks an empty hand). */
  function mostHeldFruit() {
    let best = null;
    let bestN = 0;
    for (const f of BASIC_FRUITS) {
      const n = hand.filter((c) => c.fruit === f).length;
      if (n > bestN) {
        best = f;
        bestN = n;
      }
    }
    return best ?? BASIC_FRUITS[Math.floor(rng() * BASIC_FRUITS.length)];
  }

  /**
   * Happy Hour floor on chooseCount: pad the inner pick up to min(2, hand).
   * Truth-preserving cards (Table Fruit / wild) pad first so an honest play
   * stays honest; a bluff stays a bluff either way.
   */
  function padToHappyHour(cardIds) {
    const floor = Math.min(HAPPY_HOUR_MIN_PLAY, hand.length);
    if (cardIds.length >= floor) return cardIds;
    const ids = cardIds.slice();
    const pool = [...hand].sort((a, b) => (isTruthy(b) ? 1 : 0) - (isTruthy(a) ? 1 : 0));
    for (const c of pool) {
      if (ids.length >= floor) break;
      if (!ids.includes(c.id)) ids.push(c.id);
    }
    return ids;
  }

  // ---- decision surface -------------------------------------------------------

  /** @returns {{type: string, cardIds?: string[], action?: string, data?: Object}|null} */
  function decideTurn() {
    if (decreePending) {
      // Royal Decree: crown the fruit we hold most of.
      return { type: 'mode', action: KING_ACTIONS.PICK_FRUIT, data: { fruit: mostHeldFruit() } };
    }
    const action = inner.decideTurn();
    if (action?.type === 'play' && activeRuleId === 'happy_hour') {
      return { ...action, cardIds: padToHappyHour(action.cardIds) };
    }
    return action;
  }

  function decidePenalty() {
    const d = inner.decidePenalty();
    if (!d || d.useChip || activeRuleId !== 'hair_trigger') return d;
    if (!myPenalty?.chipUsable) return d;
    // Hair Trigger lowers the chip threshold: 2 coconuts loaded make the
    // Lucky Banana Chip worth burning earlier than the archetype's default.
    const pHit = (myPenalty.coconuts ?? 1) / Math.max(1, myPenalty.chambers ?? 1);
    if (pHit >= inner.params.chipThreshold * HAIR_TRIGGER_CHIP_SCALE) return { useChip: true };
    return d;
  }

  /** Commit hook — keep the wrapper's hand exactly as sync'd as the inner's. */
  function onOwnActionApplied(action) {
    if (action?.type === 'mode') decreePending = false;
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
      case MSG.ROUND_START:
        tableFruit = p.tableFruit;
        roundActive = true;
        decreePending = false;
        myPenalty = null;
        break;
      case MSG.TURN:
        decreePending =
          p.seat === seat && Array.isArray(p.actions) && p.actions.includes(KING_ACTIONS.PICK_FRUIT);
        break;
      case MSG.PENALTY:
        myPenalty = p.seat === seat ? { chambers: p.chambers, coconuts: p.coconuts, chipUsable: !!p.chipUsable } : null;
        break;
      case MSG.ROUND_END:
      case MSG.MATCH_END:
        roundActive = false;
        decreePending = false;
        myPenalty = null;
        break;
      case MSG.MODE_EVENT:
        if (p.kind === KING_EVENTS.BAR_RULE) activeRuleId = p.ruleId;
        else if (p.kind === 'fruitFlip') tableFruit = p.fruit; // Sour Table re-roll
        // The inner ML brain has no modeEvent vocabulary — nothing to forward.
        return null;
      default:
        break;
    }
    const reaction = inner.observe(envelope);
    // Silent Round: no table talk — not even from the robots.
    if (activeRuleId === 'silent_round' && roundActive) return null;
    return reaction;
  }

  /** Mid-match takeover: prime the inner brain AND the wrapper's bookkeeping. */
  function primeFromSnapshot(snap) {
    inner.primeFromSnapshot(snap);
    if (!snap || snap.roundNo === 0) return;
    tableFruit = snap.tableFruit ?? tableFruit;
    hand = Array.isArray(snap.yourHand) ? snap.yourHand.map((c) => ({ ...c })) : [];
    activeRuleId = snap.barRule?.ruleId ?? activeRuleId;
    roundActive = !['roundEnd', 'matchEnd'].includes(snap.phase);
    decreePending = snap.phase === 'decree' && snap.turnSeat === seat;
  }

  function primePenalty(p) {
    myPenalty = { chambers: p.chambers, coconuts: p.coconuts, chipUsable: !!p.chipUsable };
    inner.primePenalty(p);
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
    primePenalty,
    estimateLieProbability: inner.estimateLieProbability,
    /** Test/inspection hooks (server-side only — never sent to clients). */
    inspect() {
      return {
        ...inner.inspect(),
        wrapperHandSize: hand.length,
        tableFruit,
        activeRuleId,
        roundActive,
        decreePending,
      };
    },
  };
}
