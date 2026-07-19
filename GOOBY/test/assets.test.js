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
  UI_SPRITES,
  BUDGET_BYTES,
  modelEntry,
} from '../scripts/kenney-manifest.mjs';
// V3/G31 (PLAN3 §B6/§D2): second asset root
import { KAYKIT_PACKS, kaykitEntry } from '../scripts/kaykit-manifest.mjs';
// V4/G79 (§G9.3): food model keys can resolve through the itch root.
import { MODEL_PACKS as ITCH_MODEL_PACKS } from '../scripts/fetch-itch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KENNEY = path.join(ROOT, 'public', 'assets', 'kenney');
const KAYKIT = path.join(ROOT, 'public', 'assets', 'kaykit');
const UI_DIR = path.join(ROOT, 'public', 'assets', 'ui');

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
  for (const pack of PACKS.filter((p) => p.modelDir)) {
    for (const entry of pack.files) {
      const { key } = modelEntry(entry);
      const file = path.join(KENNEY, pack.slug, `${key}.glb`);
      assert.ok(fs.existsSync(file), `missing ${pack.slug}/${key}.glb`);
    }
  }
});

test('every audio pack has oggs within its cap', () => {
  // V3/G31: audio packs are glob-capped OR exact `oggs` whitelists (§D3).
  for (const pack of PACKS.filter((p) => p.glob || p.oggs)) {
    const audioDir = path.join(KENNEY, pack.slug, 'audio');
    assert.ok(fs.existsSync(audioDir), `missing ${pack.slug}/audio/`);
    const oggs = fs.readdirSync(audioDir).filter((f) => f.endsWith('.ogg'));
    assert.ok(oggs.length > 0, `${pack.slug}: no .ogg files`);
    const cap = pack.max ?? pack.oggs.length;
    assert.ok(
      oggs.length <= cap,
      `${pack.slug}: ${oggs.length} oggs exceeds cap ${cap}`
    );
    if (pack.oggs) {
      for (const name of pack.oggs) {
        assert.ok(
          oggs.includes(`${name}.ogg`),
          `${pack.slug}: whitelisted '${name}.ogg' not committed`
        );
      }
    }
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

/** All committed slugs (kenney + kaykit) for key-shaped string scans. */
const ALL_SLUGS = [
  ...PACKS.map((p) => p.slug),
  ...KAYKIT_PACKS.map((p) => p.slug), // V3/G31
  ...ITCH_MODEL_PACKS.map((p) => p.slug), // V4/G79
];

/** Collect asset-key-shaped strings ('<known-slug>/<name>') from a value tree. */
function collectAssetKeys(value, out = new Set(), seen = new Set()) {
  const keyRx = new RegExp(`^(?:${ALL_SLUGS.join('|')})/[A-Za-z0-9._ -]+$`);
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
  // V3/G31: kaykit slugs live under the second root with their own ext (§B6).
  const kaykit = KAYKIT_PACKS.find((p) => p.slug === slug);
  if (kaykit) return path.join(KAYKIT, slug, `${name}.${kaykit.ext}`);
  // V4/G79: committed itch packs carry either self-contained GLB or glTF.
  const itch = ITCH_MODEL_PACKS.find((p) => p.slug === slug);
  if (itch) {
    const ext = itch.form === 'gltf' ? 'gltf' : 'glb';
    return path.join(ROOT, 'public', 'assets', 'itch', slug, `${name}.${ext}`);
  }
  const pack = PACKS.find((p) => p.slug === slug);
  return pack.glob || pack.oggs
    ? path.join(KENNEY, slug, 'audio', `${name}.ogg`)
    : path.join(KENNEY, slug, `${name}.glb`);
}

test('every asset key referenced in data/foods.js resolves to a file', async () => {
  const mod = await import('../src/data/foods.js');
  // §C5.1: each food id doubles as its food-kit GLB name — except rows with
  // an explicit modelKey override (V3/G35 §C6.1: 'nutella' re-tints the
  // food-kit honey jar instead of shipping a new GLB).
  const foods = Object.values(mod).find(Array.isArray) ?? [];
  for (const food of foods) {
    if (food?.id) {
      const file = assetKeyToFile(food.modelKey ?? `food-kit/${food.id}`);
      assert.ok(fs.existsSync(file), `food '${food.id}': missing ${file}`);
    }
  }
  for (const key of collectAssetKeys(mod)) {
    assert.ok(fs.existsSync(assetKeyToFile(key)), `foods.js key '${key}' unresolved`);
  }
});

test('every asset key referenced in data/minigames.js resolves to a file', async () => {
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

// ---------------------------------------------------------------------------
// V3/G31 (PLAN3 §B6/§D2–§D5): 3.0 asset pipeline. Frozen copies of the §D2
// kaykit whitelists + §D3 audio whitelists + §D5 3D additions — a manifest
// regression (dropped entry) fails HERE even though the manifest-driven tests
// above would silently shrink along with it.
// ---------------------------------------------------------------------------

const V3_KAYKIT_FILES = {
  // §D2.1 — the 3 NPC characters (self-contained GLBs)
  'kaykit-characters': splitNames(`Knight Mage Rogue_Hooded`),
  // §D2.2 — §C9.6 restaurant set (24)
  'kaykit-restaurant': splitNames(`kitchencounter_straight kitchencounter_sink
    oven wall_orderwindow wall_doorway floor_kitchen floor_kitchen_small plate
    plate_small menu chair_A chair_stool table_round_A cuttingboard crate
    crate_buns crate_cheese crate_tomatoes crate_carrots jar_A_large
    jar_A_medium jar_C_small bowl fridge_A`),
  // §D2.3 — surf façades + city dressing (15)
  'kaykit-city': splitNames(`building_A_withoutBase building_B_withoutBase
    building_C_withoutBase building_D_withoutBase building_E_withoutBase
    building_F_withoutBase box_A box_B bench streetlight firehydrant dumpster
    trash_A trash_B bush`),
  // §D2.4 — ghostHunt set (18)
  'kaykit-halloween': splitNames(`grave_A grave_B gravemarker_A gravemarker_B
    gravestone crypt coffin_decorated pumpkin_orange pumpkin_orange_small
    pumpkin_orange_jackolantern pumpkin_yellow_small lantern_standing
    lantern_hanging fence_gate fence_seperate tree_dead_large
    tree_pine_orange_small floor_dirt_grave`),
};

const V3_KENNEY_AUDIO = {
  // §D3.1 — completed music-jingles (85 = 5 families × 17)
  'music-jingles': ['NES', 'HIT', 'PIZZI', 'SAX', 'STEEL'].flatMap((fam) =>
    Array.from({ length: 17 }, (_, i) => `jingles_${fam}${String(i).padStart(2, '0')}`)
  ),
  // §D3.2 (15)
  'ui-audio': splitNames(`click1 click2 click3 click4 click5 rollover1
    rollover2 rollover3 rollover4 switch1 switch2 switch8 switch13 mouseclick1
    mouserelease1`),
  // §D3.3 (6)
  'ui-pack-sounds': splitNames(`tap-a tap-b click-a click-b switch-a switch-b`),
  // §D3.4 (15)
  'casino-audio': splitNames(`chip-lay-1 chip-lay-2 chip-lay-3
    chips-collide-1 chips-collide-2 chips-collide-3 chips-collide-4
    chips-stack-1 chips-stack-2 card-slide-1 card-slide-2 card-slide-3
    card-place-1 card-place-2 card-shuffle`),
};

const V3_KENNEY_3D = {
  // §D5 — every named model (some were already committed by v1/v2; the
  // manifest must expose ALL of them regardless of which wave added them)
  'food-kit': splitNames(`cake cake-birthday cupcake muffin whipped-cream
    strawberry chocolate donut-sprinkles honey`),
  'toy-car-kit': splitNames(`track-narrow-straight track-narrow-curve
    track-narrow-corner-small track-narrow-corner-large
    track-narrow-straight-bump-up track-narrow-straight-bump-down
    track-narrow-straight-hill-beginning track-narrow-straight-hill-end
    track-narrow-looping gate gate-finish item-box item-banana item-cone
    item-coin-gold item-coin-silver item-coin-bronze supports supports-clamp
    smoke`),
  'watercraft-kit': splitNames(`boat-fishing-small boat-row-small boat-sail-a
    buoy buoy-flag arrow-standing`),
  'survival-kit': splitNames(`bucket`),
  'nature-kit': splitNames(`bench fence_gate stump_round flower_purpleA
    flower_redA plant_bush pot_large rock_smallFlatA`),
  'furniture-kit': splitNames(`kitchenCoffeeMachine books lampSquareCeiling
    plantSmall1 plantSmall2 bathroomMirror toaster kitchenBar`),
};

test('V3 §D2: every kaykit whitelist entry is in the manifest and committed', () => {
  for (const [slug, names] of Object.entries(V3_KAYKIT_FILES)) {
    const pack = KAYKIT_PACKS.find((p) => p.slug === slug);
    assert.ok(pack, `kaykit manifest missing pack '${slug}'`);
    const keys = new Set(pack.files.map((e) => kaykitEntry(e, pack.ext).key));
    for (const name of names) {
      assert.ok(keys.has(name), `kaykit manifest ${slug} missing '${name}'`);
      const file = path.join(KAYKIT, slug, `${name}.${pack.ext}`);
      assert.ok(fs.existsSync(file), `missing kaykit/${slug}/${name}.${pack.ext}`);
    }
  }
});

test('V3 §D2: every kaykit slug ships a non-empty LICENSE.txt', () => {
  for (const pack of KAYKIT_PACKS) {
    const file = path.join(KAYKIT, pack.slug, 'LICENSE.txt');
    assert.ok(fs.existsSync(file), `missing ${pack.slug}/LICENSE.txt`);
    assert.ok(fs.statSync(file).size > 0, `${pack.slug}/LICENSE.txt is empty`);
  }
});

test('V3 §B6: committed kaykit .gltf files are valid glTF 2.0 with every buffer/image dep present', () => {
  const gltfs = walk(KAYKIT).filter((f) => f.endsWith('.gltf'));
  assert.ok(gltfs.length > 0, 'no kaykit .gltf files committed');
  for (const file of gltfs) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(json.asset?.version, '2.0', `${file}: bad asset.version`);
    assert.ok(
      Array.isArray(json.meshes) && json.meshes.length > 0,
      `${file}: no meshes`
    );
    const deps = [
      ...(json.buffers ?? []).map((b) => b.uri),
      ...(json.images ?? []).map((i) => i.uri),
    ].filter((uri) => uri && !uri.startsWith('data:'));
    assert.ok(deps.length > 0, `${file}: expected external .bin/texture deps`);
    for (const uri of deps) {
      const dep = path.join(path.dirname(file), uri);
      assert.ok(fs.existsSync(dep), `${file}: missing dep ${uri}`);
    }
  }
});

test('V3 §D2.1: character GLBs are valid, self-contained, and carry the 76 clips', () => {
  const REQUIRED_CLIPS = splitNames(`Idle Walking_A Running_A Sit_Chair_Idle
    Cheer Interact PickUp Jump_Full_Long`);
  for (const name of V3_KAYKIT_FILES['kaykit-characters']) {
    const file = path.join(KAYKIT, 'kaykit-characters', `${name}.glb`);
    const buf = fs.readFileSync(file);
    assert.equal(buf.toString('ascii', 0, 4), 'glTF', `${file}: bad magic`);
    assert.equal(buf.readUInt32LE(4), 2, `${file}: unexpected glTF version`);
    assert.equal(buf.readUInt32LE(8), buf.length, `${file}: length mismatch`);
    const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
    assert.equal(json.asset?.version, '2.0', `${file}: bad asset.version`);
    assert.ok((json.skins ?? []).length > 0, `${file}: no skin (not rigged?)`);
    // §B6 form (a): self-contained — no external buffer/image URIs.
    const external = [
      ...(json.buffers ?? []).map((b) => b.uri),
      ...(json.images ?? []).map((i) => i.uri),
    ].filter((uri) => uri && !uri.startsWith('data:'));
    assert.deepEqual(external, [], `${file}: not self-contained: ${external}`);
    const clips = (json.animations ?? []).map((a) => a.name);
    assert.equal(clips.length, 76, `${file}: expected 76 clips, got ${clips.length}`);
    for (const clip of REQUIRED_CLIPS) {
      assert.ok(clips.includes(clip), `${file}: missing clip '${clip}'`);
    }
  }
});

test('V3 §D3/§D5: every 3.0 kenney file is in the manifest and committed', () => {
  for (const [slug, names] of Object.entries(V3_KENNEY_AUDIO)) {
    const pack = PACKS.find((p) => p.slug === slug);
    assert.ok(pack?.oggs, `manifest missing audio pack '${slug}' (oggs form)`);
    for (const name of names) {
      assert.ok(pack.oggs.includes(name), `manifest ${slug} missing '${name}'`);
      const file = path.join(KENNEY, slug, 'audio', `${name}.ogg`);
      assert.ok(fs.existsSync(file), `missing ${slug}/audio/${name}.ogg`);
      assert.ok(fs.statSync(file).size > 0, `${slug}/audio/${name}.ogg is empty`);
    }
  }
  for (const [slug, names] of Object.entries(V3_KENNEY_3D)) {
    const pack = PACKS.find((p) => p.slug === slug);
    assert.ok(pack, `manifest missing pack '${slug}'`);
    const keys = new Set(pack.files.map((e) => modelEntry(e).key));
    for (const name of names) {
      assert.ok(keys.has(name), `manifest ${slug} whitelist missing '${name}'`);
      const file = path.join(KENNEY, slug, `${name}.glb`);
      assert.ok(fs.existsSync(file), `missing ${slug}/${name}.glb`);
      assert.equal(
        fs.readFileSync(file).toString('ascii', 0, 4),
        'glTF',
        `${file}: bad magic bytes`
      );
    }
  }
});

test('V3 §D4: every ui-pack sprite is committed under public/assets/ui/ with the pack licence', () => {
  for (const set of UI_SPRITES.sets) {
    for (const name of set.files) {
      const file = path.join(UI_DIR, set.out, `${name}.png`);
      assert.ok(fs.existsSync(file), `missing ui/${set.out}/${name}.png`);
      const buf = fs.readFileSync(file);
      assert.equal(
        buf.toString('hex', 0, 4),
        '89504e47',
        `${file}: bad PNG magic`
      );
    }
  }
  const license = path.join(UI_DIR, 'License.txt');
  assert.ok(fs.existsSync(license), 'missing ui/License.txt');
  assert.ok(fs.statSync(license).size > 0, 'ui/License.txt is empty');
});

// ---------------------------------------------------------------------------
// V3/G31 (PLAN3 §B6/§D8-3): PACK_FORMATS URL resolution — kaykit slugs route
// to the second root with their ext; every other slug resolves EXACTLY as
// v1/v2 (kenney/glb), so no existing key changes behavior.
// ---------------------------------------------------------------------------

test('V3 §B6: PACK_FORMATS routes kaykit keys and leaves kenney keys untouched', async () => {
  const assets = await import('../src/core/assets.js');
  assert.ok(Object.isFrozen(assets.PACK_FORMATS), 'PACK_FORMATS must be frozen');
  // every §D2 slug present with the right root/ext
  for (const pack of KAYKIT_PACKS) {
    const fmt = assets.PACK_FORMATS[pack.slug];
    assert.ok(fmt, `PACK_FORMATS missing '${pack.slug}'`);
    assert.equal(fmt.root, 'kaykit');
    assert.equal(fmt.ext, pack.ext);
  }
  assert.equal(
    assets.getModelUrl('kaykit-characters/Knight'),
    '/assets/kaykit/kaykit-characters/Knight.glb'
  );
  assert.equal(
    assets.getModelUrl('kaykit-restaurant/oven'),
    '/assets/kaykit/kaykit-restaurant/oven.gltf'
  );
  assert.equal(
    assets.getModelUrl('kaykit-city/bench'),
    '/assets/kaykit/kaykit-city/bench.gltf'
  );
  assert.equal(
    assets.getModelUrl('kaykit-halloween/crypt'),
    '/assets/kaykit/kaykit-halloween/crypt.gltf'
  );
  // default (unlisted) slugs stay kenney/glb — incl. the new §D5 packs
  assert.equal(
    assets.getModelUrl('food-kit/carrot'),
    '/assets/kenney/food-kit/carrot.glb'
  );
  assert.equal(
    assets.getModelUrl('toy-car-kit/track-narrow-looping'),
    '/assets/kenney/toy-car-kit/track-narrow-looping.glb'
  );
  assert.equal(
    assets.getModelUrl('watercraft-kit/buoy'),
    '/assets/kenney/watercraft-kit/buoy.glb'
  );
  assert.equal(
    assets.getModelUrl('survival-kit/bucket'),
    '/assets/kenney/survival-kit/bucket.glb'
  );
  // §D3 audio slugs resolve via getAudioUrl (AUDIO_PACK_SLUGS extension)
  assert.equal(
    assets.getAudioUrl('ui-audio/switch1'),
    '/assets/kenney/ui-audio/audio/switch1.ogg'
  );
  assert.equal(
    assets.getAudioUrl('ui-pack-sounds/tap-a'),
    '/assets/kenney/ui-pack-sounds/audio/tap-a.ogg'
  );
  assert.equal(
    assets.getAudioUrl('casino-audio/chip-lay-1'),
    '/assets/kenney/casino-audio/audio/chip-lay-1.ogg'
  );
  // audio keys must be skipped by preload (no GLTFLoader fetch)
  await assets.preload(['ui-audio/switch1', 'casino-audio/chip-lay-1']);
});

// ---------------------------------------------------------------------------
// V3/G31 (PLAN3 §B6): getAnimations / getSkinnedModel contracts (stubbed
// loader, real three.js scene graph). SkeletonUtils.clone must re-bind every
// SkinnedMesh to its OWN cloned skeleton — plain Object3D.clone() keeps
// driving the master's bones (the forbidden case).
// ---------------------------------------------------------------------------

/** Build a minimal rigged scene: root → bone + SkinnedMesh bound to it. */
async function makeSkinnedScene() {
  const THREE = await import('three');
  const scene = new THREE.Group();
  scene.name = 'master';
  const bone = new THREE.Bone();
  bone.name = 'root_bone';
  const geo = new THREE.BoxGeometry();
  const count = geo.attributes.position.count;
  geo.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4)
  );
  geo.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(
      Float32Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)),
      4
    )
  );
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = 'body';
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  scene.add(mesh);
  return { THREE, scene };
}

