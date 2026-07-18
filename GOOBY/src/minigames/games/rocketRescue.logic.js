// Rocket Rescue — pure gameplay logic (PLAN3 §C10.1 #3, agent V3/G42). No
// three.js / DOM imports so test/gamesV3b.test.js runs headlessly (§B rule).
// The visual module (rocketRescue.js) maps this state onto meshes; ALL tuning
// numbers not covered by §E0.1-3 (COIN_TABLE.rocketRescue = 5/4/28 lives in
// data/constants.js) are centralized in ROCKET below — never inline them.
//
// Binding §C10.1 #3 rules implemented here:
//   · physics lander: thrust (hold) + tilt (left/right screen thirds)
//   · 5 seeded platforms per round, 1 stranded bunny each
//   · pick up a bunny by landing ≤ 1.2 m/s vertical; carry it to the station
//     pad and land there to complete the rescue
//   · fuel tank 100, thrust burns 8/s, fuel pickups float mid-air
//   · wind gusts telegraphed by particle streaks (level 3+ = once 2 bunnies
//     are home, i.e. from the 3rd rescue leg on)
//   · hard landing (> 1.2 m/s) = bounce + −10 fuel — NEVER death
//   · out of fuel = auto-tow back to the pad, run ends
//   · score = 30·rescued + fuelRemaining/2 + 5 per soft landing (≤ 0.5 m/s)
//   · meta `rescues` · duration ~120 s
//   · autoplay bot = PD controller on altitude/velocity per platform

/** Rocket Rescue tuning (§C10.1 #3 binding numbers + V3/G42 feel knobs). */
export const ROCKET = Object.freeze({
  /** Round cap (§C10.1: ~120 s; all-5-rescued or out-of-fuel end earlier). */
  DURATION_SEC: 120,
  /** Playfield half-width (m); walls softly bounce the craft back in. */
  WORLD_HALF_W: 8,
  /** Playfield ceiling (m). */
  CEILING_Y: 11,
  /** Moon-ish gravity (m/s²). */
  GRAVITY: 2.4,
  /** Thrust acceleration along the craft's up axis (m/s²). */
  THRUST_ACCEL: 5.6,
  /** Max tilt (rad, ≈ 28°) — left/right screen thirds command ±this. */
  TILT_MAX_RAD: 0.5,
  /** Tilt slew rate toward the commanded target (rad/s). */
  TILT_RATE: 3.2,
  /** Wall bounce restitution (soft nudge back into the field). */
  WALL_RESTITUTION: 0.3,
  /** Fuel (§C10.1): tank 100, thrust burns 8/s. */
  FUEL_MAX: 100,
  FUEL_BURN_PER_SEC: 8,
  /** Mid-air fuel pickups: seeded count, refill amount, collect radius (m). */
  FUEL_PICKUP_COUNT: 8,
  FUEL_PICKUP_AMOUNT: 30,
  FUEL_PICKUP_RADIUS: 0.85,
  /** A collected canister floats back in after this many seconds (cozy —
   *  §C10.1 "never death": the round is time-boxed, not fuel-starved). */
  FUEL_RESPAWN_SEC: 9,
  /** Platforms (§C10.1: 5 seeded per round, 1 bunny each). */
  PLATFORM_COUNT: 5,
  PLATFORM_HALF_W: 1.05,
  /** Station pad (rescue drop-off + launch site). */
  PAD_X: 0,
  PAD_Y: 0,
  PAD_HALF_W: 1.6,
  /** Landing classification (§C10.1): pickup needs ≤ 1.2 m/s vertical,
   *  soft-landing bonus at ≤ 0.5 m/s. */
  LAND_MAX_VY: 1.2,
  SOFT_MAX_VY: 0.5,
  /** Score formula (§C10.1): 30·rescued + fuel/2 + 5/soft landing. Anti-farm
   *  ruling (V3/G42): only landings that DO rescue work (bunny pickup or pad
   *  delivery) are bonus-eligible — hop-farming empty surfaces pays nothing
   *  (caps the bonus at 10 landings/round == 2 per rescue leg). */
  RESCUE_POINTS: 30,
  SOFT_LANDING_BONUS: 5,
  FUEL_SCORE_DIVISOR: 2,
  /** After liftoff the departed surface can't re-catch the craft until it
   *  clears this height above it (or leaves it laterally) — a gravity sag in
   *  the first airborne frames is not a "landing". */
  DEPART_CLEAR_M: 0.4,
  /** Hard landing (§C10.1): bounce + −10 fuel, never death. */
  HARD_FUEL_PENALTY: 10,
  BOUNCE_RESTITUTION: 0.45,
  /** Wind gusts (§C10.1: telegraphed, level 3+). */
  WIND_FROM_RESCUES: 2,
  WIND_TELEGRAPH_SEC: 1.0,
  WIND_GUST_SEC: 1.6,
  WIND_ACCEL: 1.7,
  WIND_EVERY_MIN_SEC: 6,
  WIND_EVERY_MAX_SEC: 10,
  /** Auto-tow speed back to the pad after a fuel-out (m/s). */
  TOW_SPEED: 3.4,
  /** Physics integration clamp (SwiftShader frames can spike). */
  MAX_DT: 1 / 20,
  /** Bot (PD controller — §C10.1 autoplay strategy). */
  BOT_CRUISE_CLEARANCE_M: 1.2,
  BOT_ALIGN_X_M: 0.45,
  BOT_ALIGN_VX: 0.8,
  BOT_MAX_VX: 2.7,
  BOT_VX_GAIN: 1.6,
  /** Effective lateral authority (m/s², thrust duty × sin(tilt) × accel) —
   *  the sqrt braking profile below keeps approaches capturable. */
  BOT_LAT_ACCEL_EFF: 1.0,
  BOT_DESCEND_VX: 0.7,
  BOT_TILT_DEADBAND: 0.22,
  BOT_VY_GAIN: 0.85,
  BOT_MAX_RISE: 2.6,
  /** Descend below LAND_MAX_VY so clipping an intermediate platform parks
   *  ('ok' landing → liftoff → pass through) instead of hard-bounce-looping. */
  BOT_MAX_DESCEND: 1.1,
  BOT_SOFT_DESCEND: 0.42,
  BOT_FLARE_BELOW_M: 1.2,
  /** Refuel mode hysteresis: latch below ENTER, release at EXIT (a single
   *  threshold thrashes — detour burn ≈ canister gain). */
  BOT_REFUEL_ENTER: 45,
  BOT_REFUEL_EXIT: 75,
  BOT_REFUEL_RANGE_M: 12,
  /** Never abort a final descent for fuel (the abort-descend-abort loop). */
  BOT_REFUEL_SKIP_BELOW_M: 2.5,
});

