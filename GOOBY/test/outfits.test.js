// Outfit catalog integrity (§C5.3 slots/prices verbatim), attach/idempotency
// of applyOutfits on real anchors, and equip persistence roundtrip through
// core/save.js (§E3 outfits slice).
import test from 'node:test';
import assert from 'node:assert/strict';

import { OUTFITS, OUTFITS_BY_ID, OUTFIT_SLOTS, getOutfit, outfitsForSlot } from '../src/data/outfits.js';
import { EN, DE } from '../src/data/strings.js';
import * as save from '../src/core/save.js';
import { applyOutfits, buildOutfitItem, applyEquippedOutfits } from '../src/character/outfitAttach.js';

// ------------------------------------------------------------ §C5.3 catalog

/** §C5.3 binding table: id → [slot, price]. */
const SPEC = {
  partyHat: ['hat', 120],
  beanie: ['hat', 100],
  cap: ['hat', 150],
  topHat: ['hat', 300],
  crown: ['hat', 1200],
  roundGlasses: ['glasses', 150],
  sunglasses: ['glasses', 200],
  starGlasses: ['glasses', 250],
  scarfRed: ['neck', 120],
  bowtie: ['neck', 140],
  scarfStriped: ['neck', 180],
};

test('catalog has exactly the 11 §C5.3 items with verbatim slots and prices', () => {
  assert.equal(OUTFITS.length, 11);
  assert.deepEqual(
    new Set(OUTFITS.map((o) => o.id)),
    new Set(Object.keys(SPEC))
  );
  for (const [id, [slot, price]] of Object.entries(SPEC)) {
    const item = OUTFITS_BY_ID[id];
    assert.ok(item, `catalog missing ${id}`);
    assert.equal(item.slot, slot, `${id} slot`);
    assert.equal(item.price, price, `${id} price (§C5.3 binding)`);
  }
});

test('slot split per §C5.3: 5 hats, 3 glasses, 3 neck', () => {
  assert.deepEqual(OUTFIT_SLOTS, ['hat', 'glasses', 'neck']);
  assert.equal(outfitsForSlot('hat').length, 5);
  assert.equal(outfitsForSlot('glasses').length, 3);
  assert.equal(outfitsForSlot('neck').length, 3);
  for (const item of OUTFITS) assert.ok(OUTFIT_SLOTS.includes(item.slot));
});

test('every outfit nameKey exists in BOTH string dictionaries (EN+DE)', () => {
  for (const item of OUTFITS) {
    assert.equal(typeof EN[item.nameKey], 'string', `EN missing ${item.nameKey}`);
    assert.equal(typeof DE[item.nameKey], 'string', `DE missing ${item.nameKey}`);
  }
});

test('getOutfit lookup', () => {
  assert.equal(getOutfit('crown').price, 1200);
  assert.equal(getOutfit('nope'), undefined);
});

// --------------------------------------------------- procedural attachment

/** Minimal stand-in for the §D2.3 anchors contract. */
async function fakeGooby() {
  const { Object3D } = await import('three');
  return {
    anchors: { hat: new Object3D(), glasses: new Object3D(), neck: new Object3D() },
  };
}

test('all 11 builders produce a non-empty group named for their slot', () => {
  for (const item of OUTFITS) {
    const group = buildOutfitItem(item.id);
    assert.ok(group, `builder missing for ${item.id}`);
    assert.equal(group.name, `outfit-${item.slot}`);
    let meshes = 0;
    group.traverse((obj) => {
      if (obj.isMesh) meshes += 1;
    });
    assert.ok(meshes >= 2, `${item.id} should be a composite (${meshes} meshes)`);
  }
  assert.equal(buildOutfitItem('bogus'), null);
});

test('applyOutfits is idempotent: one item per slot, swap replaces, null removes', async () => {
  const gooby = await fakeGooby();
  const outfitChildren = (slot) =>
    gooby.anchors[slot].children.filter((c) => c.name.startsWith('outfit-'));

  assert.equal(applyOutfits(gooby, { hat: 'crown', glasses: 'starGlasses', neck: 'scarfRed' }), true);
  for (const slot of OUTFIT_SLOTS) assert.equal(outfitChildren(slot).length, 1);
  assert.equal(outfitChildren('hat')[0].userData.outfitId, 'crown');

  // same map again → still exactly one per slot (no stacking)
  applyOutfits(gooby, { hat: 'crown', glasses: 'starGlasses', neck: 'scarfRed' });
  for (const slot of OUTFIT_SLOTS) assert.equal(outfitChildren(slot).length, 1);

  // swap the hat → previous crown replaced by topHat
  applyOutfits(gooby, { hat: 'topHat', glasses: 'starGlasses', neck: 'scarfRed' });
  assert.equal(outfitChildren('hat').length, 1);
  assert.equal(outfitChildren('hat')[0].userData.outfitId, 'topHat');

  // undress
  applyOutfits(gooby, {});
  for (const slot of OUTFIT_SLOTS) assert.equal(outfitChildren(slot).length, 0);
});

test('applyOutfits resolves named anchor nodes inside a bare THREE.Group', async () => {
  const { Group, Object3D } = await import('three');
  const root = new Group();
  const inner = new Group();
  root.add(inner);
  for (const slot of OUTFIT_SLOTS) {
    const a = new Object3D();
    a.name = `anchor-${slot}`;
    inner.add(a);
  }
  assert.equal(applyOutfits(root, { neck: 'bowtie' }), true);
  const neckAnchor = inner.children.find((c) => c.name === 'anchor-neck');
  assert.equal(neckAnchor.children.filter((c) => c.name === 'outfit-neck').length, 1);
  assert.equal(applyOutfits(new Group(), { hat: 'cap' }), false); // no anchors
});

test('applyEquippedOutfits is a safe no-op before initOutfitSync', async () => {
  assert.equal(applyEquippedOutfits(await fakeGooby()), false);
});

// ------------------------------------------------------ persistence roundtrip

test('equip persistence roundtrip: owned + equipped survive save/load (§E3)', () => {
  save.clear();
  const { state } = save.load();
  assert.deepEqual(state.outfits, { owned: [], equipped: { hat: null, glasses: null, neck: null } });

  state.outfits.owned = ['crown', 'starGlasses', 'scarfRed', 'beanie'];
  state.outfits.equipped = { hat: 'crown', glasses: 'starGlasses', neck: 'scarfRed' };
  save.persist(state);

  const reloaded = save.load();
  assert.equal(reloaded.fresh, false);
  assert.deepEqual(reloaded.state.outfits.owned, ['crown', 'starGlasses', 'scarfRed', 'beanie']);
  assert.deepEqual(reloaded.state.outfits.equipped, {
    hat: 'crown',
    glasses: 'starGlasses',
    neck: 'scarfRed',
  });
  save.clear();
});
