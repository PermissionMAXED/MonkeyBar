// Care sheet (§C3.4, V2/G20): bottom-sheet panel id 'careSheet' — the
// medicine/vet options sheet the HUD 🤒 chip opens (the chip itself is G23's
// hud.js; anything can `ui.openPanel('careSheet')`). Shows Gooby's health
// status, the cosmetic weight-tier line (§C4.2: informative, never judgy),
// a medicine action (delegates to deps.useMedicine — home/interactions.js
// passes its shared grimace-then-relief flow) and the vet-trip button, which
// emits the runtime-only store event 'vetTripRequested' (§B3 store.emit).
// G21's shopTrip vet flow listens for it; when nobody listens yet the sheet
// falls back to the graceful "opens soon" toast (§E contract).
//
// Registered from home/interactions.js registerCareUi (the same boot hook
// that registers the food tray). Re-renders itself on 'healthChanged' /
// 'weightChanged' / 'itemsChanged' while open, so a cure or a medicine
// purchase is reflected live.

import { t } from '../data/strings.js';
import { tierOf } from '../systems/weight.js';

/** Health state → status face for the sheet header. */
const STATUS_FACE = { healthy: '💚', queasy: '🤢', sick: '🤒' };

// V3/G33 (§B3): mechanical px→rem sweep (÷16) of this injected CSS string —
// exemptions (1px hairlines/999px pills/shadows/@media px) per PLAN3 §B3.
const CSS = `
.g20-care{display:flex;flex-direction:column;gap:0.75rem;}
.g20-care-title{margin:0;font-size:1.375rem;font-weight:800;color:var(--brown,#4A3B36);}
.g20-care-status{display:flex;align-items:center;gap:0.75rem;background:var(--bg-cream,#FFF6EC);border-radius:1rem;padding:0.75rem 0.875rem;}
.g20-care-face{font-size:2.125rem;line-height:1;}
.g20-care-text{font-size:0.9375rem;font-weight:800;color:var(--brown,#4A3B36);}
.g20-care-weight{font-size:0.8125rem;font-weight:700;color:var(--brown,#4A3B36);opacity:.75;padding:0 0.125rem;}
.g20-care-weight small{display:block;font-size:0.6875rem;font-weight:600;opacity:.8;margin-top:0.125rem;}
.g20-care-actions{display:flex;flex-direction:column;gap:0.625rem;}
.g20-care .btn{width:100%;min-height:max(44px, 3.25rem);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;}
.g20-care-sub{font-size:0.6875rem;font-weight:700;opacity:.85;}
.g20-care .btn:disabled{opacity:.55;}
`;

let stylesInjected = false;
function ensureStyles() {
  if (stylesInjected || typeof document === 'undefined') return;
  stylesInjected = true;
  const el = document.createElement('style');
  el.dataset.owner = 'g20-care-sheet';
  el.textContent = CSS;
  document.head.appendChild(el);
}

/**
 * The care sheet panel module (§E6 UiModule shape). Register under the id
 * 'careSheet' (contract for G23's HUD chip).
 * @param {{store: object, ui: object, audio: object,
 *   useMedicine: () => boolean}} deps `useMedicine` runs the shared medicine
 *   flow (economy.useMedicine + juice + toasts) and returns whether a dose
 *   was consumed.
 * @returns {{mount: (el: HTMLElement) => void, unmount: () => void}}
 */
export function createCareSheetPanel({ store, ui, audio, useMedicine }) {
  /** @type {Array<() => void>} */
  let subs = [];

  /** @param {HTMLElement} el */
  function render(el) {
    const health = store.get('health.state') ?? 'healthy';
    const meds = store.get('items.medicine') ?? 0;
    const tier = tierOf(store.get('weight.value'));
    const medsLine = meds > 0 ? t('care.medicineOwned', { count: meds }) : t('care.medicineNone');

    el.innerHTML = `
      <div class="g20-care">
        <h2 class="g20-care-title">${t('care.title')}</h2>
        <div class="g20-care-status">
          <span class="g20-care-face">${STATUS_FACE[health] ?? STATUS_FACE.healthy}</span>
          <span class="g20-care-text">${t(`care.status.${health}`)}</span>
        </div>
        <div class="g20-care-weight">${t('care.weightTier', { tier: t(`weight.tier.${tier}`) })}
          <small>${t('care.weightNote')}</small></div>
        <div class="g20-care-actions">
          <button class="btn btn-teal g20-care-med">💊 ${t('care.medicine')}
            <span class="g20-care-sub">${medsLine}</span></button>
          <button class="btn g20-care-vet">🚗 ${t('care.vet')}
            <span class="g20-care-sub">${t('care.vetPrice')}</span></button>
        </div>
        <button class="btn btn-ghost g20-care-close">${t('care.close')}</button>
      </div>`;

    el.querySelector('.g20-care-med').addEventListener('click', () => {
      // The shared flow handles every refusal toast (none left / healthy);
      // on a consumed dose close the sheet so the grimace-then-relief anim
      // on Gooby is visible behind it (§C3.5).
      if (useMedicine()) ui.closePanel('careSheet');
    });
    el.querySelector('.g20-care-vet').addEventListener('click', () => {
      audio.play('ui.tap');
      // Runtime-only event (§B3): G21's vet-trip flow listens. store.emit
      // returns the listener count — zero means the flow isn't wired yet.
      const heard = store.emit?.('vetTripRequested', { from: 'careSheet' }) ?? 0;
      if (heard > 0) ui.closePanel('careSheet');
      else ui.toast('care.vetNotBuilt');
    });
    el.querySelector('.g20-care-close').addEventListener('click', () => {
      audio.play('ui.close');
      ui.closePanel('careSheet');
    });
  }

  return {
    /** @param {HTMLElement} el */
    mount(el) {
      ensureStyles();
      render(el);
      // live refresh while open: a cure, tier change or medicine purchase
      // re-renders the sheet in place
      const rerender = () => render(el);
      subs = ['healthChanged', 'weightChanged', 'itemsChanged'].map((ev) =>
        store.on(ev, rerender)
      );
    },
    unmount() {
      for (const off of subs) off?.();
      subs = [];
    },
  };
}
