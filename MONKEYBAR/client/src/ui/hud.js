// In-game HUD SHELL (P5, refactored by R3) — pure DOM rendering from
// store.snapshot + game events. The shell owns everything shared by every
// game mode: chat dock, leave button, per-seat plates (portrait, alive/ghost,
// connected, turn ring) with a countdown driven by `deadline`, the
// table-fruit banner (self-hides when the snapshot has no tableFruit), the
// transient phase/event banners, and emote bubbles.
//
// Mode-specific CONTROLS (hand fan, call buttons, penalty overlays, …) live
// in mode HUD modules (ui/modes/) keyed by `snapshot.mode` — mounted here and
// swapped on gameStart / state resync. Monkey Lies' controls moved verbatim
// to ui/modes/monkeyLiesHud.js; unknown/placeholder modes get the generic
// fallback HUD (turn.actions → modeAction buttons). Module contract lives in
// ui/modes/index.js. 3D choreography is P6's job (game/gameClient.js).

import { MSG } from '@shared/protocol.js';
import { el, clear, FRUIT_META, shortName } from './dom.js';
import { portraitCanvas } from './portraits.js';
import { createChatPanel } from './chat.js';
import { getModeHud, createGenericModeHud } from './modes/index.js';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void, onHide: () => void}}
 */
export function createHud(ctx) {
  const { store, socket } = ctx;

  // ---------------------------------------------------------------------
  // Shared layers
  // ---------------------------------------------------------------------
  const tfBanner = el('div', { className: 'tf-banner', style: { display: 'none' } });
  const seatLayer = el('div', { className: 'seat-layer' });
  const bannerLayer = el('div', { className: 'banner-layer' });
  const chat = createChatPanel(ctx, { compact: true });
  const chatDock = el('div', { className: 'chat-dock' }, [chat.el]);
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
  // Mount point for the active mode's HUD module. Unstyled static wrapper:
  // its absolutely-positioned children resolve against .hud exactly as the
  // pre-R3 direct children did. Kept LAST in the DOM so equal-z-index layers
  // (penalty veil vs leave button, both z30) stack as before.
  const modeMount = el('div', { className: 'mode-hud-mount' });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'hud' }, [
      seatLayer,
      tfBanner,
      chatDock,
      leaveBtn,
      bannerLayer,
      modeMount,
    ]),
  ]);

  // ---------------------------------------------------------------------
  // Shell state
  // ---------------------------------------------------------------------
  let visible = false;
  let rafId = 0;
  /** @type {Map<number, {plate: HTMLElement, bar: HTMLElement|null}>} */
  const plateBySeat = new Map();

  const snap = () => store.get('snapshot');

  // C2: leave the table (players) / stop spectating (spectators). The server
  // replies leftRoom, which screens.js routes back to the lobby browser.
  function onLeave() {
    if (snap()?.yourSeat == null) socket.send(MSG.STOP_SPECTATE, {});
    else socket.send(MSG.LEAVE_ROOM, {});
  }

  // ---------------------------------------------------------------------
  // Mode HUD module mounting (swapped on gameStart / state resync — the only
  // times snapshot.mode can change). ML gets its verbatim module; unknown /
  // placeholder modes get the generic turn.actions fallback.
  // ---------------------------------------------------------------------
  /** @type {import('./modes/index.js').ModeHud|null} */
  let modeHud = null;
  /** @type {string|null} */
  let mountedMode = null;

  /** @returns {boolean} true when a different module was (un)mounted */
  function mountModeHud(mode) {
    const next = mode ?? null;
    if (mountedMode === next) return false;
    if (modeHud) {
      if (visible) modeHud.onHide?.();
      modeHud.dispose?.();
      clear(modeMount);
      modeHud = null;
    }
    mountedMode = next;
    if (!next) return true;
    const factory = getModeHud(next) ?? createGenericModeHud;
    modeHud = factory(ctx);
    if (modeHud.el) modeMount.append(modeHud.el);
    return true;
  }

  /** Mode-scoped "active turn" phase test (§10.3: phases vary per mode). */
  function isTurnPhase(s) {
    if (modeHud?.isTurnPhase) return modeHud.isTurnPhase(s);
    return !['dealing', 'revealing', 'penalty', 'roundEnd', 'matchEnd'].includes(s.phase);
  }

  // ---------------------------------------------------------------------
  // Table-fruit banner (ML family; hides itself when there is no tableFruit)
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
  // Seat plates (arranged on an ellipse, you at the bottom). The stats row
  // is mode-scoped: the mounted module's seatStats(seat) provides it.
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
      const isTurn = s.turnSeat === seat.seat && isTurnPhase(s) && seat.alive;

      const stats = modeHud?.seatStats?.(seat) ?? null;

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
          stats ? el('div', { className: 'sp-stats' }, stats) : null,
          countdownBar,
        ]
      );
      seatLayer.append(plate);
      plateBySeat.set(seat.seat, { plate, bar: countdownBar?.querySelector('i') ?? null });
    }
  }

  // ---------------------------------------------------------------------
  // Countdown loop (turn deadline; module tick handles mode-specific timers
  // like ML's turn-seconds readout and penalty fuse), driven by rAF
  // ---------------------------------------------------------------------
  function tick() {
    if (!visible) return;
    const turnInfo = store.get('turnInfo');
    const s = snap();
    if (turnInfo && s && isTurnPhase(s)) {
      const total = Math.max(1, turnInfo.deadline - turnInfo.ts);
      const remaining = Math.max(0, turnInfo.deadline - Date.now());
      const frac = Math.min(1, remaining / total);
      const entry = plateBySeat.get(turnInfo.seat);
      if (entry?.bar) entry.bar.style.transform = `scaleX(${frac})`;
    }
    modeHud?.tick?.();
    rafId = requestAnimationFrame(tick);
  }

  // ---------------------------------------------------------------------
  // Phase / event banners (transient; driven by store fx* keys the reducers
  // and the gameClient choreography publish)
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
    if (!b.tableFruit) {
      // non-ML modes: no table fruit — plain round banner
      showBanner(el('div', { className: 'phase-banner' }, [el('span', { text: `Round ${b.roundNo}` })]), 2600);
      return;
    }
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
    modeHud?.render?.();
  }

  store.on('snapshot', () => {
    const swapped = mountModeHud(snap()?.mode);
    if (swapped && visible) modeHud?.onShow?.();
    renderAll();
  });
  store.on('turnInfo', () => {
    if (!visible) return;
    // a new turn means any stale pending action can be dropped
    modeHud?.onTurnInfo?.();
    renderAll();
  });

  return {
    el: screen,
    onShow() {
      visible = true;
      mountModeHud(snap()?.mode);
      modeHud?.onShow?.();
      renderAll();
      chat.onShow?.();
      rafId = requestAnimationFrame(tick);
    },
    onHide() {
      visible = false;
      cancelAnimationFrame(rafId);
      if (bannerTimer) clearTimeout(bannerTimer);
      clear(bannerLayer);
      modeHud?.onHide?.();
      chat.onHide?.();
    },
  };
}
