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
 * Create the framework: registers the 'minigame' scene and the results screen.
 * @param {{sceneManager: object, store: object, ui: object, audio: object}} deps
 * @returns {{launch: (id: string, params?: object) => Promise<boolean>}}
 */
export function createMinigameFramework({ sceneManager, store, ui, audio }) {
  /** Result of the last finished round, consumed by the results screen. */
  let lastResult = null;

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
      card.innerHTML = `
        <h1 class="mg-overlay-title">${t('mg.results.title')}</h1>
        <div style="font-weight:700;opacity:0.6">${t(r.titleKey)}</div>
        <div class="mg-results-rows">
          <div class="mg-results-row"><span>${t('mg.results.score')}</span><span class="mg-value">${r.score}${bestBadge}</span></div>
          <div class="mg-results-row"><span>${t('mg.results.best')}</span><span class="mg-value">${r.best}</span></div>
          <div class="mg-results-row"><span>${t('mg.results.coins')}</span><span class="mg-value">${icon('coin', 20)} +${r.coins}${dailyBadge}</span></div>
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
      homeBtn.innerHTML = `${icon('home', 20)} ${t('mg.results.home')}`;
      homeBtn.addEventListener('click', () => {
        ui.closeAll();
        exitToHome(r.launchParams);
      });
      btnRow.append(againBtn, homeBtn);
      el.appendChild(card);
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
        const b = document.createElement('div');
        b.className = 'mg-banner';
        b.textContent = text;
        hudEl.appendChild(b);
        setTimeout(() => b.remove(), 1200);
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
        document.removeEventListener('visibilitychange', onHidden);
        removePauseOverlay();
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
  /**
   * Launch a minigame by id (§E8): checks metadata, implementation, unlock
   * level (skipped for params.dev — harness/testing), sleep and exhaustion
   * (§C1) before switching scenes.
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
    await sceneManager.switchTo('minigame', { gameId: id, params });
    return true;
  }

  return { launch };
}
