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
//
// V2/G16 (PLAN2 §B3, all additive): every award/spend also increments
// profile.coinsEarned/coinsSpent; new APIs sellHarvest / buySeed / buyItem /
// useMedicine / payVet / buySkin / buyPlot (garden §C2, care §C3.5, vet
// §C9.2, skins §C8.5, plots §B6). ALL coin movement still flows exclusively
// through this module.
//
// V2/FIX-A (E8 arbitrage, coordinator ruling): the §C2.3 sell prices and §C7
// shop prices are BINDING and 6 of 8 crops sell above their shop price, so
// compost sales are gated on HARVEST PROVENANCE instead of price changes —
// recordHarvest credits items['harvested:<foodId>'] at the harvest site, and
// sellHarvest only sells min(inventory, harvestedCount) (sellableHarvest).
// Shop-bought crop foods are never compost-sellable.

import { ECONOMY, MINIGAME, ITEM_PRICES, UNLOCKS, VET } from '../data/constants.js'; // V2/G16: + v2 tables
import { getMinigame, computeCoins } from '../data/minigames.js';
import { getFood } from '../data/foods.js';
import { getCrop } from '../data/crops.js'; // V2/G16 (§C2.3)
import { getSkin } from '../data/skins.js'; // V2/G16 (§C8.5)
import { applyXp, minigameXp } from './leveling.js';
import { clampStat } from './stats.js';
import { add as invAdd, remove as invRemove } from './inventory.js'; // V2/G16: + remove; V2/FIX-A: has-gate moved into sellableHarvest
import { localDay, now } from '../core/clock.js'; // V2/G16: + now (health calls)

/**
 * @typedef {import('../core/store.js').createStore} _store
 * @typedef {ReturnType<_store>} Store
 */

/** Normalize a coin amount: integer ≥ 0 (fractions round AGAINST the player). */
const normAward = (n) => Math.max(0, Math.floor(Number(n) || 0));
const normCost = (n) => Math.max(0, Math.ceil(Number(n) || 0));

// --- V2/G16: optional health engine (PLAN2 §B3/§C3.5) -----------------------
// systems/health.js is G17's pure state machine (same wave). Economy only
// consumes it when the module exists at runtime — lazy dynamic import, so
// neither node:test nor the bundler hard-require it. // V2/G20 wires fully
// (tick/notification/UI effects); until then useMedicine/payVet already apply
// the §C3.5 health-slice effects through these pure calls when available.
let healthApi = null;
/** Resolves once the optional health module has been probed (tests await it). */
export const healthReady = import('./health.js').then(
  (mod) => { healthApi = mod; },
  () => { healthApi = null; }
);

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
    state.profile.coinsEarned += n; // V2/G16: lifetime total (§B2/§C12.1)
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
    state.profile.coinsSpent += n; // V2/G16: lifetime total (§B2/§C12.1)
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
    state.profile.coinsEarned += coins + progress.coinsAwarded; // V2/G16 (§B2)
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

// ============================================================================
// V2/G16: 2.0 economy APIs (PLAN2 §B3 — all additive; every one mirrors the
// v1 buyFood contract: pure store-in, {ok:boolean, reason?, total?} out,
// atomic, coins only ever move through award/spend above).
// ============================================================================

/**
 * V2/G16: canonical items-map key for seeds ('seed:<cropId>' — colon-flat like
 * furniture.placed's 'room:slot' keys, because store.get() paths split on
 * dots). Seeds live in the `items` slice (§B2: non-food consumables, NOT in
 * `inventory` — the fridge tray lists every inventory key as food).
 * @param {string} cropId
 * @returns {string}
 */
export const seedKey = (cropId) => `seed:${cropId}`;

/**
 * V2/FIX-A (E8 arbitrage): items-map key for the harvest-provenance counter
 * ('harvested:<foodId>' — colon-flat like seedKey). The counter tracks how
 * many units of a crop food were actually HARVESTED (vs shop-bought); only
 * those units are compost-sellable. Missing keys read as 0, so existing v2
 * saves need no migration (pre-fix stock simply becomes unsellable).
 * @param {string} foodId
 * @returns {string}
 */
export const harvestedKey = (foodId) => `harvested:${foodId}`;

/**
 * V2/FIX-A (E8 arbitrage): record a real garden harvest so the yield becomes
 * compost-sellable. The harvest site (home/gardenInteractions.js) calls this
 * right where the yield lands in the inventory; the counter lives in
 * `items[harvestedKey(foodId)]` and is decremented by sellHarvest.
 * CONTRACT for the harvest wiring: call ONCE per harvest with the crop's
 * yielded qty (`res.qty`), in addition to (not instead of) the inventory add.
 * @param {Store} store
 * @param {string} foodId crop-food id ('radish', …) — must be a catalog crop
 * @param {number} qty units harvested (≥ 1)
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'}}
 */