test('V3 §B6: modelCache keeps AnimationClips; getAnimations returns the SHARED array', async (t) => {
  const assets = await import('../src/core/assets.js');
  const THREE = await import('three');
  t.after(() => assets._setLoaderForTests(null));

  const key = 'kaykit-characters/__g31-anims-test';
  const { scene } = await makeSkinnedScene();
  const clips = [
    new THREE.AnimationClip('Idle', 1, []),
    new THREE.AnimationClip('Walking_A', 1, []),
  ];
  assets._setLoaderForTests({
    loadAsync: () => Promise.resolve({ scene, animations: clips }),
  });

  // not loaded yet → warn + empty array, no throw
  assert.deepEqual(assets.getAnimations(key), []);

  await assets.preload([key]);
  const got = assets.getAnimations(key);
  assert.equal(got, assets.getAnimations(key), 'same (cached) array every call');
  assert.equal(got.length, 2);
  assert.equal(got[0], clips[0], 'clips are the shared masters, never cloned');
  assert.equal(got[1].name, 'Walking_A');
});

test('V3 §B6: getSkinnedModel clones via SkeletonUtils — clone drives its OWN bones', async (t) => {
  const assets = await import('../src/core/assets.js');
  t.after(() => assets._setLoaderForTests(null));

  const key = 'kaykit-characters/__g31-skinned-test';
  const { scene } = await makeSkinnedScene();
  assets._setLoaderForTests({
    loadAsync: () => Promise.resolve({ scene, animations: [] }),
  });
  await assets.preload([key]);

  const masterMesh = scene.getObjectByName('body');
  const clone = assets.getSkinnedModel(key);
  assert.equal(clone.name, key);
  const cloneMesh = clone.getObjectByName('body');
  assert.ok(cloneMesh?.isSkinnedMesh, 'clone contains the SkinnedMesh');
  assert.notEqual(cloneMesh.skeleton, masterMesh.skeleton, 'own Skeleton instance');
  assert.notEqual(
    cloneMesh.skeleton.bones[0],
    masterMesh.skeleton.bones[0],
    'skeleton bound to CLONED bones (plain .clone() would keep the masters)'
  );
  assert.equal(
    cloneMesh.skeleton.bones[0],
    clone.getObjectByName('root_bone'),
    'clone skeleton bones are the clone-tree bones'
  );
  // geometry/material stay shared with the cached master (getModel semantics)
  assert.equal(cloneMesh.geometry, masterMesh.geometry);
  assert.equal(assets.isCachedResource(cloneMesh.geometry), true);

  // the FORBIDDEN pattern really is broken — document it in-test: a plain
  // clone's skeleton still points at the MASTER's bones.
  const plain = scene.clone(true);
  assert.equal(
    plain.getObjectByName('body').skeleton.bones[0],
    masterMesh.skeleton.bones[0],
    'plain Object3D.clone() shares the master skeleton (why it is forbidden)'
  );
});

