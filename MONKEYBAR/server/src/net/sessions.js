// Session registry — PLAN.md §2 (server/src/net/sessions.js) & §3.4.
//
// Issues {playerId, token} pairs on `hello`, resumes sessions on reconnect
// (reattaching to the existing room/game), and runs the 60 s in-match hold:
// a disconnected seated player's turns are auto-played meanwhile, and when
// the hold expires the seat converts permanently to a bot.
//
// P3 HOOK POINTS (bots/botManager.js plugs in here):
//   setAutoPlayPolicy(policy) / getAutoPlayPolicy()
//     policy = {
//       chooseTimeoutPlay({hand, tableFruit, rng}) -> string[] cardIds  (never calls)
//       choosePenaltyChip({chips, chambersLeft, coconuts}) -> boolean
//     }
//   setSeatConverter(fn) / convertSeatToBot(gameRoom, seat, opts)
//     fn(gameRoom, seat, {personality, reason}) — attach a real brain, etc.
// The trivial fallbacks below keep the server fully playable without P3:
// timeout auto-play plays 1 matching card else 1 random, never auto-calls,
// never spends the chip; seat conversion just flips the seat to a bot that
// the gameRoom fallback drives with the same policy.

import { randomUUID } from 'node:crypto';

import { RECONNECT_HOLD_MS } from '@monkeybar/shared/constants.js';

import { chooseAutoPlayCards } from '../game/modes/monkeyLies.js';
import { createLogger } from '../util/log.js';

/**
 * The trivial fallback policy (identical to the §3.4 server-side turn-timeout
 * logic). P3's Cautious brain replaces it via setAutoPlayPolicy().
 */
export const fallbackAutoPlayPolicy = Object.freeze({
  chooseTimeoutPlay({ hand, tableFruit, rng }) {
    return chooseAutoPlayCards(hand, tableFruit, rng);
  },
  choosePenaltyChip() {
    return false; // hoard the chip — never auto-spend for an absent player
  },
});

/** How often the idle-session sweep runs. */
const SWEEP_INTERVAL_MS = 60_000;
/** Idle sessions (no conn, room, spectate, or hold) are evicted after this. */
const DEFAULT_IDLE_TTL_MS = 30 * 60_000;

/**
 * @typedef {Object} Session
 * @property {string} playerId
 * @property {string} token
 * @property {string} name
 * @property {string|null} monkeyId
 * @property {import('@monkeybar/shared/protocol.js').EquippedCosmetics} equipped
 *           equipped cosmetic ids, mirrored from the profile store (§10.3) —
 *           refreshed on issue/resume and by the equipCosmetic handler
 * @property {Object|null} conn          active connection wrapper (net/connection.js)
 * @property {string|null} roomId        room the player is a member of
 * @property {string|null} spectatingRoomId
 * @property {Map<string, Object>} acks  aid → actionAck envelope (dedup, §3.4)
 * @property {ReturnType<typeof setTimeout>|null} holdTimer
 * @property {number} lastActiveAt       epoch ms of last issue/attach/detach
 */

/**
 * @param {Object} [options]
 * @param {ReturnType<import('../util/log.js').createLogger>} [options.log]
 * @param {number} [options.holdMs]
 * @param {number} [options.idleTtlMs]
 * @param {ReturnType<import('../persist/profileStore.js').createProfileStore>|null} [options.profileStore]
 *        R2 economy: identity source for profiles (token→playerId, §B.5-1);
 *        sessions mirror the equipped cosmetics from it
 */