export function recordHarvest(store, foodId, qty) {
  if (!getCrop(foodId)) return { ok: false, reason: 'unknown' };
  const n = Math.floor(Number(qty) || 0);
  if (n < 1) return { ok: false, reason: 'qty' };
  store.update((state) => {
    const key = harvestedKey(foodId);
    state.items[key] = Math.max(0, Math.floor(Number(state.items[key]) || 0)) + n;
  });
  return { ok: true };
}

/**
 * V2/FIX-A (E8 arbitrage): how many units of a crop food are sellable at the
 * compost bin RIGHT NOW = min(inventory count, harvested-provenance counter).
 * Shop-bought units (and pre-fix stock, incl. the §C5.1 starter carrots)
 * count 0. The sell sheet (ui/gardenPanel.js) must read THIS, not the raw
 * inventory count.
 * @param {object} state save state (§E3) — or any {inventory, items} shape
 * @param {string} foodId crop-food id
 * @returns {number}
 */
export function sellableHarvest(state, foodId) {
  const inv = Math.max(0, Math.floor(Number(state?.inventory?.[foodId]) || 0));
  const harvested = Math.max(0, Math.floor(Number(state?.items?.[harvestedKey(foodId)]) || 0));
  return Math.min(inv, harvested);
}

/**
 * Sell harvested crop food from the inventory at the §C2.3 sell price
 * (compost-bin sell sheet, §C2.2). Only crop foods are sellable (crop id ==
 * food id) — and only units that were actually HARVESTED (V2/FIX-A, E8):
 * several §C2.3 sell prices sit above the §C7 shop prices, so shop-bought
 * stock must never be compost-sellable (the provenance counter in
 * items[harvestedKey(foodId)] caps the sale; see recordHarvest). The
 * requested qty is capped at sellableHarvest(state, foodId); with nothing
 * sellable the call refuses ({ok:false, reason:'none'}). Bumps
 * `achievements.counters.sells` by the qty actually sold (quest event 'sell'
 * — G23 wires).
 * @param {Store} store
 * @param {string} foodId crop-food id ('radish', …)
 * @param {number} [qty]
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'|'none', total?: number,
 *   qty?: number}} qty = units actually sold (≤ requested)
 */
export function sellHarvest(store, foodId, qty = 1) {
  const crop = getCrop(foodId);
  if (!crop) return { ok: false, reason: 'unknown' };
  const requested = Math.floor(Number(qty) || 0);
  if (requested < 1) return { ok: false, reason: 'qty' };
  const n = Math.min(requested, sellableHarvest(store.get(), foodId));
  if (n < 1) return { ok: false, reason: 'none' };
  store.update((state) => {
    state.inventory = invRemove(state.inventory, foodId, n);
    const key = harvestedKey(foodId);
    state.items[key] = Math.max(0, Math.floor(Number(state.items[key]) || 0) - n);
    state.achievements.counters.sells += n;
  });
  const total = award(store, crop.sellPrice * n, 'sellHarvest');
  return { ok: true, total, qty: n };
}

/**
 * Buy crop seeds (§C2.3 seed prices; seed-picker buy row §C2.2). Seeds land
 * in `items[seedKey(cropId)]`; planting consumes one from there (G19 wires —
 * systems/garden.js stays slice-pure). Level-gated per UNLOCKS.CROPS.
 * @param {Store} store
 * @param {string} cropId
 * @param {number} [qty]
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'|'level'|'coins', total?: number}}
 */
export function buySeed(store, cropId, qty = 1) {
  const crop = getCrop(cropId);
  if (!crop) return { ok: false, reason: 'unknown' };
  const n = Math.floor(Number(qty) || 0);
  if (n < 1) return { ok: false, reason: 'qty' };
  if ((store.get('level') ?? 1) < crop.unlock) return { ok: false, reason: 'level' };
  const total = crop.seedPrice * n;
  if (!spend(store, total, 'seed')) return { ok: false, reason: 'coins' };
  store.update((state) => {
    const key = seedKey(cropId);
    state.items[key] = (state.items[key] ?? 0) + n;
  });
  return { ok: true, total };
}

/**
 * Buy a non-food consumable (§C3.5 medicine 40c / §C2.2 fertilizer 25c —
 * the shop Care row; quick-delivery eligible per §C3.5 is a UI concern, the
 * price here is always the catalog price). Lands in the `items` slice.
 * @param {Store} store
 * @param {'medicine'|'fertilizer'} itemId
 * @param {number} [qty]
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'|'coins', total?: number}}
 */
export function buyItem(store, itemId, qty = 1) {
  const price = ITEM_PRICES[itemId];
  if (price == null) return { ok: false, reason: 'unknown' };
  const n = Math.floor(Number(qty) || 0);
  if (n < 1) return { ok: false, reason: 'qty' };
  const total = price * n;
  if (!spend(store, total, itemId)) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.items[itemId] = (state.items[itemId] ?? 0) + n;
  });
  return { ok: true, total };
}

