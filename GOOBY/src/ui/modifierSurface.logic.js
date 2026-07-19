// V4/G76 — modifier surfacing pure helpers (PLAN4 §C-SYS4.2/4.4/4.6 +
// PLAN4-GAMES §G8-3): the results-breakdown line model (per-type bonus
// math next to the „{name} aktiv" chip), the glueckspilz „Glücksrolle"
// slot-roll frame math (900 ms, §C-SYS4.2 verbatim), the stickerChance
// forced-drop pick (games with §B3-v2 collection meta → a guaranteed
// album drop; everything else → the +1 quest-progress tick) and the HUD
// chip's event signature. PURE module — no DOM/three imports; node:test
// hits it directly (test/modifierSurface.test.js). Exact numbers frozen
// here per the §E0.1-2 owning-module rule. Consumers: the marked V4/G76
// blocks in minigames/framework.js (results + forced drop) and ui/hud.js
// (chip/toast).

/** §C-SYS4.2 glueckspilz results-roll presentation numbers (frozen). */
export const GLUECKSPILZ_ROLL = Object.freeze({
  /** Slot-roll animation length (§C-SYS4.2: „900 ms slot-roll"). */
  DURATION_MS: 900,
  /** Value-cycle cadence while rolling. */
  TICK_MS: 60,
  /** Roll bounds (inclusive — mirror of the engine's MODIFIER_CAPS). */
  MIN: 10,
  MAX: 60,
});

/**
 * Deterministic slot-roll display value for animation frame `frame`
 * (uniform 10–60 like the real roll, so the reel reads honest). Pure
 * sin-hash — no state, safe to call from a 60 ms interval.
 * @param {number} frame 0-based tick index
 * @param {number} [seed] round seed (varies the reel between rounds)
 * @returns {number} integer in [MIN, MAX]
 */
export function rollFrameValue(frame, seed = 0) {
  const x = Math.sin((Math.floor(Number(frame)) + 1) * 12.9898 + (Math.floor(Number(seed)) || 0) * 78.233) * 43758.5453;
  const r = x - Math.floor(x);
  return GLUECKSPILZ_ROLL.MIN + Math.floor(r * (GLUECKSPILZ_ROLL.MAX - GLUECKSPILZ_ROLL.MIN + 1));
}

/**
 * §C-SYS4.2 stickerChance — the games whose rounds carry §B3-v2 collection
 * meta (fish via fishingPond meta.caught; landmarks via the city drives'
 * meta.landmarks). Veggies/treats stay care-side sources (garden harvest /
 * feeding) — no minigame rolls them, so they are never forced here.
 */
export const FORCED_DROP_SETS = Object.freeze({
  fishingPond: 'fish',
  cityDrive: 'landmarks',
  deliveryRush: 'landmarks',
});

/**
 * Did the round already produce an organic collection drop (§B3 meta
 * shapes: fishingPond `caught`, city drives `landmarks`)? Then the
 * stickerChance guarantee is satisfied without forcing anything.
 * @param {object|undefined} gameMeta the game's onEnd meta
 * @returns {boolean}
 */
export function hasOrganicDrop(gameMeta) {
  return (Array.isArray(gameMeta?.caught) && gameMeta.caught.length > 0)
    || (Array.isArray(gameMeta?.landmarks) && gameMeta.landmarks.length > 0);
}

/**
 * Pick the forced drop entry (§C-SYS4.2: „the round's collection-drop roll
 * is FORCED to success"): prefer a seeded pick over the set's UNOWNED
 * entries; with everything owned, duplicate-counting sets (fish) drop a
 * seeded duplicate while firstOnly sets (landmarks) return null (a dup
 * award would be a no-op — the caller falls back to the quest tick).
 * @param {string[]} entryIds the set's entry ids (catalog-injected §E0.1-3)
 * @param {Record<string, number>} ownedCounts entryId → owned count
 * @param {number} seed deterministic pick seed
 * @param {boolean} allowDuplicates fish true · landmarks false
 * @returns {string|null} entry id to award (null = nothing droppable)
 */
export function pickForcedDrop(entryIds, ownedCounts, seed, allowDuplicates) {
  const ids = Array.isArray(entryIds) ? entryIds.filter((id) => typeof id === 'string' && id.length > 0) : [];
  const unowned = ids.filter((id) => Math.floor(Number(ownedCounts?.[id]) || 0) <= 0);
  const pool = unowned.length > 0 ? unowned : (allowDuplicates ? ids : []);
  if (pool.length === 0) return null;
  return pool[(Math.floor(Number(seed)) >>> 0) % pool.length];
}

/**
 * Results-breakdown value line next to the „{name} aktiv" chip (§G8-3
 * „Bonus: {name} +X 🪙" shape; strings live in v4-modifier.js):
 *   doppelGold    +{n} extra (coin glyph) · day-capped 0 → „Tagesbonus
 *                 erreicht" (§C-SYS11)
 *   turbo         „Punkte ×1,5" (the scoreMult already multiplied the score)
 *   stickerChance „+1 Sticker" / „+1 Quest-Fortschritt" per the outcome
 *   muenzregen / riesenGooby  organic/cosmetic — chip row only
 *   glueckspilz   handled by its own animated Glücksrolle row
 * @param {string} type §C-SYS4.2 type id
 * @param {{bonus?: number, capped?: boolean,
 *   stickerOutcome?: 'drop'|'quest'|null}} [round] round facts
 * @returns {{key: string, vars?: Record<string, number>, coin?: boolean}|null}
 */
export function modifierResultsValue(type, { bonus = 0, capped = false, stickerOutcome = null } = {}) {
  if (type === 'doppelGold') {
    if (bonus > 0) return { key: 'modifier.results.doppelGold', vars: { n: bonus }, coin: true };
    if (capped) return { key: 'modifier.results.capped' };
    return null;
  }
  if (type === 'turbo') return { key: 'modifier.results.turbo' };
  if (type === 'stickerChance') {
    if (stickerOutcome === 'drop') return { key: 'modifier.results.sticker.drop' };
    if (stickerOutcome === 'quest') return { key: 'modifier.results.sticker.quest' };
    return null;
  }
  return null;
}

/**
 * Stable identity of an active modifier event — the HUD chip toasts
 * §C-SYS4.6 `modifier.start` exactly once per NEW event (reschedules of
 * the same event keep the signature).
 * @param {{gameId: string, type: string, startedAt: number}|null|undefined} current
 * @returns {string} '' when no event is active
 */
export function eventSignature(current) {
  if (!current || typeof current !== 'object') return '';
  return `${current.gameId}|${current.type}|${current.startedAt}`;
}