test('V3 §B6: getSkinnedModel cache miss — placeholder + background retry, no throw', async (t) => {
  const assets = await import('../src/core/assets.js');
  t.after(() => assets._setLoaderForTests(null));

  const key = 'kaykit-characters/__g31-skinned-miss-test';
  const { scene } = await makeSkinnedScene();
  let calls = 0;
  assets._setLoaderForTests({
    loadAsync() {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('boom: transient'));
      return Promise.resolve({ scene, animations: [] });
    },
  });

  await assert.rejects(assets.preload([key]), /transient/);
  const got = assets.getSkinnedModel(key); // must not throw
  assert.equal(got.userData.placeholder, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(assets.isLoaded(key), true, 'retry populated the cache');
  assert.equal(got.userData.placeholder, false, 'placeholder self-healed');
  const healedMesh = got.getObjectByName('body');
  assert.ok(healedMesh?.isSkinnedMesh, 'healed content is the skinned model');
  assert.notEqual(
    healedMesh.skeleton,
    scene.getObjectByName('body').skeleton,
    'healed clone got its own skeleton (SkeletonUtils path)'
  );
});

// ---------------------------------------------------------------------------
// V3/FIX-E P1-1 (eval E10): KayKit packs share ONE atlas texture per pack
// (<pack>_texture.png) across every .gltf model, but a plain GLTFLoader
// decoded it once PER MODEL (19 fetches / 27 Sources ≈ 112 MB in purblePlace
// vs the 64 MB §A2.3 cap). assets.js now registers a URL-keyed caching
// texture handler on the GLTFLoader's LoadingManager (GLTFLoader consults
// manager.getHandler(imageUri) before its internal texture loader), so every
// model of a pack shares the SAME Texture instance — ONE fetch+decode, ONE
// Source, ONE GPU upload — and the shared texture is cache-owned
// (isCachedResource) so dispose sweeps must skip it.
// ---------------------------------------------------------------------------

