// V4/G58 — Settings-IA + codes-UI pure logic (PLAN4 §C-SYS12.1/§C-SYS5.3/
// §C-SYS5.2). PURE module: no three.js/DOM imports — node:test runs it
// headlessly (test/v4SettingsUi.test.js); the DOM renderers live in
// ui/settingsScreen.js / ui/codesScreen.js / ui/hud.js. The v3 sibling
// ui/settings.logic.js (G33) stays untouched.

/** §C-SYS12.1 main-list row ids in the binding order (rows 7/8 conditional). */
export const SETTINGS_MAIN_ROW_IDS = Object.freeze([
  'language', 'notifications', 'display', 'audio', 'radio', 'codes',
  'credits', 'dev',
]);

/**
 * The §C-SYS12.1 main settings list — exact order, one row each. Row 7
 * (Credits) renders only while the credits screen id is registered
 * (§E0.1-11 — G81 lands it in wave 4); row 8 (Entwickler) only when
 * settings.devUnlocked (§B4-v3, unchanged).
 * @param {{devUnlocked?: boolean, creditsAvailable?: boolean}} [flags]
 * @returns {string[]} row ids in render order
 */
export function mainRows({ devUnlocked = false, creditsAvailable = false } = {}) {
  return SETTINGS_MAIN_ROW_IDS.filter((id) => {
    if (id === 'credits') return creditsAvailable === true;
    if (id === 'dev') return devUnlocked === true;
    return true;
  });
}

/**
 * §C-SYS5.3 input normalization (identical to G53's codesEngine.normalize —
 * used as the same-wave fallback and for the pre-submit trim): trim →
 * toLowerCase → strip ALL whitespace (so „update liebe" works).
 * @param {*} input raw field value
 * @returns {string}
 */
export function normalizeCodeInput(input) {
  return String(input ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * §C-SYS5.2 HUD chip / countdown label: mm:ss with a plain minutes digit
 * below 10 (10:00 → 9:59 → … → 0:01), clamped at 0.
 * @param {number} ms remaining milliseconds
 * @returns {string}
 */
export function formatMmSs(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * §C-SYS5.3 lock countdown: whole seconds remaining on codes.lockUntil
 * (0 when unlocked / in the past / garbage).
 * @param {*} lockUntil epoch ms
 * @param {number} nowMs
 * @returns {number} seconds ≥ 0
 */
export function lockRemainingSec(lockUntil, nowMs) {
  const until = Number(lockUntil) || 0;
  return Math.max(0, Math.ceil((until - nowMs) / 1000));
}

/**
 * §C-SYS5.2 double-coins buff remaining (0 = inactive/expired).
 * @param {{buffs?: {doubleCoinsUntil?: number}}|null|undefined} codes save slice
 * @param {number} nowMs
 * @returns {number} remaining ms ≥ 0
 */
export function buffRemainingMs(codes, nowMs) {
  const until = Number(codes?.buffs?.doubleCoinsUntil) || 0;
  return Math.max(0, until - nowMs);
}

/**
 * Redeemed-list row model (§C-SYS5.1: name, date, effect line) — newest
 * first; unknown catalog ids keep rendering from the save alone.
 * @param {Record<string, number>|null|undefined} redeemed codes.redeemed map
 * @param {ReadonlyArray<{id: string, effect?: object}>} [catalog]
 * @returns {Array<{id: string, at: number, effect: object|null}>}
 */
export function redeemedRows(redeemed, catalog = []) {
  const map = redeemed != null && typeof redeemed === 'object' ? redeemed : {};
  return Object.entries(map)
    .map(([id, at]) => ({
      id,
      at: Number(at) || 0,
      effect: catalog.find((c) => c.id === id)?.effect ?? null,
    }))
    .sort((a, b) => b.at - a.at);
}

/**
 * Session-only wrong-attempt tracker (§C-SYS5.3 fallback while G53's engine
 * is unmerged; the engine owns the real rate limit once it lands): 5 wrong
 * attempts inside a rolling 60 s window → lock for 30 s. Numbers mirror
 * §B10's CODES constants.
 * @returns {{wrong: (atMs: number) => number, reset: () => void}}
 *   wrong() returns the lockUntil epoch-ms to persist (0 = no lock yet)
 */
export function createWrongAttemptWindow({ lockAfter = 5, windowSec = 60, lockSec = 30 } = {}) {
  /** @type {number[]} */
  let attempts = [];
  return {
    wrong(atMs) {
      attempts.push(atMs);
      attempts = attempts.filter((t) => atMs - t < windowSec * 1000);
      if (attempts.length >= lockAfter) {
        attempts = [];
        return atMs + lockSec * 1000;
      }
      return 0;
    },
    reset() {
      attempts = [];
    },
  };
}

/**
 * §B11 ledger row formatter (dev card 3 expander): `hh:mm:ss · +/−amount ·
 * reason · balance` in a monospace-friendly shape.
 * @param {{at: number, kind: string, amount: number, reason?: string, balance: number}} row
 * @returns {string}
 */
export function formatLedgerRow(row) {
  const d = new Date(Number(row?.at) || 0);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const amount = Number(row?.amount) || 0;
  const sign = row?.kind === 'spend' || amount < 0 ? '−' : '+';
  const abs = Math.abs(amount);
  return `${hh}:${mm}:${ss} · ${sign}${abs} · ${row?.reason || '—'} · ${Number(row?.balance) || 0}`;
}
