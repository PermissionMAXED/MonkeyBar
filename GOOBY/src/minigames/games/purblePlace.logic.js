// Comfy Cakes / Tortenwerkstatt — pure BELT-SIMULATION engine (PLAN4-GAMES
// §G1, agent V4/G61 — authentic rework). No three.js/DOM imports so
// `node --test` runs this headlessly (§B/§E8 rule); the scene module
// (purblePlace.js, V4/G62) renders THIS engine's state and forwards inputs.
//
// §G1.3 core loop (binding): the PLAYER drives the 6 m belt with ◀/▶ pedals
// (fwd 0.9 m/s, rev 0.7 m/s, slew 6 m/s²); ingredients are PHYSICAL drops
// (0.55 m fall in 0.45 s — a pan catches iff |panS − nozzleS| ≤ ±0.24 m at
// IMPACT time); the oven is a belt-skill tunnel (2.25–3.15 m) whose meter
// accrues while a sponge is inside (green 2.25–3.0 s = +5, auto-singe at
// 3.6 s = −3 even inside); ship at the box (s 5.95 ± 0.30) auto-matches the
// best open ticket (§C9.4 matrix verbatim: +20/+8/−5, combo +2…+10, speed
// +4). Kept VERBATIM from §C9 (§G1.2): ticket generator + difficulty
// weighting, match/scoring matrix, patience 45→−1.5/serve floor 30, order
// interval 30→−2/serve floor 14, 210 s round, coin row 5/5/30 (economy-side,
// §E0.1-2 — difficulty multiplies COINS, never these numbers). New per §G1.5/
// §G1.6: mistimed press = belt splat −2 (decal rides the belt 4 s), illegal-
// type press = friendly buzz ±0, per-nozzle lockout 0.5 s (candles 0.18 s,
// max 4), trash-off-left (s < 0), pan cap min(3, 1 + ⌊serves/3⌋), singed
// sponge counts as ONE wrong component at serve. §G1.6/§G5 difficulty rows +
// the §G5.4 ENDLOS row (3 rejected/expired end it, interval floor 10 s) live
// in `DIFFICULTY`/`applyDifficulty`.
//
// ── Contract for the scene (V4/G62) — §G1.9 ────────────────────────────────
//   createLine({ rng, difficulty }) → line state (plain data + rng ref)
//   stepLine(line, dt, input)       → events[] (this step's events, drained)
//   input = {
//     belt: -1|0|1,            // pedal state (◀ hold = -1, ▶ hold = +1,
//                              // none/both = 0 — the scene encodes "both
//                              // held = stopped" by sending 0)
//     press: stationId|null,   // drop-nozzle button press ('teig.vanilla',
//                              // …, 'kerzen'). Ignored while the nozzle's
//                              // lockout runs (grey the button off
//                              // line.lockouts). Non-drop ids are ignored.
//     spawnShape: 'round'|'square'|'heart'|null,  // „Neue Form" press —
//                              // spawns a pan of that shape at s = 0.15
//     ship: boolean,           // „Versand!" press
//   }
//   events[] vocabulary (§G1.9, exactly these types):
//     panSpawn   {panId, shape, s}
//     drop       {station, kind, value, nozzleS, impactAt}   (press accepted)
//     catch      {station, kind, panId, value}               (at impact)
//     splat      {station, s, points:-2}                     (no pan caught)
//     buzz       {station, panId|null, reason}               (disallowed, ±0)
//                reason: 'illegal'|'cap'|'blocked'|'raw'|'empty'|'noTicket'
//     bakeStart  {panId, bakeT}                              (tunnel entry)
//     bakeCommit {panId, result, points, bakeT, auto}        (exit / singe;
//                points is the DELTA vs the previously committed result so
//                totals stay path-independent: net == bakePoints(final))
//     serve      {ticketId, panId, wrong, points, base, comboBonus,
//                 speedBonus, patienceFrac, bake, outcome}   (perfect/oneWrong)
//     reject     {…same fields, outcome:'rejected'}          (≥2 wrong, −5)
//     expire     {ticketId, points:-5}
//     ticketNew  {ticketId, spec, patience}
//     trash      {panId}                                     (off-left, ±0)
//   Render-relevant line state: t, score, combo, serves, beltV, over (ENDLESS
//   end flag — 3 rejected/expired), tickets[{id, spec, remain, patience}],
//   pans[{id, shape, s, sponge, bake, bakeT, inOven, icing, topping,
//   candles}], drops[{station, kind, value, nozzleS, firedAt, impactAt}]
//   (in-flight blobs — animate y over FALL_SEC), splats[{s, ttl}], lockouts
//   {stationId: secondsLeft}, tune (derived difficulty numbers), plus the
//   §C9.5 meta counters cakesServed/perfectCakes/rejected (+ expired,
//   perfectBakes, splatCount, trashed).
//   Bot entry (?autoplay=1 + CI): createBot(rng, opts) → { plan(line, dt) →
//   input } — feed plan()'s return straight into stepLine each frame
//   (createLineBot is an exported alias; the v3 legacy bot is createBotV3).
// ───────────────────────────────────────────────────────────────────────────

/** Inclusive-edge epsilon for catch/ship window hit tests (float safety). */
const EPS = 1e-9;

/** Binding §G1 numbers (base = Mittel; §G1.6 difficulty derives via
 * `applyDifficulty` — base table stays frozen/exported for tests). */
export const CAKE = Object.freeze({
  /** Round length (§G1.3: 210 s fixed, unchanged). Endless ignores it. */
  DURATION_SEC: 210,
  /** Max parallel order tickets (§G1.6 verbatim §C9.2). */
  MAX_TICKETS: 3,
  /** Patience 45 s → −1.5 s per serve, floor 30 s (§C9.2); difficulty
   * multiplies the clamped result (§G1.6: Leicht ×1.3 / Schwer ×0.8). */
  PATIENCE_START_SEC: 45,
  PATIENCE_STEP_SEC: 1.5,
  PATIENCE_FLOOR_SEC: 30,
  PATIENCE_MULT: 1,
  /** Expired ticket (§C9.2): −5 + combo reset + sad walk-out. */
  EXPIRE_PTS: -5,
  /** Order interval 30 s → −2 s per serve (§C9.4); floor by §G1.6/§G5.4:
   * Leicht 18 / Mittel 14 / Schwer 12 / Endlos 10. */
  ORDER_INTERVAL_START_SEC: 30,
  ORDER_INTERVAL_STEP_SEC: 2,
  ORDER_INTERVAL_MIN_SEC: 14,
  /** Candles ≥ 3 and none-icing tickets only after serve #4 (§C9.4). */
  COMPLEX_AFTER_SERVES: 4,
  MAX_CANDLES: 4,
  /** Belt (§G1.4): 6.0 m, belt-space s = 0…6, world x = s − 3. */
  BELT_LENGTH_M: 6,
  /** Pedals (§G1.5): hold ▶ = +0.9 m/s, hold ◀ = −0.7 m/s, slew 6 m/s². */
  BELT_FWD_SPEED: 0.9,
  BELT_REV_SPEED: 0.7,
  BELT_SLEW: 6,
  /** Drop physics (§G1.5): blob falls 0.55 m in 0.45 s; catch iff
   * |panS − nozzleS| ≤ CATCH_HALF_M at impact (±0.24 Mittel). */
  FALL_SEC: 0.45,
  FALL_M: 0.55,
  CATCH_HALF_M: 0.24,
  /** Per-nozzle re-press lockout (§G1.5); candle presses ≥ 0.18 s apart. */
  LOCKOUT_SEC: 0.5,
  CANDLE_GAP_SEC: 0.18,
  /** Mistimed press (§G1.5): splat decal rides the belt 4 s, −2 points. */
  SPLAT_PTS: -2,
  SPLAT_TTL_SEC: 4,
  /** Spawn (§G1.5): pan lands at s = 0.15; spot free = no pan within 0.7 m. */
  SPAWN_S: 0.15,
  SPAWN_CLEAR_M: 0.7,
  /** Oven tunnel (§G1.5): 2.25 ≤ s ≤ 3.15 (1.0 s transit at full forward). */
  OVEN_START_S: 2.25,
  OVEN_END_S: 3.15,
  /** Bake meter (§G1.5): green 2.25–3.0 s = perfect +5; < 2.25 s pale ±0;
   * 3.0 s…singe = over ±0 (still baked); auto-singe at SINGE_SEC even inside
   * the tunnel = −3 and ONE wrong component at serve. Difficulty moves only
   * SINGE_SEC (Leicht 4.2 / Schwer+Endlos 3.2). */
  BAKE_GREEN_START_SEC: 2.25,
  BAKE_GREEN_END_SEC: 3.0,
  SINGE_SEC: 3.6,
  BAKE_PERFECT_PTS: 5,
  BAKE_SINGED_PTS: -3,
  /** Ship box (§G1.5): baked pan with |s − 5.95| ≤ 0.30. */
  SHIP_S: 5.95,
  SHIP_HALF_M: 0.3,
  /** Pan cap (§G1.6): min(3, 1 + ⌊serves / EVERY⌋); Schwer/Endlos EVERY = 2
   * so the cap reaches 3 at serve 4. */
  PAN_CAP_MAX: 3,
  PAN_CAP_EVERY_SERVES: 3,
  /** Serve scoring (§C9.4 matrix verbatim — §G1.8 totals preserved). */
  PERFECT_PTS: 20,
  ONE_WRONG_PTS: 8,
  REJECT_PTS: -5,
  COMBO_STEP: 2,
  COMBO_CAP: 10,
  SPEED_BONUS_PTS: 4,
  SPEED_BONUS_MIN_FRAC: 0.5,
  /** §G5.4 ENDLOS row: 3 rejected/expired cakes end the run. */
  ENDLESS: false,
  ENDLESS_FAIL_COUNT: 3,
  /** Legacy pre-G62 scene display fields (v3 §C9 meter) — used ONLY by the
   * LEGACY block at the end of this file; delete together with it. */
  OVEN_METER_SEC: 3,
  OVEN_GREEN_FRAC: 0.25,
  LOOP_RETURN_SEC: 0.9,
});

