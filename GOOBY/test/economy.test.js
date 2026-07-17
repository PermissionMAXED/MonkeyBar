// Economy (§C1.5/§C4.6/§C6 — agent G11): payout clamps for all 12 coin-table
// rows, ×2-once-per-local-day rollover (pinnable core/clock.js), quick-delivery
// markup rounding (ceil, float-safe), afford/spend atomicity, food purchases,
// the L8/400c quick-delivery unlock, and the §G G11 economy simulation
// (average day: daily claim + 12 min mixed games + feed to satiation must net
// ≥ +40c/day and afford full food needs by day 3 — §C numbers, untuned).
//
// V2/G16 (PLAN2 §B3/§C1.1): the 9 new coin rows join the TYPICAL payout
// checks; the seven additive v2 APIs (sellHarvest/buySeed/buyItem/useMedicine/
// payVet/buySkin/buyPlot) get unit coverage; profile.coinsEarned/coinsSpent
// lifetime totals; and a v2 average-day simulation adds quest rewards
// (≈ +75c/+37xp §C5.1) plus a radish+carrot garden cycle — the ≥ +40c/day and
// food-affordability bars must still hold (constants untuned by rule).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  award,
  spend,
  canAfford,
  awardMinigame,
  quickPrice,
  buyFood,
  canBuyQuickDelivery,
  buyQuickDelivery,
  // V2/G16 §B3 APIs
  sellHarvest,
  buySeed,
  buyItem,
  useMedicine,
  payVet,
  buySkin,
  buyPlot,
  seedKey,
  healthReady,
} from '../src/systems/economy.js';
import {
  ECONOMY, MINIGAME, COIN_TABLE, FOOD_TABLE, STATS, OFFLINE,
  CROP_TABLE, ITEM_PRICES, UNLOCKS, VET, LEVELING, // V2/G16
} from '../src/data/constants.js';
import { MINIGAME_IDS, getMinigame, computeCoins } from '../src/data/minigames.js';
import { FOODS } from '../src/data/foods.js';
import { xpToNext, applyXp } from '../src/systems/leveling.js';
import * as clock from '../src/core/clock.js';
import { defaultState } from '../src/core/save.js';
import { createStore } from '../src/core/store.js';

// V2/G16: settle the optional systems/health.js probe before tests run, so
// useMedicine/payVet behave deterministically (assertions below stay
// economy-owned either way — no health-engine internals are asserted).
await healthReady;

/** isolated store per test (autosave off — no timers keep node alive) */
const makeStore = () => createStore(defaultState(), { autosave: false });

/** Local-noon epoch ms for a YYYY-MM-DD day string (device-local, like localDay). */
function dayMs(day) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

/** Pin the game clock to local noon of a day (real-time rate). */
const pinDay = (day) => clock.configure({ now: dayMs(day) });

// ------------------------------------------------- award / spend / canAfford

test('award adds floored, non-negative coins and reports the grant', () => {
  const store = makeStore();
  assert.equal(store.get('coins'), ECONOMY.STARTING_COINS);
  assert.equal(award(store, 25, 'test'), 25);
  assert.equal(store.get('coins'), 125);
  assert.equal(award(store, 9.99), 9); // fractions floor AGAINST the player
  assert.equal(store.get('coins'), 134);
  assert.equal(award(store, -50), 0); // never negative
  assert.equal(award(store, NaN), 0);
  assert.equal(store.get('coins'), 134);
});

test('spend is atomic: all-or-nothing, never a partial or negative balance', () => {
  const store = makeStore();
  store.set('coins', 100);
  assert.equal(canAfford(store, 100), true);
  assert.equal(canAfford(store, 101), false);
  assert.equal(spend(store, 101), false);
  assert.equal(store.get('coins'), 100); // nothing deducted on failure
  assert.equal(spend(store, 100), true);
  assert.equal(store.get('coins'), 0);
  assert.equal(spend(store, 1), false);
  assert.equal(store.get('coins'), 0);
});

test('spend ceils fractional costs (rounding AGAINST the player)', () => {
  const store = makeStore();
  store.set('coins', 10);
  assert.equal(spend(store, 9.01), true);
  assert.equal(store.get('coins'), 0); // paid ceil(9.01) = 10
});

test('coinsChanged fires on award/spend after a flush (§E2 events)', () => {
  const store = makeStore();
  const seen = [];
  store.on('coinsChanged', (coins) => seen.push(coins));
  award(store, 10);
  store.flush();
  spend(store, 5);
  store.flush();
  assert.deepEqual(seen, [110, 105]);
});

