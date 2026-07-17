// Minigame framework (§E8). Owns the full launch flow: energy check → scene
// switch → asset preload → 3-2-1 countdown; pause/resume (incl. auto-pause on
// hidden); the results screen (score, best, coins, daily ×2 badge); reward
// payout; stat effects (−energy, +fun); XP; and returning to the home /
// shop-trip flow. Games never touch the store directly — they only get the
// §E8 ctx: { scene, camera, renderer, input, audio, assets, rng, hud, params,
// onScore(points), onEnd({score}) }.

import * as THREE from 'three';
import { MINIGAME, ROOMS } from '../data/constants.js';
import { getMinigame } from '../data/minigames.js';
import { t } from '../data/strings.js';
import { clampStat, isExhausted } from '../systems/stats.js';
import { isMinigameUnlocked } from '../systems/leveling.js';
import { awardMinigame } from '../systems/economy.js';
import { hasGame, loadGame } from './registry.js';
import { icon } from '../ui/icons.js';
import { burstConfettiDom, flyCoinsDom } from '../gfx/particles.js'; // G14: results polish

/**
 * Deterministic RNG (mulberry32) handed to games as ctx.rng (§E8).
 * @param {number} seed
 * @returns {() => number} 0..1
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t2 = Math.imul(a ^ (a >>> 15), 1 | a);
    t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) | 0;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Clamp a float-text spawn position into the camera's visible safe area
 * (F4 P2-3): score popups spawned near screen edges otherwise clip offscreen.
 * Projects to NDC, insets by the sprite's half extents (converted to NDC at
 * the spawn depth), clamps, and unprojects at the same depth. Mutates and
 * returns `pos` so call sites can stay one-liners.
 * @param {import('three').Vector3} pos world-space spawn position
 * @param {import('three').Camera} camera the game's ctx.camera
 * @param {{halfW?: number, halfH?: number, pad?: number}} [opts] sprite half
 *   extents in world units (match the sprite scale) + extra NDC padding
 * @returns {import('three').Vector3} pos
 */
export function clampFloatTextToView(pos, camera, { halfW = 0.8, halfH = 0.3, pad = 0.02 } = {}) {
  if (!camera) return pos;
  camera.updateMatrixWorld();
  const p = pos.clone().project(camera);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return pos;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const ndcHalfW = Math.abs(pos.clone().addScaledVector(right, halfW).project(camera).x - p.x);
  const ndcHalfH = Math.abs(pos.clone().addScaledVector(up, halfH).project(camera).y - p.y);
  const limX = Math.max(0, 1 - ndcHalfW - pad);
  const limY = Math.max(0, 1 - ndcHalfH - pad);
  const cx = Math.max(-limX, Math.min(limX, p.x));
  const cy = Math.max(-limY, Math.min(limY, p.y));
  if (cx === p.x && cy === p.y) return pos;
  return pos.copy(new THREE.Vector3(cx, cy, p.z).unproject(camera));
}

/**
 * Create the framework: registers the 'minigame' scene and the results screen.
 * @param {{sceneManager: object, store: object, ui: object, audio: object}} deps
 * @returns {{launch: (id: string, params?: object) => Promise<boolean>,
 *   isActive: () => boolean}}
 */