test('V3/FIX-E P1-1: pack textures load ONCE per URL — all models share one cache-owned Texture', async (t) => {
  const assets = await import('../src/core/assets.js');
  const THREE = await import('three');
  t.after(() => assets._setTextureLoaderForTests(null));

  let loads = 0;
  assets._setTextureLoaderForTests({
    load(url, onLoad) {
      loads += 1;
      const tex = new THREE.Texture();
      tex.name = url;
      setTimeout(() => onLoad(tex), 0);
    },
  });

  // the wiring GLTFLoader consults for external image URIs (§B6 .gltf packs)
  const handler = THREE.DefaultLoadingManager.getHandler('restaurantbits_texture.png');
  assert.ok(handler, 'caching texture handler registered on the loading manager');
  const load = (url) => new Promise((res, rej) => handler.load(url, res, undefined, rej));

  // two CONCURRENT loads of the same URL (two .gltf models of one pack)
  // coalesce onto one in-flight fetch and deliver the SAME Texture instance
  const url = '/assets/kaykit/kaykit-restaurant/restaurantbits_texture.png';
  const [first, second] = await Promise.all([load(url), load(url)]);
  assert.equal(loads, 1, 'one fetch+decode per URL per session');
  assert.equal(first, second, 'models share the SAME Texture (one Source, one GPU upload)');
  const third = await load(url);
  assert.equal(loads, 1, 'later models keep hitting the cache');
  assert.equal(third, first);

  // the shared master must never be disposed by consumers — dispose sweeps
  // consult isCachedResource (V2/FIX-F P2-3 guard, extended to textures)
  assert.equal(assets.isCachedResource(first), true, 'shared texture is cache-owned');
  assert.equal(assets.isCachedResource(first.source), true, 'its Source is cache-owned too');

  // a different pack's texture is a separate cache entry
  const other = await load('/assets/kaykit/kaykit-city/citybits_texture.png');
  assert.equal(loads, 2);
  assert.notEqual(other, first);
});

