// Home decor (§C5.2 — agent G11): applies the saved decor state to the 3D
// home and owns decorate mode.
//
// 3D application — on home-scene (re)build and on every store 'decorChanged':
//   · wallpaper/floor per room via G4's roomManager setWallpaper/setFloor
//   · furniture GLB swaps inside the roomManager slot holders (multi-piece
//     sets use the room defs' piecesByItem layouts)
//   · procedural pieces built in code: the framed wall-art canvases
//     (sunset / carrot / abstract + V2/G22 skyline / rainbow), the mini-Gooby
//     doll plushie, and the V2/G22 §C8.3 garden pieces (benches, gnomes,
//     birdbath, dirt path)
//
// V2/G22 (PLAN2 §C8): new indoor slots (ceilingFan/sideboard/bar/washer/
// sideTable/floorClutter) work through the same slot pipeline; the ceiling
// fan hangs from its anchor (mount:'ceiling'); garden items resolve
// pack-qualified GLBs (entry.glb / cluster), get §C8.3 tints (blossom tree,
// rose bed) and render as soon as G19's garden RoomDef is in ROOM_DEFS —
// placement/persistence works beforehand via the catalog fallback in
// systems/furniturePlacement.js.
//
// Decorate mode: long-press anywhere in a room (ENGINE.HOLD_MS on the canvas)
// or the shop's "place now" → the 'decorate' bottom sheet: pick a slot of the
// room, then apply any owned variant (placement rules/persistence live in
// systems/furniturePlacement.js — this module is the 3D/UI side).
//
// The room manager is recreated on every home-scene enter, so a small poll
// re-detects the live instance and re-applies (same guarded pattern as
// systems/shopTrip.js's front-door hook). Browser-only module (three.js) —
// only ever loaded via dynamic import (ui/shopScreen.js).

import * as THREE from 'three';
import { ENGINE, ROOMS } from '../data/constants.js';
import { t } from '../data/strings.js';
// V2/G22: + roomSlots (garden fallback); V2/FIX-C: + rewardSlots (§C6 decos)
import { getEntry, roomSlots, rewardSlots } from '../data/furniture.js';
import {
  place,
  placedItem,
  slotDefault,
  slotOptions,
} from '../systems/furniturePlacement.js';
import { getCamera, getGooby, getRoomManager } from './homeScene.js';
import { ROOM_DEFS, FURNITURE_SCALE } from './roomManager.js';
import { standardMat, goobyMat, disposeIfOwned, PALETTE } from '../gfx/materials.js';
import { SLOT_EMOJI, furnEmoji } from '../ui/shopScreen.js';
import { icon } from '../ui/icons.js';
import * as assets from '../core/assets.js';

let wired = false;

/**
 * Boot the decor system (idempotent). Called from ui/shopScreen.js.
 * @param {{store: object, ui: object, audio: object}} deps
 */
