// In-match driver — PLAN.md §2 (server/src/game/gameRoom.js).
//
// Owns everything the pure rules engine must not: real timers (turn deadline,
// penalty window, intermission), event broadcast with PRIVATE FILTERING
// (`hand` only to the owning seat; spectators never get `hand`), reconnect
// `state` snapshot building, seat→player mapping, and a per-seat event feed
// that P3's bot brains subscribe to (each feed carries exactly what a client
// at that seat would receive: public events + that seat's own `hand`).
//
// Bot seats & disconnected players: until P3's botManager claims a seat via
// setSeatDriven(), the fallback auto-play policy (sessions.getAutoPlayPolicy())
// acts for them shortly after their `turn` / `penalty` events — the same
// logic as the server-side turn-timeout auto-play (§3.4).

import { ERROR_CODES, MSG, ServerMsg } from '@monkeybar/shared/protocol.js';
import { AFK_MISSED_TURNS_LIMIT } from '@monkeybar/shared/constants.js';

import { createTable } from './table.js';
import { getEngineFactory } from './modes/index.js';
import { createLogger } from '../util/log.js';

/** Delay before the fallback policy acts for a bot / disconnected seat.
 *  Read at construction time so tests can tune it via the environment. */
const defaultAutoDelayMs = () => Number(process.env.MONKEYBAR_BOT_DELAY_MS) || 800;

// P3 wiring: bots/botManager.js registers itself here (once, at server
// bootstrap) and gets handed every freshly created gameRoom so it can attach
// brains to the bot seats before the match starts. Null (tests / no bots) is
// fine — the fallback auto-play below keeps every seat moving without it.
/** @type {((gameRoom: Object) => void)|null} */
let gameRoomCreatedHook = null;

/** @param {((gameRoom: Object) => void)|null} fn */
export function setGameRoomCreatedHook(fn) {
  gameRoomCreatedHook = fn;
}

const err = (code) => ({ ok: false, code });

/**
 * @param {Object} options
 * @param {string} options.roomId
 * @param {string} options.modeId
 * @param {string} options.mapId
 * @param {number} options.turnSeconds
 * @param {import('./table.js').SeatMeta[]} options.seatMetas  seat order = clockwise
 * @param {(playerId: string, envelope: {t: string, p: Object}) => void} options.send
 * @param {() => string[]} [options.getSpectatorIds]
 * @param {() => Object} [options.getAutoPlayPolicy]  P3 hook (see net/sessions.js)
 * @param {(playerId: string, seat: number) => void} [options.onAfk]
 *        called once when a CONNECTED human lets AFK_MISSED_TURNS_LIMIT turns
 *        time out in a row — the room kicks them and the seat becomes a bot
 * @param {(summary: {winnerSeat: number, standings: Object[]}) => void} [options.onMatchEnd]
 * @param {number} [options.seed]
 * @param {number} [options.autoDelayMs]
 * @param {Object} [options.engineOverrides]  extra engine options (tests)
 * @param {ReturnType<import('../util/log.js').createLogger>} [options.log]
 */
