// Room manager (§C2, §D3): builds the 4 room shells side by side from the
// pure data tables in rooms/*.js, owns the camera pan between rooms, the
// wallpaper/floor CanvasTexture painters (§C5.2 ids), the anchor registry
// (`getAnchor`) and the fixed-interactable tap events.
//
// ── Integration surface (G5 care interactions / G6 sleep / G11 decor) ──────
//   rm.on('tap:fridge'|'tap:tv'|'tap:frontDoor'|'tap:toilet'|'tap:lampSwitch'
//         |'tap:wardrobe'|'tap:bathtub'|'tap:bed'|'tap:gooby', cb)
//       cb({ name, roomId, point:{x,y,z}, hit }) — hit is the raw raycast
//       intersection (for 'tap:gooby' pass it to gooby.regionAt(hit)).
//   rm.on('roomChanged', cb)        cb({ roomId, prevRoomId })
//   rm.getAnchor(name, roomId?)     → THREE.Vector3 (world) — names: goobyIdle
//       (per room), bed, bathtub, fridge, sofa, tv, frontDoor, toilet,
//       lampSwitch, wardrobe, ballSpawn, window, counter, sink, lamp, plus
//       every §C5.2 decor slot id (per room: sofa, rug, plant, …).
//   rm.setWallpaper(roomId, id)     ids: cream|mint|sky|peach|lavender|stars
//   rm.setFloor(roomId, id)        ids: wood|tile|carpet|checker
//   rm.setNightSky(on)              bedroom window override (G6 sleep)
//   rm.goTo(roomId, {instant})      0.35 s eased pan; rm.activeRoom()
//
// Room defs are PURE data (importable without three.js — test/rooms.test.js).

import * as THREE from 'three';
import { ROOMS, UI_COLORS } from '../data/constants.js';
import { now } from '../core/clock.js';
import { standardMat, disposeIfOwned } from '../gfx/materials.js';
import { ROOM as KITCHEN } from './rooms/kitchen.js';
import { ROOM as LIVING } from './rooms/living.js';
import { ROOM as BATHROOM } from './rooms/bathroom.js';
import { ROOM as BEDROOM } from './rooms/bedroom.js';

/**
 * @typedef {Object} RoomFurnitureEntry
 * @property {string} [item]      Kenney furniture-kit GLB name (auto-grounded)
 * @property {string} [proc]      procedural builder id: 'door'|'window'|'lampSwitch'
 * @property {string} [slot]      §C5.2 decor slot id (registers a slot anchor)
 * @property {Array<{item: string, at: number[], rotY?: number}>} [pieces] multi-piece slot (table set)
 * @property {Record<string, Array>} [piecesByItem] variant piece layouts (G11 decor swaps)
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
 * @property {Record<string, {default: string|null, items: readonly string[]}>} slots
 * @property {readonly RoomFurnitureEntry[]} furniture
 * @property {Record<string, readonly number[]>} anchors
 */

/** Ordered room defs (must match ROOMS.ORDER). */
export const ROOM_DEFS = Object.freeze([KITCHEN, LIVING, BATHROOM, BEDROOM]);

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

/** §C5.2 wallpaper colorways (id → painter config). */
const WALLPAPERS = Object.freeze({
  cream: { base: '#FBF3E4', motif: '#F1E4CC', style: 'dots' },
  mint: { base: '#DEF3E2', motif: '#C8E8CF', style: 'dots' },
  sky: { base: '#DBEEF9', motif: '#C2E1F2', style: 'clouds' },
  peach: { base: '#FFE7D4', motif: '#FFD6B8', style: 'dots' },
  lavender: { base: '#EAE1F6', motif: '#DACBEE', style: 'dots' },
  stars: { base: '#3A4374', motif: '#FFE9A8', style: 'stars' },
});

/** §C5.2 floor materials (id → painter config). */
const FLOORS = Object.freeze({
  wood: { base: '#C9995F', motif: '#B58450', style: 'planks' },
  tile: { base: '#F0EDE2', motif: '#DCD6C6', style: 'tiles' },
  carpet: { base: '#E9C9D4', motif: '#E0BCC9', style: 'stipple' },
  checker: { base: '#F2E7D3', motif: '#A7D8CF', style: 'checker' },
});

export const WALLPAPER_IDS = Object.freeze(Object.keys(WALLPAPERS));
export const FLOOR_IDS = Object.freeze(Object.keys(FLOORS));

/**
 * Global scale applied to every furniture-kit GLB: the kit is authored around
 * 0.4–1.2 u pieces; ×1.55 puts counters at ~0.70 m and the fridge at ~1.43 m
 * so Gooby (1.05 u) reads as a chubby hip-high pet next to them. Per-entry
 * `scale` in the room tables multiplies on top.
 */
export const FURNITURE_SCALE = 1.55;