export function initDecor({ store, ui, audio }) {
  if (wired) return;
  wired = true;

  ui.registerPanel('decorate', createDecoratePanel({ store, ui, audio }));

  // ------------------------------------------------------------- 3D apply
  /** @type {object|null} live roomManager instance */
  let rm = null;
  /** slot state the CURRENT rm instance shows: 'roomId:slotId' → itemId */
  let applied = new Map();
  /** disposal records per slot key: geometries/materials/textures we created */
  let built = new Map();
  /**
   * Holders WE created for slots the roomManager starts empty (wallArt):
   * 'roomId:slotId' → THREE.Group. Reused across re-applies — creating a fresh
   * holder per apply would leave the old one (with its disposed meshes)
   * parented in the scene → unbounded scene-graph growth + the renderer
   * re-uploading disposed GPU resources.
   */
  let createdHolders = new Map();
  /** serialized apply runs (GLB preloads are async) */
  let applying = Promise.resolve();

  function disposeBuilt(key) {
    const rec = built.get(key);
    if (!rec) return;
    for (const g of rec.geos) g.dispose();
    for (const m of rec.mats) disposeIfOwned(m);
    for (const tx of rec.textures) tx.dispose();
    built.delete(key);
  }

  /**
   * V2/FIX-C: all decor slot ids of a room — the RoomDef slot table PLUS the
   * catalog-only reward slots (§C6 set decos have no room-def entry; their
   * anchors live in REWARD_SLOT_SPOTS below).
   * @param {{id: string, slots: object}} def @returns {string[]}
   */
  const allSlotIds = (def) => {
    const base = Object.keys(def.slots);
    return [...base, ...rewardSlots(def.id).filter((s) => !base.includes(s))];
  };

  function resetForInstance(nextRm) {
    for (const key of [...built.keys()]) disposeBuilt(key); // old scene is gone
    createdHolders = new Map(); // holders belonged to the old scene graph
    applied = new Map();
    for (const def of ROOM_DEFS) {
      for (const slotId of allSlotIds(def)) {
        // a fresh roomManager always builds the free defaults (§C5.2)
        applied.set(`${def.id}:${slotId}`, slotDefault(def.id, slotId));
      }
    }
    rm = nextRm;
  }

  async function applyAll() {
    if (!rm) return;
    const target = rm;
    for (const def of ROOM_DEFS) {
      if (rm !== target) return; // scene switched mid-apply
      // V2/G22: outdoor rooms (G19's garden) have no wallpaper/floor decor
      if (!def.outdoor) {
        rm.setWallpaper(def.id, store.get(`decor.wallpaper.${def.id}`) ?? 'cream');
        rm.setFloor(def.id, store.get(`decor.floor.${def.id}`) ?? 'wood');
      }
      for (const slotId of allSlotIds(def)) {
        await applySlot(def, slotId).catch((err) =>
          console.warn(`[decor] slot ${def.id}:${slotId} apply failed:`, err)
        );
      }
    }
  }

  const scheduleApply = () => {
    applying = applying.then(applyAll);
  };

  async function applySlot(def, slotId) {
    const roomId = def.id;
    const key = `${roomId}:${slotId}`;
    const itemId = placedItem(store, roomId, slotId);
    if (applied.get(key) === itemId) return;
    applied.set(key, itemId);

    const defEntry = def.furniture.find((f) => f.slot === slotId);
    // Reuse any holder we created earlier for this slot (wallArt) — never
    // stack a fresh holder next to the old one (§E1 dispose discipline).
    let holder = rm.getSlotHolder(roomId, slotId) ?? createdHolders.get(key) ?? null;
    if (holder && holder.parent == null) holder = null; // stale (scene rebuilt)
    if (!holder) {
      holder = createSlotHolder(roomId, slotId, defEntry);
      if (holder) createdHolders.set(key, holder);
    }
    if (!holder) return;

    // clear previous contents + our owned GPU resources (GLB clones share
    // geometry/materials with the asset cache — removal is enough for those)
    disposeBuilt(key);
    for (const child of [...holder.children]) holder.remove(child);
    if (itemId == null) return; // wallArt back to empty

    const rec = { geos: [], mats: [], textures: [] };
    built.set(key, rec);
    const track = {
      geo(g) {
        rec.geos.push(g);
        return g;
      },
      mat(m) {
        rec.mats.push(m);
        return m;
      },
      tex(tx) {
        rec.textures.push(tx);
        return tx;
      },
    };

    const entry = getEntry(itemId); // V2/G22: catalog row drives glb/mount/tint
    if (entry?.procedural) {
      const proc = buildProcedural(itemId, track);
      if (rm.getSlotHolder(roomId, slotId) !== holder && holder.parent == null) return;
      holder.add(proc);
    } else {
      // piece layout: variant table from the room def, else the catalog's
      // V2/G22 cluster scatter (garden flower beds), else a single piece
      const pieces =
        defEntry?.piecesByItem?.[itemId] ??
        (defEntry?.item === itemId && defEntry?.pieces ? defEntry.pieces : null) ??
        entry?.cluster ??
        [{ item: itemId, at: [0, 0, 0], rotY: 0 }];
      // V2/G22: garden entries resolve to pack-qualified keys ('nature-kit/…')
      // via entry.glb / cluster piece.glb; room-def piece names stay short
      // furniture-kit GLB names.
      const keyOf = (p) =>
        p.glb ?? (p.item === itemId && entry?.glb ? entry.glb : `furniture-kit/${p.item}`);
      await assets.preload(pieces.map(keyOf)); // cached after the first load
      if (rm.getSlotHolder(roomId, slotId) !== holder && holder.parent == null) return;
      for (const piece of pieces) {
        const model = assets.getModel(keyOf(piece));
        model.scale.setScalar(FURNITURE_SCALE);
        // V2/G22: ceiling-mounted items (fan) hang from the anchor instead
        if (entry?.mount === 'ceiling') hangAndCenter(model);
        else groundAndCenter(model);
        if (entry?.tint) tintModel(model, entry.tint, entry.tintTarget, track); // V2/G22
        const pieceHolder = new THREE.Group();
        pieceHolder.position.set(piece.at[0], piece.at[1], piece.at[2]);
        pieceHolder.rotation.y = ((piece.rotY ?? 0) * Math.PI) / 180;
        if (piece.scale != null) pieceHolder.scale.setScalar(piece.scale);
        pieceHolder.add(model);
        holder.add(pieceHolder);
      }
    }
    holder.traverse((obj) => {
      if (obj.isMesh) obj.castShadow = !defEntry?.noShadow;
    });
  }

  /**
   * The wallArt slot starts empty, so the roomManager never made a holder for
   * it — create one at the room-def position inside the live room group.
   * V2/FIX-C: reward slots (§C6 decos) have no room-def entry at all — their
   * anchors come from the REWARD_SLOT_SPOTS table instead.
   */
  function createSlotHolder(roomId, slotId, defEntry) {
    const spot = defEntry ?? REWARD_SLOT_SPOTS[`${roomId}:${slotId}`]; // V2/FIX-C
    if (!spot) return null;
    const def = ROOM_DEFS.find((d) => d.id === roomId);
    const sibling = Object.keys(def.slots)
      .map((s) => rm.getSlotHolder(roomId, s))
      .find(Boolean);
    const roomGroup = sibling?.parent;
    if (!roomGroup) return null;
    const holder = new THREE.Group();
    holder.name = `slot-${slotId}`;
    holder.position.set(spot.at[0], spot.at[1], spot.at[2]);
    holder.rotation.y = ((spot.rotY ?? 0) * Math.PI) / 180;
    roomGroup.add(holder);
    return holder;
  }

  // poll for the live room manager (recreated on every home enter — §E1)
  setInterval(() => {
    const next = getRoomManager();
    if (next !== rm) {
      resetForInstance(next);
      if (next) scheduleApply();
    }
  }, 400);

  store.on('decorChanged', scheduleApply);

  // ------------------------------------------------- long-press → decorate
  const canvas = typeof document !== 'undefined' ? document.getElementById('scene') : null;
  if (canvas) {
    const pickRay = new THREE.Raycaster();
    const pickNdc = new THREE.Vector2();
    /** Presses that start on Gooby are care gestures (§C3), never decorate. */
    const onGooby = (clientX, clientY) => {
      const gooby = getGooby();
      const camera = getCamera();
      if (!gooby?.group || !camera) return false;
      const w = typeof innerWidth !== 'undefined' ? innerWidth : 1;
      const h = typeof innerHeight !== 'undefined' ? innerHeight : 1;
      pickNdc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
      pickRay.setFromCamera(pickNdc, camera);
      return pickRay.intersectObject(gooby.group, true).length > 0;
    };
    let timer = null;
    let downAt = null;
    const cancel = () => {
      if (timer != null) clearTimeout(timer);
      timer = null;
      downAt = null;
    };
    /** Real-time settle (ms) inside the post-hold re-check window — long
     * enough for queued/in-flight cancel events to land under heavy jank. */
    const HOLD_SETTLE_MS = 120;
    canvas.addEventListener('pointerdown', (e) => {
      cancel();
      // Long-press must be a genuinely still hold on furniture/empty space —
      // slow pet strokes over Gooby must never open the decorate picker.
      if (onGooby(e.clientX, e.clientY)) return;
      downAt = { x: e.clientX, y: e.clientY, path: 0, at: performance.now() };
      const gesture = downAt;
      // F6 (RE1): under main-thread jank this timer can fire while a slow
      // flick's pointermove/pointerup cancels are still queued (renderer
      // input queue, or even still in flight from the browser process), so
      // cancel ORDERING is not trustworthy. Instead of deciding immediately,
      // run a settle window: a rendered frame (rAF-aligned input dispatches
      // before rAF callbacks), a short real-time settle for late-arriving
      // events, then one more frame. Only then re-check the LIVE gesture
      // state — same gesture token still down, cumulative path within the
      // tap budget, genuinely elapsed hold. A long-press opening ~150 ms
      // later is imperceptible; a picker popping mid-flick is the bug.
      timer = setTimeout(() => {
        timer = null;
        if (downAt !== gesture) return; // already released / superseded
        requestAnimationFrame(() => {
          if (downAt !== gesture) return; // cancelled by frame-1 input
          setTimeout(() => {
            if (downAt !== gesture) return; // cancelled during the settle
            requestAnimationFrame(() => {
              if (downAt !== gesture) return; // cancelled by frame-2 input
              if (gesture.path > ENGINE.TAP_MAX_PX) return; // drag/flick
              if (performance.now() - gesture.at < ENGINE.HOLD_MS) return; // too short
              const live = getRoomManager();
              if (!live) return; // only over the home scene
              // §C8.1: don't let the player wander off the scripted first-run
              // flow — no decorate mode while the tutorial overlay is active.
              if (!store.get('onboarding.done') && document.querySelector('.g14-ob')) return;
              downAt = null; // consume the gesture
              audio.play('ui.open');
              ui.openPanel('decorate', { roomId: live.activeRoom() });
            });
          }, HOLD_SETTLE_MS);
        });
      }, ENGINE.HOLD_MS + 60);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!downAt) return;
      // Cumulative path (not net displacement): a slow back-and-forth pet
      // stroke returns near its origin but is still a drag, not a hold.
      downAt.path += Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt.x = e.clientX;
      downAt.y = e.clientY;
      if (downAt.path > ENGINE.TAP_MAX_PX) cancel();
    });
    canvas.addEventListener('pointerup', cancel);
    canvas.addEventListener('pointercancel', cancel);
  }
}

