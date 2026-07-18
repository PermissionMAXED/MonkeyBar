// Outfit attach (§C5.3 / §D2.3; V2/G22 adds the 9 §C8.4 items → 20 total) —
// procedural outfit items built from
// three.js primitives and attached to Gooby's anchors (hat / glasses / neck).
// All positions/sizes are in Gooby "recipe space" (§D2.2 — the anchors live
// inside the rig, which is uniformly scaled to the 1.05-unit target height),
// tuned with screenshots so items sit correctly: hats perch on the front-top
// of the skull BETWEEN the ears (the ears rise from (±0.13, z 0) — anything
// centered z ≥ ~+0.08 with base radius ≤ ~0.11 clears them), glasses ride the
// eye line, neckwear wraps the head/body seam.
//
// applyOutfits(gooby, equipped) is idempotent (removes the previous item per
// slot before attaching) and accepts either the createGooby() API object or a
// bare THREE.Group containing the named 'anchor-*' nodes — so it also works
// for minigame-cameo rigs (games call applyEquippedOutfits(gooby) — 1 line).
// initOutfitSync() keeps the live home-scene Gooby dressed ('outfitChanged'
// store event + re-apply whenever the home scene rebuilds its rig).

import * as THREE from 'three';
import { OUTFIT_EQUIP_SLOTS, OUTFITS_BY_ID } from '../data/outfits.js';
import { getModel, isCachedResource, preload } from '../core/assets.js';

/** The one non-procedural §C13 outfit asset (preloaded lazily by wardrobe/live sync). */
export const OUTFIT_ASSET_KEYS = Object.freeze([
  'kaykit-halloween/pumpkin_orange_small',
]);

/** Warm the real pumpkin model without making any caller's mount path async. */
export const preloadOutfitAssets = () => preload(OUTFIT_ASSET_KEYS);

// ---------------------------------------------------------------------------
// Materials — module-level permanent cache (same pattern as gfx/materials.js;
// marked shared so scene dispose routines skip them). DoubleSide because
// several pieces are flat (cap brim, lens fills, star rims).
// ---------------------------------------------------------------------------

/** Outfit palette (pastel brand-adjacent — §D5). */
const C = Object.freeze({
  PINK: '#FF7BA9',
  CREAM: '#FFF9EC',
  YELLOW: '#FFD166',
  TEAL: '#59C9B9',
  TEAL_DARK: '#3FA396',
  SKY: '#6EC6FF',
  RED: '#E0655F',
  RED_DARK: '#B84943',
  CHARCOAL: '#3A3A44',
  GOLD: '#F7C948',
  BROWN: '#7A5C4F',
  BLACK: '#26262E',
  LENS_DARK: '#1A1A22',
  LENS_TINT: '#BFE3FF',
  LENS_PINK: '#FFD4E4',
  ORANGE: '#F28C3A',
  ORANGE_DARK: '#B75B2A',
  GREEN: '#4F9C67',
  GREEN_DARK: '#2E6846',
  BLUE: '#438AC9',
  NAVY: '#263D66',
  SILVER: '#B7C2CC',
  LILAC: '#B896E8',
  CYAN: '#55D7DF',
});

/** @type {Map<string, THREE.MeshStandardMaterial>} */
const matCache = new Map();

/**
 * Cached outfit material (permanent, shared — never dispose).
 * @param {string} color
 * @param {{roughness?: number, metalness?: number, opacity?: number}} [opts]
 * @returns {THREE.MeshStandardMaterial}
 */
function outfitMat(color, opts = {}) {
  const { roughness = 0.6, metalness = 0, opacity = 1 } = opts;
  const key = `${color}|${roughness}|${metalness}|${opacity}`;
  if (!matCache.has(key)) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
    });
    mat.userData.shared = true;
    matCache.set(key, mat);
  }
  return matCache.get(key);
}

/** Gold with a metallic sheen (crown). */
const gold = () => outfitMat(C.GOLD, { roughness: 0.32, metalness: 0.55 });

/** @type {Map<string, THREE.Texture>} permanent procedural fabric textures. */
const textureCache = new Map();

/**
 * Browser builds get the §C13 CanvasTexture; node tests get an equivalent
 * DataTexture so builders remain headless-safe.
 * @param {'tweed'|'knit'} kind
 */
function fabricTexture(kind) {
  if (textureCache.has(kind)) return textureCache.get(kind);
  let tex;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = kind === 'tweed' ? '#9B795F' : '#D94E52';
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = kind === 'tweed' ? 'rgba(55,37,28,.55)' : 'rgba(255,255,255,.25)';
    ctx.lineWidth = kind === 'tweed' ? 5 : 2;
    const step = kind === 'tweed' ? 16 : 8;
    for (let p = 0; p <= 64; p += step) {
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, 64);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(64, p);
      ctx.stroke();
    }
    if (kind === 'knit') {
      ctx.strokeStyle = 'rgba(90,20,25,.25)';
      for (let p = -64; p < 128; p += 12) {
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p + 64, 64);
        ctx.stroke();
      }
    }
    tex = new THREE.CanvasTexture(canvas);
  } else {
    const size = 8;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * size + x) * 4;
        const line = kind === 'tweed' ? x % 4 === 0 || y % 4 === 0 : (x + y) % 3 === 0;
        const rgb = kind === 'tweed'
          ? (line ? [92, 66, 49] : [155, 121, 95])
          : (line ? [165, 47, 52] : [217, 78, 82]);
        data.set([...rgb, 255], i);
      }
    }
    tex = new THREE.DataTexture(data, size, size);
    tex.needsUpdate = true;
  }
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(kind === 'tweed' ? 3 : 5, kind === 'tweed' ? 3 : 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(kind, tex);
  return tex;
}

/** @type {Map<string, THREE.MeshStandardMaterial>} */
const fabricMatCache = new Map();

/** @param {'tweed'|'knit'} kind */
function fabricMat(kind) {
  if (!fabricMatCache.has(kind)) {
    const texture = fabricTexture(kind);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      map: texture,
      bumpMap: kind === 'knit' ? texture : null,
      bumpScale: kind === 'knit' ? 0.018 : 0,
      side: THREE.DoubleSide,
    });
    mat.userData.shared = true;
    fabricMatCache.set(kind, mat);
  }
  return fabricMatCache.get(kind);
}

// V2/G22 (§C8.4): extra palette entries for the 9 new items.
const C2 = Object.freeze({
  STRAW: '#E8C97A',
  STRAW_DARK: '#C9A85C',
  WHITE: '#FFFFFF',
  LEAF: '#5FA85E',
  PURPLE: '#6C55A3',
  PURPLE_DARK: '#55428A',
});

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/**
 * @param {THREE.Group} parent @param {THREE.BufferGeometry} geo
 * @param {THREE.Material} mat @param {[number,number,number]} [pos]
 * @returns {THREE.Mesh}
 */
function add(parent, geo, mat, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  parent.add(m);
  return m;
}

/**
 * 5-point star ring geometry (outer/inner radius, circular hole) — the
 * starGlasses rims (§C5.3).
 * @param {number} outerR @param {number} innerR @param {number} holeR
 * @param {number} depth
 * @returns {THREE.ExtrudeGeometry}
 */
function starRingGeometry(outerR, innerR, holeR, depth) {
  const shape = new THREE.Shape();
  const points = 5;
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2; // one point up
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
}

// ---------------------------------------------------------------------------
// The 11 item builders (§C5.3) — each returns a THREE.Group in anchor space
// ---------------------------------------------------------------------------

/** Party hat 120 — striped cone (4 alternating frusta) + pompom. */
function buildPartyHat() {
  const g = new THREE.Group();
  const SEGS = 4;
  const R = 0.095;
  const H = 0.24;
  for (let i = 0; i < SEGS; i += 1) {
    const rBottom = R * (1 - i / SEGS);
    const rTop = R * (1 - (i + 1) / SEGS);
    const h = H / SEGS;
    const geo = new THREE.CylinderGeometry(Math.max(0.001, rTop), rBottom, h, 18);
    add(g, geo, outfitMat(i % 2 === 0 ? C.PINK : C.CREAM), [0, h * (i + 0.5), 0]);
  }
  add(g, new THREE.SphereGeometry(0.034, 10, 8), outfitMat(C.YELLOW, { roughness: 0.8 }), [0, H + 0.018, 0]);
  g.position.set(0, -0.015, 0.075);
  g.rotation.x = 0.3;
  return g;
}

