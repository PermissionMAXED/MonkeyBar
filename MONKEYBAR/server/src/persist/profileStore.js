// Profile persistence — RELEASE_PLAN.md §B.5-1 / PLAN.md §10.5 (R2).
//
// Server-side JSON file store at server/data/profiles.json (gitignored):
//   * loaded synchronously at boot (missing file = fresh store; a corrupt
//     file logs a warning and starts empty);
//   * every mutation schedules a DEBOUNCED save (2 s);
//   * saves are ATOMIC: write a temp file in the same directory, then rename;
//   * any disk failure degrades to a warning — the store keeps serving from
//     memory (in-memory fallback) and retries on the next mutation/flush.
//
// GROWTH GUARD (post-release fix): reads are TRANSIENT. `hello`/welcome and
// getProfile serve payloadFor/getEquipped from a read-only path that never
// stores anything, so anonymous visitors leave no trace. A profile (and the
// token bindings pointing at it) is persisted only once it becomes MEANINGFUL
// — the first real mutation (addRewards / buy / equip / bumpStats). Loading
// prunes empty default profiles and orphan token bindings left by older
// builds.
//
// Identity = the session layer's token→playerId (§3.4): the binding is
// persisted here (bindToken/resolveToken) so a client's saved token still
// resolves to the same profile after a server restart. Losing the token
// means a fresh profile — documented and accepted for 1.0. Bots never
// earn/persist: bot seats are filtered out before the store is ever touched
// (game/economy.js settleMatch).
//
// The ACTIVE-STORE accessor below is how layers that cannot receive the store
// through their constructor options (lobby/room.js payout + member cosmetics)
// reach it; server/src/index.js registers the store at boot.

import { mkdirSync, readFileSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LEVEL_CAP, xpToNext } from '@monkeybar/shared/constants.js';
import { getCosmetic, SLOT_IDS } from '@monkeybar/shared/cosmetics.js';
import { ERROR_CODES } from '@monkeybar/shared/protocol.js';

import { createLogger } from '../util/log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** §B.5-1: server/data/profiles.json (the server/data/ dir is gitignored). */
export const DEFAULT_PROFILE_FILE = resolve(__dirname, '../../data/profiles.json');
/** §B.5-1: mutations are flushed to disk after this debounce. */
export const SAVE_DEBOUNCE_MS = 2000;

const OK = Object.freeze({ ok: true });
const err = (code, msg = '') => ({ ok: false, code, msg });

/**
 * @typedef {Object} StoredProfile
 * @property {string} playerId
 * @property {number} coins     Banana Coins
 * @property {number} xp        progress INTO the current level
 * @property {number} level     1..LEVEL_CAP
 * @property {number} wins
 * @property {number} matches
 * @property {string[]} unlocked   owned cosmetic ids
 * @property {import('@monkeybar/shared/protocol.js').EquippedCosmetics} equipped
 * @property {{perMode: Record<string, {plays: number, wins: number}>}} stats
 * @property {number} createdAt
 * @property {number} updatedAt
 */

/**
 * @param {Object} [options]
 * @param {string} [options.file]        JSON file path (default server/data/profiles.json)
 * @param {number} [options.debounceMs]  save debounce (default 2000)
 * @param {boolean} [options.persist]    false = pure in-memory store (tests)
 * @param {() => number} [options.now]
 * @param {ReturnType<import('../util/log.js').createLogger>} [options.log]
 */
