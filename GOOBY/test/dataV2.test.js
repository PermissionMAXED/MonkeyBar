// V2/G16 — 2.0 catalog integrity (PLAN2 §A3/§B6/§C1.1/§C2.3/§C5.1/§C5.3/§C6/
// §C7/§C8.5, all binding). Spec tables are hardcoded here as independent
// copies so a constants.js edit can never silently drift; EN/DE parity is
// asserted for every v2 string key a catalog references plus the 11 §E0.1-1
// string modules themselves.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COIN_TABLE, CROP_TABLE, QUEST_POOL as QUEST_TABLE, SKIN_TABLE,
  UNLOCKS, NOTIFY, FOOD_TABLE, ITEM_PRICES, VET, PHOTO, LEVELING, ECONOMY,
  DAYNIGHT, WEATHER,
} from '../src/data/constants.js';
import { CROPS, CROPS_BY_ID, getCrop } from '../src/data/crops.js';
import { QUEST_POOL, getQuest } from '../src/data/quests.js';
import { COLLECTION_SETS, TOTAL_STICKERS, getCollectionSet } from '../src/data/collections.js';
import { SKINS, DEFAULT_SKIN, getSkin } from '../src/data/skins.js';
import { FOODS, getFood } from '../src/data/foods.js';
import { MINIGAME_IDS } from '../src/data/minigames.js';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID } from '../src/data/achievements.js';
import { EN, DE } from '../src/data/strings.js';

/** Both dictionaries must carry a non-empty string for the key. */
function assertKey(key, label = key) {
  assert.equal(typeof EN[key], 'string', `EN missing ${label}`);
  assert.ok(EN[key].length > 0, `EN empty ${label}`);
  assert.equal(typeof DE[key], 'string', `DE missing ${label}`);
  assert.ok(DE[key].length > 0, `DE empty ${label}`);
}

// ------------------------------------------------------ headline counts (§A3)

test('headline catalog counts: 32 foods / 8 crops / 28 quests / 4×32 stickers / 7 skins / 37 achievements / 27 games', () => {
  // V3/G35: +1 nutella (§C6.1 — appended in foods.js; constants.js FOOD_TABLE
  // stays frozen at the 32 v2 rows per the §E0.1-3 ruling)
  assert.equal(FOODS.length, 33);
  assert.equal(Object.keys(FOOD_TABLE).length, 32);
  assert.equal(CROPS.length, 8);
  assert.equal(QUEST_POOL.length, 28);
  assert.equal(COLLECTION_SETS.length, 4);
  assert.equal(TOTAL_STICKERS, 32);
  assert.deepEqual(COLLECTION_SETS.map((s) => s.entries.length), [8, 8, 6, 10]);
  assert.equal(SKINS.length, 7);
  // V3/G34: 33 → 37 achievements (§C5.5/§C6.4), 21 → 27 games (§E0.1-9) —
  // the 3.0 rows themselves are asserted verbatim in dataV3.test.js.
  assert.equal(ACHIEVEMENTS.length, 37);
  assert.equal(MINIGAME_IDS.length, 27);
});

// ---------------------------------------------------- §C1.1 coin rows verbatim

test('the 9 new §C1.1 coin rows are verbatim', () => {
  const SPEC = {
    goobySays: { divisor: 5, min: 4, max: 24 },
    gardenRush: { divisor: 3, min: 4, max: 25 },
    burgerBuild: { divisor: 4, min: 4, max: 26 },
    veggieChop: { divisor: 5, min: 4, max: 26 },
    deliveryRush: { divisor: 8, min: 5, max: 32 },
    miniGolf: { divisor: 5, min: 4, max: 28 },
    goalieGooby: { divisor: 3, min: 4, max: 26 },
    starHopper: { divisor: 9, min: 4, max: 26 },
    pipeFlow: { divisor: 5, min: 4, max: 25 },
  };
  for (const [id, row] of Object.entries(SPEC)) {
    assert.deepEqual({ ...COIN_TABLE[id] }, row, `coin row ${id}`);
  }
});

// ---------------------------------------------------- §C2.3 crop table verbatim

