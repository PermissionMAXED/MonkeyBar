// V4/G63 — recap biome vignettes: pure-side tests (PLAN4 §B5.4 + §C-SYS2.3).
// Covers the binding vignette-id order (== recapDirector.DEFAULT_BIOMES),
// the §C-SYS2.3 dolly/travel specs, the Catmull-Rom samplers, and that every
// preload key + backdrop file resolves to a COMMITTED asset on disk (the
// vignettes may only dress from existing kits — no new 3D assets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  VIGNETTE_IDS,
  VIGNETTE_SPECS,
  DRAW_CALL_BUDGET,
  BACKDROP,
  sampleSpline,
  dollyPose,
  goobyPose,
  clamp,
} from '../src/recap/vignettes.logic.js';
import {
  RECAP_BACKDROP_FILES,
  RECAP_ASSET_KEYS,
  RECAP_ASSET_KEYS_BY_BIOME,
} from '../src/recap/recapAssets.js';
import { DEFAULT_BIOMES } from '../src/systems/recapDirector.js';
import { PACK_FORMATS } from '../src/core/assets.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));

/** Mirror core/assets.getModelUrl → committed file path under public/. */
function modelPath(key) {
  const i = key.indexOf('/');
  const slug = key.slice(0, i);
  const name = key.slice(i + 1);
  const fmt = PACK_FORMATS[slug] ?? { root: 'kenney', ext: 'glb' };
  return `${publicDir}assets/${fmt.root}/${slug}/${name}.${fmt.ext}`;
}

// ---------------------------------------------------------------------------
// Binding id order (§C-SYS2.3 / G55 biomeOrder handshake)
// ---------------------------------------------------------------------------

test('VIGNETTE_IDS match recapDirector.DEFAULT_BIOMES ids in order (binding)', () => {
  assert.deepEqual([...VIGNETTE_IDS], DEFAULT_BIOMES.map((b) => b.id));
  assert.equal(VIGNETTE_IDS.length, 8);
});

test('every biome id has a spec, a backdrop file and a preload list', () => {
  for (const id of VIGNETTE_IDS) {
    assert.ok(VIGNETTE_SPECS[id], `spec for ${id}`);
    assert.ok(RECAP_BACKDROP_FILES[id], `backdrop for ${id}`);
    assert.ok(Array.isArray(RECAP_ASSET_KEYS_BY_BIOME[id]), `keys for ${id}`);
  }
  assert.deepEqual(Object.keys(VIGNETTE_SPECS), [...VIGNETTE_IDS]);
  assert.deepEqual(Object.keys(RECAP_BACKDROP_FILES), [...VIGNETTE_IDS]);
  assert.deepEqual(Object.keys(RECAP_ASSET_KEYS_BY_BIOME), [...VIGNETTE_IDS]);
});

// ---------------------------------------------------------------------------
// §C-SYS2.3 spec sanity (travel modes, durations, dolly shapes)
// ---------------------------------------------------------------------------

test('specs: travel modes are the §C-SYS2.3 journey kinds, durSec 8–12', () => {
  const allowed = new Set(['walk', 'drive', 'boat', 'fly', 'float']);
  for (const id of VIGNETTE_IDS) {
    const s = VIGNETTE_SPECS[id];
    assert.ok(allowed.has(s.travel), `${id} travel '${s.travel}'`);
    assert.ok(s.durSec >= 8 && s.durSec <= 12, `${id} durSec ${s.durSec}`);
    assert.ok(s.fov >= 40 && s.fov <= 60, `${id} fov`);
  }
  // binding table rows: city + toyRoom drive, harbor boats, space flies
  assert.equal(VIGNETTE_SPECS.city.travel, 'drive');
  assert.equal(VIGNETTE_SPECS.toyRoom.travel, 'drive');
  assert.equal(VIGNETTE_SPECS.harbor.travel, 'boat');
  assert.equal(VIGNETTE_SPECS.space.travel, 'fly');
  assert.equal(VIGNETTE_SPECS.nightSky.travel, 'float');
  // space's „gentle roll ±4°" is the only rolled dolly
  assert.equal(VIGNETTE_SPECS.space.rollAmpDeg, 4);
});

test('specs: dolly + gooby paths have ≥ 2 waypoints inside the backdrop', () => {
  const maxR = BACKDROP.RADIUS;
  for (const id of VIGNETTE_IDS) {
    const s = VIGNETTE_SPECS[id];
    for (const [name, path] of [['camPath', s.camPath], ['lookPath', s.lookPath], ['goobyPath', s.goobyPath]]) {
      assert.ok(path.length >= 2, `${id}.${name} length`);
      for (const p of path) {
        assert.equal(p.length, 3, `${id}.${name} triple`);
        assert.ok(Math.hypot(p[0], p[2]) < maxR, `${id}.${name} inside backdrop radius`);
        assert.ok(p[1] > -1 && p[1] < BACKDROP.CENTER_Y + BACKDROP.HEIGHT / 2, `${id}.${name} y sane`);
      }
    }
  }
});

