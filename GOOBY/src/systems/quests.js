// Daily quest engine (§B7/§C5.1) — PURE module: no three.js/DOM imports,
// unit-tested headlessly in test/quests.test.js. Catalog-injected per
// §E0.1-3: this file never imports data/quests.js — every function takes the
// 28-entry pool as a parameter; wave-2 wiring passes the real catalog derived
// from constants.QUEST_POOL.
//
// Semantics (§B7, binding):
//   - rollDaily: 3 quests/day, deterministic per local day via
//     mulberry32(hash32(localDay)), `requires`-filtered against the player
//     context, ≥ 2 distinct categories; no-op when the day already matches.
//   - track: pool entries declare {event, target}; matching events advance
//     `progress` (clamped at target). Optional per-entry `match` filters on
//     the event meta (e.g. {id:'carrotCatch'} for score quests) and `mode`
//     selects the progress arithmetic: 'add' (default, progress += n),
//     'max' (single-run thresholds — progress = max(progress, n)),
//     'distinct' (count distinct meta ids, e.g. "2 different minigames" —
//     the active entry additively grows a `seen` string[]).
//   - claim: progress ≥ target && !claimed → marks claimed, bumps
//     completedTotal, and RETURNS the {coins, xp} reward — actual payout via
//     economy/leveling (+ the questsDone counter) is the caller's job (§B3).
//   - reroll: once per local day ('rerolledDay' guard), seeded by
//     hash32(localDay + ':r'), replaces only unclaimed AND un-progressed
//     quests with fresh picks not currently on the board.
//
// All state-transforming functions are pure: they return NEW `quests` slices
// (§B2: { day, active: [{id, progress, claimed}], rerolledDay,
// completedTotal }) and never mutate their input.

import { localDay } from '../core/clock.js';

/**
 * @typedef {object} QuestDef  §C5.1 pool row (constants.QUEST_POOL)
 * @property {string} id        e.g. 'q.feed3'
 * @property {string} category  'care'|'games'|'garden'|'economy'
 * @property {string} event     tracked event name (§C5.1 condition column)
 * @property {number} target    progress needed to claim
 * @property {{coins: number, xp: number}} reward
 * @property {null|string|{game?: string, minigame?: string, garden?: boolean,
 *   level?: number}} [requires]  unlock gate; string = minigame id shorthand
 * @property {'add'|'max'|'distinct'} [mode]  progress arithmetic (default 'add')
 * @property {Object<string, *>} [match]  meta filter: every key must === meta[key]
 * @property {string} [distinctKey]  meta key for mode 'distinct' (default 'id')
 */

/**
 * @typedef {object} QuestEntry  one active board slot (§B2)
 * @property {string} id
 * @property {number} progress
 * @property {boolean} claimed
 * @property {string[]} [seen]  distinct-mode bookkeeping (additive)
 */

/**
 * @typedef {object} QuestCtx  player context for `requires` filtering (§B7)
 * @property {number} level
 * @property {string[]} unlockedGameIds
 * @property {boolean} gardenUnlocked
 */

// same xmur3 recipe as systems/weather.js (G17) — duplicated locally per
// §E0.1-3 so wave-1 engines stay import-independent. This one returns the raw
// uint32 (mulberry32 seed); weather.js scales its output to [0,1).
function hash32(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 PRNG — deterministic 0..1 stream from a uint32 seed. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Is a pool entry's `requires` gate satisfied (§B7: feature/level/minigame
 * unlocks)? Exposed for the quest-board UI (greyed pool preview).
 * @param {QuestDef['requires']} requires
 * @param {QuestCtx} ctx
 * @returns {boolean}
 */
export function isRequireMet(requires, ctx) {
  if (!requires) return true;
  const games = ctx?.unlockedGameIds ?? [];
  if (typeof requires === 'string') return games.includes(requires);
  if (requires.game != null && !games.includes(requires.game)) return false;
  if (requires.minigame != null && !games.includes(requires.minigame)) return false;
  if (requires.garden && !ctx?.gardenUnlocked) return false;
  if (requires.level != null && (Number(ctx?.level) || 0) < requires.level) return false;
  return true;
}

