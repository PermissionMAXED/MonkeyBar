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
  // V2/G15 (PLAN2 §D5): report the actual committed size — expected ≈ 11 MB,
  // target ≤ 25 MB (§A2.4), hard budget 80 MB.
  console.log(
    `committed kenney assets: ${(total / 1048576).toFixed(2)} MB ` +
      `(target ≤ 25 MB, hard budget ${(BUDGET_BYTES / 1048576).toFixed(0)} MB)`
  );
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
// V2/G15 (PLAN2 §D2/§D3/§D5): 2.0 asset inventory. Frozen copies of the §D2
// whitelist additions + §D3 new-pack whitelists — a manifest regression
// (dropped entry) fails HERE even though the manifest-driven tests above
// would silently shrink along with it.
// ---------------------------------------------------------------------------

const splitNames = (s) => s.trim().split(/\s+/);

const V2_FILES = {
  // §D2 additions to existing packs
  'food-kit': splitNames(`tomato tomato-slice radish eggplant pumpkin grapes
    fries corn-dog candy-bar lollypop chocolate sundae meat-patty cheese-cut
    lemon lemon-half onion onion-half mushroom mushroom-half paprika
    paprika-slice coconut coconut-half apple-half pear-half`),
  'nature-kit': splitNames(`crops_leafsStageA crops_leafsStageB
    crops_cornStageA crops_cornStageB crops_cornStageC crops_cornStageD
    crop_melon crop_pumpkin crop_turnip pot_large pot_small bed`),
  // §D3 new packs
  'city-kit-suburban': splitNames(`fence-1x4 fence-low fence-2x2 planter
    path-stones-short path-stones-long driveway-short tree-small tree-large`),
  'minigolf-kit': splitNames(`start straight end corner hole-round hole-open
    ramp-low ramp-medium bump obstacle-block obstacle-triangle windmill
    tunnel-wide wall-left wall-right flag-red flag-blue castle`),
  'space-kit': splitNames(`craft_speederA craft_speederB meteor
    meteor_detailed meteor_half`),
};

const V2_NEW_PACKS = ['city-kit-suburban', 'minigolf-kit', 'space-kit'];

test('V2 §D2/§D3: every 2.0 file is in the manifest and committed with glTF magic', () => {
  for (const [slug, names] of Object.entries(V2_FILES)) {
    const pack = PACKS.find((p) => p.slug === slug);
    assert.ok(pack, `manifest missing pack '${slug}'`);
    const keys = new Set(pack.files.map((e) => modelEntry(e).key));
    for (const name of names) {
      assert.ok(keys.has(name), `manifest ${slug} whitelist missing '${name}'`);
      const file = path.join(KENNEY, slug, `${name}.glb`);
      assert.ok(fs.existsSync(file), `missing ${slug}/${name}.glb`);
      const buf = fs.readFileSync(file);
      assert.ok(buf.length > 20, `${file}: too small to be a GLB`);
      assert.equal(
        buf.toString('ascii', 0, 4),
        'glTF',
        `${file}: bad magic bytes`
      );
    }
  }
});

test('V2 §D3: the 3 new packs ship a non-empty License.txt', () => {
  for (const slug of V2_NEW_PACKS) {
    const file = path.join(KENNEY, slug, 'License.txt');
    assert.ok(fs.existsSync(file), `missing ${slug}/License.txt`);
    assert.ok(fs.statSync(file).size > 0, `${slug}/License.txt is empty`);
  }
});

// V2/G15 (PLAN2 §D5): dynamic catalog-reference check. Each catalog file is
// scanned AS TEXT for '<pack>/<file>' asset-key string literals — NOT
// imported, because some of these modules are owned by in-flight wave-1/2
// agents (G16/G19/G21) and may import three.js/DOM. Files that don't exist
// yet are skipped per-file, so this test auto-strengthens as they land.
const V2_CATALOG_FILES = [
  'src/data/crops.js',
  'src/data/foods.js',
  'src/data/furniture.js',
  'src/data/minigames.js',
  'src/city/vetClinic.js',
];

