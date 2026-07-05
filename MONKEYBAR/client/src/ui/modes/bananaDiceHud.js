// Banana Dice HUD module (R4) — the in-game controls for liar's dice under
// coconut shells: YOUR dice hidden under a liftable shell (tap to peek), the
// current-bid banner, a bid picker (count stepper + face buttons, client-side
// legality for UX only — the server re-validates via bidBeats), the big
// CHALLENGE button, per-seat dice pip counts, and the cannon-penalty overlay
// (chip + fuse, ML event shapes). Module contract in ui/modes/index.js; the
// shared shell (seat plates, turn ring, chat, transient banners) is ui/hud.js.
//
// State: the shell re-renders on snapshot/turnInfo changes, but dice state
// moves on `modeEvent` frames (screens.js appends them to store.modeEvents).
// This module folds that ordered log incrementally — your dice from
// YOUR_DICE, the bid from BID (cleared by REVEAL), per-seat dice counts from
// REVEAL/DIE_LOST/DIE_REGAINED — and falls back to the §10.3 snapshot fields
// (yourDice/bid/totalDice/seat.dice) right after a resync. The reveal banner
// rides the fx-timed `fxDiceReveal` store key published by the choreography
// at the exact moment the 3D shells lift (no spoilers ahead of the drama).

import { MSG } from '@shared/protocol.js';
import { DICE_START, START_CHAMBERS } from '@shared/constants.js';
import { bidBeats, DICE_FACES } from '@shared/dice.js';
import { DICE_ACTIONS, DICE_EVENTS } from '@shared/modeEvents.js';
import { el, clear, shortName } from '../dom.js';

/** Survive-the-cannon regain — mode-local kind mirrored from the server
 *  engine (shared DICE_EVENTS is a frozen 1.0 contract). */
const DIE_REGAINED = 'diceDieRegained';

const FACE_GLYPH = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

/** The minimal raise over `bid` (mirror of the server helper, UX only). */
function minimalRaise(bid, totalDice) {
  if (!bid) return totalDice >= 1 ? { count: 1, face: 2 } : null;
  if (bid.face < DICE_FACES) return { count: bid.count, face: bid.face + 1 };
  if (bid.count < totalDice) return { count: bid.count + 1, face: 1 };
  return null;
}

/**
 * @param {{store, socket, toast}} ctx
 * @returns {import('./index.js').ModeHud}
 */
