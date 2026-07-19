// V4/G68 — pre-game screen `mgPregame` (PLAN4-GAMES §G5.6 layout + §G7.3
// visuals): every arcade cover-card tap opens this screen instead of
// launching directly (trips/harness/tutorial keep launching directly —
// framework.launch is untouched). Layout top-to-bottom: large cover
// (min(86vw, 22rem), 4:3, §G7.1 icon fallback), game name, info row
// (coin range 🪙 min–max · energy ⚡ n · best-of-selected-mode), the §G5.2
// difficulty segmented control (4 pills, Endlos lock per §G5.5 via G56's
// framework.getDifficultyState), the per-mode line, the §G8-1 modifier
// banner (accessor-driven: modifiers.getActiveFor — glow chip + name +
// effect + „noch N Spiele" + mm:ss), goobyWelt SPECIAL styling + quality
// toggle (§G6.6), and the full-width „Spielen ▶" button firing
// framework.launch(id, { difficulty }). Locked games show the level
// requirement instead of PLAY; coming-soon games a disabled hint.
//
// Music (§G7.3): the screen keeps the arcade medley via the shared
// acquire/release holder below — the pop is deferred one tick so the
// synchronous arcade↔pregame screen swap never restarts the medley.

import { getMinigame, MINIGAMES } from '../data/minigames.js';
import { t } from '../data/strings.js';
import { icon } from './icons.js';
import { isMinigameUnlocked } from '../systems/leveling.js';
import { hasGame } from '../minigames/registry.js';
import musicDirector from '../audio/musicDirector.js';
import audio from '../audio/audio.js';
import { now } from '../core/clock.js';
import { getActiveFor } from '../systems/modifierEngine.js'; // §G8-1/-2 single source (G54)
import {
  coverUrl,
  fallbackGradient,
  coinRange,
  formatCountdown,
  pillStates,
  modeLine,
  bestOfMode,
  showSpecialRibbon,
} from './arcadeUi.logic.js';

// ---------------------------------------------------------------------------
// §G7.3 shared arcade-music holder: pushContext('arcade') is ref-counted and
// the pop is DEFERRED one macrotask, so unmount(arcade) → mount(mgPregame)
// (both synchronous inside ui.showScreen) hands the context over seamlessly
// instead of pop+push restarting the medley. Balanced per §B2.4.
// ---------------------------------------------------------------------------

let musicHold = 0;

/** Hold the arcade medley context (screen mount). */
export function acquireArcadeMusic() {
  musicHold += 1;
  if (musicHold === 1) musicDirector.pushContext('arcade');
}

/** Release the hold (screen unmount) — pops one tick later when unheld. */
export function releaseArcadeMusic() {
  setTimeout(() => {
    musicHold = Math.max(0, musicHold - 1);
    if (musicHold === 0) musicDirector.popContext('arcade');
  }, 0);
}

// ---------------------------------------------------------------------------
// Cover art element (§G7.1): fallback gradient + big icon UNDER an <img>
// that reveals on load and removes itself on error — never a broken image.
// Shared with the arcade grid (arcadeScreen.js imports this builder).
// ---------------------------------------------------------------------------

/**
 * @param {{id: string, icon: string}} meta data/minigames.js row
 * @param {number} [iconSize] fallback icon px
 * @returns {HTMLElement} .g68-cover-art (position: relative)
 */
export function createCoverArt(meta, iconSize = 40) {
  const el = document.createElement('div');
  el.className = 'g68-cover-art';
  el.style.background = fallbackGradient(meta.id);
  const fallback = document.createElement('span');
  fallback.className = 'g68-cover-fallback';
  fallback.innerHTML = icon(meta.icon, iconSize);
  el.appendChild(fallback);
  const img = document.createElement('img');
  img.className = 'g68-cover-img';
  img.alt = '';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.addEventListener('load', () => img.classList.add('g68-cover-loaded'));
  img.addEventListener('error', () => img.remove()); // §G7.1 fallback rule
  img.src = coverUrl(meta.id);
  el.appendChild(img);
  return el;
}

