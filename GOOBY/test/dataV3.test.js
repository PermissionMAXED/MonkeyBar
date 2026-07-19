// V3/G34 — 3.0 data-spine integrity (PLAN3 §B8/§C5.5/§C6.4/§C8.5/§C9.5/
// §C10.1/§E0.1-3/-9, binding). Spec rows hardcoded as independent copies so
// a constants.js edit can never silently drift (dataV2.test.js precedent):
// the 6 new coin rows + unlock levels VERBATIM, minigames.js 27 ids +
// metadata rows, achievements 33 → 37 with verbatim §C5.5/§C6.4 rewards,
// and EN/DE parity for every v3-core / v3-stickers key.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SAVE, COIN_TABLE, UNLOCKS } from '../src/data/constants.js';
import { MINIGAME_IDS, MINIGAMES, MINIGAMES_BY_ID } from '../src/data/minigames.js';
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_ID } from '../src/data/achievements.js';
import { STICKERS } from '../src/data/stickers.js';
import { EN, DE } from '../src/data/strings.js';
import { EN as V3_CORE_EN, DE as V3_CORE_DE } from '../src/data/strings/v3-core.js';
import { EN as V3_STICKERS_EN, DE as V3_STICKERS_DE } from '../src/data/strings/v3-stickers.js';

/** Both dictionaries must carry a non-empty string for the key. */
function assertKey(key, label = key) {
  assert.equal(typeof EN[key], 'string', `EN missing ${label}`);
  assert.ok(EN[key].length > 0, `EN empty ${label}`);
  assert.equal(typeof DE[key], 'string', `DE missing ${label}`);
  assert.ok(DE[key].length > 0, `DE empty ${label}`);
}

// --- §E0.1-3 spec copies (binding, verbatim) --------------------------------

const V3_COIN_ROWS = {
  shoppingSurf: { divisor: 40, min: 5, max: 34 },  // §C8.5
  purblePlace: { divisor: 5, min: 5, max: 30 },    // §C9.5
  toyRacer: { divisor: 6, min: 5, max: 30 },       // §C10.1
  ghostHunt: { divisor: 4, min: 4, max: 28 },      // §C10.1
  rocketRescue: { divisor: 5, min: 4, max: 28 },   // §C10.1
  harborHopper: { divisor: 5, min: 4, max: 30 },   // §C10.1
};

const V3_UNLOCK_LEVELS = {
  shoppingSurf: 5,
  purblePlace: 6,
  toyRacer: 15,
  ghostHunt: 16,
  rocketRescue: 18,
  harborHopper: 20,
};

// ---------------------------------------------------------------- constants

test('SAVE.VERSION bumped to 3 (§B1 — the single §E0.1-3 spine edit)', () => {
  // V4/G53 (PLAN4 §B1): bumped again, 3 → 4 (saveV4.test.js owns the details)
  assert.equal(SAVE.VERSION, 4);
});

test('the 6 §E0.1-3 coin rows are verbatim', () => {
  for (const [id, row] of Object.entries(V3_COIN_ROWS)) {
    assert.deepEqual({ ...COIN_TABLE[id] }, row, `coin row ${id}`);
  }
});

test('the 6 §E0.1-3 unlock levels are verbatim (UNLOCKS.MINIGAMES)', () => {
  for (const [id, level] of Object.entries(V3_UNLOCK_LEVELS)) {
    assert.equal(UNLOCKS.MINIGAMES[id], level, `unlock level ${id}`);
  }
});

// ---------------------------------------------------------------- minigames

test('minigames.js lists exactly 27 shipping ids incl. the 6 new (§E0.1-9)', () => {
  // V4/G53: +goobyWelt (PLAN4 §E0.1) → 28
  assert.equal(MINIGAME_IDS.length, 28);
  for (const id of Object.keys(V3_COIN_ROWS)) {
    assert.ok(MINIGAME_IDS.includes(id), `${id} in MINIGAME_IDS`);
  }
  // registry stays 1:1 with the coin table (economy invariant)
  assert.deepEqual([...MINIGAME_IDS].sort(), Object.keys(COIN_TABLE).sort());
});

test('the 6 new metadata rows carry titleKey/minLevel/energy/coinTable (§E0.1-9)', () => {
  for (const [id, level] of Object.entries(V3_UNLOCK_LEVELS)) {
    const m = MINIGAMES_BY_ID[id];
    assert.ok(m, `${id} metadata row exists`);
    assert.equal(m.titleKey, `mg.title.${id}`);
    assert.equal(m.minLevel, level, `${id} minLevel`);
    assert.equal(m.energyCost, 8, `${id} energy (arcade rate — §C8.5/§C9.5/§C10.1)`);
    assert.deepEqual({ ...m.coinTable }, V3_COIN_ROWS[id], `${id} meta coin row`);
    assert.ok(typeof m.icon === 'string' && m.icon.length > 0, `${id} icon`);
    assert.equal(m.dev, undefined, `${id} is a shipping game`);
    assertKey(m.titleKey);
  }
  assert.equal(MINIGAMES.filter((m) => !m.dev).length, 28); // V4/G53: +goobyWelt
});

