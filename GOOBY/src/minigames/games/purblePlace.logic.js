// Cake Shop / Tortenwerkstatt — pure assembly-line engine (PLAN3 §C9, agent
// V3/G36). No three.js/DOM imports so `node --test` runs this headlessly (§B
// rule); the game module (purblePlace.js) renders THIS engine's state and
// forwards taps. Binding §C9 numbers (verbatim): tickets = shape(∘/□/♥) ×
// sponge(3) × icing(4 incl none) × topping(4 incl none) × candles 0–4, max 3
// parallel; patience 45 s → −1.5 s/serve floor 30 s, expiry −5 + combo reset;
// conveyor 0.55 m/s belt 6 m, stations Form→Teig→Ofen(3 s meter, green zone
// last 25 % = +5, late −3)→Guss→Deko→Kerzen with 0.9 s windows (at base
// speed), belt loops ONCE per cake for fixes; serve zone auto-matches the
// best open ticket; +20 perfect / +8 one-wrong / −5 rejected (≥2 wrong),
// combo +2/serve cap +10, speed bonus +4 at ≥50 % patience; ramp: order
// interval 30→14 s (−2/serve), candles ≥3 + none-icing only after serve #4,
// belt +6 %/3 serves cap +24 %; round 210 s fixed. Typical human ≈ 120–150;
// coin row (§C9.5, constants): divisor 5, min 5, max 30 ≈ 26 c.

/** Binding §C9 numbers + V3/G36 tuning (layout, spawn cadence, bot model). */
export const CAKE = Object.freeze({
  /** Round length (§C9.4: 210 s fixed). */
  DURATION_SEC: 210,
  /** Max parallel order tickets (§C9.2). */
  MAX_TICKETS: 3,
  /** Patience 45 s → −1.5 s per served cake, floor 30 s (§C9.2). */
  PATIENCE_START_SEC: 45,
  PATIENCE_STEP_SEC: 1.5,
  PATIENCE_FLOOR_SEC: 30,
  /** Expired ticket = customer leaves sad (§C9.2): −5 + combo reset. */
  EXPIRE_PTS: -5,
  /** Conveyor (§C9.3): 0.55 m/s over a 6 m belt. */
  BELT_SPEED: 0.55,
  BELT_LENGTH_M: 6,
  /** Station window: 0.9 s at base speed (§C9.3) — spatial, so it SHRINKS
   * in time as the belt ramps (that's the late-round difficulty). */
  STATION_WINDOW_SEC: 0.9,
  /** Ofen (§C9.3): 3 s bake meter, green zone = last 25 %. */
  OVEN_METER_SEC: 3,
  OVEN_GREEN_FRAC: 0.25,
  BAKE_PERFECT_PTS: 5,
  BAKE_SINGED_PTS: -3,
  /** Serve scoring (§C9.4). */
  PERFECT_PTS: 20,
  ONE_WRONG_PTS: 8,
  REJECT_PTS: -5,
  COMBO_STEP: 2,
  COMBO_CAP: 10,
  SPEED_BONUS_PTS: 4,
  SPEED_BONUS_MIN_FRAC: 0.5,
  /** Ramp (§C9.4): order interval 30 → 14 s (−2 s per serve). */
  ORDER_INTERVAL_START_SEC: 30,
  ORDER_INTERVAL_STEP_SEC: 2,
  ORDER_INTERVAL_MIN_SEC: 14,
  /** Belt +6 % per 3 serves, cap +24 % (§C9.4). */
  BELT_RAMP_PCT: 0.06,
  BELT_RAMP_EVERY_SERVES: 3,
  BELT_RAMP_CAP_PCT: 0.24,
  /** Candles ≥ 3 and none-icing tickets only after serve #4 (§C9.4). */
  COMPLEX_AFTER_SERVES: 4,
  MAX_CANDLES: 4,
  /** V3/G36 tuning: max concurrent cakes, spawn spacing/lead, belt min gap,
   * fix-loop return flight time. */
  MAX_CAKES: 3,
  SPAWN_LEAD_SEC: 0.7,
  MIN_GAP_M: 0.55,
  LOOP_RETURN_SEC: 0.9,
});

/** Ticket dimensions (§C9.2 — hexes verbatim). */
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

/** Station order (§C9.3) + belt-space positions (V3/G36 layout: 'form' is
 * the pre-spawn selector at s = 0; serve zone at s = BELT_LENGTH_M; the
 * 2.4–3.4 m span is the station-free chute between the two belt tiers). */
