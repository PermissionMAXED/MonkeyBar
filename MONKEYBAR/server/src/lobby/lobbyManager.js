// Room registry + quickmatch queue — PLAN.md §2 (server/src/lobby/lobbyManager.js).
//
// create / join (by id or 4-char code) / leave / list public rooms, the
// quickMatch queue (fills remaining seats with bots after 5 s and
// auto-starts), spectate wiring, and `roomList` broadcasts to everyone idling
// outside a room.

import { MAX_PLAYERS, QUICKMATCH_FILL_DELAY_MS } from '@monkeybar/shared/constants.js';
import { ERROR_CODES, ServerMsg } from '@monkeybar/shared/protocol.js';
import { getMode } from '@monkeybar/shared/modes.js';

import { createRoom, generateRoomCode } from './room.js';
import { isModeKnown, isModePlayable, NOT_PLAYABLE } from '../game/modes/index.js';
import { createLogger } from '../util/log.js';

const OK = Object.freeze({ ok: true });
const err = (code, msg = '') => ({ ok: false, code, msg });

/**
 * @param {Object} options
 * @param {ReturnType<import('../net/sessions.js').createSessions>} options.sessions
 * @param {number} [options.quickFillDelayMs]
 * @param {ReturnType<import('../util/log.js').createLogger>} [options.log]
 */
