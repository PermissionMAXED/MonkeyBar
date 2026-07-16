// Sleep flow integration (§C1.4) — owns everything between the pure state
// machine (systems/sleep.js) and the screen: the lamp-tap flow, bedroom night
// mode, Gooby's sleep/wake clips, the HUD countdown chip (a DOM element in
// #ui), the early-wake confirm sheet, the bedroom room-lock and the
// completed-sleep grants (the live 1 s auto-wake is core/timeEngine.js, which
// clears `state.sleep` without grants — this module observes 'sleepChanged'
// and applies XP/counters exactly once).
//
// Integration surface consumed (G4, home/homeScene.js module exports):
//   getRoomManager() → rm.on('tap:lampSwitch'|'tap:bed'|'roomChanged'),
//   rm.getAnchor('bed','bedroom') → THREE.Vector3, rm.goTo(roomId),
//   setNight(on), getGooby() → §D2.3 rig. Handles can be passed straight into
//   initSleepFlow or arrive via the guarded dynamic-import hook below.

import { SLEEP } from '../data/constants.js';
import { t } from '../data/strings.js';
import audio from '../audio/audio.js'; // G14: snore loop + wake yawn (§D6)
import { now } from '../core/clock.js';
import * as notifications from '../core/notifications.js';
import {
  canSleep,
  canWakeEarly,
  isSleeping,
  startSleep,
  wakeUp,
  applyCompletedSleepGrants,
  sleepRemainingMs,
} from '../systems/sleep.js';
import { maybeSoftAsk } from './permissionPrompt.js';

/** Chip refresh cadence (real ms — content shows game-time remaining). */
const CHIP_TICK_MS = 500;
/** Delay before posing Gooby in bed, so the room pan + hop finish first (ms). */
const POSE_DELAY_MS = 750;

/**
 * Wire the sleep flow. store + ui are required; the home-scene handles are
 * optional and feature-detected (they self-wire via the dynamic-import hook
 * below, or the coordinator passes them explicitly).
 * @param {{
 *   store: object, ui: object,
 *   roomManager?: object, homeScene?: object, gooby?: object,
 * }} deps homeScene may be the module namespace of home/homeScene.js
 *   (it exports setNight/getGooby at module level) or a scene instance.
 * @returns {{requestSleepToggle: () => void, wireHome: (handles: object) => void}}
 */
