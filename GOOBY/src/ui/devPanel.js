// Hidden dev panel (V3/G33 — PLAN3 §B4/§C4.2): the 12 cards, exactly per
// §C4.2. Registered unconditionally as §E6 screen id 'devPanel' (main.js's
// marked V3/G33 block lazy-loads this module on first open); the settings
// entry row renders ONLY when settings.devUnlocked (§B4 — harness
// ?open=devPanel works regardless in dev builds, §E9). No production-build
// stripping: hidden-by-flag is the spec.
//
// Same-wave runtime dependencies (§E0.1-11): the sticker catalog/engine
// (G34) and audio.previewBus/masterPeakDb (G32) are feature-detected with
// "not built yet" fallbacks. Coins move ONLY through systems/economy.js
// ('devGrant' reason) so profile counters stay honest.
//
// V4/G58 (PLAN4 §C-SYS6): dev panel „vollwertig" — the card-3 §B11 ledger
// expander plus cards 13–18 appended below card 12 (single scroll column,
// same devUnlocked gate): 13 codes (real redeem path via codesScreen +
// per-row reset + lock reset), 14 modifier (force/clear/next-now on G54's
// engine), 15 recap (preview/replay via the wave-2 playback module, queue
// pending via G55's §B5.2 slice semantics, beat-debug flag for G64),
// 16 radio/tracks (G51 singleton + manifest stats + quick trim),
// 17 Sprungliste (+ splat-teleport stub until wave 2), 18 harness cheat
// sheet (single source: data/harnessParams.js). Every same-wave engine is
// feature-detected per §E0.1-11 — absent ones render a "not built yet" note.

import { t, getLang } from '../data/strings.js';
import * as clock from '../core/clock.js';
import * as notifications from '../core/notifications.js';
import * as economy from '../systems/economy.js';
import { getAchievementsEngine, V2_QUEST_POOL } from '../systems/achievementsEngine.js';
import { getStickerBook } from '../systems/stickerBook.js'; // V3/FIX-D (E14 P1-3)
import { bandAt } from '../systems/dayNight.js';
import { weatherAt } from '../systems/weather.js';
import { STATS, LEVELING, NOTIFY } from '../data/constants.js';
import { ACHIEVEMENTS } from '../data/achievements.js'; // V3/FIX-D (E14 P1-1)
import { MINIGAME_IDS } from '../data/minigames.js'; // V3/FIX-D (E14 P1-1)
import { OUTFITS, OUTFIT_SLOTS } from '../data/outfits.js';
import { SKINS } from '../data/skins.js';
import { COLLECTION_SETS } from '../data/collections.js';
import audio from '../audio/audio.js';
import {
  setFakeNotch,
  getFakeNotch,
  resetSaveAndReload,
  importSaveAndReload, // V3/FIX-D (E14 P1-2)
  ensureToggleHitAreaCss, // V3/FIX-D (E9 P1)
} from './settingsScreen.js';
// V3/G33 (§E0.1-11): local fallback tables until G34's strings.js spread lands.
import { EN as DEV_EN, DE as DEV_DE } from '../data/strings/v3-dev.js';
// ---- V4/G58 (PLAN4 §C-SYS6 cards 13–18 + card-3 ledger expander) -----------
import {
  HARNESS_PARAM_GROUPS,
  JUMP_SCENES,
  JUMP_SCREENS,
  JUMP_PANELS,
} from '../data/harnessParams.js';
import { loadCodesApi, redeemCode } from './codesScreen.js';
import { formatMmSs, lockRemainingSec, formatLedgerRow } from './settingsIa.logic.js';
// §E0.1-11 fallbacks until G53's strings.js spread lands (v4-dev = card copy,
// v4-codes = the code display names + wrong/already toasts card 13 reuses).
import { EN as DEV4_EN, DE as DEV4_DE } from '../data/strings/v4-dev.js';
import { EN as CODES_EN, DE as CODES_DE } from '../data/strings/v4-codes.js';

// G34's sticker catalog — resolved at transform time; empty map while the
// file doesn't exist (main.js glob pattern — do not convert to static import).
const stickerCatalogModules = import.meta.glob('../data/stickers.js');

// V4/G58 — same-wave/wave-2 engine probes (§E0.1-11): empty maps while the
// files don't exist; every card renders a "not built yet" note instead.
const modifierEngineModules = import.meta.glob('../systems/modifierEngine.js');
const recapPlaybackModules = import.meta.glob(['./recapOverlay.js', '../systems/recapScene.js', '../scenes/recapScene.js']);
const radioEngineModules = import.meta.glob(['../audio/radio.js', '../audio/radioPlayer.js', '../systems/radio.js']);
const musicManifestModules = import.meta.glob('../data/musicManifest.json');
const splatRegistryModules = import.meta.glob(['../data/splatScenes.js', '../systems/splatScenes.js']);

/** §C-SYS4.2 type → plays fallback (used only when G54's engine exports no
 *  table of its own; the card stays disabled while the engine is absent). */
const MODIFIER_PLAYS_FALLBACK = Object.freeze({
  doppelGold: 2, muenzregen: 3, turbo: 3, riesenGooby: 3, stickerChance: 2, glueckspilz: 3,
});
const MODIFIER_TYPE_IDS = Object.freeze(Object.keys(MODIFIER_PLAYS_FALLBACK));

