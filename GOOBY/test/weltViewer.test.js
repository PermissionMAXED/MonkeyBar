// V4/G65 — Gooby-Welt splat-viewer integration layer (PLAN4-GAMES §G6,
// PLAN4 §E block G65):
//   • weltScenes.js registry: 2 shipped scenes, defs valid, committed PLY +
//     license files present, attribution rows mirror data/credits.js verbatim
//     (CC BY 4.0 obligation), iOS 1M splat ceiling respected
//   • §G6.3 orientation quaternions: windmill identity, townsquare = π about
//     X (the SOG→PLY Y-down correction) + the rotated proof-pose pins
//   • §G6.5 path-metadata FORMAT contract (shape validator both directions —
//     G66's goobyWelt.test.js layers the numeric rules on top)
//   • splatViewer.logic.js: the VERBATIM §G6.6 DropInViewer/addSplatScene
//     option blocks, quality table (high 1/90/glow · low 0.75/60/no-glow),
//     URL/progress helpers, lifecycle state machine (disposal discipline)
//   • source pins: splatViewer.js §G6.6 guard sites (reveal-mode enum,
//     pixel-ratio save/restore, awaited dispose, context-loss listener),
//     devPanel card-17 teleport wiring, harness ?weltpreview route
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WELT_SCENES,
  WELT_SCENE_IDS,
  getWeltScene,
  validateWeltSceneDef,
  validateWeltPathMeta,
  isUnitQuaternion,
  PATH_PICKUP_COUNTS,
} from '../src/welt/weltScenes.js';
import {
  VIEWER_OPTIONS,
  ADD_SCENE_OPTIONS,
  SPLAT_LIMITS,
  QUALITY,
  resolveQuality,
  sceneUrl,
  clampProgress,
  progressPhase,
  createLifecycle,
  LIFECYCLE_EDGES,
} from '../src/welt/splatViewer.logic.js';
import { CREDITS } from '../src/data/credits.js';
import { allHarnessParams } from '../src/data/harnessParams.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPLATS_DIR = path.join(ROOT, 'public', 'assets', 'splats');

// ============================================================ scene registry

test('§G6.2 registry: exactly the two shipped scenes, defs fully valid', () => {
  assert.equal(WELT_SCENES.length, 2);
  assert.deepEqual([...WELT_SCENE_IDS], ['windmill', 'townsquare']);
  for (const def of WELT_SCENES) {
    assert.deepEqual(validateWeltSceneDef(def), [], `def '${def.id}' invalid`);
  }
  assert.equal(getWeltScene('windmill')?.file, 'windmill-golden-gate-mobile.compressed.ply');
  assert.equal(getWeltScene('townsquare')?.file, 'ludlow-quality-square-mobile.compressed.ply');
  assert.equal(getWeltScene('avoncroft'), null); // reserve stays staged, not shipped
});

test('§G6.2 committed assets: PLY + license sidecar exist, sizes match ledger', () => {
  for (const def of WELT_SCENES) {
    const ply = path.join(SPLATS_DIR, def.file);
    const lic = path.join(SPLATS_DIR, def.licenseFile);
    assert.ok(fs.existsSync(ply), `${def.file} missing`);
    assert.ok(fs.existsSync(lic), `${def.licenseFile} missing`);
    const mb = fs.statSync(ply).size / (1024 * 1024);
    assert.ok(Math.abs(mb - def.sizeMB) < 1, `${def.file} is ${mb.toFixed(1)} MB, def says ${def.sizeMB}`);
    const licText = fs.readFileSync(lic, 'utf8');
    assert.match(licText, /CC BY 4\.0|creativecommons\.org\/licenses\/by\/4\.0/i, `${def.licenseFile} lacks CC BY 4.0`);
  }
});

test('§G6.6 iOS ceiling: every scene ≤ 1M splats, one-resident limit pinned', () => {
  assert.equal(SPLAT_LIMITS.MAX_SPLATS, 1_000_000);
  assert.equal(SPLAT_LIMITS.MAX_RESIDENT_SCENES, 1);
  for (const def of WELT_SCENES) {
    assert.ok(def.splatCount <= SPLAT_LIMITS.MAX_SPLATS, `${def.id} exceeds the 1M ceiling`);
  }
});

