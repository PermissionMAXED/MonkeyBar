// Home HUD (§D5, agent G5): 4 stat pills (SVG icon, per-stat fill color,
// pulse < 25), coins counter, XP/level progress ring and the action buttons
// (arcade, shop trip, wardrobe, achievements, settings, mute). Lives as a
// persistent DOM layer on the #ui overlay and only shows itself while the
// home scene is active. All numbers from data/constants.js; all text via t().

import { STATS, LEVELING, UI_COLORS } from '../data/constants.js';
import { t, getLang } from '../data/strings.js';
import { icon } from './icons.js';
import { xpToNext } from '../systems/leveling.js';
// V2/G23: claimable-quests badge reads the live engine (§B7 claimableCount)
import { getAchievementsEngine } from '../systems/achievementsEngine.js';

const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

const STAT_ICONS = { hunger: 'hunger', energy: 'energy', hygiene: 'hygiene', fun: 'fun' };
const STAT_COLORS = {
  hunger: UI_COLORS.STAT_HUNGER,
  energy: UI_COLORS.STAT_ENERGY,
  hygiene: UI_COLORS.STAT_HYGIENE,
  fun: UI_COLORS.STAT_FUN,
};

// V3/G33 (§B3 rem sweep + §C1.4 safe-area): px → rem ÷16; HUD top row
// `top: max(8px, var(--safe-top))`, bottom action bar keeps its 44px gap
// above the room-nav dots via `max(2.75rem, calc(var(--safe-bottom) +
// 2rem))`; the 4 stat pills WRAP 2×2 below ~4.5rem/pill instead of clipping
// (§C1.2 — worst case 320px × 130 %).
const HUD_CSS = `
.g5-hud{position:absolute;inset:0;pointer-events:none;z-index:40;}
.g5-hud.g5-hud-hidden{display:none;}
.g5-hud-top{position:absolute;top:max(0.625rem, var(--safe-top));left:max(0.625rem, var(--safe-left));right:max(0.625rem, var(--safe-right));display:flex;flex-direction:column;gap:0.5rem;}
.g5-hud-row{display:flex;gap:0.375rem;justify-content:space-between;align-items:center;flex-wrap:wrap;}
.g5-hud .stat-pill{flex:1;min-width:4.5rem;padding:0.375rem 0.5rem;pointer-events:auto;}
.g5-hud .stat-pill svg{flex:none;}
.g5-hud .stat-track{flex:1;min-width:1.5rem;width:auto;display:block;}
.g5-hud .stat-fill{display:block;}
.g5-hud-meta{display:flex;gap:0.5rem;align-items:center;justify-content:space-between;}
.g5-coins{display:inline-flex;align-items:center;gap:0.375rem;background:rgba(255,255,255,.92);border-radius:999px;padding:0.5rem 0.875rem;font-size:1.0625rem;font-weight:800;color:var(--brown);box-shadow:var(--shadow-soft);}
.g5-coins svg{color:var(--yellow);}
.g5-ring{position:relative;width:3.25rem;height:3.25rem;flex:none;}
.g5-ring svg{transform:rotate(-90deg);width:100%;height:100%;}
.g5-ring .g5-ring-bg{fill:rgba(255,255,255,.92);stroke:rgba(74,59,54,.12);stroke-width:5;}
.g5-ring .g5-ring-fg{fill:none;stroke:var(--teal);stroke-width:5;stroke-linecap:round;transition:stroke-dashoffset 300ms ease;}
.g5-ring .g5-ring-label{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;}
.g5-ring .g5-ring-lvl{font-size:1rem;font-weight:800;color:var(--brown);}
.g5-ring .g5-ring-cap{font-size:0.5rem;font-weight:800;color:var(--brown);opacity:.5;text-transform:uppercase;letter-spacing:0.0313rem;}
.g5-hud-btns{position:absolute;bottom:max(2.75rem, calc(var(--safe-bottom) + 2rem));left:max(0.5rem, var(--safe-left));right:max(0.5rem, var(--safe-right));display:flex;gap:0.375rem;justify-content:center;flex-wrap:wrap;}
.g5-hud-btn{pointer-events:auto;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:0.125rem;width:max(44px, 3.375rem);height:max(44px, 3.375rem);border:none;border-radius:1.125rem;background:rgba(255,255,255,.92);border-bottom:4px solid rgba(74,59,54,.14);color:var(--brown);font-family:inherit;font-size:0.5625rem;font-weight:800;cursor:pointer;box-shadow:var(--shadow-soft);-webkit-tap-highlight-color:transparent;transition:transform 90ms ease;}
.g5-hud-btn:active{transform:scale(.94);}
.g5-hud-btn svg{color:var(--pink);}
.g5-hud-btn.g5-btn-teal svg{color:var(--teal);}
.g5-hud-btn.g5-btn-yellow svg{color:#E0A93E;}
.g5-hud-btn.g5-muted svg{color:rgba(74,59,54,.35);}
.g5-hud-btn .g5-btn-label{max-width:3.25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
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

  /** @type {Array<{b: HTMLButtonElement, labelKey: string}>} F3: live re-label */
  const labeled = [];
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
    labeled.push({ b, labelKey });
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
    // F3 (single source of truth §D6): ONLY flip the persisted flags —
    // audio.js follows the store live and derives its bus gains from
    // settings.sfx/music. No direct setVolume pokes (they used to desync the
    // runtime multipliers from the settings screen's toggles).
    store.update((st) => {
      st.settings.sfx = on;
      st.settings.music = on;
    });
    store.flush(); // sync events so audio.js applies the new gains NOW
    syncMute();
  });
  function syncMute() {
    muteBtn.classList.toggle('g5-muted', store.get('settings.sfx') === false);
  }

  // ════════════════════════════════════════════════════════════ V2/G23 ═══
  // Progression buttons (§C5.1/§C12): quest clipboard + claimable badge,
  // photo-mode camera, profile avatar — plus the 🤒 sick chip (§C3.4) that
  // opens G20's 'careSheet' panel. Bespoke inline SVGs (icons.js is shared —
  // §E0.2 keeps it out of the append list, so the shapes live here).
  const G23_ICONS = {
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2.5"/><rect x="8" y="2" width="8" height="4" rx="1.5" fill="#fff" opacity="0.55"/><path d="M8 10h8M8 13.5h8M8 17h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity="0.75"/>',
    camera: '<path d="M4 7h3l1.6-2.4A1.5 1.5 0 0 1 9.9 4h4.2a1.5 1.5 0 0 1 1.3.6L17 7h3a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 19V8.5A1.5 1.5 0 0 1 4 7z"/><circle cx="12" cy="13.5" r="4" fill="#fff" opacity="0.55"/><circle cx="12" cy="13.5" r="2.1"/>',
    avatar: '<circle cx="12" cy="8.5" r="4.4"/><path d="M4 21c.6-4.4 3.9-7 8-7s7.4 2.6 8 7H4z"/><path d="M8.8 4.6C8 2.7 8.6 1.4 9.5 1.3c.9-.1 1.6 1 1.7 2.9M15.2 4.6c.8-1.9.2-3.2-.7-3.3-.9-.1-1.6 1-1.7 2.9" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
  };
  const g23Icon = (name, size = 22) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${G23_ICONS[name]}</svg>`;

  if (!document.querySelector('style[data-owner="g23-hud"]')) {
    const g23Style = document.createElement('style');
    g23Style.dataset.owner = 'g23-hud';
    // V3/G33 (§B3 rem sweep): px → rem ÷16 (44px tap floor stays real px).
    g23Style.textContent = `
.g5-hud-btn{position:relative;}
.g23-badge{position:absolute;top:-0.3125rem;right:-0.3125rem;min-width:1.1875rem;height:1.1875rem;padding:0 0.3125rem;border-radius:999px;background:var(--pink);color:#fff;font-size:0.6875rem;font-weight:800;display:none;align-items:center;justify-content:center;font-variant-numeric:tabular-nums;box-shadow:var(--shadow-soft);}
.g23-badge.g23-show{display:inline-flex;}
/* V2 fix (E16): >=44px hit target; top 10.75rem clears the HUD top block
   (~6.125rem) AND the sleep chip (top 6.5rem, up to ~3.875rem tall with big
   emoji glyphs — sick Gooby can still nap, §C3.4, so both chips may show
   together). V3/G33: rem so the offsets track the scaled HUD block. */
.g23-sick-chip{position:absolute;top:calc(10.75rem + var(--safe-top));left:50%;transform:translateX(-50%);display:none;align-items:center;justify-content:center;gap:0.4375rem;max-width:86vw;min-height:max(44px, 2.75rem);pointer-events:auto;border:none;border-radius:999px;padding:0.5625rem 0.875rem;background:var(--white);color:var(--brown);font-family:inherit;font-size:0.75rem;font-weight:800;box-shadow:var(--shadow-soft);cursor:pointer;-webkit-tap-highlight-color:transparent;animation:g23chip 1.6s ease-in-out infinite;}
.g23-sick-chip.g23-show{display:inline-flex;}
.g23-sick-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
@keyframes g23chip{0%,100%{transform:translateX(-50%) scale(1);}50%{transform:translateX(-50%) scale(1.035);}}`;
    document.head.appendChild(g23Style);
  }

  function g23Button(id, iconName, labelKey, onTap, extraClass = '') {
    const b = document.createElement('button');
    b.className = `g5-hud-btn ${extraClass}`.trim();
    b.dataset.hud = id;
    b.innerHTML = `${g23Icon(iconName, 22)}<span class="g5-btn-label">${t(labelKey)}</span>`;
    b.addEventListener('click', () => {
      audio.play('ui.tap');
      onTap(b);
    });
    btns.appendChild(b);
    labeled.push({ b, labelKey }); // rides the F3 live re-label loop
    return b;
  }

  const questBtn = g23Button('quests', 'clipboard', 'hud.quests', () => {
    ui.showScreen('questBoard'); // V2/G23: ui/questBoard.js (§C5.1)
  }, 'g5-btn-teal');
  const questBadge = document.createElement('span');
  questBadge.className = 'g23-badge';
  questBtn.appendChild(questBadge);

  g23Button('camera', 'camera', 'hud.camera', () => {
    // V2/G23: ui/photoMode.js consumes this event (§C12.2 — shopTrip pattern).
    window.dispatchEvent(new CustomEvent('gooby:photoMode'));
  }, 'g5-btn-yellow');

  g23Button('profile', 'avatar', 'hud.profile', () => {
    ui.showScreen('profile'); // V2/G23: ui/profileScreen.js (§C12.1)
  });

  /** Claimable-quests badge (§B7 claimableCount via the live engine). */
  function syncQuestBadge() {
    let n = 0;
    try {
      n = getAchievementsEngine()?.quests?.claimable?.() ?? 0;
    } catch { n = 0; }
    questBadge.textContent = String(n);
    questBadge.classList.toggle('g23-show', n > 0);
  }

  // 🤒 sick chip (§C3.4): shows while health.state === 'sick'; opens G20's
  // careSheet panel (degrades to the care sheet's own toast when unregistered).
  const sickChip = document.createElement('button');
  sickChip.className = 'g23-sick-chip';
  sickChip.innerHTML = `<span>🤒 ${t('hud.sickChip')}</span>`;
  sickChip.addEventListener('click', () => {
    audio.play('ui.tap');
    ui.openPanel('careSheet');
  });
  el.appendChild(sickChip);
  function syncSickChip() {
    sickChip.classList.toggle('g23-show', store.get('health')?.state === 'sick');
    sickChip.querySelector('span').textContent = `🤒 ${t('hud.sickChip')}`;
  }
  const offsG23 = [
    store.on('healthChanged', syncSickChip), // G20's §B3 event
    store.on('questsChanged', syncQuestBadge),
    store.on('change', () => { syncSickChip(); syncQuestBadge(); }), // fallback
  ];
  syncSickChip();
  syncQuestBadge();
  // ══════════════════════════════════════════════════════ end V2/G23 ═══

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
    // V2 fix: ring caps at LEVELING.MAX_LEVEL (40) — XP.MAX_LEVEL is the
    // frozen v1 cap (30) and pinned the ring full for L30-39 (§B3).
    const frac = level >= LEVELING.MAX_LEVEL ? 1 : Math.min(1, xp / xpToNext(level));
    ringFg.style.strokeDashoffset = String(RING_C * (1 - frac));
    syncMute();
  }
  // F3: live re-label on language switch (settings live-switch §A — the HUD is
  // a persistent layer built once at boot, so baked t() labels went stale).
  let hudLang = getLang();
  function syncLang() {
    if (getLang() === hudLang) return;
    hudLang = getLang();
    for (const { b, labelKey } of labeled) {
      b.querySelector('.g5-btn-label').textContent = t(labelKey);
    }
    for (const key of STATS.KEYS) statEls[key].pill.title = t(`stat.${key}`);
    ring.querySelector('.g5-ring-cap').textContent = t('ui.level');
  }
  const offs = [
    store.on('statsChanged', refresh),
    store.on('coinsChanged', refresh),
    store.on('xpChanged', refresh),
    store.on('change', () => { syncMute(); syncLang(); }), // F3: stay snappy when settings flip sfx/lang
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
      for (const off of offsG23) off?.(); // V2/G23: badge + sick-chip listeners
      if (visTimer != null) clearInterval(visTimer);
      el.remove();
    },
  };
}