/** Beanie 100 — hemisphere dome + folded brim torus + pompom. */
function buildBeanie() {
  const g = new THREE.Group();
  const dome = add(
    g,
    new THREE.SphereGeometry(0.115, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
    outfitMat(C.TEAL),
    [0, 0.008, 0]
  );
  dome.scale.set(1, 0.95, 1);
  const brim = add(g, new THREE.TorusGeometry(0.108, 0.028, 10, 22), outfitMat(C.TEAL_DARK), [0, 0.012, 0]);
  brim.rotation.x = Math.PI / 2;
  brim.scale.set(1, 1, 0.85);
  add(g, new THREE.SphereGeometry(0.04, 10, 8), outfitMat(C.CREAM, { roughness: 0.85 }), [0, 0.125, 0]);
  g.position.set(0, -0.018, 0.07);
  g.rotation.x = 0.24;
  return g;
}

/** Cap 150 — dome + forward brim + button. */
function buildCap() {
  const g = new THREE.Group();
  const dome = add(
    g,
    new THREE.SphereGeometry(0.118, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    outfitMat(C.SKY),
    [0, 0, 0]
  );
  dome.scale.set(1, 0.9, 1);
  add(g, new THREE.SphereGeometry(0.02, 8, 6), outfitMat(C.CREAM), [0, 0.105, 0]);
  // brim: flat semicircle sticking out over the eyes
  const brim = add(g, new THREE.CircleGeometry(0.115, 16, 0, Math.PI), outfitMat(C.SKY), [0, 0.014, 0.05]);
  brim.rotation.x = -Math.PI / 2 - 0.22; // lie flat, dip slightly at the front
  brim.scale.set(1, 1.3, 1);
  g.position.set(0, -0.028, 0.07);
  g.rotation.x = 0.26;
  return g;
}

/** Top hat 300 — cylinder + wide brim + band. */
function buildTopHat() {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.145, 0.145, 0.014, 24), outfitMat(C.CHARCOAL, { roughness: 0.45 }), [0, 0.007, 0]);
  add(g, new THREE.CylinderGeometry(0.096, 0.086, 0.2, 20), outfitMat(C.CHARCOAL, { roughness: 0.45 }), [0, 0.114, 0]);
  add(g, new THREE.CylinderGeometry(0.0915, 0.0905, 0.042, 20), outfitMat(C.RED), [0, 0.036, 0]);
  g.position.set(0, -0.012, 0.065);
  g.rotation.x = 0.18;
  return g;
}

/** Crown 1200 — gold cylinder + zigzag rim spikes + jewel spheres (endgame flex). */
function buildCrown() {
  const g = new THREE.Group();
  const BAND_H = 0.08;
  const R = 0.092;
  add(g, new THREE.CylinderGeometry(R, R + 0.007, BAND_H, 24, 1, true), gold(), [0, BAND_H / 2, 0]);
  const rim = add(g, new THREE.TorusGeometry(R + 0.006, 0.011, 8, 24), gold(), [0, 0.004, 0]);
  rim.rotation.x = Math.PI / 2;
  // zigzag rim: 8 points around the top edge
  const SPIKES = 8;
  const spikeGeo = new THREE.ConeGeometry(0.026, 0.055, 6);
  for (let i = 0; i < SPIKES; i += 1) {
    const a = (i / SPIKES) * Math.PI * 2;
    const spike = add(g, spikeGeo, gold(), [Math.cos(a) * (R - 0.004), BAND_H + 0.024, Math.sin(a) * (R - 0.004)]);
    spike.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); // lean slightly outward
  }
  // jewels on the band (front + sides + back, alternating colors)
  const jewelGeo = new THREE.SphereGeometry(0.017, 10, 8);
  const jewelCols = [C.RED, C.TEAL, C.PINK, C.TEAL];
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 2; // first jewel at the front (+z)
    add(g, jewelGeo, outfitMat(jewelCols[i], { roughness: 0.2, metalness: 0.1 }), [
      Math.cos(a) * (R + 0.008), BAND_H * 0.55, Math.sin(a) * (R + 0.008),
    ]);
  }
  g.position.set(0, -0.012, 0.07);
  g.rotation.x = 0.16;
  return g;
}

/**
 * Shared glasses chassis: bridge + 2 temple arms angled back to the head.
 * @param {THREE.Group} g @param {THREE.Material} mat @param {number} lensX lens center |x|
 */
function addGlassesFrame(g, mat, lensX) {
  add(g, new THREE.CylinderGeometry(0.009, 0.009, 0.07, 8), mat, [0, 0.02, 0.005]).rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) {
    const arm = add(g, new THREE.BoxGeometry(0.011, 0.011, 0.17), mat, [sx * 0.205, 0.02, -0.065]);
    arm.rotation.y = -sx * 0.38;
  }
}

/** Round glasses 150 — 2 torus lenses + bridge + temples. */
function buildRoundGlasses() {
  const g = new THREE.Group();
  const frame = outfitMat(C.BROWN, { roughness: 0.5 });
  const rimGeo = new THREE.TorusGeometry(0.062, 0.011, 10, 22);
  const fillGeo = new THREE.CircleGeometry(0.058, 18);
  for (const sx of [-1, 1]) {
    add(g, rimGeo, frame, [sx * 0.112, 0, 0.012]);
    add(g, fillGeo, outfitMat(C.LENS_TINT, { roughness: 0.15, opacity: 0.3 }), [sx * 0.112, 0, 0.008]);
  }
  addGlassesFrame(g, frame, 0.112);
  return g;
}

/** Sunglasses 200 — dark discs + browline + temples. */
function buildSunglasses() {
  const g = new THREE.Group();
  const frame = outfitMat(C.BLACK, { roughness: 0.35 });
  const lensGeo = new THREE.CylinderGeometry(0.066, 0.066, 0.014, 20);
  for (const sx of [-1, 1]) {
    const lens = add(g, lensGeo, outfitMat(C.LENS_DARK, { roughness: 0.15, opacity: 0.92 }), [sx * 0.112, -0.004, 0.012]);
    lens.rotation.x = Math.PI / 2;
  }
  add(g, new THREE.BoxGeometry(0.245, 0.02, 0.016), frame, [0, 0.052, 0.01]);
  addGlassesFrame(g, frame, 0.112);
  return g;
}

/** Star glasses 250 — star-shaped rims + tinted lenses. */
function buildStarGlasses() {
  const g = new THREE.Group();
  const frame = outfitMat(C.PINK, { roughness: 0.4 });
  const starGeo = starRingGeometry(0.085, 0.05, 0.042, 0.014);
  const fillGeo = new THREE.CircleGeometry(0.044, 16);
  for (const sx of [-1, 1]) {
    add(g, starGeo, frame, [sx * 0.115, 0, 0.004]);
    add(g, fillGeo, outfitMat(C.LENS_PINK, { roughness: 0.15, opacity: 0.45 }), [sx * 0.115, 0, 0.006]);
  }
  addGlassesFrame(g, frame, 0.115);
  return g;
}

/**
 * Scarf ring around the head/body seam — full torus (or striped segments)
 * half-buried in the body so it reads as wrapped.
 * @param {THREE.Group} g @param {string[]} colors 1 = solid, 2+ = stripes
 */
function addScarfRing(g, colors) {
  const SEGS = colors.length === 1 ? 1 : 10;
  const arc = (Math.PI * 2) / SEGS;
  for (let i = 0; i < SEGS; i += 1) {
    const geo = new THREE.TorusGeometry(0.33, 0.07, 10, SEGS === 1 ? 28 : 4, SEGS === 1 ? Math.PI * 2 : arc);
    const ring = add(g, geo, outfitMat(colors[i % colors.length], { roughness: 0.85 }), [0, 0.0, -0.05]);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = i * arc;
    ring.scale.set(1, 1, 0.8); // flatten vertically (torus local z = world y here)
  }
}

/**
 * Hanging scarf tail (stacked boxes; multiple colors = stripes).
 * @param {THREE.Group} g @param {number} sx -1|1 @param {string[]} colors
 */
function addScarfTail(g, sx, colors) {
  const tail = new THREE.Group();
  const N = colors.length === 1 ? 1 : 3;
  const segH = 0.22 / N;
  for (let i = 0; i < N; i += 1) {
    add(tail, new THREE.BoxGeometry(0.095, segH, 0.042), outfitMat(colors[i % colors.length], { roughness: 0.85 }), [
      0, -segH * (i + 0.5), 0,
    ]);
  }
  // fringe nubs at the tail end
  for (const fx of [-0.03, 0, 0.03]) {
    add(tail, new THREE.BoxGeometry(0.02, 0.035, 0.03), outfitMat(colors[colors.length - 1], { roughness: 0.9 }), [
      fx, -0.22 - 0.014, 0,
    ]);
  }
  tail.position.set(sx * 0.06, -0.02, 0.36);
  tail.rotation.x = -0.22; // follow the belly slope
  tail.rotation.z = sx * 0.12;
  g.add(tail);
}

/** Red scarf 120 — torus segment ring + 2 hanging tails. */
function buildScarfRed() {
  const g = new THREE.Group();
  addScarfRing(g, [C.RED]);
  addScarfTail(g, -1, [C.RED]);
  addScarfTail(g, 1, [C.RED_DARK]);
  add(g, new THREE.BoxGeometry(0.13, 0.075, 0.06), outfitMat(C.RED, { roughness: 0.85 }), [0, -0.005, 0.315]);
  g.position.y = -0.01;
  return g;
}

