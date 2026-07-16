// Shop trip (§C4) — the mandatory-but-fun driving loop. Pure state machine
// `home → driveOut → shop → home` (return teleports, no return drive) plus
// the §C4.3 reward math, both headlessly testable (test/shopTrip.test.js —
// this module imports no three.js/DOM per §B).
//
// The runtime wiring (initShopTrip) is DI-based: it receives store/ui/audio/
// framework/sceneManager from the marked G7 hook in ui/hud.js, consumes the
// HUD button's `gooby:shopTrip` window event, subscribes to the living-room
// front door (roomManager `tap:frontDoor`, G4 contract), shows the confirm
// sheet („Zum Laden fahren?"), launches the cityDrive minigame with
// params.mode='shopTrip', and on arrival opens the interim shop panel.
// Rewards are paid immediately on arrival by the framework's onEnd payout
// (cityDrive passes the §C4.3 coins as the override — see games/cityDrive.js).
//
// Flow detail (§C4):
//   1. front door / HUD shop button → confirm sheet → startTrip()
//   2. framework.launch('cityDrive', { mode:'shopTrip', onArrive, onExit })
//   3. cityDrive calls onArrive(result) at the parking trigger (or after the
//      tow cutscene) → machine 'driveOut' → 'shop', trips counter ++
//   4. results screen "Home" → onExit → shop panel over the parked-car scene
//   5. "Nach Hause / Go home" → fade → living room (machine → 'home')
//   Quit from pause before arrival → onExit cancels back home (no shop).

import { DRIVE, COIN_TABLE, MINIGAME } from '../data/constants.js';
import { t } from '../data/strings.js';
import { registerShopScreen } from '../ui/shopScreen.js';

// ---------------------------------------------------------------------------
// Pure state machine (§C4: home → driveOut → shop → home)
// ---------------------------------------------------------------------------

/** @type {Readonly<{HOME: 'home', DRIVE_OUT: 'driveOut', SHOP: 'shop'}>} */
export const TRIP_STATE = Object.freeze({ HOME: 'home', DRIVE_OUT: 'driveOut', SHOP: 'shop' });

/** @typedef {'home'|'driveOut'|'shop'} TripState */
/** @typedef {'start'|'arrive'|'goHome'|'cancel'} TripEvent */

/**
 * Pure transition table. Invalid events leave the state unchanged (the loop
 * is forgiving — §C4.5 "never a hard fail"). `arrive` while already at the
 * shop is idempotent (results-screen "play again" re-arrivals).
 * @param {TripState} state
 * @param {TripEvent} event
 * @returns {TripState}
 */
export function tripTransition(state, event) {
  switch (state) {
    case TRIP_STATE.HOME:
      return event === 'start' ? TRIP_STATE.DRIVE_OUT : TRIP_STATE.HOME;
    case TRIP_STATE.DRIVE_OUT:
      if (event === 'arrive') return TRIP_STATE.SHOP;
      if (event === 'cancel' || event === 'goHome') return TRIP_STATE.HOME;
      return TRIP_STATE.DRIVE_OUT;
    case TRIP_STATE.SHOP:
      if (event === 'goHome' || event === 'cancel') return TRIP_STATE.HOME;
      return TRIP_STATE.SHOP;
    default:
      return TRIP_STATE.HOME;
  }
}

/**
 * Stateful wrapper around tripTransition.
 * @param {(state: TripState, event: TripEvent) => void} [onChange] fired on
 *   every actual state change
 * @returns {{state: () => TripState, startTrip: () => boolean,
 *   arrive: () => boolean, goHome: () => boolean, cancel: () => boolean}}
 */
export function createTripMachine(onChange) {
  /** @type {TripState} */
  let state = TRIP_STATE.HOME;
  const fire = (event) => {
    const next = tripTransition(state, event);
    const changed = next !== state;
    state = next;
    if (changed) onChange?.(state, event);
    return changed;
  };
  return {
    state: () => state,
    startTrip: () => fire('start'),
    arrive: () => fire('arrive'),
    goHome: () => fire('goHome'),
    cancel: () => fire('cancel'),
  };
}

// ---------------------------------------------------------------------------
// Reward math (§C4.3 / §C4.5) — pure
// ---------------------------------------------------------------------------

