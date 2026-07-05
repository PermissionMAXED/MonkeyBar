// Shared materials & texture helpers — PLAN.md §2/§7 (client/src/three/materials.js).
// Everything here is 100% procedural: CanvasTexture generators + material factories.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

/** Create a canvas + 2d context. */
export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

/** Wrap a canvas in a color-space-correct CanvasTexture. */
export function canvasTexture(canvas, { repeat = null } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

// ---------------------------------------------------------------------------
// Shared-cache tagging + transient-prop disposal
// ---------------------------------------------------------------------------

/**
 * Tag a module-level cached resource (geometry / material / texture) as
 * SHARED so disposeTransientObject() never frees it. Every props module tags
 * its caches explicitly (faceCache, chipGeo, dieGeoCache, pipFaceCache,
 * shellTexCache, card geometry/back texture, …).
 * @template {{userData: Object}} T
 * @param {T} resource
 * @returns {T}
 */
export function markShared(resource) {
  resource.userData.sharedCache = true;
  return resource;
}

/**
 * Dispose a transient prop subtree's PER-INSTANCE geometries, materials and
 * canvas textures, then detach it from the scene graph. Anything tagged via
 * markShared() (module-level caches reused across instances) is skipped.
 * @param {import('three').Object3D} root
 */
export function disposeTransientObject(root) {
  root.traverse((o) => {
    if (o.geometry && !o.geometry.userData.sharedCache) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.userData.sharedCache) continue;
      for (const key of ['map', 'emissiveMap']) {
        const tex = m[key];
        if (tex && !tex.userData.sharedCache) tex.dispose();
      }
      m.dispose();
    }
  });
  root.removeFromParent();
}

/** Tiny deterministic RNG so textures look the same every load. */
function texRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  if (amt >= 0) c.lerp(new THREE.Color('#ffffff'), amt);
  else c.lerp(new THREE.Color('#000000'), -amt);
  return `#${c.getHexString()}`;
}

// ---------------------------------------------------------------------------
// Wood grain
// ---------------------------------------------------------------------------

const woodCache = new Map();

/**
 * Procedural wood-grain CanvasTexture (planks + streaks + knots).
 * @param {string} base   base wood color hex
 * @param {number} [seed]
 */
export function makeWoodTexture(base = '#5a3a22', seed = 7) {
  const key = `${base}|${seed}`;
  if (woodCache.has(key)) return woodCache.get(key);

  const { canvas, ctx } = makeCanvas(512, 512);
  const rnd = texRng(seed);

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);

  // long horizontal grain streaks
  for (let i = 0; i < 160; i++) {
    const y = rnd() * 512;
    const len = 80 + rnd() * 420;
    const x = rnd() * 512 - 60;
    const light = rnd() > 0.5;
    ctx.strokeStyle = shade(base, light ? 0.06 + rnd() * 0.1 : -(0.08 + rnd() * 0.16));
    ctx.globalAlpha = 0.25 + rnd() * 0.4;
    ctx.lineWidth = 0.6 + rnd() * 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + len * 0.3, y + (rnd() - 0.5) * 8, x + len * 0.7, y + (rnd() - 0.5) * 8, x + len, y + (rnd() - 0.5) * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // knots
  for (let i = 0; i < 7; i++) {
    const kx = rnd() * 512;
    const ky = rnd() * 512;
    for (let r = 14; r > 2; r -= 2.5) {
      ctx.strokeStyle = shade(base, -0.2 - rnd() * 0.2);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(kx, ky, r * (1.4 + rnd() * 0.3), r, rnd() * 0.6, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // plank seams
  for (let i = 1; i < 6; i++) {
    const y = i * 85 + (rnd() - 0.5) * 10;
    ctx.strokeStyle = shade(base, -0.45);
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = canvasTexture(canvas, { repeat: [1, 1] });
  woodCache.set(key, tex);
  return tex;
}

/** Standard wood material with procedural grain. */
export function woodMaterial(base = '#5a3a22', { roughness = 0.75, seed = 7, repeat = [1, 1] } = {}) {
  const map = makeWoodTexture(base, seed).clone();
  map.needsUpdate = true;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeat[0], repeat[1]);
  return new THREE.MeshStandardMaterial({ map, roughness, metalness: 0.05 });
}

// ---------------------------------------------------------------------------
// Neon / glass / metal
// ---------------------------------------------------------------------------

/**
 * Emissive neon-tube material — bright enough to feed UnrealBloomPass.
 * @param {string} color
 * @param {number} [intensity]
 */
export function neonMaterial(color, intensity = 2.6) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.25),
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: 0.4,
    metalness: 0.0,
  });
}

