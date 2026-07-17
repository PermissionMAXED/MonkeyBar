// Vet arrival panel (V2/G21, PLAN2 §C9.2): the screen that opens over the
// parked-at-the-clinic backdrop after a vet trip (screen id 'vetPanel' —
// registered from systems/shopTrip.js's initShopTrip, mirroring the G11 shop
// registration). Dr. Hoppel offers:
//
//   Behandlung 120c — only while queasy/sick (economy.payVet(store,'cure') —
//     §C3.5 FULL cure: junk/neglect counters reset + +10 all stats; stronger
//     than the 40c medicine item, and the copy says so). Can't afford → the
//     gentle „medicine costs 40c at the shop" hint (§C9.2).
//   Checkup 30c — anytime (economy.payVet(store,'checkup')): health report
//     card (junkScore band / neglect / weight tier / current state) + resets
//     neglectMin. The pre-checkup neglect value is captured BEFORE paying so
//     the card can show what was reset.
//   „Nach Hause" — teleport home (no return drive, v1 ruling) via the
//     injected goHome().
//
// After a cure Gooby wears the §C3.5 bandaged-ear gag for 10 min —
// `vetBandageUntil()` exposes the runtime timestamp (session-only, not saved)
// for the character/ambience agents (G26/G29) to render on the 3D rabbit;
// this panel shows the 🩹 badge itself while active.
//
// Module level stays DOM-free (like ui/shopScreen.js) so node tests can
// import the systems/shopTrip.js chain headlessly.

import { VET, ITEM_PRICES } from '../data/constants.js';
import { t } from '../data/strings.js';
import { payVet, canAfford } from '../systems/economy.js';
import { HEALTH } from '../systems/health.js';
import { tierOf } from '../systems/weight.js';
import { icon } from './icons.js';

/** §C3.5 bandaged-ear gag duration after a vet cure (ms). */
export const BANDAGE_MS = 10 * 60 * 1000;

/** Runtime-only (session) timestamp until which Gooby wears the bandage. */
let bandageUntil = 0;

/** @returns {number} epoch ms until which the §C3.5 bandage gag is active */
export function vetBandageUntil() {
  return bandageUntil;
}

/**
 * §C7 junkScore band for the report card (green/yellow/orange — informed
 * players, no nagging): green below the recovery-clean line, yellow from
 * there up to the queasy threshold, orange beyond.
 * @param {number} junkScore
 * @returns {'green'|'yellow'|'orange'}
 */
export function junkBand(junkScore) {
  const j = Math.max(0, Number(junkScore) || 0);
  if (j < HEALTH.RECOVER_JUNK_BELOW) return 'green';
  if (j < HEALTH.QUEASY_JUNK) return 'yellow';
  return 'orange';
}

/**
 * Register the 'vetPanel' screen (§C9.2). Called once from initShopTrip.
 * @param {{store: object, ui: object, audio: object, goHome: () => void,
 *   getArrival: () => ({coins: number}|null),
 *   isVetArrival?: () => boolean}} deps isVetArrival: a vetTrip is at its
 *   destination (drives the mgResults trip decoration below)
 */
