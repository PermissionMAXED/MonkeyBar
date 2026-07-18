// Achievements (§C8.3): catalog integrity (16 defs, verbatim rewards, EN+DE
// strings), every condition unit-driven via fake counters/state, unlock
// happening EXACTLY once with the coin reward paid, and the engine's central
// store wiring (track / trackTripResult / 'change' subscription).
import test from 'node:test';
import assert from 'node:assert/strict';

import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID, getAchievement } from '../src/data/achievements.js';
import {
  progressOf,
  isSatisfied,
  applyUnlocks,
  countNonDefaultDecor,
  initAchievements,
  resetAchievementsEngineForTests,
} from '../src/systems/achievementsEngine.js';
import { EN, DE } from '../src/data/strings.js';
import { MINIGAME_IDS } from '../src/data/minigames.js';
import { defaultState } from '../src/core/save.js';
import { createStore } from '../src/core/store.js';
// F2 (E11): read-only import — the regression test builds furniture.placed
// through the real placement API so the persisted §E3 shape is what's tested.
import * as furniturePlacement from '../src/systems/furniturePlacement.js';

/** §C8.3 binding table: id → coin reward. */
const SPEC_COINS = {
  firstFeed: 10, feed100: 100, firstWash: 10, wash50: 80,
  firstSleep: 15, sleep20: 100, firstDrive: 20, drive25: 120,
  noCrash: 40, play12: 150, coins1000: 50, level10: 100,
  fullOutfit: 60, decorator: 80, streak7: 150, tickle100: 60,
  // V2/G16: +17 2.0 rewards (PLAN2 §C5.3 verbatim; deep coverage in dataV2.test.js)
  firstHarvest: 15, harvest50: 100, allCrops: 120, firstQuest: 10, quest50: 120,
  firstSticker: 10, setComplete: 60, albumFull: 300, firstCure: 20, vetVisit: 20,
  neverSick: 150, chonkZone: 40, sleekMode: 40, play21: 250, delivery10: 80,
  holeInOne: 50, shutterbug: 60,
};

function freshState() {
  return defaultState();
}

// ------------------------------------------------------------------ catalog

test('catalog has all 16 §C8.3 achievements with verbatim coin rewards', () => {
  assert.equal(ACHIEVEMENTS.length, 33); // V2/G16: 16 v1 + 17 §C5.3
  assert.deepEqual(new Set(ACHIEVEMENTS.map((a) => a.id)), new Set(Object.keys(SPEC_COINS)));
  for (const [id, coins] of Object.entries(SPEC_COINS)) {
    assert.equal(ACHIEVEMENTS_BY_ID[id].coins, coins, `${id} reward (§C8.3 binding)`);
  }
  assert.equal(getAchievement('firstFeed').counter, 'feeds');
  assert.equal(getAchievement('bogus'), undefined);
});

test('every achievement name/desc key exists in BOTH dictionaries (EN+DE)', () => {
  for (const a of ACHIEVEMENTS) {
    assert.equal(typeof EN[a.nameKey], 'string', `EN missing ${a.nameKey}`);
    assert.equal(typeof DE[a.nameKey], 'string', `DE missing ${a.nameKey}`);
    assert.equal(typeof EN[a.descKey], 'string', `EN missing ${a.descKey}`);
    assert.equal(typeof DE[a.descKey], 'string', `DE missing ${a.descKey}`);
  }
  // §C8.3 verbatim spot checks
  assert.equal(EN['ach.feed100.name'], 'Chonky Boy');
  assert.equal(DE['ach.feed100.name'], 'Moppelhase');
  assert.equal(DE['ach.streak7.name'], 'Wochenkumpel');
});

// ------------------------------------------- all 16 conditions, unit-driven

/** counter-threshold cases: id → [counterId, target] */
const COUNTER_CASES = {
  firstFeed: ['feeds', 1],
  feed100: ['feeds', 100],
  firstWash: ['washes', 1],
  wash50: ['washes', 50],
  firstSleep: ['sleeps', 1],
  sleep20: ['sleeps', 20],
  firstDrive: ['trips', 1],
  drive25: ['trips', 25],
  noCrash: ['cleanTrips', 1],
  tickle100: ['tickles', 100],
};

test('counter achievements: below target → unsatisfied, at target → satisfied', () => {
  for (const [id, [counter, target]] of Object.entries(COUNTER_CASES)) {
    const def = ACHIEVEMENTS_BY_ID[id];
    const state = freshState();
    state.achievements.counters[counter] = target - 1;
    assert.equal(isSatisfied(def, state), false, `${id} below`);
    assert.deepEqual(progressOf(def, state), { current: target - 1, target });
    state.achievements.counters[counter] = target;
    assert.equal(isSatisfied(def, state), true, `${id} at target`);
    state.achievements.counters[counter] = target + 500; // progress clamps
    assert.equal(progressOf(def, state).current, target);
  }
});

