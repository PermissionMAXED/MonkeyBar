// V4/G54 — §G5.4 difficulty single source (PLAN4-GAMES; ruling §E0.1-14):
// the per-game Schwer beat-target table. Consumed by economy.awardMinigame
// (`beaten` writes — score ≥ target on the played mode; easy/normal share
// the same number per §G5.5), mgPregame („Ziel: N" — G68) and the eval
// bots. Targets are ≈ 80 % of the coin-cap score (divisor × max), rounded
// friendly, sanity-clamped by documented typical scores — VERBATIM §G5.4
// rows; if a bot can't reach a target on Schwer, the PARAMS are relaxed,
// never the target raised.
//
// `capScore` = the §G5.4 cap-score column (divisor × rowMax — documentation
// + eval-bot sanity). `endless` = the §G5.4 Endlos end-condition, as a
// terse developer/eval note (NOT user-facing copy — the UI strings live in
// G56's strings/v4-difficulty.js and each game's wave-3 module).
//
// Excluded by §G5.1 (no rows, on purpose): cityDrive (trip semantics,
// single difficulty), goobyWelt (§G6 chill special), `_smoke` (dev).
// Pure data: no three.js/DOM imports.

/**
 * @typedef {Object} DifficultyTargetRow
 * @property {number} capScore  §G5.4 cap-score (divisor × rowMax)
 * @property {number} target    Schwer-Ziel: beat Schwer = score ≥ target
 * @property {string} endless   Endlos end-condition (developer note)
 */

/** @type {Readonly<Record<string, Readonly<DifficultyTargetRow>>>} */
export const TARGETS = Object.freeze({
  carrotCatch: Object.freeze({ capScore: 75, target: 70, endless: '3 carrots hit the ground (cumulative)' }),
  bunnyHop: Object.freeze({ capScore: 50, target: 45, endless: 'already run-until-crash: no gate cap, wind always on' }),
  carrotGuard: Object.freeze({ capScore: 75, target: 70, endless: '3 carrots stolen' }),
  goobySays: Object.freeze({ capScore: 120, target: 70, endless: 'already until-fail: replay speed keeps ramping past the floor' }),
  memoryMatch: Object.freeze({ capScore: 48, target: 40, endless: 'boards chain; 12 cumulative miss-flips end it' }),
  basketBounce: Object.freeze({ capScore: 78, target: 65, endless: '3 consecutive misses' }),
  gardenRush: Object.freeze({ capScore: 75, target: 65, endless: '3 withered pots' }),
  pancakeTower: Object.freeze({ capScore: 52, target: 45, endless: 'already until-topple: wobble never damps below stage-8 level' }),
  burgerBuild: Object.freeze({ capScore: 104, target: 85, endless: '3 expired orders' }),
  shoppingSurf: Object.freeze({ capScore: 1360, target: 900, endless: '3 crashes (as arcade); speed ramp continues to 20 m/s, density cap x1.5' }),
  runner: Object.freeze({ capScore: 450, target: 380, endless: '3 crashes, ramp uncapped to +40%' }),
  veggieChop: Object.freeze({ capScore: 130, target: 105, endless: '3 junk hits' }),
  purblePlace: Object.freeze({ capScore: 150, target: 120, endless: '3 rejected/expired cakes end it; interval floor 10 s' }),
  bubblePop: Object.freeze({ capScore: 96, target: 80, endless: '3 spiky-bubble pops' }),
  deliveryRush: Object.freeze({ capScore: 256, target: 200, endless: '3 expired parcels' }),
  fishingPond: Object.freeze({ capScore: 78, target: 65, endless: '3 line breaks/boots' }),
  danceParty: Object.freeze({ capScore: 168, target: 140, endless: '3 full combo breaks (missed section)' }),
  miniGolf: Object.freeze({ capScore: 140, target: 110, endless: 'holes loop; 3 over-par holes end it' }),
  trampoline: Object.freeze({ capScore: 130, target: 105, endless: '3 failed landings' }),
  goalieGooby: Object.freeze({ capScore: 78, target: 65, endless: '3 goals conceded (endless shot stream)' }),
  starHopper: Object.freeze({ capScore: 234, target: 190, endless: 'already until-crash: ramp uncapped, wormholes rarer' }),
  pipeFlow: Object.freeze({ capScore: 125, target: 100, endless: '3 unsolved/leaked puzzles' }),
  toyRacer: Object.freeze({ capScore: 180, target: 150, endless: 'lap chain (races back-to-back); ends when finishing worse than 2nd' }),
  ghostHunt: Object.freeze({ capScore: 112, target: 90, endless: '3 escaped Boo-waves (< 4 catches)' }),
  rocketRescue: Object.freeze({ capScore: 140, target: 115, endless: 'fuel runs out (fuel pickups thin out -10%/platform)' }),
  harborHopper: Object.freeze({ capScore: 150, target: 110, endless: '3 bumps (buoy/pier hits)' }),
});

/**
 * Schwer beat-target for a game (§G5.4) — null for the §G5.1 exclusions
 * (cityDrive, goobyWelt, `_smoke`) and unknown ids.
 * @param {string} gameId
 * @returns {number|null}
 */
export function getTarget(gameId) {
  return TARGETS[gameId]?.target ?? null;
}
