// Jungle Poker table props (R6) — rank/suit CanvasTexture card faces reusing
// the props.js card geometry constants, plus banana-chip meshes and the
// central pot stack the betting choreography (game/modes/poker.js) grows and
// sweeps. Everything procedural, mirroring materials.js conventions.

import * as THREE from 'three';
import { makeCanvas, canvasTexture, matte, drawFruitGlyph, markShared, disposeTransientObject } from './materials.js';
import { createCard, CARD_W, CARD_H } from './props.js';

// ---------------------------------------------------------------------------
// Suit + rank metadata (suits are the four fruit suits of shared/poker.js)
// ---------------------------------------------------------------------------

/** Per-suit face styling: corner letter + ink color (the center glyph is the
 *  materials.js VECTOR fruit painter — never emoji, which tofu on headless
 *  renderers and clash with the procedural art). */
export const POKER_SUIT_META = Object.freeze({
  banana: { letter: 'B', color: '#b8860b' },
  coconut: { letter: 'C', color: '#6b4a2e' },
  mango: { letter: 'M', color: '#c2571d' },
  golden: { letter: '★', color: '#a67c00' },
});

/** '2'…'10', J, Q, K, A (rank 14). */
export function rankLabel(rank) {
  return { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[rank] ?? String(rank);
}

// ---------------------------------------------------------------------------
// Card faces
// ---------------------------------------------------------------------------

/** @type {Map<string, THREE.CanvasTexture>} module-level SHARED cache — the
 *  52 face textures are reused by every card instance and never disposed. */
const faceCache = new Map();

/**
 * Rank + suit card face (same 256×358 canvas footprint as the ML fruit faces
 * so UVs on the shared card geometry line up exactly).
 * @param {{suit: string, rank: number}} card
 */
export function makePokerFaceTexture(card) {
  const key = `${card.suit}|${card.rank}`;
  if (faceCache.has(key)) return faceCache.get(key);
  const W = 256;
  const H = 358;
  const { canvas, ctx } = makeCanvas(W, H);
  const meta = POKER_SUIT_META[card.suit] ?? { letter: '?', color: '#5a3a22' };
  const label = rankLabel(card.rank);

  // cream face + border, matching makeFruitFaceTexture's framing
  ctx.fillStyle = '#f2e8d0';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = card.suit === 'golden' ? '#c9952e' : '#7a5230';
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.strokeStyle = 'rgba(122,82,48,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(22, 22, W - 44, H - 44);

  // corner indices: rank over suit letter, top-left + rotated bottom-right
  const corner = (flip) => {
    ctx.save();
    if (flip) {
      ctx.translate(W - 44, H - 78);
      ctx.rotate(Math.PI);
      ctx.translate(-44, -78);
    }
    ctx.fillStyle = meta.color;
    ctx.textAlign = 'center';
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.fillText(label, 48, 78);
    ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(meta.letter, 48, 112);
    ctx.restore();
  };
  corner(false);
  corner(true);

  // big center suit glyph — the shared VECTOR fruit painter (golden suit
  // reuses the golden-banana painter) + rank echo below it
  drawFruitGlyph(ctx, card.suit, W / 2, H / 2 - 26, 62);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = meta.color;
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.fillText(label, W / 2, H / 2 + 86);

  const tex = markShared(canvasTexture(canvas)); // module cache — never disposed
  faceCache.set(key, tex);
  return tex;
}

/**
 * A poker card mesh: the shared rounded-card geometry (props.js createCard)
 * with a rank/suit face. Face-down when `card` is null; flip identity later
 * via `mesh.userData.setFace(card|null)`.
 * @param {{suit: string, rank: number}|null} [card]
 */
export function createPokerCard(card = null) {
  const mesh = createCard(null); // back-patterned both sides, shared geometry
  // props.js caches the rounded-card geometry + back texture at module level;
  // tag them here so disposePokerProp never frees them out from under the pile
  markShared(mesh.geometry);
  if (mesh.material.map) markShared(mesh.material.map);
  mesh.userData.setFace = (c) => {
    if (c) {
      mesh.material.map = makePokerFaceTexture(c);
      mesh.material.needsUpdate = true;
    } else {
      mesh.userData.setFruit(null); // back to face-down
    }
  };
  if (card) mesh.userData.setFace(card);
  return mesh;
}

/**
 * Dispose a transient poker prop (a dealt card, a flown chip, a swept pot …):
 * frees its per-instance geometries/materials/canvas textures and detaches it.
 * Module-level caches (face textures, card geometry/back, chip geometries) are
 * markShared-tagged and survive.
 * @param {import('three').Object3D} prop
 */
export function disposePokerProp(prop) {
  disposeTransientObject(prop);
}

// ---------------------------------------------------------------------------
// Banana chips (betting currency — lighter than the notched Lucky chip)
// ---------------------------------------------------------------------------

export const POKER_CHIP_R = 0.026;
export const POKER_CHIP_H = 0.007;

/** Module-level SHARED chip geometries (markShared — never disposed). */
let chipGeo = null;
let chipTopGeo = null;
const chipBodyMat = () => matte('#f0c53d', { roughness: 0.45 });
const chipTopMat = () => matte('#8a6a1e', { roughness: 0.4 });

/**
 * One banana chip — a light two-mesh cylinder (the pot can hold dozens).
 */
export function createPokerChip() {
  chipGeo = chipGeo ?? markShared(new THREE.CylinderGeometry(POKER_CHIP_R, POKER_CHIP_R, POKER_CHIP_H, 18));
  chipTopGeo = chipTopGeo ?? markShared(new THREE.CircleGeometry(POKER_CHIP_R * 0.55, 14));
  const g = new THREE.Group();
  const body = new THREE.Mesh(chipGeo, chipBodyMat());
  body.castShadow = true;
  g.add(body);
  const emblem = new THREE.Mesh(chipTopGeo, chipTopMat());
  emblem.rotation.x = -Math.PI / 2;
  emblem.position.y = POKER_CHIP_H / 2 + 0.0004;
  g.add(emblem);
  return g;
}

/** Most chips the pot stack ever renders (POKER_START_STACK × 8 seats = 80). */
export const POT_MAX_CHIPS = 80;
const POT_COLUMN_H = 8; // chips per column before spilling to the next

/**
 * The central pot: pre-built chip columns arranged in a tight spiral;
 * `setCount(n)` toggles visibility so growth/sweeps are O(1) per update.
 * @returns {{group: THREE.Group, setCount(n: number): void, getCount(): number,
 *            chipTopPos(i: number, target?: THREE.Vector3): THREE.Vector3}}
 */
export function createPotStack() {
  const group = new THREE.Group();
  group.name = 'poker_pot';
  /** @type {THREE.Group[]} */
  const chips = [];
  for (let i = 0; i < POT_MAX_CHIPS; i++) {
    const chip = createPokerChip();
    const col = Math.floor(i / POT_COLUMN_H);
    const row = i % POT_COLUMN_H;
    // columns spiral out from the pot center so tall pots read as a hoard
    const a = col * 2.399; // golden angle
    const r = col === 0 ? 0 : 0.017 + Math.sqrt(col) * 0.041;
    chip.position.set(
      Math.cos(a) * r,
      POKER_CHIP_H / 2 + row * (POKER_CHIP_H + 0.0006),
      Math.sin(a) * r
    );
    chip.rotation.y = (i * 0.7) % (Math.PI * 2);
    chip.visible = false;
    group.add(chip);
    chips.push(chip);
  }
  let count = 0;
  return {
    group,
    setCount(n) {
      count = Math.max(0, Math.round(n));
      const visible = Math.min(count, POT_MAX_CHIPS);
      for (let i = 0; i < POT_MAX_CHIPS; i++) chips[i].visible = i < visible;
    },
    getCount: () => count,
    /** World position of chip slot `i` (flight landing target). */
    chipTopPos(i, target = new THREE.Vector3()) {
      const chip = chips[Math.min(Math.max(0, i), POT_MAX_CHIPS - 1)];
      return chip.getWorldPosition(target);
    },
  };
}

// ---------------------------------------------------------------------------
// Face-down table spreads (each seat's 3 hole cards)
// ---------------------------------------------------------------------------

/** Lateral spacing between a seat's three table cards. */
export const HOLE_SPREAD = CARD_W * 0.62;
/** Rest height of a card lying on the table. */
export const HOLE_LIE_Y = 0.008;

/** Card size re-exports so the choreographer never reaches into props.js. */
export { CARD_W as POKER_CARD_W, CARD_H as POKER_CARD_H };