test('coins1000: balance ≥ 1000 at once', () => {
  const def = ACHIEVEMENTS_BY_ID.coins1000;
  const state = freshState();
  state.coins = 999;
  assert.equal(isSatisfied(def, state), false);
  state.coins = 1000;
  assert.equal(isSatisfied(def, state), true);
});

test('level10: level ≥ 10', () => {
  const def = ACHIEVEMENTS_BY_ID.level10;
  const state = freshState();
  state.level = 9;
  assert.equal(isSatisfied(def, state), false);
  state.level = 10;
  assert.equal(isSatisfied(def, state), true);
});

test('fullOutfit: hat + glasses + neck equipped simultaneously', () => {
  const def = ACHIEVEMENTS_BY_ID.fullOutfit;
  const state = freshState();
  state.outfits.equipped = { hat: 'crown', glasses: 'starGlasses', neck: null };
  assert.equal(isSatisfied(def, state), false);
  assert.equal(progressOf(def, state).current, 2);
  state.outfits.equipped.neck = 'scarfRed';
  assert.equal(isSatisfied(def, state), true);
});

test('decorator: ≥10 placed non-default items (furniture + wallpaper + floor)', () => {
  const def = ACHIEVEMENTS_BY_ID.decorator;
  const state = freshState();
  // §C5.2 free defaults never count (guard only — the real placement API
  // never stores a slot's free default in the flat map)
  state.furniture.placed = { 'living:sofa': 'loungeSofa', 'living:rug': 'rugRounded' };
  assert.equal(countNonDefaultDecor(state), 0);
  // 8 paid furniture placements + 1 wallpaper + 1 floor = 10. F2 (E11):
  // furniture.placed is the FLAT §E3 map { 'roomId:slotId': itemId } that
  // systems/furniturePlacement.js persists — not a nested {room:{slot:id}}.
  state.furniture.placed = {
    'living:sofa': 'loungeDesignSofa',
    'living:rug': 'rugRound',
    'living:plant': 'plantSmall1',
    'living:tv': 'televisionModern',
    'kitchen:fridge': 'kitchenFridgeLarge',
    'kitchen:appliance': 'kitchenCoffeeMachine',
    'bedroom:bed': 'bedDouble',
    'bedroom:plushie': 'proc:miniGooby',
  };
  state.decor.wallpaper = { living: 'mint', kitchen: 'cream' }; // cream = default
  state.decor.floor = { bathroom: 'tile' };
  assert.equal(countNonDefaultDecor(state), 10);
  assert.equal(isSatisfied(def, state), true);
  state.decor.floor = {};
  assert.equal(countNonDefaultDecor(state), 9);
  assert.equal(isSatisfied(def, state), false);
});

// F2 (E11) regression: drive furniture.placed through the REAL placement API
// (read-only import) so the counter is tested against the persisted §E3 shape.
test('decorator regression (F2/E11): furniturePlacement API drives progress to unlock', () => {
  resetAchievementsEngineForTests();
  const def = ACHIEVEMENTS_BY_ID.decorator;
  const store = createStore(freshState(), { autosave: false });
  store.set('coins', 5000);
  assert.equal(countNonDefaultDecor(store.get()), 0); // defaults only

  const placements = [
    ['loungeDesignSofa', 'living', 'sofa'],
    ['televisionModern', 'living', 'tv'],
    ['rugRound', 'living', 'rug'],
    ['plantSmall1', 'living', 'plant'],
    ['lampSquareFloor', 'living', 'lamp'],
    ['bookcaseClosedWide', 'living', 'bookcase'],
    ['kitchenFridgeLarge', 'kitchen', 'fridge'],
    ['bedDouble', 'bedroom', 'bed'],
  ];
  let expected = 0;
  for (const [itemId, roomId, slotId] of placements) {
    assert.equal(furniturePlacement.buyFurniture(store, itemId).ok, true, `buy ${itemId}`);
    assert.equal(furniturePlacement.place(store, itemId, roomId, slotId).ok, true, `place ${itemId}`);
    expected += 1;
    assert.equal(countNonDefaultDecor(store.get()), expected, `progress after ${itemId}`);
    assert.deepEqual(progressOf(def, store.get()), { current: expected, target: 10 });
  }
  // the persisted shape really is the flat 'roomId:slotId' → itemId map
  assert.equal(store.get('furniture.placed')['living:sofa'], 'loungeDesignSofa');

  // non-default wallpaper + floor complete the 10 (§C8.3 intent)
  assert.equal(furniturePlacement.buySurface(store, 'wallpaper', 'mint').ok, true);
  assert.equal(furniturePlacement.applySurface(store, 'wallpaper', 'living', 'mint').ok, true);
  assert.equal(countNonDefaultDecor(store.get()), 9);
  assert.equal(isSatisfied(def, store.get()), false);
  assert.equal(furniturePlacement.buySurface(store, 'floor', 'tile').ok, true);
  assert.equal(furniturePlacement.applySurface(store, 'floor', 'bathroom', 'tile').ok, true);
  assert.equal(countNonDefaultDecor(store.get()), 10);
  assert.equal(isSatisfied(def, store.get()), true);

  // the engine unlocks it at the threshold (store 'change' wiring)
  const coinsBefore = store.get('coins');
  initAchievements({ store });
  store.flush();
  assert.equal(store.get('achievements.unlocked.decorator') > 0, true);
  assert.equal(store.get('coins') >= coinsBefore + 80, true, '§C8.3 +80c reward paid');

  // placing the free default back collapses the override; the unlock stays
  furniturePlacement.place(store, 'loungeSofa', 'living', 'sofa');
  assert.equal(countNonDefaultDecor(store.get()), 9);
  assert.equal(store.get('achievements.unlocked.decorator') > 0, true);
  resetAchievementsEngineForTests();
});

