// MONKEYBAR server entry — PLAN.md §2 (server/src/index.js).
//
// HTTP server (production: serves client/dist statically with SPA fallback;
// dev: JSON health response) + `ws` WebSocketServer at /ws on port 8080.
// Wires connections (net/connection.js) → sessions (net/sessions.js) →
// lobbyManager (lobby/*) → gameRoom (game/*). Exports startServer() for tests.

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocketServer } from 'ws';

import { ERROR_CODES, MSG, ServerMsg } from '@monkeybar/shared/protocol.js';
import { MONKEYS } from '@monkeybar/shared/monkeys.js';
import { MODES } from '@monkeybar/shared/modes.js';
import { MAPS } from '@monkeybar/shared/maps.js';
import { EMOTES, QUICK_PHRASES, getEmote, getQuickPhrase } from '@monkeybar/shared/emotes.js';

import { createConnection } from './net/connection.js';
import { createSessions } from './net/sessions.js';
import { createLobbyManager } from './lobby/lobbyManager.js';
import { createLogger } from './util/log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '../../client/dist');

// ---------------------------------------------------------------------------
// Static file serving (production single-port deploy)
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let filePath = normalize(join(DIST_DIR, urlPath));
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    // SPA fallback → index.html
    filePath = join(DIST_DIR, 'index.html');
    if (!existsSync(filePath)) {
      res.writeHead(404).end('client/dist not built — run `npm run build` first');
      return;
    }
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------------------
// §3.2 message dispatcher: connection → sessions → lobby → game
// ---------------------------------------------------------------------------

const CATALOGS = Object.freeze({
  roster: MONKEYS,
  modes: MODES,
  maps: MAPS,
  emotes: EMOTES,
  quickPhrases: QUICK_PHRASES,
});

/**
 * @param {ReturnType<typeof createSessions>} sessions
 * @param {ReturnType<typeof createLobbyManager>} lobby
 * @param {ReturnType<typeof createLogger>} log
 */