// ---------------------- payout clamps (12 §C6 rows + V2/G16: 9 §C1.1 rows)

test('coin table has exactly the 21 §C6/§C1.1 rows', () => {
  assert.deepEqual([...MINIGAME_IDS].sort(), Object.keys(COIN_TABLE).sort());
  assert.equal(MINIGAME_IDS.length, 21); // V2/G16: 12 v1 + 9 §C1.1
});

for (const id of MINIGAME_IDS.filter((g) => !COIN_TABLE[g].special)) {
  test(`payout clamp §C6 row: ${id}`, () => {
    pinDay('2026-07-16');
    const { divisor, min, max } = COIN_TABLE[id];
    const store = makeStore();
    store.set(`minigames.lastPlayDay.${id}`, '2026-07-16'); // no daily ×2 here

    // score 0 → clamped up to min
    assert.equal(awardMinigame(store, id, 0).coins, min);
    // mid score → floor(score / divisor), un-clamped
    const midCoins = Math.floor((min + max) / 2);
    assert.equal(awardMinigame(store, id, midCoins * divisor + divisor - 1).coins, midCoins);
    // huge score → clamped down to max
    assert.equal(awardMinigame(store, id, 1_000_000).coins, max);
  });
}

test('payout clamp §C6 row: cityDrive (special — coinsOverride, §C4.3)', () => {
  pinDay('2026-07-16');
  assert.equal(COIN_TABLE.cityDrive.special, true);
  const store = makeStore();
  store.set('minigames.lastPlayDay.cityDrive', '2026-07-16');
  // §C4 reward math (G7) passes coins directly; economy floors + keeps them
  assert.equal(awardMinigame(store, 'cityDrive', 0, { coinsOverride: 22 }).coins, 22);
  assert.equal(awardMinigame(store, 'cityDrive', 0, { coinsOverride: 34.9 }).coins, 34);
  assert.equal(awardMinigame(store, 'cityDrive', 0, { coinsOverride: -5 }).coins, 0);
});

test('awardMinigame rejects unknown game ids', () => {
  const store = makeStore();
  assert.throws(() => awardMinigame(store, 'nope', 10), /unknown minigame/);
});

// --------------------------------------------- daily ×2 (once per local day)

test('first play per local day pays ×2, second pays ×1, next day ×2 again', () => {
  pinDay('2026-07-16');
  const store = makeStore();
  const base = computeCoins(COIN_TABLE.carrotCatch, 30, false); // floor(30/3) = 10

  const first = awardMinigame(store, 'carrotCatch', 30);
  assert.equal(first.firstToday, true);
  assert.equal(first.coins, base * MINIGAME.DAILY_FIRST_PLAY_MULT);
  assert.equal(store.get('minigames.lastPlayDay.carrotCatch'), '2026-07-16');

  const second = awardMinigame(store, 'carrotCatch', 30);
  assert.equal(second.firstToday, false);
  assert.equal(second.coins, base);

  pinDay('2026-07-17'); // local-day rollover
  const nextDay = awardMinigame(store, 'carrotCatch', 30);
  assert.equal(nextDay.firstToday, true);
  assert.equal(nextDay.coins, base * MINIGAME.DAILY_FIRST_PLAY_MULT);
});

test('the daily ×2 is tracked per game (playing A does not consume B)', () => {
  pinDay('2026-07-16');
  const store = makeStore();
  awardMinigame(store, 'carrotCatch', 30);
  const other = awardMinigame(store, 'bunnyHop', 30);
  assert.equal(other.firstToday, true);
});

test('awardMinigame side effects: +fun, plays/best, XP with level-up coins', () => {
  pinDay('2026-07-16');
  const store = makeStore();
  store.set('stats.fun', 95);
  store.set('xp', xpToNext(1) - 10); // 10 XP away from level 2

  const r = awardMinigame(store, 'runner', 300); // floor(300/15)=20 → ×2 = 40c
  assert.equal(r.coins, 40);
  assert.equal(r.xp, 10 + Math.min(15, Math.floor(40 / 2))); // §C1.5 → 25
  assert.equal(r.levelsGained, 1);
  assert.equal(r.coinsFromLevels, 25 * 2); // §C1.5: 25 × newLevel
  assert.equal(r.newBest, true);
  assert.equal(r.best, 300);

  assert.equal(store.get('stats.fun'), 100); // +15 clamped at 100
  assert.equal(store.get('minigames.plays.runner'), 1);
  assert.equal(store.get('minigames.best.runner'), 300);
  assert.equal(store.get('level'), 2);
  assert.equal(store.get('coins'), ECONOMY.STARTING_COINS + 40 + 50);

  const worse = awardMinigame(store, 'runner', 100);
  assert.equal(worse.newBest, false);
  assert.equal(worse.best, 300);
});

