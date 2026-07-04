// Lobby room state machine — PLAN.md §2 (server/src/lobby/room.js).
//
// Members (humans + bot seats), ready flow, host powers (settings, add/remove
// bot with personality tag, kick), monkey selection, private 4-char code,
// spectators, start validation (>=4 seats incl bots, all humans ready, mode
// playable), and the transition into game/gameRoom.js. Emits a FULL
// `roomState` snapshot on every lobby change (§3.3).

import {
  MIN_PLAYERS,
  ROOM_CODE_LENGTH,
  TURN_SECONDS_DEFAULT,
  TURN_SECONDS_MAX,
  TURN_SECONDS_MIN,
} from '@monkeybar/shared/constants.js';
import { ERROR_CODES, ServerMsg } from '@monkeybar/shared/protocol.js';
import { MONKEYS } from '@monkeybar/shared/monkeys.js';
import { MAPS } from '@monkeybar/shared/maps.js';
import { getMode } from '@monkeybar/shared/modes.js';

import { createGameRoom } from '../game/gameRoom.js';
import { isModeKnown, isModePlayable, NOT_PLAYABLE } from '../game/modes/index.js';
import { createLogger } from '../util/log.js';

/** §5 archetypes — the ids P3's bots/personalities.js will implement. */
export const BOT_PERSONALITIES = Object.freeze([
  'aggressive',
  'cautious',
  'chaotic',
  'mathematical',
  'emotional',
  'trollish',
  'quiet',
]);

const BOT_NAMES = {
  aggressive: 'Slugger',
  cautious: 'Tiptoe',
  chaotic: 'Zonko',
  mathematical: 'Abacus',
  emotional: 'Weepy',
  trollish: 'Heckles',
  quiet: 'Mumbles',
};

/** Unambiguous alphabet for private join codes (no 0/O/1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoomCode(isTaken = () => false) {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!isTaken(code)) return code;
  }
  throw new Error('room code space exhausted');
}

const OK = Object.freeze({ ok: true });
const err = (code, msg = '') => ({ ok: false, code, msg });

let roomCounter = 0;
let botCounter = 0;

/**
 * @param {Object} options
 * @param {string} [options.id]
 * @param {string} [options.name]
 * @param {boolean} options.isPrivate
 * @param {number} options.maxPlayers
 * @param {string} options.mode
 * @param {boolean} options.botFill
 * @param {boolean} [options.isQuick]  quickmatch rooms are hidden from listRooms
 * @param {string|null} [options.code]
 * @param {(playerId: string, envelope: Object) => void} options.send
 * @param {() => Object} [options.getAutoPlayPolicy]
 * @param {(gameRoom: Object, seat: number, opts: Object) => void} [options.convertSeat]
 *        seat→bot conversion hook (net/sessions.js convertSeatToBot; P3 overridable)
 * @param {() => void} [options.onPublicChange]  lobbyManager refreshes room lists
 * @param {(room: Object) => void} [options.onClosed]
 * @param {ReturnType<import('../util/log.js').createLogger>} [options.log]
 */
