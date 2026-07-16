// Settings screen (§B: lang/notif toggles [G6]; audio/haptics toggles land
// with G14): language auto/EN/DE with live switch, notification status +
// enable/disable (deep-links back into the §C7 permission prompt), reset save
// behind a double confirm, version footer.

import { t, setLang } from '../data/strings.js';
import { icon } from './icons.js';
import * as save from '../core/save.js';
import * as notifications from '../core/notifications.js';
import { maybeSoftAsk } from './permissionPrompt.js';
import pkg from '../../package.json';

/** Language options (§A ruling: bilingual EN+DE, auto from navigator). */
const LANGS = ['auto', 'en', 'de'];

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

  function render() {
    const el = root;
    if (!el) return;
    const lang = store.get('settings.lang') ?? 'auto';
    const notifSetting = store.get('settings.notifications');
    const granted = notifSetting === 'granted';

    el.innerHTML = `
      <div class="settings-wrap">
        <div class="settings-head">
          <button class="btn btn-ghost btn-round settings-back" aria-label="${t('ui.back')}">${icon('arrowLeft', 22)}</button>
          <h1 class="settings-title">${icon('gear', 26)} ${t('settings.title')}</h1>
        </div>
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
          <!-- G14: audio toggles -->
          <div class="settings-row settings-danger">
            <button class="btn settings-reset-btn">${resetLabel()}</button>
          </div>
        </div>
        <div class="settings-footer">${t('settings.version', { v: pkg.version })}</div>
      </div>`;
    // G14: audio toggles here (sfx/music/haptics rows join the card above).

    el.querySelector('.settings-back').addEventListener('click', () => ui.closeAll());

    for (const btn of el.querySelectorAll('.seg-btn')) {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.lang;
        store.set('settings.lang', chosen);
        setLang(chosen);
        render(); // live switch (§A)
      });
    }

    el.querySelector('.settings-notif-btn').addEventListener('click', onNotifToggle);

    const resetBtn = el.querySelector('.settings-reset-btn');
    resetBtn.addEventListener('click', () => {
      // Double confirm (§G G6): two explicit extra taps, each relabeled.
      resetStep += 1;
      if (resetStep >= 3) {
        save.clear();
        location.reload();
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
    // Deep-link back into the §C7 soft-ask (forced — the user asked).
    maybeSoftAsk({ store, ui }, { force: true });
    const once = () => {
      store.off('change', once);
      render();
    };
    store.on('change', once);
  }

  return {
    /** @param {HTMLElement} el */
    mount(el) {
      root = el;
      resetStep = 0;
      render();
    },
    unmount() {
      root = null;
    },
  };
}