// ------------------------------------------ quick-delivery markup (ceil ×1.2)

test('quickPrice: +20% rounded UP, float-noise safe', () => {
  // 5 × 1.2 in floats is 6.000000000000001 — a naive ceil would charge 7
  assert.equal(quickPrice(5), 6);
  assert.equal(quickPrice(6), 8); // 7.2 → 8
  assert.equal(quickPrice(10), 12);
  assert.equal(quickPrice(12), 15); // 14.4 → 15
  assert.equal(quickPrice(14), 17); // 16.8 → 17
  assert.equal(quickPrice(16), 20); // 19.2 → 20
  assert.equal(quickPrice(18), 22); // 21.6 → 22
  assert.equal(quickPrice(25), 30);
  assert.equal(quickPrice(30), 36);
  assert.equal(quickPrice(40), 48);
  assert.equal(quickPrice(0), 0);
});

test('quickPrice matches exact-rational ceil for every §C5.1 food price', () => {
  for (const food of FOODS) {
    // ceil(p * 6/5) in integers — the float-free ground truth
    const expected = Math.ceil((food.price * 6) / 5);
    assert.equal(quickPrice(food.price), expected, food.id);
  }
});

// ----------------------------------------------------------------- buyFood

test('buyFood (shop trip): price × qty into the inventory, atomic', () => {
  const store = makeStore();
  store.set('coins', 60);
  assert.deepEqual(buyFood(store, 'burger', 2), { ok: true, total: 50 });
  assert.equal(store.get('coins'), 10);
  assert.equal(store.get('inventory.burger'), 2);

  // not enough coins → nothing changes
  assert.deepEqual(buyFood(store, 'burger', 1), { ok: false, reason: 'coins' });
  assert.equal(store.get('coins'), 10);
  assert.equal(store.get('inventory.burger'), 2);

  assert.deepEqual(buyFood(store, 'nope', 1), { ok: false, reason: 'unknown' });
  assert.deepEqual(buyFood(store, 'carrot', 0), { ok: false, reason: 'qty' });
});

test('buyFood quick order: gated on the unlock, pays the +20% markup', () => {
  const store = makeStore();
  store.set('coins', 500);
  assert.deepEqual(buyFood(store, 'burger', 1, { quick: true }), { ok: false, reason: 'locked' });
  store.set('quickDelivery', true);
  assert.deepEqual(buyFood(store, 'burger', 2, { quick: true }), { ok: true, total: 60 }); // 2 × 30
  assert.equal(store.get('coins'), 440);
  assert.equal(store.get('inventory.burger'), 2);
});

// ------------------------------------------------- quick-delivery unlock

test('quick-delivery unlock: 400c, level ≥ 8 gate, one-time (§C4.6)', () => {
  const store = makeStore();
  assert.equal(ECONOMY.QUICK_DELIVERY_PRICE, 400);
  assert.equal(ECONOMY.QUICK_DELIVERY_LEVEL, 8);

  store.set('coins', 1000);
  assert.deepEqual(canBuyQuickDelivery(store), { ok: false, reason: 'level' }); // level 1
  assert.deepEqual(buyQuickDelivery(store), { ok: false, reason: 'level' });
  assert.equal(store.get('coins'), 1000);

  store.set('level', 8);
  store.set('coins', 399);
  assert.deepEqual(canBuyQuickDelivery(store), { ok: false, reason: 'coins' });
  assert.deepEqual(buyQuickDelivery(store), { ok: false, reason: 'coins' });
  assert.equal(store.get('quickDelivery'), false);

  store.set('coins', 400);
  assert.deepEqual(buyQuickDelivery(store), { ok: true });
  assert.equal(store.get('coins'), 0);
  assert.equal(store.get('quickDelivery'), true);

  store.set('coins', 1000);
  assert.deepEqual(buyQuickDelivery(store), { ok: false, reason: 'owned' }); // one-time
  assert.equal(store.get('coins'), 1000);
});

