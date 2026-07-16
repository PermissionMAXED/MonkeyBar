// Room navigation UI (§C2): edge arrow buttons + a 4-dot indicator at the
// bottom of the home view. Swipe navigation itself lives in homeScene.js
// (canvas gestures); this module is the DOM part. Styles are scoped in an
// injected <style> tag (ui/styles.css is owned by other agents).

import { t } from '../data/strings.js';
import { ROOMS } from '../data/constants.js';

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
  bottom:calc(14px + env(safe-area-inset-bottom));display:flex;gap:10px;padding:8px 12px;
  background:rgba(255,255,255,.72);border-radius:999px;box-shadow:0 2px 8px rgba(74,59,54,.14);}
.rn-dot{width:12px;height:12px;border-radius:50%;border:none;padding:0;background:#E3D3C2;cursor:pointer;
  transition:background .2s,transform .2s;}
.rn-dot.on{background:#FF7BA9;transform:scale(1.25);}
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

  function refresh() {
    const idx = ROOMS.ORDER.indexOf(active);
    if (leftBtn) leftBtn.disabled = idx <= 0;
    if (rightBtn) rightBtn.disabled = idx >= ROOMS.ORDER.length - 1;
    for (const [roomId, dot] of dots) dot.classList.toggle('on', roomId === active);
  }

  function step(delta) {
    const idx = ROOMS.ORDER.indexOf(active) + delta;
    if (idx < 0 || idx >= ROOMS.ORDER.length) return;
    onNavigate(ROOMS.ORDER[idx]);
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
      for (const roomId of ROOMS.ORDER) {
        const dot = document.createElement('button');
        dot.className = 'rn-dot';
        dot.setAttribute('aria-label', t(`room.${roomId}`));
        dot.addEventListener('click', () => onNavigate(roomId));
        dotsEl.appendChild(dot);
        dots.set(roomId, dot);
      }
      rootEl.appendChild(dotsEl);

      parentEl.appendChild(rootEl);
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
    },
  };
}