test('decorator: shared rug placed in two rooms counts per placement (F2/E11)', () => {
  const store = createStore(freshState(), { autosave: false });
  store.set('coins', 1000);
  assert.equal(furniturePlacement.buyFurniture(store, 'rugRectangle').ok, true);
  assert.equal(furniturePlacement.place(store, 'rugRectangle', 'living', 'rug').ok, true);
  assert.equal(furniturePlacement.place(store, 'rugRectangle', 'bedroom', 'rug').ok, true);
  assert.equal(countNonDefaultDecor(store.get()), 2);
});

test('streak7: daily streak ≥ 7', () => {
  const def = ACHIEVEMENTS_BY_ID.streak7;
  const state = freshState();
  state.daily.streak = 6;
  assert.equal(isSatisfied(def, state), false);
  state.daily.streak = 7;
  assert.equal(isSatisfied(def, state), true);
});

test('play12: each of the 12 games played ≥ 1 (plays map)', () => {
  const def = ACHIEVEMENTS_BY_ID.play12;
  const state = freshState();
  // V2/G16: the catalog now lists 21 games (§C1.1) — play12 needs ANY 12
  // distinct ones played; play21 (all 21) is the 2.0 tier (§C5.3, G23 wires).
  assert.equal(MINIGAME_IDS.length, 21);
  for (const id of MINIGAME_IDS.slice(0, 11)) state.minigames.plays[id] = 2;
  state.minigames.plays._smoke = 99; // dev game never counts
  assert.equal(isSatisfied(def, state), false);
  assert.equal(progressOf(def, state).current, 11);
  state.minigames.plays[MINIGAME_IDS[11]] = 1;
  assert.equal(isSatisfied(def, state), true);
});

// --------------------------------------------- unlock-once + reward payout

test('applyUnlocks: unlocks exactly once and pays the §C8.3 coin reward', () => {
  const state = freshState();
  state.coins = 0;
  state.achievements.counters.feeds = 1;
  const first = applyUnlocks(state, 123456);
  assert.deepEqual(first.unlocked.map((d) => d.id), ['firstFeed']);
  assert.equal(first.state.coins, 10);
  assert.equal(first.state.achievements.unlocked.firstFeed, 123456);
  // second pass on the result: nothing new, same reference back, no double pay
  const second = applyUnlocks(first.state, 999999);
  assert.deepEqual(second.unlocked, []);
  assert.equal(second.state, first.state);
  assert.equal(second.state.coins, 10);
  assert.equal(second.state.achievements.unlocked.firstFeed, 123456);
});

test('applyUnlocks: simultaneous unlocks sum their rewards', () => {
  const state = freshState();
  state.coins = 1000; // coins1000 satisfied
  state.level = 10; // level10 satisfied
  state.achievements.counters.tickles = 100; // tickle100 satisfied
  // V2/G23: L10 would now ALSO satisfy neverSick (§C5.3) — disqualify it so
  // this stays the v1 three-way sum it always tested.
  state.achievements.counters.sickEver = 1;
  const r = applyUnlocks(state, 1);
  assert.deepEqual(new Set(r.unlocked.map((d) => d.id)), new Set(['coins1000', 'level10', 'tickle100']));
  assert.equal(r.state.coins, 1000 + 50 + 100 + 60);
});

