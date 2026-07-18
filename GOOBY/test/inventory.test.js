// Inventory ops (§B systems/inventory.js) — pure, immutable.
import test from 'node:test';
import assert from 'node:assert/strict';

import { add, remove, count, has, totalCount, list } from '../src/systems/inventory.js';
import { ECONOMY } from '../src/data/constants.js';

test('starter inventory matches §C5.1 (3 carrot, 1 apple, 1 cupcake)', () => {
  assert.deepEqual(ECONOMY.STARTER_INVENTORY, { carrot: 3, apple: 1, cupcake: 1 });
  assert.equal(totalCount(ECONOMY.STARTER_INVENTORY), 5);
});

test('add creates and increments entries', () => {
  let inv = {};
  inv = add(inv, 'carrot');
  inv = add(inv, 'carrot', 2);
  inv = add(inv, 'pizza');
  assert.equal(count(inv, 'carrot'), 3);
  assert.equal(count(inv, 'pizza'), 1);
  assert.equal(totalCount(inv), 4);
});

test('remove decrements, deletes zero entries, returns null when insufficient', () => {
  let inv = { carrot: 2 };
  inv = remove(inv, 'carrot');
  assert.equal(count(inv, 'carrot'), 1);
  inv = remove(inv, 'carrot');
  assert.equal(inv.carrot, undefined); // zero entries removed
  assert.equal(remove(inv, 'carrot'), null); // nothing left
  assert.equal(remove({ apple: 1 }, 'apple', 2), null); // not enough
  assert.equal(remove({}, 'nope'), null);
});

test('has / count on missing ids', () => {
  assert.equal(count({}, 'carrot'), 0);
  assert.equal(has({}, 'carrot'), false);
  assert.equal(has({ carrot: 3 }, 'carrot', 3), true);
  assert.equal(has({ carrot: 3 }, 'carrot', 4), false);
});

test('V2/FIX-A: count coerces junk-typed values to 0 (never NaN)', () => {
  assert.equal(count({ carrot: 'many' }, 'carrot'), 0);
  assert.equal(count({ carrot: null }, 'carrot'), 0);
  assert.equal(count({ carrot: -4 }, 'carrot'), 0);
  assert.equal(count({ carrot: '2' }, 'carrot'), 2); // numeric strings coerce
  assert.equal(totalCount({ carrot: 'many', apple: 1 }), 1);
});

test('operations are immutable (inputs untouched)', () => {
  const inv = { carrot: 2 };
  add(inv, 'carrot');
  remove(inv, 'carrot');
  assert.deepEqual(inv, { carrot: 2 });
});

test('invalid amounts are no-ops', () => {
  const inv = { carrot: 2 };
  assert.deepEqual(add(inv, 'carrot', 0), { carrot: 2 });
  assert.deepEqual(add(inv, 'carrot', -3), { carrot: 2 });
  assert.deepEqual(remove(inv, 'carrot', 0), { carrot: 2 });
});

test('list returns positive-count entries for UI trays', () => {
  const l = list({ carrot: 2, apple: 0, cake: 1 });
  assert.deepEqual(l, [
    { id: 'carrot', count: 2 },
    { id: 'cake', count: 1 },
  ]);
});
