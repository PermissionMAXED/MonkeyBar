// Monkey Lies mode HUD module (R3) — the ML in-game controls, extracted
// VERBATIM from the pre-R3 ui/hud.js so Monkey Lies stays pixel-and-behavior
// identical: clickable hand fan (multi-select, stock band 1–3, wrapper HUDs
// may reshape it via caps.getPlayLimits) + PLAY, the giant
// "MONKEY LIES!" call button + last-play tag, the penalty overlay (chip +
// fuse), the persistent Last-Monkey-Holding banner, FACE THE CANNON, and the
// per-seat stats row (cards / chamber pips / Lucky Banana Chip).
// Sends play/callLiar/useChip/fireCannon with generated `aid`; reflects
// actionAck. The shared shell (chat dock, leave button, seat plates, turn
// countdown, transient banners) lives in ui/hud.js — the module contract is
// documented in ui/modes/index.js.

import { MSG } from '@shared/protocol.js';
import { MAX_PLAY, MIN_PLAY, START_CHAMBERS } from '@shared/constants.js';
import { getMonkey } from '@shared/monkeys.js';
import { el, clear, FRUIT_META, shortName } from '../dom.js';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @param {{getPlayLimits?: () => {minPlay: number, maxPlay: number}}} [caps]
 *   optional capabilities supplied by wrapper HUDs (King of the Bar / Custom
 *   Chaos): `getPlayLimits` reshapes the play band — the card-selection cap,
 *   the PLAY button gate and the helper copy all derive from it, re-read on
 *   EVERY render (limits can change per round). Default: {minPlay:1, maxPlay:3}.
 * @returns {import('./index.js').ModeHud}
 */
