// Custom Chaos HUD module (R7) — DELEGATES to the Monkey Lies HUD (the mode
// is config-driven ML) and decorates it with the host's knob readout:
//   · a knob summary row parked under the shell's table-fruit banner, fed by
//     snapshot.knobs (echoed by the server) / the `modeEvent chaosKnobs`
//     announcement; knobs turned away from their schema default glow,
//   · the play band: the inner HUD's selection cap / PLAY gate / helper copy
//     all derive from caps.getPlayLimits, fed from the knobs — both TIGHTENED
//     (maxPlay 1–2) and LOOSENED (maxPlay 4) bands work, plus a capture-phase
//     toast when a click would over-select past the knob.
// Module contract: ui/modes/index.js. Registered via this file's default.

import { CHAOS_KNOB_SCHEMA, CHAOS_KNOB_KEYS } from '@shared/chaos.js';
import { CHAOS_EVENTS } from '@shared/modeEvents.js';
import { el, clear } from '../dom.js';
import { createMonkeyLiesHud } from './monkeyLiesHud.js';

/** Compact glyph per knob (labels come from the shared schema). */
const KNOB_GLYPHS = {
  handSize: '🂠',
  maxPlay: '🃏',
  startChambers: '⚙',
  startCoconuts: '🥥',
  chipsPerMatch: '🍀',
  chipBonus: '➕',
  goldenPerPlayer: '✨',
};

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {import('./index.js').ModeHud}
 */
export default function createChaosHud(ctx) {
  const { store, toast } = ctx;

  /** @type {import('@shared/chaos.js').ChaosKnobs|null} */
  let knobs = store.get('snapshot')?.knobs ?? null;
  /** Freshest knob view: snapshot.knobs wins on (re)joins, the chaosKnobs
   *  modeEvent covers live starts (folded into `knobs` by the sub below). */
  const knobView = () => store.get('snapshot')?.knobs ?? knobs;

  const inner = createMonkeyLiesHud(ctx, {
    // Re-read on every inner render: the host's knobs bound the play band in
    // BOTH directions (maxPlay 1–4; minPlay stays stock unless a knob ever
    // supplies one).
    getPlayLimits() {
      const k = knobView();
      return { minPlay: k?.minPlay ?? 1, maxPlay: k?.maxPlay ?? 3 };
    },
  });

  // ---------------------------------------------------------------------
  // Knob summary row (under the shell's table-fruit banner)
  // ---------------------------------------------------------------------
  const knobRow = el('div', {
    className: 'last-play-tag chaos-knob-row',
    style: {
      display: 'none',
      right: 'auto',
      bottom: 'auto',
      left: '50%',
      top: '64px',
      transform: 'translateX(-50%)',
      maxWidth: 'min(560px, 92vw)',
      gap: '10px',
      flexWrap: 'wrap',
      justifyContent: 'center',
      borderColor: 'rgba(178, 102, 255, 0.55)',
      boxShadow: '0 0 22px rgba(178, 102, 255, 0.25)',
      zIndex: '6',
    },
  });

  const root = el('div', { className: 'mode-hud chaos-hud' }, [inner.el, knobRow]);

  const subs = [];

  function renderKnobs() {
    if (!knobs) {
      knobRow.style.display = 'none';
      return;
    }
    knobRow.style.display = 'flex';
    clear(knobRow);
    knobRow.append(
      el('span', {
        className: 'faint',
        style: { fontWeight: '800', letterSpacing: '1.5px', fontSize: '10.5px' },
        text: '🎛 CHAOS',
      })
    );
    for (const key of CHAOS_KNOB_KEYS) {
      const spec = CHAOS_KNOB_SCHEMA[key];
      const value = knobs[key];
      const changed = value !== spec.def;
      knobRow.append(
        el('span', {
          title: `${spec.label}: ${value}${changed ? ` (default ${spec.def})` : ''} — ${spec.desc}`,
          style: {
            fontSize: '11.5px',
            fontWeight: changed ? '800' : '600',
            color: changed ? 'var(--banana)' : 'var(--ink-dim)',
            textShadow: changed ? '0 0 12px rgba(255, 210, 61, 0.6)' : 'none',
            whiteSpace: 'nowrap',
          },
          text: `${KNOB_GLYPHS[key] ?? '·'} ${spec.label} ${value}`,
        })
      );
    }
  }

  // ---------------------------------------------------------------------
  // Max Play toast: the inner HUD already caps selection at the knob (via
  // caps.getPlayLimits), so this capture-phase listener only adds feedback —
  // whatever the knob (tightened OR loosened), an over-select click explains
  // the house limit instead of silently doing nothing.
  // ---------------------------------------------------------------------
  root.addEventListener(
    'click',
    (e) => {
      const maxPlay = knobView()?.maxPlay;
      if (!maxPlay) return;
      const card = typeof e.target?.closest === 'function' ? e.target.closest('.hand-card') : null;
      if (!card || card.classList.contains('selected') || card.classList.contains('disabled')) return;
      const selected = root.querySelectorAll('.hand-card.selected').length;
      if (selected >= maxPlay) {
        e.stopPropagation();
        toast(`House knobs: max ${maxPlay} card${maxPlay > 1 ? 's' : ''} per play.`, 'error');
      }
    },
    true
  );

  subs.push(
    store.on('modeData', (data) => {
      const announced = data?.[CHAOS_EVENTS.KNOBS]?.knobs;
      if (announced) {
        knobs = announced;
        renderKnobs();
      }
    })
  );

  // ---------------------------------------------------------------------
  // Module contract (see ui/modes/index.js) — inner HUD + decorations
  // ---------------------------------------------------------------------
  return {
    el: root,
    seatStats: (seat) => inner.seatStats?.(seat) ?? null,
    isTurnPhase: (s) => inner.isTurnPhase?.(s) ?? false,
    render() {
      inner.render?.();
      // snapshot.knobs wins on (re)joins; the chaosKnobs modeEvent covers live starts.
      const snapKnobs = store.get('snapshot')?.knobs;
      if (snapKnobs) knobs = snapKnobs;
      renderKnobs();
    },
    onTurnInfo() {
      inner.onTurnInfo?.();
    },
    tick() {
      inner.tick?.();
    },
    onShow() {
      inner.onShow?.();
      renderKnobs();
    },
    onHide() {
      inner.onHide?.();
    },
    dispose() {
      for (const off of subs) off();
      subs.length = 0;
      inner.dispose?.();
    },
  };
}