test('dolly moves: camera or look travels ≥ 1.5 units per vignette', () => {
  for (const id of VIGNETTE_IDS) {
    const a = dollyPose(id, 0);
    const b = dollyPose(id, 1);
    const camDist = Math.hypot(
      b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]
    );
    const lookDist = Math.hypot(b.look[0] - a.look[0], b.look[1] - a.look[1], b.look[2] - a.look[2]);
    assert.ok(camDist + lookDist >= 1.5, `${id} dolly travels (${camDist.toFixed(2)} + ${lookDist.toFixed(2)})`);
  }
});

test('meadow dolly rises (the §C-SYS2.3 „12° rise" push-in)', () => {
  const start = dollyPose('meadow', 0);
  const end = dollyPose('meadow', 1);
  assert.ok(end.position[1] > start.position[1] + 1, 'camera rises');
  assert.ok(end.position[2] < start.position[2], 'camera pushes in');
});

test('harbor dolly orbits: heading around the boat changes ≥ 60°', () => {
  const a = dollyPose('harbor', 0);
  const b = dollyPose('harbor', 1);
  const angA = Math.atan2(a.position[0], a.position[2]);
  const angB = Math.atan2(b.position[0], b.position[2]);
  const sweep = Math.abs(angB - angA) * (180 / Math.PI);
  assert.ok(sweep >= 60, `orbit sweep ${sweep.toFixed(0)}°`);
});

test('nightSky dolly tilts up: look elevation climbs ≥ 25°', () => {
  const a = dollyPose('nightSky', 0);
  const b = dollyPose('nightSky', 1);
  const elev = (pose) => {
    const dx = pose.look[0] - pose.position[0];
    const dy = pose.look[1] - pose.position[1];
    const dz = pose.look[2] - pose.position[2];
    return Math.atan2(dy, Math.hypot(dx, dz)) * (180 / Math.PI);
  };
  assert.ok(elev(b) - elev(a) >= 25, `tilt-up ${(elev(b) - elev(a)).toFixed(1)}°`);
});

// ---------------------------------------------------------------------------
// Samplers (pure math)
// ---------------------------------------------------------------------------

test('sampleSpline passes through endpoints, clamps t, handles 2 points', () => {
  const pts = [[0, 0, 0], [1, 2, 3], [4, 4, 4]];
  assert.deepEqual(sampleSpline(pts, 0), [0, 0, 0]);
  assert.deepEqual(sampleSpline(pts, 1), [4, 4, 4]);
  assert.deepEqual(sampleSpline(pts, -5), [0, 0, 0]);
  assert.deepEqual(sampleSpline(pts, 5), [4, 4, 4]);
  const mid = sampleSpline([[0, 0, 0], [2, 0, 0]], 0.5);
  assert.ok(Math.abs(mid[0] - 1) < 1e-9, '2-point lerp');
  // degenerate inputs never throw
  assert.deepEqual(sampleSpline([], 0.5), [0, 0, 0]);
  assert.deepEqual(sampleSpline([[7, 8, 9]], 0.5), [7, 8, 9]);
});

test('sampleSpline is continuous across segment joins', () => {
  const pts = VIGNETTE_SPECS.meadow.camPath;
  let prev = sampleSpline(pts, 0);
  for (let i = 1; i <= 100; i++) {
    const cur = sampleSpline(pts, i / 100);
    const d = Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
    assert.ok(d < 0.6, `step ${i} jump ${d}`);
    prev = cur;
  }
});

test('goobyPose: yaw faces along the path tangent; lead is applied+clamped', () => {
  const pose = goobyPose('city', 0.5); // city path runs +x → yaw ≈ +90°
  assert.ok(Math.abs(pose.yaw - Math.PI / 2) < 0.3, `city yaw ${pose.yaw}`);
  assert.ok(goobyPose('city', 1.2), 'over-progress clamps');
  assert.equal(goobyPose('nope', 0.5), null);
  assert.equal(dollyPose('nope', 0.5), null);
});

test('clamp + dollyPose roll: only space rolls, ±4° bounded', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-5, 0, 1), 0);
  for (const id of VIGNETTE_IDS) {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const { rollDeg } = dollyPose(id, p);
      assert.ok(Math.abs(rollDeg) <= 4 + 1e-9, `${id} roll bounded`);
      if (id !== 'space') assert.equal(rollDeg, 0, `${id} no roll`);
    }
  }
  assert.ok(Math.abs(dollyPose('space', 0.25).rollDeg - 4) < 1e-9, 'space peak roll +4°');
});