// [seedPrice, growthMin, waterings, wateredWindowMin, yield, sellPrice, unlock,
//  eatenHunger, eatenFun] — §C2.3 columns incl. the FOOD_TABLE-backed "eaten".
const CROP_SPEC = {
  radish: [5, 10, 1, 10, 2, 6, 3, 8, 1],
  carrot: [8, 20, 1, 20, 3, 5, 3, 10, 2],
  salad: [12, 30, 2, 15, 2, 10, 3, 20, 0],
  tomato: [15, 45, 2, 22.5, 3, 9, 4, 12, 1],
  corn: [20, 90, 2, 45, 2, 16, 6, 15, 2],
  eggplant: [25, 150, 3, 50, 2, 20, 8, 16, 1],
  pumpkin: [35, 360, 3, 120, 1, 55, 10, 26, 4],
  watermelon: [45, 480, 4, 120, 1, 70, 12, 14, 4],
};

test('CROP_TABLE + data/crops.js match §C2.3 verbatim (crop id == food id)', () => {
  assert.deepEqual(Object.keys(CROP_TABLE), Object.keys(CROP_SPEC));
  for (const [id, [seedPrice, growthMin, waterings, windowMin, yld, sellPrice, unlock, hunger, fun]] of Object.entries(CROP_SPEC)) {
    assert.deepEqual(
      { ...CROP_TABLE[id] },
      { seedPrice, growthMin, waterings, wateredWindowMin: windowMin, yield: yld, sellPrice, unlock },
      `CROP_TABLE.${id}`
    );
    const crop = CROPS_BY_ID[id];
    assert.equal(crop.foodId, id, `${id} harvest lands as its food id`);
    assert.equal(crop.unlock, unlock, `${id} unlock (§B6 mirror)`);
    assert.ok(crop.stageModels.length >= 2, `${id} has sprout + ready stage models`);
    // eaten column lives in FOOD_TABLE (§C7 — crop foods are shop-buyable too)
    assert.equal(FOOD_TABLE[id].hunger, hunger, `${id} eaten hunger`);
    assert.equal(FOOD_TABLE[id].fun, fun, `${id} eaten fun`);
    assertKey(crop.nameKey);
  }
  assert.equal(getCrop('nope'), undefined);
});

// ---------------------------------------------------- §C5.1 quest pool verbatim

// id → [category, event, target, coins, xp, requires]
const QUEST_SPEC = {
  'q.feed3': ['care', 'feed', 3, 20, 10, null],
  'q.feedHealthy2': ['care', 'feedHealthy', 2, 25, 10, null],
  'q.wash1': ['care', 'wash', 1, 20, 10, null],
  'q.pet5': ['care', 'pet', 5, 15, 8, null],
  'q.tickle3': ['care', 'tickle', 3, 15, 8, null],
  'q.ball3': ['care', 'ball', 3, 20, 10, null],
  'q.sleep1': ['care', 'sleep', 1, 25, 12, null],
  'q.medicineCabinet': ['care', 'statsScreen', 1, 10, 5, null],
  'q.play3': ['games', 'gameFinish', 3, 30, 15, null],
  'q.play2distinct': ['games', 'gameDistinct', 2, 25, 12, null],
  'q.earn60': ['games', 'gameCoins', 60, 30, 15, null],
  'q.catch30': ['games', 'score:carrotCatch', 30, 25, 12, null],
  'q.hop10': ['games', 'score:bunnyHop', 10, 25, 12, null],
  'q.run200': ['games', 'score:runner', 200, 30, 15, { minigame: 'runner' }],
  'q.fish5': ['games', 'fishCaught', 5, 25, 12, { minigame: 'fishingPond' }],
  'q.dance150': ['games', 'score:danceParty', 150, 30, 15, { minigame: 'danceParty' }],
  'q.tricks5': ['games', 'tricks:trampoline', 5, 25, 12, { minigame: 'trampoline' }],
  'q.golfPar': ['games', 'score:miniGolf', 70, 30, 15, { minigame: 'miniGolf' }],
  'q.says6': ['games', 'round:goobySays', 6, 25, 12, { minigame: 'goobySays' }],
  'q.plant2': ['garden', 'plant', 2, 20, 10, { garden: true }],
  'q.water4': ['garden', 'water', 4, 20, 10, { garden: true }],
  'q.harvest2': ['garden', 'harvest', 2, 30, 15, { garden: true }],
  'q.sell1': ['garden', 'sell', 1, 15, 8, { garden: true }],
  'q.drive1': ['economy', 'shopTrip', 1, 30, 15, null],
  'q.cleanDrive': ['economy', 'cleanDrive', 1, 35, 15, null],
  'q.deliver3': ['economy', 'deliver', 3, 30, 15, { minigame: 'deliveryRush' }],
  'q.buyFood1': ['economy', 'buyFood', 1, 15, 8, null],
  'q.photo1': ['economy', 'photo', 1, 20, 10, null],
};

