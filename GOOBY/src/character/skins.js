// V2/G22: Gooby fur-color skin applier (PLAN2 §C8.5). Skins swap the BODY /
// BELLY / EAR_INNER colors; cheeks, nose, eyes, paw pads stay untouched.
// 'golden' additionally gets metalness 0.25 on the fur materials.
//
// HOW IT WORKS (the §D2.1 material structure, honored): gfx/materials.js
// hands out one PERMANENT shared instance per gooby part. Every rig shares
// goobyMat('belly') / goobyMat('earInner') directly, and clones
// goobyMat('body') once per rig (so the wet look can animate roughness).
// applySkin therefore
//   1. mutates the three SHARED materials in place → every current AND future
//      rig (minigame cameos, photo mode, the mini-Gooby plushie) inherits the
//      skin, because body clones made after the mutation copy the new color;
//   2. re-tints the given rig's existing body CLONE (found via its 'body'
//      mesh) so live rigs recolor immediately.
// Idempotent: colors/metalness are absolute sets, never deltas.
//
// previewSkin/clearSkinPreview tint ONE rig only (shop/wardrobe try-on):
// they clone the shared belly/earInner materials onto that rig's meshes so
// the try-on never leaks into the home scene or other cameos.
//
// initSkinSync (booted from the marked V2/G22 block in main.js) applies the
// saved skin at boot and re-applies on every 'skinChanged' store event +
// whenever the home scene rebuilds its rig (same polled-accessor pattern as
// character/outfitAttach.js initOutfitSync).
//
// Contract for other agents (G23 photo mode, G24–G28 cameos): create rigs
// with createGooby() as usual — the shared materials already carry the
// equipped skin. No per-scene calls needed; applyEquippedSkin(gooby) exists
// for rigs built BEFORE boot application or kept alive across equips.

import { goobyMat } from '../gfx/materials.js';
import { getSkin, DEFAULT_SKIN } from '../data/skins.js';

/** @typedef {import('../data/skins.js').SkinDef} SkinDef */

/** The three fur parts a skin recolors (§C8.5) — material id → color key. */
const FUR_PARTS = /** @type {const} */ ([
  ['body', 'body'],
  ['belly', 'belly'],
  ['earInner', 'earInner'],
]);

/** Resolve a rig root from a createGooby() API object or a bare Object3D. */
function rootOf(gooby) {
  if (!gooby) return null;
  if (gooby.isObject3D) return gooby;
  return gooby.group?.isObject3D ? gooby.group : null;
}

/**
 * The per-rig cloned body material (body/head/ears/arms/feet share one clone
 * — see character/gooby.js), or null when the rig has no 'body' mesh.
 * @param {object|null} gooby
 */
function rigBodyMaterial(gooby) {
  const root = rootOf(gooby);
  const mesh = root?.getObjectByName?.('body');
  return mesh?.material ?? null;
}

/**
 * Apply a fur skin globally (§C8.5): mutate the shared BODY/BELLY/EAR_INNER
 * materials (all rigs everywhere — cameos, photo mode, plushie) and re-tint
 * the given rig's body clone. Cheeks/nose/eyes untouched. Idempotent.
 * @param {object|null} gooby createGooby() rig (or bare group) to also
 *   recolor in place — pass null to only update the shared materials
 * @param {SkinDef|undefined|null} skinDef falls back to the 'cream' default
 * @returns {boolean} false when skinDef was unknown AND the default was used
 */
export function applySkin(gooby, skinDef) {
  const def = skinDef ?? getSkin(DEFAULT_SKIN);
  const metalness = def.metalness ?? 0;
  for (const [matId, colorKey] of FUR_PARTS) {
    const mat = goobyMat(matId);
    mat.color.set(def.colors[colorKey]);
    mat.metalness = metalness;
  }
  const clone = rigBodyMaterial(gooby);
  if (clone) {
    clone.color.set(def.colors.body);
    clone.metalness = metalness;
    // clear any leftover local try-on clones so the rig follows shared mats
    clearSkinPreview(gooby);
  }
  return skinDef != null || def.id === DEFAULT_SKIN;
}

// ---------------------------------------------------------------------------
// Local try-on (shop Skins tab / wardrobe Fur tab preview stages)
// ---------------------------------------------------------------------------

/** userData key holding a rig's local preview material clones. */
const PREVIEW_KEY = '_g22SkinPreview';

