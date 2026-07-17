// Local-notification scheduling rules (§C7) — PURE module: no three.js/DOM
// imports, fully unit-tested. computeSchedule(state, now) predicts the 5
// trigger times and applies quiet hours, minimum spacing and the schedule cap.
//
// Triggers (§C7 table):
//   1 wake     at sleep.wakeAt (only while sleeping) — EXEMPT from quiet hours
//              (fires on time, user-initiated) and never moved by spacing.
//   2 hunger   linear §C1 awake-rate projection to hunger = 20
//   3 fun      projection to fun = 15
//   4 hygiene  projection to hygiene = 15
//   5 daily    24 h after the last daily-bonus claim (guarded — claim data
//              lands with W4's dailyBonus; §E3 stores only lastClaimDay)
//
// V2/G20 — 2.0 triggers (§B3: MAX_SCHEDULED 7; quiet hours/spacing unchanged):
//   6 harvest  at the earliest garden.readyAt across planted plots (§C2.4),
//              only when ≥ 10 min in the future; skipped entirely when no
//              current watering carries a plot to readiness ("don't lie");
//              at most ONE harvest notification.
//   7 sick     4 h after backgrounding while health.state === 'sick' (§C3.5),
//              max 1/day: state.care.sickNotifyAt remembers the last
//              scheduled trigger — when that time has PASSED (i.e. the app
//              stayed backgrounded over it, so it fired) no second sick
//              notification lands on the same local day. core/notifications.js
//              records sickNotifyAt after scheduling.
//
// Rules: stat triggers only when the predicted time is ≥ 30 min in the future;
// stats already at/below their threshold are SKIPPED (the app is open — no
// immediate nag). Quiet hours 22:00–08:00 device-local shift to 08:05 (next
// morning when late). Min 30 min between any two scheduled times — the later
// one shifts +30 (and is re-quiet-shifted if that lands inside quiet hours).
// Max NOTIFY.MAX_SCHEDULED (one per id).

import { NOTIFY, STATS, CROP_TABLE } from '../data/constants.js';
import { isSleeping } from './sleep.js';
import { readyAt } from './garden.js'; // V2/G20 (pure)

// V2/G20: engine-internal 2.0 rule numbers (§E0.1-2: not constants.js).
/** §C2.4: harvest notification only when readyAt is ≥ 10 min in the future. */
export const HARVEST_MIN_LEAD_MIN = 10;
/** §C3.5: sick notification fires 4 h after backgrounding while sick. */
export const SICK_AFTER_H = 4;

/** Notification id → strings.js key stem (titleKey/bodyKey = `notify.<stem>.title|body`). */
const ID_STEM = Object.freeze(
  Object.fromEntries(Object.entries(NOTIFY.IDS).map(([stem, id]) => [id, stem]))
);

/**
 * @typedef {{id: number, at: number, titleKey: string, bodyKey: string}} ScheduledNotification
 */

/** @param {number} id @param {number} at @returns {ScheduledNotification} */
function makeItem(id, at) {
  const stem = ID_STEM[id];
  return { id, at: Math.round(at), titleKey: `notify.${stem}.title`, bodyKey: `notify.${stem}.body` };
}

/**
 * Is an epoch-ms timestamp inside quiet hours (22:00–08:00 device-local)?
 * 08:00 itself is NOT quiet (quiet end is exclusive).
 * @param {number} ms
 * @returns {boolean}
 */
export function isQuietTime(ms) {
  const h = new Date(ms).getHours();
  return h >= NOTIFY.QUIET_START_HOUR || h < NOTIFY.QUIET_END_HOUR;
}

/**
 * Shift a quiet-hours timestamp to the next 08:05 device-local (§C7):
 * ≥ 22:00 → next day 08:05; < 08:00 → the same day 08:05.
 * Non-quiet timestamps are returned unchanged.
 * @param {number} ms
 * @returns {number}
 */
export function quietShift(ms) {
  if (!isQuietTime(ms)) return ms;
  const d = new Date(ms);
  if (d.getHours() >= NOTIFY.QUIET_START_HOUR) d.setDate(d.getDate() + 1);
  d.setHours(NOTIFY.QUIET_SHIFT_TO_HOUR, NOTIFY.QUIET_SHIFT_TO_MIN, 0, 0);
  return d.getTime();
}

/**
 * Minutes until a decaying stat reaches a threshold at §C1 awake rates
 * (linear projection). Infinity for non-decaying stats; ≤ 0 when already there.
 * @param {number} value current stat value
 * @param {number} threshold target value
 * @param {number} ratePerMin §C1 awake rate (negative = decay)
 * @returns {number}
 */
export function minutesToThreshold(value, threshold, ratePerMin) {
  if (ratePerMin >= 0) return Infinity;
  return (value - threshold) / -ratePerMin;
}

/**
 * Timestamp (epoch ms) of the last daily-bonus claim, or null when unknown.
 * Guarded against pre-W4 shapes (§E3: daily = { lastClaimDay: 'YYYY-MM-DD', streak }).
 * Prefers a numeric `daily.lastClaimAt` when a later wave adds one.
 * @param {object} state
 * @returns {number|null}
 */
