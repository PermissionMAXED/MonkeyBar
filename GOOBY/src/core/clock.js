// Game clock (§E4): now() is the ONLY allowed time source in the whole codebase.
// The dev harness (§E9) can pin it (?now=<epochMs>) and scale it (?fast=N).
// Pure module: no three.js/DOM imports.

let baseRealMs = Date.now();
/** Epoch ms that game-time started counting from (pinned via ?now=). */
let baseGameMs = baseRealMs;
/** Real-time multiplier (?fast=N). 1 = real time. */
let scale = 1;

/**
 * Current game time in epoch milliseconds.
 * @returns {number}
 */
export function now() {
  return baseGameMs + (Date.now() - baseRealMs) * scale;
}

/**
 * Configure the clock (dev harness §E9). Both options are optional.
 * @param {{now?: number, fast?: number}} opts
 *   now: pin the current game time to this epoch ms;
 *   fast: run game time at N× real time (N > 0).
 */
export function configure(opts = {}) {
  const current = now();
  baseRealMs = Date.now();
  baseGameMs = Number.isFinite(opts.now) ? Number(opts.now) : current;
  if (Number.isFinite(opts.fast) && opts.fast > 0) scale = Number(opts.fast);
}

/** @returns {number} the active time multiplier */
export function getScale() {
  return scale;
}

/**
 * Local calendar day string (YYYY-MM-DD) for a game timestamp — used for
 * "per local day" rules (§C6 daily ×2, §C8.2 streaks).
 * @param {number} [ms] defaults to now()
 * @returns {string}
 */
export function localDay(ms = now()) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