/** Bowtie 140 — 2 wing boxes + center knot on a thin neck band. */
function buildBowtie() {
  const g = new THREE.Group();
  const band = add(g, new THREE.TorusGeometry(0.325, 0.02, 8, 26), outfitMat(C.RED_DARK), [0, 0.01, -0.05]);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1, 0.9);
  for (const sx of [-1, 1]) {
    const wing = add(g, new THREE.BoxGeometry(0.125, 0.078, 0.045), outfitMat(C.RED), [sx * 0.077, 0.005, 0.31]);
    wing.rotation.z = sx * 0.14;
    wing.rotation.x = -0.15;
  }
  const knot = add(g, new THREE.BoxGeometry(0.05, 0.058, 0.05), outfitMat(C.RED_DARK), [0, 0.005, 0.325]);
  knot.rotation.x = -0.15;
  return g;
}

/** Striped scarf 180 — teal/cream striped ring + striped tails. */
function buildScarfStriped() {
  const g = new THREE.Group();
  addScarfRing(g, [C.TEAL, C.CREAM]);
  addScarfTail(g, -1, [C.TEAL, C.CREAM, C.TEAL]);
  addScarfTail(g, 1, [C.CREAM, C.TEAL, C.CREAM]);
  add(g, new THREE.BoxGeometry(0.13, 0.075, 0.06), outfitMat(C.TEAL, { roughness: 0.85 }), [0, -0.005, 0.315]);
  g.position.y = -0.01;
  return g;
}

// ---------------------------------------------------------------------------
// V2/G22: the 9 new §C8.4 item builders (all procedural, existing anchors)
// ---------------------------------------------------------------------------

/**
 * Solid 5-point star (no hole) — wizardHat decals.
 * @param {number} outerR @param {number} innerR @param {number} depth
 */
function starSolidGeometry(outerR, innerR, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
}

/** Straw hat 160 — wide garden brim + shallow dome + red band. */
function buildStrawHat() {
  const g = new THREE.Group();
  const straw = outfitMat(C2.STRAW, { roughness: 0.9 });
  const brim = add(g, new THREE.CylinderGeometry(0.19, 0.2, 0.015, 26), straw, [0, 0.008, 0]);
  brim.scale.set(1, 1, 0.92); // slight oval so the brim clears the ears
  const dome = add(
    g,
    new THREE.SphereGeometry(0.104, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    straw,
    [0, 0.012, 0]
  );
  dome.scale.set(1, 0.8, 1);
  add(g, new THREE.CylinderGeometry(0.106, 0.103, 0.032, 20), outfitMat(C.RED, { roughness: 0.7 }), [0, 0.036, 0]);
  // stitch ring on the brim edge (darker straw)
  const stitch = add(g, new THREE.TorusGeometry(0.192, 0.006, 6, 26), outfitMat(C2.STRAW_DARK, { roughness: 0.9 }), [0, 0.014, 0]);
  stitch.rotation.x = Math.PI / 2;
  stitch.scale.set(1, 0.92, 1);
  g.position.set(0, -0.012, 0.07);
  g.rotation.x = 0.22;
  return g;
}

/** Chef hat 220 — white cylinder base + puffy sphere-cluster top. */
function buildChefHat() {
  const g = new THREE.Group();
  const white = outfitMat(C2.WHITE, { roughness: 0.85 });
  add(g, new THREE.CylinderGeometry(0.095, 0.088, 0.1, 20), white, [0, 0.05, 0]);
  // the puff: a ring of 5 small spheres + a fat center one
  const puffGeo = new THREE.SphereGeometry(0.052, 12, 10);
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    add(g, puffGeo, white, [Math.cos(a) * 0.062, 0.118, Math.sin(a) * 0.062]);
  }
  add(g, new THREE.SphereGeometry(0.075, 14, 12), white, [0, 0.142, 0]);
  add(g, new THREE.CylinderGeometry(0.0965, 0.0965, 0.02, 20), outfitMat(C.CREAM, { roughness: 0.8 }), [0, 0.012, 0]);
  g.position.set(0, -0.015, 0.07);
  g.rotation.x = 0.2;
  return g;
}

/** Flower crown 180 — leafy torus ring + 6 flower blobs (§C8.4). */
function buildFlowerCrown() {
  const g = new THREE.Group();
  const ring = add(g, new THREE.TorusGeometry(0.102, 0.02, 8, 24), outfitMat(C2.LEAF, { roughness: 0.8 }), [0, 0.02, 0]);
  ring.rotation.x = Math.PI / 2;
  const petal = new THREE.SphereGeometry(0.03, 10, 8);
  const heart = new THREE.SphereGeometry(0.016, 8, 6);
  const cols = [C.PINK, C.CREAM, C.YELLOW];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 0.104;
    const z = Math.sin(a) * 0.104;
    const blob = add(g, petal, outfitMat(cols[i % 3], { roughness: 0.75 }), [x, 0.028, z]);
    blob.scale.set(1, 0.8, 1);
    add(g, heart, outfitMat(cols[(i + 1) % 3], { roughness: 0.6 }), [x, 0.054, z]);
  }
  g.position.set(0, -0.01, 0.07);
  g.rotation.x = 0.18;
  return g;
}

/** Wizard hat 350 — bent cone + brim + gold stars (§C8.4). */
function buildWizardHat() {
  const g = new THREE.Group();
  const purple = outfitMat(C2.PURPLE, { roughness: 0.6 });
  add(g, new THREE.CylinderGeometry(0.148, 0.155, 0.016, 24), outfitMat(C2.PURPLE_DARK, { roughness: 0.6 }), [0, 0.008, 0]);
  add(g, new THREE.ConeGeometry(0.098, 0.17, 18), purple, [0, 0.1, 0]);
  // the bent tip: a smaller cone leaning to the side off the main cone's top
  const tip = add(g, new THREE.ConeGeometry(0.041, 0.12, 12), purple, [0.028, 0.212, 0]);
  tip.rotation.z = -0.55;
  const bobble = add(g, new THREE.SphereGeometry(0.02, 8, 8), gold(), [0.062, 0.252, 0]);
  bobble.scale.setScalar(1); // tip bobble
  // 3 gold stars stuck on the cone face
  const starGeo = starSolidGeometry(0.026, 0.012, 0.008);
  const starSpots = [
    [0, 0.1, 0.088, 0],
    [-0.062, 0.05, 0.055, 0.5],
    [0.06, 0.06, 0.05, -0.6],
  ];
  for (const [x, y, z, lean] of starSpots) {
    const star = add(g, starGeo, gold(), [x, y, z]);
    star.rotation.y = Math.atan2(x, z); // face outward
    star.rotation.z = lean;
  }
  g.position.set(0, -0.012, 0.068);
  g.rotation.x = 0.2;
  return g;
}

/** Heart-shaped extrusion outline (rim) or fill for the heartGlasses. */
function heartShape(scale) {
  const s = new THREE.Shape();
  s.moveTo(0, 0.32 * scale);
  s.bezierCurveTo(0.02 * scale, 0.52 * scale, 0.42 * scale, 0.5 * scale, 0.42 * scale, 0.22 * scale);
  s.bezierCurveTo(0.42 * scale, -0.04 * scale, 0.12 * scale, -0.18 * scale, 0, -0.38 * scale);
  s.bezierCurveTo(-0.12 * scale, -0.18 * scale, -0.42 * scale, -0.04 * scale, -0.42 * scale, 0.22 * scale);
  s.bezierCurveTo(-0.42 * scale, 0.5 * scale, -0.02 * scale, 0.52 * scale, 0, 0.32 * scale);
  return s;
}

/** Heart glasses 220 — heart-shaped rims + pink-tinted fills (§C8.4). */
function buildHeartGlasses() {
  const g = new THREE.Group();
  const frame = outfitMat(C.PINK, { roughness: 0.4 });
  const rimShape = heartShape(0.2);
  rimShape.holes.push(heartShape(0.148));
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.014, bevelEnabled: false, curveSegments: 10 });
  const fillGeo = new THREE.ShapeGeometry(heartShape(0.15), 10);
  for (const sx of [-1, 1]) {
    add(g, rimGeo, frame, [sx * 0.112, 0.014, 0.006]);
    add(g, fillGeo, outfitMat(C.LENS_PINK, { roughness: 0.15, opacity: 0.4 }), [sx * 0.112, 0.014, 0.009]);
  }
  addGlassesFrame(g, frame, 0.112);
  return g;
}

