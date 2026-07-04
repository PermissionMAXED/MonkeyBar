// Cosmetic progression catalog (P5) — §6 slice scope: a win counter in
// localStorage unlocks cosmetics at 1 / 3 / 5 / 10 wins. No currency yet;
// shopScreen.js shows the catalog, characterSelect.js shows lock state.

export const WINS_KEY = 'mb_wins';

/** @returns {number} lifetime match wins recorded on this device */
export function getWins() {
  const n = parseInt(localStorage.getItem(WINS_KEY) ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Increment the local win counter (called from the results screen on victory). */
export function incrementWins() {
  const n = getWins() + 1;
  try {
    localStorage.setItem(WINS_KEY, String(n));
  } catch {
    /* storage blocked — cosmetic progress just won't persist */
  }
  return n;
}

/**
 * @typedef {Object} Cosmetic
 * @property {string} id
 * @property {string} name
 * @property {string} glyph
 * @property {string} desc
 * @property {number} winsRequired  win-count gate (§6: 1/3/5/10)
 */

/** @type {Cosmetic[]} */
export const COSMETICS = [
  {
    id: 'banana_pin',
    name: 'Banana Lapel Pin',
    glyph: '🍌',
    desc: 'A modest golden pin. Proof you have survived the cannon at least once.',
    winsRequired: 1,
  },
  {
    id: 'neon_shades',
    name: 'Neon Shades',
    glyph: '🕶️',
    desc: 'Impossible to read your eyes. Slightly easier to walk into stools.',
    winsRequired: 3,
  },
  {
    id: 'vip_stool',
    name: 'VIP Bar Stool',
    glyph: '🪑',
    desc: 'Velvet seat, brass legs, reserved plaque. The Parrot respects a regular.',
    winsRequired: 5,
  },
  {
    id: 'crown_of_the_bar',
    name: 'Crown of the Bar',
    glyph: '👑',
    desc: 'The soda-can crown of legend. King Kola pretends not to mind.',
    winsRequired: 10,
  },
];

/** @param {Cosmetic} cosmetic */
export function isUnlocked(cosmetic, wins = getWins()) {
  return wins >= cosmetic.winsRequired;
}
