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

// G34's sticker catalog — resolved at transform time; empty map while the
// file doesn't exist (main.js glob pattern — do not convert to static import).
const stickerCatalogModules = import.meta.glob('../data/stickers.js');

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
  let str = (getLang() === 'de' ? DEV_DE : DEV_EN)[key];
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
      </div>`;

    wire();
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

  render();
}

/** Unmount (overlay/notch toggles stay — they are global dev aids). */
export function unmountDevPanel() {
  if (!mounted) return;
  for (const off of mounted.offs) off?.();
  mounted = null;
}
