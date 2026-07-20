// GOOBY V4/G83 — arcade cover inventory gate (PLAN4-GAMES §G7.1).
// Pins the complete 27+1 game-id set and validates the coordinator art after
// build-time resize/quantization: 512×384 indexed PNG, ≤85 KiB each and
// ≤2.3 MiB total. `_smoke` is intentionally excluded.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARCADE_GAME_IDS } from '../src/ui/arcadeUi.logic.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COVERS_DIR = path.join(ROOT, 'public', 'assets', 'covers');
const PER_FILE_BYTES = 85 * 1024;
const TOTAL_BYTES = 2.3 * 1024 * 1024;

const EXPECTED_IDS = Object.freeze([
  'basketBounce',
  'bubblePop',
  'bunnyHop',
  'burgerBuild',
  'carrotCatch',
  'carrotGuard',
  'cityDrive',
  'danceParty',
  'deliveryRush',
  'fishingPond',
  'gardenRush',
  'ghostHunt',
  'goalieGooby',
  'goobySays',
  'goobyWelt',
  'harborHopper',
  'memoryMatch',
  'miniGolf',
  'pancakeTower',
  'pipeFlow',
  'purblePlace',
  'rocketRescue',
  'runner',
  'shoppingSurf',
  'starHopper',
  'toyRacer',
  'trampoline',
  'veggieChop',
]);

const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b, 'en'));

test('§G7.1: exactly 28 cover PNGs match the visible arcade game ids', () => {
  assert.equal(EXPECTED_IDS.length, 28);
  assert.deepEqual(sorted(ARCADE_GAME_IDS), sorted(EXPECTED_IDS));

  const files = fs.readdirSync(COVERS_DIR)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .map((name) => path.basename(name, '.png'));
  assert.deepEqual(sorted(files), sorted(EXPECTED_IDS));
  assert.ok(!files.includes('_smoke'));
});

test('§G7.1: every cover is 512×384 palette PNG within file and total budgets', () => {
  let total = 0;
  for (const id of EXPECTED_IDS) {
    const file = path.join(COVERS_DIR, `${id}.png`);
    const bytes = fs.readFileSync(file);
    const size = fs.statSync(file).size;
    total += size;

    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `${id}: invalid PNG signature`
    );
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${id}: IHDR must be first`);
    assert.equal(bytes.readUInt32BE(16), 512, `${id}: width`);
    assert.equal(bytes.readUInt32BE(20), 384, `${id}: height`);
    assert.equal(bytes[25], 3, `${id}: PNG color type must be indexed palette`);
    assert.ok(size <= PER_FILE_BYTES, `${id}: ${size} bytes exceeds ${PER_FILE_BYTES}`);
  }
  assert.ok(total <= TOTAL_BYTES, `${total} bytes exceeds ${TOTAL_BYTES}`);
});