test('QUEST_POOL matches §C5.1 verbatim (28 entries, table order, titles EN+DE)', () => {
  assert.deepEqual(QUEST_TABLE.map((q) => q.id), Object.keys(QUEST_SPEC));
  for (const q of QUEST_POOL) {
    const [category, event, target, coins, xp, requires] = QUEST_SPEC[q.id];
    assert.equal(q.category, category, `${q.id} category`);
    assert.equal(q.event, event, `${q.id} event`);
    assert.equal(q.target, target, `${q.id} target`);
    assert.equal(q.coins, coins, `${q.id} coins`);
    assert.equal(q.xp, xp, `${q.id} xp`);
    assert.deepEqual(q.requires == null ? null : { ...q.requires }, requires, `${q.id} requires`);
    assertKey(q.titleKey);
    assertKey(q.descKey);
  }
  assert.equal(getQuest('q.feed3').coins, 20);
  assert.equal(getQuest('nope'), undefined);
  // all four categories present (the §B7 roll needs ≥ 2 distinct ones)
  assert.deepEqual(
    [...new Set(QUEST_POOL.map((q) => q.category))].sort(),
    ['care', 'economy', 'games', 'garden']
  );
  // §C5.1 sizing: an average 3-quest day ≈ +75c/+37xp
  const avg = (sel) => QUEST_POOL.reduce((a, q) => a + sel(q), 0) / QUEST_POOL.length;
  const dayCoins = 3 * avg((q) => q.coins);
  const dayXp = 3 * avg((q) => q.xp);
  assert.ok(dayCoins > 65 && dayCoins < 80, `avg quest day ${dayCoins}c ≉ 75c`);
  assert.ok(dayXp > 30 && dayXp < 40, `avg quest day ${dayXp}xp ≉ 37xp`);
});

// ------------------------------------------------------- §C7 foods + junk flags

test('FOOD_TABLE junk flags match §C7 exactly; FOODS exposes boolean junk', () => {
  const JUNK = new Set([
    'donut-sprinkles', 'cupcake', 'ice-cream', 'pizza', 'cake', // v1 rows flagged
    'lollypop', 'cookie', 'chocolate', 'candy-bar', 'muffin', 'fries', 'corn-dog', 'sundae',
    'nutella', // V3/G35 (§C6.1 — foods.js append, junk: true)
  ]);
  for (const [id, row] of Object.entries(FOOD_TABLE)) {
    assert.equal(row.junk === true, JUNK.has(id), `junk flag for ${id}`);
  }
  for (const food of FOODS) {
    assert.equal(typeof food.junk, 'boolean', `${food.id} junk exposed`);
    assert.equal(food.junk, JUNK.has(food.id), `${food.id} junk value`);
    assertKey(`food.${food.id}`);
  }
});

test('the 16 new §C7 food rows are verbatim (price/hunger/fun/extras/junk)', () => {
  // id → [price, hunger, fun, junk, extras]
  const SPEC = {
    radish: [5, 8, 1, false], tomato: [7, 12, 1, false], corn: [10, 15, 2, false],
    eggplant: [12, 16, 1, false], pumpkin: [22, 26, 4, false], strawberry: [8, 6, 6, false],
    grapes: [9, 8, 5, false], croissant: [11, 14, 3, false], lollypop: [6, 2, 8, true],
    cookie: [8, 5, 8, true], chocolate: [9, 5, 9, true], 'candy-bar': [10, 4, 11, true],
    muffin: [12, 10, 8, true], fries: [14, 12, 9, true, { hygiene: -1 }],
    'corn-dog': [15, 18, 6, true], sundae: [18, 7, 14, true, { energy: 3 }],
  };
  assert.equal(Object.keys(SPEC).length, 16);
  for (const [id, [price, hunger, fun, junk, extras = {}]] of Object.entries(SPEC)) {
    assert.deepEqual(
      { ...FOOD_TABLE[id] },
      { price, hunger, fun, ...extras, ...(junk ? { junk: true } : {}) },
      `FOOD_TABLE.${id}`
    );
    assert.ok(getFood(id), `${id} in the FOODS catalog`);
  }
});