export function createProfileStore({
  file = DEFAULT_PROFILE_FILE,
  debounceMs = SAVE_DEBOUNCE_MS,
  persist = true,
  now = Date.now,
  log = createLogger('profiles'),
} = {}) {
  /** @type {Map<string, StoredProfile>} */
  const profiles = new Map();
  /** @type {Map<string, string>} token → playerId (§B.5-1 identity across restarts) */
  const tokens = new Map();
  /** @type {ReturnType<typeof setTimeout>|null} */
  let saveTimer = null;
  let dirty = false;
  let diskOk = persist; // flips false only if the data dir itself is unusable
  /** Serializes writes so temp+rename pairs never interleave. */
  let writeChain = Promise.resolve();
  let closed = false;

  // ---- load at boot (§B.5-1) -------------------------------------------------

  if (persist) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch (e) {
      diskOk = false;
      log.warn(`data dir unusable (${e.message}) — running in-memory only`);
    }
    if (diskOk) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        const stored = data && typeof data === 'object' ? data.profiles : null;
        let pruned = 0;
        if (stored && typeof stored === 'object') {
          for (const [playerId, rec] of Object.entries(stored)) {
            const record = normalizeRecord(playerId, rec);
            // Prune empty default profiles left behind by older builds that
            // persisted on hello — they carry zero information.
            if (isDefaultProfile(record)) {
              pruned += 1;
              continue;
            }
            profiles.set(playerId, record);
          }
        }
        const storedTokens = data && typeof data === 'object' ? data.tokens : null;
        let orphanTokens = 0;
        if (storedTokens && typeof storedTokens === 'object') {
          for (const [token, playerId] of Object.entries(storedTokens)) {
            // Prune orphan bindings: a token pointing at a pruned/absent
            // profile can only ever resolve to a fresh default anyway.
            if (typeof playerId !== 'string') continue;
            if (!profiles.has(playerId)) {
              orphanTokens += 1;
              continue;
            }
            tokens.set(token, playerId);
          }
        }
        log.info(`loaded ${profiles.size} profiles from ${file}`);
        if (pruned > 0 || orphanTokens > 0) {
          log.info(`pruned ${pruned} empty profiles + ${orphanTokens} orphan tokens`);
          markDirty(); // rewrite the cleaned file on the next debounce
        }
      } catch (e) {
        if (e.code !== 'ENOENT') {
          log.warn(`could not load ${file} (${e.message}) — starting with a fresh store`);
        }
      }
    }
  } else {
    diskOk = false;
  }

  /** Coerce a loaded record into a well-formed profile (tolerates old files). */
  function normalizeRecord(playerId, rec = {}) {
    const num = (v, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
    return {
      playerId,
      coins: Math.max(0, Math.floor(num(rec.coins))),
      xp: Math.max(0, Math.floor(num(rec.xp))),
      level: Math.min(LEVEL_CAP, Math.max(1, Math.floor(num(rec.level, 1)))),
      wins: Math.max(0, Math.floor(num(rec.wins))),
      matches: Math.max(0, Math.floor(num(rec.matches))),
      unlocked: Array.isArray(rec.unlocked) ? rec.unlocked.filter((id) => typeof id === 'string') : [],
      equipped:
        rec.equipped && typeof rec.equipped === 'object' && !Array.isArray(rec.equipped)
          ? { ...rec.equipped }
          : {},
      stats:
        rec.stats && typeof rec.stats === 'object' && rec.stats.perMode && typeof rec.stats.perMode === 'object'
          ? { perMode: { ...rec.stats.perMode } }
          : { perMode: {} },
      createdAt: num(rec.createdAt, now()),
      updatedAt: num(rec.updatedAt, now()),
    };
  }

  /**
   * An "empty default" profile carries zero information — exactly what a
   * fresh visitor gets. These are never written to disk (and are pruned on
   * load), so anonymous hellos cannot grow profiles.json.
   * @param {StoredProfile} p
   */
  function isDefaultProfile(p) {
    return (
      p.coins === 0 &&
      p.xp === 0 &&
      p.level === 1 &&
      p.wins === 0 &&
      p.matches === 0 &&
      p.unlocked.length === 0 &&
      Object.keys(p.equipped).length === 0 &&
      Object.keys(p.stats.perMode).length === 0
    );
  }

  // ---- debounced atomic save ----------------------------------------------------

  function markDirty() {
    dirty = true;
    if (!diskOk || closed || saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flush();
    }, debounceMs);
    if (saveTimer.unref) saveTimer.unref();
  }

  async function writeToDisk() {
    if (!diskOk || !dirty) return;
    dirty = false;
    // Only MEANINGFUL profiles (and the token bindings that point at them)
    // hit the disk — transient defaults from hello/getProfile never persist.
    const persistable = new Map([...profiles].filter(([, p]) => !isDefaultProfile(p)));
    const json = JSON.stringify(
      {
        version: 1,
        savedAt: new Date(now()).toISOString(),
        profiles: Object.fromEntries(persistable),
        tokens: Object.fromEntries([...tokens].filter(([, playerId]) => persistable.has(playerId))),
      },
      null,
      2
    );
    const tmp = `${file}.tmp`; // same directory → rename is atomic
    try {
      await writeFile(tmp, json, 'utf8');
      await rename(tmp, file);
    } catch (e) {
      dirty = true; // retry on the next mutation/flush; memory stays the truth
      log.warn(`save failed (${e.message}) — serving from memory`);
      try {
        await unlink(tmp);
      } catch {
        /* temp file never landed */
      }
    }
  }

  /** Force a save now (awaitable); no-op for in-memory stores. */
  function flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    writeChain = writeChain.then(writeToDisk);
    return writeChain;
  }

  /** Flush and stop scheduling saves (server shutdown). */
  async function close() {
    closed = true;
    await flush();
  }

  // ---- identity (§B.5-1: token→playerId survives restarts) ------------------------

  /**
   * Remember which playerId a session token identifies (called on issue).
   * TRANSIENT until the profile means something: the in-memory binding lets
   * the session resume immediately, but nothing is scheduled for disk while
   * the profile is still an empty default — the first meaningful mutation
   * (addRewards/buy/equip/bumpStats) marks the store dirty and the save
   * filter then includes every binding pointing at the now-real profile.
   */
  function bindToken(token, playerId) {
    if (typeof token !== 'string' || typeof playerId !== 'string') return;
    if (tokens.get(token) === playerId) return;
    tokens.set(token, playerId);
    const p = profiles.get(playerId);
    if (p && !isDefaultProfile(p)) markDirty();
  }

  /** @param {string} token @returns {string|null} the bound playerId, if any */
  function resolveToken(token) {
    return (typeof token === 'string' && tokens.get(token)) || null;
  }

  // ---- profiles -------------------------------------------------------------------

  /**
   * MUTATION path: the live record for `playerId`, created in memory when
   * absent. Creation alone schedules nothing — the save filter skips default
   * profiles, so only the mutators' touch() makes anything durable.
   * @param {string} playerId @returns {StoredProfile}
   */
  function getOrCreate(playerId) {
    let p = profiles.get(playerId);
    if (!p) {
      p = normalizeRecord(playerId, {});
      profiles.set(playerId, p);
    }
    return p;
  }

  /**
   * READ-ONLY path (hello/welcome, getProfile): the stored record if one
   * exists, else a TRANSIENT default that is never stored anywhere —
   * anonymous visitors leave no trace in memory maps or on disk.
   * @param {string} playerId @returns {StoredProfile}
   */
  function peek(playerId) {
    return profiles.get(playerId) ?? normalizeRecord(playerId, {});
  }

  function touch(p) {
    p.updatedAt = now();
    markDirty();
  }

  /** §10.2 `profile` frame payload for one player (read-only — never stores). */
  function payloadFor(playerId) {
    const p = peek(playerId);
    return {
      playerId: p.playerId,
      coins: p.coins,
      xp: p.xp,
      level: p.level,
      xpToNext: p.level >= LEVEL_CAP ? 0 : xpToNext(p.level),
      wins: p.wins,
      matches: p.matches,
      unlocked: [...p.unlocked],
      equipped: { ...p.equipped },
      stats: { perMode: structuredClone(p.stats.perMode) },
    };
  }

  /** Equipped cosmetic ids per slot (a read-only copy — never stores). */
  function getEquipped(playerId) {
    return { ...peek(playerId).equipped };
  }

  // ---- economy mutations ------------------------------------------------------------

  /**
   * Credit coins + XP, rolling levels with shared xpToNext up to LEVEL_CAP.
   * @param {string} playerId
   * @param {{coins?: number, xp?: number}} rewards
   * @returns {{levelUps: number, newLevel: number}}
   */
  function addRewards(playerId, { coins = 0, xp = 0 } = {}) {
    const p = getOrCreate(playerId);
    p.coins += Math.max(0, Math.floor(coins));
    p.xp += Math.max(0, Math.floor(xp));
    let levelUps = 0;
    while (p.level < LEVEL_CAP && p.xp >= xpToNext(p.level)) {
      p.xp -= xpToNext(p.level);
      p.level += 1;
      levelUps += 1;
    }
    if (p.level >= LEVEL_CAP) p.xp = 0; // xpToNext is irrelevant at the cap
    touch(p);
    return { levelUps, newLevel: p.level };
  }

  /**
   * Match/win counters, total + per-mode (§10.2 profile.stats).
   * @param {string} playerId
   * @param {string} modeId
   * @param {{win?: boolean}} [outcome]
   */
  function bumpStats(playerId, modeId, { win = false } = {}) {
    const p = getOrCreate(playerId);
    p.matches += 1;
    if (win) p.wins += 1;
    const per = p.stats.perMode[modeId] ?? (p.stats.perMode[modeId] = { plays: 0, wins: 0 });
    per.plays += 1;
    if (win) per.wins += 1;
    touch(p);
    return p;
  }

  // ---- shop (§10.1 buyCosmetic / equipCosmetic) ----------------------------------------

  /**
   * Buy a cosmetic: price/minLevel checks against shared/cosmetics.js.
   * @param {string} playerId
   * @param {string} itemId
   * @returns {{ok: true}|{ok: false, code: string, msg: string}}
   */
  function buy(playerId, itemId) {
    const item = getCosmetic(itemId);
    if (!item) return err(ERROR_CODES.NOT_FOUND, 'unknown cosmetic');
    const p = getOrCreate(playerId);
    if (p.unlocked.includes(itemId)) return err(ERROR_CODES.BAD_STATE, 'already owned');
    if (p.level < item.minLevel) return err(ERROR_CODES.LOCKED, `requires level ${item.minLevel}`);
    if (p.coins < item.price) return err(ERROR_CODES.CANT_AFFORD, `costs ${item.price} coins`);
    p.coins -= item.price;
    p.unlocked.push(itemId);
    touch(p);
    return OK;
  }

  /**
   * Equip an owned cosmetic into its slot (itemId null = unequip the slot).
   * @param {string} playerId
   * @param {string} slot
   * @param {string|null} itemId
   * @returns {{ok: true}|{ok: false, code: string, msg: string}}
   */
  function equip(playerId, slot, itemId) {
    if (!SLOT_IDS.includes(slot)) return err(ERROR_CODES.BAD_MSG, 'unknown slot');
    const p = getOrCreate(playerId);
    if (itemId === null) {
      if (p.equipped[slot] !== undefined) {
        delete p.equipped[slot];
        touch(p);
      }
      return OK;
    }
    const item = getCosmetic(itemId);
    if (!item) return err(ERROR_CODES.NOT_FOUND, 'unknown cosmetic');
    if (item.slot !== slot) return err(ERROR_CODES.BAD_MSG, `'${itemId}' is a ${item.slot}, not a ${slot}`);
    if (!p.unlocked.includes(itemId)) return err(ERROR_CODES.LOCKED, 'not owned');
    p.equipped[slot] = itemId;
    touch(p);
    return OK;
  }

  return {
    bindToken,
    resolveToken,
    getOrCreate,
    peek,
    payloadFor,
    getEquipped,
    addRewards,
    bumpStats,
    buy,
    equip,
    flush,
    close,
    get file() {
      return file;
    },
    get size() {
      return profiles.size;
    },
    /** True while the disk copy is usable (false = in-memory fallback). */
    get persistent() {
      return diskOk;
    },
  };
}

// ---------------------------------------------------------------------------
// Active store accessor (registered by server/src/index.js at boot)
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof createProfileStore>|null} */
let activeStore = null;

/** @param {ReturnType<typeof createProfileStore>|null} store */
export function setActiveProfileStore(store) {
  activeStore = store;
  return store;
}

/** The store index.js registered at boot (null in store-less unit tests). */
export function getActiveProfileStore() {
  return activeStore;
}
