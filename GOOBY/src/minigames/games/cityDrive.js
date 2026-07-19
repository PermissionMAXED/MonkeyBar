// City Drive — „Einkaufsfahrt" / Shopping Cruise (§C6.1 #1, §C4): THE shop
// drive. Third-person chase-cam ride across the seeded 9×9 low-poly city to
// the shop, with floating route arrows + a glowing route line, 20 coin
// pickups, 6–10 looping traffic cars (forgiving 70% hitboxes), cone/box/
// barrier obstacles and the §C4.5 crash rules (bump → shake + „Autsch!" +
// 30% speed; 3 crashes → tow-truck cutscene, car placed at the shop with no
// arrival/no-crash bonuses — you always reach the shop, never a hard fail).
//
// Modes (ctx.params.mode): 'shopTrip' (§C4 — home→shop, arrival fanfare,
// hands off to systems/shopTrip.js via params.onArrive/onExit), 'vetTrip'
// (V2/G21 §C9.2 — same machinery over the shorter vet route with 10 pickups,
// arrival hands off to the vet panel) and 'arcade' (§C4.7 — 90 s open
// coin-run in the same city, default from the arcade).
//
// Dev flags (dev builds only, §G G7 DoD): ?topcam=1 top-down city overview,
// ?autopilot=1 steers along the route so a full trip completes headlessly,
// ?mode=shopTrip|vetTrip forces a trip mode when launched via
// ?minigame=cityDrive, ?wedge=1 parks the car throttle-on against the
// nearest building face so the F4 P1-1 stuck-rescue can be reproduced
// deterministically.
//
// City assembly lives here (buildCity) and consumes city/cityBuilder.js's
// PURE layout — buildings/trees/roads render as InstancedMesh per GLB
// (§E10: drive budget ≤ 180 draw calls; logged in dev every few seconds).

import * as THREE from 'three';
import { DRIVE, DRIVE_TUNING, UI_COLORS, DAYNIGHT } from '../../data/constants.js'; // V2/G26: + DAYNIGHT (§C10.2)
import { t } from '../../data/strings.js';
import {
  generateCityLayout,
  layoutColliders,
  tileToWorld,
  pointAtLength,
  distanceToPolyline,
  CITY_ASSET_KEYS,
  landmarksInRange, // V2/G21 (§C9.3)
} from '../../city/cityBuilder.js';
import { createCarController, wrapAngle } from '../../city/carController.js';
import { createTraffic, TRAFFIC_ASSET_KEYS } from '../../city/traffic.js';
import { driveRewards, isTripMode } from '../../systems/shopTrip.js'; // V2/G21: + isTripMode
// V2/G21 (§C9.1/§C9.3): vet clinic + landmark dressing builders
import { buildVetClinic, buildLandmarkDressing, VET_CLINIC_ASSET_KEYS } from '../../city/vetClinic.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // G14: cameo outfits (§C5.3)
import { createParticles } from '../../gfx/particles.js';
// V2/G26 (§C10.2): the city drives under the real day/night band
import { bandAt } from '../../systems/dayNight.js';
import { now } from '../../core/clock.js';

const T = DRIVE_TUNING;
const SKY = '#cfe8ff'; // §D4: city fog color

// ── V3/G39 (§C7.2): arcade open-run speed — max nudged 13 → 15 m/s with the
// ramp starting after 20 s (gentle tuning only). TRIP speed stays the §C4
// 9 → 13 m/s ramp bit-identical: trips (and deliveryRush) simply omit the
// speedProfile. Frozen module-local per §E0.1-3 (constants.js is read-only).
export const ARCADE_SPEED = Object.freeze({ MAX_SPEED_MS: 15, RAMP_DELAY_SEC: 20 });
// ── end V3/G39 ──────────────────────────────────────────────────────────────

// --- V2/G26 (§C10.2): city band dressing ------------------------------------
// V2/G28 reuses: deliveryRush inherits this tint via the shared city setup —
// read the band once at init (bandAt(now()).band) and index this table.
// day = exact v1 values (#cfe8ff sky, 0.95/1.1 rig); dusk warms everything;
// night = §C10.2 night row + 2 player-car headlight SpotLights (below).
const CITY_BANDS = Object.freeze({
  day: Object.freeze({ sky: SKY, hemiIntensity: 0.95, dirIntensity: 1.1, fogFrom: 60, fogTo: 150 }),
  dawn: Object.freeze({ sky: '#f7ddb9', hemiIntensity: 0.85, dirIntensity: 0.9, fogFrom: 60, fogTo: 150 }),
  dusk: Object.freeze({ sky: '#eeb493', hemiIntensity: 0.78, dirIntensity: 0.72, fogFrom: 55, fogTo: 140 }),
  night: Object.freeze({ sky: '#1D2440', hemiIntensity: 0.55, dirIntensity: 0.18, fogFrom: 40, fogTo: 120, headlights: true }),
});
// --- end V2/G26 --------------------------------------------------------------

/** @param {string} name @returns {string|null} dev-only URL param */
function devParam(name) {
  if (!import.meta.env?.DEV || typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(name);
}

// ---------------------------------------------------------------------------
// Instanced city assembly (consumes the pure layout)
// ---------------------------------------------------------------------------

/**
 * Render every transform of a (possibly multi-mesh) GLB as InstancedMesh —
 * one draw call per (geometry, material) pair regardless of count (§E10).
 * @param {import('three').Object3D} model
 * @param {import('three').Matrix4[]} transforms
 * @param {import('three').Group} parent
 */
function addInstanced(model, transforms, parent) {
  if (transforms.length === 0) return;
  model.updateMatrixWorld(true);
  const tmp = new THREE.Matrix4();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, transforms.length);
    for (let i = 0; i < transforms.length; i++) {
      tmp.multiplyMatrices(transforms[i], o.matrixWorld);
      im.setMatrixAt(i, tmp);
    }
    im.instanceMatrix.needsUpdate = true;
    parent.add(im);
  });
}

