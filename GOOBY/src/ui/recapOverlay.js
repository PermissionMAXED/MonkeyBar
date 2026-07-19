// V4/G64 — Level-up recap cinematic player (PLAN4 §E block G64 + §C-SYS2) —
// the DOM/audio DRIVER half. All timing/selection math lives in
// recapOverlay.logic.js (node-tested); this module owns:
//   · the fullscreen takeover overlay (400 ms white-fade entry, HUD hidden,
//     input limited to the skip affordance — §C-SYS2.1),
//   · the recap track on a DEDICATED MediaElement (radio ducked via
//     radioPlayer.duck(true,'recap'), medley via musicDirector.setSuppressed
//     — the §C-SYS1 suppressor contract; element volume replicates the §B2.2
//     bus math and live-follows the sliders + the airtight music mute),
//   · cue consumption of G55's recapDirector.buildTimeline() output: intro
//     title card → 8 even-bar vignette cuts → beat-synced stat-text pops
//     (pop 0.8→1.05→1.0 over 2 beats + counter roll-up, EN+DE) → end card
//     („Level X!" ring + coin recap + next unlock + confetti + Weiter),
//   · the §C-SYS2.2 skip affordance (subtle, from t = 10 s, 300 ms cut),
//   · G63's 3D vignettes (src/recap/vignettes.js, feature-detected via glob;
//     scene id 'recap' registers when present) with a colored-backdrop DOM
//     fallback so this module ships independently,
//   · the §B5.2 atomic completion write (completeRecap in ONE store.update —
//     the ONLY path that clears recap.pendingLevel),
//   · trigger wiring: pendingLevel → plays on the NEXT home enter (poll +
//     'recapChanged'; never mid-gameplay — canAutoStart guard),
//   · dev-panel card 15 playback (previewRecap/replayRecap — G58's probe
//     shape) and the beat-debug overlay honoring G58's exported toggle
//     (getRecapBeatDebug + 'recapBeatDebugChanged').
//
// Clock rule (§C-SYS2.6): the rAF wall clock re-anchors to el.currentTime on
// every bar crossing (advanceClock — ±80 ms §A2). No-audio contexts (VM/
// muted/autoplay-refused) run the same timeline on the wall clock.

import { RECAP, selectLines, diff, completeRecap } from '../systems/recap.js';
import { buildTimeline } from '../systems/recapDirector.js';
import { getTracks, trackById } from '../systems/musicRegistry.js';
import radioPlayer, { trackUrl } from '../audio/radioPlayer.js';
import musicDirector from '../audio/musicDirector.js';
import { nextUnlock } from '../systems/leveling.js';
import { burstConfettiDom } from '../gfx/particles.js';
import { t, getLang } from '../data/strings.js';
import { now } from '../core/clock.js';
import {
  OVERLAY, biomeBackdrop, recapSeed, chooseRecapTrack, elementVolume,
  advanceClock, barIndexAt, beatIndexAt, createCueScheduler, cutSpans, spanAt,
  nextSpanAt, popDurations, skipAllowed, displayMilestone, rewardCoins,
  replayRewardFrom, canAutoStart, createOffsetRecorder,
} from './recapOverlay.logic.js';

const DEV = !!import.meta.env?.DEV;

// G63's Team-RECAP modules land in the same wave (§E0.1-11): transform-time
// globs keep this module bootable while they're absent — the cinematic then
// uses the DOM colored-backdrop fallback.
const vignetteModules = import.meta.glob('../recap/vignettes.js');
const recapAssetModules = import.meta.glob('../recap/recapAssets.js');

/** @type {{store: object, ui: object, audio: object, sceneManager: object, assets: object}|null} */
let deps = null;
/** @type {object|null} G63's vignettes module once probed (null = fallback). */
let vignettesMod = null;
/** @type {object|null} the active playback session (one at a time). */
let sess = null;
/** Last completed session's offset summary (CDP/eval evidence surface). */
let lastSummary = null;

// ---------------------------------------------------------------------------
// G63 vignette scene ('recap' — §E1; sceneManager renders, session drives)
// ---------------------------------------------------------------------------

/**
 * §E1 factory for the shared recap scene: ONE vignette live at a time (G63
 * contract), the NEXT one PRE-ROLLED hidden PRE_ROLL_SEC before its cut —
 * build + shader compile land off-beat, the on-beat swap is a visibility
 * flip (§C-SYS2.6 „camera pre-rolls so the cut lands exactly on the
 * downbeat"). The dolly runs off the session's master beat clock.
 * @param {{assets: object, renderer?: object}} ctx
 */
