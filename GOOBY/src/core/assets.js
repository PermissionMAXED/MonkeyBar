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

const loader = new GLTFLoader();

/** Permanent cache: key → loaded gltf.scene (master copy, never handed out). */
const modelCache = new Map();
/** In-flight/settled load promises so concurrent preloads coalesce. */
const loadPromises = new Map();

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
    p = loader.loadAsync(getModelUrl(key)).then((gltf) => {
      modelCache.set(key, gltf.scene);
      return gltf.scene;
    });
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

/**
 * Get a fresh instance of a preloaded model: the node hierarchy is deep-cloned
 * (safe to reposition/rename/add per scene) while geometries and materials
 * stay shared with the cached master (three.js `Object3D.clone()` semantics)
 * to keep memory + draw setup cheap.
 * @param {string} key e.g. 'food-kit/carrot'
 * @returns {import('three').Group}
 */
export function getModel(key) {
  const master = modelCache.get(key);
  if (!master) {
    throw new Error(`assets: '${key}' not loaded — call preload(['${key}']) first`);
  }
  const clone = master.clone(true);
  clone.name = key;
  return clone;
}

/**
 * Whether a key is already in the model cache (mainly for tests/dev tools).
 * @param {string} key
 * @returns {boolean}
 */
export function isLoaded(key) {
  return modelCache.has(key);
}
