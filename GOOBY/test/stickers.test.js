// V3/G34 — sticker catalog integrity (PLAN3 §C5.1/§C5.2, binding). THE WAVE
// GATE: catalog ↔ committed PNG 1:1 (fails on missing OR extra files), every
// art 512×512 ≤ 150 KB (§C5.2/§D6), the 28 frozen ids in §C5.1 table order,
// every condition row verbatim against an independent spec copy, EN/DE
// title/flavor/hint parity, and — via the pure engine — all 28 unlockable
// through their real condition shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';

import {
  STICKERS, STICKERS_BY_ID, getSticker, TOTAL_BOOK_STICKERS,
  STICKER_PAGE_SIZES, stickerPages,
} from '../src/data/stickers.js';
import {
  stickerProgress, isStickerSatisfied, applyStickerUnlocks,
} from '../src/systems/stickerBook.js';
import { defaultState } from '../src/core/save.js';
import { EN, DE } from '../src/data/strings.js';

const ART_DIR = new URL('../public/assets/stickers/', import.meta.url);

// --- §C5.1 spec copy (independent — catalog drift fails here) ---------------
// id → cond, in FROZEN table order.
const SPEC_CONDS = [
  ['firstNom', { counter: 'feeds', target: 1 }],
  ['squeakyClean', { counter: 'washes', target: 1 }],
  ['ballBuddy', { counter: 'balls', target: 10 }],
  ['sleepyhead', { counter: 'sleeps', target: 1 }],
  ['tenNights', { counter: 'sleeps', target: 10 }],
  ['grumpMorning', { event: 'grumpyWake' }],
  ['feverFace', { counter: 'sickEver', target: 1 }],
  ['drGooby', { counter: 'vetTrips', target: 1 }],
  ['firstSprout', { counter: 'harvests', target: 1 }],
  ['rainyDay', { event: 'rainCanopy' }],
  ['starGazer', { event: 'nightStars' }],
  ['sayCheese', { counter: 'photosTaken', target: 1 }],
  ['bigTen', { special: 'level', target: 10 }],
  ['quarterClub', { special: 'level', target: 25 }],
  ['maxLevel', { special: 'level', target: 40 }],
  ['roadTripper', { counter: 'trips', target: 1 }],
  ['towTrouble', { event: 'towed' }],
  ['goldenCatch', { special: 'collectionEntry', set: 'fish', entry: 'goldenFish', target: 1 }],
  ['discoGooby', { special: 'gameBest', game: 'danceParty', target: 100 }],
  ['holeInOneHero', { counter: 'holeInOnes', target: 1 }],
  ['parcelPro', { counter: 'deliveries', target: 10 }],
  ['freshDrip', { special: 'skinsOwned', target: 2 }],
  ['fullFit', { special: 'fullOutfit', target: 3 }],
  ['maxFloof', { special: 'weightMax', target: 86 }],
  ['nutellaGlob', { counter: 'nougatGlobs', target: 1 }],
  ['cakeBoss', { counter: 'perfectCakes', target: 1 }],
  ['surfStar', { counter: 'surfRuns', target: 1 }],
  ['albumMaster', { special: 'setsClaimed', target: 4 }],
];

// ------------------------------------------------------------------ catalog

test('28 stickers, §C5.1 ids in frozen table order, unique', () => {
  assert.equal(STICKERS.length, 28);
  assert.equal(TOTAL_BOOK_STICKERS, 28);
  assert.deepEqual(STICKERS.map((s) => s.id), SPEC_CONDS.map(([id]) => id));
  assert.equal(new Set(STICKERS.map((s) => s.id)).size, 28);
  assert.equal(getSticker('firstNom'), STICKERS[0]);
  assert.equal(getSticker('bogus'), undefined);
});

test('every condition row matches §C5.1 verbatim', () => {
  for (const [id, cond] of SPEC_CONDS) {
    assert.deepEqual({ ...STICKERS_BY_ID[id].cond }, cond, `cond for ${id}`);
  }
});

test('defs carry nameKey/flavorKey/hintKey/art in the §B5 shapes', () => {
  for (const s of STICKERS) {
    assert.equal(s.nameKey, `stickerbook.${s.id}.name`);
    assert.equal(s.flavorKey, `stickerbook.${s.id}.flavor`);
    assert.equal(s.hintKey, `stickerbook.${s.id}.hint`);
    assert.equal(s.art, `assets/stickers/${s.id}.png`);
    assert.ok(Object.isFrozen(s), `${s.id} frozen`);
    assert.ok(Object.isFrozen(s.cond), `${s.id}.cond frozen`);
  }
});

test('§C5.3 page layout: 5 pages of 6/6/6/6/4, table order preserved', () => {
  assert.deepEqual([...STICKER_PAGE_SIZES], [6, 6, 6, 6, 4]);
  const pages = stickerPages();
  assert.deepEqual(pages.map((p) => p.length), [6, 6, 6, 6, 4]);
  assert.deepEqual(pages.flat().map((s) => s.id), STICKERS.map((s) => s.id));
});

