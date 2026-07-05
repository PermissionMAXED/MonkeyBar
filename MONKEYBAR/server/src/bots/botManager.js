// botManager — attaches a BotBrain to every bot seat and drives it through
// P2's REAL hook points. PLAN.md §5.
//
// Wiring (see initBotManager, called once from server/src/index.js):
//   * game/gameRoom.js  setGameRoomCreatedHook → attachToGameRoom(gameRoom):
//       covers host-added bots AND quickmatch bot-fill (every match's bot
//       seats get a brain before engine.start()).
//   * net/sessions.js   setSeatConverter → convert + attachSeat(gameRoom, seat):
//       covers seats converted from disconnected/leaving players mid-match.
//   * net/sessions.js   setAutoPlayPolicy(Cautious) — §3.4: a HELD (still
//       reconnectable) human seat plays through the Cautious policy.
//
// Per bot seat: subscribe to that seat's event feed (exactly what a client
// there would see), claim the seat via gameRoom.setSeatDriven so the fallback
// stays out of the way, and on `turn` / own `penalty` schedule the brain's
// decision after a humanized delay = base + difficulty × U(0, 2.5 × base)
// (base 1200 ms ⇒ §5's "1.2 s + difficulty × U(0, 3 s)"; the MONKEYBAR_BOT_DELAY_MS
// env knob P2 introduced scales bots down for tests). Personality-keyed
// emote/quickPhrase reactions are broadcast through the lobby room.

import { ERROR_CODES, MSG, ServerMsg } from '@monkeybar/shared/protocol.js';
import { PENALTY_WINDOW_MS } from '@monkeybar/shared/constants.js';

import { setGameRoomCreatedHook } from '../game/gameRoom.js';
import { createAutoPlayPolicy, createBotBrain } from './botBrain.js';
import { getPersonality, randomPersonalityId } from './personalities.js';
import { createLogger } from '../util/log.js';

/** §5 default humanized-delay base (ms). Overridable via MONKEYBAR_BOT_DELAY_MS. */
const DEFAULT_DELAY_BASE_MS = 1200;
/** Jitter span = base × this (1200 × 2.5 = §5's U(0, 3 s)). */
const JITTER_FACTOR = 2.5;
/** Self-imposed social cooldowns (server-side bots bypass the wire rate limits). */
const REACTION_GAP_MS = 2200;
const SPAM_REACTION_GAP_MS = 2000; // Trollish emote spam still breathes a little
/** Big-moment reaction keys that bypass the self-throttle gap entirely. */
const HIGH_PRIORITY_REACTIONS = new Set(['gotShot', 'surviveShot', 'bigWin']);

