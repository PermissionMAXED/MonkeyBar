// City layout generator (§G G7, §C6.1 #1) — pure headless checks: seeded
// determinism, route waypoints on connected road tiles, shop reachability,
// pickups on route, and the route staying clear of the building colliders.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateCityLayout,
  layoutColliders,
  createLayoutRng,
  tileToWorld,
  worldToTile,
  laneOffsetPolyline,
  polylineLength,
  pointAtLength,
  distanceToPolyline,
  roadPieceFor,
  isRoadTile,
} from '../src/city/cityBuilder.js';
import { DRIVE, DRIVE_TUNING } from '../src/data/constants.js';

const T = DRIVE_TUNING;
const SEED = T.CITY_SEED;

// ------------------------------------------------------------- determinism

test('same seed → byte-identical layout', () => {
  const a = generateCityLayout(SEED);
  const b = generateCityLayout(SEED);
  assert.deepEqual(a, b);
});

test('different seed → different seeded dressing, same fixed roads/route', () => {
  const a = generateCityLayout(SEED);
  const b = generateCityLayout(SEED + 1);
  // seeded parts differ…
  assert.notEqual(JSON.stringify(a.buildings) + JSON.stringify(a.nature),
    JSON.stringify(b.buildings) + JSON.stringify(b.nature));
  // …but the §C4 "fixed route end" contract holds: route/home/shop identical
  assert.deepEqual(a.route, b.route);
  assert.deepEqual(a.home, b.home);
  assert.deepEqual(a.shop, b.shop);
  for (let r = 0; r < a.grid.length; r++) {
    for (let c = 0; c < a.grid[r].length; c++) {
      assert.equal(a.grid[r][c].kind, b.grid[r][c].kind, `tile kind (${r},${c})`);
    }
  }
});

test('layout rng stream is deterministic', () => {
  const r1 = createLayoutRng(42);
  const r2 = createLayoutRng(42);
  for (let i = 0; i < 20; i++) assert.equal(r1(), r2());
});

// ---------------------------------------------------------------- the grid

test('grid is 9×9 of 20 m tiles with valid kinds and road pieces', () => {
  const layout = generateCityLayout(SEED);
  assert.equal(T.GRID, 9);
  assert.equal(T.TILE_M, 20);
  assert.equal(layout.grid.length, T.GRID);
  const pieces = new Set([
    'road-straight', 'road-bend', 'road-intersection', 'road-crossroad', 'road-crossing',
  ]);
  for (const row of layout.grid) {
    assert.equal(row.length, T.GRID);
    for (const tile of row) {
      assert.ok(['road', 'block', 'grass'].includes(tile.kind));
      if (tile.kind === 'road') assert.ok(pieces.has(tile.piece), `piece ${tile.piece}`);
    }
  }
});

test('tile/world round-trips through the grid center', () => {
  assert.deepEqual(tileToWorld(4, 4), { x: 0, z: 0 }); // center tile = origin
  for (const [r, c] of [[0, 0], [7, 2], [3, 6], [8, 8]]) {
    const { x, z } = tileToWorld(r, c);
    assert.deepEqual(worldToTile(x, z), { r, c });
  }
});

test('roadPieceFor covers the ring+cross connectivity cases', () => {
  assert.equal(roadPieceFor(true, true, true, true).piece, 'road-crossroad');
  assert.equal(roadPieceFor(true, false, true, false).piece, 'road-straight');
  assert.equal(roadPieceFor(false, true, false, true).piece, 'road-straight');
  assert.equal(roadPieceFor(false, true, true, true).piece, 'road-intersection');
  assert.equal(roadPieceFor(false, false, true, true).piece, 'road-bend');
  assert.equal(roadPieceFor(true, true, false, false).piece, 'road-bend');
});

// ----------------------------------------------------------------- route

test('every route waypoint lies on a road tile', () => {
  const layout = generateCityLayout(SEED);
  for (const { r, c } of layout.route) {
    assert.ok(isRoadTile(layout.grid, r, c), `waypoint (${r},${c}) must be road`);
  }
});

test('consecutive route waypoints are adjacent-connected, no tile twice', () => {
  const layout = generateCityLayout(SEED);
  const seen = new Set();
  for (let i = 0; i < layout.route.length; i++) {
    const { r, c } = layout.route[i];
    const key = `${r},${c}`;
    assert.ok(!seen.has(key), `tile (${key}) visited twice`);
    seen.add(key);
    if (i > 0) {
      const prev = layout.route[i - 1];
      const manhattan = Math.abs(r - prev.r) + Math.abs(c - prev.c);
      assert.equal(manhattan, 1, `waypoints ${i - 1}→${i} must be 4-adjacent`);
    }
  }
});

