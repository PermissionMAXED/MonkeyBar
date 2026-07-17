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
import { ROOMS, DAYNIGHT } from '../data/constants.js'; // V2/G26: + DAYNIGHT (§C10.2)
import { now } from '../core/clock.js';
import { currentMood } from '../systems/sleep.js';
import { createGooby } from '../character/gooby.js';
import { createEmotionMachine } from '../character/emotions.js';
import { createParticles } from '../gfx/particles.js';
import { createHomeLights } from '../gfx/lights.js';
import { createRoomManager } from './roomManager.js';
import { createRoomNav } from '../ui/roomNav.js';
// V2/G26 (§C10/§C11): band/weather ambience — engines + animated weather FX
import { bandAt } from '../systems/dayNight.js';
import { weatherAt } from '../systems/weather.js';
import { mountGardenRain, mountGardenClouds, updateWeatherFx } from '../gfx/weatherFx.js';

export { HOME_ASSET_KEYS } from './roomManager.js';

/** Backdrop behind/around the room shells (warm pastel, §D5 vibes). */
const BACKDROP_DAY = '#F3DFC8';
const BACKDROP_NIGHT = '#232A44';

// --- V2/G26 (§C10.2): backdrop tone per band × weather -----------------------
// The scene.background peeks around the room shells; it follows the band
// (sleep night-mode still forces BACKDROP_NIGHT — §B3 override wins) and
// darkens slightly under cloud/rain like the garden grass tint does.
const BACKDROP_BAND = Object.freeze({
  day: BACKDROP_DAY,
  dawn: '#F6E4CB',
  dusk: '#DEBBAE',
  night: BACKDROP_NIGHT,
});
const BACKDROP_WEATHER_MULT = Object.freeze({ clear: 1, cloudy: 0.93, rain: 0.86 });
/** Pre-mixed backdrop colors (band:weather → THREE.Color, no per-frame alloc). */
const BACKDROP_COLORS = (() => {
  const map = new Map();
  for (const [band, hex] of Object.entries(BACKDROP_BAND)) {
    for (const [wx, mult] of Object.entries(BACKDROP_WEATHER_MULT)) {
      map.set(`${band}:${wx}`, new THREE.Color(hex).multiplyScalar(mult));
    }
  }
  map.set('sleep', new THREE.Color(BACKDROP_NIGHT));
  return map;
})();