export const STATIONS = Object.freeze(['form', 'teig', 'ofen', 'guss', 'deko', 'kerzen']);
export const STATION_S = Object.freeze({
  teig: 0.9,
  ofen: 1.8,
  guss: 3.9,
  deko: 4.7,
  kerzen: 5.45,
});

// ---------------------------------------------------------------------------
// pure math helpers (§C9.2/§C9.3/§C9.4 — each individually testable)
// ---------------------------------------------------------------------------

/**
 * Patience of a NEW ticket after `serves` served cakes: 45 − 1.5·serves,
 * floored at 30 (§C9.2).
 * @param {number} serves cakes served so far (any outcome)
 * @returns {number} seconds
 */
export function patienceFor(serves) {
  return Math.max(
    CAKE.PATIENCE_FLOOR_SEC,
    CAKE.PATIENCE_START_SEC - CAKE.PATIENCE_STEP_SEC * Math.max(0, serves)
  );
}

/**
 * Seconds until the next order: 30 − 2·serves, floored at 14 (§C9.4).
 * @param {number} serves
 * @returns {number}
 */
export function orderIntervalAt(serves) {
  return Math.max(
    CAKE.ORDER_INTERVAL_MIN_SEC,
    CAKE.ORDER_INTERVAL_START_SEC - CAKE.ORDER_INTERVAL_STEP_SEC * Math.max(0, serves)
  );
}

/**
 * Belt speed multiplier: +6 % per full 3 serves, capped at +24 % (§C9.4).
 * @param {number} serves
 * @returns {number} 1 … 1.24
 */
export function beltSpeedMultAt(serves) {
  return Math.min(
    1 + CAKE.BELT_RAMP_CAP_PCT,
    1 + CAKE.BELT_RAMP_PCT * Math.floor(Math.max(0, serves) / CAKE.BELT_RAMP_EVERY_SERVES)
  );
}

/**
 * Belt speed (m/s) after `serves` serves.
 * @param {number} serves
 * @returns {number}
 */
export function beltSpeedAt(serves) {
  return CAKE.BELT_SPEED * beltSpeedMultAt(serves);
}

/**
 * Spatial half-width of a station window: the §C9.3 0.9 s window at BASE
 * speed = 0.495 m of belt, fixed in space — faster belts shrink the TIME a
 * cake spends inside it.
 * @returns {number} meters
 */
export function stationWindowHalfM() {
  return (CAKE.BELT_SPEED * CAKE.STATION_WINDOW_SEC) / 2;
}

/**
 * Belt-window hit test (§C9.3): is a cake at `s` inside a station's window?
 * @param {number} s cake belt position (m)
 * @param {number} stationS station belt position (m)
 * @returns {boolean}
 */
export function inStationWindow(s, stationS) {
  // tiny epsilon keeps the ±half edges inclusive under float error
  return Math.abs(s - stationS) <= stationWindowHalfM() + 1e-9;
}

/**
 * Bake quality for an oven release at `tSec` on the 3 s meter (§C9.3):
 * green zone = last 25 % (2.25–3 s) → 'perfect'; earlier → 'pale';
 * past the meter (no tap) → 'singed'.
 * @param {number} tSec seconds since the cake entered the oven
 * @returns {'pale'|'perfect'|'singed'}
 */
export function bakeResultAt(tSec) {
  if (tSec >= CAKE.OVEN_METER_SEC) return 'singed';
  if (tSec >= CAKE.OVEN_METER_SEC * (1 - CAKE.OVEN_GREEN_FRAC)) return 'perfect';
  return 'pale';
}

/**
 * Immediate oven points (§C9.3): perfect +5, singed −3, pale ±0.
 * @param {'pale'|'perfect'|'singed'} result
 * @returns {number}
 */