/** §G1.6/§G5.4 difficulty rows (exact, binding). Endless = Schwer params +
 * interval floor 10 s + no duration end (3 rejected/expired end it). */
export const DIFFICULTY = Object.freeze({
  easy: Object.freeze({
    PATIENCE_MULT: 1.3, ORDER_INTERVAL_MIN_SEC: 18, CATCH_HALF_M: 0.3,
    SINGE_SEC: 4.2, PAN_CAP_EVERY_SERVES: 3, ENDLESS: false,
  }),
  normal: Object.freeze({
    PATIENCE_MULT: 1, ORDER_INTERVAL_MIN_SEC: 14, CATCH_HALF_M: 0.24,
    SINGE_SEC: 3.6, PAN_CAP_EVERY_SERVES: 3, ENDLESS: false,
  }),
  hard: Object.freeze({
    PATIENCE_MULT: 0.8, ORDER_INTERVAL_MIN_SEC: 12, CATCH_HALF_M: 0.19,
    SINGE_SEC: 3.2, PAN_CAP_EVERY_SERVES: 2, ENDLESS: false,
  }),
  endless: Object.freeze({
    PATIENCE_MULT: 0.8, ORDER_INTERVAL_MIN_SEC: 10, CATCH_HALF_M: 0.19,
    SINGE_SEC: 3.2, PAN_CAP_EVERY_SERVES: 2, ENDLESS: true,
  }),
});

/**
 * Derive the frozen tune for a §G5 mode (§G1.6 row; §E0.1-14 per-game
 * `applyDifficulty` convention). `normal` reproduces the base table
 * bit-identically; unknown modes normalize to 'normal'.
 * @param {object} [tune] base table (tests may pass a modified copy)
 * @param {'easy'|'normal'|'hard'|'endless'} [mode]
 * @returns {object} frozen derived tune (adds `mode`)
 */
export function applyDifficulty(tune = CAKE, mode = 'normal') {
  const known = Object.prototype.hasOwnProperty.call(DIFFICULTY, mode);
  const id = known ? mode : 'normal';
  return Object.freeze({ ...tune, ...DIFFICULTY[id], mode: id });
}

/** Ticket dimensions (§C9.2/§G1.6 — hexes verbatim). */
export const SHAPES = Object.freeze(['round', 'square', 'heart']);
export const SPONGES = Object.freeze(['vanilla', 'chocolate', 'strawberry']);
export const SPONGE_HEX = Object.freeze({
  vanilla: '#F5E6C8',
  chocolate: '#6B4A2F',
  strawberry: '#F2B8C6',
});
export const ICINGS = Object.freeze(['white', 'pink', 'chocolate', 'none']);
export const ICING_HEX = Object.freeze({
  white: '#FFF8F0',
  pink: '#F781B0',
  chocolate: '#4E3524',
});
export const TOPPINGS = Object.freeze(['cherry', 'sprinkles', 'berries', 'none']);

/**
 * §G1.5 station table (belt-space s, binding). `drop: true` rows are the
 * physical drop nozzles (input.press ids); spawn/versand are instant buttons
 * (input.spawnShape / input.ship); ofen and trash have no button (belt-
 * driven). The oven row carries its tunnel span (s0…s1); `s` is its center
 * (overview-strip glyph anchor).
 */
export const STATIONS = Object.freeze([
  Object.freeze({ id: 'spawn', kind: 'spawn', s: 0.15, button: true, drop: false }),
  Object.freeze({ id: 'trash', kind: 'trash', s: 0.15, button: false, drop: false }),
  Object.freeze({ id: 'teig.vanilla', kind: 'teig', value: 'vanilla', s: 0.9, button: true, drop: true }),
  Object.freeze({ id: 'teig.chocolate', kind: 'teig', value: 'chocolate', s: 1.35, button: true, drop: true }),
  Object.freeze({ id: 'teig.strawberry', kind: 'teig', value: 'strawberry', s: 1.8, button: true, drop: true }),
  Object.freeze({ id: 'ofen', kind: 'ofen', s: 2.7, s0: 2.25, s1: 3.15, button: false, drop: false }),
  Object.freeze({ id: 'guss.white', kind: 'guss', value: 'white', s: 3.5, button: true, drop: true }),
  Object.freeze({ id: 'guss.pink', kind: 'guss', value: 'pink', s: 3.95, button: true, drop: true }),
  Object.freeze({ id: 'guss.chocolate', kind: 'guss', value: 'chocolate', s: 4.4, button: true, drop: true }),
  Object.freeze({ id: 'deko.cherry', kind: 'deko', value: 'cherry', s: 4.7, button: true, drop: true }),
  Object.freeze({ id: 'deko.sprinkles', kind: 'deko', value: 'sprinkles', s: 5.0, button: true, drop: true }),
  Object.freeze({ id: 'deko.berries', kind: 'deko', value: 'berries', s: 5.3, button: true, drop: true }),
  Object.freeze({ id: 'kerzen', kind: 'kerzen', s: 5.6, button: true, drop: true }),
  Object.freeze({ id: 'versand', kind: 'versand', s: 5.95, button: true, drop: false }),
]);

/** Station row lookup by id (§G1.5). */
export const STATION_BY_ID = Object.freeze(
  Object.fromEntries(STATIONS.map((st) => [st.id, st]))
);

// ---------------------------------------------------------------------------
// pure math helpers (§G1.5/§G1.6/§C9.4 — each individually testable)
// ---------------------------------------------------------------------------

/**
 * Patience of a NEW ticket after `serves` served cakes: max(30, 45 −
 * 1.5·serves) × difficulty mult (§C9.2 verbatim; §G1.6 mult).
 * @param {number} serves cakes served so far (any outcome)
 * @param {number} [mult] §G1.6 difficulty patience multiplier
 * @returns {number} seconds
 */
export function patienceFor(serves, mult = 1) {
  return (
    Math.max(
      CAKE.PATIENCE_FLOOR_SEC,
      CAKE.PATIENCE_START_SEC - CAKE.PATIENCE_STEP_SEC * Math.max(0, serves)
    ) * mult
  );
}

/**
 * Seconds until the next order: 30 − 2·serves, floored (§C9.4 verbatim;
 * §G1.6/§G5.4 difficulty floors 18/14/12/10).
 * @param {number} serves
 * @param {number} [floorSec] difficulty interval floor
 * @returns {number}
 */
export function orderIntervalAt(serves, floorSec = CAKE.ORDER_INTERVAL_MIN_SEC) {
  return Math.max(
    floorSec,
    CAKE.ORDER_INTERVAL_START_SEC - CAKE.ORDER_INTERVAL_STEP_SEC * Math.max(0, serves)
  );
}

/**
 * Concurrent-pan cap (§G1.6): min(3, 1 + ⌊serves / EVERY⌋). Mittel EVERY=3
 * (serve 0–2: 1 pan, 3–5: 2, ≥6: 3); Schwer/Endlos EVERY=2 (cap 3 at serve 4).
 * @param {number} serves
 * @param {object} [tune]
 * @returns {number} 1…3
 */
export function panCapAt(serves, tune = CAKE) {
  return Math.min(
    tune.PAN_CAP_MAX,
    1 + Math.floor(Math.max(0, serves) / tune.PAN_CAP_EVERY_SERVES)
  );
}

/**
 * Bake result for a tunnel exit (or auto-singe) at total meter `tSec`
 * (§G1.5): < 2.25 s pale (±0, still counts as baked), 2.25–3.0 s perfect
 * (+5), ≥ SINGE_SEC singed (−3, +1 wrong at serve), in between 'over' (±0,
 * baked — overshot the green zone without burning yet).
 * @param {number} tSec accumulated bake meter seconds
 * @param {object} [tune] difficulty tune (SINGE_SEC moves per §G1.6)
 * @returns {'pale'|'perfect'|'over'|'singed'}
 */
export function bakeResultAt(tSec, tune = CAKE) {
  if (tSec >= tune.SINGE_SEC) return 'singed';
  if (tSec >= tune.BAKE_GREEN_START_SEC && tSec <= tune.BAKE_GREEN_END_SEC) return 'perfect';
  return tSec < tune.BAKE_GREEN_START_SEC ? 'pale' : 'over';
}

/**
 * Immediate bake points (§G1.5): perfect +5, singed −3, pale/over ±0.
 * @param {'pale'|'perfect'|'over'|'singed'|null} result
 * @returns {number}
 */
export function bakePoints(result) {
  if (result === 'perfect') return CAKE.BAKE_PERFECT_PTS;
  if (result === 'singed') return CAKE.BAKE_SINGED_PTS;
  return 0;
}