/** Read lazily so tests that set the env var after import still win. */
function delayBaseMs() {
  const v = Number(process.env.MONKEYBAR_BOT_DELAY_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_DELAY_BASE_MS;
}

/**
 * @param {Object} [options]
 * @param {ReturnType<import('../net/sessions.js').createSessions>} [options.sessions]
 * @param {ReturnType<import('../lobby/lobbyManager.js').createLobbyManager>} [options.lobby]
 * @param {number} [options.difficulty]  scales the humanized-delay jitter (§5)
 * @param {(gameRoom: Object, envelope: {t: string, p: Object}) => void} [options.socialBroadcast]
 *        override for emote/quickPhrase delivery (defaults to the lobby room)
 * @param {() => number} [options.rng]
 * @param {ReturnType<import('../util/log.js').createLogger>} [options.log]
 */
export function createBotManager({
  sessions = null,
  lobby = null,
  difficulty = 1,
  socialBroadcast = null,
  rng = Math.random,
  log = createLogger('bots'),
} = {}) {
  /** @type {Map<Object, {bots: Map<number, Object>, disposed: boolean, timers: Set<Object>}>} */
  const rooms = new Map();
  let installed = false;

  // ---- humanized delays (§5) ------------------------------------------------

  function decisionDelayMs(personality) {
    const base = delayBaseMs();
    const jitterMax = base * JITTER_FACTOR * difficulty;
    // Mathematical signature: even, metronomic delays — no jitter.
    if (personality.evenDelays) return Math.round(base + jitterMax / 2);
    return Math.round(base + rng() * jitterMax);
  }

  // ---- social broadcast --------------------------------------------------------

  /** Default: deliver through the lobby room so humans + spectators see it. */
  function defaultSocialBroadcast(gameRoom, envelope) {
    if (!lobby) return;
    const room = lobby.getRoom(gameRoom.roomId);
    if (!room || room.closed) return;
    // Post-match banter (room.gameRoom already null) is fine; a *different*
    // running gameRoom means our seat numbers are stale — stay quiet then.
    if (room.gameRoom && room.gameRoom !== gameRoom) return;
    room.broadcast(envelope);
  }

  const emitSocial = (gameRoom, envelope) => {
    try {
      (socialBroadcast ?? defaultSocialBroadcast)(gameRoom, envelope);
    } catch (e) {
      log.warn('social broadcast failed:', e.message);
    }
  };

  // ---- per-room bookkeeping -------------------------------------------------------

  function roomRec(gameRoom) {
    let rec = rooms.get(gameRoom);
    if (!rec) {
      rec = { bots: new Map(), disposed: false, timers: new Set() };
      rooms.set(gameRoom, rec);
      sweepEndedRooms(gameRoom);
    }
    return rec;
  }

  /** Drop bookkeeping for matches that ended (rooms Map must not grow forever). */
  function sweepEndedRooms(except) {
    for (const [gr] of rooms) {
      if (gr !== except && gr.ended) disposeRoom(gr);
    }
  }

  function disposeRoom(gameRoom) {
    const rec = rooms.get(gameRoom);
    if (!rec) return;
    rec.disposed = true;
    for (const t of rec.timers) clearTimeout(t);
    rec.timers.clear();
    for (const bot of rec.bots.values()) bot.unsubscribe?.();
    rec.bots.clear();
    rooms.delete(gameRoom);
  }

  function schedule(rec, delay, fn) {
    const t = setTimeout(() => {
      rec.timers.delete(t);
      if (rec.disposed) return;
      try {
        fn();
      } catch (e) {
        log.warn('bot timer failed:', e.message);
      }
    }, delay);
    if (t.unref) t.unref();
    rec.timers.add(t);
    return t;
  }

  // ---- decisions ---------------------------------------------------------------------

  /**
   * Re-prime a brain from the same reconnect snapshot a client at that seat
   * would receive (gameRoom.snapshotFor is public info + own hand — NOT a
   * cheat). Used to repair own-hand desync after server auto-plays.
   */
  function rePrimeFromSnapshot(gameRoom, bot) {
    const playerId = gameRoom.table.get(bot.seat).playerId;
    bot.brain.primeFromSnapshot(gameRoom.snapshotFor(playerId));
  }

  function scheduleTurnDecision(gameRoom, rec, bot) {
    if (bot.pendingTimer) clearTimeout(bot.pendingTimer);
    let retried = false; // per-schedule guard: at most ONE re-prime + retry
    const attempt = () => {
      bot.pendingTimer = null;
      if (gameRoom.ended) return;
      const action = bot.brain.decideTurn(); // null ⇒ stale (turn already moved on)
      if (!action) return;
      // Engine events fire synchronously inside actForSeat — BEFORE the
      // commit below. Flag the window so the own-`played` desync check knows
      // this play is ours (about to be committed), not a server auto-play.
      bot.acting = true;
      let res;
      try {
        if (action.type === 'call') {
          res = gameRoom.actForSeat(bot.seat, MSG.CALL_LIAR);
        } else {
          res = gameRoom.actForSeat(bot.seat, MSG.PLAY, { cardIds: action.cardIds });
        }
      } finally {
        bot.acting = false;
      }
      if (res.ok) {
        bot.brain.onOwnActionApplied(action);
        return;
      }
      if (res.code === ERROR_CODES.INVALID_CARDS && !retried) {
        // The tracked hand desynced from the server's (e.g. a deadline
        // auto-play consumed cards the brain still counts). Re-prime from the
        // reconnect snapshot and retry the decision once — never loop.
        retried = true;
        log.debug(`seat ${bot.seat} play invalid — re-priming from snapshot and retrying once`);
        rePrimeFromSnapshot(gameRoom, bot);
        attempt();
        return;
      }
      log.debug(`seat ${bot.seat} ${action.type} rejected (${res.code}) — raced, skipping`);
    };
    bot.pendingTimer = schedule(rec, decisionDelayMs(bot.personality), attempt);
  }

  function schedulePenaltyDecision(gameRoom, rec, bot) {
    if (bot.pendingTimer) clearTimeout(bot.pendingTimer);
    // Decide comfortably before the penalty window slams shut (the env-scaled
    // base keeps tests' tiny delays intact; the clamp only caps the ceiling).
    const delay = Math.min(decisionDelayMs(bot.personality), PENALTY_WINDOW_MS - 1200);
    bot.pendingTimer = schedule(rec, delay, () => {
      bot.pendingTimer = null;
      if (gameRoom.ended) return;
      const decision = bot.brain.decidePenalty(); // null ⇒ stale
      if (!decision) return;
      if (decision.useChip) {
        const res = gameRoom.actForSeat(bot.seat, MSG.USE_CHIP);
        if (res.ok) return; // chip lights the fuse itself
      }
      // Decline (or chip raced away): fire now instead of dragging out the
      // full 5 s window. Seat-validated route — a stale window is a no-op.
      gameRoom.resolvePenalty(bot.seat);
    });
  }

  // ---- reactions -----------------------------------------------------------------------

  function scheduleReaction(gameRoom, rec, bot, reaction) {
    const now = Date.now();
    const gap = bot.personality.emoteSpam ? SPAM_REACTION_GAP_MS : REACTION_GAP_MS;
    // Big moments (own shot, survival, match win) always land — the gap only
    // throttles ambient chatter.
    if (!HIGH_PRIORITY_REACTIONS.has(reaction.key) && now - bot.lastReactionAt < gap) return;
    schedule(rec, 250 + Math.floor(rng() * 1200), () => {
      bot.lastReactionAt = Date.now(); // stamped when the reaction FIRES, not at schedule time
      if (reaction.emoteId) emitSocial(gameRoom, ServerMsg.emote({ seat: bot.seat, emoteId: reaction.emoteId }));
      if (reaction.phraseId) {
        emitSocial(gameRoom, ServerMsg.quickPhrase({ seat: bot.seat, phraseId: reaction.phraseId }));
      }
    });
  }

  // ---- attachment -----------------------------------------------------------------------

  /**
   * Attach a brain to one bot seat: subscribe to its private event feed,
   * claim it (setSeatDriven) so P2's fallback stays away, and prime it from
   * the reconnect snapshot when taking over mid-match.
   * @param {Object} gameRoom  ReturnType<createGameRoom>
   * @param {number} seat
   */
  function attachSeat(gameRoom, seat) {
    if (gameRoom.ended) return null;
    const rec = roomRec(gameRoom);
    if (rec.bots.has(seat)) return rec.bots.get(seat);

    const seatInfo = gameRoom.table.get(seat);
    const personalityId = getPersonality(seatInfo.personality ?? randomPersonalityId(rng)).id;
    const brain = createBotBrain({ seat, personalityId, rng });
    const bot = {
      seat,
      brain,
      personality: getPersonality(personalityId),
      pendingTimer: null,
      lastReactionAt: 0,
      acting: false, // true while this bot's own action is inside actForSeat
      unsubscribe: null,
    };
    rec.bots.set(seat, bot);

    bot.unsubscribe = gameRoom.subscribeSeat(seat, (envelope) => {
      const reaction = brain.observe(envelope);
      if (reaction) scheduleReaction(gameRoom, rec, bot, reaction);
      const { t, p } = envelope;
      if (t === MSG.PLAYED && p.seat === seat && !bot.acting && bot.brain.inspect().handSize !== p.handCount) {
        // The server acted for this seat (deadline auto-play race): the
        // brain's tracked hand no longer matches the authoritative count.
        // Repair from the reconnect snapshot so the next decision stays legal.
        log.debug(`seat ${seat} hand desynced (server auto-play) — re-primed from snapshot`);
        rePrimeFromSnapshot(gameRoom, bot);
      }
      if (t === MSG.TURN && p.seat === seat) {
        scheduleTurnDecision(gameRoom, rec, bot);
      } else if (t === MSG.PENALTY && p.seat === seat) {
        schedulePenaltyDecision(gameRoom, rec, bot);
      } else if (t === MSG.MATCH_END) {
        if (bot.pendingTimer) clearTimeout(bot.pendingTimer);
        // Leave a short grace window so bigWin/gg reactions still land.
        schedule(rec, 4000, () => disposeRoom(gameRoom));
      }
    });
    gameRoom.setSeatDriven(seat, true);

    // Mid-match takeover (converted seat): prime from the same snapshot a
    // reconnecting client would receive, then cover any in-flight decision.
    const snap = gameRoom.snapshotFor(seatInfo.playerId);
    if (snap && snap.roundNo > 0) {
      brain.primeFromSnapshot(snap);
      if (snap.phase === 'playing' && snap.turnSeat === seat) {
        scheduleTurnDecision(gameRoom, rec, bot);
      } else if (snap.phase === 'penalty') {
        // Penalty ownership is public (the `penalty` event was broadcast);
        // inspect() is used server-side only to re-read it after the fact.
        const pen = gameRoom.engine.inspect?.().penalty;
        if (pen && pen.seat === seat) {
          brain.primePenalty({
            chambers: seatInfo.chambersLeft,
            coconuts: seatInfo.coconuts,
            chipUsable: seatInfo.chips > 0,
          });
          schedulePenaltyDecision(gameRoom, rec, bot);
        }
      }
    }
    log.debug(`attached ${personalityId} brain to seat ${seat} (${seatInfo.name}) in ${gameRoom.roomId}`);
    return bot;
  }

  /** Attach brains to every bot seat of a match (host-added + quickmatch fill). */
  function attachToGameRoom(gameRoom) {
    for (const s of gameRoom.table.seats) {
      if (s.isBot) attachSeat(gameRoom, s.seat);
    }
  }

  // ---- P2 hook installation --------------------------------------------------------------

  /** Wire into P2's anticipated hook points (idempotent per manager). */
  function install() {
    if (installed) return api;
    installed = true;
    setGameRoomCreatedHook((gameRoom) => {
      try {
        attachToGameRoom(gameRoom);
      } catch (e) {
        log.warn('failed to attach bots to new gameRoom:', e.message);
      }
    });
    if (sessions) {
      // §3.4: held human seats auto-play via the Cautious policy.
      sessions.setAutoPlayPolicy(createAutoPlayPolicy('cautious', rng));
      // Hold expired / player left mid-match: convert the seat AND give it a brain.
      sessions.setSeatConverter((gameRoom, seat, opts = {}) => {
        const personality = opts.personality ?? 'cautious';
        gameRoom.convertSeatToBot(seat, personality);
        attachSeat(gameRoom, seat);
      });
    }
    return api;
  }

  function dispose() {
    if (installed) {
      installed = false;
      setGameRoomCreatedHook(null);
      if (sessions) {
        sessions.setAutoPlayPolicy(null); // restore P2's fallback
        sessions.setSeatConverter((gameRoom, seat, opts = {}) => {
          gameRoom.convertSeatToBot(seat, opts.personality ?? 'cautious');
        });
      }
    }
    for (const gr of [...rooms.keys()]) disposeRoom(gr);
  }

  const api = {
    install,
    dispose,
    attachToGameRoom,
    attachSeat,
    decisionDelayMs,
    get roomCount() {
      return rooms.size;
    },
  };
  return api;
}

/**
 * One-call bootstrap used by server/src/index.js: create the manager and
 * install it into P2's hook points.
 * @param {Parameters<typeof createBotManager>[0]} [options]
 */
export function initBotManager(options = {}) {
  return createBotManager(options).install();
}
