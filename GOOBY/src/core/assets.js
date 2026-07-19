/**
 * GOOBY — asset loader + permanent cache (PLAN.md §B, §D1, §E1; PLAN3 §B6).
 *
 * Committed Kenney assets live under `public/assets/kenney/` (see
 * `scripts/kenney-manifest.mjs`):
 *   <slug>/<name>.glb           — models
 *   <slug>/audio/<name>.ogg     — audio packs
 *
 * V3/G31 (PLAN3 §B6): a second committed root `public/assets/kaykit/` (see
 * `scripts/kaykit-manifest.mjs`) with two file forms:
 *   <slug>/<name>.glb           — self-contained (the 3 rigged characters)
 *   <slug>/<name>.gltf + .bin + one shared <pack>_texture.png — GLTFLoader
 *                                 resolves the relative URIs against the URL
 * The frozen PACK_FORMATS table maps slug → { root, ext }; every slug not
 * listed resolves exactly as before (kenney/glb).
 *
 * V3/FIX-E (E10): external model textures (the shared KayKit pack atlases)
 * are deduped through a URL-keyed cache registered as a LoadingManager
 * handler — every .gltf of a pack shares ONE Texture/Source/GPU upload, and
 * the shared masters are isCachedResource-owned so sweeps never dispose them.
 *
 * Asset key format everywhere in the game: `'<slug>/<file-no-ext>'`,
 * e.g. `'food-kit/carrot'`, `'kaykit-restaurant/oven'`,
 * `'kaykit-characters/Knight'`, audio `'ui-audio/switch1'`.
 */

import * as THREE from 'three'; // V2/FIX-F: placeholder Group (P2-5, E18)
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// V3/G31 (§B6): skinned characters MUST be cloned via SkeletonUtils.clone —
// plain Object3D.clone() breaks skeleton bindings (binding rule §E0.1-10).
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

/** Packs whose files are OGGs under `<slug>/audio/` (PLAN.md §D1 + PLAN3 §D3). */
const AUDIO_PACK_SLUGS = new Set([
  'interface-sounds',
  'impact-sounds',
  'music-jingles',
  // V3/G31 (PLAN3 §D3.2–§D3.4)
  'ui-audio',
  'ui-pack-sounds',
  'casino-audio',
]);

/**
 * V3/G31 (PLAN3 §B6/§D8-3): slug → { root: 'kenney'|'kaykit', ext:
 * 'glb'|'gltf' } for model packs that deviate from the kenney/glb default
 * (toy-car-kit, watercraft-kit, survival-kit etc. need no entry). `.gltf`
 * entries load their sibling `.bin` + shared texture by relative URI.
 * @type {Readonly<Record<string, {root: string, ext: string}>>}
 */
export const PACK_FORMATS = Object.freeze({
  'kaykit-characters': Object.freeze({ root: 'kaykit', ext: 'glb' }),
  'kaykit-restaurant': Object.freeze({ root: 'kaykit', ext: 'gltf' }),
  'kaykit-city': Object.freeze({ root: 'kaykit', ext: 'gltf' }),
  'kaykit-halloween': Object.freeze({ root: 'kaykit', ext: 'gltf' }),
});

/** Default format for every slug not in PACK_FORMATS (v1/v2 behavior). */
const DEFAULT_FORMAT = Object.freeze({ root: 'kenney', ext: 'glb' });

// Vite injects import.meta.env (BASE_URL './' per vite.config.js); plain node
// (tests) has no env object, so fall back to '/'.
const baseUrl = () => import.meta.env?.BASE_URL ?? '/';

let loader = new GLTFLoader();

/**
 * Permanent cache: key → { scene, animations } (master copies, never handed
 * out). V3/G31 (§B6): animations are the gltf's AnimationClip array — shared
 * via getAnimations, never cloned; scene clones bind them by node name.
 */
const modelCache = new Map();
/** In-flight/settled load promises so concurrent preloads coalesce. */
const loadPromises = new Map();