// ---------------------------------------------------------------------------
// V4/G68 marked mount point — Team WELT (G65/G66, same wave): goobyWelt
// scene select + per-scene highscore chips render here once the module
// lands (feature-detected namespace export; §E0.1-11 graceful absence).
// ---------------------------------------------------------------------------
const weltModules = import.meta.glob('../minigames/games/goobyWelt.js');

/**
 * Register the 'mgPregame' screen (§G5.6). Called once from
 * createArcadeScreen (same deps — store/ui/framework).
 * @param {{store: object, ui: object, framework?: object}} deps
 */
export function registerPregameScreen({ store, ui, framework }) {
  if (ui.hasScreen('mgPregame')) return;

  /** @type {Array<() => void>} unmount cleanup (offs/intervals) */
  let cleanups = [];

  ui.registerScreen('mgPregame', {
    /** @param {HTMLElement} el @param {{gameId?: string}} params */
    mount(el, params = {}) {
      acquireArcadeMusic();
      const gameId = params.gameId;
      const meta = getMinigame(gameId) ?? MINIGAMES[0];
      const state = store.get();
      const level = Math.max(1, Math.floor(Number(state.level) || 1));
      const unlocked = isMinigameUnlocked(meta.id, level);
      const implemented = hasGame(meta.id);
      const isWelt = meta.id === 'goobyWelt';
      const canDiff = typeof framework?.getDifficultyState === 'function';
      const diff = canDiff ? framework.getDifficultyState(meta.id) : null;
      /** Screen-local mode ('endless' is a launch mode — §G5.5 not persisted). */
      let selected = diff?.enabled ? diff.selected : 'normal';
      /** @type {string|null} Team WELT scene pick (mount point below) */
      let weltScene = null;

      // ---- head: back chevron returns to the arcade grid (§G5.6) ----
      const head = document.createElement('div');
      head.className = 'g68-pre-head';
      const backBtn = document.createElement('button');
      backBtn.className = 'btn btn-ghost btn-round';
      backBtn.setAttribute('aria-label', t('ui.back'));
      backBtn.innerHTML = icon('arrowLeft', 22);
      backBtn.addEventListener('click', () => {
        audio.play('ui.close');
        ui.showScreen('arcade');
      });
      head.appendChild(backBtn);
      el.appendChild(head);

      // ---- cover card (§G7.3: width min(86vw, 22rem), 4:3, r 1.25rem) ----
      const cover = document.createElement('div');
      cover.className = 'g68-pre-cover';
      if (isWelt) cover.classList.add('g68-special'); // gold-dashed border (§G7.2)
      cover.appendChild(createCoverArt(meta, 56));
      if (isWelt && showSpecialRibbon(state)) {
        const ribbon = document.createElement('span');
        ribbon.className = 'g48-new-ribbon g68-special-ribbon';
        ribbon.textContent = t('arcade.special.ribbon');
        cover.appendChild(ribbon);
      }
      if (!unlocked) {
        const lock = document.createElement('span');
        lock.className = 'g68-cover-lock';
        lock.innerHTML = `${icon('lock', 26)}<span>${t('arcade.lockLevel', { level: meta.minLevel })}</span>`;
        cover.appendChild(lock);
      }
      el.appendChild(cover);

      // ---- name + info row (§G5.6) ----
      const name = document.createElement('h1');
      name.className = 'g68-pre-name';
      name.textContent = t(meta.titleKey);
      el.appendChild(name);
      if (isWelt) {
        const sub = document.createElement('div');
        sub.className = 'g68-pre-sub';
        sub.textContent = t('pregame.special.sub');
        el.appendChild(sub);
      }

      const range = coinRange(meta.coinTable);
      const info = document.createElement('div');
      info.className = 'g68-pre-info';
      info.innerHTML = `
        <span class="g68-chip" aria-label="${t('pregame.coins')}">${icon('coin', 16)} ${range.min}–${range.max}</span>
        <span class="g68-chip" aria-label="${t('pregame.energy')}">${icon('energy', 16)} ${meta.energyCost}</span>
        <span class="g68-chip g68-chip-best"></span>`;
      el.appendChild(info);
      const bestChip = info.querySelector('.g68-chip-best');
      const renderBest = () => {
        const n = diff ? bestOfMode(diff, selected) : Math.floor(Number(state.minigames?.best?.[meta.id]) || 0);
        bestChip.textContent = t('pregame.best', { n });
      };

      // ---- difficulty segmented control + per-mode line (§G5.2/§G5.5) ----
      let pillsEl = null;
      let lineEl = null;
      const renderDiff = () => {
        if (!diff?.enabled) return;
        pillsEl.innerHTML = '';
        for (const p of pillStates(diff, selected)) {
          const pill = document.createElement('button');
          pill.className = 'g68-pill';
          if (p.selected) pill.classList.add('g68-pill-on');
          if (p.locked) pill.classList.add('g68-pill-locked');
          pill.dataset.mode = p.mode;
          // locked pill drops the ∞ suffix so 🔒+label fits 320 px @130 % scale
          const label = p.locked ? t(`mg.diff.${p.mode}`).replace(/\s*∞\s*$/, '') : t(`mg.diff.${p.mode}`);
          pill.innerHTML = `${p.beaten ? `<span class="g68-pill-tick">${icon('check', 11)}</span>` : ''}${p.locked ? '🔒 ' : ''}${label}`;
          pill.addEventListener('click', () => {
            if (p.locked) {
              // §G5.5 lock: surface the unlock hint (line below shows it too)
              audio.play('ui.error');
              selected = 'endless';
            } else {
              audio.play('ui.pick');
              selected = p.mode;
              if (p.mode !== 'endless') framework.setDifficulty(meta.id, p.mode); // sticky §G5.5
            }
            renderDiff();
            renderBest();
          });
          pillsEl.appendChild(pill);
        }
        const line = modeLine(diff, selected);
        lineEl.textContent = t(line.key, line.vars);
        lineEl.classList.toggle('g68-modeline-lock', selected === 'endless' && !diff.endlessUnlocked);
      };
      if (diff?.enabled) {
        const block = document.createElement('div');
        block.className = 'g68-pre-diff';
        pillsEl = document.createElement('div');
        pillsEl.className = 'g68-pills';
        lineEl = document.createElement('div');
        lineEl.className = 'g68-modeline';
        block.append(pillsEl, lineEl);
        el.appendChild(block);
        renderDiff();
      }
      renderBest();

      // ---- goobyWelt SPECIAL block: §G6.6 quality toggle (+ WELT mount) ----
      if (isWelt) {
        const welt = document.createElement('div');
        welt.className = 'g68-pre-welt';
        const qLabel = document.createElement('span');
        qLabel.className = 'g68-welt-label';
        qLabel.textContent = t('pregame.quality.title');
        const qSeg = document.createElement('div');
        qSeg.className = 'g68-pills g68-quality';
        const renderQuality = () => {
          qSeg.innerHTML = '';
          const current = store.get('settings.goobyWeltQuality') === 'low' ? 'low' : 'high';
          for (const q of ['high', 'low']) {
            const b = document.createElement('button');
            b.className = 'g68-pill';
            if (q === current) b.classList.add('g68-pill-on');
            b.textContent = t(`pregame.quality.${q}`);
            b.addEventListener('click', () => {
              audio.play('ui.pick');
              store.set('settings.goobyWeltQuality', q);
              renderQuality();
            });
            qSeg.appendChild(b);
          }
        };
        renderQuality();
        welt.append(qLabel, qSeg);
        el.appendChild(welt);
        // V4/G68 mount point — Team WELT scene select + per-scene highscore
        // chips (§G5.6): renders when G65/G66's module exports SCENES.
        const loader = weltModules['../minigames/games/goobyWelt.js'];
        if (loader) {
          loader().then((ns) => {
            const scenes = Array.isArray(ns?.SCENES) ? ns.SCENES : null;
            if (!scenes || scenes.length === 0 || !welt.isConnected) return;
            const seg = document.createElement('div');
            seg.className = 'g68-pills g68-welt-scenes';
            weltScene = weltScene ?? scenes[0]?.id ?? null;
            for (const sc of scenes) {
              const b = document.createElement('button');
              b.className = 'g68-pill';
              if (sc.id === weltScene) b.classList.add('g68-pill-on');
              const best = Math.floor(Number(store.get(`minigames.weltBest.${sc.id}`)) || 0);
              b.innerHTML = `${sc.nameKey ? t(sc.nameKey) : sc.name ?? sc.id}${best > 0 ? ` <span class="g68-pill-tick">★${best}</span>` : ''}`;
              b.addEventListener('click', () => {
                audio.play('ui.pick');
                weltScene = sc.id;
                for (const other of seg.children) other.classList.remove('g68-pill-on');
                b.classList.add('g68-pill-on');
              });
              seg.appendChild(b);
            }
            welt.appendChild(seg);
          }).catch(() => {});
        }
      }

      // ---- §G8-1 modifier banner (accessor-driven, live via store event) ----
      const bannerHost = document.createElement('div');
      bannerHost.className = 'g68-pre-banner-host';
      el.appendChild(bannerHost);
      let bannerTimer = 0;
      const renderBanner = () => {
        clearInterval(bannerTimer);
        bannerHost.innerHTML = '';
        const active = getActiveFor(store.get(), meta.id, now());
        if (!active) return;
        const nameText = (() => {
          const resolved = t(active.nameKey);
          return resolved === active.nameKey ? t('pregame.modifier.title') : resolved; // §E0.1-11 until G76's strings land
        })();
        const banner = document.createElement('div');
        banner.className = 'g68-pre-banner';
        banner.style.setProperty('--modifier-color', active.color);
        banner.innerHTML = `
          <span class="g68-banner-icon">${icon(active.icon, 20)}${active.coinMult ? `<b>×${active.coinMult}</b>` : ''}</span>
          <span class="g68-banner-text">
            <span class="g68-banner-name">${nameText}</span>
            <span class="g68-banner-effect">${t(`pregame.modifier.effect.${active.type}`)}</span>
          </span>
          <span class="g68-banner-meta">
            <span class="g68-banner-plays">${t('pregame.modifier.plays', { n: active.remainingPlays })}</span>
            <span class="g68-banner-count">${formatCountdown(active.endsAt - now())}</span>
          </span>`;
        bannerHost.appendChild(banner);
        const countEl = banner.querySelector('.g68-banner-count');
        bannerTimer = setInterval(() => {
          const msLeft = active.endsAt - now();
          if (msLeft <= 0) {
            renderBanner(); // expired → accessor returns null, banner clears
            return;
          }
          countEl.textContent = formatCountdown(msLeft);
        }, 1000);
      };
      renderBanner();
      const offModifier = store.on?.('modifierChanged', renderBanner) ?? (() => {});
      cleanups.push(() => {
        clearInterval(bannerTimer);
        offModifier();
      });

      // ---- play row (§G5.6: full-width 3.5 rem btn-teal „Spielen ▶") ----
      const playRow = document.createElement('div');
      playRow.className = 'g68-pre-play';
      if (!unlocked) {
        // Locked games show the level requirement INSTEAD of PLAY.
        const lockLine = document.createElement('div');
        lockLine.className = 'g68-play-locked';
        lockLine.textContent = t('pregame.locked', { n: meta.minLevel });
        playRow.appendChild(lockLine);
      } else if (!implemented) {
        const soon = document.createElement('button');
        soon.className = 'btn g68-play-btn';
        soon.disabled = true;
        soon.textContent = t('arcade.soon');
        playRow.appendChild(soon);
      } else {
        const play = document.createElement('button');
        play.className = 'btn btn-teal g68-play-btn';
        play.textContent = t('pregame.play'); // §G7.3 „Spielen ▶" — arrow lives in the string
        play.addEventListener('click', () => {
          if (!framework) {
            ui.toast('toast.minigameMissing');
            return;
          }
          audio.play('ui.confirmBig');
          const launchParams = diff?.enabled ? { difficulty: selected } : {};
          if (weltScene != null) launchParams.scene = weltScene; // Team WELT pick
          framework
            .launch(meta.id, launchParams)
            .catch((err) => console.error('[mgPregame] launch failed:', err));
        });
        playRow.appendChild(play);
      }
      el.appendChild(playRow);
    },

    unmount() {
      for (const fn of cleanups.splice(0)) {
        try {
          fn();
        } catch (err) {
          console.warn('[mgPregame] cleanup error:', err);
        }
      }
      releaseArcadeMusic();
    },
  });
}
