/**
 * GOOBY — committed-asset budget guard (PLAN3.md §D7; PLAN4.md §A2/§E0.1-4).
 * V3/G31, raised for 4.0 by V4/G50.
 *
 * Sums EVERYTHING under public/assets/ (kenney + kaykit + itch + music +
 * GoobyMusic + splats + vfx + covers + stickers + ui + anything a later agent
 * adds) at test time:
 *   · FAIL  > 1536 MB (4.0 hard cap — §A2 „1.5 GB hard cap")
 *   · WARN  >  280 MB (headroom alarm — console only; §A2 target ≤ 300 MB)
 *
 * §E0.1-4 RECONCILIATION: these §A2 numbers supersede PLAN4-GAMES §G6.2's
 * suggested 65/80 MB raise. The raise lands in the same commit series as the
 * 4.0 splat payload — justification (the big new 4.0 binaries):
 *   · public/assets/splats/windmill-golden-gate-mobile.compressed.ply (~15.5 MB)
 *   · public/assets/splats/ludlow-quality-square-mobile.compressed.ply (~15.5 MB)
 *     (PLAN4-GAMES §G6.2 — CC BY 4.0, 1M splats each, SH0)
 *   · public/assets/music/ — 14 committed CC0 Bordmusik/recap OGGs (~29 MB,
 *     §C-SYS1.7)
 *   · public/assets/GoobyMusic/ — the owner's uploaded tracks (~108 MB and
 *     growing; §C-SYS1.1 zero-code contract — uploads must NEVER fail CI)
 *
 * Per-feature caps: v3 rows unchanged; 4.0 adds the §E block-G50 sub-asserts
 * (splats ≤ 33, music ≤ 30, itch ≤ 12, covers ≤ 3 MB).
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
const HARD_BUDGET_MB = 1536; // §A2 / §E0.1-4
const WARN_MB = 280; // §A2 / §E0.1-4
/** §D7 per-feature caps (MB) + the V4/G50 §E-block sub-asserts. */
const FEATURE_CAPS_MB = {
  'kaykit/kaykit-characters': 11,
  stickers: 4.2,
  ui: 0.5,
  // V4/G50 (PLAN4 §E block G50)
  splats: 33,
  music: 30,
  itch: 12,
  covers: 3,
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

test('§A2 v4: total committed assets stay under the 1536 MB hard cap (warn > 280 MB)', () => {
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
      `(target ≤ 300 MB, warn > ${WARN_MB} MB, hard ${HARD_BUDGET_MB} MB)`
  );
  if (total > WARN_MB * MB) {
    console.warn(
      `WARN: committed assets ${mb(total)} MB exceed the ${WARN_MB} MB ` +
        `headroom alarm (§A2) — hard cap is ${HARD_BUDGET_MB} MB, plan additions carefully`
    );
  }
  assert.ok(
    total <= HARD_BUDGET_MB * MB,
    `committed assets ${mb(total)} MB exceed the §A2 hard cap of ${HARD_BUDGET_MB} MB`
  );
});

test('§D7/§E-G50 per-feature caps — characters ≤ 11, stickers ≤ 4.2, ui ≤ 0.5, splats ≤ 33, music ≤ 30, itch ≤ 12, covers ≤ 3 MB', () => {
  for (const [rel, capMb] of Object.entries(FEATURE_CAPS_MB)) {
    const dir = path.join(ASSETS, ...rel.split('/'));
    assert.ok(fs.existsSync(dir), `expected asset dir missing: ${rel}`);
    const bytes = dirBytes(dir);
    assert.ok(
      bytes <= capMb * MB,
      `${rel}: ${mb(bytes)} MB exceeds the cap of ${capMb} MB`
    );
    console.log(`  ${rel}: ${mb(bytes)} MB / cap ${capMb} MB`);
  }
});

// ---------------------------------------------------------------------------
// V4/G50 (PLAN4-GAMES §G6.2): the two shipped splat scenes are license-bound
// binaries — pin their presence + license notes here so a stray cleanup can
// never silently drop a CC-BY obligation (credits rows live in
// src/data/credits.js; ui/creditsScreen.js renders them in wave 4).
// ---------------------------------------------------------------------------

test('V4 §G6.2: both splat scenes + their LICENSE txts are committed', () => {
  const SPLATS = path.join(ASSETS, 'splats');
  for (const [ply, license] of [
    ['windmill-golden-gate-mobile.compressed.ply', 'windmill.LICENSE.txt'],
    ['ludlow-quality-square-mobile.compressed.ply', 'townsquare.LICENSE.txt'],
  ]) {
    const plyAbs = path.join(SPLATS, ply);
    assert.ok(fs.existsSync(plyAbs), `missing splats/${ply}`);
    assert.ok(
      fs.statSync(plyAbs).size > 10 * MB,
      `splats/${ply} suspiciously small — corrupt copy?`
    );
    const licAbs = path.join(SPLATS, license);
    assert.ok(fs.existsSync(licAbs), `missing splats/${license}`);
    const text = fs.readFileSync(licAbs, 'utf8');
    assert.match(text, /CC BY 4\.0/, `${license}: no CC BY 4.0 mention`);
  }
});
