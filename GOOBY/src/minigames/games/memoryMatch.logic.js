// Memory Match — pure layout/deck/scoring logic (§C6.1 #5, agent G8). No
// three.js/DOM imports (§B rule); the game module (memoryMatch.js) imports
// from here. Binding numbers: 4×4 grid with 8 pairs (6×4 with 12 pairs at
// level ≥ MINIGAME.MEMORY_BIG_LAYOUT_LEVEL — §C1.5), score = 20 − misses +
// timeBonus(0–8), no fail state. Coin row (§C6): divisor 2, min 5, max 24.

import { MINIGAME } from '../../data/constants.js';

/** Binding §C6.1 #5 numbers + G8 tuning (time-bonus pars). */
export const MEMORY = Object.freeze({
  /** Score formula base (§C6.1: 20 − misses + timeBonus). */
  SCORE_BASE: 20,
  /** Time bonus range 0–8 (§C6.1). */
  TIME_BONUS_MAX: 8,
  /** Full bonus at/below par; −1 per step over (G8 tuning). */
  TIME_BONUS_STEP_SEC: 5,
  /** Par seconds by pair count (G8 tuning: generous for good-not-perfect play). */
  PAR_SEC_SMALL: 48,
  PAR_SEC_BIG: 85,
  /** Small 4×4 layout: 8 pairs (§C6.1). */
  SMALL: Object.freeze({ cols: 4, rows: 4, pairs: 8 }),
  /** Big 6×4 layout: 12 pairs at level ≥6 (§C6.1/§C1.5). Portrait: 4 wide × 6 tall. */
  BIG: Object.freeze({ cols: 4, rows: 6, pairs: 12 }),
  CARD_W: 0.82,
  CARD_H: 1,
  SPACING_X: 0.93,
  SPACING_Y: 1.12,
  /** Unmatched pair stays revealed this long before flipping back (s). */
  REVEAL_SEC: 0.85,
  FLIP_SEC: 0.28,
  /** V3 §C10.2: one 1 s peek, earned by three clean matches. */
  PEEK_EARN_MATCHES: 3,
  PEEK_SEC: 1,
  /** V4/G71 §G5 sequence/puzzle defaults (Mittel identity). */
  PREVIEW_SPEED_MULT: 1,
  WINDOW_MULT: 1,
  RAMP_FLOOR_STEP: 0,
  CLEAR_BONUS: 0,
  ENDLESS: false,
  ENDLESS_MISS_FLIPS: 12,
});

export const MEMORY_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ previewSpeed: 0.85, window: 1.25, rampFloor: 0, bonus: 0, endless: false }),
  normal: Object.freeze({ previewSpeed: 1, window: 1, rampFloor: 0, bonus: 0, endless: false }),
  // The frozen target is 40 while the legacy formula tops out at 28. A
  // Schwer-only +20 clear bonus reaches the §G5.4 cap-score of 48 and closes
  // that inherited reachability gap without changing Mittel or its coin row.
  hard: Object.freeze({ previewSpeed: 1.15, window: 0.8, rampFloor: -1, bonus: 20, endless: false }),
  endless: Object.freeze({ previewSpeed: 1.15, window: 0.8, rampFloor: -1, bonus: 20, endless: true }),
});

export function applyDifficulty(tune = MEMORY, mode = 'normal') {
  const id = Object.hasOwn(MEMORY_DIFFICULTY, mode) ? mode : 'normal';
  if (id === 'normal') return tune;
  const row = MEMORY_DIFFICULTY[id];
  return Object.freeze({
    ...tune,
    REVEAL_SEC: Math.max(0.35, tune.REVEAL_SEC * row.window),
    PEEK_SEC: Math.max(0.35, tune.PEEK_SEC * row.window),
    FLIP_SEC: tune.FLIP_SEC / row.previewSpeed,
    PREVIEW_SPEED_MULT: row.previewSpeed,
    WINDOW_MULT: row.window,
    RAMP_FLOOR_STEP: row.rampFloor,
    CLEAR_BONUS: row.bonus,
    ENDLESS: row.endless,
    MODE: id,
  });
}

/**
 * Card faces (Kenney food-kit minis, §C6.1) — first 8 serve the 4×4 layout,
 * all 12 the 6×4 layout.
 */
export const FACE_KEYS = Object.freeze([
  'carrot', 'apple', 'banana', 'cheese',
  'watermelon', 'donut-sprinkles', 'cupcake', 'burger',
  'ice-cream', 'pizza', 'cake', 'strawberry',
]);

/**
 * Grid layout for a pet level (§C1.5: 6×4 at L6+, else 4×4).
 * @param {number} level pet level (1…30)
 * @returns {{cols: number, rows: number, pairs: number}}
 */
export function layoutForLevel(level) {
  return level >= MINIGAME.MEMORY_BIG_LAYOUT_LEVEL ? MEMORY.BIG : MEMORY.SMALL;
}

