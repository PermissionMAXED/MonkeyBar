// Pure leveling logic (§C1.5): XP grants, level curve, unlock queries.
// No three.js/DOM imports. All numbers from data/constants.js.
// V2/G16 (PLAN2 §B3): level cap 30 → LEVELING.MAX_LEVEL (40), XP curve
// formula unchanged (cumulative L40 = 40 950); unlock queries now cover the
// 9 new §B6 minigames (UNLOCKS.MINIGAMES) alongside the v1 UNLOCK_LEVELS.
// V4/G56 (PLAN4 §C-SYS3.1/§E0.1-13): applyXp gains a `source` tag and emits
// the runtime-only store event `xpGranted {amount, source}` from THIS single
// site (call sites only pass their tag); §C-SYS3.3 adds nextUnlock(level).

import { XP, UNLOCK_LEVELS, UNLOCKS, LEVELING } from '../data/constants.js';
// V4/G56: store singleton for the runtime `xpGranted` emit (§E0.1-13 —
// core/store.js is a pure module; getStore() throws before boot/in bare node
// tests, which the guarded emit below treats as "nobody listening").
import { getStore } from '../core/store.js';

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
 * V4/G56 (§C-SYS3.1): emit the runtime-only `xpGranted {amount, source}`
 * store event — amount-0 grants (caps reached, max level) emit NOTHING.
 * Guarded: before boot / in bare node tests there is no store singleton.
 * @param {number} amount granted XP (> 0 to emit)
 * @param {string} [source] grant-site tag (§C-SYS3.1 table)
 */
function emitXpGranted(amount, source) {
  if (!(amount > 0)) return;
  try {
    getStore().emit?.('xpGranted', { amount, source: source ?? '' });
  } catch {
    /* no store yet — nobody is listening */
  }
}

/**
 * Apply an XP grant, handling multi-level-ups and the max-level cap
 * (V2/G16: LEVELING.MAX_LEVEL = 40, §B3 — curve unchanged).
 * Level-up reward is 25 * newLevel coins per level gained (§C1.5).
 * Pure math — returns the new progress plus reward info. V4/G56 (§E0.1-13):
 * the optional `source` tag rides the single `xpGranted` runtime emit above
 * (max-level and amount-0 grants emit nothing).
 * @param {{xp: number, level: number}} progress current XP within level + level
 * @param {number} amount XP to grant (≥ 0)
 * @param {string} [source] §C-SYS3.1 grant-site tag ('feed', 'quest', …)
 * @returns {{xp: number, level: number, levelsGained: number, coinsAwarded: number}}
 */
export function applyXp(progress, amount, source) {
  const MAX = LEVELING.MAX_LEVEL; // V2/G16 (§B3)
  let level = Math.max(1, Math.min(MAX, Math.floor(progress.level) || 1));
  let xp = Math.max(0, Number(progress.xp) || 0);
  let levelsGained = 0;
  let coinsAwarded = 0;
  if (level >= MAX) {
    // At max level XP is no longer accumulated (and nothing is emitted).
    return { xp: 0, level, levelsGained: 0, coinsAwarded: 0 };
  }
  const granted = Math.max(0, amount);
  xp += granted;
  while (level < MAX && xp >= xpToNext(level)) {
    xp -= xpToNext(level);
    level += 1;
    levelsGained += 1;
    coinsAwarded += XP.LEVEL_UP_COINS_PER_LEVEL * level;
  }
  if (level >= MAX) xp = 0;
  emitXpGranted(granted, source); // V4/G56 (§C-SYS3.1)
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

// ══════════════════════════════════════════════════════════════ V4/G56 ═══
// §C-SYS3.3 next-unlock preview: one shared pure helper over the MERGED
// unlock tables (v1 UNLOCK_LEVELS + §B6 UNLOCKS minigames/features/crops/
// plots). Consumed by the level-up toast (main.js), the recap end card
// (§C-SYS2.7, wave 2) and G69's xpInfo sheet. Name keys: minigames reuse
// `mg.title.<id>`, crops reuse `food.<id>`, features live in
// strings/v4-difficulty.js (`unlock.*`).

/** kind sort priority when several unlocks share a level (deterministic). */
const NEXT_UNLOCK_KIND_ORDER = Object.freeze({ minigame: 0, feature: 1, crop: 2, plot: 3 });

/** @returns {Array<{level: number, kind: string, nameKey: string}>} merged, sorted */
function unlockTable() {
  /** @type {Array<{level: number, kind: string, nameKey: string}>} */
  const rows = [];
  for (const [id, lvl] of Object.entries(ALL_UNLOCK_LEVELS)) {
    rows.push({ level: lvl, kind: 'minigame', nameKey: `mg.title.${id}` });
  }
  // §B6 features (L1 rows are birthright — no preview value, skip them)
  rows.push({ level: UNLOCKS.QUESTS, kind: 'feature', nameKey: 'unlock.quests' });
  rows.push({ level: UNLOCKS.GARDEN, kind: 'feature', nameKey: 'unlock.garden' });
  rows.push({ level: UNLOCKS.SKINS, kind: 'feature', nameKey: 'unlock.skins' });
  rows.push({ level: UNLOCKS.QUICK_DELIVERY, kind: 'feature', nameKey: 'unlock.quickDelivery' });
  for (const [id, lvl] of Object.entries(UNLOCKS.CROPS)) {
    if (lvl > UNLOCKS.GARDEN) rows.push({ level: lvl, kind: 'crop', nameKey: `food.${id}` });
  }
  for (const [idx, def] of Object.entries(UNLOCKS.GARDEN_PLOTS)) {
    rows.push({ level: def.level, kind: 'plot', nameKey: `unlock.plot${Number(idx) + 1}` });
  }
  return rows.sort(
    (a, b) =>
      a.level - b.level ||
      (NEXT_UNLOCK_KIND_ORDER[a.kind] ?? 9) - (NEXT_UNLOCK_KIND_ORDER[b.kind] ?? 9) ||
      (a.nameKey < b.nameKey ? -1 : 1)
  );
}

/**
 * §C-SYS3.3: the next thing the given level has NOT unlocked yet, or null
 * when everything is unlocked (consumers render „Alles freigeschaltet! 🏆" /
 * `unlock.all` for null). Reads the tables live, so G53's later
 * `UNLOCKS.MINIGAMES.goobyWelt` row joins automatically.
 * @param {number} level current level
 * @returns {{level: number, kind: 'minigame'|'feature'|'crop'|'plot',
 *   nameKey: string}|null}
 */
export function nextUnlock(level) {
  const lvl = Math.max(1, Math.floor(Number(level) || 1));
  for (const row of unlockTable()) {
    if (row.level > lvl) return row;
  }
  return null;
}
// ══════════════════════════════════════════════════════════ end V4/G56 ═══
