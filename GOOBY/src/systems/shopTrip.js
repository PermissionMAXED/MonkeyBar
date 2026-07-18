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
//
// V2/G21 (PLAN2 §C9.2): the machine gains a SIBLING destination — the vet
// clinic. mode='vetTrip' rides the exact same states ('shop' semantically
// reads "at the destination"), the vet route + 10 pickups from cityBuilder,
// identical §C4 crash/tow rules, and hands off to ui/vetPanel.js on arrival.
// Entry points: front door / HUD button → destination picker sheet („Laden /
// Tierarzt" with prices) once the vet is discovered (isVetDiscovered), plus
// G20's careSheet store event 'vetTripRequested' (straight to the vet
// confirm). Landmark sticker + distance events from cityDrive land here too
// (the drive plugin has no store access — see games/cityDrive.js).

import { DRIVE, COIN_TABLE, MINIGAME, VET } from '../data/constants.js'; // V2/G21: + VET (§C9.2)
import { t } from '../data/strings.js';
import { registerShopScreen } from '../ui/shopScreen.js';
import { registerVetPanel } from '../ui/vetPanel.js'; // V2/G21 (§C9.2)
import { award as awardSticker } from './collections.js'; // V2/G21 (§C9.3)
import { onDistance } from './profileStats.js'; // V2/G21 (§C12.1)

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
 * V2/G21: vetTrip uses the identical trip math (§C9.2 — same crash/tow
 * rules; only the pickup COUNT differs, and that lives in the layout).
 * Arcade (§C4.7) = collected coins, clamped to the §C6 table max.
 * @param {{mode?: 'shopTrip'|'vetTrip'|'arcade', pickups?: number,
 *   crashes?: number, towed?: boolean}} result
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
 * @param {'shopTrip'|'vetTrip'|'arcade'|string} mode
 * @returns {boolean}
 */
export function isShopHandoff(mode) {
  return mode === 'shopTrip';
}

// ── V2/G21: vetTrip mode helpers (§C9.2, pure) ──────────────────────────────

/**
 * Whether a drive result hands off to the vet arrival panel (§C9.2).
 * @param {'shopTrip'|'vetTrip'|'arcade'|string} mode
 * @returns {boolean}
 */
export function isVetHandoff(mode) {
  return mode === 'vetTrip';
}

/**
 * Guided-trip modes sharing the §C4 machine, route guidance and crash/tow
 * rules (consumed by games/cityDrive.js and G28's deliveryRush spec).
 * @param {string} mode
 * @returns {boolean}
 */
export function isTripMode(mode) {
  return mode === 'shopTrip' || mode === 'vetTrip';
}

/**
 * §C9.2: the front-door/HUD entry shows the destination picker only "once
 * the vet is discovered" — pure on the §B2 save state so tests cover it
 * headlessly. Discovered means: a completed vet trip (counter), the
 * vetClinic landmark sticker (drove within 15 m of the clinic), or Gooby
 * currently unwell (a sick Gooby must always be able to find the vet).
 * @param {object} state §B2 save-state root (store.get())
 * @returns {boolean}
 */
export function isVetDiscovered(state) {
  if ((state?.achievements?.counters?.vetTrips ?? 0) >= 1) return true;
  if ((state?.collections?.entries?.['landmarks.vetClinic'] ?? 0) >= 1) return true;
  const h = state?.health?.state;
  return h === 'queasy' || h === 'sick';
}
// ── end V2/G21 ──────────────────────────────────────────────────────────────

/**
 * V2/FIX-C P2-7: whether a trip confirm/destination sheet may OPEN at all.
 * Pure on the §B2 save state. A sleeping Gooby can't be taken on a trip —
 * the framework already refuses the drive cleanly, but the sheet shouldn't
 * even offer (toast 'toast.sleeping' instead).
 * @param {object} state §B2 save-state root (store.get())
 * @returns {{ok: boolean, reason?: 'sleeping'}}
 */
