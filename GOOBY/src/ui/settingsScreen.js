// Settings screen 3.0 (V3/G33 — PLAN3 §C2.1/§C1.1/§B4): reorganized sections —
// General (language, notifications), Audio (5 volume slider rows §C2.1 with
// quick-mute toggles on SFX/Musik + the Haptik toggle), Display (UI-Größe
// 4-stop segment with live „Aa" preview §C1.1), the hidden dev gate (5× tap
// on the language „Auto" segment §B4/§C4.1) and the „Entwickler" row that
// appears once settings.devUnlocked. Reset-save (triple confirm) + version
// footer unchanged from G6/G14.
//
// This module also owns the UI-scale DOM appliers (§B3): applyUiScale /
// initUiScale (boot + live via the store, emits 'uiScaleChanged' §B10) and
// the §B9 fake-notch override (setFakeNotch — dev panel / ?notch=1).

import { t, getLang, setLang } from '../data/strings.js';
import { icon } from './icons.js';
import * as save from '../core/save.js';
import * as notifications from '../core/notifications.js';
import { maybeSoftAsk } from './permissionPrompt.js';
import audio from '../audio/audio.js'; // G14: audio toggles
import pkg from '../../package.json';
import {
  UI_SCALES,
  normalizeUiScale,
  rootFontPx,
  VOLUME_ROWS,
  normalizeVolume,
  volumesWithDefaults,
  createDevGate,
  FAKE_NOTCH,
} from './settings.logic.js';
// V3/G33 (§E0.1-11): local fallback tables until G34's strings.js spread lands.
import { EN as UX_EN, DE as UX_DE } from '../data/strings/v3-ux.js';

/** Language options (§A ruling: bilingual EN+DE, auto from navigator). */
const LANGS = ['auto', 'en', 'de'];

/** `ui.slider` drag-tick throttle (§C3.1/§D3.5: 80 ms). */
const SLIDER_TICK_MS = 80;

/**
 * t() with a graceful fallback to this agent's v3-ux module while G34's
 * strings.js spread hasn't landed (§E0.1-11 same-wave degradation).
 * @param {string} key @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
function tx(key, vars) {
  const viaT = t(key, vars);
  if (viaT !== key) return viaT;
  let str = (getLang() === 'de' ? UX_DE : UX_EN)[key];
  if (str == null) return key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
  return str;
}

// ---------------------------------------------------------------------------
// V3/G33 — UI scale appliers (§B3) + fake notch (§B9)
// ---------------------------------------------------------------------------

/**
 * Apply a uiScale step to the document root: font-size = 16 · scale/100 px
 * plus the `data-ui-scale` attribute (later agents' CSS keys off it).
 * @param {number} scale 85|100|115|130 (illegal → 100)
 * @returns {number} the applied (normalized) scale
 */
export function applyUiScale(scale) {
  const s = normalizeUiScale(scale);
  if (typeof document !== 'undefined') {
    document.documentElement.style.fontSize = `${rootFontPx(s)}px`;
    document.documentElement.dataset.uiScale = String(s);
  }
  return s;
}

/**
 * Boot-apply the persisted uiScale and follow the store live (§B3: applied at
 * boot and on change, no reload). Emits the runtime-only 'uiScaleChanged'
 * store event (§B10) whenever the applied scale actually changes.
 * @param {{store: object}} deps
 */
export function initUiScale({ store }) {
  let applied = applyUiScale(store.get('settings.uiScale'));
  store.on('change', () => {
    const next = normalizeUiScale(store.get('settings.uiScale'));
    if (next === applied) return;
    applied = applyUiScale(next);
    store.emit?.('uiScaleChanged', { scale: applied });
  });
}

let fakeNotchOn = false;

/**
 * §B9 fake-notch toggle: force the root safe-area vars to the iPhone-14-Pro
 * values (59/34 px) so the §C1.4 40-combo matrix runs in any browser.
 * @param {boolean} on
 * @returns {boolean} the new state
 */
