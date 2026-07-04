// Lighting rig — PLAN.md §7 (client/src/three/lights.js).
// Warm key SpotLight (the shadow caster), colored neon point lights, ambient
// fill, FogExp2 — all driven by the map palette.

import * as THREE from 'three';

/**
 * Build the lighting rig for a map.
 * @param {THREE.Scene} scene
 * @param {import('@shared/maps.js').BarMap} mapConfig
 * @returns rig with { group, update(dt, elapsed), dimTo(level, seconds), setDim, dispose }
 */
export function createLights(scene, mapConfig) {
  const { palette, propParams } = mapConfig;
  const group = new THREE.Group();
  group.name = 'light_rig';

  // fog owned by the rig
  scene.fog = new THREE.FogExp2(new THREE.Color(palette.fog), propParams.fogDensity);
  scene.background = new THREE.Color(palette.fog);

  // ---- warm key spotlight over the table (the shadow caster) ----
  const warmth = propParams.lightWarmth;
  const keyColor = new THREE.Color().lerpColors(
    new THREE.Color('#cfe0ff'),
    new THREE.Color('#ffca7a'),
    warmth
  );
  const key = new THREE.SpotLight(keyColor, 95, 10, Math.PI / 4.1, 0.55, 1.35);
  key.position.set(0, 3.15, 0);
  key.target.position.set(0, 0.9, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0015;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 8;
  group.add(key, key.target);

  // ---- neon accent point lights ----
  const neons = [];
  const neonDefs = [
    { color: palette.neon, pos: [0, 2.1, -4.4], intensity: 14 }, // main sign
    { color: palette.accent, pos: [-3.4, 1.7, -2.2], intensity: 8 },
    { color: palette.neon, pos: [3.4, 1.6, 1.8], intensity: 6.5 },
    { color: palette.accent, pos: [-2.4, 1.4, 3.2], intensity: 5.5 },
  ];
  for (const def of neonDefs) {
    const p = new THREE.PointLight(new THREE.Color(def.color), def.intensity, 7, 1.8);
    p.position.set(...def.pos);
    group.add(p);
    neons.push({ light: p, base: def.intensity, phase: Math.random() * 10, flickerSeed: Math.random() });
  }

  // ---- fills ----
  const ambientColor = new THREE.Color(palette.wall).lerp(new THREE.Color('#fff4e0'), 0.45);
  const ambient = new THREE.AmbientLight(ambientColor, 0.85);
  const hemi = new THREE.HemisphereLight(new THREE.Color(palette.neon), new THREE.Color(palette.fog), 0.35);
  group.add(ambient, hemi);

  scene.add(group);

  // ---- dim control (penalty drama) ----
  let dim = 1;
  let dimTarget = 1;
  let dimSpeed = 1;
  const baseKey = key.intensity;
  const baseAmbient = ambient.intensity;
  const baseHemi = hemi.intensity;
  const baseFog = propParams.fogDensity;

  return {
    group,
    key,
    neons: neons.map((n) => n.light),
    ambient,
    /** Smoothly dim (0..1 = fraction of normal brightness). */
    dimTo(level, seconds = 0.8) {
      dimTarget = THREE.MathUtils.clamp(level, 0.05, 1);
      dimSpeed = Math.abs(dimTarget - dim) / Math.max(seconds, 0.01);
    },
    getDim: () => dim,
    update(dt, elapsed) {
      if (dim !== dimTarget) {
        const dir = Math.sign(dimTarget - dim);
        dim += dir * dimSpeed * dt;
        if ((dir > 0 && dim >= dimTarget) || (dir < 0 && dim <= dimTarget)) dim = dimTarget;
        key.intensity = baseKey * dim;
        ambient.intensity = baseAmbient * (0.35 + 0.65 * dim);
        hemi.intensity = baseHemi * dim;
        if (scene.fog) scene.fog.density = baseFog * (1 + (1 - dim) * 0.4);
      }
      // subtle neon buzz/flicker
      for (const n of neons) {
        const flick =
          Math.sin(elapsed * 17 + n.phase) * 0.05 +
          Math.sin(elapsed * 3.1 + n.phase * 2) * 0.06 +
          (Math.sin(elapsed * 41 + n.phase) > 0.985 ? -0.35 : 0);
        n.light.intensity = n.base * (0.94 + flick) * (0.55 + 0.45 * dim);
      }
      // key light sway, like a hanging lamp
      key.position.x = Math.sin(elapsed * 0.4) * 0.045;
      key.position.z = Math.cos(elapsed * 0.33) * 0.045;
    },
    dispose() {
      scene.remove(group);
      scene.fog = null;
    },
  };
}
