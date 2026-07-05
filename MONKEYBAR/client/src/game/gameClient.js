// Game client choreographer — PLAN.md §2 (client/src/game/gameClient.js), P6.
//
// Subscribes to the §3.3 server event stream (via P5's socket) and drives the
// P4 3D engine and the P5 HUD as ONE synchronized experience (§7).
//
// CRITICAL DESIGN — THE EVENT QUEUE (PLAN.md §9, highest project risk):
// server events (especially from fast bots) can arrive far quicker than their
// choreography plays out. Every game event is pushed onto a FIFO queue and
// processed strictly serially — each step is awaited (including the full
// Coconut Cannon sequence) so animations NEVER overlap or stomp each other.
// Meanwhile the authoritative snapshot/HUD state stays responsive: P5's
// screens.js reducers run immediately on the raw socket events (they are
// registered first in main.js), so hand, seats, timers, and the call button
// always reflect true server state. Only the *dramatic* presentation
// (3D choreography + reveal/cannon/round-end banners via the fx* store keys)
// is paced by this queue.
//
// Resyncs (`gameStart`, reconnect/spectate `state`) clear the queue and
// rebuild the whole scene from the snapshot. If the tab is hidden (rAF paused,
// nothing renders) or the backlog grows deep, the queue switches to fast mode
// and applies end-states without long animations so it can never fall
// minutes behind.

import { MSG } from '@shared/protocol.js';
import { START_CHAMBERS } from '@shared/constants.js';
import { DEFAULT_MAP_ID } from '@shared/maps.js';
import { TABLE_TOP_Y } from '../three/barScene.js';
import { getModeChoreographer } from './modes/index.js';

/** Fast-forward choreography when more events than this are waiting. */
const FAST_MODE_BACKLOG = 10;
/** Camera overview (spectator / winner orbit) parameters. Radius stays inside
 * the prop band (map props spawn from r≈2.2 out to the walls, seats at 1.78)
 * so vats/palms/signs never cross between the camera and the table. */
const ORBIT_RADIUS = 2.55;
const ORBIT_HEIGHT = 2.25;
const ORBIT_SPEED = 0.12; // rad/s

/**
 * @param {ReturnType<import('../three/engine.js').createEngine>} engine
 * @param {ReturnType<import('../state/store.js').createStore>} store
 * @param {ReturnType<import('../net/socket.js').createSocket>} socket
 */
