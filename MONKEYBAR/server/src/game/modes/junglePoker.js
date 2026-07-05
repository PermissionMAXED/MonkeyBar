// Jungle Poker — INERT STUB (R2). PLAN.md §4.3 rules sketch; §10.3 snapshot.
//
// MODE MODULE CONVENTION (see modes/index.js): every modes/<mode>.js exports
// { MODE_ID, PLAYABLE, createEngine }. The Wave 3 mode agent (R6) edits ONLY
// this file to flip PLAYABLE to true and provide
//   createEngine(options) → engine
// honoring the engine contract in modes/index.js (sane onTimeout defaults —
// bot seats without a brain are driven purely through timeouts).

export const MODE_ID = 'junglePoker';
export const PLAYABLE = false;
export const createEngine = null;
