// V3/G39 (PLAN3 §C7.1-3 + §C7.3): road-connectivity ports model + drive-feel
// math. The §C7.1 fix replaced the guessed orientation ladder in roadPieceFor
// with the PIECE_PORTS truth table (read off the ?scene=roadtest render) and
// a deterministic (piece × rotation) search — this suite would have caught
// the v1 bug („die Straße passt nicht": 28 of 33 road tiles misrotated) and
// locks the fix: over 20 seeds, every adjacent road-tile pair must share a
// facing port and no tile's port may open into grass/blocks. Feel tests pin
// the §C7.2 numbers (τ = 120 ms ± 10 %, 90°/s cap, 8°/s assist fading to 0
// at 25°/off at 40 % deflection, cam k = 4.0/s + FOV 55→60).
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateCityLayout,
  isRoadTile,
  PIECE_PORTS,
  rotatePorts,
  portsOf,
  roadPieceFor,
} from '../src/city/cityBuilder.js';
import {
  FEEL,
  smoothSteer,
  steerYawRate,
  assistRate,
  assistFade,
  camFollowFactor,
  chaseFov,
} from '../src/city/carFeel.js';
import { DRIVE, DRIVE_TUNING } from '../src/data/constants.js';

const T = DRIVE_TUNING;
const DEG = Math.PI / 180;
const SEEDS = Array.from({ length: 20 }, (_, i) => T.CITY_SEED + i);

// ---------------------------------------------------------- PIECE_PORTS model

test('§C7.1-1: PIECE_PORTS matches the roadtest-derived authoring truth', () => {
  // Read off the ?scene=roadtest render (evidence: G39 roadtest grid shot +
  // raycast probe): straight runs W–E at rotY 0, bend opens S+W, T opens
  // E+S+W, crossroad all four, crossing = the straight's authoring.
  assert.deepEqual([...PIECE_PORTS['road-straight']].sort(), ['E', 'W']);
  assert.deepEqual([...PIECE_PORTS['road-bend']].sort(), ['S', 'W']);
  assert.deepEqual([...PIECE_PORTS['road-intersection']].sort(), ['E', 'S', 'W']);
  assert.deepEqual([...PIECE_PORTS['road-crossroad']].sort(), ['E', 'N', 'S', 'W']);
  assert.deepEqual([...PIECE_PORTS['road-crossing']].sort(), ['E', 'W']);
});

test('§C7.1: road-crossing shares road-straight authoring (zebra substitution inherits rotY)', () => {
  assert.deepEqual(PIECE_PORTS['road-crossing'], PIECE_PORTS['road-straight']);
});

test('rotatePorts: +90° rotY quarter turn maps N→W→S→E→N; 4 turns = identity', () => {
  assert.deepEqual(rotatePorts(['N'], 1), ['W']);
  assert.deepEqual(rotatePorts(['W'], 1), ['S']);
  assert.deepEqual(rotatePorts(['S'], 1), ['E']);
  assert.deepEqual(rotatePorts(['E'], 1), ['N']);
  assert.deepEqual(rotatePorts(['N', 'E', 'S', 'W'], 4), ['N', 'E', 'S', 'W']);
  assert.deepEqual(rotatePorts(['S', 'W'], 2), ['N', 'E']);
  // negative/overflowing quarter turns normalize
  assert.deepEqual(rotatePorts(['N'], -1), ['E']);
  assert.deepEqual(rotatePorts(['N'], 5), ['W']);
});

test('portsOf: rotY radians → rotated port set (multiples of 90°)', () => {
  assert.deepEqual([...portsOf('road-bend', 0)].sort(), ['S', 'W']);
  assert.deepEqual([...portsOf('road-bend', 90 * DEG)].sort(), ['E', 'S']);
  assert.deepEqual([...portsOf('road-bend', 180 * DEG)].sort(), ['E', 'N']);
  assert.deepEqual([...portsOf('road-bend', 270 * DEG)].sort(), ['N', 'W']);
  assert.deepEqual([...portsOf('road-straight', 90 * DEG)].sort(), ['N', 'S']);
  assert.deepEqual(portsOf('not-a-piece', 0), []);
});

test('§C7.1-2: roadPieceFor solves EVERY 2/3/4-way connectivity exactly (search, no ladder)', () => {
  const sides = ['N', 'E', 'S', 'W'];
  for (let mask = 0; mask < 16; mask++) {
    const want = sides.filter((_, i) => mask & (1 << i));
    if (want.length < 2) continue; // dead ends/isolated tiles never occur (§C7.1)
    const [n, e, s, w] = sides.map((side) => want.includes(side));
    const { piece, rotY } = roadPieceFor(n, e, s, w);
    assert.deepEqual(
      [...portsOf(piece, rotY)].sort(),
      [...want].sort(),
      `${want.join('+')} → ${piece}@${Math.round(rotY / DEG)}° must open exactly those sides`
    );
    // deterministic: repeated calls return the identical answer
    const again = roadPieceFor(n, e, s, w);
    assert.deepEqual(again, { piece, rotY });
  }
});

