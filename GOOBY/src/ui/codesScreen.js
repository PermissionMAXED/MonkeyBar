// V4/G58 — Codes subscreen (PLAN4 §C-SYS5.1/§C-SYS5.3, §B6 caller half):
// input field (autocapitalize/autocorrect off) + „Einlösen" + redeemed list
// (name · date · effect line). Wrong code → 300 ms shake + ui.error + toast;
// already redeemed → toast; rate-limit lock → disabled button with a live
// „Warte {s} s" countdown. Registered as §E6 panel id 'codes' (a §B9
// subscreen sheet — back chevron top-left, ui.close sound) from
// settingsScreen's V4/G58 registration hook.
//
// Same-wave degradation (§E0.1-11): G53's systems/codesEngine.js +
// data/codes.js are discovered at transform time. While they are unmerged,
// the input UX (normalize, shake, toasts, session rate-limit) still works —
// every word is unknown and a hint row explains that codes are not live yet.
// Effects are APPLIED HERE per §B6: coins via economy.award(reason 'code'),
// sticker via the stickerBook engine's checkNow path, buff by writing
// codes.buffs.doubleCoinsUntil; store event 'codesChanged'.

import { t, getLang } from '../data/strings.js';
import { icon } from './icons.js';
import audio from '../audio/audio.js';
import * as clock from '../core/clock.js';
import * as economy from '../systems/economy.js';
import { getStickerBook } from '../systems/stickerBook.js';
import {
  normalizeCodeInput,
  lockRemainingSec,
  redeemedRows,
  createWrongAttemptWindow,
} from './settingsIa.logic.js';
// V4/G58 (§E0.1-11): local fallback table until G53's strings.js spread lands.
import { EN as CODES_EN, DE as CODES_DE } from '../data/strings/v4-codes.js';

// G53's engine + catalog — resolved at transform time; empty maps while the
// files don't exist (main.js glob pattern — do not convert to static imports).
const engineModules = import.meta.glob('../systems/codesEngine.js');
const catalogModules = import.meta.glob('../data/codes.js');

/**
 * t() with a graceful fallback to this agent's v4-codes module while G53's
 * strings.js spread hasn't landed (§E0.1-11).
 * @param {string} key @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
function tx(key, vars) {
  const viaT = t(key, vars);
  if (viaT !== key) return viaT;
  let str = (getLang() === 'de' ? CODES_DE : CODES_EN)[key];
  if (str == null) return key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replaceAll(`{${k}}`, String(v));
  return str;
}

/** @type {Promise<{engine: object|null, catalog: Array<object>|null}>|null} */
let apiPromise = null;

/**
 * Load G53's codes engine + catalog once (cached). Resolves nulls while the
 * same-wave files are unmerged — callers feature-detect per §E0.1-11.
 * @returns {Promise<{engine: object|null, catalog: Array<object>|null}>}
 */
export function loadCodesApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      let engine = null;
      let catalog = null;
      const engineLoader = engineModules['../systems/codesEngine.js'];
      if (engineLoader) {
        try {
          const mod = await engineLoader();
          if (typeof (mod.redeem ?? mod.default?.redeem) === 'function') {
            engine = mod.redeem ? mod : mod.default;
          }
        } catch (err) {
          console.warn('[codes] engine load failed:', err);
        }
      }
      const catalogLoader = catalogModules['../data/codes.js'];
      if (catalogLoader) {
        try {
          const mod = await catalogLoader();
          const rows = mod.CODES ?? mod.CODE_CATALOG ?? mod.default ?? null;
          if (Array.isArray(rows)) catalog = rows;
        } catch (err) {
          console.warn('[codes] catalog load failed:', err);
        }
      }
      return { engine, catalog };
    })();
  }
  return apiPromise;
}

/** §B10 CODES fallback numbers for the engine-absent session rate limit. */
const wrongWindow = createWrongAttemptWindow({ lockAfter: 5, windowSec: 60, lockSec: 30 });

/** Guarded read of the codes save slice (G53's §B1 shape may be absent). */
function codesSlice(store) {
  const raw = store.get('codes');
  return raw != null && typeof raw === 'object' ? raw : {};
}

/** Ensure a mutable codes container inside a store.update draft. */
function ensureCodes(state) {
  if (state.codes == null || typeof state.codes !== 'object') {
    state.codes = { redeemed: {}, lockUntil: 0, buffs: { doubleCoinsUntil: 0 } };
  }
  if (state.codes.redeemed == null || typeof state.codes.redeemed !== 'object') {
    state.codes.redeemed = {};
  }
  if (state.codes.buffs == null || typeof state.codes.buffs !== 'object') {
    state.codes.buffs = { doubleCoinsUntil: 0 };
  }
  return state.codes;
}

/** Success-toast key per §C-SYS5.2 (per-code copy, generic fallback). */
function toastKeyFor(codeId) {
  const key = `codes.toast.${codeId}`;
  return CODES_EN[key] != null || t(key) !== key ? key : 'codes.toast.ok';
}