// V2/FIX-A2 (§C1.5): unlock payouts used to add coins WITHOUT feeding
// profile.coinsEarned — the one coin source outside the lifetime total, so
// the stats screen under-reported "Coins earned" by every §C8.3 reward.
test('V2/FIX-A2: unlock payout feeds profile.coinsEarned by the same amount', () => {
  // pure layer: applyUnlocks mirrors economy.award's bookkeeping
  const state = freshState();
  state.coins = 1000; // coins1000 + (via counters) tickle100 → 50c + 60c
  state.achievements.counters.tickles = 100;
  const earned0 = state.profile.coinsEarned;
  const r = applyUnlocks(state, 1);
  assert.equal(r.state.coins, 1000 + 110, 'coins paid');
  assert.equal(r.state.profile.coinsEarned, earned0 + 110, 'lifetime total moved by the SAME amount');
  // nothing-new pass: same reference back, totals untouched
  const again = applyUnlocks(r.state, 2);
  assert.equal(again.state, r.state);

  // live engine layer: a real unlock through the store wiring
  resetAchievementsEngineForTests();
  const store = createStore(freshState(), { autosave: false });
  const engine = initAchievements({ store });
  const coins0 = store.get('coins');
  const lifetime0 = store.get('profile.coinsEarned');
  engine.track('feeds'); // firstFeed → +10c (§C8.3)
  assert.equal(store.get('coins'), coins0 + 10);
  assert.equal(store.get('profile.coinsEarned'), lifetime0 + 10, 'engine unlock feeds coinsEarned');
  resetAchievementsEngineForTests();
});

test('every one of the 16 achievements is unlockable through applyUnlocks', () => {
  const state = freshState();
  state.coins = 1000;
  state.level = 10;
  Object.assign(state.achievements.counters, {
    feeds: 100, washes: 50, sleeps: 20, trips: 25, cleanTrips: 1, tickles: 100,
  });
  // V2/G23: the §C5.3 specials are wired now — keep this the pure-v1 check by
  // disqualifying neverSick (sickEver) and play21 (only 12 of 21 played);
  // the all-33 companion test lives in the V2/G23 section below.
  state.achievements.counters.sickEver = 1;
  state.outfits.equipped = { hat: 'crown', glasses: 'starGlasses', neck: 'scarfRed' };
  state.furniture.placed = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`living:slot${i}`, `fancyItem${i}`])
  );
  state.daily.streak = 7;
  for (const id of MINIGAME_IDS.slice(0, 12)) state.minigames.plays[id] = 1; // V2/G23: 12 of 21
  const r = applyUnlocks(state, 7);
  assert.equal(r.unlocked.length, 16, 'all 16 unlock');
  // V2/G16: SPEC_COINS now lists all 33 — sum only the 16 v1 unlocks here
  // (the 17 §C5.3 counters/specials sit at 0 until G23 wires them, wave 2).
  const totalRewards = r.unlocked.reduce((sum, d) => sum + SPEC_COINS[d.id], 0);
  assert.equal(totalRewards, 1145, 'v1 §C8.3 rewards sum');
  assert.equal(r.state.coins, 1000 + totalRewards);
});

// --------------------------------------------------- engine wiring (store)

test('engine: track() bumps counters, unlocks once, pays once', () => {
  resetAchievementsEngineForTests();
  const store = createStore(freshState(), { autosave: false });
  const toasts = [];
  const jingles = [];
  const engine = initAchievements({
    store,
    ui: { toast: (key, vars) => toasts.push({ key, vars }) },
    audio: { play: (id) => jingles.push(id) },
  });

  const coins0 = store.get('coins');
  engine.track('feeds');
  assert.equal(store.get('achievements.counters.feeds'), 1);
  assert.equal(store.get('achievements.unlocked.firstFeed') > 0, true);
  assert.equal(store.get('coins'), coins0 + 10);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].key, 'ach.unlockedToast');
  assert.equal(toasts[0].vars.coins, 10);
  assert.deepEqual(jingles, ['jingle.achievement']);

  engine.track('feeds', 5); // 6 feeds — no re-unlock, no re-pay
  assert.equal(store.get('achievements.counters.feeds'), 6);
  assert.equal(store.get('coins'), coins0 + 10);
  assert.equal(toasts.length, 1);
  resetAchievementsEngineForTests();
});

test('engine: trackTripResult only counts clean, untowed trips (noCrash §C8.3)', () => {
  resetAchievementsEngineForTests();
  const store = createStore(freshState(), { autosave: false });
  const engine = initAchievements({ store });

  engine.trackTripResult({ pickups: 12, crashes: 2, towed: false });
  engine.trackTripResult({ pickups: 5, crashes: 0, towed: true }); // tow forfeits
  assert.equal(store.get('achievements.counters.cleanTrips') ?? 0, 0);
  assert.equal(store.get('achievements.unlocked.noCrash'), undefined);

  const coins0 = store.get('coins');
  engine.trackTripResult({ pickups: 20, crashes: 0, towed: false });
  assert.equal(store.get('achievements.counters.cleanTrips'), 1);
  assert.equal(store.get('achievements.unlocked.noCrash') > 0, true);
  assert.equal(store.get('coins'), coins0 + 40);
  resetAchievementsEngineForTests();
});