// -------------------------------------------------------------- achievements

test('achievements catalog is 37 with the verbatim §C5.5/§C6.4 additions', () => {
  assert.equal(ACHIEVEMENTS.length, 37); // 33 + stickerBook10/20/Full + nougatmeister
  const spec = {
    stickerBook10: ['stickerCount', 10, 50],
    stickerBook20: ['stickerCount', 20, 100],
    stickerBookFull: ['stickerCount', 28, 300],
  };
  for (const [id, [special, target, coins]] of Object.entries(spec)) {
    const a = ACHIEVEMENTS_BY_ID[id];
    assert.ok(a, `${id} exists`);
    assert.equal(a.special, special, `${id} special`);
    assert.equal(a.target, target, `${id} target`);
    assert.equal(a.coins, coins, `${id} coins (§C5.5 binding)`);
    assertKey(a.nameKey);
    assertKey(a.descKey);
  }
  const nougat = ACHIEVEMENTS_BY_ID.nougatmeister;
  assert.equal(nougat.counter, 'nougatGlobs', 'nougatmeister counter (§C6.4)');
  assert.equal(nougat.target, 25);
  assert.equal(nougat.coins, 80);
  assertKey(nougat.nameKey);
  assertKey(nougat.descKey);
});

// -------------------------------------------------- v3 string modules (EN/DE)

test('v3-core: EN/DE key parity and presence in the merged dictionaries', () => {
  assert.deepEqual(Object.keys(V3_CORE_EN).sort(), Object.keys(V3_CORE_DE).sort());
  for (const key of Object.keys(V3_CORE_EN)) assertKey(key, `v3-core ${key}`);
  // §C10.1 titles verbatim (EN / DE)
  assert.equal(EN['mg.title.toyRacer'], 'Toy Grand Prix');
  assert.equal(DE['mg.title.toyRacer'], 'Spielzeug-Rennen');
  assert.equal(EN['mg.title.ghostHunt'], 'Ghost Hunt');
  assert.equal(DE['mg.title.ghostHunt'], 'Geisterjagd');
  assert.equal(EN['mg.title.rocketRescue'], 'Rocket Rescue');
  assert.equal(DE['mg.title.rocketRescue'], 'Raketen-Rettung');
  assert.equal(EN['mg.title.harborHopper'], 'Harbor Hopper');
  assert.equal(DE['mg.title.harborHopper'], 'Hafen-Hüpfer');
  assert.equal(DE['mg.title.purblePlace'], 'Tortenwerkstatt'); // §C9.1
});

test('v3-stickers: EN/DE key parity; every catalog key + book chrome present', () => {
  assert.deepEqual(Object.keys(V3_STICKERS_EN).sort(), Object.keys(V3_STICKERS_DE).sort());
  for (const key of Object.keys(V3_STICKERS_EN)) assertKey(key, `v3-stickers ${key}`);
  for (const s of STICKERS) {
    // V4/G53: the secret herzGooby row (#29) is keyed in strings/v4-core.js
    if (s.secret) continue;
    for (const key of [s.nameKey, s.flavorKey, s.hintKey]) {
      assert.equal(typeof V3_STICKERS_EN[key], 'string', `v3-stickers owns ${key}`);
    }
  }
  for (const key of [
    'album.tab.collections', 'album.tab.book', 'stickerbook.page',
    'stickerbook.new', 'stickerbook.unknown', 'stickerbook.hintLabel',
    'stickerbook.unlockToast',
  ]) {
    assertKey(key, `book chrome ${key}`);
  }
});

test('v3 string modules never shadow a v1/v2 key (spread-order safety)', async () => {
  // The 17 v3-* modules are spread AFTER the v2 spreads in strings.js — a
  // duplicate key would silently override live copy. Assert zero collisions.
  const modules = [
    'v3-core', 'v3-stickers', 'v3-audio', 'v3-ux', 'v3-dev', 'v3-nutella',
    'v3-cake', 'v3-surf', 'v3-travel', 'v3-drive', 'v3-outfits',
    'v3-games-f', 'v3-games-g', 'v3-depth-a', 'v3-depth-b', 'v3-depth-c',
    'v3-polish',
  ];
  const seen = new Map(); // key → module (across all v3 modules too)
  for (const name of modules) {
    const mod = await import(`../src/data/strings/${name}.js`);
    assert.deepEqual(Object.keys(mod.EN).sort(), Object.keys(mod.DE).sort(), `${name} EN/DE parity`);
    for (const key of Object.keys(mod.EN)) {
      assert.equal(seen.has(key), false, `${key} defined in both ${seen.get(key)} and ${name}`);
      seen.set(key, name);
    }
  }
});