function createDispatcher(sessions, lobby, log) {
  /** Send an error result ({ok:false,code,msg}) as an `error` envelope. */
  const relayError = (conn, res) => {
    if (!res.ok) conn.sendError(res.code, res.msg ?? '');
    return res.ok;
  };

  const requireSession = (conn) => {
    if (!conn.session) {
      conn.sendError(ERROR_CODES.BAD_STATE, 'say hello first');
      return null;
    }
    return conn.session;
  };

  const memberRoom = (session) => (session.roomId ? lobby.getRoom(session.roomId) : null);

  const requireRoom = (conn) => {
    const session = requireSession(conn);
    if (!session) return {};
    const room = memberRoom(session);
    if (!room) {
      conn.sendError(ERROR_CODES.BAD_STATE, 'not in a room');
      return {};
    }
    return { session, room };
  };

  // ---- hello / session resume (§3.4) --------------------------------------------

  function hello(conn, p) {
    if (conn.session) {
      conn.sendError(ERROR_CODES.BAD_STATE, 'already said hello');
      return;
    }
    let session = sessions.resume(p.token);
    const resumed = !!session;
    if (session) {
      if (p.name) session.name = p.name.trim();
    } else {
      session = sessions.issue({ name: p.name });
    }
    conn.session = session;
    sessions.attach(session, conn); // cancels any reconnect hold, bumps old socket

    conn.send(
      ServerMsg.welcome({
        playerId: session.playerId,
        token: session.token,
        resumed,
        ...CATALOGS,
      })
    );

    if (resumed && session.roomId) {
      const room = lobby.getRoom(session.roomId);
      if (!room || room.closed) {
        session.roomId = null;
      } else {
        conn.send(ServerMsg.roomState(room.roomState()));
        const gameRoom = room.gameRoom;
        if (room.state === 'inGame' && gameRoom && gameRoom.table.seatOf(session.playerId) !== -1) {
          gameRoom.setConnected(session.playerId, true); // broadcasts `conn`
          conn.send(ServerMsg.state(gameRoom.snapshotFor(session.playerId)));
        }
      }
    } else if (resumed && session.spectatingRoomId) {
      const room = lobby.getRoom(session.spectatingRoomId);
      if (room && !room.closed && room.gameRoom) {
        conn.send(ServerMsg.roomState(room.roomState()));
        conn.send(ServerMsg.state(room.gameRoom.snapshotFor(null)));
      } else {
        session.spectatingRoomId = null;
      }
    }

    if (!session.roomId && !session.spectatingRoomId) {
      conn.send(ServerMsg.roomList(lobby.publicSummaries()));
    }
  }

  // ---- profile / lobby browsing ----------------------------------------------------

  function setProfile(conn, p) {
    const session = requireSession(conn);
    if (!session) return;
    const room = memberRoom(session);
    if (room && room.state === 'inGame') {
      conn.sendError(ERROR_CODES.BAD_STATE, 'not during a match');
      return;
    }
    if (p.name) {
      session.name = p.name.trim();
      if (room) room.setMemberName(session.playerId, session.name);
    }
    if (p.monkeyId) {
      if (!MONKEYS.some((m) => m.id === p.monkeyId)) {
        conn.sendError(ERROR_CODES.NOT_FOUND, 'unknown monkey');
        return;
      }
      session.monkeyId = p.monkeyId;
      if (room) room.selectMonkey(session.playerId, p.monkeyId);
    }
  }

  function listRooms(conn) {
    if (!requireSession(conn)) return;
    conn.send(ServerMsg.roomList(lobby.publicSummaries()));
  }

  // ---- game actions (§3.3 actionAck + §3.4 aid dedup) ------------------------------

  function gameAction(conn, t, p) {
    const session = requireSession(conn);
    if (!session) return;
    if (session.acks.has(p.aid)) {
      conn.send(session.acks.get(p.aid)); // duplicate aid → replay the ack
      return;
    }
    const room = memberRoom(session);
    const gameRoom = room?.gameRoom;
    const result = gameRoom ? gameRoom.act(session.playerId, t, p) : { ok: false, code: ERROR_CODES.BAD_STATE };
    const ack = ServerMsg.actionAck(p.aid, result.ok, result.ok ? undefined : result.code);
    sessions.rememberAck(session, p.aid, ack);
    conn.send(ack);
  }

  // ---- chat / social -----------------------------------------------------------------

  const socialRoom = (session) =>
    memberRoom(session) ?? (session.spectatingRoomId ? lobby.getRoom(session.spectatingRoomId) : null);

  function chat(conn, p) {
    const session = requireSession(conn);
    if (!session) return;
    const room = socialRoom(session);
    if (!room) {
      conn.sendError(ERROR_CODES.BAD_STATE, 'nobody around to hear you');
      return;
    }
    relayError(conn, room.chat(session.playerId, p.text));
  }

  function quickPhrase(conn, p) {
    const session = requireSession(conn);
    if (!session) return;
    if (!getQuickPhrase(p.phraseId)) {
      conn.sendError(ERROR_CODES.NOT_FOUND, 'unknown phrase');
      return;
    }
    const room = socialRoom(session);
    if (!room) {
      conn.sendError(ERROR_CODES.BAD_STATE, 'nobody around to hear you');
      return;
    }
    relayError(conn, room.quickPhrase(session.playerId, p.phraseId));
  }

  function emote(conn, p) {
    const session = requireSession(conn);
    if (!session) return;
    if (!getEmote(p.emoteId)) {
      conn.sendError(ERROR_CODES.NOT_FOUND, 'unknown emote');
      return;
    }
    const room = memberRoom(session);
    if (!room) {
      conn.sendError(ERROR_CODES.BAD_STATE, 'spectators cannot emote');
      return;
    }
    relayError(conn, room.emote(session.playerId, p.emoteId));
  }

  // ---- handler table -------------------------------------------------------------------

  const handlers = {
    [MSG.HELLO]: hello,
    [MSG.SET_PROFILE]: setProfile,
    [MSG.LIST_ROOMS]: listRooms,
    [MSG.CREATE_ROOM]: (conn, p) => {
      const session = requireSession(conn);
      if (session) relayError(conn, lobby.createRoomFor(session, p));
    },
    [MSG.JOIN_ROOM]: (conn, p) => {
      const session = requireSession(conn);
      if (session) relayError(conn, lobby.joinRoom(session, p));
    },
    [MSG.LEAVE_ROOM]: (conn) => {
      const session = requireSession(conn);
      if (session) relayError(conn, lobby.leaveRoom(session));
    },
    [MSG.QUICK_MATCH]: (conn, p) => {
      const session = requireSession(conn);
      if (session) relayError(conn, lobby.quickMatch(session, p.mode));
    },
    [MSG.CANCEL_QUICK]: (conn) => {
      const session = requireSession(conn);
      if (session) relayError(conn, lobby.cancelQuick(session));
    },
    [MSG.READY]: (conn, p) => {
      const { session, room } = requireRoom(conn);
      if (room) relayError(conn, room.setReady(session.playerId, p.ready));
    },
    [MSG.SELECT_MONKEY]: (conn, p) => {
      const { session, room } = requireRoom(conn);
      if (!room) return;
      if (relayError(conn, room.selectMonkey(session.playerId, p.monkeyId))) {
        session.monkeyId = p.monkeyId;
      }
    },
    [MSG.ADD_BOT]: (conn, p) => {
      const { session, room } = requireRoom(conn);
      if (room) relayError(conn, room.addBot(session.playerId, p.personality));
    },
    [MSG.REMOVE_BOT]: (conn, p) => {
      const { session, room } = requireRoom(conn);
      if (room) relayError(conn, room.removeBot(session.playerId, p.botId));
    },
    [MSG.UPDATE_SETTINGS]: (conn, p) => {
      const { session, room } = requireRoom(conn);
      if (room) relayError(conn, room.updateSettings(session.playerId, p.patch));
    },
    [MSG.START_GAME]: (conn) => {
      const { session, room } = requireRoom(conn);
      if (room) relayError(conn, room.startGame(session.playerId));
    },
    [MSG.PLAY]: (conn, p) => gameAction(conn, MSG.PLAY, p),
    [MSG.CALL_LIAR]: (conn, p) => gameAction(conn, MSG.CALL_LIAR, p),
    [MSG.USE_CHIP]: (conn, p) => gameAction(conn, MSG.USE_CHIP, p),
    [MSG.CHAT]: chat,
    [MSG.QUICK_PHRASE]: quickPhrase,
    [MSG.EMOTE]: emote,
    [MSG.SPECTATE]: (conn, p) => {
      const session = requireSession(conn);
      if (session) relayError(conn, lobby.spectate(session, p.roomId));
    },
    [MSG.STOP_SPECTATE]: (conn) => {
      const session = requireSession(conn);
      if (session) relayError(conn, lobby.stopSpectate(session));
    },
  };

  function dispatch(conn, t, p) {
    if (!conn.session && t !== MSG.HELLO) {
      conn.sendError(ERROR_CODES.BAD_STATE, 'say hello first');
      return;
    }
    const handler = handlers[t];
    if (!handler) {
      conn.sendError(ERROR_CODES.BAD_MSG, `unhandled type '${t}'`);
      return;
    }
    handler(conn, p);
  }

  // ---- disconnect (§3.4 hold) ----------------------------------------------------------

  function handleClose(conn) {
    const session = conn.session;
    if (!session) return;
    if (session.conn !== conn) return; // session moved to a newer socket
    sessions.detach(session, conn);

    if (session.spectatingRoomId) {
      lobby.getRoom(session.spectatingRoomId)?.removeSpectator(session.playerId);
      session.spectatingRoomId = null;
      return;
    }
    if (!session.roomId) return;

    const room = lobby.getRoom(session.roomId);
    if (!room || room.closed) {
      session.roomId = null;
      return;
    }
    const gameRoom = room.gameRoom;
    const seated =
      room.state === 'inGame' && gameRoom && gameRoom.table.seatOf(session.playerId) !== -1;
    if (seated) {
      // 60 s hold: fallback policy plays their turns; then the seat goes to a bot.
      gameRoom.setConnected(session.playerId, false);
      sessions.beginHold(session, () => {
        if (session.conn) return; // reconnected in the meantime
        const heldRoom = session.roomId ? lobby.getRoom(session.roomId) : null;
        session.roomId = null;
        heldRoom?.removeMember(session.playerId, 'left'); // converts the live seat to a bot
      });
    } else {
      session.roomId = null;
      room.removeMember(session.playerId, 'left');
    }
  }

  return { dispatch, handleClose };
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

/**
 * Start the MONKEYBAR server.
 * @param {{port?: number, production?: boolean, logLevel?: string}} [opts]
 * @returns {Promise<{
 *   httpServer: import('node:http').Server,
 *   wss: import('ws').WebSocketServer,
 *   port: number,
 *   sessions: ReturnType<typeof createSessions>,
 *   lobby: ReturnType<typeof createLobbyManager>,
 *   close: () => Promise<void>,
 * }>}
 */
export function startServer({
  port = Number(process.env.PORT) || 8080,
  production = process.env.NODE_ENV === 'production',
  logLevel = process.env.LOG_LEVEL || 'info',
  quickFillDelayMs = undefined, // tests shrink the 5 s quickmatch fill
} = {}) {
  const log = createLogger('monkeybar', logLevel);
  const sessions = createSessions({ log: log.child('sessions') });
  const lobby = createLobbyManager({ sessions, quickFillDelayMs, log: log.child('lobby') });
  const { dispatch, handleClose } = createDispatcher(sessions, lobby, log);

  const httpServer = http.createServer((req, res) => {
    if (production) {
      serveStatic(req, res);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, name: 'monkeybar', ws: '/ws' }));
    }
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    createConnection(ws, { dispatch, onClose: handleClose, log: log.child('conn') });
  });

  return new Promise((resolveStart, rejectStart) => {
    httpServer.once('error', rejectStart);
    httpServer.listen(port, () => {
      const actualPort = httpServer.address().port;
      log.info(
        `server listening on http://localhost:${actualPort} ` +
          `(ws: /ws, mode: ${production ? 'production' : 'dev'})`
      );
      resolveStart({
        httpServer,
        wss,
        port: actualPort,
        sessions,
        lobby,
        close: () =>
          new Promise((resolveClose) => {
            lobby.shutdown();
            sessions.shutdown();
            for (const client of wss.clients) client.terminate();
            wss.close(() => httpServer.close(() => resolveClose()));
          }),
      });
    });
  });
}

// Auto-start when executed directly (node server/src/index.js).
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  startServer().catch((err) => {
    console.error('[monkeybar] failed to start:', err);
    process.exit(1);
  });
}
