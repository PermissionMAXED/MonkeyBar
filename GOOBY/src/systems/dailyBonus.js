// Daily bonus (§C8.2) — pure streak logic. First open per local day →
// claimable; streak day 1–7 rewards ECONOMY.DAILY_BONUS = [20,30,40,50,60,80,
// 100] coins; day ≥ 7 stays at 100 AND adds 1 random food item; missing a day
// resets the streak to 1. Claim is required (tap) — merely opening the popup
// never advances lastClaimDay. Pure module: no three.js/DOM imports (§B), all
// "today" reads go through core/clock.js localDay() (pinnable via ?now=).
//
// Save shape (§E3): daily = { lastClaimDay: 'YYYY-MM-DD'|'', streak: number }.
// notifyRules id 5 (24 h reminder) reads lastClaimDay — updated by claim().

import { ECONOMY } from '../data/constants.js';
import { FOODS } from '../data/foods.js';
import { localDay } from '../core/clock.js';

/**
 * The local calendar day before a 'YYYY-MM-DD' day string (handles month/year
 * boundaries via the Date rollover).
 * @param {string} dayStr 'YYYY-MM-DD'
 * @returns {string} 'YYYY-MM-DD' of the previous day ('' for malformed input)
 */
export function prevDay(dayStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayStr ?? '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1, 12);
  return localDay(d.getTime());
}

/**
 * First open per local day → claimable (§C8.2).
 * @param {{lastClaimDay?: string}} daily save slice
 * @param {string} [day] local day string, defaults to today (clock)
 * @returns {boolean}
 */
export function isClaimable(daily, day = localDay()) {
  return (daily?.lastClaimDay ?? '') !== day;
}

/**
 * Streak day the NEXT claim on `day` counts as: consecutive-day claims
 * increment, a missed day (or first ever claim) resets to 1 (§C8.2).
 * @param {{lastClaimDay?: string, streak?: number}} daily
 * @param {string} [day]
 * @returns {number} ≥ 1
 */
export function nextStreak(daily, day = localDay()) {
  const streak = Math.max(0, Math.floor(Number(daily?.streak) || 0));
  if (daily?.lastClaimDay && daily.lastClaimDay === prevDay(day)) return streak + 1;
  return 1;
}

/**
 * Reward for a given streak day (§C8.2): day 1–7 pay DAILY_BONUS[day-1];
 * day ≥ 7 stays at the day-7 value and adds 1 random food item.
 * @param {number} streakDay ≥ 1
 * @returns {{coins: number, includesFood: boolean}}
 */
export function rewardForStreak(streakDay) {
  const table = ECONOMY.DAILY_BONUS;
  const idx = Math.min(Math.max(1, Math.floor(streakDay)), table.length) - 1;
  return {
    coins: table[idx],
    includesFood: streakDay >= ECONOMY.DAILY_BONUS_FOOD_FROM_DAY,
  };
}

/**
 * Pick the random food item granted from streak day 7 on (§C8.2).
 * @param {() => number} [rng] 0..1 random source (injectable for tests)
 * @returns {string} food catalog id
 */
export function pickBonusFood(rng = Math.random) {
  const i = Math.min(FOODS.length - 1, Math.max(0, Math.floor(rng() * FOODS.length)));
  return FOODS[i].id;
}

/**
 * Claim today's bonus (§C8.2) — pure, never mutates the input state.
 * No-op ({ok:false}) when already claimed today.
 *
 * @param {object} state full save state (§E3: coins, inventory, daily)
 * @param {{day?: string, rng?: () => number}} [opts]
 * @returns {{ok: false} | {ok: true, state: object,
 *   reward: {streakDay: number, coins: number, foodId: string|null}}}
 */
export function claim(state, opts = {}) {
  const day = opts.day ?? localDay();
  if (!isClaimable(state.daily, day)) return { ok: false };
  const streakDay = nextStreak(state.daily, day);
  const { coins, includesFood } = rewardForStreak(streakDay);
  const foodId = includesFood ? pickBonusFood(opts.rng) : null;
  const inventory = { ...state.inventory };
  if (foodId) inventory[foodId] = Math.max(0, Math.floor(inventory[foodId] ?? 0)) + 1;
  return {
    ok: true,
    state: {
      ...state,
      coins: state.coins + coins,
      inventory,
      daily: { ...state.daily, lastClaimDay: day, streak: streakDay },
    },
    reward: { streakDay, coins, foodId },
  };
}
