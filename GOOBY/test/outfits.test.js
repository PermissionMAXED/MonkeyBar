// Outfit catalog integrity (§C5.3 slots/prices verbatim; V2/G22 grows the
// catalog to 20 per PLAN2 §C8.4), attach/idempotency of applyOutfits on real
// anchors, and equip persistence roundtrip through core/save.js (§E3 outfits
// slice). V2/G22 also covers the §C8.5 fur-skin applier's pure parts here.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OUTFITS,
  OUTFITS_BY_ID,
  OUTFIT_SLOTS,
  OUTFIT_EQUIP_SLOTS,
  getOutfit,
  outfitsForSlot,
} from '../src/data/outfits.js';
import { EN, DE } from '../src/data/strings.js';
import { ACHIEVEMENTS } from '../src/data/achievements.js';
import { STICKERS } from '../src/data/stickers.js';
import * as save from '../src/core/save.js';
import { applyOutfits, buildOutfitItem, applyEquippedOutfits } from '../src/character/outfitAttach.js';
import { isSatisfied as isAchievementSatisfied } from '../src/systems/achievementsEngine.js';
import { isStickerSatisfied } from '../src/systems/stickerBook.js';

// ------------------------------------------------------------ §C5.3 catalog

/** §C5.3 + §C8.4 + §C13 binding table: id → [slot, price, minLevel]. */
const SPEC = {
  partyHat: ['hat', 120, 1],
  beanie: ['hat', 100, 1],
  cap: ['hat', 150, 1],
  topHat: ['hat', 300, 1],
  crown: ['hat', 1200, 1],
  roundGlasses: ['glasses', 150, 1],
  sunglasses: ['glasses', 200, 1],
  starGlasses: ['glasses', 250, 1],
  scarfRed: ['neck', 120, 1],
  bowtie: ['neck', 140, 1],
  scarfStriped: ['neck', 180, 1],
  // V2/G22 (§C8.4 verbatim)
  strawHat: ['hat', 160, 1],
  chefHat: ['hat', 220, 1],
  flowerCrown: ['hat', 180, 1],
  wizardHat: ['hat', 350, 1],
  heartGlasses: ['glasses', 220, 1],
  monocle: ['glasses', 400, 1],
  bandana: ['neck', 130, 1],
  bellCollar: ['neck', 160, 1],
  cape: ['neck', 500, 1],
  // V3/G40 (§C13.2 verbatim)
  sombrero: ['hat', 260, 6],
  pirateHat: ['hat', 320, 12],
  detectiveHat: ['hat', 280, 10],
  beret: ['hat', 180, 4],
  vikingHelm: ['hat', 380, 15],
  pumpkinHat: ['hat', 240, 8],
  spaceHelm: ['hat', 420, 18],
  chefToque: ['hat', 300, 6],
  aviatorGoggles: ['glasses', 260, 9],
  readingGlasses: ['glasses', 170, 3],
  eyepatch: ['glasses', 190, 12],
  stars3D: ['glasses', 310, 14],
  pearlNecklace: ['neck', 350, 13],
  flowerLei: ['neck', 220, 7],
  medalGold: ['neck', 400, 16],
  winterScarf: ['neck', 200, 5],
  backpackTiny: ['back', 280, 6],
  balloonRed: ['back', 240, 4],
  propellerPack: ['back', 450, 17],
  turtleShell: ['back', 320, 11],
  fairyWings: ['back', 500, 20],
  surfBoard: ['back', 380, 14],
};

test('catalog has exactly 42 §C5.3+§C8.4+§C13 items with verbatim rows', () => {
  assert.equal(OUTFITS.length, 42); // §A2: outfits 20 → 42
  assert.deepEqual(
    new Set(OUTFITS.map((o) => o.id)),
    new Set(Object.keys(SPEC))
  );
  for (const [id, [slot, price, minLevel]] of Object.entries(SPEC)) {
    const item = OUTFITS_BY_ID[id];
    assert.ok(item, `catalog missing ${id}`);
    assert.equal(item.slot, slot, `${id} slot`);
    assert.equal(item.price, price, `${id} price (§C5.3/§C8.4/§C13 binding)`);
    assert.equal(item.minLevel, minLevel, `${id} minLevel (§C13.2 binding/default 1)`);
  }
});