/**
 * @typedef {Object} RocketLayout
 * @property {Array<{x: number, y: number, halfW: number, bunny: boolean}>} platforms
 * @property {Array<{x: number, y: number, taken: boolean, respawnT: number}>} fuelPickups
 * @property {{x: number, y: number, halfW: number}} pad
 */

/**
 * Seeded round layout (§C10.1: 5 platforms + mid-air fuel pickups). Platforms
 * spread across the field with pairwise separation; low platforms keep clear
 * of the station pad column. Deterministic for a given rng.
 * @param {() => number} rng 0..1
 * @param {object} [tune] ROCKET override (tests)
 * @returns {RocketLayout}
 */
export function createLayout(rng, tune = ROCKET) {
  const pad = { x: tune.PAD_X, y: tune.PAD_Y, halfW: tune.PAD_HALF_W };
  const bands = [2.4, 3.9, 5.4, 6.9, 8.3];
  // Fisher–Yates over the height bands so every round mixes the ladder.
  for (let i = bands.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [bands[i], bands[j]] = [bands[j], bands[i]];
  }
  /** @type {RocketLayout['platforms']} */
  const platforms = [];
  for (let i = 0; i < tune.PLATFORM_COUNT; i += 1) {
    const y = bands[i % bands.length] + (rng() - 0.5) * 0.6;
    let x = 0;
    let ok = false;
    for (let attempt = 0; attempt < 24 && !ok; attempt += 1) {
      x = (rng() * 2 - 1) * (tune.WORLD_HALF_W - 1.4);
      ok =
        (Math.abs(x) >= pad.halfW + 1.0 || y >= 4.5) &&
        platforms.every((p) => Math.abs(p.x - x) >= 2.3 || Math.abs(p.y - y) >= 1.5);
    }
    if (!ok) x = (i % 2 === 0 ? 1 : -1) * (2.4 + i * 1.1); // deterministic fallback spread
    platforms.push({ x, y, halfW: tune.PLATFORM_HALF_W, bunny: true });
  }
  /** @type {RocketLayout['fuelPickups']} */
  const fuelPickups = [];
  for (let i = 0; i < tune.FUEL_PICKUP_COUNT; i += 1) {
    let x = 0;
    let y = 0;
    let ok = false;
    for (let attempt = 0; attempt < 24 && !ok; attempt += 1) {
      x = (rng() * 2 - 1) * (tune.WORLD_HALF_W - 1.1);
      y = 1.6 + rng() * (tune.CEILING_Y - 2.6);
      ok = platforms.every((p) => Math.abs(p.x - x) > 1.4 || Math.abs(p.y - y) > 1.2);
    }
    fuelPickups.push({ x, y, taken: false, respawnT: 0 });
  }
  return { platforms, fuelPickups, pad };
}