/**
 * Draw `count` defs from `eligible` (excluding `kept` ids), enforcing ≥ 2
 * distinct categories across kept+drawn on the final draw when the pool
 * allows it. Deterministic given the rng stream.
 * @param {() => number} rng
 * @param {QuestDef[]} eligible
 * @param {QuestDef[]} kept defs staying on the board (reroll keeps)
 * @param {number} count
 * @returns {QuestDef[]}
 */
function pickQuestSet(rng, eligible, kept, count) {
  const chosen = [];
  const taken = new Set(kept.map((d) => d.id));
  for (let i = 0; i < count; i += 1) {
    let candidates = eligible.filter((d) => !taken.has(d.id));
    if (candidates.length === 0) break;
    if (i === count - 1) {
      const cats = new Set([...kept, ...chosen].map((d) => d.category));
      if (cats.size > 0 && cats.size < 2) {
        const other = candidates.filter((d) => !cats.has(d.category));
        if (other.length > 0) candidates = other;
      }
    }
    const pick = candidates[Math.floor(rng() * candidates.length)];
    chosen.push(pick);
    taken.add(pick.id);
  }
  return chosen;
}

/** @param {QuestDef[]} pool @returns {Object<string, QuestDef>} */
function poolById(pool) {
  const map = {};
  for (const def of pool ?? []) map[def.id] = def;
  return map;
}

/**
 * Roll today's 3 quests (§B7): deterministic per local-day string via
 * mulberry32(hash32(localDay)), filtered to satisfied `requires`, ≥ 2
 * distinct categories. No-op (same reference back) when `q.day` already
 * matches localDay(nowMs).
 * @param {object} q quests slice (§B2)
 * @param {number} nowMs
 * @param {QuestDef[]} pool injected catalog (§C5.1)
 * @param {QuestCtx} ctx
 * @returns {object} new quests slice (or `q` unchanged)
 */
export function rollDaily(q, nowMs, pool, ctx) {
  const day = localDay(nowMs);
  if (q?.day === day) return q;
  const eligible = (pool ?? []).filter((d) => isRequireMet(d.requires, ctx));
  const rng = mulberry32(hash32(day));
  const picks = pickQuestSet(rng, eligible, [], 3);
  return {
    ...q,
    day,
    active: picks.map((d) => ({ id: d.id, progress: 0, claimed: false })),
  };
}

/**
 * Advance matching active quests (§B7): quests whose def.event === event (and
 * whose optional `match` filter accepts `meta`) gain progress per their
 * `mode` — see module header. Claimed / already-complete quests are skipped.
 * @param {object} q quests slice
 * @param {string} event §C5.1 event name
 * @param {number} [n] amount (count increment, or the score for 'max' mode)
 * @param {Object<string, *>} [meta] event metadata (e.g. {id: 'carrotCatch'})
 * @param {QuestDef[]} [pool] injected catalog
 * @returns {{q: object, changed: boolean}} same `q` reference when unchanged
 */
export function track(q, event, n = 1, meta = undefined, pool = []) {
  if (!q?.active?.length || !event) return { q, changed: false };
  const amount = Number(n);
  if (!Number.isFinite(amount)) return { q, changed: false };
  const byId = poolById(pool);
  let changed = false;
  const active = q.active.map((entry) => {
    // V2/FIX-A (E9): skip malformed rows (null / non-object / wrong-typed
    // fields from hostile saves) instead of throwing — save.js validate()
    // sanitizes on load, this guards runtime-injected slices.
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) return entry;
    if (entry.claimed === true) return entry;
    const def = byId[entry.id];
    if (!def || def.event !== event) return entry;
    if (def.match && Object.entries(def.match).some(([k, v]) => meta?.[k] !== v)) return entry;
    const prevProgress = Number(entry.progress) || 0; // V2/FIX-A: NaN/junk → 0
    const mode = def.mode ?? 'add';
    if (mode === 'distinct') {
      const key = meta?.[def.distinctKey ?? 'id'];
      const seen = Array.isArray(entry.seen) ? entry.seen : []; // V2/FIX-A
      if (key == null || seen.includes(key)) return entry;
      changed = true;
      const nextSeen = [...seen, String(key)];
      return { ...entry, seen: nextSeen, progress: Math.min(def.target, nextSeen.length) };
    }
    let progress;
    if (mode === 'max') {
      progress = Math.min(def.target, Math.max(prevProgress, amount));
    } else {
      if (amount <= 0) return entry;
      progress = Math.min(def.target, prevProgress + amount);
    }
    if (progress === entry.progress) return entry;
    changed = true;
    return { ...entry, progress };
  });
  return changed ? { q: { ...q, active }, changed: true } : { q, changed: false };
}

