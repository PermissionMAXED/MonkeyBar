// Notification permission soft-ask flow (§C7): NEVER at boot. The friendly
// explainer panel appears the first time Gooby falls asleep (ui/sleepFlow.js
// calls maybeSoftAsk) OR the first time any stat drops below 30 (watcher
// installed here). "Yes" triggers the real OS prompt; "Later" re-asks after
// 24 h (`settings.notifications = 'later:<ts>'`); a denial is respected —
// only the Settings screen deep-links back to a re-prompt.

import { NOTIFY, STATS } from '../data/constants.js';
import { t } from '../data/strings.js';
import { icon } from './icons.js';
import { now } from '../core/clock.js';
import * as notifications from '../core/notifications.js';

/** Any stat below this value triggers the soft-ask (§C7: "drops below 30"). */
const SOFT_ASK_STAT_BELOW = 30;

/**
 * Should the soft-ask panel be shown (§C7)?
 * 'unasked' → yes. 'later:<ts>' → yes once 24 h have passed. 'granted' /
 * 'denied' → no (denial respected; Settings re-prompts explicitly).
 * @param {object} state save-schema state (§E3)
 * @param {number} nowMs
 * @returns {boolean}
 */
export function shouldSoftAsk(state, nowMs) {
  const setting = state?.settings?.notifications;
  if (setting === 'unasked') return true;
  if (typeof setting === 'string' && setting.startsWith('later:')) {
    const ts = Number(setting.slice('later:'.length));
    if (!Number.isFinite(ts)) return true;
    return nowMs >= ts + NOTIFY.PERMISSION_REASK_H * 3600000;
  }
  return false;
}

/** Only one soft-ask per session — re-asking every low-stat tick would nag. */
let askedThisSession = false;

// F2 (E9/E10/E16): the soft-ask must never open over a live minigame /
// shop-trip drive (its low-stat watcher fires while stats decay mid-game) or
// stack over a blocking modal (daily-bonus sheet, onboarding). The scene
// manager handle is captured once in initPermissionFlow so every caller
// (sleepFlow, the low-stat watcher) gets the defer logic without new params.
/** @type {{currentId?: () => string|null}|null} */
let sceneManagerRef = null;
/** @type {ReturnType<typeof setInterval>|null} deferred-retry poll */
let retryTimer = null;
/** Poll cadence while a deferred soft-ask waits for home + idle (ms). */
const RETRY_MS = 1000;

/**
 * Is the soft-ask blocked right now (F2)? True while (a) a non-home scene is
 * active (minigame / shop-trip drive / showcase) or (b) a blocking modal is
 * visible (any full screen, any sheet panel — daily bonus, food tray, … — or
 * the first-run onboarding).
 * @param {{store: object, ui: object}} deps
 * @returns {boolean}
 */
function softAskBlocked({ store, ui }) {
  if (store?.get?.('onboarding.done') === false) return true; // tutorial owns the screen (§C8.1)
  if (ui?.activeScreenId?.()) return true; // full screen up (shop, arcade, results, settings…)
  if (typeof document !== 'undefined' && document.querySelector('.panel-backdrop')) return true; // sheet up (daily bonus…)
  const sceneId = sceneManagerRef?.currentId?.();
  if (sceneId != null && sceneId !== 'home') return true; // minigame / shop trip / non-home scene
  return false;
}

function clearRetry() {
  if (retryTimer != null) clearInterval(retryTimer);
  retryTimer = null;
}

/** Re-attempt a deferred soft-ask once back home and idle (F2). */
function scheduleRetry({ store, ui }) {
  if (retryTimer != null || typeof setInterval === 'undefined') return;
  retryTimer = setInterval(() => {
    if (askedThisSession || !shouldSoftAsk(store.get(), now())) {
      clearRetry();
      return;
    }
    if (softAskBlocked({ store, ui })) return; // still busy — keep waiting
    clearRetry();
    maybeSoftAsk({ store, ui });
  }, RETRY_MS);
}

/**
 * Open the soft-ask panel when §C7 allows it (checks shouldSoftAsk + session
 * guard). Pass { force: true } from the Settings deep-link to re-prompt even
 * after 'denied'/'later' — forced calls show immediately and skip the F2
 * busy-defer. Non-forced calls while a minigame/modal is up are deferred and
 * re-attempted once back at home and idle.
 * @param {{store: object, ui: object}} deps
 * @param {{force?: boolean}} [opts]
 * @returns {boolean} whether the panel was opened
 */
export function maybeSoftAsk({ store, ui }, opts = {}) {
  if (!notifications.isSupported()) return false;
  if (!opts.force) {
    if (askedThisSession) return false;
    if (!shouldSoftAsk(store.get(), now())) return false;
    if (softAskBlocked({ store, ui })) {
      // F2: defer — do NOT burn the session guard; retry when home + idle.
      scheduleRetry({ store, ui });
      return false;
    }
  }
  askedThisSession = true;
  clearRetry();
  return ui.openPanel('permission');
}

/**
 * Register the 'permission' panel and the low-stat soft-ask watcher.
 * Called once from main.js's marked G6 block.
 * @param {{store: object, ui: object, sceneManager?: object}} deps
 *   sceneManager (F2): lets the soft-ask defer while a non-home scene runs.
 */
export function initPermissionFlow({ store, ui, sceneManager }) {
  sceneManagerRef = sceneManager ?? sceneManagerRef; // F2
  ui.registerPanel('permission', createPermissionPanel({ store, ui }));
  // First time any stat drops below 30 → soft-ask (§C7).
  store.on('statsChanged', (stats) => {
    if (STATS.KEYS.some((k) => stats[k] < SOFT_ASK_STAT_BELOW)) {
      maybeSoftAsk({ store, ui });
    }
  });
}

/**
 * The soft-ask panel module (§E6 UiModule shape).
 * @param {{store: object, ui: object}} deps
 * @returns {{mount: (el: HTMLElement) => void, unmount: () => void}}
 */
export function createPermissionPanel({ store, ui }) {
  return {
    /** @param {HTMLElement} el */
    mount(el) {
      el.innerHTML = `
        <div class="perm-panel">
          <div class="perm-icon">${icon('bell', 40)}</div>
          <h2 class="perm-title">${t('perm.title')}</h2>
          <p class="perm-body">${t('perm.body')}</p>
          <div class="mg-btn-row">
            <button class="btn btn-teal perm-yes">${icon('check', 20)} ${t('perm.yes')}</button>
            <button class="btn btn-ghost perm-later">${t('ui.later')}</button>
          </div>
        </div>`;
      // F2 (E5): the settings screen renders its permission label from
      // settings.notifications but its one-shot 'change' listener can be
      // consumed by an unrelated store event (e.g. a stat tick) before the
      // user answers. store.flush() emits the change synchronously for live
      // listeners, and if settings is the screen beneath this panel it is
      // remounted so the label reflects the new state immediately.
      const syncPermissionState = (value) => {
        store.set('settings.notifications', value);
        store.flush();
        if (ui.activeScreenId?.() === 'settings') ui.showScreen('settings');
      };
      el.querySelector('.perm-yes').addEventListener('click', async () => {
        const result = await notifications.requestPermission();
        syncPermissionState(result === 'granted' ? 'granted' : 'denied');
        if (result === 'granted') ui.toast('perm.grantedToast');
        ui.closePanel('permission');
      });
      el.querySelector('.perm-later').addEventListener('click', () => {
        syncPermissionState(`later:${now()}`);
        ui.closePanel('permission');
      });
    },
    unmount() {},
  };
}