test('slot split per §C13: 17 hats, 9 glasses, 10 neck, 6 back', () => {
  assert.deepEqual(OUTFIT_SLOTS, ['hat', 'glasses', 'neck']);
  assert.deepEqual(OUTFIT_EQUIP_SLOTS, ['hat', 'glasses', 'neck', 'back']);
  assert.equal(outfitsForSlot('hat').length, 17);
  assert.equal(outfitsForSlot('glasses').length, 9);
  assert.equal(outfitsForSlot('neck').length, 10);
  assert.equal(outfitsForSlot('back').length, 6);
  for (const item of OUTFITS) assert.ok(OUTFIT_EQUIP_SLOTS.includes(item.slot));
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
    anchors: {
      hat: new Object3D(),
      glasses: new Object3D(),
      neck: new Object3D(),
      back: new Object3D(),
    },
  };
}

test('all 42 builders produce a non-empty group named for their slot', () => {
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

test('applyOutfits is idempotent across all 4 slots: swap replaces, null removes', async () => {
  const gooby = await fakeGooby();
  const outfitChildren = (slot) =>
    gooby.anchors[slot].children.filter((c) => c.name.startsWith('outfit-'));

  const full = {
    hat: 'crown',
    glasses: 'starGlasses',
    neck: 'scarfRed',
    back: 'backpackTiny',
  };
  assert.equal(applyOutfits(gooby, full), true);
  for (const slot of OUTFIT_EQUIP_SLOTS) assert.equal(outfitChildren(slot).length, 1);
  assert.equal(outfitChildren('hat')[0].userData.outfitId, 'crown');
  assert.equal(outfitChildren('back')[0].userData.outfitId, 'backpackTiny');

  // same map again → still exactly one per slot (no stacking)
  applyOutfits(gooby, full);
  for (const slot of OUTFIT_EQUIP_SLOTS) assert.equal(outfitChildren(slot).length, 1);

  // swap the hat → previous crown replaced by topHat
  applyOutfits(gooby, { ...full, hat: 'topHat' });
  assert.equal(outfitChildren('hat').length, 1);
  assert.equal(outfitChildren('hat')[0].userData.outfitId, 'topHat');

  // undress
  applyOutfits(gooby, {});
  for (const slot of OUTFIT_EQUIP_SLOTS) assert.equal(outfitChildren(slot).length, 0);
});

test('applyOutfits resolves named anchor nodes inside a bare THREE.Group', async () => {
  const { Group, Object3D } = await import('three');
  const root = new Group();
  const inner = new Group();
  root.add(inner);
  for (const slot of OUTFIT_EQUIP_SLOTS) {
    const a = new Object3D();
    a.name = `anchor-${slot}`;
    inner.add(a);
  }
  assert.equal(applyOutfits(root, { neck: 'bowtie', back: 'turtleShell' }), true);
  const neckAnchor = inner.children.find((c) => c.name === 'anchor-neck');
  assert.equal(neckAnchor.children.filter((c) => c.name === 'outfit-neck').length, 1);
  const backAnchor = inner.children.find((c) => c.name === 'anchor-back');
  assert.equal(backAnchor.children.filter((c) => c.name === 'outfit-back').length, 1);
  assert.equal(applyOutfits(new Group(), { hat: 'cap' }), false); // no anchors
});

test('applyEquippedOutfits is a safe no-op before initOutfitSync', async () => {
  assert.equal(applyEquippedOutfits(await fakeGooby()), false);
});

test('back anchor is created in outfitAttach at the §C13 offset and tracks weight scale', async () => {
  const THREE = await import('three');
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);
  const anchors = {};
  for (const slot of OUTFIT_SLOTS) {
    const anchor = new THREE.Object3D();
    anchor.name = `anchor-${slot}`;
    bodyRoot.add(anchor);
    anchors[slot] = anchor;
  }

  assert.equal(applyOutfits({ group, anchors }, { back: 'turtleShell' }), true);
  assert.ok(anchors.back, 'outfitAttach creates and exposes the new back anchor');
  assert.deepEqual(anchors.back.position.toArray(), [0, 0.34, -0.18]);
  assert.equal(anchors.back.children[0].userData.outfitId, 'turtleShell');

  anchors.neck.scale.set(1.14, 1, 1.14); // floof: gooby.js V2/FIX-C source
  anchors.back.userData.syncOutfitWeight();
  assert.deepEqual(anchors.back.scale.toArray(), [1.14, 1, 1.14]);
  assert.equal(anchors.back.position.z, -0.18 * 1.14);

  anchors.neck.scale.set(0.93, 1, 0.93); // sleek
  anchors.back.userData.syncOutfitWeight();
  assert.deepEqual(anchors.back.scale.toArray(), [0.93, 1, 0.93]);
  assert.equal(anchors.back.position.z, -0.18 * 0.93);
});

test('§C13.3 Full Fit sticker + achievement still require all 3 ORIGINAL slots', () => {
  const achievement = ACHIEVEMENTS.find((def) => def.id === 'fullOutfit');
  const sticker = STICKERS.find((def) => def.id === 'fullFit');
  const state = {
    outfits: {
      equipped: {
        hat: 'crown',
        glasses: 'starGlasses',
        neck: null,
        back: 'fairyWings',
      },
    },
  };
  assert.equal(isAchievementSatisfied(achievement, state), false, 'back cannot substitute for neck');
  assert.equal(isStickerSatisfied(sticker, state), false, 'back cannot substitute for neck');

  state.outfits.equipped.neck = 'cape';
  state.outfits.equipped.back = null;
  assert.equal(isAchievementSatisfied(achievement, state), true, '3 original slots unlock achievement');
  assert.equal(isStickerSatisfied(sticker, state), true, '3 original slots unlock sticker');
});

// ---------------------------------------------------------------------------
// V2/FIX-C (P1-1): neck items must stay visible at every weight tier.
// gooby.js setWeightTier scales the body lathe X/Z by the tier scale AND now
// scales anchors.neck (children included) the same way, so items grow with
// the belly. These tests replicate the §D2.2 pear profile + the §D2.3 neck
// anchor placement headlessly and assert the geometry contract: with the
// anchor tier-scaled, part of every neck item protrudes past the body
// surface at all four §C4.3 tiers.
// ---------------------------------------------------------------------------

/** §D2.2 pear profile control points (binding recipe table, x = radius). */
const PEAR_PROFILE = [
  [0, 0], [0.3, 0.02], [0.43, 0.2], [0.46, 0.4],
  [0.4, 0.58], [0.3, 0.7], [0.18, 0.76], [0, 0.78],
];

/** Max §D2.2 body radius near height y (same CatmullRom smoothing as gooby.js). */
async function bodyRadiusAt(y) {
  const { CatmullRomCurve3, Vector3 } = await import('three');
  const curve = new CatmullRomCurve3(PEAR_PROFILE.map(([x, py]) => new Vector3(x, py, 0)));
  let best = 0;
  for (let i = 0; i <= 2000; i += 1) {
    const p = curve.getPoint(i / 2000);
    if (Math.abs(p.y - y) < 0.005) best = Math.max(best, p.x);
  }
  return best;
}

/**
 * Largest protrusion (world radial XZ distance minus the tier-scaled body
 * radius at that height) over all mesh vertices of a neck item mounted on a
 * replica of the §D2.3 neck anchor with the P1-1 tier scaling applied.
 */
async function neckProtrusion(itemId, tierScale) {
  const THREE = await import('three');
  const root = new THREE.Group(); // body space: lathe axis at x=z=0
  const anchor = new THREE.Object3D();
  anchor.position.set(0, 0.62, 0.06 * tierScale); // gooby.js anchor re-fit
  anchor.scale.set(tierScale, 1, tierScale); // V2/FIX-C P1-1 anchor scaling
  root.add(anchor);
  const item = buildOutfitItem(itemId);
  anchor.add(item);
  root.updateMatrixWorld(true);

  let maxProtrusion = -Infinity;
  const v = new THREE.Vector3();
  const jobs = [];
  item.traverse((obj) => {
    if (!obj.isMesh) return;
    const pos = obj.geometry.getAttribute('position');
    jobs.push(async () => {
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
        const bodyR = (await bodyRadiusAt(v.y)) * tierScale; // body scales X/Z only
        maxProtrusion = Math.max(maxProtrusion, Math.hypot(v.x, v.z) - bodyR);
      }
    });
  });
  for (const job of jobs) await job();
  return maxProtrusion;
}

