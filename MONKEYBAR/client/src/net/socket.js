// WebSocket client — PLAN.md §2 (client/src/net/socket.js).
// FROZEN SIGNATURE (P1): export function createSocket(store)
//
// Connects to (wss|ws)://${location.host}/ws (Vite proxies /ws in dev).
// Auto-reconnects with exponential backoff (1 s → 8 s), re-sending
// hello{token} from localStorage; persists {playerId, token} from `welcome`.
// Typed send(t, p) / on(t, handler) / off, plus nextAid() for game actions.
// Connection status is mirrored into the store under 'connStatus'
// ('connecting' | 'open' | 'reconnecting' | 'closed').

import { MSG, makeMsg } from '@shared/protocol.js';
import { PING_INTERVAL_MS } from '@shared/constants.js';

const TOKEN_KEY = 'mb_token';
const NAME_KEY = 'mb_name';

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 8000;

/**
 * @param {ReturnType<import('../state/store.js').createStore>} store
 * @returns {{
 *   connect: () => void,
 *   close: () => void,
 *   send: (t: string, p?: Object) => boolean,
 *   on: (t: string, fn: (p: Object) => void) => () => void,
 *   off: (t: string, fn: (p: Object) => void) => void,
 *   nextAid: () => string,
 *   isOpen: () => boolean,
 * }}
 */
export function createSocket(store) {
  /** @type {WebSocket|null} */
  let ws = null;
  /** @type {Map<string, Set<Function>>} */
  const handlers = new Map();

  let backoffMs = BACKOFF_MIN_MS;
  let reconnectTimer = null;
  let pingTimer = null;
  let everConnected = false;
  let closedByUs = false;
  let aidCounter = 0;

  function setStatus(status) {
    store.set('connStatus', status);
    store.set('connection', status); // legacy P1 key, kept for compat
  }

  function emit(t, p) {
    const fns = handlers.get(t);
    if (fns) {
      for (const fn of [...fns]) {
        try {
          fn(p);
        } catch (err) {
          console.error(`[socket] handler for "${t}" threw`, err);
        }
      }
    }
  }

  function sendRaw(t, p = {}) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(makeMsg(t, p)));
      return true;
    }
    console.warn('[socket] dropped (not open):', t);
    return false;
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => sendRaw(MSG.PING, { ts: Date.now() }), PING_INTERVAL_MS);
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect() {
    if (closedByUs || reconnectTimer) return;
    setStatus('reconnecting');
    const wait = backoffMs;
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    console.log(`[socket] reconnecting in ${wait}ms`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      openSocket();
    }, wait);
  }

  function openSocket() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    setStatus(everConnected ? 'reconnecting' : 'connecting');
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      backoffMs = BACKOFF_MIN_MS;
      everConnected = true;
      setStatus('open');
      // §3.4: first message is always hello{name?, token?} — token resumes a session.
      const token = localStorage.getItem(TOKEN_KEY) || undefined;
      const name = (store.get('profile')?.name || localStorage.getItem(NAME_KEY) || '').trim();
      const hello = {};
      if (name) hello.name = name;
      if (token) hello.token = token;
      sendRaw(MSG.HELLO, hello);
      startPing();
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        console.warn('[socket] bad frame', ev.data);
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;
      const p = msg.p ?? {};
      if (msg.t === MSG.WELCOME) {
        // Issue + persist session token; downstream handlers read the rest.
        if (p.token) {
          try {
            localStorage.setItem(TOKEN_KEY, p.token);
          } catch {
            /* storage blocked — session simply won't resume */
          }
        }
        store.set('playerId', p.playerId ?? null);
        store.set('welcome', p); // legacy P1 key
      }
      emit(msg.t, p);
    });

    ws.addEventListener('close', () => {
      stopPing();
      if (closedByUs) {
        setStatus('closed');
        return;
      }
      console.log('[socket] disconnected');
      scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // 'close' always follows 'error'; reconnect is scheduled there.
    });
  }

  return {
    connect() {
      closedByUs = false;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      openSocket();
    },
    close() {
      closedByUs = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      stopPing();
      if (ws) ws.close();
      setStatus('closed');
    },
    send: sendRaw,
    on(t, fn) {
      let fns = handlers.get(t);
      if (!fns) {
        fns = new Set();
        handlers.set(t, fns);
      }
      fns.add(fn);
      return () => fns.delete(fn);
    },
    off(t, fn) {
      handlers.get(t)?.delete(fn);
    },
    /** Generate a client action id for play/callLiar/useChip (§3: `aid`). */
    nextAid() {
      return `a${++aidCounter}_${Date.now().toString(36)}`;
    },
    /** Test hook: dispatch a frame to handlers as if it came from the server. */
    _inject(t, p = {}) {
      emit(t, p);
    },
    isOpen() {
      return !!ws && ws.readyState === WebSocket.OPEN;
    },
  };
}
