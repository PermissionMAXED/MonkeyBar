// V4/G66 — Gooby Welt game half (PLAN4-GAMES §G6.3–§G6.5, §G6.7; PLAN4 §E
// block G66):
//   • §G6.5-3 authoring validation over BOTH shipped path sets (spline
//     165–185 m ⇒ 110 s ± 5 at 1.6 m/s, corridor ≥ 1.2 m, pickups reachable
//     inside corridor+offset window, star spacing ≥ 2.5 m, foto-spots ≥ 25 m
//     apart on the spline) + negative probes for every rule
//   • Team-WELT coordination: the paths resolve losslessly into G65's
//     weltScenes.js `WeltPathMeta` FORMAT contract (shape validator green,
//     ids/PLY/orientation mirror the viewer registry rows verbatim)
//   • spline math: Catmull-Rom endpoint interpolation, arc-length table
//     determinism, ~constant-speed stepping, orthonormal §G6.3 tangent frame
//   • §G6.3 steering: drag → 2.2 m per screen width (dy inverts to +up),
//     eased k = 6/s, offset clamps (global window ∩ per-segment corridor)
//   • §G6.4 pickups: sphere windows collect/miss by offset, foto wonder
//     pause freezes the float, finish fires exactly once (+10), 126 max
//   • §G6.7 bot: deterministic across 5 dt-jitter seeds per scene, ≥ 60 %
//     stars, score ≥ 45, run finishes near the 110 s design length
//   • wiring pins: §G5.1 difficulty exclusion, v4-welt.js EN/DE parity with
//     every t()-key the scene module uses, G68's SCENES/controls exports
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WELT,
  dist3,
  catmullRom,
  buildTrack,
  offsetWorldPos,
  pickupWorldPos,
  clampOffset,
  applyDrag,
  easeOffset,
  createRun,
  stepRun,
  goobyArcPos,
  goobyWorldPos,
  hudTimeLeft,
  runMeta,
  botTargetOffset,
  simulateBot,
  toWeltPathMeta,
  validateScene,
} from '../src/minigames/games/goobyWelt.logic.js';
import {
  WELT_SCENES,
  WELT_SCENE_IDS,
  weltScene,
} from '../src/minigames/games/goobyWelt.paths.js';
import {
  WELT_SCENE_IDS as VIEWER_SCENE_IDS,
  getWeltScene,
  validateWeltPathMeta,
} from '../src/welt/weltScenes.js';
import { DIFFICULTY_EXCLUDED_GAMES } from '../src/minigames/framework.logic.js';
import { EN as WELT_EN, DE as WELT_DE } from '../src/data/strings/v4-welt.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const gameSource = fs.readFileSync(
  path.join(ROOT, 'src/minigames/games/goobyWelt.js'), 'utf8'
);

/** Deep-mutable copy of an authored (frozen) scene for negative probes. */
const thaw = (sceneData) => JSON.parse(JSON.stringify(sceneData));

// ---------------------------------------------------------------------------
// §G6.5-3 authoring validation — both scenes green + every rule fires
// ---------------------------------------------------------------------------

test('§G6.5-3: both shipped path sets pass every authoring rule', () => {
  assert.deepEqual([...WELT_SCENE_IDS], ['windmill', 'townsquare']);
  for (const id of WELT_SCENE_IDS) {
    const sceneData = WELT_SCENES[id];
    assert.equal(sceneData.id, id);
    assert.deepEqual(validateScene(sceneData), []);
    const track = buildTrack(sceneData);
    assert.ok(track.length >= WELT.SPLINE_MIN_M && track.length <= WELT.SPLINE_MAX_M,
      `${id}: spline ${track.length.toFixed(1)} m in 165–185`);
    const traversal = track.length / WELT.SPEED_M_S;
    assert.ok(Math.abs(traversal - WELT.DURATION_SEC) <= WELT.DURATION_TOL_SEC,
      `${id}: traversal ${traversal.toFixed(1)} s within 110 ± 5`);
    assert.ok(sceneData.waypoints.length >= 25 && sceneData.waypoints.length <= 40);
    assert.equal(sceneData.corridor.length, sceneData.waypoints.length - 1);
    for (const w of sceneData.corridor) assert.ok(w >= WELT.MIN_CORRIDOR_M);
    assert.equal(sceneData.stars.length, 28);
    assert.equal(sceneData.carrots.length, 6);
    assert.equal(sceneData.fotoSpots.length, 3);
  }
});

