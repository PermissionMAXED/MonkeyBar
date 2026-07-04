// 16-character roster — PLAN.md §6 (binding contract).
// Silhouette params drive client/src/three/monkeyFactory.js:
//   bodyScale  — overall body size multiplier (1 = average chimp)
//   limbLength — arm/leg length multiplier
//   earSize    — ear radius multiplier
//   muzzleSize — muzzle protrusion multiplier
//   furPalette — [primary fur, secondary fur/belly, face skin] hex colors
//   accessories — ids the factory knows how to build from primitives

/**
 * @typedef {Object} MonkeySilhouette
 * @property {number} bodyScale
 * @property {number} limbLength
 * @property {number} earSize
 * @property {number} muzzleSize
 * @property {string[]} furPalette
 * @property {string[]} accessories
 */

/**
 * @typedef {Object} MonkeyPassive
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 */

/**
 * @typedef {Object} Monkey
 * @property {string} id
 * @property {string} name
 * @property {MonkeySilhouette} silhouette
 * @property {MonkeyPassive} passive
 */

/** @type {Monkey[]} */
export const MONKEYS = [
  {
    id: 'rico',
    name: 'Rico "The Fuse"',
    silhouette: {
      bodyScale: 0.8,
      limbLength: 1.15,
      earSize: 1.1,
      muzzleSize: 0.9,
      furPalette: ['#8a5a2b', '#c99b6a', '#e8c39e'],
      accessories: ['mohawk_red', 'bandana'],
    },
    passive: {
      id: 'hotHead',
      name: 'Hot Head',
      desc: 'Idle animation grows twitchier as his cannon chambers shrink.',
    },
  },
  {
    id: 'baronBananas',
    name: 'Baron Bananas',
    silhouette: {
      bodyScale: 1.55,
      limbLength: 0.9,
      earSize: 0.6,
      muzzleSize: 1.2,
      furPalette: ['#2f2a26', '#4a423a', '#a98d76'],
      accessories: ['top_hat', 'monocle'],
    },
    passive: {
      id: 'richReveal',
      name: 'Rich Reveal',
      desc: 'Gold particle glints whenever his cards flip.',
    },
  },
  {
    id: 'grandmaGuava',
    name: 'Grandma Guava',
    silhouette: {
      bodyScale: 0.55,
      limbLength: 0.85,
      earSize: 1.3,
      muzzleSize: 0.7,
      furPalette: ['#cfc4b0', '#e8e0d0', '#f2ddc6'],
      accessories: ['shawl', 'cane'],
    },
    passive: {
      id: 'sympathy',
      name: 'Sympathy',
      desc: 'The whole table lets out an automatic "phew" when she survives the cannon.',
    },
  },
  {
    id: 'djDrift',
    name: 'DJ Drift',
    silhouette: {
      bodyScale: 0.95,
      limbLength: 1.5,
      earSize: 0.9,
      muzzleSize: 0.8,
      furPalette: ['#3d3d4d', '#5c5c73', '#d9c2a8'],
      accessories: ['headphones'],
    },
    passive: {
      id: 'dropTheBass',
      name: 'Drop the Bass',
      desc: 'A bass sting plays when one of his bluffs goes unchallenged.',
    },
  },
  {
    id: 'sisterCocoa',
    name: 'Sister Cocoa',
    silhouette: {
      bodyScale: 0.9,
      limbLength: 1.1,
      earSize: 0.8,
      muzzleSize: 0.75,
      furPalette: ['#4b3626', '#6d5138', '#e6cdb2'],
      accessories: ['nun_habit', 'rosary'],
    },
    passive: {
      id: 'blessing',
      name: 'Blessing',
      desc: 'Once per match, bestows a cosmetic halo on another player.',
    },
  },
  {
    id: 'tinyTantrum',
    name: 'Tiny Tantrum',
    silhouette: {
      bodyScale: 0.5,
      limbLength: 0.8,
      earSize: 1.4,
      muzzleSize: 0.85,
      furPalette: ['#7a5230', '#a87d4f', '#f0d5b8'],
      accessories: ['bib'],
    },
    passive: {
      id: 'tableRattle',
      name: 'Table Rattle',
      desc: 'Losing a challenge shakes every prop on the table.',
    },
  },
  {
    id: 'professorPeel',
    name: 'Professor Peel',
    silhouette: {
      bodyScale: 1.35,
      limbLength: 1.25,
      earSize: 0.7,
      muzzleSize: 1.1,
      furPalette: ['#b3661f', '#d98c3f', '#e8b98a'],
      accessories: ['cracked_glasses', 'lab_coat'],
    },
    passive: {
      id: 'calculated',
      name: 'Calculated',
      desc: 'Sees his own cannon odds displayed as an exact percentage.',
    },
  },
  {
    id: 'captainSplinter',
    name: 'Captain Splinter',
    silhouette: {
      bodyScale: 1.2,
      limbLength: 1.0,
      earSize: 0.75,
      muzzleSize: 1.35,
      furPalette: ['#5e4a8a', '#8a6fb8', '#d94f4f'],
      accessories: ['eye_patch', 'pirate_coat'],
    },
    passive: {
      id: 'showman',
      name: 'Showman',
      desc: 'Wins come with a pirate-flag flourish.',
    },
  },
  {
    id: 'ladyVine',
    name: 'Lady Vine',
    silhouette: {
      bodyScale: 0.9,
      limbLength: 1.35,
      earSize: 0.65,
      muzzleSize: 0.7,
      furPalette: ['#1f1d1b', '#f5f0e8', '#c9a08a'],
      accessories: ['feather_boa'],
    },
    passive: {
      id: 'grace',
      name: 'Grace',
      desc: 'Her card plays happen in brief, elegant slow motion.',
    },
  },
  {
    id: 'chugs',
    name: 'Chugs',
    silhouette: {
      bodyScale: 1.4,
      limbLength: 0.95,
      earSize: 1.0,
      muzzleSize: 1.0,
      furPalette: ['#6b4a2e', '#8f6a45', '#e3c3a3'],
      accessories: ['tank_top', 'beer_mug'],
    },
    passive: {
      id: 'ironGut',
      name: 'Iron Gut',
      desc: 'Survives cannon shots with a mighty hiccup instead of a flinch.',
    },
  },
  {
    id: 'echo',
    name: 'Echo',
    silhouette: {
      bodyScale: 0.85,
      limbLength: 1.45,
      earSize: 0.85,
      muzzleSize: 0.75,
      furPalette: ['#d8cfc0', '#3a332c', '#f0e6d8'],
      accessories: ['mask_markings'],
    },
    passive: {
      id: 'mimic',
      name: 'Mimic',
      desc: 'Automatically mirrors the last emote used at the table.',
    },
  },
  {
    id: 'shadySlim',
    name: 'Shady Slim',
    silhouette: {
      bodyScale: 0.75,
      limbLength: 1.6,
      earSize: 0.8,
      muzzleSize: 0.85,
      furPalette: ['#3b3b3b', '#575046', '#c9b295'],
      accessories: ['trench_coat', 'fedora'],
    },
    passive: {
      id: 'smokescreen',
      name: 'Smokescreen',
      desc: 'A wisp of smoke curls off his face-down cards.',
    },
  },
  {
    id: 'kingKola',
    name: 'King Kola',
    silhouette: {
      bodyScale: 1.7,
      limbLength: 1.05,
      earSize: 0.55,
      muzzleSize: 1.25,
      furPalette: ['#26221e', '#8c8578', '#4d4238'],
      accessories: ['soda_can_crown'],
    },
    passive: {
      id: 'fanfare',
      name: 'Fanfare',
      desc: 'A royal horn sounds whenever he wins a round.',
    },
  },
  {
    id: 'nibbles',
    name: 'Nibbles',
    silhouette: {
      bodyScale: 0.45,
      limbLength: 1.2,
      earSize: 1.2,
      muzzleSize: 0.6,
      furPalette: ['#c9952e', '#e8c05f', '#f5e3b8'],
      accessories: ['acorn_pouch'],
    },
    passive: {
      id: 'speedEater',
      name: 'Speed Eater',
      desc: 'His deal animation runs at double speed.',
    },
  },
  {
    id: 'madameMystery',
    name: 'Madame Mystery',
    silhouette: {
      bodyScale: 0.95,
      limbLength: 1.0,
      earSize: 0.7,
      muzzleSize: 0.65,
      furPalette: ['#452a5c', '#6b4585', '#d9c7e8'],
      accessories: ['veil', 'crystal_ball'],
    },
    passive: {
      id: 'prophecy',
      name: 'Prophecy',
      desc: 'Publicly "predicts" a match winner at the first round start.',
    },
  },
  {
    id: 'bolt',
    name: 'Bolt',
    silhouette: {
      bodyScale: 1.0,
      limbLength: 1.1,
      earSize: 0.9,
      muzzleSize: 0.8,
      furPalette: ['#22262e', '#3d4657', '#35e8d0'],
      accessories: ['neon_arm', 'led_visor'],
    },
    passive: {
      id: 'glitch',
      name: 'Glitch',
      desc: 'His emotes leave a flickering neon trail.',
    },
  },
];

/** Lookup a monkey by id (or undefined). */
export function getMonkey(id) {
  return MONKEYS.find((m) => m.id === id);
}

export const DEFAULT_MONKEY_ID = MONKEYS[0].id;