/** Monocle 400 — a single gold rim on the right eye + hanging chain (§C8.4). */
function buildMonocle() {
  const g = new THREE.Group();
  const rim = add(g, new THREE.TorusGeometry(0.064, 0.011, 10, 22), gold(), [0.112, 0, 0.012]);
  rim.scale.setScalar(1);
  add(g, new THREE.CircleGeometry(0.06, 18), outfitMat(C.LENS_TINT, { roughness: 0.12, opacity: 0.28 }), [0.112, 0, 0.008]);
  // single temple arm on the monocle side
  const arm = add(g, new THREE.BoxGeometry(0.011, 0.011, 0.17), gold(), [0.205, 0.02, -0.065]);
  arm.rotation.y = -0.38;
  // chain: a short arc of tiny gold links draping down toward the cheek
  const linkGeo = new THREE.SphereGeometry(0.0075, 6, 6);
  const LINKS = 7;
  for (let i = 1; i <= LINKS; i += 1) {
    const p = i / LINKS;
    add(g, linkGeo, gold(), [
      0.112 + p * 0.075 + Math.sin(p * Math.PI) * 0.012,
      -0.064 - p * 0.11 + Math.sin(p * Math.PI) * -0.01,
      0.012 - p * 0.004,
    ]);
  }
  return g;
}

/** Bandana 130 — sky-blue neck band + triangle fold on the chest (§C8.4). */
function buildBandana() {
  const g = new THREE.Group();
  const cloth = outfitMat(C.SKY, { roughness: 0.85 });
  const band = add(g, new THREE.TorusGeometry(0.325, 0.032, 8, 26), cloth, [0, 0.01, -0.05]);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1, 0.75);
  // the folded triangle: a flat extruded prism draping down the belly slope
  const tri = new THREE.Shape();
  tri.moveTo(-0.155, 0);
  tri.lineTo(0.155, 0);
  tri.lineTo(0.02, -0.27);
  tri.closePath();
  const triMesh = add(
    g,
    new THREE.ExtrudeGeometry(tri, { depth: 0.02, bevelEnabled: false }),
    cloth,
    [0, 0.005, 0.315]
  );
  triMesh.rotation.x = -0.34; // follow the belly slope
  // knot + polka dots on the fold
  add(g, new THREE.BoxGeometry(0.07, 0.05, 0.05), outfitMat(C.TEAL_DARK, { roughness: 0.8 }), [0, 0.01, 0.32]);
  const dotGeo = new THREE.CircleGeometry(0.016, 8);
  for (const [dx, dy] of [[-0.06, -0.07], [0.05, -0.09], [-0.01, -0.16]]) {
    const dot = add(g, dotGeo, outfitMat(C.CREAM, { roughness: 0.8 }), [dx, 0.005 + dy * Math.cos(0.34), 0.338 - dy * Math.sin(-0.34)]);
    dot.rotation.x = -0.34;
  }
  g.position.y = -0.01;
  return g;
}

// -- bell-collar / cape animation plumbing (browser-only; onBeforeRender
//    never fires in headless tests, so the audio import stays lazy) --------

/** @type {{play: Function}|null} lazily imported audio module (bell jingles) */
let bellAudio = null;
let bellAudioLoading = false;
function jingleBell() {
  if (bellAudio) {
    // V2/G29 upgrades: the dedicated bell recipe landed — 'hop.bell' maps to
    // the bespoke 'bellJingle' synth (two inharmonic partials, two shakes).
    bellAudio.play('hop.bell');
    return;
  }
  if (!bellAudioLoading) {
    bellAudioLoading = true;
    import('../audio/audio.js')
      .then((m) => {
        bellAudio = m;
      })
      .catch(() => {});
  }
}

/**
 * Watch a mesh's world-Y velocity each rendered frame and call `onHop` when a
 * hop launch is detected (upward velocity spike after rest). Drives the
 * bellCollar jingle and the cape flutter (§C8.4) without touching the anim
 * system — outfits are guests on the rig, so they self-observe.
 * @param {THREE.Mesh} mesh @param {(vy: number) => void} onFrame
 */
function watchVerticalMotion(mesh, onFrame) {
  const pos = new THREE.Vector3();
  let lastY = null;
  let lastT = 0;
  const previous = mesh.onBeforeRender;
  mesh.onBeforeRender = function onVerticalRender(renderer, scene, camera, geometry, material, group) {
    previous.call(this, renderer, scene, camera, geometry, material, group);
    const now = performance.now();
    pos.setFromMatrixPosition(mesh.matrixWorld);
    if (lastY != null && now > lastT) {
      const dt = Math.min((now - lastT) / 1000, 0.1);
      onFrame((pos.y - lastY) / Math.max(dt, 1e-4));
    }
    lastY = pos.y;
    lastT = now;
  };
}

/**
 * Add a render-clock animation without replacing existing outfit callbacks.
 * Explicit arguments avoid a rest-array allocation in the render loop.
 * @param {THREE.Mesh} mesh @param {(timeSec: number) => void} onFrame
 */
function animateOnRender(mesh, onFrame) {
  const previous = mesh.onBeforeRender;
  mesh.onBeforeRender = function onAnimatedRender(renderer, scene, camera, geometry, material, group) {
    previous.call(this, renderer, scene, camera, geometry, material, group);
    onFrame(performance.now() / 1000);
  };
}

/** Bell collar 160 — strap + gold bell that jingles on hops (§C8.4). */
function buildBellCollar() {
  const g = new THREE.Group();
  const strap = add(g, new THREE.TorusGeometry(0.325, 0.026, 8, 26), outfitMat(C.RED_DARK, { roughness: 0.75 }), [0, 0.01, -0.05]);
  strap.rotation.x = Math.PI / 2;
  strap.scale.set(1, 1, 0.8);
  const bell = add(g, new THREE.SphereGeometry(0.055, 14, 12), gold(), [0, -0.04, 0.33]);
  // bell slit + clapper
  const slit = add(g, new THREE.BoxGeometry(0.006, 0.045, 0.02), outfitMat(C.CHARCOAL, { roughness: 0.5 }), [0, -0.066, 0.362]);
  slit.rotation.x = 0.35;
  add(g, new THREE.SphereGeometry(0.014, 8, 6), outfitMat(C.CHARCOAL, { roughness: 0.5 }), [0, -0.092, 0.345]);
  // hop detection: upward world-velocity spike after rest → one jingle
  let prevVy = 0;
  let readyAt = 0;
  watchVerticalMotion(bell, (vy) => {
    const now = performance.now();
    if (vy > 0.45 && prevVy <= 0.12 && now >= readyAt) {
      readyAt = now + 380; // debounce (a hop is ~0.5 s)
      jingleBell();
    }
    prevVy = vy;
  });
  g.position.y = -0.01;
  return g;
}

/** Cape 500 — rigid swoosh that flutters out on hops (§C8.4, cloth-sim-free). */
function buildCape() {
  const g = new THREE.Group();
  // clasp band + gold buttons at the throat. V2/FIX-C P1-1: the band torus
  // must clear the body lathe (radius ≈0.371 at the neck seam) — 0.36+0.026
  // keeps the strap proud of the surface all around, and the buttons sit on
  // the band front instead of inside the chest.
  const band = add(g, new THREE.TorusGeometry(0.36, 0.026, 8, 26), outfitMat(C.RED_DARK, { roughness: 0.8 }), [0, 0.015, -0.05]);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1, 0.8);
  for (const sx of [-1, 1]) {
    add(g, new THREE.SphereGeometry(0.022, 8, 8), gold(), [sx * 0.09, 0.02, 0.315]);
  }
  // the cape sheet: an open cone segment wrapped around the back half,
  // pivoted at the shoulders so flutter can swing the hem outward
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.02, -0.06);
  g.add(pivot);
  const sheetGeo = new THREE.CylinderGeometry(0.34, 0.54, 0.62, 18, 1, true, Math.PI * 0.52, Math.PI * 0.96);
  const sheet = new THREE.Mesh(sheetGeo, outfitMat(C.RED, { roughness: 0.75 }));
  sheet.position.y = -0.31; // top edge at the pivot
  pivot.add(sheet);
  // hem trim
  const hem = new THREE.Mesh(
    new THREE.TorusGeometry(0.54, 0.014, 6, 22, Math.PI * 0.96),
    outfitMat(C.GOLD, { roughness: 0.5, metalness: 0.3 })
  );
  hem.position.y = -0.62;
  hem.rotation.x = Math.PI / 2;
  hem.rotation.z = Math.PI * 0.52 + Math.PI / 2; // align the arc with the sheet
  pivot.add(hem);
  // hop flutter: swing the sheet away from the back on vertical motion
  let flutter = 0;
  watchVerticalMotion(sheet, (vy) => {
    const target = Math.min(Math.max(Math.abs(vy) * 0.4, 0), 0.55);
    flutter += (target - flutter) * 0.18; // eased, rigid swoosh
    pivot.rotation.x = -flutter;
  });
  g.position.y = -0.01;
  return g;
}

// ---------------------------------------------------------------------------
// V3/G40: 22 §C13 outfit builders + the new back-slot behavior
// ---------------------------------------------------------------------------