function createRecapVignetteScene(ctx) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#fff6ec');
  const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 120);
  camera.position.set(0, 1.5, 8);
  /** @type {{group: object, dispose: Function, update: Function}|null} live */
  let handle = null;
  let liveIdx = -1;
  /** @type {{handle: object, idx: number, bg: object}|null} pre-rolled next */
  let staged = null;
  /** tiny offscreen target for the pre-roll warm render (never shown) */
  let warmRT = null;
  // §A2 low-end guard: software rasterizers (SwiftShader VMs) spend 100–250 ms
  // PER FRAME at native res — those main-thread stalls are what pushes cues
  // past the ±80 ms budget. Cost ≈ pixels, so slow frames (sustained EMA > 75
  // ms, or one > 150 ms spike) step the render buffer down. Real GPUs (~16 ms
  // frames) never trip this; the ratio is restored in dispose().
  const basePR = ctx.renderer?.getPixelRatio?.() ?? 1;
  const PR_STEPS = [1, 0.6, 0.45, 0.3];
  let prStep = 0;
  let emaDt = 0;
  return {
    scene,
    camera,
    async enter() {
      await vignettesMod?.preloadBackdrops?.().catch?.(() => {});
    },
    update(dt) {
      const s = sess;
      if (!s || !vignettesMod) return;
      // Fire due cues BEFORE this frame's (expensive) render — the overlay's
      // own rAF callback runs after sceneManager's render and would tax every
      // cue with the frame's raster time.
      s.step?.(performance.now());
      emaDt = emaDt === 0 ? dt : emaDt * 0.85 + dt * 0.15;
      if ((emaDt > 0.075 || dt > 0.15) && prStep < PR_STEPS.length - 1) {
        prStep += 1;
        emaDt = 0;
        try {
          ctx.renderer.setPixelRatio(basePR * PR_STEPS[prStep]);
        } catch { /* renderer without setPixelRatio — keep native */ }
        if (DEV) console.log(`[recap] slow frames — render scale ×${PR_STEPS[prStep]}`);
      }
      s.renderScale = PR_STEPS[prStep];
      const span = s.liveSpan;
      const next = s.nextSpan;
      // Pre-roll phase 1: build the upcoming vignette hidden. Phase 2 (the
      // NEXT frame): one warm render into a tiny offscreen target — forces
      // SwiftShader program compiles AND texture uploads early (renderer
      // .compile alone skips uploads). Split across two frames so the two
      // stalls never stack; both land right after the preceding text pop
      // (PRE_ROLL_SEC), so the on-beat swap is just a visibility flip.
      if (next && next.vignette !== liveIdx && staged?.idx !== next.vignette) {
        if (staged) staged.handle.dispose();
        staged = null;
        const savedBg = scene.background;
        try {
          const h = vignettesMod.buildVignette(next.id, scene, ctx.assets, { camera });
          const stagedBg = scene.background; // the builder set the biome bg
          scene.background = savedBg; // restore until the cut lands
          h.update(0, 0); // pose the dolly at progress 0
          if (h.group) h.group.visible = false;
          staged = { handle: h, idx: next.vignette, bg: stagedBg, warmed: false };
        } catch (err) {
          console.warn(`[recap] pre-roll of '${next.id}' failed:`, err);
          scene.background = savedBg;
        }
      } else if (staged && !staged.warmed) {
        staged.warmed = true;
        const savedBg = scene.background;
        if (staged.handle.group) staged.handle.group.visible = true;
        scene.background = staged.bg;
        try {
          warmRT = warmRT ?? new THREE.WebGLRenderTarget(16, 16);
          ctx.renderer.setRenderTarget(warmRT);
          ctx.renderer.render(scene, camera);
        } catch { /* warm render is best-effort */ } finally {
          try { ctx.renderer.setRenderTarget(null); } catch { /* noop */ }
        }
        if (staged.handle.group) staged.handle.group.visible = false;
        scene.background = savedBg;
      }
      // The cut: swap ON the beat (cheap when the pre-roll landed). The old
      // vignette only HIDES here — its dispose (dozens of geometry/material
      // frees, easily a 50–150 ms software-GL stall) is deferred off-beat.
      if (span && span.id && span.vignette !== liveIdx) {
        if (handle) {
          const old = handle;
          if (old.group) old.group.visible = false;
          setTimeout(() => { try { old.dispose(); } catch { /* noop */ } }, 400);
        }
        handle = null;
        if (staged?.idx === span.vignette) {
          handle = staged.handle;
          if (handle.group) handle.group.visible = true;
          scene.background = staged.bg;
          staged = null;
        } else {
          try {
            handle = vignettesMod.buildVignette(span.id, scene, ctx.assets, { camera });
          } catch (err) {
            console.warn(`[recap] vignette '${span.id}' failed to build:`, err);
          }
        }
        liveIdx = span.vignette;
      }
      // After the end cue span is null — the last vignette idles at p = 1.
      handle?.update(dt, span ? span.progress : 1);
    },
    dispose() {
      staged?.handle.dispose();
      staged = null;
      handle?.dispose();
      handle = null;
      liveIdx = -1;
      warmRT?.dispose();
      warmRT = null;
      try {
        ctx.renderer?.setPixelRatio?.(basePR);
      } catch { /* noop */ }
    },
  };
}