test('V2 §D5: every asset-key literal in the data/city catalogs resolves to a committed file', () => {
  const slugs = PACKS.map((p) => p.slug).join('|');
  const keyRx = new RegExp(
    `['"\`]((?:${slugs})/[A-Za-z0-9._ -]+)['"\`]`,
    'g'
  );
  for (const rel of V2_CATALOG_FILES) {
    const abs = path.join(ROOT, ...rel.split('/'));
    if (!fs.existsSync(abs)) continue; // not landed yet (see note above)
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(keyRx)) {
      assert.ok(
        fs.existsSync(assetKeyToFile(m[1])),
        `${rel}: asset key '${m[1]}' does not resolve to a committed file`
      );
    }
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

// ---------------------------------------------------------------------------
// V2/FIX-F P2-5 (eval E18): getModel must survive transient load failures —
// sceneManager fail-softs preload errors, so a synchronous getModel throw in
// roomManager.enter() used to brick boot. getModel now retries the fetch once
// in the background and returns a tiny neutral placeholder Group (no throw).
// ---------------------------------------------------------------------------

test('V2/FIX-F P2-5: failing-then-succeeding load — getModel succeeds via a self-healing placeholder', async (t) => {
  const assets = await import('../src/core/assets.js');
  const THREE = await import('three');
  t.after(() => assets._setLoaderForTests(null));

  const key = 'food-kit/__ff-getmodel-retry-test';
  const master = new THREE.Group();
  master.name = 'master';
  master.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  let calls = 0;
  assets._setLoaderForTests({
    loadAsync() {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('boom: transient failure'));
      return Promise.resolve({ scene: master });
    },
  });

  // 1. Preload fails (as sceneManager would fail-soft it) …
  await assert.rejects(assets.preload([key]), /transient failure/);
  assert.equal(assets.isLoaded(key), false);

  // 2. … but getModel does NOT throw: neutral placeholder + background retry.
  const got = assets.getModel(key);
  assert.equal(got.isObject3D, true, 'placeholder is a real Object3D Group');
  assert.equal(got.name, key);
  assert.equal(got.userData.placeholder, true);
  assert.ok(got.children.length > 0, 'placeholder has a visible stand-in mesh');

  // 3. The retry (2nd loader call) lands → cache populated, placeholder heals.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2, 'getModel retried the fetch exactly once');
  assert.equal(assets.isLoaded(key), true, 'retry populated the cache');
  assert.equal(got.userData.placeholder, false, 'placeholder self-healed');
  assert.ok(
    got.children.some((c) => c.name === 'master'),
    'real model cloned into the placeholder group'
  );
  assert.equal(assets.getModel(key).name, key, 'later getModel calls serve real clones');
});

test('V2/FIX-F P2-5: twice-failing load — placeholder stays, still no throw', async (t) => {
  const assets = await import('../src/core/assets.js');
  t.after(() => assets._setLoaderForTests(null));

  const key = 'food-kit/__ff-getmodel-permafail-test';
  let calls = 0;
  assets._setLoaderForTests({
    loadAsync() {
      calls += 1;
      return Promise.reject(new Error('boom: permanent failure'));
    },
  });

  await assert.rejects(assets.preload([key]), /permanent failure/);
  const got = assets.getModel(key); // must not throw
  assert.equal(got.userData.placeholder, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 2, 'exactly one retry from getModel');
  assert.equal(assets.isLoaded(key), false, 'failed retry stays uncached');
  assert.equal(got.userData.placeholder, true, 'placeholder remains the stand-in');
  // the v1 eviction still applies: a later preload retries fresh and can recover
  assets._setLoaderForTests({
    loadAsync: () => Promise.resolve({ scene: { name: 'master', clone: () => ({ name: '' }) } }),
  });
  await assets.preload([key]);
  assert.equal(assets.isLoaded(key), true);
});

// ---------------------------------------------------------------------------
// V2/FIX-F P1-2 (eval E13): Kenney GLBs shipping metallicFactor 1 render
// near-black without an envmap — load normalization zeroes metalness===1 on
// LOADED materials only (app-created materials never pass through here).
// ---------------------------------------------------------------------------

test('V2/FIX-F P1-2: loaded GLB materials with metalness 1 normalize to 0, idempotently', async (t) => {
  const assets = await import('../src/core/assets.js');
  const THREE = await import('three');
  t.after(() => assets._setLoaderForTests(null));

  const scene = new THREE.Group();
  const metalMat = new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.7, color: 0xff7ba9 });
  const midMat = new THREE.MeshStandardMaterial({ metalness: 0.25 });
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), metalMat));
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), midMat));
  assets._setLoaderForTests({ loadAsync: () => Promise.resolve({ scene }) });

  const key = 'nature-kit/__ff-metalness-test';
  await assets.preload([key]);
  assert.equal(metalMat.metalness, 0, 'metallicFactor 1 zeroed');
  assert.equal(metalMat.roughness, 0.7, 'roughness untouched');
  assert.equal(metalMat.color.getHex(), 0xff7ba9, 'color untouched');
  assert.equal(midMat.metalness, 0.25, 'partial metalness (golden-skin-style) untouched');

  // idempotence guard: a re-run over the SAME materials (clones share them)
  // must not re-normalize — post-load tweaks survive.
  metalMat.metalness = 0.6;
  assets._setLoaderForTests({ loadAsync: () => Promise.resolve({ scene }) });
  await assets.preload(['nature-kit/__ff-metalness-test-2']);
  assert.equal(metalMat.metalness, 0.6, 'already-normalized material left alone');
});

// ---------------------------------------------------------------------------
// V2/FIX-F P2-3 (eval E17): the permanent cache exposes an ownership check so
// scene dispose sweeps (minigame framework) can skip shared master resources.
// ---------------------------------------------------------------------------

test('V2/FIX-F P2-3: isCachedResource marks cache masters (and their shared clones) only', async (t) => {
  const assets = await import('../src/core/assets.js');
  const THREE = await import('three');
  t.after(() => assets._setLoaderForTests(null));

  const geo = new THREE.BoxGeometry();
  const mat = new THREE.MeshStandardMaterial();
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geo, mat));
  assets._setLoaderForTests({ loadAsync: () => Promise.resolve({ scene }) });

  const key = 'nature-kit/__ff-ownership-test';
  await assets.preload([key]);
  assert.equal(assets.isCachedResource(geo), true, 'master geometry registered');
  assert.equal(assets.isCachedResource(mat), true, 'master material registered');

  // getModel clones SHARE the master resources → also recognized as cached
  const clone = assets.getModel(key);
  clone.traverse((o) => {
    if (!o.isMesh) return;
    assert.equal(assets.isCachedResource(o.geometry), true, 'clone geometry is the shared master');
    assert.equal(assets.isCachedResource(o.material), true, 'clone material is the shared master');
  });

  // resources the app creates itself are NOT cache-owned → sweeps dispose them
  assert.equal(assets.isCachedResource(new THREE.MeshBasicMaterial()), false);
  assert.equal(assets.isCachedResource(new THREE.BoxGeometry()), false);
  assert.equal(assets.isCachedResource(null), false);
  assert.equal(assets.isCachedResource(undefined), false);
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
