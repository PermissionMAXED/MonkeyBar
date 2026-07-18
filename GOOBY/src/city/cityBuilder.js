// City builder (§G G7, §C6.1 #1): the seeded 9×9 tile city (20 m tiles) the
// shop drive happens in — ring + cross road layout from §D1 city-kit-roads
// tiles, city-kit-commercial buildings on the block tiles, nature-kit filler
// on the outer rim, and the SHOP (building-c + detail-awning + parking apron)
// as a distinct destination at the fixed route end.
//
// This module is PURE — no three.js/DOM imports — so test/cityLayout.test.js
// runs it headlessly under node:test (same pattern as home/rooms/*.js). The
// exported layout is plain data: tile grid, route waypoints, world-space lane
// polyline, POIs (home/shop/parking), pickups, traffic loops, building/nature/
// prop placements with GLB asset keys. The three.js assembly of this data
// lives in minigames/games/cityDrive.js (buildCity there consumes it), the
// player car in city/carController.js and the AI cars in city/traffic.js.
//
// Layout (grid rows r 0..8 = north→south, cols c 0..8 = west→east):
//   ring road    r∈{1,7}, c 1..7  and  c∈{1,7}, r 1..7
//   cross roads  r=4, c 1..7  and  c=4, r 1..7
//   blocks       the four 2×2 areas between ring and cross (buildings)
//   rim          r∈{0,8} or c∈{0,8} (grass + nature filler + home house)
// The route (fixed, §C4 "shop at a fixed route end") snakes home→shop across
// ~26 tiles; the seed varies buildings, nature, crossings and props only.

import { DRIVE, DRIVE_TUNING, VET } from '../data/constants.js'; // V2/G21: + VET (§C9)

const { GRID, TILE_M, LANE_OFFSET_M } = DRIVE_TUNING;
/** Grid center index (tile (CENTER,CENTER) is the world origin). */
const CENTER = (GRID - 1) / 2;

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32 — same recipe as minigames/framework.js createRng,
// duplicated here so this module stays dependency-free and pure).
// ---------------------------------------------------------------------------

/**
 * @param {number} seed
 * @returns {() => number} deterministic 0..1 stream
 */
export function createLayoutRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tile / world helpers (pure math, exported for car/traffic/tests)
// ---------------------------------------------------------------------------

/**
 * Tile (r, c) → world center {x, z}. x grows east (+c), z grows south (+r).
 * @param {number} r @param {number} c
 * @returns {{x: number, z: number}}
 */
export function tileToWorld(r, c) {
  return { x: (c - CENTER) * TILE_M, z: (r - CENTER) * TILE_M };
}

/**
 * World {x, z} → containing tile {r, c} (may be outside 0..GRID-1).
 * @param {number} x @param {number} z
 * @returns {{r: number, c: number}}
 */
export function worldToTile(x, z) {
  return { r: Math.round(z / TILE_M + CENTER), c: Math.round(x / TILE_M + CENTER) };
}

/**
 * Offset a world polyline sideways (positive = right of travel direction,
 * right-hand traffic). Corners use an averaged-direction miter so the lane
 * stays parallel through 90° bends.
 * @param {Array<{x: number, z: number}>} pts centerline points
 * @param {number} offset meters (e.g. DRIVE_TUNING.LANE_OFFSET_M)
 * @param {boolean} [closed] treat as a closed loop (traffic lanes)
 * @returns {Array<{x: number, z: number}>}
 */
export function laneOffsetPolyline(pts, offset, closed = false) {
  const n = pts.length;
  /** Unit direction from point i to point j (or east when degenerate). */
  const dir = (i, j) => {
    const dx = pts[j].x - pts[i].x;
    const dz = pts[j].z - pts[i].z;
    const len = Math.hypot(dx, dz);
    return len > 0 ? { x: dx / len, z: dz / len } : { x: 1, z: 0 };
  };
  const out = [];
  for (let i = 0; i < n; i++) {
    const hasIn = closed || i > 0;
    const hasOut = closed || i < n - 1;
    const dIn = hasIn ? dir((i - 1 + n) % n, i) : dir(i, (i + 1) % n);
    const dOut = hasOut ? dir(i, (i + 1) % n) : dir((i - 1 + n) % n, i);
    let ax = dIn.x + dOut.x;
    let az = dIn.z + dOut.z;
    const alen = Math.hypot(ax, az) || 1;
    ax /= alen;
    az /= alen;
    // right of travel (view from above, x east / z south): (-dz, dx)
    const rx = -az;
    const rz = ax;
    // miter: keep the offset segments parallel through corners
    const cosHalf = Math.max(0.5, ax * dOut.x + az * dOut.z);
    const scale = 1 / cosHalf;
    out.push({ x: pts[i].x + rx * offset * scale, z: pts[i].z + rz * offset * scale });
  }
  return out;
}

/**
 * Total length of a polyline (m).
 * @param {Array<{x: number, z: number}>} pts
 * @param {boolean} [closed]
 * @returns {number}
 */
export function polylineLength(pts, closed = false) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  if (closed && pts.length > 1) {
    len += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z);
  }
  return len;
}