/**
 * §G1.5 catch-window hit test at IMPACT time: a pan catches a drop iff
 * |panS − nozzleS| ≤ tune.CATCH_HALF_M (±0.24 Mittel / ±0.30 Leicht /
 * ±0.19 Schwer), edges inclusive.
 * @param {number} panS pan center belt position (m)
 * @param {number} nozzleS nozzle belt position (m)
 * @param {object} [tune] derived difficulty tune
 * @returns {boolean}
 */
export function catchWindow(panS, nozzleS, tune = CAKE) {
  return Math.abs(panS - nozzleS) <= tune.CATCH_HALF_M + EPS;
}

/**
 * §G1.9 fall-lead math: where a pan pressed over at `pressedAtS` will be at
 * drop impact, given the belt plan over the FALL_SEC flight. At full forward
 * speed the pan travels 0.405 m during the fall — the press-ahead lead.
 * @param {number} pressedAtS pan belt position at press time
 * @param {number|Array<{v: number, dur?: number}>} beltPlan constant belt
 *   velocity, or velocity segments consumed in order (last one extends)
 * @param {object} [tune]
 * @returns {number} pan belt position at impact
 */
export function dropImpactS(pressedAtS, beltPlan, tune = CAKE) {
  const segs = typeof beltPlan === 'number' ? [{ v: beltPlan }] : beltPlan;
  let s = pressedAtS;
  let left = tune.FALL_SEC;
  for (const seg of segs) {
    if (left <= 0) break;
    const d = Math.min(seg.dur ?? left, left);
    s += seg.v * d;
    left -= d;
  }
  return s;
}

/** @param {() => number} rng @param {readonly any[]} items @param {number[]} weights */
function weightedPick(rng, items, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let roll = rng() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll < 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Seeded ticket generator with §C9.4 difficulty weighting (kept VERBATIM per
 * §G1.2/§G1.6): before serve #4 only simple tickets (icing never 'none',
 * candles ≤ 2, mostly 0–1); after, the full space opens and component weight
 * shifts toward complex (more candles, 'none' icing possible — 'none' is
 * COMPLEX: the player must skip a station on purpose).
 * @param {() => number} rng 0..1
 * @param {number} serves cakes served so far
 * @returns {{shape: string, sponge: string, icing: string, topping: string, candles: number}}
 */
export function makeTicket(rng, serves) {
  const complex = serves >= CAKE.COMPLEX_AFTER_SERVES;
  const shape = SHAPES[Math.min(SHAPES.length - 1, Math.floor(rng() * SHAPES.length))];
  const sponge = SPONGES[Math.min(SPONGES.length - 1, Math.floor(rng() * SPONGES.length))];
  const icing = complex
    ? weightedPick(rng, ICINGS, [3, 3, 3, 2])
    : weightedPick(rng, ICINGS, [1, 1, 1, 0]);
  const topping = weightedPick(rng, TOPPINGS, [3, 3, 3, 2]);
  const candles = complex
    ? weightedPick(rng, [0, 1, 2, 3, 4], [2, 3, 3, 2, 1])
    : weightedPick(rng, [0, 1, 2, 3, 4], [4, 3, 2, 0, 0]);
  return { shape, sponge, icing, topping, candles };
}

/**
 * Wrong/missing component count of a cake vs a ticket over the 5 §C9.2
 * dimensions (verbatim), PLUS §G1.5's singe rule: a singed sponge counts as
 * ONE additional wrong component. Empty icing/topping slots count as 'none'
 * (so a none-icing ticket matches an un-iced cake); an empty sponge can
 * never match (tickets always want sponge). Pale/perfect/over bakes are NOT
 * match dimensions (§G1.5 scores them at the oven).
 * @param {{shape: string, sponge: string|null, bake?: string|null,
 *   icing: string|null, topping: string|null, candles: number}} cake
 * @param {{shape: string, sponge: string, icing: string, topping: string, candles: number}} ticket
 * @returns {number} 0…6
 */
export function wrongCount(cake, ticket) {
  let wrong = 0;
  if (cake.shape !== ticket.shape) wrong += 1;
  if (cake.sponge !== ticket.sponge) wrong += 1;
  if ((cake.icing ?? 'none') !== ticket.icing) wrong += 1;
  if ((cake.topping ?? 'none') !== ticket.topping) wrong += 1;
  if ((cake.candles || 0) !== ticket.candles) wrong += 1;
  if (cake.bake === 'singed') wrong += 1;
  return wrong;
}

/**
 * Serve outcome by wrong count (§C9.4 verbatim).
 * @param {number} wrong
 * @returns {'perfect'|'oneWrong'|'rejected'}
 */
export function serveOutcome(wrong) {
  if (wrong === 0) return 'perfect';
  if (wrong === 1) return 'oneWrong';
  return 'rejected';
}

/**
 * Full §C9.4 serve scoring matrix (verbatim — §G1.8 equivalence): base by
 * outcome (+20 / +8 / −5), combo +2 per consecutive prior non-rejected serve
 * capped +10 (rejects earn none and reset the streak), speed bonus +4 when
 * served with ≥ 50 % patience left (non-rejected serves only).
 * @param {{wrong: number, combo: number, patienceFrac: number}} args combo =
 *   consecutive non-rejected serves BEFORE this one
 * @returns {{outcome: string, points: number, base: number, comboBonus: number,
 *   speedBonus: number, comboAfter: number}}
 */
export function scoreServe({ wrong, combo, patienceFrac }) {
  const outcome = serveOutcome(wrong);
  const rejected = outcome === 'rejected';
  const base =
    outcome === 'perfect' ? CAKE.PERFECT_PTS : outcome === 'oneWrong' ? CAKE.ONE_WRONG_PTS : CAKE.REJECT_PTS;
  const comboBonus = rejected ? 0 : Math.min(CAKE.COMBO_CAP, CAKE.COMBO_STEP * Math.max(0, combo));
  const speedBonus =
    !rejected && patienceFrac >= CAKE.SPEED_BONUS_MIN_FRAC ? CAKE.SPEED_BONUS_PTS : 0;
  return {
    outcome,
    points: base + comboBonus + speedBonus,
    base,
    comboBonus,
    speedBonus,
    comboAfter: rejected ? 0 : combo + 1,
  };
}

/**
 * The best-matching open ticket for a cake (§G1.5 ship rule): fewest wrong
 * components, tie → OLDEST ticket (tickets are stored in creation order, so
 * the first minimal index wins).
 * @param {object} cake
 * @param {Array<{spec: object}>} tickets in creation order
 * @returns {number} index into tickets, or −1 when none are open
 */