export function createRoom({
  id = `room-${++roomCounter}-${Math.random().toString(36).slice(2, 8)}`,
  name = 'The Peeling Parrot',
  isPrivate,
  maxPlayers,
  mode,
  botFill,
  isQuick = false,
  code = null,
  send,
  getAutoPlayPolicy = () => null,
  convertSeat = (gr, seat, opts = {}) => gr.convertSeatToBot(seat, opts.personality ?? 'cautious'),
  onPublicChange = () => {},
  onClosed = () => {},
  log = createLogger('room'),
}) {
  /** @type {Map<string, import('@monkeybar/shared/protocol.js').MemberInfo>} insertion order = seat order */
  const members = new Map();
  /** @type {Set<string>} spectator playerIds */
  const spectators = new Set();
  const settings = { turnSeconds: TURN_SECONDS_DEFAULT, mapId: 'peeling_parrot' };
  let hostId = null;
  let state = 'lobby'; // 'lobby' | 'inGame'
  /** @type {ReturnType<import('../game/gameRoom.js').createGameRoom>|null} */
  let gameRoom = null;
  let closed = false;

  // ---- views -----------------------------------------------------------------

  /** §3.1 RoomState — full snapshot. */
  function roomState() {
    const out = {
      id,
      name,
      hostId,
      mode,
      isPrivate,
      maxPlayers,
      botFill,
      settings: { ...settings },
      members: [...members.values()].map((m) => ({ ...m })),
      spectatorCount: spectators.size,
    };
    if (code) out.code = code;
    return out;
  }

  /** §3.1 RoomSummary — for listRooms. */
  function summary() {
    return {
      id,
      name,
      mode,
      isPrivate,
      playerCount: members.size,
      maxPlayers,
      inGame: state === 'inGame',
    };
  }

  function humans() {
    return [...members.values()].filter((m) => !m.isBot);
  }

  // ---- broadcast ---------------------------------------------------------------

  function safeSend(playerId, envelope) {
    try {
      send(playerId, envelope);
    } catch (e) {
      log.warn(`send to ${playerId} failed:`, e.message);
    }
  }

  function broadcast(envelope, { includeSpectators = true } = {}) {
    for (const m of members.values()) {
      if (!m.isBot) safeSend(m.id, envelope);
    }
    if (includeSpectators) {
      for (const pid of spectators) safeSend(pid, envelope);
    }
  }

  function broadcastRoomState() {
    broadcast(ServerMsg.roomState(roomState()));
    onPublicChange();
  }

  // ---- membership ----------------------------------------------------------------

  /**
   * @param {{playerId: string, name: string, monkeyId?: string|null}} profile
   * @param {{ready?: boolean, asHost?: boolean}} [opts]
   */
  function addMember(profile, opts = {}) {
    if (closed) return err(ERROR_CODES.NOT_FOUND);
    if (state === 'inGame') return err(ERROR_CODES.BAD_STATE, 'match in progress — spectate instead');
    if (members.size >= maxPlayers) return err(ERROR_CODES.ROOM_FULL);
    if (members.has(profile.playerId)) return err(ERROR_CODES.BAD_STATE, 'already in room');
    members.set(profile.playerId, {
      id: profile.playerId,
      name: profile.name,
      monkeyId: profile.monkeyId ?? MONKEYS[0].id,
      ready: !!opts.ready,
      isBot: false,
      isHost: false,
    });
    if (opts.asHost || !hostId) setHost(profile.playerId);
    broadcastRoomState();
    return OK;
  }

  function setHost(playerId) {
    hostId = playerId;
    for (const m of members.values()) m.isHost = m.id === hostId;
  }

  /**
   * @param {string} playerId
   * @param {'left'|'kicked'|'closed'} reason
   */
  function removeMember(playerId, reason = 'left') {
    const member = members.get(playerId);
    if (!member) return err(ERROR_CODES.NOT_FOUND);
    members.delete(playerId);
    if (!member.isBot) safeSend(playerId, ServerMsg.leftRoom(reason));

    // Mid-match: the seat lives on as a bot for the rest of the match.
    if (state === 'inGame' && gameRoom && !member.isBot) {
      const seat = gameRoom.table.seatOf(playerId);
      if (seat !== -1 && gameRoom.table.get(seat).alive) {
        convertSeat(gameRoom, seat, { reason: reason === 'left' ? 'leftMatch' : reason });
      }
    }

    if (humans().length === 0) {
      close();
      return OK;
    }
    if (playerId === hostId) {
      const nextHost = humans()[0];
      if (nextHost) setHost(nextHost.id);
    }
    broadcastRoomState();
    return OK;
  }

  /** Host power (no §3.2 wire message yet — server-side interface for later). */
  function kick(byId, targetId) {
    if (byId !== hostId) return err(ERROR_CODES.NOT_HOST);
    if (!members.has(targetId)) return err(ERROR_CODES.NOT_FOUND);
    if (targetId === hostId) return err(ERROR_CODES.BAD_STATE);
    return removeMember(targetId, 'kicked');
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const m of humans()) safeSend(m.id, ServerMsg.leftRoom('closed'));
    for (const pid of spectators) safeSend(pid, ServerMsg.leftRoom('closed'));
    members.clear();
    spectators.clear();
    if (gameRoom) {
      gameRoom.destroy();
      gameRoom = null;
    }
    state = 'lobby';
    onClosed(api);
    onPublicChange();
  }

  // ---- spectators -------------------------------------------------------------------

  function addSpectator(playerId) {
    if (closed) return err(ERROR_CODES.NOT_FOUND);
    if (state !== 'inGame') return err(ERROR_CODES.BAD_STATE, 'room is not in a match');
    if (members.has(playerId)) return err(ERROR_CODES.BAD_STATE);
    spectators.add(playerId);
    // Late spectators get the current snapshot as `state` (§3.3) — never `hand`.
    safeSend(playerId, ServerMsg.roomState(roomState()));
    safeSend(playerId, ServerMsg.state(gameRoom.snapshotFor(null)));
    broadcastRoomState();
    return OK;
  }

  function removeSpectator(playerId) {
    if (!spectators.delete(playerId)) return err(ERROR_CODES.NOT_FOUND);
    safeSend(playerId, ServerMsg.leftRoom('left'));
    broadcastRoomState();
    return OK;
  }

  // ---- lobby actions ---------------------------------------------------------------------

  function setReady(playerId, ready) {
    const m = members.get(playerId);
    if (!m || state !== 'lobby') return err(ERROR_CODES.BAD_STATE);
    m.ready = !!ready;
    broadcastRoomState();
    return OK;
  }

  function selectMonkey(playerId, monkeyId) {
    const m = members.get(playerId);
    if (!m) return err(ERROR_CODES.BAD_STATE);
    if (!MONKEYS.some((mk) => mk.id === monkeyId)) return err(ERROR_CODES.NOT_FOUND);
    m.monkeyId = monkeyId;
    broadcastRoomState();
    return OK;
  }

  function setMemberName(playerId, newName) {
    const m = members.get(playerId);
    if (!m) return err(ERROR_CODES.BAD_STATE);
    m.name = newName;
    broadcastRoomState();
    return OK;
  }

  function addBot(byId, personality) {
    if (byId !== hostId) return err(ERROR_CODES.NOT_HOST);
    if (state !== 'lobby') return err(ERROR_CODES.BAD_STATE);
    if (members.size >= maxPlayers) return err(ERROR_CODES.ROOM_FULL);
    const p = personality ?? BOT_PERSONALITIES[Math.floor(Math.random() * BOT_PERSONALITIES.length)];
    const botId = `bot-${++botCounter}`;
    members.set(botId, {
      id: botId,
      name: `${BOT_NAMES[p] ?? 'Rando'} (bot)`,
      monkeyId: MONKEYS[Math.floor(Math.random() * MONKEYS.length)].id,
      ready: true,
      isBot: true,
      personality: p,
      isHost: false,
    });
    broadcastRoomState();
    return { ok: true, botId };
  }

  function removeBot(byId, botId) {
    if (byId !== hostId) return err(ERROR_CODES.NOT_HOST);
    if (state !== 'lobby') return err(ERROR_CODES.BAD_STATE);
    const m = members.get(botId);
    if (!m || !m.isBot) return err(ERROR_CODES.NOT_FOUND);
    members.delete(botId);
    broadcastRoomState();
    return OK;
  }

  function updateSettings(byId, patch) {
    if (byId !== hostId) return err(ERROR_CODES.NOT_HOST);
    if (state !== 'lobby') return err(ERROR_CODES.BAD_STATE);
    if (patch.turnSeconds !== undefined) {
      const t = patch.turnSeconds;
      if (!Number.isInteger(t) || t < TURN_SECONDS_MIN || t > TURN_SECONDS_MAX) {
        return err(ERROR_CODES.BAD_MSG);
      }
      settings.turnSeconds = t;
    }
    if (patch.mapId !== undefined) {
      const map = MAPS.find((mp) => mp.id === patch.mapId);
      if (!map || !map.playable) return err(ERROR_CODES.NOT_FOUND, 'unknown or locked map');
      settings.mapId = patch.mapId;
    }
    if (patch.mode !== undefined) {
      if (!getMode(patch.mode) || !isModeKnown(patch.mode)) {
        return err(ERROR_CODES.NOT_FOUND, 'unknown mode');
      }
      mode = patch.mode; // non-playable allowed here; start is what's blocked
    }
    broadcastRoomState();
    return OK;
  }

  // ---- match lifecycle -------------------------------------------------------------------------

  /**
   * Start validation (§3.2): host only (unless `force`, used by quickmatch),
   * mode playable, ≥4 seats including bots, all humans ready.
   * @param {string|null} byId
   * @param {{force?: boolean, gameOptions?: Object}} [opts]
   */
  function startGame(byId, opts = {}) {
    if (!opts.force && byId !== hostId) return err(ERROR_CODES.NOT_HOST);
    if (state !== 'lobby' || closed) return err(ERROR_CODES.BAD_STATE);
    if (!isModePlayable(mode)) {
      return err(NOT_PLAYABLE, `mode '${mode}' is not playable yet`);
    }
    if (botFill && members.size < MIN_PLAYERS) {
      // Room was created with botFill: top up to the table minimum on start.
      for (let i = members.size; i < MIN_PLAYERS; i++) {
        const res = addBot(hostId, undefined);
        if (!res.ok) break;
      }
    }
    if (members.size < MIN_PLAYERS) {
      return err(ERROR_CODES.BAD_STATE, `need at least ${MIN_PLAYERS} seats (bots count)`);
    }
    if (humans().some((m) => !m.ready)) {
      return err(ERROR_CODES.BAD_STATE, 'all monkeys must be ready');
    }

    const seatMetas = [...members.values()].map((m) => ({
      playerId: m.id,
      name: m.name,
      monkeyId: m.monkeyId,
      isBot: m.isBot,
      personality: m.personality ?? null,
    }));

    gameRoom = createGameRoom({
      roomId: id,
      modeId: mode,
      mapId: settings.mapId,
      turnSeconds: settings.turnSeconds,
      seatMetas,
      send: safeSend,
      getSpectatorIds: () => [...spectators],
      getAutoPlayPolicy,
      onMatchEnd: handleMatchEnd,
      log: log.child('game'),
      ...(opts.gameOptions ?? {}),
    });
    state = 'inGame';

    // §3.3 gameStart — a personal snapshot for every human (private view) and
    // the public view for spectators. Hands arrive right after via `hand`.
    for (const m of humans()) {
      safeSend(m.id, ServerMsg.gameStart(gameRoom.snapshotFor(m.id)));
    }
    for (const pid of spectators) {
      safeSend(pid, ServerMsg.gameStart(gameRoom.snapshotFor(null)));
    }
    onPublicChange();
    gameRoom.start();
    return OK;
  }

  function handleMatchEnd() {
    if (closed || !gameRoom) return;
    gameRoom.destroy();
    gameRoom = null;
    state = 'lobby';
    for (const m of members.values()) {
      if (!m.isBot) m.ready = false;
    }
    broadcastRoomState();
  }

  // ---- chat / social ------------------------------------------------------------------------------

  /**
   * @param {string} playerId
   * @param {string} text
   */
  function chat(playerId, text) {
    const member = members.get(playerId);
    const isSpectator = spectators.has(playerId);
    if (!member && !isSpectator) return err(ERROR_CODES.BAD_STATE);
    const seat = state === 'inGame' && gameRoom && member ? gameRoom.table.seatOf(playerId) : -1;
    broadcast(
      ServerMsg.chat({
        seat: seat === -1 ? null : seat,
        name: isSpectator ? `👁 ${nameOf(playerId)}` : member.name,
        text,
      })
    );
    return OK;
  }

  /** Spectator display names come from the session layer. */
  let nameOf = (playerId) => `Monkey ${playerId.slice(0, 4)}`;
  function setNameResolver(fn) {
    nameOf = fn;
  }

  function quickPhrase(playerId, phraseId) {
    const member = members.get(playerId);
    const isSpectator = spectators.has(playerId);
    if (!member && !isSpectator) return err(ERROR_CODES.BAD_STATE);
    const seat = state === 'inGame' && gameRoom && member ? gameRoom.table.seatOf(playerId) : -1;
    broadcast(ServerMsg.quickPhrase({ seat: seat === -1 ? null : seat, phraseId }));
    return OK;
  }

  function emote(playerId, emoteId) {
    const member = members.get(playerId);
    if (!member) return err(ERROR_CODES.BAD_STATE, 'spectators cannot emote');
    const seat = state === 'inGame' && gameRoom ? gameRoom.table.seatOf(playerId) : -1;
    broadcast(ServerMsg.emote({ seat: seat === -1 ? null : seat, emoteId }));
    return OK;
  }

  // ---------------------------------------------------------------------------------------------------

  const api = {
    get id() {
      return id;
    },
    get name() {
      return name;
    },
    get code() {
      return code;
    },
    get hostId() {
      return hostId;
    },
    get state() {
      return state;
    },
    get isPrivate() {
      return isPrivate;
    },
    get isQuick() {
      return isQuick;
    },
    get maxPlayers() {
      return maxPlayers;
    },
    get mode() {
      return mode;
    },
    get closed() {
      return closed;
    },
    get gameRoom() {
      return gameRoom;
    },
    get memberCount() {
      return members.size;
    },
    members,
    spectators,
    settings,
    roomState,
    summary,
    humans,
    broadcast,
    broadcastRoomState,
    addMember,
    removeMember,
    kick,
    close,
    addSpectator,
    removeSpectator,
    setReady,
    selectMonkey,
    setMemberName,
    addBot,
    removeBot,
    updateSettings,
    startGame,
    chat,
    quickPhrase,
    emote,
    setNameResolver,
  };
  return api;
}