/** Sombrero — lathed crown, very wide brim and woven band. */
function buildSombrero() {
  const g = new THREE.Group();
  const straw = outfitMat(C2.STRAW, { roughness: 0.92 });
  const profile = [
    new THREE.Vector2(0.06, 0),
    new THREE.Vector2(0.11, 0.025),
    new THREE.Vector2(0.105, 0.12),
    new THREE.Vector2(0.055, 0.17),
    new THREE.Vector2(0, 0.18),
  ];
  add(g, new THREE.LatheGeometry(profile, 24), straw, [0, 0.012, 0]);
  const brim = add(g, new THREE.CylinderGeometry(0.24, 0.255, 0.018, 32), straw, [0, 0.012, 0]);
  brim.scale.z = 0.86;
  add(g, new THREE.CylinderGeometry(0.112, 0.112, 0.034, 24), outfitMat(C.RED), [0, 0.065, 0]);
  const edge = add(g, new THREE.TorusGeometry(0.248, 0.009, 6, 32), outfitMat(C2.STRAW_DARK), [0, 0.022, 0]);
  edge.rotation.x = Math.PI / 2;
  edge.scale.y = 0.86;
  g.position.set(0, -0.018, 0.065);
  g.rotation.x = 0.19;
  return g;
}

/** Pirate tricorn — three curled brim lobes, crown and tiny skull button. */
function buildPirateHat() {
  const g = new THREE.Group();
  const felt = outfitMat(C.CHARCOAL, { roughness: 0.72 });
  const dome = add(g, new THREE.SphereGeometry(0.13, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.58), felt);
  dome.scale.set(1, 0.78, 0.95);
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const lobe = add(
      g,
      new THREE.SphereGeometry(0.115, 12, 8),
      felt,
      [Math.cos(a) * 0.075, 0.035, Math.sin(a) * 0.07]
    );
    lobe.scale.set(1.3, 0.19, 0.72);
    lobe.rotation.y = -a;
  }
  add(g, new THREE.CylinderGeometry(0.132, 0.132, 0.025, 24), outfitMat(C.RED_DARK), [0, 0.052, 0]);
  const skull = add(g, new THREE.SphereGeometry(0.022, 10, 8), outfitMat(C.CREAM), [0, 0.09, 0.13]);
  skull.scale.set(1, 0.86, 0.45);
  for (const rz of [-0.65, 0.65]) {
    const bone = add(g, new THREE.CylinderGeometry(0.005, 0.005, 0.052, 6), outfitMat(C.CREAM), [0, 0.064, 0.13]);
    bone.rotation.z = rz;
  }
  g.position.set(0, -0.025, 0.064);
  g.rotation.x = 0.18;
  return g;
}

/** Detective deerstalker — CanvasTexture tweed checks, two bills + ear flaps. */
function buildDetectiveHat() {
  const g = new THREE.Group();
  const tweed = fabricMat('tweed');
  const dome = add(g, new THREE.SphereGeometry(0.125, 18, 11, 0, Math.PI * 2, 0, Math.PI * 0.56), tweed);
  dome.scale.set(1, 0.82, 0.95);
  for (const z of [-1, 1]) {
    const bill = add(g, new THREE.SphereGeometry(0.095, 14, 8), tweed, [0, 0.01, z * 0.105]);
    bill.scale.set(1, 0.12, 0.72);
  }
  for (const x of [-1, 1]) {
    const flap = add(g, new THREE.BoxGeometry(0.07, 0.1, 0.025), tweed, [x * 0.112, -0.03, 0]);
    flap.rotation.z = -x * 0.22;
  }
  add(g, new THREE.SphereGeometry(0.015, 8, 6), outfitMat(C.BROWN), [0, 0.105, 0]);
  g.position.set(0, -0.018, 0.068);
  g.rotation.x = 0.2;
  return g;
}

/** Beret — flat wool disc, soft crown and jaunty stem. */
function buildBeret() {
  const g = new THREE.Group();
  const wool = outfitMat('#A94F68', { roughness: 0.94 });
  const crown = add(g, new THREE.SphereGeometry(0.14, 18, 10), wool, [0.018, 0.035, 0]);
  crown.scale.set(1.15, 0.27, 1);
  add(g, new THREE.CylinderGeometry(0.1, 0.11, 0.025, 22), outfitMat(C.RED_DARK), [0, 0.002, 0]);
  const stem = add(g, new THREE.CylinderGeometry(0.009, 0.012, 0.055, 8), wool, [0.045, 0.095, 0]);
  stem.rotation.z = -0.34;
  g.position.set(0, -0.015, 0.068);
  g.rotation.x = 0.19;
  g.rotation.z = -0.1;
  return g;
}

/** Viking helmet — steel dome/band plus curved cream horns. */
function buildVikingHelm() {
  const g = new THREE.Group();
  const steel = outfitMat(C.SILVER, { roughness: 0.38, metalness: 0.62 });
  const dome = add(g, new THREE.SphereGeometry(0.13, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), steel);
  dome.scale.set(1, 0.92, 1);
  add(g, new THREE.CylinderGeometry(0.134, 0.134, 0.036, 24), outfitMat('#6F7B84', { metalness: 0.5 }), [0, 0.028, 0]);
  const ridge = add(g, new THREE.BoxGeometry(0.025, 0.15, 0.22), steel, [0, 0.075, 0]);
  ridge.rotation.x = 0.05;
  for (const sx of [-1, 1]) {
    const horn = add(g, new THREE.ConeGeometry(0.035, 0.16, 12), outfitMat(C.CREAM), [sx * 0.17, 0.105, 0]);
    horn.rotation.z = -sx * 1.05;
    horn.rotation.x = -0.12;
    add(g, new THREE.CylinderGeometry(0.042, 0.045, 0.035, 12), gold(), [sx * 0.125, 0.075, 0]).rotation.z = -sx * 0.55;
  }
  g.position.set(0, -0.02, 0.064);
  g.rotation.x = 0.18;
  return g;
}

/** Pumpkin hat — the committed KayKit pumpkin, hollow dark opening + brim. */
function buildPumpkinHat() {
  const g = new THREE.Group();
  // GLTFLoader's root-relative URL is browser-only; headless node tests still
  // exercise the hollow/brim composite without issuing a fake network load.
  if (typeof window !== 'undefined') {
    const pumpkin = getModel(OUTFIT_ASSET_KEYS[0]);
    pumpkin.name = 'pumpkinHat-kaykit';
    pumpkin.scale.setScalar(0.32); // §C13.2 binding
    pumpkin.position.set(0, 0.015, 0);
    pumpkin.rotation.y = Math.PI;
    g.add(pumpkin);
  }
  const opening = add(g, new THREE.CylinderGeometry(0.102, 0.116, 0.025, 22), outfitMat('#3B241C'), [0, 0.002, 0]);
  opening.scale.z = 0.92;
  const brim = add(g, new THREE.TorusGeometry(0.118, 0.018, 8, 24), outfitMat(C.ORANGE_DARK), [0, 0.012, 0]);
  brim.rotation.x = Math.PI / 2;
  add(g, new THREE.CylinderGeometry(0.012, 0.018, 0.07, 8), outfitMat(C.GREEN_DARK), [0.03, 0.17, 0]);
  g.position.set(0, -0.02, 0.064);
  g.rotation.x = 0.18;
  return g;
}

/** Space helmet — transparent glass dome with a chunky silver collar. */
function buildSpaceHelm() {
  const g = new THREE.Group();
  const glass = outfitMat('#BEEBFF', { roughness: 0.08, metalness: 0.05, opacity: 0.28 });
  const dome = add(g, new THREE.SphereGeometry(0.205, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.72), glass, [0, 0.02, 0]);
  dome.scale.set(1, 1.12, 1);
  const collar = add(g, new THREE.TorusGeometry(0.177, 0.027, 10, 28), outfitMat(C.SILVER, { metalness: 0.5 }), [0, -0.012, 0]);
  collar.rotation.x = Math.PI / 2;
  const rim = add(g, new THREE.TorusGeometry(0.195, 0.012, 8, 28), outfitMat(C.NAVY, { metalness: 0.25 }), [0, 0.025, 0.01]);
  rim.rotation.x = Math.PI / 2;
  add(g, new THREE.BoxGeometry(0.055, 0.03, 0.025), outfitMat(C.RED), [0, -0.022, 0.17]);
  g.position.set(0, -0.055, 0.055);
  g.rotation.x = 0.16;
  return g;
}

