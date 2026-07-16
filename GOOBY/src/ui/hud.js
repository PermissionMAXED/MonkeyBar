// Home HUD (§D5, agent G5): 4 stat pills (SVG icon, per-stat fill color,
// pulse < 25), coins counter, XP/level progress ring and the action buttons
// (arcade, shop trip, wardrobe, achievements, settings, mute). Lives as a
// persistent DOM layer on the #ui overlay and only shows itself while the
// home scene is active. All numbers from data/constants.js; all text via t().

import { STATS, XP, UI_COLORS } from '../data/constants.js';
import { t } from '../data/strings.js';
import { icon } from './icons.js';
import { xpToNext } from '../systems/leveling.js';

const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

const STAT_ICONS = { hunger: 'hunger', energy: 'energy', hygiene: 'hygiene', fun: 'fun' };
const STAT_COLORS = {
  hunger: UI_COLORS.STAT_HUNGER,
  energy: UI_COLORS.STAT_ENERGY,
  hygiene: UI_COLORS.STAT_HYGIENE,
  fun: UI_COLORS.STAT_FUN,
};

const HUD_CSS = `
.g5-hud{position:absolute;inset:0;pointer-events:none;z-index:40;}
.g5-hud.g5-hud-hidden{display:none;}
.g5-hud-top{position:absolute;top:calc(10px + var(--safe-top));left:calc(10px + var(--safe-left));right:calc(10px + var(--safe-right));display:flex;flex-direction:column;gap:8px;}
.g5-hud-row{display:flex;gap:6px;justify-content:space-between;align-items:center;}
.g5-hud .stat-pill{flex:1;min-width:0;padding:6px 8px;pointer-events:auto;}
.g5-hud .stat-pill svg{flex:none;}
.g5-hud .stat-track{flex:1;min-width:24px;width:auto;display:block;}
.g5-hud .stat-fill{display:block;}
.g5-hud-meta{display:flex;gap:8px;align-items:center;justify-content:space-between;}
.g5-coins{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.92);border-radius:999px;padding:8px 14px;font-size:17px;font-weight:800;color:var(--brown);box-shadow:var(--shadow-soft);}
.g5-coins svg{color:var(--yellow);}
.g5-ring{position:relative;width:52px;height:52px;flex:none;}
.g5-ring svg{transform:rotate(-90deg);}
.g5-ring .g5-ring-bg{fill:rgba(255,255,255,.92);stroke:rgba(74,59,54,.12);stroke-width:5;}
.g5-ring .g5-ring-fg{fill:none;stroke:var(--teal);stroke-width:5;stroke-linecap:round;transition:stroke-dashoffset 300ms ease;}
.g5-ring .g5-ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;}
.g5-ring .g5-ring-lvl{font-size:16px;font-weight:800;color:var(--brown);}
.g5-ring .g5-ring-cap{font-size:8px;font-weight:800;color:var(--brown);opacity:.5;text-transform:uppercase;letter-spacing:.5px;}
.g5-hud-btns{position:absolute;bottom:calc(44px + var(--safe-bottom));left:calc(8px + var(--safe-left));right:calc(8px + var(--safe-right));display:flex;gap:6px;justify-content:center;flex-wrap:wrap;}
.g5-hud-btn{pointer-events:auto;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:54px;height:54px;border:none;border-radius:18px;background:rgba(255,255,255,.92);border-bottom:4px solid rgba(74,59,54,.14);color:var(--brown);font-family:inherit;font-size:9px;font-weight:800;cursor:pointer;box-shadow:var(--shadow-soft);-webkit-tap-highlight-color:transparent;transition:transform 90ms ease;}
.g5-hud-btn:active{transform:scale(.94);}
.g5-hud-btn svg{color:var(--pink);}
.g5-hud-btn.g5-btn-teal svg{color:var(--teal);}
.g5-hud-btn.g5-btn-yellow svg{color:#E0A93E;}
.g5-hud-btn.g5-muted svg{color:rgba(74,59,54,.35);}
.g5-hud-btn .g5-btn-label{max-width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
`;

/**
 * Create + mount the home HUD.
 * @param {{store: object, ui: object, audio: object,
 *   framework?: {launch: Function}, sceneManager?: {currentId: () => string|null}}} deps
 * @returns {{el: HTMLElement, refresh: () => void, dispose: () => void}}
 */
