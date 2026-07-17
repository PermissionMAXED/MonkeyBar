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

const ARCADE_CSS = `
.screen-arcade{justify-content:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g5-arcade-head{width:100%;max-width:440px;display:flex;align-items:center;gap:10px;margin:6px 0 14px;flex:none;}
.g5-arcade-title{flex:1;min-width:0;margin:0;font-size:30px;font-weight:800;color:var(--brown);}
.g5-arcade-grid{width:100%;max-width:440px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding-bottom:16px;flex:none;}
.g5-tile{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-width:0;aspect-ratio:1;border:none;border-radius:20px;background:var(--white);border-bottom:4px solid rgba(74,59,54,.12);box-shadow:var(--shadow-soft);font-family:inherit;color:var(--brown);cursor:pointer;padding:8px 4px;-webkit-tap-highlight-color:transparent;transition:transform 90ms ease;}
.g5-tile:active{transform:scale(.95);}
.g5-tile-icon{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;color:#fff;flex:none;}
.g5-tile-name{font-size:11px;font-weight:800;line-height:1.15;text-align:center;max-width:100%;max-height:26px;overflow:hidden;overflow-wrap:anywhere;}
.g5-tile-best{font-size:10px;font-weight:700;opacity:.55;max-width:100%;overflow:hidden;white-space:nowrap;}
/* F3: 320px-wide fit — tighter screen padding + gaps, slightly smaller icons */
@media (max-width:359px){
  .screen-arcade{padding-left:calc(10px + var(--safe-left));padding-right:calc(10px + var(--safe-right));}
  .g5-arcade-grid{gap:8px;}
  .g5-tile-icon{width:38px;height:38px;}
}
.g5-tile-lock{position:absolute;inset:0;border-radius:20px;background:rgba(74,59,54,.55);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:#fff;font-size:12px;font-weight:800;backdrop-filter:blur(1px);}
.g5-tile-lock svg{opacity:.9;}
.g5-tile.g5-locked{cursor:default;}
/* F6 (RE3): locked tiles show ONLY the lock icon + requirement — hide the
   name/best underneath so the overlay text never collides with them */
.g5-tile.g5-locked .g5-tile-name,.g5-tile.g5-locked .g5-tile-best{visibility:hidden;}
.g5-tile.g5-soon .g5-tile-icon{opacity:.4;}
.g5-tile.g5-soon .g5-tile-name{opacity:.5;}
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
      if (!document.querySelector('style[data-owner="g5-arcade"]')) {
        const style = document.createElement('style');
        style.dataset.owner = 'g5-arcade';
        style.textContent = ARCADE_CSS;
        document.head.appendChild(style);
      }

      const level = store.get('level') ?? 1;
      const best = store.get('minigames.best') ?? {};

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
        const bestScore = best[meta.id];
        tile.innerHTML = `
          <span class="g5-tile-icon" style="background:${TILE_COLORS[i % TILE_COLORS.length]}">${icon(meta.icon, 26)}</span>
          <span class="g5-tile-name">${t(meta.titleKey)}</span>
          <span class="g5-tile-best">${bestScore != null ? t('arcade.best', { score: bestScore }) : '&nbsp;'}</span>`;

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
    unmount() {},
  };
}