export function canRequestTrip(state) {
  if (state?.sleep?.sleeping) return { ok: false, reason: 'sleeping' };
  return { ok: true };
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
  /** V2/G21 (§C9.2): destination of the trip in flight ('shopTrip'|'vetTrip'). */
  let tripMode = 'shopTrip';

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

  // ── V2/G21: vet confirm sheet + destination picker (§C9.2) ────────────────
  // Vet confirm („Zum Tierarzt fahren? Behandlung 120 Münzen").
  ui.registerPanel('vetTripConfirm', {
    /** @param {HTMLElement} el */
    mount(el) {
      el.innerHTML = `
        <div style="text-align:center">
          <h2 class="perm-title">${t('vet.confirm')}</h2>
          <p class="perm-body">${t('vet.confirmBody', {
            price: VET.CURE_PRICE,
            energy: MINIGAME.DRIVE_ENERGY_COST,
          })}</p>
          <div class="mg-btn-row">
            <button class="btn btn-teal vet-trip-yes">${t('trip.go')}</button>
            <button class="btn btn-ghost vet-trip-no">${t('ui.later')}</button>
          </div>
        </div>`;
      el.querySelector('.vet-trip-yes').addEventListener('click', () => {
        ui.closePanel('vetTripConfirm');
        startTrip('vetTrip');
      });
      el.querySelector('.vet-trip-no').addEventListener('click', () => ui.closePanel('vetTripConfirm'));
    },
    unmount() {},
  });

  // Destination picker sheet („Laden / Tierarzt" with prices) — the front
  // door / HUD entry once the vet is discovered; each option opens its
  // destination's confirm sheet. G28's deliveryRush reuses this flow.
  ui.registerPanel('cityDestinations', {
    /** @param {HTMLElement} el */
    mount(el) {
      el.innerHTML = `
        <div class="dest-pick">
          <h2 class="perm-title">${t('city.dest.title')}</h2>
          <button class="dest-option dest-opt-shop">
            <span class="dest-emoji" aria-hidden="true">🛒</span>
            <span class="dest-text">
              <span class="dest-name">${t('city.dest.shop')}</span>
              <span class="dest-sub">${t('city.dest.shopSub', { energy: MINIGAME.DRIVE_ENERGY_COST })}</span>
            </span>
          </button>
          <button class="dest-option dest-opt-vet">
            <span class="dest-emoji" aria-hidden="true">🩺</span>
            <span class="dest-text">
              <span class="dest-name">${t('city.dest.vet')}</span>
              <span class="dest-sub">${t('city.dest.vetSub', { cure: VET.CURE_PRICE, checkup: VET.CHECKUP_PRICE })}</span>
            </span>
          </button>
          <button class="btn btn-ghost dest-later">${t('ui.later')}</button>
        </div>`;
      el.querySelector('.dest-opt-shop').addEventListener('click', () => {
        audio.play('ui.pick');
        ui.closePanel('cityDestinations');
        ui.openPanel('shopTripConfirm');
      });
      el.querySelector('.dest-opt-vet').addEventListener('click', () => {
        audio.play('ui.pick');
        ui.closePanel('cityDestinations');
        ui.openPanel('vetTripConfirm');
      });
      el.querySelector('.dest-later').addEventListener('click', () => ui.closePanel('cityDestinations'));
    },
    unmount() {},
  });
  // ── end V2/G21 ─────────────────────────────────────────────────────────────

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

  // V2/G21: the vet arrival panel (§C9.2) — same registration pattern.
  registerVetPanel({
    store,
    ui,
    audio,
    goHome: () => goHome(),
    getArrival: () => lastArrival,
    isVetArrival: () => machine.state() === TRIP_STATE.SHOP && tripMode === 'vetTrip',
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

  // ── V2/G21: destination handoff (§C9.2) ────────────────────────────────────
  /** Opens the vet panel over the parked-at-the-clinic backdrop. */
  function openVet() {
    ui.closeAll();
    ui.showScreen('vetPanel');
  }

  /** Post-results handoff for the trip in flight (shop screen or vet panel). */
  function openDestination() {
    if (tripMode === 'vetTrip') openVet();
    else openShop();
  }
  // ── end V2/G21 ─────────────────────────────────────────────────────────────

  // Autopilot (dev, §G G7 DoD): state-polled auto-advance results → shop →
  // home so a full trip completes headlessly without manual input (polling
  // instead of one-shot timers keeps it robust under virtual-time headless
  // Chrome where timer and rAF clocks drift apart).
  // V2/G21: vet trips auto-advance results → vetPanel and STOP there — the
  // cure/checkup interaction is the point of the trip (CDP scripts click it).
  if (autopilot) {
    let shopOpenedAt = 0;
    setInterval(() => {
      if (machine.state() !== TRIP_STATE.SHOP) return;
      if (ui.activeScreenId?.() === 'mgResults') {
        // equivalent of tapping "Home" on the results screen
        shopOpenedAt = tripMode === 'vetTrip' ? 0 : Date.now(); // V2/G21
        openDestination(); // V2/G21: shop screen or vet panel
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
    if (result?.towed) store.emit?.('stickerHook', { id: 'towed' }); // V3/G35 (§C5.4): tow-cutscene sticker hook
    // shop-trip counter for the firstDrive/drive25 achievements (§C8.3 — G12
    // reads achievements.counters.trips). V2/G21: EVERY guided trip counts as
    // a trip; vet arrivals additionally bump vetTrips (§C9.2 — discovery +
    // the §C5.3 vet achievements).
    store.update((state) => {
      state.achievements.counters.trips = (state.achievements.counters.trips ?? 0) + 1;
      if (tripMode === 'vetTrip') {
        state.achievements.counters.vetTrips = (state.achievements.counters.vetTrips ?? 0) + 1;
      }
    });
  }

  /** Framework hands the exit back after the results screen (§E8 onExit). */
  function onExit() {
    if (machine.state() === TRIP_STATE.SHOP) openDestination(); // V2/G21
    else {
      machine.cancel();
      ui.closeAll();
      sceneManager
        .switchTo('home', { room: 'living' })
        .catch((err) => console.error('[shopTrip] exit home failed:', err));
    }
  }

  /**
   * Launch the drive (§C4.2) — the framework re-checks sleep/energy.
   * V2/G21: `mode` picks the destination ('shopTrip' default | 'vetTrip').
   * @param {'shopTrip'|'vetTrip'} [mode]
   */
  async function startTrip(mode = 'shopTrip') {
    if (machine.state() !== TRIP_STATE.HOME) machine.cancel();
    tripMode = isTripMode(mode) ? mode : 'shopTrip'; // V2/G21
    machine.startTrip();
    audio.play('ui.open');
    let ok = await framework.launch('cityDrive', { mode: tripMode, onArrive, onExit });
    // a scene fade in progress makes sceneManager ignore the switch — treat
    // that as "not launched" so callers (confirm sheet / dev kick) can retry
    if (ok && sceneManager.currentId?.() !== 'minigame') ok = false;
    if (!ok) machine.cancel();
    return ok;
  }

  /**
   * Entry point for the HUD button + front door: confirm sheet first.
   * V2/G21 (§C9.2): once the vet is discovered the destination picker opens
   * instead („Laden / Tierarzt" with prices) — its options lead to the same
   * confirm sheets.
   */
  function requestShopTrip() {
    if (machine.state() !== TRIP_STATE.HOME) return; // already out
    if (sceneManager.currentId?.() === 'minigame') return;
    if (!canRequestTrip(store.get()).ok) return ui.toast('toast.sleeping'); // V2/FIX-C P2-7
    if (isVetDiscovered(store.get())) ui.openPanel('cityDestinations'); // V2/G21
    else ui.openPanel('shopTripConfirm');
  }

  // ── V2/G21: vet entry points + cityDrive store bridges (§C9.2/§C9.3) ──────
  /** HUD 🤒 chip / careSheet vet button: straight to the vet confirm sheet. */
  function requestVetTrip() {
    if (machine.state() !== TRIP_STATE.HOME) return; // already out
    if (sceneManager.currentId?.() === 'minigame') return;
    if (!canRequestTrip(store.get()).ok) return ui.toast('toast.sleeping'); // V2/FIX-C P2-7
    ui.openPanel('vetTripConfirm');
  }

  // V2/G20 contract: ui/careSheet.js emits the runtime-only store event
  // 'vetTripRequested' (store.emit — returns the listener count so the sheet
  // can show a graceful fallback when this flow isn't wired yet).
  store.on('vetTripRequested', requestVetTrip);

  // §C9.3 landmark stickers: games/cityDrive.js has no store access, so it
  // dispatches a SYNCHRONOUS window event per landmark radius entry. The
  // award happens here; `detail.first` is reflected back (dispatchEvent runs
  // listeners synchronously) so the drive can play the one-time camera-flash
  // gag. Toast + sfx only on a first-time sticker.
  window.addEventListener('gooby:landmark', (e) => {
    const id = e?.detail?.id;
    if (!id) return;
    let first = false;
    store.update((state) => {
      const res = awardSticker(state.collections, 'landmarks', id);
      state.collections = res.c;
      first = res.first;
    });
    if (first) {
      e.detail.first = true;
      ui.toast('landmark.found', { name: t(`sticker.landmarks.${id}.name`) });
      audio.play('landmark.found');
    }
  });

  // §C12.1 distance feed: cityDrive reports accumulated meters (end of run /
  // dispose fallback) → profile.distanceM via the pure profileStats helper.
  window.addEventListener('gooby:driveDistance', (e) => {
    const meters = Number(e?.detail?.meters) || 0;
    if (meters <= 0) return;
    store.update((state) => {
      state.profile = onDistance(state.profile, meters);
    });
  });
  // ── end V2/G21 ─────────────────────────────────────────────────────────────

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
  // V2/G21: ?vettrip=1 does the same for the vet trip (§C9.2 CDP proof).
  const devTripMode = urlFlag('vettrip') ? 'vetTrip' : urlFlag('shoptrip') ? 'shopTrip' : null;
  if (devTripMode) {
    let tries = 0;
    let starting = false;
    const kick = setInterval(async () => {
      tries += 1;
      if (tries > 60) return clearInterval(kick);
      // retry until the launch actually lands (a boot-time scene fade makes
      // sceneManager ignore switches, so the first attempt can be a no-op)
      if (starting || sceneManager.currentId?.() !== 'home' || machine.state() !== TRIP_STATE.HOME) return;
      starting = true;
      const ok = await startTrip(devTripMode).catch(() => false);
      starting = false;
      if (ok) clearInterval(kick);
    }, 400);
  }

  return { machine, requestShopTrip, requestVetTrip, startTrip };
}
