// King of the Bar bot brain — NULL STUB (R2). The R7 mode agent replaces
// createBrain with a real factory ({seat, personalityId, rng}) → brain — see
// bots/brains/index.js for the decision surface (likely wrapping the Monkey
// Lies botBrain). While null, botManager skips the seat and the gameRoom
// fallback drives it via engine.onTimeout.

export const MODE_ID = 'kingOfTheBar';
export const createBrain = null;
