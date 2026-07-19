// GOOBY V4/G53 — codes engine (PLAN4 §B6 + §C-SYS5.3, binding). PURE module:
// no three.js/DOM imports, fully unit-tested (test/codes.test.js).
//
// API (§B6):
//   normalize(input)                 trim → toLowerCase → strip ALL whitespace
//   redeem(state, input, nowMs, attempts?)
//     → { ok: true, code }           code = the data/codes.js catalog row
//     | { ok: false, reason: 'unknown' | 'already' | 'locked' }
//   isDoubleCoinsActive(state, nowMs?)  HUD ×2-chip + economy buff accessor
//   remainingMs(state, nowMs?)          buff countdown for the HUD chip (G58)
//   lockRemainingMs(state, nowMs?)      §C-SYS5.3 lockout countdown
//
// redeem() runs INSIDE a store.update draft (the §B9 codes subscreen and dev
// card 13 share the caller, ui/codesScreen.js): on success it latches
// state.codes.redeemed[id] = nowMs (single-use); on the LOCK_AFTER-th wrong
// attempt inside the rolling window it writes state.codes.lockUntil. Effects
// (coins/sticker/buff) are APPLIED BY THE CALLER through existing pipes
// (§B6); the caller also emits the 'codesChanged' store event.
//
// Rate limit (§C-SYS5.3/§B10): CODES.LOCK_AFTER wrong attempts within a
// rolling CODES.LOCK_WINDOW_SEC window → lockUntil = now + CODES.LOCK_SEC.
// The lockout END persists (codes.lockUntil, §B1 — survives reload); the
// wrong-attempt window itself is session-only (in-memory here; tests inject
// their own array via the `attempts` parameter for pinned-clock purity).

import { CODES as CODE_RULES } from '../data/constants.js';
import { CODES, codeBySecret } from '../data/codes.js';

/**
 * §C-SYS5.3 input normalization: trim → toLowerCase → strip ALL whitespace
 * (so „update liebe" and „ UpdateLiebe " both resolve). Non-strings → ''.
 * @param {unknown} input as typed
 * @returns {string} normalized secret candidate
 */
export function normalize(input) {
  if (typeof input !== 'string') return '';
  return input.trim().toLowerCase().replace(/\s+/g, '');
}

/** Session-scoped wrong-attempt timestamps (rolling §C-SYS5.3 window). */
const sessionAttempts = [];

/** Test hygiene: clear the session wrong-attempt window. */
export function resetAttemptsForTests() {
  sessionAttempts.length = 0;
}

/** @param {object} state @returns {object} guarded codes slice ({} shapes filled) */
function ensureCodesSlice(state) {
  if (state.codes == null || typeof state.codes !== 'object' || Array.isArray(state.codes)) {
    state.codes = { redeemed: {}, lockUntil: 0, buffs: { doubleCoinsUntil: 0 } };
  }
  const codes = state.codes;
  if (codes.redeemed == null || typeof codes.redeemed !== 'object' || Array.isArray(codes.redeemed)) {
    codes.redeemed = {};
  }
  if (codes.buffs == null || typeof codes.buffs !== 'object' || Array.isArray(codes.buffs)) {
    codes.buffs = { doubleCoinsUntil: 0 };
  }
  return codes;
}

/**
 * THE redeem path (§B6). Pure against its inputs: mutates ONLY the passed
 * state draft (redemption latch + rate-limit lock) and the passed attempts
 * array — no module I/O, no clock reads (nowMs is injected).
 * @param {object} state save-state draft (inside store.update)
 * @param {string} input code word as typed (normalized here)
 * @param {number} nowMs current time (clock.now() / pinned in tests)
 * @param {number[]} [attempts] rolling wrong-attempt window (session default)
 * @returns {{ok: true, code: import('../data/codes.js').CodeDef}
 *   | {ok: false, reason: 'unknown'|'already'|'locked'}}
 */
export function redeem(state, input, nowMs, attempts = sessionAttempts) {
  const codes = ensureCodesSlice(state);
  const lockUntil = Number(codes.lockUntil) || 0;
  if (lockUntil > nowMs) return { ok: false, reason: 'locked' };

  const secret = normalize(input);
  const code = secret === '' ? undefined : codeBySecret(secret);
  if (!code) {
    // §C-SYS5.3 rolling window: prune to LOCK_WINDOW_SEC, count this attempt,
    // engage the lock on the LOCK_AFTER-th wrong word.
    const windowStart = nowMs - CODE_RULES.LOCK_WINDOW_SEC * 1000;
    while (attempts.length > 0 && attempts[0] < windowStart) attempts.shift();
    attempts.push(nowMs);
    if (attempts.length >= CODE_RULES.LOCK_AFTER) {
      codes.lockUntil = nowMs + CODE_RULES.LOCK_SEC * 1000;
      attempts.length = 0; // the lock replaces the window
    }
    return { ok: false, reason: 'unknown' };
  }

  if (code.once !== false && codes.redeemed[code.id]) {
    return { ok: false, reason: 'already' };
  }

  codes.redeemed[code.id] = nowMs; // single-use latch (§B6)
  return { ok: true, code };
}

/**
 * Is the „UpdateLiebe" double-coins buff live right now? (§C-SYS5.2 — the
 * economy award path and the HUD ×2 chip both read THIS.)
 * @param {object} state save state (or any {codes} shape)
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function isDoubleCoinsActive(state, nowMs = Date.now()) {
  const until = Number(state?.codes?.buffs?.doubleCoinsUntil);
  return Number.isFinite(until) && until > nowMs;
}

/**
 * Milliseconds until the double-coins buff expires (0 when inactive) — the
 * HUD chip renders „×2 💰 {mm:ss}" from this (G58/G56 contract).
 * @param {object} state
 * @param {number} [nowMs]
 * @returns {number}
 */
export function remainingMs(state, nowMs = Date.now()) {
  const until = Number(state?.codes?.buffs?.doubleCoinsUntil);
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, until - nowMs);
}

/**
 * Milliseconds until the §C-SYS5.3 lockout ends (0 when unlocked) — drives
 * the disabled-button „Warte {s} s" countdown.
 * @param {object} state
 * @param {number} [nowMs]
 * @returns {number}
 */
export function lockRemainingMs(state, nowMs = Date.now()) {
  const until = Number(state?.codes?.lockUntil);
  if (!Number.isFinite(until)) return 0;
  return Math.max(0, until - nowMs);
}

/** Re-export of the catalog for consumers that import the engine only. */
export { CODES };
