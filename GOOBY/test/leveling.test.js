// XP curve & level logic vs §C1.5 (binding): L→L+1 = 100 + 50*(L-1),
// L9→10 = 500, cumulative to L10 = 2700, level-up coins 25*newLevel, max 30.
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
import { XP, UNLOCK_LEVELS } from '../src/data/constants.js';

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

test('applyXp: capped at max level 30, XP no longer accumulates', () => {
  const r = applyXp({ xp: 0, level: 30 }, 99999);
  assert.deepEqual(r, { xp: 0, level: 30, levelsGained: 0, coinsAwarded: 0 });
  // reaching the cap mid-grant stops there
  const r2 = applyXp({ xp: 0, level: 29 }, 1e9);
  assert.equal(r2.level, 30);
  assert.equal(r2.xp, 0);
  assert.equal(r2.levelsGained, 1);
  assert.equal(r2.coinsAwarded, 25 * 30);
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
  assert.equal(unlockedMinigames(10).length, Object.keys(UNLOCK_LEVELS).length);
});