export function createHud({ store, ui, audio, framework, sceneManager }) {
  if (!document.querySelector('style[data-owner="g5-hud"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g5-hud';
    style.textContent = HUD_CSS;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.className = 'g5-hud';

  // --- top: stat pills + coins + XP/level ring ---
  const top = document.createElement('div');
  top.className = 'g5-hud-top';
  const statRow = document.createElement('div');
  statRow.className = 'g5-hud-row';
  /** @type {Record<string, {pill: HTMLElement, fill: HTMLElement}>} */
  const statEls = {};
  for (const key of STATS.KEYS) {
    const pill = document.createElement('div');
    pill.className = 'stat-pill';
    pill.title = t(`stat.${key}`);
    pill.innerHTML = `${icon(STAT_ICONS[key], 16)}<span class="stat-track"><span class="stat-fill" style="background:${STAT_COLORS[key]}"></span></span>`;
    pill.querySelector('svg').style.color = STAT_COLORS[key];
    statRow.appendChild(pill);
    statEls[key] = { pill, fill: pill.querySelector('.stat-fill') };
  }
  top.appendChild(statRow);

  const meta = document.createElement('div');
  meta.className = 'g5-hud-meta';
  const coins = document.createElement('div');
  coins.className = 'g5-coins';
  coins.innerHTML = `${icon('coin', 18)}<span class="g5-coins-n">0</span>`;
  const ring = document.createElement('div');
  ring.className = 'g5-ring';
  ring.innerHTML = `
    <svg width="52" height="52" viewBox="0 0 52 52">
      <circle class="g5-ring-bg" cx="26" cy="26" r="${RING_R}"></circle>
      <circle class="g5-ring-fg" cx="26" cy="26" r="${RING_R}"
        stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"></circle>
    </svg>
    <span class="g5-ring-label"><span class="g5-ring-lvl">1</span><span class="g5-ring-cap">${t('ui.level')}</span></span>`;
  meta.append(coins, ring);
  top.appendChild(meta);
  el.appendChild(top);

  const coinsEl = coins.querySelector('.g5-coins-n');
  const ringFg = ring.querySelector('.g5-ring-fg');
  const ringLvl = ring.querySelector('.g5-ring-lvl');

  // --- bottom: action buttons ---
  const btns = document.createElement('div');
  btns.className = 'g5-hud-btns';

  function button(id, iconName, labelKey, onTap, extraClass = '') {
    const b = document.createElement('button');
    b.className = `g5-hud-btn ${extraClass}`.trim();
    b.dataset.hud = id;
    b.innerHTML = `${icon(iconName, 22)}<span class="g5-btn-label">${t(labelKey)}</span>`;
    b.addEventListener('click', () => {
      audio.play('ui.tap');
      onTap(b);
    });
    btns.appendChild(b);
    return b;
  }

  button('arcade', 'play', 'hud.arcade', () => {
    ui.showScreen('arcade');
  }, 'g5-btn-teal');

  button('shop', 'cart', 'hud.shop', () => {
    // G7: systems/shopTrip.js consumes this event (confirm sheet → startTrip).
    window.dispatchEvent(new CustomEvent('gooby:shopTrip'));
  }, 'g5-btn-yellow');

  button('wardrobe', 'shirt', 'hud.wardrobe', () => {
    ui.showScreen('wardrobe'); // G12: ui/wardrobeScreen.js (§C5.3)
  });

  button('achievements', 'trophy', 'hud.achievements', () => {
    ui.showScreen('achievements'); // G12: ui/achievementsScreen.js (§C8.3)
  });

  button('settings', 'gear', 'hud.settings', () => {
    // G6 registers the settings screen; showScreen toasts a hint when missing.
    ui.showScreen('settings');
  });

  const muteBtn = button('mute', 'bell', 'hud.mute', () => {
    const muted = store.get('settings.sfx') === false;
    const on = muted; // toggling: muted → unmute
    store.update((st) => {
      st.settings.sfx = on;
      st.settings.music = on;
    });
    audio.setVolume('sfx', on ? 1 : 0);
    audio.setVolume('music', on ? 1 : 0);
    syncMute();
  });
  function syncMute() {
    muteBtn.classList.toggle('g5-muted', store.get('settings.sfx') === false);
  }

  el.appendChild(btns);
  ui.el.appendChild(el);

  // --- live refresh from store events (§E2) ---
  let lowCount = 0; // G14: low-stat audio tick state
  function refresh() {
    const stats = store.get('stats') ?? {};
    let nowLow = 0; // G14
    for (const key of STATS.KEYS) {
      const v = Math.max(0, Math.min(100, Number(stats[key]) || 0));
      statEls[key].fill.style.width = `${v}%`;
      statEls[key].pill.classList.toggle('stat-low', v < STATS.LOW_STAT);
      if (v < STATS.LOW_STAT) nowLow += 1; // G14
    }
    if (nowLow > lowCount) audio.play('hud.lowTick'); // G14: soft blip when a stat drops into the red
    lowCount = nowLow; // G14
    coinsEl.textContent = String(store.get('coins') ?? 0);
    const level = store.get('level') ?? 1;
    const xp = store.get('xp') ?? 0;
    ringLvl.textContent = String(level);
    const frac = level >= XP.MAX_LEVEL ? 1 : Math.min(1, xp / xpToNext(level));
    ringFg.style.strokeDashoffset = String(RING_C * (1 - frac));
    syncMute();
  }
  const offs = [
    store.on('statsChanged', refresh),
    store.on('coinsChanged', refresh),
    store.on('xpChanged', refresh),
  ];
  refresh();

  // --- visibility: only over the home scene (§D5 home HUD) ---
  let visTimer = null;
  if (sceneManager?.currentId) {
    const sync = () => {
      el.classList.toggle('g5-hud-hidden', sceneManager.currentId() !== 'home');
    };
    visTimer = setInterval(sync, 300);
    sync();
  }

  // ── G7 wiring: shop-trip state machine (§C4) ─────────────────────────────
  // Consumes gooby:shopTrip (button above) + the front-door tap; idempotent.
  if (framework && sceneManager) {
    import('../systems/shopTrip.js')
      .then((mod) => mod.initShopTrip({ store, ui, audio, framework, sceneManager }))
      .catch((err) => console.error('[hud] shopTrip wiring failed:', err));
  }
  // ── end G7 wiring ─────────────────────────────────────────────────────────

  return {
    el,
    refresh,
    dispose() {
      for (const off of offs) off?.();
      if (visTimer != null) clearInterval(visTimer);
      el.remove();
    },
  };
}