/** Glass-ish physical material for bottles / monocles / visors. */
export function glassMaterial(tint = '#9fd8c8', { opacity = 0.45, roughness = 0.08 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint),
    roughness,
    metalness: 0.0,
    transparent: true,
    opacity,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
    side: THREE.DoubleSide,
  });
}

/** Polished brass for the Coconut Cannon. */
export function brassMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#b8862e',
    roughness: 0.28,
    metalness: 0.95,
    emissive: '#3a2508',
    emissiveIntensity: 0.25,
  });
}

/** Simple matte standard material shortcut. */
export function matte(color, { roughness = 0.85, metalness = 0.02, emissive = null, emissiveIntensity = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  if (emissive) {
    m.emissive = new THREE.Color(emissive);
    m.emissiveIntensity = emissiveIntensity;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Fruit faces (card fronts)
// ---------------------------------------------------------------------------

const fruitFaceCache = new Map();

function drawBanana(ctx, cx, cy, s, golden) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.5);
  ctx.fillStyle = golden ? '#ffd23d' : '#f5d442';
  ctx.strokeStyle = golden ? '#b8860b' : '#a8862a';
  ctx.lineWidth = s * 0.05;
  ctx.beginPath();
  ctx.arc(0, -s * 0.25, s * 0.62, 0.35, Math.PI - 0.35, false);
  ctx.arc(0, -s * 0.53, s * 0.85, Math.PI - 0.5, 0.5, true);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // tips
  ctx.fillStyle = '#6b4a1e';
  ctx.beginPath();
  ctx.arc(-s * 0.56, 0.02 * s, s * 0.07, 0, Math.PI * 2);
  ctx.arc(s * 0.56, 0.02 * s, s * 0.07, 0, Math.PI * 2);
  ctx.fill();
  if (golden) {
    ctx.fillStyle = '#fff8d0';
    for (const [sx, sy] of [[-0.35, -0.5], [0.3, -0.62], [0.05, -0.2]]) {
      const px = sx * s;
      const py = sy * s;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 === 0 ? s * 0.09 : s * 0.035;
        ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawCoconut(ctx, cx, cy, s) {
  ctx.fillStyle = '#5a3d24';
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3d2814';
  ctx.lineWidth = s * 0.04;
  // hairy fibres
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42);
    ctx.lineTo(cx + Math.cos(a + 0.18) * s * 0.58, cy + Math.sin(a + 0.18) * s * 0.58);
    ctx.stroke();
  }
  // three "eyes"
  ctx.fillStyle = '#2a1a0c';
  for (const [dx, dy] of [[-0.14, -0.1], [0.14, -0.1], [0, 0.14]]) {
    ctx.beginPath();
    ctx.arc(cx + dx * s, cy + dy * s, s * 0.075, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMango(ctx, cx, cy, s) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0.35);
  const g = ctx.createLinearGradient(-s * 0.5, -s * 0.5, s * 0.5, s * 0.5);
  g.addColorStop(0, '#ffb03d');
  g.addColorStop(1, '#f0653d');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.55, s * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c2542e';
  ctx.lineWidth = s * 0.04;
  ctx.stroke();
  // leaf
  ctx.fillStyle = '#4a8a3d';
  ctx.beginPath();
  ctx.ellipse(-s * 0.42, -s * 0.36, s * 0.18, s * 0.08, -0.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Vector fruit/suit glyph painter — the same hand-drawn fruits the ML card
 * faces use, exported so poker faces (propsPoker.js) render WITHOUT emoji
 * (emoji tofu on headless/CI, and clash with the procedural art style).
 * The golden suit reuses the golden-banana painter.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} fruit  'banana'|'coconut'|'mango'|'golden'
 * @param {number} cx  glyph center x
 * @param {number} cy  glyph center y
 * @param {number} s   glyph size (≈ half-extent in px)
 */
export function drawFruitGlyph(ctx, fruit, cx, cy, s) {
  if (fruit === 'banana') drawBanana(ctx, cx, cy, s, false);
  else if (fruit === 'golden') drawBanana(ctx, cx, cy, s, true);
  else if (fruit === 'coconut') drawCoconut(ctx, cx, cy, s);
  else if (fruit === 'mango') drawMango(ctx, cx, cy, s);
  else {
    // unknown suit: a plain vector "?" so nothing ever falls back to emoji
    ctx.save();
    ctx.fillStyle = '#5a3a22';
    ctx.font = `bold ${Math.round(s * 1.4)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', cx, cy);
    ctx.restore();
  }
}

/**
 * CanvasTexture card-front for a fruit id ('banana'|'coconut'|'mango'|'golden').
 * Cached per fruit.
 */
export function makeFruitFaceTexture(fruit) {
  if (fruitFaceCache.has(fruit)) return fruitFaceCache.get(fruit);
  const W = 256;
  const H = 358;
  const { canvas, ctx } = makeCanvas(W, H);

  // cream card face + border
  ctx.fillStyle = '#f2e8d0';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = fruit === 'golden' ? '#c9952e' : '#7a5230';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.strokeStyle = 'rgba(122,82,48,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(22, 22, W - 44, H - 44);

  const cx = W / 2;
  const cy = H / 2 - 8;
  const s = 92;
  if (fruit === 'banana') drawBanana(ctx, cx, cy, s, false);
  else if (fruit === 'golden') drawBanana(ctx, cx, cy, s, true);
  else if (fruit === 'coconut') drawCoconut(ctx, cx, cy, s);
  else drawMango(ctx, cx, cy, s);

  // corner pips
  ctx.fillStyle = '#5a3a22';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const label = { banana: 'B', coconut: 'C', mango: 'M', golden: '★' }[fruit] || '?';
  ctx.fillText(label, 38, 54);
  ctx.save();
  ctx.translate(W - 38, H - 40);
  ctx.rotate(Math.PI);
  ctx.fillText(label, 0, 14);
  ctx.restore();

  const tex = markShared(canvasTexture(canvas)); // module cache — never disposed
  fruitFaceCache.set(fruit, tex);
  return tex;
}

let cardBackTex = null;

/** CanvasTexture card-back (dark jungle pattern + monkey glyph). */
export function makeCardBackTexture() {
  if (cardBackTex) return cardBackTex;
  const W = 256;
  const H = 358;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#1d2a1a';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#39ff88';
  ctx.lineWidth = 6;
  ctx.strokeRect(12, 12, W - 24, H - 24);
  // diagonal lattice
  ctx.strokeStyle = 'rgba(57,255,136,0.22)';
  ctx.lineWidth = 2;
  for (let i = -H; i < W + H; i += 26) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i + H, 0);
    ctx.lineTo(i, H);
    ctx.stroke();
  }
  // center medallion — monkey face
  ctx.fillStyle = '#14301c';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#39ff88';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 40, 0, Math.PI * 2);
  ctx.arc(W / 2 - 34, H / 2 - 18, 14, 0, Math.PI * 2);
  ctx.arc(W / 2 + 34, H / 2 - 18, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8c39e';
  ctx.beginPath();
  ctx.ellipse(W / 2, H / 2 + 12, 24, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a1008';
  ctx.beginPath();
  ctx.arc(W / 2 - 13, H / 2 - 8, 5, 0, Math.PI * 2);
  ctx.arc(W / 2 + 13, H / 2 - 8, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1a1008';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2 + 12, 10, 0.2, Math.PI - 0.2);
  ctx.stroke();

  cardBackTex = markShared(canvasTexture(canvas)); // module cache — never disposed
  return cardBackTex;
}

/** Bottle label CanvasTexture (name band). */
export function makeLabelTexture(text, bg = '#c9b295', fg = '#3a2a1e') {
  const { canvas, ctx } = makeCanvas(128, 64);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 64);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 120, 56);
  ctx.fillStyle = fg;
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 10), 64, 33);
  return canvasTexture(canvas);
}