test('§G6.5-3 negative probes: every rule reports its violation', () => {
  const base = WELT_SCENES.windmill;
  // spline length window (truncated route is far too short)
  const short = thaw(base);
  short.waypoints = short.waypoints.slice(0, 25);
  short.corridor = short.corridor.slice(0, 24);
  assert.ok(validateScene(short).some((m) => m.includes('spline length')));
  // corridor floor
  const narrow = thaw(base);
  narrow.corridor[3] = 0.8;
  assert.ok(validateScene(narrow).some((m) => m.includes('corridor half-width 0.8')));
  // star spacing ≥ 2.5 m
  const crowded = thaw(base);
  crowded.stars[1] = { ...crowded.stars[0], oy: crowded.stars[0].oy + 0.4 };
  assert.ok(validateScene(crowded).some((m) => m.includes('apart (< 2.5')));
  // stars: lateral authoring cap (±2 m per §G6.4)
  const wide = thaw(base);
  wide.stars[5].ox = 2.4;
  assert.ok(validateScene(wide).some((m) => m.includes('> 2 m')));
  // pickups must sit inside the corridor
  const outside = thaw(base);
  outside.carrots[0].ox = 4.4;
  assert.ok(validateScene(outside).some((m) => m.includes('outside corridor')));
  // vertical offset window
  const high = thaw(base);
  high.carrots[1].oy = 2.6;
  assert.ok(validateScene(high).some((m) => m.includes('outside [-1, 1.8]')));
  // foto-spots ≥ 25 m apart along the spline
  const bunched = thaw(base);
  bunched.fotoSpots[1] = { ...bunched.fotoSpots[0], s: bunched.fotoSpots[0].s + 10 };
  assert.ok(validateScene(bunched).some((m) => m.includes('m apart on the spline')));
  // pickup counts pinned
  const missing = thaw(base);
  missing.stars.pop();
  assert.ok(validateScene(missing).some((m) => m.includes('stars 27 != 28')));
});

test('paths module: deep-frozen pure data + defensive weltScene() lookup', () => {
  assert.ok(Object.isFrozen(WELT_SCENES));
  assert.ok(Object.isFrozen(WELT_SCENES.windmill.waypoints));
  assert.ok(Object.isFrozen(WELT_SCENES.townsquare.stars[0]));
  assert.equal(weltScene('windmill').id, 'windmill');
  assert.equal(weltScene('nope').id, WELT_SCENE_IDS[0]);
  assert.equal(weltScene(undefined).id, WELT_SCENE_IDS[0]);
});

// ---------------------------------------------------------------------------
// Team-WELT coordination: G65 weltScenes.js format contract (§G6.5)
// ---------------------------------------------------------------------------

test('G65 contract: path data resolves into a valid WeltPathMeta per scene', () => {
  assert.deepEqual([...WELT_SCENE_IDS], [...VIEWER_SCENE_IDS]);
  for (const id of WELT_SCENE_IDS) {
    const meta = toWeltPathMeta(WELT_SCENES[id]);
    assert.deepEqual(validateWeltPathMeta(meta), [], `${id}: shape contract green`);
    assert.equal(meta.sceneId, id);
    // viewer registry rows mirror the gameplay data (single-source checks)
    const def = getWeltScene(id);
    assert.equal(WELT_SCENES[id].ply, def.file, `${id}: same PLY as the viewer`);
    assert.deepEqual([...WELT_SCENES[id].orientation], [...def.orientation],
      `${id}: same §G6.3 orientation quaternion as the viewer`);
    // world-bounds sanity: the whole route lives inside the captured splat
    // region around the verified spawn pose (windmill starts on the meadow
    // approach ~22 m out; the runtime camera flies the SPLINE, not applyPose)
    assert.ok(dist3(WELT_SCENES[id].waypoints[0], [...def.spawn.position]) < 30,
      `${id}: waypoint[0] inside the captured region`);
    for (const w of WELT_SCENES[id].waypoints) {
      assert.ok(dist3(w, [...def.spawn.position]) < 60,
        `${id}: every waypoint inside the captured region`);
    }
  }
});