export function setFakeNotch(on) {
  fakeNotchOn = !!on;
  if (typeof document === 'undefined') return fakeNotchOn;
  const st = document.documentElement.style;
  if (fakeNotchOn) {
    st.setProperty('--safe-top', FAKE_NOTCH.top);
    st.setProperty('--safe-bottom', FAKE_NOTCH.bottom);
    st.setProperty('--safe-left', FAKE_NOTCH.left);
    st.setProperty('--safe-right', FAKE_NOTCH.right);
  } else {
    st.removeProperty('--safe-top');
    st.removeProperty('--safe-bottom');
    st.removeProperty('--safe-left');
    st.removeProperty('--safe-right');
  }
  return fakeNotchOn;
}

/** @returns {boolean} current fake-notch state (dev panel toggle sync) */
export function getFakeNotch() {
  return fakeNotchOn;
}

/**
 * Wipe the save and reload for the reset flows (settings §G G6 triple-confirm
 * + dev panel §C4.2 #11). A bare `save.clear(); location.reload()` loses the
 * race against the store's pagehide/visibilitychange flush (§E2), which
 * re-persists the live state during the reload — so clear again AFTER those
 * flush listeners ran (same-target listeners fire in registration order, and
 * these register long after the store's boot-time ones).
 */
export function resetSaveAndReload() {
  save.clear();
  const wipe = () => save.clear();
  window.addEventListener('pagehide', wipe);
  document.addEventListener('visibilitychange', wipe);
  location.reload();
}

/**
 * V3/FIX-D (E14 P1-2): persist an IMPORTED save and reload — the dev panel's
 * save-import sibling of resetSaveAndReload above. A bare
 * `save.persist(parsed); location.reload()` loses the same §E2 race: the
 * store's pagehide/visibilitychange flush re-persists the live (pre-import)
 * state during the reload. Re-persist the imported state AFTER those flush
 * listeners ran (same registration-order guarantee as the reset fix).
 * @param {object} state parsed save-schema state (load() migrates/validates
 *   whatever this writes on the next boot)
 */
export function importSaveAndReload(state) {
  save.persist(state);
  const rewrite = () => save.persist(state);
  window.addEventListener('pagehide', rewrite);
  document.addEventListener('visibilitychange', rewrite);
  location.reload();
}

// ---------------------------------------------------------------------------

/** Bespoke gear-wrench icon for the Entwickler row (§B4 — icons.js is a
 * shared append-only file; V2/G23 precedent keeps bespoke shapes local). */
const WRENCH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M21.6 6.6a5.4 5.4 0 0 1-7.3 6.5L7.4 20a2.3 2.3 0 0 1-3.3-3.3l6.9-6.9a5.4 5.4 0 0 1 6.5-7.3L14 6l.7 3.3L18 10l3.6-3.4z"/></svg>';

// V3/FIX-D (E9 P1): toggle hit-area floors. styles.css gives .g14-toggle an
// invisible ::after halo of exactly max(44px, …) — integer hit-test sampling
// plus row overlap in the dev panel measured 34–42 px effective. Raise the
// floor to 48 px on BOTH axes (visuals untouched — the halo is invisible)
// for the settings + dev-panel scopes; the dev panel additionally reserves
// ≥50 px row height so stacked toggles can't shave each other's halos.
// Injected from both mounts (either screen can open first via ?open=…).
const FIXD_TOGGLE_CSS = `
.settings-wrap .g14-toggle::after,.g33-dev-wrap .g14-toggle::after{
  inset:calc((1.875rem - max(48px, 3rem)) / 2) calc((3.25rem - max(48px, 3.75rem)) / 2);
}
`;

/** Inject the shared ≥44px toggle-halo override once (idempotent). */
export function ensureToggleHitAreaCss() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-owner="fixd-toggle-halo"]')) return;
  const style = document.createElement('style');
  style.dataset.owner = 'fixd-toggle-halo';
  style.textContent = FIXD_TOGGLE_CSS;
  document.head.appendChild(style);
}

/**
 * Human status key for the saved notifications setting (§E3).
 * @param {string} setting 'unasked'|'granted'|'denied'|'later:<ts>'
 * @returns {string} strings.js key
 */
function notifStatusKey(setting) {
  if (setting === 'granted') return 'settings.notif.granted';
  if (setting === 'denied') return 'settings.notif.denied';
  if (typeof setting === 'string' && setting.startsWith('later:')) return 'settings.notif.later';
  return 'settings.notif.unasked';
}