test('V3/FIX-E P1-1: failed texture loads are evicted and retried', async (t) => {
  const assets = await import('../src/core/assets.js');
  const THREE = await import('three');
  t.after(() => assets._setTextureLoaderForTests(null));

  let loads = 0;
  const tex = new THREE.Texture();
  assets._setTextureLoaderForTests({
    load(url, onLoad, onProgress, onError) {
      loads += 1;
      if (loads === 1) setTimeout(() => onError(new Error('boom: texture 404')), 0);
      else setTimeout(() => onLoad(tex), 0);
    },
  });

  const handler = THREE.DefaultLoadingManager.getHandler('halloweenbits_texture.png');
  const load = (url) => new Promise((res, rej) => handler.load(url, res, undefined, rej));
  const url = '/assets/kaykit/kaykit-halloween/halloweenbits_texture.png';
  await assert.rejects(load(url), /texture 404/);
  // the poisoned promise was evicted → a later model's load retries fresh
  assert.equal(await load(url), tex);
  assert.equal(loads, 2);
  // …and the recovered texture is cached + owned like any other master
  assert.equal(await load(url), tex);
  assert.equal(loads, 2);
  assert.equal(assets.isCachedResource(tex), true);
});

test('V3/FIX-E P1-1: loaded scene textures register in the isCachedResource guard', async (t) => {
  const assets = await import('../src/core/assets.js');
  const THREE = await import('three');
  t.after(() => assets._setLoaderForTests(null));

  // GLB-embedded textures (kaykit-characters, kenney colormaps) arrive on the
  // parsed scene's materials — normalizeLoadedScene must own-register them so
  // texture dispose sweeps skip masters exactly like geometries/materials.
  const map = new THREE.Texture();
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ map })
  ));
  assets._setLoaderForTests({ loadAsync: () => Promise.resolve({ scene }) });
  await assets.preload(['kaykit-restaurant/__fixe-texguard-test']);
  assert.equal(assets.isCachedResource(map), true, 'material map registered');
  assert.equal(assets.isCachedResource(map.source), true, 'map Source registered');
});

