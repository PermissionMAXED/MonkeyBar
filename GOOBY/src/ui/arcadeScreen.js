// Arcade screen (§C6.3, agent G5): grid of the minigame tiles from
// data/minigames.js metadata with lock overlays per the unlock schedule,
// best scores from the save. Registered as ui screen 'arcade'
// (ui.showScreen('arcade') / harness ?open=arcade). Metadata entries without
// an implementation module render as "coming soon" (§E8 — must be zero at
// ship).
//
// V4/G68 — cover grid 2.0 (PLAN4-GAMES §G7.2): 2 columns ALWAYS, big
// vertical cover cards (4:3 cover from public/assets/covers/<id>.png with
// the §G7.1 gradient+icon fallback), name row (2-line clamp), info row
// (★ best left, ∞ endless best right for endless-unlocked games). Overlay
// semantics kept and restyled onto the cover: lock dim + 🔒 + „ab Level N",
// NEU ribbon (§C10.3 rules unchanged — the flagship wide-tile treatment
// RETIRES: g48-flagship span-2 CSS removed, ribbon logic kept), goobyWelt
// SPECIAL gold-dashed border + ribbon, and the §C-SYS4.5 modifier glow
// (canvas twirl/ring/sparkles via ui/modifierGlow.js + box-shadow pulse +
// „{playsLeft}× ✨" badge + mm:ss countdown + icon chip). Taps open the
// §G5.6 pre-game screen: ui.showScreen('mgPregame', { gameId }) — also for
// locked games (the pre-game shows the level requirement instead of PLAY);
// coming-soon/dev states unchanged. Trips/tutorial/harness keep launching
// through framework.launch directly (they never pass through this screen).

import { MINIGAMES } from '../data/minigames.js';
import { t } from '../data/strings.js';
import { icon } from './icons.js';
import { isMinigameUnlocked } from '../systems/leveling.js';
import { hasGame } from '../minigames/registry.js';
import audio from '../audio/audio.js'; // V3/FIX-D (E19): tile/back tap cues
import { localDay, now } from '../core/clock.js'; // V3/G48: §C10.3 local-day ribbons
// ── V4/G68 imports (cover grid 2.0 + modifier glow) ──
import { getActiveFor } from '../systems/modifierEngine.js'; // §G8-2: same accessor as the banner
import { endlessUnlocked, bestForMode } from '../minigames/framework.logic.js';
import { formatCountdown, showSpecialRibbon } from './arcadeUi.logic.js';
import { createGlowManager } from './modifierGlow.js';
import {
  registerPregameScreen,
  createCoverArt,
  acquireArcadeMusic,
  releaseArcadeMusic,
} from './pregameScreen.js';
// ── end V4/G68 imports ──

// ---- V3/G48: GOOBY 3.0 arcade ribbons (PLAN3 §C10.3) ----------------------

/** All six 3.0 games carry a NEU ribbon until their first completed play. */
export const V3_GAME_IDS = Object.freeze([
  'shoppingSurf', 'purblePlace', 'toyRacer', 'ghostHunt', 'rocketRescue', 'harborHopper',
]);
/** The two flagships additionally get the wide treatment for three local days. */
export const V3_FLAGSHIP_IDS = Object.freeze(['shoppingSurf', 'purblePlace']);
const V3_GAME_SET = new Set(V3_GAME_IDS);
const V3_FLAGSHIP_SET = new Set(V3_FLAGSHIP_IDS);
const FLAGSHIP_NEW_DAYS = 3;