/** Chef toque — tall pleated cylinder with a six-lobed crown. */
function buildChefToque() {
  const g = new THREE.Group();
  const white = outfitMat(C2.WHITE, { roughness: 0.92 });
  add(g, new THREE.CylinderGeometry(0.112, 0.104, 0.15, 24), white, [0, 0.075, 0]);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const pleat = add(g, new THREE.CapsuleGeometry(0.032, 0.12, 2, 8), white, [Math.cos(a) * 0.07, 0.12, Math.sin(a) * 0.07]);
    pleat.scale.y = 1.2;
  }
  const crown = add(g, new THREE.SphereGeometry(0.115, 18, 12), white, [0, 0.21, 0]);
  crown.scale.set(1.12, 0.55, 1.12);
  add(g, new THREE.CylinderGeometry(0.116, 0.116, 0.025, 24), outfitMat(C.CREAM), [0, 0.015, 0]);
  g.position.set(0, -0.018, 0.068);
  g.rotation.x = 0.19;
  return g;
}

/** Aviator goggles — brass twin lenses, leather bridge/strap. */
function buildAviatorGoggles() {
  const g = new THREE.Group();
  const brass = outfitMat('#B88645', { roughness: 0.35, metalness: 0.45 });
  const leather = outfitMat(C.BROWN, { roughness: 0.88 });
  for (const sx of [-1, 1]) {
    const rim = add(g, new THREE.TorusGeometry(0.067, 0.014, 10, 22), brass, [sx * 0.11, 0, 0.012]);
    rim.scale.set(1.12, 0.85, 1);
    add(g, new THREE.CircleGeometry(0.058, 18), outfitMat(C.LENS_TINT, { opacity: 0.38, roughness: 0.12 }), [sx * 0.11, 0, 0.008]).scale.y = 0.84;
  }
  add(g, new THREE.BoxGeometry(0.08, 0.018, 0.018), leather, [0, 0.008, 0.002]);
  const strap = add(g, new THREE.TorusGeometry(0.205, 0.013, 7, 28, Math.PI), leather, [0, 0.01, -0.04]);
  strap.rotation.y = Math.PI / 2;
  strap.rotation.z = Math.PI / 2;
  return g;
}

/** Reading glasses — small half-moon lenses with slim temples. */
function buildReadingGlasses() {
  const g = new THREE.Group();
  const frame = outfitMat('#87543A', { roughness: 0.55 });
  for (const sx of [-1, 1]) {
    const rim = add(g, new THREE.TorusGeometry(0.056, 0.009, 8, 18, Math.PI), frame, [sx * 0.105, -0.018, 0.01]);
    rim.rotation.z = Math.PI;
    const fill = add(g, new THREE.CircleGeometry(0.052, 18, Math.PI, Math.PI), outfitMat(C.LENS_TINT, { opacity: 0.28, roughness: 0.1 }), [sx * 0.105, -0.018, 0.006]);
    fill.rotation.z = Math.PI;
  }
  addGlassesFrame(g, frame, 0.105);
  g.position.y = -0.025;
  return g;
}

/** Eyepatch — matte patch with an elastic head strap. */
function buildEyepatch() {
  const g = new THREE.Group();
  const patch = add(g, new THREE.SphereGeometry(0.069, 14, 9), outfitMat(C.BLACK), [0.108, 0, 0.015]);
  patch.scale.set(1, 0.78, 0.2);
  const strap = add(g, new THREE.TorusGeometry(0.205, 0.009, 6, 30), outfitMat(C.BROWN), [0, 0.005, -0.025]);
  strap.rotation.y = Math.PI / 2;
  strap.rotation.z = Math.PI / 2;
  const knot = add(g, new THREE.SphereGeometry(0.014, 8, 6), outfitMat(C.BROWN), [0.17, -0.045, 0]);
  knot.scale.z = 0.5;
  return g;
}

/** Red/cyan paper 3D glasses. */
function buildStars3D() {
  const g = new THREE.Group();
  const paper = outfitMat(C.CREAM, { roughness: 0.9 });
  for (const sx of [-1, 1]) {
    add(g, new THREE.BoxGeometry(0.132, 0.09, 0.014), paper, [sx * 0.105, 0, 0.004]);
    add(g, new THREE.PlaneGeometry(0.105, 0.067), outfitMat(sx < 0 ? C.RED : C.CYAN, { opacity: 0.52, roughness: 0.12 }), [sx * 0.105, 0, 0.013]);
  }
  add(g, new THREE.BoxGeometry(0.08, 0.017, 0.016), paper, [0, 0.006, 0]);
  for (const sx of [-1, 1]) {
    const arm = add(g, new THREE.BoxGeometry(0.012, 0.018, 0.17), paper, [sx * 0.205, 0.01, -0.065]);
    arm.rotation.y = -sx * 0.36;
  }
  return g;
}

/** Pearl necklace — one instanced bead ring and a front clasp pearl. */
function buildPearlNecklace() {
  const g = new THREE.Group();
  const pearl = outfitMat('#FFF5E8', { roughness: 0.2, metalness: 0.12 });
  const beadGeo = new THREE.SphereGeometry(0.029, 10, 8);
  const beads = new THREE.InstancedMesh(beadGeo, pearl, 18);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2;
    matrix.makeTranslation(Math.cos(a) * 0.39, -0.012 - Math.max(0, Math.sin(a)) * 0.035, Math.sin(a) * 0.34 - 0.035);
    beads.setMatrixAt(i, matrix);
  }
  beads.instanceMatrix.needsUpdate = true;
  g.add(beads);
  add(g, new THREE.SphereGeometry(0.045, 12, 10), pearl, [0, -0.075, 0.34]);
  add(g, new THREE.SphereGeometry(0.018, 8, 6), gold(), [0, -0.12, 0.35]);
  return g;
}

/** Flower lei — pastel blossoms around a leafy neck ring. */
function buildFlowerLei() {
  const g = new THREE.Group();
  const leafRing = add(g, new THREE.TorusGeometry(0.38, 0.018, 7, 28), outfitMat(C.GREEN), [0, 0, -0.04]);
  leafRing.rotation.x = Math.PI / 2;
  leafRing.scale.set(1, 1, 0.84);
  const colors = [C.PINK, C.YELLOW, C.LILAC, C.CREAM];
  const petalGeo = new THREE.SphereGeometry(0.036, 9, 7);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.cos(a) * 0.39;
    const z = Math.sin(a) * 0.33 - 0.04;
    const petal = add(g, petalGeo, outfitMat(colors[i % colors.length], { roughness: 0.78 }), [x, -0.01, z]);
    petal.scale.set(1.25, 0.65, 0.72);
    add(g, new THREE.SphereGeometry(0.012, 7, 5), outfitMat(C.GOLD), [x, -0.012, z + 0.025]);
  }
  return g;
}

/** Gold medal — V ribbon and a food-kit-style chunky coin disc. */
function buildMedalGold() {
  const g = new THREE.Group();
  const ribbonMat = outfitMat(C.BLUE, { roughness: 0.8 });
  for (const sx of [-1, 1]) {
    const ribbon = add(g, new THREE.BoxGeometry(0.075, 0.32, 0.025), ribbonMat, [sx * 0.075, -0.12, 0.3]);
    ribbon.rotation.z = -sx * 0.28;
    ribbon.rotation.x = -0.12;
  }
  const coin = add(g, new THREE.CylinderGeometry(0.09, 0.09, 0.028, 24), gold(), [0, -0.31, 0.325]);
  coin.rotation.x = Math.PI / 2;
  const star = add(g, starSolidGeometry(0.052, 0.024, 0.01), outfitMat(C.YELLOW), [0, -0.31, 0.344]);
  star.rotation.z = Math.PI / 2;
  add(g, new THREE.TorusGeometry(0.093, 0.009, 6, 24), outfitMat('#B78417', { metalness: 0.4 }), [0, -0.31, 0.345]);
  return g;
}

/** Winter scarf — chunky knit CanvasTexture ring, knot and long tail. */
function buildWinterScarf() {
  const g = new THREE.Group();
  const knit = fabricMat('knit');
  const ring = add(g, new THREE.TorusGeometry(0.35, 0.074, 12, 30), knit, [0, 0, -0.05]);
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(1, 1, 0.82);
  add(g, new THREE.SphereGeometry(0.075, 12, 9), knit, [0.06, -0.045, 0.325]).scale.set(1, 0.7, 0.7);
  const tail = add(g, new THREE.BoxGeometry(0.13, 0.34, 0.05), knit, [0.085, -0.235, 0.34]);
  tail.rotation.z = -0.1;
  tail.rotation.x = -0.18;
  for (const x of [0.035, 0.08, 0.125]) {
    add(g, new THREE.BoxGeometry(0.018, 0.045, 0.035), knit, [x, -0.425, 0.34]);
  }
  return g;
}