/**
 * Use one medicine (§C3.5): sick → queasy, queasy → healthy; refuses while
 * healthy (nothing consumed). Health-slice transition goes through
 * systems/health.js when present (see healthReady above; the healthy check
 * reads the save slice directly, so the gate holds either way). Bumps
 * `medsGiven`, plus `cures` when the dose lands (§C5.3 firstCure).
 * @param {Store} store
 * @returns {{ok: boolean, reason?: 'none'|'healthy'}}
 */
export function useMedicine(store) {
  if ((store.get('items.medicine') ?? 0) < 1) return { ok: false, reason: 'none' };
  if (store.get('health.state') === 'healthy') return { ok: false, reason: 'healthy' };
  const cured = healthApi ? healthApi.useMedicine(store.get('health'), now()).h : null;
  store.update((state) => {
    state.items.medicine -= 1;
    if (cured) state.health = cured;
    state.achievements.counters.medsGiven += 1;
    state.achievements.counters.cures += 1;
  });
  return { ok: true };
}

/**
 * Pay the vet (§C3.5/§C9.2). 'cure' — 120c, only while queasy/sick: full cure
 * (junk/neglect reset via health.vetCure when the module is present) plus
 * +10 all stats (clamped); bumps `cures`. 'checkup' — 30c anytime: resets
 * neglectMin (health.vetCheckup). The `vetTrips`/`trips` counters belong to
 * the trip arrival flow (§C9.2 — G21 wires), NOT to the payment.
 * @param {Store} store
 * @param {'cure'|'checkup'} kind
 * @returns {{ok: boolean, reason?: 'unknown'|'healthy'|'coins', total?: number}}
 */
export function payVet(store, kind) {
  if (kind !== 'cure' && kind !== 'checkup') return { ok: false, reason: 'unknown' };
  if (kind === 'cure' && store.get('health.state') === 'healthy') {
    return { ok: false, reason: 'healthy' };
  }
  const price = kind === 'cure' ? VET.CURE_PRICE : VET.CHECKUP_PRICE;
  if (!spend(store, price, `vet:${kind}`)) return { ok: false, reason: 'coins' };
  store.update((state) => {
    if (kind === 'cure') {
      if (healthApi) state.health = healthApi.vetCure(state.health, now());
      for (const k of Object.keys(state.stats)) {
        state.stats[k] = clampStat(state.stats[k] + VET.CURE_STAT_BONUS);
      }
      state.achievements.counters.cures += 1;
    } else if (healthApi) {
      state.health = healthApi.vetCheckup(state.health);
    }
  });
  return { ok: true, total: price };
}

/**
 * Buy a fur-color skin (§C8.5; shop Skins tab from UNLOCKS.SKINS = L5).
 * New skins go straight on (same ruling as v1 outfit purchases).
 * @param {Store} store
 * @param {string} id skin id
 * @returns {{ok: boolean, reason?: 'unknown'|'owned'|'level'|'coins', total?: number}}
 */
export function buySkin(store, id) {
  const skin = getSkin(id);
  if (!skin) return { ok: false, reason: 'unknown' };
  if ((store.get('skins.owned') ?? []).includes(id)) return { ok: false, reason: 'owned' };
  if ((store.get('level') ?? 1) < UNLOCKS.SKINS) return { ok: false, reason: 'level' };
  if (!spend(store, skin.price, 'skin')) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.skins.owned.push(id);
    state.skins.equipped = id;
  });
  return { ok: true, total: skin.price };
}

/**
 * Buy a garden plot (§B6: index 4 at L10/300c, index 5 at L16/600c; plots
 * unlock strictly in order). Success bumps `garden.plotsOwned` to index + 1.
 * @param {Store} store
 * @param {number} index 0-based plot index (only 4 and 5 are purchasable)
 * @returns {{ok: boolean, reason?: 'unknown'|'owned'|'order'|'level'|'coins', total?: number}}
 */
export function buyPlot(store, index) {
  const idx = Math.floor(Number(index));
  const owned = store.get('garden.plotsOwned') ?? 4;
  if (idx >= 0 && idx < owned) return { ok: false, reason: 'owned' };
  const def = UNLOCKS.GARDEN_PLOTS[idx];
  if (!def) return { ok: false, reason: 'unknown' };
  if (idx > owned) return { ok: false, reason: 'order' }; // plot 5 before 6
  if ((store.get('level') ?? 1) < def.level) return { ok: false, reason: 'level' };
  if (!spend(store, def.price, 'plot')) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.garden.plotsOwned = idx + 1;
  });
  return { ok: true, total: def.price };
}
