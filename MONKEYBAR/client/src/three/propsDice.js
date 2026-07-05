// Banana Dice props (R4) — procedural jungle d6 + liftable coconut shells.
// 100% procedural like props.js: CanvasTexture pip faces (1s are the golden
// wilds), rounded-cube dice, and hairy half-coconut shells the dice hide
// under. Reuses materials.js helpers; no external assets.

import * as THREE from 'three';
import { makeCanvas, canvasTexture, matte, markShared, disposeTransientObject } from './materials.js';

/** Die edge length (table scale: cards are 0.115×0.16). */
export const DIE_SIZE = 0.052;
/** Coconut shell dome radius — covers a 5-die cluster. */
export const SHELL_RADIUS = 0.15;
/** Shell dome height (hemisphere squashed a touch). */
export const SHELL_HEIGHT = 0.105;

// ---------------------------------------------------------------------------
// Pip faces
// ---------------------------------------------------------------------------

/** Standard pip layouts on a unit square (0..1). */
const PIP_LAYOUT = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]],
  6: [[0.28, 0.22], [0.72, 0.22], [0.28, 0.5], [0.72, 0.5], [0.28, 0.78], [0.72, 0.78]],
};

/** Module-level SHARED cache (markShared — never disposed): 6 pip textures
 *  reused by every die instance. */
const pipFaceCache = new Map();

/**
 * CanvasTexture for one die face. The single pip of face 1 is a golden
 * banana-star — the wild that counts toward every bid (§4.3).
 * @param {number} face 1–6
 */
