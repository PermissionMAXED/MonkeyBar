// V4/G56 — framework 2.0 pure logic (PLAN4-GAMES §G5, PLAN4 §C-SYS7.1,
// §E0.1-2): difficulty/endless launch validation, the §G5.2 coin-multiplier
// math (fallback shim + assertion oracle — economy.awardMinigame is the ONE
// runtime payout site once G54's v4 economy lands), the sick-gate predicate
// and defensive readers for G53's §G5.5 save slice. PURE module: no three.js/
// DOM imports — node:test hits this file directly.

import { isSurfTravel } from '../systems/shopTrip.js';

/** §G5.2 — the four modes. `normal` is the default (live numbers). */
export const DIFFICULTY_MODES = Object.freeze(['easy', 'normal', 'hard', 'endless']);

/**
 * §G5.2 coin multipliers (frozen here per §E0.1-2 owning-module rule; G54's
 * economy implements the SAME numbers at the single payout site — this table
 * is the shared oracle for tests and the pre-G54 fallback shim).
 */
export const DIFFICULTY_COIN_MULT = Object.freeze({ easy: 0.7, normal: 1, hard: 1.3 });

/** §G5.2 — Endlos pays a flat 5 c per run (daily ×2 still applies after). */
export const ENDLESS_FLAT_COINS = 5;

/** §G5.5 — ENDLOS pill needs `beaten[id].hard` AND level ≥ 10. */
export const ENDLESS_MIN_LEVEL = 10;

/**
 * §G5.1 exclusions: cityDrive rides trip/§C4 semantics (single difficulty),
 * goobyWelt is the §G6 chill special. Trips are excluded by mode (see
 * effectiveDifficulty); dev games (`_smoke`) by meta.dev.
 */
export const DIFFICULTY_EXCLUDED_GAMES = Object.freeze(['cityDrive', 'goobyWelt']);

/**
 * Normalize a requested difficulty to a known mode id.
 * @param {*} mode
 * @returns {'easy'|'normal'|'hard'|'endless'}
 */
export function normalizeDifficulty(mode) {
  return DIFFICULTY_MODES.includes(mode) ? mode : 'normal';
}

/**
 * Is the difficulty system enabled for this game at all (§G5.1)?
 * @param {string} gameId
 * @param {{dev?: boolean}|undefined} [meta] data/minigames.js row
 * @returns {boolean}
 */
export function difficultyEnabled(gameId, meta) {
  if (DIFFICULTY_EXCLUDED_GAMES.includes(gameId)) return false;
  if (meta?.dev === true) return false;
  return true;
}

/**
 * The difficulty a launch actually runs at (§G5.1/§G5.7-1): trip/travel
 * launches (shopTrip drive, vet drive, surf „Laufen") and excluded games are
 * always 'normal'; everything else normalizes `params.difficulty`.
 * @param {string} gameId
 * @param {{difficulty?: string, mode?: string}} [params] framework launch params
 * @param {{dev?: boolean}|undefined} [meta]
 * @returns {'easy'|'normal'|'hard'|'endless'}
 */
export function effectiveDifficulty(gameId, params = {}, meta) {
  if (params.mode != null) return 'normal'; // trips/travel never take difficulty
  if (!difficultyEnabled(gameId, meta)) return 'normal';
  return normalizeDifficulty(params.difficulty);
}

/**
 * §E0.1-2 / §G5.2 base-coin math (BEFORE the daily ×2 / code buff / doppelGold
 * steps — those stay economy-side): `base = min(row.max, max(row.min,
 * round(rowClamp(score) × difficultyMult)))`. The row-min floor is §G5.2's
 * Leicht rule („floor: row min"); ×1 reproduces rowClamp bit-identically.
 * Endless does NOT use this (flat ENDLESS_FLAT_COINS override).
 * @param {{divisor?: number, min?: number, max: number}} coinTable §C6 row
 * @param {number} score final round score
 * @param {'easy'|'normal'|'hard'} mode
 * @returns {number} integer base coins
 */
export function applyDifficultyCoinBase(coinTable, score, mode) {
  const s = Math.max(0, Math.floor(Number(score) || 0));
  const rowClamp = Math.min(
    coinTable.max,
    Math.max(coinTable.min ?? 0, Math.floor(s / (coinTable.divisor ?? 1)))
  );
  const mult = DIFFICULTY_COIN_MULT[mode] ?? 1;
  return Math.min(coinTable.max, Math.max(coinTable.min ?? 0, Math.round(rowClamp * mult)));
}

/**
 * §C-SYS7.1 sick gate (the one-line class change): while sick, BOTH shop
 * travel methods (drive `shopTrip` AND Shopping Surf `surfTravel`/`travel`)
 * plus the vet drive may launch; pure arcade launches stay blocked with
 * `toast.tooSick`.
 * @param {string|undefined} mode framework launch `params.mode`
 * @returns {boolean} true when the launch is allowed while sick
 */
export function allowsWhileSick(mode) {
  return mode === 'vetTrip' || mode === 'shopTrip' || isSurfTravel(mode);
}

/**
 * Defensive §G5.5 slice reader (G53 lands the save-v4 shape in the same wave
 * — every field falls back to the empty default until then, and hostile /
 * missing containers can never throw).
 * @param {object} state full save state (or any {minigames, level} shape)
 * @param {string} gameId
 * @returns {{selected: 'easy'|'normal'|'hard', beaten: {easy?: boolean,
 *   normal?: boolean, hard?: boolean}, bestByDiff: {easy?: number,
 *   hard?: number}, best: number, endlessBest: number}}
 */
export function difficultySliceOf(state, gameId) {
  const mg = state?.minigames ?? {};
  const selRaw = mg.difficulty?.[gameId];
  const selected = selRaw === 'easy' || selRaw === 'hard' ? selRaw : 'normal';
  const beatenRow = mg.beaten?.[gameId];
  const beaten = beatenRow && typeof beatenRow === 'object' ? beatenRow : {};
  const bbdRow = mg.bestByDiff?.[gameId];
  const bestByDiff = bbdRow && typeof bbdRow === 'object' ? bbdRow : {};
  return {
    selected,
    beaten,
    bestByDiff,
    best: Math.max(0, Math.floor(Number(mg.best?.[gameId]) || 0)),
    endlessBest: Math.max(0, Math.floor(Number(mg.endlessBest?.[gameId]) || 0)),
  };
}

/**
 * §G5.5 endless lock: enabled iff `beaten[id].hard === true` AND level ≥ 10.
 * Defensive against the missing v4 slice (locked by default).
 * @param {object} state full save state
 * @param {string} gameId
 * @returns {boolean}
 */
export function endlessUnlocked(state, gameId) {
  const level = Math.max(1, Math.floor(Number(state?.level) || 1));
  return difficultySliceOf(state, gameId).beaten.hard === true && level >= ENDLESS_MIN_LEVEL;
}

/**
 * Per-mode best for the results/pre-game boards (§G5.5: `best` stays the
 * Mittel board; Leicht/Schwer live in `bestByDiff`, Endlos in `endlessBest`).
 * @param {object} state full save state
 * @param {string} gameId
 * @param {'easy'|'normal'|'hard'|'endless'} mode
 * @returns {number}
 */
export function bestForMode(state, gameId, mode) {
  const slice = difficultySliceOf(state, gameId);
  if (mode === 'endless') return slice.endlessBest;
  if (mode === 'easy' || mode === 'hard') {
    return Math.max(0, Math.floor(Number(slice.bestByDiff[mode]) || 0));
  }
  return slice.best;
}