// ----------------------------------------------- economy simulation (§G G11)
//
// Scripted "average day" over 3 days, using ONLY the real economy paths and
// the untuned §C constants:
//   • claims the daily bonus (+20..100c table §C8.2 — the claim itself lands
//     with G12's dailyBonus.js, so the coin grant is simulated directly),
//   • plays ~12 min of mixed minigames (10 different games/day, rotating the
//     mix; §C6 durations + countdown/results ≈ 70 s/round ≈ 11.7 min; 10 plays
//     × 8 energy = 80 keeps Gooby above the exhaustion cutoff §C1),
//     each at its §C6 "typical/avg round" score — first play per day pays ×2,
//   • feeds to satiation from an average mixed §C5.1 diet (hunger drain per
//     §C1 rates: ~45 min app-open awake + 8 h sleep + capped 0.3× offline).
// Requirements (§G G11, binding): net ≥ +40c/day; full food needs affordable
// by day 3 (no failed food purchase, day-3 income covers day-3 food cost).

/** §C6 "typical/avg round" → a score that computeCoins turns into that payout. */
const TYPICAL = {
  carrotCatch: { score: 45, coins: 15 },
  bunnyHop: { score: 24, coins: 12 },
  carrotGuard: { score: 45, coins: 15 },
  memoryMatch: { score: 28, coins: 14 },
  runner: { score: 240, coins: 16 },
  basketBounce: { score: 42, coins: 14 },
  pancakeTower: { score: 26, coins: 13 },
  danceParty: { score: 96, coins: 16 },
  fishingPond: { score: 45, coins: 15 },
  bubblePop: { score: 52, coins: 13 },
  trampoline: { score: 70, coins: 14 },
};

test('§C6 typical scores produce the table\'s typical payouts (un-doubled)', () => {
  for (const [id, { score, coins }] of Object.entries(TYPICAL)) {
    assert.equal(computeCoins(getMinigame(id).coinTable, score, false), coins, id);
  }
});

// V2/G16: §C1.1 "typical/avg round" column for the 9 new games — scores are
// the §C1.2 design targets, coins the §C1.1 typical payouts (deliveryRush is
// the premium row like cityDrive).
const TYPICAL_V2 = {
  goobySays: { score: 80, coins: 16 },
  gardenRush: { score: 42, coins: 14 },
  burgerBuild: { score: 60, coins: 15 },
  veggieChop: { score: 70, coins: 14 },
  deliveryRush: { score: 192, coins: 24 },
  miniGolf: { score: 80, coins: 16 },
  goalieGooby: { score: 45, coins: 15 },
  starHopper: { score: 140, coins: 15 },
  pipeFlow: { score: 75, coins: 15 },
};

test('V2/G16: §C1.1 typical scores produce the typical payouts (un-doubled)', () => {
  for (const [id, { score, coins }] of Object.entries(TYPICAL_V2)) {
    assert.equal(computeCoins(getMinigame(id).coinTable, score, false), coins, id);
  }
  // 10–15 c/min sanity on the premium row: ~24c over ~120 s ≈ 12 c/min
  assert.equal(COIN_TABLE.deliveryRush.max, 32);
});

