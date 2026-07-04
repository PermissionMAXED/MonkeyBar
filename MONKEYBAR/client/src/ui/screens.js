// UI screen manager — PLAN.md §2 (client/src/ui/screens.js).
// FROZEN SIGNATURE (P1): export function initUI(store, socket, engine)
//
// Builds every DOM screen inside #ui, shows/hides them from store 'screen'
// with smooth transitions, and wires all server events into the store
// (snapshot reducer, chat log, room state, toasts). 3D choreography is P6's
// job via game/gameClient.js — here we only render DOM from state.

import './styles.css';

import { MSG } from '@shared/protocol.js';
import { el } from './dom.js';
import { incrementWins } from './cosmetics.js';
import { createMainMenu } from './mainMenu.js';
import { createLobbyBrowser } from './lobbyBrowser.js';
import { createLobbyScreen } from './lobbyScreen.js';
import { createCharacterSelect } from './characterSelect.js';
import { createHud } from './hud.js';
import { createSettingsScreen } from './settingsScreen.js';
import { createShopScreen } from './shopScreen.js';
import { createResultsScreen } from './resultsScreen.js';

/**
 * @param {ReturnType<import('../state/store.js').createStore>} store
 * @param {ReturnType<import('../net/socket.js').createSocket>} socket
 * @param {ReturnType<import('../three/engine.js').createEngine>} engine
 */
