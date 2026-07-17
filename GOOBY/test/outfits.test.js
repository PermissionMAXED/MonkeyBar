// Outfit catalog integrity (§C5.3 slots/prices verbatim; V2/G22 grows the
// catalog to 20 per PLAN2 §C8.4), attach/idempotency of applyOutfits on real
// anchors, and equip persistence roundtrip through core/save.js (§E3 outfits
// slice). V2/G22 also covers the §C8.5 fur-skin applier's pure parts here.
import test from 'node:test';
import assert from 'node:assert/strict';

import { OUTFITS, OUTFITS_BY_ID, OUTFIT_SLOTS, getOutfit, outfitsForSlot } from '../src/data/outfits.js';
import { EN, DE } from '../src/data/strings.js';
import * as save from '../src/core/save.js';
import { applyOutfits, buildOutfitItem, applyEquippedOutfits } from '../src/character/outfitAttach.js';

// ------------------------------------------------------------ §C5.3 catalog

/** §C5.3 + §C8.4 binding table: id → [slot, price]. */
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
  // V2/G22 (§C8.4 verbatim)
  strawHat: ['hat', 160],
  chefHat: ['hat', 220],
  flowerCrown: ['hat', 180],
  wizardHat: ['hat', 350],
  heartGlasses: ['glasses', 220],
  monocle: ['glasses', 400],
  bandana: ['neck', 130],
  bellCollar: ['neck', 160],
  cape: ['neck', 500],
};

test('catalog has exactly the 20 §C5.3+§C8.4 items with verbatim slots and prices', () => {
  assert.equal(OUTFITS.length, 20); // §A3: outfits 11 → 20
  assert.deepEqual(
    new Set(OUTFITS.map((o) => o.id)),
    new Set(Object.keys(SPEC))
  );
  for (const [id, [slot, price]] of Object.entries(SPEC)) {
    const item = OUTFITS_BY_ID[id];
    assert.ok(item, `catalog missing ${id}`);
    assert.equal(item.slot, slot, `${id} slot`);
    assert.equal(item.price, price, `${id} price (§C5.3/§C8.4 binding)`);
  }
});

