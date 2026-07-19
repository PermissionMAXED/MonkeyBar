// Gooby Welt — authored path/pickup data for both splat scenes (PLAN4-GAMES
// §G6.2/§G6.3/§G6.5, agent V4/G66). PURE DATA: no three.js/DOM imports —
// test/goobyWelt.test.js validates every §G6.5-3 rule against this file.
//
// Authoring provenance (§G6.5 methodology): routes were designed from the D2
// feasibility proof poses (`/workspace/asset-staging/splats/REPORT.md`),
// generated parametrically in the CORRECTED frame, validated by
// goobyWelt.logic.js `validateScene`, then tuned against an OCCUPANCY FIELD
// decoded from the committed compressed PLYs (Node-side, corrected-frame
// point cloud): spline centre must be splat-free, corridor extremes may only
// brush foliage/edge clouds, every pickup sphere sits in open air. Final
// visual pass over the `?minigame=goobyWelt&scene=<id>` harness via CDP
// (screenshots at fixed spline t-values — see the V4/G66 report).
//
// TEAM-WELT COORDINATION (G65, same wave): G65's `src/welt/splatViewer.js`
// owns viewer creation (`initViewer(sceneId, { quality })` → Promise) and its
// `src/welt/weltScenes.js` keys viewer-side data by THE SAME scene ids used
// here ('windmill' | 'townsquare'). This module is the single source for
// GAMEPLAY-side data: waypoints (corrected Y-up frame), per-SEGMENT corridor
// half-widths, spline-relative pickups {s: arc-m, ox: lateral-m (+ = screen
// right), oy: vertical-m}, and the per-scene `orientation` quaternion
// [x, y, z, w] that maps the RAW splat into this corrected frame (§G6.3 —
// baked here instead of touching camera.up so the §E8 camera stays
// framework-standard). goobyWelt.js applies it to the viewer object unless
// the G65 handle reports `orientationApplied: true`.
//
// Frames: BOTH PLYs are Y-down after the SOG→PLY conversion — the recipe's
// mirrored-Y correction is rotX(pi), quaternion [1, 0, 0, 0], i.e. raw
// (x, y, z) → corrected (x, −y, −z); all data below is authored in the
// CORRECTED frame. (V4/G65 reconciliation, §G6.3: the throwaway's „windmill
// already Y-up" claim only held for its top-down proof pose — ground-level
// §G6.5 CDP probes rendered the tower upside-down under identity, so the
// windmill row carries the same correction; evidence /tmp/gooby-v4-g65,
// math note in src/welt/weltScenes.js header.)

/** Recursively freeze plain data (arrays/objects of numbers). */
function deepFreeze(v) {
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    Object.freeze(v);
  }
  return v;
}

/** The two shipped §G6.2 scenes, in presentation order. */
export const WELT_SCENE_IDS = Object.freeze(['windmill', 'townsquare']);

/**
 * @typedef {Object} WeltSceneData
 * @property {string} id            scene id (== G65 weltScenes.js key)
 * @property {string} titleKey      strings key (v4-welt.js) for the scene name
 * @property {string} ply           file under public/assets/splats/
 * @property {[number,number,number,number]} orientation raw→corrected quat [x,y,z,w]
 * @property {{sky: [string,string], hemi: [string,string,number], sun: string,
 *   fallbackGround: string}} ambient scene tint (viewer bg + fallback stage)
 * @property {ReadonlyArray<[number,number,number]>} waypoints 25–40 spline pts
 * @property {ReadonlyArray<number>} corridor per-SEGMENT half-widths (≥ 1.2)
 * @property {ReadonlyArray<{s:number, ox:number, oy:number}>} stars 28 ×(+2)
 * @property {ReadonlyArray<{s:number, ox:number, oy:number}>} carrots 6 ×(+5)
 * @property {ReadonlyArray<{s:number, ox:number, oy:number}>} fotoSpots 3 ×(+10)
 */

