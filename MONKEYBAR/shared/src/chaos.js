// Custom Chaos knob schema — RELEASE_PLAN.md §B.4 / PLAN.md §10 (binding contract).
// Host-tunable knobs over the Monkey Lies engine. The server clamps every
// updateSettings `chaos` patch through validateKnobs(); clients render the
// same schema for the host UI. Zero dependencies.

/**
 * One knob's bounds + default (`def`); `label`/`desc` feed the host UI.
 * @typedef {Object} ChaosKnobSpec
 * @property {number} min
 * @property {number} max
 * @property {number} def
 * @property {string} label
 * @property {string} desc
 */

/**
 * The full knob set.
 * @typedef {Object} ChaosKnobs
 * @property {number} handSize         cards dealt per round (3–7)
 * @property {number} maxPlay          max cards per PLAY (1–4, never above handSize)
 * @property {number} startChambers    cannon chambers per player (2–8)
 * @property {number} startCoconuts    coconuts loaded per player (1–3)
 * @property {number} chipsPerMatch    Lucky Banana Chips per match (0–3)
 * @property {number} chipBonus        temp chambers a chip adds (1–4)
 * @property {number} goldenPerPlayer  wild Golden Bananas per player in the deck (0–2)
 */

/** @type {Readonly<Record<keyof ChaosKnobs, ChaosKnobSpec>>} */
export const CHAOS_KNOB_SCHEMA = Object.freeze({
  handSize: {
    min: 3, max: 7, def: 5,
    label: 'Hand Size',
    desc: 'Cards dealt to every living player each round.',
  },
  maxPlay: {
    min: 1, max: 4, def: 3,
    label: 'Max Play',
    desc: 'Most cards allowed in a single play (never above hand size).',
  },
  startChambers: {
    min: 2, max: 8, def: 4,
    label: 'Cannon Chambers',
    desc: 'Chambers every player starts the match with.',
  },
  startCoconuts: {
    min: 1, max: 3, def: 1,
    label: 'Coconuts Loaded',
    desc: 'Coconuts in every cannon at match start.',
  },
  chipsPerMatch: {
    min: 0, max: 3, def: 1,
    label: 'Lucky Chips',
    desc: 'Lucky Banana Chips granted per match.',
  },
  chipBonus: {
    min: 1, max: 4, def: 2,
    label: 'Chip Bonus',
    desc: 'Temporary chambers a chip bolts on for one shot.',
  },
  goldenPerPlayer: {
    min: 0, max: 2, def: 1,
    label: 'Wilds Per Monkey',
    desc: 'Golden Bananas added to the deck per player (native deck ≈ 0.5, rounded up).',
  },
});

/** Knob names, in schema order. */
export const CHAOS_KNOB_KEYS = Object.freeze(Object.keys(CHAOS_KNOB_SCHEMA));

/** The default knob set (a fresh copy each call). @returns {ChaosKnobs} */
export function defaultKnobs() {
  /** @type {ChaosKnobs} */
  const out = {};
  for (const key of CHAOS_KNOB_KEYS) out[key] = CHAOS_KNOB_SCHEMA[key].def;
  return out;
}

/** Frozen default knob set (use defaultKnobs() when you need a mutable copy). */
export const DEFAULT_KNOBS = Object.freeze(defaultKnobs());

/**
 * Validate a knob patch into a complete, in-bounds knob set.
 * Unknown keys are dropped; missing keys fall back to `base`; numeric values
 * are rounded to integers and clamped to their schema bounds; non-numeric
 * values fall back to `base`. Finally `maxPlay` is capped at `handSize`.
 * Pure: neither `patch` nor `base` is mutated.
 * @param {Partial<ChaosKnobs>} [patch]
 * @param {ChaosKnobs} [base]  defaults to DEFAULT_KNOBS
 * @returns {ChaosKnobs}
 */
export function validateKnobs(patch = {}, base = DEFAULT_KNOBS) {
  /** @type {ChaosKnobs} */
  const out = {};
  const src = patch && typeof patch === 'object' ? patch : {};
  for (const key of CHAOS_KNOB_KEYS) {
    const { min, max, def } = CHAOS_KNOB_SCHEMA[key];
    const fallback = typeof base[key] === 'number' && Number.isFinite(base[key]) ? base[key] : def;
    const raw = typeof src[key] === 'number' && Number.isFinite(src[key]) ? src[key] : fallback;
    out[key] = Math.min(max, Math.max(min, Math.round(raw)));
  }
  if (out.maxPlay > out.handSize) out.maxPlay = out.handSize;
  return out;
}