// -------------------------------------------------------- §C6 collections

test('COLLECTION_SETS match §C6 verbatim (ids, entries, rewards, strings)', () => {
  const SPEC = {
    fish: {
      entries: ['sunnyCarp', 'blueDace', 'pinkKoi', 'stripeBass', 'tinyMinnow', 'bigWhopper', 'nightEel', 'goldenFish'],
      reward: { coins: 200, furniture: 'proc:goldfishBowl' },
    },
    veggies: {
      entries: ['radish', 'carrot', 'salad', 'tomato', 'corn', 'eggplant', 'pumpkin', 'watermelon'],
      reward: { coins: 150, furniture: 'proc:goldenWateringCan' },
    },
    landmarks: {
      entries: ['shop', 'vetClinic', 'fountain', 'skyTower', 'parkGazebo', 'windmillCafe'],
      reward: { coins: 150, furniture: 'proc:toyCity' },
    },
    treats: {
      entries: ['donut-sprinkles', 'cupcake', 'ice-cream', 'cake', 'cookie', 'candy-bar', 'lollypop', 'sundae', 'chocolate', 'muffin'],
      reward: { coins: 150, furniture: 'proc:candyJar' },
    },
  };
  assert.deepEqual(COLLECTION_SETS.map((s) => s.id), Object.keys(SPEC));
  for (const set of COLLECTION_SETS) {
    const spec = SPEC[set.id];
    assert.deepEqual(set.entries.map((e) => e.id), spec.entries, `${set.id} entries`);
    assert.deepEqual(
      { ...set.reward },
      { ...spec.reward, xp: LEVELING.XP_SET_COMPLETE }, // §C5.2: set completion +50 XP
      `${set.id} reward`
    );
    assertKey(set.nameKey);
    for (const e of set.entries) {
      assertKey(e.nameKey);
      assertKey(e.flavorKey);
    }
  }
  // cross-catalog hooks: veggies == crop ids, treats ⊂ junk foods
  assert.deepEqual(SPEC.veggies.entries, Object.keys(CROP_TABLE));
  for (const id of SPEC.treats.entries) {
    assert.equal(FOOD_TABLE[id].junk, true, `treat ${id} must be junk`);
  }
  assert.equal(getCollectionSet('fish').entries.length, 8);
  assert.equal(getCollectionSet('nope'), undefined);
});

// --------------------------------------------------------- §C8.5 skins

test('SKIN_TABLE + data/skins.js match §C8.5 verbatim', () => {
  const SPEC = {
    cream: ['#F6EAD7', '#FFF9EC', '#F6A8B8', 0],
    snow: ['#FAFAFA', '#FFFFFF', '#F2B8C6', 400],
    caramel: ['#D9A86C', '#F2DDBD', '#E89AAB', 400],
    ash: ['#B9B4AE', '#E8E4DE', '#E0A2B4', 500],
    rose: ['#F4C6D2', '#FBE8EE', '#E88BA0', 600],
    midnight: ['#4C4A63', '#8B89A6', '#C98BA8', 800],
    golden: ['#E8C24A', '#F7E6A6', '#F0A8B8', 1500],
  };
  assert.deepEqual(Object.keys(SKIN_TABLE), Object.keys(SPEC));
  for (const skin of SKINS) {
    const [body, belly, earInner, price] = SPEC[skin.id];
    assert.deepEqual({ ...skin.colors }, { body, belly, earInner }, `${skin.id} palette`);
    assert.equal(skin.price, price, `${skin.id} price`);
    assert.equal(skin.metalness, skin.id === 'golden' ? 0.25 : 0, `${skin.id} metalness`);
    assertKey(skin.nameKey);
  }
  assert.equal(DEFAULT_SKIN, 'cream');
  assert.equal(getSkin('cream').price, 0);
  assert.equal(getSkin('nope'), undefined);
});

// ------------------------------------------------------------- §B6 unlocks

