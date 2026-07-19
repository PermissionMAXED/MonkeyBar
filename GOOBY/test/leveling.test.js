// XP curve & level logic vs §C1.5 (binding): L→L+1 = 100 + 50*(L-1),
// L9→10 = 500, cumulative to L10 = 2700, level-up coins 25*newLevel.
// V2/G16 (PLAN2 §B3/§B6): cap 30 → LEVELING.MAX_LEVEL 40 (curve unchanged,
// cumulative L40 = 40 950); unlock queries cover the 9 new §B6 games.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  xpToNext,
  cumulativeXpToLevel,
  applyXp,
  minigameXp,
  isMinigameUnlocked,
  unlockedMinigames,
} from '../src/systems/leveling.js';
import { XP, UNLOCK_LEVELS, UNLOCKS, LEVELING } from '../src/data/constants.js';

test('XP curve: L1→2 = 100, L2→3 = 150, L9→10 = 500', () => {
  assert.equal(xpToNext(1), 100);
  assert.equal(xpToNext(2), 150);
  assert.equal(xpToNext(9), 500);
});

test('cumulative XP to L10 = 2700 (§C1.5)', () => {
  assert.equal(cumulativeXpToLevel(10), 2700);
  assert.equal(cumulativeXpToLevel(2), 100);
  assert.equal(cumulativeXpToLevel(1), 0);
});

test('applyXp: no level-up below threshold', () => {
  const r = applyXp({ xp: 0, level: 1 }, 99);
  assert.deepEqual(r, { xp: 99, level: 1, levelsGained: 0, coinsAwarded: 0 });
});

test('applyXp: single level-up pays 25*newLevel coins', () => {
  const r = applyXp({ xp: 90, level: 1 }, 10);
  assert.equal(r.level, 2);
  assert.equal(r.xp, 0);
  assert.equal(r.levelsGained, 1);
  assert.equal(r.coinsAwarded, 25 * 2);
});

test('applyXp: multi level-up in one grant', () => {
  // 100 (L1→2) + 150 (L2→3) = 250; grant 260 → level 3 with 10 xp left
  const r = applyXp({ xp: 0, level: 1 }, 260);
  assert.equal(r.level, 3);
  assert.equal(r.xp, 10);
  assert.equal(r.levelsGained, 2);
  assert.equal(r.coinsAwarded, 25 * 2 + 25 * 3);
});

test('applyXp: capped at max level 40, XP no longer accumulates (V2 §B3)', () => {
  assert.equal(LEVELING.MAX_LEVEL, 40);
  const r = applyXp({ xp: 0, level: 40 }, 99999);
  assert.deepEqual(r, { xp: 0, level: 40, levelsGained: 0, coinsAwarded: 0 });
  // reaching the cap mid-grant stops there
  const r2 = applyXp({ xp: 0, level: 39 }, 1e9);
  assert.equal(r2.level, 40);
  assert.equal(r2.xp, 0);
  assert.equal(r2.levelsGained, 1);
  assert.equal(r2.coinsAwarded, 25 * 40);
  // level 30 (the old cap) keeps leveling in 2.0
  const r3 = applyXp({ xp: 0, level: 30 }, xpToNext(30));
  assert.equal(r3.level, 31);
  assert.equal(r3.coinsAwarded, 25 * 31);
});

test('V2/G16: cumulative XP to the new L40 cap = 40 950 (§B3, curve unchanged)', () => {
  assert.equal(cumulativeXpToLevel(40), 40950);
  assert.equal(cumulativeXpToLevel(30), 23200); // old-cap midpoint sanity
});

test('minigame XP: 10 + min(15, floor(coins/2)) (§C1.5)', () => {
  assert.equal(minigameXp(0), 10);
  assert.equal(minigameXp(5), 12);
  assert.equal(minigameXp(30), 25);
  assert.equal(minigameXp(100), 25); // capped
  assert.equal(XP.MINIGAME_BASE + XP.MINIGAME_BONUS_CAP, 25);
});

test('unlock queries follow §C6.3', () => {
  assert.equal(isMinigameUnlocked('carrotCatch', 1), true);
  assert.equal(isMinigameUnlocked('runner', 5), false);
  assert.equal(isMinigameUnlocked('runner', 6), true);
  assert.equal(isMinigameUnlocked('trampoline', 9), false);
  assert.equal(isMinigameUnlocked('trampoline', 10), true);
  assert.equal(isMinigameUnlocked('nope', 99), false);
  assert.deepEqual(unlockedMinigames(1), ['carrotCatch', 'bunnyHop', 'cityDrive']);
});

test('V2/G16: unlock queries cover the 9 new §B6 games', () => {
  assert.equal(isMinigameUnlocked('goobySays', 1), false);
  assert.equal(isMinigameUnlocked('goobySays', 2), true);
  assert.equal(isMinigameUnlocked('gardenRush', 4), true);
  assert.equal(isMinigameUnlocked('burgerBuild', 5), true);
  assert.equal(isMinigameUnlocked('veggieChop', 6), true);
  assert.equal(isMinigameUnlocked('deliveryRush', 7), true);
  assert.equal(isMinigameUnlocked('miniGolf', 8), false);
  assert.equal(isMinigameUnlocked('miniGolf', 9), true);
  assert.equal(isMinigameUnlocked('goalieGooby', 11), true);
  assert.equal(isMinigameUnlocked('starHopper', 12), true);
  assert.equal(isMinigameUnlocked('pipeFlow', 13), false);
  assert.equal(isMinigameUnlocked('pipeFlow', 14), true);
  // L10: all 12 v1 games + every §B6/§E0.1-3 game gated ≤ 10
  const atOldMax = Object.keys(UNLOCK_LEVELS).length +
    Object.values(UNLOCKS.MINIGAMES).filter((l) => l <= 10).length;
  assert.equal(unlockedMinigames(10).length, atOldMax);
  // V3/G34: catalog is 27 now; the last gate is harborHopper at L20 (§E0.1-3)
  // V4/G53: +goobyWelt at L12 (PLAN4 §B10) → 28
  assert.equal(unlockedMinigames(20).length, 28);
  assert.equal(unlockedMinigames(40).length, 28);
});

test('V3/G34: unlock queries cover the 6 new §E0.1-3 gates', () => {
  assert.equal(isMinigameUnlocked('shoppingSurf', 4), false);
  assert.equal(isMinigameUnlocked('shoppingSurf', 5), true);
  assert.equal(isMinigameUnlocked('purblePlace', 6), true);
  assert.equal(isMinigameUnlocked('toyRacer', 14), false);
  assert.equal(isMinigameUnlocked('toyRacer', 15), true);
  assert.equal(isMinigameUnlocked('ghostHunt', 16), true);
  assert.equal(isMinigameUnlocked('rocketRescue', 17), false);
  assert.equal(isMinigameUnlocked('rocketRescue', 18), true);
  assert.equal(isMinigameUnlocked('harborHopper', 19), false);
  assert.equal(isMinigameUnlocked('harborHopper', 20), true);
});