// ---------------------------------------------------------------------------
// Decorate-mode slot picker (bottom sheet)
// ---------------------------------------------------------------------------

/** @param {{store: object, ui: object, audio: object}} deps */
function createDecoratePanel({ store, ui, audio }) {
  return {
    /**
     * @param {HTMLElement} el
     * @param {{roomId?: string, slotId?: string, onApplied?: () => void}} [params]
     */
    mount(el, params = {}) {
      // V2/G22: the garden (G19's 5th room) is not in ROOMS.ORDER — accept
      // any room the CATALOG knows decor slots for, so garden placement works
      // through the same picker (3D application activates once G19's room
      // def is in ROOM_DEFS).
      const known =
        ROOMS.ORDER.includes(params.roomId) || roomSlots(params.roomId ?? '').length > 0;
      const roomId = known ? params.roomId : ROOMS.DEFAULT;
      let slotId = params.slotId ?? null;
      const def = ROOM_DEFS.find((d) => d.id === roomId) ?? null;

      function render() {
        el.innerHTML = `
          <div class="decor-head">
            ${slotId ? `<button class="decor-back" aria-label="${t('ui.back')}">${icon('arrowLeft', 18)}</button>` : ''}
            <h2 class="decor-title">🎨 ${t('decor.title')} · ${slotId ? t(`slot.${slotId}`) : t(`room.${roomId}`)}</h2>
          </div>
          <div class="decor-sub">${slotId ? t('decor.shopHint') : t('decor.pickSlot')}</div>
          <div class="decor-grid"></div>`;
        el.querySelector('.decor-back')?.addEventListener('click', () => {
          audio.play('ui.tap');
          slotId = null;
          render();
        });
        const grid = el.querySelector('.decor-grid');
        if (!slotId) renderSlots(grid);
        else renderVariants(grid);
      }

      function renderSlots(grid) {
        // V2/G22: room-def slot order when available, catalog order otherwise.
        // V2/FIX-C: union in the reward-only slots (§C6 set decos live in
        // catalog-only slots the shop grid hides — the picker must offer
        // them). A reward slot only shows once its deco is actually owned
        // (claimed) — before that it would just be a locked 0c curiosity.
        const base = def ? Object.keys(def.slots) : roomSlots(roomId);
        const rewards = rewardSlots(roomId).filter(
          (s) => !base.includes(s) && slotOptions(store, roomId, s).some((o) => o.owned)
        );
        for (const s of [...base, ...rewards]) {
          const current = placedItem(store, roomId, s);
          const card = document.createElement('button');
          card.className = 'shop-card';
          card.innerHTML = `
            <span class="shop-emoji">${SLOT_EMOJI[s] ?? '🪑'}</span>
            <span class="shop-name">${t(`slot.${s}`)}</span>
            <span class="shop-state">${current ? t(getEntry(current)?.nameKey ?? '') : '—'}</span>`;
          card.addEventListener('click', () => {
            audio.play('ui.tap');
            slotId = s;
            render();
          });
          grid.appendChild(card);
        }
      }

      function renderVariants(grid) {
        for (const { entry, owned, placed } of slotOptions(store, roomId, slotId)) {
          const card = document.createElement('button');
          card.className = `shop-card${placed ? ' shop-card-sel' : ''}`;
          card.innerHTML = `
            <span class="shop-emoji">${furnEmoji(entry)}</span>
            <span class="shop-name">${t(entry.nameKey)}</span>
            ${placed
              ? `<span class="shop-state">✓ ${t('shop.placed')}</span>`
              : owned
                ? `<span class="shop-state">${t('shop.apply')}</span>`
                : `<span class="shop-price">${icon('coin', 13)}${entry.price} 🔒</span>`}`;
          card.addEventListener('click', () => {
            audio.play('ui.tap');
            if (placed) return;
            if (!owned) {
              ui.toast('decor.shopHint');
              return;
            }
            const res = place(store, entry.id, roomId, slotId);
            if (res.ok) {
              ui.toast('toast.placedItem', { name: t(entry.nameKey) });
              params.onApplied?.();
              render();
            }
          });
          grid.appendChild(card);
        }
      }

      render();
    },
    unmount() {},
  };
}

