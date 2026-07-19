// V4/G65: Gooby-Welt scene registry (PLAN4-GAMES §G6.2/§G6.3, PLAN4 §E block
// G65). PURE DATA — no three.js/DOM imports (node-tested). The two shipped
// photogrammetry scenes with their §G6 authoring metadata: file, attribution
// (must mirror data/credits.js section 2 verbatim — CC BY 4.0 obligation),
// per-scene orientation quaternion (the SOG→PLY up-axis correction baked as
// data so the §E8 camera stays framework-standard, §G6.3), verified
// spawn/preview poses from the D2 proof project, ambient tint, and the
// PATH-METADATA FORMAT CONTRACT for G66's goobyWelt.paths.js (validator
// below — G66's tests add the §G6.5-3 numeric rules on top).
//
// Orientation math (the §G6.3 „Ludlow needs mirrored Y + camera.up.y = −1"
// recipe note, resolved as data): the SOG→PLY conversions are Y-down, so a
// π rotation about X ((x,y,z) → (x,−y,−z), quaternion [1,0,0,0]) brings a
// scene into three.js Y-up space. The proof camera poses transform with the
// same rotation — verified against /workspace/asset-staging/splats/
// throwaway/main.js. NOTE: the throwaway marked the WINDMILL file as
// already-Y-up (`up: [0,1,0]`), but that only held because its proof pose
// was top-down (a vertically mirrored aerial view still looks plausible).
// G65's ground-level §G6.5 CDP pose probes rendered the windmill tower
// upside-down, so BOTH scenes carry the π-about-X correction; the windmill
// tower was located by two-ray triangulation at data-space (−0.2, −2.0,
// 0.4) → corrected world (−0.2, 2.0, −0.4) (evidence /tmp/gooby-v4-g65).

/**
 * @typedef {Object} WeltPose
 * @property {[number, number, number]} position world-space camera position
 * @property {[number, number, number]} lookAt   world-space look target
 * @property {number} fov                        vertical FOV (preview framing;
 *   the GAME camera is always FOV 58 per §G6.3 — G66 owns that)
 */

/**
 * @typedef {Object} WeltSceneDef
 * @property {string} id        scene id ('windmill' | 'townsquare')
 * @property {string} file      PLY under public/assets/splats/
 * @property {string} licenseFile sibling attribution txt (§G6.2)
 * @property {{en: string, de: string}} title display name (scene select /
 *   loading card / results subtitle — data-borne like foods/outfits rows)
 * @property {number} splatCount active splats (≤ SPLAT_LIMITS.MAX_SPLATS)
 * @property {number} sizeMB    committed file size (ledger cross-check)
 * @property {{title: string, by: string, license: string, source: string}} attribution
 *   MUST match the data/credits.js welten row verbatim (CC BY 4.0)
 * @property {[number, number, number, number]} orientation [x,y,z,w] unit
 *   quaternion passed to addSplatScene({rotation}) — up-axis correction
 * @property {WeltPose} spawn   §G6 spawn pose — where the authored path
 *   starts; G66's waypoint[0] should sit at/near this point
 * @property {WeltPose} preview verified full-scene framing (dev preview,
 *   teleport card, cover-art reference) — from the D2 proof project
 * @property {string} ambientTint hex — scene clear color / fog-ish tint
 */