test("engine: central store 'change' subscription catches condition sources", () => {
  resetAchievementsEngineForTests();
  const store = createStore(freshState(), { autosave: false });
  initAchievements({ store });

  store.set('coins', 1500); // e.g. G11 economy paying out a minigame
  store.flush(); // deterministic in tests: force the coalesced 'change' emit
  assert.equal(store.get('achievements.unlocked.coins1000') > 0, true);
  assert.equal(store.get('coins'), 1500 + 50); // reward paid on top
  resetAchievementsEngineForTests();
});

test('engine: noCrash framework interception decorates shopTrip launch params', async () => {
  resetAchievementsEngineForTests();
  const store = createStore(freshState(), { autosave: false });
  /** fake §E8 framework: shopTrip passes onArrive through launch params */
  let captured = null;
  const framework = {
    launch: (id, params) => {
      captured = params;
      return Promise.resolve(true);
    },
  };
  initAchievements({ store, framework });

  let arrived = null;
  await framework.launch('cityDrive', {
    mode: 'shopTrip',
    onArrive: (result) => {
      arrived = result;
    },
  });
  captured.onArrive({ pickups: 20, crashes: 0, towed: false, coins: 35 });
  assert.deepEqual(arrived, { pickups: 20, crashes: 0, towed: false, coins: 35 }); // original still runs
  assert.equal(store.get('achievements.counters.cleanTrips'), 1);
  assert.equal(store.get('achievements.unlocked.noCrash') > 0, true);

  // arcade launches pass through untouched
  const plain = { mode: 'arcade' };
  await framework.launch('cityDrive', plain);
  assert.equal(captured, plain);
  resetAchievementsEngineForTests();
});

// ═══════════════════════════════════════════════════════════════ V2/G23 ═══
// Achievements 2.0 (§C5.3 specials, all 33 reachable) + live progression
// wiring (V2_QUEST_POOL decoration, quest track/claim/reroll through the
// engine, counter-diff forwarding, sticker XP, set claim, photo XP cap).

import {
  V2_QUEST_POOL,
  questCtxOf,
  v2SpecialProgress,
  photoXpGrant,
} from '../src/systems/achievementsEngine.js';
import { localDay } from '../src/core/clock.js';
import { LEVELING, UNLOCKS, PHOTO } from '../src/data/constants.js';
import { QUEST_POOL } from '../src/data/quests.js';

/** Fixture: today's quests already rolled (rollDaily no-ops on init). */
function withQuests(state, ids) {
  state.quests = {
    day: localDay(),
    active: ids.map((id) => ({ id, progress: 0, claimed: false })),
    rerolledDay: '',
    completedTotal: 0,
  };
  return state;
}

test('V2/G23 V2_QUEST_POOL: all 28 rows decorated with reward + mode', () => {
  assert.equal(V2_QUEST_POOL.length, 28);
  for (const row of V2_QUEST_POOL) {
    const raw = QUEST_POOL.find((r) => r.id === row.id);
    assert.deepEqual(row.reward, { coins: raw.coins, xp: raw.xp }, `${row.id} reward`);
  }
  // §B7 modes: score/round/tricks → 'max', gameDistinct → 'distinct', else 'add'
  const modeOf = (id) => V2_QUEST_POOL.find((r) => r.id === id).mode;
  for (const id of ['q.catch30', 'q.hop10', 'q.run200', 'q.dance150', 'q.golfPar']) {
    assert.equal(modeOf(id), 'max', `${id} single-round best`);
  }
  assert.equal(modeOf('q.tricks5'), 'max');
  assert.equal(modeOf('q.says6'), 'max');
  assert.equal(modeOf('q.play2distinct'), 'distinct');
  assert.equal(modeOf('q.feed3'), 'add');
  assert.equal(modeOf('q.earn60'), 'add');
});

test('V2/G23 questCtxOf: level/unlocked games/garden gate', () => {
  const state = freshState();
  state.level = 1;
  let ctx = questCtxOf(state);
  assert.equal(ctx.level, 1);
  assert.equal(ctx.gardenUnlocked, false);
  assert.equal(ctx.unlockedGameIds.includes('carrotCatch'), true);
  assert.equal(ctx.unlockedGameIds.includes('fishingPond'), false);
  state.level = UNLOCKS.GARDEN;
  ctx = questCtxOf(state);
  assert.equal(ctx.gardenUnlocked, true);
});

