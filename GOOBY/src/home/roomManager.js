// Room manager (§C2, §D3): builds the room shells side by side from the
// pure data tables in rooms/*.js, owns the camera pan between rooms, the
// wallpaper/floor CanvasTexture painters (§C5.2/§C8.2 ids), the anchor
// registry (`getAnchor`) and the fixed-interactable tap events.
//
// V2/G19 (PLAN2 §C2/§B3): 5th outdoor room — the garden (grass ground + sky
// dome instead of walls, L3 padlock gating per §B6), NAV_ORDER (room order
// incl. the garden), setAmbience({band, weather, blend}) API, painter +4
// wallpapers +3 floors (§C8.2), pack-qualified asset keys, garden proc
// builders, per-frame update hooks.
//
// ── Integration surface (G5 care / G6 sleep / G11 decor / V2 G19-G26) ──────
//   rm.on('tap:fridge'|'tap:tv'|'tap:frontDoor'|'tap:toilet'|'tap:lampSwitch'
//         |'tap:wardrobe'|'tap:bathtub'|'tap:bed'|'tap:gooby'
//         |'tap:plot0'…'tap:plot5'|'tap:compost'|'tap:wateringCan'
//         |'tap:fertilizer', cb)
//       cb({ name, roomId, point:{x,y,z}, hit }) — hit is the raw raycast
//       intersection (for 'tap:gooby' pass it to gooby.regionAt(hit)).
//   rm.on('roomChanged', cb)        cb({ roomId, prevRoomId })
//   rm.on('gardenLocked', cb)       V2/G19: goTo('garden') below L3 (§B6)
//   rm.getAnchor(name, roomId?)     → THREE.Vector3 (world) — names: goobyIdle
//       (per room), bed, bathtub, fridge, sofa, tv, frontDoor, toilet,
//       lampSwitch, wardrobe, ballSpawn, window, counter, sink, lamp, plus
//       every §C5.2 decor slot id, plus the garden's plot0…plot5, compost,
//       wateringCan, fertilizer + §C8.3 slots (gardenBench, gardenGnome, …).
//   rm.setWallpaper(roomId, id)     ids: cream|mint|sky|peach|lavender|stars
//                                        |sunset|meadow|candy|ocean (§C8.2)
//   rm.setFloor(roomId, id)        ids: wood|tile|carpet|checker
//                                        |marble|walnut|terracotta (§C8.2)
//   rm.setNightSky(on)              bedroom window override (G6 sleep)
//   rm.setAmbience({band, weather, blend})  V2/G19 §B4 — full sky-dome
//       behavior in the garden; indoor rooms window-sky only. Light lerps are
//       G26's gfx/lights.applyAmbience (// V2/G26 consumes markers below).
//   rm.goTo(roomId, {instant})      0.35 s eased pan; rm.activeRoom()
//   rm.getRoomGroup(roomId)         V2/G19: the room's THREE.Group (garden
//       visuals — crop stages/signs — are added here by gardenInteractions)
//   rm.addUpdateHook(cb)            V2/G19: cb(dt) each rm.update (animations)
//
// Room defs are PURE data (importable without three.js — test/rooms.test.js).

import * as THREE from 'three';
import { ROOMS, UI_COLORS, UNLOCKS } from '../data/constants.js'; // V2/G19: + UNLOCKS (§B6 garden gate)
import { now } from '../core/clock.js';
import { standardMat, disposeIfOwned } from '../gfx/materials.js';
// V2/G19: live ambience sources + sky dome/window textures (§C2.1/§C10/§C11)
import { bandAt } from '../systems/dayNight.js';
import { weatherAt } from '../systems/weather.js';
import { makeDome, windowTexture } from '../gfx/sky.js';
import { CROPS } from '../data/crops.js'; // V2/G19: growth-stage GLB preloads
import { ROOM as KITCHEN } from './rooms/kitchen.js';
import { ROOM as LIVING } from './rooms/living.js';
import { ROOM as BATHROOM } from './rooms/bathroom.js';
import { ROOM as BEDROOM } from './rooms/bedroom.js';
import { ROOM as GARDEN, GARDEN_SIZE } from './rooms/garden.js'; // V2/G19 (§C2)

/**
 * @typedef {Object} RoomFurnitureEntry
 * @property {string} [item]      Kenney furniture-kit GLB name (auto-grounded)
 * @property {string} [proc]      procedural builder id: 'door'|'window'|'lampSwitch'
 * @property {string} [slot]      §C5.2 decor slot id (registers a slot anchor)
 * @property {Array<{item: string, at: number[], rotY?: number, scale?: number}>} [pieces] multi-piece slot (table set)
 * @property {Record<string, Array>} [piecesByItem] variant piece layouts (G11 decor swaps — piece `at`/`rotY`/`scale` are holder-local, so they compose with the entry-level holder transform)
 * @property {number[]} at        room-local [x, yLift, z]
 * @property {number} [rotY]      degrees
 * @property {number|number[]} [scale]
 * @property {string} [interact]  tap event name → 'tap:<interact>'
 * @property {string} [anchor]    anchor name registered at this position
 * @property {number[]} [hitSize] [w,h,d] of the invisible tap box
 * @property {boolean} [noShadow] skip shadow casting (rugs)
 *
 * @typedef {Object} RoomDef
 * @property {string} id
 * @property {boolean} [outdoor]  V2/G19 (§B3): no walls/wallpaper/floor decor,
 *   grass CanvasTexture ground + sky dome instead
 * @property {number} [camZ]      V2/G19: per-room camera distance override
 *   (default CAM_OFFSET.z 7.2 — the garden pulls back to fit its 5×4 m shell)
 * @property {Record<string, {default: string|null, items: readonly string[]}>} slots
 * @property {readonly RoomFurnitureEntry[]} furniture
 * @property {Record<string, readonly number[]>} anchors
 */

/** Ordered room defs (§B3: kitchen · living · bathroom · bedroom · garden). */
export const ROOM_DEFS = Object.freeze([KITCHEN, LIVING, BATHROOM, BEDROOM, GARDEN]);

/**
 * V2/G19 (§B3): navigable room order incl. the garden. constants.ROOMS.ORDER
 * is the frozen v1 table (read-only after wave 1 — §E0.1-2), so the 5-room
 * order lives here; roomNav + swipe navigation consume it.
 */
export const NAV_ORDER = Object.freeze([...ROOMS.ORDER, GARDEN.id]);

