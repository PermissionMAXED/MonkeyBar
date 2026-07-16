// Emotion state machine (§D2.5): the mood band (§C1) sets Gooby's default
// emotion; low-stat overrides (exhausted → sleepy, starving → hungry) refine
// it; a context (eating, sleeping, dizzy…) overrides everything:
//
//     emotion = context ?? statOverride(stats) ?? moodEmotion(mood)
//
// PURE module — no three.js/DOM imports (unit-tested in test/goobyApi.test.js).
// The FACES table is pure data consumed by character/goobyFace.js + gooby.js.

import { STATS } from '../data/constants.js';
import { moodBand } from '../systems/stats.js';

/** The 8 emotion ids (§D2.3 setEmotion contract). */
export const EMOTION_IDS = Object.freeze([
  'neutral', 'happy', 'ecstatic', 'sad', 'grumpy', 'sleepy', 'hungry', 'dizzy',
]);

/** The 5 pre-built mouth shape mesh ids (§D2.2). */
export const MOUTH_IDS = Object.freeze(['smile', 'open', 'frown', 'flat', 'chew']);

/** Mood band (§C1) → default emotion (§D2.5). */
const BAND_EMOTION = Object.freeze({
  ecstatic: 'ecstatic',
  happy: 'happy',
  neutral: 'neutral',
  grumpy: 'grumpy',
  miserable: 'sad',
});

/**
 * @typedef {Object} FaceDef
 * @property {'smile'|'open'|'frown'|'flat'|'chew'} mouth  default mouth shape
 * @property {number} mouthScale   scale multiplier on the mouth mesh
 * @property {number} lids         eyelid base 0 (open) … 1.25 (closed)
 * @property {number} earDroopL    left-ear droop (rad, + folds down/back)
 * @property {number} earDroopR    right-ear droop (rad)
 * @property {number} headPitch    head pitch offset (rad, + looks down)
 * @property {number} armsHang     0 = paws on belly … 1 = arms hanging limp
 * @property {boolean} shine2      double eye shine (ecstatic ×2, §D2.5)
 * @property {boolean} drool       drool drop mesh visible (hungry)
 * @property {boolean} spiral      spiral pupil overlay (dizzy)
 * @property {boolean} blush       cheek blush pulse
 * @property {boolean} bounceIdle  bouncy idle variant (ecstatic)
 * @property {boolean} slowBlink   long lazy blinks (sleepy)
 * @property {number} yawnEverySec 0 = never; sleepy yawns every ~8 s (§D2.5)
 * @property {number} rumbleEverySec 0 = never; hungry belly rumble interval
 */

/**
 * Face table (§D2.5) — one entry per emotion. Pure data.
 * @type {Readonly<Record<string, Readonly<FaceDef>>>}
 */
export const FACES = Object.freeze({
  neutral: Object.freeze({
    mouth: 'smile', mouthScale: 0.75, lids: 0.05, earDroopL: 0.06, earDroopR: 0.06,
    headPitch: 0, armsHang: 0, shine2: false, drool: false, spiral: false,
    blush: false, bounceIdle: false, slowBlink: false, yawnEverySec: 0, rumbleEverySec: 0,
  }),
  happy: Object.freeze({
    mouth: 'smile', mouthScale: 1, lids: 0, earDroopL: 0, earDroopR: 0,
    headPitch: 0, armsHang: 0, shine2: false, drool: false, spiral: false,
    blush: true, bounceIdle: false, slowBlink: false, yawnEverySec: 0, rumbleEverySec: 0,
  }),
  ecstatic: Object.freeze({
    mouth: 'smile', mouthScale: 1.25, lids: 0, earDroopL: -0.1, earDroopR: -0.1,
    headPitch: -0.04, armsHang: 0, shine2: true, drool: false, spiral: false,
    blush: true, bounceIdle: true, slowBlink: false, yawnEverySec: 0, rumbleEverySec: 0,
  }),
  sad: Object.freeze({
    mouth: 'frown', mouthScale: 1, lids: 0.3, earDroopL: 0.7, earDroopR: 0.7,
    headPitch: 0.26, armsHang: 1, shine2: false, drool: false, spiral: false,
    blush: false, bounceIdle: false, slowBlink: false, yawnEverySec: 0, rumbleEverySec: 0,
  }),
  grumpy: Object.freeze({
    mouth: 'flat', mouthScale: 1, lids: 0.45, earDroopL: 0.7, earDroopR: 0.08,
    headPitch: 0.06, armsHang: 0, shine2: false, drool: false, spiral: false,
    blush: false, bounceIdle: false, slowBlink: false, yawnEverySec: 0, rumbleEverySec: 0,
  }),
  sleepy: Object.freeze({
    mouth: 'flat', mouthScale: 0.8, lids: 0.6, earDroopL: 0.35, earDroopR: 0.3,
    headPitch: 0.1, armsHang: 0.4, shine2: false, drool: false, spiral: false,
    blush: false, bounceIdle: false, slowBlink: true, yawnEverySec: 8, rumbleEverySec: 0,
  }),
  hungry: Object.freeze({
    mouth: 'flat', mouthScale: 1, lids: 0.15, earDroopL: 0.2, earDroopR: 0.2,
    headPitch: 0.05, armsHang: 0.2, shine2: false, drool: true, spiral: false,
    blush: false, bounceIdle: false, slowBlink: false, yawnEverySec: 0,
    rumbleEverySec: STATS.DROOL_WOBBLE_EVERY_SEC,
  }),
  dizzy: Object.freeze({
    mouth: 'open', mouthScale: 0.9, lids: 0.05, earDroopL: 0.3, earDroopR: 0.35,
    headPitch: 0, armsHang: 0.5, shine2: false, drool: false, spiral: true,
    blush: false, bounceIdle: false, slowBlink: false, yawnEverySec: 0, rumbleEverySec: 0,
  }),
});

