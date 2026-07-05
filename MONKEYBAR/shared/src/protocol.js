// MONKEYBAR wire protocol — PLAN.md §3 (binding contract).
// Wire format: JSON text frames, envelope { "t": "<type>", "p": { ...payload } }.
// Client game actions carry `aid` (client-generated id) echoed by the server in `actionAck`.

import {
  CHAT_MAX_LENGTH,
  MAX_PLAY_HARD,
  MAX_PLAYERS,
  MIN_PLAY,
  MIN_PLAYERS,
  MODE_ACTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  TURN_SECONDS_MAX,
  TURN_SECONDS_MIN,
} from './constants.js';

// ---------------------------------------------------------------------------
// §3.1 Shared shapes (JSDoc typedefs)
// ---------------------------------------------------------------------------

/**
 * @typedef {"banana"|"coconut"|"mango"|"golden"} Fruit
 */

/**
 * A playing card. `fruit` is present only in your own hand / reveals.
 * @typedef {Object} Card
 * @property {string} id
 * @property {Fruit} fruit
 */

/**
 * Equipped cosmetic ids per slot (§10.3) — equipped ids only, never the
 * full inventory. Ids come from `shared/cosmetics.js`.
 * @typedef {Object} EquippedCosmetics
 * @property {string} [hat]
 * @property {string} [skin]
 * @property {string} [table]
 * @property {string} [deco]
 */

/**
 * @typedef {Object} MemberInfo
 * @property {string} id
 * @property {string} name
 * @property {string} monkeyId
 * @property {boolean} ready
 * @property {boolean} isBot
 * @property {string} [personality]
 * @property {boolean} isHost
 * @property {EquippedCosmetics} [cosmetics]   §10.3
 */

/**
 * @typedef {Object} RoomSummary
 * @property {string} id
 * @property {string} name
 * @property {string} mode
 * @property {boolean} isPrivate
 * @property {number} playerCount
 * @property {number} maxPlayers
 * @property {boolean} inGame
 */

/**
 * @typedef {Object} RoomSettings
 * @property {number} turnSeconds
 * @property {string} mapId
 * @property {import('./chaos.js').ChaosKnobs} [chaos]   §10.3 — only when mode === 'customChaos'
 */

/**
 * @typedef {Object} RoomState
 * @property {string} id
 * @property {string} name
 * @property {string} [code]   4-char join code (private rooms only)
 * @property {string} hostId
 * @property {string} mode
 * @property {boolean} isPrivate
 * @property {number} maxPlayers
 * @property {boolean} botFill
 * @property {RoomSettings} settings
 * @property {MemberInfo[]} members
 * @property {number} spectatorCount
 */

/**
 * Per-mode seat fields (§10.3): `dice` (bananaDice), `stack`/`bet`/`folded`
 * (junglePoker). In coconutRoulette, `chips` carries roulette semantics
 * (earn on SHAKE, pay on PASS) instead of Lucky Banana Chips.
 * @typedef {Object} SeatPublic
 * @property {number} seat
 * @property {string} playerId
 * @property {string} name
 * @property {string} monkeyId
 * @property {boolean} isBot
 * @property {boolean} connected
 * @property {boolean} alive
 * @property {number} handCount
 * @property {number} chips
 * @property {number} chambersLeft
 * @property {EquippedCosmetics} [cosmetics]   §10.3
 * @property {number} [dice]      bananaDice: dice left under the shell
 * @property {number} [stack]     junglePoker: banana-chip stack
 * @property {number} [bet]       junglePoker: chips bet this hand
 * @property {boolean} [folded]   junglePoker
 */

/**
 * Game phase. Mode-scoped (§10.3): the listed set is Monkey Lies'; other
 * modes define their own strings — clients must not assume the ML set.
 * @typedef {"dealing"|"playing"|"revealing"|"penalty"|"roundEnd"|"matchEnd"|string} GamePhase
 */