export function createMinigameFramework({ sceneManager, store, ui, audio }) {
  /** Result of the last finished round, consumed by the results screen. */
  let lastResult = null;
  // F4 for F2: read-only "a minigame is on screen" flag — true from the
  // minigame scene's enter (countdown) through the results screen until the
  // scene exits. (sceneManager.currentId() === 'minigame' is the equivalent
  // check when a sceneManager handle is available.)
  let minigameActive = false;

  // ---------------------------------------------------------------- results screen
  ui.registerScreen('mgResults', {
    /** @param {HTMLElement} el */
    mount(el) {
      const r = lastResult;
      if (!r) return;
      const card = document.createElement('div');
      card.className = 'card';
      card.style.textAlign = 'center';
      const bestBadge = r.newBest ? `<span class="mg-badge mg-badge-pink">${t('mg.results.newBest')}</span>` : '';
      const dailyBadge = r.firstToday ? `<span class="mg-badge">${t('mg.results.daily2x')}</span>` : '';
      // F4 P2-6: a shop trip is not an arcade round — its "score" IS the coin
      // payout (§C4.3 pickups + bonuses), so Score/Best rows would repeat the
      // coins with arcade wording. Trip results show the earned coins only
      // (existing strings; the trip flavor line reuses 'trip.earned').
      const isTrip = r.launchParams?.mode === 'shopTrip';
      const rows = isTrip
        ? `<div class="mg-results-row"><span>${t('mg.results.coins')}</span><span class="mg-value">${icon('coin', 20)} +${r.coins}${dailyBadge}</span></div>`
        : `<div class="mg-results-row"><span>${t('mg.results.score')}</span><span class="mg-value">${r.score}${bestBadge}</span></div>
          <div class="mg-results-row"><span>${t('mg.results.best')}</span><span class="mg-value">${r.best}</span></div>
          <div class="mg-results-row"><span>${t('mg.results.coins')}</span><span class="mg-value">${icon('coin', 20)} +${r.coins}${dailyBadge}</span></div>`;
      card.innerHTML = `
        <h1 class="mg-overlay-title">${t('mg.results.title')}</h1>
        <div style="font-weight:700;opacity:0.6">${t(r.titleKey)}</div>
        <div class="mg-results-rows">
          ${rows}
        </div>
        <div class="mg-btn-row"></div>`;
      const btnRow = card.querySelector('.mg-btn-row');
      const againBtn = document.createElement('button');
      againBtn.className = 'btn btn-teal';
      againBtn.innerHTML = `${icon('replay', 20)} ${t('mg.results.playAgain')}`;
      againBtn.addEventListener('click', async () => {
        ui.closeAll();
        await launch(r.gameId, r.launchParams);
      });
      const homeBtn = document.createElement('button');
      homeBtn.className = 'btn';
      // F4 P2-6: after a trip arrival the exit continues INTO the shop
      // (systems/shopTrip.js onExit) — label it that way (existing string).
      homeBtn.innerHTML = isTrip
        ? `${icon('cart', 20)} ${t('trip.shopTitle')}`
        : `${icon('home', 20)} ${t('mg.results.home')}`;
      homeBtn.addEventListener('click', () => {
        ui.closeAll();
        exitToHome(r.launchParams);
      });
      btnRow.append(againBtn, homeBtn);
      el.appendChild(card);
      burstConfettiDom(el); // G14: results confetti (§G14 polish)
      // G14: coins fly from the results row to the HUD counter corner
      flyCoinsDom({ fromEl: card.querySelector('.mg-results-row:last-child .mg-value'), count: Math.min(10, Math.max(3, Math.round(r.coins / 3))), onArrive: () => audio.play('coin.fly') });
    },
    unmount() {},
  });

  /** Shop-trip arrival hands off to G7's flow via params.onExit; default: home. */
  function exitToHome(launchParams) {
    if (typeof launchParams?.onExit === 'function') {
      launchParams.onExit();
    } else {
      sceneManager.switchTo('home').catch((err) => console.error('[minigames] exit failed:', err));
    }
  }

  // ---------------------------------------------------------------- minigame scene
  sceneManager.register('minigame', (ctx) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(ROOMS.CAMERA_FOV, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 0, 10);

    /** @type {object|null} */
    let game = null;
    let meta = null;
    let launchParams = null;
    let running = false;
    let paused = false;
    let ended = false;
    let elapsed = 0;
    let score = 0;

    /** @type {HTMLElement|null} */
    let hudEl = null;
    let scoreEl = null;
    let timeEl = null;
    /** @type {HTMLElement|null} */
    let pauseOverlayEl = null;

    function buildHud() {
      hudEl = document.createElement('div');
      hudEl.className = 'mg-hud';
      hudEl.innerHTML = `
        <div class="mg-top">
          <span class="mg-pill"><span class="mg-label">${t('mg.hud.score')}</span><span class="mg-score">0</span></span>
          <span class="mg-pill"><span class="mg-label">${t('mg.hud.time')}</span><span class="mg-time">–</span></span>
        </div>`;
      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'btn btn-ghost btn-round mg-pause-btn';
      pauseBtn.style.cssText = `position:absolute;bottom:calc(16px + var(--safe-bottom));right:calc(16px + var(--safe-right));`;
      pauseBtn.setAttribute('aria-label', t('mg.pause'));
      pauseBtn.innerHTML = icon('pause', 22);
      pauseBtn.addEventListener('click', () => pause());
      hudEl.appendChild(pauseBtn);
      ui.el.appendChild(hudEl);
      scoreEl = hudEl.querySelector('.mg-score');
      timeEl = hudEl.querySelector('.mg-time');
    }

    // F4 P2-2: banners fired in quick succession (combo + steal + reward …)
    // used to stack on the same spot and overlap. At most ONE banner is
    // visible; extra ones queue FIFO (bounded — old news gets dropped) and
    // queued banners display shorter so they never lag far behind the action.
    const BANNER_SEC = 1.2;
    const BANNER_QUEUED_SEC = 0.7;
    const BANNER_QUEUE_MAX = 3;
    /** @type {string[]} */
    const bannerQueue = [];
    /** @type {HTMLElement|null} */
    let bannerEl = null;
    let bannerTimer = 0;

    function showNextBanner(text) {
      bannerEl = document.createElement('div');
      bannerEl.className = 'mg-banner';
      bannerEl.textContent = text;
      hudEl.appendChild(bannerEl);
      const holdSec = bannerQueue.length > 0 ? BANNER_QUEUED_SEC : BANNER_SEC;
      bannerTimer = setTimeout(() => {
        bannerEl?.remove();
        bannerEl = null;
        const next = bannerQueue.shift();
        if (next != null && hudEl) showNextBanner(next);
      }, holdSec * 1000);
    }

    function clearBanners() {
      clearTimeout(bannerTimer);
      bannerEl?.remove();
      bannerEl = null;
      bannerQueue.length = 0;
    }

    /** §E8 hud handed to games. */
    const hud = {
      /** @param {number} n */
      setScore(n) {
        if (scoreEl) scoreEl.textContent = String(n);
      },
      /** @param {number} sec remaining seconds (rendered as ceil) */
      setTime(sec) {
        if (timeEl) timeEl.textContent = String(Math.max(0, Math.ceil(sec)));
      },
      /** @param {string} text pre-translated (games pass t(...) themselves) */
      banner(text) {
        if (!hudEl) return;
        if (bannerEl) {
          if (bannerQueue.length >= BANNER_QUEUE_MAX) bannerQueue.shift();
          bannerQueue.push(text);
          return;
        }
        showNextBanner(text);
      },
    };

    function countdown() {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'mg-countdown';
        ui.el.appendChild(overlay);
        let n = MINIGAME.COUNTDOWN_FROM;
        const show = () => {
          if (n < 0) {
            overlay.remove();
            resolve();
            return;
          }
          overlay.innerHTML = `<div class="mg-count">${n > 0 ? n : t('mg.countdown.go')}</div>`;
          audio.play(n > 0 ? 'ui.count' : 'ui.go');
          n -= 1;
          setTimeout(show, n < 0 ? 600 : 900);
        };
        show();
      });
    }

    function pause() {
      if (!running || paused || ended) return;
      paused = true;
      // F6 (RE5): optional §E8 game hook — games with real-time clocks
      // (danceParty) freeze/rebase them across the paused span.
      try {
        game?.onPause?.();
      } catch (err) {
        console.warn('[minigames] game onPause error:', err);
      }
      audio.play('ui.tap');
      pauseOverlayEl = document.createElement('div');
      pauseOverlayEl.className = 'screen';
      pauseOverlayEl.style.background = 'rgba(74,59,54,0.55)';
      const card = document.createElement('div');
      card.className = 'card';
      card.style.textAlign = 'center';
      card.innerHTML = `<h1 class="mg-overlay-title">${t('mg.paused')}</h1><div class="mg-btn-row"></div>`;
      const row = card.querySelector('.mg-btn-row');
      const resumeBtn = document.createElement('button');
      resumeBtn.className = 'btn btn-teal';
      resumeBtn.innerHTML = `${icon('play', 20)} ${t('mg.resume')}`;
      resumeBtn.addEventListener('click', () => resume());
      const quitBtn = document.createElement('button');
      quitBtn.className = 'btn btn-ghost';
      quitBtn.innerHTML = `${icon('home', 20)} ${t('mg.quit')}`;
      quitBtn.addEventListener('click', () => {
        removePauseOverlay();
        exitToHome(launchParams);
      });
      row.append(resumeBtn, quitBtn);
      pauseOverlayEl.appendChild(card);
      ui.el.appendChild(pauseOverlayEl);
    }

    function removePauseOverlay() {
      pauseOverlayEl?.remove();
      pauseOverlayEl = null;
    }

    function resume() {
      removePauseOverlay();
      paused = false;
      // F6 (RE5): optional §E8 game hook — see pause().
      try {
        game?.onResume?.();
      } catch (err) {
        console.warn('[minigames] game onResume error:', err);
      }
    }

    function onHidden() {
      if (document.visibilityState === 'hidden') pause();
    }

    /** §E8 ctx.onScore — accumulate + reflect in the HUD. */
    function onScore(points) {
      score += points;
      hud.setScore(score);
    }

    /** §E8 ctx.onEnd — rewards, persistence, results screen. */
    function onEnd({ score: finalScore, coins: coinsOverride } = {}) {
      if (ended) return;
      ended = true;
      running = false;
      const s = typeof finalScore === 'number' ? finalScore : score;

      // G11: economy.awardMinigame is the single payout path (§C6 coins incl.
      // daily ×2, +fun, XP + level-up coins, plays/best/lastPlayDay — §C1.5).
      const reward = awardMinigame(store, meta.id, s, { coinsOverride });

      lastResult = {
        gameId: reward.gameId,
        titleKey: meta.titleKey,
        score: reward.score,
        best: reward.best,
        newBest: reward.newBest,
        coins: reward.coins,
        firstToday: reward.firstToday,
        launchParams,
      };
      audio.play('jingle.results');
      ui.showScreen('mgResults');
    }

    let exited = false;

    return {
      scene,
      camera,
      async enter(params) {
        minigameActive = true; // F4 for F2
        meta = getMinigame(params.gameId);
        launchParams = params.params ?? {};
        const mod = await loadGame(params.gameId);
        buildHud();
        try {
          await ctx.assets?.preload?.(mod.assetKeys ?? []);
        } catch (err) {
          console.warn('[minigames] asset preload failed:', err);
        }
        const seed = Number.isFinite(launchParams.seed) ? launchParams.seed : Math.floor(Math.random() * 2 ** 31);
        game = mod;
        game.init({
          scene,
          camera,
          renderer: ctx.renderer,
          input: ctx.input,
          audio,
          assets: ctx.assets,
          rng: createRng(seed),
          hud,
          params: launchParams,
          onScore,
          onEnd,
        });
        document.addEventListener('visibilitychange', onHidden);
        // The countdown runs AFTER enter resolves so the scene fade lifts
        // first and 3-2-1 plays over the visible stage (not behind black).
        (async () => {
          await countdown();
          if (exited) return;
          // Energy cost is charged when the round actually starts (§C6).
          store.update((state) => {
            state.stats.energy = clampStat(state.stats.energy - meta.energyCost);
          });
          running = true;
        })();
      },
      update(dt) {
        if (!running || paused || ended || !game) return;
        elapsed += dt;
        try {
          game.update?.(dt, elapsed);
        } catch (err) {
          console.error('[minigames] game update error:', err);
        }
      },
      exit() {
        exited = true;
        minigameActive = false; // F4 for F2
        document.removeEventListener('visibilitychange', onHidden);
        removePauseOverlay();
        clearBanners();
        hudEl?.remove();
        hudEl = null;
      },
      dispose() {
        try {
          game?.dispose?.();
        } catch (err) {
          console.error('[minigames] game dispose error:', err);
        }
        game = null;
        scene.traverse((obj) => {
          obj.geometry?.dispose?.();
          if (obj.material) {
            for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose?.();
          }
        });
      },
    };
  });

  // ---------------------------------------------------------------- launch
  /** F6 (RE5): retry cadence/budget while an in-flight scene switch settles. */
  const LAUNCH_RETRY_MS = 100;
  const LAUNCH_RETRY_MAX_MS = 5000;

  /**
   * Launch a minigame by id (§E8): checks metadata, implementation, unlock
   * level (skipped for params.dev — harness/testing), sleep and exhaustion
   * (§C1) before switching scenes.
   *
   * F6 (RE5): sceneManager.switchTo is a SILENT no-op while another switch is
   * in flight (fade guard) — launch keeps retrying until the switch settles
   * and only resolves true once the minigame scene really is current (results
   * "Home" → immediate relaunch, arcade taps during fades, …). Resolves false
   * if it never lands within the retry budget.
   * @param {string} id
   * @param {object} [params] forwarded to the game as ctx.params;
   *   params.dev bypasses the level lock; params.onExit overrides the
   *   return-to-home flow (shop trip — G7); params.seed pins ctx.rng.
   * @returns {Promise<boolean>} whether the game was launched
   */
  async function launch(id, params = {}) {
    const meta = getMinigame(id);
    if (!meta || !hasGame(id)) {
      ui.toast('toast.minigameMissing');
      return false;
    }
    const level = store.get('level');
    if (!params.dev && !meta.dev && !isMinigameUnlocked(id, level)) {
      ui.toast('mg.locked', { level: meta.minLevel });
      return false;
    }
    if (store.get('sleep.sleeping')) {
      ui.toast('toast.sleeping');
      return false;
    }
    if (isExhausted(store.get('stats'))) {
      ui.toast('toast.tooSleepy');
      return false;
    }
    ui.closeAll();
    const deadline = Date.now() + LAUNCH_RETRY_MAX_MS;
    const settled = () =>
      sceneManager.currentId?.() === 'minigame' && sceneManager.isSwitching?.() !== true;
    await sceneManager.switchTo('minigame', { gameId: id, params });
    while (!settled() && Date.now() < deadline) {
      // A switch was in progress and ours was swallowed (or the OLD scene is
      // still current during its fade-out) — wait for it to settle, re-check,
      // then re-issue. isSwitching() guards the fade-out phase where
      // currentId() still reports the pre-switch scene.
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_RETRY_MS));
      if (settled()) break;
      if (sceneManager.isSwitching?.() === true) continue; // still fading
      await sceneManager.switchTo('minigame', { gameId: id, params });
    }
    return settled();
  }

  return {
    launch,
    // F4 for F2: read-only accessor so outside systems (permission soft-ask
    // deferral in ui/permissionPrompt.js) can detect an in-progress minigame
    // without a sceneManager handle.
    isActive: () => minigameActive,
  };
}
