// V4/G63 — Recap biome vignettes, PURE data + math side (PLAN4 §B5.4 +
// §C-SYS2.3 binding table). No three.js/DOM imports — node-tested in
// test/recapVignettes.test.js. The three.js builders live in
// src/recap/vignettes.js and consume these specs verbatim; G64's cinematic
// player reads durations/ids from here too.
//
// ── Vignette id contract (binding, §C-SYS2.3 + G55's biomeOrder) ─────────────
// VIGNETTE_IDS is EXACTLY systems/recapDirector.js DEFAULT_BIOMES order:
//   meadow, city, harbor, space, spookGarden, bakery, nightSky, toyRoom
// (asserted against the director in the test suite — the cut cues G64
// schedules carry these ids, and vignettes.js keys its builders off them).
//
// ── Dolly-spec shape ─────────────────────────────────────────────────────────
// VIGNETTE_SPECS[id] = {
//   travel:  'walk'|'drive'|'boat'|'fly'|'float'  — how Gooby crosses it,
//   durSec:  8–12 (§C-SYS2.3 „~8–12 s per vignette"; G64's even-bar cuts own
//            the REAL timing — durSec is the authored pace + preview loop),
//   fov:     camera fov (deg),
//   rollAmpDeg: sinusoidal camera roll amplitude (space's „gentle roll ±4°"),
//   camPath / lookPath / goobyPath: Catmull-Rom waypoint lists [x,y,z] —
//            sampled by progress 0..1 via sampleSpline() below,
//   goobyScale, goobyLead: rig scale + spline phase lead (Gooby runs slightly
//            ahead of/behind the dolly so he stays in frame),
//   bg:      scene clear color behind/above the backdrop cylinder,
//   fallback:[top, bottom] gradient for a missing backdrop file (§E block
//            G63: „fallback tinted gradient if a file is missing + report").
// }
// All numbers were tuned against the committed 1080×720 backdrops
// (public/assets/recap/recap_<file>.png — ART-GATE-2).

/** The 8 §C-SYS2.3 biome ids in binding order (== DEFAULT_BIOMES order). */
export const VIGNETTE_IDS = Object.freeze([
  'meadow', 'city', 'harbor', 'space', 'spookGarden', 'bakery', 'nightSky', 'toyRoom',
]);

/** Perf gate per vignette (team-RECAP budget; plan §B5.4 allows ≤ 250). */
export const DRAW_CALL_BUDGET = 150;

/** Backdrop cylinder staging numbers (shared by every vignette). */
export const BACKDROP = Object.freeze({
  RADIUS: 30,
  HEIGHT: 44,
  /** wall center sits this far up so the horizon line lands near y ≈ 2 */
  CENTER_Y: 12,
  /** default arc (rad) — the harbor orbit widens it (see spec.backdropArc) */
  ARC: 2.1,
});

/**
 * §C-SYS2.3 dolly + travel specs, one row per biome (binding table order).
 * @type {Readonly<Record<string, object>>}
 */
