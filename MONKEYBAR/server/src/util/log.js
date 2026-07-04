// Tiny leveled logger — PLAN.md §2 (server/src/util/log.js).
// Levels: debug < info < warn < error < silent. Default level comes from
// LOG_LEVEL env (falls back to "info"). `child(sub)` produces a scoped logger.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

/**
 * @param {string} [scope]
 * @param {string} [level]  one of debug|info|warn|error|silent
 * @returns {{
 *   level: string,
 *   debug: (...args: unknown[]) => void,
 *   info: (...args: unknown[]) => void,
 *   warn: (...args: unknown[]) => void,
 *   error: (...args: unknown[]) => void,
 *   child: (sub: string) => Object,
 * }}
 */
export function createLogger(scope = 'monkeybar', level = process.env.LOG_LEVEL || 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  const make = (lvl, sink) => {
    if (LEVELS[lvl] < threshold) return () => {};
    return (...args) => sink(`[${new Date().toISOString()}] [${lvl}] [${scope}]`, ...args);
  };

  return {
    level,
    debug: make('debug', console.log),
    info: make('info', console.log),
    warn: make('warn', console.warn),
    error: make('error', console.error),
    child: (sub) => createLogger(`${scope}:${sub}`, level),
  };
}
