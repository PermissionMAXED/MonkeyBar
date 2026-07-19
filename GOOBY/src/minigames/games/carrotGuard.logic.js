// Carrot Guard — pure timing/steal/combo logic (§C6.1 #4, agent G8). No
// three.js/DOM imports (§B rule); the game module (carrotGuard.js) imports
// from here. Binding §C6.1 numbers: 3×3 mounds, moles pop 0.9 s → 0.5 s ramp,
// 10 carrots to steal, hit +1, combo ≥5 → +3 bonus, ends at 45 s or all
// carrots gone. Coin row (§C6): divisor 3, min 4, max 25, typical ≈ 45 → ~15c.

/** Binding §C6.1 #4 numbers + G8 tuning (spawn cadence, double-mole odds). */
export const GUARD = Object.freeze({
  /** Round length (§C6.1: 45 s or all carrots gone). */
  DURATION_SEC: 45,
  /** Mole grid (§C6.1: 3×3 dirt mounds). */
  GRID: 3,
  /** Carrot stock (§C6.1: 10 carrots). */
  CARROTS: 10,
  /** Mole up-time ramps 0.9 s → 0.5 s across the round (§C6.1). */
  UP_TIME_START: 0.9,
  UP_TIME_END: 0.5,
  /** Hit reward and combo rule (§C6.1: hit +1; combo ≥5 → +3 bonus). */
  HIT_POINTS: 1,
  COMBO_BONUS_AT: 5,
  COMBO_BONUS: 3,
  /** G8 tuning: seconds between mole spawns (ramps down), double-mole odds. */
  SPAWN_START_SEC: 1.3,
  SPAWN_END_SEC: 0.75,
  /** Chance a spawn brings a second simultaneous mole (0 → this by round end). */
  DOUBLE_CHANCE_END: 0.35,
  /** Mole pop-up / duck-down animation time (s) on top of the up-time. */
  POP_SEC: 0.16,
  /** V3 §C10.2 mole king: after every 20 regular bonks, three taps. */
  KING_EVERY_BONKS: 20,
  KING_TAPS: 3,
  KING_POINTS: 8,
  KING_COIN_DROP: 2,
  /** Two raw score points use the game's divisor-3 coin row. */
  KING_SCORE_PER_COIN: 3,
  /** Reject duplicate pointer/tap delivery and throttle empty-mound spam. */
  TAP_DEBOUNCE_SEC: 0.075,
  WHIFF_COOLDOWN_SEC: 0.18,
  /** V4/G71 §G5 timed-arena defaults (Mittel identity). */
  SPAWN_INTERVAL_MULT: 1,
  WINDOW_MULT: 1,
  DURATION_MULT: 1,
  ENDLESS: false,
  ENDLESS_STOLEN: 3,
  BOT_REACTION_SEC: 0.34,
});

export const GUARD_DIFFICULTY = Object.freeze({
  easy: Object.freeze({ spawn: 1.2, window: 1.25, duration: 1.2, endless: false }),
  normal: Object.freeze({ spawn: 1, window: 1, duration: 1, endless: false }),
  hard: Object.freeze({ spawn: 0.85, window: 0.8, duration: 1, endless: false }),
  endless: Object.freeze({ spawn: 0.85, window: 0.8, duration: 1, endless: true }),
});

export function applyDifficulty(tune = GUARD, mode = 'normal') {
  const id = Object.hasOwn(GUARD_DIFFICULTY, mode) ? mode : 'normal';
  if (id === 'normal') return tune;
  const row = GUARD_DIFFICULTY[id];
  return Object.freeze({
    ...tune,
    DURATION_SEC: tune.DURATION_SEC * row.duration,
    SPAWN_START_SEC: tune.SPAWN_START_SEC * row.spawn,
    SPAWN_END_SEC: tune.SPAWN_END_SEC * row.spawn,
    UP_TIME_START: Math.max(0.35, tune.UP_TIME_START * row.window),
    UP_TIME_END: Math.max(0.35, tune.UP_TIME_END * row.window),
    SPAWN_INTERVAL_MULT: row.spawn,
    WINDOW_MULT: row.window,
    DURATION_MULT: row.duration,
    ENDLESS: row.endless,
    BOT_REACTION_SEC: Math.min(tune.BOT_REACTION_SEC, Math.max(0.24, tune.BOT_REACTION_SEC * row.window)),
    MODE: id,
  });
}

/**
 * How long a mole stays up at a moment of the round: linear 0.9 s → 0.5 s
 * (§C6.1 ramp).
 * @param {number} elapsed seconds since round start
 * @param {number} [duration]
 * @returns {number} seconds
 */
export function upTimeAt(elapsed, duration = GUARD.DURATION_SEC, tune = GUARD) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return tune.UP_TIME_START + (tune.UP_TIME_END - tune.UP_TIME_START) * t;
}

/**
 * Seconds until the next mole spawn (cadence tightens across the round).
 * @param {number} elapsed seconds
 * @param {number} [duration]
 * @returns {number} seconds
 */
export function spawnIntervalAt(elapsed, duration = GUARD.DURATION_SEC, tune = GUARD) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return tune.SPAWN_START_SEC + (tune.SPAWN_END_SEC - tune.SPAWN_START_SEC) * t;
}

