// Sickness state machine (§B5/§C3) — PURE module: no three.js/DOM imports so
// node:test runs it headlessly. States: healthy → queasy → sick — never skips
// a step on the way up (one transition per tick); cures can jump down.
//
// All functions are pure slice-in/slice-out on the §B2 `health` slice
// `{ state, junkScore, neglectMin, recoverMin, since }` (plus the internal
// `tummyWarnPending` bookkeeping flag, see onEat): they return NEW objects and
// never mutate their input. Wave-2 (G20) wires tick() into the 1 s time
// engine + offline sim, onEat() into the feeding pipeline, and the cures into
// economy.useMedicine/payVet. Exact numbers live in HEALTH below (§E0.1-2:
// engine-internal consts stay in-module, not constants.js).

/**
 * Binding §B5/§C3 sickness numbers.
 */
export const HEALTH = Object.freeze({
  /** Valid states, in escalation order. */
  STATES: Object.freeze(['healthy', 'queasy', 'sick']),
  /** onEat: junk food adds +1 junkScore (§B5). */
  JUNK_EAT: 1,
  /** onEat: healthy food subtracts 0.5 junkScore, floored at 0 (§B5). */
  HEALTHY_EAT: -0.5,
  /** Tick decay: junkScore −1 per 120 min (§B5). */
  JUNK_DECAY_PER_MIN: 1 / 120,
  /** neglectMin accrues while ≥ 2 stats are < 15 (§B5). */
  NEGLECT_MIN_STATS: 2,
  /** The "low stat" threshold for neglect (§B5: stats < 15). */
  NEGLECT_STAT_BELOW: 15,
  /** healthy → queasy at junkScore ≥ 5 (§B5). */
  QUEASY_JUNK: 5,
  /** healthy → queasy at neglectMin ≥ 120 (§B5). */
  QUEASY_NEGLECT_MIN: 120,
  /** queasy → sick at junkScore ≥ 8 (§B5). */
  SICK_JUNK: 8,
  /** queasy → sick at neglectMin ≥ 360 (§B5). */
  SICK_NEGLECT_MIN: 360,
  /** queasy → healthy after 60 continuous clean minutes (§B5). */
  RECOVER_MIN: 60,
  /** "Clean" requires junkScore < 3 (and neglectMin == 0) (§B5). */
  RECOVER_JUNK_BELOW: 3,
  /** Warning ramp (§C3.2): junkScore hits 4 → 'tummyWarning' event/toast. */
  WARN_JUNK: 4,
  /** Warning ramp (§C3.2): neglect ≥ 90 min → sad-slump idle bias (visual only). */
  SLUMP_NEGLECT_MIN: 90,
  /** Queasy effect (§C3.3): fun decays ×1.25 (applied by the wave-2 stats wiring). */
  QUEASY_FUN_DECAY_MULT: 1.25,
  /** Vet cure (§C3.5): +10 to all stats (applied by economy.payVet, not here). */
  VET_CURE_STAT_BONUS: 10,
});

/**
 * @typedef {Object} HealthSlice
 * @property {'healthy'|'queasy'|'sick'} state
 * @property {number} junkScore   junk-food pressure, ≥ 0
 * @property {number} neglectMin  continuous minutes with ≥ 2 stats < 15
 * @property {number} recoverMin  continuous clean minutes while queasy
 * @property {number} since       epoch ms of the last state change (0 = unknown)
 * @property {boolean} [tummyWarnPending] internal: a junk eat crossed the
 *   WARN_JUNK line; the next tick() emits 'tummyWarning' and clears it
 */

/**
 * Normalized copy of a health slice (missing/invalid fields → §B2 defaults).
 * @param {Partial<HealthSlice>|undefined} h
 * @returns {HealthSlice}
 */
function normalize(h) {
  const state = HEALTH.STATES.includes(h?.state) ? h.state : 'healthy';
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
  return {
    state,
    junkScore: num(h?.junkScore),
    neglectMin: num(h?.neglectMin),
    recoverMin: num(h?.recoverMin),
    since: num(h?.since),
    tummyWarnPending: !!h?.tummyWarnPending,
  };
}

/**
 * Apply a feeding to the health slice (§B5). Pure — returns a new slice.
 * Junk food: junkScore +1 AND the 60-clean-min recovery window resets;
 * healthy food: junkScore −0.5, floored at 0. State transitions themselves
 * happen only in tick() (§B5: "evaluated every tick").
 * @param {HealthSlice} h
 * @param {{junk?: boolean}} food a FOOD_TABLE row (only `.junk` is read)
 * @returns {HealthSlice}
 */
export function onEat(h, food) {
  const s = normalize(h);
  if (food?.junk) {
    const before = s.junkScore;
    s.junkScore = before + HEALTH.JUNK_EAT;
    s.recoverMin = 0; // §C3.6: recovery window resets on junk
    if (s.state === 'healthy' && before < HEALTH.WARN_JUNK && s.junkScore >= HEALTH.WARN_JUNK) {
      s.tummyWarnPending = true; // §C3.2 tummy-rumble warning, emitted by tick()
    }
  } else {
    s.junkScore = Math.max(0, s.junkScore + HEALTH.HEALTHY_EAT);
  }
  return s;
}

