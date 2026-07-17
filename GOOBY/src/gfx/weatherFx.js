// V2/G26: Weather FX (§C11.2/§A2.3) — the ANIMATED weather layer on top of
// G19's static sky painters (gfx/sky.js):
//
//   mountGardenRain(group)   → instanced rain streaks + ground splash rings —
//       ONE draw call total (§A2.3: pool 300, instanced quads, GPU-animated
//       via a uTime uniform so the CPU cost is a single uniform write/frame).
//       Fades in/out over ~1 s; mesh.visible false when fully faded (zero
//       draw calls while it isn't raining).
//   mountGardenClouds(group) → soft cloud sprites drifting across the garden
//       dome while the weather is 'cloudy' (ONE InstancedMesh draw call).
//   windowRainTexture(band)  → shared ANIMATED CanvasTexture for the indoor
//       window panes during rain: streak trails + occasional droplet runs
//       painted over the static sky base (zero extra draw calls — it swaps
//       into the existing window-sky material via roomManager.setAmbience).
//   mountPondRipples(scene, opts) → cosmetic rain ripple rings for the
//       fishingPond water surface (§C11.2; ONE draw call, camera-facing
//       squashed rings).
//   updateWeatherFx(dt)      → drives every mounted garden effect + the
//       window texture (homeScene calls this from its update loop).
//
// Band/weather decisions live with the callers (homeScene subscribes to
// G20's 'dayBandChanged'/'weatherChanged' ticker events); this module only
// renders. All geometry is procedural — no assets, no textures beyond two
// tiny CanvasTextures.

import * as THREE from 'three';
import { WEATHER } from '../data/constants.js';
import { windowTexture } from './sky.js';

/** Rain/cloud tuning (§A2.3 pool 300 = streaks + splash rings, 1 draw call). */
export const WEATHER_FX = Object.freeze({
  /** Total instanced rain quads (§A2.3/§C11.2: pool 300). */
  RAIN_POOL: WEATHER.RAIN_POOL,
  /** Of the pool, how many are ground splash rings (§C11.2). */
  SPLASH_COUNT: 44,
  /** Rain fade in/out time constant (s). */
  FADE_SEC: 1.1,
  /** Garden rain volume half-extents + ceiling (room-local, §C2.1 5×4 m). */
  AREA_X: 2.45,
  AREA_Z: 1.95,
  TOP_Y: 4.6,
  /** Drifting cloud sprite count (cloudy — §C11.2). */
  CLOUD_COUNT: 8,
  /** Pond ripple ring instances (fishingPond §C11.2). */
  POND_RINGS: 26,
  /** Window rain canvas size / repaint interval (s). */
  WINDOW_SIZE: 128,
  WINDOW_REPAINT_SEC: 0.09,
});

/** @type {Set<{update: (dt: number) => void}>} handles updateWeatherFx drives */
const liveHandles = new Set();

// ---------------------------------------------------------------------------
// Shared rain shader (streaks kind=0 + flat splash rings kind=1)
// ---------------------------------------------------------------------------