/** Room shell dimensions (§C2: ~4×3×3.2 m). */
export const SHELL = Object.freeze({
  WIDTH: 4,
  DEPTH: 3,
  HEIGHT: 3.2,
  /** Center-to-center spacing between neighbouring rooms (gap = SPACING−WIDTH). */
  SPACING: 5.2,
  /** Half side-walls: how far they run from the back wall toward the camera. */
  SIDE_DEPTH: 1.9,
  WALL_THICKNESS: 0.12,
});

/** §C5.2 wallpaper colorways (id → painter config). V2/G19: + §C8.2 rows. */
const WALLPAPERS = Object.freeze({
  cream: { base: '#FBF3E4', motif: '#F1E4CC', style: 'dots' },
  mint: { base: '#DEF3E2', motif: '#C8E8CF', style: 'dots' },
  sky: { base: '#DBEEF9', motif: '#C2E1F2', style: 'clouds' },
  peach: { base: '#FFE7D4', motif: '#FFD6B8', style: 'dots' },
  lavender: { base: '#EAE1F6', motif: '#DACBEE', style: 'dots' },
  stars: { base: '#3A4374', motif: '#FFE9A8', style: 'stars' },
  // V2/G19 (§C8.2): 4 new wallpapers — warm gradient + sun disc, leafy motif,
  // pastel stripes, wave curls
  sunset: { base: '#FFB38A', motif: '#FFE08A', style: 'sunset' },
  meadow: { base: '#E4F2D8', motif: '#9CC98A', style: 'leaves' },
  candy: { base: '#FFE9F1', motif: '#FFC2D9', style: 'stripes' },
  ocean: { base: '#D6EEF7', motif: '#7FBEDB', style: 'waves' },
});

/** §C5.2 floor materials (id → painter config). V2/G19: + §C8.2 rows. */
const FLOORS = Object.freeze({
  wood: { base: '#C9995F', motif: '#B58450', style: 'planks' },
  tile: { base: '#F0EDE2', motif: '#DCD6C6', style: 'tiles' },
  carpet: { base: '#E9C9D4', motif: '#E0BCC9', style: 'stipple' },
  checker: { base: '#F2E7D3', motif: '#A7D8CF', style: 'checker' },
  // V2/G19 (§C8.2): 3 new floors — veined marble, dark walnut planks,
  // warm terracotta tiles
  marble: { base: '#F3F1EC', motif: '#C9C2B8', style: 'marble' },
  walnut: { base: '#6E4A2F', motif: '#59391F', style: 'planks' },
  terracotta: { base: '#D98E62', motif: '#C0764C', style: 'tiles' },
});

/** V2/G19 (§C2.1): the garden's grass ground CanvasTexture painter config. */
const GRASS = Object.freeze({ base: '#8FC97A', motif: '#7BB868', style: 'grass' });

export const WALLPAPER_IDS = Object.freeze(Object.keys(WALLPAPERS));
export const FLOOR_IDS = Object.freeze(Object.keys(FLOORS));

/**
 * Global scale applied to every furniture-kit GLB: the kit is authored around
 * 0.4–1.2 u pieces; ×1.55 puts counters at ~0.70 m and the fridge at ~1.43 m
 * so Gooby (1.05 u) reads as a chubby hip-high pet next to them. Per-entry
 * `scale` in the room tables multiplies on top.
 */
export const FURNITURE_SCALE = 1.55;

/**
 * V2/G19: resolve a room-table item name to an asset key. Pack-qualified names
 * ('nature-kit/tree_default') pass through; bare names keep the v1 default
 * pack ('furniture-kit/…').
 * @param {string} item
 * @returns {string}
 */
export const resolveAssetKey = (item) =>
  item.includes('/') ? item : `furniture-kit/${item}`;

/** All GLB asset keys the default home composition needs (preload list). */
export const HOME_ASSET_KEYS = Object.freeze([
  ...new Set([
    ...ROOM_DEFS.flatMap((def) =>
      def.furniture.flatMap((f) => {
        const items = [];
        if (f.pieces) items.push(...f.pieces.map((p) => p.item));
        else if (f.item) items.push(f.item);
        return items;
      })
    ).map(resolveAssetKey),
    // V2/G19 (§C2.3): crop growth-stage models (already pack-qualified) so
    // gardenInteractions can getModel() them without a per-room preload
    ...CROPS.flatMap((c) => c.stageModels),
  ]),
]);

// ---------------------------------------------------------------------------
// CanvasTexture painters (§D3: flat colors + subtle motifs)
// ---------------------------------------------------------------------------

/** @type {Map<string, THREE.CanvasTexture>} permanent shared texture cache */
const textureCache = new Map();

