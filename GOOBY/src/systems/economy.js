// Economy (§C1.5, §C4.6, §C5, §C6 — agent G11): the single money path.
// Coins only move through award/spend (atomic, store events via §E2);
// awardMinigame is the one minigame payout path (coins incl. daily ×2,
// fun, XP + level-up coins, plays/best/lastPlayDay bookkeeping) — the
// framework's onEnd calls it and renders the returned breakdown.
// Quick Delivery (§C4.6): quickPrice(base) = ceil(base * 1.2), one-time
// 400c unlock gated at level 8, food-only orders from home.
//
// Pure module (§B): no three.js/DOM imports — node:test runs it headlessly.
// The store is injected per call (first parameter) so tests can run many
// isolated stores; all numbers come from data/constants.js.

import { ECONOMY, MINIGAME } from '../data/constants.js';
import { getMinigame, computeCoins } from '../data/minigames.js';
import { getFood } from '../data/foods.js';
import { applyXp, minigameXp } from './leveling.js';
import { clampStat } from './stats.js';
import { add as invAdd } from './inventory.js';
import { localDay } from '../core/clock.js';

/**
 * @typedef {import('../core/store.js').createStore} _store
 * @typedef {ReturnType<_store>} Store
 */

/** Normalize a coin amount: integer ≥ 0 (fractions round AGAINST the player). */
const normAward = (n) => Math.max(0, Math.floor(Number(n) || 0));
const normCost = (n) => Math.max(0, Math.ceil(Number(n) || 0));

/**
 * Can the player pay `amount` coins right now?
 * @param {Store} store
 * @param {number} amount
 * @returns {boolean}
 */
export function canAfford(store, amount) {
  return (store.get('coins') ?? 0) >= normCost(amount);
}

/**
 * Grant coins (floored, never negative). Emits 'coinsChanged' via the store.
 * @param {Store} store
 * @param {number} amount
 * @param {string} [reason] payout source for logging ('minigame', 'daily', …)
 * @returns {number} coins actually granted
 */
export function award(store, amount, reason = '') {
  const n = normAward(amount);
  if (n === 0) return 0;
  store.update((state) => {
    state.coins += n;
  });
  if (reason) console.debug(`[economy] +${n}c (${reason})`);
  return n;
}

/**
 * Spend coins atomically: either the full amount is deducted or nothing
 * happens (returns false — never partial, never negative balances).
 * @param {Store} store
 * @param {number} amount
 * @param {string} [reason]
 * @returns {boolean} whether the payment went through
 */
export function spend(store, amount, reason = '') {
  const n = normCost(amount);
  if (!canAfford(store, n)) return false;
  store.update((state) => {
    state.coins -= n;
  });
  if (reason) console.debug(`[economy] -${n}c (${reason})`);
  return true;
}

/**
 * @typedef {Object} MinigameBreakdown  results-screen data (§E8)
 * @property {string} gameId
 * @property {number} score        final score
 * @property {number} coins        coins paid (after clamp + daily ×2)
 * @property {boolean} firstToday  daily ×2 applied (first play per local day)
 * @property {number} best         best score after this round
 * @property {boolean} newBest     this round set the best
 * @property {number} xp           XP granted (§C1.5 minigame formula)
 * @property {number} levelsGained
 * @property {number} coinsFromLevels level-up rewards paid on top (§C1.5)
 */

/**
 * THE minigame payout path (§C6 shared rules + §C1.5): pays
 * computeCoins(coinTable, score) with the ×2 first-play-per-local-day
 * multiplier (per-game `minigames.lastPlayDay` in the save, localDay from
 * core/clock.js), +15 fun, minigame XP (10 + min(15, floor(coins/2))) with
 * level-up coin rewards, and updates plays/best counters — in one atomic
 * store.update. Returns the breakdown for the results screen.
 * @param {Store} store
 * @param {string} id minigame id
 * @param {number} score
 * @param {{coinsOverride?: number}} [opts] cityDrive passes §C4.3 coins directly
 * @returns {MinigameBreakdown}
 */