test('economy simulation: average day nets ≥ +40c, food affordable by day 3', (t) => {
  const store = makeStore();
  const games = Object.keys(TYPICAL); // 11 regular games; 10 played per day

  // Average-day hunger drain per §C1 rates (per real minute):
  //   45 min app-open awake ......... 45 × 0.35   = 15.75
  //   8 h asleep .................... 480 × 0.175 = 84
  //   offline awake (capped 480 min)  480 × 0.35 × 0.3 = 50.4
  const drainPerDay =
    45 * -STATS.RATES_AWAKE.hunger +
    480 * -STATS.RATES_ASLEEP.hunger +
    OFFLINE.AWAKE_CAP_MIN * -STATS.RATES_AWAKE.hunger * OFFLINE.AWAKE_RATE_MULT;
  assert.ok(drainPerDay > 100 && drainPerDay < 200, `drain/day = ${drainPerDay}`);

  // Average mixed diet (§C5.1), fed in this order until hunger ≥ 95 (feeding
  // refuses at hunger ≥ 95 — §C3), repeating as needed.
  const menu = ['burger', 'pancakes', 'sandwich', 'salad', 'bread', 'carrot', 'apple'];

  let hunger = 80; // new-game default (§E3)
  const days = [];
  const dayIds = ['2026-07-16', '2026-07-17', '2026-07-18'];

  for (let d = 0; d < dayIds.length; d += 1) {
    pinDay(dayIds[d]);
    const startCoins = store.get('coins');

    // 1) daily bonus claim (§C8.2 streak table — coin grant simulated per the
    //    G12 guard; day d streak pays DAILY_BONUS[d])
    const daily = award(store, ECONOMY.DAILY_BONUS[Math.min(d, 6)], 'daily');

    // 2) ~12 min of mixed games: 10 of the 11 games, rotating the skip
    let gameCoins = 0;
    for (let i = 0; i < 10; i += 1) {
      const id = games[(d + i) % games.length];
      const r = awardMinigame(store, id, TYPICAL[id].score);
      assert.equal(r.firstToday, true, `${dayIds[d]} ${id} first play`);
      gameCoins += r.coins;
    }
    const levelUpCoins = store.get('coins') - startCoins - daily - gameCoins;

    // 3) feed to satiation (buy at shop-trip catalog prices, eat immediately)
    hunger -= drainPerDay;
    let foodCost = 0;
    let menuIdx = 0;
    while (hunger < 95) {
      const foodId = menu[menuIdx % menu.length];
      menuIdx += 1;
      const res = buyFood(store, foodId, 1);
      assert.equal(res.ok, true, `day ${d + 1}: food must stay affordable (${foodId})`);
      foodCost += res.total;
      hunger = Math.min(100, hunger + FOOD_TABLE[foodId].hunger);
      store.update((s) => {
        s.inventory[foodId] -= 1; // eaten right away
      });
    }

    const endCoins = store.get('coins');
    const net = endCoins - startCoins;
    days.push({
      day: d + 1,
      daily,
      gameCoins,
      levelUpCoins,
      foodCost,
      net,
      endCoins,
      level: store.get('level'),
    });

    // §G G11 requirement 1: every average day nets ≥ +40c
    assert.ok(net >= 40, `day ${d + 1} net ${net}c < +40c`);
  }

  for (const d of days) {
    t.diagnostic(
      `day ${d.day}: +${d.daily} daily +${d.gameCoins} games ` +
        `+${d.levelUpCoins} level-ups −${d.foodCost} food = net ${d.net >= 0 ? '+' : ''}${d.net}c ` +
        `(balance ${d.endCoins}c, level ${d.level})`
    );
  }

  // §G G11 requirement 2: full food needs affordable by day 3 — the day-3
  // income alone covers the day-3 food bill, and the closing balance holds a
  // comfortable buffer over another full day of food.
  const day3 = days[2];
  assert.ok(
    day3.daily + day3.gameCoins + day3.levelUpCoins >= day3.foodCost,
    `day 3 income ${day3.daily + day3.gameCoins + day3.levelUpCoins}c < food ${day3.foodCost}c`
  );
  assert.ok(day3.endCoins >= day3.foodCost, 'day-3 balance must cover a full day of food');

  // §C6 sanity line: daily food need ≈ 120–180c… the modeled average day
  // lands at or below that band (cheaper diets exist; never above).
  assert.ok(day3.foodCost <= 180, `food/day ${day3.foodCost}c above the §C6 band`);
});

// ============================================================================
// V2/G16 — §B3 economy APIs + profile totals + v2 average-day simulation
// ============================================================================

test('V2: profile.coinsEarned/coinsSpent track every award/spend/awardMinigame', () => {
  pinDay('2026-07-16');
  const store = makeStore();
  assert.equal(store.get('profile.coinsEarned'), 0);
  assert.equal(store.get('profile.coinsSpent'), 0);
  award(store, 30, 'test');
  spend(store, 12, 'test');
  assert.equal(store.get('profile.coinsEarned'), 30);
  assert.equal(store.get('profile.coinsSpent'), 12);
  const r = awardMinigame(store, 'carrotCatch', 30); // coins + level-up coins
  assert.equal(store.get('profile.coinsEarned'), 30 + r.coins + r.coinsFromLevels);
  spend(store, 9999999); // refused → untouched
  assert.equal(store.get('profile.coinsSpent'), 12);
});