// ---------------------------------------------------------------------------
// Committed-asset resolution (existing kits ONLY — §C-SYS2.3)
// ---------------------------------------------------------------------------

test('every preload key resolves to a committed model file', () => {
  assert.ok(RECAP_ASSET_KEYS.length >= 60, `flat list has ${RECAP_ASSET_KEYS.length} keys`);
  for (const key of RECAP_ASSET_KEYS) {
    assert.match(key, /^[a-z0-9-]+\/[A-Za-z0-9_-]+$/, `key format ${key}`);
    assert.ok(existsSync(modelPath(key)), `committed file for ${key} (${modelPath(key)})`);
  }
});

test('flat preload list is the exact de-duplicated union of the biome lists', () => {
  const union = new Set(Object.values(RECAP_ASSET_KEYS_BY_BIOME).flat());
  assert.equal(RECAP_ASSET_KEYS.length, union.size, 'no dupes');
  assert.deepEqual([...new Set(RECAP_ASSET_KEYS)].sort(), [...union].sort());
});

test('all 8 ART-GATE-2 backdrop PNGs are committed', () => {
  for (const id of VIGNETTE_IDS) {
    const file = `${publicDir}assets/recap/${RECAP_BACKDROP_FILES[id]}`;
    assert.ok(existsSync(file), `backdrop ${RECAP_BACKDROP_FILES[id]}`);
  }
});

test('outfit continuity: the pumpkin outfit GLB rides the preload list', () => {
  // outfitAttach.OUTFIT_ASSET_KEYS's single GLB — keeps equipped pumpkin
  // hats placeholder-free in every vignette (see recapAssets.js header).
  assert.ok(RECAP_ASSET_KEYS.includes('kaykit-halloween/pumpkin_orange_small'));
});

test('perf gate constant: team budget 150 ≤ plan gate 250 (§B5.4)', () => {
  assert.equal(DRAW_CALL_BUDGET, 150);
  assert.ok(DRAW_CALL_BUDGET <= 250);
});

// ---------------------------------------------------------------------------
// Runtime registry integrity (source pins — vignettes.js imports three.js and
// the Gooby rig, so node pins the WIRING textually instead of importing it;
// same convention as the other scene-side suites)
// ---------------------------------------------------------------------------

const vignettesSrc = readFileSync(
  fileURLToPath(new URL('../src/recap/vignettes.js', import.meta.url)), 'utf8'
);

test('vignettes.js registry: every biome id wires a named builder (G64 contract)', () => {
  // one buildX function per biome, keyed in the frozen BUILDERS map
  const builders = {
    meadow: 'buildMeadow', city: 'buildCity', harbor: 'buildHarbor',
    space: 'buildSpace', spookGarden: 'buildSpookGarden', bakery: 'buildBakery',
    nightSky: 'buildNightSky', toyRoom: 'buildToyRoom',
  };
  assert.deepEqual(Object.keys(builders), [...VIGNETTE_IDS], 'pin covers the id order');
  const block = vignettesSrc.match(/const BUILDERS = Object\.freeze\(\{([^}]+)\}\)/);
  assert.ok(block, 'frozen BUILDERS map present');
  for (const [id, fn] of Object.entries(builders)) {
    assert.match(vignettesSrc, new RegExp(`function ${fn}\\(stage\\)`), `${fn}(stage) defined`);
    assert.match(block[1], new RegExp(`${id}: ${fn},`), `BUILDERS.${id} → ${fn}`);
  }
});

test('vignettes.js exports the stable G64 registry API surface', () => {
  for (const name of ['buildVignette', 'VIGNETTES', 'preloadBackdrops', 'backdropStatus']) {
    assert.match(vignettesSrc, new RegExp(`export (function |const )?${name}`), `export ${name}`);
  }
  // re-exported pure-side names ride along for one-import consumers
  assert.match(vignettesSrc, /export \{ VIGNETTE_IDS, VIGNETTE_SPECS, DRAW_CALL_BUDGET \};/);
  // VIGNETTES registry is generated from VIGNETTE_IDS (no hand-typed drift)
  assert.match(vignettesSrc, /VIGNETTE_IDS\.map\(\(id\) => \[/);
});

test('dev harness surface: ?recappreview= param wired + documented', () => {
  const harnessSrc = readFileSync(
    fileURLToPath(new URL('../src/dev/harness.js', import.meta.url)), 'utf8'
  );
  assert.match(harnessSrc, /q\.get\('recappreview'\)/, 'harness reads the param');
  assert.match(harnessSrc, /recap\/vignettePreview\.js/, 'routes into the preview scene');
  const paramsSrc = readFileSync(
    fileURLToPath(new URL('../src/data/harnessParams.js', import.meta.url)), 'utf8'
  );
  assert.match(paramsSrc, /param: 'recappreview'/, 'dev-panel cheat sheet row present');
});