// ---------------------------------------------------------------------------
// V4/G50 (PLAN4 §B3/§E block G50): third committed root public/assets/itch/
// + public/assets/music/ + public/assets/splats/ + public/assets/vfx/.
// Everything below is manifest-driven from scripts/fetch-itch.mjs (the 4.0
// whitelist of record) — a dropped manifest entry OR a missing committed file
// fails here.
// ---------------------------------------------------------------------------

const ITCH = path.join(ROOT, 'public', 'assets', 'itch');
const MUSIC = path.join(ROOT, 'public', 'assets', 'music');
const SPLATS = path.join(ROOT, 'public', 'assets', 'splats');
const VFX = path.join(ROOT, 'public', 'assets', 'vfx');

test('V4 §B3: every fetch-itch manifest output is committed', async () => {
  // safe to import: fetch-itch only runs its copy pass when executed directly
  const m = await import('../scripts/fetch-itch.mjs');
  // music (§C-SYS1.7): exactly the 14 renamed OGGs + consolidated LICENSES.md
  assert.equal(m.MUSIC_FILES.length, 14, '§C-SYS1.7 table is 14 rows');
  for (const { out } of m.MUSIC_FILES) {
    const f = path.join(MUSIC, out);
    assert.ok(fs.existsSync(f), `missing music/${out}`);
    assert.ok(fs.statSync(f).size > 0, `music/${out} is empty`);
  }
  assert.ok(fs.existsSync(path.join(MUSIC, 'LICENSES.md')), 'missing music/LICENSES.md');
  // itch-sfx (§C-SYS1.9): curated ObsydianX subset, flat OGGs
  assert.ok(m.ITCH_SFX.length >= 22, 'itch-sfx subset shrank below the §C-SYS1.9 picks');
  for (const { out } of m.ITCH_SFX) {
    assert.ok(
      fs.existsSync(path.join(ITCH, 'itch-sfx', out)),
      `missing itch/itch-sfx/${out}`
    );
  }
  // vfx (§C-SYS4.5 glow + §G4.2 streaks)
  assert.equal(m.VFX_TEXTURES.length, 6, '§C-SYS4.5 names exactly 6 glow textures');
  for (const { out } of m.VFX_TEXTURES) {
    assert.ok(fs.existsSync(path.join(ITCH, 'vfx', out)), `missing itch/vfx/${out}`);
  }
  for (const { out } of m.STREAK_TEXTURES) {
    const f = path.join(VFX, out);
    assert.ok(fs.existsSync(f), `missing vfx/${out}`);
    assert.ok(fs.statSync(f).size <= 20 * 1024, `vfx/${out} exceeds the §G4.2 20 KB cap`);
  }
  // model packs: every whitelisted model + per-pack license note
  for (const pack of m.MODEL_PACKS) {
    const dir = path.join(ITCH, pack.slug);
    for (const { key } of pack.files) {
      const ext = pack.form === 'gltf' ? 'gltf' : 'glb';
      assert.ok(
        fs.existsSync(path.join(dir, `${key}.${ext}`)),
        `missing itch/${pack.slug}/${key}.${ext}`
      );
    }
    if (pack.texture) {
      assert.ok(
        fs.existsSync(path.join(dir, pack.texture)),
        `missing itch/${pack.slug}/${pack.texture}`
      );
    }
    assert.ok(
      fs.existsSync(path.join(dir, 'LICENSE-NOTE.md')),
      `missing itch/${pack.slug}/LICENSE-NOTE.md`
    );
  }
  // splats (§G6.2): PLY + per-scene LICENSE txt
  for (const scene of m.SPLAT_SCENES) {
    assert.ok(fs.existsSync(path.join(SPLATS, scene.file)), `missing splats/${scene.file}`);
    assert.ok(
      fs.existsSync(path.join(SPLATS, `${scene.sceneId}.LICENSE.txt`)),
      `missing splats/${scene.sceneId}.LICENSE.txt`
    );
  }
});

