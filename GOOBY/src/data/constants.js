// GOOBY design constants — every number in PLAN.md §C lives here (single source of
// truth at runtime; PLAN.md §C is binding). Pure data: no three.js, no DOM imports.
// All objects are frozen. Never inline these numbers elsewhere.

/** Save schema / persistence (§E3). */
export const SAVE = Object.freeze({
  VERSION: 2, // V2/G16: schema v2 — garden/health/weight/quests/collections/skins/items/profile slices (PLAN2 §B2)
  KEY: 'gooby.save',
  CORRUPT_KEY: 'gooby.save.corrupt',
  /** New-game stat defaults (§E3). */
  DEFAULT_STATS: Object.freeze({ hunger: 80, energy: 90, hygiene: 85, fun: 70 }),
});

/** Pet stats (§C1). Rates are signed deltas per real minute. */
export const STATS = Object.freeze({
  MIN: 0,
  MAX: 100,
  KEYS: Object.freeze(['hunger', 'energy', 'hygiene', 'fun']),
  /** Decay per real minute while awake (app open or closed). */
  RATES_AWAKE: Object.freeze({ hunger: -0.35, energy: -0.25, hygiene: -0.15, fun: -0.5 }),
  /** Per real minute while asleep: hunger decays at half rate, energy FILLS 0→100 in 30 min. */
  RATES_ASLEEP: Object.freeze({ hunger: -0.175, energy: 3.334, hygiene: 0, fun: 0 }),
  /** HUD bar turns orange / notification triggers below this (§C1). */
  LOW_STAT: 25,
  /** HUD bar turns red below this (§C1). */
  CRITICAL_STAT: 10,
  /** hygiene < 15 → stink-fly particles (§C1 visual states). */
  STINK_BELOW: 15,
  /** hunger < 10 → drool + belly-rumble wobble every ~20 s (§C1). */
  DROOL_BELOW: 10,
  DROOL_WOBBLE_EVERY_SEC: 20,
  /** energy ≤ 15 → exhausted: yawns, minigames refuse to start, mood capped (§C1). */
  EXHAUSTED_AT_OR_BELOW: 15,
  EXHAUSTED_MOOD_CAP: 39,
});

/** Offline catch-up simulation (§C1, §E4). */
export const OFFLINE = Object.freeze({
  /** Awake decay runs at 0.3× the awake rates while the app is closed. */
  AWAKE_RATE_MULT: 0.3,
  /** Cap of simulated awake-decay minutes (8 h). Sleep progress is uncapped. */
  AWAKE_CAP_MIN: 480,
});

/** Mood formula & bands (§C1): mood = 0.35*min(stats) + 0.65*avg(stats). */
export const MOOD = Object.freeze({
  MIN_WEIGHT: 0.35,
  AVG_WEIGHT: 0.65,
  /** Bands checked top-down: first entry whose min ≤ mood wins. */
  BANDS: Object.freeze([
    Object.freeze({ id: 'ecstatic', min: 80 }),
    Object.freeze({ id: 'happy', min: 60 }),
    Object.freeze({ id: 'neutral', min: 40 }),
    Object.freeze({ id: 'grumpy', min: 25 }),
    Object.freeze({ id: 'miserable', min: 0 }),
  ]),
});

/** Sleep system (§C1.4). */
export const SLEEP = Object.freeze({
  /** Lamp switch starts sleep only when energy < 70. */
  START_BELOW_ENERGY: 70,
  /** sleepDurationMin = ceil(30 * (100 - energy) / 100), minimum 10. */
  DURATION_BASE_MIN: 30,
  DURATION_MIN_MIN: 10,
  /** Energy fill per minute while asleep (0→100 in 30 min). */
  FILL_PER_MIN: 3.334,
  /** Early manual wake allowed after this many minutes. */
  EARLY_WAKE_AFTER_MIN: 5,
  /** Early wake grumpy debuff: mood −15 for 10 minutes. */
  EARLY_WAKE_MOOD_DEBUFF: 15,
  EARLY_WAKE_DEBUFF_MIN: 10,
});

/** XP & levels (§C1.5). XP to advance L→L+1 = BASE + STEP*(L-1). */
export const XP = Object.freeze({
  MAX_LEVEL: 30,
  BASE: 100,
  STEP: 50,
  /** XP grants. */
  FEED: 5,
  FULL_WASH: 8,
  COMPLETED_SLEEP: 10,
  PET: 1,
  /** Max XP per day from petting/tickling. */
  PET_DAILY_CAP: 20,
  /** Minigame finish XP = MINIGAME_BASE + min(MINIGAME_BONUS_CAP, floor(coins / MINIGAME_COIN_DIVISOR)). */
  MINIGAME_BASE: 10,
  MINIGAME_BONUS_CAP: 15,
  MINIGAME_COIN_DIVISOR: 2,
  /** Level-up reward = 25 * newLevel coins. */
  LEVEL_UP_COINS_PER_LEVEL: 25,
});

/** Economy (§C4, §C5, §C8.2). */
export const ECONOMY = Object.freeze({
  STARTING_COINS: 100,
  /** Starter inventory (§C5.1). */
  STARTER_INVENTORY: Object.freeze({ carrot: 3, apple: 1, cupcake: 1 }),
  /** Quick Delivery (§C4.6): one-time purchase, food only, price markup, level gate. */
  QUICK_DELIVERY_PRICE: 400,
  QUICK_DELIVERY_LEVEL: 8,
  /** +20% price markup, rounded up (ceil). */
  QUICK_DELIVERY_MARKUP: 0.2,
  /** Daily bonus streak rewards day 1–7; day ≥ 7 stays at the last value (§C8.2). */
  DAILY_BONUS: Object.freeze([20, 30, 40, 50, 60, 80, 100]),
  /** From this streak day on, the daily bonus also includes 1 random food item. */
  DAILY_BONUS_FOOD_FROM_DAY: 7,
});

