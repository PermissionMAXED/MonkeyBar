// King of the Bar — INERT STUB (R2). Monkey Lies + Bar Rule mutators
// (PLAN.md §4.3; §10.3 snapshot = ML extension + barRule).
//
// MODE MODULE CONVENTION (see modes/index.js): every modes/<mode>.js exports
// { MODE_ID, PLAYABLE, createEngine }. The Wave 3 mode agent (R7) edits ONLY
// this file to flip PLAYABLE to true and provide
//   createEngine(options) → engine
// honoring the engine contract in modes/index.js (sane onTimeout defaults —
// bot seats without a brain are driven purely through timeouts).

export const MODE_ID = 'kingOfTheBar';
export const PLAYABLE = false;
export const createEngine = null;