/**
 * Point + direction at arc length s along a polyline.
 * @param {Array<{x: number, z: number}>} pts
 * @param {number} s meters (clamped; wraps when closed)
 * @param {boolean} [closed]
 * @returns {{x: number, z: number, dx: number, dz: number}}
 */
export function pointAtLength(pts, s, closed = false) {
  const total = polylineLength(pts, closed);
  if (closed) s = ((s % total) + total) % total;
  else s = Math.max(0, Math.min(total, s));
  const n = pts.length;
  const segs = closed ? n : n - 1;
  let acc = 0;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + len >= s || i === segs - 1) {
      const f = len > 0 ? (s - acc) / len : 0;
      return {
        x: a.x + (b.x - a.x) * f,
        z: a.z + (b.z - a.z) * f,
        dx: len > 0 ? (b.x - a.x) / len : 1,
        dz: len > 0 ? (b.z - a.z) / len : 0,
      };
    }
    acc += len;
  }
  const last = pts[n - 1];
  return { x: last.x, z: last.z, dx: 1, dz: 0 };
}

/**
 * Distance from a point to a polyline (m) — off-route detection + tests.
 * @param {Array<{x: number, z: number}>} pts
 * @param {number} x @param {number} z
 * @returns {number}
 */
export function distanceToPolyline(pts, x, z) {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x, az = pts[i - 1].z;
    const bx = pts[i].x, bz = pts[i].z;
    const abx = bx - ax, abz = bz - az;
    const len2 = abx * abx + abz * abz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / len2)) : 0;
    const px = ax + abx * t, pz = az + abz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Road network (fixed ring + cross per §G G7)
// ---------------------------------------------------------------------------

const RING_MIN = 1;
const RING_MAX = GRID - 2; // 7

/** @param {number} r @param {number} c @returns {boolean} */
function isRoad(r, c) {
  if (r < RING_MIN || r > RING_MAX || c < RING_MIN || c > RING_MAX) return false;
  const onRing = r === RING_MIN || r === RING_MAX || c === RING_MIN || c === RING_MAX;
  const onCross = r === CENTER || c === CENTER;
  return onRing || onCross;
}

/** @param {object[][]} grid @param {number} r @param {number} c @returns {boolean} */
export function isRoadTile(grid, r, c) {
  return grid[r]?.[c]?.kind === 'road';
}

/**
 * Fixed route home→shop (§C4 "fixed route end"): south ring east → east ring
 * north to the cross → cross west → west ring north → north ring east → two
 * tiles south to the shop. ~26 waypoints ≈ 500 m of guided driving, no tile
 * visited twice.
 */
const ROUTE_TILES = Object.freeze([
  [7, 2], [7, 3], [7, 4], [7, 5], [7, 6], [7, 7],
  [6, 7], [5, 7], [4, 7],
  [4, 6], [4, 5], [4, 4], [4, 3], [4, 2], [4, 1],
  [3, 1], [2, 1], [1, 1],
  [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7],
  [2, 7], [3, 7],
].map((rc) => Object.freeze(rc)));

/** Home start tile and the shop block tile (fixed POIs). */
const HOME_TILE = Object.freeze([7, 2]);
const SHOP_TILE = Object.freeze([3, 6]); // block tile west of the final waypoint (3,7)

// ── V2/G21: vet clinic + landmarks (§C9) ────────────────────────────────────
/** Vet clinic block tile (§C9.1: north-west block, west-ring purpose). */
const VET_TILE = Object.freeze([2, 2]);
/**
 * Fixed vet route (§C9.1 VET_ROUTE_TILES): home → west along the south ring →
 * north up the west ring, then pull east into the parking apron. ≈ 7 tiles
 * ≈ 140 m — deliberately shorter than the shop trip (sick Gooby shouldn't
 * grind). No tile visited twice.
 */
const VET_ROUTE_TILES = Object.freeze([
  [7, 2], [7, 1], [6, 1], [5, 1], [4, 1], [3, 1], [2, 1],
].map((rc) => Object.freeze(rc)));

/**
 * Landmark table (§C9.3, sticker ids = §C6 set 3). `anchor` is the curbside
 * trigger point (world m — within 15 m of the shop/vet driving lanes so every
 * sticker is earnable from a guided trip; deliveryRush reuses them as parcel
 * drop points, §C9.4). `at` is the visual dressing center on the block tile
 * (consumed by city/vetClinic.js builders). shop/vetClinic anchors are their
 * parking aprons — resolved inside generateCityLayout.
 */
const LANDMARK_SPOTS = Object.freeze([
  Object.freeze({ id: 'fountain', anchor: Object.freeze({ x: 12, z: 12 }), at: Object.freeze({ x: 14.5, z: 14.5 }) }),
  Object.freeze({ id: 'skyTower', anchor: Object.freeze({ x: 20, z: -46 }), at: Object.freeze({ x: 20, z: -42 }) }),
  Object.freeze({ id: 'parkGazebo', anchor: Object.freeze({ x: -46, z: 20 }), at: Object.freeze({ x: -42.5, z: 20 }) }),
  Object.freeze({ id: 'windmillCafe', anchor: Object.freeze({ x: 20, z: 48 }), at: Object.freeze({ x: 20, z: 43.5 }) }),
]);