/**
 * Claim a completed quest (§B7): requires progress ≥ target && !claimed.
 * Marks it claimed and bumps `completedTotal`; RETURNS the reward — paying
 * coins/XP (economy/leveling) and the `questsDone` counter are the caller's
 * job (wave-2 wiring).
 * @param {object} q quests slice
 * @param {string} id quest id
 * @param {QuestDef[]} pool injected catalog
 * @returns {{q: object, reward: {coins: number, xp: number}}|{ok: false}}
 */
export function claim(q, id, pool) {
  // V2/FIX-A (E9): e?.id — malformed rows (null/primitives) never match/throw
  const entry = q?.active?.find((e) => e?.id === id);
  const def = (pool ?? []).find((d) => d.id === id);
  if (!entry || !def || entry.claimed === true || (Number(entry.progress) || 0) < def.target) {
    return { ok: false };
  }
  return {
    q: {
      ...q,
      active: q.active.map((e) => (e?.id === id ? { ...e, claimed: true } : e)),
      completedTotal: (Number(q.completedTotal) || 0) + 1,
    },
    reward: { coins: def.reward.coins, xp: def.reward.xp },
  };
}

/**
 * Free daily reroll (§B7): once per local day (`rerolledDay` guard), replaces
 * ONLY unclaimed AND un-progressed quests with a fresh seeded pick
 * (hash32(localDay + ':r')) drawn from eligible pool entries not currently on
 * the board; the ≥ 2 categories rule holds for the resulting set. ok:false
 * (and no reroll burned) when already used today, when today's roll is
 * missing, or when nothing is replaceable.
 * @param {object} q quests slice
 * @param {number} nowMs
 * @param {QuestDef[]} pool injected catalog
 * @param {QuestCtx} ctx
 * @returns {{q: object, ok: boolean}}
 */
export function reroll(q, nowMs, pool, ctx) {
  const day = localDay(nowMs);
  if (!q || q.day !== day || q.rerolledDay === day) return { q, ok: false };
  const active = q.active ?? [];
  // V2/FIX-A (E9): e?. — malformed rows count as replaceable, never throw
  const replaceIdx = active
    .map((e, i) => (e?.claimed !== true && (Number(e?.progress) || 0) === 0 ? i : -1))
    .filter((i) => i >= 0);
  if (replaceIdx.length === 0) return { q, ok: false };
  const byId = poolById(pool);
  const activeIds = new Set(active.map((e) => e?.id).filter((id) => typeof id === 'string'));
  const keptDefs = active
    .filter((_, i) => !replaceIdx.includes(i))
    .map((e) => byId[e?.id])
    .filter(Boolean);
  const eligible = (pool ?? []).filter(
    (d) => !activeIds.has(d.id) && isRequireMet(d.requires, ctx),
  );
  const rng = mulberry32(hash32(day + ':r'));
  const picks = pickQuestSet(rng, eligible, keptDefs, replaceIdx.length);
  const nextActive = active.slice();
  picks.forEach((def, k) => {
    nextActive[replaceIdx[k]] = { id: def.id, progress: 0, claimed: false };
  });
  return { q: { ...q, active: nextActive, rerolledDay: day }, ok: true };
}

/**
 * Number of claimable quests — the HUD badge count (§B7).
 * @param {object} q quests slice
 * @param {QuestDef[]} pool injected catalog
 * @returns {number}
 */
export function claimableCount(q, pool) {
  const byId = poolById(pool);
  let n = 0;
  for (const entry of q?.active ?? []) {
    const def = byId[entry?.id]; // V2/FIX-A (E9): malformed rows never throw
    if (def && entry.claimed !== true && (Number(entry.progress) || 0) >= def.target) n += 1;
  }
  return n;
}
