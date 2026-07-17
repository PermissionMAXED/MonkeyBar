// "What's new in 2.0" panel (PLAN2 §A3 checklist 12 / §E0.1-6, agent V2/G30).
// One-time bottom sheet for MIGRATED v1 saves only: migrations[1] in
// core/save.js sets `onboarding.whatsNew2Seen = false` for v1 veterans while
// defaultState() ships `true` for fresh saves (their onboarding covers the
// news) — so the pure predicate below is all the gating there is.
//
// Two layers, mirroring ui/onboarding.js:
//  1. PURE exports up top (shouldShowWhatsNew + the 6-bullet §A pillar tour
//     data) — no DOM/three imports, covered by test/onboarding.test.js.
//  2. Browser driver initWhatsNew() — registers the 'whatsNew' panel and
//     polls for a quiet home scene (dailyBonusPopup.js pattern) before
//     showing ONCE. The seen flag persists on mount (not on dismiss), so the
//     panel can never nag twice, however it gets closed (CTA, backdrop tap,
//     app kill mid-view). Veterans resuming an unfinished v1 tutorial see the
//     tutorial first; the panel waits for `onboarding.done`.

import { t } from '../data/strings.js';

// ---------------------------------------------------------------------------
// Pure logic (§A3 checklist 12 — covered by test/onboarding.test.js)
// ---------------------------------------------------------------------------

/**
 * The friendly 6-bullet tour of the 8 §A pillars (icon + strings key; every
 * key has EN+DE entries in data/strings/v2-polish.js).
 */
export const WHATSNEW_BULLETS = Object.freeze([
  Object.freeze({ icon: '🕹️', key: 'whatsnew.b1' }), // ① minigame explosion 12 → 21
  Object.freeze({ icon: '🌱', key: 'whatsnew.b2' }), // ② garden / 5th space
  Object.freeze({ icon: '🤒', key: 'whatsnew.b3' }), // ③ pet sim + ⑥ vet destination
  Object.freeze({ icon: '📋', key: 'whatsnew.b4' }), // ④ quests / album / achievements / L40
  Object.freeze({ icon: '🎀', key: 'whatsnew.b5' }), // ⑤ content explosion + skins
  Object.freeze({ icon: '🌙', key: 'whatsnew.b6' }), // ⑦ day/night + weather, ⑧ stats + photo
]);

/**
 * Should the one-time panel show for this save state? True only for migrated
 * v1 saves (flag explicitly false — §E0.1-6) that are not mid-tutorial.
 * Fresh saves default the flag to true and never qualify.
 * @param {object} state save-schema state (§E3)
 * @returns {boolean}
 */
export function shouldShowWhatsNew(state) {
  const ob = state?.onboarding;
  return ob?.whatsNew2Seen === false && ob?.done === true;
}

// ---------------------------------------------------------------------------
// Browser driver
// ---------------------------------------------------------------------------

/** Poll cadence (ms) — deliberately quicker than dailyBonusPopup's 800 ms so
 * the veteran greeting wins the first quiet-home slot and the daily popup
 * queues behind it (both guard on `.panel-backdrop`). */
const POLL_MS = 400;

const WN_CSS = `
.g30-wn{text-align:left;}
.g30-wn-title{margin:0 0 2px;font-size:24px;font-weight:800;color:var(--brown);text-align:center;}
.g30-wn-sub{margin:0 0 12px;font-size:13.5px;font-weight:700;opacity:.6;text-align:center;line-height:1.35;}
.g30-wn-list{display:flex;flex-direction:column;gap:8px;margin:0 0 14px;max-height:52vh;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g30-wn-item{display:flex;align-items:flex-start;gap:10px;background:rgba(74,59,54,.05);border-radius:14px;padding:9px 12px;}
.g30-wn-ico{flex:none;font-size:18px;line-height:1.3;}
.g30-wn-txt{flex:1;min-width:0;font-size:13px;font-weight:700;color:var(--brown);line-height:1.35;overflow-wrap:break-word;}
`;

/**
 * Register the 'whatsNew' panel + the show-once boot poll. Called once from
 * the marked V2/G30 block in main.js (after the daily-bonus boot lines).
 * @param {{store: object, ui: object, audio: object,
 *   sceneManager?: {currentId: () => string|null}}} deps
 */
export function initWhatsNew({ store, ui, audio, sceneManager }) {
  if (!document.querySelector('style[data-owner="g30-whatsnew"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g30-whatsnew';
    style.textContent = WN_CSS;
    document.head.appendChild(style);
  }

  // Dev harness extension (§E9 spirit, dev only): ?whatsnew=1 flips the seen
  // flag back off so the panel demos on any save (layout-matrix surface).
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  if (isDev && typeof location !== 'undefined') {
    if (new URLSearchParams(location.search).get('whatsnew') === '1') {
      store.set('onboarding.whatsNew2Seen', false);
      store.set('onboarding.done', true);
    }
  }

  ui.registerPanel('whatsNew', {
    /** @param {HTMLElement} el */
    mount(el) {
      // Persist SEEN on show (not on dismiss): once-only survives backdrop
      // taps and app kills mid-view. flush() beats the autosave debounce so
      // an immediate reload can't resurrect the panel.
      store.set('onboarding.whatsNew2Seen', true);
      store.flush?.();

      el.innerHTML = `
        <div class="g30-wn">
          <h2 class="g30-wn-title">${t('whatsnew.title')}</h2>
          <p class="g30-wn-sub">${t('whatsnew.sub')}</p>
          <div class="g30-wn-list"></div>
          <div class="mg-btn-row"></div>
        </div>`;

      const list = el.querySelector('.g30-wn-list');
      for (const bullet of WHATSNEW_BULLETS) {
        const item = document.createElement('div');
        item.className = 'g30-wn-item';
        item.innerHTML = `<span class="g30-wn-ico">${bullet.icon}</span><span class="g30-wn-txt"></span>`;
        item.querySelector('.g30-wn-txt').textContent = t(bullet.key);
        list.appendChild(item);
      }

      const cta = document.createElement('button');
      cta.className = 'btn btn-teal';
      cta.textContent = t('whatsnew.cta');
      cta.addEventListener('click', () => {
        audio.play('ui.go');
        ui.closePanel('whatsNew');
      });
      el.querySelector('.mg-btn-row').appendChild(cta);
    },
    unmount() {},
  });

  // ---- show-once boot poll (dailyBonusPopup.js pattern) ----
  // Wait for the home scene with no screen/panel up: never fights onboarding
  // (shouldShowWhatsNew requires done), harness ?open= routing, a running
  // minigame, or the daily-bonus sheet.
  const poll = setInterval(() => {
    // The flag only ever goes false → true, so once it is not-false this
    // session can never show the panel — stop polling (fresh saves clear on
    // the first tick; unseen veterans keep waiting for a quiet home).
    if (store.get('onboarding.whatsNew2Seen') !== false) {
      clearInterval(poll);
      return;
    }
    if (!shouldShowWhatsNew(store.get())) return; // mid-tutorial veteran — wait
    if (sceneManager?.currentId?.() !== 'home') return;
    if (ui.activeScreenId?.()) return;
    if (document.querySelector('.panel-backdrop')) return; // another sheet is up
    clearInterval(poll);
    audio.play('ui.open');
    ui.openPanel('whatsNew');
  }, POLL_MS);
}