export function bestTicketIndex(cake, tickets) {
  let best = -1;
  let bestWrong = Infinity;
  for (let i = 0; i < tickets.length; i += 1) {
    const w = wrongCount(cake, tickets[i].spec);
    if (w < bestWrong) {
      best = i;
      bestWrong = w;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// the belt-line engine (§G1.9): createLine + stepLine — pure, deterministic
// under a seeded rng; same seed + same input script → same events
// ---------------------------------------------------------------------------

/** @typedef {{type: string, [k: string]: any}} LineEvent */

/**
 * Create a fresh §G1 line.
 * @param {{rng: () => number, difficulty?: 'easy'|'normal'|'hard'|'endless'}} args
 *   rng = seeded 0..1 (ctx.rng in the live game); difficulty per §G5
 * @returns {object} line state (see module-header contract)
 */
export function createLine({ rng, difficulty = 'normal' } = {}) {
  if (typeof rng !== 'function') throw new Error('[purblePlace] createLine needs a seeded rng');
  const tune = applyDifficulty(CAKE, difficulty);
  return {
    mode: tune.mode,
    tune,
    rng,
    t: 0,
    score: 0,
    combo: 0, // consecutive non-rejected serves
    serves: 0, // all serve events (pacing basis)
    cakesServed: 0, // == serves (§C9.5 meta name)
    perfectCakes: 0,
    rejected: 0,
    expired: 0,
    perfectBakes: 0,
    splatCount: 0,
    buzzCount: 0,
    trashed: 0,
    /** @type {Array<{id: number, spec: object, remain: number, patience: number}>} */
    tickets: [],
    /** @type {Array<object>} */
    pans: [],
    /** @type {Array<{station: string, kind: string, value: string|null, nozzleS: number, firedAt: number, impactAt: number}>} */
    drops: [],
    /** @type {Array<{s: number, ttl: number}>} */
    splats: [],
    /** @type {Record<string, number>} */
    lockouts: {},
    beltV: 0,
    orderT: 0, // first order lands immediately
    nextTicketId: 1,
    nextPanId: 1,
    over: false, // ENDLESS end flag (§G5.4: 3 rejected/expired)
  };
}

/**
 * Spawn-button availability (§G1.6: the button greys out at the pan cap).
 * @param {object} line
 * @returns {{ok: boolean, reason: 'cap'|'blocked'|null}}
 */
export function canSpawn(line) {
  if (line.pans.length >= panCapAt(line.serves, line.tune)) return { ok: false, reason: 'cap' };
  if (line.pans.some((p) => Math.abs(p.s - line.tune.SPAWN_S) < line.tune.SPAWN_CLEAR_M)) {
    return { ok: false, reason: 'blocked' };
  }
  return { ok: true, reason: null };
}

/** @param {object} line @param {number} points (score floors at 0) */
function addScore(line, points) {
  line.score = Math.max(0, line.score + points);
}

function pushBuzz(line, events, station, panId, reason) {
  line.buzzCount += 1;
  events.push({ type: 'buzz', station, panId: panId ?? null, reason });
}

function checkEndlessOver(line) {
  if (line.tune.ENDLESS && line.rejected + line.expired >= line.tune.ENDLESS_FAIL_COUNT) {
    line.over = true;
  }
}

function trySpawn(line, shape, events) {
  if (!SHAPES.includes(shape)) return;
  const gate = canSpawn(line);
  if (!gate.ok) {
    pushBuzz(line, events, 'spawn', null, gate.reason);
    return;
  }
  const pan = {
    id: line.nextPanId++,
    shape,
    s: line.tune.SPAWN_S,
    sponge: null,
    bake: null, // last committed bake result: null|'pale'|'perfect'|'over'|'singed'
    bakeT: 0, // accumulated meter (persists across tunnel exits — §G1.5 resume)
    inOven: false,
    icing: null,
    topping: null,
    candles: 0,
  };
  line.pans.push(pan);
  events.push({ type: 'panSpawn', panId: pan.id, shape, s: pan.s });
}

function tryPress(line, stationId, events) {
  const st = STATION_BY_ID[stationId];
  if (!st || !st.drop) return; // only drop nozzles; spawn/ship ride their own inputs
  if ((line.lockouts[stationId] ?? 0) > 0) return; // silent lockout (§G1.5)
  line.lockouts[stationId] =
    st.kind === 'kerzen' ? line.tune.CANDLE_GAP_SEC : line.tune.LOCKOUT_SEC;
  const drop = {
    station: stationId,
    kind: st.kind,
    value: st.value ?? null,
    nozzleS: st.s,
    firedAt: line.t,
    impactAt: line.t + line.tune.FALL_SEC,
  };
  line.drops.push(drop);
  events.push({
    type: 'drop', station: stationId, kind: st.kind, value: drop.value,
    nozzleS: st.s, impactAt: drop.impactAt,
  });
}

function servePan(line, pan, events) {
  const idx = bestTicketIndex(pan, line.tickets);
  const ticket = line.tickets[idx];
  const wrong = wrongCount(pan, ticket.spec);
  const patienceFrac = ticket.remain / ticket.patience;
  const r = scoreServe({ wrong, combo: line.combo, patienceFrac });
  addScore(line, r.points);
  line.combo = r.comboAfter;
  line.serves += 1;
  line.cakesServed += 1;
  if (r.outcome === 'perfect') line.perfectCakes += 1;
  if (r.outcome === 'rejected') line.rejected += 1;
  line.tickets.splice(idx, 1);
  line.pans.splice(line.pans.indexOf(pan), 1);
  events.push({
    type: r.outcome === 'rejected' ? 'reject' : 'serve',
    outcome: r.outcome,
    points: r.points,
    base: r.base,
    comboBonus: r.comboBonus,
    speedBonus: r.speedBonus,
    wrong,
    patienceFrac,
    ticketId: ticket.id,
    panId: pan.id,
    bake: pan.bake,
  });
  checkEndlessOver(line);
}

function tryShip(line, events) {
  const tune = line.tune;
  const inZone = line.pans
    .filter((p) => Math.abs(p.s - tune.SHIP_S) <= tune.SHIP_HALF_M + EPS)
    .sort((a, b) => Math.abs(a.s - tune.SHIP_S) - Math.abs(b.s - tune.SHIP_S) || a.id - b.id);
  const baked = inZone.filter((p) => p.bake != null);
  if (baked.length === 0) {
    pushBuzz(line, events, 'versand', inZone[0]?.id ?? null, inZone.length > 0 ? 'raw' : 'empty');
    return;
  }
  if (line.tickets.length === 0) {
    // never serve into the void (§C9.3 spirit): friendly buzz instead
    pushBuzz(line, events, 'versand', baked[0].id, 'noTicket');
    return;
  }
  servePan(line, baked[0], events);
}

/**
 * Commit a bake result (tunnel exit or auto-singe). Points are the DELTA vs
 * the previously committed result, so the banked total is path-independent:
 * whatever the exit history, net bake points == bakePoints(final result)
 * (pale ±0 → re-bake to green = +5; green +5 → overdone singe = −8 delta =
 * −3 net — §G1.5 "fix a pale bake, and overdo it").
 */
function commitBake(line, pan, result, auto, events) {
  const delta = bakePoints(result) - bakePoints(pan.bake);
  if (result === 'perfect' && pan.bake !== 'perfect' && !pan.perfectCounted) {
    line.perfectBakes += 1;
    pan.perfectCounted = true;
  }
  pan.bake = result;
  if (delta !== 0) addScore(line, delta);
  events.push({
    type: 'bakeCommit', panId: pan.id, result, points: delta,
    bakeT: pan.bakeT, auto: !!auto,
  });
}

/** Oven tunnel bookkeeping for one movement sub-segment (§G1.5). */
function ovenStep(line, pan, s0, s1, segDt, events) {
  const tune = line.tune;
  if (pan.sponge == null || pan.bake === 'singed') {
    pan.inOven = false;
    return;
  }
  const inside1 = s1 >= tune.OVEN_START_S && s1 <= tune.OVEN_END_S;
  // fraction of the segment spent inside the tunnel (linear position model —
  // exact for constant-velocity segments, sub-ms error during slew ramps)
  let frac;
  if (s0 === s1) {
    frac = inside1 ? 1 : 0;
  } else {
    const lo = Math.min(s0, s1);
    const hi = Math.max(s0, s1);
    const overlap = Math.min(hi, tune.OVEN_END_S) - Math.max(lo, tune.OVEN_START_S);
    frac = overlap > 0 ? Math.min(1, overlap / (hi - lo)) : 0;
  }
  const wasIn = pan.inOven === true;
  if (!wasIn && frac > 0) events.push({ type: 'bakeStart', panId: pan.id, bakeT: pan.bakeT });
  if (frac > 0) {
    pan.bakeT += frac * segDt;
    if (pan.bakeT >= tune.SINGE_SEC) {
      // §G1.5: singe commits automatically at SINGE_SEC even inside the tunnel
      pan.bakeT = tune.SINGE_SEC;
      commitBake(line, pan, 'singed', true, events);
      pan.inOven = false;
      return;
    }
  }
  if ((wasIn || frac > 0) && !inside1) {
    // leaving the tunnel commits the result (§G1.5); re-entering resumes
    commitBake(line, pan, bakeResultAt(pan.bakeT, tune), false, events);
  }
  pan.inOven = inside1;
}

/** Closed-form belt advance under the 6 m/s² slew (trapezoid profile). */
function beltAdvance(v0, vt, slew, dur) {
  if (v0 === vt) return { disp: v0 * dur, v1: v0 };
  const dir = vt > v0 ? 1 : -1;
  const tRamp = Math.abs(vt - v0) / slew;
  if (dur < tRamp) {
    const v1 = v0 + dir * slew * dur;
    return { disp: ((v0 + v1) / 2) * dur, v1 };
  }
  return { disp: ((v0 + vt) / 2) * tRamp + vt * (dur - tRamp), v1: vt };
}

/** Move the whole line (pans, splats, oven, trash) by one sub-segment. */
function moveLine(line, disp, segDt, events) {
  const tune = line.tune;
  for (let i = line.splats.length - 1; i >= 0; i -= 1) {
    const sp = line.splats[i];
    sp.s += disp; // splat decals ride the belt (§G1.5)
    sp.ttl -= segDt;
    if (sp.ttl <= 0) line.splats.splice(i, 1);
  }
  for (let i = line.pans.length - 1; i >= 0; i -= 1) {
    const pan = line.pans[i];
    const s0 = pan.s;
    // right end: pans park at the belt end (no right-side falloff — §G1.1
    // "nothing one press can't cause is punished"; trash is DELIBERATE, left)
    const s1 = Math.min(tune.BELT_LENGTH_M, s0 + disp);
    pan.s = s1;
    ovenStep(line, pan, s0, s1, segDt, events);
    if (pan.s < 0) {
      // §G1.5 trash: reversing a pan fully off the belt's left end dumps it
      line.pans.splice(i, 1);
      line.trashed += 1;
      events.push({ type: 'trash', panId: pan.id });
    }
  }
}

/** Resolve one drop at its exact impact time (§G1.5 rules). */
function resolveImpact(line, drop, events) {
  const tune = line.tune;
  const candidates = line.pans
    .filter((p) => catchWindow(p.s, drop.nozzleS, tune))
    .sort((a, b) => Math.abs(a.s - drop.nozzleS) - Math.abs(b.s - drop.nozzleS) || a.id - b.id);
  const pan = candidates[0] ?? null;
  if (!pan) {
    // mistimed press: splat decal on the belt at the nozzle x, −2 (§G1.5)
    addScore(line, tune.SPLAT_PTS);
    line.splatCount += 1;
    line.splats.push({ s: drop.nozzleS, ttl: tune.SPLAT_TTL_SEC });
    events.push({ type: 'splat', station: drop.station, s: drop.nozzleS, points: tune.SPLAT_PTS });
    return;
  }
  const legal =
    drop.kind === 'teig'
      ? pan.sponge == null
      : drop.kind === 'guss'
        ? pan.bake != null && pan.icing == null
        : drop.kind === 'deko'
          ? pan.bake != null && pan.topping == null
          : pan.bake != null && pan.candles < tune.MAX_CANDLES; // kerzen
  if (!legal) {
    // §G1.5: the pan physically blocks the spot — friendly buzz, ±0, NO splat
    pushBuzz(line, events, drop.station, pan.id, 'illegal');
    return;
  }
  if (drop.kind === 'teig') pan.sponge = drop.value;
  else if (drop.kind === 'guss') pan.icing = drop.value;
  else if (drop.kind === 'deko') pan.topping = drop.value;
  else pan.candles += 1;
  events.push({
    type: 'catch', station: drop.station, kind: drop.kind, panId: pan.id,
    value: drop.kind === 'kerzen' ? pan.candles : drop.value,
  });
}

/** Belt + drops + oven integration, sub-stepped at exact impact times and at
 * velocity zero-crossings (keeps motion monotone per segment). */
function integrateLine(line, dt, dir, events) {
  const tune = line.tune;
  const vt = dir > 0 ? tune.BELT_FWD_SPEED : dir < 0 ? -tune.BELT_REV_SPEED : 0;
  let t = line.t;
  const tEnd = line.t + dt;
  let guard = 0;
  while (t < tEnd - EPS && guard < 64) {
    guard += 1;
    let tNext = tEnd;
    for (const d of line.drops) {
      if (d.impactAt > t + EPS && d.impactAt < tNext) tNext = d.impactAt;
    }
    if (line.beltV !== 0 && vt * line.beltV < 0) {
      const tz = t + Math.abs(line.beltV) / tune.BELT_SLEW;
      if (tz > t + EPS && tz < tNext) tNext = tz;
    }
    const segDt = tNext - t;
    const { disp, v1 } = beltAdvance(line.beltV, vt, tune.BELT_SLEW, segDt);
    moveLine(line, disp, segDt, events);
    line.beltV = v1;
    t = tNext;
    for (let i = line.drops.length - 1; i >= 0; i -= 1) {
      if (line.drops[i].impactAt <= t + EPS) {
        const drop = line.drops.splice(i, 1)[0];
        resolveImpact(line, drop, events);
      }
    }
  }
  line.t = tEnd;
}

/** Order spawning + patience decay + expiry (§G1.6 pacing). */
function tickTickets(line, dt, events) {
  const tune = line.tune;
  line.orderT -= dt;
  if (line.orderT <= 0) {
    if (line.tickets.length < tune.MAX_TICKETS) {
      const spec = makeTicket(line.rng, line.serves);
      const patience = patienceFor(line.serves, tune.PATIENCE_MULT);
      const ticket = { id: line.nextTicketId++, spec, remain: patience, patience };
      line.tickets.push(ticket);
      line.orderT = orderIntervalAt(line.serves, tune.ORDER_INTERVAL_MIN_SEC);
      events.push({ type: 'ticketNew', ticketId: ticket.id, spec, patience });
    } else {
      line.orderT = 0; // board full — retry as soon as a slot frees
    }
  }
  for (let i = line.tickets.length - 1; i >= 0; i -= 1) {
    const tk = line.tickets[i];
    tk.remain -= dt;
    if (tk.remain <= 0) {
      line.tickets.splice(i, 1);
      addScore(line, tune.EXPIRE_PTS);
      line.combo = 0;
      line.expired += 1;
      events.push({ type: 'expire', ticketId: tk.id, points: tune.EXPIRE_PTS });
      checkEndlessOver(line);
    }
  }
}

/**
 * Advance the line by `dt` under the player/bot input (§G1.9 contract — see
 * the module header for the input/event shapes). Input actions are sampled
 * at the step START (presses schedule impacts at t + FALL_SEC; movement
 * integration resolves them at their exact impact times). Returns this
 * step's events. No-ops once `line.over` (ENDLESS end).
 * @param {object} line
 * @param {number} dt seconds
 * @param {{belt?: number, press?: string|null, spawnShape?: string|null, ship?: boolean}} [input]
 * @returns {LineEvent[]}
 */
export function stepLine(line, dt, input = {}) {
  /** @type {LineEvent[]} */
  const events = [];
  if (line.over || !(dt > 0)) return events;

  for (const id of Object.keys(line.lockouts)) {
    line.lockouts[id] -= dt;
    if (line.lockouts[id] <= 0) delete line.lockouts[id];
  }

  if (input.spawnShape != null) trySpawn(line, input.spawnShape, events);
  if (input.press != null) tryPress(line, input.press, events);
  if (input.ship) tryShip(line, events);

  const dir = input.belt > 0 ? 1 : input.belt < 0 ? -1 : 0;
  integrateLine(line, dt, dir, events);
  tickTickets(line, dt, events);

  return events;
}

// ---------------------------------------------------------------------------
// autoplay bot (§G1.9): drives the pedals + drop buttons for ?autoplay=1 and
// CI. Strategy per spec: plans one pan at a time against the oldest ticket —
// drive to spawn → spawn correct shape → drive under the teig nozzle → stop →
// press (accounting for the 0.45 s fall by pressing when stationary) → drive
// into the oven, wait until the meter ≥ 2.4 s, drive out → icing → deko →
// candles ×n → ship. Opens a second pan only while the first bakes. Human-ish
// error model tuned so Mittel raw scores stay near the v3 bot's typicals
// (economy equivalence §G1.8) while averaging ≥ 90 (§G1.9 bar) and clearing
// the §G5.4 Schwer target 120 on some seeds.
// ---------------------------------------------------------------------------

/** V4/G61 bot tuning (human-ish error model — overridable in tests). */
export const BOT = Object.freeze({
  /** Parking accept tolerance + brake anticipation. */
  ARRIVE_TOL_M: 0.05,
  /** Careful park offset (uniform ±) — well inside all catch windows. */
  PARK_JITTER_M: 0.06,
  /** Chance of a sloppy park (uniform ±SLOPPY_JITTER_M) — the tail that
   * splats on tight (Schwer ±0.19) windows and rarely on Mittel ±0.24. */
  SLOPPY_CHANCE: 0.28,
  SLOPPY_JITTER_M: 0.27,
  /** Reaction pause after parking before the press lands. */
  REACT_MIN_SEC: 0.15,
  REACT_MAX_SEC: 0.55,
  /** Chance to press a neighboring (wrong) nozzle of the station family. */
  WRONG_CHANCE: 0.2,
  /** Chance to spawn the wrong pan shape. */
  SHAPE_WRONG_CHANCE: 0.16,
  /** Oven plan: early release (pale ±0) / dozing off (auto-singe −3). */
  OVEN_EARLY_CHANCE: 0.35,
  OVEN_LATE_CHANCE: 0.11,
  /** Park position inside the tunnel + §G1.9 exit threshold (meter ≥ 2.4). */
  OVEN_PARK_S: 2.85,
  OVEN_EXIT_METER_SEC: 2.4,
  /** Chance to leave the candle count one short. */
  CANDLE_SHORT_CHANCE: 0.18,
  /** Idle pause between cakes (a very human breather). */
  HESITATE_MIN_SEC: 0.8,
  HESITATE_MAX_SEC: 3.0,
});

/**
 * Create the §G1.9 autoplay bot. Call `plan(line, dt)` once per frame and
 * feed the returned input object straight into `stepLine`. Canonical name
 * `createBot` (sibling-game convention; G62's scene feature-detects it);
 * `createLineBot` stays exported as an alias.
 * @param {() => number} rng 0..1 (SEPARATE stream from the line's is fine)
 * @param {object} [opts] override BOT fields (tests)
 * @returns {{plan: (line: object, dt: number) => {belt: number, press: string|null, spawnShape: string|null, ship: boolean}}}
 */
export function createBot(rng, opts = {}) {
  const P = Object.freeze({ ...BOT, ...opts });

  const reactSec = () => P.REACT_MIN_SEC + rng() * (P.REACT_MAX_SEC - P.REACT_MIN_SEC);
  const hesitateSec = () => P.HESITATE_MIN_SEC + rng() * (P.HESITATE_MAX_SEC - P.HESITATE_MIN_SEC);
  const parkJitter = () =>
    rng() < P.SLOPPY_CHANCE
      ? (rng() * 2 - 1) * P.SLOPPY_JITTER_M
      : (rng() * 2 - 1) * P.PARK_JITTER_M;
  const carefulJitter = () => (rng() * 2 - 1) * P.PARK_JITTER_M;

  const st = {
    panId: null,
    spec: null, // ticket spec the pan is built against (kept if the ticket dies)
    plan: null, // per-pan error plan (rolled once at adoption)
    stage: null,
    phase: 'idle', // drive | react | await | wait | exit (oven)
    cfg: null, // {stationId, target, react} for the current stage
    reactT: 0,
    awaitUntil: 0,
    hesitateT: 0,
    spawnIssued: false,
    sideSpawned: false,
  };

  function pickShape(spec) {
    if (rng() < P.SHAPE_WRONG_CHANCE) {
      const pool = SHAPES.filter((sh) => sh !== spec.shape);
      return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    }
    return spec.shape;
  }

  function rollDrop() {
    return { wrong: rng() < P.WRONG_CHANCE, park: parkJitter(), react: reactSec() };
  }

  function rollPlan() {
    return {
      teig: rollDrop(),
      guss: rollDrop(),
      deko: rollDrop(),
      kerzenShort: rng() < P.CANDLE_SHORT_CHANCE ? 1 : 0,
      kerzenPark: parkJitter(),
      oven:
        rng() < P.OVEN_LATE_CHANCE
          ? { mode: 'late' }
          : rng() < P.OVEN_EARLY_CHANCE
            ? { mode: 'early', exitMeter: 1.2 + rng() * 0.85 }
            : { mode: 'green', exitMeter: P.OVEN_EXIT_METER_SEC + rng() * 0.15 },
      shipPark: (rng() * 2 - 1) * 0.1,
    };
  }

  function adoptPan(line, pan) {
    st.panId = pan.id;
    st.spec = line.tickets[0]?.spec ?? st.spec;
    st.plan = rollPlan();
    st.stage = null;
    st.phase = 'drive';
    st.sideSpawned = false;
  }

  function wrongPick(pool, correct) {
    const others = pool.filter((v) => v !== correct);
    return others[Math.min(others.length - 1, Math.floor(rng() * others.length))];
  }

  function makeCfg(stage) {
    const spec = st.spec;
    const plan = st.plan;
    if (stage === 'ship') return { stationId: null, target: CAKE.SHIP_S + plan.shipPark, react: reactSec() };
    if (stage === 'kerzen') return { stationId: 'kerzen', target: STATION_BY_ID.kerzen.s + plan.kerzenPark, react: reactSec() };
    const kind = stage; // teig | guss | deko
    const roll = plan[kind];
    let value;
    if (kind === 'teig') value = roll.wrong ? wrongPick(SPONGES, spec.sponge) : spec.sponge;
    else if (kind === 'guss') value = roll.wrong ? wrongPick(ICINGS.slice(0, 3), spec.icing) : spec.icing;
    else value = roll.wrong ? wrongPick(TOPPINGS.slice(0, 3), spec.topping) : spec.topping;
    const stationId = `${kind}.${value}`;
    return { stationId, target: STATION_BY_ID[stationId].s + roll.park, react: roll.react };
  }

  function nextStage(pan) {
    const spec = st.spec ?? { icing: 'none', topping: 'none', candles: 0 };
    if (pan.sponge == null) return 'teig';
    if (pan.bake == null) return 'oven';
    if (spec.icing !== 'none' && pan.icing == null) return 'guss';
    if (spec.topping !== 'none' && pan.topping == null) return 'deko';
    const wantCandles = Math.max(0, spec.candles - st.plan.kerzenShort);
    if (pan.candles < wantCandles) return 'kerzen';
    return 'ship';
  }

  function driveToward(line, pan, target) {
    const err = target - pan.s;
    if (Math.abs(err) <= P.ARRIVE_TOL_M) return 0;
    const v = line.beltV;
    if (v !== 0 && (v > 0) === (err > 0)) {
      const stopDist = (v * v) / (2 * CAKE.BELT_SLEW);
      if (stopDist >= Math.abs(err)) return 0; // release — coast onto the mark
    }
    return err > 0 ? 1 : -1;
  }

  function ovenPlan(line, pan, input, dt) {
    const plan = st.plan.oven;
    if (st.phase === 'wait') {
      // §G1.9: open a second pan only while the first bakes
      if (!st.sideSpawned && line.tickets.length >= 2 && canSpawn(line).ok) {
        st.sideSpawned = true;
        input.spawnShape = pickShape(line.tickets[1].spec);
        return input;
      }
      if (plan.mode === 'late') return input; // dozes off → auto-singe commits
      if (pan.bakeT >= (plan.exitMeter ?? P.OVEN_EXIT_METER_SEC)) st.phase = 'exit';
      return input;
    }
    if (st.phase === 'exit') {
      input.belt = 1; // drive out — the exit crossing commits the bake
      return input;
    }
    const dir = driveToward(line, pan, P.OVEN_PARK_S);
    if (dir !== 0 || Math.abs(line.beltV) > 0.001) {
      input.belt = dir;
      return input;
    }
    st.phase = 'wait';
    return input;
  }

  /**
   * One frame of bot planning.
   * @param {object} line
   * @param {number} dt
   * @returns {{belt: number, press: string|null, spawnShape: string|null, ship: boolean}}
   */
  function plan(line, dt) {
    const input = { belt: 0, press: null, spawnShape: null, ship: false };
    if (line.over) return input;

    if (st.hesitateT > 0) {
      st.hesitateT -= dt;
      return input;
    }

    if (st.spawnIssued) {
      st.spawnIssued = false;
      const newest = line.pans.reduce((a, b) => (a == null || b.id > a.id ? b : a), null);
      if (newest) adoptPan(line, newest);
    }

    let pan = line.pans.find((p) => p.id === st.panId) ?? null;
    if (!pan) {
      // pick up the parallel-spawned spare (oldest pan on the belt)
      const spare = line.pans.reduce((a, b) => (a == null || b.id < a.id ? b : a), null);
      if (spare) {
        adoptPan(line, spare);
        pan = spare;
      }
    }
    if (!pan) {
      if (line.tickets.length === 0) return input; // wait for an order
      if (!canSpawn(line).ok) return input;
      input.spawnShape = pickShape(line.tickets[0].spec);
      st.spawnIssued = true;
      return input;
    }

    const stage = nextStage(pan);
    if (stage !== st.stage) {
      st.stage = stage;
      st.phase = 'drive';
      st.cfg = stage === 'oven' ? null : makeCfg(stage);
    }

    if (stage === 'oven') return ovenPlan(line, pan, input, dt);

    switch (st.phase) {
      case 'drive': {
        const dir = driveToward(line, pan, st.cfg.target);
        if (dir !== 0 || Math.abs(line.beltV) > 0.001) {
          input.belt = dir;
          return input;
        }
        st.phase = 'react';
        st.reactT = st.cfg.react;
        return input;
      }
      case 'react': {
        st.reactT -= dt;
        if (st.reactT > 0) return input;
        if (stage === 'ship') {
          if (line.tickets.length === 0) return input; // hold — never buzz the void
          input.ship = true;
          st.panId = null;
          st.stage = null;
          st.phase = 'idle';
          st.hesitateT = hesitateSec();
          return input;
        }
        if ((line.lockouts[st.cfg.stationId] ?? 0) > 0) return input;
        input.press = st.cfg.stationId;
        st.phase = 'await';
        st.awaitUntil = line.t + CAKE.FALL_SEC + 0.1;
        return input;
      }
      case 'await': {
        if (line.t < st.awaitUntil) return input;
        // stage didn't advance → the drop splatted; re-park carefully and retry
        st.phase = 'drive';
        st.cfg = { ...st.cfg, target: (st.cfg.stationId ? STATION_BY_ID[st.cfg.stationId].s : CAKE.SHIP_S) + carefulJitter(), react: reactSec() };
        return input;
      }
      default: {
        st.phase = 'drive';
        return input;
      }
    }
  }

  return { plan };
}

/** Alias for the §G1.9 bot (older wave-2 name — keep both working). */
export const createLineBot = createBot;

/** mulberry32 (framework-identical) so tests can seed without the framework. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t2 = Math.imul(a ^ (a >>> 15), 1 | a);
    t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) | 0;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Headless full-round simulation (§G1.9 tests + evidence): line + bot at a
 * fixed 30 Hz step. Timed modes run DURATION_SEC; endless runs until the
 * §G5.4 end-condition (3 rejected/expired) or the safety cap.
 * @param {number} seed
 * @param {{difficulty?: string, durationSec?: number, bot?: object}} [opts]
 * @returns {{score: number, cakesServed: number, perfectCakes: number,
 *   rejected: number, expired: number, serves: number, perfectBakes: number,
 *   splats: number, trashed: number, tSec: number, over: boolean, mode: string}}
 */
export function simulateRound(seed, opts = {}) {
  const line = createLine({ rng: mulberry32(seed), difficulty: opts.difficulty ?? 'normal' });
  const bot = createLineBot(mulberry32(seed ^ 0x9e3779b9), opts.bot);
  const dt = 1 / 30;
  const duration = opts.durationSec ?? (line.tune.ENDLESS ? 900 : line.tune.DURATION_SEC);
  for (let t = 0; t < duration && !line.over; t += dt) {
    stepLine(line, dt, bot.plan(line, dt));
  }
  return {
    score: line.score,
    cakesServed: line.cakesServed,
    perfectCakes: line.perfectCakes,
    rejected: line.rejected,
    expired: line.expired,
    serves: line.serves,
    perfectBakes: line.perfectBakes,
    splats: line.splatCount,
    trashed: line.trashed,
    tSec: line.t,
    over: line.over,
    mode: line.mode,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY v3 §C9 auto-belt engine (V3/G36) — TRANSITIONAL, V4/G61.
// Kept ONLY so the pre-rework scene (purblePlace.js) keeps building and
// running until V4/G62's §G1 scene rework lands in this same wave; G62's
// module stops importing everything below. DELETE this whole block (plus the
// three legacy CAKE display fields) in the team-CAKE fix round once G62 is
// merged. Nothing below is part of the §G1.9 contract; the §G1 tests do not
// touch it.
// ═══════════════════════════════════════════════════════════════════════════

/** v3 §C9 numbers (frozen, private — superseded by the §G1 CAKE above). */
const V3 = Object.freeze({
  DURATION_SEC: 210,
  MAX_TICKETS: 3,
  EXPIRE_PTS: -5,
  BELT_SPEED: 0.55,
  BELT_LENGTH_M: 6,
  STATION_WINDOW_SEC: 0.9,
  OVEN_METER_SEC: 3,
  OVEN_GREEN_FRAC: 0.25,
  BAKE_PERFECT_PTS: 5,
  BAKE_SINGED_PTS: -3,
  BELT_RAMP_PCT: 0.06,
  BELT_RAMP_EVERY_SERVES: 3,
  BELT_RAMP_CAP_PCT: 0.24,
  MAX_CANDLES: 4,
  MAX_CAKES: 3,
  SPAWN_LEAD_SEC: 0.7,
  MIN_GAP_M: 0.55,
  LOOP_RETURN_SEC: 0.9,
});

/** v3 station belt positions (old single-nozzle layout). */
export const STATION_S = Object.freeze({
  teig: 0.9,
  ofen: 1.8,
  guss: 3.9,
  deko: 4.7,
  kerzen: 5.45,
});

/** v3 belt ramp: +6 % per full 3 serves, capped at +24 % (§C9.4). */
export function beltSpeedMultAt(serves) {
  return Math.min(
    1 + V3.BELT_RAMP_CAP_PCT,
    1 + V3.BELT_RAMP_PCT * Math.floor(Math.max(0, serves) / V3.BELT_RAMP_EVERY_SERVES)
  );
}

/** v3 belt speed (m/s) after `serves` serves. */
export function beltSpeedAt(serves) {
  return V3.BELT_SPEED * beltSpeedMultAt(serves);
}

/** v3 spatial station window half-width (0.9 s at base speed). */
function stationWindowHalfM() {
  return (V3.BELT_SPEED * V3.STATION_WINDOW_SEC) / 2;
}

/** v3 belt-window hit test. */
export function inStationWindow(s, stationS) {
  return Math.abs(s - stationS) <= stationWindowHalfM() + EPS;
}

/** v3 oven meter zones (3 s meter, green last 25 %, late singed). */
function bakeResultAtV3(tSec) {
  if (tSec >= V3.OVEN_METER_SEC) return 'singed';
  if (tSec >= V3.OVEN_METER_SEC * (1 - V3.OVEN_GREEN_FRAC)) return 'perfect';
  return 'pale';
}

/** v3 wrong count (no singe rule — bake was not a match dimension). */
function wrongCountV3(cake, ticket) {
  let wrong = 0;
  if (cake.shape !== ticket.shape) wrong += 1;
  if (cake.sponge !== ticket.sponge) wrong += 1;
  if ((cake.icing ?? 'none') !== ticket.icing) wrong += 1;
  if ((cake.topping ?? 'none') !== ticket.topping) wrong += 1;
  if ((cake.candles || 0) !== ticket.candles) wrong += 1;
  return wrong;
}

/** v3 best ticket (fewest wrong, tie → most urgent). */
function bestTicketIndexV3(cake, tickets) {
  let best = -1;
  let bestWrong = Infinity;
  let bestRemain = Infinity;
  for (let i = 0; i < tickets.length; i += 1) {
    const w = wrongCountV3(cake, tickets[i].spec);
    if (w < bestWrong || (w === bestWrong && tickets[i].remain < bestRemain)) {
      best = i;
      bestWrong = w;
      bestRemain = tickets[i].remain;
    }
  }
  return best;
}

/** v3 fixable-deficit test (loop policy). */
function fixableDeficit(cake, spec) {
  if (cake.sponge == null) return true;
  if (cake.icing == null && spec.icing !== 'none') return true;
  if (cake.topping == null && spec.topping !== 'none') return true;
  if ((cake.candles || 0) < spec.candles) return true;
  return false;
}

/** v3 serve-zone loop policy (one fix pass). */
function shouldLoop(cake, tickets) {
  if (tickets.length === 0) return true;
  if (cake.looped) return false;
  const best = bestTicketIndexV3(cake, tickets);
  return fixableDeficit(cake, tickets[best].spec);
}

/**
 * v3 §C9 round engine (auto-running belt, tap-station windows). LEGACY — the
 * pre-G62 scene's engine; see the block banner.
 * @param {() => number} rng seeded 0..1
 * @returns {object} engine
 */
export function createEngine(rng) {
  const state = {
    t: 0,
    score: 0,
    combo: 0,
    serves: 0,
    cakesServed: 0,
    perfectCakes: 0,
    rejected: 0,
    expired: 0,
    perfectBakes: 0,
    tickets: [],
    cakes: [],
    nextShape: SHAPES[0],
    orderT: 0,
    pendingSpawn: null,
    nextTicketId: 1,
    nextCakeId: 1,
    events: [],
  };

  const emit = (e) => state.events.push(e);

  function addScoreV3(points) {
    state.score = Math.max(0, state.score + points);
  }

  function untargetedTickets() {
    const targeted = new Set(state.cakes.map((c) => c.targetTicketId));
    if (state.pendingSpawn) targeted.add(state.pendingSpawn.ticketId);
    return state.tickets.filter((tk) => !targeted.has(tk.id));
  }

  function nextSpawnTicket() {
    if (state.pendingSpawn) {
      return state.tickets.find((tk) => tk.id === state.pendingSpawn.ticketId) ?? null;
    }
    const open = untargetedTickets();
    if (open.length === 0) return null;
    return open.reduce((a, b) => (b.remain < a.remain ? b : a));
  }

  function spawnAreaClear() {
    return state.cakes.every((c) => c.returning || c.s > V3.MIN_GAP_M + 0.1);
  }

  function serveCake(cake) {
    const idx = bestTicketIndexV3(cake, state.tickets);
    const ticket = state.tickets[idx];
    const wrong = wrongCountV3(cake, ticket.spec);
    const patienceFrac = ticket.remain / ticket.patience;
    const r = scoreServe({ wrong, combo: state.combo, patienceFrac });
    addScoreV3(r.points);
    state.combo = r.comboAfter;
    state.serves += 1;
    state.cakesServed += 1;
    if (r.outcome === 'perfect') state.perfectCakes += 1;
    if (r.outcome === 'rejected') state.rejected += 1;
    state.tickets.splice(idx, 1);
    state.cakes.splice(state.cakes.indexOf(cake), 1);
    emit({
      type: 'serve',
      outcome: r.outcome,
      points: r.points,
      base: r.base,
      comboBonus: r.comboBonus,
      speedBonus: r.speedBonus,
      wrong,
      patienceFrac,
      ticketId: ticket.id,
      cakeId: cake.id,
      bake: cake.bake,
    });
  }

  function step(dt) {
    state.t += dt;
    const speed = beltSpeedAt(state.serves);

    state.orderT -= dt;
    if (state.orderT <= 0) {
      if (state.tickets.length < V3.MAX_TICKETS) {
        const spec = makeTicket(rng, state.serves);
        const patience = patienceFor(state.serves);
        const ticket = { id: state.nextTicketId++, spec, remain: patience, patience };
        state.tickets.push(ticket);
        state.orderT = orderIntervalAt(state.serves);
        emit({ type: 'order', ticketId: ticket.id });
      } else {
        state.orderT = 0;
      }
    }

    for (let i = state.tickets.length - 1; i >= 0; i -= 1) {
      const tk = state.tickets[i];
      tk.remain -= dt;
      if (tk.remain <= 0) {
        state.tickets.splice(i, 1);
        addScoreV3(V3.EXPIRE_PTS);
        state.combo = 0;
        state.expired += 1;
        emit({ type: 'expire', ticketId: tk.id, points: V3.EXPIRE_PTS });
        for (const c of state.cakes) {
          if (c.targetTicketId === tk.id) c.targetTicketId = null;
        }
      }
    }

    for (const c of state.cakes) {
      if (c.targetTicketId != null) continue;
      const open = untargetedTickets();
      if (open.length > 0) {
        c.targetTicketId = open.reduce((a, b) => (b.remain < a.remain ? b : a)).id;
      }
    }

    if (!state.pendingSpawn && state.cakes.length < V3.MAX_CAKES && spawnAreaClear()) {
      const target = nextSpawnTicket();
      if (target) {
        state.pendingSpawn = { ticketId: target.id, t: V3.SPAWN_LEAD_SEC };
        emit({ type: 'spawnLead', ticketId: target.id });
      }
    }
    if (state.pendingSpawn) {
      state.pendingSpawn.t -= dt;
      const targetStillOpen = state.tickets.some((tk) => tk.id === state.pendingSpawn.ticketId);
      if (!targetStillOpen) {
        state.pendingSpawn = null;
      } else if (state.pendingSpawn.t <= 0 && spawnAreaClear()) {
        const cake = {
          id: state.nextCakeId++,
          shape: state.nextShape,
          sponge: null,
          bake: null,
          icing: null,
          topping: null,
          candles: 0,
          s: 0,
          looped: false,
          inOven: false,
          ovenT: 0,
          returning: false,
          returnT: 0,
          targetTicketId: state.pendingSpawn.ticketId,
        };
        state.cakes.push(cake);
        state.pendingSpawn = null;
        emit({ type: 'spawn', cakeId: cake.id, shape: cake.shape });
      }
    }

    const ordered = [...state.cakes].sort((a, b) => b.s - a.s);
    for (const cake of ordered) {
      if (cake.returning) {
        cake.returnT -= dt;
        if (cake.returnT <= 0 && spawnAreaClear()) {
          cake.returning = false;
          cake.s = 0;
          emit({ type: 'loopLand', cakeId: cake.id });
        }
        continue;
      }
      if (cake.inOven) {
        cake.ovenT += dt;
        if (cake.ovenT >= V3.OVEN_METER_SEC) {
          cake.bake = 'singed';
          cake.inOven = false;
          addScoreV3(V3.BAKE_SINGED_PTS);
          emit({ type: 'bake', cakeId: cake.id, result: 'singed', points: V3.BAKE_SINGED_PTS });
        }
        continue;
      }
      let nextS = cake.s + speed * dt;
      const ahead = state.cakes.filter(
        (c) => c !== cake && !c.returning && c.s > cake.s
      );
      for (const c of ahead) {
        nextS = Math.min(nextS, c.s - V3.MIN_GAP_M);
      }
      cake.s = Math.max(cake.s, nextS);
      if (cake.bake == null && cake.s >= STATION_S.ofen) {
        cake.s = STATION_S.ofen;
        cake.inOven = true;
        cake.ovenT = 0;
        emit({ type: 'ovenStart', cakeId: cake.id });
        continue;
      }
      if (cake.s >= V3.BELT_LENGTH_M) {
        if (shouldLoop(cake, state.tickets)) {
          cake.looped = true;
          cake.returning = true;
          cake.returnT = V3.LOOP_RETURN_SEC;
          emit({ type: 'loop', cakeId: cake.id });
        } else {
          serveCake(cake);
        }
      }
    }
  }

  function tapStation(station, value) {
    if (station === 'form') {
      const i = SHAPES.indexOf(state.nextShape);
      state.nextShape = SHAPES[(i + 1) % SHAPES.length];
      return { ok: true, shape: state.nextShape };
    }
    if (station === 'ofen') {
      const cake = state.cakes.find((c) => c.inOven);
      if (!cake) return { ok: false };
      const result = bakeResultAtV3(cake.ovenT);
      const points = result === 'perfect' ? V3.BAKE_PERFECT_PTS : result === 'singed' ? V3.BAKE_SINGED_PTS : 0;
      cake.bake = result;
      cake.inOven = false;
      if (result === 'perfect') state.perfectBakes += 1;
      addScoreV3(points);
      emit({ type: 'bake', cakeId: cake.id, result, points });
      return { ok: true, result, points };
    }
    const stationS = STATION_S[station];
    if (stationS == null) return { ok: false };
    const cake = state.cakes.find(
      (c) => !c.returning && !c.inOven && inStationWindow(c.s, stationS)
    );
    if (!cake) return { ok: false };
    if (station === 'teig' && cake.sponge == null && SPONGES.includes(value)) {
      cake.sponge = value;
      emit({ type: 'apply', station, cakeId: cake.id, value });
      return { ok: true, cakeId: cake.id };
    }
    if (station === 'guss' && cake.icing == null && cake.bake != null && ICINGS.includes(value) && value !== 'none') {
      cake.icing = value;
      emit({ type: 'apply', station, cakeId: cake.id, value });
      return { ok: true, cakeId: cake.id };
    }
    if (station === 'deko' && cake.topping == null && TOPPINGS.includes(value) && value !== 'none') {
      cake.topping = value;
      emit({ type: 'apply', station, cakeId: cake.id, value });
      return { ok: true, cakeId: cake.id };
    }
    if (station === 'kerzen' && (cake.candles || 0) < V3.MAX_CANDLES) {
      cake.candles = (cake.candles || 0) + 1;
      emit({ type: 'apply', station, cakeId: cake.id, value: cake.candles });
      return { ok: true, cakeId: cake.id, candles: cake.candles };
    }
    return { ok: false };
  }

  function drainEvents() {
    const out = state.events;
    state.events = [];
    return out;
  }

  return { state, step, tapStation, drainEvents, nextSpawnTicket };
}

/** v3 bot tuning (LEGACY — the old scene's ?autoplay error model). */
const BOT_V3 = Object.freeze({
  TAP_RATE: 6,
  MISS_CHANCE: 0.32,
  WRONG_CHANCE: 0.22,
  SHAPE_WRONG_CHANCE: 0.18,
  CANDLE_SHORT_CHANCE: 0.2,
  OVEN_EARLY_CHANCE: 0.45,
  OVEN_LATE_CHANCE: 0.13,
  FIX_FOCUS: 0.3,
  REACT_FRAC: 0.25,
});

/**
 * v3 tap-scheduler bot for the LEGACY engine (pre-G62 scene's ?autoplay=1).
 * Renamed off `createBot` (now the §G1.9 bot — G62's scene feature-detects
 * that name); the pre-rework scene only breaks under ?autoplay=1 at
 * intermediate commits, never in normal play.
 * @param {() => number} rng
 * @param {object} [opts]
 * @returns {{plan: (engine: object, dt: number) => Array<{station: string, value?: string}>}}
 */
export function createBotV3(rng, opts = {}) {
  const P = { ...BOT_V3, ...opts };
  const memo = new Map();
  let shapePlannedFor = 0;
  let tapCooldown = 0;

  function cakeMemo(id) {
    let m = memo.get(id);
    if (!m) {
      m = { acts: new Map(), ovenPlan: null, ovenDone: false };
      memo.set(id, m);
    }
    return m;
  }

  function actFor(m, cake, station, want) {
    const key = `${station}:${cake.looped ? 1 : 0}`;
    let act = m.acts.get(key);
    if (act) return act;
    const focus = cake.looped ? P.FIX_FOCUS : 1;
    if (rng() < P.MISS_CHANCE * focus) {
      act = { kind: 'miss' };
    } else {
      let value = want;
      if (rng() < P.WRONG_CHANCE * focus) {
        const pool = station === 'teig' ? SPONGES : station === 'guss' ? ICINGS.slice(0, 3) : TOPPINGS.slice(0, 3);
        value = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
      }
      act = { kind: 'tap', value, delay: rng() * P.REACT_FRAC * V3.STATION_WINDOW_SEC };
    }
    m.acts.set(key, act);
    return act;
  }

  function plan(engine, dt) {
    const { state } = engine;
    const taps = [];
    tapCooldown = Math.max(0, tapCooldown - dt);

    const nextTk = engine.nextSpawnTicket();
    if (nextTk && shapePlannedFor !== nextTk.id) {
      shapePlannedFor = nextTk.id;
      if (rng() < P.SHAPE_WRONG_CHANCE) {
        cakeMemo(-nextTk.id).forgotten = true;
      }
    }
    if (nextTk && !cakeMemo(-nextTk.id).forgotten && state.nextShape !== nextTk.spec.shape && tapCooldown <= 0) {
      taps.push({ station: 'form' });
      tapCooldown = 1 / P.TAP_RATE;
    }

    for (const cake of state.cakes) {
      const m = cakeMemo(cake.id);
      const target =
        state.tickets.find((tk) => tk.id === cake.targetTicketId) ??
        state.tickets[bestTicketIndexV3(cake, state.tickets)] ??
        null;
      if (!target) continue;
      const spec = target.spec;

      if (cake.inOven) {
        if (!m.ovenPlan) {
          const green = V3.OVEN_METER_SEC * (1 - V3.OVEN_GREEN_FRAC);
          if (rng() < P.OVEN_LATE_CHANCE) m.ovenPlan = { at: Infinity };
          else if (rng() < P.OVEN_EARLY_CHANCE) m.ovenPlan = { at: green * (0.45 + rng() * 0.5) };
          else m.ovenPlan = { at: green + rng() * (V3.OVEN_METER_SEC - green) * 0.8 };
        }
        if (!m.ovenDone && cake.ovenT >= m.ovenPlan.at) {
          m.ovenDone = true;
          taps.push({ station: 'ofen' });
        }
        continue;
      }
      m.ovenPlan = null;
      m.ovenDone = false;

      if (cake.returning) continue;

      for (const station of ['teig', 'guss', 'deko']) {
        if (!inStationWindow(cake.s, STATION_S[station])) continue;
        const slotEmpty =
          station === 'teig' ? cake.sponge == null
            : station === 'guss' ? cake.icing == null && cake.bake != null
              : cake.topping == null;
        const want =
          station === 'teig' ? spec.sponge : station === 'guss' ? spec.icing : spec.topping;
        if (!slotEmpty || want === 'none') continue;
        const act = actFor(m, cake, station, want);
        if (act.kind === 'miss') continue;
        const entryS = STATION_S[station] - stationWindowHalfM();
        const speed = beltSpeedAt(state.serves);
        const timeInside = (cake.s - entryS) / Math.max(0.01, speed);
        if (timeInside >= act.delay) taps.push({ station, value: act.value });
      }

      if (inStationWindow(cake.s, STATION_S.kerzen) && tapCooldown <= 0) {
        const act = actFor(m, cake, 'kerzen', null);
        if (act.short == null) {
          const focus = cake.looped ? P.FIX_FOCUS : 1;
          act.short = rng() < P.CANDLE_SHORT_CHANCE * focus ? 1 : 0;
        }
        const wantCandles = Math.max(0, spec.candles - act.short);
        if (act.kind !== 'miss' && (cake.candles || 0) < wantCandles) {
          taps.push({ station: 'kerzen' });
          tapCooldown = 1 / P.TAP_RATE;
        }
      }
    }

    if (memo.size > 64) {
      const alive = new Set(state.cakes.map((c) => c.id));
      for (const key of memo.keys()) {
        if (key > 0 && !alive.has(key)) memo.delete(key);
      }
    }
    return taps;
  }

  return { plan };
}
