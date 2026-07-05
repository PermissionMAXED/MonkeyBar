// King of the Bar HUD module (R7) — DELEGATES to the Monkey Lies HUD (the
// mode is config-driven ML) and decorates it with the Bar Rule theatre:
//   · a dramatic center-stage banner when each round's Bar Rule is announced
//     (`modeEvent kingBarRule`) + a persistent rule pill under the table-fruit
//     banner so the active rule stays readable all round,
//   · a silent-round chat lockout overlay (the server rejects seated chat with
//     BAD_STATE while engine.socialMuted — this makes the muzzle visible and
//     blocks the inputs client-side),
//   · the Royal Decree fruit picker: a `turn` frame carrying
//     actions:['pickFruit'] opens a 3-fruit veil; picks ride `modeAction`
//     (§10.1) with actionAck handling,
//   · Sour Table `fruitFlip` events patch snapshot.tableFruit so the shell's
//     table-fruit banner (and the inner HUD's claim tag) re-render live.
// Module contract: ui/modes/index.js. Registered via this file's default.

import { MSG } from '@shared/protocol.js';
import { MAX_PLAY, MIN_PLAY } from '@shared/constants.js';
import { BASIC_FRUITS } from '@shared/cards.js';
import { KING_ACTIONS, KING_EVENTS } from '@shared/modeEvents.js';
import { el, clear, FRUIT_META, shortName } from '../dom.js';
import { createMonkeyLiesHud } from './monkeyLiesHud.js';

/** How long the round's Bar Rule banner holds the stage. */
const RULE_BANNER_MS = 3200;

/** Bar Rules that reshape the ML play band, by ruleId (mirrors the server's
 *  kingOfTheBar.js BAR_RULES `rules` — snapshot.barRule ships only
 *  ruleId/name/desc). Happy Hour: 2-card floor, so PLAY is disabled
 *  client-side with a single card selected (the server enforces the same). */
const RULE_PLAY_LIMITS = Object.freeze({
  happy_hour: Object.freeze({ minPlay: 2, maxPlay: MAX_PLAY }),
});

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {import('./index.js').ModeHud}
 */