/**
 * Chance that a spawn is a double (two moles at once) at a round moment.
 * @param {number} elapsed seconds
 * @param {number} [duration]
 * @returns {number} 0 … DOUBLE_CHANCE_END
 */
export function doubleChanceAt(elapsed, duration = GUARD.DURATION_SEC, tune = GUARD) {
  const t = Math.min(1, Math.max(0, elapsed / duration));
  return tune.DOUBLE_CHANCE_END * t;
}

/**
 * Combo bonus check (§C6.1: combo ≥5 → +3): the bonus pays each time the
 * streak reaches a MULTIPLE of 5 (5, 10, 15…), not on every hit past 5.
 * @param {number} combo streak length AFTER the current hit
 * @returns {number} 0 or +3
 */
export function comboBonus(combo) {
  return combo > 0 && combo % GUARD.COMBO_BONUS_AT === 0 ? GUARD.COMBO_BONUS : 0;
}

/**
 * Apply a successful bonk: +1 point, streak +1, +3 bonus at every 5-streak
 * (§C6.1).
 * @param {{score: number, combo: number}} s
 * @returns {{score: number, combo: number, bonus: number}}
 */
export function applyBonk(s) {
  const combo = s.combo + 1;
  const bonus = comboBonus(combo);
  return { score: s.score + GUARD.HIT_POINTS + bonus, combo, bonus };
}

/**
 * Apply an escaped mole: it steals one carrot and the combo resets (§C6.1).
 * @param {{carrots: number, combo: number}} s
 * @returns {{carrots: number, combo: number}}
 */
export function applyEscape(s) {
  return { carrots: Math.max(0, s.carrots - 1), combo: 0 };
}

/**
 * A whiffed tap (no mole under the mallet) just resets the streak — no point
 * loss, but it keeps mound-spamming from farming combo bonuses.
 * @param {{combo: number}} s
 * @returns {{combo: number}}
 */
export function applyWhiff(s) {
  return { combo: 0 };
}

/**
 * Round-over check (§C6.1: 45 s or all carrots gone).
 * @param {{elapsed: number, carrots: number}} s
 * @param {number} [duration]
 * @returns {boolean}
 */
export function isRoundOver(s, duration = GUARD.DURATION_SEC, tune = GUARD) {
  if (tune.ENDLESS) return tune.CARROTS - s.carrots >= tune.ENDLESS_STOLEN;
  return s.elapsed >= duration || s.carrots <= 0;
}

/**
 * A king is queued after each block of 20 completed regular bonks.
 * @param {number} bonks regular bonks this run
 * @param {number} kingsSpawned
 * @returns {boolean}
 */
export function isKingDue(bonks, kingsSpawned) {
  return bonks >= (kingsSpawned + 1) * GUARD.KING_EVERY_BONKS;
}

/**
 * Resolve one accepted king tap. Only tap three completes the bonk and pays
 * +8 plus score equivalent to two coins (2 × divisor 3).
 * @param {{score:number, combo:number, hp:number}} state
 * @returns {{score:number, combo:number, hp:number, complete:boolean, bonus:number, gained:number}}
 */
export function applyKingTap(state) {
  const hp = Math.max(0, state.hp - 1);
  if (hp > 0) {
    return { ...state, hp, complete: false, bonus: 0, gained: 0 };
  }
  const combo = state.combo + 1;
  const bonus = comboBonus(combo);
  const gained = GUARD.KING_POINTS + GUARD.KING_COIN_DROP * GUARD.KING_SCORE_PER_COIN + bonus;
  return {
    score: state.score + gained,
    combo,
    hp: 0,
    complete: true,
    bonus,
    gained,
  };
}

/**
 * Shared debounce audit surface for simultaneous taps and whiff spam.
 * @param {number} sinceLastSec
 * @param {number} cooldownSec
 * @returns {boolean}
 */
export function acceptsTapAfter(sinceLastSec, cooldownSec = GUARD.TAP_DEBOUNCE_SEC) {
  return sinceLastSec === Infinity ||
    (Number.isFinite(sinceLastSec) && sinceLastSec >= cooldownSec);
}

/** Deterministic certification model for the live reaction bot. */
export function simulateGuardAutoplay(mode = 'normal', seed = 1) {
  const tune = applyDifficulty(GUARD, mode);
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) | 0;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const accuracy = mode === 'easy' ? 0.96 : mode === 'hard' || mode === 'endless' ? 0.82 : 0.93;
  let elapsed = 0;
  let carrots = tune.CARROTS;
  let state = { score: 0, combo: 0 };
  while (!isRoundOver({ elapsed, carrots }, tune.DURATION_SEC, tune) && elapsed < 240) {
    const count = 1 + (rng() < doubleChanceAt(elapsed, tune.DURATION_SEC, tune) ? 1 : 0);
    for (let i = 0; i < count; i += 1) {
      if (rng() < accuracy) state = applyBonk(state);
      else {
        const escaped = applyEscape({ carrots, combo: state.combo });
        carrots = escaped.carrots;
        state = { ...state, combo: escaped.combo };
      }
    }
    elapsed += spawnIntervalAt(elapsed, tune.DURATION_SEC, tune);
  }
  return { score: state.score, elapsed, stolen: tune.CARROTS - carrots };
}
