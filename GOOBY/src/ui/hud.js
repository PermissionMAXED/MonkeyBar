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
// V4/G59: album badge rule + session-seen stamp (§C-SYS9.3-1)
import { shouldShowAlbumBadge, gallerySeenStamp } from '../systems/gallery.logic.js';
// V4/G58: ×2-coins buff chip countdown math (§C-SYS5.2 'UpdateLiebe')
import { buffRemainingMs, formatMmSs } from './settingsIa.logic.js';
import * as g58Clock from '../core/clock.js';
// V4/G76: HUD modifier chip + arcade nav dot (§C-SYS4.6) — §G8 accessor +
// event signature for the once-per-event start toast
import { getActiveFor } from '../systems/modifierEngine.js';
import { eventSignature } from './modifierSurface.logic.js';
import { getMinigame } from '../data/minigames.js';

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
/* V3/FIX-D (E18 P1 — §C12.2): at 130 % the 3.375rem (70 px) buttons wrap to
   THREE rows on a 390-wide portrait and the top row's hit areas overlay
   Gooby's belly (touches near (188,553) opened Wardrobe instead of petting).
   Cap the buttons to 2.5rem (52 px at 130 % — still over the real-px 44 px
   floor) so all 9 fit in two rows and the block stays clear of the pet zone. */