/** @type {readonly WeltSceneDef[]} */
export const WELT_SCENES = Object.freeze([
  Object.freeze({
    id: 'windmill',
    file: 'windmill-golden-gate-mobile.compressed.ply',
    licenseFile: 'windmill.LICENSE.txt',
    title: Object.freeze({ en: 'Windmill Park', de: 'Windmühlen-Park' }),
    splatCount: 1_000_000,
    sizeMB: 15.5,
    attribution: Object.freeze({
      title: 'S Windmill in Golden Gate Park',
      by: 'azadbal',
      license: 'CC BY 4.0',
      source: 'https://superspl.at/scene/d5f14e49',
    }),
    // π about X — Y-down source → Y-up world (see header math note).
    orientation: Object.freeze([1, 0, 0, 0]),
    // Authored via the §G6.5 CDP pose probes (NOT the throwaway top-down
    // pose): tower dome triangulated at corrected (−0.2, 2.0, −0.4); this
    // pose frames dome + sails + fantail from the south-east at sail height.
    spawn: Object.freeze({
      position: Object.freeze([6.0, 2.5, 5.0]),
      lookAt: Object.freeze([-0.3, 3.5, -0.4]),
      fov: 55,
    }),
    preview: Object.freeze({
      position: Object.freeze([6.0, 2.5, 5.0]),
      lookAt: Object.freeze([-0.3, 3.5, -0.4]),
      fov: 55,
    }),
    ambientTint: '#a8c6a1',
  }),
  Object.freeze({
    id: 'townsquare',
    file: 'ludlow-quality-square-mobile.compressed.ply',
    licenseFile: 'townsquare.LICENSE.txt',
    title: Object.freeze({ en: 'Town Square', de: 'Marktplatz' }),
    splatCount: 1_000_000,
    sizeMB: 15.5,
    attribution: Object.freeze({
      title: 'Ludlow - Quality Square',
      by: 'ijenko',
      license: 'CC BY 4.0',
      source: 'https://superspl.at/scene/ca36efcc',
    }),
    // π about X — Y-down source → Y-up world (see header math note).
    orientation: Object.freeze([1, 0, 0, 0]),
    // Proof pose [13.391,−0.0502,0.9755]→[4.3869,−0.7766,1.6368] (up −Y)
    // rotated by the SAME quaternion → standard-up equivalents:
    spawn: Object.freeze({
      position: Object.freeze([13.3910007, 0.05023608, -0.97553486]),
      lookAt: Object.freeze([4.3868918, 0.7766409, -1.6367698]),
      fov: 96,
    }),
    preview: Object.freeze({
      position: Object.freeze([13.3910007, 0.05023608, -0.97553486]),
      lookAt: Object.freeze([4.3868918, 0.7766409, -1.6367698]),
      fov: 96,
    }),
    ambientTint: '#c9b8a6',
  }),
]);

/** @type {readonly string[]} */
export const WELT_SCENE_IDS = Object.freeze(WELT_SCENES.map((s) => s.id));

/**
 * @param {string} id
 * @returns {WeltSceneDef|null}
 */
export function getWeltScene(id) {
  return WELT_SCENES.find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// §G6.5 path-metadata FORMAT CONTRACT (G66's goobyWelt.paths.js authors one
// of these per scene; test/goobyWelt.test.js layers the §G6.5-3 NUMERIC rules
// — spline length 165–185 m, corridor ≥ 1.2 m, star spacing ≥ 2.5 m,
// foto-spots ≥ 25 m apart — on top of this SHAPE validator).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} WeltPathMeta
 * @property {string} sceneId               must match a WELT_SCENES id
 * @property {Array<[number, number, number]>} waypoints Catmull-Rom control
 *   points in WORLD space (post-orientation — the same space as spawn),
 *   25–40 per §G6.5-2; waypoint[0] ≈ the scene's spawn.position
 * @property {number[]} corridorHalfWidths  per-SEGMENT lateral clamp (m),
 *   length === waypoints.length − 1 (§G6.4 offsets clamp inside these)
 * @property {Array<[number, number, number]>} stars     28 world positions
 * @property {Array<[number, number, number]>} carrots   6 world positions
 * @property {Array<[number, number, number]>} fotoSpots 3 trigger centers
 *   (r = 3 m spheres, §G6.4)
 * @property {[number, number, number, number]} orientation copy of the scene
 *   def's quaternion (paths are self-contained for the pure logic tests)
 * @property {string} ambientTint            hex tint copy
 */

/** §G6.4/§G6.5 fixed pickup counts per scene. */
export const PATH_PICKUP_COUNTS = Object.freeze({ stars: 28, carrots: 6, fotoSpots: 3 });

/** @param {unknown} v @returns {boolean} finite [x,y,z] triple */
function isVec3(v) {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n));
}

/** @param {unknown} q @returns {boolean} finite, unit-length [x,y,z,w] */
export function isUnitQuaternion(q) {
  if (!Array.isArray(q) || q.length !== 4 || !q.every((n) => Number.isFinite(n))) return false;
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return Math.abs(len - 1) < 1e-6;
}

