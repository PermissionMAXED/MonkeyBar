// Client mode registry (R3) — HUD modules + per-mode modeEvent reducers.
// New modes plug in HERE without touching the Monkey Lies code paths:
//   1. HUD: implement createXxxHud(ctx) in ui/modes/<mode>Hud.js and export it
//      as that file's default (placeholders export null → generic fallback).
//   2. Reducers: add kind → (data, p) handlers to MODE_REDUCERS[modeId] so
//      screens.js can fold `modeEvent` frames into store.modeData.
// 3D choreography registers separately in game/modes/index.js.
//
// ---------------------------------------------------------------------------
// Mode HUD module contract (consumed by the ui/hud.js shell)
// ---------------------------------------------------------------------------
// A mode HUD factory is `(ctx) => ModeHud` where ctx = {store, socket, engine,
// toast, go, back} (the same ctx every screen gets).
//
/**
 * @typedef {Object} ModeHud
 * @property {HTMLElement} el   controls layer, mounted inside `.hud`; children
 *                              may be position:absolute (resolved against .hud)
 * @property {(seat: Object) => (Node[]|null)} [seatStats]
 *   children for a seat plate's `.sp-stats` row (null/absent → no stats row)
 * @property {(snapshot: Object) => boolean} [isTurnPhase]
 *   is `snapshot.phase` an active-turn phase? (drives the shell's turn ring +
 *   per-seat countdown bar; phases are mode-scoped per PLAN.md §10.3)
 * @property {() => void} [render]      re-render controls (snapshot/turnInfo changed)
 * @property {() => void} [onTurnInfo]  a fresh `turn` event landed (before render)
 * @property {() => void} [tick]        rAF hook while the game screen is visible
 * @property {() => void} [onShow]      game screen shown (reset transient UI state)
 * @property {() => void} [onHide]      game screen hidden
 * @property {() => void} [dispose]     module is being unmounted — drop store subs
 */

import { MSG } from '@shared/protocol.js';
import { el, clear } from '../dom.js';
import { createMonkeyLiesHud } from './monkeyLiesHud.js';
import bananaDiceHud from './bananaDiceHud.js';
import rouletteHud from './rouletteHud.js';
import pokerHud from './pokerHud.js';
import kingOfTheBarHud from './kingOfTheBarHud.js';
import chaosHud from './chaosHud.js';

// ---------------------------------------------------------------------------
// HUD registry (mode id → factory). null → generic fallback HUD.
// ---------------------------------------------------------------------------

/** @type {Record<string, ((ctx: Object) => ModeHud)|null>} */
const MODE_HUDS = {
  monkeyLies: createMonkeyLiesHud,
  bananaDice: bananaDiceHud,
  coconutRoulette: rouletteHud,
  junglePoker: pokerHud,
  kingOfTheBar: kingOfTheBarHud,
  customChaos: chaosHud,
};

/**
 * HUD factory for a mode, or null (unknown / placeholder modes → the shell
 * mounts {@link createGenericModeHud} instead).
 * @param {string} modeId
 */
export function getModeHud(modeId) {
  return MODE_HUDS[modeId] ?? null;
}

// ---------------------------------------------------------------------------
// Generic fallback HUD — keeps ANY mode minimally playable the day its server
// engine lands: the shell renders seats + turn, this module renders the legal
// `turn.actions` verbs as plain buttons that send `modeAction` (§10.1).
// ---------------------------------------------------------------------------

/**
 * @param {{store, socket, toast}} ctx
 * @returns {ModeHud}
 */
