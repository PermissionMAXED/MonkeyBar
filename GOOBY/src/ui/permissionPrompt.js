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

/**
 * Open the soft-ask panel when §C7 allows it (checks shouldSoftAsk + session
 * guard). Pass { force: true } from the Settings deep-link to re-prompt even
 * after 'denied'/'later'.
 * @param {{store: object, ui: object}} deps
 * @param {{force?: boolean}} [opts]
 * @returns {boolean} whether the panel was opened
 */
export function maybeSoftAsk({ store, ui }, opts = {}) {
  if (!notifications.isSupported()) return false;
  if (!opts.force) {
    if (askedThisSession) return false;
    if (!shouldSoftAsk(store.get(), now())) return false;
  }
  askedThisSession = true;
  return ui.openPanel('permission');
}

/**
 * Register the 'permission' panel and the low-stat soft-ask watcher.
 * Called once from main.js's marked G6 block.
 * @param {{store: object, ui: object}} deps
 */
export function initPermissionFlow({ store, ui }) {
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
      el.querySelector('.perm-yes').addEventListener('click', async () => {
        const result = await notifications.requestPermission();
        store.set('settings.notifications', result === 'granted' ? 'granted' : 'denied');
        if (result === 'granted') ui.toast('perm.grantedToast');
        ui.closePanel('permission');
      });
      el.querySelector('.perm-later').addEventListener('click', () => {
        store.set('settings.notifications', `later:${now()}`);
        ui.closePanel('permission');
      });
    },
    unmount() {},
  };
}