export function createSessions({
  log = createLogger('sessions'),
  holdMs = RECONNECT_HOLD_MS,
  idleTtlMs = DEFAULT_IDLE_TTL_MS,
  profileStore = null,
} = {}) {
  /** @type {Map<string, Session>} token → session */
  const byToken = new Map();
  /** @type {Map<string, Session>} playerId → session */
  const byId = new Map();

  let nameCounter = 0;

  // ---- idle-session TTL sweep ---------------------------------------------------
  // Tokens are never re-announced, so fully idle sessions (no live connection,
  // no room membership, not spectating, no reconnect hold) would otherwise
  // accumulate forever. Evict them once they exceed idleTtlMs of inactivity.

  function sweepIdleSessions() {
    const nowTs = Date.now();
    for (const session of byToken.values()) {
      if (session.conn || session.roomId || session.spectatingRoomId || session.holdTimer) continue;
      if (nowTs - session.lastActiveAt <= idleTtlMs) continue;
      byToken.delete(session.token);
      byId.delete(session.playerId);
      log.info(`evicted idle session ${session.name} (${session.playerId})`);
    }
  }

  const sweepTimer = setInterval(sweepIdleSessions, SWEEP_INTERVAL_MS);
  if (sweepTimer.unref) sweepTimer.unref();

  // ---- P3 hook points ---------------------------------------------------------

  let autoPlayPolicy = fallbackAutoPlayPolicy;

  function getAutoPlayPolicy() {
    return autoPlayPolicy;
  }

  /** P3: install the real bot decision policy (pass null to restore fallback). */
  function setAutoPlayPolicy(policy) {
    autoPlayPolicy = policy ?? fallbackAutoPlayPolicy;
  }

  /** @type {(gameRoom: Object, seat: number, opts: {personality?: string, reason?: string}) => void} */
  let seatConverter = (gameRoom, seat, { personality = 'cautious' } = {}) => {
    gameRoom.convertSeatToBot(seat, personality);
  };

  /** P3: replace how an abandoned seat becomes a live bot (attach a brain). */
  function setSeatConverter(fn) {
    seatConverter = fn;
  }

  /** Convert a seat to a bot for the rest of the match (hold expiry / leave). */
  function convertSeatToBot(gameRoom, seat, opts = {}) {
    seatConverter(gameRoom, seat, { personality: 'cautious', reason: 'holdExpired', ...opts });
  }

  // ---- session lifecycle ---------------------------------------------------------

  /** @param {{name?: string}} [profile] */
  function issue(profile = {}) {
    const session = {
      playerId: randomUUID(),
      token: randomUUID(),
      name: normalizeName(profile.name),
      monkeyId: null,
      equipped: {},
      conn: null,
      roomId: null,
      spectatingRoomId: null,
      acks: new Map(),
      holdTimer: null,
      lastActiveAt: Date.now(),
    };
    if (profileStore) {
      session.equipped = profileStore.getEquipped(session.playerId);
      profileStore.bindToken(session.token, session.playerId); // identity survives restarts
    }
    byToken.set(session.token, session);
    byId.set(session.playerId, session);
    return session;
  }

  function normalizeName(name) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    return trimmed.length > 0 ? trimmed : `Monkey-${++nameCounter}${Math.floor(Math.random() * 90 + 10)}`;
  }

  /** @param {string|undefined} token @returns {Session|null} */
  function resume(token) {
    if (typeof token !== 'string') return null;
    let session = byToken.get(token) ?? null;
    if (!session && profileStore) {
      // Post-restart: the live session map is gone, but the profile store
      // remembers which playerId this token identifies (§B.5-1) — rebuild a
      // fresh session around the SAME identity so coins/cosmetics survive.
      const playerId = profileStore.resolveToken(token);
      if (playerId) {
        session = {
          playerId,
          token,
          name: normalizeName(),
          monkeyId: null,
          equipped: {},
          conn: null,
          roomId: null,
          spectatingRoomId: null,
          acks: new Map(),
          holdTimer: null,
          lastActiveAt: Date.now(),
        };
        byToken.set(token, session);
        byId.set(playerId, session);
      }
    }
    // Re-mirror the persisted equipped set (the profile outlives the socket).
    if (session && profileStore) session.equipped = profileStore.getEquipped(session.playerId);
    return session;
  }

  /** @param {string} playerId @returns {Session|null} */
  function get(playerId) {
    return byId.get(playerId) ?? null;
  }

  /** @returns {Session[]} every known session (lobbyManager broadcasts, sweeps) */
  function all() {
    return [...byId.values()];
  }

  /**
   * Attach a live connection. If the session already has one (second tab /
   * zombie socket), the old connection is terminated — the session moves.
   */
  function attach(session, conn) {
    if (session.conn && session.conn !== conn) {
      try {
        session.conn.terminate('session takeover');
      } catch {
        /* already dead */
      }
    }
    session.conn = conn;
    session.lastActiveAt = Date.now();
    cancelHold(session);
  }

  function detach(session, conn) {
    if (session.conn === conn) session.conn = null;
    session.lastActiveAt = Date.now();
  }

  /** Deliver an envelope to a session's live connection (drops if offline). */
  function sendTo(playerId, envelope) {
    const session = byId.get(playerId);
    session?.conn?.send(envelope);
  }

  // ---- reconnect hold (§3.4) ---------------------------------------------------

  /**
   * Hold a disconnected in-match player's seat for 60 s, then hand it to a bot.
   * @param {Session} session
   * @param {() => void} onExpire
   */
  function beginHold(session, onExpire) {
    cancelHold(session);
    session.holdTimer = setTimeout(() => {
      session.holdTimer = null;
      log.info(`hold expired for ${session.name} (${session.playerId})`);
      onExpire();
    }, holdMs);
    if (session.holdTimer.unref) session.holdTimer.unref();
  }

  function cancelHold(session) {
    if (session.holdTimer) {
      clearTimeout(session.holdTimer);
      session.holdTimer = null;
    }
  }

  /** aid dedup (§3.4): remember the ack for each action id, capped per session. */
  function rememberAck(session, aid, envelope) {
    session.acks.set(aid, envelope);
    if (session.acks.size > 64) {
      const oldest = session.acks.keys().next().value;
      session.acks.delete(oldest);
    }
  }

  function shutdown() {
    clearInterval(sweepTimer);
    for (const session of byToken.values()) cancelHold(session);
    byToken.clear();
    byId.clear();
  }

  return {
    issue,
    resume,
    get,
    all,
    attach,
    detach,
    sendTo,
    beginHold,
    cancelHold,
    rememberAck,
    normalizeName,
    getAutoPlayPolicy,
    setAutoPlayPolicy,
    setSeatConverter,
    convertSeatToBot,
    shutdown,
    get count() {
      return byToken.size;
    },
  };
}