export function createMonkeyLiesHud(ctx, caps = {}) {
  const { store, socket, toast } = ctx;

  // ---------------------------------------------------------------------
  // Layers (mounted into the hud.js shell, positioned against .hud)
  // ---------------------------------------------------------------------
  const handDock = el('div', { className: 'hand-dock', style: { display: 'none' } });
  const callBtn = el('button', {
    className: 'call-btn',
    type: 'button',
    text: '🐒 MONKEY LIES!',
    style: { display: 'none' },
    onClick: onCallLiar,
  });
  const lastPlayTag = el('div', { className: 'last-play-tag', style: { display: 'none' } });
  const penaltyLayer = el('div', {});
  // Persistent Last-Monkey-Holding warning (C1) — stays up for the whole
  // last-holder turn, unlike the transient bannerLayer banners.
  const lastHolderBanner = el('div', {
    className: 'last-play-tag',
    style: {
      display: 'none',
      right: 'auto',
      bottom: 'auto',
      left: '50%',
      top: '64px',
      transform: 'translateX(-50%)',
      maxWidth: 'min(440px, 86vw)',
      textAlign: 'center',
      color: 'var(--danger)',
      borderColor: 'rgba(255, 77, 94, 0.6)',
      boxShadow: '0 0 26px rgba(255, 77, 94, 0.35)',
      zIndex: '18',
    },
    text: '🃏 LAST MONKEY HOLDING — call the last play, or the cannon turns on YOU.',
  });

  const root = el('div', { className: 'mode-hud' }, [
    lastHolderBanner,
    lastPlayTag,
    callBtn,
    handDock,
    penaltyLayer,
  ]);

  // ---------------------------------------------------------------------
  // Local UI state
  // ---------------------------------------------------------------------
  /** @type {Set<string>} */
  let selectedIds = new Set();
  /** @type {{aid: string, kind: 'play'|'call'|'chip'|'fire', cardIds?: string[]}|null} */
  let pendingAction = null;
  /** P6 glue: aid → action for ack resolution. The real server broadcasts
   *  `played`/`turn` BEFORE the `actionAck`, so pendingAction is already
   *  cleared by the turnInfo handler when the ack lands — resolve by aid. */
  const sentActions = new Map();
  function trackAction(action) {
    pendingAction = action;
    sentActions.set(action.aid, action);
    if (sentActions.size > 8) sentActions.delete(sentActions.keys().next().value);
  }
  let visible = false;
  /** @type {(() => void)[]} store unsubscribers (cleared on dispose) */
  const subs = [];

  const snap = () => store.get('snapshot');
  const isMyTurn = () => {
    const s = snap();
    return !!s && s.yourSeat != null && s.turnSeat === s.yourSeat && s.phase === 'playing';
  };
  /** C1: my turn is a pending Last-Monkey-Holding turn (no plays — call or fire). */
  const isMyLastHolderTurn = () => isMyTurn() && !!store.get('turnInfo')?.lastHolder;

  /** This round's play band — re-read on every render (wrapper HUDs can move
   *  it per round: Happy Hour minPlay 2, Chaos maxPlay 1–4). Sanitized so a
   *  buggy/absent capability degrades to the stock 1–3 band. */
  function playLimits() {
    const lim = caps.getPlayLimits?.();
    const minPlay = Number.isFinite(lim?.minPlay) ? Math.max(1, lim.minPlay) : MIN_PLAY;
    const maxPlay = Number.isFinite(lim?.maxPlay) ? Math.max(minPlay, lim.maxPlay) : MAX_PLAY;
    return { minPlay, maxPlay };
  }

  // ---------------------------------------------------------------------
  // Per-seat stats row (rendered inside the shell's seat plates)
  // ---------------------------------------------------------------------
  function seatStats(seat) {
    const pips = el(
      'div',
      { className: 'chamber-pips', title: `${seat.chambersLeft} chambers left` },
      Array.from({ length: START_CHAMBERS }, (_, i) =>
        el('i', { className: i < (seat.chambersLeft ?? 0) ? 'full' : '' })
      )
    );
    return [
      el('span', { className: 'sp-cards', text: `🂠 ${seat.handCount}` }),
      pips,
      el('span', {
        className: `sp-chip ${seat.chips > 0 ? '' : 'spent'}`,
        title: 'Lucky Banana Chip',
        text: `🍀${seat.chips}`,
      }),
    ];
  }

  // ---------------------------------------------------------------------
  // Countdown tick (turn seconds + penalty fuse) — driven by the shell's rAF
  // ---------------------------------------------------------------------
  function tick() {
    const turnInfo = store.get('turnInfo');
    const s = snap();
    if (turnInfo && s && s.phase === 'playing') {
      const remaining = Math.max(0, turnInfo.deadline - Date.now());
      const secsEl = handDock.querySelector('.turn-secs');
      if (secsEl) secsEl.textContent = `${Math.ceil(remaining / 1000)}s`;
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
  }

  // ---------------------------------------------------------------------
  // Your hand + PLAY
  // ---------------------------------------------------------------------
  function renderHand() {
    const s = snap();
    if (!s || s.yourSeat == null) {
      handDock.style.display = 'none';
      return;
    }
    const mySeat = s.seats?.find((x) => x.seat === s.yourSeat);
    const hand = s.yourHand ?? [];
    handDock.style.display = '';
    clear(handDock);

    if (mySeat && !mySeat.alive) {
      handDock.append(
        el('div', {
          className: 'last-play-tag',
          style: { position: 'static' },
          text: '👻 You are a bar ghost — heckle from the beyond.',
        })
      );
      return;
    }

    const myTurn = isMyTurn();
    const lastHolder = isMyLastHolderTurn();
    // Last Monkey Holding: playing cards is no longer possible — the hand is
    // frozen, and the PLAY button becomes FACE THE CANNON (call stays live).
    const canInteract = myTurn && !pendingAction && !lastHolder;
    const { minPlay, maxPlay } = playLimits();
    // Happy Hour clause (mirrors the server): a hand holding fewer than
    // minPlay may still shed what it has (never below 1 card).
    const effMin = Math.max(1, Math.min(minPlay, hand.length));

    // prune selections that no longer exist in hand
    selectedIds = new Set([...selectedIds].filter((id) => hand.some((c) => c.id === id)));

    const row = el(
      'div',
      { className: 'hand-row' },
      hand.map((card) => {
        const meta = FRUIT_META[card.fruit] ?? { glyph: '❓', label: '?', color: '#fff' };
        return el(
          'div',
          {
            className: `hand-card ${card.fruit === 'golden' ? 'golden' : ''} ${
              selectedIds.has(card.id) ? 'selected' : ''
            } ${canInteract ? '' : 'disabled'}`,
            onClick: () => {
              if (!canInteract) return;
              if (selectedIds.has(card.id)) selectedIds.delete(card.id);
              else if (selectedIds.size < maxPlay) selectedIds.add(card.id);
              renderHand();
            },
          },
          [
            el('div', { className: 'hc-glyph', text: meta.glyph }),
            el('div', { className: 'hc-label', text: meta.label, style: { color: meta.color } }),
          ]
        );
      })
    );

    const count = selectedIds.size;
    const playBtn = lastHolder
      ? el('button', {
          className: 'btn danger big play-btn',
          type: 'button',
          disabled: pendingAction ? 'true' : undefined,
          text: pendingAction?.kind === 'fire' ? '…' : '🔥 FACE THE CANNON',
          onClick: onFireCannon,
        })
      : el('button', {
          className: 'btn primary play-btn',
          type: 'button',
          disabled: canInteract && count >= effMin && count <= maxPlay ? undefined : 'true',
          text: pendingAction?.kind === 'play'
            ? '…'
            : count > 0
              ? `PLAY ${count} CARD${count > 1 ? 'S' : ''} 🍌`
              : effMin === maxPlay
                ? `PLAY (pick ${maxPlay})`
                : `PLAY (pick ${effMin}–${maxPlay})`,
          onClick: onPlay,
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

    handDock.append(row, el('div', { className: 'hand-actions' }, [turnTag, playBtn, myTurn ? secs : null]));
  }

  function onPlay() {
    const s = snap();
    if (!isMyTurn() || pendingAction || isMyLastHolderTurn()) return;
    const cardIds = [...selectedIds];
    const { minPlay, maxPlay } = playLimits();
    const effMin = Math.max(1, Math.min(minPlay, (s?.yourHand ?? []).length));
    if (cardIds.length < effMin || cardIds.length > maxPlay) return;
    const aid = socket.nextAid();
    trackAction({ aid, kind: 'play', cardIds });
    socket.send(MSG.PLAY, { aid, cardIds });
    renderHand();
    renderCall();
    void s;
  }

  // C1: Last Monkey Holding — fire the cannon at yourself instead of waiting
  // out the turn timer (§3.2 fireCannon; resolved via the normal actionAck).
  function onFireCannon() {
    if (!isMyLastHolderTurn() || pendingAction) return;
    const aid = socket.nextAid();
    trackAction({ aid, kind: 'fire' });
    socket.send(MSG.FIRE_CANNON, { aid });
    renderHand();
    renderCall();
  }

  // ---------------------------------------------------------------------
  // Call button + last-play tag
  // ---------------------------------------------------------------------
  function renderCall() {
    const s = snap();
    const turnInfo = store.get('turnInfo');
    const canCall =
      isMyTurn() && !!turnInfo?.canCall && !!s?.lastPlay && !pendingAction;
    callBtn.style.display = canCall ? '' : 'none';

    if (s?.lastPlay && s.phase === 'playing') {
      const who = s.seats?.find((x) => x.seat === s.lastPlay.seat);
      const meta = FRUIT_META[s.tableFruit] ?? { label: '?' };
      lastPlayTag.style.display = '';
      clear(lastPlayTag);
      lastPlayTag.append(
        el('span', { text: `${shortName(who?.name ?? 'Monkey', 12)} claims ` }),
        el('b', { text: `${s.lastPlay.count} × ${meta.label}` }),
        el('span', { text: ' …believe it?' })
      );
    } else {
      lastPlayTag.style.display = 'none';
    }
  }

  function onCallLiar() {
    if (pendingAction) return;
    const aid = socket.nextAid();
    trackAction({ aid, kind: 'call' });
    socket.send(MSG.CALL_LIAR, { aid });
    renderCall();
    renderHand();
  }

  // ---------------------------------------------------------------------
  // actionAck (§3.3) — resolve pending actions
  // ---------------------------------------------------------------------
  subs.push(
    store.on('actionAck', (ack) => {
      if (!ack) return;
      const action = sentActions.get(ack.aid) ?? null;
      if (!action) return;
      sentActions.delete(ack.aid);
      if (pendingAction?.aid === ack.aid) pendingAction = null;
      if (ack.ok) {
        if (action.kind === 'play') {
          const s = snap();
          if (s?.yourHand) {
            const remaining = s.yourHand.filter((c) => !action.cardIds.includes(c.id));
            store.set('snapshot', { ...s, yourHand: remaining });
          }
          selectedIds.clear();
        }
      } else {
        toast(`Action rejected: ${ack.code ?? 'unknown'}`, 'error');
      }
      renderHand();
      renderCall();
      renderPenalty();
    })
  );

  // ---------------------------------------------------------------------
  // Penalty overlay (§4.2): 5 s window, chip = +2 temp chambers
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
          el('div', { text: `🎯 The cannon locks onto ${shortName(seat?.name ?? 'Monkey', 14)}…` }),
          el('div', { className: 'faint', style: { fontSize: '11px', marginTop: '4px' }, text: 'drumroll…' }),
        ])
      );
      return;
    }

    const chambers = pen.chambers ?? START_CHAMBERS;
    const coconuts = pen.coconuts ?? 1;
    // Professor Peel "Calculated" (§6, cosmetic): HE sees his odds to a decimal.
    const calculated = getMonkey(seat?.monkeyId)?.passive?.id === 'calculated';
    const oddsRaw = (coconuts / Math.max(1, chambers)) * 100;
    const oddsPct = calculated ? oddsRaw.toFixed(1) : Math.round(oddsRaw);
    const canChip = !!pen.chipUsable && !s.chipUsedByYou && !pendingAction;

    const pips = el(
      'div',
      { className: 'penalty-chambers' },
      Array.from({ length: chambers }, (_, i) =>
        el('i', {
          className: i < coconuts ? 'coconut' : pen.bonus && i >= chambers - 2 ? 'bonus' : '',
        })
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
          el('div', { className: 'cannon-art', text: '🥥💣' }),
          el('div', { className: 'p-title', text: 'You face the cannon' }),
          el('div', { className: 'p-odds' }, [
            el('span', { text: calculated ? '🧮 Calculated hit chance: ' : 'Hit chance: ' }),
            el('b', { text: `${coconuts} / ${chambers} (${oddsPct}%)` }),
          ]),
          pips,
          el('div', { className: 'fuse-bar' }, [el('i')]),
          chipBtn,
          el('div', {
            className: 'faint',
            style: { fontSize: '12px', marginTop: '10px' },
            text: pen.chipUsable
              ? 'One chip per match. Spend it or trust your luck.'
              : 'No chip left. Trust your luck, monkey.',
          }),
        ]),
      ])
    );
  }

  subs.push(
    store.on('penaltyInfo', () => {
      if (visible) renderPenalty();
    })
  );

  // ---------------------------------------------------------------------
  // Module contract (see ui/modes/index.js)
  // ---------------------------------------------------------------------
  return {
    el: root,
    seatStats,
    /** ML "active turn" phase — the shell's turn ring/countdown use this. */
    isTurnPhase: (s) => s.phase === 'playing',
    render() {
      renderHand();
      renderCall();
      lastHolderBanner.style.display = isMyLastHolderTurn() ? '' : 'none';
    },
    onTurnInfo() {
      // a new turn means any stale pending action can be dropped
      if (pendingAction) pendingAction = null;
    },
    tick,
    onShow() {
      visible = true;
      selectedIds.clear();
      pendingAction = null;
      renderPenalty();
    },
    onHide() {
      visible = false;
    },
    dispose() {
      visible = false;
      for (const off of subs) off();
      subs.length = 0;
    },
  };
}
