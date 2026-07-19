// Settings screen 4.0 (V4/G58 — PLAN4 §B9/§C-SYS12.1–12.3, on top of V3/G33's
// screen): two-level IA — the 8-row main list (Sprache · Benachrichtigungen ·
// Anzeige → · Audio → · Radio · Codes → · Credits → · Entwickler) plus §E6
// subscreen panels 'settingsDisplay' (UI-Größe + Gyro-Parallax §C-SYS8) and
// 'settingsAudio' (the 5 v3 volume sliders + mute toggles + Haptik + the
// „Musik & Radio →" link §C-SYS1.5 + the §G3.3 Steuerung invert group), each
// with a back chevron top-left and the ui.close sound. Row 5 opens G52's
// radioPanel directly; row 6 opens G58's codes panel (ui/codesScreen.js);
// row 7 renders only while a credits screen id is registered (§E0.1-11 —
// G81 lands it in wave 4); row 8 renders only when settings.devUnlocked.
// The 5×-tap dev gate stays on the language „Auto" segment (§B4-v3), the
// reset-save triple confirm + version footer stay on the main list, and the
// §C-SYS12.2 one-time „Neu sortiert!" hint chip is session-only.
//
// This module also owns the UI-scale DOM appliers (§B3-v3): applyUiScale /
// initUiScale (boot + live via the store, emits 'uiScaleChanged' §B10) and
// the §B9-v3 fake-notch override (setFakeNotch — dev panel / ?notch=1).

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
import { mainRows } from './settingsIa.logic.js';
import { registerCodesUi } from './codesScreen.js';
// V3/G33 (§E0.1-11): local fallback tables until G34's strings.js spread lands.
import { EN as UX_EN, DE as UX_DE } from '../data/strings/v3-ux.js';
// V4/G58 (§E0.1-11): local fallbacks until G53's strings.js spread lands.
import { EN as V4S_EN, DE as V4S_DE } from '../data/strings/v4-settings.js';
import { EN as V4C_EN, DE as V4C_DE } from '../data/strings/v4-controls.js';

// V4/G58: G60's gyro module — resolved at transform time; empty map while the
// file doesn't exist (§E0.1-11 — do not convert to a static import). Both the
// agreed systems/ path and the §B8 home/ path are probed.
const gyroModules = import.meta.glob(['../systems/gyroParallax.js', '../home/parallax.js']);

/** Language options (§A ruling: bilingual EN+DE, auto from navigator). */
const LANGS = ['auto', 'en', 'de'];

/** `ui.slider` drag-tick throttle (§C3.1/§D3.5: 80 ms). */
const SLIDER_TICK_MS = 80;

/** §C-SYS12.2: session-only „Neu sortiert!" hint chip latch (not persisted). */
let v4HintShown = false;

/** @type {object|null} G60's gyro module once probed (null = not built yet) */
let gyroMod = null;
let gyroProbe = null;

/** Preload the gyro module so the toggle handler can call enableGyro()
 * synchronously inside the user gesture (G60's permission contract). */
function probeGyroModule() {
  if (gyroProbe) return gyroProbe;
  const loaders = Object.values(gyroModules);
  gyroProbe = (async () => {
    for (const load of loaders) {
      try {
        const mod = await load();
        if (typeof (mod.enableGyro ?? mod.requestEnable) === 'function') {
          gyroMod = mod;
          return mod;
        }
      } catch (err) {
        console.warn('[settings] gyro module load failed:', err);
      }
    }
    return null;
  })();
  return gyroProbe;
}

