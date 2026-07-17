// Room navigation UI (§C2): edge arrow buttons + a dot indicator at the
// bottom of the home view. Swipe navigation itself lives in homeScene.js
// (canvas gestures); this module is the DOM part. Styles are scoped in an
// injected <style> tag (ui/styles.css is owned by other agents).
//
// V2/G19 (PLAN2 §C2.1/§B6): 5 dots — the 5th (garden) shows a padlock below
// UNLOCKS.GARDEN (L3) and unlocks live on level-up. Navigation to a locked
// garden still calls onNavigate; roomManager.goTo gates it and emits the
// 'gardenLocked' teaser (§B6 — locked surfaces keep the v1 "level N" pattern).

import { t } from '../data/strings.js';
import { ROOMS, UNLOCKS } from '../data/constants.js'; // V2/G19: + UNLOCKS
import { NAV_ORDER } from '../home/roomManager.js'; // V2/G19: 5-room order (§B3)
import { getStore } from '../core/store.js'; // V2/G19: live level for the padlock

const NAV_CSS = `
.room-nav{position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif;}
.rn-arrow{pointer-events:auto;position:absolute;top:50%;transform:translateY(-50%);width:48px;height:60px;
  border:none;border-radius:16px;background:rgba(255,255,255,.82);color:#4A3B36;font-size:24px;font-weight:800;
  box-shadow:0 3px 10px rgba(74,59,54,.16);border-bottom:4px solid rgba(235,217,200,.9);cursor:pointer;
  display:flex;align-items:center;justify-content:center;transition:opacity .2s;}
.rn-arrow:active{transform:translateY(-50%) scale(.94);}
.rn-arrow[disabled]{opacity:0;pointer-events:none;}
.rn-left{left:calc(8px + env(safe-area-inset-left));}
.rn-right{right:calc(8px + env(safe-area-inset-right));}
.rn-dots{pointer-events:auto;position:absolute;left:50%;transform:translateX(-50%);
  bottom:calc(14px + env(safe-area-inset-bottom));display:flex;gap:32px;padding:8px 16px;
  background:rgba(255,255,255,.72);border-radius:999px;box-shadow:0 2px 8px rgba(74,59,54,.14);
  /* F6 (RE3): above the HUD (z 40) so the g5-hud-btns row can't shave the top
     of the dot halos to <44px; the 54px buttons keep ≥48px effective (§D5). */
  z-index:45;}
.rn-dot{position:relative;width:12px;height:12px;border-radius:50%;border:none;padding:0;background:transparent;cursor:pointer;}
/* F3 (§D5 44px targets): 32px dot pitch leaves room for tangent, non-overlapping
   44x44 invisible hit areas per dot (12px dot + 16px halo each side). */
.rn-dot::after{content:'';position:absolute;inset:-16px;}
/* F6 (RE3): the VISUAL dot lives on ::before so the active scale(1.25) never
   scales the 44px ::after hit halo (a scaled halo hit-tested over neighbours,
   shrinking their effective targets to ~38px). */
.rn-dot::before{content:'';position:absolute;inset:0;border-radius:50%;background:#E3D3C2;
  transition:background .2s,transform .2s;}
.rn-dot.on::before{background:#FF7BA9;transform:scale(1.25);}
/* V2/G19 (§B6): padlocked garden dot — lock glyph riding the dot, greyed */
.rn-dot.rn-locked::before{background:#D5CBBE;}
.rn-lock{position:absolute;left:50%;top:50%;transform:translate(-50%,-54%);
  font-size:11px;line-height:1;pointer-events:none;filter:grayscale(1);opacity:.85;}
.rn-dot:not(.rn-locked) .rn-lock{display:none;}
`;

/**
 * Create the room navigation overlay.
 * @param {{onNavigate: (roomId: string) => void}} opts
 *   onNavigate: called with the target room id when an arrow/dot is pressed.
 * @returns {{
 *   mount: (parentEl: HTMLElement) => void,
 *   setActive: (roomId: string) => void,
 *   unmount: () => void,
 * }}
 */
