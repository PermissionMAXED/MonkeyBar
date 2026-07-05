// Custom Chaos — INERT STUB (R2). Monkey Lies engine under host-tunable knobs
// (PLAN.md §4.3; §10.3 snapshot = ML extension + knobs).
//
// MODE MODULE CONVENTION (see modes/index.js): every modes/<mode>.js exports
// { MODE_ID, PLAYABLE, createEngine }. The Wave 3 mode agent (R7) edits ONLY
// this file to flip PLAYABLE to true and provide
//   createEngine(options) → engine
// honoring the engine contract in modes/index.js. The lobby room forwards
// the host's validated settings.chaos into the factory options as `knobs`
// (shared/chaos.js ChaosKnobs — already clamped through validateKnobs).

export const MODE_ID = 'customChaos';
export const PLAYABLE = false;
export const createEngine = null;
