// V3/G35: v3-nutella.js — Nutella + Nougatschleuse strings (PLAN3 §B7/§C6).
// Stub created by G34 (§E0.1-2); G35 owns the keys — always EN + DE.
// No other agent may edit this module.
//
// Refusal reuse (§C6.4): sick → the existing v2 'toast.junkRefusedSick',
// sleeping → 'toast.sleeping'. Only cooldown/noJar need new copy.

/** @type {Record<string, string>} */
export const EN = {
  // §C6.1: the food row (DE name exactly „Nutella", EN „Nutella")
  'food.nutella': 'Nutella',

  // §C6.3: shop furniture card + install moment
  'nougat.shopName': 'Nougat Sluice',
  'nougat.shopDesc': 'Wall-mounted chocolate dispenser. Crank it, Gooby chomps it.',
  'nougat.installed': 'The Nougat Sluice is installed!',

  // §C6.4: use + refusal toasts
  'nougat.jarUsed': '−1 Nutella',
  'nougat.cooldown': 'Gooby needs a nougat break',
  'nougat.noJar': 'No Nutella! Off to the shop',
};

/** @type {Record<string, string>} */
export const DE = {
  'food.nutella': 'Nutella',

  'nougat.shopName': 'Nougatschleuse',
  'nougat.shopDesc': 'Wandmontierter Schoko-Spender. Kurbeln, Gooby mampft.',
  'nougat.installed': 'Die Nougatschleuse ist installiert!',

  'nougat.jarUsed': '−1 Nutella',
  'nougat.cooldown': 'Gooby braucht eine Nougat-Pause',
  'nougat.noJar': 'Keine Nutella! Ab in den Laden',
};
