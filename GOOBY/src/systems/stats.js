// Pure stat math (§C1): decay tick, mood formula, clamps. No three.js/DOM imports
// so node:test runs headlessly. All numbers from data/constants.js.

import { STATS, MOOD } from '../data/constants.js';

/**
 * @typedef {{hunger:number, energy:number, hygiene:number, fun:number}} Stats
 */

/**
 * Clamp a single stat value to [0, 100]. V2/FIX-A (E9 NaN poisoning):
 * non-finite inputs (NaN/±Infinity from corrupt saves or bad arithmetic)
 * fall back to STATS.MIN instead of propagating — Math.min/max pass NaN
 * straight through, which used to poison every stat forever.
 * @param {number} v
 * @returns {number}
 */
export function clampStat(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return STATS.MIN;
  return Math.min(STATS.MAX, Math.max(STATS.MIN, n));
}

/**
 * Clamp every stat of a stats object (returns a new object).
 * @param {Stats} stats
 * @returns {Stats}
 */
export function clampStats(stats) {
  /** @type {Stats} */
  const out = {};
  for (const k of STATS.KEYS) out[k] = clampStat(Number(stats?.[k]) || 0);
  return out;
}

/**
 * Apply one decay/fill tick (§C1 rates). Pure — returns a new stats object.
 * @param {Stats} stats
 * @param {number} dtMin   elapsed real minutes
 * @param {{asleep?: boolean, rateMult?: number}} [opts]
 *   asleep: use asleep rates (hunger half-decay, energy fills);
 *   rateMult: extra multiplier on the rates (offline sim uses 0.3 — §E4).
 * @returns {Stats}
 */
export function applyTick(stats, dtMin, opts = {}) {
  const rates = opts.asleep ? STATS.RATES_ASLEEP : STATS.RATES_AWAKE;
  const mult = opts.rateMult ?? 1;
  /** @type {Stats} */
  const out = {};
  for (const k of STATS.KEYS) {
    out[k] = clampStat(stats[k] + rates[k] * dtMin * mult);
  }
  return out;
}

/**
 * Mood formula (§C1): mood = 0.35 * min(stats) + 0.65 * avg(stats), 0–100.
 * Exhausted (energy ≤ 15) caps mood at 39; an optional debuff (early-wake grumpy,
 * §C1.4) is subtracted before capping.
 * @param {Stats} stats
 * @param {{debuff?: number}} [opts] debuff: mood points to subtract (e.g. 15)
 * @returns {number}
 */
export function mood(stats, opts = {}) {
  const vals = STATS.KEYS.map((k) => stats[k]);
  const min = Math.min(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  let m = MOOD.MIN_WEIGHT * min + MOOD.AVG_WEIGHT * avg;
  if (opts.debuff) m -= opts.debuff;
  if (stats.energy <= STATS.EXHAUSTED_AT_OR_BELOW) {
    m = Math.min(m, STATS.EXHAUSTED_MOOD_CAP);
  }
  return Math.min(STATS.MAX, Math.max(STATS.MIN, m));
}

/**
 * Mood band id for a mood value (§C1 bands).
 * @param {number} moodValue
 * @returns {'ecstatic'|'happy'|'neutral'|'grumpy'|'miserable'}
 */
export function moodBand(moodValue) {
  for (const band of MOOD.BANDS) {
    if (moodValue >= band.min) return band.id;
  }
  return 'miserable';
}

/**
 * @param {number} v stat value
 * @returns {boolean} true when the stat is in the "low" band (< 25, §C1)
 */
export function isLow(v) {
  return v < STATS.LOW_STAT;
}

/**
 * @param {number} v stat value
 * @returns {boolean} true when the stat is critical (< 10, §C1)
 */
export function isCritical(v) {
  return v < STATS.CRITICAL_STAT;
}

/**
 * @param {Stats} stats
 * @returns {boolean} true when Gooby is exhausted (energy ≤ 15 → minigames refuse, §C1)
 */
export function isExhausted(stats) {
  return stats.energy <= STATS.EXHAUSTED_AT_OR_BELOW;
}

/**
 * Apply stat deltas (e.g. food, wash) with clamping. Pure — returns a new object.
 * @param {Stats} stats
 * @param {Partial<Stats>} deltas
 * @returns {Stats}
 */
export function applyDeltas(stats, deltas) {
  /** @type {Stats} */
  const out = {};
  for (const k of STATS.KEYS) out[k] = clampStat(stats[k] + (deltas[k] ?? 0));
  return out;
}