export default function createKingOfTheBarHud(ctx) {
  const { store, socket, toast } = ctx;
  const inner = createMonkeyLiesHud(ctx, {
    // Re-read on every inner render: the round's Bar Rule reshapes the play
    // band (Happy Hour → minPlay 2); rules change per round, and the freshest
    // rule comes from the kingBarRule modeEvent / snapshot.barRule on resyncs.
    getPlayLimits() {
      syncSnapshotRule();
      return RULE_PLAY_LIMITS[activeRule?.ruleId] ?? { minPlay: MIN_PLAY, maxPlay: MAX_PLAY };
    },
  });

  // ---------------------------------------------------------------------
  // Layers (absolute children resolve against .hud, like the inner HUD's)
  // ---------------------------------------------------------------------
  // Persistent "house rule" pill, parked under the shell's table-fruit banner.
  const rulePill = el('div', {
    className: 'last-play-tag king-rule-pill',
    style: {
      display: 'none',
      right: 'auto',
      bottom: 'auto',
      left: '50%',
      top: '64px',
      transform: 'translateX(-50%)',
      maxWidth: 'min(480px, 90vw)',
      borderColor: 'rgba(255, 210, 61, 0.55)',
      boxShadow: '0 0 22px rgba(255, 210, 61, 0.25)',
      zIndex: '6',
    },
  });
  // Dramatic center-stage announcement (transient, self-hiding).
  const ruleBanner = el('div', {
    className: 'king-rule-banner',
    style: {
      display: 'none',
      position: 'absolute',
      inset: '0',
      zIndex: '24',
      pointerEvents: 'none',
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
  // Silent-round lockout: measured over the shell's chat dock every render.
  const silentOverlay = el('div', {
    className: 'king-silent-overlay',
    style: {
      display: 'none',
      position: 'absolute',
      zIndex: '17', // above .chat-dock (15), below banners (20)
      pointerEvents: 'auto',
      background: 'rgba(6, 4, 10, 0.82)',
      border: '1px solid rgba(255, 77, 94, 0.5)',
      borderRadius: '14px',
      backdropFilter: 'blur(2px)',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '6px',
      textAlign: 'center',
      cursor: 'not-allowed',
    },
  });
  silentOverlay.append(
    el('div', { style: { fontSize: '30px' }, text: '🙊' }),
    el('div', {
      style: { fontWeight: '800', letterSpacing: '1.5px', color: 'var(--danger)', fontSize: '13px' },
      text: 'SILENT ROUND',
    }),
    el('div', {
      className: 'faint',
      style: { fontSize: '11px', maxWidth: '240px' },
      text: 'Chat, phrases & emotes are locked until the round ends. Poker faces only.',
    })
  );
  // Royal Decree picker / watch layer.
  const decreeLayer = el('div', {});

  const root = el('div', { className: 'mode-hud king-hud' }, [
    inner.el,
    rulePill,
    ruleBanner,
    silentOverlay,
    decreeLayer,
  ]);

  // ---------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------
  /** @type {{ruleId: string, name: string, desc: string, roundNo?: number}|null} */
  let activeRule = store.get('snapshot')?.barRule ?? null;
  /** Last snapshot.barRule ruleId adopted — snapshot.barRule only refreshes on
   *  full state resyncs, so it must win only when it CHANGES (join/rejoin),
   *  never re-override fresher kingBarRule modeEvents with a stale value. */
  let snapRuleSeen = activeRule?.ruleId ?? null;
  /** @type {string|null} aid of the in-flight pickFruit modeAction */
  let pendingAid = null;
  let visible = false;
  let bannerTimer = null;
  /** modeEvents log cursor (entries before it were already handled). */
  let seenEvents = (store.get('modeEvents') ?? []).length;
  const subs = [];

  const snap = () => store.get('snapshot');

  /** snapshot.barRule wins on (re)joins — it only refreshes on full state
   *  resyncs, so it must win only when it CHANGES, never re-override fresher
   *  kingBarRule modeEvents with a stale value. */
  function syncSnapshotRule() {
    const snapRule = snap()?.barRule;
    if (snapRule && snapRule.ruleId !== snapRuleSeen) {
      snapRuleSeen = snapRule.ruleId;
      activeRule = snapRule;
    }
  }

  const roundLive = () => {
    const phase = snap()?.phase;
    return !!phase && !['roundEnd', 'matchEnd', 'dealing'].includes(phase);
  };
  const silentNow = () => activeRule?.ruleId === 'silent_round' && roundLive();

  /** My pending Royal Decree pick window (the `turn` frame carries actions). */
  const myDecreeTurn = () => {
    const s = snap();
    const t = store.get('turnInfo');
    return (
      !!s &&
      !!t &&
      s.yourSeat != null &&
      t.seat === s.yourSeat &&
      Array.isArray(t.actions) &&
      t.actions.includes(KING_ACTIONS.PICK_FRUIT)
    );
  };
  const decreeTurnSeat = () => {
    const t = store.get('turnInfo');
    return Array.isArray(t?.actions) && t.actions.includes(KING_ACTIONS.PICK_FRUIT) ? t.seat : null;
  };

  // ---------------------------------------------------------------------
  // Bar Rule banner + pill
  // ---------------------------------------------------------------------
  function renderPill() {
    if (!activeRule) {
      rulePill.style.display = 'none';
      return;
    }
    rulePill.style.display = '';
    clear(rulePill);
    rulePill.append(
      el('span', { className: 'faint', text: 'HOUSE RULE ' }),
      el('b', { text: activeRule.name }),
      el('span', { className: 'faint', text: ` — ${activeRule.desc}` })
    );
  }

  function showRuleBanner(rule) {
    if (!visible) return;
    clear(ruleBanner);
    ruleBanner.style.display = 'flex';
    const card = el(
      'div',
      {
        className: 'panel',
        style: {
          textAlign: 'center',
          width: 'min(460px, 92vw)',
          borderColor: 'rgba(255, 210, 61, 0.6)',
          boxShadow: '0 0 60px rgba(255, 210, 61, 0.35)',
          transform: 'scale(1.35)',
          opacity: '0',
          transition: 'transform 0.28s cubic-bezier(0.2, 1.4, 0.4, 1), opacity 0.22s ease',
        },
      },
      [
        el('div', {
          style: { fontSize: '12px', fontWeight: '800', letterSpacing: '3px', color: 'var(--ink-dim)' },
          text: `👑 ROUND ${rule.roundNo ?? snap()?.roundNo ?? '—'} · THE KING DECLARES`,
        }),
        el('div', {
          style: {
            font: 'var(--font-display)',
            fontSize: '34px',
            letterSpacing: '3px',
            margin: '8px 0 6px',
            color: 'var(--banana)',
            textShadow: '0 0 26px rgba(255, 210, 61, 0.8)',
            textTransform: 'uppercase',
          },
          text: rule.name,
        }),
        el('div', { className: 'faint', style: { fontSize: '13px' }, text: rule.desc }),
      ]
    );
    ruleBanner.append(card);
    requestAnimationFrame(() => {
      card.style.transform = 'scale(1)';
      card.style.opacity = '1';
    });
    if (bannerTimer) clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => {
      ruleBanner.style.display = 'none';
      clear(ruleBanner);
    }, RULE_BANNER_MS);
  }

  // ---------------------------------------------------------------------
  // Silent-round chat lockout (measured over the shell's .chat-dock)
  // ---------------------------------------------------------------------
  function renderSilent() {
    if (!silentNow()) {
      silentOverlay.style.display = 'none';
      return;
    }
    silentOverlay.style.display = 'flex';
    const hud = root.closest('.hud');
    const dock = hud?.querySelector('.chat-dock');
    if (hud && dock) {
      const dockRect = dock.getBoundingClientRect();
      const hudRect = hud.getBoundingClientRect();
      Object.assign(silentOverlay.style, {
        left: `${dockRect.left - hudRect.left - 4}px`,
        top: `${dockRect.top - hudRect.top - 4}px`,
        width: `${dockRect.width + 8}px`,
        height: `${dockRect.height + 8}px`,
      });
    } else {
      // Fallback: mirror the .chat-dock CSS box.
      Object.assign(silentOverlay.style, {
        left: '12px',
        bottom: '12px',
        top: 'auto',
        width: 'min(328px, 88vw)',
        height: '240px',
      });
    }
  }

  // ---------------------------------------------------------------------
  // Royal Decree fruit picker
  // ---------------------------------------------------------------------
  function sendPick(fruit) {
    if (pendingAid || !myDecreeTurn()) return;
    const aid = socket.nextAid();
    pendingAid = aid;
    socket.send(MSG.MODE_ACTION, { aid, action: KING_ACTIONS.PICK_FRUIT, data: { fruit } });
    renderDecree();
  }

  function renderDecree() {
    clear(decreeLayer);
    const seat = decreeTurnSeat();
    if (seat == null) return;
    const s = snap();

    if (!myDecreeTurn()) {
      const who = s?.seats?.find((x) => x.seat === seat);
      decreeLayer.append(
        el('div', {
          className: 'last-play-tag',
          style: {
            right: 'auto',
            bottom: 'auto',
            left: '50%',
            top: '108px',
            transform: 'translateX(-50%)',
            zIndex: '18',
          },
          text: `👑 ${shortName(who?.name ?? 'Monkey', 14)} won the challenge — decreeing the next Table Fruit…`,
        })
      );
      return;
    }

    const secs = el('span', {
      className: 'king-decree-secs',
      style: { color: 'var(--banana)', fontWeight: '800' },
    });
    decreeLayer.append(
      el('div', { className: 'penalty-veil' }, [
        el('div', { className: 'penalty-box panel' }, [
          el('div', { style: { fontSize: '56px' }, text: '👑' }),
          el('div', { className: 'p-title', style: { color: 'var(--banana)' }, text: 'Royal Decree' }),
          el('div', { className: 'p-odds' }, [
            el('span', { text: 'You won the challenge — crown the next Table Fruit. ' }),
            secs,
          ]),
          el(
            'div',
            { style: { display: 'flex', gap: '12px', justifyContent: 'center', margin: '14px 0 4px' } },
            BASIC_FRUITS.map((fruit) => {
              const meta = FRUIT_META[fruit] ?? { glyph: '❓', label: fruit, color: '#fff' };
              return el(
                'button',
                {
                  className: 'btn big',
                  type: 'button',
                  disabled: pendingAid ? 'true' : undefined,
                  style: { minWidth: '108px', borderColor: meta.color },
                  onClick: () => sendPick(fruit),
                },
                [
                  el('div', { style: { fontSize: '30px' }, text: meta.glyph }),
                  el('div', { style: { fontSize: '12px', color: meta.color }, text: meta.label }),
                ]
              );
            })
          ),
          el('div', {
            className: 'faint',
            style: { fontSize: '12px', marginTop: '8px' },
            text: pendingAid ? 'Decreeing…' : 'Dawdle and the crown picks your most-held fruit for you.',
          }),
        ]),
      ])
    );
  }

  // ---------------------------------------------------------------------
  // modeEvent intake (kingBarRule / fruitFlip / kingFruitPicked)
  // ---------------------------------------------------------------------
  function handleModeEvent(evt) {
    if (evt.kind === KING_EVENTS.BAR_RULE) {
      activeRule = { ruleId: evt.ruleId, name: evt.name, desc: evt.desc, roundNo: evt.roundNo };
      renderPill();
      renderSilent();
      showRuleBanner(activeRule);
      inner.render?.(); // the new rule may reshape the play band (Happy Hour)
    } else if (evt.kind === KING_EVENTS.FRUIT_FLIP) {
      // Sour Table: keep the client's authoritative-ish view current so the
      // shell's table-fruit banner and the inner claim tag re-render live.
      const s = snap();
      if (s && s.tableFruit !== evt.fruit) store.set('snapshot', { ...s, tableFruit: evt.fruit });
      const meta = FRUIT_META[evt.fruit] ?? { glyph: '❓', label: evt.fruit };
      if (visible) toast(`🍋 Sour Table! The Table Fruit flips to ${meta.glyph} ${meta.label}.`);
    } else if (evt.kind === KING_EVENTS.FRUIT_PICKED) {
      const s = snap();
      const who = s?.seats?.find((x) => x.seat === evt.seat);
      const meta = FRUIT_META[evt.fruit] ?? { glyph: '❓', label: evt.fruit };
      if (visible) {
        toast(`👑 ${shortName(who?.name ?? 'Monkey', 14)} decrees: next Table Fruit is ${meta.glyph} ${meta.label}!`);
      }
    }
  }

  subs.push(
    store.on('modeEvents', (log) => {
      const entries = log ?? [];
      if (entries.length < seenEvents) seenEvents = 0; // reset on new match
      for (; seenEvents < entries.length; seenEvents++) handleModeEvent(entries[seenEvents]);
    }),
    store.on('actionAck', (ack) => {
      if (!ack || ack.aid !== pendingAid) return;
      pendingAid = null;
      if (!ack.ok) toast(`Decree rejected: ${ack.code ?? 'unknown'}`, 'error');
      renderDecree();
    })
  );

  // ---------------------------------------------------------------------
  // Module contract (see ui/modes/index.js) — inner HUD + decorations
  // ---------------------------------------------------------------------
  return {
    el: root,
    seatStats: (seat) => inner.seatStats?.(seat) ?? null,
    // The decree window is an active-turn phase too (state resyncs report
    // phase 'decree'; live `turn` frames patch the client phase to 'playing').
    isTurnPhase: (s) => (inner.isTurnPhase?.(s) ?? false) || s.phase === 'decree',
    render() {
      // Reconcile the rule BEFORE the inner render so its play band (via
      // getPlayLimits) is right on the very first post-resync render.
      syncSnapshotRule();
      inner.render?.();
      renderPill();
      renderSilent();
      renderDecree();
    },
    onTurnInfo() {
      inner.onTurnInfo?.();
      pendingAid = null;
    },
    tick() {
      inner.tick?.();
      const t = store.get('turnInfo');
      const secsEl = decreeLayer.querySelector('.king-decree-secs');
      if (secsEl && t) {
        secsEl.textContent = `${Math.ceil(Math.max(0, t.deadline - Date.now()) / 1000)}s`;
      }
    },
    onShow() {
      visible = true;
      inner.onShow?.();
      renderPill();
      renderSilent();
      renderDecree();
    },
    onHide() {
      visible = false;
      if (bannerTimer) clearTimeout(bannerTimer);
      ruleBanner.style.display = 'none';
      clear(ruleBanner);
      inner.onHide?.();
    },
    dispose() {
      if (bannerTimer) clearTimeout(bannerTimer);
      for (const off of subs) off();
      subs.length = 0;
      inner.dispose?.();
    },
  };
}