test('V2: sellHarvest pays the §C2.3 sell price, atomic, counts sells', () => {
  const store = makeStore();
  store.set('coins', 0);
  store.update((s) => { s.inventory = { radish: 3 }; });
  assert.deepEqual(sellHarvest(store, 'radish', 2), { ok: true, total: 2 * CROP_TABLE.radish.sellPrice });
  assert.equal(store.get('coins'), 12);
  assert.equal(store.get('inventory.radish'), 1);
  assert.equal(store.get('achievements.counters.sells'), 2);
  // more than owned → nothing changes
  assert.deepEqual(sellHarvest(store, 'radish', 2), { ok: false, reason: 'none' });
  assert.equal(store.get('coins'), 12);
  assert.equal(store.get('inventory.radish'), 1);
  // only crop foods are sellable
  assert.deepEqual(sellHarvest(store, 'burger', 1), { ok: false, reason: 'unknown' });
  assert.deepEqual(sellHarvest(store, 'radish', 0), { ok: false, reason: 'qty' });
  // NOTE (V2-E8 balance flag, constants untuned by G16 rule): the binding
  // §C2.3 sell prices sit ABOVE the §C7 shop prices for radish (6 > 5),
  // tomato (9 > 7), corn (16 > 10), eggplant, pumpkin and watermelon — a
  // shop-buy → compost-sell flip profits. The seed→grow→sell loop is the
  // intended path; the V2-E8 auditor owns the ruling.
  for (const id of Object.keys(CROP_TABLE)) {
    assert.equal(typeof FOOD_TABLE[id].price, 'number', `${id} is shop-buyable (§C2.3)`);
  }
});

test('V2: buySeed is level-gated (§B6 crops), lands in items[seedKey]', () => {
  const store = makeStore();
  store.set('coins', 100);
  assert.deepEqual(buySeed(store, 'radish'), { ok: false, reason: 'level' }); // L1 < 3
  store.set('level', 3);
  assert.deepEqual(buySeed(store, 'radish', 2), { ok: true, total: 10 });
  assert.equal(store.get('coins'), 90);
  assert.equal(store.get(`items.${seedKey('radish')}`), 2);
  assert.deepEqual(buySeed(store, 'watermelon'), { ok: false, reason: 'level' }); // L12
  assert.deepEqual(buySeed(store, 'nope'), { ok: false, reason: 'unknown' });
  assert.deepEqual(buySeed(store, 'radish', 0), { ok: false, reason: 'qty' });
  store.set('coins', 4);
  assert.deepEqual(buySeed(store, 'radish'), { ok: false, reason: 'coins' });
  assert.equal(store.get(`items.${seedKey('radish')}`), 2); // unchanged
});

test('V2: buyItem sells medicine 40c / fertilizer 25c into the items slice', () => {
  const store = makeStore();
  store.set('coins', 65);
  assert.deepEqual(buyItem(store, 'medicine'), { ok: true, total: ITEM_PRICES.medicine });
  assert.deepEqual(buyItem(store, 'fertilizer'), { ok: true, total: ITEM_PRICES.fertilizer });
  assert.equal(store.get('coins'), 0);
  assert.equal(store.get('items.medicine'), 1);
  assert.equal(store.get('items.fertilizer'), 1);
  assert.deepEqual(buyItem(store, 'medicine'), { ok: false, reason: 'coins' });
  assert.deepEqual(buyItem(store, 'potion'), { ok: false, reason: 'unknown' });
  assert.deepEqual(buyItem(store, 'medicine', -1), { ok: false, reason: 'qty' });
});

test('V2: useMedicine consumes 1 only while unwell; refuses healthy/none', () => {
  const store = makeStore();
  // healthy → refused, nothing consumed
  store.update((s) => { s.items.medicine = 2; });
  assert.deepEqual(useMedicine(store), { ok: false, reason: 'healthy' });
  assert.equal(store.get('items.medicine'), 2);
  // queasy → dose lands: −1 medicine, medsGiven + cures counters bump
  store.set('health.state', 'queasy');
  assert.deepEqual(useMedicine(store), { ok: true });
  assert.equal(store.get('items.medicine'), 1);
  assert.equal(store.get('achievements.counters.medsGiven'), 1);
  assert.equal(store.get('achievements.counters.cures'), 1);
  // none left → refused
  store.update((s) => { s.items.medicine = 0; });
  store.set('health.state', 'sick');
  assert.deepEqual(useMedicine(store), { ok: false, reason: 'none' });
});