/**
 * Snapshot base — the fields EVERY mode's snapshot carries (§10.3).
 * Spectators: yourSeat=null. Mode-specific snapshots extend this base:
 * {@link Snapshot} (monkeyLies), {@link BananaDiceSnapshot},
 * {@link CoconutRouletteSnapshot}, {@link JunglePokerSnapshot},
 * {@link KingOfTheBarSnapshot}, {@link CustomChaosSnapshot}.
 * @typedef {Object} SnapshotBase
 * @property {string} mode
 * @property {string} mapId
 * @property {GamePhase} phase
 * @property {number} roundNo
 * @property {SeatPublic[]} seats
 * @property {number} turnSeat
 * @property {number} deadline           epoch ms
 * @property {number|null} yourSeat
 */

/**
 * Full Monkey Lies game snapshot = SnapshotBase + the ML extension
 * (spectators: yourSeat=null, yourHand=null).
 * `lastHolder` and `penalty` are public info: whether the current turn is a
 * pending Last-Monkey-Holding turn, and the active penalty window (if any).
 * @typedef {Object} Snapshot
 * @property {string} mode
 * @property {string} mapId
 * @property {GamePhase} phase
 * @property {number} roundNo
 * @property {Fruit} tableFruit
 * @property {SeatPublic[]} seats
 * @property {number} turnSeat
 * @property {number} deadline           epoch ms
 * @property {{seat: number, count: number}|null} lastPlay
 * @property {boolean} lastHolder
 * @property {{seat: number, chambers: number, coconuts: number, chipUsable: boolean, deadline: number}|null} penalty
 * @property {number|null} yourSeat
 * @property {Card[]|null} yourHand
 * @property {boolean} chipUsedByYou
 */

/**
 * Banana Dice snapshot extension (§10.3). Per-seat: `SeatPublic.dice`.
 * @typedef {SnapshotBase & {
 *   yourDice: number[]|null,
 *   bid: {seat: number, count: number, face: number}|null,
 *   totalDice: number,
 *   penalty: {seat: number, chambers: number, coconuts: number, chipUsable: boolean, deadline: number}|null,
 * }} BananaDiceSnapshot
 */

/**
 * Coconut Roulette snapshot extension (§10.3). Per-seat: `SeatPublic.chips`
 * carries roulette semantics.
 * @typedef {SnapshotBase & {
 *   bomb: {holderSeat: number, shakes: number, pExplode: number}|null,
 * }} CoconutRouletteSnapshot
 */

/**
 * Jungle Poker snapshot extension (§10.3). Per-seat: `SeatPublic.stack`,
 * `.bet`, `.folded`.
 * @typedef {SnapshotBase & {
 *   pot: number,
 *   toCall: number,
 *   yourCards: import('./poker.js').PokerCard[]|null,
 *   penalty: {seat: number, chambers: number, coconuts: number, chipUsable: boolean, deadline: number}|null,
 * }} JunglePokerSnapshot
 */

/**
 * King of the Bar snapshot = the full ML extension + the active Bar Rule (§10.3).
 * @typedef {Snapshot & {
 *   barRule: {ruleId: string, name: string, desc: string}|null,
 * }} KingOfTheBarSnapshot
 */

/**
 * Custom Chaos snapshot = the full ML extension + the active knobs (§10.3).
 * @typedef {Snapshot & {
 *   knobs: import('./chaos.js').ChaosKnobs,
 * }} CustomChaosSnapshot
 */

/**
 * Player profile payload (§10.2) — sent right after `welcome`, on
 * `getProfile`, and after any buy/equip/reward.
 * @typedef {Object} Profile
 * @property {string} playerId
 * @property {number} coins
 * @property {number} xp            progress into the current level
 * @property {number} level
 * @property {number} xpToNext
 * @property {number} wins
 * @property {number} matches
 * @property {string[]} unlocked    owned cosmetic ids
 * @property {EquippedCosmetics} equipped
 * @property {{perMode: Record<string, {plays: number, wins: number}>}} stats
 */