/** All GLB asset keys the default home composition needs (preload list). */
export const HOME_ASSET_KEYS = Object.freeze([
  ...new Set(
    ROOM_DEFS.flatMap((def) =>
      def.furniture.flatMap((f) => {
        const items = [];
        if (f.pieces) items.push(...f.pieces.map((p) => p.item));
        else if (f.item) items.push(f.item);
        return items;
      })
    )
  ),
].map((item) => `furniture-kit/${item}`));

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

const PROC_BUILDERS = { door: buildDoor, window: buildWindow, lampSwitch: buildLampSwitch };

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
  /** @type {THREE.Object3D|null} Gooby's group (raycast for 'tap:gooby') */
  let goobyTarget = null;

  /** per-room build records */
  const rooms = new Map();

  const raycaster = new THREE.Raycaster();
  const homeGroup = new THREE.Group();
  homeGroup.name = 'home';
  scene.add(homeGroup);

  const roomCenterX = (roomId) => ROOMS.ORDER.indexOf(roomId) * SHELL.SPACING;

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
        if (!entry.item && !entry.pieces) continue; // empty slot (wall art)
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
          const model = assets.getModel(`furniture-kit/${piece.item}`);
          model.scale.setScalar(FURNITURE_SCALE);
          groundAndCenter(model);
          const pieceHolder = new THREE.Group();
          pieceHolder.position.set(piece.at[0], piece.at[1], piece.at[2]);
          pieceHolder.rotation.y = ((piece.rotY ?? 0) * Math.PI) / 180;
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
    applyWallpaper(def.id, store?.get(`decor.wallpaper.${def.id}`) ?? 'cream');
    applyFloor(def.id, store?.get(`decor.floor.${def.id}`) ?? 'wood');
  }

  function applyWallpaper(roomId, id) {
    const record = rooms.get(roomId);
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
  const CAM_OFFSET = Object.freeze({ y: 2.4, z: 7.2 });
  const LOOK_AT = Object.freeze({ y: 1.05, z: -0.5 });

  let activeId = ROOMS.DEFAULT;
  let camX = roomCenterX(activeId);
  let panFrom = camX;
  let panTo = camX;
  let panT = 1; // normalized progress; 1 = settled

  function placeCamera(x) {
    camera.position.set(x, CAM_OFFSET.y, CAM_OFFSET.z);
    camera.lookAt(x, LOOK_AT.y, LOOK_AT.z);
  }
  placeCamera(camX);

  /** Only the active room ±1 neighbour is rendered (draw-call budget §E10). */
  function refreshVisibility() {
    const activeIdx = ROOMS.ORDER.indexOf(activeId);
    for (const [roomId, record] of rooms) {
      const idx = ROOMS.ORDER.indexOf(roomId);
      record.group.visible = Math.abs(idx - activeIdx) <= 1;
    }
  }
  refreshVisibility();

  // --- day/night window sky (§C2: sky = day/night by device clock) ----------
  const SKY_COLORS = Object.freeze({
    day: new THREE.Color('#AEE0F7'),
    dawn: new THREE.Color('#FFD9A3'),
    dusk: new THREE.Color('#FFB98A'),
    night: new THREE.Color('#273057'),
  });
  let nightSkyOverride = false;
  let skyTimer = 0;

  function skyColorNow() {
    if (nightSkyOverride) return SKY_COLORS.night;
    const h = new Date(now()).getHours();
    if (h >= 6 && h < 8) return SKY_COLORS.dawn;
    if (h >= 8 && h < 18) return SKY_COLORS.day;
    if (h >= 18 && h < 20) return SKY_COLORS.dusk;
    return SKY_COLORS.night;
  }

  function refreshSky() {
    const color = skyColorNow();
    for (const record of rooms.values()) {
      record.windowSkyMat?.color.copy(color);
    }
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
      const prev = activeId;
      activeId = roomId;
      panFrom = camX;
      panTo = roomCenterX(roomId);
      panT = opts.instant ? 1 : 0;
      if (opts.instant) {
        camX = panTo;
        placeCamera(camX);
        refreshVisibility();
      } else {
        // both old and new neighbourhoods stay visible during the pan
        for (const [rid, record] of rooms) {
          const idx = ROOMS.ORDER.indexOf(rid);
          const ai = ROOMS.ORDER.indexOf(activeId);
          const pi = ROOMS.ORDER.indexOf(prev);
          record.group.visible = Math.abs(idx - ai) <= 1 || Math.abs(idx - pi) <= 1;
        }
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
      const hit = raycaster.intersectObjects(hitboxes, false)[0];
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
        placeCamera(camX);
        if (panT >= 1) refreshVisibility();
      }
      skyTimer -= dt;
      if (skyTimer <= 0) {
        skyTimer = 30;
        refreshSky();
      }
    },

    /** Free every geometry/material this manager created (shared mats stay). */
    dispose() {
      for (const geo of ownedGeos) geo.dispose();
      for (const mat of ownedMats) disposeIfOwned(mat);
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
