// GOOBY design constants — every number in PLAN.md §C lives here (single source of
// truth at runtime; PLAN.md §C is binding). Pure data: no three.js, no DOM imports.
// All objects are frozen. Never inline these numbers elsewhere.

/** Save schema / persistence (§E3). */
export const SAVE = Object.freeze({
  VERSION: 1,
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
  IDS: Object.freeze({ wake: 1, hunger: 2, fun: 3, hygiene: 4, daily: 5 }),
  /** Max scheduled notifications (one per id). */
  MAX_SCHEDULED: 5,
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
  'donut-sprinkles': Object.freeze({ price: 12, hunger: 10, fun: 10 }),
  cupcake: Object.freeze({ price: 14, hunger: 8, fun: 12 }),
  salad: Object.freeze({ price: 14, hunger: 20, fun: 0, hygiene: 2 }),
  'ice-cream': Object.freeze({ price: 16, hunger: 6, fun: 15, energy: 5 }),
  sandwich: Object.freeze({ price: 16, hunger: 24, fun: 3 }),
  'hot-dog': Object.freeze({ price: 18, hunger: 25, fun: 4 }),
  pancakes: Object.freeze({ price: 20, hunger: 28, fun: 6 }),
  burger: Object.freeze({ price: 25, hunger: 40, fun: 6 }),
  pizza: Object.freeze({ price: 30, hunger: 45, fun: 8, hygiene: -2 }),
  cake: Object.freeze({ price: 40, hunger: 30, fun: 20 }),
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