export function makeDieFaceTexture(face) {
  if (pipFaceCache.has(face)) return pipFaceCache.get(face);
  const S = 128;
  const { canvas, ctx } = makeCanvas(S, S);

  // ivory face with a warm edge vignette
  ctx.fillStyle = '#f4ecd8';
  ctx.fillRect(0, 0, S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(90,58,34,0.28)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  if (face === 1) {
    // golden wild: an 8-point banana-gold star with a shine dot
    const cx = S / 2;
    const cy = S / 2;
    ctx.fillStyle = '#e8a91d';
    ctx.strokeStyle = '#9a6a10';
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? S * 0.3 : S * 0.13;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff3c8';
    ctx.beginPath();
    ctx.arc(cx - S * 0.05, cy - S * 0.07, S * 0.05, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (const [px, py] of PIP_LAYOUT[face] ?? []) {
      const x = px * S;
      const y = py * S;
      ctx.fillStyle = '#33241a';
      ctx.beginPath();
      ctx.arc(x, y, S * 0.088, 0, Math.PI * 2);
      ctx.fill();
      // recessed-pip highlight
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(x - S * 0.025, y - S * 0.03, S * 0.028, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tex = markShared(canvasTexture(canvas)); // module cache — never disposed
  pipFaceCache.set(face, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Die mesh
// ---------------------------------------------------------------------------

/** Module-level SHARED die geometry (markShared — never disposed). */
let dieGeoCache = null;

/** Rounded-cube die geometry (chamfered box — cheap, no bevel pass). */
function dieGeometry() {
  if (dieGeoCache) return dieGeoCache;
  dieGeoCache = markShared(new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 1, 1, 1));
  return dieGeoCache;
}

/** Module-level SHARED face materials (markShared — never disposed). */
let dieMaterialsCache = null;

/** Six face materials in Box order [+x,−x,+y,−y,+z,−z] = faces [3,4,1,6,2,5]
 *  (opposite faces sum to 7, like a real die). Shared across all dice. */
function dieMaterials() {
  if (dieMaterialsCache) return dieMaterialsCache;
  const BOX_FACES = [3, 4, 1, 6, 2, 5];
  dieMaterialsCache = BOX_FACES.map(
    (f) =>
      markShared(
        new THREE.MeshStandardMaterial({
          map: makeDieFaceTexture(f),
          roughness: 0.5,
          metalness: 0.02,
        })
      )
  );
  return dieMaterialsCache;
}

/** Euler that brings `face` to the top (+y), matching dieMaterials order. */
const FACE_UP_EULER = {
  1: [0, 0, 0],
  2: [-Math.PI / 2, 0, 0],
  3: [0, 0, Math.PI / 2],
  4: [0, 0, -Math.PI / 2],
  5: [Math.PI / 2, 0, 0],
  6: [Math.PI, 0, 0],
};

/**
 * Point a die mesh so `face` reads upward (+y). A random yaw spin keeps a
 * revealed cluster looking hand-thrown rather than machine-aligned.
 * @param {THREE.Mesh} die
 * @param {number} face 1–6
 * @param {number} [yaw]  rotation around the up axis (radians)
 */
export function orientDieToFace(die, face, yaw = 0) {
  const [rx, ry, rz] = FACE_UP_EULER[face] ?? FACE_UP_EULER[1];
  die.rotation.set(rx, ry, rz);
  // apply the yaw in WORLD space so the face keeps pointing up
  die.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), yaw);
  return die;
}

/**
 * Build one jungle die showing `face` up.
 * @param {number} [face] 1–6
 */
export function createDie(face = 1) {
  const mesh = new THREE.Mesh(dieGeometry(), dieMaterials());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  orientDieToFace(mesh, face, Math.random() * Math.PI * 2);
  mesh.userData.face = face;
  mesh.userData.setFace = (f, yaw = Math.random() * Math.PI * 2) => {
    mesh.userData.face = f;
    orientDieToFace(mesh, f, yaw);
  };
  return mesh;
}

// ---------------------------------------------------------------------------
// Coconut shell
// ---------------------------------------------------------------------------

/** Module-level SHARED husk texture (markShared — never disposed). */
let shellTexCache = null;

/** Hairy coconut-husk CanvasTexture (fibres + darker patches). */
function makeShellTexture() {
  if (shellTexCache) return shellTexCache;
  const S = 256;
  const { canvas, ctx } = makeCanvas(S, S);
  ctx.fillStyle = '#5a3d24';
  ctx.fillRect(0, 0, S, S);
  // deterministic fibre strokes
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 340; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const len = 8 + rnd() * 26;
    const a = rnd() * Math.PI;
    const light = rnd() > 0.55;
    ctx.strokeStyle = light ? 'rgba(138,102,64,0.5)' : 'rgba(43,26,12,0.55)';
    ctx.lineWidth = 0.8 + rnd() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  // mottled patches
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(30,18,8,${0.12 + rnd() * 0.15})`;
    ctx.beginPath();
    ctx.ellipse(rnd() * S, rnd() * S, 10 + rnd() * 26, 8 + rnd() * 18, rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  shellTexCache = markShared(canvasTexture(canvas, { repeat: [2, 1] })); // module cache
  return shellTexCache;
}

/**
 * Build a liftable half-coconut shell (open side down). Origin at the rim
 * plane so `shell.position.y = tableTopY` sits it flush on the table.
 * @param {number} [scale]
 */
export function createShell(scale = 1) {
  const g = new THREE.Group();
  const r = SHELL_RADIUS * scale;

  // outer husk dome (squashed hemisphere)
  const husk = new THREE.Mesh(
    new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: makeShellTexture(), roughness: 0.9, metalness: 0.0 })
  );
  husk.scale.y = SHELL_HEIGHT / SHELL_RADIUS;
  husk.castShadow = true;
  g.add(husk);

  // pale inner flesh (visible when the shell lifts)
  const flesh = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.96, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#e8d9bc', roughness: 0.85, side: THREE.BackSide })
  );
  flesh.scale.y = (SHELL_HEIGHT / SHELL_RADIUS) * 0.96;
  g.add(flesh);

  // rim ring — reads as shell thickness from every angle
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(r * 0.98, r * 0.035, 8, 36),
    matte('#3d2814', { roughness: 0.8 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.002;
  g.add(rim);

  // the coconut's three "eyes" near the crown
  const eyeMat = matte('#2a1a0c', { roughness: 0.6 });
  for (const [dx, dz] of [[-0.22, -0.12], [0.22, -0.12], [0, 0.24]]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.075, 8, 6), eyeMat);
    eye.position.set(dx * r, SHELL_HEIGHT * scale * 0.92, dz * r);
    eye.scale.y = 0.45;
    g.add(eye);
  }

  // a scruffy fibre tuft on the crown
  const tuftMat = matte('#7a5a34', { roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(r * 0.03, r * 0.22, 5), tuftMat);
    tuft.position.set(Math.cos(a) * r * 0.06, SHELL_HEIGHT * scale + r * 0.05, Math.sin(a) * r * 0.06);
    tuft.rotation.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    g.add(tuft);
  }

  g.userData.radius = r;
  return g;
}

/**
 * Dispose a transient dice-mode prop (a coconut shell built per round, or a
 * die when it truly leaves the scene): frees per-instance geometries /
 * materials / canvas textures and detaches it. The module caches (pip
 * textures, die geometry+materials, husk texture) are markShared-tagged and
 * survive, so future rounds rebuild for free.
 * @param {import('three').Object3D} prop
 */
export function disposeDiceProp(prop) {
  disposeTransientObject(prop);
}

/**
 * Lay `faces` out as a tight hand-thrown cluster under one shell.
 * Returns positions RELATIVE to the shell center (y = die resting height).
 * @param {number} n  dice count
 * @param {number} [spread]  cluster radius scale
 */
export function diceClusterOffsets(n, spread = 1) {
  const out = [];
  const R = SHELL_RADIUS * 0.52 * spread;
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      out.push(new THREE.Vector3(0, DIE_SIZE / 2, 0));
      continue;
    }
    const a = ((i - 1) / Math.max(1, n - 1)) * Math.PI * 2 + i * 0.7;
    const rr = R * (0.72 + 0.28 * ((i * 37) % 10) / 10);
    out.push(new THREE.Vector3(Math.cos(a) * rr, DIE_SIZE / 2, Math.sin(a) * rr));
  }
  return out;
}
