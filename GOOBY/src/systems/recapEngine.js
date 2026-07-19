// V4/G55 — recapEngine (PLAN4 §B5.1) — plan-name entry point. The
// implementation lives in systems/recap.js (same agent, same contract); this
// re-export exists because every cross-agent reference in PLAN4 (§E G53's
// lazy `recapEngine.snapshot` import for migrations[3], G63/G64's consumer
// blocks, §C-SYS2.9) names `systems/recapEngine.js`. Import from EITHER path
// — both resolve to the one pure module. No logic may ever live here.

export {
  RECAP,
  STAT_CATALOG,
  defaultRecapSlice,
  initialLastRecapLevel,
  snapshot,
  diff,
  selectLines,
  formatLine,
  highestMilestone,
  milestoneCrossed,
  completeRecap,
  resolveBeats,
  beatGrid,
} from './recap.js';