// ---------------------------------------------------------------------------
// Procedural pieces (§C5.2): framed wall-art canvases + mini-Gooby doll
// ---------------------------------------------------------------------------

/** @typedef {{geo: Function, mat: Function, tex: Function}} Track */

/** @param {string} itemId @param {Track} track */
function buildProcedural(itemId, track) {
  switch (itemId) {
    case 'proc:artSunset':
      return buildWallArt('sunset', track);
    case 'proc:artCarrot':
      return buildWallArt('carrot', track);
    case 'proc:artAbstract':
      return buildWallArt('abstract', track);
    case 'proc:miniGooby':
      return buildMiniGooby(track);
    // ---- V2/G22 (§C8.1): 2 new canvases ----
    case 'proc:artSkyline':
      return buildWallArt('skyline', track);
    case 'proc:artRainbow':
      return buildWallArt('rainbow', track);
    // ---- V2/G22 (§C8.3): garden decor ----
    case 'proc:benchWood':
      return buildGardenBench(track, { seat: '#9A6B47', legs: '#7A5238' });
    case 'proc:benchPastel':
      return buildGardenBench(track, { seat: '#8FD8CB', legs: '#FFB7D5' });
    case 'proc:gnome':
      return buildGnome(track, false);
    case 'proc:gnomeGold':
      return buildGnome(track, true);
    case 'proc:birdbath':
      return buildBirdbath(track);
    case 'proc:pathDirt':
      return buildDirtPath(track);
    // ---- V2/FIX-C (§C6): the 4 collection-set completion rewards ----
    case 'proc:goldfishBowl':
      return buildGoldfishBowl(track);
    case 'proc:goldenWateringCan':
      return buildGoldenWateringCan(track);
    case 'proc:toyCity':
      return buildToyCity(track);
    case 'proc:candyJar':
      return buildCandyJar(track);
    default: {
      // unknown procedural id: a friendly placeholder cube (never throws)
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.3, 0.3, 0.3)), standardMat('#FF7BA9')));
      return grp;
    }
  }
}