/**
 * Match rewards payload (§10.2) — PRIVATE, per human seat, right after `matchEnd`.
 * @typedef {Object} Rewards
 * @property {number} coins
 * @property {number} xp
 * @property {number} levelUps
 * @property {number} newLevel
 * @property {Array<{reason: string, coins: number, xp: number}>} breakdown
 */

/**
 * @typedef {Object} Envelope
 * @property {string} t   message type (one of MSG)
 * @property {Object} p   payload
 */

// ---------------------------------------------------------------------------
// Message type constants
// ---------------------------------------------------------------------------

/**
 * Every message type on the wire, client→server (§3.2) and server→client (§3.3).
 * `chat`, `quickPhrase`, and `emote` flow in both directions with the same type.
 */
export const MSG = Object.freeze({
  // ---- client → server (§3.2) ----
  HELLO: 'hello',
  SET_PROFILE: 'setProfile',
  LIST_ROOMS: 'listRooms',
  CREATE_ROOM: 'createRoom',
  JOIN_ROOM: 'joinRoom',
  LEAVE_ROOM: 'leaveRoom',
  QUICK_MATCH: 'quickMatch',
  CANCEL_QUICK: 'cancelQuick',
  READY: 'ready',
  SELECT_MONKEY: 'selectMonkey',
  ADD_BOT: 'addBot',
  REMOVE_BOT: 'removeBot',
  UPDATE_SETTINGS: 'updateSettings',
  START_GAME: 'startGame',
  PLAY: 'play',
  CALL_LIAR: 'callLiar',
  USE_CHIP: 'useChip',
  FIRE_CANNON: 'fireCannon',
  CHAT: 'chat',
  QUICK_PHRASE: 'quickPhrase',
  EMOTE: 'emote',
  SPECTATE: 'spectate',
  STOP_SPECTATE: 'stopSpectate',
  PING: 'ping',
  // 1.0 additions (§10.1)
  MODE_ACTION: 'modeAction',
  GET_PROFILE: 'getProfile',
  BUY_COSMETIC: 'buyCosmetic',
  EQUIP_COSMETIC: 'equipCosmetic',

  // ---- server → client (§3.3) ----
  WELCOME: 'welcome',
  ERROR: 'error',
  ACTION_ACK: 'actionAck',
  ROOM_LIST: 'roomList',
  ROOM_STATE: 'roomState',
  LEFT_ROOM: 'leftRoom',
  MATCH_FOUND: 'matchFound',
  GAME_START: 'gameStart',
  STATE: 'state',
  HAND: 'hand',
  ROUND_START: 'roundStart',
  TURN: 'turn',
  PLAYED: 'played',
  CALLED: 'called',
  REVEAL: 'reveal',
  LAST_HOLDER: 'lastHolder',
  PENALTY: 'penalty',
  CHIP_USED: 'chipUsed',
  CANNON: 'cannon',
  ELIMINATED: 'eliminated',
  ROUND_END: 'roundEnd',
  MATCH_END: 'matchEnd',
  CONN: 'conn',
  PONG: 'pong',
  // 1.0 additions (§10.2)
  MODE_EVENT: 'modeEvent',
  PROFILE: 'profile',
  REWARDS: 'rewards',
});

/** Error codes carried by `error` / `actionAck` messages (§3.3 + §10.2). */
export const ERROR_CODES = Object.freeze({
  BAD_MSG: 'BAD_MSG',
  NOT_FOUND: 'NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  NOT_HOST: 'NOT_HOST',
  BAD_STATE: 'BAD_STATE',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  INVALID_CARDS: 'INVALID_CARDS',
  RATE_LIMIT: 'RATE_LIMIT',
  NAME_INVALID: 'NAME_INVALID',
  NOT_PLAYABLE: 'NOT_PLAYABLE',
  // 1.0 additions (§10.2) — shop/economy failures
  CANT_AFFORD: 'CANT_AFFORD',
  LOCKED: 'LOCKED',
});

// ---------------------------------------------------------------------------
// Envelope / payload factory helpers
// ---------------------------------------------------------------------------

/**
 * Build a wire envelope.
 * @param {string} t
 * @param {Object} [p]
 * @returns {Envelope}
 */