// THREE is only touched when G63's module resolved (it imports three itself,
// so the chunk is already paid for) — lazy holder keeps the import graph slim.
let THREE = null;

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** @param {string} cls @param {HTMLElement} [parent] @returns {HTMLDivElement} */
function div(cls, parent) {
  const el = document.createElement('div');
  el.className = cls;
  parent?.appendChild(el);
  return el;
}

/**
 * Localized stat-line text through strings/v4-recap.js (`recap.line.<id>`,
 * `.one` singular) with the director's baked textDe/textEn as fallback.
 * @param {{lineId: string, textDe: string, textEn: string}} cue
 * @param {number} n the (possibly mid-roll-up) display value
 * @returns {string}
 */
function lineText(cue, n) {
  const key = `recap.line.${cue.lineId}`;
  if (n === 1) {
    const one = t(`${key}.one`);
    if (one !== `${key}.one`) return one;
  }
  const s = t(key, { n });
  if (s !== key) return s;
  return getLang() === 'de' ? cue.textDe : cue.textEn;
}

/** Fade a fullscreen white layer to `target` opacity over `ms`. */
function fadeWhite(el, target, ms) {
  return new Promise((resolve) => {
    el.style.transition = `opacity ${ms}ms ease`;
    // Force a style flush so the transition always runs from the current value.
    void el.offsetWidth;
    el.style.opacity = String(target);
    setTimeout(resolve, ms + 30);
  });
}

// ---------------------------------------------------------------------------
// Playback session
// ---------------------------------------------------------------------------

/**
 * Build + run one cinematic. Exactly one session at a time.
 * @param {object} opts
 * @param {number} opts.level milestone headline („Level {X}!")
 * @param {Array<{id: string, value: number}>} opts.lines stat lines to show
 * @param {number} opts.fromLevel reward base (coins recap = Σ 25×l above it)
 * @param {number} opts.atMs seed input (baselineAt / history row `at`)
 * @param {boolean} [opts.commit] write §B5.2 completeRecap on finish/skip
 * @param {boolean} [opts.noScene] force the DOM backdrop fallback (CDP knob)
 * @returns {Promise<boolean>} started?
 */
