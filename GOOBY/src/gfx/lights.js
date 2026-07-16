// Home lighting rig (§D4, binding): hemisphere + directional with a single
// 1024 px shadow map (home scene only — Gooby + furniture cast, floor
// receives), plus the bedroom night-mode lerp (hemisphere dims to a cool
// night tone, the directional goes out, and a warm point light glows at the
// bedside lamp). G6's sleep flow drives night mode via homeScene.setNight().

import * as THREE from 'three';

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

  const colDaySky = new THREE.Color(DAY.hemiSky);
  const colDayGround = new THREE.Color(DAY.hemiGround);
  const colNightSky = new THREE.Color(NIGHT.hemiSky);
  const colNightGround = new THREE.Color(NIGHT.hemiGround);

  function apply() {
    hemi.color.copy(colDaySky).lerp(colNightSky, mix);
    hemi.groundColor.copy(colDayGround).lerp(colNightGround, mix);
    hemi.intensity = THREE.MathUtils.lerp(DAY.hemiIntensity, NIGHT.hemiIntensity, mix);
    dir.intensity = THREE.MathUtils.lerp(DAY.dirIntensity, NIGHT.dirIntensity, mix);
    fill.intensity = THREE.MathUtils.lerp(0.5, 0.06, mix);
    // Shadows come from the directional only — stop casting once it is out.
    dir.castShadow = mix < 0.98;
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
      const prev = mix;
      mix += (target - mix) * Math.min(1, dt / LERP_TAU);
      if (Math.abs(target - mix) < 0.002) mix = target;
      if (mix !== prev) apply();
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
