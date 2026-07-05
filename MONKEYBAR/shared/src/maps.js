// 10 map definitions — PLAN.md §7. The slice shipped the hero bar ("The
// Peeling Parrot") plus 2 palette variants; R8 implemented the remaining 7
// scenes (extraProps builders in client/src/three/mapExtras.js) and flipped
// them playable. `palette` colors + `propParams` drive client/src/three/barScene.js.

/**
 * @typedef {Object} MapPalette
 * @property {string} wall    base wall/wood color
 * @property {string} accent  trim / furniture accent color
 * @property {string} neon    dominant neon sign color
 * @property {string} fog     FogExp2 color
 */

/**
 * @typedef {Object} MapPropParams
 * @property {number} bottleCount    bottles on the back bar
 * @property {number} vineDensity    0–1, hanging vine coverage
 * @property {number} dustDensity    0–1, floating dust motes
 * @property {number} fanSpeed       ceiling fan speed (rad/s)
 * @property {number} lightWarmth    0 (cold) – 1 (warm) key spotlight tint
 * @property {number} fogDensity     FogExp2 density
 * @property {string[]} extraProps   scene-specific prop ids
 */

/**
 * @typedef {Object} BarMap
 * @property {string} id
 * @property {string} name
 * @property {string} desc
 * @property {boolean} playable
 * @property {MapPalette} palette
 * @property {string} signText   text on the main neon sign
 * @property {MapPropParams} propParams
 */