async function startCinematic({ level, lines, fromLevel, atMs, commit = false, noScene = false }) {
  if (!deps || sess) return false;
  const { store, ui, sceneManager } = deps;

  const seed = recapSeed(level, atMs);
  const pick = chooseRecapTrack(getTracks(), seed, store.get('radio')?.trims);
  const track = pick.id ? trackById(pick.id) : null;

  const s = {
    level,
    lines,
    fromLevel,
    commit,
    trackId: track?.id ?? null,
    trackFallback: pick.fallback,
    timeline: null,
    scheduler: null,
    spans: [],
    liveSpan: null,
    clock: { t: 0, anchorBar: -1 },
    lastFrame: 0,
    raf: 0,
    el: null,
    audioLive: false,
    sceneMode: false,
    returnScene: null,
    recorder: createOffsetRecorder(),
    offs: [],
    dom: {},
    skipVisible: false,
    ended: false,
    finishing: false,
    beatDebug: false,
    startedAt: now(),
  };
  sess = s;

  // §C-SYS1 suppressor: dedicated playback ducks the radio + mutes the medley
  // for the whole cinematic; both restored in teardown (reasons stack).
  radioPlayer.duck(true, 'recap');
  musicDirector.setSuppressed(true);
  document.body.classList.add('g64-recap');

  // Overlay skeleton (above the sceneManager fade so the takeover stays WHITE).
  // 'g64-boot' keeps the stage invisible until the entry fade covers the home
  // scene — the title/backdrops only exist behind/after the white.
  const root = div('g64-root g64-boot');
  const bgA = div('g64-bg', root);
  const bgB = div('g64-bg', root);
  const stage = div('g64-stage', root);
  const intro = div('g64-intro', stage);
  intro.innerHTML = `
    <div class="g64-title">${t('recap.title', { n: level })}</div>
    <div class="g64-subtitle">${t('recap.subtitle')}</div>`;
  const popHost = div('g64-pops', stage);
  const skipEl = div('g64-skip', root);
  skipEl.textContent = t('recap.skip');
  const debugEl = div('g64-debug', root);
  const white = div('g64-white', root);
  white.style.opacity = '0';
  document.body.appendChild(root);
  s.dom = { root, bgA, bgB, stage, intro, popHost, skipEl, debugEl, white };

  // Beat-debug overlay honors G58's exported toggle (dev card 15) — read the
  // current flag AND live-follow the runtime event.
  import('./devPanel.js')
    .then((m) => { s.beatDebug = m.getRecapBeatDebug?.() === true; })
    .catch(() => {});
  s.offs.push(store.on('recapBeatDebugChanged', ({ on }) => { s.beatDebug = on === true; }));

  // §C-SYS2.1 entry: 400 ms white-fade takeover.
  await fadeWhite(white, 1, OVERLAY.WHITE_FADE_MS);
  root.classList.remove('g64-boot');
  ui.closeAll();

  // Timeline: committed beats manifest (the manifest row already points at
  // the override file when one exists — §B5.3 precedence baked by G51).
  let beats = null;
  if (track?.beats) {
    try {
      const res = await fetch(trackUrl(track.beats));
      if (res.ok) beats = await res.json();
    } catch { /* default grid (§B5.3) */ }
  }
  s.timeline = buildTimeline({
    beats,
    durationSec: track?.durationSec ?? 100,
    lines,
    level,
    trackId: s.trackId ?? '',
  });
  s.scheduler = createCueScheduler(s.timeline.cues);
  s.spans = cutSpans(s.timeline);

  // 3D vignettes (G63) when present — else warm the DOM backdrop images.
  s.sceneMode = !noScene && vignettesMod != null && sceneManager.has('recap');
  if (s.sceneMode) {
    try {
      s.returnScene = sceneManager.currentId() ?? 'home';
      await sceneManager.switchTo('recap');
    } catch (err) {
      console.warn('[recap] scene switch failed — DOM fallback:', err);
      s.sceneMode = false;
      s.returnScene = null;
    }
  }
  if (!s.sceneMode) {
    for (const span of s.spans) {
      const bd = biomeBackdrop(span.id);
      if (bd.img) new Image().src = trackUrl(bd.img);
    }
    bgA.style.background = 'linear-gradient(180deg,#ffe9f2,#ffd9e4)';
    bgA.style.opacity = '1';
  }

  // Dedicated MediaElement (§C-SYS2.6): element volume replicates the §B2.2
  // bus math; play() rejection (no gesture/VM) → wall-clock mode, same cues.
  if (track) {
    const el = new Audio(trackUrl(track.file));
    el.preload = 'auto';
    s.el = el;
    const applyVolume = () => {
      const st = store.get();
      const vols = st?.settings?.volumes ?? {};
      el.volume = elementVolume({
        gainTrim: track.gainTrim,
        trimVol: st?.radio?.trims?.[track.id]?.vol ?? 100,
        master: vols.master ?? 80,
        music: vols.music ?? 70,
        musicEnabled: st?.settings?.music !== false,
      });
      // §B2.4 airtight music mute: pause the element (zero streaming), the
      // grid continues on the wall clock; re-enable resumes at el time.
      if (st?.settings?.music === false) {
        if (!el.paused) el.pause();
      } else if (el.paused && !el.ended && s.audioLive && !s.finishing) {
        // never auto-restart a naturally-ENDED track (grid is done by then)
        el.play().catch(() => {});
      }
    };
    applyVolume();
    s.offs.push(store.on('change', applyVolume));
    try {
      await el.play();
      s.audioLive = true;
    } catch {
      s.audioLive = false; // autoplay refused → wall clock (visuals identical)
    }
  }

  // Skip + Weiter input (§C-SYS2.2: overlay eats ALL taps; before t = 10 s
  // they do nothing, after they cut to the end card).
  root.addEventListener('click', (ev) => {
    if (s.ended || s.finishing) return;
    if (!s.skipVisible || !skipAllowed(s.clock.t, s.timeline.skipAfterSec)) return;
    ev.stopPropagation();
    doSkip();
  });

  if (DEV) console.log(`[recap] start L${level} track=${s.trackId} fallbackTrack=${pick.fallback} scene=${s.sceneMode} audio=${s.audioLive} bpm=${s.timeline.bpm} cues=${s.timeline.cues.length}`);

  // Master loop: rAF for smooth visuals PLUS a 25 ms timer tick — rAF alone
  // can gap 100–250 ms (throttled/hitchy frames, SwiftShader shader builds)
  // which would fire cues late; the timer keeps the §A2 ±80 ms budget honest
  // even when frames stall. step() is idempotent per timestamp.
  s.lastFrame = performance.now();
  const step = (nowMs) => {
    if (sess !== s || s.finishing) return;
    const dtSec = Math.min(0.25, Math.max(0, (nowMs - s.lastFrame) / 1000));
    if (dtSec <= 0) return;
    s.lastFrame = nowMs;
    const elT = s.audioLive && s.el && !s.el.paused && Number.isFinite(s.el.currentTime)
      ? s.el.currentTime : null;
    s.clock = advanceClock(s.clock, { dtSec, elT, grid: s.timeline });
    // Re-assert the medley suppressor: any audio.music(id) call resets it
    // (audio.js §C3.4 line) — scene hooks firing mid-cinematic must not
    // resurrect the medley under the recap track.
    if (musicDirector.getStats().suppressed !== true) musicDirector.setSuppressed(true);
    if (!s.ended) {
      for (const cue of s.scheduler.advance(s.clock.t)) fireCue(cue);
      s.liveSpan = spanAt(s.spans, s.clock.t);
      s.nextSpan = nextSpanAt(s.spans, s.clock.t);
      updatePops();
      updateSkip();
    }
    updateDebug();
  };
  const frame = (nowMs) => {
    if (sess !== s || s.finishing) return;
    step(nowMs);
    s.raf = requestAnimationFrame(frame);
  };
  s.raf = requestAnimationFrame(frame);
  s.tick = setInterval(() => step(performance.now()), 25);
  // The recap scene calls this BEFORE each render (§A2: sceneManager's rAF
  // runs before this module's, so without it every cue pays the raster time).
  s.step = step;

  // Reveal (intro cue at t = 0 fired on the first frame above).
  await fadeWhite(white, 0, OVERLAY.WHITE_FADE_MS);
  return true;
}