/** §C10.3: night yawns every 45 ± 15 s (while awake, outside sleep mode). */
const NIGHT_YAWN_BASE_SEC = 45;
const NIGHT_YAWN_JITTER_SEC = 15;
/** §C10.3: night eyelid bias. */
const NIGHT_LIDS_BIAS = 0.3;
/** §C10.2 lamp table value (0.5) × the §D4 physical point-light scale (14). */
const LAMP_PHYS_SCALE = 14;
// --- end V2/G26 ---------------------------------------------------------------

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
  // day/night background blend (V2/G26: target follows the band table now)
  let night = false;

  // --- V2/G26: ambience state (§C10/§C11) -----------------------------------
  /** last applied band/weather (mirrors rm.getAmbience once rm exists) */
  const amb = { band: 'day', weather: 'clear' };
  /** @type {ReturnType<typeof createEmotionMachine>|null} for setNightBias */
  let ambMachine = null;
  /** dusk/night auto-on lamps (§C10.2: living + bedroom, #FFD9A0 × 0.5) */
  /** @type {THREE.PointLight[]} */
  const ambLamps = [];
  /** @type {ReturnType<typeof mountGardenRain>|null} */
  let rainFx = null;
  /** @type {ReturnType<typeof mountGardenClouds>|null} */
  let cloudFx = null;
  /** §C10.3 night yawn countdown (0 = timer off) */
  let yawnIn = 0;
  /** §C11.2: Gooby is parked under the garden tree canopy during rain */
  let canopySitting = false;
  /** canopy set an emotion context we must clear on release */
  let canopyContext = false;

  const nextYawnIn = () =>
    NIGHT_YAWN_BASE_SEC + (Math.random() * 2 - 1) * NIGHT_YAWN_JITTER_SEC;

  /** night band + actually awake (sleep mode/state overrides — §C10.3) */
  function isNightAwake() {
    return amb.band === 'night' && !night && !store.get('sleep')?.sleeping;
  }

  /**
   * Apply the current band/weather everywhere: light rig, room manager
   * (window skies + garden dome/grass), backdrop target, lamps, weather FX,
   * ambient loops and Gooby's night presentation (§C10.2/§C10.3/§C11.2).
   * Runs on 'dayBandChanged'/'weatherChanged'/'sleepChanged', on room switch
   * and once at enter() (instant).
   * @param {{instant?: boolean}} [opts]
   */
  function applyAmbienceNow(opts = {}) {
    const ms = now();
    const bandInfo = bandAt(ms);
    const wx = weatherAt(ms);
    amb.band = bandInfo.band;
    amb.weather = wx.state;

    lights.applyAmbience({ band: amb.band, weather: amb.weather, blend: bandInfo.blend, instant: opts.instant });
    rm?.setAmbience({ band: amb.band, weather: amb.weather, blend: bandInfo.blend });
    if (opts.instant) scene.background.copy(backdropTarget());

    // §C10.2: warm lamps auto-on at dusk/night (sleep mode has its own lamp)
    const lampsOn = !!DAYNIGHT[amb.band]?.lampsOn && !night;
    for (const l of ambLamps) {
      l.visible = lampsOn;
      l.intensity = lampsOn ? (DAYNIGHT[amb.band].lampIntensity ?? 0.5) * LAMP_PHYS_SCALE : 0;
    }

    // §C11.2 weather FX fade in/out with their state
    rainFx?.setActive(amb.weather === 'rain');
    cloudFx?.setActive(amb.weather === 'cloudy');

    refreshAmbientAudio();

    // §C10.3 night presentation (no stat effect)
    const nightAwake = isNightAwake();
    gooby?.setLidsBias(nightAwake ? NIGHT_LIDS_BIAS : 0);
    ambMachine?.setNightBias(nightAwake);
    if (nightAwake && yawnIn <= 0) yawnIn = nextYawnIn();
    if (!nightAwake) yawnIn = 0;
  }

  /** @returns {THREE.Color} the shared pre-mixed backdrop color target */
  function backdropTarget() {
    return (night ? BACKDROP_COLORS.get('sleep') : BACKDROP_COLORS.get(`${amb.band}:${amb.weather}`))
      ?? BACKDROP_COLORS.get('day:clear');
  }

  /** Rain loop + dawn birdsong live in the garden only (§C11.2/§C10.2). */
  function refreshAmbientAudio() {
    const inGarden = rm?.activeRoom() === 'garden';
    if (amb.weather === 'rain' && inGarden) ctx.audio?.play?.('ambience.rain');
    else ctx.audio?.stop?.('ambience.rain');
    if (amb.band === 'dawn' && inGarden && !night) ctx.audio?.play?.('ambience.birdsong');
    else ctx.audio?.stop?.('ambience.birdsong');
  }

  /**
   * §C11.2: while it rains and the garden is the active room, Gooby contently
   * sits under the tree canopy (pure coziness). Checked per-frame (cheap) so
   * it engages after the room-hop lands and releases when the rain block or
   * the room changes.
   */
  function refreshCanopy() {
    const want = amb.weather === 'rain'
      && rm?.activeRoom() === 'garden'
      && !rm.isPanning() && hopTimer <= 0
      && !!gooby && !store.get('sleep')?.sleeping;
    if (want && !canopySitting) {
      const at = rm.getAnchor('canopySit', 'garden');
      if (!at) return;
      canopySitting = true;
      gooby.group.position.copy(at);
      gooby.group.rotation.y = 0.3; // angled out from under the tree
      gooby.play('sitDrive'); // seated pose, holds until stop()
      if (ambMachine && ambMachine.getContext() == null) {
        ambMachine.setContext('happy'); // "contently"
        canopyContext = true;
      }
    } else if (!want && canopySitting) {
      canopySitting = false;
      gooby.stop('sitDrive');
      gooby.group.rotation.y = 0;
      if (canopyContext) {
        canopyContext = false;
        if (ambMachine?.getContext() === 'happy') ambMachine.setContext(null);
      }
      // rain ended while still gardening → back to the idle spot
      if (rm?.activeRoom() === 'garden' && !rm.isPanning()) placeGooby('garden');
    }
  }
  // --- end V2/G26 -------------------------------------------------------------

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
      applyAmbienceNow(); // V2/G26: lamps/backdrop/§C10.3 flags re-evaluate
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

      // --- V2/G26: ambience wiring (§C10.2/§C11.2) --------------------------
      // Warm dusk/night lamps (§C10.2: living + bedroom, #FFD9A0 0.5): the
      // living light sits at the floor-lamp decor spot, the bedroom one over
      // the nightstand lamp anchor. Off until applyAmbienceNow enables them.
      const lampSpecs = [
        { x: rm.roomCenterX('living') - 1.82, y: 1.42, z: -1.36 },
        lampAt ? { x: lampAt.x, y: lampAt.y + 0.35, z: lampAt.z + 0.25 } : null,
      ];
      for (const at of lampSpecs) {
        if (!at) continue;
        const l = new THREE.PointLight(DAYNIGHT.dusk.lampColor, 0, 4.5, 2);
        l.name = 'ambienceLamp';
        l.visible = false;
        l.position.set(at.x, at.y, at.z);
        scene.add(l);
        ambLamps.push(l);
      }
      // Garden weather FX (both ONE draw call each, invisible while inactive)
      const gardenGroup = rm.getRoomGroup('garden');
      if (gardenGroup) {
        rainFx = mountGardenRain(gardenGroup);
        cloudFx = mountGardenClouds(gardenGroup);
      }
      // --- end V2/G26 --------------------------------------------------------

      // --- emotion follows the store mood (§C1 bands via emotions.js) ---
      const machine = createEmotionMachine();
      machine.onChange((id) => gooby.setEmotion(id));
      refreshEmotionInputs(machine);
      // V2/G20: sick mood cap 39 (§C3.4) — health state feeds the machine
      machine.setHealth?.(store.get('health.state'));
      subs.push(store.on('healthChanged', (h) => machine.setHealth?.(h?.state)));
      // end V2/G20
      gooby.setEmotion(machine.get());
      ambMachine = machine; // V2/G26: night sleepy-tie bias hook (§C10.3)
      subs.push(store.on('statsChanged', () => refreshEmotionInputs(machine)));
      // sleep transitions set/clear grumpyUntil without touching stats — refresh
      // so the §C1.4 grumpy face shows immediately after an early wake.
      subs.push(store.on('sleepChanged', (sleep) => {
        refreshEmotionInputs(machine);
        // F6 (RE4): the sleep flow poses the 'sleepy' face DIRECTLY on the rig
        // (bypassing the machine), so onChange won't fire when the mood band
        // is unchanged across the nap — force-apply the machine's emotion on
        // wake so the sleepy face can never stick.
        if (!sleep?.sleeping) gooby.setEmotion(machine.get());
      }));

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

      // --- V2/G26: ambience event wiring (§B4) -------------------------------
      // G20's 60 s timeEngine ticker emits these on band/weather changes (and
      // once at boot); room switches re-apply (garden-only audio/FX), and
      // sleep transitions re-evaluate the §C10.3 night-awake presentation.
      subs.push(store.on('dayBandChanged', () => applyAmbienceNow()));
      subs.push(store.on('weatherChanged', () => applyAmbienceNow()));
      subs.push(rm.on('roomChanged', () => applyAmbienceNow()));
      subs.push(store.on('sleepChanged', () => applyAmbienceNow()));
      applyAmbienceNow({ instant: true }); // first paint: no crossfade pop
      // --- end V2/G26 ---------------------------------------------------------

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
      updateWeatherFx(dt); // V2/G26 (§C11.2): rain/clouds/window streaks

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

        // V2/G26 (§C10.3): night yawns every 45±15 s while awake + idle
        if (yawnIn > 0) {
          yawnIn -= dt;
          if (yawnIn <= 0) {
            yawnIn = nextYawnIn();
            if (isNightAwake() && gooby.isPlaying('idle') && !canopySitting) {
              gooby.play('wake'); // stretch + big yawn clip (§D2.4)
              ctx.audio?.play?.('gooby.yawn');
            }
          }
        }
        // V2/G26 (§C11.2): garden-rain canopy sit engages/releases here
        refreshCanopy();
      }

      // backdrop follows the band table + sleep night mode (V2/G26 §C10.2)
      scene.background.lerp(backdropTarget(), Math.min(1, dt * 3));

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
      // V2/G26: ambient loops are home-scoped — stop them when leaving
      ctx.audio?.stop?.('ambience.rain');
      ctx.audio?.stop?.('ambience.birdsong');
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
      // V2/G26: weather FX + ambience lamps
      rainFx?.dispose();
      rainFx = null;
      cloudFx?.dispose();
      cloudFx = null;
      for (const l of ambLamps) {
        scene.remove(l);
        l.dispose();
      }
      ambLamps.length = 0;
      ambMachine = null;
      // end V2/G26
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