test('V4 §B3: itch-sfx dir contains a LICENSE-NOTE and flat OGGs only', () => {
  const dir = path.join(ITCH, 'itch-sfx');
  const entries = fs.readdirSync(dir);
  assert.ok(entries.includes('LICENSE-NOTE.md'));
  for (const e of entries) {
    assert.ok(
      e === 'LICENSE-NOTE.md' || e.endsWith('.ogg'),
      `itch-sfx/${e}: unexpected file (flat .ogg layout per §B3)`
    );
  }
});

test('V4 §G9.3: baked-goods GLBs are valid, SELF-CONTAINED binary glTF ≤ 60 KB', () => {
  for (const name of ['croissant', 'cupcake', 'cinnamon-roll']) {
    const file = path.join(ITCH, 'baked-goods', `${name}.glb`);
    const buf = fs.readFileSync(file);
    assert.ok(buf.length <= 60 * 1024, `${name}.glb exceeds the §G9.3 60 KB cap`);
    assert.equal(buf.toString('ascii', 0, 4), 'glTF', `${file}: bad magic`);
    assert.equal(buf.readUInt32LE(4), 2, `${file}: unexpected glTF version`);
    assert.equal(buf.readUInt32LE(8), buf.length, `${file}: length mismatch`);
    const json = JSON.parse(buf.toString('utf8', 20, 20 + buf.readUInt32LE(12)));
    assert.equal(json.asset?.version, '2.0', `${file}: bad asset.version`);
    assert.ok((json.meshes ?? []).length > 0, `${file}: no meshes`);
    // conversion contract: images embedded as bufferViews, single GLB buffer
    const external = [
      ...(json.buffers ?? []).map((b) => b.uri),
      ...(json.images ?? []).map((i) => i.uri),
    ].filter(Boolean);
    assert.deepEqual(external, [], `${file}: not self-contained: ${external}`);
    assert.ok((json.images ?? []).every((i) => i.bufferView != null), `${file}: image without bufferView`);
  }
});