export function registerVetPanel({ store, ui, audio, goHome, getArrival, isVetArrival }) {
  if (typeof document === 'undefined') return;
  installResultsHook({ ui, isVetArrival });

  /** @type {Array<() => void>} */
  let subs = [];
  /** @type {HTMLElement|null} */
  let wrapEl = null;
  /** neglect minutes captured for the report card (pre-checkup value) */
  let reportNeglect = 0;
  let showReport = false;

  const healthState = () => {
    const s = store.get('health.state');
    return s === 'queasy' || s === 'sick' ? s : 'healthy';
  };

  function coinsPill() {
    return `<span class="shop-coins">${icon('coin', 18)}<span class="shop-coins-n">${store.get('coins') ?? 0}</span></span>`;
  }

  function render() {
    if (!wrapEl) return;
    const state = healthState();
    const unwell = state !== 'healthy';
    const coins = store.get('coins') ?? 0;
    const arrival = getArrival?.();
    const bandaged = Date.now() < bandageUntil;

    wrapEl.innerHTML = `
      <div class="vet-head">
        <h1 class="vet-title">🩺 ${t('vet.title')}</h1>
        ${coinsPill()}
        <button class="btn btn-teal vet-home">${icon('home', 18)} ${t('trip.goHome')}</button>
      </div>
      ${arrival ? `<div class="vet-hint">🎉 ${t('trip.earned', { coins: arrival.coins ?? 0 })}</div>` : ''}
      <div class="vet-body">
        <div class="vet-doc">
          <span class="vet-avatar" aria-hidden="true">🐰<span class="vet-avatar-glasses">👓</span></span>
          <span class="vet-doc-text">
            <span class="vet-doc-name">${t('vet.doctor')}${bandaged ? ` <span class="vet-bandage-badge">🩹</span>` : ''}</span>
            <span class="vet-doc-line">${t(`vet.greet.${state}`)}</span>
          </span>
        </div>
        <div class="vet-actions">
          <button class="vet-action vet-act-cure" ${unwell ? '' : 'disabled'}>
            <span class="vet-action-head">
              <span class="vet-action-name">💊 ${t('vet.cure')}</span>
              <span class="shop-price">${icon('coin', 13)}${VET.CURE_PRICE}</span>
            </span>
            <span class="vet-action-desc">${unwell
              ? t('vet.cureDesc', { bonus: VET.CURE_STAT_BONUS })
              : t('vet.cureNotNeeded')}</span>
          </button>
          ${unwell && !canAfford(store, VET.CURE_PRICE)
            ? `<div class="vet-hint vet-hint-soft">💡 ${t('vet.hintMedicine', { price: ITEM_PRICES.medicine })}</div>`
            : ''}
          <button class="vet-action vet-act-checkup">
            <span class="vet-action-head">
              <span class="vet-action-name">📋 ${t('vet.checkup')}</span>
              <span class="shop-price">${icon('coin', 13)}${VET.CHECKUP_PRICE}</span>
            </span>
            <span class="vet-action-desc">${t('vet.checkupDesc')}</span>
          </button>
        </div>
        ${showReport ? renderReport() : ''}
      </div>`;

    wrapEl.querySelector('.vet-home').addEventListener('click', () => {
      audio.play('ui.tap');
      goHome();
    });
    wrapEl.querySelector('.vet-act-cure').addEventListener('click', onCure);
    wrapEl.querySelector('.vet-act-checkup').addEventListener('click', onCheckup);
    wrapEl.querySelector('.vet-report-done')?.addEventListener('click', () => {
      audio.play('ui.tap');
      showReport = false;
      render();
    });
    void coins; // coins pill re-renders via the coinsChanged sub below
  }

  /** Report card (§C9.2: junkScore band / neglect / weight tier). */
  function renderReport() {
    const state = healthState();
    const band = junkBand(store.get('health.junkScore'));
    const tier = tierOf(store.get('weight.value'));
    const neglectMin = Math.round(reportNeglect);
    return `
      <div class="vet-report">
        <div class="vet-report-title">📋 ${t('vet.report.title')}</div>
        <div class="vet-report-row"><span>${t('vet.report.state')}</span><span>${t(`vet.state.${state}`)}</span></div>
        <div class="vet-report-row"><span>${t('vet.report.junk')}</span><span class="vet-band vet-band-${band}">${t(`vet.junk.${band}`)}</span></div>
        <div class="vet-report-row"><span>${t('vet.report.neglect')}</span><span>${neglectMin > 0
          ? t('vet.neglect.some', { min: neglectMin })
          : t('vet.neglect.ok')}</span></div>
        <div class="vet-report-row"><span>${t('vet.report.weight')}</span><span>${t(`vet.tier.${tier}`)}</span></div>
        <button class="btn btn-teal vet-report-done">${t('vet.reportDone')}</button>
      </div>`;
  }

  /** Behandlung (§C3.5): full cure — economy.payVet pays exactly once. */
  function onCure() {
    audio.play('ui.tap');
    const res = payVet(store, 'cure');
    if (res.ok) {
      bandageUntil = Date.now() + BANDAGE_MS; // §C3.5 bandaged-ear gag
      audio.play('vet.cure');
      ui.toast('vet.cured');
      ui.toast('vet.bandage');
      // confetti burst (dynamic import — keeps three.js/DOM-heavy gfx out of
      // the node:test import chain, same pattern as shopScreen's decor boot)
      const el = wrapEl;
      if (el) {
        import('../gfx/particles.js')
          .then((m) => m.burstConfettiDom(el))
          .catch(() => {});
      }
      showReport = false;
      render();
    } else if (res.reason === 'coins') {
      audio.play('ui.error');
      ui.toast('toast.notEnoughCoins');
    } else {
      // 'healthy' — button should already be disabled; render to resync
      render();
    }
  }

  /** Checkup (§C3.5): report card + neglect reset — capture BEFORE paying. */
  function onCheckup() {
    audio.play('ui.tap');
    const before = Number(store.get('health.neglectMin')) || 0;
    const res = payVet(store, 'checkup');
    if (res.ok) {
      reportNeglect = before;
      showReport = true;
      audio.play('vet.checkup');
      render();
    } else if (res.reason === 'coins') {
      audio.play('ui.error');
      ui.toast('toast.notEnoughCoins');
    }
  }

  ui.registerScreen('vetPanel', {
    /** @param {HTMLElement} el */
    mount(el) {
      wrapEl = document.createElement('div');
      wrapEl.className = 'vet-wrap';
      el.appendChild(wrapEl);
      showReport = false;
      render();
      subs = [
        store.on('coinsChanged', (coins) => {
          const n = wrapEl?.querySelector('.shop-coins-n');
          if (n) n.textContent = String(coins);
        }),
      ];
      audio.play('vet.doorbell');
    },
    unmount() {
      for (const off of subs) off?.();
      subs = [];
      wrapEl = null;
    },
  });
}

// ---------------------------------------------------------------------------
// mgResults decoration for vet arrivals (no framework.js edit — G23's file):
// same MutationObserver pattern as ui/shopScreen.js's sibling-panel hooks.
// The framework renders vetTrip results with the arcade layout (its trip
// check is shopTrip-only); when a vet trip is at its destination this strips
// the Score/Best rows (the trip "score" IS the coin payout, F4 P2-6 ruling)
// and relabels the exit button — it continues INTO the clinic via onExit.
// ---------------------------------------------------------------------------

/** @param {{ui: object, isVetArrival?: () => boolean}} deps */
function installResultsHook({ ui, isVetArrival }) {
  if (!ui.el || typeof window === 'undefined' || !window.MutationObserver || !isVetArrival) return;

  const observer = new window.MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.classList.contains('screen-mgResults') && isVetArrival()) decorateResults(node);
      }
    }
  });
  observer.observe(ui.el, { childList: true });

  /** @param {HTMLElement} screen */
  function decorateResults(screen) {
    const rows = screen.querySelectorAll('.mg-results-row');
    for (let i = 0; i < rows.length - 1; i++) rows[i].remove(); // keep the coins row
    const btns = screen.querySelectorAll('.mg-btn-row .btn');
    const exitBtn = btns[btns.length - 1];
    if (exitBtn) exitBtn.innerHTML = `🩺 ${t('vet.title')}`;
  }
}