/** Paint one of the §C5.2 / V2/G22 §C8.1 art motifs onto a 2D canvas. */
function paintArt(variant, g, W, H) {
  if (variant === 'skyline') {
    // V2/G22 „City Skyline": night sky, moon, lit building silhouettes
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#232B52');
    sky.addColorStop(1, '#3A4374');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#FFF3C4';
    g.beginPath();
    g.arc(W * 0.78, H * 0.24, H * 0.1, 0, Math.PI * 2);
    g.fill();
    const buildings = [
      [0.02, 0.42, 0.14], [0.18, 0.3, 0.16], [0.36, 0.5, 0.12],
      [0.5, 0.24, 0.18], [0.7, 0.44, 0.13], [0.85, 0.34, 0.13],
    ];
    for (const [x, top, w] of buildings) {
      g.fillStyle = '#2A3260';
      g.fillRect(W * x, H * top, W * w, H * (1 - top));
      g.fillStyle = '#FFD166';
      for (let wy = top + 0.07; wy < 0.92; wy += 0.11) {
        for (let wx = x + 0.025; wx < x + w - 0.03; wx += 0.045) {
          if ((wx * 31 + wy * 17) % 0.13 < 0.07) g.fillRect(W * wx, H * wy, W * 0.02, H * 0.045);
        }
      }
    }
  } else if (variant === 'rainbow') {
    // V2/G22 „Rainbow": arcs over two puffy clouds
    g.fillStyle = '#DBEEF9';
    g.fillRect(0, 0, W, H);
    const cols = ['#E0655F', '#FF9F5A', '#FFD166', '#59C9B9', '#6EC6FF'];
    g.lineWidth = H * 0.055;
    for (let i = 0; i < cols.length; i += 1) {
      g.strokeStyle = cols[i];
      g.beginPath();
      g.arc(W / 2, H * 1.05, H * (0.82 - i * 0.06), Math.PI * 1.08, Math.PI * 1.92);
      g.stroke();
    }
    g.fillStyle = '#FFFFFF';
    for (const [cx, cy] of [[0.16, 0.72], [0.84, 0.72]]) {
      for (const [dx, dy, r] of [[-0.05, 0, 0.07], [0.05, 0, 0.07], [0, -0.045, 0.08], [0, 0.03, 0.075]]) {
        g.beginPath();
        g.arc(W * (cx + dx), H * (cy + dy), H * r, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (variant === 'sunset') {
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#FFD9A3');
    sky.addColorStop(0.62, '#FF9E7B');
    sky.addColorStop(1, '#C86B85');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#FFF3C4';
    g.beginPath();
    g.arc(W / 2, H * 0.58, H * 0.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#8A5A7A';
    g.beginPath();
    g.moveTo(0, H);
    g.lineTo(0, H * 0.78);
    g.quadraticCurveTo(W * 0.3, H * 0.6, W * 0.55, H * 0.82);
    g.quadraticCurveTo(W * 0.78, H * 0.68, W, H * 0.8);
    g.lineTo(W, H);
    g.fill();
  } else if (variant === 'carrot') {
    g.fillStyle = '#DEF3E2';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(0.5);
    g.fillStyle = '#FF9F5A';
    g.beginPath();
    g.moveTo(-W * 0.05, -H * 0.28);
    g.quadraticCurveTo(W * 0.16, -H * 0.1, 0, H * 0.34);
    g.quadraticCurveTo(-W * 0.16, -H * 0.1, W * 0.05, -H * 0.28);
    g.fill();
    g.fillStyle = '#59C9B9';
    for (const a of [-0.5, 0, 0.5]) {
      g.beginPath();
      g.ellipse(a * W * 0.08, -H * 0.34, W * 0.035, H * 0.1, a * 0.5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  } else {
    g.fillStyle = '#FBF3E4';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#FF7BA9';
    g.beginPath();
    g.arc(W * 0.32, H * 0.4, H * 0.22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#59C9B9';
    g.fillRect(W * 0.52, H * 0.22, W * 0.3, H * 0.3);
    g.fillStyle = '#FFD166';
    g.beginPath();
    g.moveTo(W * 0.2, H * 0.85);
    g.lineTo(W * 0.5, H * 0.55);
    g.lineTo(W * 0.8, H * 0.85);
    g.fill();
    g.strokeStyle = '#4A3B36';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(W * 0.12, H * 0.7);
    g.quadraticCurveTo(W * 0.5, H * 0.9, W * 0.88, H * 0.62);
    g.stroke();
  }
}

/**
 * A framed canvas print for the living-room wallArt slot (§C5.2). The slot
 * anchor sits on the back wall (z ≈ −1.47) — the art faces the camera (+z).
 * @param {'sunset'|'carrot'|'abstract'|'skyline'|'rainbow'} variant @param {Track} track
 */
function buildWallArt(variant, track) {
  const grp = new THREE.Group();
  grp.name = `wallArt-${variant}`;

  const W = 256;
  const H = 192;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  paintArt(variant, canvas.getContext('2d'), W, H);
  const tex = track.tex(new THREE.CanvasTexture(canvas));
  tex.colorSpace = THREE.SRGBColorSpace;

  const frame = new THREE.Mesh(
    track.geo(new THREE.BoxGeometry(0.92, 0.7, 0.05)),
    standardMat('#FFFDF4', { roughness: 0.8 })
  );
  const art = new THREE.Mesh(
    track.geo(new THREE.PlaneGeometry(0.8, 0.58)),
    track.mat(new THREE.MeshBasicMaterial({ map: tex }))
  );
  art.position.z = 0.03;
  grp.add(frame, art);
  return grp;
}

/**
 * Mini-Gooby doll plushie (§C5.2, 600c): a palm-sized fabric copy of the fat
 * rabbit — bulbous body, floppy ears, stitched face — built from the §D2.1
 * palette so it reads instantly as "little Gooby".
 * @param {Track} track
 */
function buildMiniGooby(track) {
  const grp = new THREE.Group();
  grp.name = 'miniGooby';
  const body = goobyMat('body');
  const belly = goobyMat('belly');
  const earIn = goobyMat('earInner');
  const eye = goobyMat('eye');

  const torso = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.16, 20, 16)), body);
  torso.position.y = 0.15;
  torso.scale.set(1, 1.12, 0.94);

  const tummy = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.115, 18, 14)), belly);
  tummy.position.set(0, 0.13, 0.065);
  tummy.scale.set(0.86, 0.95, 0.62);

  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.052, 12, 10)), body);
    ear.position.set(sx * 0.075, 0.36, -0.01);
    ear.scale.set(0.62, 2.1, 0.55);
    ear.rotation.z = sx * -0.28;
    const inner = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.028, 10, 8)), earIn);
    inner.position.set(sx * 0.078, 0.365, 0.022);
    inner.scale.set(0.5, 1.7, 0.4);
    inner.rotation.z = sx * -0.28;
    grp.add(ear, inner);
  }

  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.017, 8, 8)), eye);
    e.position.set(sx * 0.055, 0.21, 0.135);
    grp.add(e);
    const paw = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.05, 10, 8)), body);
    paw.position.set(sx * 0.115, 0.045, 0.05);
    paw.scale.set(0.85, 0.6, 1.1);
    grp.add(paw);
  }

  const nose = new THREE.Mesh(
    track.geo(new THREE.SphereGeometry(0.014, 8, 8)),
    standardMat(PALETTE.NOSE, { roughness: 0.55 })
  );
  nose.position.set(0, 0.185, 0.145);
  grp.add(torso, tummy, nose);
  return grp;
}

// ---------------------------------------------------------------------------
// V2/G22 (§C8.3): procedural garden pieces — benches, gnomes, birdbath, path
// ---------------------------------------------------------------------------

/**
 * Garden bench: 2 chunky legs + seat + backrest slats. The pastel variant is
 * the same build with painted colors (§C8.3).
 * @param {Track} track @param {{seat: string, legs: string}} colors
 */