export function createLobbyManager({
  sessions,
  quickFillDelayMs = QUICKMATCH_FILL_DELAY_MS,
  log = createLogger('lobby'),
}) {
  /** @type {Map<string, ReturnType<import('./room.js').createRoom>>} */
  const rooms = new Map();
  /** @type {Map<string, string>} join code → roomId */
  const codes = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} quick roomId → fill timer */
  const quickTimers = new Map();
  let shuttingDown = false;

  // ---- helpers ----------------------------------------------------------------

  function getRoom(roomId) {
    return rooms.get(roomId) ?? null;
  }

  function getRoomByCode(code) {
    if (typeof code !== 'string') return null;
    const roomId = codes.get(code.toUpperCase());
    return roomId ? getRoom(roomId) : null;
  }

  function publicSummaries() {
    return [...rooms.values()]
      .filter((r) => !r.isPrivate && !r.isQuick && !r.closed)
      .map((r) => r.summary());
  }

  /** roomList → every connected session idling outside a room (§3.3). */
  function broadcastRoomList() {
    if (shuttingDown) return;
    const envelope = ServerMsg.roomList(publicSummaries());
    for (const s of sessions.all()) {
      if (s.conn && !s.roomId && !s.spectatingRoomId) s.conn.send(envelope);
    }
  }

  function profileOf(session) {
    return { playerId: session.playerId, name: session.name, monkeyId: session.monkeyId };
  }

  // ---- room lifecycle ---------------------------------------------------------------

  function buildRoom(opts) {
    const code = opts.isPrivate ? generateRoomCode((c) => codes.has(c)) : null;
    const room = createRoom({
      ...opts,
      code,
      send: (playerId, envelope) => sessions.sendTo(playerId, envelope),
      getAutoPlayPolicy: () => sessions.getAutoPlayPolicy(),
      convertSeat: (gameRoom, seat, o) => sessions.convertSeatToBot(gameRoom, seat, o),
      onPublicChange: broadcastRoomList,
      onClosed: handleRoomClosed,
      log: log.child('room'),
    });
    rooms.set(room.id, room);
    if (code) codes.set(code, room.id);
    room.setNameResolver((playerId) => sessions.get(playerId)?.name ?? 'Monkey');
    return room;
  }

  function handleRoomClosed(room) {
    rooms.delete(room.id);
    if (room.code) codes.delete(room.code);
    const timer = quickTimers.get(room.id);
    if (timer) {
      clearTimeout(timer);
      quickTimers.delete(room.id);
    }
    // Any session still pointing at the dead room goes back to the lobby.
    for (const s of sessions.all()) {
      if (s.roomId === room.id) s.roomId = null;
      if (s.spectatingRoomId === room.id) s.spectatingRoomId = null;
    }
    broadcastRoomList();
  }

  /**
   * §3.2 createRoom — creator becomes host and is seated immediately.
   * @param {import('../net/sessions.js').Session} session
   * @param {{name?: string, isPrivate: boolean, maxPlayers: number, mode: string, botFill: boolean}} p
   */
  function createRoomFor(session, p) {
    if (session.roomId || session.spectatingRoomId) return err(ERROR_CODES.BAD_STATE, 'already in a room');
    if (!getMode(p.mode) || !isModeKnown(p.mode)) return err(ERROR_CODES.NOT_FOUND, 'unknown mode');
    const room = buildRoom({
      name: p.name ?? `${session.name}'s table`,
      isPrivate: p.isPrivate,
      maxPlayers: p.maxPlayers,
      mode: p.mode,
      botFill: p.botFill,
    });
    const res = room.addMember(profileOf(session), { asHost: true });
    if (!res.ok) {
      room.close();
      return res;
    }
    session.roomId = room.id;
    broadcastRoomList();
    return { ok: true, room };
  }

  /**
   * §3.2 joinRoom — by roomId or by private 4-char code.
   * @param {import('../net/sessions.js').Session} session
   * @param {{roomId?: string, code?: string}} p
   */
  function joinRoom(session, p) {
    if (session.roomId || session.spectatingRoomId) return err(ERROR_CODES.BAD_STATE, 'already in a room');
    const room = p.roomId ? getRoom(p.roomId) : getRoomByCode(p.code);
    if (!room || room.closed) return err(ERROR_CODES.NOT_FOUND);
    const res = room.addMember(profileOf(session));
    if (!res.ok) return res;
    session.roomId = room.id;
    broadcastRoomList();
    return { ok: true, room };
  }

  /** §3.2 leaveRoom — also doubles as stopSpectate for spectating sessions. */
  function leaveRoom(session) {
    if (session.spectatingRoomId) return stopSpectate(session);
    const room = session.roomId ? getRoom(session.roomId) : null;
    session.roomId = null;
    if (!room) return err(ERROR_CODES.BAD_STATE, 'not in a room');
    room.removeMember(session.playerId, 'left');
    broadcastRoomList();
    return OK;
  }

  // ---- quickmatch --------------------------------------------------------------------

  /**
   * §3.2 quickMatch — joins (or opens) a quickmatch room for the mode; the
   * room auto-starts when full, or 5 s after opening with bot fill (§3.4).
   */
  function quickMatch(session, mode) {
    if (session.roomId || session.spectatingRoomId) return err(ERROR_CODES.BAD_STATE, 'already in a room');
    if (!getMode(mode) || !isModeKnown(mode)) return err(ERROR_CODES.NOT_FOUND, 'unknown mode');
    if (!isModePlayable(mode)) return err(NOT_PLAYABLE, `mode '${mode}' is not playable yet`);

    let room = [...rooms.values()].find(
      (r) => r.isQuick && !r.closed && r.state === 'lobby' && r.mode === mode && r.memberCount < r.maxPlayers
    );
    if (!room) {
      room = buildRoom({
        name: 'Quick Match',
        isPrivate: true, // hidden from the public browser; join via queue only
        maxPlayers: MAX_PLAYERS,
        mode,
        botFill: true,
        isQuick: true,
      });
      const timer = setTimeout(() => {
        quickTimers.delete(room.id);
        startQuickRoom(room);
      }, quickFillDelayMs);
      if (timer.unref) timer.unref();
      quickTimers.set(room.id, timer);
    }

    const res = room.addMember(profileOf(session), { ready: true });
    if (!res.ok) return res;
    session.roomId = room.id;
    sessions.sendTo(session.playerId, ServerMsg.matchFound(room.id));
    if (room.memberCount >= room.maxPlayers) startQuickRoom(room);
    return { ok: true, room };
  }

  function startQuickRoom(room) {
    if (room.closed || room.state !== 'lobby' || room.humans().length === 0) return;
    const timer = quickTimers.get(room.id);
    if (timer) {
      clearTimeout(timer);
      quickTimers.delete(room.id);
    }
    const res = room.startGame(null, { force: true }); // botFill tops up to 4 seats
    if (!res.ok) log.warn(`quickmatch room ${room.id} failed to start:`, res.code);
  }

  /** §3.2 cancelQuick — leave the not-yet-started quickmatch room. */
  function cancelQuick(session) {
    const room = session.roomId ? getRoom(session.roomId) : null;
    if (!room || !room.isQuick || room.state !== 'lobby') {
      return err(ERROR_CODES.BAD_STATE, 'not in quickmatch');
    }
    session.roomId = null;
    room.removeMember(session.playerId, 'left');
    return OK;
  }

  // ---- spectate -----------------------------------------------------------------------

  /** §3.2 spectate — public, in-game rooms only. */
  function spectate(session, roomId) {
    if (session.roomId || session.spectatingRoomId) return err(ERROR_CODES.BAD_STATE, 'already in a room');
    const room = getRoom(roomId);
    if (!room || room.closed || room.isPrivate) return err(ERROR_CODES.NOT_FOUND);
    const res = room.addSpectator(session.playerId);
    if (!res.ok) return res;
    session.spectatingRoomId = room.id;
    return { ok: true, room };
  }

  function stopSpectate(session) {
    const room = session.spectatingRoomId ? getRoom(session.spectatingRoomId) : null;
    session.spectatingRoomId = null;
    if (!room) return err(ERROR_CODES.BAD_STATE, 'not spectating');
    room.removeSpectator(session.playerId);
    return OK;
  }

  // ---- lifecycle ------------------------------------------------------------------------

  function shutdown() {
    shuttingDown = true;
    for (const timer of quickTimers.values()) clearTimeout(timer);
    quickTimers.clear();
    for (const room of [...rooms.values()]) room.close();
    rooms.clear();
    codes.clear();
  }

  return {
    rooms,
    getRoom,
    getRoomByCode,
    publicSummaries,
    broadcastRoomList,
    createRoomFor,
    joinRoom,
    leaveRoom,
    quickMatch,
    cancelQuick,
    spectate,
    stopSpectate,
    shutdown,
  };
}
