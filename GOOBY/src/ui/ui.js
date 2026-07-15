// UI layer (§E6): DOM overlay #ui above the canvas. Full screens
// (showScreen), bottom-sheet panels (openPanel), toasts, closeAll. Screens and
// panels are plain modules exporting { mount(el, params), unmount() } and are
// registered here by their owning agents. While a screen/panel is open its DOM
// sits over the canvas with pointer-events enabled, which blocks canvas input
// (input listeners live on the canvas element — §E5).

import { t } from '../data/strings.js';

/** @typedef {{mount: (el: HTMLElement, params?: object) => void, unmount: () => void}} UiModule */

const TOAST_MS = 2500;

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
     * @param {string} textKey strings.js key
     * @param {Record<string, string|number>} [vars]
     */
    toast(textKey, vars) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.textContent = t(textKey, vars);
      root.appendChild(el);
      setTimeout(() => {
        el.classList.add('toast-out');
        setTimeout(() => el.remove(), 300);
      }, TOAST_MS);
    },
  };

  return ui;
}
