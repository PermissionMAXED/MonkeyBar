import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SLOTS,
  SLOT_IDS,
  COSMETICS,
  getCosmetic,
  getCosmeticsBySlot,
} from '../src/cosmetics.js';

test('slots are exactly hat/skin/table/deco', () => {
  assert.deepEqual(Object.values(SLOTS).sort(), ['deco', 'hat', 'skin', 'table']);
  assert.deepEqual([...SLOT_IDS].sort(), ['deco', 'hat', 'skin', 'table']);
});

test('catalog ids are unique', () => {
  const ids = COSMETICS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate cosmetic id in catalog');
});

test('every item has a valid slot and the full {id,name,glyph,desc,slot,price,minLevel} shape', () => {
  const validSlots = new Set(Object.values(SLOTS));
  for (const c of COSMETICS) {
    assert.ok(validSlots.has(c.slot), `${c.id}: invalid slot '${c.slot}'`);
    assert.ok(typeof c.id === 'string' && c.id.length > 0, `${c.id}: id`);
    assert.ok(typeof c.name === 'string' && c.name.length > 0, `${c.id}: name`);
    assert.ok(typeof c.glyph === 'string' && c.glyph.length > 0, `${c.id}: glyph`);
    assert.ok(typeof c.desc === 'string' && c.desc.length > 0, `${c.id}: desc`);
    assert.ok(Number.isInteger(c.price), `${c.id}: price`);
    assert.ok(Number.isInteger(c.minLevel), `${c.id}: minLevel`);
  }
});

test('all 4 legacy slice ids survive into 1.0 (vip_stool re-slotted to table)', () => {
  const legacy = ['banana_pin', 'neon_shades', 'crown_of_the_bar', 'vip_stool'];
  for (const id of legacy) {
    assert.ok(getCosmetic(id), `legacy id '${id}' missing from catalog`);
  }
  assert.equal(getCosmetic('banana_pin').slot, SLOTS.HAT);
  assert.equal(getCosmetic('neon_shades').slot, SLOTS.HAT);
  assert.equal(getCosmetic('crown_of_the_bar').slot, SLOTS.HAT);
  assert.equal(getCosmetic('vip_stool').slot, SLOTS.TABLE);
});

test('slot counts match §B.4: 8 hats, 6 skins, 4 tables, 4 deco', () => {
  assert.equal(getCosmeticsBySlot(SLOTS.HAT).length, 8);
  assert.equal(getCosmeticsBySlot(SLOTS.SKIN).length, 6);
  assert.equal(getCosmeticsBySlot(SLOTS.TABLE).length, 4);
  assert.equal(getCosmeticsBySlot(SLOTS.DECO).length, 4);
  assert.equal(COSMETICS.length, 22);
});

test('§B.4 named items are all present in their slots', () => {
  const bySlot = (slot) => getCosmeticsBySlot(slot).map((c) => c.id).sort();
  assert.deepEqual(
    bySlot(SLOTS.HAT),
    ['banana_pin', 'chef_toque', 'crown_of_the_bar', 'gold_monocle', 'neon_shades', 'party_cone', 'pirate_hat', 'propeller_cap']
  );
  assert.deepEqual(
    bySlot(SLOTS.SKIN),
    ['albino', 'cherry', 'gilded', 'midnight', 'neon_lime', 'royal_purple']
  );
  assert.deepEqual(
    bySlot(SLOTS.DECO),
    ['disco_ball', 'golden_cannon', 'lava_lamp_rail', 'parrot_perch']
  );
  assert.ok(bySlot(SLOTS.TABLE).includes('vip_stool'));
});

test('prices are 50–500 and minLevels are 1–10 for every item', () => {
  for (const c of COSMETICS) {
    assert.ok(c.price >= 50 && c.price <= 500, `${c.id}: price ${c.price} out of 50–500`);
    assert.ok(c.minLevel >= 1 && c.minLevel <= 10, `${c.id}: minLevel ${c.minLevel} out of 1–10`);
  }
});

test('lookup helpers behave', () => {
  assert.equal(getCosmetic('nope'), undefined);
  assert.deepEqual(getCosmeticsBySlot('nope'), []);
  const crown = getCosmetic('crown_of_the_bar');
  assert.equal(crown.price, 500);
  assert.equal(crown.minLevel, 10);
});