// ---------------------------------------------------------------------------
// Spline math: determinism, interpolation, arc parameterization, frames
// ---------------------------------------------------------------------------

test('§G6.7 determinism: identical inputs build identical tracks', () => {
  for (const id of WELT_SCENE_IDS) {
    const a = buildTrack(WELT_SCENES[id]);
    const b = buildTrack(WELT_SCENES[id]);
    assert.equal(a.length, b.length);
    assert.deepEqual(a.samples.s, b.samples.s);
    for (const s of [0, 10.5, 42.123, a.length / 2, a.length]) {
      assert.deepEqual(a.posAt(s), b.posAt(s));
      assert.deepEqual(a.tangentAt(s), b.tangentAt(s));
    }
  }
});

test('Catmull-Rom passes through the authored waypoints (clamped endpoints)', () => {
  const p0 = [0, 0, 0];
  const p1 = [1, 2, 3];
  const p2 = [4, 5, 6];
  const p3 = [7, 8, 9];
  assert.deepEqual(catmullRom(p0, p1, p2, p3, 0), p1);
  assert.deepEqual(catmullRom(p0, p1, p2, p3, 1), p2);
  const track = buildTrack(WELT_SCENES.windmill);
  const wp = WELT_SCENES.windmill.waypoints;
  assert.ok(dist3(track.posAt(0), wp[0]) < 1e-9, 'starts at waypoint[0]');
  assert.ok(dist3(track.posAt(track.length), wp[wp.length - 1]) < 1e-6, 'ends at the last waypoint');
});

test('arc-length table: monotone s, ~constant-speed stepping', () => {
  for (const id of WELT_SCENE_IDS) {
    const track = buildTrack(WELT_SCENES[id]);
    for (let i = 1; i < track.samples.s.length; i += 1) {
      assert.ok(track.samples.s[i] >= track.samples.s[i - 1], 'cumulative s is monotone');
    }
    // stepping 1 arc-metre moves ~1 world metre (chord ≤ arc, curvature-lax)
    let prev = track.posAt(0);
    for (let s = 1; s <= Math.floor(track.length); s += 1) {
      const p = track.posAt(s);
      const chord = dist3(prev, p);
      assert.ok(chord > 0.8 && chord < 1.2, `${id}: chord ${chord.toFixed(3)} @ s=${s}`);
      prev = p;
    }
  }
});

test('§G6.3 tangent frame: orthonormal, right is horizontal (screen-right)', () => {
  const track = buildTrack(WELT_SCENES.townsquare);
  for (const s of [0, 20, 55.5, 111, track.length - 1]) {
    const { fwd, right, up } = track.frameAt(s);
    const len = (v) => Math.hypot(v[0], v[1], v[2]);
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    assert.ok(Math.abs(len(fwd) - 1) < 1e-9);
    assert.ok(Math.abs(len(right) - 1) < 1e-9);
    assert.ok(Math.abs(len(up) - 1) < 1e-6);
    assert.equal(right[1], 0, 'right stays horizontal (world-up camera)');
    assert.ok(Math.abs(dot(right, fwd)) < 1e-9);
    assert.ok(dot(up, [0, 1, 0]) > 0.5, 'up points skyward on gentle float paths');
  }
});

test('corridorAt interpolates the per-segment table inside its bounds', () => {
  for (const id of WELT_SCENE_IDS) {
    const sceneData = WELT_SCENES[id];
    const track = buildTrack(sceneData);
    const lo = Math.min(...sceneData.corridor);
    const hi = Math.max(...sceneData.corridor);
    for (let s = 0; s <= track.length; s += 2.5) {
      const w = track.corridorAt(s);
      assert.ok(w >= lo - 1e-9 && w <= hi + 1e-9, `${id}: corridorAt(${s}) within table range`);
    }
    assert.equal(track.corridorAt(-5), sceneData.corridor[0]);
    assert.equal(track.corridorAt(track.length + 5), sceneData.corridor.at(-1));
  }
});