/** @type {Readonly<Record<string, WeltSceneData>>} */
export const WELT_SCENES = deepFreeze({
  // ── „S Windmill in Golden Gate Park" — azadbal, CC BY 4.0 (§G6.2) ──
  // Route (corrected frame; mill trunk at x −0.2, z −0.4, canopy tops ≈ y 3
  // on the meadow ring): approach over the SE meadow, one wide counter-
  // clockwise loop around the mill (r ≈ 15 m, climbing 3.1 → 4.4), a tighter
  // CLIMBING spiral in past the sails (r → 9.9, y → 4.8), then out ESE over
  // the open low meadow to the finish. ≈ 172 m ≈ 108 s at 1.6 m/s.
  windmill: {
    id: 'windmill',
    titleKey: 'mg.welt.scene.windmill',
    ply: 'windmill-golden-gate-mobile.compressed.ply',
    orientation: [1, 0, 0, 0], // V4/G65: Y-down source like Ludlow — A/B render proof, header note (§G6.3)
    ambient: {
      sky: ['#AFD8F2', '#EAF6E4'],
      hemi: ['#DFF0FF', '#7FA868', 1.05],
      sun: '#FFF3D9',
      fallbackGround: '#7FBF6A',
    },
    waypoints: [
      [13.72, 3.1, 9.71],
      [8.86, 3.15, 12.54],
      [2.1, 3.57, 15.09],
      [-5.02, 3.98, 14.36],
      [-11.01, 4.36, 10.55],
      [-14.63, 4.49, 4.52],
      [-15.17, 4.45, -2.42],
      [-12.58, 4.39, -8.82],
      [-7.44, 4.31, -13.34],
      [-0.89, 4.25, -15.08],
      [5.68, 4.21, -13.71],
      [10.9, 4.2, -9.59],
      [13.71, 4.23, -3.63],
      [13.55, 4.28, 2.89],
      [10.52, 4.35, 8.6],
      [4.55, 4.53, 12.65],
      [-2.56, 4.56, 12.97],
      [-8.63, 4.59, 9.65],
      [-12, 4.62, 3.89],
      [-11.97, 4.65, -2.48],
      [-8.89, 4.68, -7.69],
      [-3.89, 4.71, -10.54],
      [1.59, 4.74, -10.57],
      [6.24, 4.77, -8.07],
      [9.1, 4.8, -3.79],
      [11.5, 4.35, -5.4],
      [15.2, 3.8, -3.6],
      [18.2, 3.35, -1.4],
      [20.3, 3.05, 1.2],
      [21.1, 2.9, 3.9],
    ],
    corridor: [
      2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5,
      2, 2, 2, 2, 2, 2, 2, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5,
    ],
    stars: [
      { s: 8, ox: 0.7, oy: -0.2 },
      { s: 13.9, ox: 1.74, oy: 0.97 },
      { s: 19.8, ox: 1.74, oy: 1.27 },
      { s: 25.69, ox: 0.7, oy: 0.48 },
      { s: 31.59, ox: -0.7, oy: -0.2 },
      { s: 37.49, ox: -1.55, oy: 0.73 },
      { s: 43.39, ox: -1.9, oy: 1.26 },
      { s: 49.28, ox: -1.55, oy: 1.16 },
      { s: 55.18, ox: -0.7, oy: 0.48 },
      { s: 61.08, ox: 0.7, oy: 1.3 },
      { s: 66.98, ox: -1.24, oy: 0.93 },
      { s: 72.87, ox: 1.9, oy: 0.55 },
      { s: 78.77, ox: 1.55, oy: 0.18 },
      { s: 84.67, ox: 0.7, oy: -0.2 },
      { s: 90.57, ox: -0.7, oy: -0.2 },
      { s: 96.46, ox: -1.55, oy: 0.73 },
      { s: 102.36, ox: -1.9, oy: 1.26 },
      { s: 108.26, ox: -1.55, oy: 1.16 },
      { s: 114.16, ox: -0.7, oy: 0.48 },
      { s: 120.06, ox: 0.7, oy: -0.2 },
      { s: 125.95, ox: 1.74, oy: 0.97 },
      { s: 131.85, ox: 1.74, oy: 1.27 },
      { s: 137.75, ox: 0.7, oy: 0.48 },
      { s: 143.65, ox: -0.7, oy: 1.3 },
      { s: 149.54, ox: -1.55, oy: 0.93 },
      { s: 155.44, ox: 1.52, oy: 0.55 },
      { s: 163.94, ox: -1.55, oy: 0.18 },
      { s: 167.24, ox: -0.7, oy: -0.2 },
    ],
    // Discovery spurs (§G6.4): full-lateral reaches over the meadow edge, a
    // full-vertical float, an inward reach toward the mill, one behind the
    // sails on the inner spiral, and a low meadow dive on the exit.
    carrots: [
      { s: 24, ox: -2.4, oy: 0.3 },
      { s: 56, ox: -2.3, oy: 0.6 },
      { s: 84, ox: 0.2, oy: 1.6 },
      { s: 112, ox: 2, oy: 0.4 },
      { s: 142, ox: 1.9, oy: 0.9 },
      { s: 160.24, ox: -2.3, oy: -0.8 },
    ],
    // Landmarks: first full mill view on the east loop, the NW meadow
    // panorama, the sails up close at the end of the climbing spiral.
    fotoSpots: [
      { s: 30, ox: 0, oy: 0.6 },
      { s: 88, ox: 0, oy: 0.9 },
      { s: 147.24, ox: 0, oy: 0.8 },
    ],
  },

  // ── „Ludlow - Quality Square" — ijenko, CC BY 4.0 (§G6.2) ──
  // Route (corrected frame): the „walk into another world" reveal down the
  // narrow alley (x ≈ 18.3, walls at ~16.9/~19.6), through the arch doorway
  // at z ≈ 0, a low westward cruise along the clean z ≈ −3.1 plaza lane,
  // then a RISING STADIUM HELIX — 2.7 laps around the square on straight
  // rails z −6.15/−1.65 with r 2.25 semicircle caps, y 4.2 → 6.8 (interior
  // open to y 6.5+) — and a descending west sweep to a mid-square finish.
  // ≈ 174 m ≈ 109 s at 1.6 m/s.
  townsquare: {
    id: 'townsquare',
    titleKey: 'mg.welt.scene.townsquare',
    ply: 'ludlow-quality-square-mobile.compressed.ply',
    orientation: [1, 0, 0, 0],
    ambient: {
      sky: ['#C9D9EE', '#F2E8DC'],
      hemi: ['#E8EEF8', '#8A7B6A', 1.0],
      sun: '#FFE9C9',
      fallbackGround: '#9A8D7F',
    },
    waypoints: [
      [18.4, 1.5, 14.6],
      [18.35, 1.6, 10.9],
      [18.25, 1.75, 7.1],
      [18.15, 1.95, 3.4],
      [18.3, 2.3, 1.7],
      [18.1, 2.65, 0.4],
      [17, 2.95, -1],
      [15.4, 3.2, -2],
      [9.4, 3.35, -3.1],
      [2.2, 3.5, -3.15],
      [-4.82, 4.2, -2.45],
      [-2.74, 4.32, -6.15],
      [2.73, 4.45, -6.15],
      [8.2, 4.57, -6.15],
      [13.15, 4.7, -4.83],
      [10.13, 4.82, -1.65],
      [4.66, 4.94, -1.65],
      [-0.81, 5.07, -1.65],
      [-5.32, 5.19, -3.55],
      [-1.52, 5.31, -6.15],
      [3.95, 5.44, -6.15],
      [9.42, 5.56, -6.15],
      [13.34, 5.69, -3.65],
      [8.91, 5.81, -1.65],
      [3.44, 5.93, -1.65],
      [-2.03, 6.06, -1.65],
      [-5.19, 6.18, -4.74],
      [-0.31, 6.3, -6.15],
      [5.16, 6.43, -6.15],
      [10.63, 6.55, -6.15],
      [12.89, 6.68, -2.53],
      [7.7, 6.8, -1.65],
      [-0.6, 6.3, -2.4],
      [-4.4, 5.5, -3.6],
      [-4.2, 4.8, -5.3],
      [0.2, 4.3, -5.7],
      [4.6, 3.9, -5],
      [7.4, 3.6, -3.8],
    ],
    corridor: [
      1.2, 1.2, 1.2, 1.2, 1.2, 1.3, 1.3, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6,
      1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6,
      1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6,
    ],
    stars: [
      { s: 6, ox: 0.5, oy: -0.2 },
      { s: 11.53, ox: 1.2, oy: 0.97 },
      { s: 17.06, ox: 1.24, oy: 1.27 },
      { s: 22.59, ox: 0.5, oy: -0.48 },
      { s: 28.12, ox: -0.5, oy: -0.2 },
      { s: 33.65, ox: -1.1, oy: -0.73 },
      { s: 39.18, ox: -1.35, oy: 1.26 },
      { s: 44.71, ox: -1.1, oy: -0.9 },
      { s: 51.54, ox: -0.5, oy: 0.48 },
      { s: 55.77, ox: 0.5, oy: -0.9 },
      { s: 61.3, ox: 1.1, oy: 0.93 },
      { s: 66.83, ox: 1.35, oy: 0.05 },
      { s: 72.36, ox: -0.88, oy: 0.18 },
      { s: 77.89, ox: 0.5, oy: -0.2 },
      { s: 83.42, ox: -0.5, oy: -0.2 },
      { s: 88.95, ox: -1.1, oy: 0.73 },
      { s: 94.48, ox: -1.35, oy: -0.9 },
      { s: 101.31, ox: -1.1, oy: 1.16 },
      { s: 105.54, ox: -0.5, oy: 0.48 },
      { s: 111.07, ox: 0.5, oy: 0.7 },
      { s: 116.6, ox: -0.99, oy: 0.97 },
      { s: 122.13, ox: 1.24, oy: 1.27 },
      { s: 126.36, ox: 0.5, oy: 0.48 },
      { s: 133.19, ox: -0.5, oy: 1.3 },
      { s: 138.72, ox: -1.1, oy: 0.93 },
      { s: 144.25, ox: -1.35, oy: 1.45 },
      { s: 148.48, ox: -1.1, oy: 0.18 },
      { s: 155.31, ox: 0.4, oy: -0.2 },
    ],
    // Discovery spurs: up at the archway lintel, low over the cobbles on the
    // west cruise, outward on the first helix lap, up at the upper-floor
    // windows, along the chimney line, and a low cobble dive on the tail.
    carrots: [
      { s: 7, ox: 0.1, oy: 1.55 },
      { s: 34, ox: -1.4, oy: -0.5 },
      { s: 66, ox: 1.4, oy: 0.4 },
      { s: 100, ox: -1.5, oy: 1.2 },
      { s: 132, ox: 1.5, oy: 0.9 },
      { s: 160, ox: -1.4, oy: -0.6 },
    ],
    // Landmarks: the square reveal just past the arch, the mid-square facade
    // panorama, the square from rooftop height on the top lap.
    fotoSpots: [
      { s: 16, ox: 0, oy: 0.5 },
      { s: 82, ox: 0, oy: 0.8 },
      { s: 150, ox: 0, oy: 0.6 },
    ],
  },
});

/**
 * Defensive scene lookup (harness/pregame may pass anything).
 * @param {*} id
 * @returns {WeltSceneData} the requested scene or the first shipped one
 */
export function weltScene(id) {
  return WELT_SCENES[id] ?? WELT_SCENES[WELT_SCENE_IDS[0]];
}
