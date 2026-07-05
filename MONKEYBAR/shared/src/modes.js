// 6-mode registry — PLAN.md §4 / §4.3. Only Monkey Lies is playable in the slice.

/**
 * @typedef {Object} GameMode
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 * @property {boolean} playable
 * @property {string[]} [mutators]  Bar Rule teaser list (King of the Bar)
 */

/** @type {GameMode[]} */
export const MODES = [
  {
    id: 'monkeyLies',
    name: 'Monkey Lies',
    desc:
      'The main event. Shed your hand of fruit cards with implicit claims of "Table Fruit" — ' +
      'bluff, call "MONKEY LIES!", and send liars to the Coconut Cannon. Last monkey standing wins.',
    playable: true,
  },
  {
    id: 'bananaDice',
    name: 'Banana Dice',
    desc:
      "Liar's-dice under coconut shells: five jungle dice each, escalating bids, challenges. " +
      'Lose a die per lost challenge — at zero dice you face the cannon.',
    playable: false,
  },
  {
    id: 'coconutRoulette',
    name: 'Coconut Roulette',
    desc:
      'Pure nerve. A ticking rigged coconut passes around the table: SHAKE it for a chip (and risk the boom) ' +
      'or PASS and pay one. Explosion odds rise with every shake.',
    playable: false,
  },
  {
    id: 'junglePoker',
    name: 'Jungle Poker',
    desc:
      'Three-card blind poker with banana-chip stakes. Fold or force the showdown — ' +
      'bust your stack and the cannon takes payment.',
    playable: false,
  },
  {
    id: 'kingOfTheBar',
    name: 'King of the Bar',
    desc:
      'Monkey Lies with a twist: every round a random Bar Rule mutator bends the game. ' +
      'Adapt or get launched.',
    playable: false,
    // §4.3 Bar Rule teaser — surfaced on the mode card in the client (P7).
    mutators: [
      '🍺 Happy Hour — everyone plays 2+ cards, no singles',
      '🙊 Silent Round — chat & emotes disabled, poker faces only',
      '🔄 Sticky Stool — turn order reverses every call',
      '🍋 Sour Table — the Table Fruit changes mid-round',
      '💣 Hair Trigger — cannon starts with 2 coconuts loaded',
      '👑 Royal Decree — the round winner picks the next Table Fruit',
    ],
  },
  {
    id: 'customChaos',
    name: 'Custom Chaos',
    desc:
      'Host-tunable knobs over the Monkey Lies engine: hand size, cannon odds, timers, wilds. ' +
      'Break the game your way.',
    playable: false,
  },
];

/** Lookup a mode by id (or undefined). */
export function getMode(id) {
  return MODES.find((m) => m.id === id);
}

export const DEFAULT_MODE_ID = 'monkeyLies';
