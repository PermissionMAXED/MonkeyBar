// Unified pointer input (§E5): pointer-events only (mouse + touch), gesture
// classification (tap/drag/swipe/hold) and a raycast pick helper. Scenes get a
// scoped emitter from the scene manager so their subscriptions are removed on
// exit automatically. Thresholds from data/constants.js.

import * as THREE from 'three';
import { ENGINE } from '../data/constants.js';

/**
 * @typedef {Object} PointerPayload
 * @property {number} x   client px
 * @property {number} y   client px
 * @property {number} nx  normalized device coord −1..1 (for raycasting)
 * @property {number} ny  normalized device coord −1..1, +1 = top
 * @property {number} [dx] delta px since last drag event
 * @property {number} [dy] delta px since last drag event
 * @property {number} [vx] velocity px/s
 * @property {number} [vy] velocity px/s
 * @property {'left'|'right'|'up'|'down'} [dir] swipe direction
 */

/** @typedef {'tap'|'dragstart'|'drag'|'dragend'|'swipe'|'hold'} InputEvent */

/**
 * Create the input manager bound to the WebGL canvas. Listeners are attached
 * to the canvas element, so DOM overlays (screens/panels) naturally block
 * canvas input while open (§E6).
 * @param {HTMLCanvasElement} canvas
 */
export function createInput(canvas) {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  const raycaster = new THREE.Raycaster();

  let active = false;
  let dragging = false;
  let startX = 0, startY = 0, startT = 0;
  let lastX = 0, lastY = 0, lastT = 0;
  let vx = 0, vy = 0;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let holdTimer = null;

  function payload(x, y, extra = {}) {
    const w = typeof innerWidth !== 'undefined' ? innerWidth : 1;
    const h = typeof innerHeight !== 'undefined' ? innerHeight : 1;
    return { x, y, nx: (x / w) * 2 - 1, ny: -(y / h) * 2 + 1, ...extra };
  }

  function emit(event, data) {
    for (const cb of listeners.get(event) ?? []) {
      try {
        cb(data);
      } catch (err) {
        console.error(`[input] listener error for '${event}':`, err);
      }
    }
  }

  function clearHold() {
    if (holdTimer != null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  function onDown(e) {
    if (!e.isPrimary) return;
    active = true;
    dragging = false;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    startT = lastT = performance.now();
    vx = vy = 0;
    try {
      canvas.setPointerCapture?.(e.pointerId);
    } catch { /* synthetic events (tests) have no active pointer */ }
    clearHold();
    holdTimer = setTimeout(() => {
      if (active && !dragging) emit('hold', payload(lastX, lastY));
    }, ENGINE.HOLD_MS);
  }

  function onMove(e) {
    if (!active || !e.isPrimary) return;
    const t = performance.now();
    const dt = Math.max(1, t - lastT) / 1000;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    vx = dx / dt;
    vy = dy / dt;
    const totalDist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!dragging && totalDist > ENGINE.TAP_MAX_PX) {
      dragging = true;
      clearHold();
      emit('dragstart', payload(startX, startY));
    }
    if (dragging) {
      emit('drag', payload(e.clientX, e.clientY, { dx, dy, vx, vy }));
    }
    lastX = e.clientX;
    lastY = e.clientY;
    lastT = t;
  }

  function onUp(e) {
    if (!active || !e.isPrimary) return;
    active = false;
    clearHold();
    const t = performance.now();
    const durMs = t - startT;
    const totX = e.clientX - startX;
    const totY = e.clientY - startY;
    const dist = Math.hypot(totX, totY);
    const speed = dist / Math.max(1, durMs) * 1000; // px/s over the whole gesture
    if (dragging) {
      emit('dragend', payload(e.clientX, e.clientY, { vx, vy }));
      // Swipe: > 60 px and > 500 px/s (§E5), dominant axis picks the direction.
      if (dist > ENGINE.SWIPE_MIN_PX && speed > ENGINE.SWIPE_MIN_VEL) {
        const dir = Math.abs(totX) >= Math.abs(totY) ? (totX > 0 ? 'right' : 'left') : (totY > 0 ? 'down' : 'up');
        emit('swipe', payload(e.clientX, e.clientY, { dx: totX, dy: totY, vx, vy, dir }));
      }
    } else if (durMs <= ENGINE.TAP_MAX_MS && dist <= ENGINE.TAP_MAX_PX) {
      emit('tap', payload(e.clientX, e.clientY));
    }
    dragging = false;
  }

  function onCancel() {
    if (dragging) emit('dragend', payload(lastX, lastY, { vx, vy }));
    active = false;
    dragging = false;
    clearHold();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  const api = {
    /**
     * Subscribe to a gesture event.
     * @param {InputEvent} event
     * @param {(p: PointerPayload) => void} cb
     * @returns {() => void} unsubscribe
     */
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => api.off(event, cb);
    },

    /** @param {InputEvent} event @param {Function} cb */
    off(event, cb) {
      listeners.get(event)?.delete(cb);
    },

    /**
     * Raycast pick helper (§E5).
     * @param {import('three').Camera} camera
     * @param {import('three').Object3D[]} objects
     * @param {{nx: number, ny: number}} ndc from a gesture payload
     * @returns {import('three').Intersection|null} nearest hit or null
     */
    pick(camera, objects, ndc) {
      raycaster.setFromCamera(new THREE.Vector2(ndc.nx, ndc.ny), camera);
      const hits = raycaster.intersectObjects(objects, true);
      return hits.length > 0 ? hits[0] : null;
    },

    /**
     * Scoped emitter for scene lifecycles (§E5): same API, but removeAll()
     * detaches every subscription made through it. The scene manager calls
     * removeAll() on scene exit.
     */
    scoped() {
      /** @type {Array<[string, Function]>} */
      const subs = [];
      return {
        on(event, cb) {
          subs.push([event, cb]);
          return api.on(event, cb);
        },
        off(event, cb) {
          api.off(event, cb);
          const i = subs.findIndex(([e, c]) => e === event && c === cb);
          if (i >= 0) subs.splice(i, 1);
        },
        pick: api.pick,
        removeAll() {
          for (const [event, cb] of subs) api.off(event, cb);
          subs.length = 0;
        },
      };
    },
  };

  return api;
}