function buildGardenBench(track, colors) {
  const grp = new THREE.Group();
  grp.name = 'gardenBench';
  const seatMat = standardMat(colors.seat, { roughness: 0.85 });
  const legMat = standardMat(colors.legs, { roughness: 0.85 });
  const legGeo = track.geo(new THREE.BoxGeometry(0.09, 0.24, 0.34));
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(sx * 0.38, 0.12, 0);
    grp.add(leg);
  }
  const slatGeo = track.geo(new THREE.BoxGeometry(0.92, 0.035, 0.13));
  for (const dz of [-0.11, 0.045]) {
    const slat = new THREE.Mesh(slatGeo, seatMat);
    slat.position.set(0, 0.255, dz);
    grp.add(slat);
  }
  const backGeo = track.geo(new THREE.BoxGeometry(0.92, 0.09, 0.035));
  for (const dy of [0.4, 0.53]) {
    const back = new THREE.Mesh(backGeo, seatMat);
    back.position.set(0, dy, -0.185);
    back.rotation.x = -0.14;
    grp.add(back);
  }
  const postGeo = track.geo(new THREE.BoxGeometry(0.07, 0.36, 0.05));
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, legMat);
    post.position.set(sx * 0.38, 0.42, -0.17);
    post.rotation.x = -0.14;
    grp.add(post);
  }
  return grp;
}

/**
 * Garden gnome (§C8.3): pointy hat, round body, white beard — the golden
 * variant swaps every material for metallic gold (endgame flex).
 * @param {Track} track @param {boolean} golden
 */
function buildGnome(track, golden) {
  const grp = new THREE.Group();
  grp.name = golden ? 'gnomeGold' : 'gnome';
  const gold = standardMat('#E8C24A', { roughness: 0.35, metalness: 0.6 });
  const mat = (color, opts) => (golden ? gold : standardMat(color, opts));
  const body = new THREE.Mesh(track.geo(new THREE.ConeGeometry(0.13, 0.26, 14)), mat('#5B7DB8', { roughness: 0.7 }));
  body.position.y = 0.13;
  const head = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.075, 14, 10)), mat('#F2C9A0', { roughness: 0.7 }));
  head.position.set(0, 0.29, 0.01);
  const beard = new THREE.Mesh(
    track.geo(new THREE.SphereGeometry(0.062, 12, 8, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65)),
    mat('#F4F0E6', { roughness: 0.9 })
  );
  beard.position.set(0, 0.275, 0.045);
  beard.scale.set(1, 1.25, 0.8);
  const hat = new THREE.Mesh(track.geo(new THREE.ConeGeometry(0.085, 0.24, 12)), mat('#E0655F', { roughness: 0.65 }));
  hat.position.set(0, 0.42, 0);
  hat.rotation.x = 0.12;
  const nose = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.02, 8, 6)), mat('#E8A87C', { roughness: 0.6 }));
  nose.position.set(0, 0.3, 0.078);
  const feetGeo = track.geo(new THREE.SphereGeometry(0.035, 8, 6));
  for (const sx of [-1, 1]) {
    const foot = new THREE.Mesh(feetGeo, mat('#4A3B36', { roughness: 0.8 }));
    foot.position.set(sx * 0.055, 0.02, 0.09);
    foot.scale.set(1, 0.55, 1.4);
    grp.add(foot);
  }
  grp.add(body, head, beard, hat, nose);
  return grp;
}

/** Birdbath 240 (§C8.3): stone pedestal + basin + still water disc. */
function buildBirdbath(track) {
  const grp = new THREE.Group();
  grp.name = 'birdbath';
  const stone = standardMat('#C9C4BA', { roughness: 0.9 });
  const base = new THREE.Mesh(track.geo(new THREE.CylinderGeometry(0.16, 0.2, 0.07, 16)), stone);
  base.position.y = 0.035;
  const column = new THREE.Mesh(track.geo(new THREE.CylinderGeometry(0.055, 0.075, 0.34, 12)), stone);
  column.position.y = 0.24;
  const basin = new THREE.Mesh(track.geo(new THREE.CylinderGeometry(0.24, 0.14, 0.09, 18)), stone);
  basin.position.y = 0.45;
  const water = new THREE.Mesh(
    track.geo(new THREE.CylinderGeometry(0.205, 0.205, 0.02, 18)),
    standardMat('#A9DCF2', { roughness: 0.15 })
  );
  water.position.y = 0.485;
  grp.add(base, column, basin, water);
  return grp;
}

// ---------------------------------------------------------------------------
// V2/FIX-C (§C6): collection-set reward decos — placement anchors + builders
// ---------------------------------------------------------------------------

/**
 * Placement anchors for the reward-only slots (§C6 decos). These slots have
 * no room-def entry (rooms/*.js are frozen wave-1 files), so createSlotHolder
 * reads this table instead. Spots were picked clear of the fixed
 * interactables and existing decor slots of each room.
 * @type {Record<string, {at: readonly number[], rotY?: number}>}
 */
const REWARD_SLOT_SPOTS = Object.freeze({
  // fish set: goldfish bowl on the living-room coffee table (top ≈ y 0.37),
  // right of the set-dressing book stack at x −0.9
  'living:fishBowl': Object.freeze({ at: Object.freeze([-0.5, 0.37, 0.28]), rotY: -15 }),
  // veggies set: golden watering can displayed by the tool stump (x 1.35) —
  // a trophy next to the everyday tin can
  'garden:gardenTrophy': Object.freeze({ at: Object.freeze([1.95, 0, 0.7]), rotY: -30 }),
  // landmarks set: toy city on the bedroom floor between bed foot and rug
  'bedroom:toyCorner': Object.freeze({ at: Object.freeze([-0.55, 0, 1.05]), rotY: 15 }),
  // treats set: candy jar on the kitchen counter top (y 0.71) between the
  // drawer unit and the sink, clear of the appliance slot at x −0.62
  'kitchen:candyShelf': Object.freeze({ at: Object.freeze([-0.35, 0.71, -1.02]), rotY: 0 }),
});

/**
 * Goldfish bowl (fish-set reward): glass sphere + water fill + sand base +
 * a chunky orange goldfish mid-swim (§C6 „cute, small, distinct").
 * @param {Track} track
 */