export function makeMsg(t, p = {}) {
  return { t, p };
}

/**
 * Build and JSON-encode a wire envelope.
 * @param {string} t
 * @param {Object} [p]
 * @returns {string}
 */
export function encodeMsg(t, p = {}) {
  return JSON.stringify(makeMsg(t, p));
}

/** Client→server payload factories (each returns a ready-to-send {t,p} envelope). */
export const ClientMsg = Object.freeze({
  hello: ({ name, token } = {}) => makeMsg(MSG.HELLO, prune({ name, token })),
  setProfile: ({ name, monkeyId } = {}) => makeMsg(MSG.SET_PROFILE, prune({ name, monkeyId })),
  listRooms: () => makeMsg(MSG.LIST_ROOMS, {}),
  createRoom: ({ name, isPrivate = false, maxPlayers = MAX_PLAYERS, mode, botFill = true } = {}) =>
    makeMsg(MSG.CREATE_ROOM, prune({ name, isPrivate, maxPlayers, mode, botFill })),
  joinRoom: ({ roomId, code } = {}) => makeMsg(MSG.JOIN_ROOM, prune({ roomId, code })),
  leaveRoom: () => makeMsg(MSG.LEAVE_ROOM, {}),
  quickMatch: (mode) => makeMsg(MSG.QUICK_MATCH, { mode }),
  cancelQuick: () => makeMsg(MSG.CANCEL_QUICK, {}),
  ready: (ready) => makeMsg(MSG.READY, { ready: !!ready }),
  selectMonkey: (monkeyId) => makeMsg(MSG.SELECT_MONKEY, { monkeyId }),
  addBot: (personality) => makeMsg(MSG.ADD_BOT, prune({ personality })),
  removeBot: (botId) => makeMsg(MSG.REMOVE_BOT, { botId }),
  updateSettings: (patch) => makeMsg(MSG.UPDATE_SETTINGS, { patch }),
  startGame: () => makeMsg(MSG.START_GAME, {}),
  play: (aid, cardIds) => makeMsg(MSG.PLAY, { aid, cardIds }),
  callLiar: (aid) => makeMsg(MSG.CALL_LIAR, { aid }),
  useChip: (aid) => makeMsg(MSG.USE_CHIP, { aid }),
  fireCannon: (aid) => makeMsg(MSG.FIRE_CANNON, { aid }),
  chat: (text) => makeMsg(MSG.CHAT, { text }),
  quickPhrase: (phraseId) => makeMsg(MSG.QUICK_PHRASE, { phraseId }),
  emote: (emoteId) => makeMsg(MSG.EMOTE, { emoteId }),
  spectate: (roomId) => makeMsg(MSG.SPECTATE, { roomId }),
  stopSpectate: () => makeMsg(MSG.STOP_SPECTATE, {}),
  ping: (ts = Date.now()) => makeMsg(MSG.PING, { ts }),
  // 1.0 additions (§10.1)
  modeAction: (aid, action, data) => makeMsg(MSG.MODE_ACTION, prune({ aid, action, data })),
  getProfile: () => makeMsg(MSG.GET_PROFILE, {}),
  buyCosmetic: (itemId) => makeMsg(MSG.BUY_COSMETIC, { itemId }),
  equipCosmetic: (slot, itemId = null) => makeMsg(MSG.EQUIP_COSMETIC, { slot, itemId }),
});

