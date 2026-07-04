// DEV-ONLY mock server drive (P5) — loaded exclusively via `?mock=1` in dev
// builds (see screens.js). Simulates the §3 server: lobby room state, bots,
// and a full simplified Monkey Lies match, by intercepting socket.send and
// injecting server frames. Lets the DOM UI be exercised end-to-end while the
// authoritative P2 server / P6 choreography are still in flight.
// NEVER active in production builds or without the query flag.

import { MSG } from '@shared/protocol.js';
import { buildDeck, cardMatchesTableFruit, BASIC_FRUITS } from '@shared/cards.js';

const BOT_DEFS = [
  { name: 'Slick Rita', monkeyId: 'ladyVine', personality: 'aggressive' },
  { name: 'Old Mango', monkeyId: 'grandmaGuava', personality: 'cautious' },
  { name: 'Zapp', monkeyId: 'bolt', personality: 'chaotic' },
  { name: 'The Count', monkeyId: 'professorPeel', personality: 'mathematical' },
  { name: 'Boo-Hoo Lou', monkeyId: 'tinyTantrum', personality: 'emotional' },
  { name: 'Grinner', monkeyId: 'shadySlim', personality: 'trollish' },
  { name: 'Moss', monkeyId: 'echo', personality: 'quiet' },
];

const BOT_LINES = ['never_lie', 'sweating', 'too_easy', 'smell_bluff', 'cannon_hungers'];
const BOT_EMOTES = ['laugh', 'taunt', 'sweat', 'shock', 'shrug'];