test('V2/G23 specials: allCrops / stickers / setsClaimed progress', () => {
  const state = freshState();
  const allCrops = ACHIEVEMENTS_BY_ID.allCrops;
  const firstSticker = ACHIEVEMENTS_BY_ID.firstSticker;
  const setComplete = ACHIEVEMENTS_BY_ID.setComplete;
  const albumFull = ACHIEVEMENTS_BY_ID.albumFull;
  assert.equal(isSatisfied(allCrops, state), false);
  const crops = ['radish', 'carrot', 'salad', 'tomato', 'corn', 'eggplant', 'pumpkin', 'watermelon'];
  for (const c of crops) state.collections.entries[`veggies.${c}`] = 2;
  assert.equal(v2SpecialProgress(allCrops, state), 8);
  assert.equal(isSatisfied(allCrops, state), true);
  assert.equal(isSatisfied(firstSticker, state), true); // any entry ≥ 1
  assert.equal(isSatisfied(setComplete, state), false);
  state.collections.claimedSets = { veggies: 111 };
  assert.equal(isSatisfied(setComplete, state), true);
  assert.equal(progressOf(albumFull, state).current, 1);
  state.collections.claimedSets = { veggies: 1, fish: 2, landmarks: 3, treats: 4 };
  assert.equal(isSatisfied(albumFull, state), true);
});

test('V2/G23 specials: neverSick latches on the sickEver counter', () => {
  const def = ACHIEVEMENTS_BY_ID.neverSick;
  const state = freshState();
  assert.equal(isSatisfied(def, state), false, 'level 1: not yet');
  state.level = 10;
  assert.equal(isSatisfied(def, state), true, 'L10 + never sick');
  state.achievements.counters.sickEver = 1;
  assert.equal(isSatisfied(def, state), false, 'ever sick disqualifies');
});

test('V2/G23 specials: chonkZone (weightMax 86) / sleekMode (weightMin 25)', () => {
  const chonk = ACHIEVEMENTS_BY_ID.chonkZone;
  const sleek = ACHIEVEMENTS_BY_ID.sleekMode;
  const state = freshState(); // weight.value 50
  assert.equal(isSatisfied(chonk, state), false);
  assert.equal(isSatisfied(sleek, state), false);
  state.weight.value = 86;
  assert.equal(isSatisfied(chonk, state), true);
  assert.deepEqual(progressOf(chonk, state), { current: 86, target: 86 });
  state.weight.value = 25;
  assert.equal(isSatisfied(sleek, state), true);
  state.weight.value = 26;
  assert.equal(isSatisfied(sleek, state), false);
});

test('V2/G23 specials: play21 needs all 21 catalog games; holeInOne counter', () => {
  const play21 = ACHIEVEMENTS_BY_ID.play21;
  const state = freshState();
  for (const id of MINIGAME_IDS.slice(0, 20)) state.minigames.plays[id] = 3;
  state.minigames.plays._smoke = 9; // dev game never counts
  assert.equal(progressOf(play21, state).current, 20);
  assert.equal(isSatisfied(play21, state), false);
  state.minigames.plays[MINIGAME_IDS[20]] = 1;
  assert.equal(isSatisfied(play21, state), true);

  const hole = ACHIEVEMENTS_BY_ID.holeInOne;
  assert.equal(isSatisfied(hole, state), false);
  state.achievements.counters.holeInOnes = 1; // framework forwards miniGolf meta
  assert.equal(isSatisfied(hole, state), true);
});

test('V2/G23: ALL 33 achievements reachable via counters/specials', () => {
  const state = freshState();
  state.coins = 1000;
  state.level = 10;
  Object.assign(state.achievements.counters, {
    feeds: 100, washes: 50, sleeps: 20, trips: 25, cleanTrips: 1, tickles: 100,
    harvests: 50, questsDone: 50, cures: 1, vetTrips: 1, deliveries: 10,
    photosTaken: 10, holeInOnes: 1, sickEver: 0,
  });
  state.outfits.equipped = { hat: 'crown', glasses: 'starGlasses', neck: 'scarfRed' };
  state.furniture.placed = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`living:slot${i}`, `fancyItem${i}`])
  );
  state.daily.streak = 7;
  for (const id of MINIGAME_IDS) state.minigames.plays[id] = 1;
  for (const c of ['radish', 'carrot', 'salad', 'tomato', 'corn', 'eggplant', 'pumpkin', 'watermelon']) {
    state.collections.entries[`veggies.${c}`] = 1;
  }
  state.collections.claimedSets = { veggies: 1, fish: 2, landmarks: 3, treats: 4 };
  state.weight.value = 86; // chonkZone first …
  const pass1 = applyUnlocks(state, 7);
  assert.equal(pass1.unlocked.length, 32, 'everything except sleekMode');
  pass1.state.weight = { value: 25 }; // … then slim down for sleekMode
  const pass2 = applyUnlocks(pass1.state, 8);
  assert.deepEqual(pass2.unlocked.map((d) => d.id), ['sleekMode']);
  assert.equal(Object.keys(pass2.state.achievements.unlocked).length, 33, 'all 33');
});

test('V2/G23 photoXpGrant: +1 XP per photo, cap 5/day, day rollover resets', () => {
  let c = { photoXpDay: '', photoXpToday: 0 };
  for (let i = 0; i < PHOTO.XP_DAILY_CAP; i += 1) {
    const g = photoXpGrant(c, '2026-07-17');
    assert.equal(g.xp, PHOTO.XP_PER_PHOTO, `photo ${i + 1} grants`);
    c = g.counters;
  }
  const capped = photoXpGrant(c, '2026-07-17');
  assert.equal(capped.xp, 0, '6th photo same day: capped');
  const nextDay = photoXpGrant(capped.counters, '2026-07-18');
  assert.equal(nextDay.xp, PHOTO.XP_PER_PHOTO, 'fresh day resets the cap');
});

