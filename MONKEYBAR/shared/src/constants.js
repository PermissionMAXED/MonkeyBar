// MONKEYBAR shared rules constants — PLAN.md §4 values live HERE (binding contract).

// ---- Turn timer (seconds) ----
export const TURN_SECONDS_DEFAULT = 15;
export const TURN_SECONDS_MIN = 10;
export const TURN_SECONDS_MAX = 45;

// ---- Timing windows (milliseconds) ----
/** Victim's decision window during the `penalty` phase (may spend Lucky Banana Chip). */
export const PENALTY_WINDOW_MS = 5000;
/** Intermission between `roundEnd` and the next `roundStart`. */
export const ROUND_INTERMISSION_MS = 3000;
/** How long a disconnected in-match player's seat is held before converting to a bot. */
export const RECONNECT_HOLD_MS = 60000;
/** Quickmatch: server fills remaining seats with bots after this delay. */
export const QUICKMATCH_FILL_DELAY_MS = 5000;
/** Connected humans who let this many turns time out are kicked (seat → bot). */
export const AFK_MISSED_TURNS_LIMIT = 2;
/** Connections with no ping/traffic for this long are culled. */
export const HEARTBEAT_CULL_MS = 30000;
/** Clients send `ping` at this interval. */
export const PING_INTERVAL_MS = 10000;

// ---- Coconut Cannon (§4.2) ----
/** Each player starts the match with this many cannon chambers. */
export const START_CHAMBERS = 4;
/** Each player starts the match with this many coconuts in the cannon. */
export const START_COCONUTS = 1;
/** Lucky Banana Chip adds this many temporary chambers to a single shot. */
export const CHIP_BONUS_CHAMBERS = 2;
/** Lucky Banana Chips granted per match. */
export const CHIPS_PER_MATCH = 1;

// ---- Deck & hand (§4.1) ----
/** Cards dealt to every living player each round. */
export const HAND_SIZE = 5;
/** Maximum cards in a single PLAY (stock Monkey Lies rules). */
export const MAX_PLAY = 3;
/**
 * Protocol-level HARD cap on a play's cardIds — the outer wire safety bound.
 * Custom Chaos can raise a room's maxPlay above the stock MAX_PLAY (up to
 * CHAOS_KNOB_SCHEMA.maxPlay.max in chaos.js — keep the two in sync), so the
 * `play` validator admits up to this many cards; the ENGINE enforces each
 * room's actual per-mode/per-knob limit.
 */
export const MAX_PLAY_HARD = 4;
/** Minimum cards in a single PLAY. */
export const MIN_PLAY = 1;
/** Each non-wild fruit makes up floor(P × HAND_SIZE × DECK_FRUIT_RATIO) of the deck. */
export const DECK_FRUIT_RATIO = 0.3;

// ---- Table size ----
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;

// ---- Rate limits (§3) ----
/** Max chat message length (chars). */
export const CHAT_MAX_LENGTH = 120;
/** Minimum interval between chat / quickPhrase messages (ms) — "1/s". */
export const CHAT_RATE_LIMIT_MS = 1000;
/** Minimum interval between emotes (ms) — "1 / 2 s". */
export const EMOTE_RATE_LIMIT_MS = 2000;
/** General per-connection message ceiling (messages per second) before RATE_LIMIT errors. */
export const MSG_RATE_LIMIT_PER_SEC = 20;

// ---- Misc limits ----
/** Max player name length (chars). */
export const NAME_MAX_LENGTH = 20;
/** Private room join codes are this many characters. */
export const ROOM_CODE_LENGTH = 4;
/** Max `modeAction` verb length (chars) — §10.1. */
export const MODE_ACTION_MAX_LENGTH = 32;

// ===========================================================================
// 1.0 additions — RELEASE_PLAN.md §B.4 / PLAN.md §10 (all values additive;
// nothing above this line changed for 1.0).
// ===========================================================================

// ---- Economy: Banana Coins + XP (§10.4) ----
/** Coins per match by final place (`other` = 4th and below). */
export const COIN_REWARDS = Object.freeze({ 1: 60, 2: 35, 3: 25, other: 15 });
/** Bonus coins per successful "MONKEY LIES!" call (and mode equivalents). */
export const COIN_PER_GOOD_CALL = 2;
/** Bonus coins per cannon shot survived. */
export const COIN_PER_SURVIVED_SHOT = 2;
/** XP for finishing a match in last place. */
export const XP_BASE = 40;
/** Extra XP per place climbed above last. */
export const XP_PER_PLACE_STEP = 15;
/** Level cap — xpToNext is irrelevant at the cap. */
export const LEVEL_CAP = 50;
/** Matches shorter than this many rounds pay no rewards (anti-farm). */
export const REWARD_MIN_ROUNDS = 2;

/**
 * XP needed to advance FROM `level` to `level + 1`: 100 + 50×level.
 * @param {number} level
 * @returns {number}
 */
export function xpToNext(level) {
  return 100 + 50 * level;
}

// ---- Banana Dice (§10.4) ----
/** Dice each player starts the match with. */
export const DICE_START = 5;

// ---- Coconut Roulette (§10.4) ----
/** Chips each player starts the match with (roulette semantics). */
export const ROULETTE_START_CHIPS = 3;
/** Explosion probability of the very first shake. */
export const ROULETTE_BASE_P = 0.08;
/** Explosion probability added per completed shake. */
export const ROULETTE_STEP_P = 0.06;

// ---- Jungle Poker (§10.4) ----
/** Banana-chip stack each player starts the match with. */
export const POKER_START_STACK = 10;
/** Forced ante per hand. */
export const POKER_ANTE = 1;
/** Max raises per betting round. */
export const POKER_MAX_RAISES = 2;
/** Stack refund after busting (you play on until the cannon settles it). */
export const POKER_BUST_REFUND = 3;
