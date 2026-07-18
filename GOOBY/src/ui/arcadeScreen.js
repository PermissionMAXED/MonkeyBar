// Arcade screen (§C6.3, agent G5): grid of the 12 minigame tiles from
// data/minigames.js metadata with lock overlays per the unlock schedule,
// best scores from the save, and framework.launch(id) on tap. Registered as
// ui screen 'arcade' (ui.showScreen('arcade') / harness ?open=arcade).
// Metadata entries without an implementation module render as "coming soon"
// (§E8 — must be zero at ship).

import { MINIGAMES } from '../data/minigames.js';
import { t } from '../data/strings.js';
import { icon } from './icons.js';
import { isMinigameUnlocked } from '../systems/leveling.js';
import { hasGame } from '../minigames/registry.js';
import musicDirector from '../audio/musicDirector.js'; // V3/G32: arcade medley overlay (§B2.4)
import { localDay, now } from '../core/clock.js'; // V3/G48: §C10.3 local-day ribbons

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
 * @param {object} state save state
 * @param {string} id minigame id
 * @param {number} [nowMs] game-clock timestamp
 */
export function shouldShowV3GameRibbon(state, id, nowMs = now()) {
  if (!V3_GAME_SET.has(id) || Number(state?.minigames?.plays?.[id] ?? 0) > 0) return false;
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
const ARCADE_CSS = `
.screen-arcade{justify-content:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g5-arcade-head{width:100%;max-width:27.5rem;display:flex;align-items:center;gap:0.625rem;margin:0.375rem 0 0.875rem;flex:none;}
.g5-arcade-title{flex:1;min-width:0;margin:0;font-size:1.875rem;font-weight:800;color:var(--brown);}
.g5-arcade-grid{width:100%;max-width:27.5rem;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0.625rem;padding-bottom:1rem;flex:none;}
.g5-tile{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.375rem;min-width:0;aspect-ratio:1;border:none;border-radius:1.25rem;background:var(--white);border-bottom:0.25rem solid rgba(74,59,54,.12);box-shadow:var(--shadow-soft);font-family:inherit;color:var(--brown);cursor:pointer;padding:0.5rem 0.25rem;-webkit-tap-highlight-color:transparent;transition:transform 90ms ease;}
.g5-tile:active{transform:scale(.95);}
.g5-tile-icon{width:2.75rem;height:2.75rem;border-radius:0.875rem;display:flex;align-items:center;justify-content:center;color:#fff;flex:none;}
.g5-tile-name{font-size:0.6875rem;font-weight:800;line-height:1.15;text-align:center;max-width:100%;max-height:1.625rem;overflow:hidden;overflow-wrap:anywhere;}
.g5-tile-best{font-size:0.625rem;font-weight:700;opacity:.55;max-width:100%;overflow:hidden;white-space:nowrap;}
/* F3: 320px-wide fit — tighter screen padding + gaps, slightly smaller icons */
@media (max-width:359px){
  .screen-arcade{padding-left:calc(0.625rem + var(--safe-left));padding-right:calc(0.625rem + var(--safe-right));}
  .g5-arcade-grid{gap:0.5rem;}
  .g5-tile-icon{width:2.375rem;height:2.375rem;}
}
.g5-tile-lock{position:absolute;inset:0;border-radius:1.25rem;background:rgba(74,59,54,.55);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.25rem;color:#fff;font-size:0.75rem;font-weight:800;backdrop-filter:blur(1px);}
.g5-tile-lock svg{opacity:.9;}
.g5-tile.g5-locked{cursor:default;}
/* F6 (RE3): locked tiles show ONLY the lock icon + requirement — hide the
   name/best underneath so the overlay text never collides with them */
.g5-tile.g5-locked .g5-tile-name,.g5-tile.g5-locked .g5-tile-best{visibility:hidden;}
.g5-tile.g5-soon .g5-tile-icon{opacity:.4;}
.g5-tile.g5-soon .g5-tile-name{opacity:.5;}
/* V3/G48 (§C10.3): component-injected styles; styles.css belongs to G47. */
.g5-tile.g48-flagship{grid-column:span 2;aspect-ratio:2.05/1;flex-direction:row;padding-inline:0.875rem;background:linear-gradient(135deg,var(--white),rgba(255,123,169,.14));}
.g5-tile.g48-flagship .g5-tile-icon{width:3.125rem;height:3.125rem;}
.g5-tile.g48-flagship .g5-tile-name{font-size:0.8125rem;max-height:2rem;}
.g48-new-ribbon{position:absolute;z-index:3;right:-0.3125rem;top:0.375rem;min-width:2.75rem;padding:0.1875rem 0.4375rem;border-radius:999px;background:var(--pink);color:#fff;font-size:0.625rem;font-weight:900;line-height:1.2;letter-spacing:.04em;box-shadow:0 0.125rem 0 rgba(74,59,54,.16);transform:rotate(7deg);pointer-events:none;}
`;

/** Pastel tile accent per game (visual variety on the grid). */
const TILE_COLORS = [
  '#FF7BA9', '#59C9B9', '#FFD166', '#9B8CFF', '#7FD4FF', '#FFA26B',
  '#FF8FC0', '#6BD0A8', '#F7B84B', '#B49CFF', '#5AC0E8', '#F58C6E',
];

/**
 * Create the arcade screen ui module ({ mount, unmount } — §E6).
 * @param {{store: object, ui: object, framework?: {launch: (id: string) => Promise<boolean>}}} deps
 */
export function createArcadeScreen({ store, ui, framework }) {
  return {
    /** @param {HTMLElement} el */
    mount(el) {
      musicDirector.pushContext('arcade'); // V3/G32: NES medley while browsing (§B2.4)
      if (!document.querySelector('style[data-owner="g5-arcade"]')) {
        const style = document.createElement('style');
        style.dataset.owner = 'g5-arcade';
        style.textContent = ARCADE_CSS;
        document.head.appendChild(style);
      }

      const level = store.get('level') ?? 1;
      const best = store.get('minigames.best') ?? {};
      rememberFlagshipUnlockDays(store, level); // V3/G48: persist first-presented local day

      const head = document.createElement('div');
      head.className = 'g5-arcade-head';
      const backBtn = document.createElement('button');
      backBtn.className = 'btn btn-ghost btn-round';
      backBtn.setAttribute('aria-label', t('ui.back'));
      backBtn.innerHTML = icon('arrowLeft', 22);
      backBtn.addEventListener('click', () => ui.closeAll());
      const title = document.createElement('h1');
      title.className = 'g5-arcade-title';
      title.textContent = t('arcade.title');
      head.append(backBtn, title);
      el.appendChild(head);

      const grid = document.createElement('div');
      grid.className = 'g5-arcade-grid';
      el.appendChild(grid);

      MINIGAMES.filter((m) => !m.dev).forEach((meta, i) => {
        const unlocked = isMinigameUnlocked(meta.id, level);
        const implemented = hasGame(meta.id);
        const tile = document.createElement('button');
        tile.className = 'g5-tile';
        tile.dataset.gameId = meta.id;
        const showNew = shouldShowV3GameRibbon(store.get(), meta.id);
        if (showNew) {
          tile.classList.add('g48-new');
          if (V3_FLAGSHIP_SET.has(meta.id)) tile.classList.add('g48-flagship');
        }
        const bestScore = best[meta.id];
        tile.innerHTML = `
          <span class="g5-tile-icon" style="background:${TILE_COLORS[i % TILE_COLORS.length]}">${icon(meta.icon, 26)}</span>
          <span class="g5-tile-name">${t(meta.titleKey)}</span>
          <span class="g5-tile-best">${bestScore != null ? t('arcade.best', { score: bestScore }) : '&nbsp;'}</span>`;
        if (showNew) {
          const ribbon = document.createElement('span');
          ribbon.className = 'g48-new-ribbon';
          ribbon.textContent = t('new.ribbon');
          tile.appendChild(ribbon);
        }

        if (!unlocked) {
          tile.classList.add('g5-locked');
          const lock = document.createElement('span');
          lock.className = 'g5-tile-lock';
          lock.innerHTML = `${icon('lock', 22)}<span>${t('arcade.lockLevel', { level: meta.minLevel })}</span>`;
          tile.appendChild(lock);
          tile.addEventListener('click', () => ui.toast('mg.locked', { level: meta.minLevel }));
        } else if (!implemented) {
          tile.classList.add('g5-soon');
          const lock = document.createElement('span');
          lock.className = 'g5-tile-lock';
          lock.innerHTML = `<span>${t('arcade.soon')}</span>`;
          tile.appendChild(lock);
          tile.addEventListener('click', () => ui.toast('toast.minigameMissing'));
        } else {
          tile.addEventListener('click', () => {
            if (!framework) {
              ui.toast('toast.minigameMissing');
              return;
            }
            framework.launch(meta.id).catch((err) => console.error('[arcade] launch failed:', err));
          });
        }
        grid.appendChild(tile);
      });
    },
    unmount() {
      musicDirector.popContext('arcade'); // V3/G32: fall back to the scene medley (§B2.4)
    },
  };
}