test('V2/G23 engine: counter diff forwards quest events; claim pays once', () => {
  resetAchievementsEngineForTests();
  const toasts = [];
  const store = createStore(
    withQuests(freshState(), ['q.feed3', 'q.wash1', 'q.play3']),
    { autosave: false }
  );
  const engine = initAchievements({
    store,
    ui: { toast: (key, vars) => toasts.push({ key, vars }) },
    audio: { play: () => {} },
  });
  // rollDaily no-oped (fixture day matches localDay)
  assert.deepEqual(store.get('quests').active.map((e) => e.id), ['q.feed3', 'q.wash1', 'q.play3']);

  engine.track('feeds'); // ANY counter bump path forwards 'feed' via the diff
  store.flush();
  assert.equal(store.get('quests').active[0].progress, 1);
  engine.track('feeds', 2);
  store.flush();
  assert.equal(store.get('quests').active[0].progress, 3);
  assert.equal(engine.quests.claimable(), 1);

  const coins0 = store.get('coins');
  const xp0 = store.get('xp');
  const reward = engine.quests.claim('q.feed3');
  assert.deepEqual(reward, { coins: 20, xp: 10 }, '§C5.1 q.feed3 reward');
  assert.equal(store.get('coins') >= coins0 + 20, true, 'economy payout (+ possible unlocks)');
  assert.equal(store.get('xp'), xp0 + 10, 'leveling payout');
  assert.equal(store.get('achievements.counters.questsDone'), 1);
  assert.equal(store.get('quests').active[0].claimed, true);
  assert.equal(engine.quests.claimable(), 0);
  assert.equal(engine.quests.claim('q.feed3'), null, 'double claim refused');
  store.flush();
  assert.equal(store.get('achievements.unlocked.firstQuest') > 0, true, 'questsDone feeds firstQuest');
  resetAchievementsEngineForTests();
});

test('V2/G23 engine: feedHealthy + buyFood inventory-diff detection', () => {
  resetAchievementsEngineForTests();
  const store = createStore(
    withQuests(freshState(), ['q.feedHealthy2', 'q.buyFood1', 'q.wash1']),
    { autosave: false }
  );
  initAchievements({ store, ui: { toast: () => {} }, audio: { play: () => {} } });

  // a feed consumes a NON-junk food + bumps the feeds counter in one flush
  store.update((s) => {
    s.inventory.carrot -= 1; // starter inventory has 3
    s.achievements.counters.feeds += 1;
  });
  store.flush();
  assert.equal(store.get('quests').active[0].progress, 1, 'carrot is healthy');

  // junk food never counts for feedHealthy
  store.update((s) => {
    s.inventory.cupcake -= 1; // junk: true (§C7)
    s.achievements.counters.feeds += 1;
  });
  store.flush();
  assert.equal(store.get('quests').active[0].progress, 1, 'cupcake ignored');

  // a buy = food gained + coins spent in the same flush (no harvest)
  store.update((s) => {
    s.inventory.apple = (s.inventory.apple ?? 0) + 1;
    s.coins -= 6;
    s.profile.coinsSpent += 6;
  });
  store.flush();
  assert.equal(store.get('quests').active[1].progress, 1, 'buyFood detected');

  // a harvest gains food WITHOUT a spend — never a buy
  store.update((s) => {
    s.inventory.radish = (s.inventory.radish ?? 0) + 1;
    s.achievements.counters.harvests += 1;
  });
  store.flush();
  assert.equal(store.get('quests').active[1].progress, 1, 'harvest not a buy');
  resetAchievementsEngineForTests();
});

test('V2/G23 engine: first-time sticker pays §C5.2 XP + toast exactly once', () => {
  resetAchievementsEngineForTests();
  const toasts = [];
  const store = createStore(freshState(), { autosave: false });
  const engine = initAchievements({
    store,
    ui: { toast: (key, vars) => toasts.push({ key, vars }) },
    audio: { play: () => {} },
  });
  store.flush(); // settle the boot roll before baselining
  const xp0 = store.get('xp');
  assert.equal(engine.collections.award('fish', 'pinkKoi'), true, 'first: true');
  store.flush();
  assert.equal(store.get('xp'), xp0 + LEVELING.XP_STICKER);
  const stickerToasts = toasts.filter((x) => x.key === 'toast.sticker');
  assert.equal(stickerToasts.length, 1);
  assert.equal(stickerToasts[0].vars.xp, LEVELING.XP_STICKER);

  assert.equal(engine.collections.award('fish', 'pinkKoi'), false, 'repeat: not first');
  store.flush();
  assert.equal(store.get('collections.entries')['fish.pinkKoi'], 2, 'count stacks');
  assert.equal(toasts.filter((x) => x.key === 'toast.sticker').length, 1, 'no repeat toast');

  // firstOnly (landmark forwarding): owned → skipped
  assert.equal(engine.collections.award('fish', 'pinkKoi', 1, { firstOnly: true }), false);
  assert.equal(store.get('collections.entries')['fish.pinkKoi'], 2);
  resetAchievementsEngineForTests();
});

