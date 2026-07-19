// V4/G65: splat-viewer pure seam (PLAN4-GAMES §G6.6, PLAN4 §E block G65).
// The node-testable half of src/welt/splatViewer.js: the VERBATIM DropInViewer
// option block from the D2 feasibility recipe (/workspace/asset-staging/
// splats/REPORT.md — every value binding per §G6.6), the quality-toggle table
// (settings.goobyWeltQuality → renderer/camera numbers), the lifecycle state
// machine that enforces the §G6.6 disposal discipline, and small URL/progress
// helpers. NO three.js / DOM / gaussian-splats-3d imports here — the heavy
// integration lives in splatViewer.js (which spreads these tables).

/**
 * §G6.6 DropInViewer constructor options — VERBATIM from the D2 report.
 * splatViewer.js spreads this and adds the one non-serializable entry:
 * `sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant` (enum lives in
 * the library; a source-pin test guards it instead).
 *
 * Why (recipe rationale, §G6.6):
 * - sharedMemoryForWorkers false — no COOP/COEP / crossOriginIsolated
 *   requirement under capacitor://localhost (WKWebView guard).
 * - gpuAcceleratedSort false — required with shared memory off; also the
 *   library's mobile default.
 * - sphericalHarmonicsDegree 0 + inMemoryCompressionLevel 2 — CPU/GPU memory.
 * - freeIntermediateSplatData true — releases decoded staging arrays.
 * - halfPrecisionCovariancesOnGPU false — avoids toHalfFloat() range warnings
 *   with the shipped sources.
 */
export const VIEWER_OPTIONS = Object.freeze({
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

/**
 * §G6.6 addSplatScene options — VERBATIM from the recipe. progressiveLoad
 * stays false on purpose: progressive loads disable in-memory compression and
 * raise the resident-memory risk (report). splatViewer.js adds the per-scene
 * `rotation` (orientation quaternion) and the wired `onProgress` on top.
 */
export const ADD_SCENE_OPTIONS = Object.freeze({
  splatAlphaRemovalThreshold: 5,
  showLoadingUI: false,
  progressiveLoad: false,
});

/**
 * iOS / WKWebView memory guards (§G6.6, binding): 1M active-splat ceiling,
 * ONE splat scene resident at a time (initViewer hard-disposes any live
 * viewer before creating the next), no shadows, SH0, pixel ratio ≤ 1.
 */
export const SPLAT_LIMITS = Object.freeze({
  MAX_SPLATS: 1_000_000,
  MAX_RESIDENT_SCENES: 1,
});

/**
 * §G6.6 quality toggle — `settings.goobyWeltQuality` ('high' = „Schön",
 * 'low' = „Flüssig", G53's save slice). Numbers binding:
 * high → renderer pixel ratio 1 (NEVER the app-wide cap of 2 — splats on
 * Retina are too expensive), camera far 90, star glow sprites on;
 * low → pixel ratio 0.75, camera far 60, star glow sprites off (the
 * starGlow flag is consumed by G66's game render, not the viewer).
 * @typedef {{id: 'high'|'low', pixelRatio: number, cameraFar: number, starGlow: boolean}} WeltQuality
 */
export const QUALITY = Object.freeze({
  high: Object.freeze({ id: 'high', pixelRatio: 1, cameraFar: 90, starGlow: true }),
  low: Object.freeze({ id: 'low', pixelRatio: 0.75, cameraFar: 60, starGlow: false }),
});

/**
 * Resolve a quality id defensively — anything that isn't exactly 'low'
 * becomes 'high' (mirrors core/save.js validate()'s clamp for the slice).
 * @param {unknown} id
 * @returns {WeltQuality}
 */
export function resolveQuality(id) {
  return id === 'low' ? QUALITY.low : QUALITY.high;
}

/**
 * Runtime URL of a committed splat file. Base must be import.meta.env.BASE_URL
 * so Vite's `base: './'` stays valid inside Capacitor (recipe step 2).
 * @param {string} baseUrl e.g. './' (dev+capacitor) or '/'
 * @param {string} file e.g. 'windmill-golden-gate-mobile.compressed.ply'
 * @returns {string}
 */
export function sceneUrl(baseUrl, file) {
  const base = typeof baseUrl === 'string' && baseUrl.length > 0 ? baseUrl : './';
  return `${base}${base.endsWith('/') ? '' : '/'}assets/splats/${file}`;
}

/**
 * Clamp a loader progress value to 0–100 (the library reports float percent;
 * NaN/negative → 0 so the progress UI never renders garbage).
 * @param {unknown} pct
 * @returns {number}
 */
export function clampProgress(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Map the library's LoaderStatus enum (0 Downloading / 1 Processing /
 * 2 Done) to the progress-UI phase the loading card renders.
 * @param {unknown} status
 * @returns {'download'|'process'|'done'}
 */
export function progressPhase(status) {
  if (status === 2) return 'done';
  if (status === 1) return 'process';
  return 'download';
}

/**
 * §G6.6 lifecycle state machine — the disposal-discipline seam. Every real
 * viewer handle in splatViewer.js drives one of these; illegal transitions
 * THROW so a leak-shaped bug (double init, init-after-dispose, re-use of a
 * disposed viewer) fails loudly instead of silently keeping workers alive.
 *
 * Legal phases/edges:
 *   idle → loading                     (initViewer entered)
 *   loading → ready                    (addSplatScene resolved)
 *   loading → failed                   (load rejected — caller falls back)
 *   loading → disposing                (disposed mid-load — abort path)
 *   ready|failed → disposing           (normal teardown)
 *   disposing → disposed               (worker teardown + PR restore done)
 *   disposed → (terminal — NEVER cache/reuse a disposed viewer, §G6.6)
 */
export const LIFECYCLE_EDGES = Object.freeze({
  idle: Object.freeze(['loading']),
  loading: Object.freeze(['ready', 'failed', 'disposing']),
  ready: Object.freeze(['disposing']),
  failed: Object.freeze(['disposing']),
  disposing: Object.freeze(['disposed']),
  disposed: Object.freeze([]),
});

/**
 * @returns {{phase: string, can(next: string): boolean, to(next: string): string}}
 */
export function createLifecycle() {
  let phase = 'idle';
  return {
    get phase() {
      return phase;
    },
    /** @param {string} next @returns {boolean} */
    can(next) {
      return (LIFECYCLE_EDGES[phase] ?? []).includes(next);
    },
    /** @param {string} next @returns {string} the new phase */
    to(next) {
      if (!this.can(next)) {
        throw new Error(`[splatViewer] illegal lifecycle transition '${phase}' → '${next}'`);
      }
      phase = next;
      return phase;
    },
  };
}
