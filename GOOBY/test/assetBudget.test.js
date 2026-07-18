/**
 * GOOBY — committed-asset budget guard (PLAN3.md §D7). V3/G31.
 *
 * Sums EVERYTHING under public/assets/ (kenney + kaykit + ui + stickers +
 * anything a later agent adds) at test time:
 *   · FAIL  > 60 MB (hard budget)
 *   · WARN  > 45 MB (headroom alarm — console only)
 * Per-feature caps (§D7, binding): kaykit-characters ≤ 11 MB, stickers dir
 * ≤ 4.2 MB, ui sprites ≤ 0.5 MB.
 *
 * Pure node:test — no three.js/DOM.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');

const MB = 1024 * 1024;
const HARD_BUDGET_MB = 60;
const WARN_MB = 45;
/** §D7 per-feature caps (MB). */
const FEATURE_CAPS_MB = {
  'kaykit/kaykit-characters': 11,
  stickers: 4.2,
  ui: 0.5,
};

function dirBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    bytes += e.isDirectory() ? dirBytes(abs) : fs.statSync(abs).size;
  }
  return bytes;
}

const mb = (b) => (b / MB).toFixed(2);

test('§D7: total committed assets stay under the 60 MB hard budget (warn > 45 MB)', () => {
  assert.ok(fs.existsSync(ASSETS), 'public/assets/ missing');
  const roots = fs
    .readdirSync(ASSETS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  let total = 0;
  console.log('committed public/assets/ ledger:');
  for (const root of roots.sort()) {
    const bytes = dirBytes(path.join(ASSETS, root));
    total += bytes;
    console.log(`  ${root.padEnd(12)} ${mb(bytes).padStart(8)} MB`);
  }
  console.log(
    `  ${'TOTAL'.padEnd(12)} ${mb(total).padStart(8)} MB ` +
      `(target ≈ 30.6 MB, warn > ${WARN_MB} MB, hard ${HARD_BUDGET_MB} MB)`
  );
  if (total > WARN_MB * MB) {
    console.warn(
      `WARN: committed assets ${mb(total)} MB exceed the ${WARN_MB} MB ` +
        'headroom alarm (§D7) — hard budget is 60 MB, plan additions carefully'
    );
  }
  assert.ok(
    total <= HARD_BUDGET_MB * MB,
    `committed assets ${mb(total)} MB exceed the §D7 hard budget of ${HARD_BUDGET_MB} MB`
  );
});

test('§D7: per-feature caps — characters ≤ 11 MB, stickers ≤ 4.2 MB, ui sprites ≤ 0.5 MB', () => {
  for (const [rel, capMb] of Object.entries(FEATURE_CAPS_MB)) {
    const dir = path.join(ASSETS, ...rel.split('/'));
    assert.ok(fs.existsSync(dir), `expected asset dir missing: ${rel}`);
    const bytes = dirBytes(dir);
    assert.ok(
      bytes <= capMb * MB,
      `${rel}: ${mb(bytes)} MB exceeds the §D7 cap of ${capMb} MB`
    );
    console.log(`  ${rel}: ${mb(bytes)} MB / cap ${capMb} MB`);
  }
});