test('V2/G23 engine: set claim pays coins+XP once, deco lands in furniture.owned', () => {
  resetAchievementsEngineForTests();
  const store = createStore(freshState(), { autosave: false });
  const engine = initAchievements({ store, ui: { toast: () => {} }, audio: { play: () => {} } });
  const fish = ['sunnyCarp', 'blueDace', 'pinkKoi', 'stripeBass', 'tinyMinnow', 'bigWhopper', 'nightEel', 'goldenFish'];
  for (const id of fish) engine.collections.award('fish', id);
  store.flush();

  const coins0 = store.get('coins');
  const reward = engine.collections.claimSet('fish');
  assert.equal(reward.coins, 200, '§C6 fish set reward');
  assert.equal(store.get('coins') >= coins0 + 200, true);
  assert.equal(store.get('furniture.owned').includes('proc:goldfishBowl'), true);
  assert.equal(store.get('collections.claimedSets').fish > 0, true);
  assert.equal(engine.collections.claimSet('fish'), null, 'single claim only');
  store.flush();
  assert.equal(store.get('achievements.unlocked.setComplete') > 0, true);
  resetAchievementsEngineForTests();
});

test('V2/G23 engine: reroll once per day through the live API', () => {
  resetAchievementsEngineForTests();
  const store = createStore(
    withQuests(freshState(), ['q.feed3', 'q.wash1', 'q.tickle3']),
    { autosave: false }
  );
  const engine = initAchievements({ store, ui: { toast: () => {} }, audio: { play: () => {} } });
  assert.equal(engine.quests.reroll(), true, 'first reroll ok');
  assert.equal(store.get('quests').rerolledDay, localDay());
  assert.equal(store.get('quests').active.length, 3, 'board stays full');
  assert.equal(engine.quests.reroll(), false, 'second reroll refused');
  resetAchievementsEngineForTests();
});

test('V2/FIX-A (E7): counter-diff watcher grants §C5.2 harvest/delivery XP', () => {
  resetAchievementsEngineForTests();
  const store = createStore(freshState(), { autosave: false });
  initAchievements({ store, ui: { toast: () => {} }, audio: { play: () => {} } });
  store.flush(); // settle the boot quest roll

  // harvest +2 XP — same counter bump the garden harvest site makes
  let xp0 = store.get('xp');
  store.update((s) => { s.achievements.counters.harvests += 1; });
  store.flush();
  assert.equal(store.get('xp'), xp0 + LEVELING.XP_HARVEST);

  // delivery +3 XP, batched deltas pay per unit (deliveryRush track(n))
  xp0 = store.get('xp');
  store.update((s) => { s.achievements.counters.deliveries += 2; });
  store.flush();
  assert.equal(store.get('xp'), xp0 + 2 * LEVELING.XP_DELIVERY);

  // mixed flush: one harvest + one delivery in the same coalesced change
  xp0 = store.get('xp');
  store.update((s) => {
    s.achievements.counters.harvests += 1;
    s.achievements.counters.deliveries += 1;
  });
  store.flush();
  assert.equal(store.get('xp'), xp0 + LEVELING.XP_HARVEST + LEVELING.XP_DELIVERY);

  // non-counter changes never grant (no drift from unrelated flushes)
  xp0 = store.get('xp');
  store.set('coins', store.get('coins') + 1);
  store.flush();
  assert.equal(store.get('xp'), xp0);
  resetAchievementsEngineForTests();
});

test('V2/G23 engine: sickEver latch feeds neverSick bookkeeping', () => {
  resetAchievementsEngineForTests();
  const store = createStore(freshState(), { autosave: false });
  initAchievements({ store, ui: { toast: () => {} }, audio: { play: () => {} } });
  store.flush();
  store.update((s) => {
    s.health.state = 'sick';
  });
  store.flush();
  assert.equal(store.get('achievements.counters.sickEver'), 1, 'transition latched');
  store.update((s) => {
    s.health.state = 'healthy';
  });
  store.flush();
  store.update((s) => {
    s.health.state = 'sick';
  });
  store.flush();
  assert.equal(store.get('achievements.counters.sickEver'), 2, 'every transition counts');
  resetAchievementsEngineForTests();
});
// ═══════════════════════════════════════════════════════════ end V2/G23 ═══
