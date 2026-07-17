// Pure leveling logic (§C1.5): XP grants, level curve, unlock queries.
// No three.js/DOM imports. All numbers from data/constants.js.
// V2/G16 (PLAN2 §B3): level cap 30 → LEVELING.MAX_LEVEL (40), XP curve
// formula unchanged (cumulative L40 = 40 950); unlock queries now cover the
// 9 new §B6 minigames (UNLOCKS.MINIGAMES) alongside the v1 UNLOCK_LEVELS.

import { XP, UNLOCK_LEVELS, UNLOCKS, LEVELING } from '../data/constants.js';

/** V2/G16: merged game → unlock-level map (v1 §C6.3 + 2.0 §B6). */
const ALL_UNLOCK_LEVELS = Object.freeze({ ...UNLOCK_LEVELS, ...UNLOCKS.MINIGAMES });

/**
 * XP required to advance from level L to L+1 (§C1.5): 100 + 50*(L-1).
 * L1→2 = 100, L9→10 = 500.
 * @param {number} level current level (1-based)
 * @returns {number}
 */
export function xpToNext(level) {
  return XP.BASE + XP.STEP * (level - 1);
}

/**
 * Cumulative XP needed to reach a level from level 1 (to L10 = 2700).
 * @param {number} level target level
 * @returns {number}
 */
export function cumulativeXpToLevel(level) {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNext(l);
  return sum;
}

/**
 * Apply an XP grant, handling multi-level-ups and the max-level cap
 * (V2/G16: LEVELING.MAX_LEVEL = 40, §B3 — curve unchanged).
 * Level-up reward is 25 * newLevel coins per level gained (§C1.5).
 * Pure — returns the new progress plus reward info.
 * @param {{xp: number, level: number}} progress current XP within level + level
 * @param {number} amount XP to grant (≥ 0)
 * @returns {{xp: number, level: number, levelsGained: number, coinsAwarded: number}}
 */
export function applyXp(progress, amount) {
  const MAX = LEVELING.MAX_LEVEL; // V2/G16 (§B3)
  let level = Math.max(1, Math.min(MAX, Math.floor(progress.level) || 1));
  let xp = Math.max(0, Number(progress.xp) || 0);
  let levelsGained = 0;
  let coinsAwarded = 0;
  if (level >= MAX) {
    // At max level XP is no longer accumulated.
    return { xp: 0, level, levelsGained: 0, coinsAwarded: 0 };
  }
  xp += Math.max(0, amount);
  while (level < MAX && xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    levelsGained += 1;
    coinsAwarded += XP.LEVEL_UP_COINS_PER_LEVEL * level;
  }
  if (level >= MAX) xp = 0;
  return { xp, level, levelsGained, coinsAwarded };
}

/**
 * XP for finishing a minigame (§C1.5): 10 + min(15, floor(coinsEarned / 2)).
 * @param {number} coinsEarned coins paid out for the round
 * @returns {number}
 */
export function minigameXp(coinsEarned) {
  return (
    XP.MINIGAME_BASE +
    Math.min(XP.MINIGAME_BONUS_CAP, Math.floor(Math.max(0, coinsEarned) / XP.MINIGAME_COIN_DIVISOR))
  );
}

/**
 * Is a minigame unlocked at the given level (§C6.3 + V2/G16 §B6)?
 * Unknown ids are treated as locked.
 * @param {string} id minigame id
 * @param {number} level current level
 * @returns {boolean}
 */
export function isMinigameUnlocked(id, level) {
  const req = ALL_UNLOCK_LEVELS[id];
  if (req == null) return false;
  return level >= req;
}

/**
 * All minigame ids unlocked at the given level, in unlock order
 * (§C6.3 + V2/G16 §B6 — all 21 games at L14+).
 * @param {number} level
 * @returns {string[]}
 */
export function unlockedMinigames(level) {
  return Object.entries(ALL_UNLOCK_LEVELS)
    .filter(([, req]) => level >= req)
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
}
