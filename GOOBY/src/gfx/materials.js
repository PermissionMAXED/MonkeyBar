// Shared cheap materials + palette constants (§D2.1, binding). One module-level
// cache so every scene reuses the same material instances (fewer program
// switches). Shared materials are marked `userData.shared = true` — scene
// dispose() routines MUST skip those (they are permanent for the app lifetime).
// Anything that needs per-instance mutation (e.g. Gooby's wet look animates
// body roughness) should clone() the shared material and dispose the clone.

import * as THREE from 'three';

/** Gooby palette (§D2.1 — binding). */
export const PALETTE = Object.freeze({
  BODY: '#F6EAD7',
  BELLY: '#FFF9EC',
  EAR_INNER: '#F6A8B8',
  NOSE: '#E88BA0',
  CHEEK: '#F9C6CF', // rendered at opacity 0.85
  EYE: '#3A2E2E',
  EYE_SHINE: '#FFFFFF',
  PAW_PAD: '#F3B7C3',
});

/** Cheek opacity (§D2.1). */
export const CHEEK_OPACITY = 0.85;

/** Supporting detail colors (not in the binding palette, used by the rig/fx). */
export const DETAIL = Object.freeze({
  TOOTH: '#FFFFFF',
  MOUTH: '#4A2B33',
  TONGUE: '#F08A9B',
  DROOL: '#A9DCF2',
  SHADOW: '#3A2E2E',
});

/** Body material spec (§D2.1): MeshStandardMaterial{ roughness:0.65, metalness:0 }. */
export const BODY_ROUGHNESS = 0.65;

/** @type {Map<string, THREE.Material>} */
const cache = new Map();

/**
 * Cached MeshStandardMaterial factory. Same args → same instance.
 * @param {string} color hex color
 * @param {{roughness?: number, metalness?: number, opacity?: number, flatShading?: boolean}} [opts]
 * @returns {THREE.MeshStandardMaterial} shared instance (`userData.shared === true`)
 */
export function standardMat(color, opts = {}) {
  const { roughness = BODY_ROUGHNESS, metalness = 0, opacity = 1, flatShading = false } = opts;
  const key = `std|${color}|${roughness}|${metalness}|${opacity}|${flatShading}`;
  if (!cache.has(key)) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      flatShading,
      transparent: opacity < 1,
      opacity,
    });
    mat.userData.shared = true;
    cache.set(key, mat);
  }
  return /** @type {THREE.MeshStandardMaterial} */ (cache.get(key));
}

/**
 * Named shared materials for Gooby's parts (§D2.1 palette).
 * @param {'body'|'belly'|'earInner'|'nose'|'cheek'|'eye'|'eyeShine'|'pawPad'|'tooth'|'mouth'|'tongue'|'drool'} id
 * @returns {THREE.MeshStandardMaterial}
 */
export function goobyMat(id) {
  switch (id) {
    case 'body': return standardMat(PALETTE.BODY);
    case 'belly': return standardMat(PALETTE.BELLY);
    case 'earInner': return standardMat(PALETTE.EAR_INNER, { roughness: 0.7 });
    case 'nose': return standardMat(PALETTE.NOSE, { roughness: 0.55 });
    case 'cheek': return standardMat(PALETTE.CHEEK, { roughness: 0.8, opacity: CHEEK_OPACITY });
    case 'eye': return standardMat(PALETTE.EYE, { roughness: 0.25 });
    case 'eyeShine': return standardMat(PALETTE.EYE_SHINE, { roughness: 0.2 });
    case 'pawPad': return standardMat(PALETTE.PAW_PAD, { roughness: 0.75 });
    case 'tooth': return standardMat(DETAIL.TOOTH, { roughness: 0.45 });
    case 'mouth': return standardMat(DETAIL.MOUTH, { roughness: 0.9 });
    case 'tongue': return standardMat(DETAIL.TONGUE, { roughness: 0.8 });
    case 'drool': return standardMat(DETAIL.DROOL, { roughness: 0.2, opacity: 0.85 });
    default: throw new Error(`[materials] unknown gooby material '${id}'`);
  }
}

/**
 * Dispose helper for scenes: disposes a material only when it is NOT one of
 * the shared cached instances.
 * @param {THREE.Material|THREE.Material[]} material
 */
export function disposeIfOwned(material) {
  for (const m of Array.isArray(material) ? material : [material]) {
    if (m && !m.userData?.shared) m.dispose?.();
  }
}