/**
 * Coins earned by a drive (paid via the framework's onEnd coin override):
 * shopTrip = pickups ×1c + arrival +10c + zero-crash +5c; a tow (§C4.5)
 * forfeits both bonuses (car still placed at the shop — never a hard fail).
 * Arcade (§C4.7) = collected coins, clamped to the §C6 table max.
 * @param {{mode?: 'shopTrip'|'arcade', pickups?: number, crashes?: number,
 *   towed?: boolean}} result
 * @returns {number}
 */
export function driveRewards({ mode = 'shopTrip', pickups = 0, crashes = 0, towed = false } = {}) {
  const collected = Math.max(0, Math.floor(pickups)) * DRIVE.PICKUP_COINS;
  if (mode === 'arcade') {
    return Math.min(collected, COIN_TABLE.cityDrive.max);
  }
  const arrival = towed ? 0 : DRIVE.ARRIVAL_BONUS;
  const zeroCrash = !towed && crashes === 0 ? DRIVE.ZERO_CRASH_BONUS : 0;
  return collected + arrival + zeroCrash;
}

/**
 * Whether a drive result may hand off to the shop (§C4.7: arcade mode ends
 * on the normal results screen — no shop).
 * @param {'shopTrip'|'arcade'|string} mode
 * @returns {boolean}
 */
export function isShopHandoff(mode) {
  return mode === 'shopTrip';
}

// ---------------------------------------------------------------------------
// Runtime wiring (DOM/scene work only happens inside the injected deps'
// callbacks — this module still imports no DOM/three).
// ---------------------------------------------------------------------------

let wired = false;

/**
 * Wire the §C4 shop-trip flow. Idempotent; called from the marked G7 hook in
 * ui/hud.js at boot.
 * @param {{store: object, ui: object, audio: object,
 *   framework: {launch: Function}, sceneManager: object}} deps
 * @returns {{machine: ReturnType<typeof createTripMachine>,
 *   requestShopTrip: () => void, startTrip: () => Promise<boolean>}|null}
 */