/** Shared minigame rules (§C6). */
export const MINIGAME = Object.freeze({
  /** Energy cost per play (cityDrive uses DRIVE_ENERGY_COST). */
  ENERGY_COST: 8,
  DRIVE_ENERGY_COST: 6,
  /** Fun granted on finishing any minigame. */
  FUN_REWARD: 15,
  /** First play of each game per local day: ×2 coins (after clamp). */
  DAILY_FIRST_PLAY_MULT: 2,
  /** 3-2-1 countdown before every game. */
  COUNTDOWN_FROM: 3,
  /** 6×4 memoryMatch layout unlocks at this level (§C1.5). */
  MEMORY_BIG_LAYOUT_LEVEL: 6,
  /** Dev-only `_smoke` game round length (framework proof, §G G1). */
  SMOKE_DURATION_SEC: 15,
});

/**
 * Coin table (§C6): coins = clamp(floor(score / divisor), min, max).
 * cityDrive is special: pickups + bonuses per §C4 (max ≈ 35).
 */
export const COIN_TABLE = Object.freeze({
  cityDrive: Object.freeze({ special: true, max: 35 }),
  carrotCatch: Object.freeze({ divisor: 3, min: 4, max: 25 }),
  bunnyHop: Object.freeze({ divisor: 2, min: 3, max: 25 }),
  carrotGuard: Object.freeze({ divisor: 3, min: 4, max: 25 }),
  memoryMatch: Object.freeze({ divisor: 2, min: 5, max: 24 }),
  runner: Object.freeze({ divisor: 15, min: 4, max: 30 }),
  basketBounce: Object.freeze({ divisor: 3, min: 4, max: 26 }),
  pancakeTower: Object.freeze({ divisor: 2, min: 4, max: 26 }),
  danceParty: Object.freeze({ divisor: 6, min: 4, max: 28 }),
  fishingPond: Object.freeze({ divisor: 3, min: 4, max: 26 }),
  bubblePop: Object.freeze({ divisor: 4, min: 4, max: 24 }),
  trampoline: Object.freeze({ divisor: 5, min: 4, max: 26 }),
  // V2/G16: 9 new coin rows (PLAN2 §C1.1 verbatim)
  goobySays: Object.freeze({ divisor: 5, min: 4, max: 24 }),
  gardenRush: Object.freeze({ divisor: 3, min: 4, max: 25 }),
  burgerBuild: Object.freeze({ divisor: 4, min: 4, max: 26 }),
  veggieChop: Object.freeze({ divisor: 5, min: 4, max: 26 }),
  deliveryRush: Object.freeze({ divisor: 8, min: 5, max: 32 }),
  miniGolf: Object.freeze({ divisor: 5, min: 4, max: 28 }),
  goalieGooby: Object.freeze({ divisor: 3, min: 4, max: 26 }),
  starHopper: Object.freeze({ divisor: 9, min: 4, max: 26 }),
  pipeFlow: Object.freeze({ divisor: 5, min: 4, max: 25 }),
});

/** Minigame unlock schedule (§C6.3): level → new game. */
export const UNLOCK_LEVELS = Object.freeze({
  carrotCatch: 1,
  bunnyHop: 1,
  cityDrive: 1,
  carrotGuard: 2,
  memoryMatch: 3,
  basketBounce: 4,
  pancakeTower: 5,
  runner: 6,
  bubblePop: 7,
  fishingPond: 8,
  danceParty: 9,
  trampoline: 10,
});

/** City drive / shop trip (§C4, §C6.1 #1). */
export const DRIVE = Object.freeze({
  /** Coin pickups on route: 1c each, 20 placed per route. */
  PICKUP_COINS: 1,
  PICKUP_COUNT: 20,
  ARRIVAL_BONUS: 10,
  ZERO_CRASH_BONUS: 5,
  /** 3 crashes → tow-truck cutscene (car placed at shop, no bonuses). */
  CRASHES_FOR_TOW: 3,
  /** On bump, speed drops to 30%. */
  CRASH_SPEED_MULT: 0.3,
  /** Auto-throttle: base 9 m/s, ramps to 13. */
  BASE_SPEED: 9,
  MAX_SPEED: 13,
  /** Shop parking arrival trigger radius (m). */
  PARKING_RADIUS: 4,
  /** Arcade-mode coin run length (s). */
  ARCADE_DURATION_SEC: 90,
});