// ── cue application ──────────────────────────────────────────────────────────

/** @param {object} cue a director cue due at the master clock */
function fireCue(cue) {
  const s = sess;
  if (!s) return;
  s.recorder.record(cue.kind, cue.bar, cue.t, s.clock.t);
  if (cue.kind === 'cut') {
    if (cue.vignette === 0) s.dom.intro.classList.add('g64-gone');
    s.liveSpan = {
      vignette: cue.vignette,
      id: cue.biome?.id ?? '',
      biome: cue.biome,
      progress: 0,
    };
    clearPop();
    if (!s.sceneMode) crossfadeBackdrop(cue.biome?.id ?? '');
  } else if (cue.kind === 'text') {
    spawnPop(cue);
  } else if (cue.kind === 'end') {
    showEndCard();
  }
}

/** DOM-fallback backdrop crossfade (colored gradient + committed AI PNG). */
function crossfadeBackdrop(biomeId) {
  const s = sess;
  if (!s) return;
  const bd = biomeBackdrop(biomeId);
  const [showEl, hideEl] = s.dom.bgFlip
    ? [s.dom.bgA, s.dom.bgB] : [s.dom.bgB, s.dom.bgA];
  s.dom.bgFlip = !s.dom.bgFlip;
  const grad = `linear-gradient(180deg, ${bd.from}, ${bd.to})`;
  showEl.style.background = grad;
  if (bd.img) {
    // Committed ART-GATE-2 PNG over the tint (tint shows while it streams in).
    showEl.style.backgroundImage = `url("${trackUrl(bd.img)}"), ${grad}`;
    showEl.style.backgroundSize = 'cover, cover';
    showEl.style.backgroundPosition = 'center, center';
  }
  showEl.style.opacity = '1';
  hideEl.style.opacity = '0';
}

/** @param {object} cue text cue → beat-synced pop with counter roll-up */
function spawnPop(cue) {
  const s = sess;
  if (!s) return;
  clearPop();
  const { popSec, rollSec } = popDurations(cue, s.timeline);
  const el = div('g64-pop', s.dom.popHost);
  el.style.animationDuration = `${Math.round(popSec * 1000)}ms`;
  el.textContent = lineText(cue, cue.value === 1 ? 1 : 0);
  s.pop = { cue, el, bornT: s.clock.t, popSec, rollSec, done: false };
}

/** Per-frame counter roll-up (§C-SYS2.6: 0→n over rollupBeats AFTER the pop). */
function updatePops() {
  const s = sess;
  const p = s?.pop;
  if (!p || p.done) return;
  const dt = s.clock.t - p.bornT;
  let n;
  if (dt <= p.popSec) n = p.cue.value === 1 ? 1 : 0;
  else if (dt >= p.popSec + p.rollSec) {
    n = p.cue.value;
    p.done = true;
  } else n = Math.round(((dt - p.popSec) / p.rollSec) * p.cue.value);
  p.el.textContent = lineText(p.cue, n);
}