export function bakePoints(result) {
  if (result === 'perfect') return CAKE.BAKE_PERFECT_PTS;
  if (result === 'singed') return CAKE.BAKE_SINGED_PTS;
  return 0;
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
 * Seeded ticket generator with §C9.4 difficulty weighting: before serve #4
 * only simple tickets (icing never 'none', candles ≤ 2, mostly 0–1); after,
 * the full space opens and component weight shifts toward complex (more
 * candles, 'none' icing possible — 'none' is COMPLEX: the player must skip a
 * station on purpose).
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
 * dimensions. Empty icing/topping slots count as 'none' (so a none-icing
 * ticket matches an un-iced cake); an empty sponge can never match (tickets
 * always want sponge). Bake quality is NOT a match dimension (§C9.3 scores
 * it at the oven).
 * @param {{shape: string, sponge: string|null, icing: string|null, topping: string|null, candles: number}} cake
 * @param {{shape: string, sponge: string, icing: string, topping: string, candles: number}} ticket
 * @returns {number} 0…5
 */
export function wrongCount(cake, ticket) {
  let wrong = 0;
  if (cake.shape !== ticket.shape) wrong += 1;
  if (cake.sponge !== ticket.sponge) wrong += 1;
  if ((cake.icing ?? 'none') !== ticket.icing) wrong += 1;
  if ((cake.topping ?? 'none') !== ticket.topping) wrong += 1;
  if ((cake.candles || 0) !== ticket.candles) wrong += 1;
  return wrong;
}

/**
 * Serve outcome by wrong count (§C9.4).
 * @param {number} wrong
 * @returns {'perfect'|'oneWrong'|'rejected'}
 */
export function serveOutcome(wrong) {
  if (wrong === 0) return 'perfect';
  if (wrong === 1) return 'oneWrong';
  return 'rejected';
}

/**
 * Full §C9.4 serve scoring matrix: base by outcome (+20 / +8 / −5), combo
 * +2 per consecutive prior non-rejected serve capped +10 (rejects earn none
 * and reset the streak), speed bonus +4 when served with ≥ 50 % patience
 * left (non-rejected serves only).
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
 * The best-matching open ticket for a cake (§C9.3 serve zone): fewest wrong
 * components, ties broken by lowest remaining patience (serve the most
 * urgent customer).
 * @param {object} cake
 * @param {Array<{spec: object, remain: number}>} tickets
 * @returns {number} index into tickets, or −1 when none are open
 */
export function bestTicketIndex(cake, tickets) {
  let best = -1;
  let bestWrong = Infinity;
  let bestRemain = Infinity;
  for (let i = 0; i < tickets.length; i += 1) {
    const w = wrongCount(cake, tickets[i].spec);
    if (w < bestWrong || (w === bestWrong && tickets[i].remain < bestRemain)) {
      best = i;
      bestWrong = w;
      bestRemain = tickets[i].remain;
    }
  }
  return best;
}

/**
 * Deficits of a cake vs a ticket that a SECOND belt pass can still fix
 * (§C9.3 "missed window = slot stays empty, fixable on the next pass"):
 * empty sponge, empty icing the ticket wants, empty topping the ticket
 * wants, too-few candles. Wrong (non-empty) slots and the shape are baked
 * in — not fixable.
 * @param {object} cake
 * @param {object} spec ticket spec
 * @returns {boolean} any fixable deficit?
 */
export function fixableDeficit(cake, spec) {
  if (cake.sponge == null) return true;
  if (cake.icing == null && spec.icing !== 'none') return true;
  if (cake.topping == null && spec.topping !== 'none') return true;
  if ((cake.candles || 0) < spec.candles) return true;
  return false;
}

/**
 * Serve-zone policy (§C9.3): a cake rides the loop ONCE when its best open
 * ticket still has fixable empty slots (or when no ticket is open — never
 * serve into the void); otherwise it auto-serves.
 * @param {object} cake
 * @param {Array<{spec: object, remain: number}>} tickets
 * @returns {boolean} true = loop for a fix pass
 */
export function shouldLoop(cake, tickets) {
  if (tickets.length === 0) return true;
  if (cake.looped) return false;
  const best = bestTicketIndex(cake, tickets);
  return fixableDeficit(cake, tickets[best].spec);
}

// ---------------------------------------------------------------------------
// the round engine — pure, deterministic under a seeded rng; the game module
// renders this state and forwards taps, the bot below drives it in tests
// ---------------------------------------------------------------------------

/** Event types drained by the consumer (sfx/banners/NPC triggers). */
/** @typedef {{type: string, [k: string]: any}} CakeEvent */

/**
 * Create a fresh §C9 round engine.
 * @param {() => number} rng seeded 0..1 (ctx.rng in the live game)
 * @returns {object} engine — see the returned API
 */
export function createEngine(rng) {
  const state = {
    t: 0,
    score: 0,
    combo: 0, // consecutive non-rejected serves
    serves: 0, // all serve events (ramp basis)
    cakesServed: 0, // == serves (meta name §C9.5)
    perfectCakes: 0,
    rejected: 0,
    expired: 0,
    perfectBakes: 0,
    /** @type {Array<{id: number, spec: object, remain: number, patience: number}>} */
    tickets: [],
    /** @type {Array<object>} */
    cakes: [],
    nextShape: SHAPES[0],
    orderT: 0, // first order lands immediately
    /** @type {{ticketId: number, t: number}|null} */
    pendingSpawn: null,
    nextTicketId: 1,
    nextCakeId: 1,
    /** @type {CakeEvent[]} */
    events: [],
  };

  const emit = (e) => state.events.push(e);

  function addScore(points) {
    state.score = Math.max(0, state.score + points);
  }

  /** Open tickets no cake is currently targeting. */
  function untargetedTickets() {
    const targeted = new Set(state.cakes.map((c) => c.targetTicketId));
    if (state.pendingSpawn) targeted.add(state.pendingSpawn.ticketId);
    return state.tickets.filter((tk) => !targeted.has(tk.id));
  }

  /** The ticket the NEXT pan will bake for (bot presets the Form shape). */
  function nextSpawnTicket() {
    if (state.pendingSpawn) {
      return state.tickets.find((tk) => tk.id === state.pendingSpawn.ticketId) ?? null;
    }
    const open = untargetedTickets();
    if (open.length === 0) return null;
    return open.reduce((a, b) => (b.remain < a.remain ? b : a));
  }

  function spawnAreaClear() {
    return state.cakes.every((c) => c.returning || c.s > CAKE.MIN_GAP_M + 0.1);
  }

  function serveCake(cake) {
    const idx = bestTicketIndex(cake, state.tickets);
    const ticket = state.tickets[idx];
    const wrong = wrongCount(cake, ticket.spec);
    const patienceFrac = ticket.remain / ticket.patience;
    const r = scoreServe({ wrong, combo: state.combo, patienceFrac });
    addScore(r.points);
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

    // ── orders (§C9.4 ramp; held while the 3-ticket board is full) ─────────
    state.orderT -= dt;
    if (state.orderT <= 0) {
      if (state.tickets.length < CAKE.MAX_TICKETS) {
        const spec = makeTicket(rng, state.serves);
        const patience = patienceFor(state.serves);
        const ticket = { id: state.nextTicketId++, spec, remain: patience, patience };
        state.tickets.push(ticket);
        state.orderT = orderIntervalAt(state.serves);
        emit({ type: 'order', ticketId: ticket.id });
      } else {
        state.orderT = 0; // retry as soon as a slot frees
      }
    }

    // ── patience decay + expiry (§C9.2) ────────────────────────────────────
    for (let i = state.tickets.length - 1; i >= 0; i -= 1) {
      const tk = state.tickets[i];
      tk.remain -= dt;
      if (tk.remain <= 0) {
        state.tickets.splice(i, 1);
        addScore(CAKE.EXPIRE_PTS);
        state.combo = 0;
        state.expired += 1;
        emit({ type: 'expire', ticketId: tk.id, points: CAKE.EXPIRE_PTS });
        for (const c of state.cakes) {
          if (c.targetTicketId === tk.id) c.targetTicketId = null;
        }
      }
    }

    // ── retarget orphaned cakes (bot guidance only — serve is best-match) ──
    for (const c of state.cakes) {
      if (c.targetTicketId != null) continue;
      const open = untargetedTickets();
      if (open.length > 0) {
        c.targetTicketId = open.reduce((a, b) => (b.remain < a.remain ? b : a)).id;
      }
    }

    // ── pan spawning (Form; §C9.3 shape is set BEFORE spawn) ───────────────
    if (!state.pendingSpawn && state.cakes.length < CAKE.MAX_CAKES && spawnAreaClear()) {
      const target = nextSpawnTicket();
      if (target) {
        state.pendingSpawn = { ticketId: target.id, t: CAKE.SPAWN_LEAD_SEC };
        emit({ type: 'spawnLead', ticketId: target.id });
      }
    }
    if (state.pendingSpawn) {
      state.pendingSpawn.t -= dt;
      const targetStillOpen = state.tickets.some((tk) => tk.id === state.pendingSpawn.ticketId);
      if (!targetStillOpen) {
        state.pendingSpawn = null; // customer left before the pan hit the belt
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

    // ── belt movement, oven holds, fix-loop returns, serving ───────────────
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
        if (cake.ovenT >= CAKE.OVEN_METER_SEC) {
          // meter ran out — auto-release singed (§C9.3 late = −3)
          cake.bake = 'singed';
          cake.inOven = false;
          addScore(CAKE.BAKE_SINGED_PTS);
          emit({ type: 'bake', cakeId: cake.id, result: 'singed', points: CAKE.BAKE_SINGED_PTS });
        }
        continue;
      }
      let nextS = cake.s + speed * dt;
      // never overlap the cake ahead (queues form behind the oven)
      const ahead = state.cakes.filter(
        (c) => c !== cake && !c.returning && c.s > cake.s
      );
      for (const c of ahead) {
        nextS = Math.min(nextS, c.s - CAKE.MIN_GAP_M);
      }
      cake.s = Math.max(cake.s, nextS);
      // oven catches every un-baked cake (§C9.3 — the meter starts)
      if (cake.bake == null && cake.s >= STATION_S.ofen) {
        cake.s = STATION_S.ofen;
        cake.inOven = true;
        cake.ovenT = 0;
        emit({ type: 'ovenStart', cakeId: cake.id });
        continue;
      }
      if (cake.s >= CAKE.BELT_LENGTH_M) {
        if (shouldLoop(cake, state.tickets)) {
          cake.looped = true;
          cake.returning = true;
          cake.returnT = CAKE.LOOP_RETURN_SEC;
          emit({ type: 'loop', cakeId: cake.id });
        } else {
          serveCake(cake);
        }
      }
    }
  }

  /**
   * Player/bot input. Stations:
   *   'form'            — cycle the NEXT pan's shape (∘ → □ → ♥ → ∘)
   *   'teig'   value    — sponge id, applies to the cake in the Teig window
   *   'ofen'            — release the baking cake (bakeResultAt timing)
   *   'guss'   value    — icing id
   *   'deko'   value    — topping id
   *   'kerzen'          — +1 candle on the cake in the window (max 4)
   * @param {string} station
   * @param {string} [value]
   * @returns {{ok: boolean, [k: string]: any}}
   */
  function tapStation(station, value) {
    if (station === 'form') {
      const i = SHAPES.indexOf(state.nextShape);
      state.nextShape = SHAPES[(i + 1) % SHAPES.length];
      return { ok: true, shape: state.nextShape };
    }
    if (station === 'ofen') {
      const cake = state.cakes.find((c) => c.inOven);
      if (!cake) return { ok: false };
      const result = bakeResultAt(cake.ovenT);
      const points = bakePoints(result);
      cake.bake = result;
      cake.inOven = false;
      if (result === 'perfect') state.perfectBakes += 1;
      addScore(points);
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
    if (station === 'kerzen' && (cake.candles || 0) < CAKE.MAX_CANDLES) {
      cake.candles = (cake.candles || 0) + 1;
      emit({ type: 'apply', station, cakeId: cake.id, value: cake.candles });
      return { ok: true, cakeId: cake.id, candles: cake.candles };
    }
    return { ok: false };
  }

  /** Drain queued events (sfx/banner/NPC triggers) since the last call. */
  function drainEvents() {
    const out = state.events;
    state.events = [];
    return out;
  }

  return { state, step, tapStation, drainEvents, nextSpawnTicket };
}

// ---------------------------------------------------------------------------
// autoplay bot (§C9.7): a tap scheduler that reads the next cake's ticket and
// queues station taps — shared by the logic-level simulation (tests) and the
// live ?autoplay=1 mode. Error model tuned so raw scores land near the §C9.4
// human-typical 120–150 (row 5/5/30 ≈ 26 c) while averaging ≥ 90 (§C9.7 bar).
// ---------------------------------------------------------------------------

/** V3/G36 bot tuning (human-ish error model). */
export const BOT = Object.freeze({
  /** Manual taps per second (candle dropper, Form cycling). */
  TAP_RATE: 6,
  /** Chance to sleep through a station window entirely (fix-loop catches it). */
  MISS_CHANCE: 0.32,
  /** Chance to press a neighboring (wrong) component button. */
  WRONG_CHANCE: 0.22,
  /** Chance to forget presetting the Form shape for the next pan. */
  SHAPE_WRONG_CHANCE: 0.18,
  /** Chance to leave the candle dropper one candle short. */
  CANDLE_SHORT_CHANCE: 0.2,
  /** Oven timing: pale (early release) / singed (dozes past the meter). */
  OVEN_EARLY_CHANCE: 0.45,
  OVEN_LATE_CHANCE: 0.13,
  /** Error-chance multiplier on the fix pass (players FOCUS after a loop). */
  FIX_FOCUS: 0.3,
  /** Reaction delay inside a window before the tap lands (fraction of it). */
  REACT_FRAC: 0.25,
});

/**
 * Create the §C9.7 autoplay bot. Call `plan(engine, dt)` once per frame —
 * it returns an array of {station, value} taps to feed engine.tapStation.
 * @param {() => number} rng 0..1 (SEPARATE stream from the engine's is fine)
 * @param {object} [opts] override BOT fields (tests)
 * @returns {{plan: (engine: object, dt: number) => Array<{station: string, value?: string}>}}
 */
export function createBot(rng, opts = {}) {
  const P = { ...BOT, ...opts };
  /** per-cake bookkeeping: id → {passActs: Map<'station:pass', plan>, ovenPlan} */
  const memo = new Map();
  let shapePlannedFor = 0; // pendingSpawn ticketId already handled
  let tapCooldown = 0;

  function cakeMemo(id) {
    let m = memo.get(id);
    if (!m) {
      m = { acts: new Map(), ovenPlan: null, ovenDone: false };
      memo.set(id, m);
    }
    return m;
  }

  /** Decide once per (cake, station, pass): miss / wrong / correct + delay.
   * On the fix pass errors shrink by FIX_FOCUS (looped players concentrate). */
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
      act = { kind: 'tap', value, delay: rng() * P.REACT_FRAC * CAKE.STATION_WINDOW_SEC };
    }
    m.acts.set(key, act);
    return act;
  }

  function plan(engine, dt) {
    const { state } = engine;
    /** @type {Array<{station: string, value?: string}>} */
    const taps = [];
    tapCooldown = Math.max(0, tapCooldown - dt);

    // ── Form: preset the next pan's shape while the spawn lead runs ────────
    const nextTk = engine.nextSpawnTicket();
    if (nextTk && shapePlannedFor !== nextTk.id) {
      shapePlannedFor = nextTk.id;
      if (rng() < P.SHAPE_WRONG_CHANCE) {
        // forgot — the pan keeps whatever shape the selector shows
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
        state.tickets[bestTicketIndex(cake, state.tickets)] ??
        null;
      if (!target) continue;
      const spec = target.spec;

      // oven (independent of belt windows — the cake is held)
      if (cake.inOven) {
        if (!m.ovenPlan) {
          const green = CAKE.OVEN_METER_SEC * (1 - CAKE.OVEN_GREEN_FRAC);
          if (rng() < P.OVEN_LATE_CHANCE) m.ovenPlan = { at: Infinity }; // dozes off → auto-singe
          else if (rng() < P.OVEN_EARLY_CHANCE) m.ovenPlan = { at: green * (0.45 + rng() * 0.5) };
          else m.ovenPlan = { at: green + rng() * (CAKE.OVEN_METER_SEC - green) * 0.8 };
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

      // component stations — act once per window pass
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

      // candle dropper: tap up to the needed count while inside the window
      // (occasionally one short — CANDLE_SHORT_CHANCE — a very human slip)
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

    // drop memos of cakes that left the belt (served)
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
 * Headless full-round simulation (§C9.7 tests): engine + bot at a fixed
 * 30 Hz step. Also the ticket-stream solvability proof — a competent (bot)
 * player keeps the board from flooding (low expiry count).
 * @param {number} seed
 * @param {{durationSec?: number, bot?: object}} [opts]
 * @returns {{score: number, cakesServed: number, perfectCakes: number,
 *   rejected: number, expired: number, serves: number, perfectBakes: number}}
 */
export function simulateRound(seed, opts = {}) {
  const duration = opts.durationSec ?? CAKE.DURATION_SEC;
  const engine = createEngine(mulberry32(seed));
  const bot = createBot(mulberry32(seed ^ 0x9e3779b9), opts.bot);
  const dt = 1 / 30;
  for (let t = 0; t < duration; t += dt) {
    engine.step(dt);
    for (const tap of bot.plan(engine, dt)) engine.tapStation(tap.station, tap.value);
    engine.drainEvents();
  }
  const s = engine.state;
  return {
    score: s.score,
    cakesServed: s.cakesServed,
    perfectCakes: s.perfectCakes,
    rejected: s.rejected,
    expired: s.expired,
    serves: s.serves,
    perfectBakes: s.perfectBakes,
  };
}
