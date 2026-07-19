// V4/G68 — modifier tile glow (PLAN4 §C-SYS4.5, the „shader-style" effect):
// a tile-sized <canvas> overlay (pointer-events: none) compositing with
// globalCompositeOperation 'lighter':
//   (a) twirl_02.png tinted (§C-SYS4.5 per-type tint, gold default),
//       rotating 0.15 rev/s at 55 % opacity;
//   (b) circle_04.png soft ring pulsing scale 0.92→1.08 / opacity
//       0.35→0.6 at 0.8 Hz;
//   (c) 6 sparkle particles (star_03.png, 8–12 px) orbiting the border,
//       respawning every 1.2 s.
// ONE shared rAF drives every glow on the arcade screen (createGlowManager);
// the loop stops entirely while the document is hidden or the owning screen
// pauses it, and getStats() exposes the per-frame cost for the ≤ 1 ms/frame
// budget probe. Textures are G50's Brackeys VFX pack (§B3 —
// public/assets/itch/vfx/, white-on-BLACK opaque: luminance becomes the
// sprite alpha during tinting so 'lighter' never adds black boxes).
//
// Animation math is exported PURE (pulseAt/twirlAngleAt/sparkleAt) so
// node:test pins the §C-SYS4.5 numbers without a DOM. Wave-3 G76 (modifier
// surfacing sweep) consolidates/extends this component — keep the exports
// stable.

/** §C-SYS4.5 numbers — frozen here per the §E0.1-2 owning-module rule. */
export const GLOW = Object.freeze({
  /** Texture root (G50's §B3 inventory). */
  TEXTURE_DIR: 'assets/itch/vfx/',
  TWIRL: 'twirl_02.png',
  RING: 'circle_04.png',
  SPARKLE: 'star_03.png',
  /** (a) twirl rotation, revolutions per second + opacity. */
  ROT_REV_PER_SEC: 0.15,
  TWIRL_ALPHA: 0.55,
  /** (b) ring pulse: 0.8 Hz, scale 0.92→1.08, opacity 0.35→0.6. */
  PULSE_HZ: 0.8,
  PULSE_SCALE_MIN: 0.92,
  PULSE_SCALE_MAX: 1.08,
  PULSE_ALPHA_MIN: 0.35,
  PULSE_ALPHA_MAX: 0.6,
  /** (c) sparkles: 6 × star_03 at 8–12 px, respawn every 1.2 s. */
  SPARKLE_COUNT: 6,
  SPARKLE_MIN_PX: 8,
  SPARKLE_MAX_PX: 12,
  SPARKLE_RESPAWN_SEC: 1.2,
  /** Default tint (gold — doppelGold/glueckspilz). */
  DEFAULT_TINT: '#FFD34D',
  /** On-device per-frame budget (ms) — see getStats(). */
  FRAME_BUDGET_MS: 1,
});

const TAU = Math.PI * 2;

/**
 * (b) ring pulse at time t: 0.8 Hz sine between the §C-SYS4.5 bounds.
 * @param {number} tSec seconds since the glow started
 * @returns {{scale: number, alpha: number}}
 */
export function pulseAt(tSec) {
  const phase = Math.sin(TAU * GLOW.PULSE_HZ * tSec) * 0.5 + 0.5;
  return {
    scale: GLOW.PULSE_SCALE_MIN + (GLOW.PULSE_SCALE_MAX - GLOW.PULSE_SCALE_MIN) * phase,
    alpha: GLOW.PULSE_ALPHA_MIN + (GLOW.PULSE_ALPHA_MAX - GLOW.PULSE_ALPHA_MIN) * phase,
  };
}

/**
 * (a) twirl rotation angle at time t (0.15 rev/s).
 * @param {number} tSec
 * @returns {number} radians
 */
export function twirlAngleAt(tSec) {
  return TAU * GLOW.ROT_REV_PER_SEC * tSec;
}

/** Deterministic 0..1 hash per (sparkle, generation) — no state needed. */
function hash01(i, gen) {
  const x = Math.sin(i * 7.13 + gen * 13.77 + 1.618) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * (c) sparkle i at time t: orbits the tile border on an inscribed ellipse,
 * respawning at a new deterministic angle every 1.2 s (staggered per index
 * so the 6 never blink in unison). Position is normalized 0..1 (the canvas
 * scales it); alpha fades in/out over the generation's life.
 * @param {number} i sparkle index (0..SPARKLE_COUNT-1)
 * @param {number} tSec
 * @returns {{x: number, y: number, sizePx: number, alpha: number, gen: number}}
 */
export function sparkleAt(i, tSec) {
  const cycles = tSec / GLOW.SPARKLE_RESPAWN_SEC + i / GLOW.SPARKLE_COUNT;
  const gen = Math.floor(cycles);
  const life = cycles - gen; // 0..1 within this generation
  const h1 = hash01(i, gen);
  const h2 = hash01(i, gen + 101);
  const dir = h2 > 0.5 ? 1 : -1;
  const angle = h1 * TAU + dir * life * 0.9; // slow orbit along the border
  return {
    x: 0.5 + 0.46 * Math.cos(angle),
    y: 0.5 + 0.46 * Math.sin(angle),
    sizePx: GLOW.SPARKLE_MIN_PX + (GLOW.SPARKLE_MAX_PX - GLOW.SPARKLE_MIN_PX) * h2,
    alpha: Math.sin(Math.PI * life),
    gen,
  };
}

// ---------------------------------------------------------------------------
// Canvas component (browser-only from here down — nothing below runs at
// module scope, so node:test can still import the pure math above).
// ---------------------------------------------------------------------------

/** @type {Map<string, Promise<HTMLImageElement|null>>} raw texture cache */
const imageCache = new Map();
/** @type {Map<string, HTMLCanvasElement|null>} tinted sprite cache (`name|color`) */
const tintCache = new Map();

/** Load one VFX texture (memoized; resolves null on error — draws skip it). */
function loadImage(name) {
  if (!imageCache.has(name)) {
    imageCache.set(name, new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `${GLOW.TEXTURE_DIR}${name}`;
    }));
  }
  return imageCache.get(name);
}