function clearPop() {
  const s = sess;
  if (s?.pop?.el) {
    const old = s.pop.el;
    old.classList.add('g64-pop-out');
    setTimeout(() => old.remove(), 350);
  }
  if (s) s.pop = null;
}

/** §C-SYS2.2: subtle affordance fades in from t = skipAfterSec. */
function updateSkip() {
  const s = sess;
  if (!s || s.skipVisible) return;
  if (skipAllowed(s.clock.t, s.timeline.skipAfterSec)) {
    s.skipVisible = true;
    s.dom.skipEl.classList.add('g64-skip-in');
  }
}

/** §C-SYS2.2 skip: 300 ms cut to the end card (audio jumps with the clock). */
function doSkip() {
  const s = sess;
  if (!s || s.ended || s.finishing) return;
  if (DEV) console.log(`[recap] skip at t=${s.clock.t.toFixed(2)} → end card t=${s.timeline.endCard.t.toFixed(2)}`);
  s.dom.root.classList.add('g64-cut');
  setTimeout(() => s.dom.root.classList.remove('g64-cut'), OVERLAY.SKIP_CUT_MS + 60);
  const endT = s.timeline.endCard.t;
  s.scheduler.skipTo(endT);
  s.clock = { t: endT, anchorBar: barIndexAt(s.timeline, endT) };
  if (s.el && s.audioLive) {
    try {
      s.el.currentTime = endT;
    } catch { /* not seekable yet — wall clock carries on */ }
  }
  clearPop();
  for (const cue of s.scheduler.advance(endT)) fireCue(cue); // fires 'end'
}

/** §C-SYS2.7 end card: headline ring, coin recap, next unlock, confetti. */
function showEndCard() {
  const s = sess;
  if (!s || s.ended) return;
  s.ended = true;
  s.liveSpan = null;
  clearPop();
  s.dom.intro.classList.add('g64-gone');
  s.dom.skipEl.classList.remove('g64-skip-in');

  const coins = rewardCoins(s.level, s.fromLevel);
  const playerLevel = s.commit
    ? Math.max(s.level, Math.floor(Number(deps.store.get('level')) || 1))
    : s.level;
  const next = nextUnlock(playerLevel);
  let nextLine = t('recap.endcard.all');
  if (next) {
    const name = t(next.nameKey);
    nextLine = name !== next.nameKey
      ? t('recap.endcard.next', { name, n: next.level })
      : '';
  }
  const R = 26;
  const C = (2 * Math.PI * R).toFixed(2);
  const card = div('g64-endcard', s.dom.root);
  card.innerHTML = `
    <div class="g64-ring">
      <svg viewBox="0 0 64 64" width="100%" height="100%">
        <circle class="g64-ring-bg" cx="32" cy="32" r="${R}"></circle>
        <circle class="g64-ring-fg" cx="32" cy="32" r="${R}"
          stroke-dasharray="${C}" stroke-dashoffset="${C}"></circle>
      </svg>
      <span class="g64-ring-n">${s.level}</span>
    </div>
    <div class="g64-end-title">${t('recap.title', { n: s.level })}</div>
    ${coins > 0 ? `<div class="g64-end-line">💰 ${t('recap.endcard.rewards', { n: coins })}</div>` : ''}
    ${nextLine ? `<div class="g64-end-line g64-end-next">${nextLine}</div>` : ''}
    <button class="btn btn-pink g64-continue">${t('recap.continue')}</button>`;
  requestAnimationFrame(() => {
    const fg = card.querySelector('.g64-ring-fg');
    if (fg) fg.style.strokeDashoffset = '0';
  });
  card.querySelector('.g64-continue')?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    finishRecap();
  });
  burstConfettiDom(s.dom.root, { count: 56 });
  deps.audio.play('jingle.levelUp');
  if (DEV) console.log(`[recap] end card: L${s.level} coins=${coins} next=${next?.nameKey ?? 'all'} summary=${JSON.stringify(s.recorder.summary())}`);
}