// ── V3/FIX-E P1-1 (E10): URL-keyed shared texture cache ─────────────────────
// KayKit `.gltf` packs (§B6) reference ONE shared atlas per pack
// (`<pack>_texture.png`), but a plain GLTFLoader fetches + decodes that image
// once PER MODEL (purblePlace: 19 fetches, 27 GPU copies ≈ 112 MB vs the
// 64 MB §A2.3 texture budget). GLTFLoader consults
// `manager.getHandler(<image uri>)` before falling back to its internal
// texture loader, so a caching handler registered on the loading manager
// makes every model of a pack share the SAME Texture instance: one fetch +
// decode, one Source → one GPU upload. Embedded images (GLB bufferViews,
// data: URIs) never reach getHandler and keep the stock path.

/** In-flight/settled shared-texture promises: resolved URL → Promise<Texture>. */
const texturePromises = new Map();
/** Loads the actual image (swappable test seam — see _setTextureLoaderForTests). */
let textureLoader = new THREE.TextureLoader();

/** LoadingManager handler: serves one shared, cache-owned Texture per URL. */
const cachingTextureHandler = {
  load(url, onLoad, onProgress, onError) {
    let p = texturePromises.get(url);
    if (!p) {
      p = new Promise((resolve, reject) => {
        textureLoader.load(url, resolve, undefined, reject);
      }).then(
        (tex) => {
          // The shared master is permanent — consumers/sweeps must never
          // dispose it (extends the V2/FIX-F P2-3 ownership guard).
          cachedResources.add(tex);
          if (tex.source) cachedResources.add(tex.source);
          return tex;
        },
        (err) => {
          // Evict the rejected promise so a later model load retries the
          // fetch (mirrors the model-promise eviction in loadModel).
          if (texturePromises.get(url) === p) texturePromises.delete(url);
          throw err;
        }
      );
      texturePromises.set(url, p);
    }
    p.then(onLoad, onError ?? (() => {}));
  },
};

// GLTFLoader matches handlers against the RAW image uri from the glTF JSON
// (e.g. 'restaurantbits_texture.png'); the handler then receives the
// resolved URL — per-pack cache keys stay distinct. Registered on the
// default manager (shared by every GLTFLoader this module creates).
THREE.DefaultLoadingManager.addHandler(/\.(png|jpe?g)$/i, cachingTextureHandler);

// ── V2/FIX-F P2-3 (E17): cache ownership registry ───────────────────────────
// Geometries/materials/textures of cache MASTERS. getModel clones SHARE these
// objects (Object3D.clone() semantics), so scene dispose sweeps (minigame
// framework) can consult isCachedResource to skip them — disposing a shared
// master forces a GPU re-upload + shader recompile on the next scene that
// uses the model. V3/FIX-E (E10): also holds the shared pack textures + their
// Sources — disposing one of those would break EVERY model of the pack.
/** @type {WeakSet<object>} */
const cachedResources = new WeakSet();

/**
 * Whether a geometry/material/texture belongs to (is shared with) the
 * permanent asset cache. Scene dispose sweeps must SKIP these — mirror
 * `roomManager`'s `disposeIfOwned` pattern (V2/FIX-F P2-3).
 * @param {object|null|undefined} resource a THREE geometry, material or texture
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
 *   · V3/FIX-E (E10): register the materials' textures (+ their Sources) too —
 *     the KayKit pack atlases are SHARED across every model of a pack via the
 *     caching texture handler, and GLB-embedded textures are shared by all
 *     clones of their master; a dispose sweep must never free either kind.
 * @param {object} sceneRoot the gltf.scene master
 */