test('every sticker title/flavor/hint exists in BOTH dictionaries (EN+DE)', () => {
  for (const s of STICKERS) {
    for (const key of [s.nameKey, s.flavorKey, s.hintKey]) {
      assert.equal(typeof EN[key], 'string', `EN missing ${key}`);
      assert.ok(EN[key].length > 0, `EN empty ${key}`);
      assert.equal(typeof DE[key], 'string', `DE missing ${key}`);
      assert.ok(DE[key].length > 0, `DE empty ${key}`);
    }
  }
  // §C5.1 verbatim spot checks (EN + DE title/flavor)
  assert.equal(EN['stickerbook.firstNom.name'], 'First Nom');
  assert.equal(DE['stickerbook.firstNom.name'], 'Erster Happs');
  assert.equal(EN['stickerbook.maxLevel.flavor'], 'There is no level 41. Gooby checked.');
  assert.equal(DE['stickerbook.maxLevel.flavor'], 'Es gibt kein Level 41. Gooby hat nachgesehen.');
  assert.equal(DE['stickerbook.albumMaster.name'], 'Album-Meister');
});

// ------------------------------------------- §C5.2 art files (the wave gate)

/** Parse width/height from a PNG's IHDR (bytes 16–23 after the signature). */
function pngSize(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.deepEqual(buf.subarray(0, 8), sig, 'PNG signature');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('catalog ↔ public/assets/stickers/*.png is exactly 1:1 (§C5.2 gate)', () => {
  const files = readdirSync(ART_DIR).filter((f) => f.endsWith('.png')).sort();
  const expected = STICKERS.map((s) => `${s.id}.png`).sort();
  assert.deepEqual(files, expected, 'no missing and no extra sticker art');
});

test('every sticker PNG is 512×512 and ≤ 150 KB (§C5.2/§D6)', () => {
  for (const s of STICKERS) {
    const url = new URL(`${s.id}.png`, ART_DIR);
    const bytes = statSync(url).size;
    assert.ok(bytes <= 150 * 1024, `${s.id}.png is ${bytes} B (> 150 KB)`);
    const { width, height } = pngSize(readFileSync(url));
    assert.equal(width, 512, `${s.id}.png width`);
    assert.equal(height, 512, `${s.id}.png height`);
  }
});

// ------------------------- all 28 unlockable via their REAL conditions (§B5)

/**
 * Build a state that legitimately satisfies every §C5.1 condition at once
 * (event stickers unlock via their hook path — asserted separately).
 */
function maxedState() {
  const s = defaultState();
  s.level = 40;
  s.weight.value = 86;
  Object.assign(s.achievements.counters, {
    feeds: 1, washes: 1, balls: 10, sleeps: 10, sickEver: 1, vetTrips: 1,
    harvests: 1, photosTaken: 1, trips: 1, holeInOnes: 1, deliveries: 10,
    nougatGlobs: 1, perfectCakes: 1, surfRuns: 1,
  });
  s.minigames.best.danceParty = 100;
  s.collections.entries['fish.goldenFish'] = 1;
  s.collections.claimedSets = { veggies: 1, fish: 1, landmarks: 1, treats: 1 };
  s.skins.owned = ['cream', 'snow'];
  s.outfits.equipped = { hat: 'crown', glasses: 'starGlasses', neck: 'scarfRed', back: null };
  return s;
}

test('all 24 counter/special stickers unlock through applyStickerUnlocks', () => {
  const eventIds = SPEC_CONDS.filter(([, c]) => c.event).map(([id]) => id);
  assert.deepEqual(eventIds, ['grumpMorning', 'rainyDay', 'starGazer', 'towTrouble']);
  const { state, unlocked } = applyStickerUnlocks(maxedState(), 777);
  assert.equal(unlocked.length, 28 - eventIds.length, '24 non-event stickers');
  for (const [id, cond] of SPEC_CONDS) {
    if (cond.event) {
      assert.equal(state.stickers.unlocked[id], undefined, `${id} needs its hook`);
    } else {
      assert.equal(state.stickers.unlocked[id], 777, `${id} unlocked`);
    }
  }
});

test('each individual condition flips exactly at its threshold', () => {
  for (const [id, cond] of SPEC_CONDS) {
    if (cond.event) continue;
    const def = STICKERS_BY_ID[id];
    const below = defaultState();
    const at = maxedState();
    // build a below-threshold variant of the maxed state for THIS sticker
    if (cond.counter) {
      Object.assign(below.achievements.counters, at.achievements.counters);
      below.achievements.counters[cond.counter] = cond.target - 1;
    } else if (cond.special === 'level') below.level = cond.target - 1;
    else if (cond.special === 'weightMax') below.weight.value = cond.target - 1;
    else if (cond.special === 'setsClaimed') below.collections.claimedSets = { veggies: 1 };
    else if (cond.special === 'skinsOwned') below.skins.owned = ['cream'];
    else if (cond.special === 'gameBest') below.minigames.best[cond.game] = cond.target - 1;
    else if (cond.special === 'collectionEntry') below.collections.entries = {};
    else if (cond.special === 'fullOutfit') {
      below.outfits.equipped = { hat: 'crown', glasses: 'starGlasses', neck: null, back: null };
    }
    assert.equal(isStickerSatisfied(def, below), false, `${id} below threshold`);
    assert.equal(isStickerSatisfied(def, at), true, `${id} at threshold`);
    const p = stickerProgress(def, at);
    assert.equal(p.current, p.target, `${id} progress caps at target`);
  }
});
