// Home decor (§C5.2 — agent G11): applies the saved decor state to the 3D
// home and owns decorate mode.
//
// 3D application — on home-scene (re)build and on every store 'decorChanged':
//   · wallpaper/floor per room via G4's roomManager setWallpaper/setFloor
//   · furniture GLB swaps inside the roomManager slot holders (multi-piece
//     sets use the room defs' piecesByItem layouts)
//   · procedural pieces built in code: the 3 framed wall-art canvases
//     (sunset / carrot / abstract) and the mini-Gooby doll plushie
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
import { getEntry } from '../data/furniture.js';
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

  function resetForInstance(nextRm) {
    for (const key of [...built.keys()]) disposeBuilt(key); // old scene is gone
    createdHolders = new Map(); // holders belonged to the old scene graph
    applied = new Map();
    for (const def of ROOM_DEFS) {
      for (const slotId of Object.keys(def.slots)) {
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
      rm.setWallpaper(def.id, store.get(`decor.wallpaper.${def.id}`) ?? 'cream');
      rm.setFloor(def.id, store.get(`decor.floor.${def.id}`) ?? 'wood');
      for (const slotId of Object.keys(def.slots)) {
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

    if (getEntry(itemId)?.procedural) {
      const proc = buildProcedural(itemId, track);
      if (rm.getSlotHolder(roomId, slotId) !== holder && holder.parent == null) return;
      holder.add(proc);
    } else {
      // piece layout: variant table from the room def, else a single piece
      const pieces =
        defEntry?.piecesByItem?.[itemId] ??
        (defEntry?.item === itemId && defEntry?.pieces ? defEntry.pieces : null) ??
        [{ item: itemId, at: [0, 0, 0], rotY: 0 }];
      const keys = pieces.map((p) => `furniture-kit/${p.item}`);
      await assets.preload(keys); // cached after the first load
      if (rm.getSlotHolder(roomId, slotId) !== holder && holder.parent == null) return;
      for (const piece of pieces) {
        const model = assets.getModel(`furniture-kit/${piece.item}`);
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
      if (obj.isMesh) obj.castShadow = !defEntry?.noShadow;
    });
  }

  /**
   * The wallArt slot starts empty, so the roomManager never made a holder for
   * it — create one at the room-def position inside the live room group.
   */
  function createSlotHolder(roomId, slotId, defEntry) {
    if (!defEntry) return null;
    const def = ROOM_DEFS.find((d) => d.id === roomId);
    const sibling = Object.keys(def.slots)
      .map((s) => rm.getSlotHolder(roomId, s))
      .find(Boolean);
    const roomGroup = sibling?.parent;
    if (!roomGroup) return null;
    const holder = new THREE.Group();
    holder.name = `slot-${slotId}`;
    holder.position.set(defEntry.at[0], defEntry.at[1], defEntry.at[2]);
    holder.rotation.y = ((defEntry.rotY ?? 0) * Math.PI) / 180;
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
      const roomId = ROOMS.ORDER.includes(params.roomId) ? params.roomId : ROOMS.DEFAULT;
      let slotId = params.slotId ?? null;
      const def = ROOM_DEFS.find((d) => d.id === roomId);

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
        for (const s of Object.keys(def.slots)) {
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
    default: {
      // unknown procedural id: a friendly placeholder cube (never throws)
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.3, 0.3, 0.3)), standardMat('#FF7BA9')));
      return grp;
    }
  }
}

/** Paint one of the 3 §C5.2 art motifs onto a 2D canvas. */
function paintArt(variant, g, W, H) {
  if (variant === 'sunset') {
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
 * @param {'sunset'|'carrot'|'abstract'} variant @param {Track} track
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