:root[data-ui-scale="130"] .g5-hud-btn{width:max(44px, 2.5rem);height:max(44px, 2.5rem);border-radius:0.875rem;}
:root[data-ui-scale="130"] .g5-hud-btn .g5-btn-label{max-width:2.25rem;}
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

  // ══════════════════════════════════════════════════════════ V4/G69 ═══
  // §C-SYS3.2: the HUD level pill is a 44px+ keyboard-accessible entry point
  // to the shared „Wie levle ich?" info sheet.
  ring.dataset.hud = 'xpInfo';
  ring.setAttribute('role', 'button');
  ring.setAttribute('tabindex', '0');
  ring.setAttribute('aria-label', t('xp.openLabel'));
  ring.style.pointerEvents = 'auto';
  ring.style.cursor = 'pointer';
  const openXpInfo = () => {
    audio.play('ui.tap');
    ui.openPanel('xpInfo');
  };
  ring.addEventListener('click', openXpInfo);
  ring.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openXpInfo();
  });
  // Keep the full ring tap target, and add the requested compact visual cue
  // beside it. The visible dot is small; the button still has a 44px hit area.
  if (!document.querySelector('style[data-owner="v4-g69-hud-xp"]')) {
    const xpHelpStyle = document.createElement('style');
    xpHelpStyle.dataset.owner = 'v4-g69-hud-xp';
    xpHelpStyle.textContent = `
.g69-hud-xp-help{pointer-events:auto;display:inline-flex;align-items:center;justify-content:center;width:max(44px,1.75rem);height:max(44px,1.75rem);padding:0;border:0;background:transparent;color:var(--teal-dark);cursor:pointer;-webkit-tap-highlight-color:transparent;}
.g69-hud-xp-help-mark{display:inline-flex;align-items:center;justify-content:center;width:1.375rem;height:1.375rem;border-radius:50%;background:rgba(255,255,255,.94);box-shadow:var(--shadow-soft);font:900 .75rem/1 system-ui,sans-serif;}
.g69-hud-xp-help:active .g69-hud-xp-help-mark{transform:scale(.9);}
`;
    document.head.appendChild(xpHelpStyle);
  }
  const xpHelp = document.createElement('button');
  xpHelp.className = 'g69-hud-xp-help';
  xpHelp.dataset.hud = 'xpHelp';
  xpHelp.setAttribute('aria-label', t('xp.openLabel'));
  xpHelp.innerHTML = '<span class="g69-hud-xp-help-mark" aria-hidden="true">?</span>';
  xpHelp.addEventListener('click', openXpInfo);
  // ══════════════════════════════════════════════════════ end V4/G69 ═══

  // ---- V4/G52: playing-only HUD radio chip (§C-SYS1.3) --------------------
  // It lives inside the safe-area-aware meta row, so the transient fixed
  // now-playing chip never overlaps it or any bottom action.
  if (!document.querySelector('style[data-owner="v4-g52-hud-radio"]')) {
    const radioStyle = document.createElement('style');
    radioStyle.dataset.owner = 'v4-g52-hud-radio';
    radioStyle.textContent = `
.g52-hud-radio{display:none;pointer-events:auto;align-items:center;gap:.3125rem;min-width:max(44px,2.75rem);min-height:max(44px,2.75rem);padding:.375rem .625rem;border:0;border-radius:999px;background:rgba(255,255,255,.94);color:var(--pink-dark);font:800 .6875rem/1 system-ui,sans-serif;box-shadow:var(--shadow-soft);cursor:pointer;}
.g52-hud-radio.g52-show{display:inline-flex;}
.g52-hud-radio-note{font-size:1.125rem;animation:g52hudnote 1s ease-in-out infinite;}
@keyframes g52hudnote{50%{transform:translateY(-.1875rem) rotate(-8deg);}}`;
    document.head.appendChild(radioStyle);
  }
  const radioChip = document.createElement('button');
  radioChip.className = 'g52-hud-radio';
  radioChip.dataset.hud = 'radio';
  radioChip.innerHTML = '<span class="g52-hud-radio-note" aria-hidden="true">♫</span><span></span>';
  const radioChipText = radioChip.querySelector('span:last-child');
  const syncRadioChip = () => {
    let label = t('radio.hud');
    radioChip.classList.toggle('g52-show', store.get('radio.playing') === true);
    if (label !== 'radio.hud') {
      radioChipText.textContent = label;
      radioChip.setAttribute('aria-label', label);
      return;
    }
    import('../data/strings/v4-radio.js').then(({ EN, DE }) => {
      label = (getLang() === 'de' ? DE : EN)['radio.hud'];
      radioChipText.textContent = label;
      radioChip.setAttribute('aria-label', label);
    });
  };
  radioChip.addEventListener('click', () => {
    audio.play('ui.tap');
    ui.openPanel('radioPanel');
  });
  const offsG52 = [
    store.on('radioChanged', syncRadioChip),
    store.on('radioTrackChanged', syncRadioChip),
    store.on('change', syncRadioChip),
  ];
  meta.append(coins, radioChip, ring);
  ring.before(xpHelp); // V4/G69: small „?" affordance beside the HUD XP ring (§C-SYS3.2)
  syncRadioChip();
  // ---- end V4/G52 HUD radio chip -------------------------------------------
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

  // ══════════════════════════════════════════════════════════ V4/G59 ═══
  // Album badge (PLAN4 §C-SYS9.3-1): a dot on the profile HUD button (the
  // album's entry path: profile → „Galerie" row) while a new photo was added
  // and the gallery was not visited yet — gallery.lastAddedAt (persisted)
  // vs the runtime session-seen stamp (systems/gallery.logic.js; the album's
  // Fotos tab stamps it on render). Listeners ride offsG23 for disposal.
  if (!document.querySelector('style[data-owner="g59-hud"]')) {
    const g59Style = document.createElement('style');
    g59Style.dataset.owner = 'g59-hud';
    g59Style.textContent = '.g59-dot{position:absolute;top:-0.1875rem;right:-0.1875rem;width:0.75rem;height:0.75rem;border-radius:50%;background:var(--pink);box-shadow:var(--shadow-soft);display:none;pointer-events:none;}.g59-dot.g59-show{display:block;}';
    document.head.appendChild(g59Style);
  }
  const albumDot = document.createElement('span');
  albumDot.className = 'g59-dot';
  btns.querySelector('[data-hud="profile"]')?.appendChild(albumDot);
  function syncAlbumDot() {
    const g = store.get('gallery');
    albumDot.classList.toggle('g59-show', shouldShowAlbumBadge(g?.lastAddedAt, gallerySeenStamp()));
  }
  offsG23.push(
    store.on('galleryChanged', syncAlbumDot), // runtime add signal (photoMode)
    store.on('change', syncAlbumDot) // coalesced fallback — clears after visit
  );
  syncAlbumDot();
  // ══════════════════════════════════════════════════════ end V4/G59 ═══

  // ══════════════════════════════════════════════════════════ V4/G56 ═══
  // XP floaters (PLAN4 §C-SYS3.1): every XP grant emits the runtime
  // 'xpGranted {amount, source}' event from systems/leveling.js (single-emit
  // ruling §E0.1-13); the HUD floats „+{n} XP" — 14px (0.875rem) bold, rises
  // 2.5rem (40px) + fades over 900ms, max 3 visible, further grants COALESCE
  // into the newest floater's number (its animation restarts). The layer is
  // a FIXED sibling pinned over the level ring's HUD spot so floaters stay
  // visible when the home HUD itself is hidden (minigame results, quest
  // board) — §C-SYS3.1 fires on minigame end too.
  if (!document.querySelector('style[data-owner="g56-hud-xp"]')) {
    const g56Style = document.createElement('style');
    g56Style.dataset.owner = 'g56-hud-xp';
    g56Style.textContent = `
.g56-xp-layer{position:absolute;top:calc(max(0.625rem, var(--safe-top)) + 3.1rem);right:max(0.875rem, var(--safe-right));width:0;height:0;pointer-events:none;z-index:620;}
.g56-xp-floater{position:absolute;right:0;bottom:0;font-size:0.875rem;font-weight:800;color:var(--teal);text-shadow:0 0.0625rem 0 rgba(255,255,255,.85);white-space:nowrap;pointer-events:none;animation:g56xpfloat 900ms ease-out forwards;}
@keyframes g56xpfloat{0%{opacity:0;transform:translateY(0);}15%{opacity:1;}100%{opacity:0;transform:translateY(-2.5rem);}}`;
    document.head.appendChild(g56Style);
  }
  const xpLayer = document.createElement('div');
  xpLayer.className = 'g56-xp-layer';
  ui.el.appendChild(xpLayer);
  /** §E0.1-11 fallback until G53 spreads strings/v4-difficulty.js. */
  function xpFloaterText(n) {
    const global = t('hud.xpFloater', { n });
    return global !== 'hud.xpFloater' ? global : `+${n} XP`;
  }
  /** @type {Array<{el: HTMLElement, amount: number, timer: number}>} */
  const xpFloaters = [];
  function retireXpFloater(f) {
    f.el.remove();
    const i = xpFloaters.indexOf(f);
    if (i >= 0) xpFloaters.splice(i, 1);
  }
  function onXpGranted(payload) {
    const amount = Math.floor(Number(payload?.amount) || 0);
    if (amount <= 0) return; // amount-0 grants emit nothing anyway (§C-SYS3.1)
    if (xpFloaters.length >= 3) {
      // Coalesce into the NEWEST floater: bump its number, restart its life
      // (clone swap restarts the CSS animation without a reflow hack).
      const f = xpFloaters[xpFloaters.length - 1];
      f.amount += amount;
      clearTimeout(f.timer);
      const fresh = f.el.cloneNode(false);
      fresh.textContent = xpFloaterText(f.amount);
      f.el.replaceWith(fresh);
      f.el = fresh;
      f.timer = setTimeout(() => retireXpFloater(f), 900);
      return;
    }
    const f = { el: document.createElement('div'), amount, timer: 0 };
    f.el.className = 'g56-xp-floater';
    f.el.textContent = xpFloaterText(amount);
    f.el.style.right = `${xpFloaters.length * 0.625}rem`; // stagger stacked grants
    xpLayer.appendChild(f.el);
    xpFloaters.push(f);
    f.timer = setTimeout(() => retireXpFloater(f), 900);
  }
  const offsG56 = [store.on('xpGranted', onXpGranted)];
  // ══════════════════════════════════════════════════════ end V4/G56 ═══

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
    ring.setAttribute('aria-label', t('xp.openLabel')); // V4/G69: live-language XP entry label
    xpHelp.setAttribute('aria-label', t('xp.openLabel')); // V4/G69: live-language „?" label
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

  // ---- V4/G58: ×2-coins buff chip (§C-SYS5.2 'UpdateLiebe') ----------------
  // „×2 💰 mm:ss" beside the coin counter while codes.buffs.doubleCoinsUntil
  // is in the future: 1 s countdown, disappears at 0, survives reload via the
  // persisted expiry stamp. Styles in the V4/G58 styles.css block. Cleanup
  // rides the existing `offs` list (declared above) — no dispose() edit.
  {
    const buffChip = document.createElement('div');
    buffChip.className = 'g58-hud-buff';
    buffChip.dataset.hud = 'coinBuff';
    buffChip.innerHTML = '<span aria-hidden="true">×2 💰</span><span class="g58-hud-buff-t"></span>';
    const buffT = buffChip.querySelector('.g58-hud-buff-t');
    coins.after(buffChip); // meta row is safe-area aware (§C1.4)
    const syncBuff = () => {
      const remaining = buffRemainingMs(store.get('codes'), g58Clock.now());
      buffChip.classList.toggle('g58-show', remaining > 0);
      if (remaining > 0) buffT.textContent = formatMmSs(remaining);
    };
    const buffTimer = setInterval(syncBuff, 1000);
    offs.push(store.on('codesChanged', syncBuff), () => clearInterval(buffTimer));
    syncBuff();
  }
  // ---- end V4/G58 buff chip ------------------------------------------------

  // ══════════════════════════════════════════════════════════ V4/G76 ═══
  // §C-SYS4.6 modifier surfacing: a small glowing HUD chip (type-tinted,
  // „✨ {name} · mm:ss") while a modifier event is ACTIVE somewhere, a
  // pulsing dot on the arcade nav button, and the once-per-event start
  // toast `modifier.start` + jingle.short. The chip taps into the arcade
  // with the modified tile scrolled into view (G68's glow marks it) and
  // auto-hides when the event is consumed/expired — state read through
  // G54's §G8 accessor only (event + 1 s countdown tick). Styles in the
  // V4/G76 styles.css block. Cleanup rides the existing `offs` list.
  {
    const modRow = document.createElement('div');
    modRow.className = 'g76-hud-mod-row';
    const modChip = document.createElement('button');
    modChip.className = 'g76-hud-mod';
    modChip.dataset.hud = 'modifier';
    modChip.innerHTML = '<span class="g76-hud-mod-icon" aria-hidden="true">✨</span><span class="g76-hud-mod-name"></span><span class="g76-hud-mod-t"></span>';
    modRow.appendChild(modChip);
    top.appendChild(modRow);
    const modName = modChip.querySelector('.g76-hud-mod-name');
    const modT = modChip.querySelector('.g76-hud-mod-t');
    const modDot = document.createElement('span');
    modDot.className = 'g76-dot';
    btns.querySelector('[data-hud="arcade"]')?.appendChild(modDot);
    modChip.addEventListener('click', () => {
      const cur = store.get('modifiers')?.current;
      audio.play('ui.tap');
      ui.showScreen('arcade');
      if (!cur) return;
      // G68's glow/badge already highlight the modified tile — just make
      // sure it is on screen (28-tile grid scrolls).
      requestAnimationFrame(() => {
        document.querySelector(`.g5-arcade-grid [data-game-id="${cur.gameId}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    });
    let modSeenSig = null; // null = pre-boot (never toast the restored event)
    const syncModChip = () => {
      const state = store.get();
      const cur = state.modifiers?.current;
      const active = cur ? getActiveFor(state, cur.gameId, g58Clock.now()) : null;
      modRow.classList.toggle('g76-show', !!active);
      modDot.classList.toggle('g76-show', !!active);
      if (active) {
        const name = t(active.nameKey);
        modChip.style.setProperty('--modifier-color', active.color);
        modDot.style.setProperty('--modifier-color', active.color);
        modName.textContent = name === active.nameKey ? '' : name;
        modT.textContent = formatMmSs(Math.max(0, active.endsAt - g58Clock.now()));
        modChip.setAttribute('aria-label', t('modifier.hud.open'));
      }
      // §C-SYS4.6: „when an event starts while playing" — toast + jingle
      // exactly once per NEW event (boot restores stay silent).
      const sig = active ? eventSignature(cur) : '';
      if (sig && modSeenSig !== null && sig !== modSeenSig) {
        const gameTitleKey = getMinigame(cur.gameId)?.titleKey;
        ui.toast('modifier.start', {
          game: gameTitleKey ? t(gameTitleKey) : cur.gameId,
          name: t(active.nameKey),
        });
        audio.play('jingle.short');
      }
      modSeenSig = sig;
    };
    const modTimer = setInterval(syncModChip, 1000); // countdown + expiry sweep
    offs.push(store.on('modifierChanged', syncModChip), () => clearInterval(modTimer));
    syncModChip();
  }
  // ══════════════════════════════════════════════════════ end V4/G76 ═══

  return {
    el,
    refresh,
    dispose() {
      for (const off of offs) off?.();
      for (const off of offsG23) off?.(); // V2/G23: badge + sick-chip listeners
      for (const off of offsG52) off?.();
      // V4/G56: floater listener + layer (timers die with the layer removal)
      for (const off of offsG56) off?.();
      for (const f of xpFloaters) clearTimeout(f.timer);
      xpLayer.remove();
      if (visTimer != null) clearInterval(visTimer);
      el.remove();
    },
  };
}
