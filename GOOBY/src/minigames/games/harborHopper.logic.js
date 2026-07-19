// Harbor Hopper — pure gameplay logic (PLAN3 §C10.1 #4, agent V3/G42). No
// three.js / DOM imports so test/gamesV3b.test.js runs headlessly (§B rule).
// The visual module (harborHopper.js) maps this state onto meshes; ALL tuning
// numbers not covered by §E0.1-3 (COIN_TABLE.harborHopper = 5/4/30 lives in
// data/constants.js) are centralized in HARBOR below — never inline them.
//
// Binding §C10.1 #4 rules implemented here:
//   · watercraft-kit fishing boat down a harbor channel: auto-forward 6 m/s,
//     drag to steer, momentum-heavy lateral feel
//   · floating crates +4, net rings +2
//   · buoys/piers bump = −3 + slow, with forgiving 70 % hitboxes
//   · rhythmic wave bands roll down the channel — riding a crest at its
//     (foamy) center = surf-boost +30 % for 2 s, chainable
//   · seagull steals the top crate after > 4 s one-lane idling — honk
//     warning first (changing lanes shoos it off)
//   · powerup Fischkutter-Horn: clears buoys in a 6 m cone ahead, 2 charges
//   · 120 s round · score ≈ 100 · meta `cratesShipped`
//   · autoplay bot: spline-follows a greedy crate path, centers wave crests

/** Harbor Hopper tuning (§C10.1 #4 binding numbers + V3/G42 feel knobs). */
export const HARBOR = Object.freeze({
  /** Round length (§C10.1: 120 s). */
  DURATION_SEC: 120,
  /** Auto-forward speed (§C10.1: 6 m/s). */
  BASE_SPEED: 6,
  /** Channel half-width (m) — piers eat into it from the sides. */
  CHANNEL_HALF_W: 3.2,
  /** Seagull lanes: the channel divides into 3 idle-detection lanes. */
  LANES: 3,
  /** Momentum-heavy steering: lateral accel toward the drag target, linear
   *  damping, lateral speed cap (m/s). */
  STEER_ACCEL: 6.5,
  STEER_DAMPING: 2.6,
  MAX_LATERAL_SPEED: 3.4,
  /** Pickups (§C10.1: crates +4, net rings +2) + collect radii (m). */
  CRATE_POINTS: 4,
  RING_POINTS: 2,
  CRATE_RADIUS: 0.8,
  RING_RADIUS: 0.85,
  /** Obstacles (§C10.1: bump = −3 + slow; 70 % hitboxes). */
  BUMP_PENALTY: -3,
  HITBOX_SCALE: 0.7,
  BUOY_RADIUS: 0.75,
  BOAT_RADIUS: 0.6,
  /** Pier fingers: lateral reach from the channel wall + z depth (m). */
  PIER_REACH_M: 2.1,
  PIER_DEPTH_M: 1.1,
  /** Bump effect: slow to 55 % for 1.4 s, 1 s of i-frames, lateral shove. */
  SLOW_FACTOR: 0.55,
  SLOW_SEC: 1.4,
  BUMP_IFRAMES_SEC: 1.0,
  BUMP_SHOVE: 2.2,
  /** Spawn tables (seeded): a row every 11–15 m; type odds (rest = empty). */
  ROW_GAP_M: Object.freeze({ min: 11, max: 15 }),
  CRATE_CHANCE: 0.44,
  RING_CHANCE: 0.2,
  BUOY_CHANCE: 0.26,
  /** A pier finger every 70–110 m (alternating sides, seeded jitter). */
  PIER_EVERY_M: Object.freeze({ min: 70, max: 110 }),
  /** Items generate this far ahead of the boat. */
  LOOKAHEAD_M: 60,
  /** Wave bands (§C10.1): rhythmic, roll toward the boat; riding the foamy
   *  sweet-spot section of a crest = +30 % for 2 s, chainable. */
  WAVE_EVERY_SEC: 6,
  WAVE_SPEED: 2.5,
  WAVE_SPAWN_AHEAD_M: 34,
  SWEET_HALF_W: 1.05,
  BOOST_FACTOR: 1.3,
  BOOST_SEC: 2,
  /** Seagull (§C10.1: idle > 4 s in one lane → honk warning → steals the
   *  top crate; only threatens while ≥ 1 crate is aboard). */
  GULL_IDLE_SEC: 4,
  GULL_WARN_SEC: 1.5,
  /** Fischkutter-Horn (§C10.1): clears buoys in a 6 m cone ahead, 2 charges.
   *  Cone half-width = CONE_BASE + z·CONE_SPREAD. */
  HORN_CHARGES: 2,
  HORN_CONE_M: 6,
  HORN_CONE_BASE: 0.9,
  HORN_CONE_SPREAD: 0.45,
  /** Physics integration clamp (SwiftShader frames can spike). */
  MAX_DT: 1 / 20,
  /** Bot (§C10.1: greedy crate path + crest centering). */
  BOT_SCAN_M: 16,
  BOT_DODGE_M: 6.5,
  BOT_WAVE_M: 12,
  BOT_HORN_M: 4.5,
  BOT_CRATE_VALUE: 4,
  BOT_RING_VALUE: 2,
  BOT_REACH_X_PER_M: 0.5,
  /** Bot shoos the seagull: hop a lane once idle this long (< GULL_IDLE_SEC
   *  + GULL_WARN_SEC, so the warning honk fires but the steal does not). */
  BOT_GULL_DODGE_AT_SEC: 4.6,
  // ── V4/G74 §G5.3/§G5.4/§C-SYS4.3 derived-mode defaults (Mittel identity) ──
  ENDLESS: false,
  /** §G5.4 Endlos end-condition: 3 bumps (buoy/pier hits). */
  ENDLESS_BUMP_LIMIT: 3,
  /** §G5.4 Endlos ramp: base speed climbs per meter, capped so the §C8.7-
   *  style row-reachability guarantee below survives (rowReachability ≥ 1
   *  even mid-boost — test-pinned). */
  ENDLESS_ACCEL_PER_M: 0.004,
  ENDLESS_MAX_SPEED: 9.6,
  /** Row-reachability validator params (runner-family guardrail §G5.3):
   *  a buoy dodge must fit between consecutive rows at WORST-case speed —
   *  react + steer across the forgiving hitbox + margin. */
  VALIDATOR_REACT_SEC: 0.35,
  VALIDATOR_DODGE_MARGIN_M: 0.35,
  /** Modifier passthroughs (§C-SYS4.3; all 1 = no modifier). */
  PICKUP_RATE: 1,
  SCORE_MULT: 1,
  PICKUP_RADIUS_MULT: 1,
  RENDER_SCALE_MULT: 1,
  /** Certification-bot human model (§G5.4 gates; exempt from §G5.3
   *  guardrails): focus cooldown after each pickup (pickup-rate cap) +
   *  mean seconds between short no-steer lapses. These are the MITTEL
   *  human-rate values — simulateHarborAutoplay only; the §C10.1 in-game
   *  ?autoplay=1 bot and the legacy simulateRound ignore both. */
  BOT_FOCUS_SEC: 1.9,
  BOT_LAPSE_EVERY_SEC: 14,
});