// ---------------------------------------------------------------------------
// §G6.3 steering: drag mapping, easing, clamps
// ---------------------------------------------------------------------------

test('§G6.3 drag: 2.2 m per screen width, dy inverts to float-up', () => {
  const t0 = { x: 0, y: 0 };
  const full = applyDrag(t0, 390, 0, 390);
  assert.ok(Math.abs(full.x - WELT.DRAG_M_PER_SCREEN_W) < 1e-9, 'full-width drag = 2.2 m');
  const up = applyDrag(t0, 0, -100, 1000);
  assert.ok(up.y > 0, 'dragging up (negative dy) floats up');
  const chained = applyDrag(applyDrag(t0, 50, 0, 500), 50, 0, 500);
  assert.ok(Math.abs(chained.x - 0.44) < 1e-9, 'drag deltas accumulate');
  const guarded = applyDrag(t0, 100, 0, 0);
  assert.ok(Number.isFinite(guarded.x), 'zero screen width guarded');
});

test('§G6.3 easing: k = 6/s exponential, frame-rate independent, dt≤0 no-op', () => {
  const one = easeOffset(0, 1, 1 / 6);
  assert.ok(Math.abs(one - (1 - Math.exp(-1))) < 1e-9);
  // two half-steps == one full step (exponential composition)
  const half = easeOffset(easeOffset(0, 1, 0.1), 1, 0.1);
  const fullStep = easeOffset(0, 1, 0.2);
  assert.ok(Math.abs(half - fullStep) < 1e-12);
  assert.equal(easeOffset(0.4, 1, 0), 0.4);
  assert.equal(easeOffset(0.4, 1, -0.1), 0.4);
});

test('§G6.3/§G6.4 clampOffset: global window ∩ corridor half-width', () => {
  assert.deepEqual(clampOffset({ x: 9, y: 9 }, 99), { x: WELT.OFFSET_X_MAX, y: WELT.OFFSET_Y_MAX });
  assert.deepEqual(clampOffset({ x: -9, y: -9 }, 99), { x: -WELT.OFFSET_X_MAX, y: WELT.OFFSET_Y_MIN });
  assert.deepEqual(clampOffset({ x: 2.4, y: 0 }, 1.5), { x: 1.5, y: 0 });
  assert.deepEqual(clampOffset({ x: -2.4, y: 0.5 }, 1.5), { x: -1.5, y: 0.5 });
  assert.deepEqual(clampOffset({ x: 1, y: 0 }, 0), { x: 0, y: 0 }, 'degenerate corridor → centreline');
  assert.deepEqual(clampOffset({ x: 1, y: 0 }, -3), { x: 0, y: 0 }, 'negative half-width never flips');
});

// ---------------------------------------------------------------------------
// §G6.4 run state machine: pickups, foto pause, finish, scoring
// ---------------------------------------------------------------------------

/** Step a run at a fixed 60 fps until predicate (bounded). */
function stepUntil(run, target, predicate, maxSteps = 20000) {
  const events = [];
  for (let i = 0; i < maxSteps && !predicate(run, events); i += 1) {
    run.target = typeof target === 'function' ? target(run) : target;
    events.push(...stepRun(run, 1 / 60));
  }
  return events;
}

test('§G6.4 pickup window: riding the authored offset collects star #0', () => {
  const sceneData = WELT_SCENES.windmill;
  const star0 = sceneData.stars[0];
  const run = createRun(sceneData);
  const events = stepUntil(
    run,
    { x: star0.ox, y: star0.oy },
    (r) => goobyArcPos(r) > star0.s + 3
  );
  const hit = events.filter((e) => e.type === 'star' && e.index === 0);
  assert.equal(hit.length, 1, 'star #0 collected exactly once');
  assert.equal(hit[0].points, WELT.STAR_POINTS);
  assert.ok(Array.isArray(hit[0].pos));
  assert.equal(run.starDone[0], true);
  assert.ok(run.score >= WELT.STAR_POINTS);
});