/**
 * Apply a redeemed code's effects through the existing pipes (§B6: the UI
 * caller applies — coins → economy.award('code'), sticker → stickerBook
 * checkNow after the redeemed write, buff → codes.buffs.doubleCoinsUntil).
 * @param {{store: object, ui: object}} deps
 * @param {{id: string, effect?: object}} code catalog row
 */
export function applyCodeEffects({ store, ui }, code) {
  const effect = code?.effect ?? {};
  const nowMs = clock.now();
  if (effect.buff === 'doubleCoins') {
    const minutes = Math.max(1, Number(effect.minutes) || 10);
    store.update((state) => {
      ensureCodes(state).buffs.doubleCoinsUntil = nowMs + minutes * 60000;
    });
  }
  const coins = Math.floor(Number(effect.coins) || 0);
  if (coins > 0) economy.award(store, coins, 'code');
  if (effect.sticker) {
    try {
      getStickerBook()?.checkNow?.(); // unlock rides the normal book path (§C-SYS5.2)
    } catch { /* engine not initialized (harness edge) */ }
  }
  store.emit?.('codesChanged', { id: code?.id });
  store.flush?.();
  // Pre-translate via tx(): ui.toast() only knows t()'s table, and the
  // v4-codes spread is G53's (§E0.1-11 — a raw key would toast otherwise).
  ui.toast(tx(toastKeyFor(code?.id)));
  audio.play('ui.confirmBig');
}

/**
 * The single redeem path (§C-SYS5.1 screen AND §C-SYS6 card 13 share it —
 * no parallel logic). Runs G53's engine against the live store state and
 * applies effects on success.
 * @param {{store: object, ui: object}} deps
 * @param {string} rawInput as typed (the engine normalizes; the fallback
 *   normalizes identically via settingsIa.logic)
 * @returns {Promise<{ok: boolean, reason?: string, code?: object}>}
 *   reasons: 'empty' | 'unknown' | 'already' | 'locked' | engine-reported
 */
export async function redeemCode(deps, rawInput) {
  const { store } = deps;
  const nowMs = clock.now();
  const normalized = normalizeCodeInput(rawInput);
  if (normalized === '') return { ok: false, reason: 'empty' };
  if (lockRemainingSec(codesSlice(store).lockUntil, nowMs) > 0) {
    return { ok: false, reason: 'locked' };
  }
  const { engine, catalog } = await loadCodesApi();

  if (!engine) {
    // §E0.1-11 fallback: no engine → every word is unknown; keep the
    // §C-SYS5.3 lock UX alive with a session-only window.
    const lockUntil = wrongWindow.wrong(nowMs);
    if (lockUntil > 0) {
      store.update((state) => {
        ensureCodes(state).lockUntil = lockUntil;
      });
      store.flush?.();
    }
    return { ok: false, reason: 'unknown', fallback: true };
  }

  /** @type {{ok: boolean, reason?: string, code?: object}} */
  let result = { ok: false, reason: 'unknown' };
  store.update((state) => {
    ensureCodes(state);
    const res = engine.redeem(state, rawInput, nowMs);
    if (res != null && typeof res === 'object') result = res;
    if (result.ok) {
      const codeId = result.code?.id ?? String(result.code ?? '');
      if (codeId && !state.codes.redeemed[codeId]) {
        state.codes.redeemed[codeId] = nowMs; // idempotent belt-and-braces
      }
      const counters = state.achievements?.counters;
      if (counters && typeof counters === 'object') {
        counters.codesRedeemed = Math.floor(Number(counters.codesRedeemed) || 0) + 1;
      }
    }
  });
  if (result.ok) {
    let row = result.code != null && typeof result.code === 'object' ? result.code : null;
    if (!row && catalog) row = catalog.find((c) => c.id === result.code) ?? null;
    applyCodeEffects(deps, row ?? { id: String(result.code ?? '') });
  } else {
    store.flush?.(); // persist any engine-side lock/attempt writes NOW
  }
  return result;
}

/** Effect line for a redeemed-list row (§C-SYS5.1). */
function effectLine(effect) {
  if (effect?.buff === 'doubleCoins') {
    return tx('codes.effect.doubleCoins', { m: Math.max(1, Number(effect.minutes) || 10) });
  }
  const parts = [];
  if (effect?.sticker) parts.push(tx('codes.effect.sticker'));
  if (Number(effect?.coins) > 0) parts.push(tx('codes.effect.coins', { c: Number(effect.coins) }));
  return parts.join(' · ') || '✨';
}

/** Pretty display name for a code id ('updateLiebe' → 'UpdateLiebe'). */
function codeName(id) {
  const key = `codes.name.${id}`;
  const via = tx(key);
  return via === key ? id : via;
}

/**
 * Create the codes §E6 panel module (§B9 subscreen sheet).
 * @param {{store: object, ui: object}} deps
 * @returns {{mount: (el: HTMLElement) => void, unmount: () => void}}
 */