/**
 * V4/G74 §G5.3 runner/steer rows: Leicht = speed ×0.85 + obstacle density
 * ×0.85 · Schwer = speed ×1.2 + density ×1.15 (crash allowance unchanged —
 * the timed round has no crash-out). Density scales the BUOY row chance and
 * the pier cadence only (pickups stay — the §C10.1 score chances remain).
 * Endlos (§G5.4): Schwer channel, no round timer, speed ramps on to
 * ENDLESS_MAX_SPEED and 3 bumps end the run.
 */
export const HARBOR_DIFFICULTY = Object.freeze({
  // Leicht gets +20 % round time: the §C10.1 score chances scale with
  // channel METERS, so the slower easy boat covers the same distance a
  // Mittel round does (otherwise "easier" would mathematically pay less).
  easy: Object.freeze({ speed: 0.85, density: 0.85, duration: 1.2, botFocus: 1.5, botLapse: 34, endless: false }),
  normal: Object.freeze({ speed: 1, density: 1, duration: 1, botFocus: 1.9, botLapse: 14, endless: false }),
  hard: Object.freeze({ speed: 1.2, density: 1.15, duration: 1, botFocus: 1.9, botLapse: 12.5, endless: false }),
  endless: Object.freeze({ speed: 1.2, density: 1.15, duration: 1, botFocus: 1.9, botLapse: 12.5, endless: true }),
});

/**
 * Derive the frozen per-mode tune (§G5.3). Mittel returns the frozen live
 * HARBOR table itself — bit-identical numbers AND rng streams (§G5.2/§E5).
 * @param {object} [tune] @param {string} [mode] @returns {object}
 */
export function applyDifficulty(tune = HARBOR, mode = 'normal') {
  const id = Object.hasOwn(HARBOR_DIFFICULTY, mode) ? mode : 'normal';
  if (id === 'normal') return tune;
  const row = HARBOR_DIFFICULTY[id];
  return Object.freeze({
    ...tune,
    BASE_SPEED: tune.BASE_SPEED * row.speed,
    DURATION_SEC: tune.DURATION_SEC * row.duration,
    BUOY_CHANCE: tune.BUOY_CHANCE * row.density,
    PIER_EVERY_M: Object.freeze({
      min: tune.PIER_EVERY_M.min / row.density,
      max: tune.PIER_EVERY_M.max / row.density,
    }),
    BOT_FOCUS_SEC: row.botFocus,
    BOT_LAPSE_EVERY_SEC: row.botLapse,
    ENDLESS: row.endless,
    MODE: id,
  });
}