/**
 * t() with a graceful fallback to this agent's modules while the strings.js
 * spreads haven't landed (§E0.1-11 same-wave degradation). Lookup order:
 * strings.js → v3-ux (G33) → v4-settings → v4-controls (G58).
 * @param {string} key @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
function tx(key, vars) {
  const viaT = t(key, vars);
  if (viaT !== key) return viaT;
  const de = getLang() === 'de';
  let str = (de ? UX_DE : UX_EN)[key] ?? (de ? V4S_DE : V4S_EN)[key] ?? (de ? V4C_DE : V4C_EN)[key];
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
// V4/G58: the .g58-sub scope extends the same floor to the new subscreens.
const FIXD_TOGGLE_CSS = `
.settings-wrap .g14-toggle::after,.g33-dev-wrap .g14-toggle::after,.g58-sub .g14-toggle::after{
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

// ---------------------------------------------------------------------------
// V4/G58 — subscreen panels (§B9: §E6 panels with back chevron + ui.close)
// ---------------------------------------------------------------------------

/** Shared subscreen header (back chevron top-left per §B9). */
function subHead(ui, panelId, titleHtml) {
  return `
    <div class="g58-sub-head">
      <button class="btn btn-ghost btn-round g58-sub-back" aria-label="${t('ui.back')}">${icon('arrowLeft', 22)}</button>
      <h2 class="g58-sub-title">${titleHtml}</h2>
    </div>`;
}

function wireSubBack(el, ui, panelId) {
  el.querySelector('.g58-sub-back')?.addEventListener('click', () => {
    audio.play('ui.close'); // §B9 back sound
    ui.closePanel(panelId);
  });
}

/**
 * 'settingsDisplay' panel (§C-SYS12.1 row 3): UI-Größe 4-stop segment
 * (unchanged v3 behavior) + the §C-SYS8.1 Gyro-Parallax toggle with the
 * in-gesture permission flow (§C-SYS8.2, via G60's preloaded module).
 * @param {{store: object, ui: object}} deps
 * @returns {{mount: (el: HTMLElement) => void, unmount: () => void}}
 */
export function createDisplayPanel({ store, ui }) {
  /** @type {HTMLElement|null} */
  let root = null;

  function render() {
    const el = root;
    if (!el) return;
    const uiScale = normalizeUiScale(store.get('settings.uiScale'));
    const gyroOn = store.get('settings.gyro') === true;
    el.innerHTML = `
      <div class="g58-sub" data-sub="display">
        ${subHead(ui, 'settingsDisplay', `<span class="g33-scale-aa">Aa</span> ${tx('settings.sub.display')}`)}
        <div class="card settings-card">
          <div class="settings-row">
            <span class="settings-label">${tx('settings.uiScale')}</span>
            <span class="seg g33-scale-seg" role="group">
              ${UI_SCALES.map((s) => `<button class="seg-btn ${s === uiScale ? 'seg-on' : ''}" data-uiscale="${s}">${s}&hairsp;%</button>`).join('')}
            </span>
          </div>
          <div class="settings-row g58-gyro-row">
            <span class="settings-label g58-two-line">📱 ${tx('settings.gyro')}
              <small class="g58-subline">${tx('settings.gyro.sub')}</small></span>
            <button class="g14-toggle ${gyroOn ? 'g14-on' : ''}" data-act="gyro" role="switch"
              aria-checked="${gyroOn}" aria-label="${tx('settings.gyro')}"><span class="g14-knob"></span></button>
          </div>
        </div>
      </div>`;

    wireSubBack(el, ui, 'settingsDisplay');

    for (const btn of el.querySelectorAll('[data-uiscale]')) {
      btn.addEventListener('click', () => {
        const s = normalizeUiScale(Number(btn.dataset.uiscale));
        store.set('settings.uiScale', s);
        store.flush();
        audio.play('ui.pick');
        render();
      });
    }

    // §C-SYS8.2 permission flow — INSIDE the tap handler (user gesture).
    // G60's enableGyro() is called synchronously off the preloaded module so
    // the iOS requestPermission call keeps the user activation; while G60 is
    // unmerged an inline flow with the same §C-SYS8.2 semantics fills in.
    el.querySelector('[data-act="gyro"]')?.addEventListener('click', async () => {
      if (store.get('settings.gyro') === true) {
        store.set('settings.gyro', false);
        store.flush();
        try {
          gyroMod?.disableGyro?.();
        } catch { /* engine detach is best-effort */ }
        audio.play('ui.toggleOff');
        render();
        return;
      }
      const hadOrientation = typeof globalThis.DeviceOrientationEvent !== 'undefined';
      let ok;
      if (gyroMod) {
        ok = await (gyroMod.enableGyro ?? gyroMod.requestEnable)();
      } else {
        // §E0.1-11 fallback (same §C-SYS8.2 decision table, no engine yet).
        const ctor = globalThis.DeviceOrientationEvent;
        if (typeof ctor?.requestPermission === 'function') {
          try {
            ok = (await ctor.requestPermission()) === 'granted';
          } catch {
            ok = false;
          }
        } else {
          ok = true; // non-iOS with event OR desktop pointer fallback (§C-SYS8.4)
        }
      }
      if (!ok) {
        ui.toast(tx('settings.gyro.denied')); // snaps back OFF (§C-SYS8.2)
        audio.play('ui.error');
        render();
        return;
      }
      store.set('settings.gyro', true);
      store.flush();
      try {
        gyroMod?.syncGyroSetting?.(true);
      } catch { /* best-effort */ }
      audio.play('ui.toggleOn');
      if (!hadOrientation) ui.toast(tx('settings.gyro.pointer')); // §C-SYS8.4 note
      render();
    });
  }

  return {
    /** @param {HTMLElement} el */
    mount(el) {
      root = el;
      ensureToggleHitAreaCss();
      probeGyroModule().then(() => {}); // warm the module for the tap handler
      render();
    },
    unmount() {
      root = null;
    },
  };
}