const RAIN_VERT = /* glsl */ `
  attribute float aSeed;
  attribute float aKind;
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uArea; // x/z half-extents, y = fall ceiling
  varying vec2 vUv;
  varying float vKind;
  varying float vAlpha;
  float h(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  void main() {
    vUv = uv;
    vKind = aKind;
    vec3 p;
    if (aKind < 0.5) {
      // falling streak: seeded column, loops from the ceiling to the ground
      float x = (h(aSeed) * 2.0 - 1.0) * uArea.x;
      float z = (h(aSeed + 7.0) * 2.0 - 1.0) * uArea.z;
      float speed = 6.5 + h(aSeed + 13.0) * 3.5;
      float y = uArea.y - mod(uTime * speed + h(aSeed + 3.0) * uArea.y, uArea.y);
      // cylindrical billboard: offset along the camera-right axis
      vec3 right = vec3(modelViewMatrix[0][0], modelViewMatrix[1][0], modelViewMatrix[2][0]);
      p = vec3(x, y, z) + right * (position.x * 0.030) + vec3(0.0, position.y * 0.36, 0.0);
      vAlpha = uIntensity * (0.45 + h(aSeed + 5.0) * 0.55);
    } else {
      // ground splash ring: seeded spot, expanding + fading on its own phase
      float x = (h(aSeed + 21.0) * 2.0 - 1.0) * (uArea.x - 0.1);
      float z = (h(aSeed + 33.0) * 2.0 - 1.0) * (uArea.z - 0.1);
      float phase = fract(uTime * (0.9 + h(aSeed + 41.0) * 0.7) + h(aSeed + 47.0));
      float r = 0.045 + phase * 0.19;
      p = vec3(x + position.x * 2.0 * r, 0.025, z - position.y * 2.0 * r);
      vAlpha = uIntensity * (1.0 - phase) * 0.5;
    }
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

// Pond variant (§C11.2 fishingPond): rings only, camera-facing in the x/y
// plane, squashed vertically so they read as surface ripples side-on.
const POND_VERT = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uPond; // x = half-width, y = surface y, z = ring plane z
  varying vec2 vUv;
  varying float vKind;
  varying float vAlpha;
  float h(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  void main() {
    vUv = uv;
    vKind = 1.0;
    float x = (h(aSeed) * 2.0 - 1.0) * uPond.x;
    float phase = fract(uTime * (0.8 + h(aSeed + 41.0) * 0.6) + h(aSeed + 47.0));
    float r = 0.05 + phase * 0.34;
    vec3 p = vec3(x + position.x * 2.0 * r, uPond.y + position.y * 2.0 * r * 0.26, uPond.z);
    vAlpha = uIntensity * (1.0 - phase) * 0.75;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const RAIN_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying float vKind;
  varying float vAlpha;
  void main() {
    float a;
    if (vKind < 0.5) {
      // soft vertical streak, dimmer toward both ends
      float across = 1.0 - smoothstep(0.22, 0.5, abs(vUv.x - 0.5));
      float along = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
      a = across * (0.3 + 0.7 * along);
    } else {
      // thin ring band
      float d = length(vUv - 0.5) * 2.0;
      a = smoothstep(0.55, 0.8, d) * (1.0 - smoothstep(0.84, 1.0, d));
    }
    a *= vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(0.78, 0.86, 0.97, a);
  }
`;

/**
 * Instanced quad geometry with per-instance seed/kind attributes.
 * @param {number} count total instances
 * @param {number} splashFrom instances ≥ this index are splash rings (kind 1)
 * @returns {THREE.InstancedBufferGeometry}
 */
function makeInstancedQuads(count, splashFrom) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = count;
  const seeds = new Float32Array(count);
  const kinds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    seeds[i] = i + 1;
    kinds[i] = i >= splashFrom ? 1 : 0;
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
  return geo;
}

/**
 * @typedef {Object} WeatherFxHandle
 * @property {THREE.Mesh|THREE.InstancedMesh} mesh
 * @property {(on: boolean) => void} setActive fade the effect in/out
 * @property {() => boolean} isActive
 * @property {(dt: number) => void} update
 * @property {() => void} dispose
 */

/**
 * Garden rain (§C11.2): 300 instanced quads — falling streaks + ground splash
 * rings — as ONE mesh = ONE extra draw call while raining (§A2.3). Add to the
 * garden room group (room-local coordinates); visibility follows the group
 * plus the fade (invisible ⇒ zero draw calls).
 * @param {THREE.Group} group the garden room group (roomManager.getRoomGroup)
 * @returns {WeatherFxHandle}
 */