/**
 * Apply harborHopper's eligible gameplay modifiers (§C-SYS4.3: muenzregen /
 * turbo / riesenGooby). Plain-number payload from ctx.params.modifier
 * (§E0.1-3) — the logic never reads modifier STATE.
 * @param {object} tune @param {{type: string}|null|undefined} modifier
 * @returns {object}
 */
export function applyModifier(tune, modifier) {
  if (!modifier) return tune;
  if (modifier.type === 'muenzregen') {
    // +50 % pickup rows: extra seeded crate/ring rows interleave the base
    // table (the base rng stream stays untouched — see generateAhead).
    return Object.freeze({
      ...tune,
      PICKUP_RATE: Math.max(0.1, Number(modifier.coinRate) || 1),
    });
  }
  if (modifier.type === 'turbo') {
    const speedMult = Math.max(0.1, Number(modifier.speedMult) || 1);
    return Object.freeze({
      ...tune,
      BASE_SPEED: tune.BASE_SPEED * speedMult,
      SCORE_MULT: Math.max(0, Number(modifier.scoreMult) || 1),
    });
  }
  if (modifier.type === 'riesenGooby') {
    const hitboxMult = Math.max(0.1, Number(modifier.hitboxMult) || 1);
    return Object.freeze({
      ...tune,
      CRATE_RADIUS: tune.CRATE_RADIUS * hitboxMult,
      RING_RADIUS: tune.RING_RADIUS * hitboxMult,
      PICKUP_RADIUS_MULT: hitboxMult,
      RENDER_SCALE_MULT: Math.max(0.1, Number(modifier.scale) || 1),
    });
  }
  return tune;
}

/**
 * V4/G74 runner-family §G5.3 guardrail — the harbor's row-reachability
 * validator: between two consecutive spawn rows at WORST-case speed
 * (ramp cap × surf boost) the boat must fit a react + full buoy dodge.
 * ≥ 1 = always avoidable (test-pinned for every derived mode incl. turbo).
 * @param {object} [tune] @returns {number} safety ratio
 */
export function rowReachability(tune = HARBOR) {
  const maxBase = tune.ENDLESS ? Math.max(tune.BASE_SPEED, tune.ENDLESS_MAX_SPEED) : tune.BASE_SPEED;
  const worstSpeed = maxBase * tune.BOOST_FACTOR;
  const rowSec = tune.ROW_GAP_M.min / worstSpeed;
  const dodgeM = (tune.BUOY_RADIUS + tune.BOAT_RADIUS) * tune.HITBOX_SCALE + tune.VALIDATOR_DODGE_MARGIN_M;
  const needSec = tune.VALIDATOR_REACT_SEC + dodgeM / tune.MAX_LATERAL_SPEED;
  return rowSec / needSec;
}

/**
 * Final displayed/awarded score (§C-SYS4.2 turbo ×1.5 at the single seam;
 * ×1 everywhere else — bit-identical ints).
 * @param {{score: number}} state @param {object} [tune] @returns {number}
 */
export function hopperScore(state, tune = HARBOR) {
  return Math.round(state.score * tune.SCORE_MULT);
}

/**
 * Idle-detection lane of a lateral position (0 · 1 · 2 across the channel).
 * @param {number} x boat x (m, − = port)
 * @param {object} [tune]
 * @returns {number}
 */
export function laneOf(x, tune = HARBOR) {
  const w = (tune.CHANNEL_HALF_W * 2) / tune.LANES;
  return Math.max(0, Math.min(tune.LANES - 1, Math.floor((x + tune.CHANNEL_HALF_W) / w)));
}

/**
 * Current forward speed: base × boost × slow (both timed multipliers).
 * @param {{boostT: number, slowT: number}} state
 * @param {object} [tune]
 * @returns {number} m/s
 */
export function speedOf(state, tune = HARBOR) {
  let v = tune.BASE_SPEED;
  // V4/G74 §G5.4 Endlos ramp: base speed climbs with distance, capped so
  // rowReachability stays ≥ 1 (never-impossible dodges, §G5.3 guardrail).
  if (tune.ENDLESS) {
    v = Math.min(tune.ENDLESS_MAX_SPEED, v + (state.z ?? 0) * tune.ENDLESS_ACCEL_PER_M);
  }
  if (state.boostT > 0) v *= tune.BOOST_FACTOR;
  if (state.slowT > 0) v *= tune.SLOW_FACTOR;
  return v;
}

/**
 * Circle-vs-circle pickup/bump test with the §C10.1 70 % obstacle scale.
 * @param {{x: number, z: number}} boat
 * @param {{x: number, z: number}} item
 * @param {number} radius combined base radius
 * @param {boolean} forgiving apply HITBOX_SCALE (obstacles only)
 * @param {object} [tune]
 * @returns {boolean}
 */