/**
 * Tint ONE rig with a skin without touching the shared materials — the
 * shop/wardrobe try-on. Belly/tail/ear-inner meshes get local clones (created
 * once, reused); the body clone is per-rig already.
 * @param {object} gooby @param {SkinDef} skinDef
 * @returns {boolean}
 */
export function previewSkin(gooby, skinDef) {
  const root = rootOf(gooby);
  if (!root || !skinDef) return false;
  const metalness = skinDef.metalness ?? 0;
  let rec = root.userData[PREVIEW_KEY];
  if (!rec) {
    rec = { clones: [], swapped: [] };
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const isBelly = obj.material === goobyMat('belly');
      const isEar = obj.material === goobyMat('earInner');
      if (isBelly || isEar) {
        const clone = obj.material.clone();
        clone.userData.shared = false;
        clone.userData.part = isBelly ? 'belly' : 'earInner';
        rec.swapped.push({ mesh: obj, original: obj.material });
        rec.clones.push(clone);
        obj.material = clone;
      }
    });
    root.userData[PREVIEW_KEY] = rec;
  }
  for (const clone of rec.clones) {
    clone.color.set(skinDef.colors[clone.userData.part]);
    clone.metalness = metalness;
  }
  const body = rigBodyMaterial(gooby);
  if (body) {
    body.color.set(skinDef.colors.body);
    body.metalness = metalness;
  }
  return true;
}

/**
 * Undo previewSkin on a rig: restore the shared materials, dispose the local
 * clones and re-tint the body clone back to the shared body color.
 * @param {object|null} gooby
 */
export function clearSkinPreview(gooby) {
  const root = rootOf(gooby);
  const rec = root?.userData?.[PREVIEW_KEY];
  if (!rec) return;
  delete root.userData[PREVIEW_KEY];
  for (const { mesh, original } of rec.swapped) mesh.material = original;
  for (const clone of rec.clones) clone.dispose();
  const body = rigBodyMaterial(gooby);
  if (body) {
    body.color.copy(goobyMat('body').color);
    body.metalness = goobyMat('body').metalness;
  }
}

// ---------------------------------------------------------------------------
// Live wiring (single marked V2/G22 block in main.js calls initSkinSync)
// ---------------------------------------------------------------------------

/** @type {object|null} store handle after initSkinSync */
let liveStore = null;

/**
 * Apply the CURRENTLY equipped save skin to a rig — the one-liner for scenes
 * that keep a rig alive across equips. New rigs don't need it (shared
 * materials already carry the skin). Safe no-op before initSkinSync.
 * @param {object|null} gooby
 * @returns {boolean}
 */
export function applyEquippedSkin(gooby) {
  if (!liveStore) return false;
  return applySkin(gooby, getSkin(liveStore.get('skins.equipped') ?? DEFAULT_SKIN));
}

let syncWired = false;

/**
 * Boot the skin system (idempotent): apply the saved skin to the shared
 * materials immediately, re-apply on 'skinChanged' (buy/equip), and keep the
 * live home-scene rig tinted across scene rebuilds.
 * @param {{store: object}} deps
 */
export function initSkinSync({ store }) {
  liveStore = store;
  if (syncWired) return;
  syncWired = true;

  // Dev harness (§E9 spirit, dev only): ?skin=<id> owns + equips at boot.
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  if (isDev && typeof location !== 'undefined') {
    const raw = new URLSearchParams(location.search).get('skin');
    if (raw && getSkin(raw)) {
      store.update((state) => {
        if (!state.skins.owned.includes(raw)) state.skins.owned.push(raw);
        state.skins.equipped = raw;
      });
    }
  }

  /** @type {object|null} */
  let lastGooby = null;
  const apply = () => applySkin(lastGooby, getSkin(store.get('skins.equipped') ?? DEFAULT_SKIN));
  apply(); // boot application — cameo rigs created later inherit via shared mats
  store.on('skinChanged', apply);

  setInterval(async () => {
    try {
      const mod = await import('../home/homeScene.js');
      const gooby = mod.getGooby?.();
      if (!gooby) {
        lastGooby = null;
        return;
      }
      if (gooby !== lastGooby) {
        lastGooby = gooby;
        apply();
      }
    } catch {
      /* home scene not present (tests / early boot) */
    }
  }, 700);
}
