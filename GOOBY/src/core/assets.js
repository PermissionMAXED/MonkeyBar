/**
 * GOOBY — asset loader + permanent cache (PLAN.md §B, §D1, §E1).
 *
 * Committed Kenney assets live under `public/assets/kenney/` (see
 * `scripts/kenney-manifest.mjs`):
 *   <slug>/<name>.glb           — models
 *   <slug>/audio/<name>.ogg     — audio packs
 *
 * Asset key format everywhere in the game: `'<slug>/<file-no-ext>'`,
 * e.g. `'food-kit/carrot'`, `'interface-sounds/click_001'`.
 */

import * as THREE from 'three'; // V2/FIX-F: placeholder Group (P2-5, E18)
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Packs whose files are OGGs under `<slug>/audio/` (PLAN.md §D1). */
const AUDIO_PACK_SLUGS = new Set([
  'interface-sounds',
  'impact-sounds',
  'music-jingles',
]);

// Vite injects import.meta.env (BASE_URL './' per vite.config.js); plain node
// (tests) has no env object, so fall back to '/'.
const baseUrl = () => import.meta.env?.BASE_URL ?? '/';

let loader = new GLTFLoader();

/** Permanent cache: key → loaded gltf.scene (master copy, never handed out). */
const modelCache = new Map();
/** In-flight/settled load promises so concurrent preloads coalesce. */
const loadPromises = new Map();

// ── V2/FIX-F P2-3 (E17): cache ownership registry ───────────────────────────
// Geometries/materials of cache MASTERS. getModel clones SHARE these objects
// (Object3D.clone() semantics), so scene dispose sweeps (minigame framework)
// can consult isCachedResource to skip them — disposing a shared master forces
// a GPU re-upload + shader recompile on the next scene that uses the model.
/** @type {WeakSet<object>} */
const cachedResources = new WeakSet();

/**
 * Whether a geometry/material belongs to (is shared with) the permanent asset
 * cache. Scene dispose sweeps must SKIP these — mirror `roomManager`'s
 * `disposeIfOwned` pattern (V2/FIX-F P2-3).
 * @param {object|null|undefined} resource a THREE geometry or material
 * @returns {boolean}
 */
export function isCachedResource(resource) {
  return resource != null && cachedResources.has(resource);
}

/**
 * One-time normalization of a freshly loaded GLB scene (idempotent per
 * material — clones/multi-mesh GLBs share material instances):
 *   · V2/FIX-F P1-2 (E13): Kenney nature-kit GLBs ship `metallicFactor: 1`
 *     (tree_oak, tree_default, flower_redA, …); with no envmap those materials
 *     render near-black. metalness === 1 → 0, roughness/colormap untouched.
 *     ONLY loaded GLB materials pass through here — materials the app creates
 *     itself (e.g. the golden skin's 0.25 metalness) are never touched.
 *   · V2/FIX-F P2-3: register master geometries/materials in the ownership
 *     WeakSet (see isCachedResource).
 * @param {object} sceneRoot the gltf.scene master
 */
function normalizeLoadedScene(sceneRoot) {
  sceneRoot.traverse?.((obj) => {
    if (obj.geometry) cachedResources.add(obj.geometry);
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const mat of mats) {
      cachedResources.add(mat);
      if (mat.userData?.goobyMetalnessNormalized) continue;
      if (mat.userData) mat.userData.goobyMetalnessNormalized = true;
      if (mat.metalness === 1) mat.metalness = 0;
    }
  });
}

/**
 * Test seam: swap the loader (must expose `loadAsync(url) → Promise<{scene}>`).
 * Used by `test/assets.test.js` to simulate transient load failures without
 * network/GLTFLoader; production code never calls this.
 * @param {{loadAsync: (url: string) => Promise<{scene: object}>}|null} l
 *   replacement loader, or null to restore the real GLTFLoader
 */
export function _setLoaderForTests(l) {
  loader = l ?? new GLTFLoader();
}

/**
 * Split an asset key into { slug, name }.
 * @param {string} key e.g. 'food-kit/carrot'
 */
function parseKey(key) {
  const i = key.indexOf('/');
  if (i <= 0 || i === key.length - 1) {
    throw new Error(`assets: bad key '${key}' (expected '<slug>/<file-no-ext>')`);
  }
  return { slug: key.slice(0, i), name: key.slice(i + 1) };
}

const isAudioKey = (key) => AUDIO_PACK_SLUGS.has(parseKey(key).slug);

/**
 * URL of a model GLB for a key.
 * @param {string} key
 * @returns {string}
 */
export function getModelUrl(key) {
  const { slug, name } = parseKey(key);
  return `${baseUrl()}assets/kenney/${slug}/${name}.glb`;
}

/**
 * URL of an audio OGG for a key (audio packs keep files under `audio/`).
 * @param {string} key e.g. 'interface-sounds/click_001'
 * @returns {string}
 */
