// The other 5 modes — registered so they appear in lobby settings, but not
// playable in the slice (PLAN.md §4.3). Starting them is blocked in lobby
// validation with error code NOT_PLAYABLE; if anything ever reaches the
// factory anyway, it throws a NotPlayableError carrying the same code.

import { MODES } from '@monkeybar/shared/modes.js';

export const NOT_PLAYABLE = 'NOT_PLAYABLE';

export class NotPlayableError extends Error {
  /** @param {string} modeId */
  constructor(modeId) {
    super(`mode '${modeId}' is not playable in this build`);
    this.code = NOT_PLAYABLE;
    this.modeId = modeId;
  }
}

/**
 * Register every non-playable mode from the shared registry.
 * @param {(id: string, factory: Function, meta: {playable: boolean}) => void} registerMode
 */
export function registerStubModes(registerMode) {
  for (const mode of MODES) {
    if (mode.playable) continue;
    registerMode(
      mode.id,
      () => {
        throw new NotPlayableError(mode.id);
      },
      { playable: false }
    );
  }
}
