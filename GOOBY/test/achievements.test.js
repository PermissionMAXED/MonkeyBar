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
};

function freshState() {
  return defaultState();
}

// ------------------------------------------------------------------ catalog

test('catalog has all 16 §C8.3 achievements with verbatim coin rewards', () => {
  assert.equal(ACHIEVEMENTS.length, 16);
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
  assert.equal(MINIGAME_IDS.length, 12);
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
  const r = applyUnlocks(state, 1);
  assert.deepEqual(new Set(r.unlocked.map((d) => d.id)), new Set(['coins1000', 'level10', 'tickle100']));
  assert.equal(r.state.coins, 1000 + 50 + 100 + 60);
});

test('every one of the 16 achievements is unlockable through applyUnlocks', () => {
  const state = freshState();
  state.coins = 1000;
  state.level = 10;
  Object.assign(state.achievements.counters, {
    feeds: 100, washes: 50, sleeps: 20, trips: 25, cleanTrips: 1, tickles: 100,
  });
  state.outfits.equipped = { hat: 'crown', glasses: 'starGlasses', neck: 'scarfRed' };
  state.furniture.placed = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`living:slot${i}`, `fancyItem${i}`])
  );
  state.daily.streak = 7;
  for (const id of MINIGAME_IDS) state.minigames.plays[id] = 1;
  const r = applyUnlocks(state, 7);
  assert.equal(r.unlocked.length, 16, 'all 16 unlock');
  const totalRewards = Object.values(SPEC_COINS).reduce((a, b) => a + b, 0);
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