/** Server→client payload factories (each returns a ready-to-send {t,p} envelope). */
export const ServerMsg = Object.freeze({
  welcome: ({ playerId, token, resumed, roster, modes, maps, emotes, quickPhrases }) =>
    makeMsg(MSG.WELCOME, { playerId, token, resumed, roster, modes, maps, emotes, quickPhrases }),
  error: (code, msg = '') => makeMsg(MSG.ERROR, { code, msg }),
  actionAck: (aid, ok, code) => makeMsg(MSG.ACTION_ACK, prune({ aid, ok, code })),
  roomList: (rooms) => makeMsg(MSG.ROOM_LIST, { rooms }),
  roomState: (room) => makeMsg(MSG.ROOM_STATE, { room }),
  leftRoom: (reason) => makeMsg(MSG.LEFT_ROOM, { reason }),
  matchFound: (roomId) => makeMsg(MSG.MATCH_FOUND, { roomId }),
  gameStart: (snapshot) => makeMsg(MSG.GAME_START, { snapshot }),
  state: (snapshot) => makeMsg(MSG.STATE, { snapshot }),
  hand: (cards) => makeMsg(MSG.HAND, { cards }),
  roundStart: ({ roundNo, tableFruit, firstSeat, seats }) =>
    makeMsg(MSG.ROUND_START, { roundNo, tableFruit, firstSeat, seats }),
  // `actions` (§10.3) = legal verbs this turn for modeAction modes; Monkey Lies omits it.
  turn: ({ seat, deadline, canCall, lastHolder, actions }) =>
    makeMsg(
      MSG.TURN,
      actions === undefined
        ? { seat, deadline, canCall, lastHolder }
        : { seat, deadline, canCall, lastHolder, actions }
    ),
  played: ({ seat, count, handCount }) => makeMsg(MSG.PLAYED, { seat, count, handCount }),
  called: ({ callerSeat, targetSeat }) => makeMsg(MSG.CALLED, { callerSeat, targetSeat }),
  reveal: ({ targetSeat, cards, lie, loserSeat }) =>
    makeMsg(MSG.REVEAL, { targetSeat, cards, lie, loserSeat }),
  lastHolder: (seat) => makeMsg(MSG.LAST_HOLDER, { seat }),
  penalty: ({ seat, chambers, coconuts, chipUsable, deadline }) =>
    makeMsg(MSG.PENALTY, { seat, chambers, coconuts, chipUsable, deadline }),
  chipUsed: ({ seat, chambersNow }) => makeMsg(MSG.CHIP_USED, { seat, chambersNow }),
  cannon: ({ seat, hit }) => makeMsg(MSG.CANNON, { seat, hit }),
  eliminated: (seat) => makeMsg(MSG.ELIMINATED, { seat }),
  roundEnd: (nextIn) => makeMsg(MSG.ROUND_END, { nextIn }),
  matchEnd: ({ winnerSeat, standings }) => makeMsg(MSG.MATCH_END, { winnerSeat, standings }),
  chat: ({ seat = null, name, text }) => makeMsg(MSG.CHAT, { seat, name, text }),
  quickPhrase: ({ seat, phraseId, name }) =>
    makeMsg(MSG.QUICK_PHRASE, prune({ seat, phraseId, name })),
  emote: ({ seat, emoteId, name }) => makeMsg(MSG.EMOTE, prune({ seat, emoteId, name })),
  conn: ({ seat, connected }) => makeMsg(MSG.CONN, { seat, connected }),
  pong: (ts, serverTs = Date.now()) => makeMsg(MSG.PONG, { ts, serverTs }),
  // 1.0 additions (§10.2)
  modeEvent: (kind, payload = {}) => makeMsg(MSG.MODE_EVENT, { kind, ...payload }),
  profile: ({ playerId, coins, xp, level, xpToNext, wins, matches, unlocked, equipped, stats }) =>
    makeMsg(MSG.PROFILE, {
      playerId, coins, xp, level, xpToNext, wins, matches, unlocked, equipped, stats,
    }),
  rewards: ({ coins, xp, levelUps, newLevel, breakdown }) =>
    makeMsg(MSG.REWARDS, { coins, xp, levelUps, newLevel, breakdown }),
});

