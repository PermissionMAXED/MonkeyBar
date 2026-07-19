import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

test('quality: pure data and shop-trip modules import headlessly', async () => {
  const strings = await import('../src/data/strings.js');
  const trip = await import('../src/systems/shopTrip.js');
  assert.equal(strings.resolveLang('en'), 'en');
  assert.equal(strings.resolveLang('de'), 'de');
  assert.equal(typeof trip.tripTransition, 'function');
});

test('quality: browser-only shop-trip dependencies stay lazy and injected', () => {
  const trip = source('src/systems/shopTrip.js');
  assert.doesNotMatch(trip, /import\s+[^;]*from\s+['"]\.\.\/ui\//);
  assert.doesNotMatch(trip, /\bwindow\.addEventListener/);
  assert.match(trip, /eventTarget\?\.addEventListener\('gooby:shopTrip'/);

  const strings = source('src/data/strings.js');
  assert.doesNotMatch(strings, /typeof\s+navigator|\bnavigator\.language/);
  assert.match(strings, /globalThis\.navigator\?\.language/);
});

test('quality: Nougatschleuse purchase uses economy.spend', () => {
  const shop = source('src/ui/shopScreen.js');
  assert.match(shop, /spend\(store,\s*NOUGAT\.PRICE,\s*'nougatschleuse'\)/);
  assert.doesNotMatch(shop, /st\.coins\s*-=\s*NOUGAT\.PRICE/);
});

test('quality: Toy Grand Prix and Ghost Hunt forward round counters', () => {
  const racer = source('src/minigames/games/toyRacer.js');
  assert.match(racer, /\.track\?\.\('races',\s*meta\.races\)/);
  assert.match(racer, /\.track\?\.\('wins',\s*meta\.wins\)/);

  const hunt = source('src/minigames/games/ghostHunt.js');
  assert.match(hunt, /\.track\?\.\('ghostsCaught',\s*meta\.ghostsCaught\)/);
});

test('quality: orphan strings and shipped TODO/skip escape hatches are gone', () => {
  for (const file of ['src/data/strings/v3-nutella.js', 'src/data/strings/v3-surf.js']) {
    const text = source(file);
    assert.doesNotMatch(text, /nougat\.shopDesc|mg\.surf\.puddle|mg\.surf\.distance/);
  }
  assert.doesNotMatch(source('src/home/gardenInteractions.js'), /TODO\(G19/);
  assert.doesNotMatch(source('src/ui/sleepFlow.js'), /\[sleepFlow\]\s+TODO/);
  assert.doesNotMatch(source('test/assets.test.js'), /\bt\.skip\(/);
});

test('quality: one V3/G33 marked block and sticker provenance are documented', () => {
  const blocks = source('src/main.js').match(/---- V3\/G33:/g) ?? [];
  assert.equal(blocks.length, 1);

  for (const file of ['README.md', 'AGENTS.md']) {
    const text = source(file);
    assert.match(text, /28 sticker-book images are AI-generated originals/);
    assert.match(text, /CC0-equivalent/);
    assert.match(text, /no third-party IP/);
  }
});

test('quality: required Kenney models are manifest-listed and committed', () => {
  const manifest = source('scripts/kenney-manifest.mjs');
  for (const [pack, name] of [
    ['food-kit', 'chocolate'],
    ['city-kit-roads', 'light-square-double'],
  ]) {
    assert.match(manifest, new RegExp(`slug: '${pack}'[\\s\\S]*?${name}`));
    assert.ok(
      fs.existsSync(path.join(ROOT, 'public', 'assets', 'kenney', pack, `${name}.glb`)),
      `${pack}/${name}.glb is committed`
    );
  }
});
