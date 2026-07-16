// Notifications adapter (§E7): schedules the §C7 rules computed by
// systems/notifyRules.js. Two runtime paths, chosen per call:
//   - native: `@capacitor/local-notifications` behind a DYNAMIC-IMPORT GUARD —
//     the plugin (and @capacitor/core) only land with G13/W5, so the web build
//     must never hard-require them. Even the platform probe is guarded:
//     `globalThis.Capacitor?.isNativePlatform?.()`.
//   - web: best-effort `Notification` API fired from setTimeout while the page
//     is hidden (dev builds only — real delivery is the native path).
//
// Reschedule contract (§C7): on app background + on save → cancelAll() then
// schedule from the predicted curves; on app open → cancelAll(). The hooks are
// installed from main.js's marked G6 block via installNotificationHooks().

import { NOTIFY } from '../data/constants.js';
import { computeSchedule } from '../systems/notifyRules.js';
import { t } from '../data/strings.js';
import { now, getScale } from './clock.js';

/** True when running inside a Capacitor native shell (guarded probe — §E7). */
function isNative() {
  return !!globalThis.Capacitor?.isNativePlatform?.();
}

/** @returns {Promise<object|null>} the LocalNotifications plugin, or null on web */
async function nativePlugin() {
  const cap = globalThis.Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  // Preferred: the runtime bridge — present on native without bundling the
  // plugin's JS package (which is only installed by G13 in wave 5).
  if (cap.Plugins?.LocalNotifications) return cap.Plugins.LocalNotifications;
  try {
    // Non-literal specifier so Rollup/Vite never resolve it at build time —
    // the web build must not hard-require the (not-yet-installed) package.
    const specifier = '@capacitor/local-notifications';
    const mod = await import(/* @vite-ignore */ specifier);
    return mod?.LocalNotifications ?? null;
  } catch (err) {
    console.warn('[notifications] local-notifications plugin unavailable:', err?.message);
    return null;
  }
}

/** Web-path pending timers: notification id → timeout handle. */
const webTimers = new Map();

/**
 * Is any notification path available at all?
 * @returns {boolean}
 */
export function isSupported() {
  if (isNative()) return true;
  return typeof Notification !== 'undefined';
}

/**
 * Current OS-level permission.
 * @returns {Promise<'granted'|'denied'|'prompt'>}
 */
export async function getPermission() {
  const plugin = await nativePlugin();
  if (plugin) {
    try {
      const res = await plugin.checkPermissions();
      return res?.display === 'granted' ? 'granted' : res?.display === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'prompt';
    }
  }
  if (typeof Notification === 'undefined') return 'denied';
  return Notification.permission === 'default' ? 'prompt' : /** @type {'granted'|'denied'} */ (Notification.permission);
}

/**
 * Trigger the OS permission prompt (only ever called from the soft-ask flow —
 * §C7: never at boot).
 * @returns {Promise<'granted'|'denied'|'prompt'>}
 */
export async function requestPermission() {
  const plugin = await nativePlugin();
  if (plugin) {
    try {
      const res = await plugin.requestPermissions();
      return res?.display === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  if (typeof Notification === 'undefined') return 'denied';
  const res = await Notification.requestPermission();
  return res === 'granted' ? 'granted' : res === 'denied' ? 'denied' : 'prompt';
}

/**
 * Cancel every scheduled notification (ids 1–5).
 * @returns {Promise<void>}
 */
export async function cancelAll() {
  for (const timer of webTimers.values()) clearTimeout(timer);
  webTimers.clear();
  const plugin = await nativePlugin();
  if (plugin) {
    try {
      await plugin.cancel({ notifications: Object.values(NOTIFY.IDS).map((id) => ({ id })) });
    } catch (err) {
      console.warn('[notifications] cancel failed:', err?.message);
    }
  }
}

/**
 * Cancel + reschedule everything from the current state (§E7): runs
 * computeSchedule and hands the result to the active path. No-op without
 * permission (settings-level 'granted' is checked by the caller via
 * `settings.notifications`; here only the OS grant matters).
 * @param {object} state save-schema state (§E3)
 * @returns {Promise<import('../systems/notifyRules.js').ScheduledNotification[]>} what was scheduled
 */
export async function rescheduleAll(state) {
  await cancelAll();
  if (state?.settings?.notifications !== 'granted') return [];
  if ((await getPermission()) !== 'granted') return [];
  const items = computeSchedule(state, now());
  const plugin = await nativePlugin();
  if (plugin) {
    try {
      await plugin.schedule({
        notifications: items.map((n) => ({
          id: n.id,
          title: t(n.titleKey),
          body: t(n.bodyKey),
          schedule: { at: new Date(n.at) },
        })),
      });
    } catch (err) {
      console.warn('[notifications] schedule failed:', err?.message);
    }
    return items;
  }
  // Web best-effort (dev only): fire while hidden via setTimeout. Delays are
  // divided by the clock scale so ?fast=N harness runs preview them quickly.
  if (!import.meta.env?.DEV || typeof Notification === 'undefined') return items;
  for (const n of items) {
    const delay = Math.max(0, (n.at - now()) / getScale());
    webTimers.set(
      n.id,
      setTimeout(() => {
        webTimers.delete(n.id);
        if (typeof document !== 'undefined' && document.hidden && Notification.permission === 'granted') {
          try {
            new Notification(t(n.titleKey), { body: t(n.bodyKey), tag: `gooby-${n.id}` });
          } catch (err) {
            console.warn('[notifications] web notify failed:', err?.message);
          }
        }
      }, delay)
    );
  }
  return items;
}

/**
 * Install the §C7 reschedule hooks (called once from main.js's marked G6
 * block): on open → cancelAll; visibilitychange→hidden → rescheduleAll;
 * back to visible → cancelAll; save flush (approximated by a 1 s-debounced
 * store 'change' while hidden) → rescheduleAll. On native the §C7
 * `App.addListener('appStateChange')` path (F2) re-runs the same scheduling
 * entry points on background/resume — WKWebView visibility events are not
 * guaranteed around app suspension.
 * @param {{store: object}} deps
 */
export function installNotificationHooks({ store }) {
  if (typeof document === 'undefined') return;
  cancelAll(); // on app open: cancel all (§C7)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') rescheduleAll(store.get());
    else cancelAll();
  });
  let debounce = null;
  store.on('change', () => {
    if (debounce != null) return;
    debounce = setTimeout(() => {
      debounce = null;
      // Only meaningful in the background — while open, notifications stay
      // cancelled and the hidden hook reschedules on the way out.
      if (document.hidden) rescheduleAll(store.get());
    }, 1000);
  });

  // F2 (E5): native appStateChange listener (§C7) — guarded dynamic import
  // like every other Capacitor usage; pure no-op on web. On resume the
  // schedule is refreshed by re-running the §C7 entry point for an open app
  // (cancelAll — pending notifications are stale once the player is back);
  // on background rescheduleAll recomputes from the live state. This also
  // puts the shipped @capacitor/app dependency to use.
  (async () => {
    const cap = globalThis.Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    try {
      let appPlugin = cap.Plugins?.App ?? null;
      if (!appPlugin) {
        // Non-literal specifier so Rollup/Vite never resolve it at build time.
        const specifier = '@capacitor/app';
        const mod = await import(/* @vite-ignore */ specifier);
        appPlugin = mod?.App ?? null;
      }
      appPlugin?.addListener?.('appStateChange', ({ isActive }) => {
        if (isActive) cancelAll();
        else rescheduleAll(store.get());
      });
    } catch (err) {
      console.warn('[notifications] @capacitor/app unavailable:', err?.message);
    }
  })();
}
