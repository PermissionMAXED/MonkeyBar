// RETIRED (R2): this file's stub-registration role ended when the five locked
// modes became per-mode inert modules (bananaDice.js, coconutRoulette.js,
// junglePoker.js, kingOfTheBar.js, customChaos.js — see modes/index.js for
// the module convention). It now only hosts the NOT_PLAYABLE error code and
// NotPlayableError, which the lobby layer uses to block starting locked modes
// and the registry installs as the throwing factory for engine-less modules.

export const NOT_PLAYABLE = 'NOT_PLAYABLE';

export class NotPlayableError extends Error {
  /** @param {string} modeId */
  constructor(modeId) {
    super(`mode '${modeId}' is not playable in this build`);
    this.code = NOT_PLAYABLE;
    this.modeId = modeId;
  }
}
