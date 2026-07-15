// Minigame implementation discovery (§E8): import.meta.glob over games/*.js.
// Metadata lives in data/minigames.js; an entry without a module here renders
// as "coming soon" in the arcade (must be zero at ship).

const modules = import.meta.glob('./games/*.js');

/** @param {string} path './games/foo.js' → 'foo' */
function idOf(path) {
  return path.replace('./games/', '').replace('.js', '');
}

/** @type {Record<string, () => Promise<object>>} id → lazy loader */
const loaders = Object.fromEntries(Object.entries(modules).map(([path, load]) => [idOf(path), load]));

/**
 * @param {string} id
 * @returns {boolean} true when an implementation module exists
 */
export function hasGame(id) {
  return id in loaders;
}

/** @returns {string[]} ids of all implemented games */
export function implementedIds() {
  return Object.keys(loaders);
}

/**
 * Load a game module's default export (§E8 plugin shape:
 * { id, assetKeys, init(ctx), update(dt, elapsed), dispose() }).
 * @param {string} id
 * @returns {Promise<object>}
 */
export async function loadGame(id) {
  const load = loaders[id];
  if (!load) throw new Error(`[minigames] no implementation for '${id}'`);
  const mod = await load();
  const game = mod.default;
  if (!game || typeof game.init !== 'function') {
    throw new Error(`[minigames] '${id}' does not default-export a valid game`);
  }
  return game;
}