test('§G6.4 pickup window: flying the far side misses star #0', () => {
  const sceneData = WELT_SCENES.windmill;
  const star0 = sceneData.stars[0]; // ox 0.7 — ride the opposite corridor edge
  const run = createRun(sceneData);
  const events = stepUntil(
    run,
    { x: -WELT.OFFSET_X_MAX, y: star0.oy },
    (r) => goobyArcPos(r) > star0.s + 3
  );
  assert.equal(events.filter((e) => e.type === 'star' && e.index === 0).length, 0);
  assert.equal(run.starDone[0], false);
});

test('§G6.4 foto-spot: r=3 trigger fires a wonder pause that freezes the float', () => {
  const sceneData = WELT_SCENES.windmill;
  const foto0 = sceneData.fotoSpots[0];
  const run = createRun(sceneData);
  const events = stepUntil(
    run,
    (r) => botTargetOffset(r),
    (r, evs) => evs.some((e) => e.type === 'foto')
  );
  const foto = events.find((e) => e.type === 'foto');
  assert.equal(foto.index, 0);
  assert.equal(foto.points, WELT.FOTO_POINTS);
  assert.ok(run.fotoPauseT > 0, 'wonder pause armed');
  const sBefore = run.s;
  stepRun(run, 0.5);
  assert.equal(run.s, sBefore, 'forward float frozen during the pause');
  stepRun(run, WELT.FOTO_PAUSE_SEC); // drain the rest
  stepRun(run, 1 / 60);
  assert.ok(run.s > sBefore, 'float resumes after the pause');
  assert.ok(Math.abs(foto0.s - goobyArcPos(run)) < 8, 'paused near the authored landmark');
});

test('§G6.4 finish: gate fires exactly once, +10, run freezes', () => {
  const run = createRun(WELT_SCENES.townsquare);
  const events = stepUntil(run, { x: 0, y: 0 }, (r) => r.finished);
  const finishes = events.filter((e) => e.type === 'finish');
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].points, WELT.FINISH_BONUS);
  assert.equal(run.finished, true);
  const scoreAfter = run.score;
  assert.deepEqual(stepRun(run, 1), [], 'finished runs step to no events');
  assert.equal(run.score, scoreAfter);
  assert.equal(hudTimeLeft(run), 0);
});

test('§G6.4 scoring identity: 28·2 + 6·5 + 3·10 + 10 = 126 = MAX_SCORE', () => {
  assert.equal(
    WELT.STAR_COUNT * WELT.STAR_POINTS
    + WELT.CARROT_COUNT * WELT.CARROT_POINTS
    + WELT.FOTO_COUNT * WELT.FOTO_POINTS
    + WELT.FINISH_BONUS,
    WELT.MAX_SCORE
  );
  assert.equal(WELT.MAX_SCORE, 126);
  assert.equal(WELT.SPEED_M_S, 1.6);
  assert.equal(WELT.CAMERA_FOV, 58);
});

test('run helpers: hudTimeLeft ≈ 110 s at spawn, Gooby leads by 2.2 m, meta shape', () => {
  for (const id of WELT_SCENE_IDS) {
    const run = createRun(WELT_SCENES[id]);
    assert.ok(Math.abs(hudTimeLeft(run) - WELT.DURATION_SEC) <= WELT.DURATION_TOL_SEC);
    assert.equal(goobyArcPos(run), WELT.GOOBY_AHEAD_M);
    const g = goobyWorldPos(run);
    assert.ok(dist3(g, run.track.posAt(WELT.GOOBY_AHEAD_M)) < 1e-9, 'zero offset = on the spline');
    assert.deepEqual(runMeta(run), { stars: 0, carrots: 0, fotoSpots: 0, sceneId: id });
    assert.deepEqual(offsetWorldPos(run.track, 0, { x: 0, y: 0 }), run.track.posAt(0));
    const p = WELT_SCENES[id].stars[3];
    assert.deepEqual(pickupWorldPos(run.track, p), offsetWorldPos(run.track, p.s, { x: p.ox, y: p.oy }));
  }
});

// ---------------------------------------------------------------------------
// §G6.7 bot: deterministic, floors, both scenes
// ---------------------------------------------------------------------------