export const VIGNETTE_SPECS = Object.freeze({
  // #1 Blumenwiese — „low push-in through grass, 12° rise“; Gooby hops a
  // flower-lined path away from the camera into the meadow.
  meadow: Object.freeze({
    travel: 'walk',
    durSec: 10,
    fov: 46,
    rollAmpDeg: 0,
    camPath: Object.freeze([[1.1, 0.55, 10.5], [0.9, 0.8, 8.2], [0.6, 1.3, 5.6], [0.3, 2.3, 3.2]]),
    lookPath: Object.freeze([[0, 0.8, 3.5], [0, 0.9, 1.5], [0.2, 1.3, -2], [0.4, 2.2, -6]]),
    goobyPath: Object.freeze([[-1.1, 0, 6.5], [-0.4, 0, 4.4], [0.4, 0, 1.8], [0.8, 0, -0.8], [1.0, 0, -3.2]]),
    goobyScale: 0.85,
    goobyLead: 0,
    bg: '#bfe0ff',
    fallback: Object.freeze(['#8ec9ff', '#eaf7d9']),
  }),
  // #2 Große Stadt — „lateral truck along a street canyon“; Gooby drives the
  // car-kit sedan down the street while the camera trucks parallel.
  city: Object.freeze({
    travel: 'drive',
    durSec: 10,
    fov: 48,
    rollAmpDeg: 0,
    camPath: Object.freeze([[-6.5, 1.5, 7], [-2.2, 1.6, 7], [2.2, 1.6, 7], [6.5, 1.5, 7]]),
    lookPath: Object.freeze([[-6, 1.1, -0.5], [-2, 1.0, -0.5], [2, 1.0, -0.5], [6, 1.1, -0.5]]),
    goobyPath: Object.freeze([[-9, 0, 1.4], [-4.5, 0, 1.4], [0, 0, 1.4], [4.5, 0, 1.4], [9, 0, 1.4]]),
    goobyScale: 0.55,
    goobyLead: 0.03,
    bg: '#aee0ff',
    fallback: Object.freeze(['#aee0ff', '#ffe9c9']),
  }),
  // #3 Hafen — „slow orbit around a fishing boat“; Gooby captains the bobbing
  // watercraft-kit fishing boat, camera arcs ~100° around it.
  harbor: Object.freeze({
    travel: 'boat',
    durSec: 11,
    fov: 47,
    rollAmpDeg: 0,
    backdropArc: 3.4,
    camPath: Object.freeze([
      [-5.6, 1.3, 3.6], [-3.2, 1.5, 5.6], [0.4, 1.7, 6.6], [3.8, 1.9, 5.2], [5.8, 2.1, 2.6],
    ]),
    lookPath: Object.freeze([[0, 1.0, 0], [0, 1.1, 0]]),
    goobyPath: Object.freeze([[0, 0, 0.4], [0, 0, -0.4]]), // gentle drift at anchor
    goobyScale: 0.6,
    goobyLead: 0,
    bg: '#ffe3c2',
    fallback: Object.freeze(['#ffd9a8', '#9fd4e8']),
  }),
  // #4 Weltraum — „forward glide, gentle roll ±4°“; Gooby pilots the space-kit
  // speeder through a meteor field, chase camera glides after it.
  space: Object.freeze({
    travel: 'fly',
    durSec: 10,
    fov: 50,
    rollAmpDeg: 4,
    camPath: Object.freeze([[-1.1, 2.4, 9.5], [-0.4, 2.6, 5.5], [0.5, 2.9, 1.5], [1.2, 3.3, -2.5]]),
    lookPath: Object.freeze([[-0.6, 1.6, 2], [0.2, 1.9, -3], [1.2, 2.4, -9]]),
    goobyPath: Object.freeze([[-1.4, 1.4, 4], [-0.5, 1.7, 0], [0.7, 2.0, -4], [1.6, 2.5, -8.5]]),
    goobyScale: 0.42,
    goobyLead: 0,
    bg: '#0a0d2a',
    fallback: Object.freeze(['#0a0d2a', '#27164d']),
  }),
  // #5 Spukgarten — „creep-dolly between graves, low fog plane“; Gooby tiptoes
  // the grave aisle, jack-o'-lanterns glowing, fog hugging the dirt.
  spookGarden: Object.freeze({
    travel: 'walk',
    durSec: 11,
    fov: 46,
    rollAmpDeg: 0,
    camPath: Object.freeze([[0.3, 1.45, 8.5], [-0.3, 1.35, 6.2], [0.3, 1.3, 3.8], [-0.2, 1.25, 1.6]]),
    lookPath: Object.freeze([[0, 0.75, 2], [0, 0.65, -0.5], [0, 0.6, -3.5]]),
    goobyPath: Object.freeze([[-0.7, 0, 5.4], [0.5, 0, 3.4], [-0.5, 0, 1.2], [0.3, 0, -1.2], [0, 0, -3]]),
    goobyScale: 0.85,
    goobyLead: 0,
    bg: '#2c2440',
    fallback: Object.freeze(['#2c2440', '#5a4a72']),
  }),
  // #6 Bäckerei — „slide along the counter, 20° look-down“; Gooby patrols the
  // treat-laden counters while the camera slides beside him looking down.
  bakery: Object.freeze({
    travel: 'walk',
    durSec: 10,
    fov: 46,
    rollAmpDeg: 0,
    camPath: Object.freeze([[-4.2, 2.8, 4.8], [-1.4, 2.8, 4.7], [1.4, 2.8, 4.7], [4.2, 2.8, 4.8]]),
    lookPath: Object.freeze([[-4.6, 0.7, -1.1], [-1.6, 0.7, -1.1], [1.5, 0.7, -1.1], [4.8, 0.7, -1.1]]),
    goobyPath: Object.freeze([[-5.2, 0, 0.3], [-2.4, 0, 0.2], [0.4, 0, 0.3], [2.8, 0, 0.2], [5.4, 0, 0.3]]),
    goobyScale: 0.8,
    goobyLead: 0.02,
    // the painted bakery interior IS the back wall — pull the cylinder close
    backdropRadius: 14,
    backdropHeight: 22,
    backdropCenterY: 5,
    bg: '#ffe6c4',
    fallback: Object.freeze(['#ffe6c4', '#fff4e0']),
  }),
  // #7 Nachthimmel — „slow tilt-up from horizon to zenith“; Gooby floats past
  // on a puffy cloud among the stars while the camera pitches skyward.
  nightSky: Object.freeze({
    travel: 'float',
    durSec: 10,
    fov: 50,
    rollAmpDeg: 0,
    camPath: Object.freeze([[0, 1.8, 8.5], [0, 2.0, 8.5], [0, 2.4, 8.5]]),
    lookPath: Object.freeze([[0, 2.2, -4], [0, 5.5, -4.5], [0, 13.5, -5]]),
    goobyPath: Object.freeze([[-2.4, 2.0, -2.2], [-0.9, 3.4, -2.7], [0.8, 5.4, -3.2], [2.1, 8.2, -3.7]]),
    goobyScale: 0.95,
    goobyLead: 0,
    bg: '#0b1030',
    fallback: Object.freeze(['#0b1030', '#27407a']),
  }),
  // #8 Spielzeugzimmer — „toy-height push past the racetrack“; mini Gooby laps
  // the toy-car-kit track in a toy kart, camera skims the rug beside it.
  toyRoom: Object.freeze({
    travel: 'drive',
    durSec: 10,
    fov: 48,
    rollAmpDeg: 0,
    camPath: Object.freeze([[-4.4, 1.15, 3.9], [-1.6, 1.05, 3.5], [1.6, 1.1, 3.4], [4.4, 1.2, 3.7]]),
    lookPath: Object.freeze([[-4.2, 0.25, -0.3], [-1.4, 0.22, -0.5], [1.4, 0.22, -0.3], [4.2, 0.25, -0.5]]),
    goobyPath: Object.freeze([[-5.6, 0.05, 0.2], [-2.8, 0.05, -0.5], [0, 0.05, 0.3], [2.8, 0.05, -0.4], [5.8, 0.05, 0.2]]),
    goobyScale: 0.34,
    goobyLead: 0.02,
    bg: '#ffdfc2',
    fallback: Object.freeze(['#ffd9b8', '#ffefdb']),
  }),
});