export function initSleepFlow({ store, ui, roomManager, homeScene, gooby }) {
  /** @type {HTMLElement|null} */
  let chipEl = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let chipTimer = null;
  /** True while THIS module performs the wake (skip the observer's grant). */
  let selfWake = false;
  /** Sleep observed in-session (offline wakes already got grants in the sim). */
  let sawSleeping = isSleeping(store.get());
  let homeWired = false;
  /** @type {ReturnType<typeof setTimeout>|null} pending bed-pose timer */
  let poseTimer = null;

  function safeCall(fn) {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------- chip
  function fmtMmSs(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')}`;
  }

  function updateChip() {
    if (!chipEl) return;
    const state = store.get();
    chipEl.querySelector('.sleep-chip-time').textContent = fmtMmSs(sleepRemainingMs(state, now()));
    chipEl.querySelector('.sleep-chip-energy').textContent = `⚡ ${Math.round(state.stats.energy)}%`;
  }

  function showChip() {
    if (chipEl) return;
    chipEl = document.createElement('div');
    chipEl.className = 'sleep-chip';
    chipEl.setAttribute('role', 'status');
    chipEl.setAttribute('aria-label', t('toast.sleeping'));
    chipEl.innerHTML =
      '<span class="sleep-chip-zzz">💤</span><span class="sleep-chip-time"></span><span class="sleep-chip-energy"></span>';
    chipEl.addEventListener('click', () => openWakeSheet());
    ui.el.appendChild(chipEl);
    updateChip();
    chipTimer = setInterval(updateChip, CHIP_TICK_MS);
  }

  function hideChip() {
    if (chipTimer != null) clearInterval(chipTimer);
    chipTimer = null;
    chipEl?.remove();
    chipEl = null;
  }

  // ---------------------------------------------------------------- scene glue
  function getGoobyRig() {
    return gooby ?? safeCall(() => homeScene?.getGooby?.()) ?? null;
  }

  /** Pose Gooby in/out of bed + play the sleep/wake clips (feature-detected). */
  function poseGooby(sleeping) {
    const g = getGoobyRig();
    if (!g) return;
    try {
      if (sleeping) {
        const anchor = safeCall(() => roomManager?.getAnchor?.('bed', 'bedroom'));
        if (anchor && g.group) {
          if (anchor.isVector3) g.group.position.copy(anchor);
          else if (Number.isFinite(anchor.x)) g.group.position.set(anchor.x, anchor.y ?? 0, anchor.z ?? 0);
        }
        g.setEmotion?.('sleepy');
        g.play?.('sleep', { loop: true });
      } else {
        g.stop?.('sleep');
        const wakePromise = g.play?.('wake');
        wakePromise?.then?.(() => g.play?.('idle', { loop: true }));
      }
    } catch (err) {
      console.warn('[sleepFlow] Gooby sleep pose failed:', err?.message);
    }
  }

  /** Night mode + move to the bedroom + (delayed) bed pose. */
  function enterSleepScene() {
    safeCall(() => (homeScene?.setNight ?? (() => {}))(true));
    const rm = roomManager;
    if (rm?.goTo && safeCall(() => rm.activeRoom?.()) !== 'bedroom') rm.goTo('bedroom');
    // Wait out the camera pan + Gooby's hop-along before lying him down.
    if (poseTimer != null) clearTimeout(poseTimer);
    poseTimer = setTimeout(() => {
      poseTimer = null;
      if (isSleeping(store.get())) poseGooby(true);
    }, POSE_DELAY_MS);
  }

  function exitSleepScene() {
    if (poseTimer != null) clearTimeout(poseTimer);
    poseTimer = null;
    safeCall(() => (homeScene?.setNight ?? (() => {}))(false));
    poseGooby(false);
  }

  // ---------------------------------------------------------------- transitions
  function startSleepFlow() {
    store.update((state) => Object.assign(state, startSleep(state, now())));
    ui.toast('toast.fellAsleep');
    // First time Gooby falls asleep → notification soft-ask (§C7).
    maybeSoftAsk({ store, ui });
    // Wake notification at wakeAt (§C1.4) — adapter no-ops without permission.
    notifications.rescheduleAll(store.get());
  }

  function earlyWake() {
    selfWake = true;
    store.update((state) => Object.assign(state, wakeUp(state, now(), { early: true }).state));
    ui.toast('toast.wokeEarly');
  }

  /** Every sleep transition funnels through the store event (§E2). */
  function onSleepChanged(sleep) {
    if (sleep?.sleeping) {
      sawSleeping = true;
      audio.play('gooby.snore'); // G14: snore loop while asleep (§D6)
      showChip();
      enterSleepScene();
      return;
    }
    audio.stop('gooby.snore'); // G14: end snore loop
    hideChip();
    if (!sawSleeping) return; // boot flush / offline wake (grants already applied)
    sawSleeping = false;
    audio.play('gooby.yawn'); // G14: wake yawn (§D6)
    const early = selfWake;
    selfWake = false;
    if (!early) {
      // Completed sleep: XP +10 + sleeps counter (§C1.4/§C1.5). timeEngine
      // only clears the sleep struct, so the grants are applied exactly here.
      store.update((state) => Object.assign(state, applyCompletedSleepGrants(state)));
      ui.toast('notify.wake.body');
    }
    exitSleepScene();
    notifications.cancelAll(); // app open — the wake notification is obsolete
  }

  // ---------------------------------------------------------------- confirm sheet
  ui.registerPanel('wakeConfirm', {
    /** @param {HTMLElement} el */
    mount(el) {
      const allowed = canWakeEarly(store.get(), now());
      el.innerHTML = `
        <div class="wake-confirm">
          <h2 class="perm-title">${t('sleep.wakeConfirm.title')}</h2>
          <p class="perm-body">${allowed ? t('sleep.wakeConfirm.body') : t('sleep.wakeConfirm.tooEarly', { min: SLEEP.EARLY_WAKE_AFTER_MIN })}</p>
          <div class="mg-btn-row">
            <button class="btn wake-yes" ${allowed ? '' : 'disabled'}>${t('sleep.wakeConfirm.wake')}</button>
            <button class="btn btn-teal wake-no">${t('sleep.wakeConfirm.letSleep')}</button>
          </div>
        </div>`;
      el.querySelector('.wake-yes').addEventListener('click', () => {
        if (!canWakeEarly(store.get(), now())) return;
        ui.closePanel('wakeConfirm');
        earlyWake();
      });
      el.querySelector('.wake-no').addEventListener('click', () => ui.closePanel('wakeConfirm'));
    },
    unmount() {},
  });

  function openWakeSheet() {
    if (!isSleeping(store.get())) return;
    ui.openPanel('wakeConfirm');
  }

  /**
   * Lamp-switch / bed tap entry point (§C1.4): awake + energy < 70 → sleep;
   * awake + energy ≥ 70 → "not sleepy" toast; sleeping → early-wake sheet.
   */
  function requestSleepToggle() {
    const state = store.get();
    if (isSleeping(state)) {
      openWakeSheet();
    } else if (canSleep(state)) {
      startSleepFlow();
    } else {
      ui.toast('toast.notSleepy');
    }
  }

  // ---------------------------------------------------------------- wiring
  /**
   * Attach the home-scene handles (idempotent). Called directly when the
   * handles are known, or by the dynamic-import hook below once G4 lands.
   * @param {{roomManager?: object, homeScene?: object, gooby?: object}} handles
   */
  function wireHome(handles = {}) {
    roomManager = handles.roomManager ?? roomManager;
    homeScene = handles.homeScene ?? homeScene;
    gooby = handles.gooby ?? gooby;
    if (homeWired || !roomManager?.on) return;
    homeWired = true;
    roomManager.on('tap:lampSwitch', requestSleepToggle);
    roomManager.on('tap:bed', requestSleepToggle);
    // Room lock (§C1.4): while sleeping the home stays on the bedroom night
    // view — any pan away (swipe/arrows/dots) bounces straight back.
    roomManager.on('roomChanged', ({ roomId }) => {
      if (!isSleeping(store.get()) || roomId === 'bedroom') return;
      ui.toast('toast.sleeping');
      roomManager.goTo?.('bedroom');
      enterSleepScene(); // restore night + bed pose after the bounce
    });
    // Late wiring while already asleep (e.g. booted mid-sleep): sync visuals.
    if (isSleeping(store.get())) enterSleepScene();
    console.info('[sleepFlow] home scene wired (lamp/bed taps active)');
  }

  store.on('sleepChanged', onSleepChanged);
  if (sawSleeping) showChip(); // booted while still asleep (nap not finished)
  if (sawSleeping) audio.play('gooby.snore'); // G14: resume snore (no-op pre-gesture)
  if (roomManager || homeScene) wireHome({ roomManager, homeScene, gooby });

  // ── G6 dynamic-import hook (guard-wiring against G4's wave-2 files) ──────
  // import.meta.glob resolves at transform time: an EMPTY map until G4's
  // homeScene.js exists, then a real loader. The module-level accessors
  // (getRoomManager/getGooby/setNight) only return live instances after
  // switchTo('home') creates the scene, so poll briefly until they do.
  const g4Modules = import.meta.glob('../home/homeScene.js');
  const g4Loader = g4Modules['../home/homeScene.js'];
  if (!homeWired && g4Loader) {
    let tries = 0;
    const poll = setInterval(async () => {
      tries += 1;
      if (homeWired || tries > 60) {
        clearInterval(poll);
        if (!homeWired) {
          console.warn(
            '[sleepFlow] TODO(G6→G4): home/homeScene.js is present but ' +
              'getRoomManager() never returned an instance — wire manually via ' +
              'initSleepFlow(...).wireHome({ roomManager, homeScene, gooby }).'
          );
        }
        return;
      }
      try {
        const hsMod = await g4Loader();
        const rm = hsMod?.getRoomManager?.();
        if (rm?.on) {
          clearInterval(poll);
          wireHome({ roomManager: rm, homeScene: hsMod, gooby: hsMod.getGooby?.() });
        }
      } catch (err) {
        console.warn('[sleepFlow] G4 wiring attempt failed:', err?.message);
      }
    }, 1000);
  }
  // ── end G6 dynamic-import hook ───────────────────────────────────────────

  // Dev-harness extension (§E9 spirit, dev builds only): ?sleep=1 starts the
  // sleep flow right after boot so the full cycle is demonstrable headlessly.
  if (import.meta.env?.DEV && typeof location !== 'undefined') {
    if (new URLSearchParams(location.search).get('sleep') === '1') {
      let tries = 0;
      const kick = setInterval(() => {
        tries += 1;
        const state = store.get();
        if (isSleeping(state) || tries > 40) {
          clearInterval(kick);
          return;
        }
        if (canSleep(state)) {
          clearInterval(kick);
          requestSleepToggle();
        }
      }, 250);
    }
  }

  return { requestSleepToggle, wireHome };
}