export function createCodesPanel({ store, ui }) {
  /** @type {HTMLElement|null} */
  let root = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let tick = null;
  /** @type {Array<object>|null} */
  let catalog = null;
  let engineMissing = false;
  let busy = false;

  function lockSec() {
    return lockRemainingSec(codesSlice(store).lockUntil, clock.now());
  }

  function render() {
    const el = root;
    if (!el) return;
    const rows = redeemedRows(codesSlice(store).redeemed, catalog ?? []);
    const locked = lockSec();
    el.innerHTML = `
      <div class="g58-sub" data-sub="codes">
        <div class="g58-sub-head">
          <button class="btn btn-ghost btn-round g58-sub-back" aria-label="${t('ui.back')}">${icon('arrowLeft', 22)}</button>
          <h2 class="g58-sub-title">🔑 ${tx('codes.title')}</h2>
        </div>
        <p class="g58-codes-sub">${tx('codes.sub')}</p>
        <div class="card settings-card g58-codes-card">
          <div class="g58-codes-inputrow">
            <input class="g58-codes-input" type="text" autocapitalize="off" autocorrect="off"
              autocomplete="off" spellcheck="false" enterkeyhint="go" maxlength="40"
              placeholder="${tx('codes.input.placeholder')}" aria-label="${tx('codes.input.placeholder')}">
            <button class="btn btn-teal g58-codes-redeem" ${locked > 0 ? 'disabled' : ''}>
              ${locked > 0 ? tx('codes.locked', { s: locked }) : tx('codes.redeem')}
            </button>
          </div>
        </div>
        <div class="settings-section">${tx('codes.redeemed.title')}</div>
        <div class="card settings-card g58-codes-list">
          ${engineMissing ? `<p class="g58-codes-empty">${tx('codes.unavailable')}</p>` : ''}
          ${rows.length === 0 && !engineMissing
            ? `<p class="g58-codes-empty">${tx('codes.redeemed.empty')}</p>`
            : rows.map((r) => `
          <div class="settings-row g58-codes-row">
            <span class="g58-codes-name">✅ ${codeName(r.id)}</span>
            <span class="g58-codes-meta">
              <span class="g58-codes-date">${new Date(r.at).toLocaleDateString(getLang() === 'de' ? 'de-DE' : 'en-US')}</span>
              <span class="g58-codes-effect">${effectLine(r.effect)}</span>
            </span>
          </div>`).join('')}
        </div>
      </div>`;

    el.querySelector('.g58-sub-back')?.addEventListener('click', () => {
      audio.play('ui.close'); // §B9 back chevron sound
      ui.closePanel('codes');
    });
    el.querySelector('.g58-codes-redeem')?.addEventListener('click', submit);
    el.querySelector('.g58-codes-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  async function submit() {
    const el = root;
    if (!el || busy) return;
    const input = el.querySelector('.g58-codes-input');
    const value = input?.value ?? '';
    if (normalizeCodeInput(value) === '' || lockSec() > 0) return;
    busy = true;
    audio.play('ui.tap');
    const res = await redeemCode({ store, ui }, value);
    busy = false;
    if (!root) return; // panel closed mid-flight
    if (res.ok) {
      render(); // list + counters refresh; success toast already shown
      return;
    }
    if (res.reason === 'already') {
      ui.toast(tx('codes.already'));
      return;
    }
    if (res.reason === 'locked') {
      render();
      return;
    }
    // unknown → §C-SYS5.3: 300 ms shake + ui.error + toast.
    const row = el.querySelector('.g58-codes-inputrow');
    row?.classList.remove('g58-shake');
    void row?.offsetWidth; // restart the CSS animation
    row?.classList.add('g58-shake');
    audio.play('ui.error');
    ui.toast(tx('codes.wrong'));
    if (lockSec() > 0) render(); // lock may have just engaged
  }

  /** 1 s countdown repaint while a lock runs (label + disabled state). */
  function syncLock() {
    const el = root;
    if (!el) return;
    const btn = el.querySelector('.g58-codes-redeem');
    if (!btn) return;
    const locked = lockSec();
    const wasDisabled = btn.disabled;
    btn.disabled = locked > 0;
    btn.textContent = locked > 0 ? tx('codes.locked', { s: locked }) : tx('codes.redeem');
    if (wasDisabled && locked === 0) audio.play('ui.toggleOn');
  }

  return {
    /** @param {HTMLElement} el */
    mount(el) {
      root = el;
      render();
      loadCodesApi().then(({ engine, catalog: rows }) => {
        engineMissing = engine == null;
        catalog = rows;
        if (root) render();
      });
      tick = setInterval(syncLock, 1000);
    },
    unmount() {
      if (tick != null) clearInterval(tick);
      tick = null;
      root = null;
    },
  };
}

/**
 * Register the codes panel id (idempotent — called from settingsScreen's
 * V4/G58 hook so no main.js block is needed).
 * @param {{store: object, ui: object}} deps
 */
export function registerCodesUi(deps) {
  deps.ui.registerPanel('codes', createCodesPanel(deps));
}