export function hits(boat, item, radius, forgiving, tune = HARBOR) {
  const r = forgiving ? radius * tune.HITBOX_SCALE : radius;
  const dx = item.x - boat.x;
  const dz = item.z - boat.z;
  return dx * dx + dz * dz <= r * r;
}

/**
 * Pier collision test: a finger reaching PIER_REACH_M from `side` at depth
 * PIER_DEPTH_M around `z` (70 % hitbox applied to both extents).
 * @param {{x: number, z: number}} boat
 * @param {{side: -1|1, z: number}} pier
 * @param {object} [tune]
 * @returns {boolean}
 */
export function hitsPier(boat, pier, tune = HARBOR) {
  const depth = (tune.PIER_DEPTH_M / 2 + tune.BOAT_RADIUS) * tune.HITBOX_SCALE;
  if (Math.abs(boat.z - pier.z) > depth) return false;
  const innerEdge = tune.CHANNEL_HALF_W - tune.PIER_REACH_M * tune.HITBOX_SCALE;
  return pier.side < 0 ? boat.x <= -innerEdge : boat.x >= innerEdge;
}

/**
 * Horn cone test (§C10.1: 6 m cone ahead of the bow).
 * @param {{x: number, z: number}} boat
 * @param {{x: number, z: number}} buoy
 * @param {object} [tune]
 * @returns {boolean}
 */
export function inHornCone(boat, buoy, tune = HARBOR) {
  const dz = buoy.z - boat.z;
  if (dz < -0.5 || dz > tune.HORN_CONE_M) return false;
  return Math.abs(buoy.x - boat.x) <= tune.HORN_CONE_BASE + Math.max(0, dz) * tune.HORN_CONE_SPREAD;
}

/**
 * Apply a score delta with the shared floor-at-zero rule.
 * @param {number} score
 * @param {number} delta
 * @returns {number}
 */
export function applyScore(score, delta) {
  return Math.max(0, score + delta);
}

/**
 * @typedef {Object} HarborItem
 * @property {'crate'|'ring'|'buoy'} type
 * @property {number} x @property {number} z
 * @property {boolean} gone collected / cleared / passed
 */

/**
 * @typedef {Object} HarborState
 * @property {number} x lateral position (m) @property {number} vx lateral velocity
 * @property {number} z distance down the channel (m)
 * @property {number} score @property {number} crates crates aboard
 * @property {number} rings @property {number} bumps @property {number} steals
 * @property {number} boostT @property {number} boostChain @property {number} slowT
 * @property {number} iframesT @property {number} hornCharges
 * @property {number} idleT @property {number} lane
 * @property {{phase: 'idle'|'warn', t: number}} gull
 * @property {number} elapsed @property {boolean} ended
 */

/**
 * Create the deterministic harbor engine. step() advances one frame and
 * returns semantic events for the visual layer / tests:
 *   crate {item} · ring {item} · bump {what} · buoyCleared {count} ·
 *   hornEmpty · waveSpawn {sweetX} · boost {chain} · gullWarn · gullSteal ·
 *   gullLeave · ended
 * @param {() => number} rng seeded 0..1
 * @param {object} [tune]
 * @returns {{state: HarborState, items: HarborItem[],
 *   piers: Array<{side: -1|1, z: number, hit: boolean}>,
 *   waves: Array<{z: number, sweetX: number, ridden: boolean}>,
 *   step: (input: {targetX: number|null, horn?: boolean}, dt: number) => Array<object>}}
 */