/**
 * Create the settings screen module (§E6 UiModule shape). Registered as
 * 'settings' from main.js's marked G6 block.
 * @param {{store: object, ui: object}} deps
 * @returns {{mount: (el: HTMLElement) => void, unmount: () => void}}
 */
export function createSettingsScreen({ store, ui }) {
  /** @type {HTMLElement|null} */
  let root = null;
  /** Reset double-confirm progress: 0 = idle, 1 = one confirm done. */
  let resetStep = 0;
  /** F3: mount-scoped store subscription (live permission-label refresh). */
  let offChange = null;
  /** V3/G33: dev-gate tap counter (§B4) — mount-scoped. */
  const devGate = createDevGate();
  /** V3/G33: mount-scoped ui.slider tick throttle. */
  let lastSliderTick = 0;

  function render() {
    const el = root;
    if (!el) return;
    const lang = store.get('settings.lang') ?? 'auto';
    const notifSetting = store.get('settings.notifications');
    const granted = notifSetting === 'granted';
    const volumes = volumesWithDefaults(store.get('settings.volumes'));
    const uiScale = normalizeUiScale(store.get('settings.uiScale'));
    const devUnlocked = store.get('settings.devUnlocked') === true;

    el.innerHTML = `
      <div class="settings-wrap">
        <div class="settings-head">
          <button class="btn btn-ghost btn-round settings-back" aria-label="${t('ui.back')}">${icon('arrowLeft', 22)}</button>
          <h1 class="settings-title">${icon('gear', 26)} ${t('settings.title')}</h1>
        </div>
        <div class="settings-section">${tx('settings.section.general')}</div>
        <div class="card settings-card">
          <div class="settings-row">
            <span class="settings-label">${t('settings.language')}</span>
            <span class="seg" role="group">
              ${LANGS.map((l) => `<button class="seg-btn ${l === lang ? 'seg-on' : ''}" data-lang="${l}">${t(`settings.lang.${l}`)}</button>`).join('')}
            </span>
          </div>
          <div class="settings-row">
            <span class="settings-label">${icon('bell', 18)} ${t('settings.notifications')}</span>
            <span class="settings-value">
              <span class="settings-status">${t(notifStatusKey(notifSetting))}</span>
              <button class="btn ${granted ? 'btn-ghost' : 'btn-teal'} settings-notif-btn">
                ${granted ? t('settings.notif.disable') : t('settings.notif.enable')}
              </button>
            </span>
          </div>
        </div>
        <div class="settings-section">${tx('settings.section.audio')}</div>
        <div class="card settings-card">
          ${VOLUME_ROWS.map(({ key, labelKey, icon: ic, mute }) => {
            const muted = mute ? store.get(`settings.${mute}`) === false : false;
            return `
          <div class="settings-row g33-vol-row ${muted ? 'g33-vol-muted' : ''}" data-vol-row="${key}">
            <span class="settings-label">${icon(ic, 18)} ${tx(labelKey)}</span>
            <span class="g33-vol-controls">
              <input type="range" class="g33-vol-slider" min="0" max="100" step="5"
                style="--g47-fill:${volumes[key]}%" ${''/* V3/G47: sprite fill hook (§C11.2) */}
                value="${volumes[key]}" data-vol="${key}" aria-label="${tx(labelKey)}">
              <span class="g33-vol-readout">${volumes[key]}%</span>
              ${mute ? `<button class="g14-toggle ${!muted ? 'g14-on' : ''}"
                data-audio-toggle="${mute}" role="switch" aria-checked="${!muted}"
                aria-label="${tx('settings.vol.mute', { label: tx(labelKey) })}"><span class="g14-knob"></span></button>` : ''}
            </span>
          </div>`;
          }).join('')}
          <div class="settings-row">
            <span class="settings-label">${icon('spring', 18)} ${t('settings.haptics')}</span>
            <button class="g14-toggle ${store.get('settings.haptics') !== false ? 'g14-on' : ''}"
              data-audio-toggle="haptics" role="switch"
              aria-checked="${store.get('settings.haptics') !== false}"
              aria-label="${t('settings.haptics')}"><span class="g14-knob"></span></button>
          </div>
        </div>
        <div class="settings-section">${tx('settings.section.display')}</div>
        <div class="card settings-card">
          <div class="settings-row">
            <span class="settings-label"><span class="g33-scale-aa">Aa</span> ${tx('settings.uiScale')}</span>
            <span class="seg g33-scale-seg" role="group">
              ${UI_SCALES.map((s) => `<button class="seg-btn ${s === uiScale ? 'seg-on' : ''}" data-uiscale="${s}">${s}&hairsp;%</button>`).join('')}
            </span>
          </div>
        </div>
        ${devUnlocked ? `
        <div class="card settings-card">
          <div class="settings-row g33-dev-row">
            <span class="settings-label">${WRENCH_SVG} ${tx('settings.devRow')}</span>
            <button class="btn btn-ghost g33-dev-open">${tx('settings.devOpen')}</button>
          </div>
        </div>` : ''}
        <div class="card settings-card">
          <div class="settings-row settings-danger">
            <button class="btn settings-reset-btn">${resetLabel()}</button>
          </div>
        </div>
        <div class="settings-footer">${t('settings.version', { v: pkg.version })}</div>
      </div>`;

    // G14: toggle handlers — flip the persisted setting; audio.js follows the
    // store live (§D6/§C2.3 mute persistence), so no direct bus pokes.
    for (const btn of el.querySelectorAll('[data-audio-toggle]')) {
      btn.addEventListener('click', () => {
        const key = btn.dataset.audioToggle;
        const next = store.get(`settings.${key}`) === false;
        store.set(`settings.${key}`, next);
        store.flush(); // sync events so audio.js sees the new setting NOW
        // V3/G33 (§D3.5): real toggle samples replace the old ui.pick blip.
        audio.play(next ? 'ui.toggleOn' : 'ui.toggleOff');
        render();
      });
    }

    // V3/G33 (§C2.1/§C2.2): volume sliders — live store write-through while
    // dragging (G32's audio.js store-follow applies the gains); throttled
    // ui.slider ticks; preview blip on RELEASE via G32's audio.previewBus
    // (feature-detected — §E0.1-11).
    for (const slider of el.querySelectorAll('.g33-vol-slider')) {
      const key = slider.dataset.vol;
      const row = slider.closest('.g33-vol-row');
      const readout = row.querySelector('.g33-vol-readout');
      slider.addEventListener('input', () => {
        const v = normalizeVolume(slider.value, key);
        slider.style.setProperty('--g47-fill', `${v}%`); // V3/G47: sprite fill hook (§C11.2)
        readout.textContent = `${v}%`;
        store.update((state) => {
          state.settings.volumes = state.settings.volumes ?? {};
          state.settings.volumes[key] = v;
        });
        store.flush(); // live gain while dragging (§B2.2 store-follow)
        const nowTick = Date.now();
        if (nowTick - lastSliderTick >= SLIDER_TICK_MS) {
          lastSliderTick = nowTick;
          audio.play('ui.slider');
        }
      });
      slider.addEventListener('change', () => {
        store.flush();
        if (typeof audio.previewBus === 'function') {
          audio.previewBus(key); // §C2.2 per-bus preview blip (G32)
        } else {
          audio.play('ui.pick'); // G32 not merged yet — plain confirmation
        }
      });
    }

    // V3/G33 (§C1.1): UI-Größe 4-stop segment — instant apply via the store
    // (initUiScale's change-follower sets the root font-size and emits
    // 'uiScaleChanged'); persists; NO toast (the whole UI visibly changes).
    for (const btn of el.querySelectorAll('[data-uiscale]')) {
      btn.addEventListener('click', () => {
        const s = normalizeUiScale(Number(btn.dataset.uiscale));
        store.set('settings.uiScale', s);
        store.flush();
        audio.play('ui.pick');
        render();
      });
    }

    // V3/G33 (§B4/§C4.1): hidden dev gate — 5× tap on the language „Auto"
    // segment within the 4 s rolling window; ANY other tap resets the chain
    // (capture-phase listener on the screen root), as does 2 s of inactivity
    // (inside devGate). Unlock persists; re-tapping 5× toasts „bereits aktiv".
    for (const btn of el.querySelectorAll('.seg-btn[data-lang]')) {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.lang;
        audio.play('ui.pick'); // V3/FIX-D (E19): segment cue (incl. gate taps)
        if (chosen === 'auto') {
          if (devGate.tap(Date.now())) {
            if (store.get('settings.devUnlocked') === true) {
              ui.toast('dev.already');
            } else {
              store.set('settings.devUnlocked', true);
              store.flush();
              ui.toast('dev.unlocked');
              audio.play('jingle.achievement');
            }
          }
        }
        store.set('settings.lang', chosen);
        setLang(chosen);
        render(); // live switch (§A)
      });
    }

    // V3/G33: dev-panel entry (rendered only when unlocked — §B4).
    el.querySelector('.g33-dev-open')?.addEventListener('click', () => {
      audio.play('ui.tap');
      ui.showScreen('devPanel');
    });

    el.querySelector('.settings-back').addEventListener('click', () => {
      audio.play('ui.close'); // V3/FIX-D (E19)
      ui.closeAll();
    });

    el.querySelector('.settings-notif-btn').addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      onNotifToggle();
    });

    const resetBtn = el.querySelector('.settings-reset-btn');
    resetBtn.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      // Double confirm (§G G6): two explicit extra taps, each relabeled.
      resetStep += 1;
      if (resetStep >= 3) {
        resetSaveAndReload(); // V3/G33: survives the §E2 pagehide flush
        return;
      }
      render();
      // Brief tap-guard so a rapid double-tap can't blow through a confirm...
      const fresh = el.querySelector('.settings-reset-btn');
      if (fresh) {
        fresh.disabled = true;
        setTimeout(() => {
          fresh.disabled = false;
        }, 700);
      }
      // ...and walking away resets the confirmation chain entirely.
      setTimeout(() => {
        if (resetStep > 0) {
          resetStep = 0;
          render();
        }
      }, 6000);
    });

    function resetLabel() {
      if (resetStep === 1) return t('settings.reset.confirm1');
      if (resetStep >= 2) return t('settings.reset.confirm2');
      return t('settings.reset');
    }
  }

  async function onNotifToggle() {
    const granted = store.get('settings.notifications') === 'granted';
    if (granted) {
      store.set('settings.notifications', 'denied');
      notifications.cancelAll();
      render();
      return;
    }
    const osPerm = await notifications.getPermission();
    if (osPerm === 'granted') {
      // OS already allows — only the app-level setting was off.
      store.set('settings.notifications', 'granted');
      render();
      return;
    }
    if (osPerm === 'denied') {
      ui.toast('settings.notif.blocked');
      return;
    }
    // Deep-link back into the §C7 soft-ask (forced — the user asked). The
    // status label re-renders via the mount-scoped subscription below (F3:
    // a one-shot 'change' listener got eaten by the 1 Hz stat tick before
    // the user answered, leaving a stale label).
    maybeSoftAsk({ store, ui }, { force: true });
  }

  /** V3/G33 (§B4): capture-phase reset — any tap that is NOT the „Auto"
   * segment resets the dev-gate chain. */
  function onAnyPointerDown(e) {
    const target = /** @type {HTMLElement} */ (e.target);
    if (!target?.closest?.('.seg-btn[data-lang="auto"]')) devGate.reset();
  }

  return {
    /** @param {HTMLElement} el */
    mount(el) {
      root = el;
      resetStep = 0;
      ensureToggleHitAreaCss(); // V3/FIX-D (E9 P1)
      render();
      el.addEventListener('pointerdown', onAnyPointerDown, true); // V3/G33 §B4
      // F3: re-render from LIVE permission state whenever it changes while
      // the screen is open (the soft-ask panel / OS prompt writes the store).
      let lastNotif = store.get('settings.notifications');
      offChange = store.on('change', () => {
        const cur = store.get('settings.notifications');
        if (cur !== lastNotif) {
          lastNotif = cur;
          render();
        }
      });
    },
    unmount() {
      root?.removeEventListener('pointerdown', onAnyPointerDown, true); // V3/G33
      offChange?.();
      offChange = null;
      root = null;
    },
  };
}