/** Care interactions (§C3). */
export const INTERACT = Object.freeze({
  /** Pet: slow drag, velocity < 600 px/s for ≥ 400 ms. +1 fun per stroke. */
  PET_MAX_VELOCITY: 600,
  PET_MIN_MS: 400,
  PET_FUN: 1,
  /** Tickle: ≥3 direction changes within 900 ms. +2 fun. */
  TICKLE_DIR_CHANGES: 3,
  TICKLE_WINDOW_MS: 900,
  TICKLE_FUN: 2,
  /** Max +10 fun/day from pet + tickle combined. */
  PET_TICKLE_FUN_DAILY_CAP: 10,
  /** 5 pokes in <3 s → dizzy for 2 s. */
  POKE_DIZZY_COUNT: 5,
  POKE_DIZZY_WINDOW_MS: 3000,
  DIZZY_SEC: 2,
  /** Feeding refused (head shake) at hunger ≥ 95. */
  FEED_REFUSE_AT_HUNGER: 95,
  /** Wash: hygiene += 60 * coverage (coverage 0–1); full wash also +3 fun. */
  WASH_HYGIENE_FACTOR: 60,
  FULL_WASH_FUN: 3,
  /** Ball toss: +3 fun per fetch, 15 s cooldown. */
  BALL_FUN: 3,
  BALL_COOLDOWN_SEC: 15,
  /** Toilet gag: tap when hygiene < 50 → +5 hygiene, 10-min cooldown (§C2). */
  TOILET_BELOW_HYGIENE: 50,
  TOILET_HYGIENE_GAIN: 5,
  TOILET_COOLDOWN_MIN: 10,
});

/** Local notification rules (§C7). */
export const NOTIFY = Object.freeze({
  // V2/G16: ids 6/7 + cap 7 (PLAN2 §B3 — harvest §C2.4, sick §C3.5)
  IDS: Object.freeze({ wake: 1, hunger: 2, fun: 3, hygiene: 4, daily: 5, harvest: 6, sick: 7 }),
  /** Max scheduled notifications (one per id). */
  MAX_SCHEDULED: 7,
  /** Stat thresholds whose predicted crossing time triggers a notification. */
  HUNGER_AT: 20,
  FUN_AT: 15,
  HYGIENE_AT: 15,
  /** Stat notifications only when the predicted time is ≥ 30 min in the future. */
  MIN_LEAD_MIN: 30,
  /** Min 30 min between any two scheduled times (later one shifts +30 min). */
  MIN_SPACING_MIN: 30,
  /** Quiet hours 22:00–08:00 device-local; triggers inside shift to 08:05. */
  QUIET_START_HOUR: 22,
  QUIET_END_HOUR: 8,
  QUIET_SHIFT_TO_HOUR: 8,
  QUIET_SHIFT_TO_MIN: 5,
  /** Notification ids exempt from quiet hours (wake — user-initiated). */
  QUIET_EXEMPT_IDS: Object.freeze([1]),
  /** Daily-bonus reminder fires 24 h after last claim. */
  DAILY_AFTER_H: 24,
  /** "Later" on the permission soft-ask re-asks after 24 h. */
  PERMISSION_REASK_H: 24,
});

/**
 * Food table (§C5.1) — verbatim numbers. The catalog (`data/foods.js`) derives
 * from this. Keys are the Kenney food-kit GLB names. Deltas are stat changes.
 */
export const FOOD_TABLE = Object.freeze({
  carrot: Object.freeze({ price: 5, hunger: 10, fun: 2, favorite: true }),
  apple: Object.freeze({ price: 6, hunger: 10, fun: 1 }),
  banana: Object.freeze({ price: 6, hunger: 11, fun: 0 }),
  bread: Object.freeze({ price: 10, hunger: 18, fun: 0 }),
  cheese: Object.freeze({ price: 12, hunger: 16, fun: 2 }),
  watermelon: Object.freeze({ price: 12, hunger: 14, fun: 4 }),
  'donut-sprinkles': Object.freeze({ price: 12, hunger: 10, fun: 10, junk: true }), // V2/G16: junk flag (§C7)
  cupcake: Object.freeze({ price: 14, hunger: 8, fun: 12, junk: true }), // V2/G16: junk flag (§C7)
  salad: Object.freeze({ price: 14, hunger: 20, fun: 0, hygiene: 2 }),
  'ice-cream': Object.freeze({ price: 16, hunger: 6, fun: 15, energy: 5, junk: true }), // V2/G16: junk flag (§C7)
  sandwich: Object.freeze({ price: 16, hunger: 24, fun: 3 }),
  'hot-dog': Object.freeze({ price: 18, hunger: 25, fun: 4 }),
  pancakes: Object.freeze({ price: 20, hunger: 28, fun: 6 }),
  burger: Object.freeze({ price: 25, hunger: 40, fun: 6 }),
  pizza: Object.freeze({ price: 30, hunger: 45, fun: 8, hygiene: -2, junk: true }), // V2/G16: junk flag (§C7)
  cake: Object.freeze({ price: 40, hunger: 30, fun: 20, junk: true }), // V2/G16: junk flag (§C7)
  // V2/G16: +16 foods (PLAN2 §C7 verbatim; crop foods are also shop-purchasable)
  radish: Object.freeze({ price: 5, hunger: 8, fun: 1 }),
  tomato: Object.freeze({ price: 7, hunger: 12, fun: 1 }),
  corn: Object.freeze({ price: 10, hunger: 15, fun: 2 }),
  eggplant: Object.freeze({ price: 12, hunger: 16, fun: 1 }),
  pumpkin: Object.freeze({ price: 22, hunger: 26, fun: 4 }),
  strawberry: Object.freeze({ price: 8, hunger: 6, fun: 6 }),
  grapes: Object.freeze({ price: 9, hunger: 8, fun: 5 }),
  croissant: Object.freeze({ price: 11, hunger: 14, fun: 3 }),
  lollypop: Object.freeze({ price: 6, hunger: 2, fun: 8, junk: true }),
  cookie: Object.freeze({ price: 8, hunger: 5, fun: 8, junk: true }),
  chocolate: Object.freeze({ price: 9, hunger: 5, fun: 9, junk: true }),
  'candy-bar': Object.freeze({ price: 10, hunger: 4, fun: 11, junk: true }),
  muffin: Object.freeze({ price: 12, hunger: 10, fun: 8, junk: true }),
  fries: Object.freeze({ price: 14, hunger: 12, fun: 9, hygiene: -1, junk: true }),
  'corn-dog': Object.freeze({ price: 15, hunger: 18, fun: 6, junk: true }),
  sundae: Object.freeze({ price: 18, hunger: 7, fun: 14, energy: 3, junk: true }),
});