/** Compose a Matrix4 from x/z, rotY, uniform scale and ground height. */
function composeAt(x, y, z, rotY, scale) {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY ?? 0),
    new THREE.Vector3(scale, scale, scale)
  );
  return m;
}

/**
 * Build the whole static city into the scene from the pure layout.
 * @param {import('three').Scene} scene
 * @param {{getModel: Function}} assets
 * @param {import('../../city/cityBuilder.js').CityLayout} layout
 * @returns {{group: import('three').Group}}
 */
function buildCity(scene, assets, layout) {
  const group = new THREE.Group();
  group.name = 'city';

  // grass ground plane (one draw call — the rim tiles are just the plane)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(300, 300),
    new THREE.MeshStandardMaterial({ color: '#8fc76d', roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // roads + block pavements, instanced per piece type
  /** @type {Record<string, THREE.Matrix4[]>} */
  const byPiece = {};
  for (let r = 0; r < layout.grid.length; r++) {
    for (let c = 0; c < layout.grid[r].length; c++) {
      const tile = layout.grid[r][c];
      const { x, z } = tileToWorld(r, c);
      const key = tile.kind === 'road' ? tile.piece : tile.kind === 'block' ? 'tile-low' : null;
      if (!key) continue;
      (byPiece[key] ??= []).push(composeAt(x, 0, z, tile.rotY ?? 0, T.TILE_M));
    }
  }
  for (const [piece, transforms] of Object.entries(byPiece)) {
    addInstanced(assets.getModel(`city-kit-roads/${piece}`), transforms, group);
  }

  // buildings (per GLB key), nature, lamps — all instanced
  /** @type {Record<string, THREE.Matrix4[]>} */
  const byKey = {};
  for (const b of layout.buildings) (byKey[b.key] ??= []).push(composeAt(b.x, T.ROAD_Y, b.z, b.rotY, b.scale));
  for (const n of layout.nature) (byKey[n.key] ??= []).push(composeAt(n.x, 0, n.z, n.rotY, n.scale));
  (byKey['city-kit-roads/light-square-double'] ??= []).push(
    ...layout.lamps.map((l) => composeAt(l.x, T.ROAD_Y, l.z, l.rotY, T.LAMP_SCALE))
  );
  for (const [key, transforms] of Object.entries(byKey)) {
    addInstanced(assets.getModel(key), transforms, group);
  }

  // --- the SHOP destination dressing (§G G7: awning + parking area) --------
  const awning = assets.getModel('city-kit-commercial/detail-awning');
  awning.scale.setScalar(T.BUILDING_SCALE);
  awning.position.set(layout.shop.awningAt.x, T.ROAD_Y + 3.4, layout.shop.awningAt.z);
  awning.rotation.y = layout.shop.rotY;
  group.add(awning);

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 13),
    new THREE.MeshStandardMaterial({ color: '#6b6f76', roughness: 1 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(layout.shop.parking.x, T.ROAD_Y + 0.02, layout.shop.parking.z);
  group.add(apron);

  // --- home: a tiny pastel house next to the start tile --------------------
  const homeGarden = tileToWorld(layout.home.tile.r + 1, layout.home.tile.c);
  const house = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(8, 4.6, 7),
    new THREE.MeshStandardMaterial({ color: UI_COLORS.BG_CREAM, roughness: 0.9 })
  );
  base.position.y = 2.3;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(6.4, 3.4, 4),
    new THREE.MeshStandardMaterial({ color: UI_COLORS.PRIMARY_PINK, roughness: 0.9 })
  );
  roof.position.y = 6.3;
  roof.rotation.y = Math.PI / 4;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 2.8, 0.3),
    new THREE.MeshStandardMaterial({ color: '#8a6248', roughness: 0.9 })
  );
  door.position.set(0, 1.4, -3.6);
  house.add(base, roof, door);
  house.position.set(homeGarden.x, 0, homeGarden.z);
  group.add(house);

  scene.add(group);
  return { group };
}

// ---------------------------------------------------------------------------
// Route guidance (§G G7: floating 3D arrows + glowing route line)
// ---------------------------------------------------------------------------

/**
 * @param {import('three').Scene} scene
 * @param {import('../../city/cityBuilder.js').CityLayout} layout
 */
