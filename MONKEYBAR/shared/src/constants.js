// MONKEYBAR shared rules constants — PLAN.md §4 values live HERE (binding contract).

// ---- Turn timer (seconds) ----
export const TURN_SECONDS_DEFAULT = 25;
export const TURN_SECONDS_MIN = 15;
export const TURN_SECONDS_MAX = 45;

// ---- Timing windows (milliseconds) ----
/** Victim's decision window during the `penalty` phase (may spend Lucky Banana Chip). */
export const PENALTY_WINDOW_MS = 5000;
/** Intermission between `roundEnd` and the next `roundStart`. */
export const ROUND_INTERMISSION_MS = 5000;
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
export const START_CHAMBERS = 6;
/** Each player starts the match with this many coconuts in the cannon. */
export const START_COCONUTS = 1;
/** Lucky Banana Chip adds this many temporary chambers to a single shot. */
export const CHIP_BONUS_CHAMBERS = 2;
/** Lucky Banana Chips granted per match. */
export const CHIPS_PER_MATCH = 1;

// ---- Deck & hand (§4.1) ----
/** Cards dealt to every living player each round. */
export const HAND_SIZE = 5;
/** Maximum cards in a single PLAY. */
export const MAX_PLAY = 3;
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
