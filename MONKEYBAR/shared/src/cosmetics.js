// 1.0 cosmetics catalog — RELEASE_PLAN.md §B.4 / PLAN.md §10 (binding contract).
// Bought with Banana Coins, gated by level; equipped ids ride on
// MemberInfo.cosmetics / SeatPublic.cosmetics (never full inventories).
// The four legacy slice ids (banana_pin, neon_shades, crown_of_the_bar,
// vip_stool) keep their ids so pre-1.0 unlocks map 1:1.

/** The four equip slots. @enum {string} */
export const SLOTS = Object.freeze({
  HAT: 'hat',
  SKIN: 'skin',
  TABLE: 'table',
  DECO: 'deco',
});

/** Slot ids as a list (stable order for shop tabs). */
export const SLOT_IDS = Object.freeze([SLOTS.HAT, SLOTS.SKIN, SLOTS.TABLE, SLOTS.DECO]);

/**
 * @typedef {Object} Cosmetic
 * @property {string} id
 * @property {string} name
 * @property {string} glyph
 * @property {string} desc
 * @property {string} slot      one of SLOTS
 * @property {number} price     Banana Coins, 50–500
 * @property {number} minLevel  level gate, 1–10
 */

/** @type {Cosmetic[]} */
export const COSMETICS = [
  // ---- hats (8) ----
  {
    id: 'banana_pin',
    name: 'Banana Lapel Pin',
    glyph: '🍌',
    desc: 'A modest golden pin. Proof you have survived the cannon at least once.',
    slot: SLOTS.HAT,
    price: 50,
    minLevel: 1,
  },
  {
    id: 'party_cone',
    name: 'Party Cone',
    glyph: '🥳',
    desc: 'A crooked paper cone. Every night at the Parrot is somebody\u2019s birthday.',
    slot: SLOTS.HAT,
    price: 80,
    minLevel: 1,
  },
  {
    id: 'propeller_cap',
    name: 'Propeller Cap',
    glyph: '🧢',
    desc: 'Spins faster the harder you bluff. Aerodynamically dishonest.',
    slot: SLOTS.HAT,
    price: 100,
    minLevel: 2,
  },
  {
    id: 'neon_shades',
    name: 'Neon Shades',
    glyph: '🕶️',
    desc: 'Impossible to read your eyes. Slightly easier to walk into stools.',
    slot: SLOTS.HAT,
    price: 120,
    minLevel: 2,
  },
  {
    id: 'chef_toque',
    name: 'Chef\u2019s Toque',
    glyph: '🍳',
    desc: 'You did not earn this in a kitchen. You earned it cooking opponents.',
    slot: SLOTS.HAT,
    price: 150,
    minLevel: 3,
  },
  {
    id: 'pirate_hat',
    name: 'Pirate Hat',
    glyph: '🏴\u200d☠️',
    desc: 'Captain Splinter swears he lost this one fair and square.',
    slot: SLOTS.HAT,
    price: 180,
    minLevel: 3,
  },
  {
    id: 'gold_monocle',
    name: 'Gold Monocle',
    glyph: '🧐',
    desc: 'See through lies. Or at least look like you can.',
    slot: SLOTS.HAT,
    price: 260,
    minLevel: 5,
  },
  {
    id: 'crown_of_the_bar',
    name: 'Crown of the Bar',
    glyph: '👑',
    desc: 'The soda-can crown of legend. King Kola pretends not to mind.',
    slot: SLOTS.HAT,
    price: 500,
    minLevel: 10,
  },

  // ---- skins (6 fur dyes) ----
  {
    id: 'midnight',
    name: 'Midnight Dye',
    glyph: '🌑',
    desc: 'Fur so dark the spotlight gives up. Great for lurking in your own seat.',
    slot: SLOTS.SKIN,
    price: 100,
    minLevel: 1,
  },
  {
    id: 'albino',
    name: 'Albino Dye',
    glyph: '🤍',
    desc: 'Ghost-white fur. The table swears they can see through you. They cannot.',
    slot: SLOTS.SKIN,
    price: 120,
    minLevel: 2,
  },
  {
    id: 'cherry',
    name: 'Cherry Dye',
    glyph: '🍒',
    desc: 'Flushed permanently. Nobody can tell when you\u2019re actually sweating.',
    slot: SLOTS.SKIN,
    price: 150,
    minLevel: 2,
  },
  {
    id: 'neon_lime',
    name: 'Neon Lime Dye',
    glyph: '🟢',
    desc: 'Radioactive-adjacent. Pairs beautifully with every neon sign in town.',
    slot: SLOTS.SKIN,
    price: 150,
    minLevel: 3,
  },
  {
    id: 'royal_purple',
    name: 'Royal Purple Dye',
    glyph: '🟣',
    desc: 'The dye of monkey nobility. Or at least of monkeys with coins to burn.',
    slot: SLOTS.SKIN,
    price: 250,
    minLevel: 5,
  },
  {
    id: 'gilded',
    name: 'Gilded Dye',
    glyph: '✨',
    desc: 'Actual gold leaf in the fur. Baron Bananas keeps offering to buy you.',
    slot: SLOTS.SKIN,
    price: 450,
    minLevel: 8,
  },

  // ---- tables (4, incl. legacy vip_stool re-slotted) ----
  {
    id: 'barrel_throne',
    name: 'Barrel Throne',
    glyph: '🛢️',
    desc: 'An upended rum barrel. Smells like victory and old varnish.',
    slot: SLOTS.TABLE,
    price: 120,
    minLevel: 2,
  },
  {
    id: 'tiki_bench',
    name: 'Tiki Bench',
    glyph: '🌴',
    desc: 'Carved palm, seats one monkey and their ego comfortably.',
    slot: SLOTS.TABLE,
    price: 160,
    minLevel: 3,
  },
  {
    id: 'vip_stool',
    name: 'VIP Bar Stool',
    glyph: '🪑',
    desc: 'Velvet seat, brass legs, reserved plaque. The Parrot respects a regular.',
    slot: SLOTS.TABLE,
    price: 200,
    minLevel: 4,
  },
  {
    id: 'velvet_booth',
    name: 'Velvet Booth',
    glyph: '🛋️',
    desc: 'A whole booth to yourself. Power move at a round table.',
    slot: SLOTS.TABLE,
    price: 320,
    minLevel: 6,
  },

  // ---- deco (4) ----
  {
    id: 'parrot_perch',
    name: 'Parrot Perch',
    glyph: '🦜',
    desc: 'A live parrot that repeats your best table talk. Unhelpfully loudly.',
    slot: SLOTS.DECO,
    price: 140,
    minLevel: 2,
  },
  {
    id: 'disco_ball',
    name: 'Disco Ball',
    glyph: '🪩',
    desc: 'Hangs over your seat. Every call you make becomes a dance number.',
    slot: SLOTS.DECO,
    price: 220,
    minLevel: 4,
  },
  {
    id: 'lava_lamp_rail',
    name: 'Lava Lamp Rail',
    glyph: '🫧',
    desc: 'A row of slow-blooping lamps along your rail. Deeply hypnotic. Possibly a tell.',
    slot: SLOTS.DECO,
    price: 280,
    minLevel: 5,
  },
  {
    id: 'golden_cannon',
    name: 'Golden Cannon',
    glyph: '🎇',
    desc: 'A gilded replica of the Coconut Cannon on your rail. It has never missed you.',
    slot: SLOTS.DECO,
    price: 500,
    minLevel: 9,
  },
];

/** Lookup a cosmetic by id (or undefined). */
export function getCosmetic(id) {
  return COSMETICS.find((c) => c.id === id);
}

/**
 * All cosmetics for one slot, in catalog (price-ish) order.
 * @param {string} slot  one of SLOTS
 * @returns {Cosmetic[]}
 */
export function getCosmeticsBySlot(slot) {
  return COSMETICS.filter((c) => c.slot === slot);
}