/** V4/G58 — minimal HTML escaper for catalog/param interpolations. */
const escHtml = (v) => String(v ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

// V4/G58 §C-SYS6 card 15 — beat-debug flag (session-only, never persisted).
// G64's wave-2 recapOverlay reads getRecapBeatDebug() at playback start and
// may live-follow the runtime 'recapBeatDebugChanged' store event to draw
// the bar grid + cue markers + ms-offset readout (§A2 ±80 ms evidence tool).
let recapBeatDebug = false;

/** @returns {boolean} beat-debug overlay requested? */
export function getRecapBeatDebug() {
  return recapBeatDebug;
}

/** @param {boolean} on */
export function setRecapBeatDebug(on) {
  recapBeatDebug = on === true;
}

/** §C4.2 #7 — weather/band pin search: step 15 min, scan ≤ 45 days. */
const PIN_SEARCH = Object.freeze({ STEP_MS: 15 * 60000, SPAN_MS: 45 * 86400000 });

/**
 * t() with a graceful fallback to this agent's v3-dev module while G34's
 * strings.js spread hasn't landed (§E0.1-11).
 * @param {string} key @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
function tx(key, vars) {
  const viaT = t(key, vars);
  if (viaT !== key) return viaT;
  // V4/G58: chain the v4-dev + v4-codes tables behind G34's v3-dev table.
  const de = getLang() === 'de';
  let str = (de ? DEV_DE : DEV_EN)[key] ?? (de ? DEV4_DE : DEV4_EN)[key] ?? (de ? CODES_DE : CODES_EN)[key];
  if (str == null) return key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
  return str;
}

// --- module-level runtime state (survives panel remounts; never persisted) --
/** @type {{el: HTMLElement, raf: number, timer: ReturnType<typeof setInterval>}|null} */
let overlay = null;
let pinnedBand = 'auto';
let pinnedWeather = 'auto';
let clockOffsetH = 0;

/**
 * Find an epoch ms whose local day-band AND weather block match the pins
 * (§C4.2 #7 — pins the ambience engines like ?now=, both are pure functions
 * of the clock). 'auto' matches anything.
 * @param {string} wantBand 'auto'|'dawn'|'day'|'dusk'|'night'
 * @param {string} wantWeather 'auto'|'clear'|'cloudy'|'rain'
 * @returns {number|null}
 */
export function findPinTime(wantBand, wantWeather, fromMs = Date.now()) {
  if (wantBand === 'auto' && wantWeather === 'auto') return null;
  for (let ts = fromMs; ts < fromMs + PIN_SEARCH.SPAN_MS; ts += PIN_SEARCH.STEP_MS) {
    const b = bandAt(ts);
    if (wantBand !== 'auto' && (b.band !== wantBand || b.blend != null)) continue;
    if (wantWeather !== 'auto' && weatherAt(ts).state !== wantWeather) continue;
    return ts;
  }
  return null;
}

/** Re-emit the runtime ambience events so rooms react NOW (60 s ticker lag). */
function emitAmbience(store) {
  store.emit?.('dayBandChanged', bandAt(clock.now()));
  store.emit?.('weatherChanged', weatherAt(clock.now()));
}

/** Apply the current pin/offset state to the clock (last write wins). */
function applyClock(store) {
  if (pinnedBand !== 'auto' || pinnedWeather !== 'auto') {
    const ts = findPinTime(pinnedBand, pinnedWeather);
    if (ts == null) return false;
    clock.configure({ now: ts });
  } else {
    clock.configure({ now: Date.now() + clockOffsetH * 3600000 });
  }
  emitAmbience(store);
  return true;
}

// --- FPS/draw-call overlay chip (§C4.2 #10) ---------------------------------

/**
 * Toggle the diagnostics chip: fps (1 s avg), renderer.info draw calls +
 * triangles, JS heap (when available), master-bus peak dBFS (G32's
 * audio.getStats().masterPeakDb — feature-detected).
 * @param {{ui: object, sceneManager?: object}} deps
 * @param {boolean} on
 */
export function setOverlay({ ui, sceneManager }, on) {
  if (!on) {
    if (overlay) {
      cancelAnimationFrame(overlay.raf);
      clearInterval(overlay.timer);
      overlay.el.remove();
      overlay = null;
    }
    return;
  }
  if (overlay) return;
  const el = document.createElement('div');
  el.className = 'g33-overlay';
  el.textContent = '…';
  ui.el.appendChild(el);
  let frames = 0;
  const state = { el, raf: 0, timer: 0 };
  const pump = () => {
    frames += 1;
    state.raf = requestAnimationFrame(pump);
  };
  state.raf = requestAnimationFrame(pump);
  state.timer = setInterval(() => {
    const info = sceneManager?.renderer?.info?.render;
    const heap = globalThis.performance?.memory?.usedJSHeapSize;
    let peak = '—';
    try {
      const db = audio.getStats?.()?.masterPeakDb;
      if (typeof db === 'number' && Number.isFinite(db)) peak = `${db.toFixed(1)} dB`;
    } catch { /* G32 not merged yet */ }
    el.textContent =
      `fps ${frames}\n` +
      `calls ${info?.calls ?? '—'}  tris ${info?.triangles ?? '—'}\n` +
      `heap ${heap ? `${(heap / 1048576).toFixed(1)} MB` : '—'}  peak ${peak}`;
    frames = 0;
  }, 1000);
  overlay = state;
}

/** @returns {boolean} overlay chip active? (toggle sync on remount) */
export function getOverlay() {
  return overlay != null;
}

// ---------------------------------------------------------------------------

/** @type {{deps: object, el: HTMLElement|null, offs: Array<() => void>}|null} */
let mounted = null;

/**
 * Mount the dev panel into a §E6 screen container (called from main.js's
 * lazy V3/G33 facade).
 * @param {HTMLElement} el
 * @param {{store: object, ui: object, audio?: object, sceneManager?: object, framework?: object}} deps
 */
export function mountDevPanel(el, deps) {
  const { store, ui } = deps;
  mounted = { deps, el, offs: [] };
  ensureToggleHitAreaCss(); // V3/FIX-D (E9 P1)
  /** Unlock-all / reset-save confirm chains (relabel pattern). */
  let unlockStep = 0;
  let resetStep = 0;
  /** @type {Array<{id: string}>|null} G34's sticker catalog once probed */
  let stickerDefs = null;
  /** @type {'granted'|'denied'|'prompt'|'…'} async OS permission state */
  let osPerm = '…';

  // ---- V4/G58 card state (§C-SYS6 cards 13–18 + card-3 ledger) -------------
  /** card-3 expander open state (survives re-renders, not remounts) */
  let ledgerOpen = false;
  /** @type {Array<object>|null} G53's data/codes.js rows once probed */
  let codesCatalog = null;
  /** @type {object|null} G54's modifierEngine module once probed */
  let modEngine = null;
  /** @type {object|null} wave-2 recap playback module (G63/G64) once probed */
  let recapPlayback = null;
  /** @type {object|null} G51's radio singleton once probed */
  let radioApi = null;
  /** @type {{tracks?: Array<object>}|null} G51's committed music manifest */
  let musicManifest = null;
  /** @type {Array<{id: string}>|null} plan-B splat-scene registry (wave 2) */
  let splatScenes = null;
  /** card-14 force dropdown selections */
  let modGame = MINIGAME_IDS[0];
  let modType = MODIFIER_TYPE_IDS[0];
  /** card-16 quick-trim track selection */
  let trimTrackId = '';

  const stickerLoader = stickerCatalogModules['../data/stickers.js'];
  if (stickerLoader) {
    stickerLoader().then((mod) => {
      stickerDefs = mod.STICKERS ?? mod.STICKER_DEFS ?? mod.default ?? null;
      if (stickerDefs && !Array.isArray(stickerDefs)) stickerDefs = null;
      render();
    }).catch(() => {});
  }
  notifications.getPermission().then((p) => {
    osPerm = p;
    render();
  }).catch(() => {});

  // V4/G58 — probe every same-wave engine once per mount (§E0.1-11).
  loadCodesApi().then(({ catalog }) => {
    codesCatalog = catalog;
    render();
  }).catch(() => {});
  const modLoader = modifierEngineModules['../systems/modifierEngine.js'];
  if (modLoader) {
    modLoader().then((mod) => {
      const api = mod.default ?? mod;
      if (typeof api?.tick === 'function' || typeof api?.consume === 'function') {
        modEngine = api;
        render();
      }
    }).catch(() => {});
  }
  for (const load of Object.values(recapPlaybackModules)) {
    load().then((mod) => {
      const api = mod.default ?? mod;
      if (typeof (api?.previewRecap ?? api?.preview ?? api?.play) === 'function' && !recapPlayback) {
        recapPlayback = api;
        render();
      }
    }).catch(() => {});
  }
  (async () => {
    // Dev/CDP seam shared with G52's radio UI (stripped from prod builds).
    const stub = import.meta.env.DEV ? globalThis.__goobyRadioStub : null;
    if (stub && typeof stub.now === 'function') {
      radioApi = stub;
    } else {
      for (const load of Object.values(radioEngineModules)) {
        try {
          const mod = await load();
          const api = mod.default ?? mod.radio ?? mod.radioPlayer ?? mod;
          if (api && (typeof api.now === 'function' || typeof api.toggle === 'function' || typeof api.start === 'function')) {
            radioApi = api;
            break;
          }
        } catch { /* engine broken/absent — card shows the missing note */ }
      }
    }
    for (const load of Object.values(musicManifestModules)) {
      try {
        const mod = await load();
        const manifest = mod.default ?? mod;
        if (Array.isArray(manifest?.tracks)) {
          musicManifest = manifest;
          trimTrackId = trimTrackId || manifest.tracks[0]?.id || '';
        }
      } catch { /* manifest absent */ }
    }
    for (const load of Object.values(splatRegistryModules)) {
      try {
        const mod = await load();
        const rows = mod.SPLAT_SCENES ?? mod.default ?? null;
        if (Array.isArray(rows) && rows.length > 0) splatScenes = rows;
      } catch { /* wave-2 registry absent */ }
    }
    render();
  })();

  const seg = (name, options, active) =>
    `<span class="seg" role="group" data-seg="${name}">${options
      .map(
        (o) =>
          `<button class="seg-btn ${o.value === active ? 'seg-on' : ''}" data-seg-val="${o.value}">${o.label}</button>`
      )
      .join('')}</span>`;

  function render() {
    if (!mounted || mounted.el !== el) return;
    const stats = store.get('stats') ?? {};
    const level = store.get('level') ?? 1;
    const coins = store.get('coins') ?? 0;
    const weight = Math.round(Number(store.get('weight.value')) || 50);
    const health = store.get('health.state') ?? 'healthy';

    el.innerHTML = `
      <div class="g33-dev-wrap">
        <div class="settings-head">
          <button class="btn btn-ghost btn-round g33-dev-back" aria-label="${t('ui.back')}">${backIcon()}</button>
          <h1 class="settings-title">🔧 ${tx('dev.title')}</h1>
        </div>

        <div class="card g33-dev-card" data-card="unlockAll">
          <div class="g33-dev-card-title">1 · ${tx('dev.unlockAll')}</div>
          <p class="g33-dev-card-desc">${tx('dev.unlockAll.desc')}</p>
          <div class="g33-dev-line">
            <button class="btn btn-teal g33-dev-btn" data-act="unlockAll">
              ${unlockStep === 1 ? tx('dev.unlockAll.confirm') : tx('dev.unlockAll')}
            </button>
          </div>
        </div>

        <div class="card g33-dev-card" data-card="level">
          <div class="g33-dev-card-title">2 · ${tx('dev.level')} <span class="g33-dev-val" data-val="level">${level}</span></div>
          <div class="g33-dev-line">
            <button class="btn btn-ghost g33-dev-btn" data-act="levelDec">−1</button>
            <button class="btn btn-ghost g33-dev-btn" data-act="levelInc">+1</button>
            <button class="btn btn-yellow g33-dev-btn" data-act="levelSet">${tx('dev.set')}</button>
          </div>
        </div>

        <div class="card g33-dev-card" data-card="coins">
          <div class="g33-dev-card-title">3 · ${tx('dev.coins')} <span class="g33-dev-val" data-val="coins">${coins}</span></div>
          <div class="g33-dev-line">
            <button class="btn btn-ghost g33-dev-btn" data-act="coins100">+100</button>
            <button class="btn btn-ghost g33-dev-btn" data-act="coins1000">+1000</button>
            <button class="btn btn-yellow g33-dev-btn" data-act="coinsSet">${tx('dev.set')}</button>
          </div>
          ${''/* V4/G58 §C-SYS6 card-3 extension: §B11 ledger ring buffer */}
          <details class="g58-ledger" data-act="ledgerBox" ${ledgerOpen ? 'open' : ''}>
            <summary class="g33-dev-card-desc">${tx('dev.ledger')}</summary>
            <pre class="g58-ledger-pre">${escHtml(ledgerText())}</pre>
          </details>
        </div>

        <div class="card g33-dev-card" data-card="stats">
          <div class="g33-dev-card-title">4 · ${tx('dev.stats')}</div>
          ${STATS.KEYS.map((k) => `
          <div class="g33-dev-line">
            <span class="g33-dev-label">${t(`stat.${k}`)}</span>
            <input type="range" class="g33-vol-slider" min="0" max="100" step="1"
              value="${Math.round(Number(stats[k]) || 0)}" data-stat="${k}" aria-label="${t(`stat.${k}`)}">
            <span class="g33-dev-val" data-val="stat-${k}">${Math.round(Number(stats[k]) || 0)}</span>
          </div>`).join('')}
        </div>

        <div class="card g33-dev-card" data-card="weight">
          <div class="g33-dev-card-title">5 · ${tx('dev.weight')} <span class="g33-dev-val" data-val="weight">${weight}</span></div>
          <div class="g33-dev-line">
            <input type="range" class="g33-vol-slider" min="5" max="95" step="1"
              value="${weight}" data-act="weight" aria-label="${tx('dev.weight')}">
          </div>
        </div>

        <div class="card g33-dev-card" data-card="health">
          <div class="g33-dev-card-title">6 · ${tx('dev.health')}</div>
          <div class="g33-dev-line">
            ${seg('health', [
              { value: 'healthy', label: tx('dev.health.healthy') },
              { value: 'queasy', label: tx('dev.health.queasy') },
              { value: 'sick', label: tx('dev.health.sick') },
            ], health)}
          </div>
        </div>

        <div class="card g33-dev-card" data-card="ambience">
          <div class="g33-dev-card-title">7 · ${tx('dev.weather')} / ${tx('dev.band')}</div>
          <div class="g33-dev-line">
            <span class="g33-dev-label">${tx('dev.weather')}</span>
            ${seg('weather', [
              { value: 'auto', label: tx('dev.auto') },
              { value: 'clear', label: tx('dev.weather.sunny') },
              { value: 'cloudy', label: tx('dev.weather.cloudy') },
              { value: 'rain', label: tx('dev.weather.rain') },
            ], pinnedWeather)}
          </div>
          <div class="g33-dev-line">
            <span class="g33-dev-label">${tx('dev.band')}</span>
            ${seg('band', [
              { value: 'auto', label: tx('dev.auto') },
              { value: 'dawn', label: tx('dev.band.dawn') },
              { value: 'day', label: tx('dev.band.day') },
              { value: 'dusk', label: tx('dev.band.dusk') },
              { value: 'night', label: tx('dev.band.night') },
            ], pinnedBand)}
          </div>
        </div>

        <div class="card g33-dev-card" data-card="clock">
          <div class="g33-dev-card-title">8 · ${tx('dev.clock')} <span class="g33-dev-val" data-val="clock">${clockOffsetH >= 0 ? '+' : ''}${clockOffsetH} h</span></div>
          <div class="g33-dev-line">
            <input type="range" class="g33-vol-slider" min="-12" max="12" step="0.5"
              value="${clockOffsetH}" data-act="clockOffset" aria-label="${tx('dev.clock')}">
            <button class="btn btn-ghost g33-dev-btn" data-act="clockReset" style="flex:none">${tx('dev.clock.reset')}</button>
          </div>
        </div>

        <div class="card g33-dev-card" data-card="notify">
          <div class="g33-dev-card-title">9 · ${tx('dev.notify')}</div>
          <p class="g33-dev-card-desc">${tx('dev.notify.state', { state: osPerm })}</p>
          <div class="g33-dev-line">
            <button class="btn btn-teal g33-dev-btn" data-act="notifyFire">${tx('dev.notify.fire')}</button>
          </div>
        </div>

        <div class="card g33-dev-card" data-card="overlay">
          ${''/* V3/FIX-D (E9 P1): min-height reserves ≥50px per toggle row so
               the stacked 44px+ hit halos never overlap each other */}
          <div class="settings-row" style="border-bottom:none;padding:0;min-height:max(50px, 3.125rem)">
            <span class="g33-dev-card-title">10 · ${tx('dev.overlay')}</span>
            <button class="g14-toggle ${getOverlay() ? 'g14-on' : ''}" data-act="overlay" role="switch"
              aria-checked="${getOverlay()}" aria-label="${tx('dev.overlay')}"><span class="g14-knob"></span></button>
          </div>
          <div class="settings-row" style="border-bottom:none;padding:0;min-height:max(50px, 3.125rem)">
            <span class="g33-dev-card-title">${tx('dev.notch')}</span>
            <button class="g14-toggle ${getFakeNotch() ? 'g14-on' : ''}" data-act="notch" role="switch"
              aria-checked="${getFakeNotch()}" aria-label="${tx('dev.notch')}"><span class="g14-knob"></span></button>
          </div>
        </div>

        <div class="card g33-dev-card" data-card="save">
          <div class="g33-dev-card-title">11 · ${tx('dev.save')}</div>
          <div class="g33-dev-line">
            <button class="btn btn-ghost g33-dev-btn" data-act="saveExport">${tx('dev.save.export')}</button>
            <button class="btn btn-ghost g33-dev-btn" data-act="saveImport">${tx('dev.save.import')}</button>
            <button class="btn g33-dev-btn" style="background:#e0655f;border-bottom-color:#b84943" data-act="saveReset">
              ${resetStep === 0 ? tx('dev.save.reset') : resetStep === 1 ? t('settings.reset.confirm1') : t('settings.reset.confirm2')}
            </button>
          </div>
        </div>

        <div class="card g33-dev-card" data-card="debug">
          <div class="g33-dev-card-title">12 · ${tx('dev.debug')}</div>
          <div class="g33-dev-line">
            ${stickerDefs
              ? `<select class="g33-dev-select" data-act="stickerSel">
                  ${stickerDefs.map((d) => `<option value="${d.id}">${d.id}</option>`).join('')}
                </select>
                <button class="btn btn-ghost g33-dev-btn" style="flex:none" data-act="stickerFire">${tx('dev.debug.fireSticker')}</button>`
              : `<span class="g33-dev-label">${tx('dev.debug.noStickers')}</span>`}
          </div>
          <div class="g33-dev-line">
            <button class="btn btn-ghost g33-dev-btn" data-act="questsDone">${tx('dev.debug.quests')}</button>
            <button class="btn btn-ghost g33-dev-btn" data-act="dailyDay">${tx('dev.debug.daily')}</button>
          </div>
        </div>

        ${''/* ---- V4/G58: §C-SYS6 cards 13–18 (append below card 12) ---- */}
        <div class="card g33-dev-card" data-card="codes">
          <div class="g33-dev-card-title">13 · ${tx('dev.codes')}</div>
          ${codesCatalog
            ? codesCatalog.map((c) => codeRow(c)).join('')
            : `<p class="g33-dev-card-desc">${tx('dev.codes.missing')}</p>`}
          <div class="g33-dev-line">
            <button class="btn btn-ghost g33-dev-btn" data-act="codesLockReset" ${codesLockSec() > 0 ? '' : 'disabled'}>
              ${codesLockSec() > 0 ? `${tx('dev.codes.lockReset')} (${codesLockSec()} s)` : tx('dev.codes.lockNone')}
            </button>
          </div>
        </div>

        <div class="card g33-dev-card" data-card="modifier">
          <div class="g33-dev-card-title">14 · ${tx('dev.modifier')}</div>
          <p class="g33-dev-card-desc" data-val="modState">${modReadout()}</p>
          ${modEngine ? `
          <div class="g33-dev-line">
            <select class="g33-dev-select" data-act="modGame" aria-label="${tx('dev.modifier.game')}">
              ${MINIGAME_IDS.map((id) => `<option value="${id}" ${id === modGame ? 'selected' : ''}>${id}</option>`).join('')}
            </select>
            <select class="g33-dev-select" data-act="modType" aria-label="${tx('dev.modifier.type')}">
              ${MODIFIER_TYPE_IDS.map((id) => `<option value="${id}" ${id === modType ? 'selected' : ''}>${id}</option>`).join('')}
            </select>
          </div>
          <div class="g33-dev-line">
            <button class="btn btn-teal g33-dev-btn" data-act="modStart">${tx('dev.modifier.start')}</button>
            <button class="btn btn-ghost g33-dev-btn" data-act="modClear">${tx('dev.modifier.clear')}</button>
            <button class="btn btn-yellow g33-dev-btn" data-act="modNextNow">${tx('dev.modifier.nextNow')}</button>
          </div>`
          : `<p class="g33-dev-card-desc">${tx('dev.modifier.missing')}</p>`}
        </div>

        <div class="card g33-dev-card" data-card="recap">
          <div class="g33-dev-card-title">15 · ${tx('dev.recap')}</div>
          <p class="g33-dev-card-desc" data-val="recapState">${recapReadout()}</p>
          <div class="g33-dev-line">
            <button class="btn btn-teal g33-dev-btn" data-act="recapPreview">${tx('dev.recap.preview')}</button>
            <button class="btn btn-ghost g33-dev-btn" data-act="recapReplay">${tx('dev.recap.replay')}</button>
          </div>
          <div class="g33-dev-line">
            <button class="btn btn-yellow g33-dev-btn" data-act="recapQueue">${tx('dev.recap.queue')}</button>
          </div>
          ${recapPlayback ? '' : `<p class="g33-dev-card-desc">${tx('dev.recap.missing')}</p>`}
          <div class="settings-row" style="border-bottom:none;padding:0;min-height:max(50px, 3.125rem)">
            <span class="g33-dev-card-title">${tx('dev.recap.beatDebug')}</span>
            <button class="g14-toggle ${getRecapBeatDebug() ? 'g14-on' : ''}" data-act="recapBeatDebug" role="switch"
              aria-checked="${getRecapBeatDebug()}" aria-label="${tx('dev.recap.beatDebug')}"><span class="g14-knob"></span></button>
          </div>
        </div>

        <div class="card g33-dev-card" data-card="radio">
          <div class="g33-dev-card-title">16 · ${tx('dev.radio')}</div>
          <p class="g33-dev-card-desc" data-val="radioNow">${radioReadout()}</p>
          ${radioApi ? `
          <div class="g33-dev-line">
            <button class="btn btn-teal g33-dev-btn" data-act="radioToggle">${tx('dev.radio.play')} / ${tx('dev.radio.pause')}</button>
            <button class="btn btn-ghost g33-dev-btn" data-act="radioSkip">${tx('dev.radio.skip')}</button>
          </div>`
          : `<p class="g33-dev-card-desc">${tx('dev.radio.missing')}</p>`}
          <p class="g33-dev-card-desc">${manifestStats()}</p>
          ${trimRows()}
        </div>

        <div class="card g33-dev-card" data-card="jump">
          <div class="g33-dev-card-title">17 · ${tx('dev.jump')}</div>
          <div class="g33-dev-card-desc">${tx('dev.jump.scenes')}</div>
          <div class="g58-dev-chips">
            ${JUMP_SCENES.map((id) => jumpChip('jumpScene', id, deps.sceneManager?.has?.(id) === true)).join('')}
          </div>
          <div class="g33-dev-card-desc">${tx('dev.jump.screens')}</div>
          <div class="g58-dev-chips">
            ${JUMP_SCREENS.map((id) => jumpChip('jumpScreen', id, ui.hasScreen(id))).join('')}
          </div>
          <div class="g33-dev-card-desc">${tx('dev.jump.panels')}</div>
          <div class="g58-dev-chips">
            ${JUMP_PANELS.map((id) => jumpChip('jumpPanel', id, true)).join('')}
          </div>
          <div class="g33-dev-card-desc">${tx('dev.jump.splat')}</div>
          ${splatScenes
            ? `<div class="g58-dev-chips">${splatScenes.map((s) => jumpChip('jumpSplat', s.id ?? String(s), deps.sceneManager?.has?.(s.id ?? String(s)) === true)).join('')}</div>`
            : `<p class="g33-dev-card-desc">${tx('dev.jump.splatMissing')}</p>`}
        </div>

        <div class="card g33-dev-card" data-card="cheat">
          <div class="g33-dev-card-title">18 · ${tx('dev.cheat')}</div>
          ${HARNESS_PARAM_GROUPS.map((g) => `
          <div class="g33-dev-card-desc g58-cheat-group">${escHtml(getLang() === 'de' ? g.de : g.en)}</div>
          ${g.rows.map((r) => `
          <div class="g33-dev-line g58-cheat-row">
            <code class="g58-cheat-code">${escHtml(r.example)}</code>
            <span class="g58-cheat-desc">${escHtml(getLang() === 'de' ? r.de : r.en)}</span>
            <button class="btn btn-ghost g33-dev-btn g58-cheat-copy" data-act="cheatCopy" data-example="${escHtml(r.example)}">${tx('dev.cheat.copy')}</button>
          </div>`).join('')}`).join('')}
        </div>
      </div>`;

    wire();
    wireV4();
  }

  /** Tiny inline arrow icon (icons.js is shared — keep this file additive). */
  function backIcon() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 4l-8 8 8 8" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /** Numeric prompt helper. @returns {number|null} */
  function askNumber(msgKey, min, max) {
    const raw = globalThis.prompt?.(tx(msgKey));
    if (raw == null || raw.trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, Math.floor(n)));
  }

  /** getAchievementsEngine().checkNow() with the harness-edge guard. */
  function achievementsCheckNow() {
    try {
      getAchievementsEngine()?.checkNow();
    } catch { /* engine not initialized (harness edge) */ }
  }

  // ---- V4/G58 card renderers/handlers (§C-SYS6) -----------------------------

  /** Card-3 expander body: §B11 rows newest first (or the missing note). */
  function ledgerText() {
    if (typeof economy.getLedger !== 'function') return tx('dev.ledger.missing');
    let rows = [];
    try {
      rows = economy.getLedger() ?? [];
    } catch { /* defensive — G54's buffer */ }
    if (!Array.isArray(rows) || rows.length === 0) return tx('dev.ledger.empty');
    return [...rows]
      .sort((a, b) => (Number(b?.at) || 0) - (Number(a?.at) || 0))
      .map(formatLedgerRow)
      .join('\n');
  }

  /** Card 13 seconds left on codes.lockUntil (0 = unlocked). */
  function codesLockSec() {
    return lockRemainingSec(store.get('codes')?.lockUntil, clock.now());
  }

  /** Card 13 one catalog row: status · name · secret + redeem/reset. */
  function codeRow(c) {
    const id = String(c?.id ?? '');
    const secret = String(c?.secret ?? c?.code ?? id);
    const nameKey = `codes.name.${id}`;
    const name = tx(nameKey) === nameKey ? (c?.name ?? id) : tx(nameKey);
    const redeemedAt = store.get('codes')?.redeemed?.[id];
    return `
          <div class="g33-dev-line g58-dev-code">
            <span class="g33-dev-label">${redeemedAt ? '✅' : '—'} ${escHtml(name)} <code class="g58-dev-secret">${escHtml(secret)}</code></span>
            <button class="btn btn-ghost g33-dev-btn g58-flexnone" data-act="codeRedeem" data-secret="${escHtml(secret)}">${tx('dev.codes.redeem')}</button>
            <button class="btn btn-ghost g33-dev-btn g58-flexnone" data-act="codeReset" data-id="${escHtml(id)}" ${redeemedAt ? '' : 'disabled'}>${tx('dev.codes.reset')}</button>
          </div>`;
  }

  /** §B1 modifiers slice — defensive create inside a store.update draft. */
  function ensureModifiers(state) {
    if (state.modifiers == null || typeof state.modifiers !== 'object') {
      state.modifiers = { nextAt: 0, seed: 0, current: null, lastGameId: '', dayCoins: 0, dayCoinsDay: '' };
    }
    return state.modifiers;
  }

  /** Card 14 readout: `game · type · playsLeft · endsAt` + next-event line. */
  function modReadout() {
    const m = store.get('modifiers') ?? {};
    const next = Number(m.nextAt) || 0;
    const nextLabel = tx('dev.modifier.nextAt', { t: next > 0 ? formatMmSs(next - clock.now()) : '—' });
    const cur = m.current;
    if (cur == null || typeof cur !== 'object') return `${tx('dev.modifier.none')} · ${nextLabel}`;
    return `${escHtml(cur.gameId)} · ${escHtml(cur.type)} · ${Math.floor(Number(cur.playsLeft) || 0)}× · ${formatMmSs((Number(cur.endsAt) || 0) - clock.now())} · ${nextLabel}`;
  }

  /** Card 15 readout: pending/last milestone + history availability. */
  function recapReadout() {
    const r = store.get('recap') ?? {};
    const history = Array.isArray(r.history) ? r.history : [];
    const state = tx('dev.recap.state', {
      p: Math.floor(Number(r.pendingLevel) || 0),
      l: Math.floor(Number(r.lastRecapLevel) || 0),
    });
    return history.length === 0 ? `${state} · ${tx('dev.recap.noHistory')}` : `${state} · ${history.length}/8`;
  }

  /** Card 16 readout: `station · trackId · t/dur · effective gain`. */
  function radioReadout() {
    if (!radioApi) return tx('dev.radio.idle');
    try {
      const now = radioApi.now?.() ?? radioApi.getStats?.()?.radio ?? null;
      const trackId = now?.trackId ?? now?.track ?? '';
      if (!now || !trackId) return tx('dev.radio.idle');
      const pos = Number(now.t ?? now.time ?? now.positionSec) || 0;
      const dur = Number(now.duration ?? now.durationSec ?? now.dur) || 0;
      const gain = now.gain ?? now.effectiveGain ?? now.volume;
      return `${escHtml(now.station ?? '—')} · ${escHtml(trackId)} · ${formatMmSs(pos * 1000)}/${formatMmSs(dur * 1000)} · ${gain != null && Number.isFinite(Number(gain)) ? Number(gain).toFixed(2) : '—'}`;
    } catch {
      return tx('dev.radio.idle');
    }
  }

  /** Card 16 manifest stats line (tracks/stations/missing covers+beats). */
  function manifestStats() {
    const tracks = musicManifest?.tracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return tx('dev.radio.manifestMissing');
    const stations = new Set(tracks.map((r) => r?.category).filter(Boolean));
    const covers = tracks.filter((r) => !r?.cover).length;
    const beats = tracks.filter((r) => !r?.beats).length;
    return tx('dev.radio.manifest', { n: tracks.length, s: stations.size, c: covers, b: beats });
  }

  /** Card 16 per-track quick-trim rows (dev-sized settings mirror). */
  function trimRows() {
    const tracks = musicManifest?.tracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return '';
    const vol = Math.round(Number(store.get('radio')?.trims?.[trimTrackId]?.vol) || 100);
    return `
          <div class="g33-dev-line">
            <span class="g33-dev-label">${tx('dev.radio.trims')}</span>
            <select class="g33-dev-select" data-act="trimSel" aria-label="${tx('dev.radio.trims')}">
              ${tracks.map((r) => `<option value="${escHtml(r.id)}" ${r.id === trimTrackId ? 'selected' : ''}>${escHtml(r.title ?? r.id)}</option>`).join('')}
            </select>
          </div>
          <div class="g33-dev-line">
            <input type="range" class="g33-vol-slider" min="0" max="150" step="5"
              value="${vol}" data-act="trimVol" aria-label="${tx('dev.radio.trims')}">
            <span class="g33-dev-val" data-val="trimVol">${vol}</span>
          </div>`;
  }

  /** Card 17 one probe-aware jump chip (disabled = not registered yet). */
  function jumpChip(act, id, registered) {
    return `<button class="btn btn-ghost g33-dev-btn g58-chip" data-act="${act}" data-id="${escHtml(id)}"
      ${registered ? '' : `disabled title="${tx('dev.jump.gone', { id })}"`}>${escHtml(id)}</button>`;
  }

  /** Milestone prompt shared by card-15 preview/queue (5–40, snapped to 5). */
  function askMilestone() {
    const n = askNumber('dev.recap.prompt', 5, 40);
    if (n == null) return null;
    return Math.min(40, Math.max(5, Math.round(n / 5) * 5));
  }

  // V3/FIX-D (E14 P1-1): unlock-all used to grant the content catalogs and
  // run ONE checkNow() — counter/state-backed achievements stayed locked
  // (8/37). Now it drives the REAL engine to 37/37: counter conditions get
  // their counters raised to target (persisted, so the cabinet's progress
  // rows stay consistent with the unlocks), and the live-state specials that
  // would permanently repaint the pet/home (weight tiers, equipped outfit,
  // placed decor, sickEver) are satisfied TRANSIENTLY between synchronous
  // checkNow() passes and restored — the engine latches every unlock in
  // achievements.unlocked, so they persist; the coalesced §E2 flush only
  // ever sees the restored state.
  function doUnlockAll() {
    const nowMs = clock.now();
    // Pass 1 — persistent grants: catalogs, counters, plays, streak, sets.
    store.update((state) => {
      state.level = LEVELING.MAX_LEVEL; // 40 → unlocks all 27 games (§B6)
      state.outfits.owned = [...new Set([...(state.outfits.owned ?? []), ...OUTFITS.map((o) => o.id)])];
      state.skins.owned = [...new Set([...(state.skins.owned ?? []), ...SKINS.map((s) => s.id)])];
      state.collections.entries = state.collections.entries ?? {};
      for (const set of COLLECTION_SETS) {
        for (const entry of set.entries) {
          const k = `${set.id}.${entry.id}`;
          state.collections.entries[k] = Math.max(1, Number(state.collections.entries[k]) || 0);
        }
      }
      // setComplete/albumFull read collections.claimedSets (§C5.3).
      state.collections.claimedSets = state.collections.claimedSets ?? {};
      for (const set of COLLECTION_SETS) {
        if (!state.collections.claimedSets[set.id]) state.collections.claimedSets[set.id] = nowMs;
      }
      if (stickerDefs) {
        // G34's stickers slice (§B1) — defensive create until save v3 lands.
        state.stickers = state.stickers && typeof state.stickers === 'object'
          ? state.stickers : { unlocked: {}, seen: {} };
        state.stickers.unlocked = state.stickers.unlocked ?? {};
        for (const d of stickerDefs) {
          if (!state.stickers.unlocked[d.id]) state.stickers.unlocked[d.id] = nowMs;
        }
      }
      // Counter-backed achievements: raise every counter to its target.
      const counters = state.achievements.counters;
      for (const def of ACHIEVEMENTS) {
        if (!def.counter) continue;
        counters[def.counter] = Math.max(Math.floor(Number(counters[def.counter]) || 0), def.target);
      }
      counters.holeInOnes = Math.max(Math.floor(Number(counters.holeInOnes) || 0), 1); // 'holeInOne' special
      // play12/play21 specials: every catalog game played once.
      state.minigames.plays = state.minigames.plays ?? {};
      for (const id of MINIGAME_IDS) {
        state.minigames.plays[id] = Math.max(1, Math.floor(Number(state.minigames.plays[id]) || 0));
      }
      // streak7 special reads daily.streak.
      state.daily = state.daily ?? {};
      state.daily.streak = Math.max(Math.floor(Number(state.daily.streak) || 0), 7);
    });
    achievementsCheckNow();

    // Pass 2 — transient specials: chonkZone/fullOutfit/decorator/neverSick,
    // then sleekMode (the two weight milestones exclude each other live).
    const live = store.get();
    const saved = {
      weight: Number(live.weight?.value),
      equipped: { ...(live.outfits?.equipped ?? {}) },
      placed: { ...(live.furniture?.placed ?? {}) },
      sickEver: Math.floor(Number(live.achievements?.counters?.sickEver) || 0),
    };
    store.update((state) => {
      state.weight.value = 90; // chonkZone ≥ 86
      for (const slot of OUTFIT_SLOTS) { // fullOutfit: 3 slots at once
        if (state.outfits.equipped[slot] == null) {
          state.outfits.equipped[slot] = OUTFITS.find((o) => o.slot === slot)?.id ?? null;
        }
      }
      state.furniture.placed = { ...(state.furniture.placed ?? {}) };
      for (let i = 0; i < 10; i += 1) { // decorator: ≥ 10 non-default placed
        state.furniture.placed[`g33dev:${i}`] = 'g33devUnlockProbe';
      }
      state.achievements.counters.sickEver = 0; // neverSick (level 40 ≥ 10)
    });
    achievementsCheckNow();
    store.update((state) => {
      state.weight.value = 20; // sleekMode ≤ 25
    });
    achievementsCheckNow();
    store.update((state) => { // restore the transient slices
      state.weight.value = Number.isFinite(saved.weight) ? saved.weight : 50;
      state.outfits.equipped = saved.equipped;
      state.furniture.placed = saved.placed;
      state.achievements.counters.sickEver = saved.sickEver;
    });

    // coins1000 needs the BALANCE to touch 1000 once — the 37 rewards exceed
    // it on a fresh save, but top up honestly (devGrant) when they did not.
    const coins = store.get('coins') ?? 0;
    if (coins < 1000 && !store.get('achievements.unlocked')?.coins1000) {
      economy.award(store, 1000 - coins, 'devGrant');
    }
    achievementsCheckNow();
    store.flush();
    ui.toast('dev.unlockAll.done');
    audio.play('ui.confirmBig');
  }

  // V3/FIX-D (E14 P1-3): the card used to emit 'stickerHook' with the STICKER
  // id — the engine only maps §C5.4 HOOK ids (grumpyWake…), and counter/
  // special stickers have no hook at all, so nothing ever fired. Route every
  // def kind through the real engine instead: event stickers emit their
  // cond.event hook on the §E0.1-7 channel; counter/collection/game-best
  // conditions are raised persistently and latched by checkNow(); the
  // remaining live-state specials (level/weight/outfit/sets/skins) are
  // satisfied transiently around a synchronous checkNow() pass and restored
  // — the unlock itself persists in stickers.unlocked.
  /** @param {string} id sticker id @returns {boolean} sticker now unlocked */
  function fireSticker(id) {
    const def = stickerDefs?.find((d) => d.id === id);
    const cond = def?.cond;
    if (!cond) return false;
    const unlocked = () => !!store.get('stickers')?.unlocked?.[id];
    if (unlocked()) return true; // already revealed — repeat fires are no-ops
    if (cond.event) {
      store.emit?.('stickerHook', { id: cond.event });
      return unlocked();
    }
    const book = getStickerBook();
    if (!book) return false;
    const target = Math.max(1, Math.floor(Number(cond.target) || 1));
    if (cond.counter) {
      store.update((state) => {
        const counters = state.achievements.counters;
        counters[cond.counter] = Math.max(Math.floor(Number(counters[cond.counter]) || 0), target);
      });
      book.checkNow();
    } else if (cond.special === 'collectionEntry') {
      store.update((state) => {
        state.collections.entries = state.collections.entries ?? {};
        const k = `${cond.set}.${cond.entry}`;
        state.collections.entries[k] = Math.max(Math.floor(Number(state.collections.entries[k]) || 0), target);
      });
      book.checkNow();
    } else if (cond.special === 'gameBest') {
      store.update((state) => {
        state.minigames.best = state.minigames.best ?? {};
        state.minigames.best[cond.game] = Math.max(Math.floor(Number(state.minigames.best[cond.game]) || 0), target);
      });
      book.checkNow();
    } else {
      // Transient live-state specials — restored right after the latch pass
      // (all synchronous, so the coalesced §E2 flush never sees them).
      const live = store.get();
      const saved = {
        level: live.level,
        weight: Number(live.weight?.value),
        equipped: { ...(live.outfits?.equipped ?? {}) },
        claimed: { ...(live.collections?.claimedSets ?? {}) },
        skins: [...(live.skins?.owned ?? [])],
      };
      store.update((state) => {
        if (cond.special === 'level') {
          state.level = Math.max(Math.floor(Number(state.level) || 1), target);
        } else if (cond.special === 'weightMax') {
          state.weight.value = Math.max(Number(state.weight?.value) || 0, target);
        } else if (cond.special === 'fullOutfit') {
          for (const slot of OUTFIT_SLOTS) {
            if (state.outfits.equipped[slot] == null) {
              state.outfits.equipped[slot] = OUTFITS.find((o) => o.slot === slot)?.id ?? null;
            }
          }
        } else if (cond.special === 'setsClaimed') {
          state.collections.claimedSets = state.collections.claimedSets ?? {};
          for (const set of COLLECTION_SETS) {
            if (!state.collections.claimedSets[set.id]) state.collections.claimedSets[set.id] = clock.now();
          }
        } else if (cond.special === 'skinsOwned') {
          state.skins.owned = [...new Set([...(state.skins.owned ?? []), ...SKINS.map((s) => s.id)])];
        }
      });
      book.checkNow();
      store.update((state) => {
        state.level = saved.level;
        if (Number.isFinite(saved.weight)) state.weight.value = saved.weight;
        state.outfits.equipped = saved.equipped;
        state.collections.claimedSets = saved.claimed;
        state.skins.owned = saved.skins;
      });
    }
    store.flush();
    return unlocked();
  }

  function setLevel(n) {
    store.update((state) => {
      state.level = Math.min(LEVELING.MAX_LEVEL, Math.max(1, Math.floor(n)));
      state.xp = 0;
    });
    store.flush();
    try {
      getAchievementsEngine()?.checkNow(); // re-run level-unlock evaluation
    } catch { /* engine not initialized */ }
    render();
  }

  async function notifyTestFire() {
    const title = t('notify.wake.title');
    const body = t('notify.wake.body');
    const at = Date.now() + 5000;
    const cap = globalThis.Capacitor;
    if (cap?.isNativePlatform?.()) {
      try {
        const plugin = cap.Plugins?.LocalNotifications;
        await plugin?.schedule({
          notifications: [{ id: NOTIFY.IDS.wake, title, body, schedule: { at: new Date(at) } }],
        });
        ui.toast('dev.notify.sent');
      } catch {
        ui.toast('dev.notify.unavailable');
      }
      return;
    }
    if (typeof Notification === 'undefined') {
      ui.toast('dev.notify.unavailable');
      return;
    }
    if (Notification.permission === 'default') await Notification.requestPermission();
    osPerm = await notifications.getPermission();
    if (Notification.permission !== 'granted') {
      ui.toast('dev.notify.unavailable');
      render();
      return;
    }
    setTimeout(() => {
      try {
        new Notification(title, { body, tag: `gooby-dev-${NOTIFY.IDS.wake}` });
      } catch (err) {
        console.warn('[devPanel] web notify failed:', err?.message);
      }
    }, 5000);
    ui.toast('dev.notify.sent');
    render();
  }

  function wire() {
    el.querySelector('.g33-dev-back')?.addEventListener('click', () => {
      audio.play('ui.close');
      ui.showScreen('settings');
    });

    el.querySelector('[data-act="unlockAll"]')?.addEventListener('click', () => {
      if (unlockStep === 0) {
        audio.play('ui.tap'); // V3/FIX-D (E19)
        unlockStep = 1; // §C4.2 #1: confirm sheet first (relabel confirm)
        render();
        setTimeout(() => {
          if (unlockStep === 1) {
            unlockStep = 0;
            render();
          }
        }, 5000);
        return;
      }
      unlockStep = 0;
      doUnlockAll();
      render();
    });

    // V3/FIX-D (E19): 'ui.tap' cues on the plain dev buttons.
    el.querySelector('[data-act="levelDec"]')?.addEventListener('click', () => {
      audio.play('ui.tap');
      setLevel((store.get('level') ?? 1) - 1);
    });
    el.querySelector('[data-act="levelInc"]')?.addEventListener('click', () => {
      audio.play('ui.tap');
      setLevel((store.get('level') ?? 1) + 1);
    });
    el.querySelector('[data-act="levelSet"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      const n = askNumber('dev.level.prompt', 1, LEVELING.MAX_LEVEL);
      if (n != null) setLevel(n);
    });

    const grant = (n) => {
      economy.award(store, n, 'devGrant'); // §C4.2 #3: profile counters stay honest
      store.flush();
      render();
    };
    el.querySelector('[data-act="coins100"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      grant(100);
    });
    el.querySelector('[data-act="coins1000"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      grant(1000);
    });
    el.querySelector('[data-act="coinsSet"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      const target = askNumber('dev.coins.prompt', 0, 999999);
      if (target == null) return;
      const cur = store.get('coins') ?? 0;
      if (target > cur) economy.award(store, target - cur, 'devGrant');
      else if (target < cur) economy.spend(store, cur - target, 'devGrant');
      store.flush();
      render();
    });

    for (const slider of el.querySelectorAll('[data-stat]')) {
      slider.addEventListener('input', () => {
        const k = slider.dataset.stat;
        const v = Math.min(STATS.MAX, Math.max(STATS.MIN, Number(slider.value) || 0));
        store.set(`stats.${k}`, v);
        store.flush();
        audio.play('ui.slider'); // V3/FIX-D (E19): sfxMap throttles to 80 ms
        const val = el.querySelector(`[data-val="stat-${k}"]`);
        if (val) val.textContent = String(Math.round(v));
      });
    }

    el.querySelector('[data-act="weight"]')?.addEventListener('input', (e) => {
      const v = Math.min(95, Math.max(5, Number(e.target.value) || 50));
      store.set('weight.value', v); // tier morph is live via 'weightChanged'
      store.flush();
      audio.play('ui.slider'); // V3/FIX-D (E19)
      const val = el.querySelector('[data-val="weight"]');
      if (val) val.textContent = String(Math.round(v));
    });

    for (const segEl of el.querySelectorAll('[data-seg]')) {
      const name = segEl.dataset.seg;
      for (const btn of segEl.querySelectorAll('[data-seg-val]')) {
        btn.addEventListener('click', () => {
          const v = btn.dataset.segVal;
          if (name === 'health') {
            store.update((state) => {
              state.health.state = v;
              state.health.since = clock.now();
            });
            store.flush();
          } else if (name === 'weather' || name === 'band') {
            if (name === 'weather') pinnedWeather = v;
            else pinnedBand = v;
            if (!applyClock(store)) ui.toast('dev.pin.fail');
          }
          audio.play('ui.pick');
          render();
        });
      }
    }

    el.querySelector('[data-act="clockOffset"]')?.addEventListener('input', () => {
      audio.play('ui.slider'); // V3/FIX-D (E19): drag tick (commit stays on change)
    });
    el.querySelector('[data-act="clockOffset"]')?.addEventListener('change', (e) => {
      clockOffsetH = Number(e.target.value) || 0;
      applyClock(store);
      render();
    });
    el.querySelector('[data-act="clockReset"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      clockOffsetH = 0;
      applyClock(store);
      render();
    });

    el.querySelector('[data-act="notifyFire"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      notifyTestFire();
    });

    el.querySelector('[data-act="overlay"]')?.addEventListener('click', () => {
      setOverlay(deps, !getOverlay());
      audio.play(getOverlay() ? 'ui.toggleOn' : 'ui.toggleOff');
      render();
    });
    el.querySelector('[data-act="notch"]')?.addEventListener('click', () => {
      setFakeNotch(!getFakeNotch()); // §B9: force --safe-* to 59/34 px
      audio.play(getFakeNotch() ? 'ui.toggleOn' : 'ui.toggleOff');
      render();
    });

    el.querySelector('[data-act="saveExport"]')?.addEventListener('click', async () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      const json = JSON.stringify(store.get());
      try {
        await navigator.clipboard.writeText(json);
        ui.toast('dev.save.exported');
      } catch {
        globalThis.prompt?.(tx('dev.save.export'), json); // clipboard blocked: manual copy
      }
    });
    el.querySelector('[data-act="saveImport"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      const raw = globalThis.prompt?.(tx('dev.save.importPrompt'));
      if (raw == null || raw.trim() === '') return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed == null || typeof parsed !== 'object') throw new Error('not an object');
        // V3/FIX-D (E14 P1-2): a bare persist+reload lost the race against
        // the §E2 pagehide flush (the live pre-import store re-persisted
        // during the reload) — importSaveAndReload re-writes the imported
        // state AFTER those flush listeners, like the reset fix does.
        importSaveAndReload(parsed); // load() migrates/validates on boot
      } catch {
        ui.toast('dev.save.importFail');
      }
    });
    el.querySelector('[data-act="saveReset"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      resetStep += 1; // reuses the settings triple-confirm pattern (§C4.2 #11)
      if (resetStep >= 3) {
        resetSaveAndReload(); // survives the §E2 pagehide flush
        return;
      }
      render();
      setTimeout(() => {
        if (resetStep > 0) {
          resetStep = 0;
          render();
        }
      }, 6000);
    });

    el.querySelector('[data-act="stickerFire"]')?.addEventListener('click', () => {
      const sel = el.querySelector('[data-act="stickerSel"]');
      const id = sel?.value;
      if (!id) return;
      if (fireSticker(id)) audio.play('ui.pick');
      else ui.toast('dev.debug.noStickers');
    });
    el.querySelector('[data-act="questsDone"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      store.update((state) => {
        for (const row of state.quests?.active ?? []) {
          const def = V2_QUEST_POOL.find((q) => q.id === row.id);
          if (def && row.claimed !== true) row.progress = def.target;
        }
      });
      store.flush();
      ui.toast('dev.debug.questsDone');
    });
    el.querySelector('[data-act="dailyDay"]')?.addEventListener('click', () => {
      audio.play('ui.tap'); // V3/FIX-D (E19)
      const n = askNumber('dev.debug.daily.prompt', 1, 9999);
      if (n == null) return;
      store.update((state) => {
        state.daily = n === 1
          ? { lastClaimDay: '', streak: 0 }
          : { lastClaimDay: clock.localDay(clock.now() - 86400000), streak: n - 1 };
      });
      store.flush();
      ui.openPanel('dailyBonus'); // show the forced day-N popup immediately
    });
  }

  /** V4/G58 — listeners for the §C-SYS6 cards 13–18 + the card-3 expander. */
  function wireV4() {
    // card 3 — expander open state survives the full re-renders.
    el.querySelector('[data-act="ledgerBox"]')?.addEventListener('toggle', (e) => {
      ledgerOpen = e.target.open === true;
    });

    // card 13 — codes: the REAL redeem path (codesScreen.redeemCode → G53
    // engine → §B6 effects; no parallel logic).
    for (const btn of el.querySelectorAll('[data-act="codeRedeem"]')) {
      btn.addEventListener('click', async () => {
        audio.play('ui.tap');
        const res = await redeemCode({ store, ui }, btn.dataset.secret ?? '');
        if (!res.ok) {
          if (res.reason === 'already') ui.toast(tx('codes.already'));
          else if (res.reason !== 'locked') {
            audio.play('ui.error');
            ui.toast(tx('codes.wrong'));
          }
        }
        render();
      });
    }
    for (const btn of el.querySelectorAll('[data-act="codeReset"]')) {
      btn.addEventListener('click', () => {
        audio.play('ui.tap');
        const id = btn.dataset.id ?? '';
        store.update((state) => {
          if (state.codes?.redeemed) delete state.codes.redeemed[id];
        });
        store.emit?.('codesChanged', { id });
        store.flush();
        ui.toast(tx('dev.codes.resetDone'));
        render();
      });
    }
    el.querySelector('[data-act="codesLockReset"]')?.addEventListener('click', () => {
      audio.play('ui.tap');
      store.update((state) => {
        if (state.codes) state.codes.lockUntil = 0;
      });
      store.flush();
      ui.toast(tx('dev.codes.lockCleared'));
      render();
    });

    // card 14 — modifier (only wired while G54's engine is present; the
    // engine's own consume/expire keep running — no parallel scheduler).
    el.querySelector('[data-act="modGame"]')?.addEventListener('change', (e) => {
      modGame = e.target.value;
    });
    el.querySelector('[data-act="modType"]')?.addEventListener('change', (e) => {
      modType = e.target.value;
      render(); // the game dropdown re-filters to the type's eligibility row
    });
    el.querySelector('[data-act="modStart"]')?.addEventListener('click', () => {
      if (!modEngine) return;
      audio.play('ui.tap');
      const nowMs = clock.now();
      let res = { ok: false, reason: 'unknown' };
      store.update((state) => {
        ensureModifiers(state);
        const force = modEngine.forceEvent ?? modEngine.force;
        if (typeof force === 'function') {
          // G54's §B4 signature: forceEvent(state, {gameId, type}, nowMs).
          const out = force(state, { gameId: modGame, type: modType }, nowMs);
          res = out != null && typeof out === 'object' ? out : { ok: true };
          return;
        }
        // Engine has no force helper: write the documented §B4 row shape.
        const table = modEngine.TYPES ?? modEngine.MODIFIER_TYPES ?? null;
        const plays = Math.max(1, Math.floor(Number(table?.[modType]?.plays)
          || MODIFIER_PLAYS_FALLBACK[modType] || 2));
        state.modifiers.current = {
          gameId: modGame, type: modType, startedAt: nowMs,
          endsAt: nowMs + 45 * 60000, playsLeft: plays,
        };
        res = { ok: true };
      });
      if (!res.ok) {
        audio.play('ui.error');
        ui.toast(tx('dev.modifier.ineligible')); // §C-SYS4.3 matrix says no
        return;
      }
      store.emit?.('modifierChanged', {
        current: store.get('modifiers')?.current ?? null,
        nextAt: Number(store.get('modifiers')?.nextAt) || 0,
      });
      store.flush();
      ui.toast(tx('dev.modifier.started'));
      render();
    });
    el.querySelector('[data-act="modClear"]')?.addEventListener('click', () => {
      if (!modEngine) return;
      audio.play('ui.tap');
      store.update((state) => {
        ensureModifiers(state);
        if (typeof modEngine.clearEvent === 'function') modEngine.clearEvent(state);
        else state.modifiers.current = null;
      });
      store.emit?.('modifierChanged', { current: null, nextAt: Number(store.get('modifiers')?.nextAt) || 0 });
      store.flush();
      ui.toast(tx('dev.modifier.cleared'));
      render();
    });
    el.querySelector('[data-act="modNextNow"]')?.addEventListener('click', () => {
      if (!modEngine) return;
      audio.play('ui.tap');
      store.update((state) => {
        ensureModifiers(state).nextAt = clock.now(); // §C-SYS6: nextAt = now
      });
      store.emit?.('modifierChanged', {
        current: store.get('modifiers')?.current ?? null,
        nextAt: Number(store.get('modifiers')?.nextAt) || 0,
      });
      store.flush();
      ui.toast(tx('dev.modifier.nextSet'));
      render();
    });

    // card 15 — recap.
    el.querySelector('[data-act="recapPreview"]')?.addEventListener('click', () => {
      audio.play('ui.tap');
      const level = askMilestone();
      if (level == null) return;
      if (!recapPlayback) {
        ui.toast(tx('dev.recap.missing')); // wave-2 G63/G64 playback absent
        return;
      }
      try {
        // §C-SYS6 card 15: CURRENT diff, no state writes — preview mode.
        const preview = recapPlayback.previewRecap ?? recapPlayback.preview ?? recapPlayback.play;
        preview({ level, store, ui, sceneManager: deps.sceneManager, preview: true });
      } catch (err) {
        console.warn('[devPanel] recap preview failed:', err);
        ui.toast(tx('dev.recap.missing'));
      }
    });
    el.querySelector('[data-act="recapQueue"]')?.addEventListener('click', () => {
      audio.play('ui.tap');
      const level = askMilestone();
      if (level == null) return;
      // §B5.2 queue semantics (G55's engine slice): keep the LOWEST pending
      // milestone; only the play-completion path may clear it.
      store.update((state) => {
        if (state.recap == null || typeof state.recap !== 'object') {
          state.recap = { lastRecapLevel: 0, baseline: {}, baselineAt: 0, pendingLevel: 0, history: [] };
        }
        const pending = Math.floor(Number(state.recap.pendingLevel) || 0);
        if (pending === 0 || level < pending) state.recap.pendingLevel = level;
      });
      store.emit?.('recapChanged', {
        pendingLevel: Number(store.get('recap')?.pendingLevel) || 0,
        lastRecapLevel: Number(store.get('recap')?.lastRecapLevel) || 0,
      });
      store.flush();
      ui.toast(tx('dev.recap.queued', { n: level }));
      render();
    });
    el.querySelector('[data-act="recapReplay"]')?.addEventListener('click', () => {
      audio.play('ui.tap');
      const history = store.get('recap')?.history;
      const last = Array.isArray(history) ? history[history.length - 1] : null;
      if (!last) {
        ui.toast(tx('dev.recap.noHistory'));
        return;
      }
      if (!recapPlayback) {
        ui.toast(tx('dev.recap.missing'));
        return;
      }
      try {
        const replay = recapPlayback.replayRecap ?? recapPlayback.replay ?? recapPlayback.play;
        replay({ ...last, store, ui, sceneManager: deps.sceneManager, replay: true });
      } catch (err) {
        console.warn('[devPanel] recap replay failed:', err);
        ui.toast(tx('dev.recap.missing'));
      }
    });
    el.querySelector('[data-act="recapBeatDebug"]')?.addEventListener('click', () => {
      setRecapBeatDebug(!getRecapBeatDebug());
      store.emit?.('recapBeatDebugChanged', { on: getRecapBeatDebug() });
      audio.play(getRecapBeatDebug() ? 'ui.toggleOn' : 'ui.toggleOff');
      render();
    });

    // card 16 — radio (drives G51's real singleton; §C-SYS6 "no parallel path").
    el.querySelector('[data-act="radioToggle"]')?.addEventListener('click', () => {
      audio.play('ui.tap');
      try {
        if (typeof radioApi?.toggle === 'function') radioApi.toggle();
        else if (radioApi?.now?.()?.trackId) radioApi?.stop?.();
        else radioApi?.start?.();
      } catch (err) {
        console.warn('[devPanel] radio toggle failed:', err);
      }
      render();
    });
    el.querySelector('[data-act="radioSkip"]')?.addEventListener('click', () => {
      audio.play('ui.tap');
      try {
        radioApi?.skip?.();
      } catch (err) {
        console.warn('[devPanel] radio skip failed:', err);
      }
      render();
    });
    el.querySelector('[data-act="trimSel"]')?.addEventListener('change', (e) => {
      trimTrackId = e.target.value;
      render();
    });
    el.querySelector('[data-act="trimVol"]')?.addEventListener('input', (e) => {
      audio.play('ui.slider');
      const val = el.querySelector('[data-val="trimVol"]');
      if (val) val.textContent = String(Math.round(Number(e.target.value) || 100));
    });
    el.querySelector('[data-act="trimVol"]')?.addEventListener('change', (e) => {
      const vol = Math.min(150, Math.max(0, Math.round(Number(e.target.value) || 100)));
      const id = trimTrackId;
      if (!id) return;
      if (typeof radioApi?.setTrim === 'function') {
        // G51 engine present: setTrim(id, patch) persists + retunes live gain.
        try { radioApi.setTrim(id, { vol }); } catch (err) { console.warn('[devPanel] setTrim failed:', err); }
      } else {
        store.update((state) => {
          if (state.radio == null || typeof state.radio !== 'object') state.radio = {};
          if (state.radio.trims == null || typeof state.radio.trims !== 'object') state.radio.trims = {};
          // §B1: only non-default entries stored.
          if (vol === 100 && state.radio.trims[id]?.on !== false) delete state.radio.trims[id];
          else state.radio.trims[id] = { vol, on: state.radio.trims[id]?.on !== false };
        });
        store.flush(); // persisted trim applies once the engine lands
      }
    });

    // card 17 — jump list + splat teleport.
    for (const btn of el.querySelectorAll('[data-act="jumpScene"], [data-act="jumpSplat"]')) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id ?? '';
        const sm = deps.sceneManager;
        if (!sm?.has?.(id) || sm.isSwitching?.()) return;
        audio.play('ui.tap');
        if (btn.dataset.act === 'jumpSplat') setOverlay(deps, true); // fps/draw readout
        ui.closeAll();
        sm.switchTo(id);
      });
    }
    for (const btn of el.querySelectorAll('[data-act="jumpScreen"]')) {
      btn.addEventListener('click', () => {
        audio.play('ui.tap');
        ui.showScreen(btn.dataset.id ?? '');
      });
    }
    for (const btn of el.querySelectorAll('[data-act="jumpPanel"]')) {
      btn.addEventListener('click', () => {
        audio.play('ui.tap');
        ui.openPanel(btn.dataset.id ?? ''); // unknown ids toast via ui.js
      });
    }

    // card 18 — cheat-sheet copy buttons.
    for (const btn of el.querySelectorAll('[data-act="cheatCopy"]')) {
      btn.addEventListener('click', async () => {
        audio.play('ui.tap');
        const example = btn.dataset.example ?? '';
        try {
          await navigator.clipboard.writeText(example);
          ui.toast(tx('dev.cheat.copied', { p: example }));
        } catch {
          globalThis.prompt?.(tx('dev.cheat.copy'), example); // clipboard blocked
        }
      });
    }
  }

  // Live value labels while other systems mutate state (tick, economy…).
  mounted.offs.push(
    store.on('coinsChanged', () => {
      const val = el.querySelector('[data-val="coins"]');
      if (val) val.textContent = String(store.get('coins') ?? 0);
    }),
    store.on('xpChanged', () => {
      const val = el.querySelector('[data-val="level"]');
      if (val) val.textContent = String(store.get('level') ?? 1);
    })
  );

  // V4/G58 — cards 13–16 follow their §B10 runtime events + a 1 s repaint
  // for the countdown labels (modifier endsAt / codes lock / radio position).
  mounted.offs.push(
    store.on?.('modifierChanged', render) ?? (() => {}),
    store.on?.('codesChanged', render) ?? (() => {}),
    store.on?.('recapChanged', render) ?? (() => {}),
    store.on?.('radioChanged', () => {
      const val = el.querySelector('[data-val="radioNow"]');
      if (val) val.textContent = radioReadout();
    }) ?? (() => {})
  );
  const g58Tick = setInterval(() => {
    const modVal = el.querySelector('[data-val="modState"]');
    if (modVal) modVal.textContent = modReadout();
    const radioVal = el.querySelector('[data-val="radioNow"]');
    if (radioVal) radioVal.textContent = radioReadout();
  }, 1000);
  mounted.offs.push(() => clearInterval(g58Tick));

  render();
}

/** Unmount (overlay/notch toggles stay — they are global dev aids). */
export function unmountDevPanel() {
  if (!mounted) return;
  for (const off of mounted.offs) off?.();
  mounted = null;
}