/**
 * Landing classification (§C10.1 binding thresholds).
 * @param {number} vyAbs |vertical speed| at touchdown (m/s)
 * @param {object} [tune]
 * @returns {'soft'|'ok'|'hard'}
 */
export function classifyLanding(vyAbs, tune = ROCKET) {
  if (vyAbs <= tune.SOFT_MAX_VY) return 'soft';
  if (vyAbs <= tune.LAND_MAX_VY) return 'ok';
  return 'hard';
}

/**
 * Round score (§C10.1): 30·rescued + fuelRemaining/2 + 5 per soft landing.
 * @param {number} rescued bunnies delivered to the pad
 * @param {number} fuelRemaining 0..100
 * @param {number} softLandings count of ≤ 0.5 m/s touchdowns
 * @param {object} [tune]
 * @returns {number}
 */
export function roundScore(rescued, fuelRemaining, softLandings, tune = ROCKET) {
  return Math.max(0, Math.floor(
    tune.RESCUE_POINTS * rescued +
    Math.max(0, fuelRemaining) / tune.FUEL_SCORE_DIVISOR +
    tune.SOFT_LANDING_BONUS * softLandings
  ));
}

/**
 * Screen-thirds tilt command (§C10.1 controls): left third → tilt left,
 * right third → tilt right, middle third (or no touch) → level out.
 * @param {number|null} nx normalized pointer x −1..1 (null = not touching)
 * @returns {-1|0|1} tilt direction command
 */
export function tiltCommandFor(nx) {
  if (nx == null) return 0;
  if (nx < -1 / 3) return -1;
  if (nx > 1 / 3) return 1;
  return 0;
}

/**
 * @typedef {Object} RocketState
 * @property {number} x @property {number} y craft position (m)
 * @property {number} vx @property {number} vy craft velocity (m/s)
 * @property {number} tilt current tilt (rad, + = right)
 * @property {number} fuel 0..100
 * @property {boolean} carrying a bunny is aboard
 * @property {number} rescued bunnies delivered
 * @property {number} softLandings @property {number} hardLandings
 * @property {'pad'|number|null} landedOn pad, platform index, or airborne
 * @property {boolean} towing auto-tow in progress (fuel-out)
 * @property {boolean} ended @property {string|null} endReason
 * @property {number} elapsed round seconds
 * @property {{phase: 'idle'|'telegraph'|'gust', dir: number, t: number, nextAt: number}} wind
 */

/**
 * Create the deterministic lander engine. step() integrates one frame and
 * returns semantic events for the visual layer / tests:
 *   liftoff · landing {where, vy, kind} · bunnyPickup {platform} ·
 *   rescue {count} · hardLanding {vy} · fuelPickup {index} ·
 *   fuelLow · outOfFuel · towed · windTelegraph {dir} · windGust {dir} ·
 *   ended {reason}
 * @param {() => number} rng seeded 0..1 (layout + wind schedule)
 * @param {object} [tune]
 * @returns {{state: RocketState, layout: RocketLayout,
 *   step: (input: {thrust: boolean, tiltDir: number}, dt: number) => Array<object>}}
 */