test('route starts at home and the road network connects home to the route end (BFS)', () => {
  const layout = generateCityLayout(SEED);
  assert.deepEqual(layout.route[0], layout.home.tile);
  const goal = layout.route[layout.route.length - 1];
  const queue = [layout.home.tile];
  const seen = new Set([`${layout.home.tile.r},${layout.home.tile.c}`]);
  let reached = false;
  while (queue.length > 0) {
    const { r, c } = queue.shift();
    if (r === goal.r && c === goal.c) {
      reached = true;
      break;
    }
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      const key = `${nr},${nc}`;
      if (!seen.has(key) && isRoadTile(layout.grid, nr, nc)) {
        seen.add(key);
        queue.push({ r: nr, c: nc });
      }
    }
  }
  assert.ok(reached, 'shop-side route end unreachable from home over roads');
});

test('shop is reachable: parking apron sits within a tile of the route end', () => {
  const layout = generateCityLayout(SEED);
  const end = layout.route[layout.route.length - 1];
  const endWorld = tileToWorld(end.r, end.c);
  const d = Math.hypot(layout.shop.parking.x - endWorld.x, layout.shop.parking.z - endWorld.z);
  assert.ok(d <= T.TILE_M, `parking ${d.toFixed(1)} m from route end (> ${T.TILE_M})`);
  // the shop tile itself is adjacent to the route end
  const manhattan =
    Math.abs(layout.shop.tile.r - end.r) + Math.abs(layout.shop.tile.c - end.c);
  assert.equal(manhattan, 1);
  // and the lane polyline actually finishes inside the parking trigger
  const last = layout.lane[layout.lane.length - 1];
  const dPark = Math.hypot(last.x - layout.shop.parking.x, last.z - layout.shop.parking.z);
  assert.ok(dPark < DRIVE.PARKING_RADIUS, 'lane must end at the parking trigger');
});

// ----------------------------------------------------------------- pickups

test('exactly DRIVE.PICKUP_COUNT pickups, all on the route lane and on roads', () => {
  const layout = generateCityLayout(SEED);
  assert.equal(layout.pickups.length, DRIVE.PICKUP_COUNT);
  for (const p of layout.pickups) {
    assert.ok(distanceToPolyline(layout.lane, p.x, p.z) < 0.5, 'pickup off the lane');
    const { r, c } = worldToTile(p.x, p.z);
    assert.ok(isRoadTile(layout.grid, r, c), `pickup at (${r},${c}) not on a road`);
  }
});

// ---------------------------------------------------------- lane + geometry

test('lane polyline hugs the route (≤ lane offset + ε from the centerline)', () => {
  const layout = generateCityLayout(SEED);
  // sample the lane every 2 m; skip the final off-road approach into parking
  const routeEndWorld = tileToWorld(
    layout.route[layout.route.length - 1].r,
    layout.route[layout.route.length - 1].c
  );
  for (let s = 0; s < layout.laneLength; s += 2) {
    const p = pointAtLength(layout.lane, s);
    const nearParking =
      Math.hypot(p.x - routeEndWorld.x, p.z - routeEndWorld.z) < T.TILE_M;
    if (nearParking) continue;
    const d = distanceToPolyline(layout.routeCenter, p.x, p.z);
    assert.ok(d <= T.LANE_OFFSET_M + 1.5, `lane strays ${d.toFixed(1)} m at s=${s}`);
  }
});

test('laneOffsetPolyline keeps straight segments exactly offset', () => {
  const line = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }];
  const lane = laneOffsetPolyline(line, 2.5); // travel +x → right = +z (south)
  for (const p of lane) assert.ok(Math.abs(p.z - 2.5) < 1e-9);
  assert.ok(Math.abs(polylineLength(lane) - 20) < 1e-9);
});

test('building/barrier colliders never block the drive lane', () => {
  const layout = generateCityLayout(SEED);
  const boxes = layoutColliders(layout);
  const r = T.CAR_RADIUS_M;
  for (let s = 0; s <= layout.laneLength; s += 2) {
    const p = pointAtLength(layout.lane, s);
    for (const b of boxes) {
      const inside =
        p.x > b.minX - r && p.x < b.maxX + r && p.z > b.minZ - r && p.z < b.maxZ + r;
      assert.ok(!inside, `collider [${b.minX.toFixed(1)},${b.minZ.toFixed(1)}] blocks lane at s=${s}`);
    }
  }
});

// ----------------------------------------------------------------- traffic

test('traffic loops are closed cycles of adjacent road tiles', () => {
  const layout = generateCityLayout(SEED);
  assert.ok(layout.trafficLoops.length >= 1);
  for (const loop of layout.trafficLoops) {
    assert.ok(loop.length >= 8, 'loop long enough to spread cars');
    for (let i = 0; i < loop.length; i++) {
      const [r, c] = loop[i];
      assert.ok(isRoadTile(layout.grid, r, c), `loop tile (${r},${c}) not road`);
      const [nr, nc] = loop[(i + 1) % loop.length];
      assert.equal(Math.abs(r - nr) + Math.abs(c - nc), 1, 'loop must be closed-adjacent');
    }
  }
});

test('traffic count stays in the §C6.1 6–10 band', () => {
  assert.ok(T.TRAFFIC_COUNT >= 6 && T.TRAFFIC_COUNT <= 10);
  assert.equal(T.TRAFFIC_HITBOX_SCALE, 0.7); // forgiving 70% AABBs
});