/** @type {BarMap[]} */
export const MAPS = [
  {
    id: 'peeling_parrot',
    name: 'The Peeling Parrot',
    desc:
      'The hero bar. Round dark-wood table under one warm spotlight, bottles glinting behind the bar, ' +
      'vines in the rafters, and a parrot-shaped neon sign that lost half its letters years ago.',
    playable: true,
    palette: { wall: '#3a2a1e', accent: '#7a4f2a', neon: '#39ff88', fog: '#120d08' },
    signText: 'THE PEELING PARROT',
    propParams: {
      bottleCount: 14,
      vineDensity: 0.6,
      dustDensity: 0.5,
      fanSpeed: 0.8,
      lightWarmth: 0.85,
      fogDensity: 0.045,
      extraProps: ['parrot_sign', 'dartboard', 'barrel_stool'],
    },
  },
  {
    id: 'neon_nectar',
    name: 'Neon Nectar',
    desc:
      'The Parrot after a synthwave renovation: magenta tube-light everywhere, chrome trim, ' +
      'nectar cocktails that glow in the dark.',
    playable: true,
    palette: { wall: '#1a1030', accent: '#3d2a6e', neon: '#ff3df0', fog: '#0d0620' },
    signText: 'NEON NECTAR',
    propParams: {
      bottleCount: 18,
      vineDensity: 0.25,
      dustDensity: 0.3,
      fanSpeed: 1.4,
      lightWarmth: 0.35,
      fogDensity: 0.05,
      extraProps: ['neon_palm', 'jukebox', 'chrome_rail'],
    },
  },
  {
    id: 'voodoo_vats',
    name: 'Voodoo Vats',
    desc:
      'A swamp-cellar speakeasy where the brew bubbles in glowing green vats and the vines have opinions.',
    playable: true,
    palette: { wall: '#1c2418', accent: '#3f5230', neon: '#a4ff3d', fog: '#0a1206' },
    signText: 'VOODOO VATS',
    propParams: {
      bottleCount: 10,
      vineDensity: 0.95,
      dustDensity: 0.7,
      fanSpeed: 0.4,
      lightWarmth: 0.55,
      fogDensity: 0.075,
      extraProps: ['brew_vat', 'skull_shelf', 'lantern_string'],
    },
  },
  {
    id: 'rumble_reef',
    name: 'Rumble Reef',
    desc: 'A tiki dive built into a shipwreck: portholes, rope lights, and sand on the floor.',
    playable: true,
    palette: { wall: '#12303d', accent: '#2a5a6e', neon: '#3dc8ff', fog: '#06141c' },
    signText: 'RUMBLE REEF',
    propParams: {
      bottleCount: 12,
      vineDensity: 0.2,
      dustDensity: 0.4,
      fanSpeed: 0.6,
      lightWarmth: 0.5,
      fogDensity: 0.055,
      extraProps: ['ship_wheel', 'porthole', 'net_ceiling'],
    },
  },
  {
    id: 'canopy_casino',
    name: 'Canopy Casino',
    desc: 'High-roller treehouse above the jungle canopy — velvet, gold trim, and a long fall for cheats.',
    playable: true,
    palette: { wall: '#2e1420', accent: '#6e2a3d', neon: '#ffd23d', fog: '#160810' },
    signText: 'CANOPY CASINO',
    propParams: {
      bottleCount: 20,
      vineDensity: 0.4,
      dustDensity: 0.2,
      fanSpeed: 1.0,
      lightWarmth: 0.75,
      fogDensity: 0.035,
      extraProps: ['chip_tower', 'velvet_rope', 'chandelier'],
    },
  },
  {
    id: 'frostbite_lounge',
    name: 'Frostbite Lounge',
    desc: 'An ice-bar folly for snow monkeys: frozen table, steaming hot-spring tub in the corner.',
    playable: true,
    palette: { wall: '#1c2836', accent: '#3a5a7a', neon: '#7ae8ff', fog: '#0a1420' },
    signText: 'FROSTBITE LOUNGE',
    propParams: {
      bottleCount: 8,
      vineDensity: 0.05,
      dustDensity: 0.6,
      fanSpeed: 0.2,
      lightWarmth: 0.2,
      fogDensity: 0.06,
      extraProps: ['ice_sculpture', 'hot_spring', 'icicle_rack'],
    },
  },
  {
    id: 'dune_saloon',
    name: 'Dune Saloon',
    desc: 'Swinging doors, cactus jugs, and a desert wind that never stops rattling the shutters.',
    playable: true,
    palette: { wall: '#4a3620', accent: '#8a6a3a', neon: '#ff9a3d', fog: '#1c1206' },
    signText: 'DUNE SALOON',
    propParams: {
      bottleCount: 11,
      vineDensity: 0.0,
      dustDensity: 0.9,
      fanSpeed: 0.9,
      lightWarmth: 0.9,
      fogDensity: 0.04,
      extraProps: ['cactus_jug', 'wanted_poster', 'swing_doors'],
    },
  },
  {
    id: 'temple_taproom',
    name: 'Temple Taproom',
    desc: 'A bar squatting in ancient ruins — moss-eaten idols watch every bluff, and they judge.',
    playable: true,
    palette: { wall: '#2a2e22', accent: '#565e3a', neon: '#e8d43d', fog: '#10130a' },
    signText: 'TEMPLE TAPROOM',
    propParams: {
      bottleCount: 9,
      vineDensity: 0.8,
      dustDensity: 0.65,
      fanSpeed: 0.0,
      lightWarmth: 0.65,
      fogDensity: 0.07,
      extraProps: ['stone_idol', 'brazier', 'rune_wall'],
    },
  },
  {
    id: 'rooftop_rumpus',
    name: 'Rooftop Rumpus',
    desc: 'City-skyline rooftop bar with string lights, billboard glow, and pigeons eyeing your chips.',
    playable: true,
    palette: { wall: '#22242e', accent: '#4a4e6e', neon: '#ff5a7a', fog: '#0c0d14' },
    signText: 'ROOFTOP RUMPUS',
    propParams: {
      bottleCount: 15,
      vineDensity: 0.1,
      dustDensity: 0.25,
      fanSpeed: 1.2,
      lightWarmth: 0.6,
      fogDensity: 0.03,
      extraProps: ['string_lights', 'billboard', 'ac_unit'],
    },
  },
  {
    id: 'submarine_speakeasy',
    name: 'Submarine Speakeasy',
    desc: 'A leaky sub parked on the sea floor. Sonar pings keep time, and the pressure is literal.',
    playable: true,
    palette: { wall: '#101c22', accent: '#2a4a52', neon: '#3dffc8', fog: '#04100e' },
    signText: 'SUB SPEAKEASY',
    propParams: {
      bottleCount: 7,
      vineDensity: 0.0,
      dustDensity: 0.35,
      fanSpeed: 0.5,
      lightWarmth: 0.3,
      fogDensity: 0.08,
      extraProps: ['periscope', 'valve_wall', 'sonar_screen'],
    },
  },
];

/** Lookup a map by id (or undefined). */
export function getMap(id) {
  return MAPS.find((m) => m.id === id);
}

export const DEFAULT_MAP_ID = 'peeling_parrot';