/** Tiny backpack — rounded box body, flap, pocket and shoulder straps. */
function buildBackpackTiny() {
  const g = new THREE.Group();
  const cloth = outfitMat(C.TEAL, { roughness: 0.82 });
  const pack = add(g, new THREE.BoxGeometry(0.34, 0.34, 0.17, 3, 3, 2), cloth, [0, 0, -0.25]);
  pack.rotation.x = -0.08;
  add(g, new THREE.BoxGeometry(0.32, 0.11, 0.19), outfitMat(C.TEAL_DARK), [0, 0.14, -0.255]).rotation.x = -0.12;
  add(g, new THREE.BoxGeometry(0.2, 0.13, 0.07), outfitMat(C.SKY), [0, -0.08, -0.355]);
  add(g, new THREE.SphereGeometry(0.02, 8, 6), gold(), [0, 0.105, -0.36]);
  for (const sx of [-1, 1]) {
    const strap = add(g, new THREE.TorusGeometry(0.22, 0.025, 7, 20, Math.PI), outfitMat(C.BROWN), [sx * 0.13, 0.01, -0.04]);
    strap.rotation.set(0, Math.PI / 2, Math.PI / 2);
  }
  g.userData.specialBehavior = 'hopFlutter';
  return g;
}

/** Red balloon — string and balloon pivot sway gently with the render clock. */
function buildBalloonRed() {
  const g = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.set(0.12, 0.04, -0.2);
  g.add(pivot);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.035, 0.32, -0.01),
    new THREE.Vector3(-0.025, 0.63, 0.015),
  ]);
  add(pivot, new THREE.TubeGeometry(curve, 18, 0.006, 5, false), outfitMat('#DED3C2'));
  const balloon = add(pivot, new THREE.SphereGeometry(0.16, 18, 13), outfitMat(C.RED, { roughness: 0.38 }), [-0.025, 0.78, 0.015]);
  balloon.scale.set(0.86, 1.14, 0.82);
  const knot = add(pivot, new THREE.ConeGeometry(0.025, 0.055, 8), outfitMat(C.RED_DARK), [-0.025, 0.6, 0.015]);
  knot.rotation.x = Math.PI;
  animateOnRender(balloon, (time) => {
    pivot.rotation.z = Math.sin(time * 1.35) * 0.09;
    pivot.rotation.x = Math.cos(time * 1.08) * 0.045;
  });
  g.userData.specialBehavior = 'balloonSway';
  g.userData.animationTarget = pivot;
  return g;
}

/** Propeller pack — twin tanks and a permanently spinning rear propeller. */
function buildPropellerPack() {
  const g = new THREE.Group();
  const packMat = outfitMat(C.NAVY, { roughness: 0.52, metalness: 0.25 });
  add(g, new THREE.BoxGeometry(0.28, 0.32, 0.14), packMat, [0, 0, -0.24]);
  for (const sx of [-1, 1]) {
    add(g, new THREE.CylinderGeometry(0.055, 0.065, 0.3, 14), outfitMat(C.SILVER, { metalness: 0.48 }), [sx * 0.12, -0.02, -0.27]);
    add(g, new THREE.ConeGeometry(0.058, 0.1, 12), outfitMat(C.ORANGE), [sx * 0.12, -0.21, -0.27]).rotation.x = Math.PI;
  }
  const prop = new THREE.Group();
  prop.position.set(0, 0.08, -0.34);
  g.add(prop);
  add(prop, new THREE.CylinderGeometry(0.035, 0.035, 0.055, 10), gold()).rotation.x = Math.PI / 2;
  for (const rz of [0, Math.PI / 2]) {
    const blade = add(prop, new THREE.BoxGeometry(0.34, 0.045, 0.018), outfitMat(C.YELLOW), [0, 0, -0.035]);
    blade.rotation.z = rz;
  }
  const driver = prop.children.find((o) => o.isMesh);
  animateOnRender(driver, (time) => {
    prop.rotation.z = time * 8.5;
  });
  g.userData.specialBehavior = 'propellerSpin';
  g.userData.animationTarget = prop;
  return g;
}

/** Turtle shell — layered dome, checker shading and raised rim plates. */
function buildTurtleShell() {
  const g = new THREE.Group();
  const shell = add(g, new THREE.SphereGeometry(0.28, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.66), outfitMat(C.GREEN_DARK, { roughness: 0.8 }), [0, 0, -0.21]);
  shell.rotation.x = -Math.PI / 2;
  shell.scale.set(1.05, 1, 0.52);
  const center = add(g, new THREE.CylinderGeometry(0.15, 0.18, 0.045, 6), outfitMat(C.GREEN), [0, 0, -0.49]);
  center.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const plate = add(g, new THREE.CylinderGeometry(0.07, 0.09, 0.035, 6), outfitMat(i % 2 ? '#74A957' : '#91BE65'), [Math.cos(a) * 0.17, Math.sin(a) * 0.17, -0.475]);
    plate.rotation.x = Math.PI / 2;
    plate.rotation.z = a;
  }
  add(g, new THREE.TorusGeometry(0.265, 0.025, 8, 28), outfitMat('#B4C36C'), [0, 0, -0.46]);
  g.userData.specialBehavior = 'hopFlutter';
  return g;
}

/** One translucent fairy-wing shape. */
function fairyWingGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.05, 0.22, 0.28, 0.32, 0.31, 0.1);
  shape.bezierCurveTo(0.34, -0.06, 0.12, -0.12, 0, 0);
  return new THREE.ShapeGeometry(shape, 12);
}

/** Fairy wings — four translucent planes that flutter harder on hops. */
function buildFairyWings() {
  const g = new THREE.Group();
  const wingMat = outfitMat('#D6C5FF', { roughness: 0.18, opacity: 0.58 });
  const veinMat = outfitMat('#8A69C7', { roughness: 0.5, opacity: 0.75 });
  const pivots = [];
  let watchMesh = null;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.035, sy > 0 ? 0.1 : -0.02, -0.24);
      pivot.scale.x = sx;
      g.add(pivot);
      const wing = add(pivot, fairyWingGeometry(), wingMat);
      wing.rotation.y = sx * 0.18;
      wing.rotation.z = sy > 0 ? 0.42 : -0.28;
      wing.scale.set(sy > 0 ? 1 : 0.72, sy > 0 ? 1 : 0.78, 1);
      const vein = add(pivot, new THREE.CylinderGeometry(0.008, 0.012, sy > 0 ? 0.31 : 0.24, 6), veinMat, [0.075, sy > 0 ? 0.11 : 0.06, 0.006]);
      vein.rotation.z = sy > 0 ? -0.5 : -0.8;
      pivots.push({ pivot, sx, sy });
      watchMesh ??= wing;
    }
  }
  let hopBoost = 0;
  let lastTime = 0;
  watchVerticalMotion(watchMesh, (vy) => {
    hopBoost = Math.max(hopBoost, Math.min(Math.abs(vy) * 0.34, 0.72));
  });
  animateOnRender(watchMesh, (time) => {
    const dt = lastTime ? Math.min(time - lastTime, 0.1) : 0;
    lastTime = time;
    hopBoost = Math.max(0, hopBoost - dt * 1.8);
    const flutter = Math.sin(time * (8 + hopBoost * 12)) * (0.09 + hopBoost * 0.32);
    for (const p of pivots) p.pivot.rotation.y = p.sx * (0.12 + flutter * p.sy);
  });
  g.userData.specialBehavior = 'fairyHopFlutter';
  g.userData.animationTarget = pivots[0].pivot;
  return g;
}

/** Surf board — long capsule board carried diagonally with stripe + fin. */
function buildSurfBoard() {
  const g = new THREE.Group();
  const board = add(g, new THREE.CapsuleGeometry(0.11, 0.62, 5, 16), outfitMat(C.SKY, { roughness: 0.48 }), [0, -0.02, -0.26]);
  board.scale.z = 0.24;
  board.rotation.z = -0.48;
  const stripe = add(g, new THREE.BoxGeometry(0.055, 0.62, 0.018), outfitMat(C.CREAM), [0, -0.02, -0.292]);
  stripe.rotation.z = -0.48;
  const stripe2 = add(g, new THREE.BoxGeometry(0.028, 0.62, 0.02), outfitMat(C.RED), [0.045, 0, -0.295]);
  stripe2.rotation.z = -0.48;
  const fin = add(g, new THREE.ConeGeometry(0.06, 0.13, 3), outfitMat(C.TEAL_DARK), [0.17, -0.28, -0.31]);
  fin.rotation.set(Math.PI / 2, 0, 0.48);
  g.rotation.y = -0.18; // §C13 angled carry, not flat against the spine
  g.userData.specialBehavior = 'angledCarry';
  return g;
}

