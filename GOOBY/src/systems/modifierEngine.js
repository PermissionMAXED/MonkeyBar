// V4/G54 — Modifier event engine (PLAN4 §B4, §C-SYS4.1–4.4): the seeded
// scheduler behind the timed minigame modifier events. PURE module — no
// three.js/DOM imports; node:test hits it directly. Driven by the 1 s
// timeEngine tick (same wiring style as health/weather — see the marked
// V4/G54 block in core/timeEngine.js).
//
// Responsibilities (§B4):
//   1. schedule — first event GRACE_MIN after the first v4 boot
//      (`nextAt === 0` → now + 30 min), then every CADENCE_MIN 50–120 min
//      (seeded uniform, persisted `nextAt` — reload/offline safe: a
//      `nextAt` that passed while the app was closed starts on next boot).
//   2. roll — exactly ONE (game, type) pair, uniform over the eligible
//      pairs (game unlocked at the current level ∧ §C-SYS4.3 matrix ∧
//      `gameId !== lastGameId`) via mulberry32(`seed`++).
//   3. consume — the framework calls consume(state, gameId) at launch
//      (§C-SYS4.4): decrements `playsLeft`, clears `current` at 0 and pins
//      `lastGameId`. Early-quit refunds ≤ 1×/event via refund().
//   4. expire — `now ≥ endsAt` clears `current` (the schedule stays).
//
// All exact numbers are FROZEN HERE per the §E0.1-2 owning-module rule:
// GRACE_MIN 30, WINDOW_MIN 45, CADENCE_MIN [50, 120], the §C-SYS4.2 type
// table, the §C-SYS4.3 eligibility matrix and the §C-SYS11 caps (the
// DAY_COIN_CAP prefers G53's constants.js MODIFIER block once it lands —
// guarded namespace read, §B10 value 150 as the same-wave fallback).
//
// Store event contract (§B10): whoever mutates the slice emits
// `modifierChanged {current, nextAt}` — the timeEngine block does it for
// tick() changes; the framework (G56) does it after consume()/refund();
// dev card 14 (G58) after forceEvent()/clearEvent().
//
// Save slice (§B1, G53's `v4SliceDefaults()` — defaultSlice() mirrors it):
//   modifiers: { nextAt, seed, current, lastGameId, dayCoins, dayCoinsDay,
//                endlessCoins, endlessCoinsDay }
//   current: null | { gameId, type, startedAt, endsAt, playsLeft,
//                     refundUsed? }
// The `endlessCoins/endlessCoinsDay` pair is the §C-SYS11.1 row-6 endless
// day ledger (same pattern as dayCoins — economy.js books both).

import * as CONSTANTS from '../data/constants.js'; // guarded MODIFIER read (§B10 — G53 lands the block this wave)
import { isMinigameUnlocked } from './leveling.js';

/** §B4 timing numbers (minutes) — frozen here per §E0.1-2. */
export const MODIFIER_TIMING = Object.freeze({
  /** First event fires this many minutes after the first v4 boot. */
  GRACE_MIN: 30,
  /** Active-event window: 45 min OR the plays budget, whichever first. */
  WINDOW_MIN: 45,
  /** Seeded-uniform cadence between events (inclusive bounds). */
  CADENCE_MIN: Object.freeze([50, 120]),
});

/** §C-SYS11 caps — DAY_COIN_CAP prefers G53's constants block (§B10: 150). */
export const MODIFIER_CAPS = Object.freeze({
  /** §C-SYS11.1 row 5: total modifier surplus (doppelGold + glueckspilz) per local day. */
  DAY_COIN_CAP: CONSTANTS.MODIFIER?.DAY_COIN_CAP ?? 150,
  /** §C-SYS11.1 row 6: coins from `reason: 'endless'` sources per local day. */
  ENDLESS_DAY_CAP: 100,
  /** §C-SYS4.2 glueckspilz results-roll bounds (inclusive). */
  GLUECKSPILZ_MIN: 10,
  GLUECKSPILZ_MAX: 60,
});

/**
 * §C-SYS4.2 — the 6 modifier types (exact numbers, frozen). `params` is the
 * `ctx.params.modifier` tuning payload per §E0.1-3 (plain numbers the game's
 * scene derives and passes into its logic init — no logic file ever reads
 * modifier STATE). `coinMult` (doppelGold) is applied by economy.js at the
 * single payout site; `nameKey`/`color`/`icon` feed the §G8 accessor (the
 * strings themselves are G76's strings/v4-modifier.js).
 */
