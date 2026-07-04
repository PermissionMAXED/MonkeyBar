// Emote + quick-phrase catalogs — PLAN.md §2 (shared/emotes.js), used by chat wheel + bots.

/**
 * @typedef {Object} Emote
 * @property {string} id
 * @property {string} name
 * @property {string} glyph
 */

/** @type {Emote[]} */
export const EMOTES = [
  { id: 'laugh', name: 'Laugh', glyph: '😂' },
  { id: 'cry', name: 'Cry', glyph: '😭' },
  { id: 'rage', name: 'Rage', glyph: '😡' },
  { id: 'shrug', name: 'Shrug', glyph: '🤷' },
  { id: 'taunt', name: 'Taunt', glyph: '😜' },
  { id: 'sweat', name: 'Sweat', glyph: '😅' },
  { id: 'heart', name: 'Heart', glyph: '❤️' },
  { id: 'shock', name: 'Shock', glyph: '😱' },
  { id: 'mindblown', name: 'Mind Blown', glyph: '🤯' },
  { id: 'sleepy', name: 'Sleepy', glyph: '😴' },
];

/**
 * @typedef {Object} QuickPhrase
 * @property {string} id
 * @property {string} text
 */

/** @type {QuickPhrase[]} */
export const QUICK_PHRASES = [
  { id: 'youre_lying', text: "You're lying." },
  { id: 'never_lie', text: 'I never lie 🍌' },
  { id: 'cannon_hungers', text: 'The cannon hungers.' },
  { id: 'nice_try', text: 'Nice try.' },
  { id: 'call_it', text: 'Somebody call it!' },
  { id: 'too_easy', text: 'Too easy.' },
  { id: 'sweating', text: "You're sweating." },
  { id: 'trust_me', text: 'Trust me. Would this face lie?' },
  { id: 'good_luck', text: 'Good luck. You need it.' },
  { id: 'oh_no', text: 'Oh no. Oh no no no.' },
  { id: 'smell_bluff', text: 'I smell a bluff.' },
  { id: 'gg', text: 'GG, monkeys.' },
];

/** Lookup helpers. */
export function getEmote(id) {
  return EMOTES.find((e) => e.id === id);
}

export function getQuickPhrase(id) {
  return QUICK_PHRASES.find((q) => q.id === id);
}