// ------------------------------------------- §C7.1-3: 20-seed connectivity

const DIRS = Object.freeze({
  N: { dr: -1, dc: 0, opp: 'S' },
  E: { dr: 0, dc: 1, opp: 'W' },
  S: { dr: 1, dc: 0, opp: 'N' },
  W: { dr: 0, dc: -1, opp: 'E' },
});

test('§C7.1-3: 20 seeds — every road tile\'s ports ⊆ its road-neighbor directions', () => {
  for (const seed of SEEDS) {
    const layout = generateCityLayout(seed);
    for (let r = 0; r < layout.grid.length; r++) {
      for (let c = 0; c < layout.grid[r].length; c++) {
        const tile = layout.grid[r][c];
        if (tile.kind !== 'road') continue;
        const ports = portsOf(tile.piece, tile.rotY ?? 0);
        assert.ok(ports.length >= 2, `seed ${seed} (${r},${c}) ${tile.piece} has ports`);
        for (const p of ports) {
          const { dr, dc } = DIRS[p];
          assert.ok(
            isRoadTile(layout.grid, r + dr, c + dc),
            `seed ${seed}: (${r},${c}) ${tile.piece}@${Math.round((tile.rotY ?? 0) / DEG)}° ` +
              `opens ${p} into non-road (${r + dr},${c + dc})`
          );
        }
      }
    }
  }
});

test('§C7.1-3: 20 seeds — every adjacent road-tile pair shares a facing port pair', () => {
  for (const seed of SEEDS) {
    const layout = generateCityLayout(seed);
    for (let r = 0; r < layout.grid.length; r++) {
      for (let c = 0; c < layout.grid[r].length; c++) {
        if (!isRoadTile(layout.grid, r, c)) continue;
        const ports = portsOf(layout.grid[r][c].piece, layout.grid[r][c].rotY ?? 0);
        for (const [dir, { dr, dc, opp }] of Object.entries(DIRS)) {
          const rr = r + dr, cc = c + dc;
          if (!isRoadTile(layout.grid, rr, cc)) continue;
          const nPorts = portsOf(layout.grid[rr][cc].piece, layout.grid[rr][cc].rotY ?? 0);
          assert.ok(
            ports.includes(dir) && nPorts.includes(opp),
            `seed ${seed}: road pair (${r},${c})↔(${rr},${cc}) must share the ` +
              `${dir}/${opp} facing ports (got [${ports}] / [${nPorts}])`
          );
        }
      }
    }
  }
});

test('§C7.1-3: shop + vet route tiles connect port-to-port along both drives (20 seeds)', () => {
  for (const seed of SEEDS) {
    const layout = generateCityLayout(seed);
    for (const [name, tiles] of [['route', layout.route], ['vetRoute', layout.vetRoute]]) {
      for (let i = 1; i < tiles.length; i++) {
        const a = tiles[i - 1];
        const b = tiles[i];
        const dir = Object.entries(DIRS).find(
          ([, d]) => a.r + d.dr === b.r && a.c + d.dc === b.c
        );
        assert.ok(dir, `seed ${seed} ${name} ${i - 1}→${i} adjacent`);
        const aPorts = portsOf(layout.grid[a.r][a.c].piece, layout.grid[a.r][a.c].rotY ?? 0);
        const bPorts = portsOf(layout.grid[b.r][b.c].piece, layout.grid[b.r][b.c].rotY ?? 0);
        assert.ok(
          aPorts.includes(dir[0]) && bPorts.includes(dir[1].opp),
          `seed ${seed} ${name} ${i - 1}→${i}: waypoint tiles must share facing ports`
        );
      }
    }
  }
});

test('§C7.1: zebra substitutions keep the straight\'s exact orientation (20 seeds)', () => {
  for (const seed of SEEDS) {
    const layout = generateCityLayout(seed);
    for (let r = 0; r < layout.grid.length; r++) {
      for (let c = 0; c < layout.grid[r].length; c++) {
        const tile = layout.grid[r][c];
        if (tile.kind !== 'road' || tile.piece !== 'road-crossing') continue;
        // the crossing must open exactly where a straight with the same rotY would
        assert.deepEqual(
          portsOf('road-crossing', tile.rotY ?? 0),
          portsOf('road-straight', tile.rotY ?? 0),
          `seed ${seed}: crossing at (${r},${c}) must inherit the straight's orientation`
        );
      }
    }
  }
});

// ------------------------------------------------- §C7.2/§C7.3 feel tests