export function runMockDrive(store, socket) {
  console.warn('[mockDrive] ACTIVE — simulated server (dev ?mock=1 only)');
  const inject = (t, p) => socket._inject(t, p);
  const realSend = socket.send.bind(socket);
  const rand = Math.random;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  /** @type {any} */ let room = null;
  /** @type {any} */ let game = null;
  let botSeq = 0;
  const timers = new Set();

  function later(ms, fn) {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function myId() {
    return store.get('playerId') ?? 'you';
  }

  function myProfile() {
    return store.get('profile');
  }

  // ------------------------------------------------------------------
  // Lobby
  // ------------------------------------------------------------------
  function pushRoomState() {
    inject(MSG.ROOM_STATE, { room: JSON.parse(JSON.stringify(room)) });
  }

  function makeRoom(p) {
    room = {
      id: `mock-${Date.now().toString(36)}`,
      name: p.name ?? 'Mock table',
      code: p.isPrivate ? 'MOCK' : undefined,
      hostId: myId(),
      mode: p.mode,
      isPrivate: !!p.isPrivate,
      maxPlayers: p.maxPlayers ?? 6,
      botFill: !!p.botFill,
      settings: { turnSeconds: 25, mapId: 'peeling_parrot' },
      members: [
        {
          id: myId(),
          name: myProfile().name || 'You',
          monkeyId: myProfile().monkeyId || 'rico',
          ready: false,
          isBot: false,
          isHost: true,
        },
      ],
      spectatorCount: 0,
    };
    pushRoomState();
  }

  function addBot(personality) {
    if (room.members.length >= room.maxPlayers) return;
    const used = new Set(room.members.map((m) => m.name));
    const def = BOT_DEFS.find((d) => !used.has(d.name)) ?? BOT_DEFS[botSeq % BOT_DEFS.length];
    room.members.push({
      id: `bot-${++botSeq}`,
      name: def.name,
      monkeyId: def.monkeyId,
      ready: true,
      isBot: true,
      personality: personality ?? def.personality,
      isHost: false,
    });
    pushRoomState();
  }

  // ------------------------------------------------------------------
  // Game engine (simplified Monkey Lies, §4.1/§4.2)
  // ------------------------------------------------------------------
  function aliveSeats() {
    return game.seats.filter((s) => s.alive);
  }

  function seatOf(id) {
    return game.seats.find((s) => s.playerId === id);
  }

  function publicSeats() {
    return game.seats.map(({ hand, ...pub }) => ({ ...pub, handCount: hand.length }));
  }

  function snapshot() {
    const you = seatOf(myId());
    return {
      mode: room.mode,
      mapId: room.settings.mapId,
      phase: game.phase,
      roundNo: game.roundNo,
      tableFruit: game.tableFruit,
      seats: publicSeats(),
      turnSeat: game.turnSeat,
      deadline: game.deadline,
      lastPlay: game.lastPlay ? { seat: game.lastPlay.seat, count: game.lastPlay.cards.length } : null,
      yourSeat: you?.seat ?? null,
      yourHand: you ? you.hand : null,
      chipUsedByYou: you ? you.chips <= 0 : false,
    };
  }

  function startGame() {
    let members = [...room.members];
    if (room.botFill) {
      while (members.length < room.maxPlayers && members.length < 8) {
        addBot();
        members = [...room.members];
      }
    }
    game = {
      phase: 'dealing',
      roundNo: 0,
      tableFruit: null,
      turnSeat: -1,
      deadline: 0,
      lastPlay: null,
      eliminatedOrder: [],
      seats: members.map((m, i) => ({
        seat: i,
        playerId: m.id,
        name: m.name,
        monkeyId: m.monkeyId,
        isBot: m.isBot,
        connected: true,
        alive: true,
        chips: 1,
        chambersLeft: 6,
        hand: [],
      })),
    };
    inject(MSG.GAME_START, { snapshot: snapshot() });
    later(700, newRound);
  }

  function newRound() {
    game.roundNo += 1;
    game.lastPlay = null;
    game.phase = 'playing';
    const alive = aliveSeats();
    const deck = [...buildDeck(alive.length)].sort(() => rand() - 0.5);
    for (const seat of game.seats) seat.hand = [];
    for (const seat of alive) seat.hand = deck.splice(0, 5);
    game.tableFruit = pick(BASIC_FRUITS);
    const firstSeat = alive[(game.roundNo - 1) % alive.length].seat;
    inject(MSG.ROUND_START, {
      roundNo: game.roundNo,
      tableFruit: game.tableFruit,
      firstSeat,
      seats: publicSeats(),
    });
    const you = seatOf(myId());
    if (you?.alive) inject(MSG.HAND, { cards: you.hand });
    later(400, () => setTurn(firstSeat));
    botChatter();
  }

  let turnTimer = null;

  function setTurn(seatNo) {
    game.turnSeat = seatNo;
    game.phase = 'playing';
    game.deadline = Date.now() + room.settings.turnSeconds * 1000;
    inject(MSG.TURN, { seat: seatNo, deadline: game.deadline, canCall: !!game.lastPlay });
    const seat = game.seats.find((s) => s.seat === seatNo);
    if (turnTimer) clearTimeout(turnTimer);
    if (seat.isBot) {
      turnTimer = later(1200 + rand() * 2200, () => botAct(seat));
    } else {
      // §3.4 timeout auto-play: server plays 1 matching card if possible
      turnTimer = later(room.settings.turnSeconds * 1000, () => {
        if (game.phase === 'playing' && game.turnSeat === seatNo) {
          const card =
            seat.hand.find((c) => cardMatchesTableFruit(c, game.tableFruit)) ?? seat.hand[0];
          if (card) doPlay(seat, [card.id]);
        }
      });
    }
  }

  function nextSeatWithCards(fromSeat) {
    const alive = aliveSeats();
    const order = alive.map((s) => s.seat).sort((a, b) => a - b);
    let idx = order.indexOf(fromSeat);
    for (let i = 1; i <= order.length; i++) {
      const seat = game.seats.find((s) => s.seat === order[(idx + i) % order.length]);
      if (seat.hand.length > 0) return seat;
    }
    return null;
  }

  function doPlay(seat, cardIds) {
    const cards = seat.hand.filter((c) => cardIds.includes(c.id));
    seat.hand = seat.hand.filter((c) => !cardIds.includes(c.id));
    game.lastPlay = { seat: seat.seat, cards };
    inject(MSG.PLAYED, { seat: seat.seat, count: cards.length, handCount: seat.hand.length });
    const next = nextSeatWithCards(seat.seat);
    const holders = aliveSeats().filter((s) => s.hand.length > 0);
    if (!next || (holders.length === 1 && holders[0].seat !== seat.seat)) {
      // everyone else shed their hand — Last Monkey Holding (§4.4)
      const holder = holders[0] ?? seat;
      inject(MSG.LAST_HOLDER, { seat: holder.seat });
      later(1600, () => startPenalty(holder));
      return;
    }
    if (holders.length === 0) {
      // last play emptied the final hand: round fizzles, redeal
      endRound();
      return;
    }
    later(500, () => setTurn(next.seat));
  }

  function botAct(seat) {
    if (game.phase !== 'playing' || game.turnSeat !== seat.seat) return;
    const lp = game.lastPlay;
    if (lp) {
      const vsYou = game.seats.find((s) => s.seat === lp.seat)?.playerId === myId();
      const callChance = vsYou ? 0.45 : 0.25;
      if (rand() < callChance) {
        doCall(seat.seat);
        return;
      }
    }
    // play: prefer the truth, lie when short on table fruit
    const matching = seat.hand.filter((c) => cardMatchesTableFruit(c, game.tableFruit));
    const lieMode = matching.length === 0 || rand() < 0.35;
    const pool = lieMode ? seat.hand : matching;
    const count = Math.min(pool.length, 1 + (rand() < 0.4 ? 1 : 0));
    doPlay(seat, pool.slice(0, Math.max(1, count)).map((c) => c.id));
  }

  function doCall(callerSeat) {
    const lp = game.lastPlay;
    if (!lp) return;
    game.phase = 'revealing';
    if (turnTimer) clearTimeout(turnTimer);
    inject(MSG.CALLED, { callerSeat, targetSeat: lp.seat });
    later(1400, () => {
      const lie = !lp.cards.every((c) => cardMatchesTableFruit(c, game.tableFruit));
      const loserSeat = lie ? lp.seat : callerSeat;
      inject(MSG.REVEAL, { targetSeat: lp.seat, cards: lp.cards, lie, loserSeat });
      later(2600, () => startPenalty(game.seats.find((s) => s.seat === loserSeat)));
    });
  }

  let pendingShot = null;

  function startPenalty(seat) {
    game.phase = 'penalty';
    const deadline = Date.now() + 5000;
    pendingShot = { seat, chambers: seat.chambersLeft, fired: false };
    inject(MSG.PENALTY, {
      seat: seat.seat,
      chambers: seat.chambersLeft,
      coconuts: 1,
      chipUsable: seat.chips > 0,
      deadline,
    });
    if (seat.isBot) {
      if (seat.chips > 0 && seat.chambersLeft <= 3 && rand() < 0.8) {
        later(1500, () => useChip(seat));
        later(3000, () => fireCannon(seat));
      } else {
        later(2600, () => fireCannon(seat));
      }
    } else {
      later(5100, () => fireCannon(seat)); // fires at window end unless chip re-schedules
    }
  }

  function useChip(seat) {
    if (!pendingShot || pendingShot.seat !== seat || seat.chips <= 0 || pendingShot.fired) return;
    seat.chips -= 1;
    pendingShot.chambers += 2;
    inject(MSG.CHIP_USED, { seat: seat.seat, chambersNow: pendingShot.chambers });
  }

  function fireCannon(seat) {
    if (!pendingShot || pendingShot.seat !== seat || pendingShot.fired) return;
    pendingShot.fired = true;
    const hit = rand() < 1 / Math.max(1, pendingShot.chambers);
    inject(MSG.CANNON, { seat: seat.seat, hit });
    later(1200, () => {
      if (hit) {
        seat.alive = false;
        game.eliminatedOrder.push(seat.seat);
        inject(MSG.ELIMINATED, { seat: seat.seat });
      } else {
        seat.chambersLeft = Math.max(1, seat.chambersLeft - 1);
      }
      pendingShot = null;
      endRound();
    });
  }

  function endRound() {
    const alive = aliveSeats();
    if (alive.length <= 1) {
      const winner = alive[0] ?? game.seats[0];
      const order = [winner.seat, ...[...game.eliminatedOrder].reverse()];
      inject(MSG.MATCH_END, {
        winnerSeat: winner.seat,
        standings: order.map((seatNo, i) => ({
          seat: seatNo,
          name: game.seats.find((s) => s.seat === seatNo)?.name ?? '?',
          place: i + 1,
        })),
      });
      game.phase = 'matchEnd';
      // room returns to lobby state
      for (const m of room.members) if (!m.isBot) m.ready = false;
      later(2500, pushRoomState);
      return;
    }
    game.phase = 'roundEnd';
    inject(MSG.ROUND_END, { nextIn: 5000 });
    later(5000, newRound);
  }

  function botChatter() {
    const bots = aliveSeats().filter((s) => s.isBot);
    if (!bots.length) return;
    later(2000 + rand() * 4000, () => {
      if (!game || game.phase === 'matchEnd') return;
      const bot = pick(bots);
      if (rand() < 0.5) inject(MSG.QUICK_PHRASE, { seat: bot.seat, phraseId: pick(BOT_LINES) });
      else inject(MSG.EMOTE, { seat: bot.seat, emoteId: pick(BOT_EMOTES) });
    });
  }

  // ------------------------------------------------------------------
  // send() interception
  // ------------------------------------------------------------------
  socket.send = (t, p = {}) => {
    switch (t) {
      case MSG.LIST_ROOMS:
        inject(MSG.ROOM_LIST, {
          rooms: [
            { id: 'fake-1', name: "Baron's back table", mode: 'monkeyLies', isPrivate: false, playerCount: 3, maxPlayers: 6, inGame: false },
            { id: 'fake-2', name: 'High stakes, low morals', mode: 'monkeyLies', isPrivate: false, playerCount: 5, maxPlayers: 5, inGame: true },
          ],
        });
        return true;
      case MSG.CREATE_ROOM:
        makeRoom(p);
        return true;
      case MSG.JOIN_ROOM:
        inject(MSG.ERROR, { code: 'NOT_FOUND', msg: 'mock rooms are not joinable' });
        return true;
      case MSG.QUICK_MATCH:
        later(1500, () => {
          makeRoom({ name: 'Quick match table', isPrivate: false, maxPlayers: 6, mode: p.mode, botFill: true });
          inject(MSG.MATCH_FOUND, { roomId: room.id });
          addBot();
          addBot();
          addBot();
        });
        return true;
      case MSG.CANCEL_QUICK:
        return true;
      case MSG.LEAVE_ROOM:
        room = null;
        game = null;
        for (const id of timers) clearTimeout(id);
        timers.clear();
        inject(MSG.LEFT_ROOM, { reason: 'left' });
        return true;
      case MSG.READY: {
        if (!room) return true;
        const me = room.members.find((m) => m.id === myId());
        if (me) me.ready = !!p.ready;
        pushRoomState();
        return true;
      }
      case MSG.SELECT_MONKEY: {
        if (room) {
          const me = room.members.find((m) => m.id === myId());
          if (me) me.monkeyId = p.monkeyId;
          pushRoomState();
        }
        return realSend(t, p); // still exercise the real wire format
      }
      case MSG.ADD_BOT:
        if (room) addBot(p.personality);
        return true;
      case MSG.REMOVE_BOT:
        if (room) {
          room.members = room.members.filter((m) => m.id !== p.botId);
          pushRoomState();
        }
        return true;
      case MSG.UPDATE_SETTINGS:
        if (room) {
          const { turnSeconds, mapId, mode } = p.patch ?? {};
          if (turnSeconds) room.settings.turnSeconds = turnSeconds;
          if (mapId) room.settings.mapId = mapId;
          if (mode) room.mode = mode;
          pushRoomState();
        }
        return true;
      case MSG.START_GAME:
        if (room) startGame();
        return true;
      case MSG.PLAY: {
        const you = game && seatOf(myId());
        if (!game || !you || game.turnSeat !== you.seat || game.phase !== 'playing') {
          inject(MSG.ACTION_ACK, { aid: p.aid, ok: false, code: 'NOT_YOUR_TURN' });
          return true;
        }
        const owned = p.cardIds.every((id) => you.hand.some((c) => c.id === id));
        if (!owned || p.cardIds.length < 1 || p.cardIds.length > 3) {
          inject(MSG.ACTION_ACK, { aid: p.aid, ok: false, code: 'INVALID_CARDS' });
          return true;
        }
        if (turnTimer) clearTimeout(turnTimer);
        inject(MSG.ACTION_ACK, { aid: p.aid, ok: true });
        doPlay(you, p.cardIds);
        return true;
      }
      case MSG.CALL_LIAR: {
        const you = game && seatOf(myId());
        if (!game || !you || game.turnSeat !== you.seat || !game.lastPlay) {
          inject(MSG.ACTION_ACK, { aid: p.aid, ok: false, code: 'BAD_STATE' });
          return true;
        }
        inject(MSG.ACTION_ACK, { aid: p.aid, ok: true });
        doCall(you.seat);
        return true;
      }
      case MSG.USE_CHIP: {
        const you = game && seatOf(myId());
        if (!you || !pendingShot || pendingShot.seat !== you || you.chips <= 0) {
          inject(MSG.ACTION_ACK, { aid: p.aid, ok: false, code: 'BAD_STATE' });
          return true;
        }
        inject(MSG.ACTION_ACK, { aid: p.aid, ok: true });
        useChip(you);
        later(1500, () => fireCannon(you));
        return true;
      }
      case MSG.CHAT: {
        const you = game && seatOf(myId());
        inject(MSG.CHAT, { seat: you?.seat ?? null, name: myProfile().name || 'You', text: p.text });
        return true;
      }
      case MSG.QUICK_PHRASE: {
        const you = game && seatOf(myId());
        inject(MSG.QUICK_PHRASE, { seat: you?.seat ?? 0, phraseId: p.phraseId });
        return true;
      }
      case MSG.EMOTE: {
        const you = game && seatOf(myId());
        inject(MSG.EMOTE, { seat: you?.seat ?? 0, emoteId: p.emoteId });
        return true;
      }
      default:
        return realSend(t, p); // hello / setProfile / ping etc. hit the real server
    }
  };
}