test('V2/FIX-C P1-1: every neck item protrudes past the body at all 4 weight tiers', async () => {
  const { WEIGHT } = await import('../src/systems/weight.js');
  const tiers = WEIGHT.TIERS.map((t) => WEIGHT.TIER_SCALE[t]);
  assert.deepEqual(tiers, [0.93, 1, 1.07, 1.14], '§C4.3 tier scales verbatim');
  for (const item of outfitsForSlot('neck')) {
    for (const scale of tiers) {
      const p = await neckProtrusion(item.id, scale);
      assert.ok(
        p > 0.01,
        `${item.id} must stick out ≥1 cm past the body at tier scale ${scale} (got ${p.toFixed(4)})`
      );
    }
  }
});

test('V2/FIX-C P1-1: cape clasp band + gold buttons clear the body at default tier', async () => {
  const THREE = await import('three');
  const cape = buildOutfitItem('cape');
  const anchor = new THREE.Object3D();
  anchor.position.set(0, 0.62, 0.06);
  anchor.add(cape);
  anchor.updateMatrixWorld(true);

  // regression: pre-fix the clasp band (r 0.325) + buttons sat INSIDE the
  // chest even at scale 1.00. Band sides must clear the lathe surface…
  const band = cape.children.find(
    (c) => c.isMesh && c.geometry.type === 'TorusGeometry' && c.geometry.parameters.radius > 0.3
  );
  assert.ok(band, 'cape has a clasp band torus');
  const bandBox = new THREE.Box3().setFromObject(band);
  const bandY = (bandBox.min.y + bandBox.max.y) / 2;
  const bodyAtBand = await bodyRadiusAt(bandY);
  assert.ok(
    bandBox.max.x > bodyAtBand + 0.01,
    `band side extent ${bandBox.max.x.toFixed(3)} must clear body radius ${bodyAtBand.toFixed(3)}`
  );

  // …and both gold buttons must sit proud of the surface at the front.
  const buttons = cape.children.filter(
    (c) => c.isMesh && c.geometry.type === 'SphereGeometry' && c.geometry.parameters.radius < 0.03
  );
  assert.equal(buttons.length, 2, 'two clasp buttons');
  for (const b of buttons) {
    const w = b.getWorldPosition(new THREE.Vector3());
    const bodyR = await bodyRadiusAt(w.y);
    assert.ok(
      Math.hypot(w.x, w.z) > bodyR,
      `button center radial ${Math.hypot(w.x, w.z).toFixed(3)} must exceed body radius ${bodyR.toFixed(3)} at y ${w.y.toFixed(2)}`
    );
  }
});

// ------------------------------------------------------ persistence roundtrip

test('equip persistence roundtrip: owned + equipped survive save/load (§E3)', () => {
  save.clear();
  const { state } = save.load();
  // V3/G34: schema v3 adds the 4th 'back' slot at null (§B1/§C13 — G40 wave 2)
  assert.deepEqual(state.outfits, {
    owned: [],
    equipped: { hat: null, glasses: null, neck: null, back: null },
  });

  state.outfits.owned = ['crown', 'starGlasses', 'scarfRed', 'fairyWings', 'beanie'];
  state.outfits.equipped = {
    hat: 'crown',
    glasses: 'starGlasses',
    neck: 'scarfRed',
    back: 'fairyWings',
  };
  save.persist(state);

  const reloaded = save.load();
  assert.equal(reloaded.fresh, false);
  assert.deepEqual(
    reloaded.state.outfits.owned,
    ['crown', 'starGlasses', 'scarfRed', 'fairyWings', 'beanie']
  );
  assert.deepEqual(reloaded.state.outfits.equipped, {
    hat: 'crown',
    glasses: 'starGlasses',
    neck: 'scarfRed',
    back: 'fairyWings',
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
