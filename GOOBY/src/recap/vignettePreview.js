// V4/G63 — DEV-ONLY vignette preview scene (§E9 harness surface; the §E
// block's „dev harness page/param rendering each vignette standalone").
// Route: ?recappreview=<biome|1..8> (dev/harness.js marked block) — renders
// ONE biome vignette with its dolly looping at the authored durSec pace, so
// build agents / evals can screenshot all 8 and read perf numbers without
// the full cinematic (G64's player).
//
// CDP probe (window.__recapPreview):
//   show(id)        → switch biome (dispose current → build new)
//   stats()         → { biome, calls, triangles, geometries, textures,
//                       programs, budget, backdrop } (renderer.info of the
//                       last rendered frame)
//   cycle(id, n)    → build→dispose n× (leak check; returns renderer.info
//                       memory before/after — plateau expected)
//   setProgress(p)  → freeze the dolly at p (null resumes the loop)
//
// NOT part of the shipped cinematic — G64's recap screen is the production
// consumer of src/recap/vignettes.js.

import * as THREE from 'three';
import { buildVignette, preloadBackdrops, backdropStatus } from './vignettes.js';
import { VIGNETTE_IDS, VIGNETTE_SPECS, DRAW_CALL_BUDGET } from './vignettes.logic.js';
import { RECAP_ASSET_KEYS } from './recapAssets.js';

export { RECAP_ASSET_KEYS as PREVIEW_ASSET_KEYS };

/**
 * §E1 scene factory — register('recapPreview', createVignettePreviewScene,
 * RECAP_ASSET_KEYS) then switchTo('recapPreview', { biome }).
 * @param {{renderer: THREE.WebGLRenderer, assets: object}} ctx
 */
export function createVignettePreviewScene(ctx) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 120);

  /** @type {ReturnType<typeof buildVignette>|null} */
  let handle = null;
  let progress = 0;
  let frozen = null; // non-null → setProgress() pinned the dolly
  let elapsed = 0;

  function show(id) {
    const biome = VIGNETTE_IDS.includes(id)
      ? id
      : VIGNETTE_IDS[Math.max(0, Math.min(7, (parseInt(id, 10) || 1) - 1))];
    handle?.dispose();
    elapsed = 0;
    progress = 0;
    handle = buildVignette(biome, scene, ctx.assets, { camera });
    console.log(`[recapPreview] showing '${biome}' (durSec ${handle.durSec})`);
    return biome;
  }

  function stats() {
    const info = ctx.renderer.info;
    return {
      biome: handle?.id ?? null,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      budget: DRAW_CALL_BUDGET,
      backdrop: backdropStatus()[handle?.id] ?? 'pending',
    };
  }

  function cycle(id, n = 8) {
    const biome = VIGNETTE_IDS.includes(id) ? id : handle?.id ?? 'meadow';
    const mem = () => ({ ...ctx.renderer.info.memory });
    const before = mem();
    const perCycle = [];
    for (let i = 0; i < n; i++) {
      const h = buildVignette(biome, scene, ctx.assets, {});
      h.update(0.016, 0.5);
      h.dispose();
      perCycle.push(mem());
    }
    return { biome, n, before, after: mem(), perCycle };
  }

  return {
    scene,
    camera,

    async enter(params = {}) {
      await preloadBackdrops();
      show(params.biome ?? VIGNETTE_IDS[0]);
      window.__recapPreview = {
        ids: [...VIGNETTE_IDS],
        specs: VIGNETTE_SPECS,
        show,
        stats,
        cycle,
        setProgress(p) {
          frozen = p == null ? null : Math.max(0, Math.min(1, Number(p) || 0));
        },
        getProgress: () => (frozen ?? progress),
      };
    },

    update(dt) {
      if (!handle) return;
      elapsed = (elapsed + dt) % handle.durSec;
      progress = elapsed / handle.durSec;
      handle.update(dt, frozen ?? progress);
    },

    exit() {
      delete window.__recapPreview;
    },

    dispose() {
      handle?.dispose();
      handle = null;
    },
  };
}