/**
 * Build a shuffled deck of pair ids (Fisher-Yates with the seeded ctx.rng).
 * @param {number} pairs pair count (8 or 12)
 * @param {() => number} rng 0..1
 * @returns {number[]} `pairs*2` entries, each pair id 0…pairs−1 exactly twice
 */
export function buildDeck(pairs, rng) {
  const deck = [];
  for (let i = 0; i < pairs; i += 1) deck.push(i, i);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Time bonus (§C6.1: 0–8): full at/below par for the layout, −1 per
 * TIME_BONUS_STEP_SEC over par, clamped 0…8.
 * @param {number} elapsed seconds to clear the board
 * @param {{pairs: number}} layout
 * @returns {number} 0…8
 */
export function timeBonus(elapsed, layout) {
  const par = layout.pairs > MEMORY.SMALL.pairs ? MEMORY.PAR_SEC_BIG : MEMORY.PAR_SEC_SMALL;
  const over = Math.max(0, elapsed - par);
  const bonus = MEMORY.TIME_BONUS_MAX - Math.ceil(over / MEMORY.TIME_BONUS_STEP_SEC);
  return Math.max(0, Math.min(MEMORY.TIME_BONUS_MAX, bonus));
}

/**
 * Final score (§C6.1, verbatim): `20 − misses + timeBonus(0–8)`, floored at 0
 * (no fail state; the §C6 coin clamp min 5 guarantees a payout).
 * @param {number} misses non-matching reveals
 * @param {number} elapsed seconds to clear the board
 * @param {{pairs: number}} layout
 * @returns {number}
 */
export function memoryScore(misses, elapsed, layout, tune = MEMORY) {
  return Math.max(
    0,
    tune.SCORE_BASE - misses + timeBonus(elapsed, layout) + (tune.CLEAR_BONUS ?? 0)
  );
}

/**
 * Resolve a two-card reveal: match when both cards carry the same pair id.
 * @param {number} a pair id of the first card
 * @param {number} b pair id of the second card
 * @returns {boolean}
 */
export function isMatch(a, b) {
  return a === b;
}

/**
 * Advance the clean-match streak that earns the one-shot peek.
 * @param {{cleanMatches:number, peekReady:boolean, peekUsed:boolean}} state
 * @param {boolean} matched whether the just-resolved pair matched
 * @returns {{cleanMatches:number, peekReady:boolean, peekUsed:boolean}}
 */
export function advancePeekProgress(state, matched) {
  const cleanMatches = matched ? state.cleanMatches + 1 : 0;
  return {
    cleanMatches,
    peekReady: state.peekReady ||
      (!state.peekUsed && cleanMatches >= MEMORY.PEEK_EARN_MATCHES),
    peekUsed: state.peekUsed,
  };
}

/** One peek per round, only after it has been earned. */
export function canUsePeek(state) {
  return state.peekReady && !state.peekUsed;
}

/**
 * Synchronous flip admission closes the rapid double-flip race: once two
 * unresolved cards are selected, no third card can enter before resolution.
 * @param {{phase:string, pickedCount:number, cardState:string, peeking:boolean}} state
 * @returns {boolean}
 */
export function canFlipCard(state) {
  return state.phase === 'play' &&
    !state.peeking &&
    state.pickedCount < 2 &&
    state.cardState === 'down';
}

/**
 * Centered grid extents for narrow-viewport layout audits.
 * @param {{cols:number,rows:number}} layout
 */
export function gridExtents(layout) {
  return {
    width: (layout.cols - 1) * MEMORY.SPACING_X + MEMORY.CARD_W,
    height: (layout.rows - 1) * MEMORY.SPACING_Y + MEMORY.CARD_H,
  };
}

/** §G5.4: endless boards chain until 12 cumulative miss-flips. */
export function isMemoryEndlessOver(misses, tune = MEMORY) {
  return tune.ENDLESS && misses >= tune.ENDLESS_MISS_FLIPS;
}

/** Deterministic certification model for the mode-aware memory bot. */
export function simulateMemoryAutoplay(mode = 'normal', seed = 1) {
  const tune = applyDifficulty(MEMORY, mode);
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) | 0;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const layout = MEMORY.BIG;
  const recallFail = mode === 'easy' ? 0.04 : mode === 'hard' || mode === 'endless' ? 0.12 : 0.08;
  let misses = 0;
  for (let i = 0; i < layout.pairs; i += 1) {
    if (rng() < recallFail) misses += 1;
  }
  const elapsed = layout.pairs * (mode === 'easy' ? 1.2 : mode === 'hard' ? 0.92 : 1.05);
  const rawScore = memoryScore(misses, elapsed, layout, { ...tune, CLEAR_BONUS: 0 });
  return {
    score: memoryScore(misses, elapsed, layout, tune),
    rawScore,
    misses,
    elapsed,
  };
}
