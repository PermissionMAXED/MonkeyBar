// Sticker album engine (§B7/§C6): award/count/first-time flag, set progress,
// set completion + single claim, completion-reward passthrough, and purity.
// Fixture sets mirror the §C6 table (fish 8 / veggies 8 / landmarks 6 /
// treats 10 = 4 sets, 32 stickers) — the engine is catalog-injected
// (§E0.1-3), the real catalog (data/collections.js) lands with G16.
//
// Fish species-roll tests (seeded size/color → species mapping, goldenFish
// 2% over 10k rolls, night-gated nightEel) belong to G23's fishingPond work
// (wave 2, §C6 row 1) — add them here alongside that wiring.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  entryKey,
  award,
  countOf,
  isSetComplete,
  setProgress,
  claimSet,
} from '../src/systems/collections.js';

// §C6 sets (entry ids verbatim; rewards = coins + procedural deco §C6).
const FISH = {
  id: 'fish',
  entries: ['sunnyCarp', 'blueDace', 'pinkKoi', 'stripeBass', 'tinyMinnow', 'bigWhopper', 'nightEel', 'goldenFish'],
  reward: { coins: 200, furnitureId: 'goldfishBowl' },
};
const VEGGIES = {
  id: 'veggies',
  entries: ['radish', 'carrot', 'salad', 'tomato', 'corn', 'eggplant', 'pumpkin', 'watermelon'],
  reward: { coins: 150, furnitureId: 'goldenWateringCan' },
};
const LANDMARKS = {
  id: 'landmarks',
  entries: ['shop', 'vetClinic', 'fountain', 'skyTower', 'parkGazebo', 'windmillCafe'],
  reward: { coins: 150, furnitureId: 'toyCity' },
};
const TREATS = {
  id: 'treats',
  entries: ['donut-sprinkles', 'cupcake', 'ice-cream', 'cake', 'cookie', 'candy-bar', 'lollypop', 'sundae', 'chocolate', 'muffin'],
  reward: { coins: 150, furnitureId: 'candyJar' },
};
const SETS = [FISH, VEGGIES, LANDMARKS, TREATS];

/** Fresh §B2 collections slice (defaults land in save.js with G16). */
function freshCollections() {
  return { entries: {}, claimedSets: {} };
}

test('§C6 fixture shape: 4 sets, 8/8/6/10 entries = 32 stickers', () => {
  assert.deepEqual(SETS.map((s) => s.entries.length), [8, 8, 6, 10]);
  assert.equal(SETS.reduce((n, s) => n + s.entries.length, 0), 32);
});

// ------------------------------------------------------------------ award

test('award: first-time flag exactly once, counts stack on repeats (§B7)', () => {
  const c0 = freshCollections();
  const a1 = award(c0, 'veggies', 'carrot');
  assert.equal(a1.first, true);
  assert.equal(countOf(a1.c, 'veggies', 'carrot'), 1);
  assert.equal(a1.c.entries[entryKey('veggies', 'carrot')], 1); // §B2 key shape
  const a2 = award(a1.c, 'veggies', 'carrot');
  assert.equal(a2.first, false); // repeat — no second sticker toast
  assert.equal(countOf(a2.c, 'veggies', 'carrot'), 2);
  assert.equal(c0.entries[entryKey('veggies', 'carrot')], undefined); // pure
});

test('award: n > 1 in one call; invalid n is a same-reference no-op', () => {
  const c0 = freshCollections();
  const a = award(c0, 'fish', 'tinyMinnow', 3);
  assert.equal(a.first, true);
  assert.equal(countOf(a.c, 'fish', 'tinyMinnow'), 3);
  for (const bad of [0, -2, NaN]) {
    const r = award(a.c, 'fish', 'tinyMinnow', bad);
    assert.equal(r.c, a.c);
    assert.equal(r.first, false);
  }
});

test('award: same entry id in different sets counts independently', () => {
  // 'carrot' exists as a veggie sticker AND as a plain food id — the
  // '<setId>.<entryId>' key namespaces them (§B2).
  let c = freshCollections();
  c = award(c, 'veggies', 'carrot').c;
  assert.equal(countOf(c, 'treats', 'carrot'), 0);
  assert.equal(countOf(c, 'veggies', 'carrot'), 1);
});

// ------------------------------------------------- progress / completion

