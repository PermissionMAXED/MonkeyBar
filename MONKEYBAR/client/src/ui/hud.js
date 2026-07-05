// In-game HUD (P5) — pure DOM rendering from store.snapshot + game events.
// Table-fruit banner, per-seat plates (portrait, handCount, chips, chamber
// pips, alive/ghost, connected) with a countdown driven by `deadline`, your
// clickable hand (multi-select 1–3) + PLAY, the giant "MONKEY LIES!" call
// button, penalty overlay (chip + fuse), phase/reveal banners, chat dock.
// Sends play/callLiar/useChip/fireCannon with generated `aid`; reflects actionAck.
// 3D choreography is P6's job (game/gameClient.js) — none of that here.

import { MSG } from '@shared/protocol.js';
import { MAX_PLAY, MIN_PLAY, START_CHAMBERS } from '@shared/constants.js';
import { getMonkey } from '@shared/monkeys.js';
import { el, clear, FRUIT_META, shortName } from './dom.js';
import { portraitCanvas } from './portraits.js';
import { createChatPanel } from './chat.js';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void, onHide: () => void}}
 */
export function createHud(ctx) {
  const { store, socket, toast } = ctx;

  // ---------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------
  const tfBanner = el('div', { className: 'tf-banner', style: { display: 'none' } });
  const seatLayer = el('div', { className: 'seat-layer' });
  const handDock = el('div', { className: 'hand-dock', style: { display: 'none' } });
  const callBtn = el('button', {
    className: 'call-btn',
    type: 'button',
    text: '🐒 MONKEY LIES!',
    style: { display: 'none' },
    onClick: onCallLiar,
  });
  const lastPlayTag = el('div', { className: 'last-play-tag', style: { display: 'none' } });
  const bannerLayer = el('div', { className: 'banner-layer' });
  const penaltyLayer = el('div', {});
  const chat = createChatPanel(ctx, { compact: true });
  const chatDock = el('div', { className: 'chat-dock' }, [chat.el]);
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
  // Small always-visible escape hatch (C2): leave the table / stop spectating.
  const leaveBtn = el('button', {
    className: 'btn ghost small',
    type: 'button',
    text: '🚪 Leave table',
    title: 'Leave the table and return to the room browser',
    style: {
      position: 'absolute',
      top: '14px',
      left: '16px',
      zIndex: '30',
      pointerEvents: 'auto',
      background: 'rgba(8, 14, 7, 0.75)',
    },
    onClick: onLeave,
  });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'hud' }, [
      seatLayer,
      tfBanner,
      lastHolderBanner,
      lastPlayTag,
      callBtn,
      handDock,
      chatDock,
      leaveBtn,
      bannerLayer,
      penaltyLayer,
    ]),
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
  let rafId = 0;
  /** @type {Map<number, {plate: HTMLElement, bar: HTMLElement|null}>} */
  const plateBySeat = new Map();

  const snap = () => store.get('snapshot');
  const isMyTurn = () => {
    const s = snap();
    return !!s && s.yourSeat != null && s.turnSeat === s.yourSeat && s.phase === 'playing';
  };
  /** C1: my turn is a pending Last-Monkey-Holding turn (no plays — call or fire). */
  const isMyLastHolderTurn = () => isMyTurn() && !!store.get('turnInfo')?.lastHolder;

  // C2: leave the table (players) / stop spectating (spectators). The server
  // replies leftRoom, which screens.js routes back to the lobby browser.
  function onLeave() {
    if (snap()?.yourSeat == null) socket.send(MSG.STOP_SPECTATE, {});
    else socket.send(MSG.LEAVE_ROOM, {});
  }

  // ---------------------------------------------------------------------
  // Table-fruit banner
  // ---------------------------------------------------------------------
  function renderTableFruit() {
    const s = snap();
    if (!s || !s.tableFruit) {
      tfBanner.style.display = 'none';
      return;
    }
    const meta = FRUIT_META[s.tableFruit] ?? { glyph: '❓', label: s.tableFruit, color: '#fff' };
    tfBanner.style.display = '';
    clear(tfBanner);
    tfBanner.append(
      el('span', { className: 'tf-label', text: 'table fruit' }),
      el('span', {
        className: 'tf-fruit',
        text: `${meta.glyph} ${meta.label}`,
        style: { color: meta.color, textShadow: `0 0 18px ${meta.color}` },
      }),
      el('span', { className: 'tf-round', text: `round ${s.roundNo ?? '—'}` })
    );
  }

  // ---------------------------------------------------------------------
  // Seat plates (arranged on an ellipse, you at the bottom)
  // ---------------------------------------------------------------------
  function seatPosition(offset, count) {
    const t = count > 0 ? offset / count : 0;
    const rad = (Math.PI / 180) * (90 + t * 360);
    return { x: 50 + 42 * Math.cos(rad), y: 40 + 28 * Math.sin(rad) };
  }

  function renderSeats() {
    const s = snap();
    clear(seatLayer);
    plateBySeat.clear();
    if (!s?.seats?.length) return;

    const roster = store.get('catalogs').roster;
    const anchor = s.yourSeat ?? s.seats[0].seat;
    const orderedSeatNos = s.seats.map((x) => x.seat).sort((a, b) => a - b);
    const anchorIdx = Math.max(0, orderedSeatNos.indexOf(anchor));
    const n = orderedSeatNos.length;

    for (const seat of s.seats) {
      const idx = orderedSeatNos.indexOf(seat.seat);
      const offset = (idx - anchorIdx + n) % n;
      const { x, y } = seatPosition(offset, n);
      const monkey = roster.find((m) => m.id === seat.monkeyId);
      const isMe = s.yourSeat != null && seat.seat === s.yourSeat;
      const isTurn = s.turnSeat === seat.seat && s.phase === 'playing' && seat.alive;

      const pips = el(
        'div',
        { className: 'chamber-pips', title: `${seat.chambersLeft} chambers left` },
        Array.from({ length: START_CHAMBERS }, (_, i) =>
          el('i', { className: i < (seat.chambersLeft ?? 0) ? 'full' : '' })
        )
      );

      const countdownBar = isTurn
        ? el('div', { className: 'turn-countdown' }, [el('i')])
        : null;

      const plate = el(
        'div',
        {
          className: `seat-plate ${isTurn ? 'turn' : ''} ${isMe ? 'me' : ''} ${seat.alive ? '' : 'dead'}`,
          style: { left: `${x}%`, top: `${y}%` },
          dataset: { seat: String(seat.seat) },
        },
        [
          seat.alive ? null : el('div', { className: 'ghost-tag', text: '👻 ghost' }),
          el('div', { className: 'sp-top' }, [
            el('div', { className: 'sp-portrait-wrap' }, [
              el('div', { className: 'turn-ring', style: { border: '2px solid var(--banana)' } }),
              portraitCanvas(monkey, 44, !seat.alive),
            ]),
            el('div', { style: { minWidth: '0', flex: '1' } }, [
              el('div', { className: 'sp-name' }, [
                el('span', { text: shortName(seat.name, 11) }),
                seat.isBot ? el('span', { title: 'bot', text: '🤖' }) : null,
                seat.connected ? null : el('span', { className: 'off', text: '⚠ offline' }),
              ]),
              el('div', {
                className: 'm-sub faint',
                style: { fontSize: '10px' },
                text: isMe ? 'you' : monkey?.name ?? '',
              }),
            ]),
          ]),
          el('div', { className: 'sp-stats' }, [
            el('span', { className: 'sp-cards', text: `🂠 ${seat.handCount}` }),
            pips,
            el('span', {
              className: `sp-chip ${seat.chips > 0 ? '' : 'spent'}`,
              title: 'Lucky Banana Chip',
              text: `🍀${seat.chips}`,
            }),
          ]),
          countdownBar,
        ]
      );
      seatLayer.append(plate);
      plateBySeat.set(seat.seat, { plate, bar: countdownBar?.querySelector('i') ?? null });
    }
  }

  // ---------------------------------------------------------------------
  // Countdown loop (turn deadline + penalty fuse), driven by rAF
  // ---------------------------------------------------------------------
  function tick() {
    if (!visible) return;
    const turnInfo = store.get('turnInfo');
    const s = snap();
    if (turnInfo && s && s.phase === 'playing') {
      const total = Math.max(1, turnInfo.deadline - turnInfo.ts);
      const remaining = Math.max(0, turnInfo.deadline - Date.now());
      const frac = Math.min(1, remaining / total);
      const entry = plateBySeat.get(turnInfo.seat);
      if (entry?.bar) entry.bar.style.transform = `scaleX(${frac})`;
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
    rafId = requestAnimationFrame(tick);
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
              else if (selectedIds.size < MAX_PLAY) selectedIds.add(card.id);
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
          disabled: canInteract && count >= MIN_PLAY && count <= MAX_PLAY ? undefined : 'true',
          text: pendingAction?.kind === 'play'
            ? '…'
            : count > 0
              ? `PLAY ${count} CARD${count > 1 ? 'S' : ''} 🍌`
              : 'PLAY (pick 1–3)',
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
    if (cardIds.length < MIN_PLAY || cardIds.length > MAX_PLAY) return;
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
  });

  // ---------------------------------------------------------------------
  // Phase / event banners
  // ---------------------------------------------------------------------
  let bannerTimer = null;

  function showBanner(node, ms = 2400) {
    clear(bannerLayer);
    bannerLayer.append(node);
    if (bannerTimer) clearTimeout(bannerTimer);
    if (ms > 0) {
      bannerTimer = setTimeout(() => clear(bannerLayer), ms);
    }
  }

  store.on('roundBanner', (b) => {
    if (!b || !visible) return;
    const meta = FRUIT_META[b.tableFruit] ?? { glyph: '❓', label: '?' };
    showBanner(
      el('div', { className: 'phase-banner' }, [
        el('span', { text: `Round ${b.roundNo}` }),
        el('span', { className: 'sub', text: `Table fruit: ${meta.glyph} ${meta.label} — shed your hand, lie well.` }),
      ]),
      2600
    );
  });

  // P6 glue: fxReveal is published by game/gameClient.js when the 3D flip
  // actually plays (the raw revealInfo store key lands ahead of choreography).
  store.on('fxReveal', (r) => {
    if (!r || !visible) return;
    const s = snap();
    const target = s?.seats?.find((x) => x.seat === r.targetSeat);
    const loser = s?.seats?.find((x) => x.seat === r.loserSeat);
    showBanner(
      el('div', { className: `phase-banner ${r.lie ? 'lie' : 'truth'}` }, [
        el('span', { text: r.lie ? '🚨 MONKEY LIED!' : '😇 THE TRUTH!' }),
        el(
          'div',
          { className: 'reveal-cards' },
          (r.cards ?? []).map((c) =>
            el('div', { className: 'mini-card', text: FRUIT_META[c.fruit]?.glyph ?? '❓' })
          )
        ),
        el('span', {
          className: 'sub',
          text: `${shortName(target?.name ?? 'Monkey', 14)}'s cards are flipped — ${shortName(
            loser?.name ?? 'Monkey',
            14
          )} faces the Coconut Cannon.`,
        }),
      ]),
      3400
    );
  });

  store.on('lastHolderInfo', (info) => {
    if (!info || !visible) return;
    const s = snap();
    const seat = s?.seats?.find((x) => x.seat === info.seat);
    showBanner(
      el('div', { className: 'phase-banner lie' }, [
        el('span', { text: '🃏 LAST MONKEY HOLDING' }),
        el('span', {
          className: 'sub',
          text: `${shortName(seat?.name ?? 'Monkey', 14)} never emptied their hand. House rules: fire the cannon at yourself.`,
        }),
      ]),
      3000
    );
  });

  // P6 glue: fxCannon fires at the THOOM/click inside the cannon sequence —
  // never before the drumroll resolves (no spoilers).
  store.on('fxCannon', (c) => {
    if (!c || !visible) return;
    const s = snap();
    const seat = s?.seats?.find((x) => x.seat === c.seat);
    showBanner(
      el('div', { className: `phase-banner ${c.hit ? 'lie' : 'truth'}` }, [
        el('span', { text: c.hit ? '💥 THOOM!' : '😮‍💨 *click*' }),
        el('span', {
          className: 'sub',
          text: c.hit
            ? `${shortName(seat?.name ?? 'Monkey', 14)} takes a coconut to the face. KO!`
            : `${shortName(seat?.name ?? 'Monkey', 14)} survives — one empty chamber gone forever.`,
        }),
      ]),
      2800
    );
  });

  // P6 glue: fxRoundEnd carries the *remaining* intermission (queue-adjusted).
  store.on('fxRoundEnd', (info) => {
    if (!info || !visible) return;
    showBanner(
      el('div', { className: 'phase-banner' }, [
        el('span', { text: '🍹 Round over' }),
        el('span', {
          className: 'sub',
          text: `Reshuffling… next round in ${Math.ceil((info.nextIn ?? 5000) / 1000)}s.`,
        }),
      ]),
      Math.min(info.nextIn ?? 5000, 5000)
    );
  });

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

  store.on('penaltyInfo', () => {
    if (visible) renderPenalty();
  });

  // ---------------------------------------------------------------------
  // Emote bubbles over seat plates
  // ---------------------------------------------------------------------
  store.on('emoteEvent', (ev) => {
    if (!ev || !visible) return;
    const entry = plateBySeat.get(ev.seat);
    if (!entry) return;
    const rect = entry.plate.getBoundingClientRect();
    const host = screen.querySelector('.hud');
    const hostRect = host.getBoundingClientRect();
    const bubble = el('div', {
      className: 'emote-bubble',
      text: ev.glyph,
      style: {
        left: `${rect.left + rect.width / 2 - hostRect.left}px`,
        top: `${rect.top - hostRect.top}px`,
      },
    });
    host.appendChild(bubble);
    setTimeout(() => bubble.remove(), 2300);
  });

  // ---------------------------------------------------------------------
  // Master render on snapshot / turn changes
  // ---------------------------------------------------------------------
  function renderAll() {
    if (!visible) return;
    renderTableFruit();
    renderSeats();
    renderHand();
    renderCall();
    lastHolderBanner.style.display = isMyLastHolderTurn() ? '' : 'none';
  }

  store.on('snapshot', () => renderAll());
  store.on('turnInfo', () => {
    if (!visible) return;
    // a new turn means any stale pending action can be dropped
    if (pendingAction) pendingAction = null;
    renderAll();
  });

  return {
    el: screen,
    onShow() {
      visible = true;
      selectedIds.clear();
      pendingAction = null;
      renderAll();
      renderPenalty();
      chat.onShow?.();
      rafId = requestAnimationFrame(tick);
    },
    onHide() {
      visible = false;
      cancelAnimationFrame(rafId);
      if (bannerTimer) clearTimeout(bannerTimer);
      clear(bannerLayer);
      chat.onHide?.();
    },
  };
}
