// Minigame metadata integrity (§C6, binding): 12 v1 ids, coin table clamps,
// unlock levels, bilingual titles, payout math incl. daily ×2.
// V2/G16 (PLAN2 §C1.1/§B6): +9 2.0 games — 21 shipping ids, 9 new coin rows,
// UNLOCKS.MINIGAMES levels (deep §C1.1 row checks live in dataV2.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MINIGAMES,
  MINIGAME_IDS,
  MINIGAMES_BY_ID,
  getMinigame,
  computeCoins,
} from '../src/data/minigames.js';
import { COIN_TABLE, UNLOCK_LEVELS, UNLOCKS, MINIGAME } from '../src/data/constants.js';
import { EN, DE } from '../src/data/strings.js';

// §C6 coin table, copied verbatim from PLAN.md as an independent check.
const EXPECTED_COIN_TABLE = {
  carrotCatch: { divisor: 3, min: 4, max: 25 },
  bunnyHop: { divisor: 2, min: 3, max: 25 },
  carrotGuard: { divisor: 3, min: 4, max: 25 },
  memoryMatch: { divisor: 2, min: 5, max: 24 },
  runner: { divisor: 15, min: 4, max: 30 },
  basketBounce: { divisor: 3, min: 4, max: 26 },
  pancakeTower: { divisor: 2, min: 4, max: 26 },
  danceParty: { divisor: 6, min: 4, max: 28 },
  fishingPond: { divisor: 3, min: 4, max: 26 },
  bubblePop: { divisor: 4, min: 4, max: 24 },
  trampoline: { divisor: 5, min: 4, max: 26 },
};

// §C6.3 unlock schedule, verbatim.
const EXPECTED_UNLOCKS = {
  carrotCatch: 1,
  bunnyHop: 1,
  cityDrive: 1,
  carrotGuard: 2,
  memoryMatch: 3,
  basketBounce: 4,
  pancakeTower: 5,
  runner: 6,
  bubblePop: 7,
  fishingPond: 8,
  danceParty: 9,
  trampoline: 10,
};

// V2/G16: the 9 new §B6 games with their unlock levels (verbatim).
// V3/G34: +6 3.0 games at their §E0.1-3 gates (dataV3.test.js re-asserts).
const EXPECTED_V2_UNLOCKS = {
  goobySays: 2,
  gardenRush: 4,
  burgerBuild: 5,
  veggieChop: 6,
  deliveryRush: 7,
  miniGolf: 9,
  goalieGooby: 11,
  starHopper: 12,
  pipeFlow: 14,
  shoppingSurf: 5,
  purblePlace: 6,
  toyRacer: 15,
  ghostHunt: 16,
  rocketRescue: 18,
  harborHopper: 20,
};

test('exactly 27 shipping game ids (§C6 + V2 §C1.1 + V3 §E0.1-9)', () => {
  assert.equal(MINIGAME_IDS.length, 27);
  assert.deepEqual(
    [...MINIGAME_IDS].sort(),
    [...Object.keys(EXPECTED_UNLOCKS), ...Object.keys(EXPECTED_V2_UNLOCKS)].sort()
  );
});

test('coin table rows match §C6 verbatim', () => {
  for (const [id, row] of Object.entries(EXPECTED_COIN_TABLE)) {
    assert.deepEqual({ ...COIN_TABLE[id] }, row, `coin row for ${id}`);
    assert.deepEqual({ ...MINIGAMES_BY_ID[id].coinTable }, row, `meta coin row for ${id}`);
  }
  assert.equal(COIN_TABLE.cityDrive.special, true);
  assert.equal(COIN_TABLE.cityDrive.max, 35);
});

test('coin table clamps are sane (min ≤ max, divisor > 0, max > 0)', () => {
  for (const m of MINIGAMES) {
    const ct = m.coinTable;
    assert.ok(ct.max > 0, `${m.id} max > 0`);
    if (!ct.special) {
      assert.ok(ct.divisor > 0, `${m.id} divisor > 0`);
      assert.ok(ct.min <= ct.max, `${m.id} min ≤ max`);
      assert.ok(ct.min >= 0, `${m.id} min ≥ 0`);
    }
  }
});

test('unlock levels match §C6.3 verbatim', () => {
  assert.deepEqual({ ...UNLOCK_LEVELS }, EXPECTED_UNLOCKS);
  for (const [id, level] of Object.entries(EXPECTED_UNLOCKS)) {
    assert.equal(MINIGAMES_BY_ID[id].minLevel, level, `minLevel for ${id}`);
  }
});

test('V2/G16: 2.0 unlock levels match §B6 verbatim (UNLOCKS.MINIGAMES)', () => {
  assert.deepEqual({ ...UNLOCKS.MINIGAMES }, EXPECTED_V2_UNLOCKS);
  for (const [id, level] of Object.entries(EXPECTED_V2_UNLOCKS)) {
    assert.equal(MINIGAMES_BY_ID[id].minLevel, level, `minLevel for ${id}`);
  }
});

test('energy costs: 8 per play, 6 for the drives (§C6 + V2 §C1.1)', () => {
  for (const m of MINIGAMES) {
    // V2/G16: deliveryRush reuses the city-drive energy cost (§C1.1 row).
    const drive = m.id === 'cityDrive' || m.id === 'deliveryRush';
    assert.equal(m.energyCost, drive ? 6 : 8, `energyCost for ${m.id}`);
  }
});

test('_smoke is dev-only and hidden from the menu; 28 total entries', () => {
  assert.equal(MINIGAMES.length, 28); // V3/G34: 27 shipping + _smoke
  const smoke = getMinigame('_smoke');
  assert.ok(smoke, '_smoke registered');
  assert.equal(smoke.dev, true);
  assert.ok(MINIGAMES.filter((m) => !m.dev).length === 27);
});

test('every title key exists in EN and DE dictionaries (bilingual §A)', () => {
  for (const m of MINIGAMES) {
    assert.equal(typeof EN[m.titleKey], 'string', `EN title for ${m.id}`);
    assert.equal(typeof DE[m.titleKey], 'string', `DE title for ${m.id}`);
    assert.ok(EN[m.titleKey].length > 0 && DE[m.titleKey].length > 0);
  }
});

test('computeCoins: clamp then daily ×2 (§C6 shared rules)', () => {
  const ct = { divisor: 3, min: 4, max: 25 };
  assert.equal(computeCoins(ct, 0, false), 4); // clamped up to min
  assert.equal(computeCoins(ct, 30, false), 10); // floor(30/3)
  assert.equal(computeCoins(ct, 31, false), 10); // floor
  assert.equal(computeCoins(ct, 9999, false), 25); // clamped to max
  assert.equal(computeCoins(ct, 9999, true), 50); // ×2 AFTER clamp
  assert.equal(MINIGAME.DAILY_FIRST_PLAY_MULT, 2);
});

test('computeCoins: special override path (cityDrive §C4)', () => {
  const ct = COIN_TABLE.cityDrive;
  assert.equal(computeCoins(ct, 0, false, 27), 27);
  assert.equal(computeCoins(ct, 0, true, 27), 54);
  assert.equal(computeCoins(ct, 0, false, -5), 0);
});

test('every game has an icon name and unique id', () => {
  const ids = new Set();
  for (const m of MINIGAMES) {
    assert.ok(typeof m.icon === 'string' && m.icon.length > 0, `icon for ${m.id}`);
    assert.ok(!ids.has(m.id), `duplicate id ${m.id}`);
    ids.add(m.id);
  }
});