export function createRoomNav({ onNavigate }) {
  /** @type {HTMLElement|null} */
  let rootEl = null;
  /** @type {HTMLStyleElement|null} */
  let styleEl = null;
  /** @type {HTMLButtonElement|null} */
  let leftBtn = null;
  /** @type {HTMLButtonElement|null} */
  let rightBtn = null;
  /** @type {Map<string, HTMLButtonElement>} */
  const dots = new Map();
  let active = ROOMS.DEFAULT;
  /** @type {(() => void)|null} V2/G19: xpChanged unsub (padlock refresh) */
  let unsubLevel = null;

  // V2/G19: live §B6 garden gate — guarded so the module stays importable in
  // tests/before boot (getStore throws until createStore ran).
  function gardenLocked() {
    try {
      return (getStore().get('level') ?? 1) < UNLOCKS.GARDEN;
    } catch {
      return false;
    }
  }

  function refresh() {
    const idx = NAV_ORDER.indexOf(active); // V2/G19: 5-room order
    if (leftBtn) leftBtn.disabled = idx <= 0;
    if (rightBtn) rightBtn.disabled = idx >= NAV_ORDER.length - 1;
    const locked = gardenLocked(); // V2/G19
    for (const [roomId, dot] of dots) {
      dot.classList.toggle('on', roomId === active);
      if (roomId === 'garden') dot.classList.toggle('rn-locked', locked);
    }
  }

  function step(delta) {
    const idx = NAV_ORDER.indexOf(active) + delta;
    if (idx < 0 || idx >= NAV_ORDER.length) return;
    onNavigate(NAV_ORDER[idx]);
  }

  return {
    /** @param {HTMLElement} parentEl typically ctx.ui.el */
    mount(parentEl) {
      styleEl = document.createElement('style');
      styleEl.textContent = NAV_CSS;
      document.head.appendChild(styleEl);

      rootEl = document.createElement('div');
      rootEl.className = 'room-nav';

      leftBtn = document.createElement('button');
      leftBtn.className = 'rn-arrow rn-left';
      leftBtn.textContent = '‹';
      leftBtn.setAttribute('aria-label', t('nav.prevRoom'));
      leftBtn.addEventListener('click', () => step(-1));
      rootEl.appendChild(leftBtn);

      rightBtn = document.createElement('button');
      rightBtn.className = 'rn-arrow rn-right';
      rightBtn.textContent = '›';
      rightBtn.setAttribute('aria-label', t('nav.nextRoom'));
      rightBtn.addEventListener('click', () => step(1));
      rootEl.appendChild(rightBtn);

      const dotsEl = document.createElement('div');
      dotsEl.className = 'rn-dots';
      for (const roomId of NAV_ORDER) {
        const dot = document.createElement('button');
        dot.className = 'rn-dot';
        dot.setAttribute('aria-label', t(`room.${roomId}`));
        dot.addEventListener('click', () => onNavigate(roomId));
        // V2/G19 (§B6): padlock glyph on the garden dot (hidden once unlocked)
        if (roomId === 'garden') {
          const lock = document.createElement('span');
          lock.className = 'rn-lock';
          lock.textContent = '🔒';
          dot.appendChild(lock);
        }
        dotsEl.appendChild(dot);
        dots.set(roomId, dot);
      }
      rootEl.appendChild(dotsEl);

      parentEl.appendChild(rootEl);

      // V2/G19: unlock the padlock live on level-up
      try {
        unsubLevel = getStore().on('xpChanged', refresh);
      } catch { /* store not created (tests) — padlock stays static */ }

      refresh();
    },

    /** Highlight a room without navigating. @param {string} roomId */
    setActive(roomId) {
      active = roomId;
      refresh();
    },

    unmount() {
      rootEl?.remove();
      styleEl?.remove();
      rootEl = null;
      styleEl = null;
      leftBtn = null;
      rightBtn = null;
      dots.clear();
      unsubLevel?.(); // V2/G19
      unsubLevel = null;
    },
  };
}