export function createGameClient(engine, store, socket) {
  // ------------------------------------------------------------------------
  // Event queue
  // ------------------------------------------------------------------------
  /** @type {{t: string, p: Object, at: number, epoch: number}[]} */
  const queue = [];
  let processing = false;
  /** Bumped on every resync; stale queued items are dropped. */
  let epoch = 0;
  /** @type {(() => void)[]} unsubscribers */
  const subs = [];

  function enqueue(t, p) {
    queue.push({ t, p, at: Date.now(), epoch });
    pump();
  }

  /** Drop everything queued (a resync snapshot supersedes it). */
  function clearQueue() {
    queue.length = 0;
    epoch += 1;
  }

  async function pump() {
    if (processing) return;
    processing = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        if (item.epoch !== epoch && item.t !== '__resync') continue;
        try {
          await processEvent(item);
        } catch (err) {
          console.error(`[gameClient] choreography for "${item.t}" failed:`, err);
        }
      }
    } finally {
      processing = false;
    }
    // events may have arrived while the last await settled
    if (queue.length) pump();
  }

  /** Catch-up latch: once the backlog is deep, stay fast until fully drained. */
  let catchingUp = false;

  /** True → skip long animations (hidden tab / deep backlog). */
  function fastMode() {
    if (document.hidden) return true;
    if (catchingUp) {
      if (queue.length <= 2) catchingUp = false;
    } else if (queue.length > FAST_MODE_BACKLOG) {
      catchingUp = true;
    }
    return catchingUp;
  }

  const anim = engine.anim;
  const wait = (s) => (fastMode() ? Promise.resolve() : anim.wait(s));

  // ------------------------------------------------------------------------
  // Per-mode choreography (R3): non-ML modes may register a choreographer
  // { resync(snapshot, tools), handle(kind, p, tools) } in game/modes/index.js.
  // Monkey Lies is never registered — its paths below stay untouched.
  // ------------------------------------------------------------------------
  /** @type {import('./modes/index.js').ChoreoTools} */
  const tools = { engine, store, wait, fastMode, sysFlavor };

  /** Delegate an event to the active mode's choreographer (no-op for ML). */
  async function modeHandle(kind, p) {
    const choreo = getModeChoreographer(store.get('snapshot')?.mode);
    if (choreo?.handle) await choreo.handle(kind, p, tools);
  }

  // ------------------------------------------------------------------------
  // Scene bookkeeping
  // ------------------------------------------------------------------------
  const SEAT_MAX = 8;
  let localSeat = null; // null → spectator
  let inMatch = false;
  /** Seats already rendered as ghosts (monkeys are recreated on resync). */
  const ghosted = new Set();
  /** Cannon victim currently mid-sequence — their emote clips are suppressed. */
  let cannonBusySeat = null;

  const snap = () => store.get('snapshot');
  const seatInfo = (seatNo) => snap()?.seats?.find((s) => s.seat === seatNo) ?? null;
  const aliveSeats = () => (snap()?.seats ?? []).filter((s) => s.alive);

  // ------------------------------------------------------------------------
  // Monkey passives (§6) — all cosmetic/UX flavor, zero balance impact.
  // ------------------------------------------------------------------------
  /** §6 passive id of the monkey seated at seatNo (or null). */
  const passiveOf = (seatNo) => engine.getMonkey(seatNo)?.def?.passive?.id ?? null;
  /** Where the played pile sits on the table (for pile-anchored VFX). */
  const pilePos = () => ({ x: 0.3, y: TABLE_TOP_Y + 0.06, z: 0 });

  function sysFlavor(text) {
    store.push('chatLog', { kind: 'sys', text, ts: Date.now() });
  }

  /** Rico "Hot Head": idle twitchiness grows as his chambers shrink. */
  function refreshHotHeads(seats) {
    for (const s of seats ?? []) {
      if (!s.alive || passiveOf(s.seat) !== 'hotHead') continue;
      const monkey = engine.getMonkey(s.seat);
      if (monkey) {
        monkey.state.twitchy =
          1 + Math.max(0, START_CHAMBERS - (s.chambersLeft ?? START_CHAMBERS)) * 0.35;
      }
    }
  }

  /** Madame Mystery: publicly "predicts" a winner at the first round start. */
  function maybeProphecy(p) {
    if ((p.roundNo ?? 0) !== 1) return;
    const seats = p.seats ?? snap()?.seats ?? [];
    const mystic = seats.find((s) => passiveOf(s.seat) === 'prophecy');
    if (!mystic) return;
    // Deterministic pick (same on every client): hash of the seat playerIds.
    const key = seats.map((s) => s.playerId ?? String(s.seat)).join('|');
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    const others = seats.filter((s) => s.seat !== mystic.seat);
    const chosen = others.length ? others[hash % others.length] : mystic;
    sysFlavor(
      `🔮 ${mystic.name} peers into the crystal ball: “The last monkey standing will be… ${chosen.name}.”`
    );
    if (mystic.seat !== localSeat) {
      const monkey = engine.getMonkey(mystic.seat);
      if (monkey) {
        monkey.flashExpression('grin', 1.6);
        engine.particles.goldGlint(monkey.headWorldPos());
      }
    }
  }

  /** Sister Cocoa: once per match, bestows a cosmetic blessing on another monkey. */
  let blessingDone = false;
  function maybeBlessing(p) {
    if (blessingDone || (p.roundNo ?? 0) < 2) return;
    const seats = (p.seats ?? snap()?.seats ?? []).filter((s) => s.alive);
    const sister = seats.find((s) => passiveOf(s.seat) === 'blessing');
    if (!sister) return;
    blessingDone = true;
    const others = seats.filter((s) => s.seat !== sister.seat);
    if (!others.length) return;
    const key = seats.map((s) => s.playerId ?? String(s.seat)).join('/');
    let hash = 7;
    for (let i = 0; i < key.length; i++) hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
    const blessed = others[hash % others.length];
    sysFlavor(`😇 ${sister.name} bestows her blessing upon ${blessed.name}. May the fruit be kind.`);
    const monkey = engine.getMonkey(blessed.seat);
    if (monkey) {
      monkey.flashExpression('grin', 1.4);
      engine.particles.goldGlint(monkey.headWorldPos());
    }
  }

  /** Bolt "Glitch": his emotes leave a flickering neon trail. */
  function maybeGlitchTrail(seatNo) {
    if (passiveOf(seatNo) !== 'glitch') return;
    const monkey = engine.getMonkey(seatNo);
    if (monkey) engine.particles.neonTrail(monkey.headWorldPos());
  }

  /** Echo "Mimic": mirrors the last emote used at the table (rate-limited). */
  let lastMimicAt = 0;
  function maybeMimic(p) {
    const now = Date.now();
    if (now - lastMimicAt < 6000) return;
    const echo = aliveSeats().find((s) => s.seat !== p.seat && passiveOf(s.seat) === 'mimic');
    if (!echo || echo.seat === localSeat || echo.seat === cannonBusySeat) return;
    lastMimicAt = now;
    setTimeout(() => {
      if (!inMatch || echo.seat === cannonBusySeat) return;
      engine.emote(echo.seat, p.emoteId);
    }, 700);
  }

  /** DJ Drift "Drop the Bass": sting when his play rides on unchallenged. */
  let uncalledPlaySeat = null;
  /** Caller of the challenge in flight (for the reveal-winner flourish). */
  let lastCallerSeat = null;

  /** Fade a monkey into a table ghost (§4.1: eliminated players stay seated). */
  function ghostSeat(seatNo) {
    if (ghosted.has(seatNo)) return;
    const monkey = engine.getMonkey(seatNo);
    if (!monkey) return;
    ghosted.add(seatNo);
    monkey.setExpression('ko');
    monkey.root.traverse((obj) => {
      if (!obj.material) return;
      // clone so shared materials on living monkeys stay opaque
      obj.material = obj.material.clone();
      obj.material.transparent = true;
      obj.material.opacity = 0.26;
      obj.material.depthWrite = false;
    });
  }

  // ------------------------------------------------------------------------
  // Overview camera (spectators + winner orbit). Runs after rig.update in the
  // frame loop, so writing the camera here overrides the seated rig.
  // ------------------------------------------------------------------------
  let overviewOn = false;
  let orbitAngle = Math.PI * 0.25;
  /** @type {number|null} seat the orbit keeps in frame (winner celebration) */
  let orbitFocusSeat = null;

  subs.push(
    engine.onFrame((dt) => {
      if (!overviewOn) return;
      orbitAngle += dt * ORBIT_SPEED;
      const cam = engine.camera;
      cam.position.set(
        Math.sin(orbitAngle) * ORBIT_RADIUS,
        ORBIT_HEIGHT + Math.sin(orbitAngle * 2.3) * 0.06,
        Math.cos(orbitAngle) * ORBIT_RADIUS
      );
      const focus = orbitFocusSeat != null ? engine.getMonkey(orbitFocusSeat) : null;
      if (focus) {
        const head = focus.headWorldPos();
        cam.lookAt(head.x * 0.6, 1.05 + head.y * 0.12, head.z * 0.6);
      } else {
        cam.lookAt(0, 1.02, 0);
      }
    })
  );

  function setOverview(on, focusSeat = null) {
    overviewOn = on;
    orbitFocusSeat = focusSeat;
    if (on) engine.setSpectatorView();
  }

  // P7: title-screen ATTRACT MODE — a slow camera orbit of the bar plays
  // behind every menu screen (and the lobby's map preview). It never runs
  // during a match, and it never clobbers an existing overview (so the
  // winner-focused orbit keeps its focus through the results screen).
  function updateAttract() {
    if (inMatch || localSeat != null) return;
    if (store.get('screen') === 'game') return;
    if (!overviewOn) setOverview(true);
  }
  subs.push(store.on('screen', () => updateAttract()));

  // ------------------------------------------------------------------------
  // Audio: unlock (needs a user gesture) + prefs wiring
  // ------------------------------------------------------------------------
  let audioArmed = false;
  function armAudio() {
    if (audioArmed) return;
    const unlock = () => {
      audioArmed = true;
      engine.audio.unlock({ withMusic: true });
      engine.audio.setMuted(!!store.get('prefs')?.muted);
      engine.audio.setVolume?.(store.get('prefs')?.volume ?? 0.8);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    // Chrome: only touch the AudioContext after a real user gesture.
    if (navigator.userActivation?.hasBeenActive) unlock();
    else {
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
    }
  }

  subs.push(
    store.on('prefs', (prefs, prev) => {
      engine.audio.setMuted(!!prefs?.muted);
      engine.audio.setVolume?.(prefs?.volume ?? 0.8);
      if (prefs?.quality !== prev?.quality) engine.setQuality(prefs?.quality ?? 'high');
    })
  );
  engine.setQuality(store.get('prefs')?.quality ?? 'high');
  engine.audio.setVolume?.(store.get('prefs')?.volume ?? 0.8);

  // ------------------------------------------------------------------------
  // Resync: rebuild the whole scene from an authoritative snapshot
  // (gameStart, reconnect `state`, spectate `state`).
  // ------------------------------------------------------------------------
  async function resync(snapshot) {
    if (!snapshot) return;
    inMatch = snapshot.phase !== 'matchEnd';
    ghosted.clear();
    cannonBusySeat = null;
    uncalledPlaySeat = null;
    lastCallerSeat = null;
    // once-per-match passives: don't re-fire when reconnecting mid-match
    blessingDone = (snapshot.roundNo ?? 0) >= 2;

    engine.loadMap(snapshot.mapId);
    engine.tableView.clearHand();
    await engine.clearPile();

    for (let s = 0; s < SEAT_MAX; s++) engine.clearSeat(s);
    for (const seat of snapshot.seats ?? []) {
      // §10.3: equipped cosmetics ride on SeatPublic (R9 renders them)
      engine.seatMonkey(seat.seat, seat.monkeyId, seat.name, seat.cosmetics);
      if (!seat.alive) ghostSeat(seat.seat);
    }

    localSeat = snapshot.yourSeat ?? null;
    if (localSeat != null) {
      setOverview(false);
      engine.setLocalSeat(localSeat);
      const me = seatInfo(localSeat);
      if (snapshot.yourHand?.length && me?.alive !== false) {
        engine.showHand(snapshot.yourHand);
      }
    } else {
      // SPECTATOR (§3.4): standing overview camera, no hand.
      setOverview(true);
    }

    // pending face-down play back on the table
    if (snapshot.lastPlay?.count) {
      await engine.tableView.addToPile(snapshot.lastPlay.seat, snapshot.lastPlay.count);
    }
    engine.setTurn(snapshot.phase === 'playing' ? snapshot.turnSeat : null);
    engine.audio.music.setIntensity(snapshot.phase === 'penalty' ? 0.8 : 0.2);
    refreshHotHeads(snapshot.seats);
    armAudio();

    // per-mode scene state on top of the shared base resync (no-op for ML)
    const choreo = getModeChoreographer(snapshot.mode);
    if (choreo?.resync) await choreo.resync(snapshot, tools);
  }

  // ------------------------------------------------------------------------
  // Per-event choreography (§7) — each runs to completion before the next
  // ------------------------------------------------------------------------
  async function processEvent({ t, p, at }) {
    switch (t) {
      case '__resync':
        return resync(p.snapshot);

      case MSG.HAND: {
        // deal: fan the new hand up from the table
        if (localSeat == null) return;
        const me = seatInfo(localSeat);
        if (me && !me.alive) return;
        engine.showHand(p.cards ?? []);
        return wait(0.45);
      }

      case MSG.ROUND_START: {
        // sweep the old cards; the HUD table-fruit banner (roundBanner) is
        // set by screens.js — intermission keeps this queue caught up.
        await engine.clearPile();
        // music intensity climbs with the round number — the bar heats up
        engine.audio.music.setIntensity(Math.min(0.45, 0.2 + (p.roundNo ?? 1) * 0.03));
        engine.rig.lookAtTable();
        for (const s of aliveSeats()) engine.getMonkey(s.seat)?.setExpression('neutral');
        uncalledPlaySeat = null;
        lastCallerSeat = null;
        refreshHotHeads(p.seats ?? snap()?.seats);
        if (!fastMode()) {
          maybeProphecy(p);
          maybeBlessing(p);
        }
        return wait(0.2);
      }

      case MSG.TURN: {
        engine.setTurn(p.seat); // ring + camera glance + tick
        await modeHandle(MSG.TURN, p); // extra per-mode turn beat (no-op for ML)
        return wait(0.15);
      }

      case MSG.PLAYED:
        return choreographPlay(p);

      case MSG.CALLED:
        return choreographCall(p);

      case MSG.REVEAL:
        return choreographReveal(p);

      case MSG.LAST_HOLDER: {
        engine.lookAt(p.seat);
        engine.playClip(p.seat, 'sob'); // resigned — not awaited, plays into penalty
        return wait(0.8);
      }

      case MSG.PENALTY: {
        // The DOM overlay (chip decision, fuse) is immediate via screens.js —
        // the victim's 5 s server window must not wait for choreography.
        engine.lookAt(p.seat);
        engine.audio.music.setIntensity(0.8);
        engine.getMonkey(p.seat)?.setExpression('sweat');
        // Professor Peel "Calculated": announces the exact odds to the bar.
        const peel = aliveSeats().find((s) => passiveOf(s.seat) === 'calculated');
        if (peel && !fastMode()) {
          const pct = (((p.coconuts ?? 1) / Math.max(1, p.chambers ?? START_CHAMBERS)) * 100).toFixed(1);
          const whose = peel.seat === p.seat ? 'my' : 'the';
          sysFlavor(`🧮 ${peel.name} adjusts his cracked glasses: “${pct}% — ${whose} odds, precisely.”`);
        }
        await modeHandle(MSG.PENALTY, p); // extra per-mode penalty beat (no-op for ML)
        return wait(0.3);
      }

      case MSG.CHIP_USED: {
        // Lucky Banana Chip: +2 chambers bolted on (§4.2)
        const monkey = engine.getMonkey(p.seat);
        if (monkey) engine.particles.goldGlint(monkey.headWorldPos());
        engine.audio.sfx.chipClack();
        engine.playClip(p.seat, 'smug');
        return wait(0.7);
      }

      case MSG.CANNON:
        await choreographCannon(p);
        return modeHandle(MSG.CANNON, p); // extra per-mode cannon beat (no-op for ML)

      case MSG.ELIMINATED: {
        ghostSeat(p.seat);
        if (p.seat === localSeat) engine.tableView.clearHand();
        return wait(0.3);
      }

      case MSG.ROUND_END: {
        // fx-timed HUD banner with the *remaining* intermission
        const elapsed = Date.now() - at;
        store.set('fxRoundEnd', { ...p, nextIn: Math.max(800, (p.nextIn ?? 5000) - elapsed), ts: Date.now() });
        engine.setTurn(null);
        engine.audio.music.setIntensity(0.15);
        await engine.clearPile();
        return;
      }

      case MSG.MATCH_END:
        return choreographMatchEnd(p);

      // §10.2: mode-scoped drama — entirely the mode choreographer's show
      // (ML emits none). screens.js already reduced it into store.modeData.
      case MSG.MODE_EVENT:
        return modeHandle(p.kind, p);

      default:
        return;
    }
  }

  async function choreographPlay(p) {
    // DJ Drift "Drop the Bass": the previous play just rode on unchallenged.
    if (uncalledPlaySeat != null && !fastMode() && passiveOf(uncalledPlaySeat) === 'dropTheBass') {
      engine.audio.sfx.bassSting();
      engine.getMonkey(uncalledPlaySeat)?.flashExpression('grin', 1.0);
    }
    uncalledPlaySeat = p.seat;

    // face-down slide from the seat + reach/slam clip
    let meshes = null;
    if (p.seat === localSeat) {
      // consume the exact played cards from the 3D fan: the HUD ack already
      // shrank snapshot.yourHand, so fan − hand = what was just played.
      const fan = engine.tableView.getHandCards(); // live array
      const remaining = new Set((snap()?.yourHand ?? []).map((c) => c.id));
      let played = fan.filter((m) => !remaining.has(m.userData.cardId));
      if (played.length !== p.count) played = fan.slice(-p.count);
      for (const m of played) {
        const i = fan.indexOf(m);
        if (i !== -1) {
          fan.splice(i, 1);
          fan.push(m); // takeHandCards() consumes from the end
        }
      }
      meshes = played;
    }

    // suspicious glances around the table (§7)
    const others = aliveSeats().filter((s) => s.seat !== p.seat && s.seat !== localSeat);
    for (const s of others) {
      if (Math.random() < 0.5) engine.getMonkey(s.seat)?.flashExpression('sweat', 0.9);
    }
    if (p.seat !== localSeat) engine.lookAt(p.seat);

    // Lady Vine "Grace": her card plays land in brief, elegant slow motion.
    if (!fastMode() && passiveOf(p.seat) === 'grace') anim.slowMo(0.45, 0.55);

    // Fast mode (deep backlog / hidden tab): let the flight play out without
    // blocking the queue — this is what lets a lagging queue actually catch up.
    const flight = engine.playCards(p.seat, p.count, meshes);
    await (fastMode() ? Promise.race([flight, anim.wait(0.1)]) : flight);

    // Shady Slim "Smokescreen": a wisp of smoke curls off his face-down cards.
    if (!fastMode() && passiveOf(p.seat) === 'smokescreen') {
      engine.particles.smokePuff(pilePos(), { count: 10, size: 0.07, speed: 0.28 });
    }

    // keep the local fan authoritative (ack order can race the animation)
    if (p.seat === localSeat) {
      const hand = snap()?.yourHand ?? [];
      const fanIds = engine.tableView.getHandCards().map((m) => m.userData.cardId);
      if (fanIds.length !== hand.length || hand.some((c, i) => c.id !== fanIds[i])) {
        engine.showHand(hand);
      }
    }
  }

  async function choreographCall(p) {
    uncalledPlaySeat = null; // the play got challenged — no bass drop
    lastCallerSeat = p.callerSeat;
    // point-and-shout + micro hit-stop + music tightens (§7)
    engine.audio.music.setIntensity(0.6);
    engine.lookAt(p.callerSeat);
    engine.getMonkey(p.targetSeat)?.flashExpression('shock', 1.4);
    engine.shake(0.3);
    engine.postfx.pulseBloom?.(1.5);
    await wait(0.12); // hit-stop beat before the shout lands
    if (fastMode()) return;
    await engine.playClip(p.callerSeat, 'point');
  }

  async function choreographReveal(p) {
    // fx-timed HUD banner fires WITH the flip, not when the packet landed
    store.set('fxReveal', { ...p, ts: Date.now() });
    if (fastMode()) return;
    // Baron Bananas "Rich Reveal": gold glints whenever HIS cards flip.
    if (passiveOf(p.targetSeat) === 'richReveal') {
      engine.particles.goldGlint(pilePos());
      engine.particles.goldGlint(pilePos());
    }
    // dramatic staggered flip (inside revealCards) + per-seat reactions
    await engine.revealCards(p.targetSeat, p.cards ?? [], p.lie);
    if (p.loserSeat !== p.targetSeat) engine.playClip(p.loserSeat, 'sob');
    // Tiny Tantrum "Table Rattle": losing a challenge shakes the whole table.
    if (passiveOf(p.loserSeat) === 'tableRattle') {
      engine.shake(0.55);
      engine.audio.sfx.chipClack();
      sysFlavor('🍼 Tiny Tantrum pounds the table! Everything rattles.');
    }
    // Challenge winner flourishes: King Kola's royal horn / Splinter's flag show.
    const winnerSeat = p.loserSeat === p.targetSeat ? lastCallerSeat : p.targetSeat;
    if (winnerSeat != null) {
      const wp = passiveOf(winnerSeat);
      if (wp === 'fanfare') {
        engine.audio.sfx.royalHorn();
        engine.getMonkey(winnerSeat)?.flashExpression('grin', 1.6);
      } else if (wp === 'showman') {
        const m = engine.getMonkey(winnerSeat);
        if (m) engine.particles.confetti(m.headWorldPos(), { count: 30 });
        engine.playClip(winnerSeat, 'smug');
      }
    }
    for (const s of aliveSeats()) {
      if (s.seat === p.loserSeat || s.seat === p.targetSeat || s.seat === localSeat) continue;
      if (Math.random() < 0.45) engine.getMonkey(s.seat)?.flashExpression(p.lie ? 'grin' : 'shock', 1.2);
    }
    await wait(0.4);
  }

  async function choreographCannon(p) {
    // fx-timed HUD banner appears at the THOOM/click, not at packet arrival —
    // engine.cannonSequence invokes onResolve right as the shot resolves.
    const announce = () => store.set('fxCannon', { ...p, ts: Date.now() });
    if (fastMode()) {
      announce();
      engine.audio.music.setIntensity(0.2);
      return;
    }
    cannonBusySeat = p.seat;
    const passive = passiveOf(p.seat);
    try {
      // §7: dolly, dim, drumroll, THOOM+shake+KO flop OR click+confetti+exhale.
      // AWAITED IN FULL — the queue (and thus the UI drama) holds until the
      // lights come back up.
      await engine.cannonSequence(p.seat, p.hit, {
        onResolve: () => {
          announce();
          if (!p.hit && passive === 'ironGut') engine.audio.sfx.hiccup(); // Chugs shrugs it off
        },
      });
      if (!p.hit) {
        if (passive === 'sympathy') {
          // Grandma Guava: the whole bar exhales with her.
          engine.audio.sfx.phew();
          for (const s of aliveSeats()) {
            if (s.seat !== p.seat && s.seat !== localSeat) {
              engine.getMonkey(s.seat)?.flashExpression('grin', 1.1);
            }
          }
        }
        refreshHotHeads(snap()?.seats); // Rico gets twitchier as chambers shrink
      }
    } finally {
      cannonBusySeat = null;
    }
  }

  async function choreographMatchEnd(p) {
    inMatch = false;
    engine.setTurn(null);
    store.set('penaltyInfo', null);
    if (!fastMode() && p.winnerSeat != null && engine.getMonkey(p.winnerSeat)) {
      // winner celebration: confetti + cheer + slow camera orbit (§7)
      engine.audio.music.setIntensity(0.5);
      setOverview(true, p.winnerSeat);
      const wp = passiveOf(p.winnerSeat);
      if (wp === 'fanfare') engine.audio.sfx.royalHorn(); // King Kola takes his crown
      if (wp === 'showman') {
        // Captain Splinter: an extra pirate-flag flourish of confetti
        const m = engine.getMonkey(p.winnerSeat);
        if (m) engine.particles.confetti(m.headWorldPos(), { count: 60 });
      }
      const cheer = engine.celebrate(p.winnerSeat);
      await Promise.race([cheer, anim.wait(3.2)]);
      await wait(1.4);
    }
    // …then the podium. screens.js parked matchResult for us (see below).
    store.set('matchResult', p);
    if (['game', 'results'].includes(store.get('screen'))) store.set('screen', 'results');
    engine.audio.music.setIntensity(0.1);
  }

  // ------------------------------------------------------------------------
  // Socket wiring. screens.js subscribed FIRST (main.js order), so the P5
  // store reducers have already run when these handlers fire — snapshot/HUD
  // state is always ahead of (or equal to) the choreography, never behind.
  // ------------------------------------------------------------------------
  const QUEUED = [
    MSG.HAND,
    MSG.ROUND_START,
    MSG.TURN,
    MSG.PLAYED,
    MSG.CALLED,
    MSG.REVEAL,
    MSG.LAST_HOLDER,
    MSG.PENALTY,
    MSG.CHIP_USED,
    MSG.CANNON,
    MSG.ELIMINATED,
    MSG.ROUND_END,
    MSG.MODE_EVENT,
  ];
  for (const t of QUEUED) subs.push(socket.on(t, (p) => enqueue(t, p)));

  subs.push(
    socket.on(MSG.GAME_START, (p) => {
      clearQueue();
      enqueue('__resync', p);
    })
  );
  subs.push(
    socket.on(MSG.STATE, (p) => {
      // reconnect / spectate: supersedes any queued drama
      clearQueue();
      enqueue('__resync', p);
    })
  );

  subs.push(
    socket.on(MSG.MATCH_END, (p) => {
      // screens.js (registered first) just set matchResult and armed a 1.6 s
      // results transition. Park the result so the podium waits for the
      // celebration choreography instead (choreographMatchEnd restores it).
      store.set('matchResult', null);
      enqueue(MSG.MATCH_END, p);
    })
  );

  // Emotes are ambient: play immediately (never blocked behind the queue),
  // but don't stomp the cannon victim's KO/survival acting.
  subs.push(
    socket.on(MSG.EMOTE, (p) => {
      if (!inMatch && !snap()) return;
      maybeMimic(p); // Echo mirrors the table's last emote (even the local player's)
      if (p.seat === localSeat || p.seat === cannonBusySeat) return; // DOM bubble covers these
      engine.emote(p.seat, p.emoteId);
      maybeGlitchTrail(p.seat); // Bolt's emotes leave a neon trail
    })
  );
  subs.push(
    socket.on(MSG.QUICK_PHRASE, (p) => {
      if (p.seat == null || p.seat === localSeat || p.seat === cannonBusySeat) return;
      engine.getMonkey(p.seat)?.flashExpression('grin', 1.1);
    })
  );

  subs.push(
    socket.on(MSG.LEFT_ROOM, () => {
      clearQueue();
      inMatch = false;
      localSeat = null;
      setOverview(false);
      engine.setTurn(null);
      engine.tableView.clearHand();
      engine.clearPile();
      for (let s = 0; s < SEAT_MAX; s++) engine.clearSeat(s);
      ghosted.clear();
      engine.audio.music.setIntensity(0);
      updateAttract(); // back to the menu → attract orbit resumes
    })
  );

  // lobby nicety: preview the selected map behind the lobby UI
  subs.push(
    store.on('roomState', (room) => {
      if (room && !inMatch) engine.loadMap(room.settings?.mapId ?? DEFAULT_MAP_ID);
    })
  );

  // idle backdrop behind the menus before any room exists + attract orbit
  engine.loadMap(DEFAULT_MAP_ID);
  updateAttract();

  return {
    /** test/debug hooks */
    get queueLength() {
      return queue.length;
    },
    get processing() {
      return processing;
    },
    dispose() {
      clearQueue();
      for (const off of subs) off();
    },
  };
}
