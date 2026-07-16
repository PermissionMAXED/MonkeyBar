// Persistent home scene (§C2, §D3, §D4): the 4-room apartment, its lighting
// rig, room navigation and Gooby living in the active room. Registered as
// scene id 'home' in main.js with HOME_ASSET_KEYS preloaded.
//
// ── API for sibling agents (G5 interactions, G6 sleep, G11 decor) ──────────
// The §E1 lifecycle instance returned by createHomeScene ALSO carries:
//   getGooby()        → the live createGooby() rig (§D2.3 API) or null
//   getRoomManager()  → the live roomManager (events/anchors — see its JSDoc)
//   setNight(on)      → bedroom night mode (§D4 lighting lerp + window sky)
//   isNight()         → current night-mode target
//
// The same four functions are exported at module level and resolve to the
// currently active home scene instance (null/no-op when the home scene is not
// active), so G5/G6 can simply:
//
//   import { getGooby, getRoomManager, setNight } from '../home/homeScene.js';
//   getRoomManager()?.on('tap:fridge', ({ point }) => { … });
//
// Gooby taps: getRoomManager().on('tap:gooby', ({ hit }) => …) — pass `hit`
// to getGooby().regionAt(hit) for the touched region (head/belly/feet).

import * as THREE from 'three';
import { ROOMS } from '../data/constants.js';
import { now } from '../core/clock.js';
import { currentMood } from '../systems/sleep.js';
import { createGooby } from '../character/gooby.js';
import { createEmotionMachine } from '../character/emotions.js';
import { createParticles } from '../gfx/particles.js';
import { createHomeLights } from '../gfx/lights.js';
import { createRoomManager } from './roomManager.js';
import { createRoomNav } from '../ui/roomNav.js';

export { HOME_ASSET_KEYS } from './roomManager.js';

/** Backdrop behind/around the room shells (warm pastel, §D5 vibes). */
const BACKDROP_DAY = '#F3DFC8';
const BACKDROP_NIGHT = '#232A44';

/** @type {ReturnType<typeof createHomeScene>|null} live instance (module accessors) */
let activeInstance = null;

/** @returns {object|null} the live Gooby rig (§D2.3) — null outside the home scene */
export function getGooby() {
  return activeInstance?.getGooby() ?? null;
}

/** @returns {object|null} the live room manager — null outside the home scene */
export function getRoomManager() {
  return activeInstance?.getRoomManager() ?? null;
}

/** @returns {THREE.PerspectiveCamera|null} the live home camera — null outside the home scene */
export function getCamera() {
  return activeInstance?.camera ?? null;
}

/**
 * Toggle bedroom night mode (§D4). No-op outside the home scene.
 * @param {boolean} on
 */
export function setNight(on) {
  activeInstance?.setNight(on);
}

/** @returns {boolean} current night-mode target (false outside the home scene) */
export function isNight() {
  return activeInstance?.isNight() ?? false;
}

/**
 * §E1 scene factory for the persistent home.
 * @param {{renderer: THREE.WebGLRenderer, assets: object, input: object, audio: object, store: object, ui: object}} ctx
 */
