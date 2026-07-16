// Daily bonus (§C8.2): streak day math incl. reset, day boundaries via the
// pinnable core/clock.js, reward table [20,30,40,50,60,80,100], day ≥ 7
// keeping 100 + 1 random food item, and claim-required semantics.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  prevDay,
  isClaimable,
  nextStreak,
  rewardForStreak,
  pickBonusFood,
  claim,
} from '../src/systems/dailyBonus.js';
import { ECONOMY } from '../src/data/constants.js';
import { FOODS } from '../src/data/foods.js';
import * as clock from '../src/core/clock.js';
import { defaultState } from '../src/core/save.js';

/** Local-noon epoch ms for a YYYY-MM-DD day string (device-local, like localDay). */
function dayMs(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

// ----------------------------------------------------------------- day math

test('prevDay handles plain, month and year boundaries', () => {
  assert.equal(prevDay('2026-07-16'), '2026-07-15');
  assert.equal(prevDay('2026-07-01'), '2026-06-30');
  assert.equal(prevDay('2026-01-01'), '2025-12-31');
  assert.equal(prevDay('2024-03-01'), '2024-02-29'); // leap year
  assert.equal(prevDay('garbage'), '');
  assert.equal(prevDay(''), '');
});

test('isClaimable: first open per local day (§C8.2)', () => {
  assert.equal(isClaimable({ lastClaimDay: '' }, '2026-07-16'), true);
  assert.equal(isClaimable({ lastClaimDay: '2026-07-15' }, '2026-07-16'), true);
  assert.equal(isClaimable({ lastClaimDay: '2026-07-16' }, '2026-07-16'), false);
  assert.equal(isClaimable(undefined, '2026-07-16'), true);
});

test('nextStreak: consecutive day increments, gap or first claim resets to 1', () => {
  assert.equal(nextStreak({ lastClaimDay: '', streak: 0 }, '2026-07-16'), 1);
  assert.equal(nextStreak({ lastClaimDay: '2026-07-15', streak: 3 }, '2026-07-16'), 4);
  assert.equal(nextStreak({ lastClaimDay: '2026-07-14', streak: 3 }, '2026-07-16'), 1); // missed a day
  assert.equal(nextStreak({ lastClaimDay: '2026-06-30', streak: 6 }, '2026-07-01'), 7); // month boundary
});

// ------------------------------------------------------------- reward table

test('rewards day 1–7 are the §C8.2 table verbatim', () => {
  assert.deepEqual([...ECONOMY.DAILY_BONUS], [20, 30, 40, 50, 60, 80, 100]);
  for (let day = 1; day <= 7; day += 1) {
    assert.equal(rewardForStreak(day).coins, ECONOMY.DAILY_BONUS[day - 1], `day ${day}`);
  }
});

test('day ≥ 7 stays at 100 and includes 1 random food item', () => {
  for (const day of [7, 8, 20, 365]) {
    const r = rewardForStreak(day);
    assert.equal(r.coins, 100, `day ${day} coins`);
    assert.equal(r.includesFood, true, `day ${day} food`);
  }
  for (const day of [1, 3, 6]) {
    assert.equal(rewardForStreak(day).includesFood, false, `day ${day} no food yet`);
  }
});

test('pickBonusFood returns a valid catalog id (deterministic with injected rng)', () => {
  assert.equal(pickBonusFood(() => 0), FOODS[0].id);
  assert.equal(pickBonusFood(() => 0.999999), FOODS[FOODS.length - 1].id);
  const ids = new Set(FOODS.map((f) => f.id));
  for (let i = 0; i < 20; i += 1) assert.ok(ids.has(pickBonusFood()));
});

// ------------------------------------------------------------------- claims

test('claim pays coins, advances the streak, and refuses a second claim that day', () => {
  let state = { ...defaultState(), coins: 0 };
  const r1 = claim(state, { day: '2026-07-16' });
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.reward, { streakDay: 1, coins: 20, foodId: null });
  assert.equal(r1.state.coins, 20);
  assert.deepEqual(r1.state.daily, { lastClaimDay: '2026-07-16', streak: 1 });
  // claim required — merely re-opening the same day never double-pays
  assert.equal(claim(r1.state, { day: '2026-07-16' }).ok, false);
  // input state untouched (pure)
  assert.equal(state.coins, 0);
  assert.equal(state.daily.streak, 0);
});

test('7 consecutive claims walk the table; day 7 adds the food item', () => {
  let state = { ...defaultState(), coins: 0, inventory: {} };
  const days = ['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'];
  let total = 0;
  days.forEach((day, i) => {
    const r = claim(state, { day, rng: () => 0 }); // rng 0 → FOODS[0] (carrot)
    assert.equal(r.ok, true);
    assert.equal(r.reward.streakDay, i + 1);
    assert.equal(r.reward.coins, ECONOMY.DAILY_BONUS[i]);
    assert.equal(r.reward.foodId, i === 6 ? FOODS[0].id : null);
    total += r.reward.coins;
    state = r.state;
  });
  assert.equal(state.coins, total);
  assert.equal(state.daily.streak, 7);
  assert.equal(state.inventory[FOODS[0].id], 1);
  // day 8: still 100 + another food item, streak keeps counting
  const r8 = claim(state, { day: '2026-07-17', rng: () => 0 });
  assert.equal(r8.reward.coins, 100);
  assert.equal(r8.reward.streakDay, 8);
  assert.equal(r8.state.daily.streak, 8);
  assert.equal(r8.state.inventory[FOODS[0].id], 2);
});

test('missing a day resets the streak to 1 (§C8.2)', () => {
  let state = { ...defaultState(), daily: { lastClaimDay: '2026-07-14', streak: 6 } };
  const r = claim(state, { day: '2026-07-16' }); // skipped the 15th
  assert.equal(r.ok, true);
  assert.equal(r.reward.streakDay, 1);
  assert.equal(r.reward.coins, ECONOMY.DAILY_BONUS[0]);
  assert.equal(r.state.daily.streak, 1);
});

// ------------------------------------------- day boundary via the fake clock

test('clock-pinned flow: claim → not claimable → next local day claimable again', () => {
  clock.configure({ now: dayMs('2026-07-16') });
  let state = { ...defaultState(), coins: 0 };

  assert.equal(isClaimable(state.daily), true); // defaults to localDay(now())
  const r = claim(state); // no explicit day — uses the pinned clock
  assert.equal(r.ok, true);
  assert.equal(r.state.daily.lastClaimDay, '2026-07-16');
  state = r.state;
  assert.equal(isClaimable(state.daily), false);
  assert.equal(claim(state).ok, false);

  // hop the pinned clock across local midnight → first open of the new day
  clock.configure({ now: dayMs('2026-07-17') });
  assert.equal(isClaimable(state.daily), true);
  const r2 = claim(state);
  assert.equal(r2.ok, true);
  assert.equal(r2.reward.streakDay, 2); // consecutive local days
  assert.equal(r2.reward.coins, ECONOMY.DAILY_BONUS[1]);
});
