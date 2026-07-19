// GOOBY V4/G53 — code-word catalog (PLAN4 §B6, binding). Pure data: no
// three.js/DOM imports. `secret` is the NORMALIZED form (lowercase, ALL
// whitespace stripped — systems/codesEngine.js `normalize`); `once: true`
// rows are single-use (redemption latched in codes.redeemed, §B1).
// Effects are APPLIED by the caller through existing pipes (§B6): coins via
// economy.award(reason 'code'), sticker via the stickerBook engine's unlock
// path, buff by writing codes.buffs.doubleCoinsUntil.

/**
 * @typedef {Object} CodeDef
 * @property {string} id       code id ('updateLiebe' | 'herzGooby')
 * @property {string} secret   normalized secret word (§C-SYS5.3)
 * @property {{buff?: string, minutes?: number, sticker?: string,
 *   coins?: number}} effect   effect payload (§C-SYS5.2, applied by caller)
 * @property {boolean} once    single-use (all launch codes)
 */

/** @type {ReadonlyArray<CodeDef>} the 2 launch codes (§C-SYS5.2, verbatim). */
export const CODES = Object.freeze([
  // „UpdateLiebe" → 10:00 min Doppel-Münzen-Buff (×2 AFTER daily ×2 → ×4)
  Object.freeze({
    id: 'updateLiebe',
    secret: 'updateliebe',
    effect: Object.freeze({ buff: 'doubleCoins', minutes: 10 }),
    once: true,
  }),
  // „IchLIE3BDich" → secret sticker #29 herzGooby + 50 c (§C-SYS5.4)
  Object.freeze({
    id: 'herzGooby',
    secret: 'ichlie3bdich',
    effect: Object.freeze({ sticker: 'herzGooby', coins: 50 }),
    once: true,
  }),
]);

/** @type {Record<string, CodeDef>} id → def lookup. */
export const CODES_BY_ID = Object.freeze(
  Object.fromEntries(CODES.map((c) => [c.id, c]))
);

/**
 * @param {string} secret NORMALIZED secret word
 * @returns {CodeDef|undefined}
 */
export function codeBySecret(secret) {
  return CODES.find((c) => c.secret === secret);
}
