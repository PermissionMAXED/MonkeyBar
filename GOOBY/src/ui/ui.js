// UI layer (§E6): DOM overlay #ui above the canvas. Full screens
// (showScreen), bottom-sheet panels (openPanel), toasts, closeAll. Screens and
// panels are plain modules exporting { mount(el, params), unmount() } and are
// registered here by their owning agents. While a screen/panel is open its DOM
// sits over the canvas with pointer-events enabled, which blocks canvas input
// (input listeners live on the canvas element — §E5).

import { t } from '../data/strings.js';
import { registerCreditsScreen } from './creditsScreen.js'; // V4/G81: §C-SYS12.4 feature-detected settings row

/** @typedef {{mount: (el: HTMLElement, params?: object) => void, unmount: () => void}} UiModule */
/** @typedef {{onTap?: () => void}} ToastOptions */

const TOAST_MS = 2500;

// V3/FIX-D (E20 P1-1): while a fullscreen modal panel (whatsNew) is open,
// non-critical toasts are HELD in a queue instead of stacking over the panel;
// they flush (deduped, lightly staggered) once the panel closes. Panels opt
// in via ui.holdToasts()/ui.releaseToasts() from their mount/unmount hooks.
const TOAST_FLUSH_STAGGER_MS = 400;

export function createUi() {
  const root = document.getElementById('ui');

  /** @type {Map<string, UiModule>} */
  const screens = new Map();
  /** @type {Map<string, UiModule>} */
  const panels = new Map();
  /** @type {{id: string, el: HTMLElement, mod: UiModule}|null} */
  let activeScreen = null;
  /** @type {Array<{id: string, el: HTMLElement, mod: UiModule}>} */
  const activePanels = [];
  // V3/FIX-D (E20 P1-1): toast gate state — hold depth, held texts, live els.
  let toastHold = 0;
  /** @type {Array<{text: string, options?: ToastOptions}>} */
  const heldToasts = [];
  /** @type {Set<HTMLElement>} */
  const liveToasts = new Set();
  /** @type {WeakMap<HTMLElement, ToastOptions|undefined>} */
  const liveToastOptions = new WeakMap();

  /**
   * V3/FIX-D: render one toast element now (the pre-gate toast() body).
   * V4/G70b: an optional tap action turns the notice into an accessible,
   * one-shot button without changing passive toast behavior.
   * @param {string} text
   * @param {ToastOptions} [options]
   */
  function spawnToast(text, options) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    root.appendChild(el);
    liveToasts.add(el);
    liveToastOptions.set(el, options);

    const dismiss = () => {
      if (!el.isConnected || el.classList.contains('toast-out')) return;
      el.classList.add('toast-out');
      setTimeout(() => {
        liveToasts.delete(el);
        el.remove();
      }, 300);
    };
    const timer = setTimeout(dismiss, TOAST_MS);

    if (typeof options?.onTap === 'function') {
      el.classList.add('toast-action');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.style.pointerEvents = 'auto';
      el.style.cursor = 'pointer';
      el.style.minHeight = '44px';
      let activated = false;
      const activate = () => {
        if (activated) return;
        activated = true;
        clearTimeout(timer);
        liveToasts.delete(el);
        el.remove();
        options.onTap();
      };
      el.addEventListener('click', activate, { once: true });
      el.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate();
      });
    }
  }

  /** V3/FIX-D: queue a toast while the gate is closed (deduped by text). */
  function holdToast(text, options) {
    const existing = heldToasts.find((entry) => entry.text === text);
    if (!existing) heldToasts.push({ text, options });
    else if (!existing.options?.onTap && options?.onTap) existing.options = options;
  }

  const ui = {
    /** The overlay root element — persistent layers (minigame HUD) attach here. */
    el: root,

    /**
     * Register a full-screen module (arcade, shop, results…).
     * @param {string} id @param {UiModule} mod
     */
    registerScreen(id, mod) {
      screens.set(id, mod);
    },

    /**
     * Register a sheet panel module (food tray, confirm, permission…).
     * @param {string} id @param {UiModule} mod
     */
    registerPanel(id, mod) {
      panels.set(id, mod);
    },

    /** @param {string} id @returns {boolean} */
    hasScreen(id) {
      return screens.has(id);
    },

    /**
     * Show a full screen (closes any open screen/panels first).
     * @param {string} id
     * @param {object} [params]
     * @returns {boolean} false when the screen is not registered (toasts a hint)
     */
    showScreen(id, params = {}) {
      const mod = screens.get(id);
      if (!mod) {
        console.warn(`[ui] unknown screen '${id}'`);
        ui.toast('toast.screenMissing');
        return false;
      }
      ui.closeAll();
      const el = document.createElement('div');
      el.className = `screen screen-${id}`;
      root.appendChild(el);
      activeScreen = { id, el, mod };
      mod.mount(el, params);
      return true;
    },

    /**
     * Open a bottom-sheet panel over the current view.
     * @param {string} id
     * @param {object} [params]
     * @returns {boolean}
     */
    openPanel(id, params = {}) {
      const mod = panels.get(id);
      if (!mod) {
        console.warn(`[ui] unknown panel '${id}'`);
        ui.toast('toast.screenMissing');
        return false;
      }
      const backdrop = document.createElement('div');
      backdrop.className = `panel-backdrop panel-backdrop-${id}`;
      const el = document.createElement('div');
      el.className = `panel panel-${id}`;
      backdrop.appendChild(el);
      root.appendChild(backdrop);
      backdrop.addEventListener('pointerdown', (e) => {
        if (e.target === backdrop) ui.closePanel(id);
      });
      activePanels.push({ id, el: backdrop, mod });
      mod.mount(el, params);
      return true;
    },

    /** Close one panel by id (no-op when not open). @param {string} id */
    closePanel(id) {
      const i = activePanels.findIndex((p) => p.id === id);
      if (i < 0) return;
      const { el, mod } = activePanels[i];
      activePanels.splice(i, 1);
      try {
        mod.unmount();
      } catch (err) {
        console.error('[ui] panel unmount error:', err);
      }
      el.remove();
    },

    /** Close the active screen and every panel. */
    closeAll() {
      while (activePanels.length > 0) ui.closePanel(activePanels[activePanels.length - 1].id);
      if (activeScreen) {
        try {
          activeScreen.mod.unmount();
        } catch (err) {
          console.error('[ui] screen unmount error:', err);
        }
        activeScreen.el.remove();
        activeScreen = null;
      }
    },

    /** @returns {string|null} id of the open full screen */
    activeScreenId() {
      return activeScreen?.id ?? null;
    },

    /**
     * Show a transient toast. Text goes through t() (§A: all user-facing text).
     * V3/FIX-D (E20 P1-1): held (queued, deduped) while the toast gate is
     * closed — see holdToasts()/releaseToasts().
     * @param {string} textKey strings.js key
     * @param {Record<string, string|number>} [vars]
     * @param {ToastOptions} [options]
     */
    toast(textKey, vars, options) {
      const text = t(textKey, vars);
      if (toastHold > 0) {
        holdToast(text, options);
        return;
      }
      spawnToast(text, options);
    },

    /**
     * V3/FIX-D (E20 P1-1): close the toast gate (re-entrant — one depth per
     * open modal). The FIRST hold also sweeps already-visible toasts into the
     * queue so a boot toast storm can't keep covering a panel that opened a
     * beat later (offline/achievement toasts race the whatsNew poll).
     */
    holdToasts() {
      toastHold += 1;
      if (toastHold > 1) return;
      for (const el of [...liveToasts]) {
        const text = el.textContent ?? '';
        if (text) holdToast(text, liveToastOptions.get(el));
        liveToasts.delete(el);
        el.remove();
      }
    },

    /**
     * V3/FIX-D (E20 P1-1): reopen the toast gate; when the last hold lifts,
     * flush the held toasts with a light stagger so they read one by one.
     */
    releaseToasts() {
      toastHold = Math.max(0, toastHold - 1);
      if (toastHold > 0) return;
      const pending = heldToasts.splice(0);
      pending.forEach((entry, i) => {
        setTimeout(() => {
          if (toastHold > 0) holdToast(entry.text, entry.options); // a new modal opened mid-flush
          else spawnToast(entry.text, entry.options);
        }, i * TOAST_FLUSH_STAGGER_MS);
      });
    },
  };

  registerCreditsScreen(ui); // V4/G81: static screen has no store dependency
  return ui;
}