export function createEngine(rng, tune = HARBOR) {
  /** @type {HarborState} */
  const state = {
    x: 0,
    vx: 0,
    z: 0,
    score: 0,
    crates: 0,
    rings: 0,
    bumps: 0,
    steals: 0,
    boostT: 0,
    boostChain: 0,
    slowT: 0,
    iframesT: 0,
    hornCharges: tune.HORN_CHARGES,
    idleT: 0,
    lane: laneOf(0, tune),
    gull: { phase: 'idle', t: 0 },
    elapsed: 0,
    ended: false,
  };
  /** @type {HarborItem[]} */
  const items = [];
  /** @type {Array<{side: -1|1, z: number, hit: boolean}>} */
  const piers = [];
  /** @type {Array<{z: number, sweetX: number, ridden: boolean}>} */
  const waves = [];
  let genZ = 14; // first row spawns a little ahead of the start
  let nextPierZ = tune.PIER_EVERY_M.min + rng() * (tune.PIER_EVERY_M.max - tune.PIER_EVERY_M.min);
  let nextWaveAt = tune.WAVE_EVERY_SEC * 0.6; // first crest arrives early

  /** Seeded row generation up to `untilZ` (called as the boat advances). */
  function generateAhead(untilZ) {
    while (genZ < untilZ) {
      const roll = rng();
      const x = (rng() * 2 - 1) * (tune.CHANNEL_HALF_W - 0.55);
      if (roll < tune.CRATE_CHANCE) {
        items.push({ type: 'crate', x, z: genZ, gone: false });
      } else if (roll < tune.CRATE_CHANCE + tune.RING_CHANCE) {
        items.push({ type: 'ring', x, z: genZ, gone: false });
      } else if (roll < tune.CRATE_CHANCE + tune.RING_CHANCE + tune.BUOY_CHANCE) {
        items.push({ type: 'buoy', x, z: genZ, gone: false });
      } // else: empty water
      const gap = tune.ROW_GAP_M.min + rng() * (tune.ROW_GAP_M.max - tune.ROW_GAP_M.min);
      genZ += gap;
      // V4/G74 §C-SYS4.3 muenzregen: extra PICKUP-only rows interleave the
      // base table at the row midpoints. Chance = (rate−1)·(crate+ring), so
      // expected pickups/row = (crate+ring)·rate — EXACTLY +50 % at 1.5. The
      // branch draws rng only when the modifier is active — base streams
      // stay bit-identical.
      if (tune.PICKUP_RATE > 1 &&
        rng() < (tune.PICKUP_RATE - 1) * (tune.CRATE_CHANCE + tune.RING_CHANCE)) {
        const px = (rng() * 2 - 1) * (tune.CHANNEL_HALF_W - 0.55);
        const isCrate = rng() < tune.CRATE_CHANCE / (tune.CRATE_CHANCE + tune.RING_CHANCE);
        items.push({ type: isCrate ? 'crate' : 'ring', x: px, z: genZ - gap / 2, gone: false });
      }
      if (genZ >= nextPierZ) {
        const side = piers.length % 2 === 0 ? (rng() < 0.5 ? -1 : 1) : -piers[piers.length - 1].side;
        piers.push({ side, z: nextPierZ, hit: false });
        nextPierZ += tune.PIER_EVERY_M.min + rng() * (tune.PIER_EVERY_M.max - tune.PIER_EVERY_M.min);
      }
    }
  }
  generateAhead(tune.LOOKAHEAD_M);

  function bump(events, what) {
    state.score = applyScore(state.score, tune.BUMP_PENALTY);
    state.bumps += 1;
    state.slowT = tune.SLOW_SEC;
    state.iframesT = tune.BUMP_IFRAMES_SEC;
    state.boostT = 0; // a bump kills the surf
    state.boostChain = 0;
    events.push({ type: 'bump', what });
    // V4/G74 §G5.4 Endlos end-condition: 3 bumps (buoy/pier hits)
    if (tune.ENDLESS && state.bumps >= tune.ENDLESS_BUMP_LIMIT) {
      state.ended = true;
      events.push({ type: 'ended', reason: 'bumps' });
    }
  }

  /**
   * @param {{targetX: number|null, horn?: boolean}} input
   * @param {number} dt seconds
   * @returns {Array<object>} events this frame
   */
  function step(input, dt) {
    /** @type {Array<object>} */
    const events = [];
    if (state.ended) return events;
    dt = Math.min(tune.MAX_DT, Math.max(0, dt));
    state.elapsed += dt;
    // V4/G74 §G5.4: Endlos has no round timer — 3 bumps end it (see bump()).
    if (!tune.ENDLESS && state.elapsed >= tune.DURATION_SEC) {
      state.ended = true;
      events.push({ type: 'ended' });
      return events;
    }

    // ---- timers ----
    if (state.boostT > 0) state.boostT = Math.max(0, state.boostT - dt);
    if (state.boostT === 0) state.boostChain = 0;
    if (state.slowT > 0) state.slowT = Math.max(0, state.slowT - dt);
    if (state.iframesT > 0) state.iframesT = Math.max(0, state.iframesT - dt);

    // ---- Fischkutter-Horn (§C10.1: 6 m cone, 2 charges) ----
    if (input.horn) {
      if (state.hornCharges > 0) {
        state.hornCharges -= 1;
        let cleared = 0;
        for (const item of items) {
          if (item.gone || item.type !== 'buoy') continue;
          if (inHornCone({ x: state.x, z: state.z }, item, tune)) {
            item.gone = true;
            cleared += 1;
          }
        }
        events.push({ type: 'buoyCleared', count: cleared });
      } else {
        events.push({ type: 'hornEmpty' });
      }
    }

    // ---- momentum steering (drag → lateral accel, damped) ----
    if (input.targetX != null) {
      const target = Math.max(-tune.CHANNEL_HALF_W + 0.35, Math.min(tune.CHANNEL_HALF_W - 0.35, input.targetX));
      const err = target - state.x;
      state.vx += Math.max(-1, Math.min(1, err / 0.9)) * tune.STEER_ACCEL * dt;
    }
    state.vx -= state.vx * Math.min(1, tune.STEER_DAMPING * dt);
    state.vx = Math.max(-tune.MAX_LATERAL_SPEED, Math.min(tune.MAX_LATERAL_SPEED, state.vx));
    state.x += state.vx * dt;
    const wallX = tune.CHANNEL_HALF_W - 0.35;
    if (state.x < -wallX) {
      state.x = -wallX;
      state.vx = Math.abs(state.vx) * 0.25;
    } else if (state.x > wallX) {
      state.x = wallX;
      state.vx = -Math.abs(state.vx) * 0.25;
    }

    // ---- forward travel ----
    const prevBoatZ = state.z;
    state.z += speedOf(state, tune) * dt;
    generateAhead(state.z + tune.LOOKAHEAD_M);

    // ---- wave bands (rhythmic, roll toward the boat) ----
    if (state.elapsed >= nextWaveAt) {
      const sweetX = (rng() * 2 - 1) * (tune.CHANNEL_HALF_W - tune.SWEET_HALF_W);
      waves.push({ z: state.z + tune.WAVE_SPAWN_AHEAD_M, sweetX, ridden: false });
      events.push({ type: 'waveSpawn', sweetX });
      nextWaveAt += tune.WAVE_EVERY_SEC;
    }
    for (const wave of waves) {
      const prevZ = wave.z;
      wave.z -= tune.WAVE_SPEED * dt; // rolls down-channel toward the boat
      // crest passes under the hull when the relative sign flips this frame
      // (compare before-vs-before and after-vs-after — comparing both ends
      // against the post-move boat z misses crossings wider than the wave's
      // own per-frame travel)
      if (!wave.ridden && prevZ >= prevBoatZ && wave.z <= state.z) {
        // crest passes under the hull this frame
        if (Math.abs(state.x - wave.sweetX) <= tune.SWEET_HALF_W && state.slowT === 0) {
          state.boostChain += 1;
          state.boostT = tune.BOOST_SEC; // chainable: each crest re-arms 2 s
          events.push({ type: 'boost', chain: state.boostChain });
        }
        wave.ridden = true;
      }
    }
    for (let i = waves.length - 1; i >= 0; i -= 1) {
      if (waves[i].z < state.z - 8) waves.splice(i, 1);
    }

    // ---- pickups & buoys ----
    const boat = { x: state.x, z: state.z };
    for (const item of items) {
      if (item.gone || item.z < state.z - 2 || item.z > state.z + 3) continue;
      if (item.type === 'crate' && hits(boat, item, tune.CRATE_RADIUS + tune.BOAT_RADIUS, false, tune)) {
        item.gone = true;
        state.crates += 1;
        state.score = applyScore(state.score, tune.CRATE_POINTS);
        events.push({ type: 'crate', item });
      } else if (item.type === 'ring' && hits(boat, item, tune.RING_RADIUS + tune.BOAT_RADIUS, false, tune)) {
        item.gone = true;
        state.rings += 1;
        state.score = applyScore(state.score, tune.RING_POINTS);
        events.push({ type: 'ring', item });
      } else if (item.type === 'buoy' && state.iframesT === 0 &&
        hits(boat, item, tune.BUOY_RADIUS + tune.BOAT_RADIUS, true, tune)) {
        state.vx = (state.x <= item.x ? -1 : 1) * tune.BUMP_SHOVE; // shove away
        bump(events, 'buoy');
      }
    }
    if (state.iframesT === 0) {
      for (const pier of piers) {
        if (Math.abs(pier.z - state.z) > 3) continue;
        if (hitsPier(boat, pier, tune)) {
          pier.hit = true;
          state.vx = -pier.side * tune.BUMP_SHOVE; // shove toward mid-channel
          bump(events, 'pier');
        }
      }
    }
    // prune passed items (visual layer pools its own meshes)
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].z < state.z - 10) items.splice(i, 1);
    }

    // ---- seagull idle rule (§C10.1: > 4 s one lane, honk warning first) ----
    const lane = laneOf(state.x, tune);
    if (lane !== state.lane) {
      state.lane = lane;
      state.idleT = 0;
      if (state.gull.phase === 'warn') {
        state.gull.phase = 'idle';
        state.gull.t = 0;
        events.push({ type: 'gullLeave' });
      }
    } else if (state.crates > 0) {
      state.idleT += dt;
      if (state.gull.phase === 'idle' && state.idleT >= tune.GULL_IDLE_SEC) {
        state.gull.phase = 'warn';
        state.gull.t = 0;
        events.push({ type: 'gullWarn' });
      } else if (state.gull.phase === 'warn') {
        state.gull.t += dt;
        if (state.gull.t >= tune.GULL_WARN_SEC) {
          state.gull.phase = 'idle';
          state.gull.t = 0;
          state.idleT = 0;
          state.crates -= 1;
          state.steals += 1;
          state.score = applyScore(state.score, -tune.CRATE_POINTS);
          events.push({ type: 'gullSteal' });
        }
      }
    } else {
      state.idleT = 0;
      if (state.gull.phase === 'warn') {
        state.gull.phase = 'idle';
        state.gull.t = 0;
        events.push({ type: 'gullLeave' });
      }
    }

    return events;
  }

  return { state, items, piers, waves, step };
}