export function createGameRoom({
  roomId,
  modeId,
  mapId,
  turnSeconds,
  seatMetas,
  send,
  getSpectatorIds = () => [],
  getAutoPlayPolicy = () => null,
  onAfk = null,
  onMatchEnd = () => {},
  seed,
  autoDelayMs = defaultAutoDelayMs(),
  engineOverrides = {},
  log = createLogger('gameRoom'),
}) {
  const factory = getEngineFactory(modeId);
  if (!factory) throw new Error(`gameRoom: unknown mode '${modeId}'`);

  const table = createTable(seatMetas);

  let ended = false;
  let destroyed = false;
  /** Increments on every engine-emitted event; guards stale scheduled actions. */
  let epoch = 0;
  /** @type {ReturnType<typeof setTimeout>|null} main deadline timer */
  let deadlineTimer = null;
  /** @type {Set<ReturnType<typeof setTimeout>>} pending fallback actions */
  const fallbackTimers = new Set();
  /** Seats P3's botManager drives itself (fallback stays out of the way). */
  const drivenSeats = new Set();
  /** @type {Map<number, Set<Function>>} per-seat event feed subscribers (P3 hook) */
  const seatFeeds = new Map();

  // Policy proxy: resolves the CURRENT policy at call time so P3 can swap it in
  // (sessions.setAutoPlayPolicy) even mid-match.
  const enginePolicy = {
    chooseTimeoutPlay(view) {
      return getAutoPlayPolicy()?.chooseTimeoutPlay?.(view) ?? null;
    },
  };

  const engine = factory({
    table,
    seed,
    turnSeconds,
    mapId,
    onEvent: handleEngineEvent,
    autoPlayPolicy: enginePolicy,
    ...engineOverrides,
  });

  // ---- broadcast + private filtering -----------------------------------------

  function safeSend(playerId, envelope) {
    try {
      send(playerId, envelope);
    } catch (e) {
      log.warn(`send to ${playerId} failed:`, e.message);
    }
  }

  function feedSeat(seat, envelope) {
    const fns = seatFeeds.get(seat);
    if (!fns) return;
    for (const fn of [...fns]) {
      try {
        fn(envelope);
      } catch (e) {
        log.warn(`seat feed ${seat} handler failed:`, e.message);
      }
    }
  }

  /** Public envelope → every seated human + all spectators + every seat feed. */
  function broadcastPublic(envelope) {
    for (const s of table.seats) {
      if (!s.isBot) safeSend(s.playerId, envelope);
      feedSeat(s.seat, envelope);
    }
    for (const id of getSpectatorIds()) safeSend(id, envelope);
  }

  /** @param {import('./modes/monkeyLies.js').EngineEvent} evt */
  function handleEngineEvent(evt) {
    if (destroyed) return;
    epoch += 1;
    const envelope = { t: evt.t, p: evt.p };
    if (evt.seat !== undefined) {
      // PRIVATE (e.g. `hand`): owner only — never spectators, never other seats.
      const s = table.get(evt.seat);
      if (!s.isBot) safeSend(s.playerId, envelope);
      feedSeat(evt.seat, envelope);
    } else {
      broadcastPublic(envelope);
      if (evt.t === MSG.TURN) maybeScheduleFallback('turn', evt.p.seat);
      else if (evt.t === MSG.PENALTY) maybeScheduleFallback('penalty', evt.p.seat);
      else if (evt.t === MSG.MATCH_END) finishMatch(evt.p);
    }
  }

  function finishMatch(p) {
    ended = true;
    clearTimers();
    // Let the matchEnd broadcast finish flushing before the room tears us down.
    queueMicrotask(() => onMatchEnd(p));
  }

  // ---- timers -----------------------------------------------------------------

  function clearTimers() {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
      deadlineTimer = null;
    }
    for (const t of fallbackTimers) clearTimeout(t);
    fallbackTimers.clear();
  }

  /** Keep the single real deadline timer in sync with the engine's state. */
  function syncTimer() {
    if (destroyed || ended) return;
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
      deadlineTimer = null;
    }
    const timer = engine.getTimer();
    if (!timer) return;
    const wait = Math.max(0, timer.deadline - Date.now());
    deadlineTimer = setTimeout(() => {
      deadlineTimer = null;
      if (destroyed || ended) return;
      const turnSeat = timer.kind === 'turn' ? engine.turnSeat : -1;
      engine.onTimeout(timer.kind);
      if (turnSeat !== -1) noteMissedTurn(turnSeat);
      syncTimer();
    }, wait);
  }

  // ---- AFK detection (P7 hardening) --------------------------------------------
  // A CONNECTED human whose turn hits the real deadline (server auto-plays for
  // them) is "missing turns". After AFK_MISSED_TURNS_LIMIT consecutive misses,
  // onAfk kicks them from the room, which converts the seat to a bot.
  // Disconnected players are excluded — the §3.4 reconnect hold covers them.

  /** @type {Map<number, number>} seat → consecutive missed turns */
  const missedTurns = new Map();

  function noteMissedTurn(seat) {
    if (!onAfk || destroyed || ended) return;
    const s = table.get(seat);
    if (s.isBot || !s.connected || !s.alive) return;
    const misses = (missedTurns.get(seat) ?? 0) + 1;
    missedTurns.set(seat, misses);
    if (misses < AFK_MISSED_TURNS_LIMIT) return;
    missedTurns.delete(seat);
    log.info(`room ${roomId}: seat ${seat} (${s.name}) AFK after ${misses} missed turns`);
    broadcastPublic(
      ServerMsg.chat({
        seat: null,
        name: '🍹 The Bar',
        text: `${s.name} dozed off at the table — a bot takes the stool.`,
      })
    );
    try {
      onAfk(s.playerId, seat);
    } catch (e) {
      log.warn('onAfk handler failed:', e.message);
    }
  }

  /** Should the server act for this seat (bot without a P3 driver, or offline)? */
  function isAutoDriven(seat) {
    const s = table.get(seat);
    if (s.isBot) return !drivenSeats.has(seat);
    return !s.connected;
  }

  function maybeScheduleFallback(kind, seat) {
    if (destroyed || ended || !isAutoDriven(seat)) return;
    const scheduledEpoch = epoch;
    const t = setTimeout(() => {
      fallbackTimers.delete(t);
      if (destroyed || ended) return;
      // Stale if the game advanced (any event fired) or a human reclaimed the seat.
      if (epoch !== scheduledEpoch || !isAutoDriven(seat)) return;
      runFallback(kind, seat);
    }, autoDelayMs);
    fallbackTimers.add(t);
  }

  function runFallback(kind, seat) {
    const policy = getAutoPlayPolicy();
    if (kind === 'turn') {
      // Same logic as the §3.4 turn-timeout: auto-play one card (or the
      // Last-Monkey-Holding self-shot). Never auto-calls.
      engine.onTimeout('turn');
    } else if (kind === 'penalty') {
      const s = table.get(seat);
      let useChip = false;
      try {
        useChip = !!policy?.choosePenaltyChip?.({
          chips: s.chips,
          chambersLeft: s.chambersLeft,
          coconuts: s.coconuts,
        });
      } catch {
        useChip = false;
      }
      if (useChip && s.chips > 0) engine.useChip(seat);
      else engine.resolvePenalty();
    }
    syncTimer();
  }

  // ---- player actions -----------------------------------------------------------

  /**
   * Route a §3.2 game action from a player. Returns {ok, code?} — the caller
   * (net layer) wraps it into an `actionAck`.
   * @param {string} playerId
   * @param {string} type   MSG.PLAY | MSG.CALL_LIAR | MSG.USE_CHIP
   * @param {Object} p
   */
  function act(playerId, type, p) {
    if (destroyed || ended) return err(ERROR_CODES.BAD_STATE);
    const seat = table.seatOf(playerId);
    if (seat === -1) return err(ERROR_CODES.BAD_STATE);
    const result = actForSeat(seat, type, p);
    if (result.ok) missedTurns.delete(seat); // any real action clears AFK strikes
    return result;
  }

  /** Seat-level action entry (also the P3 bot hook). */
  function actForSeat(seat, type, p = {}) {
    if (destroyed || ended) return err(ERROR_CODES.BAD_STATE);
    let result;
    if (type === MSG.PLAY) result = engine.play(seat, p.cardIds);
    else if (type === MSG.CALL_LIAR) result = engine.callLiar(seat);
    else if (type === MSG.USE_CHIP) result = engine.useChip(seat);
    else result = err(ERROR_CODES.BAD_MSG);
    syncTimer();
    return result;
  }

  // ---- connections / seats ---------------------------------------------------------

  /**
   * Mark a seated player (dis)connected; broadcasts `conn` and lets the
   * fallback policy cover their pending turn/penalty while offline.
   */
  function setConnected(playerId, connected) {
    const seat = table.seatOf(playerId);
    if (seat === -1) return false;
    const s = table.get(seat);
    if (s.connected === connected) return true;
    table.setConnected(seat, connected);
    broadcastPublic(ServerMsg.conn({ seat, connected }));
    if (!connected && !ended) {
      if (engine.phase === 'playing' && engine.turnSeat === seat) {
        maybeScheduleFallback('turn', seat);
      } else if (engine.phase === 'penalty') {
        const pen = engine.inspect?.().penalty;
        if (pen && pen.seat === seat) maybeScheduleFallback('penalty', seat);
      }
    }
    return true;
  }

  /**
   * Permanently convert a seat to a bot (reconnect hold expired / player left
   * mid-match). P3's botManager may then claim it via setSeatDriven().
   * @param {number} seat
   * @param {string} [personality]
   */
  function convertSeatToBot(seat, personality = 'cautious') {
    const s = table.get(seat);
    if (s.isBot) return s;
    s.isBot = true;
    s.personality = personality;
    s.connected = true;
    log.info(`room ${roomId}: seat ${seat} (${s.name}) converted to bot (${personality})`);
    // Cover an in-flight turn/penalty for the fresh bot.
    if (!ended) {
      if (engine.phase === 'playing' && engine.turnSeat === seat) {
        maybeScheduleFallback('turn', seat);
      } else if (engine.phase === 'penalty') {
        const pen = engine.inspect?.().penalty;
        if (pen && pen.seat === seat) maybeScheduleFallback('penalty', seat);
      }
    }
    return s;
  }

  // ---- snapshots -------------------------------------------------------------------

  /**
   * Reconnect / spectate `state` snapshot. Pass a seated playerId for the
   * private view (their hand), anything else for the spectator view.
   * @param {string|null} playerId
   */
  function snapshotFor(playerId) {
    const seat = playerId ? table.seatOf(playerId) : -1;
    return engine.snapshotFor(seat === -1 ? null : seat);
  }

  // ---- P3 bot hook points ------------------------------------------------------------

  /**
   * Subscribe to the event feed of one seat: exactly the envelopes a client
   * seated there would receive (all public events + that seat's `hand`).
   * @param {number} seat
   * @param {(envelope: {t: string, p: Object}) => void} fn
   * @returns {() => void} unsubscribe
   */
  function subscribeSeat(seat, fn) {
    let fns = seatFeeds.get(seat);
    if (!fns) {
      fns = new Set();
      seatFeeds.set(seat, fns);
    }
    fns.add(fn);
    return () => fns.delete(fn);
  }

  /** P3: claim/release a bot seat so the fallback auto-play stays out of the way. */
  function setSeatDriven(seat, driven) {
    if (driven) drivenSeats.add(seat);
    else drivenSeats.delete(seat);
  }

  // ---- lifecycle -----------------------------------------------------------------------

  function start() {
    engine.start();
    syncTimer();
  }

  function destroy() {
    destroyed = true;
    ended = true;
    clearTimers();
    seatFeeds.clear();
  }

  const api = {
    roomId,
    modeId,
    mapId,
    table,
    engine,
    start,
    act,
    actForSeat,
    setConnected,
    convertSeatToBot,
    snapshotFor,
    subscribeSeat,
    setSeatDriven,
    destroy,
    get ended() {
      return ended;
    },
  };

  // P3 wiring: let the botManager claim this room's bot seats (see hook above).
  if (gameRoomCreatedHook) {
    try {
      gameRoomCreatedHook(api);
    } catch (e) {
      log.warn('gameRoomCreated hook failed:', e.message);
    }
  }

  return api;
}
