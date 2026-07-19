// V4/G79 — PLAN4-GAMES §G9.2/§G9.3 food catalog, chips and care seam.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/core/store.js';
import { defaultState } from '../src/core/save.js';
import {
  FOODS,
  V4_BAKERY_FOODS,
  getFood,
  visibleFoodValues,
} from '../src/data/foods.js';
import { EN, DE } from '../src/data/strings.js';
import { buyFood } from '../src/systems/economy.js';
import { count as invCount } from '../src/systems/inventory.js';
import { feedGooby } from '../src/home/interactions.js';

const SPEC = Object.freeze({
  croissant: Object.freeze({
    name: ['Croissant', 'Croissant'],
    price: 12,
    deltas: Object.freeze({ hunger: 14, fun: 4, energy: 2, hygiene: -1 }),
    junk: false,
    modelKey: 'baked-goods/croissant',
  }),
  cupcakePink: Object.freeze({
    name: ['Pink Cupcake', 'Rosa Cupcake'],
    price: 14,
    deltas: Object.freeze({ hunger: 10, fun: 10, energy: 2, hygiene: -2 }),
    junk: true,
    modelKey: 'baked-goods/cupcake',
  }),
  cinnamonRoll: Object.freeze({
    name: ['Cinnamon Roll', 'Zimtschnecke'],
    price: 16,
    deltas: Object.freeze({ hunger: 16, fun: 8, energy: 3, hygiene: -2 }),
    junk: true,
    modelKey: 'baked-goods/cinnamon-roll',
  }),
});

test('V4/G79 bakery definitions are exact, unique and bilingual (§G9.3)', () => {
  assert.equal(V4_BAKERY_FOODS.length, 3);
  assert.deepEqual(V4_BAKERY_FOODS.map((food) => food.id), Object.keys(SPEC));
  assert.equal(FOODS.length, 35, '33 baseline + 2 new ids; croissant upgrades its existing v2 id');
  assert.equal(new Set(FOODS.map((food) => food.id)).size, FOODS.length, 'catalog ids stay unique');

  for (const [id, expected] of Object.entries(SPEC)) {
    const food = getFood(id);
    assert.ok(food, `${id} is in the catalog`);
    assert.equal(food.price, expected.price, `${id} price`);
    assert.deepEqual(food.deltas, expected.deltas, `${id} deltas`);
    assert.equal(food.junk, expected.junk, `${id} junk flag`);
    assert.equal(food.modelKey, expected.modelKey, `${id} model`);
    assert.equal(EN[food.nameKey], expected.name[0], `${id} EN`);
    assert.equal(DE[food.nameKey], expected.name[1], `${id} DE`);
  }
});

test('V4/G79 food chips expose only non-zero hunger/fun in stable order (§G9.2)', () => {
  assert.deepEqual(visibleFoodValues(getFood('croissant')), [
    ['hunger', 14],
    ['fun', 4],
  ]);
  assert.deepEqual(visibleFoodValues(getFood('banana')), [['hunger', 11]]);
  assert.deepEqual(visibleFoodValues({
    deltas: { hunger: 0, fun: 0, energy: 99, hygiene: -99 },
  }), []);
});

test('V4/G79 bakery foods are purchasable and feed with exact stat deltas', () => {
  for (const [id, expected] of Object.entries(SPEC)) {
    const store = createStore(defaultState());
    store.set('coins', 100);
    assert.deepEqual(buyFood(store, id), { ok: true, total: expected.price }, `${id} purchase`);
    assert.equal(store.get('coins'), 100 - expected.price, `${id} spend`);
    assert.equal(invCount(store.get('inventory'), id), 1, `${id} inventory`);

    const before = { hunger: 20, fun: 30, energy: 40, hygiene: 50 };
    const result = feedGooby({
      stats: before,
      inventory: store.get('inventory'),
      xp: 0,
      level: 1,
      health: 'healthy',
    }, id);
    assert.equal(result.ok, true, `${id} feed`);
    assert.deepEqual(result.stats, {
      hunger: before.hunger + expected.deltas.hunger,
      fun: before.fun + expected.deltas.fun,
      energy: before.energy + expected.deltas.energy,
      hygiene: before.hygiene + expected.deltas.hygiene,
    }, `${id} exact applied deltas`);
    assert.equal(invCount(result.inventory, id), 0, `${id} consumed`);
  }
});
