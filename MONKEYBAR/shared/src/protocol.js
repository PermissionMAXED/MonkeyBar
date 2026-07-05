// MONKEYBAR wire protocol — PLAN.md §3 (binding contract).
// Wire format: JSON text frames, envelope { "t": "<type>", "p": { ...payload } }.
// Client game actions carry `aid` (client-generated id) echoed by the server in `actionAck`.

import {
  CHAT_MAX_LENGTH,
  MAX_PLAY,
  MAX_PLAYERS,
  MIN_PLAY,
  MIN_PLAYERS,
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
 * @typedef {Object} MemberInfo
 * @property {string} id
 * @property {string} name
 * @property {string} monkeyId
 * @property {boolean} ready
 * @property {boolean} isBot
 * @property {string} [personality]
 * @property {boolean} isHost
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
 */

/**
 * @typedef {"dealing"|"playing"|"revealing"|"penalty"|"roundEnd"|"matchEnd"} GamePhase
 */

/**
 * Full game snapshot (spectators: yourSeat=null, yourHand=null).
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
});

/** Error codes carried by `error` / `actionAck` messages (§3.3). */
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
  turn: ({ seat, deadline, canCall, lastHolder }) =>
    makeMsg(MSG.TURN, { seat, deadline, canCall, lastHolder }),
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
    if (p.cardIds.length < MIN_PLAY || p.cardIds.length > MAX_PLAY) return ERROR_CODES.INVALID_CARDS;
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