/** §C9.3: the windmillCafe's minigolf-kit windmill scale (binding ×2.2). */
const WINDMILL_SCALE = 2.2;

/** Block tiles reserved for landmark dressing — no seeded buildings there. */
const LANDMARK_TILES = Object.freeze([
  VET_TILE, // vetClinic
  Object.freeze([5, 5]), // fountain plaza
  Object.freeze([2, 5]), // skyTower
  Object.freeze([5, 2]), // parkGazebo
  Object.freeze([6, 5]), // windmillCafe
]);
// ── end V2/G21 ──────────────────────────────────────────────────────────────

/** Traffic lane loops (closed tile cycles, clockwise = right-hand traffic). */
const TRAFFIC_LOOP_CORNERS = Object.freeze([
  // full ring, clockwise
  Object.freeze([[1, 1], [1, 7], [7, 7], [7, 1]]),
  // full ring, counter-clockwise
  Object.freeze([[1, 1], [7, 1], [7, 7], [1, 7]]),
  // north-west quadrant (ring + cross), clockwise
  Object.freeze([[1, 1], [1, 4], [4, 4], [4, 1]]),
  // south-east quadrant, clockwise
  Object.freeze([[4, 4], [4, 7], [7, 7], [7, 4]]),
]);

/**
 * Expand corner tiles into a full closed tile path (every tile on the way).
 * @param {ReadonlyArray<ReadonlyArray<number>>} corners
 * @returns {Array<[number, number]>}
 */
