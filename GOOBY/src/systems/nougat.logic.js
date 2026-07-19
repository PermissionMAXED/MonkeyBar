// V3/G35 — Nougatschleuse pure logic (§B7 / §C6.4, numbers frozen here per
// the §E0.1-2 ruling: constants.js stays closed, 3.0 numbers live in the
// owning module). No three.js/DOM imports — test/nougat.test.js runs this
// headlessly under node:test.
//
// The wall-mounted kitchen chocolate dispenser: tap → refusal checks
// (sleeping / sick / no jar / cooldown) → 2.8 s crank+glob sequence (wiring:
// home/interactions.js) → effects through the EXISTING pure pipes
// (stats.applyDeltas, health.onEat junk ×2, weight.onEat ×1, leveling.applyXp,
// inventory.remove) — composed here so the whole state math stays pure and
// unit-testable, while the wiring only handles juice/toasts/anim.

import { applyDeltas } from './stats.js';
import { onEat as healthOnEat } from './health.js';
import { onEat as weightOnEat } from './weight.js';
import { applyXp } from './leveling.js';
import { remove as invRemove, count as invCount } from './inventory.js';

/** §C6.4 exact numbers (frozen). */
export const NOUGAT = Object.freeze({
  /** Cooldown between globs: 30 REAL minutes (persisted `nougat.lastGlobAt`). */
  COOLDOWN_MIN: 30,
  /** Stat deltas per glob (through stats.applyDeltas). */
  STAT_DELTAS: Object.freeze({ hunger: 15, fun: 10, hygiene: -8 }),
  /** junkScore +2 — DOUBLE junk (pure nougat): health.onEat({junk:true}) ×2. */
  JUNK_EATS: 2,
  /** weight +2 — weight.onEat(junk) ×1 (WEIGHT.EAT_JUNK = 2). */
  WEIGHT_EATS: 1,
  /** XP per glob. */
  XP: 2,
  /** Consumes 1 nutella jar from the inventory per glob. */
  JAR_FOOD_ID: 'nutella',
  /** Crank+glob sequence length (wiring/anim budget, §C6.4 ≈ 2.8 s). */
  SEQUENCE_SEC: 2.8,
  /** Messy-face cheek smears last 60 s (or until washed). */
  MESSY_FACE_SEC: 60,
  /** Shop card (§C6.3): furniture tab, 400 c, unlock L5, auto-mounts. */
  PRICE: 400,
  UNLOCK_LEVEL: 5,
});

/**
 * @typedef {'cooldown'|'noJar'|'sick'|'sleeping'} NougatRefusal
 */

/**
 * Cooldown remaining from the persisted timestamp (0 when ready).
 * V3/FIX-A (E2 P2-1) defensive clamp: a lastGlobAt further in the future
 * than one full cooldown can't come from legitimate clock skew (a pinned
 * ?now= / device-clock rollback keeps the stamp within rollback-size of
 * nowMs and is preserved so a rollback never unlocks the machine early) —
 * treat such junk as "just globbed" so the machine is never soft-locked for
 * ~285k years (save.js validate() clamps the persisted value to now() at
 * load; this guards states poked at runtime, e.g. via the dev console).
 * @param {{nougat?: {lastGlobAt?: number}}} state store snapshot (or slice)
 * @param {number} nowMs
 * @returns {number} ms until the next glob is allowed
 */
export function cooldownRemainingMs(state, nowMs) {
  let last = Number(state?.nougat?.lastGlobAt) || 0;
  if (last <= 0) return 0;
  if (last > nowMs + NOUGAT.COOLDOWN_MIN * 60000) last = nowMs;
  return Math.max(0, last + NOUGAT.COOLDOWN_MIN * 60000 - nowMs);
}

/**
 * §C6.4 refusal matrix — tap requires: not sleeping, not sick, ≥ 1 nutella
 * jar, cooldown elapsed (checked in that order).
 * @param {{sleep?: {sleeping?: boolean}, health?: {state?: string},
 *   inventory?: object, nougat?: {lastGlobAt?: number}}} state
 * @param {number} nowMs
 * @returns {{ok: true}|{ok: false, reason: NougatRefusal}}
 */
export function canGlob(state, nowMs) {
  if (state?.sleep?.sleeping) return { ok: false, reason: 'sleeping' };
  if (state?.health?.state === 'sick') return { ok: false, reason: 'sick' };
  if (invCount(state?.inventory ?? {}, NOUGAT.JAR_FOOD_ID) < 1) return { ok: false, reason: 'noJar' };
  if (cooldownRemainingMs(state, nowMs) > 0) return { ok: false, reason: 'cooldown' };
  return { ok: true };
}

/**
 * Apply one glob's full effect set (§C6.4 exact numbers) through the existing
 * pure pipes. Pure — never mutates the input; returns the new slices plus the
 * XP grant breakdown so the wiring can toast level-ups.
 *
 * Refusals are NOT re-checked here beyond the jar (callers gate on canGlob);
 * a missing jar still fails closed.
 *
 * @param {{stats: object, inventory: object, health: object, weight: object,
 *   xp: number, level: number, nougat?: {lastGlobAt?: number, installed?: boolean},
 *   achievements?: {counters?: object}}} state store snapshot
 * @param {number} nowMs
 * @returns {{ok: false, reason: 'noJar'} | {ok: true,
 *   stats: object, inventory: object, health: object, weight: object,
 *   xp: number, level: number, levelsGained: number, coinsAwarded: number,
 *   nougat: {lastGlobAt: number, installed: boolean},
 *   nougatGlobs: number}}
 */
export function applyGlob(state, nowMs) {
  const inventory = invRemove(state.inventory, NOUGAT.JAR_FOOD_ID);
  if (inventory == null) return { ok: false, reason: 'noJar' };

  const stats = applyDeltas(state.stats, NOUGAT.STAT_DELTAS);

  // double junk (§C6.4): two junk "bites" through the health pipe → junkScore
  // +2, warning/recovery semantics identical to eating two junk foods
  let health = state.health;
  for (let i = 0; i < NOUGAT.JUNK_EATS; i += 1) {
    health = healthOnEat(health, { junk: true });
  }
  // weight +2 = ONE junk eat (WEIGHT.EAT_JUNK) — not doubled (§C6.4)
  let weight = state.weight;
  for (let i = 0; i < NOUGAT.WEIGHT_EATS; i += 1) {
    weight = weightOnEat(weight, { junk: true });
  }

  const prog = applyXp({ xp: state.xp, level: state.level }, NOUGAT.XP, 'nougat'); // V4/G56: xpGranted source tag (§C-SYS3.1 #12)

  return {
    ok: true,
    stats,
    inventory,
    health,
    weight,
    xp: prog.xp,
    level: prog.level,
    levelsGained: prog.levelsGained,
    coinsAwarded: prog.coinsAwarded,
    nougat: { ...(state.nougat ?? {}), installed: state.nougat?.installed === true, lastGlobAt: nowMs },
    nougatGlobs: (Number(state.achievements?.counters?.nougatGlobs) || 0) + 1,
  };
}