function buildRouteGuides(scene, layout) {
  const group = new THREE.Group();
  group.name = 'routeGuides';

  // glowing route line: a flat ribbon along the lane polyline
  const step = 2.5;
  const samples = [];
  for (let s = 0; s <= layout.laneLength; s += step) samples.push(pointAtLength(layout.lane, s));
  const positions = new Float32Array(samples.length * 2 * 3);
  const half = T.ROUTE_LINE_WIDTH_M / 2;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const rx = -p.dz * half;
    const rz = p.dx * half;
    positions.set([p.x - rx, T.ROAD_Y + 0.14, p.z - rz, p.x + rx, T.ROAD_Y + 0.14, p.z + rz], i * 6);
  }
  const indices = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  ribbonGeo.setIndex(indices);
  const ribbonMat = new THREE.MeshBasicMaterial({
    color: UI_COLORS.PRIMARY_PINK,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  group.add(ribbon);

  // floating arrows along the route (one InstancedMesh)
  const count = Math.floor(layout.laneLength / T.ARROW_SPACING_M);
  const arrowGeo = new THREE.ConeGeometry(0.85, 2.1, 6);
  const arrowMat = new THREE.MeshBasicMaterial({ color: UI_COLORS.YELLOW, transparent: true, opacity: 0.92 });
  const arrows = new THREE.InstancedMesh(arrowGeo, arrowMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  /** kept for per-frame near-player hiding (arrows must never block the cam) */
  const arrowSpots = [];
  for (let i = 0; i < count; i++) {
    const p = pointAtLength(layout.lane, (i + 1) * T.ARROW_SPACING_M);
    q.setFromUnitVectors(up, new THREE.Vector3(p.dx, 0, p.dz));
    m.compose(new THREE.Vector3(p.x, T.ROAD_Y + T.ARROW_HEIGHT_M, p.z), q, new THREE.Vector3(1, 1, 1));
    arrows.setMatrixAt(i, m);
    arrowSpots.push({ x: p.x, z: p.z, matrix: m.clone(), hidden: false });
  }
  arrows.instanceMatrix.needsUpdate = true;
  group.add(arrows);

  // pulsing arrival ring at the parking trigger (radius = §C4 PARKING_RADIUS)
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(DRIVE.PARKING_RADIUS - 0.5, DRIVE.PARKING_RADIUS, 40),
    new THREE.MeshBasicMaterial({ color: UI_COLORS.TEAL, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(layout.shop.parking.x, T.ROAD_Y + 0.16, layout.shop.parking.z);
  group.add(ring);

  // single off-route helper arrow (floats over the car pointing back)
  const guide = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: UI_COLORS.TEAL }));
  guide.visible = false;
  group.add(guide);

  scene.add(group);
  return { group, arrows, arrowSpots, ribbonMat, ring, guide };
}

/** Hide route arrows near the car (they'd float into the chase cam). */
function hideNearbyArrows(guides, px, pz) {
  const { arrows, arrowSpots } = guides;
  const hideR2 = 13 * 13;
  const hidden = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
  let dirty = false;
  for (let i = 0; i < arrowSpots.length; i++) {
    const a = arrowSpots[i];
    const dx = a.x - px;
    const dz = a.z - pz;
    const hide = dx * dx + dz * dz < hideR2;
    if (hide === a.hidden) continue;
    a.hidden = hide;
    arrows.setMatrixAt(i, hide ? hidden : a.matrix);
    dirty = true;
  }
  if (dirty) arrows.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// The game (§E8 plugin)
// ---------------------------------------------------------------------------

export default {
  id: 'cityDrive',
  assetKeys: [
    ...CITY_ASSET_KEYS,
    ...TRAFFIC_ASSET_KEYS,
    ...VET_CLINIC_ASSET_KEYS, // V2/G21 (§C9.1/§C9.3)
    'car-kit/sedan',
    'car-kit/truck',
  ],

  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    ctx.audio.music('city'); // V3/G32: Sax medley context while driving (§B2.4/§C3.3)
    // V2/G21 (§C9.2): three modes — 'shopTrip' | 'vetTrip' (guided trips
    // sharing the machinery) | 'arcade' (§C4.7 free coin-run).
    const reqMode = isTripMode(ctx.params.mode) ? ctx.params.mode : devParam('mode');
    this.mode = isTripMode(reqMode) ? reqMode : 'arcade';
    // F4 P2-6: reflect a dev-forced trip (?mode=shopTrip|vetTrip) back into
    // the launch params so the framework results screen picks the trip too.
    if (this.mode !== 'arcade') ctx.params.mode = this.mode;
    this.topcam = devParam('topcam') === '1';
    this.autopilot = devParam('autopilot') === '1';

    // ── V2/G21: route view (§C9.2) ────────────────────────────────────────
    // The vet trip re-targets the SAME shop-trip machinery: a shallow view
    // over the base layout swaps lane/pickups/destination-parking/spawn
    // heading so every existing route/arrival code path runs unchanged.
    // City assembly below always renders the BASE layout (real shop apron —
    // the vet apron is drawn by buildVetClinic).
    this.baseLayout = generateCityLayout(T.CITY_SEED);
    this.layout = this.mode === 'vetTrip'
      ? {
          ...this.baseLayout,
          lane: this.baseLayout.vetLane,
          laneLength: this.baseLayout.vetLaneLength,
          pickups: this.baseLayout.vetPickups,
          home: { ...this.baseLayout.home, heading: this.baseLayout.vet.heading },
          shop: { ...this.baseLayout.shop, parking: this.baseLayout.vet.parking },
        }
      : this.baseLayout;
    // parked-at-destination heading after the tow teleport (§C4.5): the shop
    // is entered from the east (face west), the vet from the west (face east)
    this.parkHeading = this.mode === 'vetTrip' ? Math.PI / 2 : -Math.PI / 2;
    // ── end V2/G21 ─────────────────────────────────────────────────────────
    const layout = this.layout;

    // --- scene dressing (§D4: hemi+dir, fog #cfe8ff from 60 m, no shadows) --
    // V2/G26 (§C10.2): the rig follows the real day/night band — day is the
    // exact v1 dressing; dusk warms, night dims to the moonlight row and adds
    // player-car headlights. V2/G28 reuses: deliveryRush inherits this tint
    // via this shared setup (band read once per round — CITY_BANDS above).
    const { scene, camera } = ctx;
    this.band = bandAt(now()).band;
    const cityBand = CITY_BANDS[this.band] ?? CITY_BANDS.day;
    const bandCfg = DAYNIGHT[this.band] ?? DAYNIGHT.day;
    scene.background = new THREE.Color(cityBand.sky);
    if (!this.topcam) scene.fog = new THREE.Fog(cityBand.sky, cityBand.fogFrom, cityBand.fogTo);
    scene.add(new THREE.HemisphereLight(bandCfg.hemiSky, bandCfg.hemiGround, cityBand.hemiIntensity));
    const dir = new THREE.DirectionalLight(bandCfg.dirColor, cityBand.dirIntensity);
    dir.position.set(40, 60, -30);
    scene.add(dir);

    buildCity(scene, ctx.assets, this.baseLayout); // V2/G21: always the base city
    // V2/G21 (§C9.1/§C9.3): vet clinic sign/trees/apron/Dr. Hoppel + the
    // procedural landmark dressing (fountain/gazebo/café) — every city mode.
    buildVetClinic(scene, ctx.assets, this.baseLayout);
    buildLandmarkDressing(scene, ctx.assets, this.baseLayout);
    this.guides = buildRouteGuides(scene, layout);
    // arcade (§C4.7) is a free coin-run — no route guidance to a destination
    this.guides.group.visible = isTripMode(this.mode); // V2/G21: both trips
    this.particles = createParticles(scene);

    // --- player car + Gooby (sitDrive, §D2.4) -------------------------------
    const spawn = { x: layout.lane[0].x, z: layout.lane[0].z, heading: layout.home.heading };
    const colliders = layoutColliders(layout);
    this.car = createCarController({
      scene,
      assets: ctx.assets,
      uiRoot: document.getElementById('ui') ?? document.body,
      spawn,
      colliders,
      onWallHit: () => ctx.audio.play('bump'),
      // F4 P1-1: sustained throttle-on standstill (wedged off-road) → rescue
      onStuck: () => this.startRescue(),
      // V3/G39 (§C7.2): arcade-only 15 m/s ramp after 20 s (trips: §C4 9→13)
      speedProfile: this.mode === 'arcade'
        ? { maxSpeed: ARCADE_SPEED.MAX_SPEED_MS, rampDelaySec: ARCADE_SPEED.RAMP_DELAY_SEC }
        : undefined,
    });
    // F4 P1-1 dev repro (?wedge=1): park the car nose-first (heading east)
    // against a building's west face — throttle-on, zero displacement — so
    // the stuck watchdog + rescue can be exercised deterministically over
    // CDP. The spawn z sits exactly on the lane-snap lateral target of its
    // tile so the assist adds no sideways slide that would mask the wedge.
    if (devParam('wedge') === '1') {
      const half = (T.GRID - 1) / 2;
      const candidates = colliders
        .filter((box) => box.maxX - box.minX > 6 && box.maxZ - box.minZ > 6)
        .map((box) => {
          const zc = (box.minZ + box.maxZ) / 2;
          const row = Math.round(zc / T.TILE_M + half);
          const restZ = (row - half) * T.TILE_M + T.LANE_OFFSET_M; // east → right lane
          return { box, restZ };
        })
        .filter(({ box, restZ }) => restZ > box.minZ + 1.2 && restZ < box.maxZ - 1.2)
        .sort((a, bb) => {
          const da = Math.hypot(a.box.minX - spawn.x, a.restZ - spawn.z);
          const db = Math.hypot(bb.box.minX - spawn.x, bb.restZ - spawn.z);
          return da - db;
        });
      const spot = candidates[0];
      if (spot) this.car.teleport(spot.box.minX - 2, spot.restZ, Math.PI / 2);
    }
    // V2/G26 (§C10.2): night band = 2 headlight SpotLight cones on the PLAYER
    // car only (traffic stays unlit — budget). Car-local +z is forward
    // (carController: forward = (sin h, 0, cos h)); nose ≈ halfL 1.27×scale.
    if (cityBand.headlights) {
      for (const side of [-1, 1]) {
        const head = new THREE.SpotLight('#ffedbe', 90, 34, 0.46, 0.55, 1.6);
        head.position.set(side * 0.62, 1.05, 1.27 * T.CAR_SCALE - 0.15);
        head.target.position.set(side * 0.9, 0.0, 16);
        head.name = `headlight${side < 0 ? 'L' : 'R'}`;
        this.car.group.add(head, head.target);
      }
    }
    // end V2/G26
    this.gooby = createGooby();
    applyEquippedOutfits(this.gooby); // G14: cameo wears the equipped outfits
    this.gooby.group.scale.setScalar(1.15);
    // seated high in the cabin so head + ears poke through the roof (the
    // §D1 car-kit sedan roof tops out ≈ 2.34 car-local at CAR_SCALE)
    this.gooby.group.position.set(0, 2.05, -0.2);
    this.car.group.add(this.gooby.group);
    this.gooby.setEmotion('happy');
    this.gooby.play('sitDrive');

    this.traffic = createTraffic({ scene, assets: ctx.assets, layout, rng: ctx.rng });

    // --- coin pickups (instanced; §C4.3 route coins / arcade scatter) -------
    this.coinGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 14);
    this.coinGeo.rotateX(Math.PI / 2);
    this.coins = isTripMode(this.mode) // V2/G21: vet route carries 10 (§C9.2)
      ? layout.pickups.map((p) => ({ ...p, active: true }))
      : this.scatterCoins(T.ARCADE_COINS_ACTIVE);
    this.coinMesh = new THREE.InstancedMesh(
      this.coinGeo,
      new THREE.MeshBasicMaterial({ color: '#f7c531' }),
      isTripMode(this.mode) ? this.coins.length : T.ARCADE_COINS_ACTIVE + 8 // V2/G21
    );
    scene.add(this.coinMesh);

    // knockable props (cones/boxes — individual so they can fly, §C6.1 juice)
    this.knockables = [];
    for (const p of layout.props) {
      if (p.kind === 'barrier') {
        const b = ctx.assets.getModel(p.key);
        b.scale.setScalar(T.LAMP_SCALE);
        b.position.set(p.x, T.ROAD_Y, p.z);
        b.rotation.y = p.rotY;
        scene.add(b);
      } else {
        const m = ctx.assets.getModel(p.key);
        m.scale.setScalar(T.PROP_SCALE);
        m.position.set(p.x, T.ROAD_Y, p.z);
        m.rotation.y = p.rotY;
        scene.add(m);
        this.knockables.push({ mesh: m, hit: false, vx: 0, vz: 0, vy: 0, spin: 0 });
      }
    }

    // --- state ----------------------------------------------------------------
    this.crashes = 0;
    this.invuln = 0;
    this.collected = 0;
    this.towed = false;
    this.arrived = false;
    this.phase = 'drive'; // 'drive' | 'tow' | 'rescue' | 'fanfare'
    this.phaseT = 0;
    this.rescueDone = false;
    this.progress = 0;
    this.shake = 0;
    this.emotionT = 0;
    this.drawLogT = 0;
    // V2/G21 (§C9.3/§C12.1): landmark triggers + odometer for meta/profile
    this.landmarksHit = new Set();
    this.distanceM = 0;
    this.distanceSent = false;
    this.lastPos = { x: spawn.x, z: spawn.z };

    // crash pips (trips): 💥 n/3 chip under the score row
    if (isTripMode(this.mode)) { // V2/G21: vet trip shows it too (§C9.2)
      this.chip = document.createElement('div');
      this.chip.className = 'mg-pill';
      this.chip.style.cssText =
        'position:absolute;top:calc(64px + var(--safe-top));left:50%;transform:translateX(-50%);z-index:35;';
      (document.getElementById('ui') ?? document.body).appendChild(this.chip);
      this.updateChip();
    }

    ctx.hud.setScore(0);
    ctx.hud.setTime(this.mode === 'arcade' ? DRIVE.ARCADE_DURATION_SEC : 0);

    if (this.topcam) {
      camera.far = 700;
      camera.fov = 45;
      camera.updateProjectionMatrix();
      const aspect = Math.min(1, innerWidth / innerHeight);
      const y = 96 / (Math.tan((camera.fov * Math.PI) / 360) * aspect);
      camera.position.set(0, y, 0.1);
      camera.lookAt(0, 0, 0);
    } else {
      this.car.updateChaseCam(camera, 10);
    }
  },

  /** Arcade coins: seeded scatter over road tiles (respawn keeps the count). */
  scatterCoins(n) {
    const { rng } = this.ctx;
    const roads = [];
    this.layout.grid.forEach((row, r) =>
      row.forEach((tile, c) => tile.kind === 'road' && roads.push([r, c]))
    );
    const coins = [];
    for (let i = 0; i < n; i++) {
      const [r, c] = roads[Math.floor(rng() * roads.length)];
      const { x, z } = tileToWorld(r, c);
      coins.push({ x: x + (rng() - 0.5) * 8, z: z + (rng() - 0.5) * 8, active: true });
    }
    return coins;
  },

  updateChip() {
    if (!this.chip) return;
    this.chip.textContent = t('drive.crashes', { n: this.crashes, max: DRIVE.CRASHES_FOR_TOW });
  },

  /** §C4.5 bump: shake + „Autsch!" + speed to 30%; 3rd crash → tow. */
  crash() {
    if (this.invuln > 0 || this.phase !== 'drive') return;
    this.crashes += 1;
    this.invuln = T.CRASH_INVULN_SEC;
    this.shake = 1;
    this.car.applyCrashPenalty();
    this.ctx.audio.play('crash');
    this.ctx.hud.banner(t('trip.crash'));
    this.gooby.setEmotion('dizzy');
    this.emotionT = 1.5;
    this.updateChip();
    // V2/G21: identical tow rule on the vet trip (§C9.2 "crash rules + tow
    // rule identical to §C4 v1")
    if (isTripMode(this.mode) && this.crashes >= DRIVE.CRASHES_FOR_TOW) {
      this.startTow();
    }
  },

  /** §C4.5 tow-truck cutscene: car placed at the destination, no bonuses. */
  startTow() {
    this.phase = 'tow';
    this.phaseT = 0;
    this.towed = true;
    this.car.setFrozen(true);
    this.ctx.audio.play('tow');
    // V2/G21: destination-specific tow line (§C9.2)
    this.ctx.hud.banner(t(this.mode === 'vetTrip' ? 'vet.towed' : 'trip.towed'));
    // the tow truck rolls up behind the car
    this.truck = this.ctx.assets.getModel('car-kit/truck');
    this.truck.scale.setScalar(T.CAR_SCALE);
    const h = this.car.heading();
    this.truck.position.set(
      this.car.position.x - Math.sin(h) * 18,
      T.ROAD_Y,
      this.car.position.z - Math.cos(h) * 18
    );
    this.truck.rotation.y = h;
    this.ctx.scene.add(this.truck);
    // full-screen fade veil for the teleport (stepped in update)
    this.veil = document.createElement('div');
    this.veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:45;';
    document.body.appendChild(this.veil);
  },

  /** F4 P1-1: nearest sensible road point to drop a wedged car back onto. */
  rescueSpot() {
    const layout = this.layout;
    if (isTripMode(this.mode)) { // V2/G21: vet route rescue works the same
      // back onto the guided route at the driver's current progress (§C4)
      const q = pointAtLength(layout.lane, Math.min(layout.laneLength, this.progress));
      return { x: q.x, z: q.z, heading: Math.atan2(q.dx, q.dz) };
    }
    // arcade: nearest road tile center, keeping the cardinal travel direction
    const p = this.car.position;
    let best = null;
    let bestD = Infinity;
    layout.grid.forEach((row, r) =>
      row.forEach((tile, c) => {
        if (tile.kind !== 'road') return;
        const w = tileToWorld(r, c);
        const d = (w.x - p.x) ** 2 + (w.z - p.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = w;
        }
      })
    );
    const cardinal = Math.round(this.car.heading() / (Math.PI / 2)) * (Math.PI / 2);
    return best
      ? { x: best.x, z: best.z, heading: cardinal }
      : { x: layout.lane[0].x, z: layout.lane[0].z, heading: layout.home.heading };
  },

  /**
   * F4 P1-1 unstick (both modes): sustained throttle-on standstill → short
   * veil dip + teleport back to the nearest road point. Gentle by design —
   * no crash counted, no bonus lost (§C4.5 crash rules stay traffic-only).
   */
  startRescue() {
    if (this.phase !== 'drive' || this.arrived) return;
    this.phase = 'rescue';
    this.phaseT = 0;
    this.rescueDone = false;
    this.car.setFrozen(true);
    this.ctx.audio.play('tow');
    this.gooby.setEmotion('dizzy');
    this.emotionT = 1.5;
    this.veil = document.createElement('div');
    this.veil.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:45;';
    document.body.appendChild(this.veil);
    if (import.meta.env?.DEV) console.info('[cityDrive] wedge detected → rescue started');
  },

  /** Arrival (parking trigger radius 4 m — §C4.3): fanfare, then results. */
  arrive() {
    if (this.arrived) return;
    this.arrived = true;
    this.phase = 'fanfare';
    this.phaseT = 0;
    this.car.setFrozen(true);
    this.gooby.setEmotion('ecstatic');
    this.emotionT = 0;
    this.ctx.audio.play('jingle.arrival');
    // V2/G21: destination-specific arrival line (§C9.2)
    this.ctx.hud.banner(t(this.mode === 'vetTrip' ? 'vet.arrived' : 'trip.arrived'));
    const park = this.layout.shop.parking; // V2/G21: = vet parking on a vetTrip
    this.particles.emit?.('confetti', new THREE.Vector3(park.x, T.ROAD_Y + 3, park.z), { count: 26 });
    const coins = driveRewards({
      mode: this.mode, // V2/G21: same math for both trips (§C9.2)
      pickups: this.collected,
      crashes: this.crashes,
      towed: this.towed,
    });
    this.result = { pickups: this.collected, crashes: this.crashes, towed: this.towed, coins };
    // hand off to the §C4 state machine BEFORE the results screen (rewards
    // are then paid by the framework through the onEnd coins override).
    this.ctx.params.onArrive?.(this.result);
  },

  /**
   * @param {number} dt seconds (framework skips pauses)
   * @param {number} elapsed running seconds
   */
  update(dt, elapsed) {
    const { ctx } = this;
    const layout = this.layout;
    this.invuln = Math.max(0, this.invuln - dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);

    // Gooby is the soul — keep him alive even in the car
    this.gooby.update(dt);
    if (this.emotionT > 0) {
      this.emotionT -= dt;
      if (this.emotionT <= 0) this.gooby.setEmotion('happy');
    }

    // --- phases -------------------------------------------------------------
    if (this.phase === 'tow') {
      this.phaseT += dt;
      // truck rolls in (0–1.2 s), veil fades (1.2–2 s), teleport + fade back
      if (this.truck && this.phaseT < 1.2) {
        const h = this.car.heading();
        const d = 18 - (this.phaseT / 1.2) * 12;
        this.truck.position.set(
          this.car.position.x - Math.sin(h) * d,
          T.ROAD_Y,
          this.car.position.z - Math.cos(h) * d
        );
      }
      if (this.veil) this.veil.style.opacity = String(Math.max(0, Math.min(1, (this.phaseT - 1.2) / 0.7)));
      if (this.phaseT >= 2.1) {
        const park = layout.shop.parking; // V2/G21: = vet parking on a vetTrip (route view)
        this.car.teleport(park.x, park.z, this.parkHeading); // V2/G21: parked facing the building
        if (this.truck) {
          ctx.scene.remove(this.truck);
          this.truck = null;
        }
        this.veil?.remove();
        this.veil = null;
        this.car.updateChaseCam(ctx.camera, 10);
        // V2/FIX-F P2-4 (E12): the §C9.3 landmark scan only ran in phase
        // 'drive' — a towed trip teleports during phase 'tow', so towed
        // arrivals never awarded the destination/landmark stickers. Scan at
        // the tow drop-off too (both destination aprons sit inside their
        // landmark's 15 m trigger — test/cityLayout.test.js proves it).
        this.scanLandmarks(park.x, park.z);
        this.arrive(); // §C4.5: you always reach the shop
      }
    } else if (this.phase === 'fanfare') {
      this.phaseT += dt;
      this.car.update(dt);
      this.particles.update?.(dt);
      if (!this.topcam) this.car.updateChaseCam(ctx.camera, dt, 0);
      if (this.phaseT >= 1.7) {
        this.phase = 'done';
        // V2/G21: + §B3 meta {landmarks, crashes, distanceM} (G23 forwards)
        ctx.onEnd({ score: this.result.coins, coins: this.result.coins, meta: this.buildMeta() });
      }
      return;
    } else if (this.phase === 'rescue') {
      // F4 P1-1: veil dips to black, the car reappears on the nearest road
      // point, veil lifts — then straight back to driving.
      this.phaseT += dt;
      this.traffic.update(dt);
      this.particles.update?.(dt);
      if (this.veil) {
        this.veil.style.opacity = String(
          this.phaseT < 0.45
            ? Math.min(1, this.phaseT / 0.45)
            : Math.max(0, 1 - (this.phaseT - 0.45) / 0.55)
        );
      }
      if (!this.rescueDone && this.phaseT >= 0.45) {
        this.rescueDone = true;
        const spot = this.rescueSpot();
        this.car.teleport(spot.x, spot.z, spot.heading);
        this.invuln = T.CRASH_INVULN_SEC; // no chained traffic hit on re-entry
        if (!this.topcam) this.car.updateChaseCam(ctx.camera, 10);
        if (import.meta.env?.DEV) {
          console.info(`[cityDrive] rescue → road point x=${spot.x.toFixed(1)} z=${spot.z.toFixed(1)}`);
        }
      }
      if (this.phaseT >= 1.05) {
        this.veil?.remove();
        this.veil = null;
        this.car.setFrozen(false);
        this.phase = 'drive';
        this.phaseT = 0;
      }
      return;
    }

    if (this.phase !== 'drive' && this.phase !== 'tow') return;

    // --- driving ------------------------------------------------------------
    if (this.phase === 'drive') {
      if (this.autopilot) this.drivePilot();
      this.car.update(dt);
    }
    this.traffic.update(dt);
    this.particles.update?.(dt);

    // route progress (monotonic arc-length projection onto the lane)
    const p = this.car.position;
    let bestS = this.progress;
    let bestD = Infinity;
    for (let s = this.progress; s <= Math.min(layout.laneLength, this.progress + 26); s += 2) {
      const q = pointAtLength(layout.lane, s);
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bestD) {
        bestD = d;
        bestS = s;
      }
    }
    if (bestD < T.OFF_ROUTE_M) this.progress = bestS;

    // traffic collision (§C4.5) — forgiving 70% AABBs
    if (this.phase === 'drive' && this.invuln <= 0) {
      const hit = this.traffic.checkHit(this.car.aabb(T.TRAFFIC_HITBOX_SCALE));
      if (hit) this.crash();
    }

    // ── V2/G21: landmark triggers + odometer (§C9.3/§C12.1, ANY city mode) ──
    if (this.phase === 'drive') {
      const step = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      if (step < 15) this.distanceM += step; // teleports (tow/rescue) don't count
      this.lastPos.x = p.x;
      this.lastPos.z = p.z;
      this.scanLandmarks(p.x, p.z); // V2/FIX-F P2-4: shared with the tow path
    }
    // ── end V2/G21 ───────────────────────────────────────────────────────────

    // knockable cones/boxes: bonk + small speed loss (never a crash)
    for (const k of this.knockables) {
      if (k.hit) {
        if (k.spin > 0) {
          k.mesh.position.x += k.vx * dt;
          k.mesh.position.z += k.vz * dt;
          k.mesh.position.y = Math.max(T.ROAD_Y, k.mesh.position.y + k.vy * dt);
          k.vy -= 22 * dt;
          k.mesh.rotation.x += k.spin * dt;
          k.spin = Math.max(0, k.spin - dt * 4);
        }
        continue;
      }
      const dx = k.mesh.position.x - p.x;
      const dz = k.mesh.position.z - p.z;
      if (dx * dx + dz * dz < 4.4) {
        k.hit = true;
        const d = Math.hypot(dx, dz) || 1;
        k.vx = (dx / d) * 9;
        k.vz = (dz / d) * 9;
        k.vy = 6;
        k.spin = 9;
        ctx.audio.play('bonk');
        this.car.applyKnockPenalty();
      }
    }

    // coin pickups
    const pr2 = T.PICKUP_RADIUS_M * T.PICKUP_RADIUS_M;
    for (const coin of this.coins) {
      if (!coin.active) continue;
      const dx = coin.x - p.x;
      const dz = coin.z - p.z;
      if (dx * dx + dz * dz < pr2) {
        coin.active = false;
        this.collected += 1;
        ctx.onScore(1);
        ctx.audio.play('coin.get');
        this.particles.emit?.('sparkles', new THREE.Vector3(coin.x, T.ROAD_Y + 1.4, coin.z), { count: 6 });
        // arcade (§C4.7): coins respawn/scatter — reuse the slot elsewhere
        if (this.mode === 'arcade') Object.assign(coin, this.scatterCoins(1)[0]);
      }
    }
    // spin + draw active coins
    const cm = new THREE.Matrix4();
    const cq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), elapsed * 2.4);
    const cs = new THREE.Vector3(1, 1, 1);
    const zero = new THREE.Vector3(0, 0, 0);
    const zeroS = new THREE.Vector3(0.0001, 0.0001, 0.0001);
    let ci = 0;
    for (const coin of this.coins) {
      if (ci >= this.coinMesh.count) break;
      const bob = Math.sin(elapsed * 3 + coin.x * 0.1) * 0.15;
      cm.compose(
        coin.active ? new THREE.Vector3(coin.x, T.ROAD_Y + 1.15 + bob, coin.z) : zero,
        cq,
        coin.active ? cs : zeroS
      );
      this.coinMesh.setMatrixAt(ci++, cm);
    }
    this.coinMesh.instanceMatrix.needsUpdate = true;

    // --- guidance -----------------------------------------------------------
    if (isTripMode(this.mode)) hideNearbyArrows(this.guides, p.x, p.z); // V2/G21
    this.guides.arrows.position.y = Math.sin(elapsed * 2) * 0.3;
    this.guides.ribbonMat.opacity = 0.45 + Math.sin(elapsed * 3) * 0.12;
    this.guides.ring.scale.setScalar(1 + Math.sin(elapsed * 3.2) * 0.07);
    const offRoute = distanceToPolyline(layout.lane, p.x, p.z) > T.OFF_ROUTE_M;
    this.guides.guide.visible = isTripMode(this.mode) && offRoute && this.phase === 'drive'; // V2/G21
    if (this.guides.guide.visible) {
      const target = pointAtLength(layout.lane, this.progress + 8);
      const dir = new THREE.Vector3(target.x - p.x, 0, target.z - p.z).normalize();
      this.guides.guide.position.set(p.x, T.ROAD_Y + 5.4, p.z);
      this.guides.guide.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }

    // --- mode goals ----------------------------------------------------------
    if (isTripMode(this.mode)) { // V2/G21: same arrival logic, vet parking via the route view
      const park = layout.shop.parking;
      const dist = Math.hypot(park.x - p.x, park.z - p.z);
      // HUD "time" shows a friendly ETA (remaining route / current speed)
      const remaining = Math.max(0, layout.laneLength - this.progress);
      ctx.hud.setTime(remaining / Math.max(4, this.car.speed()));
      if (this.phase === 'drive' && dist <= DRIVE.PARKING_RADIUS) this.arrive();
    } else {
      const remaining = DRIVE.ARCADE_DURATION_SEC - elapsed;
      ctx.hud.setTime(remaining);
      if (remaining <= 0 && this.phase === 'drive') {
        this.phase = 'done';
        ctx.onEnd({
          score: this.collected,
          coins: driveRewards({ mode: 'arcade', pickups: this.collected }),
          meta: this.buildMeta(), // V2/G21: landmarks trigger in arcade too (§C9.3)
        });
        return;
      }
    }

    // --- camera + §E10 budget log --------------------------------------------
    if (!this.topcam) this.car.updateChaseCam(ctx.camera, dt, this.shake);
    if (import.meta.env?.DEV) {
      this.drawLogT += dt;
      if (this.drawLogT > 3) {
        this.drawLogT = 0;
        const calls = ctx.renderer?.info?.render?.calls ?? 0;
        console.info(`[cityDrive] draw calls: ${calls} (budget ≤ ${T.DRAW_CALL_BUDGET})`);
      }
    }
  },

  /** Dev autopilot (§G G7 DoD): steer along the lane, brake into corners. */
  drivePilot() {
    const layout = this.layout;
    const p = this.car.position;
    const target = pointAtLength(layout.lane, Math.min(layout.laneLength, this.progress + 11));
    const desired = Math.atan2(target.x - p.x, target.z - p.z);
    const err = wrapAngle(desired - this.car.heading());
    this.car.setSteer(Math.max(-1, Math.min(1, -err * 2.4))); // V4/G57 (§G3.1-a): setSteer(v>0)=screen-right ⇒ heading −, so the heading-error command is negated
    this.car.setBrake(Math.abs(err) > 0.85 && this.car.speed() > 7);
  },

  // ── V2/G21: landmark gag + §B3 meta + §C12.1 distance feed ────────────────
  /**
   * §C9.3 landmark scan at a car position — fires the sticker event once per
   * landmark per run. Runs per-frame in phase 'drive' AND once at the tow
   * drop-off (V2/FIX-F P2-4, E12 — tows teleport outside phase 'drive').
   * @param {number} px @param {number} pz car world position
   */
  scanLandmarks(px, pz) {
    for (const id of landmarksInRange(this.baseLayout.landmarks, px, pz)) {
      if (this.landmarksHit.has(id)) continue;
      this.landmarksHit.add(id);
      // SYNCHRONOUS window event — systems/shopTrip.js awards the sticker
      // (it has store access; this plugin doesn't) and reflects `first`
      // back into detail so the one-time camera-flash gag fires here.
      const ev = new CustomEvent('gooby:landmark', { detail: { id, first: false } });
      window.dispatchEvent(ev);
      if (ev.detail.first) this.cameraFlash();
    }
  },

  /** §C9.3 camera-flash gag — plays once per first-time landmark sticker. */
  cameraFlash() {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;inset:0;background:#fff;opacity:0.85;pointer-events:none;z-index:44;transition:opacity 0.45s ease-out;';
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '0';
    });
    setTimeout(() => el.remove(), 520);
  },

  /** §B3 meta for onEnd: {landmarks: string[], crashes, distanceM}. */
  buildMeta() {
    this.sendDistance();
    return {
      landmarks: [...this.landmarksHit],
      crashes: this.crashes,
      distanceM: Math.round(this.distanceM),
    };
  },

  /**
   * §C12.1 profile.distanceM feed — one event per run (idempotent), consumed
   * by systems/shopTrip.js's store bridge (profileStats.onDistance). Fired
   * from buildMeta (normal ends) and dispose (quit from pause).
   */
  sendDistance() {
    if (this.distanceSent || !(this.distanceM > 0)) return;
    this.distanceSent = true;
    window.dispatchEvent(
      new CustomEvent('gooby:driveDistance', { detail: { meters: Math.round(this.distanceM) } })
    );
  },
  // ── end V2/G21 ──────────────────────────────────────────────────────────────

  dispose() {
    this.sendDistance(); // V2/G21: quit-from-pause still books the odometer
    this.car?.dispose();
    this.traffic?.dispose();
    this.gooby?.dispose();
    this.particles?.dispose?.();
    this.chip?.remove();
    this.chip = null;
    this.veil?.remove();
    this.veil = null;
    this.truck = null;
    this.ctx = null;
    this.layout = null;
    this.baseLayout = null; // V2/G21
    this.landmarksHit = null; // V2/G21
    this.guides = null;
    this.coins = null;
    this.coinMesh = null;
    this.knockables = null;
  },
};

export { CITY_BANDS, buildCity, buildRouteGuides, hideNearbyArrows }; // V2/G28: deliveryRush consumes the shared dusk band table + instanced city assembly + arrow/route-line guides instead of duplicating them (§C1.2 #5, §C1.3, §C9.4)
export const controls = Object.freeze({ invertible: true }); // V4/G57 (§G2.1 rule 4, §G3.3): global „Steuerung invertieren“ applies (G56 proxy / carController invertSteer param)