function expandLoop(corners) {
  const tiles = [];
  for (let i = 0; i < corners.length; i++) {
    const [r0, c0] = corners[i];
    const [r1, c1] = corners[(i + 1) % corners.length];
    const dr = Math.sign(r1 - r0);
    const dc = Math.sign(c1 - c0);
    let r = r0, c = c0;
    while (r !== r1 || c !== c1) {
      tiles.push([r, c]);
      r += dr;
      c += dc;
    }
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Model catalogs (asset keys + authored footprints, from the committed GLBs)
// ---------------------------------------------------------------------------

/** Building palette: authored half-extents (units) baked from GLB bounds. */
const BUILDINGS = Object.freeze({
  'building-a': Object.freeze({ hw: 0.44, hd: 0.47 }),
  'building-b': Object.freeze({ hw: 0.49, hd: 0.47 }),
  'building-c': Object.freeze({ hw: 0.44, hd: 0.55 }),
  'building-d': Object.freeze({ hw: 0.42, hd: 0.45 }),
  'building-e': Object.freeze({ hw: 0.82, hd: 0.51 }),
  'building-f': Object.freeze({ hw: 0.42, hd: 0.52 }),
  'building-g': Object.freeze({ hw: 0.49, hd: 0.46 }),
  'building-h': Object.freeze({ hw: 0.44, hd: 0.51 }),
  'building-skyscraper-a': Object.freeze({ hw: 0.68, hd: 0.68 }),
  'low-detail-building-a': Object.freeze({ hw: 0.25, hd: 0.25 }),
  'low-detail-building-d': Object.freeze({ hw: 0.25, hd: 0.25 }),
  'low-detail-building-e': Object.freeze({ hw: 0.25, hd: 0.25 }),
});

/** Main street-facing building rotation candidates per block quadrant. */
const MAIN_BUILDING_IDS = Object.freeze([
  'building-a', 'building-b', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h',
]);
const TOWER_IDS = Object.freeze(['low-detail-building-a', 'low-detail-building-d', 'low-detail-building-e']);

/** Nature filler palette (nature-kit whitelist §D1). */
const TREE_IDS = Object.freeze(['tree_default', 'tree_oak', 'tree_fat', 'tree_pineRoundA']);
const SHRUB_IDS = Object.freeze(['plant_bush', 'rock_smallA', 'flower_redA', 'flower_yellowA']);

/** V3/G46 (§C11.1): real sidewalk props, batched by key in buildCity(). */
export const CITY_DRESSING_KEYS = Object.freeze([
  'kaykit-city/streetlight',
  'kaykit-city/firehydrant',
  'kaykit-city/dumpster',
  'kaykit-city/bench',
  'kaykit-city/trash_A',
  'kaykit-city/trash_B',
]);

/** V3/G46 (§C11.1): six mini-market display props at the shop destination. */
export const SHOP_DRESSING_KEYS = Object.freeze([
  'kaykit-restaurant/crate',
  'kaykit-restaurant/crate_buns',
  'kaykit-restaurant/crate_tomatoes',
  'kaykit-restaurant/crate_carrots',
  'kaykit-city/box_A',
  'kaykit-city/box_B',
]);

/** Every GLB asset key the built city needs (preloaded by cityDrive). */
export const CITY_ASSET_KEYS = Object.freeze([
  'city-kit-roads/road-straight',
  'city-kit-roads/road-bend',
  'city-kit-roads/road-intersection',
  'city-kit-roads/road-crossroad',
  'city-kit-roads/road-crossing',
  'city-kit-roads/tile-low',
  'city-kit-roads/light-square-double',
  'city-kit-roads/construction-barrier',
  ...MAIN_BUILDING_IDS.map((id) => `city-kit-commercial/${id}`),
  'city-kit-commercial/building-c',
  'city-kit-commercial/building-skyscraper-a',
  ...TOWER_IDS.map((id) => `city-kit-commercial/${id}`),
  'city-kit-commercial/detail-awning',
  ...TREE_IDS.map((id) => `nature-kit/${id}`),
  ...SHRUB_IDS.map((id) => `nature-kit/${id}`),
  'car-kit/cone',
  'car-kit/box',
  'minigolf-kit/windmill', // V2/G21: windmillCafe landmark (§C9.3, in layout.buildings)
  ...CITY_DRESSING_KEYS,
  ...SHOP_DRESSING_KEYS,
]);

// ---------------------------------------------------------------------------
// Road piece classification (connectivity → GLB piece + rotY)
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

// ── V3/G39 (§C7.1): PIECE_PORTS truth table + search-based roadPieceFor ─────
// The v1 orientation ladder guessed the GLB authoring ("road-straight runs
// N–S at rotY 0") and rotated with the wrong sign — 28 of the 33 road tiles
// rendered misrotated (every straight/zebra 90° off, bends [1,1]/[7,7] and
// T's [4,1]/[4,7] 180° off): the product owner's „die Straße passt nicht".
// This table is the TRUE authored open-port sides per §C7.1-1, read off the
// `?scene=roadtest` render (dev harness; evidence in the G39 report) and
// cross-checked with a raycast+colormap probe over the same live scene.

/**
 * TRUE open port sides (road surface meeting the tile edge) of each Kenney
 * city-kit-roads GLB at rotY 0. `road-crossing` shares `road-straight`'s
 * authoring, so the §C7.1 zebra substitution inherits the straight's
 * orientation correctly (locked by test/cityRoads.test.js).
 * Frozen module-local per §E0.1-3 — constants.js is read-only.
 * @type {Readonly<Record<string, ReadonlyArray<'N'|'E'|'S'|'W'>>>}
 */
export const PIECE_PORTS = Object.freeze({
  'road-straight': Object.freeze(['W', 'E']),
  'road-bend': Object.freeze(['S', 'W']),
  'road-intersection': Object.freeze(['E', 'S', 'W']),
  'road-crossroad': Object.freeze(['N', 'E', 'S', 'W']),
  'road-crossing': Object.freeze(['W', 'E']),
});

/** One +90° three.js rotY quarter turn maps ports N→W→S→E→N (R_y(θ)). */
const PORT_TURN = Object.freeze({ N: 'W', W: 'S', S: 'E', E: 'N' });

/**
 * Rotate a set of port sides by `quarterTurns` × +90° rotY.
 * @param {ReadonlyArray<'N'|'E'|'S'|'W'>} ports
 * @param {number} quarterTurns 0..3 (positive rotY quarter turns)
 * @returns {Array<'N'|'E'|'S'|'W'>}
 */
export function rotatePorts(ports, quarterTurns) {
  const q = ((Math.round(quarterTurns) % 4) + 4) % 4;
  return ports.map((p) => {
    let out = p;
    for (let i = 0; i < q; i++) out = PORT_TURN[out];
    return out;
  });
}

/**
 * Open ports of a PLACED tile — piece rotated by its grid rotY (radians).
 * Consumed by test/cityRoads.test.js and G44's deliveryRush audit.
 * @param {string} piece PIECE_PORTS key
 * @param {number} rotY radians (multiple of 90°)
 * @returns {Array<'N'|'E'|'S'|'W'>}
 */
export function portsOf(piece, rotY) {
  return rotatePorts(PIECE_PORTS[piece] ?? [], Math.round(rotY / (90 * DEG)));
}

/** Deterministic search order (crossing is a seeded straight substitution). */
const SEARCH_PIECES = Object.freeze([
  'road-straight', 'road-bend', 'road-intersection', 'road-crossroad',
]);

/**
 * Pick the road GLB + Y rotation for a road tile from its N/E/S/W road
 * neighbors: SEARCH (piece × quarter turn) for the rotation whose rotated
 * PIECE_PORTS equal the tile's connectivity set — deterministic (fixed
 * search order, first match wins), no special-case ladder (§C7.1-2).
 * @param {boolean} n @param {boolean} e @param {boolean} s @param {boolean} w
 * @returns {{piece: string, rotY: number}}
 */
export function roadPieceFor(n, e, s, w) {
  const want = [n && 'N', e && 'E', s && 'S', w && 'W'].filter(Boolean).sort().join('');
  for (const piece of SEARCH_PIECES) {
    for (let q = 0; q < 4; q++) {
      const got = rotatePorts(PIECE_PORTS[piece], q).sort().join('');
      if (got === want) return { piece, rotY: q * 90 * DEG };
    }
  }
  // 0/1-port tiles don't occur in the ring+cross network; safe default:
  // a straight oriented along the one existing neighbor (W–E authored base).
  return { piece: 'road-straight', rotY: n || s ? 90 * DEG : 0 };
}
// ── end V3/G39 ──────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// generateCityLayout — THE pure seeded generator (§G G7 test surface)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CityLayout
 * @property {number} seed
 * @property {Array<Array<{kind: 'road'|'block'|'grass', piece?: string, rotY?: number}>>} grid 9×9
 * @property {Array<{r: number, c: number}>} route  home→shop tile waypoints
 * @property {Array<{x: number, z: number}>} routeCenter  world centerline polyline
 * @property {Array<{x: number, z: number}>} lane  right-lane world polyline (drive + pickups + guides)
 * @property {number} laneLength  arc length of `lane` (m)
 * @property {{tile: {r: number, c: number}, world: {x: number, z: number}, heading: number}} home
 * @property {{tile: {r: number, c: number}, buildingAt: {x: number, z: number}, rotY: number,
 *   parking: {x: number, z: number}, awningAt: {x: number, z: number}}} shop
 * @property {{tile: {r: number, c: number}, buildingAt: {x: number, z: number}, rotY: number,
 *   parking: {x: number, z: number}, heading: number}} vet  V2/G21 §C9.1/§B3
 * @property {Array<{r: number, c: number}>} vetRoute  V2/G21: home→vet tile waypoints
 * @property {Array<{x: number, z: number}>} vetRouteCenter  V2/G21 centerline
 * @property {Array<{x: number, z: number}>} vetLane  V2/G21 right-lane polyline
 * @property {number} vetLaneLength  V2/G21 arc length (m)
 * @property {Array<{x: number, z: number}>} vetPickups  V2/G21 §C9.2: 10 coins
 * @property {Array<{id: string, x: number, z: number, at: {x: number, z: number}}>} landmarks
 *   V2/G21 §C9.3: 6 sticker landmarks — x/z = curbside trigger/delivery anchor,
 *   `at` = visual dressing center (city/vetClinic.js builders)
 * @property {Array<{x: number, z: number}>} pickups  §C4.3: 20 coins on route
 * @property {Array<Array<[number, number]>>} trafficLoops  closed tile cycles
 * @property {Array<{key: string, x: number, z: number, rotY: number, scale: number,
 *   halfX: number, halfZ: number}>} buildings  incl. AABB half-extents (m)
 * @property {Array<{key: string, x: number, z: number, rotY: number, scale: number,
 *   area?: 'cityDressing'|'shopMarket'}>} nature  nature + instanced static dressing
 * @property {Array<{key: string, kind: 'cone'|'box'|'barrier', x: number, z: number, rotY: number}>} props
 * @property {Array<{x: number, z: number, rotY: number}>} lamps
 */

/**
 * Deterministic city from a seed (§G G7). Same seed → identical layout; the
 * seed varies buildings, nature filler, zebra crossings and props — roads,
 * route, home and shop are fixed (§C4 "fixed route end").
 * @param {number} seed
 * @returns {CityLayout}
 */
export function generateCityLayout(seed) {
  const rng = createLayoutRng(seed);

  // --- grid: road / block / grass -----------------------------------------
  /** @type {CityLayout['grid']} */
  const grid = [];
  for (let r = 0; r < GRID; r++) {
    const row = [];
    for (let c = 0; c < GRID; c++) {
      if (isRoad(r, c)) row.push({ kind: 'road' });
      else if (r > RING_MIN && r < RING_MAX && c > RING_MIN && c < RING_MAX) row.push({ kind: 'block' });
      else row.push({ kind: 'grass' });
    }
    grid.push(row);
  }

  // road pieces from connectivity
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (grid[r][c].kind !== 'road') continue;
      const { piece, rotY } = roadPieceFor(
        isRoad(r - 1, c), isRoad(r, c + 1), isRoad(r + 1, c), isRoad(r, c - 1)
      );
      grid[r][c].piece = piece;
      grid[r][c].rotY = rotY;
    }
  }

  // seeded zebra crossings: straights right next to a 3/4-way node (~40%)
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const t = grid[r][c];
      if (t.kind !== 'road' || t.piece !== 'road-straight') continue;
      const nearNode = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].some(([rr, cc]) => {
        const p = grid[rr]?.[cc]?.piece;
        return p === 'road-intersection' || p === 'road-crossroad';
      });
      if (nearNode && rng() < 0.4) t.piece = 'road-crossing';
    }
  }

  // --- route + lane polylines ----------------------------------------------
  const route = ROUTE_TILES.map(([r, c]) => ({ r, c }));
  const routeCenter = route.map(({ r, c }) => tileToWorld(r, c));
  const homeWorld = tileToWorld(HOME_TILE[0], HOME_TILE[1]);

  // shop: building on the west half of the block tile, front facing east
  // toward the final waypoint (3,7); the parking apron sits on the tile's
  // east half so the car pulls off the road into it.
  const shopWorld = tileToWorld(SHOP_TILE[0], SHOP_TILE[1]);
  const shopBuildingAt = { x: shopWorld.x - 5, z: shopWorld.z };
  const shopRotY = 90 * DEG; // authored front (+z) → east (+x)
  const parking = { x: shopWorld.x + 6.5, z: shopWorld.z };
  const awningAt = { x: shopBuildingAt.x + 0.55 * DRIVE_TUNING.BUILDING_SCALE, z: shopWorld.z };

  // driving lane (right of centerline) + a final approach into the parking
  const lane = laneOffsetPolyline(routeCenter, LANE_OFFSET_M, false);
  lane.push({ x: parking.x, z: parking.z });
  const laneLength = polylineLength(lane);

  // --- pickups: 20 coins evenly along the lane (§C4.3) ---------------------
  const pickups = [];
  const first = 40;
  const last = laneLength - 18;
  for (let i = 0; i < DRIVE.PICKUP_COUNT; i++) {
    const s = first + ((last - first) * i) / (DRIVE.PICKUP_COUNT - 1);
    const p = pointAtLength(lane, s);
    pickups.push({ x: p.x, z: p.z });
  }

  // ── V2/G21: vet clinic route + parking (§C9.1) ────────────────────────────
  // Building on the EAST half of the tile, front facing west toward ring
  // column 1 (rotY −90°); parking apron on the tile's west half so the car
  // pulls east off the west ring into it (mirror of the shop recipe).
  const vetWorld = tileToWorld(VET_TILE[0], VET_TILE[1]);
  const vetBuildingAt = { x: vetWorld.x + 5, z: vetWorld.z };
  const vetRotY = -90 * DEG; // authored front (+z) → west (−x)
  const vetParking = { x: vetWorld.x - 6.5, z: vetWorld.z };

  const vetRoute = VET_ROUTE_TILES.map(([r, c]) => ({ r, c }));
  const vetRouteCenter = vetRoute.map(({ r, c }) => tileToWorld(r, c));
  const vetLane = laneOffsetPolyline(vetRouteCenter, LANE_OFFSET_M, false);
  vetLane.push({ x: vetParking.x, z: vetParking.z });
  const vetLaneLength = polylineLength(vetLane);
  const vetStart = pointAtLength(vetLane, 0);
  const vetHeading = Math.atan2(vetStart.dx, vetStart.dz); // car spawn: west

  // §C9.2: 10 coin pickups on the vet route (instead of the shop trip's 20)
  const vetPickups = [];
  const vetFirst = 24;
  const vetLast = vetLaneLength - 16;
  for (let i = 0; i < VET.ROUTE_PICKUP_COUNT; i++) {
    const s = vetFirst + ((vetLast - vetFirst) * i) / (VET.ROUTE_PICKUP_COUNT - 1);
    const p = pointAtLength(vetLane, s);
    vetPickups.push({ x: p.x, z: p.z });
  }

  // §C9.3 landmarks: shop + vet anchors are their parking aprons (triggered
  // by every arrival); the other four sit curbside on reserved block tiles.
  const landmarks = [
    { id: 'shop', x: parking.x, z: parking.z, at: { ...shopBuildingAt } },
    { id: 'vetClinic', x: vetParking.x, z: vetParking.z, at: { ...vetBuildingAt } },
    ...LANDMARK_SPOTS.map((s) => ({ id: s.id, x: s.anchor.x, z: s.anchor.z, at: { ...s.at } })),
  ];
  const isLandmarkTile = (r, c) => LANDMARK_TILES.some(([lr, lc]) => lr === r && lc === c);
  // ── end V2/G21 ─────────────────────────────────────────────────────────────

  // --- buildings on block tiles --------------------------------------------
  const buildings = [];
  const scaleB = DRIVE_TUNING.BUILDING_SCALE;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (grid[r][c].kind !== 'block') continue;
      if (r === SHOP_TILE[0] && c === SHOP_TILE[1]) continue; // shop tile stays clear
      if (isLandmarkTile(r, c)) continue; // V2/G21: vet + landmark tiles stay clear (§C9.3)
      const { x, z } = tileToWorld(r, c);
      // face the nearest road: pick the closest road neighbor direction
      const facings = [];
      if (isRoad(r - 1, c)) facings.push(180 * DEG); // north
      if (isRoad(r + 1, c)) facings.push(0); //          south
      if (isRoad(r, c + 1)) facings.push(90 * DEG); //   east
      if (isRoad(r, c - 1)) facings.push(270 * DEG); //  west
      const rotY = facings.length > 0 ? facings[Math.floor(rng() * facings.length)] : 0;
      // center blocks get a skyscraper flavor sometimes
      const nearCenter = Math.abs(r - CENTER) <= 1 || Math.abs(c - CENTER) <= 1;
      const key = nearCenter && rng() < 0.35
        ? 'building-skyscraper-a'
        : MAIN_BUILDING_IDS[Math.floor(rng() * MAIN_BUILDING_IDS.length)];
      const b = BUILDINGS[key];
      const rot90 = Math.round(rotY / (90 * DEG)) % 2 !== 0;
      buildings.push({
        key: `city-kit-commercial/${key}`,
        x, z, rotY, scale: scaleB,
        halfX: (rot90 ? b.hd : b.hw) * scaleB,
        halfZ: (rot90 ? b.hw : b.hd) * scaleB,
      });
      // small background tower in a back corner of some tiles
      if (rng() < 0.45) {
        const tKey = TOWER_IDS[Math.floor(rng() * TOWER_IDS.length)];
        const tb = BUILDINGS[tKey];
        const ts = scaleB * 0.9;
        const tx = x + (rng() < 0.5 ? -6.5 : 6.5);
        const tz = z + (rng() < 0.5 ? -6.5 : 6.5);
        buildings.push({
          key: `city-kit-commercial/${tKey}`,
          x: tx, z: tz, rotY: 0, scale: ts,
          halfX: tb.hw * ts, halfZ: tb.hd * ts,
        });
      }
    }
  }
  // the shop itself (building-c per §G G7)
  const shopB = BUILDINGS['building-c'];
  buildings.push({
    key: 'city-kit-commercial/building-c',
    x: shopBuildingAt.x, z: shopBuildingAt.z, rotY: shopRotY, scale: scaleB,
    halfX: shopB.hd * scaleB, halfZ: shopB.hw * scaleB,
  });

  // ── V2/G21: fixed landmark buildings (§C9.1/§C9.3, deterministic) ─────────
  // The vet clinic (building-e, west-facing — ±90° swaps the half extents).
  const vetB = BUILDINGS['building-e'];
  buildings.push({
    key: 'city-kit-commercial/building-e',
    x: vetBuildingAt.x, z: vetBuildingAt.z, rotY: vetRotY, scale: scaleB,
    halfX: vetB.hd * scaleB, halfZ: vetB.hw * scaleB,
  });
  // skyTower: building-skyscraper-a on block [2,5] (§C9.3)
  const towerB = BUILDINGS['building-skyscraper-a'];
  const towerAt = landmarks.find((l) => l.id === 'skyTower').at;
  buildings.push({
    key: 'city-kit-commercial/building-skyscraper-a',
    x: towerAt.x, z: towerAt.z, rotY: 0, scale: scaleB,
    halfX: towerB.hw * scaleB, halfZ: towerB.hd * scaleB,
  });
  // windmillCafe: minigolf-kit windmill ×2.2 (§C9.3; café dressing in
  // city/vetClinic.js) — instanced + collidable like every other building.
  const millAt = landmarks.find((l) => l.id === 'windmillCafe').at;
  buildings.push({
    key: 'minigolf-kit/windmill',
    x: millAt.x, z: millAt.z, rotY: 180 * DEG, scale: WINDMILL_SCALE,
    halfX: 0.6 * WINDMILL_SCALE, halfZ: 0.5 * WINDMILL_SCALE,
  });
  // ── end V2/G21 ─────────────────────────────────────────────────────────────

  // --- nature filler on the rim ---------------------------------------------
  const nature = [];
  const scaleT = DRIVE_TUNING.TREE_SCALE;
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      if (grid[r][c].kind !== 'grass') continue;
      if (r === HOME_TILE[0] + 1 && c === HOME_TILE[1]) continue; // home garden tile
      const { x, z } = tileToWorld(r, c);
      const trees = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < trees; i++) {
        nature.push({
          key: `nature-kit/${TREE_IDS[Math.floor(rng() * TREE_IDS.length)]}`,
          x: x + (rng() - 0.5) * 14, z: z + (rng() - 0.5) * 14,
          rotY: rng() * Math.PI * 2, scale: scaleT * (0.8 + rng() * 0.5),
        });
      }
      if (rng() < 0.7) {
        nature.push({
          key: `nature-kit/${SHRUB_IDS[Math.floor(rng() * SHRUB_IDS.length)]}`,
          x: x + (rng() - 0.5) * 14, z: z + (rng() - 0.5) * 14,
          rotY: rng() * Math.PI * 2, scale: scaleT,
        });
      }
    }
  }

  // ── V3/G46 (§C11.1): real city + shop dressing ---------------------------
  // buildCity already batches layout.nature by model key into InstancedMesh,
  // so feeding static scenery through that existing path adds one draw call
  // per distinct model (never one per placement). These are visual-only:
  // gameplay colliders and all lane/road geometry remain data-driven above.
  const dressing = [
    {
      key: 'kaykit-city/streetlight', scale: 9,
      spots: [[-52, -52], [52, -52], [52, 52], [-52, 52], [-8, -52], [8, 52], [-52, 8], [52, -8]],
    },
    {
      key: 'kaykit-city/bench', scale: 5,
      spots: [[-28, -52], [28, 52], [-52, -28], [52, 28]],
    },
    {
      key: 'kaykit-city/firehydrant', scale: 5,
      spots: [[8, -28], [-8, 28], [28, 8]],
    },
    {
      key: 'kaykit-city/dumpster', scale: 5,
      spots: [[-28, -8], [28, -8]],
    },
    {
      key: 'kaykit-city/trash_A', scale: 4.5,
      spots: [[-42, -52], [42, 52], [-52, 42], [52, -22]],
    },
    {
      key: 'kaykit-city/trash_B', scale: 5,
      spots: [[-18, -52], [18, 52], [-52, 18], [52, -42]],
    },
  ];
  for (const recipe of dressing) {
    for (const [x, z] of recipe.spots) {
      nature.push({
        key: recipe.key,
        x: x + (rng() - 0.5) * 0.7,
        z: z + (rng() - 0.5) * 0.7,
        rotY: rng() * Math.PI * 2,
        scale: recipe.scale,
        area: 'cityDressing',
      });
    }
  }

  // The app has no separate 3D shop-interior scene: arrival opens the DOM
  // shop screen over this destination. Six real crates/boxes therefore form
  // a readable mini-market display along the shop's street-facing façade,
  // visible during arrival while preserving the identical shop handoff.
  const shopDisplay = [
    ['kaykit-restaurant/crate', 41.7, -24.0, 0.62],
    ['kaykit-restaurant/crate_buns', 41.7, -21.4, 0.62],
    ['kaykit-restaurant/crate_tomatoes', 41.7, -18.6, 0.62],
    ['kaykit-restaurant/crate_carrots', 41.7, -16.0, 0.62],
    ['kaykit-city/box_A', 43.2, -23.0, 5.5],
    ['kaykit-city/box_B', 43.2, -17.0, 5.5],
  ];
  for (const [key, x, z, scale] of shopDisplay) {
    nature.push({
      key, x, z,
      rotY: (rng() - 0.5) * 0.35,
      scale,
      area: 'shopMarket',
    });
  }
  // ── end V3/G46 ------------------------------------------------------------

  // --- props: cones / boxes / barriers near the route (§C6.1 obstacles) ----
  const props = [];
  const propSpots = 8;
  for (let i = 0; i < propSpots; i++) {
    const s = 70 + ((laneLength - 140) * i) / (propSpots - 1) + (rng() - 0.5) * 20;
    const p = pointAtLength(lane, s);
    // keep clear of pickups so obstacles never punish collecting
    const nearPickup = pickups.some((pk) => Math.hypot(pk.x - p.x, pk.z - p.z) < 6);
    if (nearPickup) continue;
    const roll = rng();
    const kind = roll < 0.55 ? 'cone' : roll < 0.8 ? 'box' : 'barrier';
    // knockables sit near the lane (dodge or bonk); SOLID barriers park at
    // the road edge so they never block the guided lane (± box + car radius)
    const side = (rng() < 0.5 ? -1 : 1) * (kind === 'barrier' ? 5.5 : 1.6);
    const rx = -p.dz * side;
    const rz = p.dx * side;
    const key = kind === 'barrier' ? 'city-kit-roads/construction-barrier' : `car-kit/${kind}`;
    props.push({ key, kind, x: p.x + rx, z: p.z + rz, rotY: rng() * Math.PI * 2 });
  }

  // --- street lamps at the road nodes ---------------------------------------
  const lamps = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const p = grid[r][c].piece;
      if (p !== 'road-intersection' && p !== 'road-crossroad') continue;
      const { x, z } = tileToWorld(r, c);
      lamps.push({ x: x + 6.5, z: z + 6.5, rotY: 180 * DEG });
    }
  }

  return {
    seed,
    grid,
    route,
    routeCenter,
    lane,
    laneLength,
    home: { tile: { r: HOME_TILE[0], c: HOME_TILE[1] }, world: homeWorld, heading: 90 * DEG },
    shop: {
      tile: { r: SHOP_TILE[0], c: SHOP_TILE[1] },
      buildingAt: shopBuildingAt,
      rotY: shopRotY,
      parking,
      awningAt,
    },
    // V2/G21 (§B3): vet destination + route + landmarks (§C9)
    vet: {
      tile: { r: VET_TILE[0], c: VET_TILE[1] },
      buildingAt: vetBuildingAt,
      rotY: vetRotY,
      parking: vetParking,
      heading: vetHeading,
    },
    vetRoute,
    vetRouteCenter,
    vetLane,
    vetLaneLength,
    vetPickups,
    landmarks,
    pickups,
    trafficLoops: TRAFFIC_LOOP_CORNERS.map(expandLoop),
    buildings,
    nature,
    props,
    lamps,
  };
}