export function createBananaDiceHud(ctx) {
  const { store, socket, toast } = ctx;

  // ---------------------------------------------------------------------
  // Layers (mounted into the hud.js shell, positioned against .hud)
  // ---------------------------------------------------------------------
  const dock = el('div', { className: 'hand-dock mode-action-dock', style: { display: 'none' } });
  // persistent current-bid banner, top-center (transient banners stay clear)
  const bidBanner = el('div', {
    className: 'last-play-tag',
    style: {
      display: 'none',
      right: 'auto',
      bottom: 'auto',
      left: '50%',
      top: '64px',
      transform: 'translateX(-50%)',
      textAlign: 'center',
      zIndex: '18',
    },
  });
  // fx-timed reveal strip (fed by fxDiceReveal from the 3D choreography)
  const revealBanner = el('div', {
    className: 'last-play-tag',
    style: {
      display: 'none',
      right: 'auto',
      bottom: 'auto',
      left: '50%',
      top: '112px',
      transform: 'translateX(-50%)',
      maxWidth: 'min(480px, 88vw)',
      textAlign: 'center',
      color: 'var(--banana)',
      zIndex: '18',
    },
  });
  const penaltyLayer = el('div', {});
  const root = el('div', { className: 'mode-hud' }, [bidBanner, revealBanner, dock, penaltyLayer]);

  // ---------------------------------------------------------------------
  // Local UI state
  // ---------------------------------------------------------------------
  /** @type {{aid: string, kind: 'bid'|'challenge'|'chip'}|null} */
  let pendingAction = null;
  /** aid → action; real servers broadcast turn/modeEvent BEFORE the ack. */
  const sentActions = new Map();
  function trackAction(action) {
    pendingAction = action;
    sentActions.set(action.aid, action);
    if (sentActions.size > 8) sentActions.delete(sentActions.keys().next().value);
  }
  let visible = false;
  /** Bid picker selection + the bid it was defaulted against. */
  let sel = null;
  let selKey = null;
  /** Shell peek (your dice hidden under the coconut until you look). */
  let peeking = false;
  let revealTimer = null;
  /** @type {(() => void)[]} store unsubscribers (cleared on dispose) */
  const subs = [];

  // ---------------------------------------------------------------------
  // Dice state folded from the ordered modeEvents log (rouletteHud pattern)
  // ---------------------------------------------------------------------
  /** @type {number[]|null} */ let myDice = null;
  let myDiceSeen = false;
  /** @type {{seat: number, count: number, face: number}|null} */ let bid = null;
  let bidSeen = false;
  /** @type {Map<number, number>} seat → dice count (fresher than snapshot) */
  const diceOverride = new Map();
  /** @type {Object|null} last folded event (by identity — the log is capped) */
  let lastFolded = null;

  function resetFold() {
    myDice = null;
    myDiceSeen = false;
    bid = null;
    bidSeen = false;
    diceOverride.clear();
  }

  /** Reconnect/spectate resync: the fresh snapshot is now the authority. */
  function resetDerived() {
    resetFold();
    const evts = store.get('modeEvents') ?? [];
    lastFolded = evts.length ? evts[evts.length - 1] : null;
  }

  function fold(p) {
    switch (p.kind) {
      case DICE_EVENTS.YOUR_DICE:
        myDice = p.dice ?? [];
        myDiceSeen = true;
        peeking = false; // fresh roll — shell slams back down
        break;
      case DICE_EVENTS.BID:
        bid = { seat: p.seat, count: p.count, face: p.face };
        bidSeen = true;
        break;
      case DICE_EVENTS.REVEAL:
        bid = null;
        bidSeen = true;
        for (const entry of p.dice ?? []) diceOverride.set(entry.seat, entry.dice.length);
        break;
      case DICE_EVENTS.DIE_LOST:
        diceOverride.set(p.seat, p.diceLeft);
        break;
      case DIE_REGAINED:
        diceOverride.set(p.seat, p.diceLeft ?? 1);
        break;
      default:
        break;
    }
  }

  /** Fold new modeEvents (append-only but capped + reset on gameStart). */
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
  /** Freshest views: folded events win; snapshot fields cover resyncs. */
  function bidView() {
    ingest();
    return bidSeen ? bid : (snap()?.bid ?? null);
  }
  function myDiceView() {
    ingest();
    return myDiceSeen ? myDice : (snap()?.yourDice ?? null);
  }
  const diceFor = (seat) => diceOverride.get(seat.seat) ?? seat.dice ?? 0;
  function totalDiceView() {
    const s = snap();
    if (!s?.seats?.length) return s?.totalDice ?? 0;
    ingest();
    let n = 0;
    for (const seat of s.seats) if (seat.alive) n += diceFor(seat);
    return n;
  }

  const isMyTurn = () => {
    const s = snap();
    return !!s && s.yourSeat != null && s.turnSeat === s.yourSeat && s.phase === 'playing';
  };

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------
  function sendBid() {
    if (!isMyTurn() || pendingAction || !sel) return;
    const aid = socket.nextAid();
    trackAction({ aid, kind: 'bid' });
    socket.send(MSG.MODE_ACTION, {
      aid,
      action: DICE_ACTIONS.BID,
      data: { count: sel.count, face: sel.face },
    });
    render();
  }

  function sendChallenge() {
    const b = bidView();
    const s = snap();
    if (!isMyTurn() || pendingAction || !b || b.seat === s.yourSeat) return;
    const aid = socket.nextAid();
    trackAction({ aid, kind: 'challenge' });
    socket.send(MSG.MODE_ACTION, { aid, action: DICE_ACTIONS.CHALLENGE, data: {} });
    render();
  }

  subs.push(
    store.on('actionAck', (ack) => {
      if (!ack) return;
      const action = sentActions.get(ack.aid) ?? null;
      if (!action) return;
      sentActions.delete(ack.aid);
      if (pendingAction?.aid === ack.aid) pendingAction = null;
      if (!ack.ok) toast(`Action rejected: ${ack.code ?? 'unknown'}`, 'error');
      render();
      renderPenalty();
    })
  );
  // dice state moves on modeEvent frames — re-render as they land
  subs.push(store.on('modeEvents', () => render()));
  // reconnect/spectate resync: the snapshot is now the authority
  subs.push(socket.on(MSG.STATE, () => resetDerived()));

  // fx-timed reveal strip: published by the choreography AT the shell lift
  subs.push(
    store.on('fxDiceReveal', (r) => {
      if (!r || !visible) return;
      peeking = true; // shells are up — your dice show too
      const s = snap();
      const loser = s?.seats?.find((x) => x.seat === r.loserSeat);
      clear(revealBanner);
      revealBanner.append(
        el('b', { text: `🎲 SHELLS UP! ${r.matching} × ${FACE_GLYPH[r.face]}` }),
        el('span', { text: ' on the table (wild ⚀ count) — ' }),
        el('b', {
          style: { color: 'var(--danger)' },
          text: `${shortName(loser?.name ?? 'Monkey', 14)} loses a die.`,
        })
      );
      revealBanner.style.display = '';
      if (revealTimer) clearTimeout(revealTimer);
      revealTimer = setTimeout(() => {
        revealBanner.style.display = 'none';
      }, 3400);
      render();
    })
  );

  subs.push(
    store.on('penaltyInfo', () => {
      if (visible) renderPenalty();
    })
  );

  // ---------------------------------------------------------------------
  // Per-seat stats row: dice pips (the shell count everyone can see) + chip
  // ---------------------------------------------------------------------
  function seatStats(seat) {
    const n = seat.alive ? diceFor(seat) : 0;
    const pips = el(
      'div',
      { className: 'chamber-pips', title: `${n} dice under the shell` },
      Array.from({ length: DICE_START }, (_, i) => el('i', { className: i < n ? 'full' : '' }))
    );
    return [
      el('span', { className: 'sp-cards', text: `🎲 ${n}` }),
      pips,
      el('span', {
        className: `sp-chip ${seat.chips > 0 ? '' : 'spent'}`,
        title: 'Lucky Banana Chip',
        text: `🍀${seat.chips}`,
      }),
    ];
  }

  // ---------------------------------------------------------------------
  // Current-bid banner (persistent while bidding)
  // ---------------------------------------------------------------------
  function renderBidBanner() {
    const s = snap();
    const b = bidView();
    if (!s || s.phase !== 'playing' || !b) {
      bidBanner.style.display = 'none';
      return;
    }
    const who = s.seats?.find((x) => x.seat === b.seat);
    const mine = s.yourSeat != null && b.seat === s.yourSeat;
    clear(bidBanner);
    bidBanner.append(
      el('span', { text: `${mine ? 'You' : shortName(who?.name ?? 'Monkey', 12)} bid${mine ? '' : 's'} ` }),
      el('b', {
        style: { color: 'var(--banana)', fontSize: '15px' },
        text: `${b.count} × ${FACE_GLYPH[b.face]}`,
      }),
      el('span', { className: 'faint', text: `  (⚀ wild · ${totalDiceView()} dice in play)` })
    );
    bidBanner.style.display = '';
  }

  // ---------------------------------------------------------------------
  // Controls dock: shell-covered dice + bid picker + CHALLENGE
  // ---------------------------------------------------------------------
  function dieTile(face, size = 34) {
    const wild = face === 1;
    return el('div', {
      style: {
        width: `${size}px`,
        height: `${size}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${size * 0.94}px`,
        lineHeight: '1',
        borderRadius: '6px',
        background: wild ? 'rgba(232, 169, 29, 0.22)' : 'rgba(244, 236, 216, 0.12)',
        border: wild ? '1px solid rgba(232, 169, 29, 0.65)' : '1px solid rgba(244, 236, 216, 0.3)',
        color: wild ? '#ffd23d' : '#f4ecd8',
      },
      title: wild ? '1 — the golden WILD (counts toward every bid)' : `${face}`,
      text: FACE_GLYPH[face],
    });
  }

  /** Your dice under a liftable coconut shell (tap to peek). */
  function shellPeek(dice) {
    const row = el(
      'div',
      { style: { display: 'flex', gap: '6px', padding: '6px 10px' } },
      dice.length
        ? dice.map((f) => dieTile(f))
        : [el('span', { className: 'faint', style: { fontSize: '12px' }, text: 'no dice this round' })]
    );
    const shell = el('div', {
      style: {
        position: 'absolute',
        inset: '-6px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '12px',
        background: 'radial-gradient(circle at 50% 30%, #6b4a2b, #3d2814 78%)',
        border: '1px solid rgba(0,0,0,0.5)',
        boxShadow: '0 6px 14px rgba(0,0,0,0.45)',
        cursor: 'pointer',
        transition: 'transform 0.22s ease, opacity 0.22s ease',
        transform: peeking ? 'translateY(-44px) rotate(-8deg)' : 'none',
        opacity: peeking ? '0.25' : '1',
        zIndex: '2',
        userSelect: 'none',
      },
      title: peeking ? 'drop the shell' : 'lift the shell to peek at your dice',
      onClick: () => {
        peeking = !peeking;
        render();
      },
    }, [
      el('span', { style: { fontSize: '22px' }, text: '🥥' }),
      el('span', {
        className: 'faint',
        style: { fontSize: '9px', letterSpacing: '0.08em' },
        text: peeking ? '' : 'TAP TO PEEK',
      }),
    ]);
    return el(
      'div',
      { style: { position: 'relative', display: 'inline-flex', alignItems: 'center' } },
      [row, shell]
    );
  }

  /** Bid picker: count stepper + face buttons + BID / CHALLENGE. */
  function picker(s) {
    const b = bidView();
    const total = totalDiceView();
    const myTurn = isMyTurn();
    // (re)default the selection whenever the bid-to-beat changes
    const key = b ? `${b.seat}:${b.count}:${b.face}` : 'open';
    if (!sel || selKey !== key) {
      sel = minimalRaise(b, total) ?? { count: 1, face: 2 };
      selKey = key;
    }
    sel.count = Math.max(1, Math.min(total || 1, sel.count));

    const legal = (cand) => cand.count >= 1 && cand.count <= total && (!b || bidBeats(cand, b));
    const canBid = myTurn && !pendingAction && legal(sel);
    const canChallenge = myTurn && !pendingAction && !!b && b.seat !== s.yourSeat;

    const stepBtn = (delta, glyph) =>
      el('button', {
        className: 'btn ghost small',
        type: 'button',
        style: { minWidth: '34px', padding: '6px 8px' },
        disabled: myTurn && !pendingAction ? undefined : 'true',
        text: glyph,
        onClick: () => {
          sel.count = Math.max(1, Math.min(total || 1, sel.count + delta));
          render();
        },
      });

    const faceBtns = Array.from({ length: DICE_FACES }, (_, i) => {
      const face = i + 1;
      const active = sel.face === face;
      const wouldBeLegal = legal({ count: sel.count, face });
      return el('button', {
        className: 'btn ghost small',
        type: 'button',
        style: {
          minWidth: '36px',
          padding: '5px 7px',
          fontSize: '17px',
          lineHeight: '1',
          borderColor: active ? 'var(--banana)' : undefined,
          background: active ? 'rgba(255, 210, 61, 0.18)' : undefined,
          opacity: wouldBeLegal ? '1' : '0.35',
          color: face === 1 ? '#ffd23d' : undefined,
        },
        disabled: myTurn && !pendingAction ? undefined : 'true',
        title: face === 1 ? '⚀ — the golden wild' : `face ${face}`,
        text: FACE_GLYPH[face],
        onClick: () => {
          sel.face = face;
          render();
        },
      });
    });

    const bidBtn = el('button', {
      className: 'btn primary big',
      type: 'button',
      disabled: canBid ? undefined : 'true',
      text: pendingAction?.kind === 'bid' ? '…' : `📣 BID ${sel.count} × ${FACE_GLYPH[sel.face]}`,
      title: canBid || !myTurn ? 'raise the bid' : b ? 'must strictly beat the current bid' : '',
      onClick: sendBid,
    });
    const challengeBtn = el('button', {
      className: 'btn danger big',
      type: 'button',
      disabled: canChallenge ? undefined : 'true',
      text: pendingAction?.kind === 'challenge' ? '…' : '🚨 CHALLENGE!',
      title: b ? 'call the bid a lie — shells up!' : 'no bid to challenge yet',
      onClick: sendChallenge,
    });

    return el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center' } }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } }, [
        el('span', { className: 'faint', style: { fontSize: '11px' }, text: 'COUNT' }),
        stepBtn(-1, '−'),
        el('b', { style: { minWidth: '26px', textAlign: 'center', fontSize: '18px' }, text: `${sel.count}` }),
        stepBtn(+1, '+'),
        el('span', { className: 'faint', style: { fontSize: '11px', marginLeft: '8px' }, text: 'FACE' }),
        ...faceBtns,
      ]),
      el('div', { className: 'hand-actions' }, [
        myTurn
          ? el('span', { className: 'badge host', style: { fontSize: '12px', padding: '5px 10px' }, text: '★ YOUR TURN' })
          : el('span', { className: 'faint', style: { fontSize: '12px' }, text: 'waiting for your turn…' }),
        bidBtn,
        challengeBtn,
        myTurn
          ? el('span', { className: 'turn-secs', style: { fontWeight: '800', color: 'var(--banana)', minWidth: '34px' } })
          : null,
      ]),
    ]);
  }

  function render() {
    renderBidBanner();
    const s = snap();
    clear(dock);
    if (!s || s.phase === 'matchEnd') {
      dock.style.display = 'none';
      return;
    }
    if (s.yourSeat == null) {
      dock.style.display = 'none'; // spectators watch the banners + 3D
      return;
    }
    dock.style.display = '';

    const mySeat = s.seats?.find((x) => x.seat === s.yourSeat);
    if (mySeat && !mySeat.alive) {
      dock.append(
        el('div', {
          className: 'last-play-tag',
          style: { position: 'static' },
          text: '👻 Out of dice, out of luck. Heckle from the beyond.',
        })
      );
      return;
    }

    const dice = myDiceView() ?? [];
    dock.append(
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', justifyContent: 'center' } }, [
        shellPeek(dice),
        el('div', { className: 'faint', style: { fontSize: '11px', maxWidth: '150px' } }, [
          el('div', { text: `your dice: ${dice.length}` }),
          el('div', { text: `table total: ${totalDiceView()} — ⚀ is wild` }),
        ]),
      ]),
      picker(s)
    );
  }

  // ---------------------------------------------------------------------
  // Penalty overlay (§4.2 shapes): 0 dice → the Coconut Cannon decides
  // ---------------------------------------------------------------------
  function renderPenalty() {
    clear(penaltyLayer);
    const pen = store.get('penaltyInfo');
    const s = snap();
    if (!pen || !s) return;

    const seat = s.seats?.find((x) => x.seat === pen.seat);
    const mine = s.yourSeat != null && pen.seat === s.yourSeat;

    if (!mine) {
      penaltyLayer.append(
        el('div', { className: 'penalty-watch' }, [
          el('div', { text: `🎯 ${shortName(seat?.name ?? 'Monkey', 14)} ran out of dice — the cannon locks on…` }),
          el('div', {
            className: 'faint',
            style: { fontSize: '11px', marginTop: '4px' },
            text: 'survive → the bar spots them one die',
          }),
        ])
      );
      return;
    }

    const chambers = pen.chambers ?? START_CHAMBERS;
    const coconuts = pen.coconuts ?? 1;
    const oddsPct = Math.round((coconuts / Math.max(1, chambers)) * 100);
    const canChip = !!pen.chipUsable && !s.chipUsedByYou && !pendingAction;

    const pips = el(
      'div',
      { className: 'penalty-chambers' },
      Array.from({ length: chambers }, (_, i) =>
        el('i', { className: i < coconuts ? 'coconut' : pen.bonus && i >= chambers - 2 ? 'bonus' : '' })
      )
    );

    const chipBtn = el('button', {
      className: 'btn primary big',
      type: 'button',
      disabled: canChip ? undefined : 'true',
      text: pendingAction?.kind === 'chip' ? '…' : '🍀 USE LUCKY BANANA CHIP (+2 chambers)',
      onClick: () => {
        if (!canChip) return;
        const aid = socket.nextAid();
        trackAction({ aid, kind: 'chip' });
        socket.send(MSG.USE_CHIP, { aid });
        renderPenalty();
      },
    });

    penaltyLayer.append(
      el('div', { className: 'penalty-veil' }, [
        el('div', { className: 'penalty-box panel' }, [
          el('div', { className: 'cannon-art', text: '🎲🥥💣' }),
          el('div', { className: 'p-title', text: 'Out of dice — you face the cannon' }),
          el('div', { className: 'p-odds' }, [
            el('span', { text: 'Hit chance: ' }),
            el('b', { text: `${coconuts} / ${chambers} (${oddsPct}%)` }),
          ]),
          pips,
          el('div', { className: 'fuse-bar' }, [el('i')]),
          chipBtn,
          el('div', {
            className: 'faint',
            style: { fontSize: '12px', marginTop: '10px' },
            text: pen.chipUsable
              ? 'One chip per match. Survive and the bar spots you a die.'
              : 'No chip left. Survive and the bar spots you a die.',
          }),
        ]),
      ])
    );
  }

  // ---------------------------------------------------------------------
  // Module contract (see ui/modes/index.js)
  // ---------------------------------------------------------------------
  return {
    el: root,
    seatStats,
    /** Banana Dice's only active-turn phase (§10.3). */
    isTurnPhase: (s) => s.phase === 'playing',
    render,
    onTurnInfo() {
      // a new turn means any stale pending action can be dropped
      pendingAction = null;
    },
    tick() {
      const turnInfo = store.get('turnInfo');
      const s = snap();
      if (turnInfo && s && s.phase === 'playing') {
        const secsEl = dock.querySelector('.turn-secs');
        if (secsEl) secsEl.textContent = `${Math.ceil(Math.max(0, turnInfo.deadline - Date.now()) / 1000)}s`;
      }
      const pen = store.get('penaltyInfo');
      if (pen) {
        const fuse = penaltyLayer.querySelector('.fuse-bar i');
        if (fuse) {
          const total = Math.max(1, pen.deadline - pen.ts);
          const remaining = Math.max(0, pen.deadline - Date.now());
          fuse.style.transform = `scaleX(${Math.min(1, remaining / total)})`;
        }
      }
    },
    onShow() {
      visible = true;
      pendingAction = null;
      peeking = false;
      resetDerived();
      render();
      renderPenalty();
    },
    onHide() {
      visible = false;
      if (revealTimer) clearTimeout(revealTimer);
      revealBanner.style.display = 'none';
    },
    dispose() {
      visible = false;
      if (revealTimer) clearTimeout(revealTimer);
      for (const off of subs) off();
      subs.length = 0;
    },
  };
}

export default createBananaDiceHud;