function buildGoldfishBowl(track) {
  const grp = new THREE.Group();
  grp.name = 'goldfishBowl';
  const glass = new THREE.Mesh(
    track.geo(new THREE.SphereGeometry(0.115, 18, 14, 0, Math.PI * 2, Math.PI * 0.14)),
    track.mat(new THREE.MeshStandardMaterial({
      color: '#DFF2FB', roughness: 0.08, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
    }))
  );
  glass.position.y = 0.115;
  const water = new THREE.Mesh(
    track.geo(new THREE.SphereGeometry(0.104, 16, 12, 0, Math.PI * 2, Math.PI * 0.3)),
    track.mat(new THREE.MeshStandardMaterial({
      color: '#A9DCF2', roughness: 0.15, transparent: true, opacity: 0.55,
    }))
  );
  water.position.y = 0.115;
  const sand = new THREE.Mesh(
    track.geo(new THREE.SphereGeometry(0.095, 14, 6, 0, Math.PI * 2, Math.PI * 0.72)),
    standardMat('#EAD9A8', { roughness: 0.95 })
  );
  sand.position.y = 0.115;
  // the resident: body + tail fin + eye dots
  const orange = standardMat('#FF9F5A', { roughness: 0.6 });
  const body = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.034, 12, 10)), orange);
  body.scale.set(1.35, 1, 0.8);
  body.position.set(0.012, 0.125, 0);
  body.rotation.y = 0.6;
  const tail = new THREE.Mesh(track.geo(new THREE.ConeGeometry(0.02, 0.036, 8)), orange);
  tail.position.set(-0.038, 0.125, -0.025);
  tail.rotation.z = Math.PI / 2;
  tail.rotation.y = 0.6;
  const eyeMat = standardMat('#4A3B36', { roughness: 0.4 });
  const eye = new THREE.Mesh(track.geo(new THREE.SphereGeometry(0.006, 6, 6)), eyeMat);
  eye.position.set(0.052, 0.132, 0.022);
  grp.add(glass, water, sand, body, tail, eye);
  return grp;
}

/**
 * Golden watering can (veggies-set reward): the garden tool-can shape
 * (roomManager buildWateringCan) re-built in trophy gold on a little plinth.
 * @param {Track} track
 */
function buildGoldenWateringCan(track) {
  const grp = new THREE.Group();
  grp.name = 'goldenWateringCan';
  const gold = standardMat('#E8C24A', { roughness: 0.3, metalness: 0.65 });
  const plinth = new THREE.Mesh(
    track.geo(new THREE.CylinderGeometry(0.2, 0.24, 0.1, 14)),
    standardMat('#C9C4BA', { roughness: 0.9 })
  );
  plinth.position.y = 0.05;
  grp.add(plinth);
  const can = new THREE.Group();
  can.position.y = 0.1;
  const body = new THREE.Mesh(track.geo(new THREE.CylinderGeometry(0.13, 0.15, 0.24, 12)), gold);
  body.position.y = 0.12;
  can.add(body);
  const spout = new THREE.Mesh(track.geo(new THREE.CylinderGeometry(0.025, 0.035, 0.28, 8)), gold);
  spout.position.set(0.19, 0.19, 0);
  spout.rotation.z = Math.PI / 2.6;
  can.add(spout);
  const rose = new THREE.Mesh(track.geo(new THREE.CylinderGeometry(0.05, 0.03, 0.04, 10)), gold);
  rose.position.set(0.3, 0.26, 0);
  rose.rotation.z = Math.PI / 2.6;
  can.add(rose);
  const handleTop = new THREE.Mesh(track.geo(new THREE.TorusGeometry(0.08, 0.016, 8, 14, Math.PI)), gold);
  handleTop.position.set(-0.02, 0.24, 0);
  can.add(handleTop);
  const handleBack = new THREE.Mesh(track.geo(new THREE.TorusGeometry(0.09, 0.016, 8, 14, Math.PI)), gold);
  handleBack.position.set(-0.14, 0.13, 0);
  handleBack.rotation.z = Math.PI / 2;
  can.add(handleBack);
  grp.add(can);
  return grp;
}

/**
 * Toy city (landmarks-set reward): a palm-sized skyline of pastel block
 * towers on a green base plate, tiny road across.
 * @param {Track} track
 */
function buildToyCity(track) {
  const grp = new THREE.Group();
  grp.name = 'toyCity';
  const plate = new THREE.Mesh(
    track.geo(new THREE.BoxGeometry(0.52, 0.03, 0.4)),
    standardMat('#9FD8A4', { roughness: 0.9 })
  );
  plate.position.y = 0.015;
  grp.add(plate);
  const road = new THREE.Mesh(
    track.geo(new THREE.BoxGeometry(0.52, 0.006, 0.07)),
    standardMat('#8B8B93', { roughness: 0.95 })
  );
  road.position.set(0, 0.033, 0.06);
  grp.add(road);
  // towers: [x, z, w, h, color] — tallest in back like a real skyline
  const towers = [
    [-0.18, -0.1, 0.1, 0.24, '#6EC6FF'],
    [-0.05, -0.13, 0.09, 0.32, '#FF9E7B'],
    [0.09, -0.09, 0.11, 0.2, '#FFD166'],
    [0.2, -0.13, 0.08, 0.27, '#B39DDB'],
    [-0.16, 0.13, 0.09, 0.12, '#59C9B9'],
    [0.16, 0.13, 0.1, 0.15, '#FF7BA9'],
  ];
  for (const [x, z, w, h, color] of towers) {
    const tower = new THREE.Mesh(
      track.geo(new THREE.BoxGeometry(w, h, w)),
      standardMat(color, { roughness: 0.7 })
    );
    tower.position.set(x, 0.03 + h / 2, z);
    grp.add(tower);
  }
  // the sky-tower landmark: a thin spire with a ball top, city centerpiece
  const spire = new THREE.Mesh(
    track.geo(new THREE.ConeGeometry(0.028, 0.14, 8)),
    standardMat('#F4F0E6', { roughness: 0.6 })
  );
  spire.position.set(0.02, 0.35, -0.12);
  const ball = new THREE.Mesh(
    track.geo(new THREE.SphereGeometry(0.016, 8, 8)),
    standardMat('#FFD166', { roughness: 0.4, metalness: 0.3 })
  );
  ball.position.set(0.02, 0.43, -0.12);
  const spireBase = new THREE.Mesh(
    track.geo(new THREE.BoxGeometry(0.09, 0.25, 0.09)),
    standardMat('#DCD6C6', { roughness: 0.7 })
  );
  spireBase.position.set(0.02, 0.155, -0.12);
  grp.add(spireBase, spire, ball);
  return grp;
}