test('UNLOCKS matches the §B6 gating table verbatim', () => {
  assert.equal(UNLOCKS.PHOTO, 1);
  assert.equal(UNLOCKS.PROFILE, 1);
  assert.equal(UNLOCKS.ALBUM, 1);
  assert.equal(UNLOCKS.VET_CHECKUP, 1);
  assert.equal(UNLOCKS.QUESTS, 2);
  assert.equal(UNLOCKS.GARDEN, 3);
  assert.equal(UNLOCKS.SKINS, 5);
  assert.equal(UNLOCKS.QUICK_DELIVERY, 8);
  assert.equal(UNLOCKS.QUICK_DELIVERY, ECONOMY.QUICK_DELIVERY_LEVEL); // v1 parity
  assert.deepEqual({ ...UNLOCKS.MINIGAMES }, {
    goobySays: 2, gardenRush: 4, burgerBuild: 5, veggieChop: 6, deliveryRush: 7,
    miniGolf: 9, goalieGooby: 11, starHopper: 12, pipeFlow: 14,
    // V3/G34: the 6 3.0 gates (§E0.1-3 — dataV3.test.js re-asserts them)
    shoppingSurf: 5, purblePlace: 6, toyRacer: 15, ghostHunt: 16,
    rocketRescue: 18, harborHopper: 20,
  });
  assert.deepEqual({ ...UNLOCKS.CROPS }, {
    radish: 3, carrot: 3, salad: 3, tomato: 4, corn: 6, eggplant: 8, pumpkin: 10, watermelon: 12,
  });
  // crop gates mirror the §C2.3 unlock column exactly
  for (const [id, row] of Object.entries(CROP_TABLE)) {
    assert.equal(UNLOCKS.CROPS[id], row.unlock, `${id} unlock parity`);
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(UNLOCKS.GARDEN_PLOTS)),
    { 4: { level: 10, price: 300 }, 5: { level: 16, price: 600 } }
  );
});

// ------------------------------------- §B3 notify ids + §C3.5/§C9.2/§C12.2 rows

test('NOTIFY gains harvest:6 / sick:7 with MAX_SCHEDULED 7 + EN/DE copy', () => {
  assert.equal(NOTIFY.IDS.harvest, 6);
  assert.equal(NOTIFY.IDS.sick, 7);
  assert.equal(NOTIFY.MAX_SCHEDULED, 7);
  assert.equal(Object.keys(NOTIFY.IDS).length, 7); // one id per scheduled slot
  // §C2.4 / §C3.5 copy, verbatim
  assert.equal(EN['notify.harvest.body'], 'Your crops are ready! 🥕');
  assert.equal(DE['notify.harvest.body'], 'Deine Ernte ist reif! 🥕');
  assert.equal(EN['notify.sick.body'], "Gooby isn't feeling well… 💊");
  assert.equal(DE['notify.sick.body'], 'Gooby fühlt sich nicht gut… 💊');
  assertKey('notify.harvest.title');
  assertKey('notify.sick.title');
});

test('care/vet/photo/leveling numbers are verbatim (§C3.5/§C9.2/§C12.2/§C5.2)', () => {
  assert.deepEqual({ ...ITEM_PRICES }, { medicine: 40, fertilizer: 25 });
  assert.equal(VET.CURE_PRICE, 120);
  assert.equal(VET.CHECKUP_PRICE, 30);
  assert.equal(VET.CURE_STAT_BONUS, 10);
  assert.equal(VET.ROUTE_PICKUP_COUNT, 10);
  assert.equal(PHOTO.CANVAS_W, 1080);
  assert.equal(PHOTO.CANVAS_H, 1440);
  assert.equal(PHOTO.XP_PER_PHOTO, 1);
  assert.equal(PHOTO.XP_DAILY_CAP, 5);
  assert.equal(LEVELING.MAX_LEVEL, 40);
  assert.equal(LEVELING.XP_HARVEST, 2);
  assert.equal(LEVELING.XP_DELIVERY, 3);
  assert.equal(LEVELING.XP_STICKER, 5);
  assert.equal(LEVELING.XP_SET_COMPLETE, 50);
  // ambience tables exist for G17/G19/G26 consumers (§C10.2/§C11.1)
  assert.deepEqual(Object.keys(DAYNIGHT).sort(), ['dawn', 'day', 'dusk', 'night']);
  assert.ok(WEATHER, 'WEATHER params exported');
});

// ------------------------------------------------- §C5.3 achievements verbatim