function makeTexture(kind, id, cfg) {
  const key = `${kind}:${id}`;
  if (textureCache.has(key)) return textureCache.get(key);

  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  g.fillStyle = cfg.base;
  g.fillRect(0, 0, S, S);
  g.fillStyle = cfg.motif;
  g.strokeStyle = cfg.motif;

  switch (cfg.style) {
    case 'dots': // subtle offset polka dots
      for (let row = 0; row < 8; row += 1) {
        for (let col = 0; col < 8; col += 1) {
          const x = col * 32 + (row % 2 === 0 ? 8 : 24);
          const y = row * 32 + 12;
          g.beginPath();
          g.arc(x, y, 4.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    case 'clouds': // puffy 3-lobe clouds on the sky colorway
      for (const [cx, cy, s] of [[50, 60, 1], [180, 40, 0.8], [120, 150, 1.1], [220, 190, 0.9], [30, 210, 0.85]]) {
        for (const [dx, dy, r] of [[-14, 0, 13], [0, -7, 16], [15, 0, 12]]) {
          g.beginPath();
          g.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2);
          g.fill();
        }
      }
      break;
    case 'stars': { // dots + tiny 4-point stars on twilight blue (§D3)
      for (let i = 0; i < 40; i += 1) {
        const x = (i * 97 + 31) % S;
        const y = (i * 53 + 17) % S;
        g.globalAlpha = 0.35 + ((i * 29) % 60) / 100;
        g.beginPath();
        g.arc(x, y, 1.6, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      for (const [x, y, r] of [[48, 52, 7], [190, 90, 9], [110, 190, 8], [230, 210, 6]]) {
        g.beginPath();
        for (let p = 0; p < 8; p += 1) {
          const ang = (p / 8) * Math.PI * 2 - Math.PI / 2;
          const rad = p % 2 === 0 ? r : r * 0.4;
          g[p === 0 ? 'moveTo' : 'lineTo'](x + Math.cos(ang) * rad, y + Math.sin(ang) * rad);
        }
        g.closePath();
        g.fill();
      }
      break;
    }
    case 'planks': { // horizontal wood planks with staggered joints + grain
      const plank = 32;
      g.lineWidth = 2;
      for (let y = 0; y < S; y += plank) {
        g.strokeRect(-2, y, S + 4, plank);
        const off = (y / plank) % 2 === 0 ? 64 : 0;
        for (let x = off; x < S; x += 128) {
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x, y + plank);
          g.stroke();
        }
      }
      g.globalAlpha = 0.25;
      for (let i = 0; i < 26; i += 1) {
        const x = (i * 41) % S;
        const y = (i * 89 + 9) % S;
        g.fillRect(x, y, 14 + (i % 3) * 8, 1.5);
      }
      g.globalAlpha = 1;
      break;
    }
    case 'tiles': // square tiles with grout lines
      g.lineWidth = 3;
      for (let i = 0; i <= 4; i += 1) {
        g.beginPath();
        g.moveTo(i * 64, 0);
        g.lineTo(i * 64, S);
        g.moveTo(0, i * 64);
        g.lineTo(S, i * 64);
        g.stroke();
      }
      break;
    case 'stipple': // soft carpet noise
      for (let i = 0; i < 500; i += 1) {
        const x = (i * 37 + 11) % S;
        const y = (i * 71 + 5) % S;
        g.globalAlpha = 0.18 + ((i * 13) % 40) / 100;
        g.fillRect(x, y, 2, 2);
      }
      g.globalAlpha = 1;
      break;
    case 'checker': // alternating pastel tiles
      for (let row = 0; row < 4; row += 1) {
        for (let col = 0; col < 4; col += 1) {
          if ((row + col) % 2 === 0) g.fillRect(col * 64, row * 64, 64, 64);
        }
      }
      break;
    // ---- V2/G19 (§C8.2 painter additions + §C2.1 grass) ----
    case 'sunset': { // warm vertical gradient + sun disc
      const grad = g.createLinearGradient(0, 0, 0, S);
      grad.addColorStop(0, '#FFD9A0');
      grad.addColorStop(0.55, cfg.base);
      grad.addColorStop(1, '#E58BB8');
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
      g.fillStyle = cfg.motif;
      g.beginPath();
      g.arc(S * 0.62, S * 0.34, 30, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 0.35;
      g.beginPath();
      g.arc(S * 0.62, S * 0.34, 42, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
      break;
    }
    case 'leaves': // leafy meadow motif — staggered two-lobe leaves
      for (let row = 0; row < 6; row += 1) {
        for (let col = 0; col < 6; col += 1) {
          const x = col * 44 + (row % 2 === 0 ? 12 : 34);
          const y = row * 44 + 16;
          g.save();
          g.translate(x, y);
          g.rotate(((row * 7 + col * 13) % 8) * 0.35 - 1.2);
          g.beginPath();
          g.ellipse(0, 0, 11, 4.5, 0, 0, Math.PI * 2);
          g.fill();
          g.beginPath();
          g.ellipse(9, -5, 8, 3.5, 0.7, 0, Math.PI * 2);
          g.fill();
          g.restore();
        }
      }
      break;
    case 'stripes': // candy pastel vertical stripes
      for (let x = 0; x < S; x += 42) g.fillRect(x, 0, 21, S);
      g.globalAlpha = 0.4;
      g.fillStyle = '#FFFFFF';
      for (let x = 16; x < S; x += 42) g.fillRect(x, 0, 5, S);
      g.globalAlpha = 1;
      break;
    case 'waves': // ocean wave curls in offset rows
      g.lineWidth = 3.5;
      for (let row = 0; row < 6; row += 1) {
        const y = row * 44 + 22;
        const off = row % 2 === 0 ? 0 : 32;
        for (let x = -16; x < S + 16; x += 64) {
          g.beginPath();
          g.arc(x + off, y, 14, Math.PI, Math.PI * 1.85);
          g.stroke();
          g.beginPath();
          g.arc(x + off + 20, y + 4, 8, Math.PI, Math.PI * 1.75);
          g.stroke();
        }
      }
      break;
    case 'marble': // pale slab + wandering veins
      g.lineWidth = 1.6;
      g.globalAlpha = 0.55;
      for (let v = 0; v < 7; v += 1) {
        let x = (v * 53 + 17) % S;
        let y = 0;
        g.beginPath();
        g.moveTo(x, y);
        while (y < S) {
          x += Math.sin(v * 3 + y * 0.06) * 9 + ((v * 31 + y) % 7) - 3;
          y += 16 + ((v * 13 + y) % 9);
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
      break;
    case 'grass': // §C2.1 garden ground — mottled green + blade stipple
      for (let i = 0; i < 700; i += 1) {
        const x = (i * 37 + 11) % S;
        const y = (i * 71 + 5) % S;
        g.globalAlpha = 0.25 + ((i * 13) % 45) / 100;
        g.fillRect(x, y, 2, 3 + (i % 3));
      }
      g.globalAlpha = 0.3;
      g.fillStyle = '#A8D98A';
      for (let i = 0; i < 240; i += 1) {
        const x = (i * 97 + 31) % S;
        const y = (i * 53 + 17) % S;
        g.fillRect(x, y, 1.5, 3);
      }
      g.globalAlpha = 1;
      break;
    // ---- end V2/G19 ----
    default:
      break;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Procedural builders (door / window / lamp switch)
// ---------------------------------------------------------------------------

function buildDoor(track) {
  const grp = new THREE.Group();
  grp.name = 'proc-door';
  const frame = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.9, 2.0, 0.1)), standardMat('#9A6B45', { roughness: 0.8 }));
  frame.position.y = 1.0;
  const panel = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.76, 1.86, 0.09)), standardMat('#C98F5F', { roughness: 0.7 }));
  panel.position.set(0, 0.97, 0.02);
  const inset = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.56, 0.85, 0.03)), standardMat('#B57C4C', { roughness: 0.7 }));
  inset.position.set(0, 1.28, 0.055);
  const knob = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.045, 10, 8)), standardMat('#F2C14E', { roughness: 0.35 }));
  knob.position.set(-0.3, 0.95, 0.08);
  grp.add(frame, panel, inset, knob);
  return grp;
}