/**
 * Advance the sickness machine by dtMin minutes (§B5). Pure — returns
 * `{ h, events }`; input is not mutated.
 *
 * Per tick: junkScore decays 1/120 min; neglectMin +1/min while
 * `lowStatCount ≥ 2`, else resets to 0; the queasy recovery window
 * (junkScore < 3 && neglectMin == 0) accrues toward 60 min and resets the
 * moment the condition breaks. Then ONE transition is evaluated (never skips
 * a step up): healthy→queasy at junk ≥ 5 || neglect ≥ 120 ('becameQueasy');
 * queasy→sick at junk ≥ 8 || neglect ≥ 360 ('becameSick'); queasy→healthy at
 * recoverMin ≥ 60 ('recovered'). Sick never auto-recovers. A junk eat that
 * crossed junkScore 4 emits 'tummyWarning' (§C3.2) unless a transition
 * superseded it this tick.
 *
 * Offline sim (§E4 rules): callers pass `opts.mult = 0.3` and cap dtMin at
 * 480 sim-minutes themselves (same contract as stats.applyTick).
 * @param {HealthSlice} h
 * @param {number} dtMin elapsed real minutes
 * @param {number} lowStatCount how many of the 4 stats are currently
 *   < HEALTH.NEGLECT_STAT_BELOW (the caller counts — this module never sees
 *   the stats slice)
 * @param {{mult?: number, nowMs?: number}} [opts] mult: offline rate
 *   multiplier (default 1); nowMs: when provided, `since` is stamped on a
 *   state change
 * @returns {{h: HealthSlice, events: string[]}}
 */
export function tick(h, dtMin, lowStatCount, opts = {}) {
  const s = normalize(h);
  /** @type {string[]} */
  const events = [];
  const mult = Number.isFinite(opts.mult) ? opts.mult : 1;
  const effMin = Math.max(0, Number(dtMin) || 0) * mult;

  // Counters (§B5).
  s.junkScore = Math.max(0, s.junkScore - effMin * HEALTH.JUNK_DECAY_PER_MIN);
  if ((Number(lowStatCount) || 0) >= HEALTH.NEGLECT_MIN_STATS) {
    s.neglectMin += effMin;
  } else {
    s.neglectMin = 0; // resets the minute the condition clears (§B5)
  }
  const clean = s.junkScore < HEALTH.RECOVER_JUNK_BELOW && s.neglectMin === 0;
  if (s.state === 'queasy' && clean) {
    s.recoverMin += effMin;
  } else {
    s.recoverMin = 0;
  }

  // One transition per tick (§B5: never skips on the way up).
  const from = s.state;
  if (from === 'healthy') {
    if (s.junkScore >= HEALTH.QUEASY_JUNK || s.neglectMin >= HEALTH.QUEASY_NEGLECT_MIN) {
      s.state = 'queasy';
      events.push('becameQueasy');
    }
  } else if (from === 'queasy') {
    if (s.junkScore >= HEALTH.SICK_JUNK || s.neglectMin >= HEALTH.SICK_NEGLECT_MIN) {
      s.state = 'sick';
      s.recoverMin = 0;
      events.push('becameSick');
    } else if (s.recoverMin >= HEALTH.RECOVER_MIN) {
      s.state = 'healthy';
      s.recoverMin = 0;
      events.push('recovered');
    }
  }
  // 'sick' never auto-recovers (§B5) — only useMedicine()/vetCure().

  if (s.state !== from && Number.isFinite(opts.nowMs)) s.since = opts.nowMs;

  if (s.tummyWarnPending) {
    s.tummyWarnPending = false;
    if (s.state === 'healthy') events.push('tummyWarning'); // superseded if queasy hit first
  }
  return { h: s, events };
}

/**
 * Use one medicine (§B5/§C3.5): sick → queasy (resets recoverMin so the
 * 60-clean-min window restarts), queasy → healthy. `ok: false` while already
 * healthy (callers must NOT consume the item then). Counters are NOT reset —
 * that is the vet cure's job; a still-high junkScore can re-trigger queasy on
 * a later tick (medicine treats the symptom, not the diet).
 * Item consumption (items.medicine −1) is the caller's job (economy, §B3).
 * @param {HealthSlice} h
 * @param {number} [nowMs] optional: stamps `since` on the state change
 * @returns {{h: HealthSlice, ok: boolean}}
 */
export function useMedicine(h, nowMs) {
  const s = normalize(h);
  if (s.state === 'healthy') return { h: s, ok: false };
  s.state = s.state === 'sick' ? 'queasy' : 'healthy';
  s.recoverMin = 0;
  if (Number.isFinite(nowMs)) s.since = nowMs;
  return { h: s, ok: true };
}

/**
 * Vet full cure (§B5/§C3.5): any state → healthy; junkScore and neglectMin
 * reset to 0. The +10-all-stats bonus (HEALTH.VET_CURE_STAT_BONUS) is applied
 * to the stats slice by economy.payVet — never here (pure health slice only).
 * @param {HealthSlice} h
 * @param {number} [nowMs] optional: stamps `since` on the state change
 * @returns {HealthSlice}
 */
export function vetCure(h, nowMs) {
  const s = normalize(h);
  if (s.state !== 'healthy' && Number.isFinite(nowMs)) s.since = nowMs;
  s.state = 'healthy';
  s.junkScore = 0;
  s.neglectMin = 0;
  s.recoverMin = 0;
  s.tummyWarnPending = false;
  return s;
}

/**
 * Vet checkup (§C3.5): resets neglectMin to 0; nothing else changes (the
 * report card the checkup shows is UI, wave 2).
 * @param {HealthSlice} h
 * @returns {HealthSlice}
 */
export function vetCheckup(h) {
  const s = normalize(h);
  s.neglectMin = 0;
  return s;
}

/**
 * Minigame gate (§C3.4): games refuse ONLY while sick (mirrors the v1
 * exhausted gate). Queasy Gooby still plays.
 * @param {HealthSlice} h
 * @returns {boolean}
 */
export function canPlayMinigame(h) {
  return normalize(h).state !== 'sick';
}