export function initShopTrip({ store, ui, audio, framework, sceneManager }) {
  if (wired) return null;
  wired = true;

  const machine = createTripMachine((state, event) => {
    if (isDev) console.info(`[shopTrip] ${event} → ${state}`);
  });
  /** Last arrival result from cityDrive (for the shop panel / autopilot). */
  let lastArrival = null;

  const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  const urlFlag = (name) =>
    isDev && typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get(name) === '1';
  const autopilot = urlFlag('autopilot');

  // ---------------------------------------------------------------- panels
  // Confirm sheet (§C4.1: „Zum Laden fahren? / Drive to the shop?").
  ui.registerPanel('shopTripConfirm', {
    /** @param {HTMLElement} el */
    mount(el) {
      el.innerHTML = `
        <div style="text-align:center">
          <h2 class="perm-title">${t('trip.confirm')}</h2>
          <p class="perm-body">${t('trip.confirmBody', { energy: MINIGAME.DRIVE_ENERGY_COST })}</p>
          <div class="mg-btn-row">
            <button class="btn btn-teal trip-yes">${t('trip.go')}</button>
            <button class="btn btn-ghost trip-no">${t('ui.later')}</button>
          </div>
        </div>`;
      el.querySelector('.trip-yes').addEventListener('click', () => {
        ui.closePanel('shopTripConfirm');
        startTrip();
      });
      el.querySelector('.trip-no').addEventListener('click', () => ui.closePanel('shopTripConfirm'));
    },
    unmount() {},
  });

  // G11: the real shop UI (§C5) — ui/shopScreen.js registers the 'shop'
  // full-screen (trip + browse modes, quick-delivery order flow) and boots the
  // decor wiring (home/decor.js). Arrival hands off via openShop() below.
  registerShopScreen({
    store,
    ui,
    audio,
    goHome: () => goHome(),
    getArrival: () => lastArrival,
    isAtShop: () => machine.state() === TRIP_STATE.SHOP,
  });

  // ---------------------------------------------------------------- flow
  /** §C4.4: "Go home" → fade → living room (return teleports, no drive). */
  function goHome() {
    machine.goHome();
    ui.closeAll();
    sceneManager
      .switchTo('home', { room: 'living' })
      .catch((err) => console.error('[shopTrip] return home failed:', err));
  }

  /** Opens the shop over the parked-at-the-shop backdrop (state 'shop'). */
  function openShop() {
    ui.closeAll();
    ui.showScreen('shop', { mode: 'trip' }); // G11: real shop UI (§C5)
  }

  // Autopilot (dev, §G G7 DoD): state-polled auto-advance results → shop →
  // home so a full trip completes headlessly without manual input (polling
  // instead of one-shot timers keeps it robust under virtual-time headless
  // Chrome where timer and rAF clocks drift apart).
  if (autopilot) {
    let shopOpenedAt = 0;
    setInterval(() => {
      if (machine.state() !== TRIP_STATE.SHOP) return;
      if (ui.activeScreenId?.() === 'mgResults') {
        // equivalent of tapping "Home" on the results screen
        shopOpenedAt = Date.now();
        openShop();
      } else if (shopOpenedAt > 0 && Date.now() - shopOpenedAt > 2000) {
        goHome(); // equivalent of tapping "Nach Hause / Go home"
        shopOpenedAt = 0;
      }
    }, 600);
  }

  /** cityDrive calls this at the parking trigger / after the tow (§C4.3/.5). */
  function onArrive(result) {
    lastArrival = result;
    machine.arrive();
    // shop-trip counter for the firstDrive/drive25 achievements (§C8.3 — G12
    // reads achievements.counters.trips).
    store.update((state) => {
      state.achievements.counters.trips = (state.achievements.counters.trips ?? 0) + 1;
    });
  }

  /** Framework hands the exit back after the results screen (§E8 onExit). */
  function onExit() {
    if (machine.state() === TRIP_STATE.SHOP) openShop();
    else {
      machine.cancel();
      ui.closeAll();
      sceneManager
        .switchTo('home', { room: 'living' })
        .catch((err) => console.error('[shopTrip] exit home failed:', err));
    }
  }

  /** Launch the drive (§C4.2) — the framework re-checks sleep/energy. */
  async function startTrip() {
    if (machine.state() !== TRIP_STATE.HOME) machine.cancel();
    machine.startTrip();
    audio.play('ui.open');
    let ok = await framework.launch('cityDrive', { mode: 'shopTrip', onArrive, onExit });
    // a scene fade in progress makes sceneManager ignore the switch — treat
    // that as "not launched" so callers (confirm sheet / dev kick) can retry
    if (ok && sceneManager.currentId?.() !== 'minigame') ok = false;
    if (!ok) machine.cancel();
    return ok;
  }

  /** Entry point for the HUD button + front door: confirm sheet first. */
  function requestShopTrip() {
    if (machine.state() !== TRIP_STATE.HOME) return; // already out
    if (sceneManager.currentId?.() === 'minigame') return;
    ui.openPanel('shopTripConfirm');
  }

  // ---------------------------------------------------------------- wiring
  // HUD shop button (ui/hud.js dispatches this — marked G7 hook).
  window.addEventListener('gooby:shopTrip', requestShopTrip);

  // ── G7 front-door wiring (the single marked G7 room hook) ────────────────
  // The living-room front door emits roomManager 'tap:frontDoor' (G4). The
  // room manager is recreated on every home-scene enter, so poll the module
  // accessor and re-subscribe whenever a new instance appears (same guarded
  // dynamic-import pattern as ui/sleepFlow.js — never breaks node tests).
  let lastRm = null;
  setInterval(async () => {
    try {
      const mod = await import('../home/homeScene.js');
      const rm = mod.getRoomManager?.();
      if (rm && rm !== lastRm && typeof rm.on === 'function') {
        lastRm = rm;
        rm.on('tap:frontDoor', requestShopTrip);
      }
    } catch { /* home scene not present yet */ }
  }, 1000);
  // ── end G7 front-door wiring ──────────────────────────────────────────────

  // Dev-harness extension (§E9 spirit, dev only): ?shoptrip=1 starts the trip
  // right after boot (skips the confirm sheet) so the full §C4 loop is
  // demonstrable headlessly; combine with ?autopilot=1 for a hands-free trip.
  if (urlFlag('shoptrip')) {
    let tries = 0;
    let starting = false;
    const kick = setInterval(async () => {
      tries += 1;
      if (tries > 60) return clearInterval(kick);
      // retry until the launch actually lands (a boot-time scene fade makes
      // sceneManager ignore switches, so the first attempt can be a no-op)
      if (starting || sceneManager.currentId?.() !== 'home' || machine.state() !== TRIP_STATE.HOME) return;
      starting = true;
      const ok = await startTrip().catch(() => false);
      starting = false;
      if (ok) clearInterval(kick);
    }, 400);
  }

  return { machine, requestShopTrip, startTrip };
}