/**
 * Tint a white-on-black VFX texture: luminance → alpha, RGB → tint color.
 * (The Brackeys pack is OPAQUE — additive drawing of the raw file would
 * paint black boxes on a transparent overlay canvas.)
 * @param {HTMLImageElement} img
 * @param {string} color CSS color
 * @returns {HTMLCanvasElement|null}
 */
function tintSprite(img, color) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const px = data.data;
  for (let p = 0; p < px.length; p += 4) {
    px[p + 3] = Math.max(px[p], px[p + 1], px[p + 2]); // luminance → alpha
    px[p] = 255;
    px[p + 1] = 255;
    px[p + 2] = 255;
  }
  g.putImageData(data, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Memoized tinted sprite (null until the texture resolves / on failure). */
function tinted(name, color) {
  const key = `${name}|${color}`;
  if (!tintCache.has(key)) {
    tintCache.set(key, null);
    loadImage(name).then((img) => {
      if (img) tintCache.set(key, tintSprite(img, color));
    });
  }
  return tintCache.get(key);
}

/**
 * Create the shared glow driver for one screen (§C-SYS4.5: „one shared rAF
 * for the arcade screen"). Attach a glow per modified tile; the single loop
 * draws them all and self-suspends while hidden/paused/empty.
 * @returns {{attach: (host: HTMLElement, opts?: {color?: string}) => {remove: () => void},
 *   setPaused: (p: boolean) => void, dispose: () => void,
 *   getStats: () => {frames: number, lastFrameMs: number, avgFrameMs: number}}}
 */
export function createGlowManager() {
  /** @type {Set<{host: HTMLElement, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, color: string}>} */
  const entries = new Set();
  let raf = 0;
  let running = false;
  let paused = false;
  let disposed = false;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const stats = { frames: 0, lastFrameMs: 0, totalMs: 0 };

  function drawEntry(e, tSec) {
    const { canvas, ctx, host, color } = e;
    // Track live tile size (rem-scale/viewport changes) — cheap compare.
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(host.clientWidth * dpr));
    const h = Math.max(1, Math.round(host.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const cx = w / 2;
    const cy = h / 2;
    // (a) rotating twirl — sized to cover the tile diagonally.
    const twirl = tinted(GLOW.TWIRL, color);
    if (twirl) {
      const s = Math.hypot(w, h) * 0.72;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(twirlAngleAt(tSec));
      ctx.globalAlpha = GLOW.TWIRL_ALPHA;
      ctx.drawImage(twirl, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    // (b) pulsing soft ring.
    const ring = tinted(GLOW.RING, color);
    if (ring) {
      const { scale, alpha } = pulseAt(tSec);
      const s = Math.min(w, h) * 1.02 * scale;
      ctx.globalAlpha = alpha;
      ctx.drawImage(ring, cx - s / 2, cy - s / 2, s, s);
    }
    // (c) border sparkles.
    const star = tinted(GLOW.SPARKLE, color);
    if (star) {
      for (let i = 0; i < GLOW.SPARKLE_COUNT; i += 1) {
        const sp = sparkleAt(i, tSec);
        const s = sp.sizePx * dpr;
        ctx.globalAlpha = sp.alpha;
        ctx.drawImage(star, sp.x * w - s / 2, sp.y * h - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  function frame(nowMs) {
    raf = 0;
    if (disposed || paused || entries.size === 0 || document.hidden) {
      running = false;
      return;
    }
    const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tSec = (nowMs - t0) / 1000;
    for (const e of entries) drawEntry(e, tSec);
    stats.lastFrameMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    stats.frames += 1;
    stats.totalMs += stats.lastFrameMs;
    raf = requestAnimationFrame(frame);
  }

  function ensureLoop() {
    if (disposed || running || paused || entries.size === 0 || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  const onVisibility = () => ensureLoop();
  document.addEventListener('visibilitychange', onVisibility);

  return {
    /**
     * Overlay a glow canvas on a tile/cover element (host must be
     * position:relative — the canvas fills it, pointer-events: none).
     * @param {HTMLElement} host
     * @param {{color?: string}} [opts] §C-SYS4.5 per-type tint
     */
    attach(host, opts = {}) {
      const canvas = document.createElement('canvas');
      canvas.className = 'g68-glow-canvas';
      const ctx = canvas.getContext('2d');
      const entry = { host, canvas, ctx, color: opts.color || GLOW.DEFAULT_TINT };
      host.appendChild(canvas);
      entries.add(entry);
      ensureLoop();
      return {
        remove() {
          entries.delete(entry);
          canvas.remove();
        },
      };
    },
    /** Pause/resume the shared loop (screen hidden behind another screen). */
    setPaused(p) {
      paused = !!p;
      ensureLoop();
    },
    /** Tear everything down (screen unmount). */
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      running = false;
      document.removeEventListener('visibilitychange', onVisibility);
      for (const e of entries) e.canvas.remove();
      entries.clear();
    },
    /** ≤ 1 ms/frame budget probe (§C-SYS4.5 — dev overlay/CDP reads this). */
    getStats() {
      return {
        frames: stats.frames,
        lastFrameMs: stats.lastFrameMs,
        avgFrameMs: stats.frames > 0 ? stats.totalMs / stats.frames : 0,
      };
    },
  };
}
