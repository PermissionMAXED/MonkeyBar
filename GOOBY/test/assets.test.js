/**
 * GOOBY — asset pipeline tests (PLAN.md §G G2).
 *
 * Pure node:test, no three.js — validates the committed output of
 * `scripts/fetch-kenney.mjs` against `scripts/kenney-manifest.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKS,
  BUDGET_BYTES,
  modelEntry,
} from '../scripts/kenney-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KENNEY = path.join(ROOT, 'public', 'assets', 'kenney');

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

test('every manifest model file exists on disk', () => {
  for (const pack of PACKS.filter((p) => p.files)) {
    for (const entry of pack.files) {
      const { key } = modelEntry(entry);
      const file = path.join(KENNEY, pack.slug, `${key}.glb`);
      assert.ok(fs.existsSync(file), `missing ${pack.slug}/${key}.glb`);
    }
  }
});

test('every audio pack has oggs within its cap', () => {
  for (const pack of PACKS.filter((p) => p.glob)) {
    const audioDir = path.join(KENNEY, pack.slug, 'audio');
    assert.ok(fs.existsSync(audioDir), `missing ${pack.slug}/audio/`);
    const oggs = fs.readdirSync(audioDir).filter((f) => f.endsWith('.ogg'));
    assert.ok(oggs.length > 0, `${pack.slug}: no .ogg files`);
    assert.ok(
      oggs.length <= pack.max,
      `${pack.slug}: ${oggs.length} oggs exceeds cap ${pack.max}`
    );
  }
});

test('every pack directory has a License.txt', () => {
  for (const pack of PACKS) {
    const file = path.join(KENNEY, pack.slug, 'License.txt');
    assert.ok(fs.existsSync(file), `missing ${pack.slug}/License.txt`);
    assert.ok(fs.statSync(file).size > 0, `${pack.slug}/License.txt is empty`);
  }
});

test('total committed asset size is under the 80 MB budget', () => {
  const total = walk(KENNEY).reduce((n, f) => n + fs.statSync(f).size, 0);
  assert.ok(
    total < BUDGET_BYTES,
    `${(total / 1048576).toFixed(2)} MB >= budget ${(BUDGET_BYTES / 1048576).toFixed(2)} MB`
  );
});

test('all committed .glb files are valid binary glTF', () => {
  const glbs = walk(KENNEY).filter((f) => f.endsWith('.glb'));
  assert.ok(glbs.length > 0, 'no .glb files committed');
  for (const file of glbs) {
    const buf = fs.readFileSync(file);
    assert.ok(buf.length > 20, `${file}: too small to be a GLB`);
    assert.equal(
      buf.toString('ascii', 0, 4),
      'glTF',
      `${file}: bad magic bytes`
    );
    assert.equal(buf.readUInt32LE(4), 2, `${file}: unexpected glTF version`);
    assert.equal(
      buf.readUInt32LE(8),
      buf.length,
      `${file}: declared length != file size`
    );
    // Chunk 0 must be a JSON chunk holding a parseable glTF 2.0 document.
    const chunkLen = buf.readUInt32LE(12);
    assert.equal(
      buf.toString('ascii', 16, 20),
      'JSON',
      `${file}: first chunk is not JSON`
    );
    const json = JSON.parse(buf.toString('utf8', 20, 20 + chunkLen));
    assert.equal(json.asset?.version, '2.0', `${file}: bad asset.version`);
    assert.ok(
      Array.isArray(json.meshes) && json.meshes.length > 0,
      `${file}: no meshes`
    );
    // External texture URIs (e.g. Textures/colormap.png in the newer packs)
    // are resolved relative to the GLB — each must be committed alongside it,
    // otherwise every model load 404s in the browser.
    for (const image of json.images ?? []) {
      if (image.uri) {
        const tex = path.join(path.dirname(file), image.uri);
        assert.ok(fs.existsSync(tex), `${file}: missing texture ${image.uri}`);
      }
    }
  }
});

/** Collect asset-key-shaped strings ('<known-slug>/<name>') from a value tree. */
function collectAssetKeys(value, out = new Set(), seen = new Set()) {
  const slugs = PACKS.map((p) => p.slug).join('|');
  const keyRx = new RegExp(`^(?:${slugs})/[A-Za-z0-9._ -]+$`);
  if (typeof value === 'string') {
    if (keyRx.test(value)) out.add(value);
  } else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const v of Object.values(value)) collectAssetKeys(v, out, seen);
  }
  return out;
}

function assetKeyToFile(key) {
  const [slug, ...rest] = key.split('/');
  const name = rest.join('/');
  const pack = PACKS.find((p) => p.slug === slug);
  return pack.glob
    ? path.join(KENNEY, slug, 'audio', `${name}.ogg`)
    : path.join(KENNEY, slug, `${name}.glb`);
}