export function createEngine(rng, tune = ROCKET) {
  const layout = createLayout(rng, tune);
  /** @type {RocketState} */
  const state = {
    x: layout.pad.x,
    y: layout.pad.y,
    vx: 0,
    vy: 0,
    tilt: 0,
    fuel: tune.FUEL_MAX,
    carrying: false,
    rescued: 0,
    softLandings: 0,
    hardLandings: 0,
    landedOn: 'pad',
    departedFrom: null,
    lastLandedOn: 'pad',
    towing: false,
    ended: false,
    endReason: null,
    elapsed: 0,
    fuelLowFired: false,
    wind: {
      phase: 'idle',
      dir: 1,
      t: 0,
      nextAt: tune.WIND_EVERY_MIN_SEC + rng() * (tune.WIND_EVERY_MAX_SEC - tune.WIND_EVERY_MIN_SEC),
    },
  };

  /** Surfaces the craft can land on: the pad + every platform. */
  function surfaces() {
    const list = [{ id: 'pad', x: layout.pad.x, y: layout.pad.y, halfW: layout.pad.halfW }];
    for (let i = 0; i < layout.platforms.length; i += 1) {
      const p = layout.platforms[i];
      list.push({ id: i, x: p.x, y: p.y, halfW: p.halfW });
    }
    return list;
  }

  function endRun(reason, events) {
    if (state.ended) return;
    state.ended = true;
    state.endReason = reason;
    events.push({ type: 'ended', reason });
  }

  /**
   * @param {{thrust: boolean, tiltDir: number}} input
   * @param {number} dt seconds
   * @returns {Array<object>} events this frame
   */
  function step(input, dt) {
    /** @type {Array<object>} */
    const events = [];
    if (state.ended) return events;
    dt = Math.min(tune.MAX_DT, Math.max(0, dt));
    state.elapsed += dt;
    if (state.elapsed >= tune.DURATION_SEC) {
      endRun('time', events);
      return events;
    }

    // fuel pickup respawn timers (cozy refuel loop)
    for (const f of layout.fuelPickups) {
      if (f.taken) {
        f.respawnT -= dt;
        if (f.respawnT <= 0) f.taken = false;
      }
    }

    // ---- auto-tow (fuel-out): drift back to the pad, then the run ends ----
    if (state.towing) {
      const dx = layout.pad.x - state.x;
      const dy = layout.pad.y - state.y;
      const dist = Math.hypot(dx, dy);
      const stepM = tune.TOW_SPEED * dt;
      if (dist <= stepM || dist < 0.05) {
        state.x = layout.pad.x;
        state.y = layout.pad.y;
        events.push({ type: 'towed' });
        endRun('fuel', events);
      } else {
        state.x += (dx / dist) * stepM;
        state.y += (dy / dist) * stepM;
      }
      return events;
    }

    // ---- tilt slew toward the commanded thirds direction ----
    const tiltTarget = Math.max(-1, Math.min(1, input.tiltDir || 0)) * tune.TILT_MAX_RAD;
    const dTilt = tiltTarget - state.tilt;
    const maxSlew = tune.TILT_RATE * dt;
    state.tilt += Math.abs(dTilt) <= maxSlew ? dTilt : Math.sign(dTilt) * maxSlew;

    const landed = state.landedOn !== null;
    const thrusting = !!input.thrust && state.fuel > 0;

    if (landed && !thrusting) {
      // parked on a surface — nothing to integrate
      state.vx = 0;
      state.vy = 0;
    } else {
      if (landed && thrusting) {
        state.departedFrom = state.landedOn; // guard vs same-frame re-landing
        state.landedOn = null;
        events.push({ type: 'liftoff' });
      }
      // thrust along the craft's up axis (tilt + = right lean → push right)
      let ax = 0;
      let ay = -tune.GRAVITY;
      if (thrusting) {
        ax += Math.sin(state.tilt) * tune.THRUST_ACCEL;
        ay += Math.cos(state.tilt) * tune.THRUST_ACCEL;
        state.fuel = Math.max(0, state.fuel - tune.FUEL_BURN_PER_SEC * dt);
      }
      // wind gust (§C10.1: level 3+ only, telegraphed below)
      if (state.wind.phase === 'gust') ax += state.wind.dir * tune.WIND_ACCEL;

      state.vx += ax * dt;
      state.vy += ay * dt;
      const prevY = state.y;
      state.x += state.vx * dt;
      state.y += state.vy * dt;

      // soft walls + ceiling
      const wallX = tune.WORLD_HALF_W - 0.4;
      if (state.x < -wallX) {
        state.x = -wallX;
        state.vx = Math.abs(state.vx) * tune.WALL_RESTITUTION;
      } else if (state.x > wallX) {
        state.x = wallX;
        state.vx = -Math.abs(state.vx) * tune.WALL_RESTITUTION;
      }
      if (state.y > tune.CEILING_Y) {
        state.y = tune.CEILING_Y;
        state.vy = Math.min(0, state.vy);
      }

      // ---- fuel pickups (mid-air only) ----
      for (let i = 0; i < layout.fuelPickups.length; i += 1) {
        const f = layout.fuelPickups[i];
        if (f.taken) continue;
        if (Math.hypot(f.x - state.x, f.y - state.y) <= tune.FUEL_PICKUP_RADIUS) {
          f.taken = true;
          f.respawnT = tune.FUEL_RESPAWN_SEC;
          state.fuel = Math.min(tune.FUEL_MAX, state.fuel + tune.FUEL_PICKUP_AMOUNT);
          state.fuelLowFired = false;
          events.push({ type: 'fuelPickup', index: i });
        }
      }

      // departed-surface guard: the surface just lifted off from can only
      // re-catch the craft after it climbs DEPART_CLEAR_M above it (or slides
      // off laterally) — a gravity sag in the first airborne frames must not
      // read as a fresh landing.
      if (state.departedFrom != null) {
        const s = state.departedFrom === 'pad'
          ? layout.pad
          : layout.platforms[state.departedFrom];
        if (state.y >= s.y + tune.DEPART_CLEAR_M || Math.abs(state.x - s.x) > s.halfW) {
          state.departedFrom = null;
        }
      }

      // ---- landing: crossing a surface top from above with overlap ----
      if (state.vy <= 0) {
        for (const s of surfaces()) {
          if (s.id === state.departedFrom) continue;
          if (prevY >= s.y && state.y <= s.y && Math.abs(state.x - s.x) <= s.halfW) {
            const vyAbs = Math.abs(state.vy);
            const kind = classifyLanding(vyAbs, tune);
            if (kind === 'hard') {
              // §C10.1: bounce + −10 fuel, never death
              state.y = s.y + 0.02;
              state.vy = vyAbs * tune.BOUNCE_RESTITUTION;
              state.vx *= 0.6;
              state.hardLandings += 1;
              state.fuel = Math.max(0, state.fuel - tune.HARD_FUEL_PENALTY);
              events.push({ type: 'hardLanding', vy: vyAbs, where: s.id });
            } else {
              state.y = s.y;
              state.vx = 0;
              state.vy = 0;
              state.landedOn = s.id;
              state.departedFrom = null;
              let rescueWork = false;
              if (typeof s.id === 'number' && layout.platforms[s.id].bunny && !state.carrying) {
                layout.platforms[s.id].bunny = false;
                state.carrying = true;
                rescueWork = true;
              } else if (s.id === 'pad' && state.carrying) {
                state.carrying = false;
                state.rescued += 1;
                rescueWork = true;
              }
              // anti-farm ruling (see SOFT_LANDING_BONUS): a soft landing is
              // bonus-eligible when it lands somewhere NEW or does rescue work
              // — micro-hopping the same surface pays nothing.
              const eligible = rescueWork || s.id !== state.lastLandedOn;
              state.lastLandedOn = s.id;
              if (kind === 'soft' && eligible) state.softLandings += 1;
              events.push({ type: 'landing', where: s.id, vy: vyAbs, kind, bonusEligible: kind === 'soft' && eligible });
              if (rescueWork && state.carrying) {
                events.push({ type: 'bunnyPickup', platform: s.id });
              } else if (rescueWork) {
                events.push({ type: 'rescue', count: state.rescued });
                if (state.rescued >= tune.PLATFORM_COUNT) endRun('complete', events);
              }
            }
            break;
          }
        }
      }
    }

    // ---- wind scheduler (§C10.1: level 3+, telegraph → gust) ----
    const wind = state.wind;
    if (state.rescued >= tune.WIND_FROM_RESCUES && !state.ended) {
      if (wind.phase === 'idle' && state.elapsed >= wind.nextAt && state.landedOn === null) {
        wind.phase = 'telegraph';
        wind.dir = rng() < 0.5 ? -1 : 1;
        wind.t = 0;
        events.push({ type: 'windTelegraph', dir: wind.dir });
      } else if (wind.phase === 'telegraph') {
        wind.t += dt;
        if (wind.t >= tune.WIND_TELEGRAPH_SEC) {
          wind.phase = 'gust';
          wind.t = 0;
          events.push({ type: 'windGust', dir: wind.dir });
        }
      } else if (wind.phase === 'gust') {
        wind.t += dt;
        if (wind.t >= tune.WIND_GUST_SEC) {
          wind.phase = 'idle';
          wind.nextAt = state.elapsed + tune.WIND_EVERY_MIN_SEC +
            rng() * (tune.WIND_EVERY_MAX_SEC - tune.WIND_EVERY_MIN_SEC);
        }
      }
    }

    // ---- fuel-out → auto-tow (never death, §C10.1) ----
    if (state.fuel <= 0 && !state.towing && !state.ended) {
      if (state.landedOn === 'pad') {
        endRun('fuel', events);
      } else {
        state.towing = true;
        state.landedOn = null;
        events.push({ type: 'outOfFuel' });
      }
    } else if (!state.fuelLowFired && state.fuel > 0 && state.fuel <= 20) {
      state.fuelLowFired = true;
      events.push({ type: 'fuelLow' });
    }

    return events;
  }

  return { state, layout, step };
}