/**
 * Greedy autoplay bot (§C10.1: "spline-follows a greedy crate path, centers
 * wave crests"). Builds a short target list: the nearest approaching wave's
 * sweet spot (priority), else the best-value reachable pickup in the scan
 * window; dodges buoys/piers that sit on the path; fires the horn when a
 * buoy is imminent and unavoidable.
 * @param {object} [tune]
 * @returns {{control: (state: HarborState, items: HarborItem[],
 *   piers: Array<{side: -1|1, z: number}>,
 *   waves: Array<{z: number, sweetX: number, ridden: boolean}>) =>
 *   {targetX: number, horn: boolean}}}
 */
export function createBot(tune = HARBOR) {
  let dodgeToLane = null; // latched anti-gull hop (flip-flopping never lands)
  // V4/G74: the reach filter is TIME-based — lateral authority is fixed
  // (MAX_LATERAL_SPEED) while row time shrinks with the mode's speed, so a
  // faster channel means fewer chaseable pickups (×1 on Mittel: identical).
  const reachPerM = tune.BOT_REACH_X_PER_M * (HARBOR.BASE_SPEED / tune.BASE_SPEED);
  return {
    control(state, items, piers, waves) {
      let targetX = null;

      // 1) center the next approaching crest (§C10.1 bot rule) when close
      let bestWave = null;
      for (const wave of waves) {
        if (wave.ridden || wave.z < state.z) continue;
        const dz = wave.z - state.z;
        if (dz <= tune.BOT_WAVE_M && (bestWave == null || dz < bestWave.z - state.z)) bestWave = wave;
      }
      if (bestWave) targetX = bestWave.sweetX;

      // 2) otherwise: greedy value-per-reach pickup in the scan window
      if (targetX == null) {
        let best = null;
        let bestScore = -Infinity;
        for (const item of items) {
          if (item.gone || item.type === 'buoy') continue;
          const dz = item.z - state.z;
          if (dz < 1 || dz > tune.BOT_SCAN_M) continue;
          const reach = Math.abs(item.x - state.x) / Math.max(1, dz * reachPerM);
          if (reach > 1.15) continue; // not reachable in time — skip
          const value = (item.type === 'crate' ? tune.BOT_CRATE_VALUE : tune.BOT_RING_VALUE) - dz * 0.12 - reach;
          if (value > bestScore) {
            bestScore = value;
            best = item;
          }
        }
        targetX = best ? best.x : state.x * 0.6; // drift toward mid-channel
      }

      // 3) dodge buoys/piers sitting on the path ahead
      let horn = false;
      for (const item of items) {
        if (item.gone || item.type !== 'buoy') continue;
        const dz = item.z - state.z;
        if (dz < 0.4 || dz > tune.BOT_DODGE_M) continue;
        const clearance = (tune.BUOY_RADIUS + tune.BOAT_RADIUS) * tune.HITBOX_SCALE + 0.35;
        if (Math.abs(item.x - targetX) < clearance) {
          // steer around the buoy on the side closer to the current hull line
          targetX = item.x + (state.x <= item.x ? -clearance : clearance);
        }
        if (dz <= tune.BOT_HORN_M && Math.abs(item.x - state.x) < clearance * 0.8 &&
          state.hornCharges > 0) {
          horn = true; // imminent + charges left → honk it away
        }
      }
      for (const pier of piers) {
        const dz = pier.z - state.z;
        if (dz < 0 || dz > tune.BOT_DODGE_M) continue;
        const innerEdge = tune.CHANNEL_HALF_W - tune.PIER_REACH_M - 0.45;
        if (pier.side < 0) targetX = Math.max(targetX, -innerEdge);
        else targetX = Math.min(targetX, innerEdge);
      }

      // 4) shoo the seagull: once the warning honk is up (or idle is about to
      // trip it), hop into the adjacent lane — cargo beats loitering. The hop
      // is LATCHED until the lane change registers (idleT resets): recomputing
      // the direction every frame flip-flops and never leaves the lane.
      if (dodgeToLane == null && state.crates > 0 &&
        (state.gull.phase === 'warn' || state.idleT >= tune.BOT_GULL_DODGE_AT_SEC)) {
        const lane = laneOf(state.x, tune);
        dodgeToLane = lane === 0 ? 1 : lane === tune.LANES - 1 ? tune.LANES - 2
          : targetX >= state.x ? lane + 1 : lane - 1;
      }
      if (dodgeToLane != null) {
        if (state.idleT < 0.2 || state.crates === 0) {
          dodgeToLane = null; // hop landed (idle reset) — resume the route
        } else {
          const laneW = (tune.CHANNEL_HALF_W * 2) / tune.LANES;
          targetX = -tune.CHANNEL_HALF_W + laneW * (dodgeToLane + 0.5);
        }
      }

      return {
        targetX: Math.max(-tune.CHANNEL_HALF_W + 0.4, Math.min(tune.CHANNEL_HALF_W - 0.4, targetX)),
        horn,
      };
    },
  };
}