/** @param {number} v @param {number} lo @param {number} hi */
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Uniform Catmull-Rom sample of a waypoint list at t ∈ [0,1] (clamped; ends
 * are duplicated so the curve passes through the first/last waypoint).
 * 2-point lists degrade to a lerp; the output array is fresh each call
 * unless `out` is supplied.
 * @param {ReadonlyArray<ReadonlyArray<number>>} points [x,y,z] waypoints (≥ 2)
 * @param {number} t 0..1
 * @param {number[]} [out] reused output triple
 * @returns {number[]} [x, y, z]
 */
export function sampleSpline(points, t, out = [0, 0, 0]) {
  const n = points.length;
  const tt = clamp(Number(t) || 0, 0, 1);
  if (n === 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  if (n === 1) {
    out[0] = points[0][0]; out[1] = points[0][1]; out[2] = points[0][2];
    return out;
  }
  const segs = n - 1;
  const f = tt * segs;
  const i = Math.min(segs - 1, Math.floor(f));
  const u = f - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n - 1, i + 2)];
  const u2 = u * u;
  const u3 = u2 * u;
  for (let k = 0; k < 3; k++) {
    out[k] = 0.5 * (
      2 * p1[k] +
      (-p0[k] + p2[k]) * u +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 +
      (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3
    );
  }
  return out;
}

/**
 * Sample a vignette's dolly at progress p → plain-data camera pose. The
 * three.js side (vignettes.js update / G64's player) applies it verbatim;
 * pure so the paths are node-testable.
 * @param {string} id vignette id (VIGNETTE_IDS)
 * @param {number} p progress 0..1 (clamped)
 * @returns {{position: number[], look: number[], fov: number, rollDeg: number}|null}
 */
export function dollyPose(id, p) {
  const spec = VIGNETTE_SPECS[id];
  if (!spec) return null;
  const t = clamp(Number(p) || 0, 0, 1);
  return {
    position: sampleSpline(spec.camPath, t),
    look: sampleSpline(spec.lookPath, t),
    fov: spec.fov,
    rollDeg: spec.rollAmpDeg ? Math.sin(t * Math.PI * 2) * spec.rollAmpDeg : 0,
  };
}

/**
 * Gooby's spline pose at progress p: position + facing yaw along the path
 * tangent (rad, three.js convention: yaw 0 faces +z, atan2(dx, dz)).
 * @param {string} id vignette id
 * @param {number} p progress 0..1 (spec.goobyLead applied + clamped)
 * @returns {{position: number[], yaw: number}|null}
 */
export function goobyPose(id, p) {
  const spec = VIGNETTE_SPECS[id];
  if (!spec) return null;
  const t = clamp((Number(p) || 0) + (spec.goobyLead ?? 0), 0, 1);
  const pos = sampleSpline(spec.goobyPath, t);
  const EPS = 0.01;
  const ahead = sampleSpline(spec.goobyPath, clamp(t + EPS, 0, 1));
  const behind = sampleSpline(spec.goobyPath, clamp(t - EPS, 0, 1));
  const dx = ahead[0] - behind[0];
  const dz = ahead[2] - behind[2];
  const yaw = dx * dx + dz * dz > 1e-10 ? Math.atan2(dx, dz) : 0;
  return { position: pos, yaw };
}
