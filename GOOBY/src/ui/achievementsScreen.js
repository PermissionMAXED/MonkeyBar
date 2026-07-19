// Achievements screen (§C8.3, agent G12) — the 16 achievement tiles with
// live progress bars, unlocked states and coin reward labels. Rewards are paid
// automatically by systems/achievementsEngine.js the moment a condition is
// met (no claim step) — this screen is the trophy cabinet.
// Registered as ui screen 'achievements' (HUD button / ?open=achievements).

import { ACHIEVEMENTS } from '../data/achievements.js';
import { progressOf } from '../systems/achievementsEngine.js';
import { t } from '../data/strings.js';
import { icon } from './icons.js';

// V3/G33 (§B3): mechanical px→rem sweep (÷16) of this injected CSS string —
// exemptions (1px hairlines/999px pills/shadows/@media px) per PLAN3 §B3.
const ACH_CSS = `
.screen-achievements{justify-content:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g12-ach-head{width:100%;max-width:27.5rem;display:flex;align-items:center;gap:0.625rem;margin:0.375rem 0 0.375rem;flex:none;}
/* F3: title shrinks/ellipsizes at narrow widths — never the count pill
   (6vw keeps "Achievements" un-ellipsized beside the pill at 320px) */
.g12-ach-title{flex:1;min-width:0;margin:0;font-size:clamp(1.0625rem,6vw,1.875rem);font-weight:800;color:var(--brown);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.g12-ach-count{flex:none;background:var(--white);border-radius:999px;padding:0.5rem 0.75rem;font-size:0.9375rem;font-weight:800;color:var(--teal-dark);box-shadow:var(--shadow-soft);}
.g12-ach-list{width:100%;max-width:27.5rem;display:flex;flex-direction:column;gap:0.5rem;padding-bottom:1.125rem;flex:none;}
.g12-ach-tile{display:flex;align-items:center;gap:0.75rem;background:var(--white);border-radius:1.125rem;box-shadow:var(--shadow-soft);padding:0.625rem 0.875rem;}
.g12-ach-tile.g12-locked{opacity:.92;}
.g12-ach-medal{flex:none;width:2.875rem;height:2.875rem;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(74,59,54,.08);color:rgba(74,59,54,.35);}
.g12-ach-tile.g12-done .g12-ach-medal{background:var(--yellow);color:#fff;}
.g12-ach-body{flex:1;min-width:0;}
.g12-ach-name{font-size:0.9375rem;font-weight:800;color:var(--brown);}
.g12-ach-desc{font-size:0.75rem;font-weight:700;opacity:.72;margin-top:1px;} /* V4/G-UI: .55→.72 — body-text contrast ≈4.7:1 (WCAG-ish) */
.g12-ach-bar{margin-top:0.375rem;height:0.5rem;border-radius:999px;background:var(--track-soft);overflow:hidden;}
.g12-ach-fill{display:block;height:100%;border-radius:999px;background:var(--teal);transition:width 300ms ease;}
.g12-ach-tile.g12-done .g12-ach-fill{background:var(--yellow);}
.g12-ach-side{flex:none;text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:0.1875rem;}
.g12-ach-progress{font-size:0.75rem;font-weight:800;opacity:.6;}
.g12-ach-reward{display:inline-flex;align-items:center;gap:0.1875rem;font-size:0.8125rem;font-weight:800;color:var(--brown);background:rgba(255,209,102,.35);border-radius:999px;padding:0.1875rem 0.5625rem;}
.g12-ach-reward svg{color:var(--yellow);}
.g12-ach-tile.g12-done .g12-ach-reward{background:var(--yellow);color:#fff;}
.g12-ach-tile.g12-done .g12-ach-reward svg{color:#fff;}
`;

/**
 * Create + register the achievements screen.
 * @param {{store: object, ui: object, audio: object}} deps
 */
export function registerAchievementsScreen({ store, ui, audio }) {
  if (!document.querySelector('style[data-owner="g12-ach"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g12-ach';
    style.textContent = ACH_CSS;
    document.head.appendChild(style);
  }

  /** @type {{off: Function}|null} */
  let live = null;

  function mount(el) {
    const head = document.createElement('div');
    head.className = 'g12-ach-head';
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-ghost btn-round';
    backBtn.setAttribute('aria-label', t('ui.back'));
    backBtn.innerHTML = icon('arrowLeft', 22);
    backBtn.addEventListener('click', () => {
      audio.play('ui.close');
      ui.closeAll();
    });
    const title = document.createElement('h1');
    title.className = 'g12-ach-title';
    title.textContent = t('ach.title');
    const count = document.createElement('div');
    count.className = 'g12-ach-count';
    head.append(backBtn, title, count);
    el.appendChild(head);

    const list = document.createElement('div');
    list.className = 'g12-ach-list';
    el.appendChild(list);

    function render() {
      const state = store.get();
      const unlockedMap = state.achievements?.unlocked ?? {};
      count.textContent = `${Object.keys(unlockedMap).length}/${ACHIEVEMENTS.length}`;
      list.innerHTML = '';
      for (const def of ACHIEVEMENTS) {
        const done = !!unlockedMap[def.id];
        const p = progressOf(def, state);
        const pct = done ? 100 : Math.round((p.current / p.target) * 100);
        const tile = document.createElement('div');
        tile.className = `g12-ach-tile ${done ? 'g12-done' : 'g12-locked'}`;
        tile.innerHTML = `
          <span class="g12-ach-medal">${icon(done ? 'trophy' : 'lock', 24)}</span>
          <span class="g12-ach-body">
            <div class="g12-ach-name">${t(def.nameKey)}</div>
            <div class="g12-ach-desc">${t(def.descKey)}</div>
            <div class="g12-ach-bar"><span class="g12-ach-fill" style="width:${pct}%"></span></div>
          </span>
          <span class="g12-ach-side">
            <span class="g12-ach-progress">${done ? t('ach.unlockedLabel') : `${p.current}/${p.target}`}</span>
            <span class="g12-ach-reward">${icon('coin', 14)}+${def.coins}</span>
          </span>`;
        list.appendChild(tile);
      }
    }

    render();
    // live refresh: unlocks + counter changes land through the store (§E2)
    const off = store.on('change', render);
    live = { off };
  }

  function unmount() {
    live?.off?.();
    live = null;
  }

  ui.registerScreen('achievements', { mount, unmount });

  // Dev harness extension (§E9 spirit, dev only): ?achdemo=1 seeds a mixed
  // demo state (some unlocked, some mid-progress) for screenshots.
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  if (isDev && typeof location !== 'undefined' && new URLSearchParams(location.search).get('achdemo') === '1') {
    store.update((state) => {
      Object.assign(state.achievements.counters, {
        feeds: 34, washes: 3, sleeps: 5, trips: 2, cleanTrips: 1, tickles: 41,
      });
      state.minigames.plays = { carrotCatch: 4, bunnyHop: 2, cityDrive: 2, memoryMatch: 1, runner: 3 };
      state.daily.streak = 3;
    });
  }
}