export function mountGardenRain(group) {
  const geo = makeInstancedQuads(WEATHER_FX.RAIN_POOL, WEATHER_FX.RAIN_POOL - WEATHER_FX.SPLASH_COUNT);
  const mat = new THREE.ShaderMaterial({
    vertexShader: RAIN_VERT,
    fragmentShader: RAIN_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      // uArea packs (halfX, ceilingY, halfZ) — see the vertex shader
      uArea: { value: new THREE.Vector3(WEATHER_FX.AREA_X, WEATHER_FX.TOP_Y, WEATHER_FX.AREA_Z) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'gardenRain';
  mesh.frustumCulled = false; // instances are positioned in the shader
  mesh.renderOrder = 12; // after the dome + room props
  mesh.visible = false;
  group.add(mesh);

  let target = 0;
  let cur = 0;
  const handle = {
    mesh,
    setActive(on) {
      target = on ? 1 : 0;
      if (on) mesh.visible = true;
    },
    isActive: () => target > 0,
    update(dt) {
      mat.uniforms.uTime.value += dt;
      if (cur !== target) {
        cur += Math.sign(target - cur) * Math.min(Math.abs(target - cur), dt / WEATHER_FX.FADE_SEC);
        mat.uniforms.uIntensity.value = cur;
        if (cur <= 0.004 && target === 0) mesh.visible = false;
      }
    },
    dispose() {
      liveHandles.delete(handle);
      group.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
  liveHandles.add(handle);
  return handle;
}

// ---------------------------------------------------------------------------
// Drifting clouds (cloudy — §C11.2)
// ---------------------------------------------------------------------------

/** @type {THREE.CanvasTexture|null} shared puffy-cloud sprite texture */
let cloudTex = null;
function getCloudTexture() {
  if (cloudTex) return cloudTex;
  const W = 128;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  // 4 overlapping radial puffs → one soft cloud
  for (const [cx, cy, r] of [[38, 40, 24], [62, 30, 28], [88, 40, 24], [60, 46, 30]]) {
    const grad = g.createRadialGradient(cx, cy, 2, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
  cloudTex = new THREE.CanvasTexture(canvas);
  cloudTex.colorSpace = THREE.SRGBColorSpace;
  return cloudTex;
}

/**
 * Soft cloud sprites drifting across the garden dome while cloudy (§C11.2).
 * ONE InstancedMesh = one draw call; matrices update on the CPU (8 clouds).
 * @param {THREE.Group} group the garden room group
 * @returns {WeatherFxHandle}
 */
export function mountGardenClouds(group) {
  const N = WEATHER_FX.CLOUD_COUNT;
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: getCloudTexture(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.name = 'gardenClouds';
  mesh.renderOrder = 2; // over the dome, under the rain
  mesh.frustumCulled = false;
  mesh.visible = false;
  group.add(mesh);

  // seeded drift lanes across the visible dome half (camera looks toward −z)
  const clouds = [];
  for (let i = 0; i < N; i += 1) {
    const j = (n) => (((i * 73 + n * 37) % 89) / 89);
    clouds.push({
      x: -9 + j(1) * 18,
      y: 3.0 + j(2) * 2.6,
      z: -8.2 + j(3) * 2.4,
      w: 2.4 + j(4) * 1.6,
      h: 1.1 + j(5) * 0.7,
      speed: 0.14 + j(6) * 0.18, // m/s drift (§C11.2 "soft ... drift")
    });
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const write = () => {
    for (let i = 0; i < N; i += 1) {
      const c = clouds[i];
      m.compose(new THREE.Vector3(c.x, c.y, c.z), q, new THREE.Vector3(c.w, c.h, 1));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  write();

  let target = 0;
  let cur = 0;
  const handle = {
    mesh,
    setActive(on) {
      target = on ? 1 : 0;
      if (on) mesh.visible = true;
    },
    isActive: () => target > 0,
    update(dt) {
      if (!mesh.visible) return;
      for (const c of clouds) {
        c.x += c.speed * dt;
        if (c.x > 9.5) c.x = -9.5; // wrap across the dome
      }
      write();
      if (cur !== target) {
        cur += Math.sign(target - cur) * Math.min(Math.abs(target - cur), dt / WEATHER_FX.FADE_SEC);
        mat.opacity = 0.9 * cur;
        if (cur <= 0.004 && target === 0) mesh.visible = false;
      }
    },
    dispose() {
      liveHandles.delete(handle);
      group.remove(mesh);
      geo.dispose();
      mat.dispose(); // cloudTex stays cached
    },
  };
  liveHandles.add(handle);
  return handle;
}

// ---------------------------------------------------------------------------
// Animated window rain texture (indoor rooms — §C11.2)
// ---------------------------------------------------------------------------

/**
 * @type {{canvas: HTMLCanvasElement, g: CanvasRenderingContext2D,
 *   tex: THREE.CanvasTexture, band: string, accum: number,
 *   streaks: Array<{x: number, y: number, v: number, len: number}>,
 *   runs: Array<{x: number, y: number, v: number, r: number}>}|null}
 */
let winRain = null;

/**
 * The shared animated rain-window texture (§C11.2: streak overlay +
 * occasional droplet runs painted over the band's static rain sky).
 * roomManager.setAmbience swaps it into the window-sky material while
 * raining; updateWeatherFx(dt) animates it. Cached singleton — never dispose.
 * @param {'day'|'dawn'|'dusk'|'night'} band
 * @returns {THREE.CanvasTexture}
 */
export function windowRainTexture(band) {
  const S = WEATHER_FX.WINDOW_SIZE;
  if (!winRain) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const g = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const rnd = Math.random;
    winRain = {
      canvas,
      g,
      tex,
      band: '',
      accum: 0,
      // fast diagonal streak trails
      streaks: Array.from({ length: 13 }, () => ({
        x: rnd() * S, y: rnd() * S, v: 55 + rnd() * 65, len: 9 + rnd() * 13,
      })),
      // slow fat droplet runs (the "occasional droplet run")
      runs: Array.from({ length: 3 }, () => ({
        x: rnd() * S, y: rnd() * S, v: 7 + rnd() * 9, r: 1.7 + rnd() * 1.2,
      })),
    };
  }
  if (winRain.band !== band) {
    winRain.band = band;
    paintWindowRain(0);
  }
  return winRain.tex;
}

/** Repaint the window-rain canvas advanced by `dt` seconds. */
function paintWindowRain(dt) {
  const S = WEATHER_FX.WINDOW_SIZE;
  const { g } = winRain;
  // static base: the band's rain sky from G19's painter (cached canvas)
  const base = windowTexture(winRain.band || 'day', 'rain');
  g.clearRect(0, 0, S, S);
  g.drawImage(base.image, 0, 0, S, S);
  // streak trails
  g.strokeStyle = 'rgba(228,241,255,0.55)';
  g.lineWidth = 1.4;
  g.lineCap = 'round';
  for (const s of winRain.streaks) {
    s.y += s.v * dt;
    if (s.y - s.len > S) {
      s.y = -4;
      s.x = Math.random() * S;
    }
    g.beginPath();
    g.moveTo(s.x + 1.5, s.y - s.len);
    g.lineTo(s.x, s.y);
    g.stroke();
  }
  // droplet runs: bead head + thin wobbly trail
  for (const r of winRain.runs) {
    r.y += r.v * dt;
    if (r.y > S + 4) {
      r.y = -4;
      r.x = Math.random() * S;
      r.v = 7 + Math.random() * 9;
    }
    g.strokeStyle = 'rgba(228,241,255,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(r.x + Math.sin(r.y * 0.2) * 1.5, Math.max(0, r.y - 14));
    g.lineTo(r.x, r.y);
    g.stroke();
    g.fillStyle = 'rgba(238,247,255,0.8)';
    g.beginPath();
    g.arc(r.x, r.y, r.r, 0, Math.PI * 2);
    g.fill();
  }
  winRain.tex.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// fishingPond ripple rings (§C11.2 — cosmetic, rain only)
// ---------------------------------------------------------------------------

/**
 * Rain ripple rings for the fishingPond surface (§C11.2): ONE instanced mesh
 * of camera-facing squashed rings popping along the water line. The pond
 * game drives update(dt)/dispose() itself (its scene, its loop).
 * @param {THREE.Scene} scene
 * @param {{surfaceY: number, halfW: number, z?: number}} opts
 * @returns {WeatherFxHandle}
 */
export function mountPondRipples(scene, { surfaceY, halfW, z = 0.55 }) {
  const geo = makeInstancedQuads(WEATHER_FX.POND_RINGS, 0); // all rings
  const mat = new THREE.ShaderMaterial({
    vertexShader: POND_VERT,
    fragmentShader: RAIN_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uPond: { value: new THREE.Vector3(halfW, surfaceY, z) },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'pondRipples';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  scene.add(mesh);
  const handle = {
    mesh,
    setActive(on) {
      mesh.visible = !!on;
    },
    isActive: () => mesh.visible,
    update(dt) {
      mat.uniforms.uTime.value += dt;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
  return handle;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Advance every mounted garden effect + the animated window texture.
 * homeScene calls this once per frame (§C11.2). Cheap when idle: faded
 * effects early-out and the window canvas repaints at ~11 fps only while a
 * rain texture exists.
 * @param {number} dt seconds
 */
export function updateWeatherFx(dt) {
  for (const handle of liveHandles) handle.update(dt);
  if (winRain) {
    winRain.accum += dt;
    if (winRain.accum >= WEATHER_FX.WINDOW_REPAINT_SEC) {
      paintWindowRain(winRain.accum);
      winRain.accum = 0;
    }
  }
}
