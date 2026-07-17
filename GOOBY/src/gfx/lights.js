// Home lighting rig (§D4, binding): hemisphere + directional with a single
// 1024 px shadow map (home scene only — Gooby + furniture cast, floor
// receives), plus the bedroom night-mode lerp (hemisphere dims to a cool
// night tone, the directional goes out, and a warm point light glows at the
// bedside lamp). G6's sleep flow drives night mode via homeScene.setNight().
//
// V2/G26 (§C10.2/§C11.2): rig.applyAmbience({band, weather, blend}) — the
// day/night-band pass. It retargets the rig's BASE values from the binding
// constants.DAYNIGHT table (with 30-min crossfade blending) and multiplies
// hemi/dir intensity ×0.85 while cloudy / ×0.70 while raining; update(dt)
// eases toward those targets over ~1 s. The v1 sleep night-mode (setNight)
// keeps working unchanged on top: its mix lerps FROM the ambience base TO the
// §D4 NIGHT values, so sleep always looks like full night regardless of the
// band outside (§B3 — sleep override wins).

import * as THREE from 'three';
import { DAYNIGHT, WEATHER } from '../data/constants.js';

/** §D4 day rig values. */
const DAY = Object.freeze({
  hemiSky: '#fff5e8',
  hemiGround: '#b8a898',
  hemiIntensity: 0.9,
  dirColor: '#fff2dd',
  dirIntensity: 1.1,
  lampIntensity: 0,
});

/** §D4 night-mode values (bedroom night: lamp on until sleep starts). */
const NIGHT = Object.freeze({
  hemiSky: '#4a5a8a',
  hemiGround: '#202535',
  hemiIntensity: 0.5,
  dirIntensity: 0,
  lampColor: '#ffb573',
  lampIntensity: 14,
  lampDistance: 5,
});

/** Single shadow map budget (§D4/§E10). */
const SHADOW_MAP_SIZE = 1024;
/** Night lerp time constant (s) — reaches ~95% in 3×. */
const LERP_TAU = 0.35;

// --- V2/G26: ambience helpers (§C10.2/§C11.2) -------------------------------

/** Ambience ease time constant (s) — band/weather changes glide, never pop. */
const AMBIENCE_TAU = 1.0;
/** §C11.2 hemi/dir intensity multipliers per weather state. */
const WEATHER_MULT = Object.freeze({
  clear: 1,
  cloudy: WEATHER.CLOUDY_LIGHT_MULT,
  rain: WEATHER.RAIN_LIGHT_MULT,
});
/** Front-fill intensity per band (artistic §D4 supplement, scaled by weather). */
const FILL_INTENSITY = Object.freeze({ day: 0.5, dawn: 0.42, dusk: 0.3, night: 0.1 });

/**
 * Resolve the §C10.2 DAYNIGHT row for a band into numeric rig targets,
 * applying the §C11.2 weather intensity multiplier.
 * @param {'day'|'dawn'|'dusk'|'night'} band
 * @param {'clear'|'cloudy'|'rain'} weather
 * @returns {{hemiSky: THREE.Color, hemiGround: THREE.Color, hemiIntensity: number,
 *   dirColor: THREE.Color, dirIntensity: number, fillIntensity: number}}
 */
function bandTargets(band, weather) {
  const cfg = DAYNIGHT[band] ?? DAYNIGHT.day;
  const mult = WEATHER_MULT[weather] ?? 1;
  return {
    hemiSky: new THREE.Color(cfg.hemiSky),
    hemiGround: new THREE.Color(cfg.hemiGround),
    hemiIntensity: cfg.hemiIntensity * mult,
    dirColor: new THREE.Color(cfg.dirColor),
    dirIntensity: cfg.dirIntensity * mult,
    fillIntensity: (FILL_INTENSITY[band] ?? FILL_INTENSITY.day) * mult,
  };
}