/** Rooms & home-scene camera (§C2). */
export const ROOMS = Object.freeze({
  ORDER: Object.freeze(['kitchen', 'living', 'bathroom', 'bedroom']),
  DEFAULT: 'living',
  CAMERA_FOV: 45,
  /** Eased camera pan between rooms (s). */
  PAN_SEC: 0.35,
  /** Gooby room-hop hides behind this fade (ms). */
  GAP_FADE_MS: 150,
});

/** Onboarding (§C8.1). */
export const ONBOARDING = Object.freeze({
  /** Skippable after this step. */
  SKIPPABLE_AFTER_STEP: 3,
  /** Tutorial carrotCatch variant guarantees at least this many coins. */
  TUTORIAL_MIN_COINS: 10,
  /** Tutorial carrotCatch variant length (s). */
  TUTORIAL_DURATION_SEC: 30,
});

/** Engine / plumbing numbers (§E1, §E2, §E4, §E5, §E10). */
export const ENGINE = Object.freeze({
  /** Scene-switch fade (ms) — also the room-gap fade. */
  SCENE_FADE_MS: 150,
  /** Store autosave debounce (ms). */
  AUTOSAVE_DEBOUNCE_MS: 1000,
  /** Time engine tick interval (ms). */
  TICK_MS: 1000,
  /** setPixelRatio(min(devicePixelRatio, 2)). */
  MAX_PIXEL_RATIO: 2,
  /** Swipe classification: > 60 px and > 500 px/s (§E5). */
  SWIPE_MIN_PX: 60,
  SWIPE_MIN_VEL: 500,
  /** Hold gesture threshold (ms). */
  HOLD_MS: 500,
  /** Tap classification: ≤ this movement (px) and ≤ this duration (ms). */
  TAP_MAX_PX: 10,
  TAP_MAX_MS: 300,
});

/**
 * Care-interaction tuning (G5, §C3 implementation details). The BINDING §C3
 * numbers (stat deltas, caps, cooldowns, thresholds) live in INTERACT/XP above;
 * these are the feel/geometry knobs the spec leaves to implementation.
 */
export const CARE_TUNING = Object.freeze({
  /** Wash: coverage ≥ this counts as a "full wash" (+3 fun, XP 8 — §C3/§C1.5). */
  FULL_WASH_COVERAGE: 0.99,
  /** Soap-drag distance (px over Gooby) for suds coverage 0 → 1. */
  WASH_SCRUB_PX_FULL: 2400,
  /** Wet-ears look duration after the rinse (§C3: ears droop 20 s). */
  WASH_WET_SEC: 20,
  /** Dragged food counts as "near the mouth" inside this screen radius (px). */
  FEED_NEAR_MOUTH_PX: 120,
  /** Dropping food inside this screen radius (px) of the mouth feeds Gooby. */
  FEED_DROP_PX: 150,
  /** Ignore sub-jitter pointer movement (px) when counting tickle direction changes. */
  TICKLE_MIN_DX_PX: 3,
  /** Ball toss physics (living room, §C3): simple ballistic + floor bounce. */
  BALL: Object.freeze({
    GRAVITY: 6.5, //           m/s² (cartoon gravity — floatier than 9.81)
    RESTITUTION: 0.55, //      bounce energy kept per floor/wall hit
    FRICTION: 1.6, //          ground drag (fraction of velocity lost per s)
    RADIUS: 0.11, //           ball radius (m)
    FLICK_VEL_SCALE: 0.0035, // px/s pointer flick → m/s world velocity
    MAX_SPEED: 6, //           launch speed clamp (m/s)
    BOUND_X: 1.55, //          |x - spawn.x| wall clamp within the room (m)
    BOUND_Z_MIN: -1.15, //     z - spawn.z back-wall clamp (m)
    BOUND_Z_MAX: 1.35, //      z - spawn.z camera-side clamp (m)
    REST_SPEED: 0.18, //       on-floor speed below which the ball settles
  }),
  /** Gooby only chases the ball when it rests within this range of him (m). */
  CHASE_MAX_DIST: 3.2,
});

/**
 * City-drive tuning (G7, §C4/§C6.1 #1 implementation knobs). The BINDING §C
 * drive numbers (speeds, pickup/bonus coins, crash rules, parking radius,
 * arcade length) live in DRIVE above; this export centralizes the layout and
 * feel knobs the spec leaves to implementation (per the "no inlined design
 * numbers" rule), plus the §C6.1/§E10 city facts (9×9 grid, 20 m tiles,
 * 6–10 traffic cars, 70% hitboxes, ≤ 180 draw calls).
 */