test('V2: payVet — cure 120c only while unwell (+10 stats), checkup 30c anytime', () => {
  const store = makeStore();
  store.set('coins', 200);
  assert.deepEqual(payVet(store, 'cure'), { ok: false, reason: 'healthy' });
  assert.deepEqual(payVet(store, 'groom'), { ok: false, reason: 'unknown' });
  store.set('health.state', 'sick');
  store.update((s) => { s.stats = { hunger: 50, energy: 95, hygiene: 10, fun: 40 }; });
  assert.deepEqual(payVet(store, 'cure'), { ok: true, total: VET.CURE_PRICE });
  assert.equal(store.get('coins'), 80);
  assert.deepEqual(store.get('stats'), { hunger: 60, energy: 100, hygiene: 20, fun: 50 }); // +10 clamped
  assert.equal(store.get('achievements.counters.cures'), 1);
  // checkup works while healthy too
  assert.deepEqual(payVet(store, 'checkup'), { ok: true, total: VET.CHECKUP_PRICE });
  assert.equal(store.get('coins'), 50);
  store.set('coins', 0);
  store.set('health.state', 'sick');
  assert.deepEqual(payVet(store, 'cure'), { ok: false, reason: 'coins' });
});

test('V2: buySkin — L5 gate, one-time, new skin goes straight on (§C8.5)', () => {
  const store = makeStore();
  store.set('coins', 2000);
  assert.deepEqual(buySkin(store, 'midnight'), { ok: false, reason: 'level' });
  store.set('level', UNLOCKS.SKINS);
  assert.deepEqual(buySkin(store, 'cream'), { ok: false, reason: 'owned' }); // default skin
  assert.deepEqual(buySkin(store, 'nope'), { ok: false, reason: 'unknown' });
  const r = buySkin(store, 'midnight');
  assert.equal(r.ok, true);
  assert.deepEqual(store.get('skins.owned'), ['cream', 'midnight']);
  assert.equal(store.get('skins.equipped'), 'midnight');
  assert.equal(store.get('coins'), 2000 - r.total);
  assert.deepEqual(buySkin(store, 'midnight'), { ok: false, reason: 'owned' });
  store.set('coins', 0);
  assert.deepEqual(buySkin(store, 'golden'), { ok: false, reason: 'coins' });
});

test('V2: buyPlot — §B6 gating: plot 5 at L10/300c, plot 6 at L16/600c, in order', () => {
  const store = makeStore();
  store.set('coins', 1000);
  assert.deepEqual(buyPlot(store, 3), { ok: false, reason: 'owned' }); // comes with the garden
  assert.deepEqual(buyPlot(store, 6), { ok: false, reason: 'unknown' });
  assert.deepEqual(buyPlot(store, 5), { ok: false, reason: 'order' }); // plot 5 first
  assert.deepEqual(buyPlot(store, 4), { ok: false, reason: 'level' }); // L1 < 10
  store.set('level', 10);
  assert.deepEqual(buyPlot(store, 4), { ok: true, total: 300 });
  assert.equal(store.get('garden.plotsOwned'), 5);
  assert.equal(store.get('coins'), 700);
  assert.deepEqual(buyPlot(store, 5), { ok: false, reason: 'level' }); // L10 < 16
  store.set('level', 16);
  store.set('coins', 599);
  assert.deepEqual(buyPlot(store, 5), { ok: false, reason: 'coins' });
  store.set('coins', 600);
  assert.deepEqual(buyPlot(store, 5), { ok: true, total: 600 });
  assert.equal(store.get('garden.plotsOwned'), 6);
  assert.deepEqual(buyPlot(store, 4), { ok: false, reason: 'owned' });
});

// ------------------------------------------- v2 average-day simulation (§B3)
//
// The v1 sim above stays untouched (regression). The v2 day models an
// established 2.0 player (level 12 — garden + most games unlocked): daily
// bonus, 10 mixed rounds drawn from all 20 regular games (§C6 + §C1.1),
// 3 claimed quests (≈ +75c/+37xp — the §C5.1 daily average; the quest engine
// itself is G18's, so the claim payout path is simulated via award/applyXp
// exactly like dailyBonus), one radish+carrot garden cycle through the REAL
// buySeed/sellHarvest paths (+§C5.2 harvest XP), and feeding to satiation.
// Bars (binding, constants untuned): net ≥ +40c/day, food affordable, and
// the §A3 disposable-income check — 7-day extrapolation ≥ 400c.