test('V4 §B3: committed itch .gltf files are valid glTF 2.0 with every dep present', () => {
  const gltfs = walk(ITCH).filter((f) => f.endsWith('.gltf'));
  assert.ok(gltfs.length > 0, 'no itch .gltf files committed');
  for (const file of gltfs) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(json.asset?.version, '2.0', `${file}: bad asset.version`);
    assert.ok((json.meshes ?? []).length > 0, `${file}: no meshes`);
    const deps = [
      ...(json.buffers ?? []).map((b) => b.uri),
      ...(json.images ?? []).map((i) => i.uri),
    ].filter((uri) => uri && !uri.startsWith('data:'));
    assert.ok(deps.length > 0, `${file}: expected external .bin/texture deps`);
    for (const uri of deps) {
      assert.ok(
        fs.existsSync(path.join(path.dirname(file), decodeURIComponent(uri))),
        `${file}: missing dep ${uri}`
      );
    }
  }
});

test('V4 §B3: PACK_FORMATS + AUDIO_PACK_ROOTS route itch keys; kenney/kaykit stay untouched', async () => {
  const assets = await import('../src/core/assets.js');
  assert.ok(Object.isFrozen(assets.AUDIO_PACK_ROOTS), 'AUDIO_PACK_ROOTS must be frozen');
  // itch model packs (keys stay '<pack>/<name>' — PLAN4-GAMES §G9.3's
  // `itch/baked-goods/croissant` spelling maps to 'baked-goods/croissant';
  // `itch` is the root, carried by PACK_FORMATS)
  assert.equal(
    assets.getModelUrl('pleasant-picnic/radio'), // §C-SYS1.4 verbatim
    '/assets/itch/pleasant-picnic/radio.gltf'
  );
  assert.equal(
    assets.getModelUrl('baked-goods/croissant'),
    '/assets/itch/baked-goods/croissant.glb'
  );
  assert.equal(
    assets.getModelUrl('bakery-interior/stand_mixer'),
    '/assets/itch/bakery-interior/stand_mixer.gltf'
  );
  assert.equal(
    assets.getModelUrl('aline-furniture/bookshelf'),
    '/assets/itch/aline-furniture/bookshelf.glb'
  );
  // itch audio root: flat, no audio/ subdir (§B3)
  assert.equal(
    assets.getAudioUrl('itch-sfx/confirm_style_4_001'),
    '/assets/itch/itch-sfx/confirm_style_4_001.ogg'
  );
  // v1–v3 routing unchanged
  assert.equal(
    assets.getModelUrl('food-kit/carrot'),
    '/assets/kenney/food-kit/carrot.glb'
  );
  assert.equal(
    assets.getModelUrl('kaykit-restaurant/oven'),
    '/assets/kaykit/kaykit-restaurant/oven.gltf'
  );
  assert.equal(
    assets.getAudioUrl('ui-audio/switch1'),
    '/assets/kenney/ui-audio/audio/switch1.ogg'
  );
  // itch-sfx keys are audio keys — preload must skip them (no GLTFLoader fetch)
  await assets.preload(['itch-sfx/confirm_style_4_001']);
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