export function getAudioUrl(key) {
  const { slug, name } = parseKey(key);
  return `${baseUrl()}assets/kenney/${slug}/audio/${name}.ogg`;
}

function loadModel(key) {
  let p = loadPromises.get(key);
  if (!p) {
    p = loader.loadAsync(getModelUrl(key)).then(
      (gltf) => {
        normalizeLoadedScene(gltf.scene); // V2/FIX-F P1-2 + P2-3
        modelCache.set(key, gltf.scene);
        return gltf.scene;
      },
      (err) => {
        // Evict the rejected promise so a later preload retries the fetch —
        // otherwise one transient failure (network blip, mid-load reload)
        // would poison the key for the whole session. Concurrent callers of
        // the SAME in-flight load still share this one promise/rejection.
        if (loadPromises.get(key) === p) loadPromises.delete(key);
        throw err;
      }
    );
    loadPromises.set(key, p);
  }
  return p;
}

/**
 * Preload assets into the permanent cache. Model keys are fetched + parsed via
 * GLTFLoader; audio keys resolve immediately (the audio manager streams OGGs
 * by URL, see `getAudioUrl`). Safe to call repeatedly with overlapping keys.
 * @param {string[]} keys asset keys, e.g. ['food-kit/carrot']
 * @returns {Promise<void>}
 */
export async function preload(keys) {
  await Promise.all(keys.filter((k) => !isAudioKey(k)).map(loadModel));
}

// ── V2/FIX-F P2-5 (E18): getModel never throws on a missing model ───────────
// sceneManager fail-softs preload errors (console.warn), but consumers like
// roomManager.enter() call getModel synchronously right after — one transient
// GLB fetch failure used to hard-crash boot ('[boot] fatal') with no retry.

/** Shared placeholder resources (cache-owned so dispose sweeps skip them). */
let placeholderGeo = null;
let placeholderMat = null;

/**
 * Tiny neutral stand-in Group for a model that is not (yet) loaded. If the
 * background retry lands, the real model is cloned INTO this group so the
 * scene self-heals without consumer involvement.
 * @param {string} key
 * @returns {import('three').Group}
 */
function makePlaceholder(key) {
  if (!placeholderGeo) {
    placeholderGeo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
    placeholderMat = new THREE.MeshStandardMaterial({ color: 0xbdb4aa, roughness: 0.9 });
    cachedResources.add(placeholderGeo);
    cachedResources.add(placeholderMat);
  }
  const group = new THREE.Group();
  group.name = key;
  group.userData.placeholder = true;
  const box = new THREE.Mesh(placeholderGeo, placeholderMat);
  box.position.y = 0.12;
  group.add(box);
  return group;
}

/**
 * Get a fresh instance of a preloaded model: the node hierarchy is deep-cloned
 * (safe to reposition/rename/add per scene) while geometries and materials
 * stay shared with the cached master (three.js `Object3D.clone()` semantics)
 * to keep memory + draw setup cheap.
 *
 * Cache miss (V2/FIX-F P2-5, E18): instead of throwing, retry the fetch once
 * in the background (the v1 retry-on-reject eviction guarantees a real
 * re-fetch after a failed preload) and return a tiny neutral placeholder
 * Group immediately. When the retry succeeds the model is cloned into the
 * placeholder, and later getModel calls serve real clones from the cache.
 *
 * Disposal caveat (F5/E14): because geometries/materials are SHARED with the
 * permanent cache, calling `.dispose()` on a clone's geometry/material (e.g.
 * a blanket scene sweep) releases the cached master's GPU buffers/programs
 * too. three.js re-uploads them on next render (CPU-side data is retained),
 * so this is safe but causes re-upload churn — prefer disposing only
 * resources you created: use `isCachedResource` to skip shared masters, like
 * `roomManager`'s `disposeIfOwned` does.
 * @param {string} key e.g. 'food-kit/carrot'
 * @returns {import('three').Group}
 */
export function getModel(key) {
  const master = modelCache.get(key);
  if (master) {
    const clone = master.clone(true);
    clone.name = key;
    return clone;
  }
  console.warn(`assets: '${key}' not loaded — retrying fetch, placeholder returned`);
  const placeholder = makePlaceholder(key);
  loadModel(key).then(
    (loaded) => {
      if (loaded?.isObject3D !== true) return; // test seams may stub the scene
      placeholder.userData.placeholder = false;
      placeholder.add(loaded.clone(true));
    },
    (err) => {
      console.warn(`assets: retry for '${key}' failed — placeholder stays:`, err);
    }
  );
  return placeholder;
}

/**
 * Whether a key is already in the model cache (mainly for tests/dev tools).
 * @param {string} key
 * @returns {boolean}
 */
export function isLoaded(key) {
  return modelCache.has(key);
}