test('slot split per §C8.4: 9 hats, 5 glasses, 6 neck', () => {
  assert.deepEqual(OUTFIT_SLOTS, ['hat', 'glasses', 'neck']);
  assert.equal(outfitsForSlot('hat').length, 9);
  assert.equal(outfitsForSlot('glasses').length, 5);
  assert.equal(outfitsForSlot('neck').length, 6);
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

test('all 20 builders produce a non-empty group named for their slot', () => {
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

// ================ V2/G22 (PLAN2 §C8.5) — fur-skin applier pure parts ========
// applySkin recolors ONLY body/belly/earInner (shared materials + the rig's
// per-rig body clone); cheeks/nose/eyes stay untouched; golden gets
// metalness 0.25; idempotent. previewSkin tints one rig without leaking.
// createGooby needs a DOM canvas (face textures), so the rigs here mirror
// gooby.js's exact material wiring instead: ONE cloned goobyMat('body')
// shared by body/head/ears, the SHARED belly/earInner instances direct.
// NOTE: the shared gfx/materials.js instances are module-level singletons —
// every test restores the 'cream' default before returning.

/** Headless stand-in for createGooby()'s material structure (§D2.1). */
async function fakeRig() {
  const { Group, Mesh, SphereGeometry } = await import('three');
  const { goobyMat } = await import('../src/gfx/materials.js');
  const group = new Group();
  const geo = new SphereGeometry(0.1, 6, 4);
  const bodyClone = goobyMat('body').clone(); // per-rig clone (wet-look anim)
  for (const name of ['body', 'head']) {
    const m = new Mesh(geo, bodyClone);
    m.name = name;
    group.add(m);
  }
  for (const [name, matId] of [['belly', 'belly'], ['earInnerL', 'earInner'], ['cheekL', 'cheek']]) {
    const m = new Mesh(geo, goobyMat(matId)); // shared instances, like gooby.js
    m.name = name;
    group.add(m);
  }
  return { group };
}

test('applySkin swaps body/belly/earInner, leaves cheeks/nose/eyes, golden metalness', async () => {
  const { goobyMat } = await import('../src/gfx/materials.js');
  const { applySkin } = await import('../src/character/skins.js');
  const { getSkin, DEFAULT_SKIN } = await import('../src/data/skins.js');

  const gooby = await fakeRig();
  const hex = (mat) => `#${mat.color.getHexString().toUpperCase()}`;
  const bodyClone = gooby.group.getObjectByName('body').material;
  const cheekBefore = hex(goobyMat('cheek'));
  const noseBefore = hex(goobyMat('nose'));
  const eyeBefore = hex(goobyMat('eye'));

  try {
    applySkin(gooby, getSkin('midnight'));
    assert.equal(hex(goobyMat('body')), '#4C4A63'); // §C8.5 verbatim
    assert.equal(hex(goobyMat('belly')), '#8B89A6');
    assert.equal(hex(goobyMat('earInner')), '#C98BA8');
    assert.equal(hex(bodyClone), '#4C4A63'); // the rig's live clone re-tints
    // cheeks / nose / eyes untouched (§C8.5)
    assert.equal(hex(goobyMat('cheek')), cheekBefore);
    assert.equal(hex(goobyMat('nose')), noseBefore);
    assert.equal(hex(goobyMat('eye')), eyeBefore);

    // golden: subtle metalness 0.25 (§C8.5); other skins reset it to 0
    applySkin(gooby, getSkin('golden'));
    assert.equal(goobyMat('body').metalness, 0.25);
    assert.equal(bodyClone.metalness, 0.25);
    applySkin(gooby, getSkin('snow'));
    assert.equal(goobyMat('body').metalness, 0);

    // idempotent: applying twice changes nothing further
    applySkin(gooby, getSkin('snow'));
    assert.equal(hex(goobyMat('body')), '#FAFAFA');

    // a rig cloned AFTER the swap inherits the skin (minigame-cameo path:
    // gooby.js clones the shared body material at build time)
    assert.equal(hex(goobyMat('body').clone()), '#FAFAFA');
  } finally {
    applySkin(gooby, getSkin(DEFAULT_SKIN)); // restore the shared singletons
  }
  assert.equal(hex(goobyMat('body')), '#F6EAD7'); // cream default restored
  assert.equal(hex(bodyClone), '#F6EAD7');
});

test('previewSkin tints ONE rig only and clearSkinPreview restores it', async () => {
  const { goobyMat } = await import('../src/gfx/materials.js');
  const { previewSkin, clearSkinPreview } = await import('../src/character/skins.js');
  const { getSkin } = await import('../src/data/skins.js');

  const rigA = await fakeRig();
  const rigB = await fakeRig();
  const hex = (mat) => `#${mat.color.getHexString().toUpperCase()}`;
  const bellyOf = (rig) => rig.group.getObjectByName('belly').material;

  try {
    previewSkin(rigA, getSkin('rose'));
    // rig A wears the try-on (local belly clone + its own body clone)…
    assert.equal(hex(rigA.group.getObjectByName('body').material), '#F4C6D2');
    assert.equal(hex(bellyOf(rigA)), '#FBE8EE');
    // …while the SHARED materials and rig B stay cream (no leak)
    assert.equal(hex(goobyMat('body')), '#F6EAD7');
    assert.equal(hex(goobyMat('belly')), '#FFF9EC');
    assert.equal(hex(rigB.group.getObjectByName('body').material), '#F6EAD7');
    assert.equal(bellyOf(rigB), goobyMat('belly')); // still the shared instance

    clearSkinPreview(rigA);
    assert.equal(bellyOf(rigA), goobyMat('belly')); // shared material restored
    assert.equal(hex(rigA.group.getObjectByName('body').material), '#F6EAD7');
  } finally {
    clearSkinPreview(rigA);
  }
});