export function lastClaimMs(state) {
  const daily = state?.daily;
  if (daily == null || typeof daily !== 'object') return null;
  if (Number.isFinite(daily.lastClaimAt) && daily.lastClaimAt > 0) return daily.lastClaimAt;
  const day = daily.lastClaimDay;
  if (typeof day !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  // Local midnight of the claim day (localDay strings are device-local).
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/**
 * Apply quiet hours + min-spacing + cap to raw trigger times. Deterministic:
 * items are processed in (time, id) order; on a violation the LATER item
 * shifts +30 min (then re-quiet-shifts), except wake (id 1) which never moves.
 * @param {ScheduledNotification[]} items
 * @returns {ScheduledNotification[]} sorted by time, ≤ MAX_SCHEDULED entries
 */
function resolveConflicts(items) {
  const exempt = new Set(NOTIFY.QUIET_EXEMPT_IDS);
  const list = items.map((item) =>
    exempt.has(item.id) ? { ...item } : { ...item, at: quietShift(item.at) }
  );
  const spacingMs = NOTIFY.MIN_SPACING_MIN * 60000;
  // Iterate until stable: shifting one item later can create new violations
  // (or push past other items), so re-sort + re-scan. Bounded: each pass moves
  // one item strictly later and there are ≤ 5 items.
  for (let guard = 0; guard < 50; guard++) {
    list.sort((a, b) => a.at - b.at || a.id - b.id);
    let violation = false;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (cur.at - prev.at < spacingMs) {
        if (exempt.has(cur.id)) continue; // wake fires on time (§C1.4)
        cur.at = quietShift(prev.at + spacingMs);
        violation = true;
        break;
      }
    }
    if (!violation) break;
  }
  return list.slice(0, NOTIFY.MAX_SCHEDULED);
}

/**
 * Compute the full notification schedule (§C7). Pure & deterministic.
 * @param {object} state save-schema state (§E3)
 * @param {number} nowMs current game time (clock.now())
 * @returns {ScheduledNotification[]} sorted by time, max 5, one per id
 */
export function computeSchedule(state, nowMs) {
  /** @type {ScheduledNotification[]} */
  const items = [];

  // id 1 — wake at wakeAt (§C1.4), only while sleeping and still in the future.
  if (isSleeping(state) && state.sleep.wakeAt > nowMs) {
    items.push(makeItem(NOTIFY.IDS.wake, state.sleep.wakeAt));
  }

  // ids 2–4 — stat-threshold crossings, linear §C1 awake-rate projection.
  const statTriggers = [
    { id: NOTIFY.IDS.hunger, stat: 'hunger', threshold: NOTIFY.HUNGER_AT },
    { id: NOTIFY.IDS.fun, stat: 'fun', threshold: NOTIFY.FUN_AT },
    { id: NOTIFY.IDS.hygiene, stat: 'hygiene', threshold: NOTIFY.HYGIENE_AT },
  ];
  for (const { id, stat, threshold } of statTriggers) {
    const value = Number(state?.stats?.[stat]);
    if (!Number.isFinite(value)) continue;
    if (value <= threshold) continue; // already low: skip — the app is open
    const min = minutesToThreshold(value, threshold, STATS.RATES_AWAKE[stat]);
    if (!Number.isFinite(min) || min < NOTIFY.MIN_LEAD_MIN) continue;
    items.push(makeItem(id, nowMs + min * 60000));
  }

  // id 5 — daily bonus, 24 h after the last claim (skip when past — app open).
  const claimed = lastClaimMs(state);
  if (claimed != null) {
    const at = claimed + NOTIFY.DAILY_AFTER_H * 3600000;
    if (at > nowMs) items.push(makeItem(NOTIFY.IDS.daily, at));
  }

  // V2/G20: id 6 — harvest-ready (§C2.4): earliest readyAt across planted
  // plots, only when the CURRENT watering carries the plot to readiness
  // (garden.readyAt returns null otherwise — "don't lie") and the moment is
  // ≥ 10 min in the future. At most one harvest notification.
  const harvestAt = earliestReadyAt(state, nowMs);
  if (harvestAt != null && harvestAt - nowMs >= HARVEST_MIN_LEAD_MIN * 60000) {
    items.push(makeItem(NOTIFY.IDS.harvest, harvestAt));
  }

  // V2/G20: id 7 — sick (§C3.5): 4 h after backgrounding while sick, max
  // 1/day. `care.sickNotifyAt` is the last trigger this module scheduled
  // (recorded by core/notifications.js); a PAST value means the app stayed
  // backgrounded over it — it fired — so no second one on the same local day.
  if (state?.health?.state === 'sick') {
    const at = nowMs + SICK_AFTER_H * 3600000;
    const lastSickAt = Number(state?.care?.sickNotifyAt);
    const firedSameDay =
      Number.isFinite(lastSickAt) && lastSickAt > 0 && lastSickAt <= nowMs &&
      sameLocalDay(lastSickAt, quietShift(at));
    if (!firedSameDay) items.push(makeItem(NOTIFY.IDS.sick, at));
  }

  return resolveConflicts(items);
}

/**
 * V2/G20: earliest predicted plot readiness (§C2.4), or null when no planted
 * plot can reach readiness on its current watering. Crop defs come straight
 * from constants.CROP_TABLE (readyAt only needs growthMin).
 * @param {object} state save-schema state
 * @param {number} nowMs
 * @returns {number|null}
 */
export function earliestReadyAt(state, nowMs) {
  const plots = state?.garden?.plots;
  if (!Array.isArray(plots)) return null;
  let earliest = null;
  for (const plot of plots) {
    if (!plot || plot.crop == null) continue;
    const def = CROP_TABLE[plot.crop];
    if (!def) continue;
    const at = readyAt(plot, def, nowMs);
    // Already-ready plots (at <= nowMs) never notify — the player will see
    // them; only future readiness counts (§C2.4 lead handled by the caller).
    if (at == null || at <= nowMs) continue;
    if (earliest == null || at < earliest) earliest = at;
  }
  return earliest;
}

/**
 * V2/G20: do two timestamps fall on the same device-local calendar day?
 * @param {number} a @param {number} b
 * @returns {boolean}
 */
export function sameLocalDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}