/** @type {Record<string, () => THREE.Group>} id → builder (42 catalog items). */
const BUILDERS = Object.freeze({
  partyHat: buildPartyHat,
  beanie: buildBeanie,
  cap: buildCap,
  topHat: buildTopHat,
  crown: buildCrown,
  roundGlasses: buildRoundGlasses,
  sunglasses: buildSunglasses,
  starGlasses: buildStarGlasses,
  scarfRed: buildScarfRed,
  bowtie: buildBowtie,
  scarfStriped: buildScarfStriped,
  // V2/G22 (§C8.4)
  strawHat: buildStrawHat,
  chefHat: buildChefHat,
  flowerCrown: buildFlowerCrown,
  wizardHat: buildWizardHat,
  heartGlasses: buildHeartGlasses,
  monocle: buildMonocle,
  bandana: buildBandana,
  bellCollar: buildBellCollar,
  cape: buildCape,
  // V3/G40 (§C13.2)
  sombrero: buildSombrero,
  pirateHat: buildPirateHat,
  detectiveHat: buildDetectiveHat,
  beret: buildBeret,
  vikingHelm: buildVikingHelm,
  pumpkinHat: buildPumpkinHat,
  spaceHelm: buildSpaceHelm,
  chefToque: buildChefToque,
  aviatorGoggles: buildAviatorGoggles,
  readingGlasses: buildReadingGlasses,
  eyepatch: buildEyepatch,
  stars3D: buildStars3D,
  pearlNecklace: buildPearlNecklace,
  flowerLei: buildFlowerLei,
  medalGold: buildMedalGold,
  winterScarf: buildWinterScarf,
  backpackTiny: buildBackpackTiny,
  balloonRed: buildBalloonRed,
  propellerPack: buildPropellerPack,
  turtleShell: buildTurtleShell,
  fairyWings: buildFairyWings,
  surfBoard: buildSurfBoard,
});

/**
 * Build one outfit item mesh group (anchor space).
 * @param {string} id catalog id (data/outfits.js)
 * @returns {THREE.Group|null} named `outfit-<slot>`, or null for unknown ids
 */
export function buildOutfitItem(id) {
  const def = OUTFITS_BY_ID[id];
  const builder = BUILDERS[id];
  if (!def || !builder) {
    console.warn(`[outfitAttach] unknown outfit '${id}'`);
    return null;
  }
  const group = builder();
  group.name = `outfit-${def.slot}`;
  group.userData.outfitId = id;
  return group;
}

// ---------------------------------------------------------------------------
// Attach / detach
// ---------------------------------------------------------------------------

/**
 * Create the §C13 back anchor inside outfitAttach (gooby.js stays read-only).
 * It shares the neck anchor's body-root parent so squash/hop transforms carry
 * it, and mirrors V2/FIX-C's neck X/Z scaling as weight tiers tween.
 * @param {object} gooby @param {Record<string, THREE.Object3D>} anchors
 * @param {THREE.Object3D|null} root
 */
function ensureBackAnchor(gooby, anchors, root) {
  let back = anchors.back ?? root?.getObjectByName?.('anchor-back') ?? null;
  if (!back) {
    const parent = anchors.neck?.parent ?? root?.getObjectByName?.('body')?.parent;
    if (!parent) return;
    back = new THREE.Object3D();
    back.name = 'anchor-back';
    parent.add(back);
  }
  anchors.back = back;
  if (gooby?.anchors && !gooby.anchors.back) gooby.anchors.back = back;
  const weightSource = anchors.neck ?? null;
  back.userData.syncOutfitWeight = () => {
    const tierScale = Number.isFinite(weightSource?.scale?.x) ? weightSource.scale.x : 1;
    back.position.set(0, 0.34, -0.18 * tierScale);
    back.scale.set(tierScale, 1, tierScale);
  };
  back.userData.syncOutfitWeight();
}

/**
 * Add hop flutter + continuous weight-tier refit to one attached back item.
 * @param {THREE.Object3D} anchor @param {THREE.Group} item
 */
function wireBackMotion(anchor, item) {
  let probe = null;
  item.traverse((obj) => {
    if (!probe && obj.isMesh) probe = obj;
  });
  if (!probe) return;
  let flutter = 0;
  watchVerticalMotion(probe, (vy) => {
    const target = Math.min(Math.max(Math.abs(vy) * 0.28, 0), 0.42);
    flutter += (target - flutter) * 0.32;
  });
  animateOnRender(probe, () => {
    anchor.userData.syncOutfitWeight?.();
    flutter *= 0.9;
    anchor.rotation.x = -flutter;
  });
  item.userData.backMotionProbe = probe.name || probe.geometry?.type || 'mesh';
}

/**
 * Resolve the hat/glasses/neck/back anchors from a createGooby() API object
 * or a bare rig group (named 'anchor-*' nodes — §D2.3/§C13).
 * @param {{anchors?: object, group?: THREE.Group}|THREE.Object3D|null} gooby
 * @returns {Record<string, THREE.Object3D>|null}
 */
function resolveAnchors(gooby) {
  if (!gooby) return null;
  const root = gooby.isObject3D ? gooby : gooby.group;
  /** @type {Record<string, THREE.Object3D>} */
  const found = gooby.anchors?.hat ? gooby.anchors : {};
  if (root?.traverse) {
    root.traverse((obj) => {
      for (const slot of OUTFIT_EQUIP_SLOTS) {
        if (obj.name === `anchor-${slot}`) found[slot] = obj;
      }
    });
  }
  if (!found.hat && !found.glasses && !found.neck) return null;
  ensureBackAnchor(gooby, found, root ?? null);
  return found;
}

/**
 * Dress a Gooby rig per the equipped map (§C5.3: one item per slot).
 * Idempotent — each slot's previous outfit is removed (geometries disposed;
 * outfit materials are shared/permanent) before the new one attaches, so
 * calling with the same map twice leaves exactly one item per slot.
 *
 * @param {{anchors?: object, group?: THREE.Group}|THREE.Object3D|null} gooby
 *   createGooby() rig or any Object3D containing the named anchors
 * @param {{hat?: string|null, glasses?: string|null, neck?: string|null, back?: string|null}} [equipped]
 * @returns {boolean} false when no anchors could be resolved
 */
export function applyOutfits(gooby, equipped = {}) {
  const anchors = resolveAnchors(gooby);
  if (!anchors) return false;
  for (const slot of OUTFIT_EQUIP_SLOTS) {
    const anchor = anchors[slot];
    if (!anchor) continue;
    if (slot === 'back') anchor.rotation.x = 0;
    for (const child of [...anchor.children]) {
      if (!child.name?.startsWith('outfit-')) continue;
      child.traverse((obj) => {
        if (obj.geometry && !isCachedResource(obj.geometry)) obj.geometry.dispose?.();
      });
      anchor.remove(child);
    }
    const id = equipped?.[slot];
    if (id) {
      const item = buildOutfitItem(id);
      if (item) {
        anchor.add(item);
        if (slot === 'back') wireBackMotion(anchor, item);
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Live wiring (single marked G12 block in main.js calls initOutfitSync)
// ---------------------------------------------------------------------------

/** @type {object|null} the store handle after initOutfitSync (for the helper below) */
let liveStore = null;

/**
 * Dress a rig with the CURRENTLY equipped save outfits — the one-liner for
 * scenes/games that build their own Gooby (minigame cameos, drive sitDrive):
 * `applyEquippedOutfits(this.gooby)` right after createGooby(). No-op before
 * initOutfitSync ran (e.g. headless tests).
 * @param {{anchors?: object, group?: THREE.Group}|THREE.Object3D|null} gooby
 * @returns {boolean}
 */
export function applyEquippedOutfits(gooby) {
  if (!liveStore) return false;
  return applyOutfits(gooby, liveStore.get('outfits.equipped') ?? {});
}

let syncWired = false;

/**
 * Keep the home-scene Gooby dressed (§C5.3): re-applies on every
 * 'outfitChanged' store event and whenever the home scene rebuilds its rig
 * (polled module accessor — same guarded pattern as the G6/G7 room hooks;
 * home/homeScene.js is only imported lazily in the browser).
 * @param {{store: object}} deps
 */
export function initOutfitSync({ store }) {
  liveStore = store;
  if (syncWired) return;
  syncWired = true;

  // Dev harness extension (§E9 spirit, dev only): ?outfits=crown,starGlasses,…
  // owns + equips the listed catalog ids at boot (G12 screenshot surface).
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  if (isDev && typeof location !== 'undefined') {
    const raw = new URLSearchParams(location.search).get('outfits');
    if (raw != null) {
      const ids = raw.split(',').map((s) => s.trim()).filter((id) => OUTFITS_BY_ID[id]);
      store.update((state) => {
        state.outfits.equipped = { hat: null, glasses: null, neck: null, back: null };
        for (const id of ids) {
          if (!state.outfits.owned.includes(id)) state.outfits.owned.push(id);
          state.outfits.equipped[OUTFITS_BY_ID[id].slot] = id;
        }
      });
    }
  }

  /** @type {object|null} */
  let lastGooby = null;
  const apply = () => {
    if (lastGooby) applyOutfits(lastGooby, store.get('outfits.equipped') ?? {});
  };
  store.on('outfitChanged', apply);
  preloadOutfitAssets().then(apply).catch((err) => {
    console.warn('[outfitAttach] pumpkin preload unavailable:', err);
  });

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