test('§C7.3: steering low-pass step response hits 63.2 % at τ = 120 ms (±10 %), any frame rate', () => {
  for (const hz of [120, 60, 30]) {
    const dt = 1 / hz;
    let v = 0;
    let elapsed = 0;
    while (elapsed + dt <= FEEL.STEER_SMOOTH_TAU_S + 1e-9) {
      v = smoothSteer(v, 1, dt);
      elapsed += dt;
    }
    if (elapsed < FEEL.STEER_SMOOTH_TAU_S) {
      v = smoothSteer(v, 1, FEEL.STEER_SMOOTH_TAU_S - elapsed);
    }
    // τ within ±10 % ⇔ step response at 120 ms within 1−e^(−0.12/0.132) …
    // 1−e^(−0.12/0.108) = 0.597 … 0.671
    assert.ok(v > 0.597 && v < 0.671, `step response at τ was ${v.toFixed(4)} @ ${hz} Hz`);
  }
  assert.equal(FEEL.STEER_SMOOTH_TAU_S, 0.12);
  assert.equal(smoothSteer(0.5, 1, 0), 0.5); // dt=0 no-op
});

test('§C7.2: output steering-rate cap is 90°/s (v1 full-lock 109°/s clamps)', () => {
  assert.equal(FEEL.STEER_RATE_CAP_RAD_S, 90 * DEG);
  // v1 full lock at low speed: 1.9 rad/s ≈ 108.9°/s → must clamp to 90°/s
  assert.equal(steerYawRate(1, T.STEER_RATE, 1), 90 * DEG);
  assert.equal(steerYawRate(-1, T.STEER_RATE, 1), -90 * DEG);
  // below the cap the response stays linear (no distortion)
  const gentle = steerYawRate(0.4, T.STEER_RATE, 1);
  assert.ok(Math.abs(gentle - 0.4 * T.STEER_RATE) < 1e-12);
  assert.equal(steerYawRate(0, T.STEER_RATE, 1), 0);
});

test('§C7.3: assist-force curve — max 8°/s, linear fade, 0 beyond 25° intent', () => {
  assert.equal(FEEL.ASSIST_MAX_RATE_RAD_S, 8 * DEG);
  assert.equal(FEEL.ASSIST_FADE_END_RAD, 25 * DEG);
  // peak force toward the lane at (near) zero intent
  assert.ok(Math.abs(assistRate(1e-9, 0)) <= 8 * DEG + 1e-12);
  assert.ok(Math.abs(assistRate(1e-9, 0) - 8 * DEG) < 1e-6);
  // linear fade: half force at 12.5°
  assert.ok(Math.abs(assistRate(12.5 * DEG, 0) - 4 * DEG) < 1e-9);
  assert.ok(Math.abs(assistRate(-12.5 * DEG, 0) + 4 * DEG) < 1e-9);
  // zero at and beyond 25°
  assert.equal(assistRate(25 * DEG, 0), 0);
  assert.equal(assistRate(30 * DEG, 0), 0);
  assert.equal(assistFade(25 * DEG), 0);
  assert.equal(assistFade(40 * DEG), 0);
  // sign follows the intent angle (spring TOWARD the lane heading)
  assert.ok(assistRate(10 * DEG, 0) > 0);
  assert.ok(assistRate(-10 * DEG, 0) < 0);
});

test('§C7.2: assist fully disabled while actively steering ≥ 40 % deflection', () => {
  assert.equal(FEEL.ASSIST_OFF_DEFLECTION, 0.4);
  assert.equal(assistRate(5 * DEG, 0.4), 0);
  assert.equal(assistRate(5 * DEG, -0.4), 0);
  assert.equal(assistRate(5 * DEG, 1), 0);
  assert.ok(assistRate(5 * DEG, 0.39) > 0); // just below: assist stays on
});

test('§C7.3: camera-lag bound — k = 4.0/s damped follow closes ≥ 98 % of the gap per second', () => {
  assert.equal(FEEL.CAM_POS_LERP_K, 4.0);
  // frame-rate independent: remaining gap after 1 s == e^(−4) at any Hz
  for (const hz of [120, 60, 24]) {
    let gap = 1;
    for (let i = 0; i < hz; i++) gap *= 1 - camFollowFactor(1 / hz);
    assert.ok(Math.abs(gap - Math.exp(-4)) < 1e-9, `gap after 1 s @ ${hz} Hz = ${gap}`);
    assert.ok(gap < 0.02, 'camera must close ≥ 98 % of the gap within 1 s');
  }
  assert.equal(camFollowFactor(0), 0);
});

test('§C7.2: chase-cam FOV scales 55° → 60° over 9 → 13 m/s and clamps outside', () => {
  assert.equal(FEEL.CAM_LOOKAHEAD_M, 6);
  assert.equal(chaseFov(0), 55);
  assert.equal(chaseFov(9), 55);
  assert.equal(chaseFov(11), 57.5);
  assert.equal(chaseFov(13), 60);
  assert.equal(chaseFov(15), 60); // arcade 15 m/s cap stays at 60°
});

test('§C7.2/§C7.3: trip speed semantics pinned — base 9 → max 13 m/s UNCHANGED', () => {
  assert.equal(DRIVE.BASE_SPEED, 9);
  assert.equal(DRIVE.MAX_SPEED, 13);
});