function buildWindow(track) {
  const grp = new THREE.Group();
  grp.name = 'proc-window';
  const frame = new THREE.Mesh(track.geo(new THREE.BoxGeometry(1.15, 1.15, 0.09)), standardMat('#FBF1DE', { roughness: 0.75 }));
  const sill = new THREE.Mesh(track.geo(new THREE.BoxGeometry(1.3, 0.07, 0.18)), standardMat('#FBF1DE', { roughness: 0.75 }));
  sill.position.set(0, -0.6, 0.05);
  // sky pane — material owned by the manager so the day/night tint can lerp
  const skyMat = new THREE.MeshBasicMaterial({ color: '#AEE0F7' });
  track.mat(skyMat);
  const sky = new THREE.Mesh(track.geo(new THREE.PlaneGeometry(0.98, 0.98)), skyMat);
  sky.name = 'windowSky';
  sky.position.z = 0.05;
  const barV = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.05, 1.0, 0.03)), standardMat('#FBF1DE', { roughness: 0.75 }));
  barV.position.z = 0.065;
  const barH = new THREE.Mesh(track.geo(new THREE.BoxGeometry(1.0, 0.05, 0.03)), standardMat('#FBF1DE', { roughness: 0.75 }));
  barH.position.z = 0.065;
  grp.add(frame, sill, sky, barV, barH);
  grp.userData.skyMat = skyMat;
  return grp;
}

function buildLampSwitch(track) {
  const grp = new THREE.Group();
  grp.name = 'proc-lampSwitch';
  const plate = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.2, 0.28, 0.035)), standardMat('#FFFDF6', { roughness: 0.6 }));
  const knob = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.07, 0.11, 0.06)), standardMat(UI_COLORS.PRIMARY_PINK, { roughness: 0.5 }));
  knob.position.z = 0.04;
  grp.add(plate, knob);
  return grp;
}

// ---- V2/G19: garden procedural builders (§C2.1 compost bin / watering can,
// §C2.2 fertilizer bag, §C8.3 free defaults: bench + dirt path) ----

function buildCompostBin(track) {
  const grp = new THREE.Group();
  grp.name = 'proc-compostBin';
  const wood = standardMat('#7A9A5A', { roughness: 0.85 });
  const dark = standardMat('#5E7A44', { roughness: 0.9 });
  // slatted box body
  for (let i = 0; i < 3; i += 1) {
    const slat = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.52, 0.13, 0.52)), i % 2 === 0 ? wood : dark);
    slat.position.y = 0.09 + i * 0.16;
    grp.add(slat);
  }
  // corner posts
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.07, 0.56, 0.07)), standardMat('#8A6B45', { roughness: 0.85 }));
    post.position.set(sx * 0.26, 0.28, sz * 0.26);
    grp.add(post);
  }
  // compost heap peeking over the rim
  const heap = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.22, 10, 7)), standardMat('#6B4A2E', { roughness: 1 }));
  heap.scale.y = 0.5;
  heap.position.y = 0.56;
  grp.add(heap);
  const sprout = new THREE.Mesh(track.geo(new THREE.ConeGeometry(0.05, 0.1, 6)), standardMat('#9CC98A', { roughness: 0.8 }));
  sprout.position.set(0.06, 0.68, 0.02);
  grp.add(sprout);
  return grp;
}

function buildWateringCan(track) {
  const grp = new THREE.Group();
  grp.name = 'proc-wateringCan';
  const tin = standardMat('#7FB4CE', { roughness: 0.45, metalness: 0.3 });
  const body = new THREE.Mesh(track.geo(new THREE.CylinderGeometry(0.13, 0.15, 0.24, 12)), tin);
  body.position.y = 0.12;
  grp.add(body);
  // spout: angled thin cylinder + rose head
  const spout = new THREE.Mesh(track.geo(new THREE.CylinderGeometry(0.025, 0.035, 0.28, 8)), tin);
  spout.position.set(0.19, 0.19, 0);
  spout.rotation.z = Math.PI / 2.6;
  grp.add(spout);
  const rose = new THREE.Mesh(track.geo(new THREE.CylinderGeometry(0.05, 0.03, 0.04, 10)), tin);
  rose.position.set(0.3, 0.26, 0);
  rose.rotation.z = Math.PI / 2.6;
  grp.add(rose);
  // top + back handles (half-tori)
  const handleTop = new THREE.Mesh(track.geo(new THREE.TorusGeometry(0.08, 0.016, 8, 14, Math.PI)), tin);
  handleTop.position.set(-0.02, 0.24, 0);
  grp.add(handleTop);
  const handleBack = new THREE.Mesh(track.geo(new THREE.TorusGeometry(0.09, 0.016, 8, 14, Math.PI)), tin);
  handleBack.position.set(-0.14, 0.13, 0);
  handleBack.rotation.z = Math.PI / 2;
  grp.add(handleBack);
  return grp;
}

function buildFertilizerBag(track) {
  const grp = new THREE.Group();
  grp.name = 'proc-fertilizerBag';
  const sack = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.3, 0.4, 0.2)), standardMat('#D9B98A', { roughness: 0.95 }));
  sack.position.y = 0.2;
  sack.rotation.z = 0.06;
  grp.add(sack);
  const fold = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.32, 0.07, 0.22)), standardMat('#C4A26E', { roughness: 0.95 }));
  fold.position.y = 0.41;
  fold.rotation.z = 0.06;
  grp.add(fold);
  // sprout label patch
  const label = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.18, 0.16, 0.012)), standardMat('#F6F0E0', { roughness: 0.8 }));
  label.position.set(0, 0.22, 0.105);
  grp.add(label);
  const leaf = new THREE.Mesh(track.geo(new THREE.ConeGeometry(0.045, 0.09, 6)), standardMat('#7BB868', { roughness: 0.8 }));
  leaf.position.set(0, 0.22, 0.12);
  grp.add(leaf);
  return grp;
}

function buildGardenBench(track) {
  const grp = new THREE.Group();
  grp.name = 'proc-gardenBench';
  const wood = standardMat('#A9805A', { roughness: 0.85 });
  for (let i = 0; i < 3; i += 1) {
    const slat = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.9, 0.045, 0.11)), wood);
    slat.position.set(0, 0.32, -0.13 + i * 0.13);
    grp.add(slat);
  }
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.08, 0.32, 0.34)), standardMat('#8A6B45', { roughness: 0.85 }));
    leg.position.set(sx * 0.36, 0.16, 0);
    grp.add(leg);
  }
  // low backrest
  const back = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.9, 0.1, 0.05)), wood);
  back.position.set(0, 0.52, -0.18);
  back.rotation.x = -0.18;
  grp.add(back);
  return grp;
}