/**
 * Headless full-round simulation (tests + tuning): engine + greedy bot at a
 * fixed dt until the round ends.
 * @param {number} seed
 * @param {object} [tune]
 * @param {number} [dt]
 * @returns {{score: number, crates: number, rings: number, bumps: number,
 *   steals: number, boosts: number, distanceM: number, hornsUsed: number}}
 */
export function simulateRound(seed, tune = HARBOR, dt = 1 / 60) {
  const rng = mulberry32(seed);
  const engine = createEngine(rng, tune);
  const bot = createBot(tune);
  let boosts = 0;
  let guard = Math.ceil((tune.DURATION_SEC + 10) / dt);
  while (!engine.state.ended && guard > 0) {
    const c = bot.control(engine.state, engine.items, engine.piers, engine.waves);
    const events = engine.step(c, dt);
    for (const ev of events) if (ev.type === 'boost') boosts += 1;
    guard -= 1;
  }
  const s = engine.state;
  return {
    score: s.score,
    crates: s.crates,
    rings: s.rings,
    bumps: s.bumps,
    steals: s.steals,
    boosts,
    distanceM: Math.floor(s.z),
    hornsUsed: tune.HORN_CHARGES - s.hornCharges,
  };
}

/**
 * V4/G74 §G5.4 certification sim: one full seeded bot round at `mode`
 * (deterministic, no DOM). A seeded lapse track (short no-steer windows,
 * human attention model) drives both the §G5.4 monotone-means gate AND the
 * Endlos termination — a lapsing skipper WILL take 3 bumps eventually.
 * @param {string} [mode] @param {number} [seed] @param {number} [maxSec]
 * @param {object|null} [modifier] optional §C-SYS4.3 payload (tests)
 * @returns {{score: number, crates: number, rings: number, bumps: number,
 *   steals: number, boosts: number, distanceM: number, elapsed: number}}
 */