/** G58's beat-debug overlay: bar/beat/clock + per-cue offset readout (§A2). */
function updateDebug() {
  const s = sess;
  if (!s) return;
  const el = s.dom.debugEl;
  if (!s.beatDebug) {
    if (el.style.display !== 'none') el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const bar = barIndexAt(s.timeline, s.clock.t);
  const beat = beatIndexAt(s.timeline, s.clock.t);
  const rows = s.recorder.rows().slice(-3)
    .map((r) => `${r.kind}@${r.bar} ${r.offsetMs >= 0 ? '+' : ''}${r.offsetMs}ms`)
    .join(' · ');
  const sum = s.recorder.summary();
  el.textContent = `t ${s.clock.t.toFixed(2)}/${s.timeline.totalSec.toFixed(0)}s · bar ${bar} · beat ${beat} · bpm ${s.timeline.bpm}`
    + ` | ${rows || '—'} | max ${sum.maxAbsMs}ms mean ${sum.meanAbsMs}ms (${sum.within}/${sum.n} ≤ ${sum.budgetMs}ms)`;
}

// ── completion + teardown ────────────────────────────────────────────────────

/** „Weiter" path: §B5.2 atomic completion (commit mode) + 500 ms fade home. */
async function finishRecap() {
  const s = sess;
  if (!s || s.finishing) return;
  s.finishing = true;
  const { store, audio, sceneManager } = deps;
  audio.play('ui.confirmBig');
  lastSummary = {
    level: s.level,
    trackId: s.trackId,
    audioLive: s.audioLive,
    sceneMode: s.sceneMode,
    ...s.recorder.summary(),
  };

  if (s.commit) {
    // §B5.2: ONE store.update — history row + lastRecapLevel advance +
    // baseline re-snapshot + pendingLevel cleared, with the PLAYED lines.
    let payload = null;
    store.update((state) => {
      const res = completeRecap(state, now(), s.lines);
      state.recap = res.recap;
      payload = { pendingLevel: 0, lastRecapLevel: res.recap.lastRecapLevel };
    });
    if (payload) store.emit('recapChanged', payload);
    store.flush();
  }

  // §C-SYS2.1 exit: end card → 500 ms fade home (white — covers the scene
  // switch), audio fades like the radio's §B2.3 transitions.
  cancelAnimationFrame(s.raf);
  if (s.tick != null) clearInterval(s.tick);
  if (s.el) {
    const el = s.el;
    const v0 = el.volume;
    const steps = 6;
    for (let i = 1; i <= steps; i += 1) {
      setTimeout(() => { el.volume = Math.max(0, v0 * (1 - i / steps)); },
        (OVERLAY.AUDIO_FADE_MS / steps) * i);
    }
    setTimeout(() => {
      el.pause();
      el.removeAttribute('src');
      el.load?.();
    }, OVERLAY.AUDIO_FADE_MS + 50);
  }
  await fadeWhite(s.dom.white, 1, OVERLAY.EXIT_FADE_MS);
  if (s.sceneMode && s.returnScene) {
    try {
      await sceneManager.switchTo(s.returnScene);
    } catch (err) {
      console.warn('[recap] return scene switch failed:', err);
    }
  }
  for (const off of s.offs) off?.();
  radioPlayer.duck(false, 'recap');
  musicDirector.setSuppressed(false);
  document.body.classList.remove('g64-recap');
  await fadeWhite(s.dom.white, 0, OVERLAY.WHITE_FADE_MS);
  s.dom.root.remove();
  if (sess === s) sess = null;
}

// ---------------------------------------------------------------------------
// Public API (§E block G64 + G58's dev-card-15 probe shape)
// ---------------------------------------------------------------------------

/**
 * Dev card 15 „Preview": plays the cinematic at `level` from the CURRENT
 * diff — §C-SYS6 rule: NO state writes (pendingLevel/history untouched).
 * @param {{level: number}} opts
 */
export function previewRecap(opts = {}) {
  if (!deps) throw new Error('[recap] not initialized');
  const store = deps.store;
  const state = store.get();
  const level = Math.max(RECAP.FIRST_MILESTONE,
    Math.min(RECAP.LAST_MILESTONE, Math.floor(Number(opts.level) || RECAP.FIRST_MILESTONE)));
  const recap = state.recap ?? {};
  const lines = selectLines(diff(recap.baseline ?? {}, state, now()));
  startCinematic({
    level,
    lines,
    fromLevel: replayRewardFrom(recap.history, { level, at: 0 }),
    atMs: Number(recap.baselineAt) || now(),
    commit: false,
    noScene: opts.noScene === true,
  }).catch((err) => console.error('[recap] preview failed:', err));
}

/**
 * §C-SYS2.8 replay (profile row + dev card 15): plays from the STORED stats
 * — no re-snapshot, reward text reproduced from the history context.
 * @param {{level: number, at?: number, stats?: Array<{id: string, value: number}>}} opts
 */
export function replayRecap(opts = {}) {
  if (!deps) throw new Error('[recap] not initialized');
  const history = deps.store.get('recap')?.history ?? [];
  const level = Math.max(RECAP.FIRST_MILESTONE, Math.floor(Number(opts.level) || 0));
  const row = {
    level,
    at: Number(opts.at) || 0,
    stats: Array.isArray(opts.stats) ? opts.stats : [],
  };
  startCinematic({
    level,
    lines: row.stats,
    fromLevel: replayRewardFrom(history, row),
    atMs: row.at || level, // deterministic per row → same §C-SYS2.6 pick
    commit: false,
    noScene: opts.noScene === true,
  }).catch((err) => console.error('[recap] replay failed:', err));
}

/** Generic entry (G58 probes previewRecap ?? preview ?? play). */
export function play(opts = {}) {
  if (opts.replay || Array.isArray(opts.stats)) replayRecap(opts);
  else previewRecap(opts);
}

/** @returns {boolean} a cinematic is on screen right now */
export function isPlaying() {
  return sess != null;
}

/** Eval/CDP evidence surface: live session probe + last run's §A2 summary. */
export function getRecapStats() {
  const s = sess;
  const radio = radioPlayer.getStats();
  const medley = musicDirector.getStats();
  return {
    playing: s != null,
    level: s?.level ?? null,
    trackId: s?.trackId ?? null,
    t: s ? Math.round(s.clock.t * 100) / 100 : null,
    bar: s ? barIndexAt(s.timeline, s.clock.t) : null,
    audioLive: s?.audioLive ?? null,
    elementT: s?.el && Number.isFinite(s.el.currentTime) ? Math.round(s.el.currentTime * 100) / 100 : null,
    elementPaused: s?.el ? s.el.paused : null,
    sceneMode: s?.sceneMode ?? null,
    renderScale: s?.renderScale ?? null,
    ended: s?.ended ?? null,
    vignette: s?.liveSpan?.id ?? null,
    offsets: s ? s.recorder.rows() : [],
    summary: s ? s.recorder.summary() : null,
    lastSummary,
    // §C-SYS1 suppressor evidence: radio ducked + medley suppressed while live.
    radioDucked: radio.ducked,
    radioElementState: radio.elementState,
    radioWantPlaying: radio.wantPlaying,
    medleySuppressed: medley.suppressed,
    medleySources: medley.sourcesLive,
  };
}

/**
 * Boot wiring (ONE main.js marked block): §B5.2 plays-on-next-home-enter
 * hook (poll + 'recapChanged' — never mid-gameplay per canAutoStart), G63
 * scene registration (feature-detected) and the DEV CDP probe.
 * @param {{store: object, ui: object, audio: object, sceneManager: object,
 *   assets: object}} d
 */
export function initRecapOverlay(d) {
  deps = d;

  // G63's vignettes (same-wave §E0.1-11): probe + register scene id 'recap'.
  const loadVg = vignetteModules['../recap/vignettes.js'];
  const loadAm = recapAssetModules['../recap/recapAssets.js'];
  if (loadVg) {
    Promise.all([loadVg(), loadAm ? loadAm() : null, import('three')])
      .then(([vg, am, three]) => {
        if (typeof vg?.buildVignette !== 'function') return;
        vignettesMod = vg;
        THREE = three;
        if (!d.sceneManager.has('recap')) {
          d.sceneManager.register('recap', createRecapVignetteScene,
            [...(am?.RECAP_ASSET_KEYS ?? [])]);
        }
      })
      .catch((err) => console.warn('[recap] G63 vignettes unavailable — DOM backdrop fallback:', err));
  }

  // Trigger: recap.pendingLevel → next quiet home moment (§C-SYS2.1).
  const maybeAutoStart = () => {
    if (!deps || sess) return;
    const recap = deps.store.get('recap');
    if (!recap || typeof recap !== 'object') return;
    const ok = canAutoStart({
      pendingLevel: recap.pendingLevel,
      sceneId: deps.sceneManager.currentId(),
      switching: deps.sceneManager.isSwitching(),
      activeScreenId: deps.ui.activeScreenId(),
      playing: sess != null,
    });
    if (!ok) return;
    const state = deps.store.get();
    const level = displayMilestone(recap.pendingLevel, state.level);
    const lines = selectLines(diff(recap.baseline ?? {}, state, now()));
    startCinematic({
      level,
      lines,
      fromLevel: Math.max(0, Math.floor(Number(recap.lastRecapLevel) || 0)),
      atMs: Number(recap.baselineAt) || now(),
      commit: true,
    }).catch((err) => console.error('[recap] auto-start failed:', err));
  };
  setInterval(maybeAutoStart, OVERLAY.POLL_MS);
  d.store.on('recapChanged', () => setTimeout(maybeAutoStart, 60));

  if (DEV) {
    window.__recap = {
      stats: getRecapStats,
      isPlaying,
      preview: (level, o = {}) => previewRecap({ level, ...o }),
      replay: (row, o = {}) => replayRecap({ ...row, ...o }),
      skip: doSkip,
      finish: finishRecap,
    };
  }
}

export default {
  initRecapOverlay, previewRecap, replayRecap, play, isPlaying, getRecapStats,
};