export function initUI(store, socket, engine) {
  const root = document.getElementById('ui');
  if (!root) return;

  // ---------------------------------------------------------------------
  // Toasts + connection pill
  // ---------------------------------------------------------------------
  const toastStack = el('div', { className: 'toast-stack' });
  root.appendChild(toastStack);

  function toast(msg, kind = 'info', ms = 3200) {
    const t = el('div', { className: `toast ${kind === 'error' ? 'error' : ''}`, text: msg });
    toastStack.appendChild(t);
    setTimeout(() => {
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 320);
    }, ms);
  }

  const connPill = el('div', { className: 'conn-pill connecting' }, [
    el('span', { className: 'dot' }),
    el('span', { className: 'label', text: 'connecting' }),
  ]);
  root.appendChild(connPill);
  store.on('connStatus', (s, prev) => {
    connPill.className = `conn-pill ${s}`;
    connPill.querySelector('.label').textContent =
      s === 'open' ? 'online' : s === 'reconnecting' ? 'reconnecting…' : s;
    if (s === 'open' && (prev === 'reconnecting' || prev === 'closed')) {
      toast('Reconnected to the bar 🍌');
    } else if (s === 'reconnecting' && prev === 'open') {
      toast('Connection lost — reconnecting…', 'error');
    }
  });

  // ---------------------------------------------------------------------
  // Screen manager
  // ---------------------------------------------------------------------
  let backTarget = 'mainMenu';

  const ctx = {
    store,
    socket,
    engine,
    toast,
    go(name) {
      const cur = store.get('screen');
      if (cur === name) return;
      // remember where overlay-ish screens should return to
      if (['characterSelect', 'settings', 'shop'].includes(name)) {
        if (!['characterSelect', 'settings', 'shop'].includes(cur)) backTarget = cur;
      }
      store.set('screen', name);
    },
    back() {
      store.set('screen', backTarget && backTarget !== 'boot' ? backTarget : 'mainMenu');
    },
  };

  // boot splash
  const bootEl = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'boot-logo' }, [
        el('div', { className: 'big', text: 'MONKEYBAR' }),
        el('div', { className: 'sub', text: '🍌 swinging into the bar…' }),
      ]),
    ]),
  ]);

  /** @type {Record<string, {el: HTMLElement, onShow?: () => void, onHide?: () => void}>} */
  const screens = {
    boot: { el: bootEl },
    mainMenu: createMainMenu(ctx),
    lobbyBrowser: createLobbyBrowser(ctx),
    lobby: createLobbyScreen(ctx),
    characterSelect: createCharacterSelect(ctx),
    settings: createSettingsScreen(ctx),
    shop: createShopScreen(ctx),
    game: createHud(ctx),
    results: createResultsScreen(ctx),
  };

  for (const s of Object.values(screens)) root.insertBefore(s.el, toastStack);

  store.on('screen', (name, prev) => {
    const prevScreen = screens[prev];
    const nextScreen = screens[name];
    if (prevScreen) {
      prevScreen.el.classList.remove('active');
      prevScreen.onHide?.();
    }
    if (nextScreen) {
      nextScreen.el.classList.add('active');
      nextScreen.onShow?.();
    }
  });
  // activate the initial screen
  screens[store.get('screen')]?.el.classList.add('active');

  // ---------------------------------------------------------------------
  // Snapshot reducer helpers
  // ---------------------------------------------------------------------
  /** @type {import('@shared/protocol.js').Card[]|null} */
  let pendingHand = null;

  function patchSnapshot(patch) {
    const snap = store.get('snapshot');
    if (!snap) return;
    store.set('snapshot', { ...snap, ...patch });
  }

  function patchSeat(seatNo, patch) {
    const snap = store.get('snapshot');
    if (!snap?.seats) return;
    const seats = snap.seats.map((s) => (s.seat === seatNo ? { ...s, ...patch } : s));
    store.set('snapshot', { ...snap, seats });
  }

  function seatName(seatNo) {
    const snap = store.get('snapshot');
    const seat = snap?.seats?.find((s) => s.seat === seatNo);
    return seat?.name ?? `Monkey ${seatNo != null ? seatNo + 1 : '?'}`;
  }

  function sysLine(text) {
    store.push('chatLog', { kind: 'sys', text, ts: Date.now() });
  }

  function adoptSnapshot(snapshot) {
    if (!snapshot) return;
    const snap = { ...snapshot };
    if (pendingHand && !snap.yourHand) {
      snap.yourHand = pendingHand;
      pendingHand = null;
    }
    store.set('snapshot', snap);
  }

  // ---------------------------------------------------------------------
  // Server event wiring (§3.3)
  // ---------------------------------------------------------------------
  socket.on(MSG.WELCOME, (p) => {
    store.set('catalogs', {
      roster: p.roster ?? [],
      modes: p.modes ?? [],
      maps: p.maps ?? [],
      emotes: p.emotes ?? [],
      quickPhrases: p.quickPhrases ?? [],
    });
    // Push the locally persisted monkey pick to the server (outside game only —
    // a resumed session may be mid-match, where setProfile is rejected).
    const profile = store.get('profile');
    if (profile?.monkeyId && !p.resumed) socket.send(MSG.SET_PROFILE, { monkeyId: profile.monkeyId });
    if (store.get('screen') === 'boot') ctx.go('mainMenu');
    if (p.resumed) toast('Session resumed 🐒');
  });

  socket.on(MSG.ERROR, (p) => {
    const friendly = {
      BAD_MSG: 'The bar did not understand that.',
      NOT_FOUND: 'Room not found.',
      ROOM_FULL: 'That table is full.',
      NOT_HOST: 'Only the host can do that.',
      BAD_STATE: "Can't do that right now.",
      NOT_YOUR_TURN: 'Not your turn, monkey.',
      INVALID_CARDS: 'Invalid card selection.',
      RATE_LIMIT: 'Slow down there, monkey.',
      NAME_INVALID: 'That name will not fly at this bar.',
    };
    toast(friendly[p.code] ?? p.msg ?? p.code ?? 'Unknown error', 'error');
  });

  socket.on(MSG.ACTION_ACK, (p) => {
    store.set('actionAck', { ...p, ts: Date.now() });
  });

  socket.on(MSG.ROOM_LIST, (p) => {
    store.set('roomList', p.rooms ?? []);
  });

  socket.on(MSG.ROOM_STATE, (p) => {
    store.set('roomState', p.room ?? null);
    const screen = store.get('screen');
    if (['boot', 'mainMenu', 'lobbyBrowser'].includes(screen)) ctx.go('lobby');
  });

  socket.on(MSG.LEFT_ROOM, (p) => {
    store.set('roomState', null);
    store.set('snapshot', null);
    store.set('quickSearching', false);
    if (p.reason === 'kicked') toast('You were kicked from the room.', 'error');
    else if (p.reason === 'closed') toast('The room was closed.', 'error');
    const screen = store.get('screen');
    if (['lobby', 'game', 'results'].includes(screen)) {
      ctx.go('lobbyBrowser');
      socket.send(MSG.LIST_ROOMS, {});
    }
  });

  socket.on(MSG.MATCH_FOUND, (p) => {
    store.set('quickSearching', false);
    toast('Match found! 🍌');
    // Most servers auto-seat you and push roomState; join explicitly if not.
    setTimeout(() => {
      if (store.get('roomState')?.id !== p.roomId) {
        socket.send(MSG.JOIN_ROOM, { roomId: p.roomId });
      }
    }, 600);
  });

  socket.on(MSG.GAME_START, (p) => {
    store.set('matchResult', null);
    store.set('revealInfo', null);
    store.set('cannonResult', null);
    store.set('penaltyInfo', null);
    store.set('turnInfo', null);
    store.set('roundEndInfo', null);
    adoptSnapshot(p.snapshot);
    sysLine('The match begins. Trust no monkey.');
    ctx.go('game');
  });

  socket.on(MSG.STATE, (p) => {
    adoptSnapshot(p.snapshot);
    if (p.snapshot && p.snapshot.phase !== 'matchEnd' && store.get('screen') !== 'game') {
      ctx.go('game');
    }
  });

  socket.on(MSG.HAND, (p) => {
    const snap = store.get('snapshot');
    if (snap) {
      store.set('snapshot', { ...snap, yourHand: p.cards ?? [] });
    } else {
      pendingHand = p.cards ?? [];
    }
  });

  socket.on(MSG.ROUND_START, (p) => {
    store.set('revealInfo', null);
    store.set('cannonResult', null);
    store.set('penaltyInfo', null);
    store.set('roundEndInfo', null);
    store.set('lastHolderInfo', null);
    patchSnapshot({
      roundNo: p.roundNo,
      tableFruit: p.tableFruit,
      seats: p.seats ?? store.get('snapshot')?.seats,
      turnSeat: p.firstSeat,
      phase: 'playing',
      lastPlay: null,
    });
    store.set('roundBanner', { roundNo: p.roundNo, tableFruit: p.tableFruit, ts: Date.now() });
  });

  socket.on(MSG.TURN, (p) => {
    store.set('turnInfo', { ...p, ts: Date.now() });
    patchSnapshot({ turnSeat: p.seat, deadline: p.deadline, phase: 'playing' });
  });

  socket.on(MSG.PLAYED, (p) => {
    patchSeat(p.seat, { handCount: p.handCount });
    patchSnapshot({ lastPlay: { seat: p.seat, count: p.count } });
    if (p.handCount === 0) sysLine(`${seatName(p.seat)} is out of cards — safe and smirking.`);
  });

  socket.on(MSG.CALLED, (p) => {
    patchSnapshot({ phase: 'revealing' });
    store.set('calledInfo', { ...p, ts: Date.now() });
    sysLine(`${seatName(p.callerSeat)} calls MONKEY LIES on ${seatName(p.targetSeat)}!`);
  });

  socket.on(MSG.REVEAL, (p) => {
    store.set('revealInfo', { ...p, ts: Date.now() });
    sysLine(
      p.lie
        ? `${seatName(p.targetSeat)} LIED! The cannon swivels…`
        : `${seatName(p.targetSeat)} told the truth. Bad call — the cannon turns on ${seatName(p.loserSeat)}…`
    );
  });

  socket.on(MSG.LAST_HOLDER, (p) => {
    store.set('lastHolderInfo', { ...p, ts: Date.now() });
    sysLine(`${seatName(p.seat)} is the Last Monkey Holding. House rules apply.`);
  });

  socket.on(MSG.PENALTY, (p) => {
    store.set('penaltyInfo', { ...p, ts: Date.now() });
    patchSnapshot({ phase: 'penalty' });
  });

  socket.on(MSG.CHIP_USED, (p) => {
    const pen = store.get('penaltyInfo');
    if (pen && pen.seat === p.seat) {
      store.set('penaltyInfo', { ...pen, chambers: p.chambersNow, chipUsable: false, bonus: true });
    }
    const snap = store.get('snapshot');
    const seat = snap?.seats?.find((s) => s.seat === p.seat);
    if (seat) patchSeat(p.seat, { chips: Math.max(0, (seat.chips ?? 1) - 1) });
    if (snap && p.seat === snap.yourSeat) patchSnapshot({ chipUsedByYou: true });
    sysLine(`${seatName(p.seat)} spends the Lucky Banana Chip! +2 chambers.`);
  });

  socket.on(MSG.CANNON, (p) => {
    store.set('penaltyInfo', null);
    store.set('cannonResult', { ...p, ts: Date.now() });
    if (!p.hit) {
      const seat = store.get('snapshot')?.seats?.find((s) => s.seat === p.seat);
      if (seat) {
        patchSeat(p.seat, { chambersLeft: Math.max(1, (seat.chambersLeft ?? 6) - 1) });
      }
    }
    sysLine(
      p.hit
        ? `💥 THOOM! ${seatName(p.seat)} takes a coconut to the face!`
        : `*click* — ${seatName(p.seat)} survives. The table exhales.`
    );
  });

  socket.on(MSG.ELIMINATED, (p) => {
    patchSeat(p.seat, { alive: false });
    sysLine(`${seatName(p.seat)} is OUT. A ghost now haunts the bar.`);
  });

  socket.on(MSG.ROUND_END, (p) => {
    patchSnapshot({ phase: 'roundEnd', lastPlay: null });
    store.set('turnInfo', null);
    store.set('roundEndInfo', { ...p, ts: Date.now() });
  });

  socket.on(MSG.MATCH_END, (p) => {
    patchSnapshot({ phase: 'matchEnd' });
    store.set('turnInfo', null);
    store.set('penaltyInfo', null);
    store.set('matchResult', { ...p, ts: Date.now() });
    const snap = store.get('snapshot');
    if (snap && snap.yourSeat != null && snap.yourSeat === p.winnerSeat) {
      const wins = incrementWins();
      sysLine(`You win the match! Lifetime wins: ${wins}.`);
    }
    // Let the final cannon/KO drama breathe before the podium.
    setTimeout(() => {
      if (store.get('matchResult')) ctx.go('results');
    }, 1600);
  });

  socket.on(MSG.CHAT, (p) => {
    store.push('chatLog', {
      kind: 'chat',
      seat: p.seat ?? null,
      name: p.name ?? 'Monkey',
      text: p.text ?? '',
      ts: Date.now(),
    });
  });

  socket.on(MSG.QUICK_PHRASE, (p) => {
    const phrase = store.get('catalogs').quickPhrases.find((q) => q.id === p.phraseId);
    store.push('chatLog', {
      kind: 'phrase',
      seat: p.seat,
      name: seatName(p.seat),
      text: phrase?.text ?? p.phraseId,
      ts: Date.now(),
    });
  });

  socket.on(MSG.EMOTE, (p) => {
    const emote = store.get('catalogs').emotes.find((e) => e.id === p.emoteId);
    store.push('chatLog', {
      kind: 'emote',
      seat: p.seat,
      name: seatName(p.seat),
      glyph: emote?.glyph ?? '❓',
      ts: Date.now(),
    });
    store.set('emoteEvent', { seat: p.seat, glyph: emote?.glyph ?? '❓', ts: Date.now() });
  });

  socket.on(MSG.CONN, (p) => {
    patchSeat(p.seat, { connected: p.connected });
    sysLine(
      p.connected
        ? `${seatName(p.seat)} reconnected.`
        : `${seatName(p.seat)} lost connection — a bot warms their stool.`
    );
  });

  socket.on(MSG.PONG, (p) => {
    if (typeof p.ts === 'number') store.set('latencyMs', Date.now() - p.ts);
  });

  // Dev-only hook so the store/socket can be poked from the console
  // (also used by build-agent smoke tests; harmless, stripped from prod builds).
  if (import.meta.env?.DEV) {
    window.__mb = { store, socket, go: ctx.go, toast };
    // `?mock=1` drives the full lobby/game UI with scripted §3 server events
    // (useful while the authoritative server or 3D choreography is in flight).
    if (new URLSearchParams(location.search).get('mock') === '1') {
      import('./mockDrive.js').then(({ runMockDrive }) => runMockDrive(store, socket));
    }
  }
}