test('setProgress counts distinct stickers owned vs set size', () => {
  let c = freshCollections();
  assert.deepEqual(setProgress(c, LANDMARKS), { have: 0, total: 6 });
  c = award(c, 'landmarks', 'shop').c;
  c = award(c, 'landmarks', 'fountain').c;
  c = award(c, 'landmarks', 'fountain').c; // repeats don't inflate `have`
  assert.deepEqual(setProgress(c, LANDMARKS), { have: 2, total: 6 });
  assert.equal(isSetComplete(c, 'landmarks', LANDMARKS), false);
});

test('isSetComplete: true only when every entry is owned ≥ 1 (all 4 sets)', () => {
  for (const setDef of SETS) {
    let c = freshCollections();
    for (const entryId of setDef.entries.slice(0, -1)) {
      c = award(c, setDef.id, entryId).c;
    }
    assert.equal(isSetComplete(c, setDef.id, setDef), false, `${setDef.id} one short`);
    c = award(c, setDef.id, setDef.entries.at(-1)).c;
    assert.equal(isSetComplete(c, setDef.id, setDef), true, `${setDef.id} complete`);
    assert.deepEqual(setProgress(c, setDef), { have: setDef.entries.length, total: setDef.entries.length });
  }
});

test('veggie set completes via first-harvest awards of all 8 §C2.3 crops', () => {
  // garden.harvest → collections.award(c, 'veggies', cropId) is the §B7 wiring
  let c = freshCollections();
  const firsts = [];
  for (const cropId of VEGGIES.entries) {
    const r = award(c, 'veggies', cropId);
    firsts.push(r.first);
    c = r.c;
  }
  assert.ok(firsts.every(Boolean), 'every first harvest flags a sticker toast');
  assert.equal(isSetComplete(c, 'veggies', VEGGIES), true);
});

// ------------------------------------------------------------- claimSet

test('claimSet: reward passthrough once, then permanently guarded (§B7/§C6)', () => {
  const NOW = 1_800_000_000_000;
  let c = freshCollections();
  for (const id of TREATS.entries) c = award(c, 'treats', id).c;
  const r = claimSet(c, 'treats', TREATS, NOW);
  assert.deepEqual(r.reward, { coins: 150, furnitureId: 'candyJar' }); // verbatim passthrough
  assert.equal(r.c.claimedSets.treats, NOW); // §B2: '<setId>' → timestampMs
  assert.deepEqual(claimSet(r.c, 'treats', TREATS, NOW + 1), { ok: false }); // single claim
  // extra awards after the claim never re-open it
  const later = award(r.c, 'treats', 'cookie').c;
  assert.deepEqual(claimSet(later, 'treats', TREATS, NOW + 2), { ok: false });
});

test('claimSet: refuses while incomplete; other sets stay independent', () => {
  const NOW = 1_800_000_000_000;
  let c = freshCollections();
  c = award(c, 'fish', 'sunnyCarp').c;
  assert.deepEqual(claimSet(c, 'fish', FISH, NOW), { ok: false });
  // completing + claiming veggies leaves fish unclaimed and unclaimable
  for (const id of VEGGIES.entries) c = award(c, 'veggies', id).c;
  const r = claimSet(c, 'veggies', VEGGIES, NOW);
  assert.equal(r.c.claimedSets.veggies, NOW);
  assert.equal(r.c.claimedSets.fish, undefined);
  assert.deepEqual(claimSet(r.c, 'fish', FISH, NOW), { ok: false });
});

test('object-shaped entries ({id}) are accepted — catalog format tolerance', () => {
  const setDef = {
    id: 'mini',
    entries: [{ id: 'a' }, { id: 'b' }],
    reward: { coins: 10 },
  };
  let c = freshCollections();
  c = award(c, 'mini', 'a').c;
  assert.deepEqual(setProgress(c, setDef), { have: 1, total: 2 });
  c = award(c, 'mini', 'b').c;
  assert.equal(isSetComplete(c, 'mini', setDef), true);
});

// ---------------------------------------------------------------- purity

test('collections functions are pure: deep-frozen slices never throw/mutate', () => {
  const freeze = (o) => {
    for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v);
    return Object.freeze(o);
  };
  let c = freshCollections();
  for (const id of LANDMARKS.entries) c = award(c, 'landmarks', id).c;
  const frozen = freeze(c);
  const claimed = claimSet(frozen, 'landmarks', LANDMARKS, 123).c;
  assert.equal(claimed.claimedSets.landmarks, 123);
  assert.equal(frozen.claimedSets.landmarks, undefined);
  award(freeze(claimed), 'landmarks', 'shop');
  setProgress(frozen, LANDMARKS);
});