/** Lerp target set a into b by t (mutates a; colors + scalars). */
function lerpTargets(a, b, t) {
  a.hemiSky.lerp(b.hemiSky, t);
  a.hemiGround.lerp(b.hemiGround, t);
  a.hemiIntensity = THREE.MathUtils.lerp(a.hemiIntensity, b.hemiIntensity, t);
  a.dirColor.lerp(b.dirColor, t);
  a.dirIntensity = THREE.MathUtils.lerp(a.dirIntensity, b.dirIntensity, t);
  a.fillIntensity = THREE.MathUtils.lerp(a.fillIntensity, b.fillIntensity, t);
  return a;
}

// --- end V2/G26 helpers ------------------------------------------------------

/**
 * Create the home lighting rig. Call `update(dt)` every frame and
 * `setFocus(x)` when the camera pans so the shadow frustum follows the active
 * room (keeps the single 1024 map crisp instead of stretching it over all 4
 * rooms).
 *
 * @param {THREE.Scene} scene
 * @returns {{
 *   hemi: THREE.HemisphereLight,
 *   dir: THREE.DirectionalLight,
 *   lamp: THREE.PointLight,
 *   setNight: (on: boolean, opts?: {instant?: boolean}) => void,
 *   isNight: () => boolean,
 *   applyAmbience: (params: {band?: string, weather?: string,
 *     blend?: {from: string, to: string, t: number}|null, instant?: boolean}) => void,
 *   getAmbience: () => {band: string, weather: string},
 *   setFocus: (x: number) => void,
 *   setLampPosition: (pos: {x: number, y: number, z: number}) => void,
 *   update: (dt: number) => void,
 *   dispose: () => void,
 * }}
 */