const MATERIAL_TEXTURE_SLOTS = [
  'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap',
  'bumpMap', 'alphaMap', 'lightMap', 'envMap', 'specularMap',
];
function normalizeLoadedScene(sceneRoot) {
  sceneRoot.traverse?.((obj) => {
    if (obj.geometry) cachedResources.add(obj.geometry);
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const mat of mats) {
      cachedResources.add(mat);
      for (const slot of MATERIAL_TEXTURE_SLOTS) {
        const tex = mat[slot];
        if (!tex) continue;
        cachedResources.add(tex); // V3/FIX-E: master textures are cache-owned
        if (tex.source) cachedResources.add(tex.source);
      }
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
 * Test seam: swap the shared-texture image loader (must expose
 * `load(url, onLoad, onProgress, onError)`) and reset the URL-keyed texture
 * cache. Used by `test/assets.test.js` to verify the V3/FIX-E dedupe without
 * network/Image decode; production code never calls this.
 * @param {{load: Function}|null} l replacement loader, or null to restore
 *   the real TextureLoader
 */
export function _setTextureLoaderForTests(l) {
  textureLoader = l ?? new THREE.TextureLoader();
  texturePromises.clear();
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
 * URL of a model file for a key. V3/G31 (§B6): consults PACK_FORMATS —
 * kaykit slugs resolve under `assets/kaykit/` with their `.glb`/`.gltf`
 * extension; everything else stays `assets/kenney/<slug>/<name>.glb`.
 * @param {string} key e.g. 'food-kit/carrot', 'kaykit-restaurant/oven'
 * @returns {string}
 */
export function getModelUrl(key) {
  const { slug, name } = parseKey(key);
  const fmt = PACK_FORMATS[slug] ?? DEFAULT_FORMAT;
  return `${baseUrl()}assets/${fmt.root}/${slug}/${name}.${fmt.ext}`;
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
        // V3/G31 (§B6): keep the AnimationClips — masters cache both.
        modelCache.set(key, {
          scene: gltf.scene,
          animations: gltf.animations ?? [],
        });
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
  const master = modelCache.get(key)?.scene;
  if (master) {
    // V3/G31 (§B6): plain Object3D.clone() breaks skeleton bindings — the
    // KayKit characters (or any skinned model) must go through
    // getSkinnedModel. Warn loudly instead of handing out a broken rig.
    if (hasSkinnedMesh(master)) {
      console.warn(
        `assets: '${key}' contains SkinnedMesh — use getSkinnedModel(key), ` +
          'plain clones break skeleton bindings (PLAN3 §B6)'
      );
    }
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

// ── V3/G31 (PLAN3 §B6): animations + skinned-character cloning ──────────────

/** @param {object} root @returns {boolean} any SkinnedMesh in the subtree? */
function hasSkinnedMesh(root) {
  let found = false;
  root.traverse?.((obj) => {
    if (obj.isSkinnedMesh) found = true;
  });
  return found;
}

/**
 * The cached AnimationClip array of a preloaded model (PLAN3 §B6). The array
 * and its clips are SHARED masters — never cloned, never mutated by callers;
 * bind them to a getSkinnedModel clone via `new AnimationMixer(clone)
 * .clipAction(clip)` (clips bind by node name). Static models simply return
 * `[]`. Not-yet-loaded keys warn and return `[]` — preload first (§E1).
 * @param {string} key e.g. 'kaykit-characters/Knight'
 * @returns {import('three').AnimationClip[]}
 */
export function getAnimations(key) {
  const cached = modelCache.get(key);
  if (!cached) {
    console.warn(`assets: getAnimations('${key}') before load — [] returned`);
    return [];
  }
  return cached.animations;
}

/**
 * Get a fresh instance of a preloaded SKINNED model (the KayKit characters),
 * cloned via `SkeletonUtils.clone` so every SkinnedMesh is re-bound to its
 * OWN cloned skeleton (PLAN3 §B6 binding rule: plain `Object3D.clone()` is
 * FORBIDDEN for skinned models — clones would keep driving the master's
 * bones). Geometries/materials stay shared with the cached master (same
 * ownership semantics as getModel — see isCachedResource). Animate with the
 * shared clips from `getAnimations(key)`.
 *
 * Cache miss: mirrors getModel's fail-soft (V2/FIX-F P2-5) — background
 * retry + neutral placeholder Group that self-heals with a proper
 * SkeletonUtils clone when the load lands.
 * @param {string} key e.g. 'kaykit-characters/Knight'
 * @returns {import('three').Object3D}
 */
export function getSkinnedModel(key) {
  const master = modelCache.get(key)?.scene;
  if (master) {
    const clone = skeletonClone(master);
    clone.name = key;
    return clone;
  }
  console.warn(`assets: '${key}' not loaded — retrying fetch, placeholder returned`);
  const placeholder = makePlaceholder(key);
  loadModel(key).then(
    (loaded) => {
      if (loaded?.isObject3D !== true) return; // test seams may stub the scene
      placeholder.userData.placeholder = false;
      placeholder.add(skeletonClone(loaded));
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