export const MODIFIER_TYPES = Object.freeze({
  doppelGold: Object.freeze({
    id: 'doppelGold', plays: 2, coinMult: 2,
    nameKey: 'modifier.name.doppelGold', icon: 'coin', color: '#FFD34D',
    params: Object.freeze({}),
  }),
  muenzregen: Object.freeze({
    id: 'muenzregen', plays: 3,
    nameKey: 'modifier.name.muenzregen', icon: 'sparkle', color: '#3FC9C0',
    params: Object.freeze({ coinRate: 1.5 }),
  }),
  turbo: Object.freeze({
    id: 'turbo', plays: 3,
    nameKey: 'modifier.name.turbo', icon: 'energy', color: '#FF7B66',
    params: Object.freeze({ speedMult: 1.25, scoreMult: 1.5 }),
  }),
  riesenGooby: Object.freeze({
    id: 'riesenGooby', plays: 3,
    nameKey: 'modifier.name.riesenGooby', icon: 'rabbit', color: '#B9A7F0',
    params: Object.freeze({ scale: 1.6, hitboxMult: 1.3 }),
  }),
  stickerChance: Object.freeze({
    id: 'stickerChance', plays: 2,
    nameKey: 'modifier.name.stickerChance', icon: 'star', color: '#FF9BD0',
    params: Object.freeze({ forceDrop: true }),
  }),
  glueckspilz: Object.freeze({
    id: 'glueckspilz', plays: 3,
    nameKey: 'modifier.name.glueckspilz', icon: 'sparkle', color: '#FFD34D',
    params: Object.freeze({ bonusMin: 10, bonusMax: 60 }),
  }),
});

/**
 * §C-SYS4.3 — the frozen eligibility matrix. HARD-CODED literal 27-game
 * list (NOT derived from data/minigames.js) so G53's later `goobyWelt` row
 * can never join: goobyWelt and trips (`mode: shopTrip/vetTrip`) are NEVER
 * modified (§G8-5 — getActiveFor enforces both).
 */
const ALL_ARCADE_GAMES = Object.freeze([
  'carrotCatch', 'bunnyHop', 'cityDrive', 'carrotGuard', 'goobySays',
  'memoryMatch', 'basketBounce', 'gardenRush', 'pancakeTower', 'burgerBuild',
  'shoppingSurf', 'runner', 'veggieChop', 'purblePlace', 'bubblePop',
  'deliveryRush', 'fishingPond', 'danceParty', 'miniGolf', 'trampoline',
  'goalieGooby', 'starHopper', 'pipeFlow', 'toyRacer', 'ghostHunt',
  'rocketRescue', 'harborHopper',
]);

export const MODIFIER_ELIGIBLE = Object.freeze({
  doppelGold: ALL_ARCADE_GAMES,
  glueckspilz: ALL_ARCADE_GAMES,
  stickerChance: ALL_ARCADE_GAMES,
  muenzregen: Object.freeze([
    'shoppingSurf', 'cityDrive', 'deliveryRush', 'starHopper', 'harborHopper',
    'rocketRescue', 'toyRacer', 'bunnyHop', 'runner',
  ]),
  turbo: Object.freeze([
    'shoppingSurf', 'runner', 'bunnyHop', 'starHopper', 'toyRacer',
    'harborHopper', 'veggieChop', 'carrotCatch',
  ]),
  riesenGooby: Object.freeze([
    'shoppingSurf', 'runner', 'bunnyHop', 'trampoline', 'danceParty',
    'goalieGooby', 'starHopper', 'harborHopper',
  ]),
});

/** Stable roll order for the (type, game) pair table (determinism). */
const TYPE_IDS = Object.freeze(Object.keys(MODIFIER_TYPES));

const MS_PER_MIN = 60000;

/**
 * mulberry32 draw at a persisted stream position (same generator family as
 * framework/danceParty/musicDirector — §E8). ONE draw per position; callers
 * advance `seed` by 1 per draw so the stream survives reloads.
 * @param {number} seed stream position (any int32)
 * @returns {number} deterministic value in [0, 1)
 */
