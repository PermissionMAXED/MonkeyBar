// Per-socket wrapper — PLAN.md §2 (server/src/net/connection.js).
//
// Parses + validates every frame with shared validateClientMsg, answers
// `ping` itself, enforces rate limits (global msgs/s ceiling; chat &
// quickPhrase 1/s; emote 1/2 s), tracks the app-level heartbeat (cull after
// 30 s of silence), and hands everything else to the dispatcher installed by
// server/src/index.js. Exposes safe send helpers that never throw.

import {
  CHAT_RATE_LIMIT_MS,
  EMOTE_RATE_LIMIT_MS,
  HEARTBEAT_CULL_MS,
  MSG_RATE_LIMIT_PER_SEC,
  PING_INTERVAL_MS,
} from '@monkeybar/shared/constants.js';
import { ERROR_CODES, MSG, ServerMsg, validateClientMsg } from '@monkeybar/shared/protocol.js';

import { createLogger } from '../util/log.js';

/** Minimum interval (ms) between messages, per §3 rate-limited type. */
const TYPE_INTERVALS = {
  [MSG.CHAT]: CHAT_RATE_LIMIT_MS,
  [MSG.QUICK_PHRASE]: CHAT_RATE_LIMIT_MS,
  [MSG.EMOTE]: EMOTE_RATE_LIMIT_MS,
};

let connCounter = 0;

/** WebSocket readyState OPEN (same value in `ws` and the browser). */
const WS_OPEN = 1;

/**
 * @param {import('ws').WebSocket} ws
 * @param {Object} options
 * @param {(conn: Object, t: string, p: Object) => void} options.dispatch
 * @param {(conn: Object) => void} [options.onClose]
 * @param {number} [options.heartbeatCullMs]
 * @param {ReturnType<import('../util/log.js').createLogger>} [options.log]
 */
export function createConnection(ws, {
  dispatch,
  onClose = () => {},
  heartbeatCullMs = HEARTBEAT_CULL_MS,
  log = createLogger('conn'),
}) {
  const conn = {
    id: `conn-${++connCounter}`,
    ws,
    /** @type {import('./sessions.js').Session|null} set by the hello handler */
    session: null,
    send,
    sendMsg,
    sendError,
    terminate,
    get open() {
      return ws.readyState === WS_OPEN;
    },
  };

  let lastSeen = Date.now();
  // Global ceiling: token bucket over a 1 s window.
  let windowStart = Date.now();
  let windowCount = 0;
  /** @type {Record<string, number>} last accepted timestamp per rate-limited type */
  const lastByType = {};

  // ---- send helpers (never throw) ---------------------------------------------

  /** @param {{t: string, p: Object}} envelope */
  function send(envelope) {
    if (ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(JSON.stringify(envelope));
      return true;
    } catch (e) {
      log.warn(`${conn.id} send failed:`, e.message);
      return false;
    }
  }

  function sendMsg(t, p = {}) {
    return send({ t, p });
  }

  function sendError(code, msg = '') {
    return send(ServerMsg.error(code, msg));
  }

  function terminate(reason = '') {
    if (reason) log.info(`${conn.id} terminated: ${reason}`);
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
  }

  // ---- heartbeat cull (§3.4: clients ping every 10 s) ----------------------------

  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > heartbeatCullMs) terminate('heartbeat cull');
  }, Math.min(PING_INTERVAL_MS, heartbeatCullMs));
  if (heartbeat.unref) heartbeat.unref();

  // ---- inbound frames ---------------------------------------------------------------

  ws.on('message', (raw) => {
    lastSeen = Date.now();

    // Global per-connection ceiling before we even parse.
    const nowTs = Date.now();
    if (nowTs - windowStart >= 1000) {
      windowStart = nowTs;
      windowCount = 0;
    }
    windowCount += 1;
    if (windowCount > MSG_RATE_LIMIT_PER_SEC) {
      sendError(ERROR_CODES.RATE_LIMIT, 'message flood');
      return;
    }

    const res = validateClientMsg(raw);
    if (!res.ok) {
      sendError(res.code, 'invalid message');
      return;
    }

    // Per-type rate limits (§3.2: chat 1/s, emote 1/2 s).
    const minInterval = TYPE_INTERVALS[res.t];
    if (minInterval) {
      const last = lastByType[res.t] ?? 0;
      if (nowTs - last < minInterval) {
        sendError(ERROR_CODES.RATE_LIMIT, `${res.t} rate limit`);
        return;
      }
      lastByType[res.t] = nowTs;
    }

    // Heartbeat ping answered right here (§3.3 pong).
    if (res.t === MSG.PING) {
      send(ServerMsg.pong(res.p.ts));
      return;
    }

    try {
      dispatch(conn, res.t, res.p);
    } catch (e) {
      log.error(`${conn.id} dispatch '${res.t}' crashed:`, e.stack ?? e.message);
      sendError(ERROR_CODES.BAD_STATE, 'internal error');
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    try {
      onClose(conn);
    } catch (e) {
      log.error(`${conn.id} onClose crashed:`, e.stack ?? e.message);
    }
  });

  ws.on('error', (e) => {
    log.warn(`${conn.id} socket error:`, e.message);
  });

  return conn;
}