/**
 * 'settingsAudio' panel (§C-SYS12.1 row 4): the 5 v3 volume slider rows +
 * quick-mute toggles + Haptik (unchanged), the „Musik & Radio →" link to
 * G52's per-track subscreen (§C-SYS1.5) and the §G3.3 „Steuerung" invert
 * group under the sliders.
 * @param {{store: object, ui: object}} deps
 * @returns {{mount: (el: HTMLElement) => void, unmount: () => void}}
 */
export function createAudioPanel({ store, ui }) {
  /** @type {HTMLElement|null} */
  let root = null;
  let lastSliderTick = 0;

  function render() {
    const el = root;
    if (!el) return;
    const volumes = volumesWithDefaults(store.get('settings.volumes'));
    const controls = store.get('settings.controls');
    const invertX = controls?.invertX === true;
    const invertY = controls?.invertY === true;
    el.innerHTML = `
      <div class="g58-sub" data-sub="audio">
        ${subHead(ui, 'settingsAudio', `${icon('music', 22)} ${tx('settings.sub.audio')}`)}
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
          <div class="settings-row g58-nav-row" data-nav="tracks" role="button" tabindex="0">
            <span class="settings-label">🎵 ${tx('settings.tracks.link')}</span>
            <span class="g58-chevron">${icon('arrowRight', 18)}</span>
          </div>
        </div>
        <div class="settings-section">🎮 ${tx('settings.controls.title')}</div>
        <div class="card settings-card">
          <div class="settings-row">
            <span class="settings-label">${tx('settings.controls.invertX')}</span>
            <button class="g14-toggle ${invertX ? 'g14-on' : ''}" data-invert="invertX" role="switch"
              aria-checked="${invertX}" aria-label="${tx('settings.controls.invertX')}"><span class="g14-knob"></span></button>
          </div>
          <div class="settings-row">
            <span class="settings-label">${tx('settings.controls.invertY')}</span>
            <button class="g14-toggle ${invertY ? 'g14-on' : ''}" data-invert="invertY" role="switch"
              aria-checked="${invertY}" aria-label="${tx('settings.controls.invertY')}"><span class="g14-knob"></span></button>
          </div>
          <p class="g58-controls-hint">${tx('settings.controls.hint')}</p>
        </div>
      </div>`;

    wireSubBack(el, ui, 'settingsAudio');

    // G14: toggle handlers — flip the persisted setting; audio.js follows the
    // store live (§D6/§C2.3 mute persistence), so no direct bus pokes.
    for (const btn of el.querySelectorAll('[data-audio-toggle]')) {
      btn.addEventListener('click', () => {
        const key = btn.dataset.audioToggle;
        const next = store.get(`settings.${key}`) === false;
        store.set(`settings.${key}`, next);
        store.flush(); // sync events so audio.js sees the new setting NOW
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

    // §C-SYS1.5 link → G52's per-track subscreen (same-wave feature-detect:
    // G52 registers BOTH a 'trackSettings' screen and panel — the panel keeps
    // the settings stack alive underneath).
    const openTracks = () => {
      audio.play('ui.open');
      if (ui.hasScreen('trackSettings')) ui.openPanel('trackSettings');
      else ui.toast(tx('settings.tracks.missing'));
    };
    const tracksRow = el.querySelector('[data-nav="tracks"]');
    tracksRow?.addEventListener('click', openTracks);
    tracksRow?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') openTracks();
    });

    // §G3.3 Steuerung group: strict-boolean writes; G56's inputInvert proxy
    // reads settings.controls live (slice default lands with G53's save v4 —
    // the guarded create keeps pre-merge saves working).
    for (const btn of el.querySelectorAll('[data-invert]')) {
      btn.addEventListener('click', () => {
        const key = btn.dataset.invert;
        store.update((state) => {
          if (state.settings.controls == null || typeof state.settings.controls !== 'object') {
            state.settings.controls = { invertX: false, invertY: false };
          }
          state.settings.controls[key] = state.settings.controls[key] !== true;
        });
        store.flush();
        audio.play(store.get(`settings.controls.${key}`) === true ? 'ui.toggleOn' : 'ui.toggleOff');
        render();
      });
    }
  }

  return {
    /** @param {HTMLElement} el */
    mount(el) {
      root = el;
      ensureToggleHitAreaCss();
      render();
    },
    unmount() {
      root = null;
    },
  };
}

// ---------------------------------------------------------------------------

/**
 * Create the settings screen module (§E6 UiModule shape). Registered as
 * 'settings' from main.js's marked G6 block. Registers the V4/G58 subscreen
 * panels ('settingsDisplay', 'settingsAudio', 'codes') as a side effect so
 * no additional main.js block is needed (§E0.1-10 kept clean).
 * @param {{store: object, ui: object}} deps
 * @returns {{mount: (el: HTMLElement) => void, unmount: () => void}}
 */
export function createSettingsScreen({ store, ui }) {
  // V4/G58: subscreen panel registration (idempotent map writes).
  ui.registerPanel('settingsDisplay', createDisplayPanel({ store, ui }));
  ui.registerPanel('settingsAudio', createAudioPanel({ store, ui }));
  registerCodesUi({ store, ui });

  /** @type {HTMLElement|null} */
  let root = null;
  /** Reset double-confirm progress: 0 = idle, 1 = one confirm done. */
  let resetStep = 0;
  /** F3: mount-scoped store subscription (live permission-label refresh). */
  let offChange = null;
  /** V3/G33: dev-gate tap counter (§B4) — mount-scoped. */
  const devGate = createDevGate();
  /** §C-SYS12.2: chip visible for the whole first-open mount. */
  let showHint = false;

  function render() {
    const el = root;
    if (!el) return;
    const lang = store.get('settings.lang') ?? 'auto';
    const notifSetting = store.get('settings.notifications');
    const granted = notifSetting === 'granted';
    const devUnlocked = store.get('settings.devUnlocked') === true;
    const creditsAvailable = ui.hasScreen('credits') || ui.hasScreen('creditsScreen');
    const rows = mainRows({ devUnlocked, creditsAvailable });

    const rowHtml = {
      language: `
          <div class="settings-row">
            <span class="settings-label">${t('settings.language')}</span>
            <span class="seg" role="group">
              ${LANGS.map((l) => `<button class="seg-btn ${l === lang ? 'seg-on' : ''}" data-lang="${l}">${t(`settings.lang.${l}`)}</button>`).join('')}
            </span>
          </div>`,
      notifications: `
          <div class="settings-row">
            <span class="settings-label">${icon('bell', 18)} ${t('settings.notifications')}</span>
            <span class="settings-value">
              <span class="settings-status">${t(notifStatusKey(notifSetting))}</span>
              <button class="btn ${granted ? 'btn-ghost' : 'btn-teal'} settings-notif-btn">
                ${granted ? t('settings.notif.disable') : t('settings.notif.enable')}
              </button>
            </span>
          </div>`,
      display: navRow('display', `<span class="g33-scale-aa">Aa</span> ${tx('settings.row.display')}`),
      audio: navRow('audio', `${icon('music', 18)} ${tx('settings.row.audio')}`),
      radio: navRow('radio', `📻 ${tx('settings.row.radio')}`),
      codes: navRow('codes', `🔑 ${tx('settings.row.codes')}`),
      credits: navRow('credits', `${icon('heart', 18)} ${tx('settings.row.credits')}`),
      dev: `
          <div class="settings-row g33-dev-row g58-nav-row" data-nav="dev" role="button" tabindex="0">
            <span class="settings-label">${WRENCH_SVG} ${tx('settings.devRow')}</span>
            <span class="settings-value"><button class="btn btn-ghost g33-dev-open">${tx('settings.devOpen')}</button></span>
          </div>`,
    };

    el.innerHTML = `
      <div class="settings-wrap g58-main">
        <div class="settings-head">
          <button class="btn btn-ghost btn-round settings-back" aria-label="${t('ui.back')}">${icon('arrowLeft', 22)}</button>
          <h1 class="settings-title">${icon('gear', 26)} ${t('settings.title')}</h1>
        </div>
        ${showHint ? `
        <div class="g58-hint-chip" role="status">
          <span>✨ ${tx('settings.hint.v4')}</span>
          <button class="g58-hint-close" aria-label="${t('ui.back')}">${icon('close', 14)}</button>
        </div>` : ''}
        <div class="card settings-card g58-main-card">
          ${rows.map((id) => rowHtml[id]).join('')}
        </div>
        <div class="card settings-card g58-reset-card">
          <div class="settings-row settings-danger">
            <button class="btn settings-reset-btn">${resetLabel()}</button>
          </div>
        </div>
        <div class="settings-footer">${t('settings.version', { v: pkg.version })}</div>
      </div>`;

    function navRow(id, labelHtml) {
      return `
          <div class="settings-row g58-nav-row" data-nav="${id}" role="button" tabindex="0"
            aria-label="${labelHtml.replace(/<[^>]*>/g, '').trim()}">
            <span class="settings-label">${labelHtml}</span>
            <span class="g58-chevron">${icon('arrowRight', 18)}</span>
          </div>`;
    }

    // §C-SYS12.2 hint chip dismiss (session latch already set at mount).
    el.querySelector('.g58-hint-close')?.addEventListener('click', () => {
      audio.play('ui.close');
      showHint = false;
      render();
    });

    // V4/G58 — §C-SYS12.1 row navigation.
    const navigate = (id) => {
      if (id === 'display') {
        audio.play('ui.open');
        ui.openPanel('settingsDisplay');
      } else if (id === 'audio') {
        audio.play('ui.open');
        ui.openPanel('settingsAudio');
      } else if (id === 'radio') {
        // Row 5 opens G52's radioPanel directly (§C-SYS12.1 — „players think
        // of the radio as a thing"). openPanel toasts when unregistered.
        audio.play('ui.open');
        ui.openPanel('radioPanel');
      } else if (id === 'codes') {
        audio.play('ui.open');
        ui.openPanel('codes');
      } else if (id === 'credits') {
        audio.play('ui.open');
        ui.showScreen(ui.hasScreen('credits') ? 'credits' : 'creditsScreen');
      } else if (id === 'dev') {
        audio.play('ui.tap');
        ui.showScreen('devPanel');
      }
    };
    for (const row of el.querySelectorAll('.g58-nav-row')) {
      row.addEventListener('click', () => navigate(row.dataset.nav));
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') navigate(row.dataset.nav);
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

    el.querySelector('.settings-back').addEventListener('click', () => {
      audio.play('ui.close'); // V3/FIX-D (E19)
      ui.closeAll();
    });

    el.querySelector('.settings-notif-btn').addEventListener('click', (e) => {
      e.stopPropagation();
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
      // §C-SYS12.2: one-time hint chip — first v4-settings open per session.
      showHint = !v4HintShown;
      v4HintShown = true;
      ensureToggleHitAreaCss(); // V3/FIX-D (E9 P1)
      probeGyroModule().then(() => {}); // warm G60's module for the subscreen
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