/**
 * PD-controller autoplay bot (§C10.1: "PD controller on altitude/velocity per
 * platform"). Picks the next bunny platform (nearest first) or the pad when
 * carrying, detours to a fuel canister when the tank runs low, cruises with
 * clearance above the target, then descends inside the approach band with a
 * soft-landing velocity setpoint. Horizontal: P on position → velocity
 * setpoint → tilt command; vertical: bang-bang thrust on the vy setpoint.
 * @param {object} [tune]
 * @returns {{control: (state: RocketState, layout: RocketLayout) => {thrust: boolean, tiltDir: number}}}
 */
export function createBot(tune = ROCKET) {
  let refueling = false; // hysteresis latch (BOT_REFUEL_ENTER/_EXIT)
  return {
    control(state, layout) {
      if (state.ended || state.towing) return { thrust: false, tiltDir: 0 };

      // --- parked: lift off whenever there is somewhere left to go ---
      // (a bunny pickup happens ON landing, so "parked on a platform" always
      // means either cargo aboard → fly to the pad, or an empty re-landing)
      if (state.landedOn !== null) {
        const bunniesLeft = layout.platforms.some((p) => p.bunny);
        const shouldGo = state.carrying ? state.landedOn !== 'pad' : bunniesLeft;
        return { thrust: shouldGo && state.fuel > 0, tiltDir: 0 };
      }

      // --- target selection ---
      let tx = layout.pad.x;
      let ty = layout.pad.y;
      if (!state.carrying) {
        let best = null;
        let bestD = Infinity;
        for (const p of layout.platforms) {
          if (!p.bunny) continue;
          const d = Math.abs(p.x - state.x) + Math.abs(p.y - state.y) * 0.6;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        if (best) {
          tx = best.x;
          ty = best.y;
        }
      }
      // refuel detour when the tank runs low — latched (hysteresis) so the
      // bot commits to refueling instead of thrashing, but NEVER while
      // capturing the target (aborting a final descent loops forever)
      let isCanister = false;
      const dxT = tx - state.x;
      const finalDescent =
        Math.abs(dxT) <= tune.BOT_ALIGN_X_M * 2 && state.y - ty < tune.BOT_REFUEL_SKIP_BELOW_M;
      if (!refueling && state.fuel < tune.BOT_REFUEL_ENTER) refueling = true;
      else if (refueling && state.fuel >= tune.BOT_REFUEL_EXIT) refueling = false;
      if (refueling && !finalDescent) {
        let best = null;
        let bestD = Infinity;
        for (const f of layout.fuelPickups) {
          if (f.taken) continue;
          const d = Math.hypot(f.x - state.x, f.y - state.y);
          if (d < bestD) {
            bestD = d;
            best = f;
          }
        }
        if (best && bestD < tune.BOT_REFUEL_RANGE_M) {
          tx = best.x;
          ty = best.y;
          isCanister = true; // fly AT it (no landing clearance / flare)
        }
      }

      const dx = tx - state.x;
      const heightAbove = state.y - ty;
      const aligned = !isCanister &&
        Math.abs(dx) <= tune.BOT_ALIGN_X_M && Math.abs(state.vx) <= tune.BOT_ALIGN_VX;

      let vyDes;
      let vxDes;
      if (!aligned || heightAbove < -0.1) {
        // ALIGN phase: brake/steer at a cruise band above the target (or
        // straight at a canister) — only descend once position AND lateral
        // speed are captured. The vx setpoint follows a sqrt braking profile
        // (√(2·a·d)) so approaches decelerate instead of limit-cycling.
        const yDes = isCanister ? ty : Math.max(ty + tune.BOT_CRUISE_CLEARANCE_M, state.y - 1.4);
        vyDes = Math.max(-1.1, Math.min(tune.BOT_MAX_RISE, (yDes - state.y) * tune.BOT_VY_GAIN));
        const brake = Math.sqrt(2 * tune.BOT_LAT_ACCEL_EFF * Math.abs(dx)) * 0.85;
        vxDes = Math.sign(dx) * Math.min(tune.BOT_MAX_VX, brake, Math.abs(dx) * tune.BOT_VX_GAIN + 0.15);
      } else {
        // DESCEND phase: velocity setpoint shrinks with height, flaring to the
        // soft-landing band (§C10.1 ≤ 0.5 m/s) for the touchdown.
        const drop = Math.min(tune.BOT_MAX_DESCEND, 0.45 * heightAbove + 0.25);
        vyDes = heightAbove < tune.BOT_FLARE_BELOW_M ? -tune.BOT_SOFT_DESCEND : -drop;
        vxDes = Math.max(-tune.BOT_DESCEND_VX, Math.min(tune.BOT_DESCEND_VX, dx * 2.0));
      }

      // vertical: bang-bang thrust on the vy setpoint · horizontal: vx
      // setpoint → tilt bang-bang. Lateral authority ONLY exists while
      // thrusting, so a big vx error force-fires the thruster too (anti-drift
      // — a coasting craft cannot steer).
      const dvx = vxDes - state.vx;
      const thrust = state.vy < vyDes || (Math.abs(dvx) > 1.2 && state.vy < tune.BOT_MAX_RISE);
      const tiltDir = dvx > tune.BOT_TILT_DEADBAND ? 1 : dvx < -tune.BOT_TILT_DEADBAND ? -1 : 0;
      return { thrust, tiltDir };
    },
  };
}

/**
 * Headless full-round simulation (tests + tuning): engine + PD bot at a fixed
 * dt until the round ends.
 * @param {number} seed
 * @param {object} [tune]
 * @param {number} [dt]
 * @returns {{score: number, rescued: number, softLandings: number,
 *   hardLandings: number, fuelLeft: number, elapsed: number, endReason: string}}
 */
export function simulateRound(seed, tune = ROCKET, dt = 1 / 60) {
  const rng = mulberry32(seed);
  const engine = createEngine(rng, tune);
  const bot = createBot(tune);
  let guard = Math.ceil((tune.DURATION_SEC + 30) / dt);
  while (!engine.state.ended && guard > 0) {
    engine.step(bot.control(engine.state, engine.layout), dt);
    guard -= 1;
  }
  const s = engine.state;
  return {
    score: roundScore(s.rescued, s.fuel, s.softLandings, tune),
    rescued: s.rescued,
    softLandings: s.softLandings,
    hardLandings: s.hardLandings,
    fuelLeft: s.fuel,
    elapsed: s.elapsed,
    endReason: s.endReason,
  };
}

/**
 * Deterministic RNG (mulberry32 — same recipe as framework.createRng, local
 * copy keeps this module pure/standalone for node:test).
 * @param {number} seed
 * @returns {() => number} 0..1
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