/** @param {string} day local YYYY-MM-DD @returns {number} UTC day ordinal */
function dayOrdinal(day) {
  const [y, m, d] = String(day).split('-').map(Number);
  if (![y, m, d].every(Number.isFinite)) return Number.NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * Pure ribbon rule. All six stop being new after first play; the flagship
 * window also expires after 3 local calendar days (§C10.3).
 * V3/FIX-D (E20 P1-2): LOCKED tiles never carry the ribbon — §C10.3 reads
 * "after first unlock", so a still-locked 3.0 game shows only its level
 * badge until the player actually reaches its unlock level.
 * V4/G68 (§G7.2): the ribbon RULE is unchanged; only the flagship wide-tile
 * treatment retired (covers make every tile loud).
 * @param {object} state save state
 * @param {string} id minigame id
 * @param {number} [nowMs] game-clock timestamp
 */
export function shouldShowV3GameRibbon(state, id, nowMs = now()) {
  if (!V3_GAME_SET.has(id) || Number(state?.minigames?.plays?.[id] ?? 0) > 0) return false;
  const level = Math.max(1, Math.floor(Number(state?.level) || 1));
  if (!isMinigameUnlocked(id, level)) return false; // V3/FIX-D (E20 P1-2)
  if (!V3_FLAGSHIP_SET.has(id)) return true;
  const unlockedDay = state?.minigames?.newUnlockDay?.[id];
  if (typeof unlockedDay !== 'string') return true;
  const age = dayOrdinal(localDay(nowMs)) - dayOrdinal(unlockedDay);
  return Number.isFinite(age) && age >= 0 && age < FLAGSHIP_NEW_DAYS;
}

/**
 * Record the first local day each unlocked flagship is presented in the
 * arcade. This tiny UI-owned metadata makes the 3-day window stable across
 * reloads without changing game/system logic.
 * @param {object} store
 * @param {number} level
 */
function rememberFlagshipUnlockDays(store, level) {
  const existing = store.get('minigames.newUnlockDay') ?? {};
  const next = { ...existing };
  const today = localDay();
  let changed = false;
  for (const id of V3_FLAGSHIP_IDS) {
    if (isMinigameUnlocked(id, level) && typeof next[id] !== 'string') {
      next[id] = today;
      changed = true;
    }
  }
  if (changed) {
    store.set('minigames.newUnlockDay', next);
    store.flush?.();
  }
}

// ---- end V3/G48 arcade ribbons --------------------------------------------

// V3/G33 (§B3): mechanical px→rem sweep (÷16) of this injected CSS string —
// exemptions (1px hairlines/999px pills/shadows/@media px) per PLAN3 §B3.
// V4/G68 (§G7.2): grid reworked to 2-col cover cards; the g48-flagship
// span-2 rules are REMOVED (ribbon CSS kept — the pre-game special ribbon
// reuses it). Pre-game screen styles live in styles.css (V4/G68 block).
const ARCADE_CSS = `
.screen-arcade{justify-content:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g5-arcade-head{width:100%;max-width:27.5rem;display:flex;align-items:center;gap:0.625rem;margin:0.375rem 0 0.875rem;flex:none;}
.g5-arcade-title{flex:1;min-width:0;margin:0;font-size:1.875rem;font-weight:800;color:var(--brown);}
.g5-arcade-grid{width:100%;max-width:27.5rem;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.75rem;padding-bottom:1rem;flex:none;}
.g68-card{position:relative;display:flex;flex-direction:column;align-items:stretch;min-width:0;border:none;border-radius:1.25rem;background:var(--white);border-bottom:0.25rem solid rgba(74,59,54,.12);box-shadow:var(--shadow-soft);font-family:inherit;color:var(--brown);cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent;transition:transform 90ms ease;text-align:left;}
.g68-card:active{transform:scale(.96);}
.g68-cover{position:relative;width:100%;aspect-ratio:4/3;border-radius:1rem 1rem 0 0;overflow:hidden;flex:none;}
.g68-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;padding:0.375rem 0.625rem 0;font-size:0.8125rem;font-weight:800;line-height:1.2;min-height:1.25rem;overflow-wrap:anywhere;}
.g68-info{display:flex;align-items:center;justify-content:space-between;gap:0.375rem;padding:0.125rem 0.625rem 0.5rem;font-size:0.6875rem;font-weight:700;opacity:.6;min-height:1.125rem;}
.g68-info span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-width:0;}
/* F3: 320px-wide fit — tighter screen padding + gaps */
@media (max-width:359px){
  .screen-arcade{padding-left:calc(0.625rem + var(--safe-left));padding-right:calc(0.625rem + var(--safe-right));}
  .g5-arcade-grid{gap:0.625rem;}
}
.g68-card.g5-soon .g68-cover-art{opacity:.55;}
.g68-card.g5-soon .g68-name{opacity:.5;}
.g68-soon-tag{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:0.75rem;font-weight:800;background:rgba(74,59,54,.45);z-index:2;}
/* V3/G48 (§C10.3): NEU ribbon (V4/G68: flagship span-2 treatment retired). */
.g48-new-ribbon{position:absolute;z-index:3;right:-0.3125rem;top:0.375rem;min-width:2.75rem;padding:0.1875rem 0.4375rem;border-radius:999px;background:var(--pink);color:#fff;font-size:0.625rem;font-weight:900;line-height:1.2;letter-spacing:.04em;box-shadow:0 0.125rem 0 rgba(74,59,54,.16);transform:rotate(7deg);pointer-events:none;}
`;
// V4/G68: shared cover/lock/special/glow/pre-game styles live in styles.css
// (marked V4/G68 block) — the pre-game screen must render even when the
// arcade screen (and this injected CSS) never mounted.

/**
 * Create the arcade screen ui module ({ mount, unmount } — §E6).
 * V4/G68: also registers the §G5.6 'mgPregame' screen (same deps).
 * @param {{store: object, ui: object, framework?: {launch: (id: string) => Promise<boolean>}}} deps
 */
export function createArcadeScreen({ store, ui, framework }) {
  registerPregameScreen({ store, ui, framework }); // V4/G68 (§G5.6)

  /** @type {ReturnType<typeof createGlowManager>|null} */
  let glow = null;
  /** @type {{remove: () => void}|null} */
  let glowHandle = null;
  let badgeTimer = 0;
  /** @type {() => void} */
  let offModifier = () => {};

  return {
    /** @param {HTMLElement} el */
    mount(el) {
      acquireArcadeMusic(); // V3/G32 medley via the V4/G68 shared holder (§G7.3)
      if (!document.querySelector('style[data-owner="g5-arcade"]')) {
        const style = document.createElement('style');
        style.dataset.owner = 'g5-arcade';
        style.textContent = ARCADE_CSS;
        document.head.appendChild(style);
      }

      const state = store.get();
      const level = state.level ?? 1;
      const best = state.minigames?.best ?? {};
      rememberFlagshipUnlockDays(store, level); // V3/G48: persist first-presented local day

      const head = document.createElement('div');
      head.className = 'g5-arcade-head';
      const backBtn = document.createElement('button');
      backBtn.className = 'btn btn-ghost btn-round';
      backBtn.setAttribute('aria-label', t('ui.back'));
      backBtn.innerHTML = icon('arrowLeft', 22);
      backBtn.addEventListener('click', () => {
        audio.play('ui.close'); // V3/FIX-D (E19)
        ui.closeAll();
      });
      const title = document.createElement('h1');
      title.className = 'g5-arcade-title';
      title.textContent = t('arcade.title');
      head.append(backBtn, title);
      el.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'g5-arcade-grid';
      el.appendChild(grid);

      MINIGAMES.filter((m) => !m.dev).forEach((meta) => {
        const unlocked = isMinigameUnlocked(meta.id, level);
        const implemented = hasGame(meta.id);
        const isWelt = meta.id === 'goobyWelt';
        const tile = document.createElement('button');
        // V4/G68: the legacy `g5-tile` class is dropped on purpose — G47's
        // §C11.2 gloss-frame reskin (`.screen-arcade .g5-tile` border-image)
        // belongs to the retired icon-tile look; §G7.2 cover cards keep the
        // plain card shadow + 1.25rem radius.
        tile.className = 'g68-card';
        tile.dataset.gameId = meta.id;
        const showNew = !isWelt && shouldShowV3GameRibbon(state, meta.id);
        if (showNew) tile.classList.add('g48-new');
        if (isWelt) tile.classList.add('g68-special'); // §G7.2 gold-dashed border

        // §G7.2 cover (4:3) with the §G7.1 gradient+icon fallback.
        const cover = document.createElement('span');
        cover.className = 'g68-cover';
        cover.appendChild(createCoverArt(meta, 44));
        tile.appendChild(cover);

        // name + info row (★ best left, ∞ endless best right — §G7.2).
        const nameEl = document.createElement('span');
        nameEl.className = 'g68-name';
        nameEl.textContent = t(meta.titleKey);
        tile.appendChild(nameEl);
        const infoEl = document.createElement('span');
        infoEl.className = 'g68-info';
        const bestScore = best[meta.id];
        const endlessOn = endlessUnlocked(state, meta.id);
        infoEl.innerHTML = `
          <span>${bestScore != null ? t('arcade.best.short', { n: bestScore }) : '&nbsp;'}</span>
          ${endlessOn ? `<span>${t('arcade.endless.short', { n: bestForMode(state, meta.id, 'endless') })}</span>` : ''}`;
        tile.appendChild(infoEl);

        // ribbons: NEU (§C10.3 unchanged) / goobyWelt SPECIAL until first play.
        if (showNew) {
          const ribbon = document.createElement('span');
          ribbon.className = 'g48-new-ribbon';
          ribbon.textContent = t('new.ribbon');
          cover.appendChild(ribbon);
        } else if (isWelt && showSpecialRibbon(state)) {
          const ribbon = document.createElement('span');
          ribbon.className = 'g48-new-ribbon g68-special-ribbon';
          ribbon.textContent = t('arcade.special.ribbon');
          cover.appendChild(ribbon);
        }

        if (!unlocked) {
          tile.classList.add('g5-locked');
          const lock = document.createElement('span');
          lock.className = 'g68-cover-lock';
          lock.innerHTML = `${icon('lock', 22)}<span>${t('arcade.lockLevel', { level: meta.minLevel })}</span>`;
          cover.appendChild(lock);
          // V4/G68 (§G7.2/§G5.6): locked tiles open the pre-game screen too —
          // it shows the level requirement instead of PLAY.
          tile.addEventListener('click', () => {
            audio.play('ui.pick');
            ui.showScreen('mgPregame', { gameId: meta.id });
          });
        } else if (!implemented) {
          tile.classList.add('g5-soon');
          const soon = document.createElement('span');
          soon.className = 'g68-soon-tag';
          soon.innerHTML = `<span>${t('arcade.soon')}</span>`;
          cover.appendChild(soon);
          tile.addEventListener('click', () => {
            audio.play('ui.error'); // V3/FIX-D (E19)
            ui.toast('toast.minigameMissing');
          });
        } else {
          tile.addEventListener('click', () => {
            audio.play('ui.pick'); // V3/FIX-D (E19): tile tap cue
            ui.showScreen('mgPregame', { gameId: meta.id }); // §G7.2 → §G5.6
          });
        }
        grid.appendChild(tile);
      });

      // ── V4/G68 (§C-SYS4.5/§G8-2): modifier glow on the modified tile —
      // canvas twirl/ring/sparkles + box-shadow pulse + „N× ✨" badge with
      // mm:ss countdown + icon chip. Accessor-driven (single source), live
      // via the §B10 'modifierChanged' store event. ──
      glow = createGlowManager();
      const clearFx = () => {
        clearInterval(badgeTimer);
        badgeTimer = 0;
        glowHandle?.remove();
        glowHandle = null;
        for (const tile of grid.querySelectorAll('.g68-modified')) {
          tile.classList.remove('g68-modified');
          tile.querySelector('.g68-mod-badge')?.remove();
          tile.querySelector('.g68-mod-chip')?.remove();
        }
      };
      const applyModifierFx = () => {
        clearFx();
        const gameId = store.get('modifiers.current')?.gameId;
        if (!gameId) return;
        const active = getActiveFor(store.get(), gameId, now());
        if (!active) return;
        const tile = grid.querySelector(`[data-game-id="${gameId}"]`);
        if (!tile) return;
        tile.classList.add('g68-modified');
        tile.style.setProperty('--modifier-color', active.color);
        glowHandle = glow.attach(tile.querySelector('.g68-cover'), { color: active.color });
        const badge = document.createElement('span');
        badge.className = 'g68-mod-badge';
        badge.innerHTML = `
          <span class="g68-mod-plays">${t('arcade.modifier.badge', { n: active.remainingPlays })}</span>
          <span class="g68-mod-count">${formatCountdown(active.endsAt - now())}</span>`;
        tile.appendChild(badge);
        const chip = document.createElement('span');
        chip.className = 'g68-mod-chip';
        chip.innerHTML = `${icon(active.icon, 14)}${active.coinMult ? `<b>×${active.coinMult}</b>` : ''}`;
        tile.querySelector('.g68-cover').appendChild(chip);
        const countEl = badge.querySelector('.g68-mod-count');
        badgeTimer = setInterval(() => {
          const msLeft = active.endsAt - now();
          if (msLeft <= 0) {
            applyModifierFx(); // window expired — accessor now returns null
            return;
          }
          countEl.textContent = formatCountdown(msLeft);
        }, 1000);
      };
      applyModifierFx();
      offModifier = store.on?.('modifierChanged', applyModifierFx) ?? (() => {});
      // ── end V4/G68 modifier glow ──
    },
    unmount() {
      clearInterval(badgeTimer);
      badgeTimer = 0;
      offModifier();
      offModifier = () => {};
      glowHandle = null;
      glow?.dispose();
      glow = null;
      releaseArcadeMusic(); // V4/G68 holder — pops the V3/G32 medley context (§B2.4)
    },
  };
}