export function rand01(seed) {
  let a = seed >>> 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * The §B1 modifiers slice at its exact defaults (mirrors G53's
 * `v4SliceDefaults()` — the engine also self-heals a missing slice through
 * this factory so wave-1b runs green before save v4 merges, §E0.1-11).
 * @returns {object}
 */
export function defaultSlice() {
  return {
    nextAt: 0,
    seed: 0,
    current: null,
    lastGameId: '',
    dayCoins: 0,
    dayCoinsDay: '',
    endlessCoins: 0,
    endlessCoinsDay: '',
  };
}

/**
 * Derive the initial mulberry32 stream position from the save's createdAt
 * (§B1: `seed: 0` = "derive from createdAt" — same formula as G53's
 * save.js `deriveModifierSeed`, uint32; junk createdAt falls back to 1 so
 * the sentinel 0 never sticks).
 * @param {object} state full save state
 * @returns {number} non-zero uint32 stream position
 */
export function initialSeed(state) {
  return (Math.floor(Number(state?.createdAt) || 0) % 4294967296) || 1;
}

/**
 * All eligible (gameId, type) pairs for a roll (§C-SYS4.3): game unlocked at
 * `level`, game in the type's matrix row, `gameId !== lastGameId`. Stable
 * order (type-table order × matrix order) so a seed maps to one pair forever.
 * @param {number} level current player level
 * @param {string} [lastGameId] no-repeat guard ('' = none)
 * @returns {{gameId: string, type: string}[]}
 */
export function eligiblePairs(level, lastGameId = '') {
  const pairs = [];
  for (const type of TYPE_IDS) {
    for (const gameId of MODIFIER_ELIGIBLE[type]) {
      if (gameId === lastGameId) continue;
      if (!isMinigameUnlocked(gameId, level)) continue;
      pairs.push({ gameId, type });
    }
  }
  return pairs;
}

/**
 * Roll the next event onto a slice COPY (2 seeded draws: pair index +
 * cadence). No eligible pair (hostile level) → only reschedules.
 * @param {object} m modifiers slice (not mutated)
 * @param {number} nowMs
 * @param {number} level
 * @returns {{m: object, started: boolean}}
 */
function rollEvent(m, nowMs, level) {
  const out = { ...m };
  const pairs = eligiblePairs(level, out.lastGameId);
  const [cadLo, cadHi] = MODIFIER_TIMING.CADENCE_MIN;
  let started = false;
  if (pairs.length > 0) {
    const pair = pairs[Math.floor(rand01(out.seed) * pairs.length)];
    out.seed = (out.seed + 1) | 0;
    const def = MODIFIER_TYPES[pair.type];
    out.current = {
      gameId: pair.gameId,
      type: pair.type,
      startedAt: nowMs,
      endsAt: nowMs + MODIFIER_TIMING.WINDOW_MIN * MS_PER_MIN,
      playsLeft: def.plays,
    };
    started = true;
  }
  const cadenceMin = cadLo + rand01(out.seed) * (cadHi - cadLo);
  out.seed = (out.seed + 1) | 0;
  out.nextAt = Math.round(nowMs + cadenceMin * MS_PER_MIN);
  return { m: out, started };
}

/**
 * The 1 s scheduler tick (§B4) — PURE: never mutates `state`; returns a
 * fresh slice in `changes` only when something changed. The caller (the
 * marked V4/G54 block in core/timeEngine.js) assigns
 * `state.modifiers = changes` inside store.update and emits
 * `modifierChanged {current, nextAt}`.
 * @param {object} state full save state (reads modifiers/level/createdAt)
 * @param {number} nowMs clock.now()
 * @returns {{changes: object|null,
 *   event: 'scheduled'|'started'|'expired'|'rescheduled'|null}}
 */
export function tick(state, nowMs) {
  const base = state?.modifiers ?? null;
  let m = base ? { ...base } : defaultSlice();
  let changed = base == null;
  let event = null;

  if (!Number.isFinite(m.seed) || m.seed === 0) {
    m.seed = initialSeed(state);
    changed = true;
  }
  // 3) expire — window over: clear current, pin the no-repeat guard,
  //    schedule stays (§B4; the pin covers played-out AND unplayed events).
  if (m.current && nowMs >= m.current.endsAt) {
    m.lastGameId = m.current.gameId;
    m.current = null;
    changed = true;
    event = 'expired';
  }
  // 1) schedule — unscheduled slice gets the 30 min first-boot grace (§C-SYS4.1).
  if (!(m.nextAt > 0)) {
    m.nextAt = nowMs + MODIFIER_TIMING.GRACE_MIN * MS_PER_MIN;
    changed = true;
    event = event ?? 'scheduled';
  } else if (!m.current && nowMs >= m.nextAt) {
    // 2) roll — one event at a time (a passed nextAt waits for the active
    //    window to clear; offline catch-up starts the event NOW, §C-SYS4.1).
    const level = Math.max(1, Math.floor(Number(state?.level) || 1));
    const r = rollEvent(m, nowMs, level);
    m = r.m;
    changed = true;
    event = r.started ? 'started' : 'rescheduled';
  }
  return { changes: changed ? m : null, event };
}

/**
 * Consume ONE play at launch (§C-SYS4.4 — the framework calls this inside
 * store.update when an ARCADE launch of the modified game starts; trips
 * never consume). Mutates `state.modifiers` (fresh slice object assigned).
 * Clears `current` at 0 plays and pins `lastGameId` (§B4).
 * @param {object} state full save state (mutated in place)
 * @param {string} gameId launched game
 * @param {number} nowMs clock.now()
 * @returns {{ok: boolean, modifier?: object, cleared?: boolean}}
 *   `modifier` = the pre-decrement event snapshot (incl. `refundUsed`) —
 *   hold it for refund() and for building `ctx.params.modifier` via
 *   launchParams().
 */
export function consume(state, gameId, nowMs) {
  const active = getActiveFor(state, gameId, nowMs);
  if (!active) return { ok: false };
  const m = { ...state.modifiers };
  const cur = m.current;
  const snapshot = { ...cur };
  const playsLeft = cur.playsLeft - 1;
  if (playsLeft <= 0) {
    m.current = null;
    m.lastGameId = cur.gameId;
  } else {
    m.current = { ...cur, playsLeft };
  }
  state.modifiers = m;
  return { ok: true, modifier: snapshot, cleared: playsLeft <= 0 };
}

/**
 * Refund an early-quit play (§C-SYS4.4 — max ONCE per event, anti-farming).
 * Works both while the event is still active AND when the final consume
 * just cleared it (restores 1 play inside the original window). Mutates
 * `state.modifiers`.
 * @param {object} state full save state (mutated in place)
 * @param {object} snapshot the `modifier` snapshot consume() returned
 * @param {number} nowMs clock.now()
 * @returns {{ok: boolean}}
 */
export function refund(state, snapshot, nowMs) {
  if (!snapshot || snapshot.refundUsed === true) return { ok: false };
  if (!(nowMs < snapshot.endsAt)) return { ok: false }; // window over — no refund
  const m = state?.modifiers;
  if (!m) return { ok: false };
  const cur = m.current;
  if (cur && cur.gameId === snapshot.gameId && cur.startedAt === snapshot.startedAt) {
    if (cur.refundUsed === true) return { ok: false };
    state.modifiers = {
      ...m,
      current: { ...cur, playsLeft: cur.playsLeft + 1, refundUsed: true },
    };
    return { ok: true };
  }
  if (cur == null && m.lastGameId === snapshot.gameId) {
    // The final consume cleared the event this round — restore its last play.
    state.modifiers = {
      ...m,
      current: { ...snapshot, playsLeft: 1, refundUsed: true },
    };
    return { ok: true };
  }
  return { ok: false };
}

/**
 * §G8 read-only accessor — the single source of truth for the arcade tile
 * glow (G68/G76), the mgPregame banner and the framework consume gate.
 * Returns null for: no/expired/spent event, a different game, `goobyWelt`,
 * and trip launches (`opts.mode` shopTrip/vetTrip/surfTravel/travel) —
 * §G8-5 catalog rule.
 * @param {object} state full save state
 * @param {string} gameId
 * @param {number} [nowMs] clock time (pass store-consistent time; defaults
 *   to Date.now() only as a last resort for read-only UI probes)
 * @param {{mode?: string}} [opts] framework launch mode (trips → null)
 * @returns {null | {id: string, type: string, nameKey: string, icon: string,
 *   color: string, remainingPlays: number, startedAt: number, endsAt: number,
 *   coinMult?: number, params: object}}
 */
export function getActiveFor(state, gameId, nowMs = Date.now(), opts = {}) {
  if (gameId === 'goobyWelt') return null;
  const mode = opts.mode;
  if (mode === 'shopTrip' || mode === 'vetTrip' || mode === 'surfTravel' || mode === 'travel') return null;
  const cur = state?.modifiers?.current;
  if (!cur || cur.gameId !== gameId) return null;
  if (!(cur.playsLeft > 0)) return null;
  if (nowMs >= cur.endsAt) return null;
  const def = MODIFIER_TYPES[cur.type];
  if (!def) return null;
  return {
    id: def.id,
    type: def.id,
    nameKey: def.nameKey,
    icon: def.icon,
    color: def.color,
    remainingPlays: cur.playsLeft,
    startedAt: cur.startedAt,
    endsAt: cur.endsAt,
    ...(def.coinMult ? { coinMult: def.coinMult } : {}),
    params: def.params,
  };
}

/**
 * Build the `ctx.params.modifier` launch payload (§B4/§E0.1-3): plain
 * `{ type, …tuning }` numbers the game scene forwards into its logic init.
 * @param {object} snapshot the event snapshot consume() returned (or a
 *   getActiveFor() descriptor — anything with a `type`)
 * @returns {object|null}
 */
export function launchParams(snapshot) {
  const def = MODIFIER_TYPES[snapshot?.type];
  if (!def) return null;
  return {
    type: def.id,
    ...def.params,
    ...(def.coinMult ? { coinMult: def.coinMult } : {}),
  };
}

/**
 * Seeded glueckspilz results-roll (§C-SYS4.2): uniform 10–60 c, ONE
 * mulberry32 draw (`seed`++). The caller (G76's results block) pays the
 * bonus via `economy.award(store, bonus, 'glueckspilz')` — the §C-SYS11
 * day cap is applied THERE (award returns 0 when capped → „Tagesbonus
 * erreicht"). Mutates `state.modifiers.seed`.
 * @param {object} state full save state (mutated in place)
 * @returns {number} rolled bonus (10–60, inclusive)
 */
export function rollGlueckspilz(state) {
  const m = state.modifiers ?? (state.modifiers = defaultSlice());
  if (!Number.isFinite(m.seed) || m.seed === 0) m.seed = initialSeed(state);
  const { GLUECKSPILZ_MIN: lo, GLUECKSPILZ_MAX: hi } = MODIFIER_CAPS;
  const bonus = lo + Math.floor(rand01(m.seed) * (hi - lo + 1));
  state.modifiers = { ...m, seed: (m.seed + 1) | 0 };
  return bonus;
}

/**
 * Dev-panel force (§A2 "dev panel can force/clear" — card 14, G58): start an
 * event NOW for an explicit (game, type) pair; the pair must exist in the
 * §C-SYS4.3 matrix (level locks are bypassed — dev surface). Mutates
 * `state.modifiers`; the caller emits `modifierChanged`.
 * @param {object} state full save state (mutated in place)
 * @param {{gameId: string, type: string}} pick
 * @param {number} nowMs
 * @returns {{ok: boolean, reason?: 'unknown'|'ineligible'}}
 */
export function forceEvent(state, pick, nowMs) {
  const def = MODIFIER_TYPES[pick?.type];
  if (!def) return { ok: false, reason: 'unknown' };
  if (!MODIFIER_ELIGIBLE[pick.type].includes(pick.gameId)) {
    return { ok: false, reason: 'ineligible' };
  }
  const m = { ...(state.modifiers ?? defaultSlice()) };
  if (!Number.isFinite(m.seed) || m.seed === 0) m.seed = initialSeed(state);
  m.current = {
    gameId: pick.gameId,
    type: pick.type,
    startedAt: nowMs,
    endsAt: nowMs + MODIFIER_TIMING.WINDOW_MIN * MS_PER_MIN,
    playsLeft: def.plays,
  };
  if (!(m.nextAt > nowMs)) m.nextAt = nowMs + MODIFIER_TIMING.GRACE_MIN * MS_PER_MIN;
  state.modifiers = m;
  return { ok: true };
}

/**
 * Dev-panel clear (card 14, G58): drop the active event; the schedule
 * (`nextAt`) stays. Mutates `state.modifiers`.
 * @param {object} state full save state (mutated in place)
 * @returns {{ok: boolean}}
 */
export function clearEvent(state) {
  const m = state?.modifiers;
  if (!m?.current) return { ok: false };
  state.modifiers = { ...m, lastGameId: m.current.gameId, current: null };
  return { ok: true };
}