function buildDirtPath(track) {
  const grp = new THREE.Group();
  grp.name = 'proc-dirtPath';
  const dirt = standardMat('#A5814F', { roughness: 1 });
  for (let i = 0; i < 4; i += 1) {
    const patch = new THREE.Mesh(track.geo(new THREE.CircleGeometry(0.16 - i * 0.012, 10)), dirt);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(Math.sin(i * 1.7) * 0.12, 0.012, 0.45 - i * 0.32);
    patch.scale.x = 1.35;
    grp.add(patch);
  }
  return grp;
}

// ---- end V2/G19 proc builders ----

const PROC_BUILDERS = {
  door: buildDoor, window: buildWindow, lampSwitch: buildLampSwitch,
  // V2/G19 (§C2.1/§C2.2/§C8.3)
  compostBin: buildCompostBin, wateringCan: buildWateringCan,
  fertilizerBag: buildFertilizerBag, gardenBench: buildGardenBench,
  dirtPath: buildDirtPath,
};

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

/**
 * Build the home's rooms into `scene` and manage them.
 *
 * @param {{
 *   scene: THREE.Scene,
 *   camera: THREE.PerspectiveCamera,
 *   assets: {getModel: (key: string) => THREE.Group},
 *   store: {get: (path: string) => *},
 * }} deps
 */