export function simulateHarborAutoplay(mode = 'normal', seed = 1, maxSec = 900, modifier = null) {
  const tune = applyModifier(applyDifficulty(HARBOR, mode), modifier);
  const rng = mulberry32(seed);
  const engine = createEngine(rng, tune);
  const bot = createBot(tune);
  const lapse = mulberry32((seed ^ 0x9d2c5681) >>> 0);
  // human-attention model: per-mode lapse cadence (tighter under pressure)
  // drives fumbles/bumps — §G5.4 monotone gate + Endlos termination.
  const lapseEvery = tune.BOT_LAPSE_EVERY_SEC > 0 ? tune.BOT_LAPSE_EVERY_SEC : Infinity;
  let nextLapse = lapseEvery * (0.5 + lapse());
  let lapseT = 0;
  let boosts = 0;
  let focusT = 0; // §G5.3 human model: post-pickup focus cooldown
  const dt = 1 / 60;
  let guard = Math.ceil(maxSec / dt);
  while (!engine.state.ended && guard > 0) {
    // during the focus cooldown the skipper ignores NEW pickups (buoys stay
    // visible — dodging is reflex, chasing is attention)
    const seen = focusT > 0 ? engine.items.filter((it) => it.type === 'buoy') : engine.items;
    const c = bot.control(engine.state, seen, engine.piers, engine.waves);
    nextLapse -= dt;
    if (nextLapse <= 0 && lapseT <= 0) {
      lapseT = 0.7 + lapse() * 0.9;
      nextLapse = lapseEvery * (0.5 + lapse());
    }
    if (lapseT > 0) {
      lapseT -= dt;
      c.targetX = null; //   hands off the tiller — drift
      c.horn = false;
    }
    const events = engine.step(c, dt);
    for (const ev of events) {
      if (ev.type === 'boost') boosts += 1;
      if (ev.type === 'crate' || ev.type === 'ring') focusT = tune.BOT_FOCUS_SEC;
    }
    if (focusT > 0) focusT -= dt;
    guard -= 1;
  }
  const s = engine.state;
  return {
    score: hopperScore(s, tune),
    crates: s.crates,
    rings: s.rings,
    bumps: s.bumps,
    steals: s.steals,
    boosts,
    distanceM: Math.floor(s.z),
    elapsed: s.elapsed,
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