export function createGenericModeHud(ctx) {
  const { store, socket, toast } = ctx;

  const dock = el('div', { className: 'hand-dock mode-action-dock', style: { display: 'none' } });
  const root = el('div', { className: 'mode-hud' }, [dock]);

  /** @type {string|null} aid of the in-flight modeAction */
  let pendingAid = null;
  const subs = [];

  const snap = () => store.get('snapshot');
  // Phases are mode-scoped (§10.3); without mode knowledge, treat everything
  // outside the shared intermission/terminal states as an active turn phase.
  const isTurnPhase = (s) =>
    !['dealing', 'revealing', 'penalty', 'roundEnd', 'matchEnd'].includes(s.phase);
  const isMyTurn = () => {
    const s = snap();
    return !!s && s.yourSeat != null && s.turnSeat === s.yourSeat && isTurnPhase(s);
  };

  function sendAction(action) {
    if (!isMyTurn() || pendingAid) return;
    const aid = socket.nextAid();
    pendingAid = aid;
    socket.send(MSG.MODE_ACTION, { aid, action });
    render();
  }

  function render() {
    const s = snap();
    clear(dock);
    if (!s || s.yourSeat == null) {
      dock.style.display = 'none';
      return;
    }
    dock.style.display = '';
    const mySeat = s.seats?.find((x) => x.seat === s.yourSeat);
    if (mySeat && !mySeat.alive) {
      dock.append(
        el('div', {
          className: 'last-play-tag',
          style: { position: 'static' },
          text: '👻 You are a bar ghost — heckle from the beyond.',
        })
      );
      return;
    }

    const myTurn = isMyTurn();
    const actions = (myTurn ? store.get('turnInfo')?.actions : null) ?? [];
    const turnTag = myTurn
      ? el('span', {
          className: 'badge host',
          style: { fontSize: '12px', padding: '5px 10px' },
          text: '★ YOUR TURN',
        })
      : el('span', { className: 'faint', style: { fontSize: '12px' }, text: 'waiting for your turn…' });

    dock.append(
      el('div', { className: 'hand-actions' }, [
        turnTag,
        ...actions.map((action) =>
          el('button', {
            className: 'btn primary',
            type: 'button',
            disabled: pendingAid ? 'true' : undefined,
            text: pendingAid ? '…' : action.toUpperCase(),
            onClick: () => sendAction(action),
          })
        ),
      ])
    );
  }

  subs.push(
    store.on('actionAck', (ack) => {
      if (!ack || ack.aid !== pendingAid) return;
      pendingAid = null;
      if (!ack.ok) toast(`Action rejected: ${ack.code ?? 'unknown'}`, 'error');
      render();
    })
  );

  return {
    el: root,
    isTurnPhase,
    render,
    onTurnInfo() {
      pendingAid = null;
    },
    onShow() {
      pendingAid = null;
      render();
    },
    onHide() {},
    dispose() {
      for (const off of subs) off();
      subs.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Per-mode modeEvent reducers: fold a `modeEvent {kind, ...p}` frame into
// store.modeData (screens.js calls reduceByMode on every frame). Mode agents
// (R4–R7) register `{ [kind]: (data, p) => newData }` tables here; without a
// handler the generic reducer keeps the latest payload per kind.
// ---------------------------------------------------------------------------

/** @type {Record<string, Record<string, (data: Object, p: Object) => Object>>} */
const MODE_REDUCERS = {
  // bananaDice:      { [DICE_EVENTS.BID]: (data, p) => ({ ...data, bid: p }), ... }   (R4)
  // coconutRoulette: { ... }   (R4/R5)
  // junglePoker:     { ... }   (R5/R6)
  // kingOfTheBar:    { ... }   (R6)
  // customChaos:     { ... }   (R7)
};

/**
 * Reduce a modeEvent into the mode-scoped client state (store.modeData).
 * @param {string|undefined} modeId   snapshot.mode
 * @param {string} kind               modeEvent kind (shared/modeEvents.js)
 * @param {Object} p                  full modeEvent payload (includes `kind`)
 * @param {Object|null} data          previous store.modeData
 * @returns {Object} next modeData
 */
export function reduceByMode(modeId, kind, p, data) {
  const prev = data && typeof data === 'object' ? data : {};
  const handler = modeId ? MODE_REDUCERS[modeId]?.[kind] : null;
  if (handler) return handler(prev, p);
  // generic fallback: remember the latest payload per kind
  const payload = { ...p };
  delete payload.kind;
  return { ...prev, [kind]: payload };
}