export function createRoomManager({ scene, camera, assets, store }) {
  /** @type {THREE.BufferGeometry[]} */
  const ownedGeos = [];
  /** @type {THREE.Material[]} */
  const ownedMats = [];
  const track = {
    geo(g) {
      ownedGeos.push(g);
      return g;
    },
    mat(m) {
      ownedMats.push(m);
      return m;
    },
  };

  /** shared invisible material for the raycast-only tap boxes */
  const hitMat = track.mat(new THREE.MeshBasicMaterial({ visible: false }));

  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  function emit(event, payload) {
    for (const cb of listeners.get(event) ?? []) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[roomManager] listener error for '${event}':`, err);
      }
    }
  }

  /** anchor registry: `${roomId}:${name}` → world THREE.Vector3 */
  const anchors = new Map();
  function addAnchor(roomId, name, world) {
    anchors.set(`${roomId}:${name}`, world.clone());
  }

  /** @type {THREE.Mesh[]} invisible tap boxes (raycast targets) */
  const hitboxes = [];
  /** @type {Set<(dt: number) => void>} V2/G19: per-frame update hooks */
  const updateHooks = new Set();
  /** @type {THREE.Object3D|null} Gooby's group (raycast for 'tap:gooby') */
  let goobyTarget = null;

  /** per-room build records */
  const rooms = new Map();

  const raycaster = new THREE.Raycaster();
  const homeGroup = new THREE.Group();
  homeGroup.name = 'home';
  scene.add(homeGroup);

  const roomCenterX = (roomId) => NAV_ORDER.indexOf(roomId) * SHELL.SPACING; // V2/G19: 5-room order

  /** V2/G19: the garden's sky dome mesh (visible only around the garden). */
  let skyDome = null;

  // --- shells + furniture ---------------------------------------------------
  for (const def of ROOM_DEFS) {
    const cx = roomCenterX(def.id);
    const group = new THREE.Group();
    group.name = `room-${def.id}`;
    group.position.x = cx;
    homeGroup.add(group);

    // materials owned per room so wallpaper/floor swap independently
    const wallMat = track.mat(new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }));
    const floorMat = track.mat(new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }));

    const T = SHELL.WALL_THICKNESS;
    if (def.outdoor) {
      // V2/G19 (§C2.1/§B3): outdoor shell — 5×4 m grass ground + sky dome,
      // no walls/baseboard, wallpaper/floor painters skip this room.
      const ground = new THREE.Mesh(
        track.geo(new THREE.BoxGeometry(GARDEN_SIZE.WIDTH, T, GARDEN_SIZE.DEPTH)),
        floorMat
      );
      ground.name = 'ground';
      ground.position.y = -T / 2;
      ground.receiveShadow = true;
      group.add(ground);
      const grass = makeTexture('fl', 'grass', GRASS);
      floorMat.map = grass;
      floorMat.color.set('#ffffff');
      floorMat.map.repeat.set(2.5, 2);
      floorMat.needsUpdate = true;

      // sky dome (§C2.1: one draw call, gfx/sky.js) — starts on the live band
      const liveBand = bandAt(now()).band;
      const liveWeather = weatherAt(now()).state;
      skyDome = makeDome(liveBand, liveWeather);
      skyDome.position.y = -0.4; // dip the seam below the ground plane
      skyDome.visible = false; // refreshVisibility() decides
      group.add(skyDome);
    } else {
      const floor = new THREE.Mesh(track.geo(new THREE.BoxGeometry(SHELL.WIDTH, T, SHELL.DEPTH)), floorMat);
      floor.name = 'floor';
      floor.position.y = -T / 2;
      floor.receiveShadow = true;
      group.add(floor);

      const back = new THREE.Mesh(track.geo(new THREE.BoxGeometry(SHELL.WIDTH, SHELL.HEIGHT, T)), wallMat);
      back.name = 'wallBack';
      back.position.set(0, SHELL.HEIGHT / 2, -SHELL.DEPTH / 2 - T / 2);
      group.add(back);

      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(track.geo(new THREE.BoxGeometry(T, SHELL.HEIGHT, SHELL.SIDE_DEPTH)), wallMat);
        side.name = sx < 0 ? 'wallLeft' : 'wallRight';
        side.position.set(
          sx * (SHELL.WIDTH / 2 + T / 2),
          SHELL.HEIGHT / 2,
          -SHELL.DEPTH / 2 + SHELL.SIDE_DEPTH / 2
        );
        group.add(side);
      }

      // baseboard strip for a finished look
      const base = new THREE.Mesh(
        track.geo(new THREE.BoxGeometry(SHELL.WIDTH, 0.09, 0.05)),
        standardMat('#FFFDF4', { roughness: 0.85 })
      );
      base.position.set(0, 0.045, -SHELL.DEPTH / 2 + 0.03);
      group.add(base);
    }

    const record = {
      def,
      group,
      wallMat,
      floorMat,
      wallpaper: null,
      floor: null,
      /** slot id → furniture holder group (G11's decor.js swaps models here) */
      slotHolders: new Map(),
      windowSkyMat: null,
    };

    // furniture + anchors + hitboxes
    for (const entry of def.furniture) {
      const [ex, ey, ez] = entry.at;
      const world = new THREE.Vector3(cx + ex, ey, ez);
      if (entry.anchor) addAnchor(def.id, entry.anchor, world);
      if (entry.slot) {
        addAnchor(def.id, entry.slot, world);
        // V2/G19: slots may default to a procedural build (garden bench/path)
        if (!entry.item && !entry.pieces && !entry.proc) continue; // empty slot (wall art, gnome)
      }

      const holder = new THREE.Group();
      holder.name = entry.slot ? `slot-${entry.slot}` : `furn-${entry.item ?? entry.proc}`;
      holder.position.set(ex, ey, ez);
      holder.rotation.y = ((entry.rotY ?? 0) * Math.PI) / 180;
      if (entry.scale != null) {
        if (Array.isArray(entry.scale)) holder.scale.set(entry.scale[0], entry.scale[1], entry.scale[2]);
        else holder.scale.setScalar(entry.scale);
      }
      group.add(holder);
      if (entry.slot) record.slotHolders.set(entry.slot, holder);

      if (entry.proc) {
        const proc = PROC_BUILDERS[entry.proc](track);
        holder.add(proc);
        if (entry.proc === 'window') record.windowSkyMat = proc.userData.skyMat;
      } else {
        const pieces = entry.pieces ?? [{ item: entry.item, at: [0, 0, 0], rotY: 0 }];
        for (const piece of pieces) {
          const model = assets.getModel(resolveAssetKey(piece.item)); // V2/G19: multi-pack keys
          model.scale.setScalar(FURNITURE_SCALE);
          groundAndCenter(model);
          const pieceHolder = new THREE.Group();
          pieceHolder.position.set(piece.at[0], piece.at[1], piece.at[2]);
          pieceHolder.rotation.y = ((piece.rotY ?? 0) * Math.PI) / 180;
          if (piece.scale != null) pieceHolder.scale.setScalar(piece.scale);
          pieceHolder.add(model);
          holder.add(pieceHolder);
        }
      }

      holder.traverse((obj) => {
        if (obj.isMesh) obj.castShadow = !entry.noShadow;
      });

      if (entry.interact) {
        const size = entry.hitSize ?? [0.8, 1, 0.8];
        const hit = new THREE.Mesh(
          track.geo(new THREE.BoxGeometry(size[0], size[1], size[2])),
          hitMat // invisible — raycast only (raycaster ignores visibility)
        );
        hit.name = `hit-${entry.interact}`;
        hit.visible = false;
        hit.position.set(cx + ex, ey + size[1] / 2, ez);
        hit.rotation.y = holder.rotation.y;
        hit.userData.interact = entry.interact;
        hit.userData.roomId = def.id;
        homeGroup.add(hit);
        hitboxes.push(hit);
      }
    }

    // point anchors from the data table (goobyIdle, ballSpawn, …)
    for (const [name, at] of Object.entries(def.anchors)) {
      addAnchor(def.id, name, new THREE.Vector3(cx + at[0], at[1], at[2]));
    }

    rooms.set(def.id, record);
  }

  // wallpaper/floor: saved decor or the free defaults (§C5.2)
  for (const def of ROOM_DEFS) {
    if (def.outdoor) continue; // V2/G19 (§B3): garden has no wallpaper/floor decor
    applyWallpaper(def.id, store?.get(`decor.wallpaper.${def.id}`) ?? 'cream');
    applyFloor(def.id, store?.get(`decor.floor.${def.id}`) ?? 'wood');
  }

  function applyWallpaper(roomId, id) {
    const record = rooms.get(roomId);
    if (!record || record.def.outdoor) return; // V2/G19: no-op for the garden
    const cfg = WALLPAPERS[id] ?? WALLPAPERS.cream;
    const tex = makeTexture('wp', id in WALLPAPERS ? id : 'cream', cfg);
    record.wallMat.map = tex;
    record.wallMat.color.set('#ffffff');
    record.wallMat.needsUpdate = true;
    record.wallMat.map.repeat.set(2.4, 2);
    record.wallpaper = id;
  }

  function applyFloor(roomId, id) {
    const record = rooms.get(roomId);
    if (!record || record.def.outdoor) return; // V2/G19: grass is fixed (§C2.1)
    const cfg = FLOORS[id] ?? FLOORS.wood;
    const tex = makeTexture('fl', id in FLOORS ? id : 'wood', cfg);
    record.floorMat.map = tex;
    record.floorMat.color.set('#ffffff');
    record.floorMat.needsUpdate = true;
    record.floorMat.map.repeat.set(2, 1.5);
    record.floor = id;
  }

  // --- camera pan (§C2: 0.35 s ease, portrait FOV 45, Gooby center-low) ------
  // z 7.2 shows ±1.67 m of the back wall at 390×844 — room edges crop softly.
  // V2/G19: rooms may override the distance via def.camZ (the garden pulls
  // back to 8.4 so its 5×4 m outdoor shell + tools fit the portrait frame).
  const CAM_OFFSET = Object.freeze({ y: 2.4, z: 7.2 });
  const LOOK_AT = Object.freeze({ y: 1.05, z: -0.5 });
  const roomCamZ = (roomId) => rooms.get(roomId)?.def.camZ ?? CAM_OFFSET.z; // V2/G19

  let activeId = ROOMS.DEFAULT;
  let camX = roomCenterX(activeId);
  let camZ = roomCamZ(activeId); // V2/G19: per-room camera distance
  let panFrom = camX;
  let panTo = camX;
  let panFromZ = camZ; // V2/G19
  let panToZ = camZ; // V2/G19
  let panT = 1; // normalized progress; 1 = settled
  let panInvolvesGarden = false; // V2/G19: keeps the dome visible mid-pan

  function placeCamera(x, z = camZ) {
    camera.position.set(x, CAM_OFFSET.y, z);
    camera.lookAt(x, LOOK_AT.y, LOOK_AT.z);
  }
  placeCamera(camX);

  /** Only the active room ±1 neighbour is rendered (draw-call budget §E10). */
  function refreshVisibility() {
    const activeIdx = NAV_ORDER.indexOf(activeId); // V2/G19: 5-room order
    for (const [roomId, record] of rooms) {
      const idx = NAV_ORDER.indexOf(roomId);
      record.group.visible = Math.abs(idx - activeIdx) <= 1;
    }
    refreshDomeVisibility();
  }

  /**
   * V2/G19: the dome encloses the camera (radius 11 > cam distance 7.6), so
   * it may only render while the garden itself is on screen — otherwise it
   * would swallow the indoor backdrop of the neighbouring bedroom.
   */
  function refreshDomeVisibility() {
    if (!skyDome) return;
    skyDome.visible = activeId === GARDEN.id || (panT < 1 && panInvolvesGarden);
  }
  refreshVisibility();

  // --- V2/G19: ambience (§B4/§C10.2/§C11.2) ---------------------------------
  // Band/weather are read LIVE from systems/dayNight + systems/weather on a
  // 30 s timer (G20's 'dayBandChanged'/'weatherChanged' ticker events refine
  // this via setAmbience but are not required — §E G19).
  let nightSkyOverride = false;
  let skyTimer = 0;
  /** last applied params — G26 reads via getAmbience() */
  let ambience = { band: 'day', weather: 'clear', blend: null };

  /** grass tint per band so garden nights read dark without a light rig */
  const GRASS_TINT = Object.freeze({
    day: new THREE.Color('#ffffff'),
    dawn: new THREE.Color('#ffe9d6'),
    dusk: new THREE.Color('#e8c2ad'),
    night: new THREE.Color('#7d87b5'),
  });
  const WEATHER_TINT_MULT = Object.freeze({ clear: 1, cloudy: 0.88, rain: 0.78 });

  function applyAmbience(params) {
    const band = params?.band ?? 'day';
    const weather = params?.weather ?? 'clear';
    ambience = { band, weather, blend: params?.blend ?? null };

    // indoor rooms: window-sky textures only (§B3 — sleep override wins).
    // V2/G26 consumes: light-intensity lerps (hemi/dir ×0.85 cloudy / ×0.70
    // rain per §C11.2 + §C10.2 band params) apply via gfx/lights.applyAmbience
    // — this manager deliberately does NOT touch the home light rig.
    const winTex = nightSkyOverride
      ? windowTexture('night', 'clear')
      : windowTexture(band, weather);
    for (const record of rooms.values()) {
      if (!record.windowSkyMat) continue;
      record.windowSkyMat.map = winTex;
      record.windowSkyMat.color.set('#ffffff');
      record.windowSkyMat.needsUpdate = true;
    }

    // garden: full behavior — dome retexture + grass tint (§C2.1)
    skyDome?.userData.setSky(band, weather);
    const gardenRec = rooms.get(GARDEN.id);
    if (gardenRec) {
      gardenRec.floorMat.color
        .copy(GRASS_TINT[band] ?? GRASS_TINT.day)
        .multiplyScalar(WEATHER_TINT_MULT[weather] ?? 1);
    }
  }

  function refreshSky() {
    const ms = now();
    applyAmbience({ band: bandAt(ms).band, weather: weatherAt(ms).state, blend: bandAt(ms).blend });
  }
  refreshSky();

  const easeInOut = (u) => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);

  const manager = {
    /** @param {string} event @param {(payload: *) => void} cb @returns {() => void} */
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => listeners.get(event)?.delete(cb);
    },

    /** @param {string} event @param {Function} cb */
    off(event, cb) {
      listeners.get(event)?.delete(cb);
    },

    /** @returns {string} active room id */
    activeRoom() {
      return activeId;
    },

    /** @returns {number} world x of a room's floor center */
    roomCenterX,

    /**
     * Pan the camera to a room (0.35 s ease — §C2). Emits 'roomChanged'.
     * @param {string} roomId
     * @param {{instant?: boolean}} [opts]
     */
    goTo(roomId, opts = {}) {
      if (!rooms.has(roomId)) {
        console.warn(`[roomManager] unknown room '${roomId}'`);
        return;
      }
      // V2/G19 (§B6): the garden is padlocked below UNLOCKS.GARDEN — emit the
      // teaser event (gardenInteractions toasts „Der Garten öffnet ab L3").
      if (roomId === GARDEN.id && (store?.get('level') ?? 1) < UNLOCKS.GARDEN) {
        emit('gardenLocked', { level: store?.get('level') ?? 1, unlockLevel: UNLOCKS.GARDEN });
        return;
      }
      const prev = activeId;
      activeId = roomId;
      panFrom = camX;
      panTo = roomCenterX(roomId);
      panFromZ = camZ; // V2/G19: dolly toward the room's camZ during the pan
      panToZ = roomCamZ(roomId);
      panT = opts.instant ? 1 : 0;
      panInvolvesGarden = roomId === GARDEN.id || prev === GARDEN.id; // V2/G19
      if (opts.instant) {
        camX = panTo;
        camZ = panToZ;
        placeCamera(camX);
        refreshVisibility();
      } else {
        // both old and new neighbourhoods stay visible during the pan
        for (const [rid, record] of rooms) {
          const idx = NAV_ORDER.indexOf(rid); // V2/G19: 5-room order
          const ai = NAV_ORDER.indexOf(activeId);
          const pi = NAV_ORDER.indexOf(prev);
          record.group.visible = Math.abs(idx - ai) <= 1 || Math.abs(idx - pi) <= 1;
        }
        refreshDomeVisibility();
      }
      if (prev !== roomId) emit('roomChanged', { roomId, prevRoomId: prev });
    },

    /** @returns {boolean} true while the camera pan is easing */
    isPanning() {
      return panT < 1;
    },

    /**
     * Resolve an anchor to a world position (§C2).
     * @param {string} name anchor name (see module JSDoc)
     * @param {string} [roomId] defaults to the active room, then a global search
     * @returns {THREE.Vector3|null}
     */
    getAnchor(name, roomId) {
      if (roomId) return anchors.get(`${roomId}:${name}`)?.clone() ?? null;
      const scoped = anchors.get(`${activeId}:${name}`);
      if (scoped) return scoped.clone();
      for (const def of ROOM_DEFS) {
        const found = anchors.get(`${def.id}:${name}`);
        if (found) return found.clone();
      }
      return null;
    },

    /** @returns {string[]} every registered `${roomId}:${name}` anchor key */
    anchorKeys() {
      return [...anchors.keys()];
    },

    /**
     * Swap a room's wallpaper (§C5.2 ids: cream|mint|sky|peach|lavender|stars).
     * @param {string} roomId @param {string} id
     */
    setWallpaper(roomId, id) {
      if (!rooms.has(roomId)) return;
      applyWallpaper(roomId, id);
    },

    /**
     * Swap a room's floor (§C5.2 ids: wood|tile|carpet|checker).
     * @param {string} roomId @param {string} id
     */
    setFloor(roomId, id) {
      if (!rooms.has(roomId)) return;
      applyFloor(roomId, id);
    },

    /** @param {string} roomId @returns {{wallpaper: string, floor: string}|null} */
    getDecor(roomId) {
      const record = rooms.get(roomId);
      return record ? { wallpaper: record.wallpaper, floor: record.floor } : null;
    },

    /**
     * Decor slot holder group — G11's decor.js swaps furniture models inside.
     * @param {string} roomId @param {string} slotId
     * @returns {THREE.Group|null}
     */
    getSlotHolder(roomId, slotId) {
      return rooms.get(roomId)?.slotHolders.get(slotId) ?? null;
    },

    /** Force the bedroom window to night sky (G6 sleep). @param {boolean} on */
    setNightSky(on) {
      nightSkyOverride = !!on;
      refreshSky();
    },

    // ---- V2/G19: ambience + garden APIs (§B3/§B4/§C2) ----

    /**
     * Apply day/night + weather ambience (§B4). Full behavior in the garden
     * (sky-dome retexture + grass tint); indoor rooms get window-sky textures
     * only. Light lerps are gfx/lights.applyAmbience — G26 wires the ticker
     * events ('dayBandChanged'/'weatherChanged') to both. Without any caller
     * the manager refreshes itself from systems/dayNight + systems/weather
     * every 30 s, so ambience never REQUIRES the ticker.
     * @param {{band: 'day'|'dawn'|'dusk'|'night', weather: 'clear'|'cloudy'|'rain',
     *   blend?: {from: string, to: string, t: number}|null}} params
     */
    setAmbience(params) {
      if (!params || typeof params !== 'object') return;
      applyAmbience(params);
      skyTimer = 30; // a fresh push resets the self-refresh countdown
    },

    /** @returns {{band: string, weather: string, blend: object|null}} last applied ambience */
    getAmbience() {
      return { ...ambience };
    },

    /** @returns {readonly string[]} 5-room nav order (§B3: … bedroom · garden) */
    getNavOrder() {
      return NAV_ORDER;
    },

    /** @returns {boolean} §B6 garden gate (level ≥ UNLOCKS.GARDEN) */
    isGardenUnlocked() {
      return (store?.get('level') ?? 1) >= UNLOCKS.GARDEN;
    },

    /**
     * A room's THREE.Group (children are room-local — group.position.x is the
     * room's world center). gardenInteractions adds dynamic garden visuals
     * (crop stages, FOR-SALE signs, particles) here.
     * @param {string} roomId
     * @returns {THREE.Group|null}
     */
    getRoomGroup(roomId) {
      return rooms.get(roomId)?.group ?? null;
    },

    /**
     * Register a per-frame hook riding rm.update(dt) — gardenInteractions
     * animates the watering can / ready-crop bounce here.
     * @param {(dt: number) => void} cb
     * @returns {() => void} unsubscribe
     */
    addUpdateHook(cb) {
      updateHooks.add(cb);
      return () => updateHooks.delete(cb);
    },

    // ---- end V2/G19 APIs ----

    /** Gooby's group for 'tap:gooby' raycasts. @param {THREE.Object3D|null} obj */
    setGoobyTarget(obj) {
      goobyTarget = obj;
    },

    /**
     * Raycast a tap (from input 'tap' ndc coords) against Gooby + the fixed
     * interactables; emits 'tap:<name>' with { name, roomId, point, hit }.
     * @param {{nx: number, ny: number}} ndc
     * @returns {string|null} the emitted interactable name, or null
     */
    handleTap(ndc) {
      raycaster.setFromCamera(new THREE.Vector2(ndc.nx, ndc.ny), camera);
      // Gooby first — he sits in front of the furniture and always wins.
      if (goobyTarget) {
        const hit = raycaster.intersectObject(goobyTarget, true)[0];
        if (hit) {
          emit('tap:gooby', { name: 'gooby', roomId: activeId, point: hit.point, hit });
          return 'gooby';
        }
      }
      const hits = raycaster.intersectObjects(hitboxes, false);
      let hit = hits[0];
      // V2/G19 (§C2.2): the shallow home camera makes garden hitboxes overlap
      // along the tap ray (front plot row occludes the back row's base, the
      // watering-can box shades the compost bin behind it). When one ray
      // pierces several GARDEN boxes, pick the one whose box center lies
      // nearest the ray — matches where the player actually aimed. Indoor
      // rooms keep the plain v1 nearest-intersection rule.
      if (hit && hit.object.userData.roomId === GARDEN.id) {
        const gardenHits = hits.filter((h) => h.object.userData.roomId === GARDEN.id);
        if (gardenHits.length > 1) {
          const center = new THREE.Vector3();
          hit = gardenHits.reduce((best, h) => {
            h.object.getWorldPosition(center);
            const d = raycaster.ray.distanceToPoint(center);
            return d < best.d ? { h, d } : best;
          }, { h: hit, d: Infinity }).h ?? hit;
        }
      }
      if (hit) {
        const name = hit.object.userData.interact;
        const payload = { name, roomId: hit.object.userData.roomId, point: hit.point, hit };
        emit(`tap:${name}`, payload);
        return name;
      }
      return null;
    },

    /** Ease the camera pan + refresh the window sky. @param {number} dt seconds */
    update(dt) {
      if (panT < 1) {
        panT = Math.min(1, panT + dt / ROOMS.PAN_SEC);
        camX = THREE.MathUtils.lerp(panFrom, panTo, easeInOut(panT));
        camZ = THREE.MathUtils.lerp(panFromZ, panToZ, easeInOut(panT)); // V2/G19
        placeCamera(camX);
        if (panT >= 1) refreshVisibility();
      }
      skyTimer -= dt;
      if (skyTimer <= 0) {
        skyTimer = 30;
        refreshSky();
      }
      // V2/G19: per-frame hooks (garden animations)
      for (const cb of updateHooks) {
        try {
          cb(dt);
        } catch (err) {
          console.error('[roomManager] update hook error:', err);
        }
      }
    },

    /** Free every geometry/material this manager created (shared mats stay). */
    dispose() {
      for (const geo of ownedGeos) geo.dispose();
      for (const mat of ownedMats) disposeIfOwned(mat);
      skyDome?.userData.dispose(); // V2/G19 (dome textures stay cached)
      updateHooks.clear(); // V2/G19
      // GLB clones share geometry/materials with the asset cache — not disposed.
      scene.remove(homeGroup);
      listeners.clear();
      anchors.clear();
    },
  };

  return manager;
}

/**
 * Kenney furniture GLBs have corner origins — recenter the footprint on x/z
 * and drop the bounding-box bottom onto y=0 so data tables can think in
 * "floor position of the piece's center".
 * @param {THREE.Object3D} model
 */
function groundAndCenter(model) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
}
