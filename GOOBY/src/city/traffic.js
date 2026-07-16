// AI traffic (§G G7, §C6.1 #1): 6–10 Kenney car-kit cars (taxi/van/police/
// delivery/suv) looping fixed lane paths derived from the layout's closed
// tile cycles, with forgiving 70%-scaled AABB collision vs the player
// (DRIVE_TUNING.TRAFFIC_HITBOX_SCALE). Traffic never chases or reacts — it
// just keeps driving its loop (cozy, §A pillar 4).

import * as THREE from 'three';
import { DRIVE_TUNING } from '../data/constants.js';
import {
  tileToWorld,
  laneOffsetPolyline,
  polylineLength,
  pointAtLength,
} from './cityBuilder.js';
import { ensureWheels } from './carController.js';

const T = DRIVE_TUNING;

/** Traffic model rotation (types cycle §C6.1's list). */
const CAR_TYPES = ['taxi', 'van', 'police', 'delivery', 'suv'];

/** Authored half-extents (units) of the widest traffic bodies (car-kit). */
const CAR_HALF_W = 0.75;
const CAR_HALF_L = 1.5;

/** GLB keys the traffic needs preloaded. */
export const TRAFFIC_ASSET_KEYS = Object.freeze([
  ...CAR_TYPES.map((id) => `car-kit/${id}`),
  'car-kit/wheel-default',
]);

/**
 * @param {{
 *   scene: import('three').Scene,
 *   assets: {getModel: (key: string) => import('three').Object3D},
 *   layout: import('./cityBuilder.js').CityLayout,
 *   rng: () => number,
 * }} deps rng: the framework-seeded stream (start offsets only — lanes are fixed)
 * @returns {{
 *   update: (dt: number) => void,
 *   checkHit: (playerAabb: {minX: number, maxX: number, minZ: number, maxZ: number}) =>
 *     ({x: number, z: number}|null),
 *   dispose: () => void,
 * }}
 */
export function createTraffic({ scene, assets, layout, rng }) {
  const group = new THREE.Group();
  group.name = 'traffic';
  scene.add(group);

  // closed lane polylines (right-hand offset per loop travel direction)
  const lanes = layout.trafficLoops.map((tiles) => {
    const center = tiles.map(([r, c]) => tileToWorld(r, c));
    const pts = laneOffsetPolyline(center, T.LANE_OFFSET_M, true);
    return { pts, length: polylineLength(pts, true) };
  });

  /** @type {Array<{model: THREE.Object3D, wheels: THREE.Object3D[], lane: {pts: object[], length: number}, s: number, hitCooldown: number}>} */
  const cars = [];
  for (let i = 0; i < T.TRAFFIC_COUNT; i++) {
    const lane = lanes[i % lanes.length];
    const type = CAR_TYPES[i % CAR_TYPES.length];
    const model = assets.getModel(`car-kit/${type}`);
    model.scale.setScalar(T.CAR_SCALE);
    const wheels = ensureWheels(model, assets);
    group.add(model);
    cars.push({
      model,
      wheels,
      lane,
      // spread cars around their loop (rng jitter keeps rounds varied)
      s: ((Math.floor(i / lanes.length) + 1) / (Math.ceil(T.TRAFFIC_COUNT / lanes.length) + 1) + rng() * 0.1) * lane.length,
      hitCooldown: 0,
    });
  }

  function place(car) {
    const p = pointAtLength(car.lane.pts, car.s, true);
    car.model.position.set(p.x, T.ROAD_Y, p.z);
    car.model.rotation.y = Math.atan2(p.dx, p.dz);
  }
  for (const car of cars) place(car);

  const hw = CAR_HALF_W * T.CAR_SCALE;
  const hl = CAR_HALF_L * T.CAR_SCALE;

  return {
    /** @param {number} dt */
    update(dt) {
      const wheelOmega = (T.TRAFFIC_SPEED / T.CAR_SCALE / 0.3) * dt;
      for (const car of cars) {
        car.s = (car.s + T.TRAFFIC_SPEED * dt) % car.lane.length;
        car.hitCooldown = Math.max(0, car.hitCooldown - dt);
        place(car);
        for (const w of car.wheels) w.rotation.x += wheelOmega;
      }
    },

    /**
     * Forgiving collision (§C6.1): both boxes pre-scaled to 70%. Returns the
     * hit car's position (for the push-back) or null. A short per-car
     * cooldown avoids double-counting one bump.
     * @param {{minX: number, maxX: number, minZ: number, maxZ: number}} playerAabb
     */
    checkHit(playerAabb) {
      for (const car of cars) {
        if (car.hitCooldown > 0) continue;
        const p = car.model.position;
        const rotated = Math.abs(Math.sin(car.model.rotation.y)) > 0.5;
        const hx = (rotated ? hl : hw) * T.TRAFFIC_HITBOX_SCALE;
        const hz = (rotated ? hw : hl) * T.TRAFFIC_HITBOX_SCALE;
        if (
          playerAabb.minX < p.x + hx && playerAabb.maxX > p.x - hx &&
          playerAabb.minZ < p.z + hz && playerAabb.maxZ > p.z - hz
        ) {
          car.hitCooldown = 2.5;
          return { x: p.x, z: p.z };
        }
      }
      return null;
    },

    dispose() {
      scene.remove(group);
    },
  };
}