/**
 * Validate a §G6.5 path-metadata object's SHAPE. Returns a list of problems
 * (empty = valid) so G66's tests can assert both directions cheaply.
 * @param {unknown} meta
 * @returns {string[]}
 */
export function validateWeltPathMeta(meta) {
  const errs = [];
  if (meta == null || typeof meta !== 'object') return ['meta is not an object'];
  const m = /** @type {Record<string, any>} */ (meta);
  if (!WELT_SCENE_IDS.includes(m.sceneId)) errs.push(`unknown sceneId '${m.sceneId}'`);
  if (!Array.isArray(m.waypoints) || m.waypoints.length < 25 || m.waypoints.length > 40) {
    errs.push('waypoints must be an array of 25–40 points (§G6.5-2)');
  } else if (!m.waypoints.every(isVec3)) {
    errs.push('waypoints must all be finite [x,y,z]');
  }
  if (!Array.isArray(m.corridorHalfWidths)
    || !Array.isArray(m.waypoints)
    || m.corridorHalfWidths.length !== Math.max(0, m.waypoints.length - 1)) {
    errs.push('corridorHalfWidths must have waypoints.length − 1 entries');
  } else if (!m.corridorHalfWidths.every((w) => Number.isFinite(w) && w > 0)) {
    errs.push('corridorHalfWidths must all be finite and > 0');
  }
  for (const [key, want] of Object.entries(PATH_PICKUP_COUNTS)) {
    if (!Array.isArray(m[key]) || m[key].length !== want) {
      errs.push(`${key} must have exactly ${want} entries (§G6.4)`);
    } else if (!m[key].every(isVec3)) {
      errs.push(`${key} entries must all be finite [x,y,z]`);
    }
  }
  if (!isUnitQuaternion(m.orientation)) errs.push('orientation must be a unit [x,y,z,w] quaternion');
  if (typeof m.ambientTint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(m.ambientTint)) {
    errs.push('ambientTint must be a #rrggbb hex string');
  }
  return errs;
}

/**
 * Validate a WeltSceneDef row (the registry's own tests run this over both
 * shipped rows; also exported for the eval agent's probes).
 * @param {unknown} def
 * @returns {string[]} problems (empty = valid)
 */
export function validateWeltSceneDef(def) {
  const errs = [];
  if (def == null || typeof def !== 'object') return ['def is not an object'];
  const d = /** @type {Record<string, any>} */ (def);
  if (typeof d.id !== 'string' || d.id.length === 0) errs.push('id missing');
  if (typeof d.file !== 'string' || !d.file.endsWith('.ply')) errs.push('file must be a .ply');
  if (typeof d.licenseFile !== 'string' || !d.licenseFile.endsWith('.txt')) errs.push('licenseFile must be a .txt');
  if (typeof d.title?.en !== 'string' || d.title.en.length === 0) errs.push('title.en missing');
  if (typeof d.title?.de !== 'string' || d.title.de.length === 0) errs.push('title.de missing');
  if (!Number.isFinite(d.splatCount) || d.splatCount <= 0) errs.push('splatCount must be > 0');
  if (!Number.isFinite(d.sizeMB) || d.sizeMB <= 0) errs.push('sizeMB must be > 0');
  for (const k of ['title', 'by', 'license', 'source']) {
    if (typeof d.attribution?.[k] !== 'string' || d.attribution[k].length === 0) {
      errs.push(`attribution.${k} missing (CC BY 4.0 obligation, §G6.2)`);
    }
  }
  if (!isUnitQuaternion(d.orientation)) errs.push('orientation must be a unit [x,y,z,w] quaternion');
  for (const poseKey of ['spawn', 'preview']) {
    const p = d[poseKey];
    if (!isVec3(p?.position)) errs.push(`${poseKey}.position must be finite [x,y,z]`);
    if (!isVec3(p?.lookAt)) errs.push(`${poseKey}.lookAt must be finite [x,y,z]`);
    if (!Number.isFinite(p?.fov) || p.fov <= 0 || p.fov >= 180) errs.push(`${poseKey}.fov out of range`);
  }
  if (typeof d.ambientTint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(d.ambientTint)) {
    errs.push('ambientTint must be a #rrggbb hex string');
  }
  return errs;
}