test('the 17 new §C5.3 achievements are verbatim with EN/DE names', () => {
  // id → [conditionKind, conditionKey, target, coins]
  const SPEC = {
    firstHarvest: ['counter', 'harvests', 1, 15],
    harvest50: ['counter', 'harvests', 50, 100],
    allCrops: ['special', 'allCrops', 8, 120],
    firstQuest: ['counter', 'questsDone', 1, 10],
    quest50: ['counter', 'questsDone', 50, 120],
    firstSticker: ['special', 'stickers', 1, 10],
    setComplete: ['special', 'setsClaimed', 1, 60],
    albumFull: ['special', 'setsClaimed', 4, 300],
    firstCure: ['counter', 'cures', 1, 20],
    vetVisit: ['counter', 'vetTrips', 1, 20],
    neverSick: ['special', 'neverSick', 1, 150],
    chonkZone: ['special', 'weightMax', 86, 40],
    sleekMode: ['special', 'weightMin', 25, 40],
    play21: ['special', 'play21', 21, 250],
    delivery10: ['counter', 'deliveries', 10, 80],
    holeInOne: ['special', 'holeInOne', 1, 50],
    shutterbug: ['counter', 'photosTaken', 10, 60],
  };
  assert.equal(Object.keys(SPEC).length, 17);
  for (const [id, [kind, key, target, coins]] of Object.entries(SPEC)) {
    const def = ACHIEVEMENTS_BY_ID[id];
    assert.ok(def, `achievement ${id} exists`);
    assert.equal(def[kind === 'counter' ? 'counter' : 'special'], key, `${id} condition`);
    assert.equal(def.target, target, `${id} target`);
    assert.equal(def.coins, coins, `${id} coins`);
    assertKey(def.nameKey);
    assertKey(def.descKey);
  }
  // §C5.3 verbatim name spot checks
  assert.equal(EN['ach.firstHarvest.name'], 'Green Thumb');
  assert.equal(DE['ach.firstHarvest.name'], 'Grüner Daumen');
  assert.equal(EN['ach.play21.name'], 'Arcade Legend');
  assert.equal(DE['ach.play21.name'], 'Arcade-Legende');
});

// ------------------------------------ §E0.1-1 string modules: EN/DE parity

test('all 11 v2-* string modules exist with exact EN/DE key parity', async () => {
  const modules = [
    'v2-core', 'v2-garden', 'v2-health', 'v2-city', 'v2-shop', 'v2-progress',
    'v2-games-d', 'v2-games-e', 'v2-ambience', 'v2-audio', 'v2-polish',
  ];
  const seen = new Map(); // key → module (collisions between modules are bugs)
  for (const name of modules) {
    const mod = await import(`../src/data/strings/${name}.js`);
    assert.ok(mod.EN && mod.DE, `${name} exports EN+DE`);
    const enKeys = Object.keys(mod.EN).sort();
    const deKeys = Object.keys(mod.DE).sort();
    assert.deepEqual(enKeys, deKeys, `${name}: EN/DE key parity`);
    for (const key of enKeys) {
      assert.ok(!seen.has(key), `${key} defined in both ${seen.get(key)} and ${name}`);
      seen.set(key, name);
      // the merged dictionaries carry every module key (spread after v1 §E0.1-1)
      assert.equal(EN[key], mod.EN[key], `merged EN['${key}']`);
      assert.equal(DE[key], mod.DE[key], `merged DE['${key}']`);
    }
  }
  assert.ok(seen.size >= 200, `v2 modules carry ${seen.size} keys (v2-core alone has ~200)`);
  // the 9 new game titles are v2-core's (§C1.2 verbatim spot checks)
  for (const id of ['goobySays', 'gardenRush', 'burgerBuild', 'veggieChop', 'deliveryRush', 'miniGolf', 'goalieGooby', 'starHopper', 'pipeFlow']) {
    assert.equal(seen.get(`mg.title.${id}`), 'v2-core', `mg.title.${id} in v2-core`);
    assertKey(`mg.title.${id}`);
  }
  assert.equal(EN['mg.title.goobySays'], 'Gooby Says');
  assert.equal(DE['mg.title.goobySays'], 'Gooby sagt');
});

test('merged EN and DE dictionaries stay in full key parity', () => {
  const en = Object.keys(EN).sort();
  const de = Object.keys(DE).sort();
  assert.deepEqual(en, de);
});