/**
 * Candy jar (treats-set reward): glass jar stuffed with candy balls under a
 * cherry-red lid — kitchen counter eye-candy.
 * @param {Track} track
 */
function buildCandyJar(track) {
  const grp = new THREE.Group();
  grp.name = 'candyJar';
  const jar = new THREE.Mesh(
    track.geo(new THREE.CylinderGeometry(0.085, 0.075, 0.17, 14, 1, true)),
    track.mat(new THREE.MeshStandardMaterial({
      color: '#EAF6FC', roughness: 0.08, transparent: true, opacity: 0.32, side: THREE.DoubleSide,
    }))
  );
  jar.position.y = 0.085;
  const bottom = new THREE.Mesh(
    track.geo(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 14)),
    track.mat(new THREE.MeshStandardMaterial({
      color: '#EAF6FC', roughness: 0.08, transparent: true, opacity: 0.4,
    }))
  );
  bottom.position.y = 0.006;
  const lid = new THREE.Mesh(
    track.geo(new THREE.CylinderGeometry(0.09, 0.09, 0.035, 14)),
    standardMat('#E0655F', { roughness: 0.5 })
  );
  lid.position.y = 0.19;
  const knob = new THREE.Mesh(
    track.geo(new THREE.SphereGeometry(0.022, 10, 8)),
    standardMat('#FFD166', { roughness: 0.4, metalness: 0.3 })
  );
  knob.position.y = 0.22;
  grp.add(jar, bottom, lid, knob);
  // candy fill: layered pastel balls (deterministic layout — no Math.random)
  const candyCols = ['#FF7BA9', '#FFD166', '#59C9B9', '#B39DDB', '#FF9E7B'];
  const ballGeo = track.geo(new THREE.SphereGeometry(0.021, 8, 8));
  let i = 0;
  for (let layer = 0; layer < 3; layer += 1) {
    const y = 0.028 + layer * 0.038;
    const r = 0.048 - layer * 0.006;
    const n = 6 - layer;
    for (let k = 0; k < n; k += 1) {
      const a = (k / n) * Math.PI * 2 + layer * 0.7;
      const ballMesh = new THREE.Mesh(ballGeo, standardMat(candyCols[i % candyCols.length], { roughness: 0.35 }));
      ballMesh.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      grp.add(ballMesh);
      i += 1;
    }
  }
  return grp;
}

/** Free dirt path (§C8.3): 3 flattened earth patches in a walking line. */
function buildDirtPath(track) {
  const grp = new THREE.Group();
  grp.name = 'pathDirt';
  const dirt = standardMat('#8A6844', { roughness: 1 });
  const patchGeo = track.geo(new THREE.CylinderGeometry(0.17, 0.19, 0.025, 10));
  for (const [x, z, s] of [[-0.32, 0.05, 1], [0, -0.06, 0.9], [0.32, 0.04, 1.05]]) {
    const patch = new THREE.Mesh(patchGeo, dirt);
    patch.position.set(x, 0.012, z);
    patch.scale.set(s, 1, s * 0.8);
    patch.rotation.y = x * 2;
    grp.add(patch);
  }
  return grp;
}

/**
 * Kenney furniture GLBs have corner origins — recenter the footprint on x/z
 * and drop the bounding-box bottom onto y=0 (mirrors roomManager's grounding
 * so swapped variants sit exactly where the defaults did).
 * @param {THREE.Object3D} model
 */
function groundAndCenter(model) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
}

/**
 * V2/G22: ceiling-mount grounding (§C8.1 fan) — center x/z but pull the
 * bounding-box TOP up to y=0 so the model hangs from the slot anchor.
 * @param {THREE.Object3D} model
 */
function hangAndCenter(model) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.max.y;
}

/**
 * V2/G22 (§C8.3): tint a GLB clone's materials — 'foliage' recolors the
 * green-dominant materials (blossom-tree canopy), 'bloom' recolors everything
 * else (rose-bed petals; leaves/stems stay green). Materials are cloned per
 * application (the asset cache's shared materials are never mutated) and
 * tracked for disposal on the next slot swap.
 * @param {THREE.Object3D} model @param {string} tintHex
 * @param {'foliage'|'bloom'|undefined} target @param {Track} track
 */
function tintModel(model, tintHex, target, track) {
  const tint = new THREE.Color(tintHex);
  const clones = new Map();
  model.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const swap = (m) => {
      if (!m?.color) return m;
      const { r, g, b } = m.color;
      const greenish = g > r * 1.05 && g > b * 1.05;
      if ((target === 'foliage') !== greenish) return m;
      if (!clones.has(m)) {
        const clone = m.clone();
        clone.userData.shared = false;
        clone.color.lerp(tint, 0.72);
        clones.set(m, track.mat(clone));
      }
      return clones.get(m);
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(swap) : swap(obj.material);
  });
}