export const DRIVE_TUNING = Object.freeze({
  // --- city layout (§C6.1: seeded 9×9 tile city, 20 m tiles) ---
  GRID: 9,
  TILE_M: 20,
  /** Canonical city seed — the same familiar city every drive (§C6.1). */
  CITY_SEED: 20260716,
  /** Lane center distance from the road centerline (m, right-hand traffic). */
  LANE_OFFSET_M: 2.5,
  /** Road surface height above the ground plane (Kenney tile 0.02 × 20 m). */
  ROAD_Y: 0.4,
  // --- §E10 budget (drive scene) ---
  DRAW_CALL_BUDGET: 180,
  // --- car feel (§C6.1: physics-lite, forgiving) ---
  /** Seconds of clean driving to ramp BASE_SPEED → MAX_SPEED. */
  SPEED_RAMP_SEC: 22,
  /** Yaw rate at full steer input (rad/s). */
  STEER_RATE: 1.9,
  /** Brake button deceleration (m/s²) and the crawl floor while braking. */
  BRAKE_DECEL: 12,
  BRAKE_MIN_SPEED: 1.2,
  /** Lane-snapping assist: only within this heading deviation (§G G7 ≤ 15°). */
  LANE_SNAP_DEG: 15,
  /** Assist ease rates: heading (rad/s toward cardinal), lateral (1/s). */
  LANE_SNAP_HEADING_RATE: 1.7,
  LANE_SNAP_LATERAL_RATE: 1.8,
  /** Soft wall/prop collision (§G G7: slide + speed loss, no crash count). */
  WALL_SPEED_MULT: 0.55,
  /** Knockable cone/box hit: small speed loss only (forgiving juice). */
  KNOCK_SPEED_MULT: 0.85,
  /** §C4.5 bump: invulnerability window + recovery back to full speed (s). */
  CRASH_INVULN_SEC: 2,
  CRASH_RECOVER_SEC: 2.5,
  /** Player collision radius vs walls/props (m). */
  CAR_RADIUS_M: 1.5,
  // --- traffic (§C6.1: 6–10 AI cars, forgiving 70% AABBs) ---
  TRAFFIC_COUNT: 8,
  TRAFFIC_SPEED: 6.5,
  TRAFFIC_HITBOX_SCALE: 0.7,
  // --- model scales (Kenney GLB units → world meters) ---
  CAR_SCALE: 1.8,
  BUILDING_SCALE: 10,
  TREE_SCALE: 6,
  PROP_SCALE: 1.8,
  LAMP_SCALE: 12,
  // --- chase camera (§C6.1 third-person) ---
  CAM_BACK: 10.5,
  CAM_HEIGHT: 5.6,
  CAM_LOOKAHEAD: 7,
  CAM_POS_LERP: 4.5,
  // --- route guidance (§G G7: floating arrows + glowing line) ---
  ARROW_SPACING_M: 14,
  ARROW_HEIGHT_M: 2.6,
  ROUTE_LINE_WIDTH_M: 1.6,
  /** Car is "off route" beyond this distance from the guide line (m). */
  OFF_ROUTE_M: 14,
  /** Coin pickup collect radius (m). */
  PICKUP_RADIUS_M: 3,
  // --- arcade mode (§C4.7: 90 s open coin-run) ---
  ARCADE_COINS_ACTIVE: 26,
});

/**
 * Dance Party (§C6.1 #9) — BINDING rhythm numbers, and the shared music
 * contract with §D6/G14: the seeded 75 s note pattern and the real 100 BPM
 * dance track both derive from BPM + PATTERN_SEED, so when G14's procedural
 * track lands, the notes line up. The game drives note timing from the
 * framework clock (dt/elapsed) at this BPM — never from wall-clock timers.
 */
export const DANCE = Object.freeze({
  /** Track tempo (§C6.1 #9 / §D6: 100 BPM upbeat dance variant). */
  BPM: 100,
  /** Seed of the 75 s note pattern — same seed G14's track generator uses. */
  PATTERN_SEED: 100_2026,
  /** Round / track length (s). */
  DURATION_SEC: 75,
  /** Note lanes. */
  LANES: 3,
  /** Hit windows (§C6.1 #9): perfect ≤ 70 ms (+4) / good ≤ 140 ms (+2). */
  PERFECT_MS: 70,
  GOOD_MS: 140,
  PERFECT_PTS: 4,
  GOOD_PTS: 2,
  /** Score = sum − 2 × misses (§C6.1 #9); a miss also resets the combo. */
  MISS_PENALTY: 2,
});

/** UI palette (§D5) — pastel brand system, mirrored by CSS vars in ui/styles.css. */
export const UI_COLORS = Object.freeze({
  BG_CREAM: '#FFF6EC',
  PRIMARY_PINK: '#FF7BA9',
  TEAL: '#59C9B9',
  YELLOW: '#FFD166',
  TEXT_BROWN: '#4A3B36',
  /** Stat bar fills: hunger orange, energy yellow, hygiene blue, fun pink. */
  STAT_HUNGER: '#FF9F5A',
  STAT_ENERGY: '#FFD166',
  STAT_HYGIENE: '#6EC6FF',
  STAT_FUN: '#FF7BA9',
});

// ============================================================================
// V2/G16: GOOBY 2.0 data spine (PLAN2.md §B/§C — binding). ONE region, added
// in wave 1; constants.js is read-only for every other 2.0 agent (§E0.1-2).
// Engine-internal exact numbers (health/weight thresholds §B5, dayNight band
// hours §B4, weather hash recipe §B4) live in their engine modules instead.
// ============================================================================