// TODO(G1): data/foods.js and data/minigames.js are owned by agent G1 (in
// flight during Wave 1). Until they exist these sub-tests skip; the
// coordinator re-runs the full suite at the checkpoint, where they must pass.
test('every asset key referenced in data/foods.js resolves to a file', async (t) => {
  const foodsPath = path.join(ROOT, 'src', 'data', 'foods.js');
  if (!fs.existsSync(foodsPath)) {
    t.skip('TODO(G1): src/data/foods.js not created yet');
    return;
  }
  const mod = await import('../src/data/foods.js');
  // §C5.1: each food id doubles as its food-kit GLB name.
  const foods = Object.values(mod).find(Array.isArray) ?? [];
  for (const food of foods) {
    if (food?.id) {
      const file = path.join(KENNEY, 'food-kit', `${food.id}.glb`);
      assert.ok(fs.existsSync(file), `food '${food.id}': missing ${file}`);
    }
  }
  for (const key of collectAssetKeys(mod)) {
    assert.ok(fs.existsSync(assetKeyToFile(key)), `foods.js key '${key}' unresolved`);
  }
});

test('every asset key referenced in data/minigames.js resolves to a file', async (t) => {
  const miniPath = path.join(ROOT, 'src', 'data', 'minigames.js');
  if (!fs.existsSync(miniPath)) {
    t.skip('TODO(G1): src/data/minigames.js not created yet');
    return;
  }
  const mod = await import('../src/data/minigames.js');
  for (const key of collectAssetKeys(mod)) {
    assert.ok(
      fs.existsSync(assetKeyToFile(key)),
      `minigames.js key '${key}' unresolved`
    );
  }
});

// ---------------------------------------------------------------------------
// Loader cache behaviour (F5 fix, eval E18): a rejected load must NOT stay
// cached — the failed promise is evicted so the next preload retries, while
// concurrent callers of the SAME in-flight load still coalesce onto one fetch.
// ---------------------------------------------------------------------------

test('assets cache: rejected loads are evicted and retried; in-flight loads coalesce', async (t) => {
  const assets = await import('../src/core/assets.js');
  t.after(() => assets._setLoaderForTests(null));

  const key = 'food-kit/__f5-transient-test';
  const fakeScene = {
    name: 'master',
    clone() {
      return { name: '' };
    },
  };
  let calls = 0;
  /** @type {(v: {scene: object}) => void} */
  let resolveInFlight;
  assets._setLoaderForTests({
    loadAsync() {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('boom: transient network failure'));
      return new Promise((resolve) => {
        resolveInFlight = resolve;
      });
    },
  });

  // 1. First preload fails → rejection propagates, nothing cached.
  await assert.rejects(assets.preload([key]), /transient network failure/);
  assert.equal(assets.isLoaded(key), false, 'failed load must not be cached');
  assert.equal(calls, 1);

  // 2. Retry after failure: the poisoned promise was evicted → loader called
  //    again; two overlapping preloads coalesce onto ONE in-flight fetch.
  const p1 = assets.preload([key]);
  const p2 = assets.preload([key]);
  assert.equal(calls, 2, 'concurrent preloads must share one in-flight load');
  resolveInFlight({ scene: fakeScene });
  await Promise.all([p1, p2]);
  assert.equal(assets.isLoaded(key), true);
  assert.equal(calls, 2);

  // 3. Settled successful loads stay permanently cached — no further fetches.
  await assets.preload([key]);
  assert.equal(calls, 2, 'successful load must stay cached');
  assert.equal(assets.getModel(key).name, key, 'getModel returns a named clone');
});

test('assets cache: concurrent callers share one rejection, then recover', async (t) => {
  const assets = await import('../src/core/assets.js');
  t.after(() => assets._setLoaderForTests(null));

  const key = 'food-kit/__f5-shared-rejection-test';
  let calls = 0;
  /** @type {(e: Error) => void} */
  let rejectInFlight;
  assets._setLoaderForTests({
    loadAsync() {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve, reject) => {
          rejectInFlight = reject;
        });
      }
      return Promise.resolve({ scene: { name: 'master', clone: () => ({ name: '' }) } });
    },
  });

  // Two callers race on the same key while the load is in flight…
  const p1 = assert.rejects(assets.preload([key]), /shared boom/);
  const p2 = assert.rejects(assets.preload([key]), /shared boom/);
  assert.equal(calls, 1, 'in-flight load must be shared, not duplicated');
  rejectInFlight(new Error('shared boom'));
  await Promise.all([p1, p2]);

  // …and a later preload retries fresh and succeeds.
  await assets.preload([key]);
  assert.equal(calls, 2);
  assert.equal(assets.isLoaded(key), true);
});