export function createHomeLights(scene) {
  const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiIntensity);
  hemi.name = 'homeHemi';
  scene.add(hemi);

  // Angled from the window side (§D3/§D4): high, right and toward the camera.
  const dir = new THREE.DirectionalLight(DAY.dirColor, DAY.dirIntensity);
  dir.name = 'homeDir';
  dir.castShadow = true;
  dir.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  // Tight per-room frustum — setFocus() slides it to the active room.
  dir.shadow.camera.left = -3.4;
  dir.shadow.camera.right = 3.4;
  dir.shadow.camera.top = 4.5;
  dir.shadow.camera.bottom = -2;
  dir.shadow.camera.near = 0.5;
  dir.shadow.camera.far = 16;
  dir.shadow.bias = -0.002;
  dir.shadow.normalBias = 0.02;
  scene.add(dir);
  scene.add(dir.target);

  // Soft front fill so the camera-facing walls/furniture read warm instead of
  // muddy (artistic supplement to the §D4 rig; no shadows, fades at night).
  const fill = new THREE.DirectionalLight('#fff6e8', 0.5);
  fill.name = 'homeFill';
  scene.add(fill);
  scene.add(fill.target);

  const lamp = new THREE.PointLight(NIGHT.lampColor, 0, NIGHT.lampDistance, 2);
  lamp.name = 'homeLamp';
  lamp.visible = false;
  scene.add(lamp);

  // lerp state: 0 = day … 1 = night
  let night = false;
  let mix = 0;

  const colNightSky = new THREE.Color(NIGHT.hemiSky);
  const colNightGround = new THREE.Color(NIGHT.hemiGround);

  // V2/G26 (§C10.2/§C11.2): the rig's BASE values follow the day/night band +
  // weather instead of the fixed §D4 DAY row (day/clear resolves to exactly
  // the v1 values — day IS v1). `amb` eases toward `ambTarget` in update(dt).
  let ambBand = 'day';
  let ambWeather = 'clear';
  const amb = bandTargets('day', 'clear');
  let ambTarget = bandTargets('day', 'clear');

  function apply() {
    // sleep night-mode blends FROM the ambience base TO the §D4 NIGHT rig
    hemi.color.copy(amb.hemiSky).lerp(colNightSky, mix);
    hemi.groundColor.copy(amb.hemiGround).lerp(colNightGround, mix);
    hemi.intensity = THREE.MathUtils.lerp(amb.hemiIntensity, NIGHT.hemiIntensity, mix);
    dir.color.copy(amb.dirColor); // sleep only dims — moon/warm tint may stay
    dir.intensity = THREE.MathUtils.lerp(amb.dirIntensity, NIGHT.dirIntensity, mix);
    fill.intensity = THREE.MathUtils.lerp(amb.fillIntensity, 0.06, mix);
    // Shadows come from the directional only — stop casting once it is out
    // (ambience night keeps 0.15 moonlight ⇒ shadows stay, §C10.2).
    dir.castShadow = THREE.MathUtils.lerp(amb.dirIntensity, NIGHT.dirIntensity, mix) > 0.05;
    lamp.intensity = NIGHT.lampIntensity * mix;
    lamp.visible = mix > 0.01;
  }
  apply();

  return {
    hemi,
    dir,
    lamp,

    /**
     * Toggle bedroom night mode (§D4). Lerps over ~1 s unless instant.
     * @param {boolean} on
     * @param {{instant?: boolean}} [opts]
     */
    setNight(on, opts = {}) {
      night = !!on;
      if (opts.instant) {
        mix = night ? 1 : 0;
        apply();
      }
    },

    /** @returns {boolean} current night-mode target */
    isNight() {
      return night;
    },

    // ---- V2/G26: day/night + weather ambience (§B4/§C10.2/§C11.2) ----

    /**
     * Retarget the rig to a §C10.2 band (constants.DAYNIGHT) with the §C11.2
     * weather intensity multiplier (cloudy ×0.85 / rain ×0.70). During the
     * 30-min boundary crossfade pass `blend` (systems/dayNight bandAt():
     * {from, to, t}) and the targets mix accordingly. Values ease over ~1 s
     * in update(dt); pass instant to snap (first paint / room boot).
     * homeScene wires G20's 'dayBandChanged'/'weatherChanged' events here.
     * @param {{band?: string, weather?: string,
     *   blend?: {from: string, to: string, t: number}|null, instant?: boolean}} params
     */
    applyAmbience(params = {}) {
      ambBand = DAYNIGHT[params.band] ? params.band : 'day';
      ambWeather = params.weather ?? 'clear';
      const blend = params.blend;
      ambTarget = blend && DAYNIGHT[blend.from] && DAYNIGHT[blend.to]
        ? lerpTargets(bandTargets(blend.from, ambWeather), bandTargets(blend.to, ambWeather), blend.t)
        : bandTargets(ambBand, ambWeather);
      if (params.instant) {
        lerpTargets(amb, ambTarget, 1);
        apply();
      }
    },

    /** @returns {{band: string, weather: string}} last applied ambience params */
    getAmbience() {
      return { band: ambBand, weather: ambWeather };
    },

    // ---- end V2/G26 ----

    /**
     * Slide the directional light + shadow frustum to the active room center.
     * @param {number} x world x of the active room center
     */
    setFocus(x) {
      dir.position.set(x + 2.6, 5.2, 3.4);
      dir.target.position.set(x, 0, -0.4);
      dir.target.updateMatrixWorld();
      fill.position.set(x - 1.5, 2.8, 8);
      fill.target.position.set(x, 0.8, -1);
      fill.target.updateMatrixWorld();
    },

    /**
     * Park the warm night lamp at the bedside lamp's world position.
     * @param {{x: number, y: number, z: number}} pos
     */
    setLampPosition(pos) {
      lamp.position.set(pos.x, pos.y + 0.35, pos.z + 0.25);
    },

    /** Ease the day/night mix (call every frame). @param {number} dt seconds */
    update(dt) {
      const target = night ? 1 : 0;
      mix += (target - mix) * Math.min(1, dt / LERP_TAU);
      if (Math.abs(target - mix) < 0.002) mix = target;
      // V2/G26: ease the ambience base toward its band/weather target (~1 s).
      // apply() runs unconditionally — a handful of color/scalar ops per frame.
      lerpTargets(amb, ambTarget, Math.min(1, dt / AMBIENCE_TAU));
      apply();
    },

    dispose() {
      dir.shadow.map?.dispose();
      scene.remove(hemi, dir, dir.target, fill, fill.target, lamp);
      hemi.dispose();
      dir.dispose();
      fill.dispose();
      lamp.dispose();
    },
  };
}