/**
 * Leveling 2.0 (§B3): cap 30 → 40, XP curve formula unchanged (XP.BASE/STEP
 * still rule; cumulative XP to L40 = 40 950). Plus the §C5.2 v2 XP sources.
 */
export const LEVELING = Object.freeze({
  MAX_LEVEL: 40,
  /** §C5.2 XP grants: harvest +2, delivery +3, sticker +5, set completion +50. */
  XP_HARVEST: 2,
  XP_DELIVERY: 3,
  XP_STICKER: 5,
  XP_SET_COMPLETE: 50,
});

/**
 * Feature ↔ level unlock gating (§B6 verbatim). v1 unlocks (UNLOCK_LEVELS,
 * memory 6×4 at L6, quick delivery L8) unchanged. GARDEN_PLOTS is keyed by
 * 0-based plot index: plots 0–3 come with the garden; index 4 (5th plot) and
 * index 5 (6th plot) are purchasable at the listed level/price.
 */
export const UNLOCKS = Object.freeze({
  PHOTO: 1,
  PROFILE: 1,
  ALBUM: 1,
  VET_CHECKUP: 1, // cure is available whenever sick, any level (§B6)
  QUESTS: 2,
  GARDEN: 3, // 4 plots + crops radish/carrot/salad + garden decor slots
  SKINS: 5, // skins shop tab
  QUICK_DELIVERY: 8, // v1, unchanged (== ECONOMY.QUICK_DELIVERY_LEVEL)
  /** New-minigame unlock levels (§B6); v1 games stay in UNLOCK_LEVELS. */
  MINIGAMES: Object.freeze({
    goobySays: 2,
    gardenRush: 4,
    burgerBuild: 5,
    veggieChop: 6,
    deliveryRush: 7,
    miniGolf: 9,
    goalieGooby: 11,
    starHopper: 12,
    pipeFlow: 14,
  }),
  /** Crop unlock levels (§B6/§C2.3). */
  CROPS: Object.freeze({
    radish: 3,
    carrot: 3,
    salad: 3,
    tomato: 4,
    corn: 6,
    eggplant: 8,
    pumpkin: 10,
    watermelon: 12,
  }),
  /** Purchasable garden plots, by 0-based plot index (§B6). */
  GARDEN_PLOTS: Object.freeze({
    4: Object.freeze({ level: 10, price: 300 }),
    5: Object.freeze({ level: 16, price: 600 }),
  }),
});

/**
 * Crop table (§C2.3 verbatim — growth is REAL minutes, offline-aware).
 * Eaten stat effects live in FOOD_TABLE (crop id == food id; the v1 rows for
 * carrot/salad/watermelon are unchanged and also crop-harvestable). Stage
 * model keys live in data/crops.js (asset-resolution is checked there).
 */
export const CROP_TABLE = Object.freeze({
  radish: Object.freeze({ seedPrice: 5, growthMin: 10, waterings: 1, wateredWindowMin: 10, yield: 2, sellPrice: 6, unlock: 3 }),
  carrot: Object.freeze({ seedPrice: 8, growthMin: 20, waterings: 1, wateredWindowMin: 20, yield: 3, sellPrice: 5, unlock: 3 }),
  salad: Object.freeze({ seedPrice: 12, growthMin: 30, waterings: 2, wateredWindowMin: 15, yield: 2, sellPrice: 10, unlock: 3 }),
  tomato: Object.freeze({ seedPrice: 15, growthMin: 45, waterings: 2, wateredWindowMin: 22.5, yield: 3, sellPrice: 9, unlock: 4 }),
  corn: Object.freeze({ seedPrice: 20, growthMin: 90, waterings: 2, wateredWindowMin: 45, yield: 2, sellPrice: 16, unlock: 6 }),
  eggplant: Object.freeze({ seedPrice: 25, growthMin: 150, waterings: 3, wateredWindowMin: 50, yield: 2, sellPrice: 20, unlock: 8 }),
  pumpkin: Object.freeze({ seedPrice: 35, growthMin: 360, waterings: 3, wateredWindowMin: 120, yield: 1, sellPrice: 55, unlock: 10 }),
  watermelon: Object.freeze({ seedPrice: 45, growthMin: 480, waterings: 4, wateredWindowMin: 120, yield: 1, sellPrice: 70, unlock: 12 }),
});

/**
 * Daily-quest pool (§C5.1 verbatim, 28 entries). `event` names are THE quest
 * event contract — systems/quests.js `track(state, event, n, meta)` call
 * sites (wave 2) must use exactly these strings:
 *   feed / feedHealthy / wash / pet / tickle / ball / sleep / statsScreen —
 *     care actions, n = 1 per action;
 *   gameFinish (any minigame), gameDistinct (n=1 per DISTINCT game per day),
 *   gameCoins (n = coins earned), fishCaught (n = fish per round),
 *   deliver (n = parcels), shopTrip, cleanDrive (0-crash trip/delivery),
 *   buyFood, photo, plant / water / harvest / sell (garden, n = count);
 *   score:<gameId> / round:goobySays / tricks:trampoline — per-round bests:
 *     progress = max(progress, n) semantics (single round must reach target).
 * `requires`: null, {minigame:'<id>'} (unlocked check) or {garden:true} (L3).
 */