/**
 * Default emotion for a mood value (§C1 bands → §D2.5).
 * @param {number} moodValue 0–100
 * @returns {'ecstatic'|'happy'|'neutral'|'grumpy'|'sad'}
 */
export function moodEmotion(moodValue) {
  return BAND_EMOTION[moodBand(moodValue)];
}

/**
 * Low-stat visual override (§C1): exhausted (energy ≤ 15) → sleepy;
 * starving (hunger < 10) → hungry. Sleepy wins when both apply.
 * @param {{hunger?: number, energy?: number}} [stats]
 * @returns {'sleepy'|'hungry'|null}
 */
export function statOverride(stats) {
  if (!stats) return null;
  if (typeof stats.energy === 'number' && stats.energy <= STATS.EXHAUSTED_AT_OR_BELOW) return 'sleepy';
  if (typeof stats.hunger === 'number' && stats.hunger < STATS.DROOL_BELOW) return 'hungry';
  return null;
}

/**
 * Derive the effective emotion (§D2.5): `context ?? statOverride ?? moodEmotion`.
 * @param {{mood?: number, stats?: {hunger?: number, energy?: number}, context?: string|null}} input
 * @returns {string} one of EMOTION_IDS
 */
export function deriveEmotion({ mood = 60, stats = null, context = null } = {}) {
  if (context != null) return context;
  return statOverride(stats) ?? moodEmotion(mood);
}

/**
 * Stateful emotion machine wrapping deriveEmotion. Feed it mood/stats from the
 * store and push/clear contexts from gameplay (eating, sleeping, dizzy…);
 * subscribe with onChange to drive the face rig.
 *
 * @param {{mood?: number, stats?: object, context?: string|null}} [initial]
 * @returns {{
 *   setMood: (v: number) => string,
 *   setStats: (stats: object|null) => string,
 *   setContext: (id: string|null) => string,  // id must be an EMOTION_IDS member
 *   getContext: () => string|null,
 *   get: () => string,
 *   onChange: (cb: (emotion: string, prev: string) => void) => (() => void),
 * }}
 */
export function createEmotionMachine(initial = {}) {
  let mood = initial.mood ?? 60;
  let stats = initial.stats ?? null;
  let context = initial.context ?? null;
  let current = deriveEmotion({ mood, stats, context });
  /** @type {Set<Function>} */
  const subs = new Set();

  function refresh() {
    const next = deriveEmotion({ mood, stats, context });
    if (next !== current) {
      const prev = current;
      current = next;
      for (const cb of subs) cb(current, prev);
    }
    return current;
  }

  return {
    setMood(v) {
      mood = v;
      return refresh();
    },
    setStats(s) {
      stats = s;
      return refresh();
    },
    setContext(id) {
      if (id != null && !EMOTION_IDS.includes(id)) {
        throw new Error(`[emotions] unknown context emotion '${id}'`);
      }
      context = id;
      return refresh();
    },
    getContext: () => context,
    get: () => current,
    onChange(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