export function createHomeScene(ctx) {
  const { renderer, assets, input, store, ui } = ctx;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKDROP_DAY);

  const camera = new THREE.PerspectiveCamera(ROOMS.CAMERA_FOV, innerWidth / innerHeight, 0.1, 60);

  // Single 1024 px shadow map lives in the home scene only (§D4/§E10).
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const lights = createHomeLights(scene);
  const particles = createParticles(scene);

  /** Built lazily in enter() — furniture GLBs must be preloaded first. */
  let rm = null;
  let gooby = null;
  let roomNav = null;

  // room-hop state (§C2: Gooby hops along on room change)
  let hopTimer = -1;
  // transient look-at release
  let lookTimer = 0;
  // day/night background blend
  const bgDay = new THREE.Color(BACKDROP_DAY);
  const bgNight = new THREE.Color(BACKDROP_NIGHT);
  let bgMix = 0;
  let night = false;

  /** @type {Array<() => void>} store/input unsubscribers */
  const subs = [];

  // dev draw-call readout (§E10 budget check: home ≤ 120 calls)
  /** @type {HTMLElement|null} */
  let debugEl = null;
  let debugTimer = 0;
  let debugLogged = false;

  function placeGooby(roomId) {
    const at = rm.getAnchor('goobyIdle', roomId);
    if (at) gooby.group.position.copy(at);
    gooby.group.rotation.y = 0; // face the camera
  }

  function refreshEmotionInputs(machine) {
    const state = store.get();
    machine.setStats(state.stats);
    // currentMood (systems/sleep.js) is the canonical mood reader: it applies
    // the §C1.4 early-wake grumpy debuff (−15 while grumpyUntil is active) and
    // clamps to the valid 0–100 range.
    machine.setMood(currentMood(state, now()));
  }

  const api = {
    scene,
    camera,

    // --- sibling integration surface (see module JSDoc) ---
    getGooby: () => gooby,
    getRoomManager: () => rm,

    /**
     * Bedroom night mode (§D4): lerp the lighting rig, warm lamp point light,
     * night window sky and backdrop. G6's sleep flow calls this.
     * @param {boolean} on
     */
    setNight(on) {
      night = !!on;
      lights.setNight(night);
      rm?.setNightSky(night);
    },

    /** @returns {boolean} */
    isNight: () => night,

    async enter(params = {}) {
      ctx.audio?.music?.('home'); // G14: lo-fi home loop (§D6; starts post-gesture)
      // --- build the rooms (models are preloaded by the scene manager) ---
      rm = createRoomManager({ scene, camera, assets, store });

      gooby = createGooby({ particles });
      // Real shadows in the home (§D4): Gooby casts, the blob shadow rests.
      gooby.group.traverse((obj) => {
        if (obj.isMesh && obj.name !== 'blobShadow') obj.castShadow = true;
        if (obj.name === 'blobShadow') obj.visible = false;
      });
      scene.add(gooby.group);
      rm.setGoobyTarget(gooby.group);

      const startRoom = ROOMS.ORDER.includes(params.room) ? params.room : ROOMS.DEFAULT;
      rm.goTo(startRoom, { instant: true });
      placeGooby(startRoom);
      lights.setFocus(rm.roomCenterX(startRoom));
      const lampAt = rm.getAnchor('lamp', 'bedroom');
      if (lampAt) lights.setLampPosition(lampAt);

      // --- emotion follows the store mood (§C1 bands via emotions.js) ---
      const machine = createEmotionMachine();
      machine.onChange((id) => gooby.setEmotion(id));
      refreshEmotionInputs(machine);
      gooby.setEmotion(machine.get());
      subs.push(store.on('statsChanged', () => refreshEmotionInputs(machine)));
      // sleep transitions set/clear grumpyUntil without touching stats — refresh
      // so the §C1.4 grumpy face shows immediately after an early wake.
      subs.push(store.on('sleepChanged', () => refreshEmotionInputs(machine)));

      // --- room navigation: arrows + dots (ui/roomNav.js) + swipe ---
      roomNav = createRoomNav({ onNavigate: (roomId) => api.goToRoom(roomId) });
      roomNav.mount(ui.el);
      roomNav.setActive(startRoom);
      subs.push(rm.on('roomChanged', ({ roomId }) => {
        roomNav.setActive(roomId);
        lights.setFocus(rm.roomCenterX(roomId));
        // Gooby hops along: hop out now, teleport mid-pan, land in the room.
        gooby.play('jump');
        hopTimer = ROOMS.PAN_SEC / 2;
      }));

      // Swipe on empty space pans rooms (§C2). Swipes that start on Gooby are
      // reserved for G5's pet/tickle gestures.
      let swipeBlocked = false;
      subs.push(input.on('dragstart', (p) => {
        swipeBlocked = !!input.pick(camera, [gooby.group], p);
      }));
      subs.push(input.on('swipe', (p) => {
        if (swipeBlocked || rm.isPanning()) return;
        if (p.dir !== 'left' && p.dir !== 'right') return;
        const idx = ROOMS.ORDER.indexOf(rm.activeRoom()) + (p.dir === 'left' ? 1 : -1);
        if (idx >= 0 && idx < ROOMS.ORDER.length) api.goToRoom(ROOMS.ORDER[idx]);
      }));

      // Taps → fixed-interactable events (G5/G6 subscribe via getRoomManager).
      subs.push(input.on('tap', (p) => {
        rm.handleTap(p);
        // Gooby is alive: he watches where you touched for a moment.
        const at = new THREE.Vector3(p.nx, p.ny, 0.5).unproject(camera);
        gooby.lookAt(at);
        lookTimer = 1.4;
      }));

      // dev-only corner draw-call readout (§E10: home budget ≤ 120)
      if (import.meta.env?.DEV) {
        debugEl = document.createElement('div');
        debugEl.style.cssText =
          'position:absolute;left:8px;top:calc(8px + env(safe-area-inset-top));z-index:50;' +
          'font:700 11px system-ui;color:#4A3B36;background:rgba(255,255,255,.6);' +
          'padding:2px 7px;border-radius:8px;pointer-events:none;';
        ui.el.appendChild(debugEl);
      }
    },

    /**
     * Pan to a room (0.35 s ease — §C2). Delegates to the room manager.
     * @param {string} roomId
     * @param {{instant?: boolean}} [opts]
     */
    goToRoom(roomId, opts = {}) {
      rm?.goTo(roomId, opts);
      if (opts.instant && rm && gooby) placeGooby(roomId);
    },

    update(dt) {
      rm?.update(dt);
      lights.update(dt);
      particles.update(dt);

      if (gooby) {
        gooby.update(dt);
        if (hopTimer > 0) {
          hopTimer -= dt;
          if (hopTimer <= 0) placeGooby(rm.activeRoom());
        }
        if (lookTimer > 0) {
          lookTimer -= dt;
          if (lookTimer <= 0) gooby.lookAt(null);
        }
      }

      // backdrop follows night mode
      const bgTarget = night ? 1 : 0;
      if (Math.abs(bgTarget - bgMix) > 0.002) {
        bgMix += (bgTarget - bgMix) * Math.min(1, dt * 3);
        scene.background.copy(bgDay).lerp(bgNight, bgMix);
      }

      if (debugEl) {
        debugTimer -= dt;
        if (debugTimer <= 0 && renderer.info.render.calls > 0) {
          debugTimer = 0.5;
          debugEl.textContent = `${renderer.info.render.calls} calls · ${Math.round(renderer.info.render.triangles / 1000)}k tris`;
          if (!debugLogged && renderer.info.render.calls > 0) {
            debugLogged = true;
            console.log(`[home] draw calls: ${renderer.info.render.calls}, triangles: ${renderer.info.render.triangles} (budget: 120 calls / 150k tris, §E10) @ ${new Date(now()).toISOString()}`);
          }
        }
      }
    },

    exit() {
      ctx.audio?.music?.(null); // G14: stop the home loop when leaving home
      roomNav?.unmount();
      roomNav = null;
      debugEl?.remove();
      debugEl = null;
      for (const unsub of subs) unsub();
      subs.length = 0;
    },

    dispose() {
      if (activeInstance === api) activeInstance = null;
      renderer.shadowMap.enabled = false; // shadows are home-only (§D4)
      gooby?.dispose();
      gooby = null;
      particles.dispose();
      rm?.dispose();
      rm = null;
      lights.dispose();
    },
  };

  activeInstance = api;
  return api;
}