export const QUEST_POOL = Object.freeze([
  Object.freeze({ id: 'q.feed3', category: 'care', event: 'feed', target: 3, coins: 20, xp: 10, requires: null }),
  Object.freeze({ id: 'q.feedHealthy2', category: 'care', event: 'feedHealthy', target: 2, coins: 25, xp: 10, requires: null }),
  Object.freeze({ id: 'q.wash1', category: 'care', event: 'wash', target: 1, coins: 20, xp: 10, requires: null }),
  Object.freeze({ id: 'q.pet5', category: 'care', event: 'pet', target: 5, coins: 15, xp: 8, requires: null }),
  Object.freeze({ id: 'q.tickle3', category: 'care', event: 'tickle', target: 3, coins: 15, xp: 8, requires: null }),
  Object.freeze({ id: 'q.ball3', category: 'care', event: 'ball', target: 3, coins: 20, xp: 10, requires: null }),
  Object.freeze({ id: 'q.sleep1', category: 'care', event: 'sleep', target: 1, coins: 25, xp: 12, requires: null }),
  Object.freeze({ id: 'q.medicineCabinet', category: 'care', event: 'statsScreen', target: 1, coins: 10, xp: 5, requires: null }),
  Object.freeze({ id: 'q.play3', category: 'games', event: 'gameFinish', target: 3, coins: 30, xp: 15, requires: null }),
  Object.freeze({ id: 'q.play2distinct', category: 'games', event: 'gameDistinct', target: 2, coins: 25, xp: 12, requires: null }),
  Object.freeze({ id: 'q.earn60', category: 'games', event: 'gameCoins', target: 60, coins: 30, xp: 15, requires: null }),
  Object.freeze({ id: 'q.catch30', category: 'games', event: 'score:carrotCatch', target: 30, coins: 25, xp: 12, requires: null }),
  Object.freeze({ id: 'q.hop10', category: 'games', event: 'score:bunnyHop', target: 10, coins: 25, xp: 12, requires: null }),
  Object.freeze({ id: 'q.run200', category: 'games', event: 'score:runner', target: 200, coins: 30, xp: 15, requires: Object.freeze({ minigame: 'runner' }) }),
  Object.freeze({ id: 'q.fish5', category: 'games', event: 'fishCaught', target: 5, coins: 25, xp: 12, requires: Object.freeze({ minigame: 'fishingPond' }) }),
  Object.freeze({ id: 'q.dance150', category: 'games', event: 'score:danceParty', target: 150, coins: 30, xp: 15, requires: Object.freeze({ minigame: 'danceParty' }) }),
  Object.freeze({ id: 'q.tricks5', category: 'games', event: 'tricks:trampoline', target: 5, coins: 25, xp: 12, requires: Object.freeze({ minigame: 'trampoline' }) }),
  Object.freeze({ id: 'q.golfPar', category: 'games', event: 'score:miniGolf', target: 70, coins: 30, xp: 15, requires: Object.freeze({ minigame: 'miniGolf' }) }),
  Object.freeze({ id: 'q.says6', category: 'games', event: 'round:goobySays', target: 6, coins: 25, xp: 12, requires: Object.freeze({ minigame: 'goobySays' }) }),
  Object.freeze({ id: 'q.plant2', category: 'garden', event: 'plant', target: 2, coins: 20, xp: 10, requires: Object.freeze({ garden: true }) }),
  Object.freeze({ id: 'q.water4', category: 'garden', event: 'water', target: 4, coins: 20, xp: 10, requires: Object.freeze({ garden: true }) }),
  Object.freeze({ id: 'q.harvest2', category: 'garden', event: 'harvest', target: 2, coins: 30, xp: 15, requires: Object.freeze({ garden: true }) }),
  Object.freeze({ id: 'q.sell1', category: 'garden', event: 'sell', target: 1, coins: 15, xp: 8, requires: Object.freeze({ garden: true }) }),
  Object.freeze({ id: 'q.drive1', category: 'economy', event: 'shopTrip', target: 1, coins: 30, xp: 15, requires: null }),
  Object.freeze({ id: 'q.cleanDrive', category: 'economy', event: 'cleanDrive', target: 1, coins: 35, xp: 15, requires: null }),
  Object.freeze({ id: 'q.deliver3', category: 'economy', event: 'deliver', target: 3, coins: 30, xp: 15, requires: Object.freeze({ minigame: 'deliveryRush' }) }),
  Object.freeze({ id: 'q.buyFood1', category: 'economy', event: 'buyFood', target: 1, coins: 15, xp: 8, requires: null }),
  Object.freeze({ id: 'q.photo1', category: 'economy', event: 'photo', target: 1, coins: 20, xp: 10, requires: null }),
]);

/**
 * Sticker collections (§C6 verbatim): 4 sets, 32 entries, completion rewards.
 * Reward furniture ids are procedural deco ('proc:*' — §C6 reward column);
 * set completion additionally grants LEVELING.XP_SET_COMPLETE XP (§C5.2).
 */
export const COLLECTIONS = Object.freeze({
  SETS: Object.freeze([
    Object.freeze({
      id: 'fish',
      entries: Object.freeze(['sunnyCarp', 'blueDace', 'pinkKoi', 'stripeBass', 'tinyMinnow', 'bigWhopper', 'nightEel', 'goldenFish']),
      reward: Object.freeze({ coins: 200, furniture: 'proc:goldfishBowl' }),
    }),
    Object.freeze({
      id: 'veggies',
      entries: Object.freeze(['radish', 'carrot', 'salad', 'tomato', 'corn', 'eggplant', 'pumpkin', 'watermelon']),
      reward: Object.freeze({ coins: 150, furniture: 'proc:goldenWateringCan' }),
    }),
    Object.freeze({
      id: 'landmarks',
      entries: Object.freeze(['shop', 'vetClinic', 'fountain', 'skyTower', 'parkGazebo', 'windmillCafe']),
      reward: Object.freeze({ coins: 150, furniture: 'proc:toyCity' }),
    }),
    Object.freeze({
      id: 'treats',
      entries: Object.freeze(['donut-sprinkles', 'cupcake', 'ice-cream', 'cake', 'cookie', 'candy-bar', 'lollypop', 'sundae', 'chocolate', 'muffin']),
      reward: Object.freeze({ coins: 150, furniture: 'proc:candyJar' }),
    }),
  ]),
});