test('§G6.2 attribution mirrors data/credits.js section 2 verbatim (CC BY 4.0)', () => {
  for (const def of WELT_SCENES) {
    const row = CREDITS.welten.find((r) => r.title === def.attribution.title);
    assert.ok(row, `credits row for '${def.attribution.title}' missing`);
    assert.equal(row.by, def.attribution.by);
    assert.equal(row.license, def.attribution.license);
    assert.equal(row.source, def.attribution.source);
    assert.equal(def.attribution.license, 'CC BY 4.0');
  }
});

test('§G6.3 orientation: BOTH scenes π-about-X (Y-down sources), poses corrected', () => {
  const windmill = getWeltScene('windmill');
  const townsquare = getWeltScene('townsquare');
  // Both SOG→PLY conversions are Y-down — the G65 pose probes rendered the
  // windmill tower upside-down under the throwaway's claimed identity, so
  // both rows bake the π-about-X correction (weltScenes.js header note).
  assert.deepEqual([...windmill.orientation], [1, 0, 0, 0]);
  assert.deepEqual([...townsquare.orientation], [1, 0, 0, 0]);
  assert.ok(isUnitQuaternion(windmill.orientation));
  assert.ok(isUnitQuaternion(townsquare.orientation));
  // Windmill pose authored via the §G6.5 CDP probes: frames the tower
  // (dome triangulated at corrected (−0.2, 2.0, −0.4)) from the south-east.
  assert.deepEqual([...windmill.preview.position], [6.0, 2.5, 5.0]);
  assert.deepEqual([...windmill.preview.lookAt], [-0.3, 3.5, -0.4]);
  // Townsquare = proof pose ([13.391,−0.0502,0.9755] → [4.3869,−0.7766,
  // 1.6368], up −Y) rotated by the SAME π-about-X ((x,y,z) → (x,−y,−z)):
  assert.deepEqual([...townsquare.preview.position], [13.3910007, 0.05023608, -0.97553486]);
  assert.deepEqual([...townsquare.preview.lookAt], [4.3868918, 0.7766409, -1.6367698]);
  for (const def of WELT_SCENES) {
    assert.ok(def.title.en.length > 0 && def.title.de.length > 0, `${def.id} title EN+DE`);
    assert.match(def.ambientTint, /^#[0-9a-f]{6}$/i);
  }
});

test('scene-def validator rejects broken defs (both directions)', () => {
  assert.deepEqual(validateWeltSceneDef(null), ['def is not an object']);
  const broken = {
    ...structuredClone({ ...getWeltScene('windmill') }),
    file: 'nope.glb',
    orientation: [0, 0, 0, 2],
    splatCount: -1,
  };
  const errs = validateWeltSceneDef(broken);
  assert.ok(errs.some((e) => e.includes('.ply')), 'file rule');
  assert.ok(errs.some((e) => e.includes('quaternion')), 'quaternion rule');
  assert.ok(errs.some((e) => e.includes('splatCount')), 'splatCount rule');
});

// ============================================== §G6.5 path metadata contract

/** Minimal VALID §G6.5 meta for shape tests (numeric rules are G66's). */
function samplePathMeta() {
  const waypoints = Array.from({ length: 30 }, (_, i) => [i * 6, 2, Math.sin(i) * 2]);
  const vec = (i, dy = 0) => [i * 6, 2 + dy, 0];
  return {
    sceneId: 'windmill',
    waypoints,
    corridorHalfWidths: Array.from({ length: 29 }, () => 2.0),
    stars: Array.from({ length: PATH_PICKUP_COUNTS.stars }, (_, i) => vec(i * 0.9)),
    carrots: Array.from({ length: PATH_PICKUP_COUNTS.carrots }, (_, i) => vec(i * 4, 1)),
    fotoSpots: Array.from({ length: PATH_PICKUP_COUNTS.fotoSpots }, (_, i) => vec(i * 9, 2)),
    orientation: [0, 0, 0, 1],
    ambientTint: '#a8c6a1',
  };
}

test('§G6.5 path-meta format: valid sample passes with zero problems', () => {
  assert.deepEqual(validateWeltPathMeta(samplePathMeta()), []);
  assert.deepEqual(PATH_PICKUP_COUNTS, { stars: 28, carrots: 6, fotoSpots: 3 });
});

test('§G6.5 path-meta format: every shape rule fires', () => {
  assert.deepEqual(validateWeltPathMeta(null), ['meta is not an object']);
  const cases = [
    [{ sceneId: 'atlantis' }, 'unknown sceneId'],
    [{ waypoints: samplePathMeta().waypoints.slice(0, 10) }, '25–40'],
    [{ waypoints: [...samplePathMeta().waypoints.slice(0, -1), [1, NaN, 3]] }, 'finite [x,y,z]'],
    [{ corridorHalfWidths: [1, 2, 3] }, 'waypoints.length − 1'],
    [{ corridorHalfWidths: Array.from({ length: 29 }, () => 0) }, '> 0'],
    [{ stars: samplePathMeta().stars.slice(0, 5) }, 'exactly 28'],
    [{ carrots: [] }, 'exactly 6'],
    [{ fotoSpots: samplePathMeta().fotoSpots.slice(0, 2) }, 'exactly 3'],
    [{ orientation: [1, 1, 0, 0] }, 'unit'],
    [{ ambientTint: 'green' }, '#rrggbb'],
  ];
  for (const [patch, needle] of cases) {
    const errs = validateWeltPathMeta({ ...samplePathMeta(), ...patch });
    assert.ok(errs.some((e) => e.includes(needle)), `rule '${needle}' did not fire: ${errs}`);
  }
});

// ================================================= §G6.6 option blocks (VERBATIM)

test('§G6.6 DropInViewer options are the D2 recipe VERBATIM (frozen)', () => {
  assert.ok(Object.isFrozen(VIEWER_OPTIONS));
  assert.deepEqual({ ...VIEWER_OPTIONS }, {
    sharedMemoryForWorkers: false,
    gpuAcceleratedSort: false,
    enableSIMDInSort: true,
    integerBasedSort: true,
    halfPrecisionCovariancesOnGPU: false,
    dynamicScene: false,
    sphericalHarmonicsDegree: 0,
    inMemoryCompressionLevel: 2,
    freeIntermediateSplatData: true,
  });
});

test('§G6.6 addSplatScene options are the D2 recipe VERBATIM (frozen)', () => {
  assert.ok(Object.isFrozen(ADD_SCENE_OPTIONS));
  assert.deepEqual({ ...ADD_SCENE_OPTIONS }, {
    splatAlphaRemovalThreshold: 5,
    showLoadingUI: false,
    progressiveLoad: false,
  });
});

test('§G6.6 quality table: high 1/90/glow · low 0.75/60/no-glow + defensive resolve', () => {
  assert.deepEqual({ ...QUALITY.high }, { id: 'high', pixelRatio: 1, cameraFar: 90, starGlow: true });
  assert.deepEqual({ ...QUALITY.low }, { id: 'low', pixelRatio: 0.75, cameraFar: 60, starGlow: false });
  assert.equal(resolveQuality('low'), QUALITY.low);
  assert.equal(resolveQuality('high'), QUALITY.high);
  assert.equal(resolveQuality(undefined), QUALITY.high);
  assert.equal(resolveQuality('ultra'), QUALITY.high); // save-clamp mirror
});

test('sceneUrl builds Capacitor-safe relative URLs from BASE_URL', () => {
  assert.equal(sceneUrl('./', 'a.ply'), './assets/splats/a.ply');
  assert.equal(sceneUrl('/', 'a.ply'), '/assets/splats/a.ply');
  assert.equal(sceneUrl('/sub/path', 'a.ply'), '/sub/path/assets/splats/a.ply');
  assert.equal(sceneUrl('', 'a.ply'), './assets/splats/a.ply');
  assert.equal(sceneUrl(undefined, 'a.ply'), './assets/splats/a.ply');
});

test('progress helpers: clamp 0–100, phase mapping', () => {
  assert.equal(clampProgress(-5), 0);
  assert.equal(clampProgress(150), 100);
  assert.equal(clampProgress(42.5), 42.5);
  assert.equal(clampProgress(NaN), 0);
  assert.equal(clampProgress('nope'), 0);
  assert.equal(progressPhase(0), 'download');
  assert.equal(progressPhase(1), 'process');
  assert.equal(progressPhase(2), 'done');
  assert.equal(progressPhase(undefined), 'download');
});

// ==================================================== lifecycle seam (§G6.6)

test('lifecycle: the happy path and the abort path are legal', () => {
  const a = createLifecycle();
  assert.equal(a.phase, 'idle');
  a.to('loading');
  a.to('ready');
  a.to('disposing');
  a.to('disposed');
  assert.equal(a.phase, 'disposed');

  const b = createLifecycle(); // disposed mid-load (scene switched away)
  b.to('loading');
  b.to('disposing');
  b.to('disposed');
  assert.equal(b.phase, 'disposed');

  const c = createLifecycle(); // load failure → teardown
  c.to('loading');
  c.to('failed');
  c.to('disposing');
  c.to('disposed');
  assert.equal(c.phase, 'disposed');
});

test('lifecycle: leak-shaped transitions THROW (disposal discipline)', () => {
  const l = createLifecycle();
  l.to('loading');
  l.to('ready');
  assert.throws(() => l.to('loading'), /illegal/, 're-init of a live viewer');
  l.to('disposing');
  assert.throws(() => l.to('ready'), /illegal/, 'resurrect while disposing');
  l.to('disposed');
  for (const next of ['idle', 'loading', 'ready', 'disposing', 'disposed']) {
    assert.equal(l.can(next), false, `disposed → ${next} must be terminal`);
    assert.throws(() => l.to(next), /illegal/);
  }
  assert.deepEqual([...LIFECYCLE_EDGES.disposed], []);
  assert.throws(() => createLifecycle().to('ready'), /illegal/, 'idle must load first');
});

// ======================================================= source pins (§G6.6)

const viewerSrc = fs.readFileSync(path.join(ROOT, 'src', 'welt', 'splatViewer.js'), 'utf8');
const previewSrc = fs.readFileSync(path.join(ROOT, 'src', 'welt', 'weltPreview.js'), 'utf8');
const devPanelSrc = fs.readFileSync(path.join(ROOT, 'src', 'ui', 'devPanel.js'), 'utf8');
const harnessSrc = fs.readFileSync(path.join(ROOT, 'src', 'dev', 'harness.js'), 'utf8');

test('splatViewer.js §G6.6 guard sites present (source pins)', () => {
  assert.match(viewerSrc, /\.\.\.VIEWER_OPTIONS/, 'spreads the verbatim option block');
  assert.match(viewerSrc, /sceneRevealMode: GaussianSplats3D\.SceneRevealMode\.Instant/, 'Instant reveal');
  assert.match(viewerSrc, /\.\.\.ADD_SCENE_OPTIONS/, 'spreads the verbatim addSplatScene block');
  assert.match(viewerSrc, /const savedPixelRatio = renderer\.getPixelRatio\(\)/, 'pixel-ratio save');
  assert.match(viewerSrc, /renderer\.setPixelRatio\(savedPixelRatio\)/, 'pixel-ratio restore');
  assert.match(viewerSrc, /await splats\.dispose\(\)/, 'awaited worker teardown');
  assert.match(viewerSrc, /webglcontextlost/, 'context-loss listener');
  assert.match(viewerSrc, /rotation: \[\.\.\.def\.orientation\]/, '§G6.3 orientation as data');
  assert.match(viewerSrc, /welt-load-failed/, 'typed load-failure rejection (fallback hook)');
  assert.match(viewerSrc, /SPLAT_LIMITS\.MAX_SPLATS/, 'iOS ceiling enforced');
});

test('preview + devPanel card 17 + harness route wired (source pins)', () => {
  assert.match(previewSrc, /registerWeltPreviewScenes/, 'preview registrar exported');
  assert.match(previewSrc, /await handle\?\.dispose\(\)/, 'preview awaits viewer teardown');
  assert.match(devPanelSrc, /\.\.\/welt\/weltScenes\.js/, 'card 17 probes the shipped registry');
  assert.match(devPanelSrc, /\.\.\/welt\/weltPreview\.js/, 'card 17 lazy preview loader');
  assert.match(devPanelSrc, /mod\.WELT_SCENES/, 'card 17 accepts the WELT_SCENES export');
  assert.match(harnessSrc, /weltpreview/, '?weltpreview= route');
  assert.ok(allHarnessParams().some((r) => r.param === 'weltpreview'), 'card-18 cheat row');
});
