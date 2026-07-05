// Seats, turn order (clockwise = ascending seat index, wrapping), elimination,
// chips, chambers/coconuts state — PLAN.md §2 (server/src/game/table.js).
//
// The table is dumb state: the rules engine (game/modes/*) mutates it, the
// gameRoom reads it for routing/snapshots. No networking, no timers.

import {
  CHIPS_PER_MATCH,
  START_CHAMBERS,
  START_COCONUTS,
} from '@monkeybar/shared/constants.js';

/**
 * @typedef {Object} SeatMeta
 * @property {string} playerId   unique id ("bot-N" ids for bot seats)
 * @property {string} name
 * @property {string} [monkeyId]
 * @property {boolean} [isBot]
 * @property {string} [personality]  bot personality tag (P3 uses this)
 * @property {import('@monkeybar/shared/protocol.js').EquippedCosmetics|null} [cosmetics]
 *           equipped cosmetic ids (§10.3) — passed straight through to SeatPublic
 */

/**
 * @typedef {Object} Seat
 * @property {number} seat
 * @property {string} playerId
 * @property {string} name
 * @property {string|null} monkeyId
 * @property {boolean} isBot
 * @property {string|null} personality
 * @property {import('@monkeybar/shared/protocol.js').EquippedCosmetics|null} cosmetics
 * @property {boolean} connected
 * @property {boolean} alive
 * @property {import('@monkeybar/shared/protocol.js').Card[]} hand
 * @property {number} chips
 * @property {number} chambersLeft
 * @property {number} coconuts
 */

/**
 * @param {SeatMeta[]} seatMetas  seat order = clockwise turn order
 */
export function createTable(seatMetas) {
  if (!Array.isArray(seatMetas) || seatMetas.length < 2) {
    throw new RangeError('createTable: need at least 2 seat metas');
  }

  /** @type {Seat[]} */
  const seats = seatMetas.map((meta, i) => ({
    seat: i,
    playerId: meta.playerId,
    name: meta.name,
    monkeyId: meta.monkeyId ?? null,
    isBot: !!meta.isBot,
    personality: meta.personality ?? null,
    cosmetics: meta.cosmetics ?? null,
    connected: true,
    alive: true,
    hand: [],
    chips: CHIPS_PER_MATCH,
    chambersLeft: START_CHAMBERS,
    coconuts: START_COCONUTS,
  }));

  /** @param {number} seat @returns {Seat} */
  function get(seat) {
    const s = seats[seat];
    if (!s) throw new RangeError(`table: no seat ${seat}`);
    return s;
  }

  function aliveSeats() {
    return seats.filter((s) => s.alive);
  }

  function aliveCount() {
    return aliveSeats().length;
  }

  /** Alive seats still holding cards. */
  function holders() {
    return seats.filter((s) => s.alive && s.hand.length > 0);
  }

  /**
   * Next alive seat clockwise, strictly after `from`. -1 if none.
   * @param {number} from
   */
  function nextAliveSeat(from) {
    for (let i = 1; i <= seats.length; i++) {
      const s = seats[(from + i) % seats.length];
      if (s.alive) return s.seat;
    }
    return -1;
  }

  /**
   * Next alive seat with cards clockwise, strictly after `from`
   * (skips empty-handed & eliminated seats). -1 if none.
   * @param {number} from
   */
  function nextSeatWithCards(from) {
    for (let i = 1; i <= seats.length; i++) {
      const s = seats[(from + i) % seats.length];
      if (s.alive && s.hand.length > 0) return s.seat;
    }
    return -1;
  }

  /** Elimination → ghost: seat stays (chat/spectate), hand cleared, not in turn order. */
  function eliminate(seat) {
    const s = get(seat);
    s.alive = false;
    s.hand = [];
  }

  function setConnected(seat, connected) {
    get(seat).connected = !!connected;
  }

  /** @param {string} playerId @returns {number} seat index or -1 */
  function seatOf(playerId) {
    const s = seats.find((x) => x.playerId === playerId);
    return s ? s.seat : -1;
  }

  /**
   * Public seat view — §3.1 SeatPublic. Never exposes hand contents.
   * @param {number} seat
   * @returns {import('@monkeybar/shared/protocol.js').SeatPublic}
   */
  function publicSeat(seat) {
    const s = get(seat);
    const out = {
      seat: s.seat,
      playerId: s.playerId,
      name: s.name,
      monkeyId: s.monkeyId,
      isBot: s.isBot,
      connected: s.connected,
      alive: s.alive,
      handCount: s.hand.length,
      chips: s.chips,
      chambersLeft: s.chambersLeft,
    };
    // §10.3: equipped cosmetic ids ride SeatPublic only when the seat has any.
    if (s.cosmetics) out.cosmetics = s.cosmetics;
    return out;
  }

  function publicSeats() {
    return seats.map((s) => publicSeat(s.seat));
  }

  return {
    seats,
    size: seats.length,
    get,
    aliveSeats,
    aliveCount,
    holders,
    nextAliveSeat,
    nextSeatWithCards,
    eliminate,
    setConnected,
    seatOf,
    publicSeat,
    publicSeats,
  };
}