/**
 * Fur-color skins (§C8.5 verbatim): BODY / BELLY / EAR_INNER material colors.
 * 'golden' additionally gets subtle metalness 0.25. Shop tab from L5
 * (UNLOCKS.SKINS); 'cream' is the free default everyone owns.
 */
export const SKIN_TABLE = Object.freeze({
  cream: Object.freeze({ body: '#F6EAD7', belly: '#FFF9EC', earInner: '#F6A8B8', price: 0 }),
  snow: Object.freeze({ body: '#FAFAFA', belly: '#FFFFFF', earInner: '#F2B8C6', price: 400 }),
  caramel: Object.freeze({ body: '#D9A86C', belly: '#F2DDBD', earInner: '#E89AAB', price: 400 }),
  ash: Object.freeze({ body: '#B9B4AE', belly: '#E8E4DE', earInner: '#E0A2B4', price: 500 }),
  rose: Object.freeze({ body: '#F4C6D2', belly: '#FBE8EE', earInner: '#E88BA0', price: 600 }),
  midnight: Object.freeze({ body: '#4C4A63', belly: '#8B89A6', earInner: '#C98BA8', price: 800 }),
  golden: Object.freeze({ body: '#E8C24A', belly: '#F7E6A6', earInner: '#F0A8B8', price: 1500, metalness: 0.25 }),
});

/**
 * Day/night light & sky parameter table (§C10.2 verbatim). Band hour
 * boundaries + crossfade math live in systems/dayNight.js (§B4/§E0.1-2);
 * roomManager.setAmbience/gfx apply these values per band. `sky2` is the
 * lower stop of a gradient dome where present. Night dir = moonlight.
 */
export const DAYNIGHT = Object.freeze({
  day: Object.freeze({
    hemiSky: '#fff5e8', hemiGround: '#b8a898', hemiIntensity: 0.90,
    dirColor: '#fff2dd', dirIntensity: 1.10,
    sky: '#AEE0F7',
  }),
  dusk: Object.freeze({
    hemiSky: '#ffd9b8', hemiGround: '#8a7f95', hemiIntensity: 0.75,
    dirColor: '#ffb98a', dirIntensity: 0.70,
    sky: '#FFB38A', sky2: '#C98BB8',
    lampsOn: true, lampColor: '#FFD9A0', lampIntensity: 0.5,
  }),
  night: Object.freeze({
    hemiSky: '#4a5a8a', hemiGround: '#202535', hemiIntensity: 0.50,
    dirColor: '#9FB2E8', dirIntensity: 0.15,
    sky: '#1D2440', stars: true, moon: true,
    lampsOn: true, lampColor: '#FFD9A0', lampIntensity: 0.5,
  }),
  dawn: Object.freeze({
    hemiSky: '#ffe9d0', hemiGround: '#9a92a0', hemiIntensity: 0.80,
    dirColor: '#ffd9b0', dirIntensity: 0.85,
    sky: '#FFD9A8', birdsong: true,
  }),
});

/**
 * Weather model params (§C11.1): 6-hour local blocks, deterministic hash pick
 * clear 55% / cloudy 25% / rain 20% (same weather for everyone on the same
 * local date+block). The hash recipe itself is locked inside
 * systems/weather.js (§B4/§E0.1-2). Effect multipliers per §C11.2.
 */
export const WEATHER = Object.freeze({
  BLOCK_HOURS: 6,
  P_CLEAR: 0.55,
  P_CLOUDY: 0.25,
  P_RAIN: 0.20,
  CLOUDY_LIGHT_MULT: 0.85,
  RAIN_LIGHT_MULT: 0.70,
  /** Instanced rain quad pool (garden), 1 draw call (§A2.3/§C11.2). */
  RAIN_POOL: 300,
});

/** Vet clinic prices & effects (§C3.5/§C9.2). */
export const VET = Object.freeze({
  /** Full cure from any state: junk/neglect reset, +10 all stats (clamped). */
  CURE_PRICE: 120,
  CURE_STAT_BONUS: 10,
  /** Health report card + neglectMin reset; available anytime. */
  CHECKUP_PRICE: 30,
  /** Coin pickups on the vet route: 10 instead of the shop trip's 20 (§C9.2). */
  ROUTE_PICKUP_COUNT: 10,
});

/** Photo mode (§C12.2): capture canvas 1080×1440 (3:4), +1 XP capped 5/day. */
export const PHOTO = Object.freeze({
  CANVAS_W: 1080,
  CANVAS_H: 1440,
  XP_PER_PHOTO: 1,
  XP_DAILY_CAP: 5,
});

/** Non-food consumable item prices (§C3.5/§C2.2): Care row in the shop. */
export const ITEM_PRICES = Object.freeze({
  medicine: 40,
  fertilizer: 25,
});

// ============================================================== end V2/G16 ==