test('§G6.7 bot: identical counts across 5 dt-jitter seeds, floors honored', () => {
  for (const id of WELT_SCENE_IDS) {
    const results = [1, 2, 3, 4, 5].map((seed) => simulateBot(WELT_SCENES[id], seed));
    for (const r of results) {
      assert.equal(r.finished, true, `${id}: bot reaches the finish gate`);
      assert.ok(r.stars >= Math.ceil(WELT.STAR_COUNT * 0.6), `${id}: ≥ 60 % stars (got ${r.stars})`);
      assert.ok(r.score >= 45, `${id}: score floor 45 (got ${r.score})`);
      assert.ok(r.durationSec > 95 && r.durationSec < 125,
        `${id}: run near design length (got ${r.durationSec.toFixed(1)} s)`);
    }
    const counts = results.map((r) => [r.score, r.stars, r.carrots, r.fotoSpots].join('/'));
    assert.equal(new Set(counts).size, 1, `${id}: deterministic across seeds (${counts[0]})`);
  }
});

test('§G6.7 bot steering: idles on the centreline, tracks pickups < 2 m ahead', () => {
  const sceneData = WELT_SCENES.windmill;
  const run = createRun(sceneData);
  // nothing ahead within 2 m at spawn (first star sits at s=8) → centreline
  assert.deepEqual(botTargetOffset(run), { x: 0, y: 0 });
  // park Gooby just behind star #0 → bot steers toward its authored offset
  const star0 = sceneData.stars[0];
  run.s = star0.s - WELT.GOOBY_AHEAD_M - 1;
  const steer = botTargetOffset(run);
  assert.equal(steer.x, star0.ox);
  assert.equal(steer.y, star0.oy);
});

// ---------------------------------------------------------------------------
// Wiring pins: difficulty exclusion, strings, scene-module contracts
// ---------------------------------------------------------------------------

test('§G5.1: goobyWelt is difficulty-excluded (normal only, no endless)', () => {
  assert.ok(DIFFICULTY_EXCLUDED_GAMES.includes('goobyWelt'));
});

test('v4-welt.js: EN/DE parity + every t() key the scene module uses exists', () => {
  assert.deepEqual(Object.keys(WELT_EN).sort(), Object.keys(WELT_DE).sort());
  for (const [k, v] of [...Object.entries(WELT_EN), ...Object.entries(WELT_DE)]) {
    assert.ok(typeof v === 'string' && v.length > 0, `${k} non-empty`);
  }
  for (const id of WELT_SCENE_IDS) {
    const key = WELT_SCENES[id].titleKey;
    assert.ok(WELT_EN[key] && WELT_DE[key], `scene title key ${key} in both languages`);
  }
  const used = [...gameSource.matchAll(/t\('(mg\.welt\.[^']+)'\)/g)].map((m) => m[1]);
  assert.ok(used.length >= 3, 'scene module banners use mg.welt.* keys');
  for (const key of used) {
    assert.ok(WELT_EN[key], `${key} in EN`);
    assert.ok(WELT_DE[key], `${key} in DE`);
  }
});

test('scene-module pins: G68 SCENES export, §G6.6 dispose/context-loss guards', () => {
  // G68 pre-game contract: SCENES rows {id, nameKey} in shipped order
  assert.match(gameSource, /export const SCENES = Object\.freeze\(/);
  assert.match(gameSource, /WELT_SCENE_IDS\.map\(\(id\) => Object\.freeze\(\{ id, nameKey: WELT_SCENES\[id\]\.titleKey \}\)\)/);
  // §G6.6 lifecycle guards (source pins — runtime proof is the CDP pass)
  assert.match(gameSource, /async dispose\(\)/, 'async dispose (framework awaits it)');
  assert.match(gameSource, /await hardDispose\(\)/, 'AWAITS the viewer hard dispose');
  assert.match(gameSource, /webglcontextlost/, 'context-loss clean exit path');
  assert.match(gameSource, /setPixelRatio\?\.\(this\.savedPixelRatio/, 'pixel-ratio restore');
  assert.match(gameSource, /playContext\?\.\('game:goobyWelt'\)/, '„Splat-Wunderwelt" game context');
  assert.match(gameSource, /import\.meta\.glob\('\.\.\/\.\.\/welt\/splatViewer\.js'\)/,
    'viewer feature-detected, never a static import (§E0.1-11)');
});
