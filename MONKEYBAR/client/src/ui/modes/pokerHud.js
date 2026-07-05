// Jungle Poker mode HUD (R6) — the poker controls layer mounted by the
// ui/hud.js shell: your 3 cards fanned (rank + fruit suit), the pot / to-call
// readout, FOLD / CHECK–CALL / RAISE(amount stepper) controls, per-seat
// stack/bet/folded plate stats, the bust-cannon penalty overlay (Lucky Banana
// Chip window, ML §4.2 shapes), and the fx-timed showdown rank-name banner
// (fxPokerShowdown — published by game/modes/poker.js WITH the 3D flips).
//
// State derivation: the shell patches snapshot.phase/turnSeat generically, but
// poker facts (pot, bets, stacks, folds) ride `modeEvent` frames which
// screens.js folds into store.modeData — latest payload per kind, each
// stamped with the engine's monotonic `seq`. The freshest of snapshot /
// pokerAnte / pokerAction / pokerShowdown wins (a reconnect snapshot always
// carries the highest seq at adoption time). yourCards is owner-only by
// construction (§B.3): spectators and other seats never receive it.

import { MSG } from '@shared/protocol.js';
import { POKER_MAX_RAISES, START_CHAMBERS } from '@shared/constants.js';
import { POKER_ACTIONS, POKER_EVENTS } from '@shared/modeEvents.js';
import { getMonkey } from '@shared/monkeys.js';
import { el, clear, FRUIT_META, shortName } from '../dom.js';

const RAISE_MIN = 1;
const RAISE_MAX = 3;
/** '2'…'10', J, Q, K, A. */
const rankLabel = (rank) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[rank] ?? String(rank));

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {import('./index.js').ModeHud}
 */
