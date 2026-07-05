// Coconut Roulette HUD module (R5) — the in-game controls for the rigged
// coconut: big SHAKE / PASS buttons, a live explosion-odds meter (fuse bar +
// percentage), the round's shake counter, and per-seat chip counts on the
// shell's seat plates (🥥 marks the holder). Module contract in
// ui/modes/index.js; the shared shell (seat plates, turn ring, chat, banners)
// lives in ui/hud.js.
//
// State: the shell re-renders on snapshot/turnInfo changes, but roulette's
// chip counts and bomb odds move on `modeEvent` frames (screens.js appends
// them to store.modeEvents). This module folds that ordered log incrementally
// — holder/shakes/pExplode from HOLDER/SHAKE, per-seat chips from SHAKE/PASS,
// null after EXPLODE — and falls back to `snapshot.bomb` (§10.3) right after
// a resync. PASS at 0 chips is disabled here AND rejected server-side.

import { MSG } from '@shared/protocol.js';
import { ROULETTE_ACTIONS, ROULETTE_EVENTS } from '@shared/modeEvents.js';
import { el, clear, shortName } from '../dom.js';

/**
 * @param {{store, socket, toast}} ctx
 * @returns {import('./index.js').ModeHud}
 */
export function createRouletteHud(ctx) {
  const { store, socket, toast } = ctx;

  const dock = el('div', { className: 'hand-dock mode-action-dock', style: { display: 'none' } });
  const root = el('div', { className: 'mode-hud' }, [dock]);

  /** @type {string|null} aid of the in-flight modeAction */
  let pendingAid = null;
  /** @type {string|null} verb of the in-flight modeAction (button spinner) */
  let pendingVerb = null;
  const subs = [];

  // ---------------------------------------------------------------------
  // Bomb + chip state folded from the ordered modeEvents log
  // ---------------------------------------------------------------------
  /** @type {{holderSeat: number, shakes: number, pExplode: number}|null} */
  let bombState = null;
  let bombSeen = false; // a mode event set/cleared bombState since last reset
  /** @type {Map<number, number>} seat → chips (fresher than snapshot.seats) */
  const chipOverride = new Map();
  /** @type {Object|null} last folded event (by identity — the log is capped) */
  let lastFolded = null;

  function resetFold() {
    bombState = null;
    bombSeen = false;
    chipOverride.clear();
  }

  /** Reconnect/spectate resync: the fresh snapshot is now the authority. */
  function resetDerived() {
    resetFold();
    const evts = store.get('modeEvents') ?? [];
    lastFolded = evts.length ? evts[evts.length - 1] : null;
  }

  function fold(p) {
    switch (p.kind) {
      case ROULETTE_EVENTS.HOLDER:
        bombState = { holderSeat: p.seat, shakes: p.shakes ?? 0, pExplode: p.pExplode ?? 0 };
        bombSeen = true;
        break;
      case ROULETTE_EVENTS.SHAKE:
        bombState = { holderSeat: p.seat, shakes: p.shakes ?? 0, pExplode: p.pExplode ?? 0 };
        bombSeen = true;
        if (typeof p.chips === 'number') chipOverride.set(p.seat, p.chips);
        break;
      case ROULETTE_EVENTS.PASS:
        if (typeof p.chips === 'number') chipOverride.set(p.seat, p.chips);
        break;
      case ROULETTE_EVENTS.EXPLODE:
        bombState = null;
        bombSeen = true;
        break;
      default:
        break;
    }
  }

  /** Fold new modeEvents. The log is append-only but CAPPED (store.push
   *  trims the front) and cleared on gameStart — so track our place by the
   *  last folded item's identity, and refold everything (last-write-wins,
   *  so it's safe) when the marker was trimmed away or the log was reset. */
  function ingest() {
    const evts = store.get('modeEvents') ?? [];
    if (!evts.length) {
      if (lastFolded) {
        lastFolded = null;
        resetFold();
      }
      return;
    }
    let start = 0;
    if (lastFolded) {
      const idx = evts.lastIndexOf(lastFolded);
      if (idx >= 0) start = idx + 1;
      else resetFold(); // trimmed/reset — refold the surviving window
    }
    for (let i = start; i < evts.length; i++) fold(evts[i]);
    lastFolded = evts[evts.length - 1];
  }

  const snap = () => store.get('snapshot');
  /** Freshest bomb view: folded events win; snapshot.bomb covers resyncs. */
  function bombView() {
    ingest();
    return bombSeen ? bombState : (snap()?.bomb ?? null);
  }
  const chipsFor = (seat) => chipOverride.get(seat.seat) ?? seat.chips ?? 0;

  const isMyTurn = () => {
    const s = snap();
    return !!s && s.yourSeat != null && s.turnSeat === s.yourSeat && s.phase === 'playing';
  };

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  function sendAction(action) {
    if (!isMyTurn() || pendingAid) return;
    const me = snap()?.seats?.find((x) => x.seat === snap().yourSeat);
    if (action === ROULETTE_ACTIONS.PASS && me && chipsFor(me) <= 0) return; // broke — server would refuse too
    const aid = socket.nextAid();
    pendingAid = aid;
    pendingVerb = action;
    socket.send(MSG.MODE_ACTION, { aid, action });
    render();
  }

  subs.push(
    store.on('actionAck', (ack) => {
      if (!ack || ack.aid !== pendingAid) return;
      pendingAid = null;
      pendingVerb = null;
      if (!ack.ok) toast(`Action rejected: ${ack.code ?? 'unknown'}`, 'error');
      render();
    })
  );
  // odds/chips move on modeEvent frames — re-render as they land
  subs.push(store.on('modeEvents', () => render()));
  // reconnect/spectate resync: the snapshot is now the authority
  subs.push(socket.on(MSG.STATE, () => resetDerived()));

  // ---------------------------------------------------------------------
  // Per-seat stats row (rendered inside the shell's seat plates)
  // ---------------------------------------------------------------------
  function seatStats(seat) {
    const b = bombView();
    const holder = seat.alive && b?.holderSeat === seat.seat;
    const nodes = [
      el('span', {
        className: `sp-chip ${chipsFor(seat) > 0 ? '' : 'spent'}`,
        title: 'chips (pay 1 to pass)',
        text: `🍌 ${chipsFor(seat)}`,
      }),
    ];
    if (holder) {
      nodes.push(el('span', { title: 'holding the rigged coconut', text: '🥥💣' }));
    }
    return nodes;
  }

  // ---------------------------------------------------------------------
  // Controls dock: status + odds meter + SHAKE / PASS
  // ---------------------------------------------------------------------
  function oddsMeter(b) {
    const p = Math.min(1, b?.pExplode ?? 0);
    const meter = el('div', { className: 'fuse-bar', style: { width: '230px', margin: '0' } }, [
      el('i', { style: { transform: `scaleX(${p})` } }),
    ]);
    return el(
      'div',
      { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' } },
      [
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [
          el('span', { className: 'faint', style: { fontSize: '11px' }, text: 'BOOM ODDS' }),
          meter,
          el('b', {
            style: { color: p >= 0.3 ? 'var(--danger)' : 'var(--banana)', minWidth: '42px' },
            text: `${Math.round(p * 100)}%`,
          }),
        ]),
        el('span', {
          className: 'faint',
          style: { fontSize: '11px' },
          text: `shakes this round: ${b?.shakes ?? 0}`,
        }),
      ]
    );
  }

  function render() {
    const s = snap();
    clear(dock);
    if (!s || s.phase === 'matchEnd') {
      dock.style.display = 'none';
      return;
    }
    dock.style.display = '';

    const b = bombView();
    const me = s.yourSeat != null ? s.seats?.find((x) => x.seat === s.yourSeat) : null;
    const holderSeatObj = b ? s.seats?.find((x) => x.seat === b.holderSeat) : null;

    if (me && !me.alive) {
      dock.append(
        el('div', {
          className: 'last-play-tag',
          style: { position: 'static' },
          text: '👻 You went out with a bang. Heckle from the beyond.',
        })
      );
      if (b) dock.append(oddsMeter(b));
      return;
    }

    // status line: who is holding the thing
    const iHold = me && b && b.holderSeat === me.seat;
    dock.append(
      el('div', {
        style: { fontWeight: '800', fontSize: '14px', color: iHold ? 'var(--danger)' : 'var(--ink)' },
        text: !b
          ? '🥥 The coconut is being re-rigged…'
          : iHold
            ? '🥥💣 YOU are holding the rigged coconut!'
            : `🥥 ${shortName(holderSeatObj?.name ?? 'Monkey', 14)} holds the rigged coconut…`,
      }),
      oddsMeter(b)
    );

    if (!me) return; // spectators just watch the odds climb

    const myTurn = isMyTurn();
    const chips = chipsFor(me);
    const canPass = myTurn && chips > 0 && !pendingAid;
    const canShake = myTurn && !pendingAid;
    const pct = Math.round(Math.min(1, b?.pExplode ?? 0) * 100);

    const shakeBtn = el('button', {
      className: 'btn danger big',
      type: 'button',
      disabled: canShake ? undefined : 'true',
      text: pendingVerb === ROULETTE_ACTIONS.SHAKE ? '…' : `🥥 SHAKE  (+1 🍌 · ${pct}% boom)`,
      onClick: () => sendAction(ROULETTE_ACTIONS.SHAKE),
    });
    const passBtn = el('button', {
      className: 'btn primary big',
      type: 'button',
      disabled: canPass ? undefined : 'true',
      text: pendingVerb === ROULETTE_ACTIONS.PASS ? '…' : '👉 PASS  (−1 🍌)',
      onClick: () => sendAction(ROULETTE_ACTIONS.PASS),
    });

    const turnTag = myTurn
      ? el('span', {
          className: 'badge host',
          style: { fontSize: '12px', padding: '5px 10px' },
          text: '★ YOUR TURN',
        })
      : el('span', { className: 'faint', style: { fontSize: '12px' }, text: 'waiting for your turn…' });
    const secs = el('span', {
      className: 'turn-secs',
      style: { fontWeight: '800', color: 'var(--banana)', minWidth: '34px' },
    });

    dock.append(
      el('div', { className: 'hand-actions' }, [turnTag, shakeBtn, passBtn, myTurn ? secs : null]),
      el('div', {
        className: 'faint',
        style: { fontSize: '11px' },
        text:
          myTurn && chips <= 0
            ? '🚫 0 chips — passing is off the table. SHAKE it, monkey.'
            : `your chips: 🍌 ${chips} — survive a shake to earn one, pay one to pass`,
      })
    );
  }

  // ---------------------------------------------------------------------
  // Module contract (see ui/modes/index.js)
  // ---------------------------------------------------------------------
  return {
    el: root,
    seatStats,
    /** Roulette's only active-turn phase (§10.3). */
    isTurnPhase: (s) => s.phase === 'playing',
    render,
    onTurnInfo() {
      // a new turn means any stale pending action can be dropped
      pendingAid = null;
      pendingVerb = null;
    },
    tick() {
      const turnInfo = store.get('turnInfo');
      const s = snap();
      if (turnInfo && s && s.phase === 'playing') {
        const secsEl = dock.querySelector('.turn-secs');
        if (secsEl) secsEl.textContent = `${Math.ceil(Math.max(0, turnInfo.deadline - Date.now()) / 1000)}s`;
      }
    },
    onShow() {
      pendingAid = null;
      pendingVerb = null;
      render();
    },
    onHide() {},
    dispose() {
      for (const off of subs) off();
      subs.length = 0;
    },
  };
}

export default createRouletteHud;
