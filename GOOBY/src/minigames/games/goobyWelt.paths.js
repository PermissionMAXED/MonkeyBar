// Gooby Welt — authored path/pickup data for both splat scenes (PLAN4-GAMES
// §G6.2/§G6.3/§G6.5, agent V4/G66). PURE DATA: no three.js/DOM imports —
// test/goobyWelt.test.js validates every §G6.5-3 rule against this file.
//
// Authoring provenance (§G6.5 methodology): routes were designed from the D2
// feasibility proof poses (`/workspace/asset-staging/splats/REPORT.md`,
// throwaway/main.js camera/target per scene), generated parametrically,
// validated by goobyWelt.logic.js `validateScene`, then tuned with the
// `?minigame=goobyWelt&scene=<id>&flycam=1` harness route over CDP
// (screenshot pass at fixed spline t-values — see the V4/G66 report).
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
// Frames: 'windmill' PLY is already Y-up (identity quaternion). 'townsquare'
// (Ludlow) needs the recipe's mirrored-Y correction — rotX(pi), quaternion
// [1, 0, 0, 0], i.e. raw (x, y, z) → corrected (x, −y, −z); all data below
// is authored in the CORRECTED frame.

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
  // Route: approach over the meadow from the south-east, one wide clockwise
  // loop around the mill at stroller height, then a tighter CLIMBING arc up
  // past the sails, drifting out over the park to the finish gate. ≈ 175 m
  // ≈ 109 s at 1.6 m/s.
  windmill: {
    id: 'windmill',
    titleKey: 'mg.welt.scene.windmill',
    ply: 'windmill-golden-gate-mobile.compressed.ply',
    orientation: [0, 0, 0, 1],
    ambient: {
      sky: ['#AFD8F2', '#EAF6E4'],
      hemi: ['#DFF0FF', '#7FA868', 1.05],
      sun: '#FFF3D9',
      fallbackGround: '#7FBF6A',
    },
    waypoints: [
      [19.05, 5.3, 20.44],
      [18.21, 5.05, 13.82],
      [16.68, 4.85, 8.63],
      [14.47, 4.7, 3.46],
      [13.89, 5.06, -3.71],
      [10.14, 5.34, -9.66],
      [4.21, 5.49, -13.14],
      [-2.53, 5.48, -13.5],
      [-8.6, 5.32, -10.8],
      [-12.74, 5.05, -5.68],
      [-14.1, 4.75, 0.74],
      [-12.4, 4.48, 7.1],
      [-7.96, 4.32, 12.04],
      [-1.66, 4.31, 14.45],
      [5.18, 4.46, 13.69],
      [11.02, 4.74, 9.78],
      [14.47, 5.1, 3.46],
      [12.96, 6.33, -3.91],
      [8.34, 6.45, -9.08],
      [2.31, 6.58, -11.01],
      [-3.28, 6.7, -9.74],
      [-7.25, 6.83, -6.43],
      [-9.67, 6.95, -2.18],
      [-9.69, 7.08, 2.7],
      [-7.31, 7.2, 6.97],
      [-6.13, 6.9, 13.18],
      [-1.7, 6.4, 18.85],
      [4.3, 5.9, 22.41],
    ],
    corridor: [
      2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5,
      2.5, 2.5, 2, 2, 2, 2, 2, 2, 2, 2.5, 2.5, 2.5, 2.5,
    ],
    stars: [
      { s: 8, ox: 0.7, oy: -0.2 },
      { s: 13.88, ox: 1.74, oy: 0.97 },
      { s: 19.77, ox: 1.74, oy: 1.27 },
      { s: 25.65, ox: 0.7, oy: 0.48 },
      { s: 31.53, ox: -0.7, oy: -0.2 },
      { s: 37.41, ox: -1.55, oy: 0.73 },
      { s: 43.3, ox: -1.9, oy: 1.26 },
      { s: 49.18, ox: -1.55, oy: 1.16 },
      { s: 55.06, ox: -0.7, oy: 0.48 },
      { s: 60.95, ox: 0.7, oy: 1.3 },
      { s: 66.83, ox: 1.55, oy: 0.93 },
      { s: 72.71, ox: 1.9, oy: 0.55 },
      { s: 78.6, ox: 1.55, oy: 0.18 },
      { s: 84.48, ox: 0.7, oy: -0.2 },
      { s: 90.36, ox: -0.7, oy: -0.2 },
      { s: 96.24, ox: -1.55, oy: 0.73 },
      { s: 102.13, ox: -1.9, oy: 1.26 },
      { s: 108.01, ox: -1.55, oy: 1.16 },
      { s: 113.89, ox: -0.7, oy: 0.48 },
      { s: 118.48, ox: -0.56, oy: -0.2 },
      { s: 124.36, ox: -1.39, oy: 0.97 },
      { s: 132.84, ox: 1.74, oy: 1.27 },
      { s: 137.43, ox: 0.7, oy: 0.48 },
      { s: 143.31, ox: -0.7, oy: 1.3 },
      { s: 149.19, ox: -1.55, oy: 0.93 },
      { s: 155.07, ox: -1.9, oy: 0.55 },
      { s: 160.96, ox: -1.55, oy: 0.18 },
      { s: 166.84, ox: -0.7, oy: -0.2 },
    ],
    // Discovery spurs (§G6.4): full-lateral reaches behind the mill + two
    // full-vertical floats over the meadow.
    carrots: [
      { s: 22, ox: 2.4, oy: 0.3 },
      { s: 52, ox: -2.4, oy: 0.2 },
      { s: 80, ox: 0.2, oy: 1.7 },
      { s: 104, ox: 1.9, oy: -0.8 },
      { s: 134, ox: -0.3, oy: 1.7 },
      { s: 158.84, ox: -2.3, oy: 1 },
    ],
    // Landmarks: first full mill view on the approach, the meadow panorama
    // across the loop, the sails up close on the climbing arc.
    fotoSpots: [
      { s: 30, ox: 0, oy: 0.6 },
      { s: 88, ox: 0, oy: 0.9 },
      { s: 150, ox: 0, oy: 1.1 },
    ],
  },

  // ── „Ludlow - Quality Square" — ijenko, CC BY 4.0 (§G6.2) ──
  // Route: four weaving passes along the cobbled lane — stroller height out,
  // window height back, chimney height out again — settling into the open
  // square for the finish. Corrected frame (rotX(pi)). ≈ 168 m ≈ 105 s.
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
      [13.5, 1, -1.2],
      [8.67, 1.15, -0.42],
      [3.83, 1.26, -0.42],
      [-1, 1.3, -1.2],
      [-5.83, 1.26, -1.98],
      [-10.67, 1.15, -1.98],
      [-15.5, 1, -1.2],
      [-18.2, 1.7, 1.8],
      [-19.1, 1.95, 4.8],
      [-17.3, 2.1, 7.8],
      [-10.67, 2.75, 2.75],
      [-5.83, 2.86, 1.95],
      [-1, 2.9, 1.2],
      [3.83, 2.86, 1.25],
      [8.67, 2.75, 2.05],
      [13.5, 2.6, 2.8],
      [16.2, 3.8, -1],
      [17.1, 3.6, -4],
      [15.3, 3.4, -7],
      [8.67, 4.55, -1.09],
      [3.83, 4.66, -1.82],
      [-1, 4.7, -1.73],
      [-5.83, 4.66, -0.91],
      [-10.67, 4.55, -0.18],
      [-15.5, 4.4, -0.27],
      [-18.8, 3.05, -4.3],
      [-19.7, 2.85, -7.6],
      [-17.3, 2.75, -10.6],
      [-10.28, 1.68, 1.31],
      [-5.06, 1.79, 1.79],
      [0.16, 1.79, 2.84],
      [5.38, 1.68, 3],
      [10.6, 1.5, 2.06],
    ],
    corridor: [
      1.8, 1.8, 1.8, 1.8, 1.8, 2.2, 2.2, 2.2, 2.2, 2.2, 1.8, 1.8, 1.8, 1.8,
      2.2, 2.2, 2.2, 2.2, 2.2, 1.8, 1.8, 1.8, 1.8, 2.2, 2.2, 2.2, 2.2, 2.2,
      1.8, 1.8, 1.8, 1.8,
    ],
    stars: [
      { s: 7, ox: 0.55, oy: -0.2 },
      { s: 12.68, ox: 1.5, oy: 0.97 },
      { s: 18.36, ox: 1.5, oy: 1.27 },
      { s: 24.04, ox: 0.55, oy: 0.48 },
      { s: 29.72, ox: -0.55, oy: -0.2 },
      { s: 35.4, ox: -1.33, oy: 0.73 },
      { s: 41.08, ox: 1.32, oy: 1.26 },
      { s: 46.76, ox: -1.33, oy: 1.16 },
      { s: 52.44, ox: -0.55, oy: 0.48 },
      { s: 58.12, ox: 0.55, oy: 1.3 },
      { s: 63.8, ox: 1.33, oy: 0.93 },
      { s: 69.47, ox: 1.65, oy: 0.55 },
      { s: 75.15, ox: 1.33, oy: 0.18 },
      { s: 80.83, ox: 0.55, oy: -0.2 },
      { s: 86.51, ox: -0.55, oy: -0.2 },
      { s: 92.19, ox: -1.33, oy: 0.73 },
      { s: 97.87, ox: -1.65, oy: 1.26 },
      { s: 103.55, ox: -1.33, oy: 1.16 },
      { s: 109.23, ox: -0.55, oy: 0.48 },
      { s: 114.91, ox: 0.55, oy: -0.2 },
      { s: 120.59, ox: 1.5, oy: 0.97 },
      { s: 126.27, ox: 1.5, oy: 1.27 },
      { s: 131.95, ox: 0.55, oy: 0.48 },
      { s: 137.63, ox: -0.55, oy: 1.3 },
      { s: 142.01, ox: 1.06, oy: 0.93 },
      { s: 148.99, ox: 1.32, oy: 0.55 },
      { s: 154.67, ox: -1.33, oy: 0.18 },
      { s: 159.05, ox: -0.55, oy: -0.2 },
    ],
    // Discovery spurs: under the archway eaves, up at the window boxes,
    // low over the cobbles, high at the chimney line.
    carrots: [
      { s: 20, ox: -1.7, oy: 0.2 },
      { s: 48, ox: 1.6, oy: 1.5 },
      { s: 74, ox: -1.6, oy: -0.7 },
      { s: 100, ox: 1.7, oy: 1.6 },
      { s: 128, ox: -1.7, oy: 0.4 },
      { s: 154.35, ox: 1.6, oy: 1.4 },
    ],
    // Landmarks: the lane vista, the upper-floor facades, the square from
    // rooftop height on the last pass.
    fotoSpots: [
      { s: 28, ox: 0, oy: 0.7 },
      { s: 84, ox: 0, oy: 1.2 },
      { s: 142.35, ox: 0, oy: 0.6 },
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