test('V2 economy simulation: quest + garden day still nets ≥ +40c', (t) => {
  const store = makeStore();
  store.set('level', 12);
  const games = [...Object.keys(TYPICAL), ...Object.keys(TYPICAL_V2)]; // 20 regular games
  const ALL_TYPICAL = { ...TYPICAL, ...TYPICAL_V2 };

  const drainPerDay =
    45 * -STATS.RATES_AWAKE.hunger +
    480 * -STATS.RATES_ASLEEP.hunger +
    OFFLINE.AWAKE_CAP_MIN * -STATS.RATES_AWAKE.hunger * OFFLINE.AWAKE_RATE_MULT;

  const menu = ['burger', 'pancakes', 'sandwich', 'salad', 'bread', 'carrot', 'apple'];
  let hunger = 80;
  const days = [];
  const dayIds = ['2026-08-01', '2026-08-02', '2026-08-03'];

  for (let d = 0; d < dayIds.length; d += 1) {
    pinDay(dayIds[d]);
    const startCoins = store.get('coins');

    // 1) daily bonus
    const daily = award(store, ECONOMY.DAILY_BONUS[Math.min(d, 6)], 'daily');

    // 2) 10 mixed rounds from the 20-game pool (all distinct → ×2 each)
    let gameCoins = 0;
    for (let i = 0; i < 10; i += 1) {
      const id = games[(d * 3 + i) % games.length];
      const r = awardMinigame(store, id, ALL_TYPICAL[id].score);
      assert.equal(r.firstToday, true, `${dayIds[d]} ${id} first play`);
      gameCoins += r.coins;
    }

    // 3) three claimed quests ≈ +75c/+37xp (§C5.1 daily average)
    const questCoins = award(store, 75, 'quests');
    store.update((s) => {
      const prog = applyXp({ xp: s.xp, level: s.level }, 37);
      s.xp = prog.xp; s.level = prog.level; s.coins += prog.coinsAwarded;
      s.profile.coinsEarned += prog.coinsAwarded;
    });

    // 4) one radish + carrot garden cycle through the real §B3 paths:
    //    buy seeds → (G18's growth engine simulated: yields land in the
    //    inventory per §C2.3) → sell the harvest at the compost bin, +2 XP
    //    per harvest (§C5.2).
    const seeds = buySeed(store, 'radish').total + buySeed(store, 'carrot').total;
    store.update((s) => {
      s.inventory.radish = (s.inventory.radish ?? 0) + CROP_TABLE.radish.yield;
      s.inventory.carrot = (s.inventory.carrot ?? 0) + CROP_TABLE.carrot.yield;
      const prog = applyXp({ xp: s.xp, level: s.level }, 2 * LEVELING.XP_HARVEST);
      s.xp = prog.xp; s.level = prog.level; s.coins += prog.coinsAwarded;
      s.profile.coinsEarned += prog.coinsAwarded;
    });
    const harvestCoins =
      sellHarvest(store, 'radish', CROP_TABLE.radish.yield).total +
      sellHarvest(store, 'carrot', CROP_TABLE.carrot.yield).total;

    // 5) feed to satiation
    hunger -= drainPerDay;
    let foodCost = 0;
    let menuIdx = 0;
    while (hunger < 95) {
      const foodId = menu[menuIdx % menu.length];
      menuIdx += 1;
      const res = buyFood(store, foodId, 1);
      assert.equal(res.ok, true, `v2 day ${d + 1}: food must stay affordable (${foodId})`);
      foodCost += res.total;
      hunger = Math.min(100, hunger + FOOD_TABLE[foodId].hunger);
      store.update((s) => { s.inventory[foodId] -= 1; });
    }

    const net = store.get('coins') - startCoins;
    days.push({
      day: d + 1, daily, gameCoins, questCoins,
      garden: harvestCoins - seeds, foodCost, net,
      endCoins: store.get('coins'), level: store.get('level'),
    });
    assert.ok(net >= 40, `v2 day ${d + 1} net ${net}c < +40c`);
  }

  for (const d of days) {
    t.diagnostic(
      `v2 day ${d.day}: +${d.daily} daily +${d.gameCoins} games +${d.questCoins} quests ` +
        `${d.garden >= 0 ? '+' : ''}${d.garden} garden −${d.foodCost} food = ` +
        `net +${d.net}c (balance ${d.endCoins}c, level ${d.level})`
    );
  }

  // §A3 quality bar: 7-day extrapolated disposable income ≥ 400c (one §C8
  // sink per week stays affordable).
  const avgNet = days.reduce((a, d) => a + d.net, 0) / days.length;
  assert.ok(avgNet * 7 >= 400, `7-day disposable ${Math.round(avgNet * 7)}c < 400c`);

  // profile lifetime totals moved with every one of the movements above
  assert.ok(store.get('profile.coinsEarned') > 0);
  assert.ok(store.get('profile.coinsSpent') > 0);
  assert.equal(
    store.get('profile.coinsEarned') - store.get('profile.coinsSpent'),
    store.get('coins') - ECONOMY.STARTING_COINS
  );
});
