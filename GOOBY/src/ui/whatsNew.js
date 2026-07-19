// One-time What's-new panels: 2.0 (V2/G30) + 3.0 (V3/G48).
// migrations[1] marks the 2.0 panel unseen for migrated v1 saves;
// migrations[2] marks the 3.0 panel unseen for migrated v1/v2 saves. Fresh
// saves default both flags true because their onboarding covers the basics.
//
// Two layers, mirroring ui/onboarding.js:
//  1. PURE exports up top (predicates + bilingual bullet-tour data) — no
//     DOM/three imports, covered by test/onboarding.test.js.
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

/** V3/G48: the 7-bullet GOOBY 3.0 tour (PLAN3 §E6/G48). */
export const WHATSNEW3_BULLETS = Object.freeze([
  Object.freeze({ icon: '🕹️', key: 'whatsnew3.b1' }), // 27 games + both flagships
  Object.freeze({ icon: '🏃', key: 'whatsnew3.b2' }), // surf travel + polished driving
  Object.freeze({ icon: '📕', key: 'whatsnew3.b3' }), // 28-picture Stickerbuch
  Object.freeze({ icon: '🍫', key: 'whatsnew3.b4' }), // Nutella + Nougatschleuse
  Object.freeze({ icon: '⚙️', key: 'whatsnew3.b5' }), // UI scale + five volume buses
  Object.freeze({ icon: '🎒', key: 'whatsnew3.b6' }), // 42 outfits + back slot
  Object.freeze({ icon: '🎵', key: 'whatsnew3.b7' }), // sampled audio + medleys
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

/**
 * V3/G48: true only for migrated v1/v2 veterans whose tutorial is complete.
 * Fresh saves default whatsNew3Seen true and never qualify (§E0.1-8).
 * @param {object} state save-schema state (§E3)
 * @returns {boolean}
 */
export function shouldShowWhatsNew3(state) {
  const ob = state?.onboarding;
  return ob?.whatsNew3Seen === false && ob?.done === true;
}

// ---------------------------------------------------------------------------
// Browser driver
// ---------------------------------------------------------------------------

/** Poll cadence (ms) — deliberately quicker than dailyBonusPopup's 800 ms so
 * the veteran greeting wins the first quiet-home slot and the daily popup
 * queues behind it (both guard on `.panel-backdrop`). */
const POLL_MS = 400;

// V3/G33 (§B3): mechanical px→rem sweep (÷16) of this injected CSS string —
// exemptions (1px hairlines/999px pills/shadows/@media px) per PLAN3 §B3.
const WN_CSS = `
.g30-wn{text-align:left;}
.g30-wn-title{margin:0 0 0.125rem;font-size:1.5rem;font-weight:800;color:var(--brown);text-align:center;}
.g30-wn-sub{margin:0 0 0.75rem;font-size:0.8438rem;font-weight:700;opacity:.72;text-align:center;line-height:1.35;} /* V4/G-UI: .6→.72 — body-text contrast ≈4.7:1 (WCAG-ish) */
.g30-wn-list{display:flex;flex-direction:column;gap:0.5rem;margin:0 0 0.875rem;max-height:52vh;overflow-y:auto;-webkit-overflow-scrolling:touch;}
.g30-wn-item{display:flex;align-items:flex-start;gap:0.625rem;background:rgba(74,59,54,.05);border-radius:0.875rem;padding:0.5625rem 0.75rem;}
.g30-wn-ico{flex:none;font-size:1.125rem;line-height:1.3;}
.g30-wn-txt{flex:1;min-width:0;font-size:0.8125rem;font-weight:700;color:var(--brown);line-height:1.35;overflow-wrap:break-word;}
/* V3/G48: slightly denser seven-row tour at 320px/130 %, still ≥44px CTA. */
.g30-wn[data-version="3"] .g30-wn-list{gap:0.375rem;max-height:min(54vh,27rem);}
.g30-wn[data-version="3"] .g30-wn-item{padding:0.4375rem 0.625rem;}
.g30-wn[data-version="3"] .g30-wn-txt{font-size:0.7813rem;}
@media (max-width:359px) and (max-height:600px){
  .panel-backdrop-whatsNew .panel{padding:0.75rem 0.875rem max(0.75rem,calc(var(--safe-bottom) + 0.25rem));}
  .g30-wn[data-version="3"] .g30-wn-title{font-size:1.25rem;}
  .g30-wn[data-version="3"] .g30-wn-sub{margin-bottom:0.5rem;font-size:0.75rem;}
  .g30-wn[data-version="3"] .g30-wn-list{max-height:44vh;margin-bottom:0.625rem;}
}
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

  // V3/G48 dev demo: ?whatsnew=1 forces ONLY the 3.0 panel. ?whatsnew=2
  // preserves the old 2.0 demo for regression/layout checks.
  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  if (isDev && typeof location !== 'undefined') {
    const demo = new URLSearchParams(location.search).get('whatsnew');
    if (demo === '1' || demo === '3') {
      store.set('onboarding.whatsNew2Seen', true);
      store.set('onboarding.whatsNew3Seen', false);
      store.set('onboarding.done', true);
    } else if (demo === '2') {
      store.set('onboarding.whatsNew2Seen', false);
      store.set('onboarding.whatsNew3Seen', true);
      store.set('onboarding.done', true);
    }
  }

  ui.registerPanel('whatsNew', {
    /**
     * @param {HTMLElement} el
     * @param {{version?: 2|3}} params
     */
    mount(el, params = {}) {
      const version = params.version === 3 ? 3 : 2;
      const isV3 = version === 3;
      // V3/FIX-D (E20 P1-1): the veteran greeting must not be buried under
      // the boot toast storm (offline summary + achievement/sticker queue) —
      // gate non-critical toasts while the panel is up; ui.releaseToasts()
      // in unmount() flushes them once the player closes the tour.
      ui.holdToasts?.();
      // Persist SEEN on show (not on dismiss): once-only survives backdrop
      // taps and app kills mid-view. flush() beats the autosave debounce so
      // an immediate reload can't resurrect the panel.
      store.set(`onboarding.whatsNew${version}Seen`, true);
      store.flush?.();

      el.innerHTML = `
        <div class="g30-wn" data-version="${version}">
          <h2 class="g30-wn-title">${t(isV3 ? 'whatsnew3.title' : 'whatsnew.title')}</h2>
          <p class="g30-wn-sub">${t(isV3 ? 'whatsnew3.sub' : 'whatsnew.sub')}</p>
          <div class="g30-wn-list"></div>
          <div class="mg-btn-row"></div>
        </div>`;

      const list = el.querySelector('.g30-wn-list');
      for (const bullet of isV3 ? WHATSNEW3_BULLETS : WHATSNEW_BULLETS) {
        const item = document.createElement('div');
        item.className = 'g30-wn-item';
        item.innerHTML = `<span class="g30-wn-ico">${bullet.icon}</span><span class="g30-wn-txt"></span>`;
        item.querySelector('.g30-wn-txt').textContent = t(bullet.key);
        list.appendChild(item);
      }

      const cta = document.createElement('button');
      cta.className = 'btn btn-teal';
      cta.textContent = t(isV3 ? 'whatsnew3.cta' : 'whatsnew.cta');
      cta.addEventListener('click', () => {
        audio.play('ui.go');
        ui.closePanel('whatsNew');
      });
      el.querySelector('.mg-btn-row').appendChild(cta);
    },
    unmount() {
      ui.releaseToasts?.(); // V3/FIX-D (E20 P1-1): flush the held toast queue
    },
  });

  // ---- show-once boot poll (dailyBonusPopup.js pattern) ----
  // Wait for the home scene with no screen/panel up: never fights onboarding
  // (both predicates require done), harness ?open= routing, a running
  // minigame, or the daily-bonus sheet. A direct v1→v3 migration legitimately
  // has BOTH flags false; preserve the v2 contract by showing 2.0 first, then
  // 3.0 after it closes.
  const poll = setInterval(() => {
    const state = store.get();
    const version = shouldShowWhatsNew(state) ? 2 : shouldShowWhatsNew3(state) ? 3 : null;
    const anyPending = state?.onboarding?.whatsNew2Seen === false
      || state?.onboarding?.whatsNew3Seen === false;
    if (!anyPending) {
      clearInterval(poll);
      return;
    }
    if (version == null) return; // mid-tutorial veteran — wait
    if (sceneManager?.currentId?.() !== 'home') return;
    if (ui.activeScreenId?.()) return;
    if (document.querySelector('.panel-backdrop')) return; // another sheet is up
    audio.play('ui.open');
    ui.openPanel('whatsNew', { version });
  }, POLL_MS);
}
