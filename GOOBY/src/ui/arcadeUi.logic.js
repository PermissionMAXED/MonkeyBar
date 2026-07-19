// V4/G68 — arcade cover grid + pre-game screen pure helpers (PLAN4-GAMES
// §G7.1–7.3, §G5.6; PLAN4 §C-SYS4.5 tint table). PURE module: no DOM/three
// imports — node:test hits this file directly (test/v4ArcadeUi.test.js).
// The DOM renderers (arcadeScreen.js grid, pregameScreen.js) consume these
// helpers so grid and pre-game stay pixel/state consistent.

import { MINIGAMES } from '../data/minigames.js';
import { MODIFIER_TYPES } from '../systems/modifierEngine.js';
import { DIFFICULTY_MODES } from '../minigames/framework.logic.js';

/**
 * §G7.1 cover-art root: `public/assets/covers/<gameId>.png` (512×384, 4:3).
 * Covers are UI assets (plain <img>/background-image), NOT run through
 * core/assets.js. Missing/unloadable files fall back to the tinted icon
 * card (§G7.1 fallback rule — onerror swap, never a broken image).
 */
export const COVER_DIR = 'assets/covers/';

/** @param {string} gameId @returns {string} relative cover URL (§G7.1) */
export function coverUrl(gameId) {
  return `${COVER_DIR}${gameId}.png`;
}

/** Pastel accent per game (v1 grid palette, kept for fallback covers). */
export const TILE_COLORS = Object.freeze([
  '#FF7BA9', '#59C9B9', '#FFD166', '#9B8CFF', '#7FD4FF', '#FFA26B',
  '#FF8FC0', '#6BD0A8', '#F7B84B', '#B49CFF', '#5AC0E8', '#F58C6E',
]);

/** Visible (non-dev) arcade order — 28 ids incl. goobyWelt (§G7.2 grid). */
export const ARCADE_GAME_IDS = Object.freeze(
  MINIGAMES.filter((m) => !m.dev).map((m) => m.id)
);

/**
 * Deterministic pastel accent for a game (same hue on the grid tile and the
 * pre-game fallback cover — the two screens must visually agree).
 * @param {string} gameId
 * @returns {string} hex color
 */
export function gameAccent(gameId) {
  const i = ARCADE_GAME_IDS.indexOf(gameId);
  return TILE_COLORS[(i >= 0 ? i : 0) % TILE_COLORS.length];
}

/**
 * §G7.1 fallback-cover look: soft two-stop gradient built from the game's
 * accent (big icon + name are DOM siblings). color-mix keeps it derivable
 * from ONE accent hex without a color library.
 * @param {string} gameId
 * @returns {string} CSS background value
 */
export function fallbackGradient(gameId) {
  const c = gameAccent(gameId);
  return `linear-gradient(155deg, color-mix(in srgb, ${c} 55%, #FFF6EC) 0%, ${c} 58%, color-mix(in srgb, ${c} 72%, #4A3B36) 100%)`;
}

/**
 * §G5.6 info-row coin range from the §C6 coin row (defensive: special rows
 * without min keep 0).
 * @param {{min?: number, max?: number}|undefined} coinTable
 * @returns {{min: number, max: number}}
 */
export function coinRange(coinTable) {
  return {
    min: Math.max(0, Math.floor(Number(coinTable?.min) || 0)),
    max: Math.max(0, Math.floor(Number(coinTable?.max) || 0)),
  };
}

/**
 * §C-SYS4.5 badge countdown `mm:ss` to endsAt (1 s tick; clamped ≥ 0).
 * @param {number} msRemaining
 * @returns {string}
 */
export function formatCountdown(msRemaining) {
  const total = Math.max(0, Math.ceil((Number(msRemaining) || 0) / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * §C-SYS4.5 tint per modifier type — single source: the engine's frozen
 * §C-SYS4.2 table (gold doppelGold/glueckspilz, teal muenzregen, coral
 * turbo, lavender riesenGooby, pink stickerChance). Unknown → gold.
 * @param {string|undefined} type
 * @returns {string} hex color
 */
export function glowTint(type) {
  return MODIFIER_TYPES[type]?.color ?? '#FFD34D';
}

/**
 * §G5.6 segmented-control model: one row per mode with selection/lock/beaten
 * ticks, derived purely from framework.getDifficultyState() output + the
 * screen-local selection ('endless' is a launch mode, never persisted).
 * @param {{beaten: object, endlessUnlocked: boolean}} diff
 *   framework.getDifficultyState(gameId) shape (G56 contract)
 * @param {'easy'|'normal'|'hard'|'endless'} selected
 * @returns {Array<{mode: string, selected: boolean, locked: boolean,
 *   beaten: boolean}>}
 */
export function pillStates(diff, selected) {
  return DIFFICULTY_MODES.map((mode) => ({
    mode,
    selected: mode === selected,
    locked: mode === 'endless' && diff.endlessUnlocked !== true,
    beaten: diff.beaten?.[mode] === true,
  }));
}

/**
 * §G5.6 per-mode line under the segmented control — returns the i18n key +
 * vars (Leicht „×0,7 Münzen" · Mittel „×1" · Schwer „×1,3 · Ziel: N" ·
 * Endlos unlocked „5 Münzen · Highscore ∞: M" / locked the §G5.5 lock line).
 * Keys live in v4-difficulty (G56) except the lock line (§G7.4: v4-arcade).
 * @param {{target: number|null, endlessUnlocked: boolean,
 *   bestByMode: {endless: number}}} diff getDifficultyState() shape
 * @param {'easy'|'normal'|'hard'|'endless'} mode
 * @returns {{key: string, vars?: Record<string, string|number>}}
 */
export function modeLine(diff, mode) {
  if (mode === 'easy') return { key: 'mg.diff.coins.easy' };
  if (mode === 'normal') return { key: 'mg.diff.coins.normal' };
  if (mode === 'hard') return { key: 'mg.diff.coins.hard', vars: { n: diff.target ?? '—' } };
  if (diff.endlessUnlocked === true) {
    return { key: 'mg.diff.coins.endless', vars: { n: diff.bestByMode?.endless ?? 0 } };
  }
  return { key: 'pregame.endlessLocked', vars: { n: diff.target ?? '—' } };
}

/**
 * §G5.6 info-row „best of selected mode" number.
 * @param {{bestByMode: Record<string, number>}} diff
 * @param {'easy'|'normal'|'hard'|'endless'} mode
 * @returns {number}
 */
export function bestOfMode(diff, mode) {
  return Math.max(0, Math.floor(Number(diff?.bestByMode?.[mode]) || 0));
}

/**
 * §G7.2 goobyWelt SPECIAL ribbon rule: replaces the NEU ribbon for this tile,
 * permanent until first play (plays > 0 retires it; the gold-dashed border
 * stays — it marks the special game itself, not its newness).
 * @param {object} state save state
 * @returns {boolean}
 */
export function showSpecialRibbon(state) {
  return Math.floor(Number(state?.minigames?.plays?.goobyWelt) || 0) <= 0;
}