// ── V2/G21: landmark trigger helper (§C9.3, pure — shared by cityDrive and
// G28's deliveryRush) ────────────────────────────────────────────────────────

/** Sticker/delivery trigger radius around a landmark anchor (m, §C9.3). */
export const LANDMARK_TRIGGER_M = 15;

/**
 * Landmark ids whose anchor lies within `radius` m of (x, z) — the §C9.3
 * "entering a 15 m radius" sticker trigger during any city drive mode.
 * @param {CityLayout['landmarks']} landmarks
 * @param {number} x @param {number} z car world position
 * @param {number} [radius] defaults to LANDMARK_TRIGGER_M
 * @returns {string[]}
 */
export function landmarksInRange(landmarks, x, z, radius = LANDMARK_TRIGGER_M) {
  const r2 = radius * radius;
  return (landmarks ?? [])
    .filter((l) => (l.x - x) * (l.x - x) + (l.z - z) * (l.z - z) <= r2)
    .map((l) => l.id);
}
// ── end V2/G21 ──────────────────────────────────────────────────────────────

/**
 * Axis-aligned collision boxes for the car (buildings + solid props + the
 * city bounds are handled by the controller separately). Pure.
 * @param {CityLayout} layout
 * @returns {Array<{minX: number, maxX: number, minZ: number, maxZ: number}>}
 */
export function layoutColliders(layout) {
  const boxes = layout.buildings.map((b) => ({
    minX: b.x - b.halfX, maxX: b.x + b.halfX,
    minZ: b.z - b.halfZ, maxZ: b.z + b.halfZ,
  }));
  for (const p of layout.props) {
    if (p.kind !== 'barrier') continue; // cones/boxes are knockable, not solid
    boxes.push({ minX: p.x - 1.1, maxX: p.x + 1.1, minZ: p.z - 1.1, maxZ: p.z + 1.1 });
  }
  return boxes;
}