export function awardMinigame(store, id, score, opts = {}) {
  const meta = getMinigame(id);
  if (!meta) throw new Error(`[economy] unknown minigame '${id}'`);
  const s = Math.max(0, Math.floor(Number(score) || 0));
  const today = localDay();
  const firstToday = store.get(`minigames.lastPlayDay.${id}`) !== today;
  const coins = computeCoins(meta.coinTable, s, firstToday, opts.coinsOverride);
  const prevBest = store.get(`minigames.best.${id}`) ?? 0;
  const newBest = s > prevBest;
  const xp = minigameXp(coins);
  let progress;
  store.update((state) => {
    state.coins += coins;
    state.stats.fun = clampStat(state.stats.fun + MINIGAME.FUN_REWARD);
    state.minigames.plays[id] = (state.minigames.plays[id] ?? 0) + 1;
    state.minigames.lastPlayDay[id] = today;
    if (newBest) state.minigames.best[id] = s;
    progress = applyXp({ xp: state.xp, level: state.level }, xp);
    state.xp = progress.xp;
    state.level = progress.level;
    state.coins += progress.coinsAwarded;
  });
  return {
    gameId: id,
    score: s,
    coins,
    firstToday,
    best: Math.max(prevBest, s),
    newBest,
    xp,
    levelsGained: progress.levelsGained,
    coinsFromLevels: progress.coinsAwarded,
  };
}

/**
 * Quick-delivery price (§C4.6): +20% markup, rounded UP. Integer-cent math so
 * float noise never flips the ceil (5 × 1.2 must be 6, not 7).
 * @param {number} base catalog price in coins
 * @returns {number}
 */
export function quickPrice(base) {
  const cents = Math.round(Math.max(0, base) * 100 * (1 + ECONOMY.QUICK_DELIVERY_MARKUP));
  return Math.ceil(cents / 100);
}

/**
 * Buy food into the inventory (§C5.1). At the shop (trip) the catalog price
 * applies; a quick-delivery order from home (§C4.6) pays quickPrice(base).
 * Atomic: on insufficient coins nothing changes.
 * @param {Store} store
 * @param {string} foodId
 * @param {number} [qty]
 * @param {{quick?: boolean}} [opts] quick: order from home (+20% markup)
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'|'coins'|'locked', total?: number}}
 */
export function buyFood(store, foodId, qty = 1, opts = {}) {
  const food = getFood(foodId);
  if (!food) return { ok: false, reason: 'unknown' };
  const n = Math.floor(Number(qty) || 0);
  if (n < 1) return { ok: false, reason: 'qty' };
  if (opts.quick && !store.get('quickDelivery')) return { ok: false, reason: 'locked' };
  const unit = opts.quick ? quickPrice(food.price) : food.price;
  const total = unit * n;
  if (!spend(store, total, opts.quick ? 'order' : 'shop')) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.inventory = invAdd(state.inventory, foodId, n);
  });
  return { ok: true, total };
}

/**
 * Is the one-time Quick Delivery unlock (§C4.6) purchasable right now?
 * @param {Store} store
 * @returns {{ok: boolean, reason?: 'owned'|'level'|'coins'}}
 */
export function canBuyQuickDelivery(store) {
  if (store.get('quickDelivery')) return { ok: false, reason: 'owned' };
  if ((store.get('level') ?? 1) < ECONOMY.QUICK_DELIVERY_LEVEL) return { ok: false, reason: 'level' };
  if (!canAfford(store, ECONOMY.QUICK_DELIVERY_PRICE)) return { ok: false, reason: 'coins' };
  return { ok: true };
}

/**
 * One-time Quick Delivery purchase (§C4.6): 400c, level ≥ 8, sets
 * `quickDelivery: true`. Atomic.
 * @param {Store} store
 * @returns {{ok: boolean, reason?: 'owned'|'level'|'coins'}}
 */
export function buyQuickDelivery(store) {
  const check = canBuyQuickDelivery(store);
  if (!check.ok) return check;
  if (!spend(store, ECONOMY.QUICK_DELIVERY_PRICE, 'quickDelivery')) {
    return { ok: false, reason: 'coins' };
  }
  store.update((state) => {
    state.quickDelivery = true;
  });
  return { ok: true };
}