/** Drop undefined keys so payloads stay tidy on the wire. */
function prune(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Client message validation (server-side first line of defense)
// ---------------------------------------------------------------------------

const isStr = (v) => typeof v === 'string';
const isBool = (v) => typeof v === 'boolean';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const optStr = (v) => v === undefined || isStr(v);

/** Valid display name: string, 1–NAME_MAX_LENGTH chars after trim. */
function validName(name) {
  return isStr(name) && name.trim().length >= 1 && name.length <= NAME_MAX_LENGTH;
}

/**
 * Per-type payload validators. Each returns `null` when the payload is OK,
 * or an error code string from {@link ERROR_CODES} when it is not.
 * @type {Record<string, (p: Object) => (string|null)>}
 */
const CLIENT_VALIDATORS = {
  [MSG.HELLO]: (p) => {
    if (p.name !== undefined && !validName(p.name)) return ERROR_CODES.NAME_INVALID;
    if (!optStr(p.token)) return ERROR_CODES.BAD_MSG;
    return null;
  },
  [MSG.SET_PROFILE]: (p) => {
    if (p.name !== undefined && !validName(p.name)) return ERROR_CODES.NAME_INVALID;
    if (!optStr(p.monkeyId)) return ERROR_CODES.BAD_MSG;
    return null;
  },
  [MSG.LIST_ROOMS]: () => null,
  [MSG.CREATE_ROOM]: (p) => {
    if (p.name !== undefined && !validName(p.name)) return ERROR_CODES.NAME_INVALID;
    if (!isBool(p.isPrivate)) return ERROR_CODES.BAD_MSG;
    if (!isInt(p.maxPlayers) || p.maxPlayers < MIN_PLAYERS || p.maxPlayers > MAX_PLAYERS) {
      return ERROR_CODES.BAD_MSG;
    }
    if (!isStr(p.mode)) return ERROR_CODES.BAD_MSG;
    if (!isBool(p.botFill)) return ERROR_CODES.BAD_MSG;
    return null;
  },
  [MSG.JOIN_ROOM]: (p) => {
    if (!isStr(p.roomId) && !isStr(p.code)) return ERROR_CODES.BAD_MSG;
    if (!optStr(p.roomId) || !optStr(p.code)) return ERROR_CODES.BAD_MSG;
    return null;
  },
  [MSG.LEAVE_ROOM]: () => null,
  [MSG.QUICK_MATCH]: (p) => (isStr(p.mode) ? null : ERROR_CODES.BAD_MSG),
  [MSG.CANCEL_QUICK]: () => null,
  [MSG.READY]: (p) => (isBool(p.ready) ? null : ERROR_CODES.BAD_MSG),
  [MSG.SELECT_MONKEY]: (p) => (isStr(p.monkeyId) ? null : ERROR_CODES.BAD_MSG),
  [MSG.ADD_BOT]: (p) => (optStr(p.personality) ? null : ERROR_CODES.BAD_MSG),
  [MSG.REMOVE_BOT]: (p) => (isStr(p.botId) ? null : ERROR_CODES.BAD_MSG),
  [MSG.UPDATE_SETTINGS]: (p) => {
    if (!isObj(p.patch)) return ERROR_CODES.BAD_MSG;
    const { turnSeconds, mapId, mode } = p.patch;
    if (turnSeconds !== undefined) {
      if (!isInt(turnSeconds) || turnSeconds < TURN_SECONDS_MIN || turnSeconds > TURN_SECONDS_MAX) {
        return ERROR_CODES.BAD_MSG;
      }
    }
    if (!optStr(mapId) || !optStr(mode)) return ERROR_CODES.BAD_MSG;
    return null;
  },
  [MSG.START_GAME]: () => null,
  [MSG.PLAY]: (p) => {
    if (!isStr(p.aid)) return ERROR_CODES.BAD_MSG;
    if (!Array.isArray(p.cardIds)) return ERROR_CODES.INVALID_CARDS;
    // MAX_PLAY_HARD is the wire safety bound (covers Custom Chaos maxPlay 4);
    // the per-room/per-mode limit (stock 3) is the ENGINE's call, not ours.
    if (p.cardIds.length < MIN_PLAY || p.cardIds.length > MAX_PLAY_HARD) return ERROR_CODES.INVALID_CARDS;
    if (!p.cardIds.every(isStr)) return ERROR_CODES.INVALID_CARDS;
    if (new Set(p.cardIds).size !== p.cardIds.length) return ERROR_CODES.INVALID_CARDS;
    return null;
  },
  [MSG.CALL_LIAR]: (p) => (isStr(p.aid) ? null : ERROR_CODES.BAD_MSG),
  [MSG.USE_CHIP]: (p) => (isStr(p.aid) ? null : ERROR_CODES.BAD_MSG),
  [MSG.FIRE_CANNON]: (p) => (isStr(p.aid) ? null : ERROR_CODES.BAD_MSG),
  [MSG.CHAT]: (p) => {
    if (!isStr(p.text)) return ERROR_CODES.BAD_MSG;
    if (p.text.length < 1 || p.text.length > CHAT_MAX_LENGTH) return ERROR_CODES.BAD_MSG;
    return null;
  },
  [MSG.QUICK_PHRASE]: (p) => (isStr(p.phraseId) ? null : ERROR_CODES.BAD_MSG),
  [MSG.EMOTE]: (p) => (isStr(p.emoteId) ? null : ERROR_CODES.BAD_MSG),
  [MSG.SPECTATE]: (p) => (isStr(p.roomId) ? null : ERROR_CODES.BAD_MSG),
  [MSG.STOP_SPECTATE]: () => null,
  [MSG.PING]: (p) => (isNum(p.ts) ? null : ERROR_CODES.BAD_MSG),
  // 1.0 additions (§10.1)
  [MSG.MODE_ACTION]: (p) => {
    if (!isStr(p.aid)) return ERROR_CODES.BAD_MSG;
    if (!isStr(p.action) || p.action.length < 1 || p.action.length > MODE_ACTION_MAX_LENGTH) {
      return ERROR_CODES.BAD_MSG;
    }
    if (p.data !== undefined && !isObj(p.data)) return ERROR_CODES.BAD_MSG;
    return null;
  },
  [MSG.GET_PROFILE]: () => null,
  [MSG.BUY_COSMETIC]: (p) => (isStr(p.itemId) ? null : ERROR_CODES.BAD_MSG),
  [MSG.EQUIP_COSMETIC]: (p) => {
    if (!isStr(p.slot)) return ERROR_CODES.BAD_MSG;
    if (p.itemId !== null && !isStr(p.itemId)) return ERROR_CODES.BAD_MSG;
    return null;
  },
};

/** Set of message types a client may legitimately send. */
export const CLIENT_MSG_TYPES = Object.freeze(new Set(Object.keys(CLIENT_VALIDATORS)));

/**
 * Parse + validate a raw client frame.
 *
 * Checks: valid JSON, envelope `{t, p}` (p optional, defaults to `{}`),
 * `t` is a known client→server type, and the payload passes the per-type
 * basic shape validation. Deeper game-state checks (turn order, ownership,
 * rate limits…) are the game engine's job, not this function's.
 *
 * @param {string|Buffer|ArrayBuffer|Uint8Array} raw
 * @returns {{ok: true, t: string, p: Object} | {ok: false, code: string}}
 */
export function validateClientMsg(raw) {
  let text;
  if (typeof raw === 'string') {
    text = raw;
  } else if (raw && typeof raw.toString === 'function') {
    try {
      text = raw.toString('utf8');
    } catch {
      return { ok: false, code: ERROR_CODES.BAD_MSG };
    }
  } else {
    return { ok: false, code: ERROR_CODES.BAD_MSG };
  }

  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return { ok: false, code: ERROR_CODES.BAD_MSG };
  }

  if (!isObj(msg) || !isStr(msg.t)) return { ok: false, code: ERROR_CODES.BAD_MSG };
  const p = msg.p === undefined ? {} : msg.p;
  if (!isObj(p)) return { ok: false, code: ERROR_CODES.BAD_MSG };

  const validator = CLIENT_VALIDATORS[msg.t];
  if (!validator) return { ok: false, code: ERROR_CODES.BAD_MSG };

  const errCode = validator(p);
  if (errCode) return { ok: false, code: errCode };

  return { ok: true, t: msg.t, p };
}