export function createPokerHud(ctx) {
  const { store, socket, toast } = ctx;

  // ---------------------------------------------------------------------
  // Layers (positioned against .hud via the shell's mode mount)
  // ---------------------------------------------------------------------
  const handDock = el('div', { className: 'hand-dock', style: { display: 'none' } });
  // pot / to-call readout, top-center under the round banner spot
  const potTag = el('div', {
    className: 'last-play-tag',
    style: {
      display: 'none',
      right: 'auto',
      bottom: 'auto',
      left: '50%',
      top: '64px',
      transform: 'translateX(-50%)',
      textAlign: 'center',
      zIndex: '9',
    },
  });
  const penaltyLayer = el('div', {});
  const bannerLayer = el('div', { className: 'banner-layer' });
  const root = el('div', { className: 'mode-hud' }, [potTag, bannerLayer, handDock, penaltyLayer]);

  // ---------------------------------------------------------------------
  // Local UI state
  // ---------------------------------------------------------------------
  let raiseAmount = 1;
  /** @type {{aid: string, kind: 'fold'|'call'|'raise'|'chip'}|null} */
  let pendingAction = null;
  /** aid → action; acks can land after the next turn already cleared pending. */
  const sentActions = new Map();
  function trackAction(action) {
    pendingAction = action;
    sentActions.set(action.aid, action);
    if (sentActions.size > 8) sentActions.delete(sentActions.keys().next().value);
  }
  let visible = false;
  let bannerTimer = null;
  /** @type {(() => void)[]} */
  const subs = [];

  const snap = () => store.get('snapshot');
  const isMyTurn = () => {
    const s = snap();
    return !!s && s.yourSeat != null && s.turnSeat === s.yourSeat && s.phase === 'playing';
  };

  // ---------------------------------------------------------------------
  // Poker state derivation (snapshot vs modeEvent payloads, by seq)
  // ---------------------------------------------------------------------

  /** Freshest {seq, pot, currentBet, raisesUsed, seats[]} view of the table. */
  function pokerState() {
    const s = snap();
    const md = store.get('modeData') ?? {};
    const candidates = [];
    if (s?.mode === 'junglePoker' && Array.isArray(s.seats)) {
      candidates.push({
        seq: s.seq ?? 0,
        pot: s.pot ?? 0,
        currentBet: s.currentBet ?? 0,
        raisesUsed: s.raisesUsed ?? 0,
        seats: s.seats,
      });
    }
    for (const kind of [POKER_EVENTS.ANTE, POKER_EVENTS.ACTION, POKER_EVENTS.SHOWDOWN]) {
      const p = md[kind];
      if (!p?.seats) continue;
      const done = kind === POKER_EVENTS.SHOWDOWN; // pot already swept
      candidates.push({
        seq: p.seq ?? 0,
        pot: done ? 0 : p.pot ?? 0,
        currentBet: done ? 0 : p.currentBet ?? 0,
        raisesUsed: p.raisesUsed ?? 0,
        seats: p.seats,
      });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.seq - b.seq);
    return candidates.at(-1);
  }

  /** My seat's poker view from the freshest state (stack/bet/folded). */
  function mySeatState() {
    const s = snap();
    if (!s || s.yourSeat == null) return null;
    return pokerState()?.seats?.find((x) => x.seat === s.yourSeat) ?? null;
  }

  /** My live hole cards — null once folded, mucked, or the hand resolved. */
  function myCards() {
    const s = snap();
    if (!s || s.yourSeat == null) return null;
    const md = store.get('modeData') ?? {};
    const candidates = [];
    if (s.mode === 'junglePoker') candidates.push({ seq: s.seq ?? 0, cards: s.yourCards ?? null });
    const yc = md[POKER_EVENTS.YOUR_CARDS];
    if (yc) candidates.push({ seq: yc.seq ?? 0, cards: yc.cards ?? null });
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.seq - b.seq);
    const best = candidates.at(-1);
    if (!best.cards?.length) return null;
    // dealt before the last showdown → that hand is over, cards are muck
    const showdownSeq = md[POKER_EVENTS.SHOWDOWN]?.seq ?? 0;
    if (showdownSeq > best.seq) return null;
    if (mySeatState()?.folded) return null; // folded = mucked, even to me
    return best.cards;
  }

  /** Chips I owe to stay in — turn payload when acting, else derived. */
  function myToCall() {
    if (isMyTurn()) {
      const t = store.get('turnInfo');
      if (typeof t?.toCall === 'number') return t.toCall;
    }
    const st = pokerState();
    const me = mySeatState();
    if (!st || !me || me.folded) return 0;
    return Math.max(0, (st.currentBet ?? 0) - (me.bet ?? 0));
  }

  // ---------------------------------------------------------------------
  // Per-seat plate stats: 🍌 stack · bet posted · folded (shell renders these)
  // ---------------------------------------------------------------------
  function seatStats(seat) {
    const info = pokerState()?.seats?.find((x) => x.seat === seat.seat) ?? seat;
    const stack = info.stack ?? 0;
    const bet = info.bet ?? 0;
    const stats = [
      el('span', { className: 'sp-cards', title: 'banana-chip stack', text: `🍌 ${stack}` }),
    ];
    if (info.folded) {
      stats.push(el('span', { style: { color: 'var(--ink-faint)' }, text: '🙈 fold' }));
    } else if (bet > 0) {
      stats.push(el('span', { style: { color: 'var(--neon-cyan)' }, text: `bet ${bet}` }));
    } else if (seat.alive && stack === 0) {
      stats.push(el('span', { style: { color: 'var(--danger)' }, text: 'all-in' }));
    }
    stats.push(
      el('span', {
        className: `sp-chip ${(seat.chips ?? 0) > 0 ? '' : 'spent'}`,
        title: 'Lucky Banana Chip',
        text: `🍀${seat.chips ?? 0}`,
      })
    );
    return stats;
  }

  // ---------------------------------------------------------------------
  // Pot / to-call readout (everyone, spectators included)
  // ---------------------------------------------------------------------
  function renderPot() {
    const s = snap();
    const st = pokerState();
    if (!s || !st || s.phase === 'matchEnd') {
      potTag.style.display = 'none';
      return;
    }
    potTag.style.display = '';
    clear(potTag);
    potTag.append(el('span', { text: 'POT ' }), el('b', { text: `${st.pot} 🍌` }));
    const owe = s.yourSeat != null ? myToCall() : 0;
    if (owe > 0 && !mySeatState()?.folded) {
      potTag.append(el('span', { text: '  ·  to call ' }), el('b', { text: `${owe}` }));
    }
    if ((st.raisesUsed ?? 0) >= POKER_MAX_RAISES && s.phase === 'playing') {
      potTag.append(
        el('span', { className: 'faint', style: { fontSize: '11px' }, text: '  ·  raises capped' })
      );
    }
  }

  // ---------------------------------------------------------------------
  // Your cards + FOLD / CHECK–CALL / RAISE controls
  // ---------------------------------------------------------------------
  function cardNode(card) {
    const meta = FRUIT_META[card.suit] ?? { glyph: '❓', label: '?', color: '#fff' };
    return el(
      'div',
      { className: `hand-card disabled ${card.suit === 'golden' ? 'golden' : ''}`, style: { cursor: 'default' } },
      [
        el('div', {
          className: 'hc-glyph',
          style: { fontSize: '26px', fontWeight: '900', color: meta.color },
          text: `${rankLabel(card.rank)} ${meta.glyph}`,
        }),
        el('div', { className: 'hc-label', text: meta.label, style: { color: meta.color } }),
      ]
    );
  }

  function sendMode(action, data) {
    if (!isMyTurn() || pendingAction) return;
    const aid = socket.nextAid();
    trackAction({ aid, kind: action });
    socket.send(MSG.MODE_ACTION, data ? { aid, action, data } : { aid, action });
    render();
  }

  function renderHand() {
    const s = snap();
    if (!s || s.yourSeat == null) {
      handDock.style.display = 'none';
      return;
    }
    handDock.style.display = '';
    clear(handDock);

    const mePub = s.seats?.find((x) => x.seat === s.yourSeat);
    if (mePub && !mePub.alive) {
      handDock.append(
        el('div', {
          className: 'last-play-tag',
          style: { position: 'static' },
          text: '👻 You are a bar ghost — heckle from the beyond.',
        })
      );
      return;
    }

    const me = mySeatState();
    const cards = myCards();
    if (cards?.length) {
      handDock.append(el('div', { className: 'hand-row' }, cards.map(cardNode)));
    } else if (me?.folded && s.phase === 'playing') {
      handDock.append(
        el('div', {
          className: 'last-play-tag',
          style: { position: 'static' },
          text: '🙈 Folded — your cards are muck. Watch the pot walk away.',
        })
      );
    }

    const myTurn = isMyTurn();
    const turnInfo = store.get('turnInfo');
    const actions = (myTurn ? turnInfo?.actions : null) ?? [];
    const toCall = myToCall();
    const busy = !!pendingAction;

    const turnTag = myTurn
      ? el('span', {
          className: 'badge host',
          style: { fontSize: '12px', padding: '5px 10px' },
          text: '★ YOUR TURN',
        })
      : el('span', {
          className: 'faint',
          style: { fontSize: '12px' },
          text: s.phase === 'playing' ? 'waiting for your turn…' : ' ',
        });

    const secs = el('span', {
      className: 'turn-secs',
      style: { fontWeight: '800', color: 'var(--banana)', minWidth: '34px' },
    });

    const row = el('div', { className: 'hand-actions' }, [turnTag]);

    if (myTurn && actions.length) {
      if (actions.includes(POKER_ACTIONS.FOLD)) {
        row.append(
          el('button', {
            className: 'btn danger',
            type: 'button',
            disabled: busy ? 'true' : undefined,
            text: pendingAction?.kind === POKER_ACTIONS.FOLD ? '…' : 'FOLD',
            onClick: () => sendMode(POKER_ACTIONS.FOLD),
          })
        );
      }
      if (actions.includes(POKER_ACTIONS.CALL)) {
        row.append(
          el('button', {
            className: 'btn primary',
            type: 'button',
            disabled: busy ? 'true' : undefined,
            text:
              pendingAction?.kind === POKER_ACTIONS.CALL
                ? '…'
                : toCall > 0
                  ? `CALL ${toCall} 🍌`
                  : 'CHECK',
            onClick: () => sendMode(POKER_ACTIONS.CALL),
          })
        );
      }
      if (actions.includes(POKER_ACTIONS.RAISE)) {
        raiseAmount = Math.min(Math.max(raiseAmount, RAISE_MIN), RAISE_MAX);
        const stepBtn = (delta, label) =>
          el('button', {
            className: 'btn ghost small',
            type: 'button',
            disabled:
              busy || (delta < 0 ? raiseAmount <= RAISE_MIN : raiseAmount >= RAISE_MAX)
                ? 'true'
                : undefined,
            text: label,
            onClick: () => {
              raiseAmount = Math.min(Math.max(raiseAmount + delta, RAISE_MIN), RAISE_MAX);
              render();
            },
          });
        row.append(
          el(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(8,14,7,0.78)',
                border: '1px solid var(--line-strong)',
                borderRadius: '12px',
                padding: '4px 8px',
              },
            },
            [
              stepBtn(-1, '−'),
              el('b', {
                style: { minWidth: '20px', textAlign: 'center', color: 'var(--banana)' },
                text: String(raiseAmount),
              }),
              stepBtn(+1, '+'),
              el('button', {
                className: 'btn primary',
                type: 'button',
                disabled: busy ? 'true' : undefined,
                text: pendingAction?.kind === POKER_ACTIONS.RAISE ? '…' : `RAISE +${raiseAmount}`,
                onClick: () => sendMode(POKER_ACTIONS.RAISE, { amount: raiseAmount }),
              }),
            ]
          )
        );
      }
      row.append(secs);
    }
    handDock.append(row);
  }

  // ---------------------------------------------------------------------
  // Showdown rank-name banner (fx-timed by the choreography)
  // ---------------------------------------------------------------------
  function showBanner(node, ms) {
    clear(bannerLayer);
    bannerLayer.append(node);
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => clear(bannerLayer), ms);
  }

  subs.push(
    store.on('fxPokerShowdown', (fx) => {
      if (!fx || !visible) return;
      const s = snap();
      const name = (seatNo) =>
        shortName(s?.seats?.find((x) => x.seat === seatNo)?.name ?? 'Monkey', 12);
      if (fx.uncontested) {
        showBanner(
          el('div', { className: 'phase-banner truth' }, [
            el('span', { text: '🏆 UNCONTESTED' }),
            el('span', {
              className: 'sub',
              text: `Everyone folds — ${name(fx.winnerSeat)} drags ${fx.pot} 🍌 without showing a card.`,
            }),
          ]),
          2800
        );
        return;
      }
      const winners = fx.winners?.length ? fx.winners : [{ seat: fx.winnerSeat, amount: fx.pot }];
      const winnerHand = fx.hands?.find((h) => h.seat === winners[0].seat);
      const split = winners.length > 1;
      showBanner(
        el('div', { className: 'phase-banner' }, [
          el('span', { text: split ? '🤝 SPLIT POT' : '🃏 SHOWDOWN' }),
          el(
            'div',
            { className: 'reveal-cards' },
            (winnerHand?.cards ?? []).map((c) =>
              el('div', {
                className: 'mini-card',
                text: `${rankLabel(c.rank)}${FRUIT_META[c.suit]?.glyph ?? '❓'}`,
              })
            )
          ),
          el('span', {
            className: 'sub',
            text: split
              ? `${winners.map((w) => name(w.seat)).join(' & ')} split ${fx.pot} 🍌 with ${winnerHand?.name ?? 'equal hands'}.`
              : `${name(winners[0].seat)} wins ${fx.pot} 🍌 with ${winnerHand?.name ?? 'the best hand'}.`,
          }),
        ]),
        3400
      );
    })
  );

  // ---------------------------------------------------------------------
  // Bust-cannon penalty overlay (ML §4.2 shapes: chip window + fuse)
  // ---------------------------------------------------------------------
  function renderPenalty() {
    clear(penaltyLayer);
    const pen = store.get('penaltyInfo');
    const s = snap();
    if (!pen || !s || s.phase !== 'penalty') return;

    const seat = s.seats?.find((x) => x.seat === pen.seat);
    const mine = s.yourSeat != null && pen.seat === s.yourSeat;

    if (!mine) {
      penaltyLayer.append(
        el('div', { className: 'penalty-watch' }, [
          el('div', {
            text: `💸 ${shortName(seat?.name ?? 'Monkey', 14)} is broke — the cannon demands payment…`,
          }),
          el('div', {
            className: 'faint',
            style: { fontSize: '11px', marginTop: '4px' },
            text: 'survive → the bar fronts 3 chips. drumroll…',
          }),
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
          el('div', { className: 'p-title', text: "You're bust — face the cannon" }),
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
              ? 'Survive and the bar fronts you 3 chips. One Lucky Chip per match.'
              : 'No chip left. Survive and the bar fronts you 3 chips.',
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
  // actionAck — resolve pending fold/call/raise/chip sends
  // ---------------------------------------------------------------------
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

  // modeEvent payloads (pot/bets/stacks) land between snapshot patches —
  // refresh the dock + pot readout as they arrive (plates re-render with the
  // shell on the next snapshot/turn tick, which every action also triggers).
  subs.push(
    store.on('modeData', () => {
      if (visible) render();
    })
  );

  // ---------------------------------------------------------------------
  // Countdown tick (turn seconds + penalty fuse), driven by the shell's rAF
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

  function render() {
    renderPot();
    renderHand();
  }

  // ---------------------------------------------------------------------
  // Module contract (see ui/modes/index.js)
  // ---------------------------------------------------------------------
  return {
    el: root,
    seatStats,
    /** Poker "active turn" phase — drives the shell's turn ring/countdown. */
    isTurnPhase: (s) => s.phase === 'playing',
    render,
    onTurnInfo() {
      // a new turn means any stale pending action can be dropped
      if (pendingAction && pendingAction.kind !== 'chip') pendingAction = null;
    },
    tick,
    onShow() {
      visible = true;
      pendingAction = null;
      raiseAmount = 1;
      render();
      renderPenalty();
    },
    onHide() {
      visible = false;
      if (bannerTimer) clearTimeout(bannerTimer);
      clear(bannerLayer);
    },
    dispose() {
      visible = false;
      for (const off of subs) off();
      subs.length = 0;
    },
  };
}

export default createPokerHud;
