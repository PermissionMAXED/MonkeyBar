// Cake Shop / Tortenwerkstatt — V4/G62 „Comfy Cakes" scene rework (PLAN4-GAMES
// §G1, PLAN4 §E block G62). Fixed SIDE-VIEW camera onto a 6 m left→right
// conveyor (2D perspective of a 3D bakery, like the Vista original): the
// PLAYER drives the belt with hold-◀/▶ pedals, ingredients drop from overhead
// nozzles on per-station buttons (0.45 s fall — press-ahead timing skill),
// the oven is a belt-skill tunnel (stop inside, leave in the green zone), and
// finished cakes ship at the box on the far right. Tickets/match matrix/NPC
// customers/coin economy stay §C9-verbatim.
//
// ENGINE SPLIT (§G1.9 contract): the pure simulation lives in G61's
// purblePlace.logic.js rework — `createLine({rng, difficulty})` +
// `stepLine(line, dt, input)` with `input = {belt: −1|0|1, press:
// stationId|null, spawnShape, ship}`. This module feature-detects those
// exports and keeps a scene-local §G1.3–§G1.6 belt sim coded to the SAME
// contract as the §E0.1-11 degradation path only (G61's engine is the bound
// path — wave-end joint verification 2026-07-19: every CDP round reports
// engine=g61, bot probe-validated, suite 1723/1723; evidence
// /tmp/gooby-v4-g62/JOINT-VERIFICATION.md). Station positions/rules below
// are the binding §G1.5 table verbatim, so both sides agree by construction.
//
// Layout/camera (§G1.4): belt s=0…6 → world x = s−3, belt top y 0.72, z 0;
// camera FOV 40/44 at (camX, 1.9, 7.4) looking at (camX, 1.05, 0) — world +x
// = screen right (§G2-safe by construction); the camera follows the focus pan
// clamped ±1.4 showing a 3.2 m window (3.6 m ≥412 px). Controls (§G1.7): BIG
// round pedals bottom-left/right (≥72 px), a station dock of ≥56 px drop
// buttons aligned under their projected nozzle x, ticket pictograms top-left,
// the belt overview strip under them. NOTE (§G1.7 reconciliation, measured):
// 2×4.5 rem pedals + the 3.25 rem framework pause + 4×3.5 rem dock buttons
// cannot share ONE 320 px row at 130 % UI scale (≈460 px needed), so the dock
// is a full-width row directly ABOVE the pedals — every §G1.7 requirement
// (sizes, max 4/5 buttons, projected alignment, spawn far-left / Versand
// far-right, <360 px pedal inset, pause clearance) holds.
//
// Skinned-NPC budget stays §C9.7: ≤1 actively-animated mixer, ≤250 draw
// calls. Music: the registry resolves trackFor('game:purblePlace') (Treblo —
// Games/PurblePlace); no automatic framework hook exists post-G51, so this
// scene calls audio.radio.playContext on init and restores the persisted
// radio wish on dispose (same duck/replaceContext mechanics as G52/G64).
// Dev-only ?autoplay=1 uses G61's bot when present, else the local pilot.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // cameo outfits (§C5.3)
import { getAchievementsEngine } from '../../systems/achievementsEngine.js';
import { getStore } from '../../core/store.js'; // radio-wish restore only (dispose)
import { clampFloatTextToView } from '../framework.js';
import * as cakeLogic from './purblePlace.logic.js';

// ---------------------------------------------------------------------------
// §G1 binding numbers (scene copy of the §G1.4/§G1.5 tables — G61's logic
// module owns behavior; these mirror the same spec rows for rendering)
// ---------------------------------------------------------------------------

/** §G1.4 belt/camera + §G1.5 physics numbers (verbatim). */
export const G62 = Object.freeze({
  BELT_LEN: 6.0,
  BELT_Y: 0.72,
  DURATION_SEC: 210,
  MAX_TICKETS: 3,
  FWD_SPEED: 0.9,
  REV_SPEED: 0.7,
  BELT_SLEW: 6,
  SQUIRT_SEC: 0.35,
  FALL_H: 0.55,
  FALL_SEC: 0.45,
  LOCKOUT_SEC: 0.5,
  CANDLE_GAP_SEC: 0.18,
  MAX_CANDLES: 4,
  SPLAT_SEC: 4,
  SPLAT_PTS: -2,
  SPAWN_S: 0.15,
  SPAWN_CLEAR_M: 0.7,
  OVEN_IN: 2.25,
  OVEN_OUT: 3.15,
  BAKE_GREEN_MIN: 2.25,
  BAKE_GREEN_MAX: 3.0,
  BAKE_PERFECT_PTS: 5,
  BAKE_SINGED_PTS: -3,
  SHIP_S: 5.95,
  SHIP_HALF: 0.3,
  CAM_Y: 1.9,
  CAM_Z: 7.4,
  CAM_LOOK_Y: 1.05,
  CAM_FOV: 40,
  CAM_FOV_WIDE: 44,
  CAM_WINDOW: 3.2,
  CAM_WINDOW_WIDE: 3.6,
  CAM_CLAMP: 1.4,
  CAM_K: 5,
  WIDE_PX: 412,
  ENDLESS_FAILS: 3,
  ENDLESS_INTERVAL_FLOOR: 10,
});

/** §G1.5 nozzle table (belt-space s, drops fall straight down at nozzle x). */
export const NOZZLES = Object.freeze([
  Object.freeze({ id: 'teig.vanilla', s: 0.9, kind: 'teig', value: 'vanilla' }),
  Object.freeze({ id: 'teig.chocolate', s: 1.35, kind: 'teig', value: 'chocolate' }),
  Object.freeze({ id: 'teig.strawberry', s: 1.8, kind: 'teig', value: 'strawberry' }),
  Object.freeze({ id: 'guss.white', s: 3.5, kind: 'guss', value: 'white' }),
  Object.freeze({ id: 'guss.pink', s: 3.95, kind: 'guss', value: 'pink' }),
  Object.freeze({ id: 'guss.chocolate', s: 4.4, kind: 'guss', value: 'chocolate' }),
  Object.freeze({ id: 'deko.cherry', s: 4.7, kind: 'deko', value: 'cherry' }),
  Object.freeze({ id: 'deko.sprinkles', s: 5.0, kind: 'deko', value: 'sprinkles' }),
  Object.freeze({ id: 'deko.berries', s: 5.3, kind: 'deko', value: 'berries' }),
  Object.freeze({ id: 'kerzen', s: 5.6, kind: 'kerzen', value: null }),
]);

/**
 * §G1.6 difficulty rows (Leicht/Mittel/Schwer + §G5.4 endless). Scene-owned
 * copy so meter zones/dock hints render right for BOTH engine kinds.
 * @param {'easy'|'normal'|'hard'|'endless'} difficulty
 */
export function diffParams(difficulty) {
  if (difficulty === 'easy') {
    return { patMult: 1.3, intervalFloor: 18, catchHalf: 0.3, singeAt: 4.2, capDiv: 3, endless: false };
  }
  if (difficulty === 'hard') {
    return { patMult: 0.8, intervalFloor: 12, catchHalf: 0.19, singeAt: 3.2, capDiv: 2, endless: false };
  }
  if (difficulty === 'endless') {
    return {
      patMult: 1, intervalFloor: G62.ENDLESS_INTERVAL_FLOOR, catchHalf: 0.24, singeAt: 3.6,
      capDiv: 3, endless: true,
    };
  }
  return { patMult: 1, intervalFloor: 14, catchHalf: 0.24, singeAt: 3.6, capDiv: 3, endless: false };
}

/** §G1.6 pan cap: min(3, 1 + floor(serves / capDiv)) — Schwer reaches 3 @ serve 4. */
export function panCapAt(serves, params) {
  return Math.min(3, 1 + Math.floor(Math.max(0, serves) / params.capDiv));
}

// §C9.2 dimension tables — reused from the logic module when exported
// (§G1.9 keeps the ticket generator verbatim), spec fallbacks otherwise.
const SHAPES = cakeLogic.SHAPES ?? Object.freeze(['round', 'square', 'heart']);
const SPONGES = cakeLogic.SPONGES ?? Object.freeze(['vanilla', 'chocolate', 'strawberry']);
const SPONGE_HEX = cakeLogic.SPONGE_HEX ?? Object.freeze({
  vanilla: '#F5E6C8', chocolate: '#6B4A2F', strawberry: '#F2B8C6',
});
const ICING_HEX = cakeLogic.ICING_HEX ?? Object.freeze({
  white: '#FFF8F0', pink: '#F781B0', chocolate: '#4E3524',
});
const SPRINKLE_COLORS = ['#E4572E', '#F5C518', '#4CB5AE', '#B37FD4', '#7CC15E', '#F781B0'];
const SHAPE_GLYPH = { round: '●', square: '■', heart: '♥' };
const DEKO_HEX = Object.freeze({ cherry: '#D6293A', sprinkles: '#F5C518', berries: '#E4405F' });

/** Splat/drop tint per station id. */
function stationHex(stationId) {
  const noz = NOZZLES.find((n) => n.id === stationId);
  if (!noz) return '#C9A87A';
  if (noz.kind === 'teig') return SPONGE_HEX[noz.value];
  if (noz.kind === 'guss') return ICING_HEX[noz.value];
  if (noz.kind === 'deko') return DEKO_HEX[noz.value];
  return '#F7E7C8'; // kerzen wax
}

/** Belt-space s → world (single straight tier — §G1.4 `x = s − 3.0`). */
function beltPoint(s, out = new THREE.Vector3()) {
  return out.set(s - 3.0, G62.BELT_Y, 0);
}

// ---------------------------------------------------------------------------
// §G1.9 engine facade — G61's createLine/stepLine when present, else the
// scene-local fallback sim below (identical input/event vocabulary)
// ---------------------------------------------------------------------------

/** Legal-target matrix (§G1.5 rows): may `kind` drop into `pan` right now? */
function dropLegal(kind, pan) {
  if (kind === 'teig') return pan.sponge == null;
  if (kind === 'guss') return pan.bake != null && pan.icing == null;
  if (kind === 'deko') return pan.bake != null && pan.topping == null;
  if (kind === 'kerzen') return pan.bake != null && (pan.candles || 0) < G62.MAX_CANDLES;
  return false;
}

/** §C9.4 wrong count + the §G1.5 singe rule (singed = ONE wrong component). */
function wrongCountOf(pan, spec) {
  const base = typeof cakeLogic.wrongCount === 'function'
    ? cakeLogic.wrongCount(pan, spec)
    : 5;
  return base + (pan.bake === 'singed' ? 1 : 0);
}

/**
 * Scene-local §G1.3–§G1.6 belt sim (fallback until G61's stepLine lands).
 * Pure over the injected rng — no DOM/three access.
 * @param {{rng: () => number, difficulty: string}} opts
 */
export function createFallbackLine({ rng, difficulty }) {
  const P = diffParams(difficulty);
  return {
    kind: 'g62-fallback',
    difficulty,
    params: P,
    rng,
    t: 0,
    score: 0,
    combo: 0,
    serves: 0,
    cakesServed: 0,
    perfectCakes: 0,
    perfectBakes: 0,
    rejected: 0,
    expired: 0,
    beltV: 0,
    beltDir: 0,
    over: false,
    /** @type {Array<object>} */
    pans: [],
    /** @type {Array<{id: number, spec: object, remain: number, patience: number}>} */
    tickets: [],
    /** @type {Array<{s: number, age: number, station: string}>} */
    splats: [],
    /** @type {Array<{station: string, kind: string, value: string|null, s: number, t: number}>} */
    drops: [],
    /** @type {Record<string, number>} per-nozzle re-press lockouts (§G1.5) */
    locks: {},
    orderT: 0,
    nextTicketId: 1,
    nextPanId: 1,
    get panCap() {
      return panCapAt(this.serves, this.params);
    },
  };
}

/**
 * Advance the fallback sim by dt with the §G1.9 input shape; returns events[]
 * (`ticketNew, expire, panSpawn, drop, catch, splat, buzz, bakeStart,
 * bakeCommit, serve, reject, trash`).
 * @param {object} line createFallbackLine state
 * @param {number} dt seconds
 * @param {{belt?: number, press?: string|null, spawnShape?: string|null, ship?: boolean}} input
 */
export function stepFallbackLine(line, dt, input = {}) {
  /** @type {Array<object>} */
  const events = [];
  if (line.over) return events;
  const P = line.params;
  const emit = (e) => events.push(e);
  const addScore = (pts) => {
    line.score = Math.max(0, line.score + pts);
  };
  const endlessFail = () => {
    if (P.endless && line.rejected + line.expired >= G62.ENDLESS_FAILS) line.over = true;
  };
  line.t += dt;

  // ── belt: slew toward the pedal command (§G1.5 pedals row) ───────────────
  const dir = input.belt > 0 ? 1 : input.belt < 0 ? -1 : 0;
  line.beltDir = dir;
  const target = dir > 0 ? G62.FWD_SPEED : dir < 0 ? -G62.REV_SPEED : 0;
  const dv = target - line.beltV;
  const maxDv = G62.BELT_SLEW * dt;
  line.beltV += Math.abs(dv) <= maxDv ? dv : Math.sign(dv) * maxDv;
  const move = line.beltV * dt;

  // ── pans ride the belt; s < 0 → trash (§G1.5 trash row) ──────────────────
  for (let i = line.pans.length - 1; i >= 0; i -= 1) {
    const pan = line.pans[i];
    pan.s = Math.min(G62.BELT_LEN + 0.05, pan.s + move);
    if (pan.s < 0) {
      line.pans.splice(i, 1);
      emit({ type: 'trash', panId: pan.id, pan });
    }
  }

  // ── splat decals ride the belt for 4 s (§G1.5 mistimed row) ──────────────
  for (let i = line.splats.length - 1; i >= 0; i -= 1) {
    const sp = line.splats[i];
    sp.s += move;
    sp.age += dt;
    if (sp.age >= G62.SPLAT_SEC || sp.s < 0 || sp.s > G62.BELT_LEN) line.splats.splice(i, 1);
  }

  // ── nozzle lockouts ───────────────────────────────────────────────────────
  for (const k of Object.keys(line.locks)) {
    line.locks[k] -= dt;
    if (line.locks[k] <= 0) delete line.locks[k];
  }

  // ── drops in flight → impact hit test (§G1.5 drop physics) ───────────────
  for (let i = line.drops.length - 1; i >= 0; i -= 1) {
    const d = line.drops[i];
    d.t += dt;
    if (d.t < G62.FALL_SEC) continue;
    line.drops.splice(i, 1);
    let hit = null;
    for (const pan of line.pans) {
      const dist = Math.abs(pan.s - d.s);
      if (dist <= P.catchHalf && (hit == null || dist < Math.abs(hit.s - d.s))) hit = pan;
    }
    if (hit && dropLegal(d.kind, hit)) {
      if (d.kind === 'teig') hit.sponge = d.value;
      else if (d.kind === 'guss') hit.icing = d.value;
      else if (d.kind === 'deko') hit.topping = d.value;
      else if (d.kind === 'kerzen') hit.candles = (hit.candles || 0) + 1;
      emit({ type: 'catch', panId: hit.id, station: d.station, kind: d.kind, value: d.value, pan: hit });
    } else if (hit) {
      // illegal type while a pan blocks the spot — friendly buzz, 0 pts
      emit({ type: 'buzz', station: d.station, panId: hit.id, bounce: true });
    } else {
      addScore(G62.SPLAT_PTS);
      line.splats.push({ s: d.s, age: 0, station: d.station });
      emit({ type: 'splat', station: d.station, s: d.s, points: G62.SPLAT_PTS });
    }
  }

  // ── oven tunnel (§G1.5 oven row): meter accumulates inside, singe
  // auto-commits at singeAt, leaving commits pale/perfect, re-entry resumes ──
  for (const pan of line.pans) {
    const inside = pan.sponge != null && pan.s >= G62.OVEN_IN && pan.s <= G62.OVEN_OUT;
    if (inside && !pan.inOven) {
      pan.inOven = true;
      emit({ type: 'bakeStart', panId: pan.id, pan });
    }
    if (inside) {
      pan.bakeT = (pan.bakeT || 0) + dt;
      if (pan.bakeT >= P.singeAt && pan.bake !== 'singed') {
        pan.bake = 'singed';
        addScore(G62.BAKE_SINGED_PTS);
        emit({ type: 'bakeCommit', panId: pan.id, result: 'singed', points: G62.BAKE_SINGED_PTS, pan });
      }
    } else if (pan.inOven) {
      pan.inOven = false;
      if (pan.bake !== 'singed' && (pan.bakeT || 0) > 0) {
        const inGreen = pan.bakeT >= G62.BAKE_GREEN_MIN && pan.bakeT <= G62.BAKE_GREEN_MAX;
        const result = inGreen ? 'perfect' : pan.bake === 'perfect' ? 'perfect' : 'pale';
        const points = result === 'perfect' && pan.bake !== 'perfect' ? G62.BAKE_PERFECT_PTS : 0;
        if (points > 0) {
          line.perfectBakes += 1;
          addScore(points);
        }
        pan.bake = result;
        emit({ type: 'bakeCommit', panId: pan.id, result, points, pan });
      }
    }
  }

  // ── tickets: patience decay + expiry (§C9.2 verbatim) ────────────────────
  for (let i = line.tickets.length - 1; i >= 0; i -= 1) {
    const tk = line.tickets[i];
    tk.remain -= dt;
    if (tk.remain <= 0) {
      line.tickets.splice(i, 1);
      addScore(-5);
      line.combo = 0;
      line.expired += 1;
      emit({ type: 'expire', ticketId: tk.id, points: -5 });
      endlessFail();
    }
  }

  // ── orders (§G1.6 pacing: 30 s − 2 s/serve, difficulty floor) ────────────
  line.orderT -= dt;
  if (line.orderT <= 0) {
    if (line.tickets.length < G62.MAX_TICKETS) {
      const spec = typeof cakeLogic.makeTicket === 'function'
        ? cakeLogic.makeTicket(line.rng, line.serves)
        : { shape: SHAPES[0], sponge: SPONGES[0], icing: 'white', topping: 'cherry', candles: 0 };
      const basePat = typeof cakeLogic.patienceFor === 'function'
        ? cakeLogic.patienceFor(line.serves)
        : Math.max(30, 45 - 1.5 * line.serves);
      const patience = basePat * P.patMult;
      const ticket = { id: line.nextTicketId++, spec, remain: patience, patience };
      line.tickets.push(ticket);
      line.orderT = Math.max(P.intervalFloor, 30 - 2 * line.serves);
      emit({ type: 'ticketNew', ticketId: ticket.id, ticket });
    } else {
      line.orderT = 0; // retry as soon as a board slot frees
    }
  }

  // ── press: spawn / nozzle drop (§G1.5 buttons) ────────────────────────────
  const press = input.press ?? null;
  if (press === 'spawn') {
    const shape = SHAPES.includes(input.spawnShape) ? input.spawnShape : SHAPES[0];
    const capped = line.pans.length >= line.panCap;
    const blocked = line.pans.some((p) => Math.abs(p.s - G62.SPAWN_S) < G62.SPAWN_CLEAR_M);
    if (capped || blocked) {
      emit({ type: 'buzz', station: 'spawn' });
    } else {
      const pan = {
        id: line.nextPanId++, shape, s: G62.SPAWN_S,
        sponge: null, bake: null, bakeT: 0, inOven: false,
        icing: null, topping: null, candles: 0,
      };
      line.pans.push(pan);
      emit({ type: 'panSpawn', panId: pan.id, shape, pan });
    }
  } else if (press) {
    const noz = NOZZLES.find((n) => n.id === press);
    if (noz && !(line.locks[noz.id] > 0)) {
      line.locks[noz.id] = noz.kind === 'kerzen' ? G62.CANDLE_GAP_SEC : G62.LOCKOUT_SEC;
      let blockedBy = null;
      for (const pan of line.pans) {
        if (Math.abs(pan.s - noz.s) <= P.catchHalf && !dropLegal(noz.kind, pan)) blockedBy = pan;
      }
      if (blockedBy) {
        // §G1.5 disallowed row: the pan physically blocks the spot — no splat
        emit({ type: 'buzz', station: noz.id, panId: blockedBy.id, bounce: true });
      } else {
        line.drops.push({ station: noz.id, kind: noz.kind, value: noz.value, s: noz.s, t: 0 });
        emit({ type: 'drop', station: noz.id, kind: noz.kind, value: noz.value });
      }
    }
  }

  // ── ship (§G1.5 versand row): auto-match, fewest wrong, tie → oldest ─────
  if (input.ship) {
    let pan = null;
    for (const p of line.pans) {
      if (p.bake != null && Math.abs(p.s - G62.SHIP_S) <= G62.SHIP_HALF) {
        if (pan == null || Math.abs(p.s - G62.SHIP_S) < Math.abs(pan.s - G62.SHIP_S)) pan = p;
      }
    }
    if (!pan || line.tickets.length === 0) {
      emit({ type: 'buzz', station: 'versand' });
    } else {
      let ticket = null;
      let bestWrong = Infinity;
      for (const tk of line.tickets) {
        const w = wrongCountOf(pan, tk.spec);
        if (w < bestWrong) { // strict < keeps the OLDEST on ties (§G1.5)
          bestWrong = w;
          ticket = tk;
        }
      }
      const patienceFrac = Math.max(0, ticket.remain / ticket.patience);
      const r = typeof cakeLogic.scoreServe === 'function'
        ? cakeLogic.scoreServe({ wrong: bestWrong, combo: line.combo, patienceFrac })
        : { outcome: bestWrong === 0 ? 'perfect' : bestWrong === 1 ? 'oneWrong' : 'rejected', points: 0, comboAfter: 0 };
      addScore(r.points);
      line.combo = r.comboAfter;
      line.serves += 1;
      line.cakesServed += 1;
      if (r.outcome === 'perfect') line.perfectCakes += 1;
      if (r.outcome === 'rejected') line.rejected += 1;
      line.tickets.splice(line.tickets.indexOf(ticket), 1);
      line.pans.splice(line.pans.indexOf(pan), 1);
      emit({
        type: r.outcome === 'rejected' ? 'reject' : 'serve',
        outcome: r.outcome, points: r.points, wrong: bestWrong, patienceFrac,
        panId: pan.id, ticketId: ticket.id, pan,
      });
      endlessFail();
    }
  }
  return events;
}

/** Feature-detect G61's §G1.9 engine; fall back to the scene sim (§E0.1-11). */
export function createCakeEngine({ rng, difficulty }) {
  if (typeof cakeLogic.createLine === 'function' && typeof cakeLogic.stepLine === 'function') {
    const line = cakeLogic.createLine({ rng, difficulty });
    return {
      kind: 'g61',
      line,
      step: (dt, input) => cakeLogic.stepLine(line, dt, input) ?? [],
    };
  }
  const line = createFallbackLine({ rng, difficulty });
  return { kind: 'fallback', line, step: (dt, input) => stepFallbackLine(line, dt, input) };
}

// ---------------------------------------------------------------------------
// fallback autoplay pilot — serial one-pan planner against the oldest ticket
// (used for ?autoplay=1 until G61's §G1.9 bot lands; same input shape)
// ---------------------------------------------------------------------------

/** @returns {{plan: (line: object, dt: number) => object}} */
export function createFallbackPilot() {
  let cool = 0; // press spacing
  const IDLE = { belt: 0, press: null, spawnShape: null, ship: false };
  /** Next §G1.5 station the pan needs for `spec` (null = ship it). */
  function nextNeed(pan, spec) {
    if (pan.sponge == null) return { s: NOZZLES.find((n) => n.id === `teig.${spec.sponge}`).s, press: `teig.${spec.sponge}` };
    if (pan.bake == null || (pan.bake === 'pale' && (pan.bakeT || 0) < G62.BAKE_GREEN_MIN)) {
      return { oven: true };
    }
    if (pan.icing == null && spec.icing !== 'none') {
      return { s: NOZZLES.find((n) => n.id === `guss.${spec.icing}`).s, press: `guss.${spec.icing}` };
    }
    if (pan.topping == null && spec.topping !== 'none') {
      return { s: NOZZLES.find((n) => n.id === `deko.${spec.topping}`).s, press: `deko.${spec.topping}` };
    }
    if ((pan.candles || 0) < spec.candles) return { s: 5.6, press: 'kerzen' };
    return { ship: true };
  }
  return {
    plan(line, dt) {
      cool = Math.max(0, cool - dt);
      const pans = line.pans ?? [];
      const tickets = line.tickets ?? [];
      if (pans.length === 0) {
        if (tickets.length === 0) return IDLE;
        if (cool > 0) return { ...IDLE };
        cool = 0.4;
        return { belt: 0, press: 'spawn', spawnShape: tickets[0].spec.shape, ship: false };
      }
      const pan = pans[0];
      const spec = (tickets[0] ?? tickets.find(() => true))?.spec;
      if (!spec) return IDLE; // wait for the next customer, keep the pan
      const need = nextNeed(pan, spec);
      const stopped = Math.abs(line.beltV ?? 0) < 0.02;
      if (need.oven) {
        const mid = (G62.OVEN_IN + G62.OVEN_OUT) / 2;
        if ((pan.bakeT || 0) >= G62.BAKE_GREEN_MIN + 0.2) {
          return { belt: 1, press: null, spawnShape: null, ship: false }; // leave in green
        }
        if (pan.s < mid - 0.05) return { belt: 1, press: null, spawnShape: null, ship: false };
        if (pan.s > mid + 0.08) return { belt: -1, press: null, spawnShape: null, ship: false };
        return IDLE; // hold inside, meter runs
      }
      if (need.ship) {
        if (pan.s < G62.SHIP_S - 0.08) return { belt: 1, press: null, spawnShape: null, ship: false };
        if (pan.s > G62.SHIP_S + G62.SHIP_HALF) return { belt: -1, press: null, spawnShape: null, ship: false };
        if (!stopped || cool > 0) return IDLE;
        cool = 0.3;
        return { belt: 0, press: null, spawnShape: null, ship: true };
      }
      // drive under the nozzle, stop, press (0.45 s fall lands on a still pan)
      if (pan.s < need.s - 0.04) return { belt: 1, press: null, spawnShape: null, ship: false };
      if (pan.s > need.s + 0.04) return { belt: -1, press: null, spawnShape: null, ship: false };
      if (!stopped || cool > 0) return IDLE;
      cool = need.press === 'kerzen' ? 0.25 : 0.65;
      return { belt: 0, press: need.press, spawnShape: null, ship: false };
    },
  };
}

// ---------------------------------------------------------------------------
// pictogram SVG builders (tickets + dock buttons — language-free, §C9.2)
// ---------------------------------------------------------------------------

/** @param {string} shape @param {number} cx @param {number} cy @param {number} r */
function shapeBadgeSvg(shape, cx, cy, r) {
  const c = '#7A5B40';
  if (shape === 'round') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
  if (shape === 'square') {
    return `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="1.5" fill="${c}"/>`;
  }
  const s = r / 8;
  return `<path transform="translate(${cx},${cy - r}) scale(${s})" fill="${c}"
    d="M0 4 C -2 0 -8 0 -8 5 C -8 9 -3 12 0 15 C 3 12 8 9 8 5 C 8 0 2 0 0 4 Z"/>`;
}

/** @param {string} topping @param {number} cx @param {number} cy */
function toppingSvg(topping, cx, cy) {
  if (topping === 'cherry') {
    return `<path d="M${cx} ${cy - 4} q 3 -5 7 -6" stroke="#2E7D32" stroke-width="1.6" fill="none"/>
      <circle cx="${cx}" cy="${cy}" r="4" fill="#D6293A"/>
      <circle cx="${cx - 1.4}" cy="${cy - 1.4}" r="1.1" fill="#F08A96"/>`;
  }
  if (topping === 'sprinkles') {
    return SPRINKLE_COLORS.slice(0, 5).map((c, i) => {
      const x = cx - 10 + i * 5;
      const y = cy + (i % 2 === 0 ? -1.5 : 1.5);
      return `<rect x="${x}" y="${y}" width="4" height="1.8" rx="0.9" fill="${c}" transform="rotate(${i * 37 - 60} ${x + 2} ${y + 1})"/>`;
    }).join('');
  }
  if (topping === 'berries') {
    const berry = (x) => `<path d="M${x} ${cy - 4} C ${x + 4} ${cy - 4} ${x + 3.4} ${cy + 1} ${x} ${cy + 3.4}
        C ${x - 3.4} ${cy + 1} ${x - 4} ${cy - 4} ${x} ${cy - 4} Z" fill="#E4405F"/>
      <path d="M${x - 2.4} ${cy - 4.4} L ${x + 2.4} ${cy - 4.4} L ${x} ${cy - 2.2} Z" fill="#4E9B47"/>`;
    return berry(cx - 5) + berry(cx + 5);
  }
  return '';
}

/**
 * Pictogram order card (§C9.2 unchanged): side-view cake with a shape badge —
 * readable at every uiScale, EN+DE identical (language-free).
 * @param {{shape: string, sponge: string, icing: string, topping: string, candles: number}} spec
 * @returns {string} svg markup
 */
function ticketSvg(spec) {
  const parts = [];
  for (let i = 0; i < spec.candles; i += 1) {
    const x = 32 + (i - (spec.candles - 1) / 2) * 8;
    parts.push(`<rect x="${x - 1.3}" y="10" width="2.6" height="11" rx="1" fill="#F7E7C8" stroke="#C9A87A" stroke-width="0.6"/>
      <circle cx="${x}" cy="7.6" r="2.4" fill="#FFB13D"/>`);
  }
  if (spec.icing !== 'none') {
    const hex = ICING_HEX[spec.icing];
    parts.push(`<rect x="13" y="24" width="38" height="10" rx="5" fill="${hex}" stroke="rgba(74,59,54,0.25)" stroke-width="1"/>
      <circle cx="20" cy="34.5" r="3" fill="${hex}"/><circle cx="32" cy="36" r="3.4" fill="${hex}"/><circle cx="44" cy="34.5" r="3" fill="${hex}"/>`);
  }
  parts.push(`<rect x="15" y="31" width="34" height="15" fill="${SPONGE_HEX[spec.sponge]}" stroke="#7A5B40" stroke-width="1.4"/>`);
  parts.push('<path d="M12 46 L52 46 L49 53 L15 53 Z" fill="#9AA0A8" stroke="#6E747C" stroke-width="1"/>');
  parts.push(toppingSvg(spec.topping, 32, 20.5));
  parts.push(shapeBadgeSvg(spec.shape, 54, 11, 6.5));
  return `<svg viewBox="0 0 64 60" aria-hidden="true">${parts.join('')}</svg>`;
}

/**
 * Dock-button pictograms (buttons are language-free; labels ride aria/title).
 * @param {string} kind @param {string} [color]
 */
function buttonSvg(kind, color) {
  const wrap = (inner) => `<svg viewBox="0 0 28 28" aria-hidden="true">${inner}</svg>`;
  if (kind === 'sponge') {
    return wrap(`<path d="M8 8 C 8 4 20 4 20 8 L 21 16 L 7 16 Z" fill="${color}" stroke="#7A5B40" stroke-width="1.2"/>
      <path d="M11 16 L 14 23 L 17 16 Z" fill="${color}" stroke="#7A5B40" stroke-width="1"/>`);
  }
  if (kind === 'icing') {
    return wrap(`<rect x="4" y="8" width="20" height="8" rx="4" fill="${color}" stroke="rgba(74,59,54,0.3)" stroke-width="1"/>
      <circle cx="9" cy="17" r="2.4" fill="${color}"/><circle cx="15" cy="19" r="2.8" fill="${color}"/><circle cx="21" cy="17" r="2.2" fill="${color}"/>`);
  }
  if (kind === 'candle') {
    return wrap(`<rect x="11.5" y="9" width="5" height="14" rx="2" fill="#F7E7C8" stroke="#C9A87A" stroke-width="1"/>
      <circle cx="14" cy="5.5" r="3" fill="#FFB13D"/>`);
  }
  if (kind === 'cherry') return wrap(toppingSvg('cherry', 14, 16));
  if (kind === 'sprinkles') {
    return wrap(`<rect x="4" y="10" width="20" height="9" rx="4.5" fill="#FFF3E0" stroke="#C9A87A" stroke-width="1"/>${toppingSvg('sprinkles', 14, 14.5)}`);
  }
  if (kind === 'berries') return wrap(toppingSvg('berries', 14, 16));
  if (kind === 'pan') {
    return wrap(`<path d="M5 12 L23 12 L20.5 19 L7.5 19 Z" fill="#9AA0A8" stroke="#6E747C" stroke-width="1.2"/>
      <path d="M14 4 L14 10 M11 7 L17 7" stroke="#4A8F5C" stroke-width="2.4" stroke-linecap="round"/>`);
  }
  return wrap('');
}

// ---------------------------------------------------------------------------
// floating score text (shared minigame pattern — self-disposing sprites)
// ---------------------------------------------------------------------------

function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#4A3B36') {
      const canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 42px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(text, 90, 40);
      g.fillStyle = color;
      g.fillText(text, 90, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.6, halfH: 0.27 }));
      sprite.scale.set(1.2, 0.53, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.9 });
    },
    update(dt) {
      for (const f of active) {
        f.age += dt;
        f.sprite.position.y += dt * 0.9;
        f.mat.opacity = 1 - (f.age / f.life) ** 2;
        if (f.age >= f.life) {
          f.sprite.parent?.remove(f.sprite);
          f.mat.dispose();
          f.tex.dispose();
          active.delete(f);
        }
      }
    },
    dispose() {
      for (const f of active) {
        f.sprite.parent?.remove(f.sprite);
        f.mat.dispose();
        f.tex.dispose();
      }
      active.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// static asset tables (§G1.4 dressing: KayKit restaurant + Tiny Treats bakery)
// ---------------------------------------------------------------------------

const RESTAURANT_KEYS = [
  'kitchencounter_straight', 'kitchencounter_sink', 'oven', 'wall_orderwindow',
  'wall_doorway', 'floor_kitchen', 'plate', 'menu', 'chair_stool', 'crate_buns',
  'jar_A_medium', 'jar_C_small',
].map((k) => `kaykit-restaurant/${k}`);
const CHAR_KEYS = ['Knight', 'Mage', 'Rogue_Hooded'].map((k) => `kaykit-characters/${k}`);
const TREATS_KEYS = [
  'display_case_long', 'stand_mixer', 'scale', 'cash_register', 'dough_ball',
  'dough_rolled_A', 'dough_roller', 'macaron_pink', 'macaron_blue', 'macaron_yellow',
].map((k) => `bakery-interior/${k}`);
const GOODS_KEYS = ['croissant', 'cupcake', 'cinnamon-roll'].map((k) => `baked-goods/${k}`);
const FOOD_KEYS = ['food-kit/strawberry'];

/** NPC choreography (§C9.1 kept): door back-right → order-window seats back-left. */
const NPC = Object.freeze({
  SCALE: 0.45,
  WALK_SPEED: 1.15,
  DOOR: Object.freeze({ x: 2.4, z: -1.7 }),
  SEATS: Object.freeze([
    Object.freeze({ x: -2.55, z: -1.42 }),
    Object.freeze({ x: -1.95, z: -1.52 }),
    Object.freeze({ x: -1.35, z: -1.42 }),
  ]),
  CHEER_SEC: 1.7,
});

/** Overhead nozzle body colors (station color per §G1.7 button faces). */
const NOZZLE_BODY_HEX = Object.freeze({
  teig: '#C9905C', guss: '#D97BA6', deko: '#4CB5AE', kerzen: '#B98A5A',
});

// ---------------------------------------------------------------------------
// the §E8 game module
// ---------------------------------------------------------------------------

/** @type {object} §E8 plugin */
export default {
  id: 'purblePlace',
  assetKeys: [...RESTAURANT_KEYS, ...CHAR_KEYS, ...TREATS_KEYS, ...GOODS_KEYS, ...FOOD_KEYS],
  /** §B2.3 sample warmup — existing v3 ids (§C-SYS1.9.2 rows 30–32 flip in wave 3). */
  sfx: ['cake.apply', 'cake.ovenDing', 'cake.splat', 'cake.serve', 'cake.candle', 'cake.order'],

  // ------------------------------------------------------------------ init
  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';
    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.paused = false;
    this.endT = 0;
    this.reportedScore = 0;
    this.maxDrawCalls = 0;
    this.difficulty = ['easy', 'normal', 'hard', 'endless'].includes(ctx.params?.difficulty)
      ? ctx.params.difficulty
      : 'normal';
    this.diff = diffParams(this.difficulty);
    this.endless = this.diff.endless;

    this.engine = createCakeEngine({ rng: ctx.rng, difficulty: this.difficulty });
    this.pilot = null;
    if (this.autoplay) {
      // prefer G61's §G1.9 bot; validate its first plan shape, else local pilot
      if (this.engine.kind === 'g61' && typeof cakeLogic.createBot === 'function') {
        try {
          const bot = cakeLogic.createBot(ctx.rng);
          const probe = bot?.plan?.(this.engine.line, 0);
          if (probe && typeof probe === 'object' && !Array.isArray(probe) && 'belt' in probe) {
            this.pilot = bot;
          }
        } catch { /* fall through to the local pilot */ }
      }
      if (!this.pilot) this.pilot = createFallbackPilot();
    }

    // player input state (assembled into the §G1.9 input shape per frame)
    this.pedal = { back: false, fwd: false };
    /** @type {string[]} queued button presses (one consumed per frame) */
    this.pressQueue = [];
    this.shipQueued = false;
    this.spawnShape = SHAPES[0];
    this.lastTouchedPanId = null;
    this.failCount = 0; // endless: rejected+expired (scene mirror)
    this.counters = { cakesServed: 0, perfectCakes: 0, rejected: 0 };

    const scene = ctx.scene;
    const camera = ctx.camera;
    this.camX = 0;
    camera.fov = this.targetFov();
    camera.updateProjectionMatrix();
    camera.position.set(0, G62.CAM_Y, G62.CAM_Z);
    camera.lookAt(0, G62.CAM_LOOK_Y, 0);
    scene.background = new THREE.Color('#F6E3D0'); // warm bakery cream
    scene.fog = new THREE.Fog('#F6E3D0', 13, 24);

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    /** @type {THREE.Texture[]} */
    this.ownedTexs = [];
    this.geoCache = new Map();

    this.buildLighting(scene);
    this.buildRoom(scene);
    this.buildBelt(scene);
    this.buildNozzles(scene);
    this.buildOven(scene);
    this.buildEnds(scene);
    this.buildCakeSharedResources();

    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, camera);
    // Gooby baker cameo behind the belt center (§G1.4 — outfits equipped)
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    const podium = this.own(new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.42, 0.5),
      new THREE.MeshStandardMaterial({ color: '#A9744B', roughness: 0.85 })
    ));
    podium.position.set(0.55, 0.21, -0.95);
    scene.add(podium);
    this.gooby.group.scale.setScalar(0.8);
    this.gooby.group.position.set(0.55, 0.42, -0.95);
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    // live pan views / drop blobs / splat decals
    /** @type {Map<number, object>} pan id → view */
    this.panViews = new Map();
    /** @type {Array<object>} cosmetic falling blobs (engine events drive outcome) */
    this.dropViews = [];
    /** @type {Map<object, object>} engine splat entry → decal mesh */
    this.splatViews = new Map();

    // NPC customers (§C9.1 lifecycle kept; §C9.7 cap: ≤1 animated mixer)
    /** @type {Map<number, object>} ticketId → npc */
    this.npcs = new Map();
    this.npcCharIdx = Math.floor(ctx.rng() * CHAR_KEYS.length);
    this.animOwner = null;
    /** @type {object[]} */
    this.animQueue = [];
    this.seatTaken = [false, false, false];
    this.exitingNpcs = [];

    this.buildTopDom();
    this.buildControlBar();

    ctx.hud.setScore(0);
    ctx.hud.setTime(this.endless ? 0 : G62.DURATION_SEC);

    // §C-SYS1 music: the registry resolves the real Treblo track for
    // 'game:purblePlace' — played via the radio chain (loops, gates the
    // medley); dispose restores the persisted radio wish.
    this.musicContextOn = false;
    try {
      this.musicContextOn = !!ctx.audio.radio?.playContext?.('game:purblePlace');
    } catch { /* no radio engine in this context */ }

    if (import.meta.env?.DEV) {
      // §E9 test surface: CDP drives a full manual round through this
      // (press/ship/pedal) and reads engine + perf state without UI scraping.
      window.__purble = {
        game: this,
        engine: this.engine,
        line: this.engine.line,
        kind: this.engine.kind,
        renderer: ctx.renderer,
        press: (id) => this.queuePress(id),
        ship: () => this.queueShip(),
        pedal: (dir, on) => this.setPedal(dir, on),
        setShape: (shape) => {
          if (SHAPES.includes(shape)) this.spawnShape = shape;
          this.syncSpawnButton();
        },
      };
    }
  },

  // ------------------------------------------------------------- scene build
  buildLighting(scene) {
    scene.add(new THREE.HemisphereLight(0xfff3e2, 0xd9b28f, 1.05));
    const key = new THREE.DirectionalLight(0xfff0d8, 1.0);
    key.position.set(3, 7, 5);
    scene.add(key);
    this.ovenLight = new THREE.PointLight(0xffb46b, 14, 4.5, 2);
    this.ovenLight.position.set(-0.3, 1.0, 0.4);
    scene.add(this.ovenLight);
  },

  own(mesh) {
    if (mesh.geometry) this.ownedGeos.push(mesh.geometry);
    if (mesh.material) this.ownedMats.push(mesh.material);
    return mesh;
  },

  /** One GLB clone, uniformly scaled so its bbox height = h (v3 pattern). */
  place(scene, key, x, z, rotY = 0, h = null) {
    const m = this.ctx.assets.getModel(key);
    if (h != null) {
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      if (size.y > 0) m.scale.setScalar(h / size.y);
    }
    m.position.set(x, 0, z);
    m.rotation.y = rotY;
    scene.add(m);
    return m;
  },

  buildRoom(scene) {
    // warm wood ground + kitchen tile strip under the line
    const ground = this.own(new THREE.Mesh(
      new THREE.PlaneGeometry(20, 12),
      new THREE.MeshStandardMaterial({ color: '#C89A6B', roughness: 0.95 })
    ));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, 0.5);
    scene.add(ground);
    // kitchen tile strip stays BEHIND the belt only — a front row read as a
    // giant foreground chessboard in the fixed side view (CDP shot proof)
    const tileProbe = this.ctx.assets.getModel('kaykit-restaurant/floor_kitchen');
    const tb = new THREE.Box3().setFromObject(tileProbe);
    const ts = tb.getSize(new THREE.Vector3());
    const tileScale = 1.45 / Math.max(0.01, ts.x);
    for (let i = 0; i < 5; i += 1) {
      const tile = i === 0 ? tileProbe : this.ctx.assets.getModel('kaykit-restaurant/floor_kitchen');
      tile.scale.setScalar(tileScale);
      tile.position.set(-3.15 + i * 1.45, 0, -0.55);
      scene.add(tile);
    }

    // back wall: order window BACK-LEFT (customers sit there — §G1.4),
    // doorway right (NPC entry), order window mid for symmetry
    this.place(scene, 'kaykit-restaurant/wall_orderwindow', -2.2, -2.3, 0, 2.1);
    this.place(scene, 'kaykit-restaurant/wall_orderwindow', 0.15, -2.3, 0, 2.1);
    this.place(scene, 'kaykit-restaurant/wall_doorway', 2.45, -2.3, 0, 2.1);
    this.place(scene, 'kaykit-restaurant/menu', 0.15, -2.24, 0, 0.9).position.y = 1.35;

    // upper wall band + striped awning + pennant bunting: the portrait frame
    // shows a lot of air above the 2.1 m wall row — fill it so the side view
    // reads as a cozy bakery wall instead of empty sky (§G1.4 look bar)
    const bandMat = new THREE.MeshStandardMaterial({ color: '#F3DFC7', roughness: 0.95 });
    const band = new THREE.Mesh(new THREE.BoxGeometry(9.4, 2.4, 0.12), bandMat);
    band.position.set(0.1, 3.28, -2.36);
    const trimMat = new THREE.MeshStandardMaterial({ color: '#E5A8BC', roughness: 0.9 });
    const trim = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.14, 0.14), trimMat);
    trim.position.set(0.1, 2.14, -2.35);
    this.ownedGeos.push(band.geometry, trim.geometry);
    this.ownedMats.push(bandMat, trimMat);
    scene.add(band, trim);
    // awning: alternating pink/cream slats angled over the order windows
    const awning = new THREE.Group();
    const slatGeoA = new THREE.BoxGeometry(0.46, 0.05, 0.62);
    this.ownedGeos.push(slatGeoA);
    const awnPink = new THREE.MeshStandardMaterial({ color: '#F2A0B8', roughness: 0.85 });
    const awnCream = new THREE.MeshStandardMaterial({ color: '#FFF4E4', roughness: 0.85 });
    this.ownedMats.push(awnPink, awnCream);
    for (let i = 0; i < 10; i += 1) {
      const slat = new THREE.Mesh(slatGeoA, i % 2 === 0 ? awnPink : awnCream);
      slat.position.set(-2.15 + i * 0.47, 0, 0);
      awning.add(slat);
    }
    awning.rotation.x = 0.5;
    awning.position.set(0.05, 2.3, -2.05);
    scene.add(awning);
    // bunting: one merged triangle-fan mesh (single draw call), two swags
    const flagPos = [];
    const flagCol = [];
    const flagPalette = [[0.98, 0.62, 0.74], [1.0, 0.93, 0.72], [0.55, 0.83, 0.78], [1.0, 0.98, 0.92]];
    const swag = (x0, x1, y, sag) => {
      const n = 7;
      for (let i = 0; i < n; i += 1) {
        const f = (i + 0.5) / n;
        const x = x0 + (x1 - x0) * f;
        const yy = y - Math.sin(f * Math.PI) * sag;
        const c = flagPalette[i % flagPalette.length];
        flagPos.push(x - 0.11, yy, 0, x + 0.11, yy, 0, x, yy - 0.24, 0);
        for (let k = 0; k < 3; k += 1) flagCol.push(c[0], c[1], c[2]);
      }
    };
    swag(-3.1, -0.1, 2.72, 0.3);
    swag(0.1, 3.1, 2.72, 0.3);
    const flagGeo = new THREE.BufferGeometry();
    flagGeo.setAttribute('position', new THREE.Float32BufferAttribute(flagPos, 3));
    flagGeo.setAttribute('color', new THREE.Float32BufferAttribute(flagCol, 3));
    const flagMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.ownedGeos.push(flagGeo);
    this.ownedMats.push(flagMat);
    const flags = new THREE.Mesh(flagGeo, flagMat);
    flags.position.z = -1.6;
    scene.add(flags);

    // back counter row + Tiny Treats bakery dressing (§G1.4 list)
    this.place(scene, 'kaykit-restaurant/kitchencounter_straight', -0.6, -1.85, 0, 0.95);
    this.place(scene, 'kaykit-restaurant/kitchencounter_sink', 0.55, -1.85, 0, 0.95);
    this.place(scene, 'kaykit-restaurant/kitchencounter_straight', 1.7, -1.85, 0, 0.95);
    const dress = (key, x, z, s, rotY = 0) => {
      const m = this.ctx.assets.getModel(key);
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const k = s / Math.max(size.x, size.y, size.z, 0.001);
      m.scale.setScalar(k);
      m.position.set(x, 0.97, z);
      m.rotation.y = rotY;
      scene.add(m);
      return m;
    };
    dress('bakery-interior/stand_mixer', -0.75, -1.8, 0.34, 0.4);
    dress('bakery-interior/scale', -0.25, -1.85, 0.26, -0.2);
    dress('bakery-interior/dough_rolled_A', 0.95, -1.8, 0.3, 0.3);
    dress('bakery-interior/dough_ball', 1.25, -1.82, 0.18);
    dress('bakery-interior/macaron_pink', 1.6, -1.8, 0.12);
    dress('bakery-interior/macaron_blue', 1.75, -1.84, 0.12);
    dress('bakery-interior/macaron_yellow', 1.9, -1.78, 0.12);
    this.place(scene, 'kaykit-restaurant/jar_A_medium', 0.35, -1.8, 0, 0.34).position.y = 0.97;
    this.place(scene, 'kaykit-restaurant/jar_C_small', 0.15, -1.84, 0, 0.26).position.y = 0.97;
    this.place(scene, 'kaykit-restaurant/crate_buns', 2.15, -1.95, 0.3, 0.42);

    // Tiny Treats display case + register front-right (shop corner)
    const caseM = this.ctx.assets.getModel('bakery-interior/display_case_long');
    const cb = new THREE.Box3().setFromObject(caseM);
    const cs = cb.getSize(new THREE.Vector3());
    caseM.scale.setScalar(1.0 / Math.max(0.01, cs.y));
    caseM.position.set(3.45, 0, 1.3);
    caseM.rotation.y = -Math.PI / 2;
    scene.add(caseM);
    dress('bakery-interior/cash_register', 3.45, 1.3 - 0.9, 0.3, -Math.PI / 2).position.y = 1.02;
    dress('baked-goods/croissant', 3.42, 1.25, 0.22, 0.4).position.y = 0.62;
    dress('baked-goods/cupcake', 3.45, 1.55, 0.2).position.y = 0.62;
    dress('baked-goods/cinnamon-roll', 3.42, 1.85, 0.2).position.y = 0.62;

    // hanging utensils strip over the back counter (§G1.4)
    const railMat = new THREE.MeshStandardMaterial({ color: '#6E5A48', roughness: 0.6, metalness: 0.3 });
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.6, 8), railMat);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0.55, 1.78, -1.8);
    this.ownedGeos.push(rail.geometry);
    this.ownedMats.push(railMat);
    scene.add(rail);
    const roller = dress('bakery-interior/dough_roller', -0.15, -1.8, 0.3);
    roller.position.set(-0.15, 1.62, -1.8);
    roller.rotation.z = Math.PI / 2;
    const hangJar = this.place(scene, 'kaykit-restaurant/jar_C_small', 1.15, -1.8, 0, 0.22);
    hangJar.position.y = 1.56;

    // order-window stools (customers sit back-left, tickets appear beside them)
    this.stoolTopY = 0.5;
    for (const seat of NPC.SEATS) {
      const stool = this.place(scene, 'kaykit-restaurant/chair_stool', seat.x, seat.z, 0, 0.52);
      const sb = new THREE.Box3().setFromObject(stool);
      this.stoolTopY = Math.max(0.3, sb.max.y);
    }
    this.place(scene, 'kaykit-restaurant/plate', -1.95, -1.15, 0, 0.05).position.y = 0.0;
  },

  buildBelt(scene) {
    // scrolling stripe texture — offset.x follows the SIGNED belt velocity
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 16;
    const g = canvas.getContext('2d');
    g.fillStyle = '#5B5350';
    g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#6E6663';
    g.fillRect(0, 0, 26, 16);
    this.beltTex = new THREE.CanvasTexture(canvas);
    this.beltTex.wrapS = this.beltTex.wrapT = THREE.RepeatWrapping;
    this.beltTex.repeat.set(11, 1);
    this.ownedTexs.push(this.beltTex);
    const beltMat = new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#8C6A4F', roughness: 0.8 });
    this.ownedMats.push(beltMat, frameMat);

    const top = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.06, 0.56), beltMat);
    top.position.set(0, G62.BELT_Y - 0.03, 0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6.62, 0.5, 0.68), frameMat);
    frame.position.set(0, G62.BELT_Y - 0.34, 0);
    this.ownedGeos.push(top.geometry, frame.geometry);
    scene.add(top, frame);
    // end rollers + legs
    const rollerMat = new THREE.MeshStandardMaterial({ color: '#4A423E', roughness: 0.55, metalness: 0.35 });
    this.ownedMats.push(rollerMat);
    const rollerGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.6, 12);
    this.ownedGeos.push(rollerGeo);
    for (const x of [-3.28, 3.28]) {
      const roller = new THREE.Mesh(rollerGeo, rollerMat);
      roller.rotation.x = Math.PI / 2;
      roller.position.set(x, G62.BELT_Y - 0.08, 0);
      scene.add(roller);
    }
    const legGeo = new THREE.BoxGeometry(0.1, 0.42, 0.5);
    this.ownedGeos.push(legGeo);
    for (const x of [-2.9, -1.5, 0, 1.5, 2.9]) {
      const leg = new THREE.Mesh(legGeo, frameMat);
      leg.position.set(x, 0.21, 0);
      scene.add(leg);
    }
    // low machine skirt: grounds the conveyor in the side view (the bare
    // floor band under the belt read empty in the CDP look shots)
    const skirtMat = new THREE.MeshStandardMaterial({ color: '#7A5B44', roughness: 0.9 });
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(6.62, 0.16, 0.6), skirtMat);
    skirt.position.set(0, 0.08, 0);
    this.ownedGeos.push(skirt.geometry);
    this.ownedMats.push(skirtMat);
    scene.add(skirt);
  },

  /** Overhead dispenser gantry + one nozzle rig per §G1.5 drop station. */
  buildNozzles(scene) {
    const gantryMat = new THREE.MeshStandardMaterial({ color: '#8C6A4F', roughness: 0.75 });
    this.ownedMats.push(gantryMat);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(6.62, 0.09, 0.14), gantryMat);
    beam.position.set(0, 2.02, 0);
    this.ownedGeos.push(beam.geometry);
    scene.add(beam);
    const postGeo = new THREE.BoxGeometry(0.12, 2.02, 0.12);
    this.ownedGeos.push(postGeo);
    for (const x of [-3.25, 3.25]) {
      const post = new THREE.Mesh(postGeo, gantryMat);
      post.position.set(x, 1.01, 0);
      scene.add(post);
    }

    /** @type {Record<string, {group: THREE.Group, spout: THREE.Mesh, squirtT: number}>} */
    this.nozzleRigs = {};
    const tipGeo = new THREE.CylinderGeometry(0.05, 0.075, 0.16, 10);
    const pipeGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8);
    this.ownedGeos.push(tipGeo, pipeGeo);
    for (const noz of NOZZLES) {
      const gp = new THREE.Group();
      const x = noz.s - 3.0;
      const accentHex = stationHex(noz.id);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: NOZZLE_BODY_HEX[noz.kind], roughness: 0.55,
      });
      const accentMat = new THREE.MeshStandardMaterial({
        color: accentHex, roughness: 0.45, emissive: accentHex, emissiveIntensity: 0.15,
      });
      this.ownedMats.push(bodyMat, accentMat);
      let body;
      if (noz.kind === 'teig' || noz.kind === 'guss') {
        body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.34, 12), accentMat);
      } else if (noz.kind === 'deko') {
        body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.26), accentMat);
      } else {
        body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.28), accentMat);
      }
      this.ownedGeos.push(body.geometry);
      body.position.y = 1.72;
      const pipe = new THREE.Mesh(pipeGeo, bodyMat);
      pipe.position.y = 1.95; // hangs the hopper off the gantry beam (2.02)
      const spout = new THREE.Mesh(tipGeo, bodyMat);
      spout.position.y = 1.47;
      const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.1, 8), bodyMat);
      this.ownedGeos.push(lip.geometry);
      lip.position.y = 1.36;
      gp.add(body, pipe, spout, lip);
      gp.position.set(x, 0, 0);
      scene.add(gp);
      this.nozzleRigs[noz.id] = { group: gp, spout, squirtT: 0 };
    }
  },

  /** §G1.5 oven tunnel (s 2.25–3.15) with the vertical bake meter. */
  buildOven(scene) {
    const x0 = G62.OVEN_IN - 3.0;
    const x1 = G62.OVEN_OUT - 3.0;
    const cx = (x0 + x1) / 2;
    const w = x1 - x0;
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#B0563A', roughness: 0.8 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#6E3A28', roughness: 0.85 });
    this.ownedMats.push(bodyMat, darkMat);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.34, 0.8), bodyMat);
    roof.position.set(cx, 1.32, 0);
    // front wall with a viewing slit (pans peek through while baking)
    const lip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.1, 0.06), darkMat);
    lip.position.set(cx, 0.78, 0.38);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.19, 0.06), darkMat);
    brow.position.set(cx, 1.06, 0.38);
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.6, 0.06), darkMat);
    back.position.set(cx, 1.02, -0.38);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 10), darkMat);
    chimney.position.set(cx + 0.25, 1.6, -0.15);
    this.ownedGeos.push(roof.geometry, lip.geometry, brow.geometry, back.geometry, chimney.geometry);
    scene.add(roof, lip, brow, back, chimney);
    // inner glow plane (slit) — opacity follows the meter
    const glowMat = new THREE.MeshBasicMaterial({
      color: '#FF8A3C', transparent: true, opacity: 0.25, depthWrite: false,
    });
    this.ovenGlowMat = glowMat;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, 0.17), glowMat);
    glow.position.set(cx, 0.92, 0.37);
    this.ownedGeos.push(glow.geometry);
    this.ownedMats.push(glowMat);
    scene.add(glow);
    // the KayKit oven sits behind as dressing
    this.place(scene, 'kaykit-restaurant/oven', cx, -1.05, 0, 1.2);

    // vertical bake meter on the tunnel face (§G1.5: green zone marked)
    const meter = new THREE.Group();
    const mBgMat = new THREE.MeshBasicMaterial({ color: '#3A2B22' });
    const mGreenMat = new THREE.MeshBasicMaterial({ color: '#5CB85C', transparent: true, opacity: 0.55 });
    const mFillMat = new THREE.MeshBasicMaterial({ color: '#F2762E' });
    this.ownedMats.push(mBgMat, mGreenMat, mFillMat);
    const mH = 0.52;
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(0.09, mH), mBgMat);
    const greenFrac = (G62.BAKE_GREEN_MAX - G62.BAKE_GREEN_MIN) / this.diff.singeAt;
    const greenY = ((G62.BAKE_GREEN_MIN + G62.BAKE_GREEN_MAX) / 2 / this.diff.singeAt - 0.5) * mH;
    const green = new THREE.Mesh(new THREE.PlaneGeometry(0.09, mH * greenFrac), mGreenMat);
    green.position.set(0, greenY, 0.002);
    this.ovenFill = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 1), mFillMat);
    this.ovenFill.scale.y = 0.001;
    this.ovenFill.position.set(0, -mH / 2, 0.004);
    this.ownedGeos.push(bg.geometry, green.geometry, this.ovenFill.geometry);
    meter.add(bg, green, this.ovenFill);
    meter.position.set(x1 + 0.14, 1.06, 0.4);
    scene.add(meter);
    this.ovenMeterH = mH;
    this.ovenMeter = meter;
  },

  /** Spawn pan stack (left), ship box + trash bin (edges). */
  buildEnds(scene) {
    // pan stack beside the spawn spot
    const stack = new THREE.Group();
    const stackMat = new THREE.MeshStandardMaterial({ color: '#9AA0A8', roughness: 0.45, metalness: 0.55 });
    this.ownedMats.push(stackMat);
    const stackGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.05, 16);
    this.ownedGeos.push(stackGeo);
    for (let i = 0; i < 3; i += 1) {
      const p = new THREE.Mesh(stackGeo, stackMat);
      p.position.y = 0.03 + i * 0.06;
      stack.add(p);
    }
    stack.position.set(G62.SPAWN_S - 3.0, G62.BELT_Y, -0.55);
    scene.add(stack);

    // shipping box at the far right (§G1.5 versand) — pink ribbon
    const boxMat = new THREE.MeshStandardMaterial({ color: '#C99B66', roughness: 0.85 });
    const ribbonMat = new THREE.MeshStandardMaterial({ color: '#FF7BA9', roughness: 0.5 });
    this.ownedMats.push(boxMat, ribbonMat);
    const shipBox = new THREE.Group();
    const wallGeoX = new THREE.BoxGeometry(0.56, 0.3, 0.05);
    const wallGeoZ = new THREE.BoxGeometry(0.05, 0.3, 0.56);
    const floorGeo = new THREE.BoxGeometry(0.56, 0.05, 0.56);
    this.ownedGeos.push(wallGeoX, wallGeoZ, floorGeo);
    const bf = new THREE.Mesh(floorGeo, boxMat);
    bf.position.y = 0.03;
    const w1 = new THREE.Mesh(wallGeoX, boxMat);
    w1.position.set(0, 0.18, 0.26);
    const w2 = new THREE.Mesh(wallGeoX, boxMat);
    w2.position.set(0, 0.18, -0.26);
    const w3 = new THREE.Mesh(wallGeoZ, boxMat);
    w3.position.set(0.26, 0.18, 0);
    const w4 = new THREE.Mesh(wallGeoZ, boxMat);
    w4.position.set(-0.26, 0.18, 0);
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.08), ribbonMat);
    this.ownedGeos.push(ribbon.geometry);
    ribbon.position.set(0, 0.17, 0);
    shipBox.add(bf, w1, w2, w3, w4, ribbon);
    shipBox.position.set(3.35, G62.BELT_Y - 0.06, 0.05);
    scene.add(shipBox);
    this.shipBoxGroup = shipBox;

    // trash bin under the belt's left edge (§G1.5 trash row)
    const binMat = new THREE.MeshStandardMaterial({ color: '#5A6470', roughness: 0.6, metalness: 0.3 });
    this.ownedMats.push(binMat);
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.42, 14, 1, true), binMat);
    bin.material.side = THREE.DoubleSide;
    this.ownedGeos.push(bin.geometry);
    bin.position.set(-3.5, 0.21, 0.15);
    scene.add(bin);
    this.trashBin = bin;
  },

  // -------------------------------------------------- procedural cake meshes
  buildCakeSharedResources() {
    this.candleGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.12, 8);
    this.candleMat = new THREE.MeshStandardMaterial({ color: '#F7E7C8', roughness: 0.7 });
    const flameCanvas = document.createElement('canvas');
    flameCanvas.width = flameCanvas.height = 32;
    const g = flameCanvas.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,240,180,1)');
    grad.addColorStop(0.5, 'rgba(255,170,60,0.9)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    const flameTex = new THREE.CanvasTexture(flameCanvas);
    this.flameMat = new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false });
    this.ownedTexs.push(flameTex);
    this.cherryMat = new THREE.MeshStandardMaterial({ color: '#D6293A', roughness: 0.35 });
    this.stemMat = new THREE.MeshStandardMaterial({ color: '#2E7D32', roughness: 0.7 });
    this.cherryGeo = new THREE.SphereGeometry(0.055, 12, 10);
    this.stemGeo = new THREE.CylinderGeometry(0.008, 0.01, 0.09, 6);
    this.sprinkleGeo = new THREE.BoxGeometry(0.045, 0.016, 0.016);
    this.sprinkleMats = SPRINKLE_COLORS.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 })
    );
    this.panMat = new THREE.MeshStandardMaterial({ color: '#9AA0A8', roughness: 0.45, metalness: 0.55 });
    this.dropGeo = new THREE.SphereGeometry(0.075, 10, 8);
    this.splatGeo = new THREE.CircleGeometry(0.17, 16);
    this.ownedGeos.push(
      this.candleGeo, this.cherryGeo, this.stemGeo, this.sprinkleGeo, this.dropGeo, this.splatGeo
    );
    this.ownedMats.push(
      this.candleMat, this.flameMat, this.cherryMat, this.stemMat, this.panMat, ...this.sprinkleMats
    );
  },

  /** Cached layer geometry per (shape, height, footprint) — 36-combo rule. */
  layerGeo(shape, h, xy) {
    const key = `${shape}:${h}:${xy}`;
    let geo = this.geoCache.get(key);
    if (geo) return geo;
    if (shape === 'round') {
      geo = new THREE.CylinderGeometry(xy * 0.47, xy * 0.5, h, 24);
    } else if (shape === 'square') {
      geo = new THREE.BoxGeometry(xy * 0.9, h, xy * 0.9);
    } else {
      const s = new THREE.Shape();
      s.moveTo(25, 25);
      s.bezierCurveTo(25, 25, 20, 0, 0, 0);
      s.bezierCurveTo(-30, 0, -30, 35, -30, 35);
      s.bezierCurveTo(-30, 55, -10, 77, 25, 95);
      s.bezierCurveTo(60, 77, 80, 55, 80, 35);
      s.bezierCurveTo(80, 35, 80, 0, 50, 0);
      s.bezierCurveTo(35, 0, 25, 25, 25, 25);
      geo = new THREE.ExtrudeGeometry(s, { depth: h / (xy / 110), bevelEnabled: false });
      geo.scale(xy / 110, xy / 110, xy / 110);
      geo.rotateX(Math.PI / 2);
      geo.center();
      geo.rotateY(Math.PI); // heart tip toward the camera
    }
    this.geoCache.set(key, geo);
    this.ownedGeos.push(geo);
    return geo;
  },

  /** Build the view group of a freshly spawned pan (§G1.5 spawn). */
  makePanView(pan) {
    const group = new THREE.Group();
    const panMesh = new THREE.Mesh(this.layerGeo(pan.shape, 0.06, 0.6), this.panMat);
    panMesh.position.y = 0.03;
    group.add(panMesh);
    this.ctx.scene.add(group);
    const view = {
      group, pan: panMesh, sponge: null, icing: null, toppings: null, candles: [],
      spongeMat: null, icingMat: null, wiggleT: 0, dying: false,
    };
    this.panViews.set(pan.id, view);
    // spawn pop
    group.scale.setScalar(0.2);
    tween({
      from: 0.2, to: 1, duration: 0.24, ease: easings.easeOutBack,
      onUpdate: (v) => group.scale.setScalar(v),
    });
    return view;
  },

  /** Pop-in a component mesh on the engine `catch` events. */
  applyComponentVisual(pan, view, kind, value) {
    const pop = (obj) => {
      const target = obj.scale.x || 1;
      tween({
        from: 0.2, to: target, duration: 0.24, ease: easings.easeOutBack,
        onUpdate: (v) => obj.scale.setScalar(v),
      });
    };
    if (kind === 'teig') {
      view.spongeMat = new THREE.MeshStandardMaterial({ color: SPONGE_HEX[value], roughness: 0.85 });
      this.ownedMats.push(view.spongeMat);
      view.sponge = new THREE.Mesh(this.layerGeo(pan.shape, 0.2, 0.56), view.spongeMat);
      view.sponge.position.y = 0.16;
      view.group.add(view.sponge);
      pop(view.sponge);
    } else if (kind === 'guss') {
      view.icingMat = new THREE.MeshStandardMaterial({ color: ICING_HEX[value], roughness: 0.5 });
      this.ownedMats.push(view.icingMat);
      view.icing = new THREE.Mesh(this.layerGeo(pan.shape, 0.07, 0.6), view.icingMat);
      view.icing.position.y = 0.3;
      view.group.add(view.icing);
      pop(view.icing);
    } else if (kind === 'deko') {
      view.toppings = new THREE.Group();
      const topY = view.icing ? 0.36 : 0.28;
      if (value === 'cherry') {
        const c = new THREE.Mesh(this.cherryGeo, this.cherryMat);
        c.position.y = 0.05;
        const stem = new THREE.Mesh(this.stemGeo, this.stemMat);
        stem.position.set(0.02, 0.13, 0);
        stem.rotation.z = -0.35;
        view.toppings.add(c, stem);
      } else if (value === 'sprinkles') {
        for (let i = 0; i < 6; i += 1) {
          const sp = new THREE.Mesh(this.sprinkleGeo, this.sprinkleMats[i % this.sprinkleMats.length]);
          const a = (i / 6) * Math.PI * 2 + 0.5;
          sp.position.set(Math.cos(a) * 0.14, 0.012, Math.sin(a) * 0.14);
          sp.rotation.y = a * 2.3;
          view.toppings.add(sp);
        }
      } else if (value === 'berries') {
        for (const dx of [-0.1, 0.1]) {
          const b = this.ctx.assets.getModel('food-kit/strawberry');
          const box = new THREE.Box3().setFromObject(b);
          const size = box.getSize(new THREE.Vector3());
          b.scale.setScalar(0.12 / Math.max(size.x, size.y, size.z, 0.001));
          b.position.set(dx, 0.005, 0.02 * (dx > 0 ? -1 : 1));
          view.toppings.add(b);
        }
      }
      view.toppings.position.y = topY;
      view.group.add(view.toppings);
      pop(view.toppings);
    } else if (kind === 'kerzen') {
      const i = view.candles.length;
      const holder = new THREE.Group();
      const stick = new THREE.Mesh(this.candleGeo, this.candleMat);
      stick.position.y = 0.06;
      const flame = new THREE.Sprite(this.flameMat);
      flame.scale.setScalar(0.09);
      flame.position.y = 0.15;
      holder.add(stick, flame);
      const a = (i / G62.MAX_CANDLES) * Math.PI * 2 + 0.8;
      const baseY = view.icing ? 0.34 : view.sponge ? 0.26 : 0.06;
      holder.position.set(Math.cos(a) * 0.16, baseY, Math.sin(a) * 0.16);
      view.group.add(holder);
      view.candles.push(holder);
      pop(holder);
    }
  },

  /** Bake tint (§G1.5): pale keeps the raw hue, perfect goldens, singed chars. */
  applyBakeVisual(view, result) {
    if (!view.spongeMat) return;
    const c = view.spongeMat.color;
    if (result === 'perfect') c.lerp(new THREE.Color('#C88A3F'), 0.42);
    if (result === 'singed') c.lerp(new THREE.Color('#2E2018'), 0.68);
  },

  destroyPanView(panId) {
    const view = this.panViews.get(panId);
    if (!view) return;
    view.group.parent?.remove(view.group);
    this.panViews.delete(panId);
  },

  // ----------------------------------------------------------------- DOM UI
  uiRoot() {
    return document.getElementById('ui') ?? document.body;
  },

  /** Ticket pictogram row + the §G1.4 belt overview strip under it. */
  buildTopDom() {
    this.topEl = document.createElement('div');
    this.topEl.className = 'g62-top';
    const tickets = document.createElement('div');
    tickets.className = 'g62-tickets';
    const strip = document.createElement('div');
    strip.className = 'g62-strip';
    strip.setAttribute('aria-label', t('mg.cake4.strip'));
    // station glyphs at their s positions (display only — §G1.4)
    const glyphs = [
      [G62.SPAWN_S, '🥘'],
      [(G62.OVEN_IN + G62.OVEN_OUT) / 2, '🔥'],
      [G62.SHIP_S, '📦'],
      [5.6, '🕯'],
    ];
    for (const noz of NOZZLES) {
      if (noz.kind === 'kerzen') continue;
      const dot = document.createElement('span');
      dot.className = 'g62-strip-st';
      dot.style.left = `${(noz.s / G62.BELT_LEN) * 100}%`;
      dot.style.background = stationHex(noz.id);
      strip.appendChild(dot);
    }
    for (const [s, ch] of glyphs) {
      const el = document.createElement('span');
      el.className = 'g62-strip-glyph';
      el.style.left = `${(s / G62.BELT_LEN) * 100}%`;
      el.textContent = ch;
      strip.appendChild(el);
    }
    this.stripWinEl = document.createElement('div');
    this.stripWinEl.className = 'g62-strip-win';
    strip.appendChild(this.stripWinEl);
    this.topEl.append(tickets, strip);
    this.uiRoot().appendChild(this.topEl);
    this.ticketsEl = tickets;
    this.stripEl = strip;
    /** @type {Map<number, {el: HTMLElement, fill: HTMLElement}>} */
    this.ticketEls = new Map();
    /** @type {Map<number, HTMLElement>} pan id → strip dot */
    this.stripDots = new Map();
  },

  /** §G1.7 control bar: hold pedals + projected station dock. */
  buildControlBar() {
    const root = this.uiRoot();
    const mkPedal = (cls, glyph, aria, dir) => {
      const b = document.createElement('button');
      b.className = `g62-pedal ${cls}`;
      b.innerHTML = `<span aria-hidden="true">${glyph}</span>`;
      b.setAttribute('aria-label', aria);
      b.title = aria;
      const on = (ev) => {
        ev.preventDefault();
        b.setPointerCapture?.(ev.pointerId);
        this.setPedal(dir, true);
        b.classList.add('g62-held');
      };
      const off = () => {
        this.setPedal(dir, false);
        b.classList.remove('g62-held');
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (ev) => ev.preventDefault());
      root.appendChild(b);
      return b;
    };
    this.pedalBackEl = mkPedal('g62-pedal-back', '◀', t('mg.cake4.pedal.back'), -1);
    this.pedalFwdEl = mkPedal('g62-pedal-fwd', '▶', t('mg.cake4.pedal.fwd'), 1);

    // desktop nicety: arrow keys drive the pedals (still 100 % button-driven)
    this.onKey = (ev) => {
      if (ev.repeat) return;
      const down = ev.type === 'keydown';
      if (ev.key === 'ArrowLeft') this.setPedal(-1, down);
      else if (ev.key === 'ArrowRight') this.setPedal(1, down);
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);

    // station dock — every button built once, projected/culled per frame
    this.dockEl = document.createElement('div');
    this.dockEl.className = 'g62-dock';
    root.appendChild(this.dockEl);
    /** @type {Map<string, {el: HTMLElement, noz: object|null}>} */
    this.dockBtns = new Map();
    const dockBtn = (id, className, html, aria, onTap) => {
      const b = document.createElement('button');
      b.className = className;
      b.innerHTML = html;
      b.setAttribute('aria-label', aria);
      b.title = aria;
      b.style.display = 'none';
      b.addEventListener('pointerdown', (ev) => ev.preventDefault()); // no focus scroll
      b.addEventListener('click', onTap);
      this.dockEl.appendChild(b);
      return b;
    };
    // shape cycle + spawn pair (far left when the spawn station is in view)
    this.shapeBtn = dockBtn('shape', 'g62-drop g62-shape', `<span class="g62-shape-glyph">${SHAPE_GLYPH[this.spawnShape]}</span>`, t('mg.cake4.shape'), () => {
      const i = SHAPES.indexOf(this.spawnShape);
      this.spawnShape = SHAPES[(i + 1) % SHAPES.length];
      this.ctx?.audio.play('ui.tap');
      this.syncSpawnButton();
    });
    this.spawnBtn = dockBtn('spawn', 'g62-drop g62-spawnbtn', buttonSvg('pan'), t('mg.cake4.spawn'), () => this.queuePress('spawn'));
    for (const noz of NOZZLES) {
      const ariaKey = noz.kind === 'teig' ? `mg.cake.sponge.${noz.value}`
        : noz.kind === 'guss' ? `mg.cake.icing.${noz.value}`
          : noz.kind === 'deko' ? `mg.cake.top.${noz.value}`
            : 'mg.cake.st.kerzen';
      const svg = noz.kind === 'teig' ? buttonSvg('sponge', SPONGE_HEX[noz.value])
        : noz.kind === 'guss' ? buttonSvg('icing', ICING_HEX[noz.value])
          : noz.kind === 'deko' ? buttonSvg(noz.value)
            : buttonSvg('candle');
      const el = dockBtn(noz.id, 'g62-drop', svg, t(ariaKey), () => this.queuePress(noz.id));
      el.style.setProperty('--g62-face', stationHex(noz.id));
      this.dockBtns.set(noz.id, { el, noz });
    }
    this.shipBtn = dockBtn('versand', 'g62-drop g62-ship', `📦 ${t('mg.cake4.ship')}`, t('mg.cake4.ship'), () => this.queueShip());
    this.remPx = 16;
    this.remRefresh = 0;
  },

  setPedal(dir, on) {
    if (dir < 0) this.pedal.back = on;
    else this.pedal.fwd = on;
    this.pedalBackEl?.classList.toggle('g62-held', this.pedal.back);
    this.pedalFwdEl?.classList.toggle('g62-held', this.pedal.fwd);
  },

  queuePress(id) {
    if (this.phase !== 'play' || this.paused) return;
    if (this.pressQueue.length < 4) this.pressQueue.push(id);
  },

  queueShip() {
    if (this.phase !== 'play' || this.paused) return;
    this.shipQueued = true;
  },

  syncSpawnButton() {
    const glyphEl = this.shapeBtn?.querySelector('.g62-shape-glyph');
    if (glyphEl) glyphEl.textContent = SHAPE_GLYPH[this.spawnShape];
  },

  /** The §G1.4 camera window edges (world x at z = 0). */
  cameraWindow() {
    const cam = this.ctx.camera;
    const halfH = Math.tan((cam.fov * Math.PI) / 360) * G62.CAM_Z;
    const halfW = halfH * cam.aspect;
    return { left: this.camX - halfW, right: this.camX + halfW, halfW };
  },

  /** Target vertical FOV: the spec FOV, widened so the §G1.4 window fits. */
  targetFov() {
    const wide = innerWidth >= G62.WIDE_PX;
    const specFov = wide ? G62.CAM_FOV_WIDE : G62.CAM_FOV;
    const window = wide ? G62.CAM_WINDOW_WIDE : G62.CAM_WINDOW;
    const aspect = this.ctx.camera.aspect || 1;
    const needV = (2 * Math.atan(window / 2 / G62.CAM_Z / aspect) * 180) / Math.PI;
    return Math.max(specFov, needV);
  },

  /** §G1.4 focus pan: nearest to an actionable station, else last touched. */
  focusPanX() {
    const pans = this.engine.line.pans ?? [];
    if (pans.length === 0) return -G62.CAM_CLAMP; // show the spawn end
    let best = null;
    let bestDist = Infinity;
    for (const pan of pans) {
      let panBest = Infinity;
      if (pan.sponge == null) {
        for (const noz of NOZZLES) if (noz.kind === 'teig') panBest = Math.min(panBest, Math.abs(pan.s - noz.s));
      } else if (pan.bake == null) {
        panBest = Math.abs(pan.s - (G62.OVEN_IN + G62.OVEN_OUT) / 2);
      } else {
        for (const noz of NOZZLES) {
          if (dropLegal(noz.kind, pan)) panBest = Math.min(panBest, Math.abs(pan.s - noz.s));
        }
        panBest = Math.min(panBest, Math.abs(pan.s - G62.SHIP_S));
      }
      if (panBest < bestDist) {
        bestDist = panBest;
        best = pan;
      }
    }
    if (bestDist > 1.6 && this.lastTouchedPanId != null) {
      const touched = pans.find((p) => p.id === this.lastTouchedPanId);
      if (touched) best = touched;
    }
    return (best ?? pans[0]).s - 3.0;
  },

  updateCamera(dt) {
    const cam = this.ctx.camera;
    const fov = this.targetFov();
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    const target = Math.max(-G62.CAM_CLAMP, Math.min(G62.CAM_CLAMP, this.focusPanX()));
    const k = 1 - Math.exp(-G62.CAM_K * dt);
    this.camX += (target - this.camX) * k;
    cam.position.set(this.camX, G62.CAM_Y, G62.CAM_Z);
    cam.lookAt(this.camX, G62.CAM_LOOK_Y, 0);
  },

  /** Project world x (on the belt line) to viewport px. */
  projectX(worldX) {
    const v = new THREE.Vector3(worldX, G62.BELT_Y + 0.3, 0).project(this.ctx.camera);
    return (v.x * 0.5 + 0.5) * innerWidth;
  },

  /** §G1.7 dock layout: in-view buttons under their projected nozzle x. */
  updateDock() {
    this.remRefresh -= 1;
    if (this.remRefresh <= 0) {
      this.remRefresh = 30;
      const fs = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
      if (Number.isFinite(fs) && fs > 4) this.remPx = fs;
      this.dockRect = this.dockEl.getBoundingClientRect();
    }
    const rect = this.dockRect ?? this.dockEl.getBoundingClientRect();
    const win = this.cameraWindow();
    const btnW = Math.max(56, Math.min(3.5 * this.remPx, innerWidth * 0.16));
    const gap = 0.5 * this.remPx;
    const line = this.engine.line;
    const pans = line.pans ?? [];

    // spawn pair (far left) — §G1.5: greys out at the pan cap
    const spawnInView = G62.SPAWN_S - 3.0 >= win.left - 0.2 && G62.SPAWN_S - 3.0 <= win.right + 0.2;
    const cap = line.panCap ?? panCapAt(line.serves ?? 0, this.diff);
    const capped = pans.length >= cap;
    let leftEdge = 0;
    for (const [i, el] of [this.shapeBtn, this.spawnBtn].entries()) {
      el.style.display = spawnInView ? '' : 'none';
      if (spawnInView) {
        el.style.transform = `translate(${leftEdge}px, -50%)`;
        el.style.width = `${btnW}px`;
        el.style.height = `${btnW}px`;
        leftEdge += btnW + gap * 0.5;
        if (i === 1) {
          el.classList.toggle('g62-off', capped);
          el.disabled = capped;
        }
      }
    }
    if (spawnInView) leftEdge += gap * 0.5;

    // Versand (far right, min 4.5 rem wide, pink) — §G1.7
    const shipInView = G62.SHIP_S - 3.0 >= win.left - 0.2 && G62.SHIP_S - 3.0 <= win.right + 0.2;
    const shipW = Math.max(btnW, 4.5 * this.remPx);
    let rightEdge = rect.width;
    this.shipBtn.style.display = shipInView ? '' : 'none';
    if (shipInView) {
      rightEdge = rect.width - shipW - gap;
      this.shipBtn.style.transform = `translate(${rect.width - shipW}px, -50%)`;
      this.shipBtn.style.width = `${shipW}px`;
      this.shipBtn.style.height = `${btnW}px`;
      const ready = pans.some((p) => p.bake != null && Math.abs(p.s - G62.SHIP_S) <= G62.SHIP_HALF);
      this.shipBtn.classList.toggle('g62-ready', ready);
    }

    // drop nozzles in view → actionable first (a pan sits in/near their catch
    // window with a legal drop — the button the player NEEDS must survive the
    // cap), then nearest-to-center; cap 4 (<412 px) / 5 AND by the row width
    // actually left between the spawn pair and Versand (320 px @ 130 % fits
    // only 2 beside the spawn pair — §G1.7 ≥56 px beats button count)
    const fitN = Math.max(1, Math.floor((rightEdge - leftEdge + gap) / (btnW + gap)));
    const maxN = Math.min(innerWidth >= G62.WIDE_PX ? 5 : 4, fitN);
    const actionable = (n) =>
      pans.some((p) => Math.abs(p.s - n.s) <= 0.6 && dropLegal(n.kind, p));
    const inView = NOZZLES
      .filter((n) => n.s - 3.0 >= win.left - 0.15 && n.s - 3.0 <= win.right + 0.15)
      .map((n) => ({ n, hot: actionable(n), d: Math.abs(n.s - 3.0 - this.camX) }))
      .sort((a, b) => (a.hot === b.hot ? a.d - b.d : a.hot ? -1 : 1))
      .slice(0, maxN)
      .map((e) => e.n)
      .sort((a, b) => a.s - b.s);
    const shown = new Set(inView.map((n) => n.id));
    const xs = [];
    for (const noz of inView) {
      const px = this.projectX(noz.s - 3.0) - rect.left - btnW / 2;
      xs.push(Math.max(leftEdge, Math.min(rightEdge - btnW, px)));
    }
    for (let i = 1; i < xs.length; i += 1) xs[i] = Math.max(xs[i], xs[i - 1] + btnW + gap);
    for (let i = xs.length - 1; i >= 0; i -= 1) {
      const limit = i === xs.length - 1 ? rightEdge - btnW : xs[i + 1] - btnW - gap;
      xs[i] = Math.min(xs[i], limit);
    }
    for (const [id, entry] of this.dockBtns) {
      const idx = inView.findIndex((n) => n.id === id);
      if (idx < 0) {
        if (!shown.has(id)) entry.el.style.display = 'none';
        continue;
      }
      entry.el.style.display = '';
      entry.el.style.width = `${btnW}px`;
      entry.el.style.height = `${btnW}px`;
      entry.el.style.transform = `translate(${xs[idx]}px, -50%)`;
      // dim nozzles that would buzz right now (readability aid, still tappable)
      const pans2 = pans;
      const legalNow = pans2.some(
        (p) => Math.abs(p.s - entry.noz.s) <= this.diff.catchHalf && dropLegal(entry.noz.kind, p)
      );
      entry.el.classList.toggle('g62-live', legalNow);
    }
  },

  syncTicketsDom() {
    const tickets = this.engine.line.tickets ?? [];
    const seen = new Set();
    for (const tk of tickets) {
      seen.add(tk.id);
      let entry = this.ticketEls.get(tk.id);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'g62-ticket';
        el.innerHTML = `${ticketSvg(tk.spec)}<div class="g62-tk-bar"><div class="g62-tk-fill"></div></div>`;
        this.ticketsEl.appendChild(el);
        entry = { el, fill: el.querySelector('.g62-tk-fill') };
        this.ticketEls.set(tk.id, entry);
        requestAnimationFrame(() => el.classList.add('g62-in'));
        if (!this.npcs.has(tk.id)) this.spawnNpc(tk.id); // NPC per customer (§C9.1)
      }
      const patience = tk.patience || 1;
      const frac = Math.max(0, (tk.remain ?? 0) / patience);
      entry.fill.style.width = `${(frac * 100).toFixed(1)}%`;
      entry.fill.style.background =
        frac > 0.5 ? '#7CC15E' : frac > 0.25 ? '#F5A623' : '#D64545';
    }
    for (const [id, entry] of this.ticketEls) {
      if (!seen.has(id)) {
        entry.el.remove();
        this.ticketEls.delete(id);
        // safety net: resolve a still-seated NPC whose ticket vanished
        if (this.npcs.has(id)) this.resolveNpc(id, 'expired');
      }
    }
  },

  /** §G1.4 overview strip: pan dots + oven pulse + camera-window highlight. */
  updateStrip() {
    const line = this.engine.line;
    const pans = line.pans ?? [];
    const seen = new Set();
    for (const pan of pans) {
      seen.add(pan.id);
      let dot = this.stripDots.get(pan.id);
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'g62-strip-dot';
        this.stripEl.appendChild(dot);
        this.stripDots.set(pan.id, dot);
      }
      dot.style.left = `${(Math.max(0, Math.min(G62.BELT_LEN, pan.s)) / G62.BELT_LEN) * 100}%`;
      dot.style.background = pan.sponge ? SPONGE_HEX[pan.sponge] : '#E9E2D8';
      const hot = pan.inOven === true && (pan.bakeT || 0) >= G62.BAKE_GREEN_MIN;
      dot.classList.toggle('g62-hot', hot);
    }
    for (const [id, dot] of this.stripDots) {
      if (!seen.has(id)) {
        dot.remove();
        this.stripDots.delete(id);
      }
    }
    const win = this.cameraWindow();
    const l = Math.max(0, ((win.left + 3.0) / G62.BELT_LEN) * 100);
    const r = Math.min(100, ((win.right + 3.0) / G62.BELT_LEN) * 100);
    this.stripWinEl.style.left = `${l}%`;
    this.stripWinEl.style.width = `${Math.max(0, r - l)}%`;
  },

  // -------------------------------------------------------------- NPC layer
  /** Grant the single animation token (§C9.7 cap) or queue for it. */
  requestAnim(npc) {
    if (this.animOwner == null) {
      this.animOwner = npc;
      return true;
    }
    if (this.animOwner !== npc && !this.animQueue.includes(npc)) this.animQueue.push(npc);
    return this.animOwner === npc;
  },

  releaseAnim(npc) {
    if (this.animOwner === npc) this.animOwner = null;
    else {
      const i = this.animQueue.indexOf(npc);
      if (i >= 0) this.animQueue.splice(i, 1);
    }
    while (this.animOwner == null && this.animQueue.length > 0) {
      const next = this.animQueue.shift();
      if (next && this.npcAlive(next)) this.animOwner = next;
    }
  },

  npcAlive(npc) {
    for (const n of this.npcs.values()) if (n === npc) return true;
    return this.exitingNpcs?.includes(npc) ?? false;
  },

  /** Play a clip exclusively on this npc's mixer. */
  npcPlay(npc, name, { loop = true, timeScale = 1 } = {}) {
    const action = npc.actions[name];
    if (!action) return null;
    npc.mixer.stopAllAction();
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = timeScale;
    action.play();
    return action;
  },

  spawnNpc(ticketId) {
    const seatIdx = this.seatTaken.indexOf(false);
    const key = CHAR_KEYS[this.npcCharIdx % CHAR_KEYS.length];
    this.npcCharIdx += 1;
    const model = this.ctx.assets.getSkinnedModel(key);
    model.scale.setScalar(NPC.SCALE);
    model.position.set(NPC.DOOR.x, 0, NPC.DOOR.z);
    this.ctx.scene.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const clips = this.ctx.assets.getAnimations(key);
    const pick = (n) => clips.find((c) => c.name === n) ?? null;
    const actions = {};
    for (const [id, clipName] of Object.entries({
      walk: 'Walking_A', sit: 'Sit_Chair_Idle', cheer: 'Cheer', idle: 'Idle',
    })) {
      const clip = pick(clipName);
      if (clip) actions[id] = mixer.clipAction(clip);
    }
    const npc = {
      ticketId, seatIdx: seatIdx >= 0 ? seatIdx : 1, model, mixer, actions,
      state: 'waitEnter', t: 0,
    };
    if (seatIdx >= 0) this.seatTaken[seatIdx] = true;
    this.npcPlay(npc, 'idle');
    mixer.update(0.05);
    this.npcs.set(ticketId, npc);
    return npc;
  },

  /** Move npc toward (x, z); returns true when arrived. Faces the direction. */
  npcWalkTowards(npc, x, z, dt) {
    const p = npc.model.position;
    const dx = x - p.x;
    const dz = z - p.z;
    const dist = Math.hypot(dx, dz);
    const step = NPC.WALK_SPEED * dt;
    npc.model.rotation.y = Math.atan2(dx, dz);
    if (dist <= step) {
      p.set(x, 0, z);
      return true;
    }
    p.x += (dx / dist) * step;
    p.z += (dz / dist) * step;
    return false;
  },

  /** Resolve a seated customer: serve outcome or expiry → cheer/sad exit. */
  resolveNpc(ticketId, outcome) {
    const npc = this.npcs.get(ticketId);
    if (!npc) return;
    this.npcs.delete(ticketId);
    this.seatTaken[npc.seatIdx] = false;
    this.exitingNpcs.push(npc);
    npc.outcome = outcome;
    npc.state = outcome === 'perfect' || outcome === 'oneWrong' ? 'cheerWait' : 'sadWait';
    npc.t = 0;
  },

  /** V3/FIX-E P1-2: free a removed NPC's per-clone skeleton boneTexture. */
  disposeNpcResources(npc) {
    npc.mixer.stopAllAction();
    npc.mixer.uncacheRoot(npc.model);
    npc.model.traverse((obj) => {
      if (obj.isSkinnedMesh && obj.skeleton) obj.skeleton.dispose();
    });
  },

  removeNpc(npc) {
    this.releaseAnim(npc);
    this.ctx.scene.remove(npc.model);
    this.disposeNpcResources(npc);
    const i = this.exitingNpcs?.indexOf(npc) ?? -1;
    if (i >= 0) this.exitingNpcs.splice(i, 1);
  },

  updateNpcs(dt) {
    const all = [...this.npcs.values(), ...(this.exitingNpcs ?? [])];
    for (const npc of all) {
      const seat = NPC.SEATS[npc.seatIdx];
      switch (npc.state) {
        case 'waitEnter':
          if (this.requestAnim(npc)) {
            npc.state = 'enter';
            this.npcPlay(npc, 'walk');
          }
          break;
        case 'enter':
          if (this.npcWalkTowards(npc, seat.x, seat.z, dt)) {
            npc.state = 'seated';
            npc.model.rotation.y = 0; // face the belt (+z)
            npc.model.position.y = Math.max(0, this.stoolTopY - 0.3);
            this.npcPlay(npc, 'sit');
            npc.mixer.update(0.4); // settle into the pose …
            this.releaseAnim(npc); // … then FREEZE (§C9.7 seated cap)
          }
          break;
        case 'seated':
          break; // frozen pose — mixer not advanced
        case 'cheerWait':
          if (this.requestAnim(npc)) {
            npc.state = 'cheer';
            npc.t = 0;
            this.npcPlay(npc, 'cheer', { loop: false });
          }
          break;
        case 'cheer':
          npc.t += dt;
          if (npc.t >= NPC.CHEER_SEC) {
            npc.state = 'exit';
            npc.model.position.y = 0;
            this.npcPlay(npc, 'walk');
          }
          break;
        case 'sadWait':
          if (this.requestAnim(npc)) {
            npc.state = 'exit';
            npc.model.position.y = 0;
            this.npcPlay(npc, 'walk', { timeScale: 0.75 }); // sad trudge out
          }
          break;
        case 'exit':
          if (this.npcWalkTowards(npc, NPC.DOOR.x, NPC.DOOR.z, dt)) {
            this.removeNpc(npc);
          }
          break;
        default:
          break;
      }
    }
    // §C9.7 hard cap: exactly ONE mixer advances per frame
    if (this.animOwner) this.animOwner.mixer.update(dt);
  },

  // ------------------------------------------------------------- event pump
  /** Drain engine events → sfx, banners, floats, juice, NPC wiring. */
  processEvents(events) {
    const ctx = this.ctx;
    for (const e of events) {
      const panId = e.panId ?? e.cakeId ?? null;
      switch (e.type) {
        case 'ticketNew':
        case 'order': {
          ctx.audio.play('cake.order');
          ctx.hud.banner(t('mg.cake.newOrder'));
          break; // NPC spawn rides syncTicketsDom (engine-agnostic)
        }
        case 'panSpawn':
        case 'spawn': {
          const pan = (this.engine.line.pans ?? []).find((p) => p.id === panId) ?? e.pan;
          if (pan) this.makePanView(pan);
          this.lastTouchedPanId = panId;
          ctx.audio.play('ui.tap');
          break;
        }
        case 'drop': {
          this.spawnDropVisual(e.station ?? e.stationId);
          ctx.audio.play(e.kind === 'kerzen' ? 'cake.candle' : 'cake.apply');
          break;
        }
        case 'catch':
        case 'apply': {
          const station = e.station ?? e.stationId ?? '';
          const noz = NOZZLES.find((n) => n.id === station) ?? null;
          const kind = e.kind ?? noz?.kind ?? String(station).split('.')[0];
          const value = e.value ?? noz?.value ?? null;
          const pan = (this.engine.line.pans ?? []).find((p) => p.id === panId) ?? e.pan;
          const view = this.panViews.get(panId);
          if (pan && view) this.applyComponentVisual(pan, view, kind, value);
          this.lastTouchedPanId = panId;
          ctx.audio.play(kind === 'kerzen' ? 'cake.candle' : 'cake.apply');
          if (view) this.particles.emit('sparkles', view.group.position.clone().add(new THREE.Vector3(0, 0.45, 0)), { count: 4 });
          break;
        }
        case 'splat': {
          ctx.audio.play('cake.splat');
          ctx.hud.banner(t('mg.cake4.splat'));
          const x = (e.s ?? 3.0) - 3.0;
          this.floats.spawn('−2', new THREE.Vector3(x, 1.15, 0.2), '#D64570');
          break; // decal itself syncs from line.splats
        }
        case 'buzz': {
          ctx.audio.play('ui.error');
          ctx.hud.banner(t('mg.cake4.buzz'));
          const view = this.panViews.get(panId);
          if (view) view.wiggleT = 0.45; // §G1.5 friendly pan wiggle
          break;
        }
        case 'bakeStart':
        case 'ovenStart':
          break; // glow/meter ride updateOven
        case 'bakeCommit':
        case 'bake': {
          const view = this.panViews.get(panId);
          if (view) this.applyBakeVisual(view, e.result);
          const pos = view?.group.position.clone().add(new THREE.Vector3(0, 0.5, 0))
            ?? new THREE.Vector3(-0.3, 1.3, 0.3);
          if (e.result === 'perfect') {
            ctx.audio.play('cake.ovenDing');
            ctx.hud.banner(t('mg.cake.bakePerfect'));
            this.floats.spawn('+5', pos, '#2E8B57');
            if (view) this.particles.emit('sparkles', pos, { count: 8 });
          } else if (e.result === 'singed') {
            ctx.audio.play('ui.error');
            ctx.hud.banner(t('mg.cake.bakeSinged'));
            this.floats.spawn('−3', pos, '#D64570');
            if (view) this.particles.emit('dizzyStars', pos, { count: 5 }); // singe smoke beat
          } else {
            ctx.audio.play('cake.ovenDing');
          }
          break;
        }
        case 'serve':
        case 'reject':
          this.onServeEvent({ ...e, outcome: e.outcome ?? (e.type === 'reject' ? 'rejected' : 'perfect'), panId });
          break;
        case 'expire': {
          ctx.audio.play('ui.error');
          ctx.hud.banner(t('mg.cake.expired'));
          this.resolveNpc(e.ticketId, 'expired');
          this.gooby.setEmotion('sad');
          this.emotionT = 1.2;
          if (this.endless) this.failCount += 1;
          break;
        }
        case 'trash': {
          ctx.audio.play('cake.splat');
          ctx.hud.banner(t('mg.cake4.trash'));
          this.onTrashVisual(panId);
          break;
        }
        default:
          break;
      }
    }
  },

  onServeEvent(e) {
    const ctx = this.ctx;
    const view = this.panViews.get(e.panId);
    const shipPos = new THREE.Vector3(G62.SHIP_S - 3.0, G62.BELT_Y + 0.3, 0.1);
    this.counters.cakesServed += 1;
    if (e.outcome === 'perfect') this.counters.perfectCakes += 1;
    if (e.outcome === 'rejected') {
      this.counters.rejected += 1;
      if (this.endless) this.failCount += 1;
      ctx.audio.play('cake.splat');
      ctx.hud.banner(t('mg.cake.rejected'));
      this.particles.emit('dizzyStars', shipPos, { count: 8 });
      this.gooby.setEmotion('sad');
      this.gooby.play('sadSlump'); // §G1.5 Gooby facepalm beat
      this.emotionT = 1.6;
      if (view) {
        const group = view.group;
        view.dying = true;
        tween({
          from: 1, to: 0.12, duration: 0.3, ease: easings.easeOutQuad,
          onUpdate: (v) => group.scale.set(2 - v, v, 2 - v),
          onComplete: () => this.destroyPanView(e.panId),
        });
      }
    } else {
      ctx.audio.play('cake.serve');
      ctx.hud.banner(t(e.outcome === 'perfect' ? 'mg.cake.perfect' : 'mg.cake.oneWrong', { pts: e.points }));
      if (e.outcome === 'perfect') {
        this.particles.emit('confetti', shipPos, { count: 12 });
        this.gooby.setEmotion('ecstatic');
        this.gooby.play('happyBounce');
        this.emotionT = 1.6;
      }
      if (view) {
        // the finished cake hops into the shipping box
        const group = view.group;
        view.dying = true;
        const from = group.position.clone();
        const to = this.shipBoxGroup.position.clone().add(new THREE.Vector3(0, 0.25, 0));
        tween({
          from: 0, to: 1, duration: 0.45, ease: easings.easeInOutQuad,
          onUpdate: (v) => {
            group.position.lerpVectors(from, to, v);
            group.position.y += Math.sin(v * Math.PI) * 0.55;
            group.scale.setScalar(1 - v * 0.45);
          },
          onComplete: () => this.destroyPanView(e.panId),
        });
        // box bounce
        const box = this.shipBoxGroup;
        tween({
          from: 0, to: 1, duration: 0.35, ease: easings.easeOutQuad,
          onUpdate: (v) => box.scale.setScalar(1 + Math.sin(v * Math.PI) * 0.12),
        });
      }
    }
    if (typeof e.points === 'number') {
      this.floats.spawn(
        e.points >= 0 ? `+${e.points}` : `−${Math.abs(e.points)}`,
        shipPos.clone().add(new THREE.Vector3(0.15, 0.35, 0)),
        e.points >= 0 ? '#2E8B57' : '#D64570'
      );
    }
    this.resolveNpc(e.ticketId, e.outcome);
    // §C9.5 meta counters (stickerBook watches counters.perfectCakes)
    try {
      const engine = getAchievementsEngine();
      engine?.track?.('cakesServed', 1);
      if (e.outcome === 'perfect') engine?.track?.('perfectCakes', 1);
    } catch (err) {
      console.warn('[purblePlace] counter tracking failed:', err);
    }
  },

  /** Trash juice: the dumped pan tips off the left edge into the bin. */
  onTrashVisual(panId) {
    const view = this.panViews.get(panId);
    if (!view) return;
    view.dying = true;
    const group = view.group;
    const from = group.position.clone();
    const to = this.trashBin.position.clone().add(new THREE.Vector3(0, 0.15, 0));
    tween({
      from: 0, to: 1, duration: 0.4, ease: easings.easeInQuad,
      onUpdate: (v) => {
        group.position.lerpVectors(from, to, v);
        group.rotation.z = v * 1.8;
        group.scale.setScalar(1 - v * 0.5);
      },
      onComplete: () => {
        this.particles.emit('crumbs', to.clone().add(new THREE.Vector3(0, 0.25, 0)), { count: 6 });
        this.destroyPanView(panId);
      },
    });
  },

  /** Cosmetic falling blob at a nozzle (§G1.5 squirt + 0.45 s fall). */
  spawnDropVisual(stationId) {
    const noz = NOZZLES.find((n) => n.id === stationId);
    if (!noz) return;
    const rig = this.nozzleRigs[stationId];
    if (rig) rig.squirtT = G62.SQUIRT_SEC;
    const mat = new THREE.MeshStandardMaterial({ color: stationHex(stationId), roughness: 0.5 });
    this.ownedMats.push(mat);
    let mesh;
    if (noz.kind === 'kerzen') {
      mesh = new THREE.Mesh(this.candleGeo, this.candleMat);
    } else {
      mesh = new THREE.Mesh(this.dropGeo, mat);
      if (noz.kind === 'guss') mesh.scale.set(1.2, 0.8, 1.2);
    }
    mesh.position.set(noz.s - 3.0, G62.BELT_Y + G62.FALL_H + 0.08, 0);
    this.ctx.scene.add(mesh);
    this.dropViews.push({ mesh, mat, t: 0, x: noz.s - 3.0 });
  },

  updateDropVisuals(dt) {
    for (let i = this.dropViews.length - 1; i >= 0; i -= 1) {
      const d = this.dropViews[i];
      d.t += dt;
      const f = Math.min(1, d.t / G62.FALL_SEC);
      d.mesh.position.y = G62.BELT_Y + G62.FALL_H + 0.08 - f * f * (G62.FALL_H + 0.02);
      if (d.t >= G62.FALL_SEC) {
        d.mesh.parent?.remove(d.mesh);
        this.dropViews.splice(i, 1);
      }
    }
    // nozzle squirt anim decay
    for (const rig of Object.values(this.nozzleRigs)) {
      if (rig.squirtT > 0) {
        rig.squirtT -= dt;
        const f = Math.max(0, rig.squirtT / G62.SQUIRT_SEC);
        rig.spout.scale.setScalar(1 + Math.sin(f * Math.PI) * 0.35);
      } else if (rig.spout.scale.x !== 1) {
        rig.spout.scale.setScalar(1);
      }
    }
  },

  /** Splat decals mirror line.splats (they ride the belt — §G1.5). */
  syncSplats() {
    const splats = this.engine.line.splats ?? [];
    const seen = new Set();
    for (const sp of splats) {
      seen.add(sp);
      let mesh = this.splatViews.get(sp);
      if (!mesh) {
        const mat = new THREE.MeshBasicMaterial({
          color: stationHex(sp.station), transparent: true, opacity: 0.9, depthWrite: false,
        });
        this.ownedMats.push(mat);
        mesh = new THREE.Mesh(this.splatGeo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.scale.set(1, 0.7, 1);
        this.ctx.scene.add(mesh);
        this.splatViews.set(sp, mesh);
      }
      mesh.position.set((sp.s ?? 0) - 3.0, G62.BELT_Y + 0.012, 0.05);
      const life = Math.max(0, 1 - (sp.age ?? 0) / G62.SPLAT_SEC);
      mesh.material.opacity = 0.35 + life * 0.55;
    }
    for (const [sp, mesh] of this.splatViews) {
      if (!seen.has(sp)) {
        mesh.parent?.remove(mesh);
        this.splatViews.delete(sp);
      }
    }
  },

  /** Position pan views from belt-space + §G1.5 buzz wiggle. */
  syncPanViews(dt) {
    const pans = this.engine.line.pans ?? [];
    const alive = new Set();
    for (const pan of pans) {
      alive.add(pan.id);
      const view = this.panViews.get(pan.id) ?? this.makePanView(pan);
      if (view.dying) continue;
      beltPoint(pan.s, view.group.position);
      if (view.wiggleT > 0) {
        view.wiggleT -= dt;
        view.group.rotation.z = Math.sin(view.wiggleT * 40) * 0.08 * Math.max(0, view.wiggleT / 0.45);
      } else if (view.group.rotation.z !== 0) {
        view.group.rotation.z = 0;
      }
    }
    for (const id of [...this.panViews.keys()]) {
      const view = this.panViews.get(id);
      if (!alive.has(id) && !view.dying) {
        view.dying = true;
        setTimeout(() => this.destroyPanView(id), 600);
      }
    }
  },

  /** Oven meter fill + glow + light (§G1.5 meter zones). */
  updateOven() {
    const pans = this.engine.line.pans ?? [];
    let baking = null;
    for (const pan of pans) {
      if (pan.inOven && (baking == null || (pan.bakeT || 0) > (baking.bakeT || 0))) baking = pan;
    }
    const frac = baking ? Math.min(1, (baking.bakeT || 0) / this.diff.singeAt) : 0;
    this.ovenFill.scale.y = Math.max(0.001, frac * this.ovenMeterH);
    this.ovenFill.position.y = -this.ovenMeterH / 2 + (frac * this.ovenMeterH) / 2;
    const inGreen = baking && baking.bakeT >= G62.BAKE_GREEN_MIN && baking.bakeT <= G62.BAKE_GREEN_MAX;
    const past = baking && baking.bakeT > G62.BAKE_GREEN_MAX;
    this.ovenFill.material.color.set(inGreen ? '#5CB85C' : past ? '#D64545' : '#F2762E');
    this.ovenGlowMat.opacity = baking ? 0.35 + frac * 0.55 : 0.18;
    this.ovenLight.intensity = baking ? 14 + frac * 20 : 6;
    if (past) {
      // red pulse while overbaking (§G1.4 strip pairs with this)
      const pulse = 0.5 + Math.sin(performance.now() / 90) * 0.5;
      this.ovenGlowMat.opacity = 0.45 + pulse * 0.5;
    }
  },

  // ---------------------------------------------------------------- update
  onPause() {
    this.paused = true;
    this.setPedal(-1, false);
    this.setPedal(1, false);
  },

  onResume() {
    this.paused = false;
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);

    if (this.phase === 'ending') {
      this.updateNpcs(dt);
      this.updateDropVisuals(dt);
      this.endT += dt;
      if (this.endT >= 1.4 && this.phase !== 'done') {
        this.phase = 'done';
        const line = this.engine.line;
        ctx.onEnd({
          score: line.score ?? this.reportedScore,
          meta: {
            cakesServed: line.cakesServed ?? this.counters.cakesServed,
            perfectCakes: line.perfectCakes ?? this.counters.perfectCakes,
            rejected: line.rejected ?? this.counters.rejected,
          },
        });
      }
      return;
    }

    // ── assemble the §G1.9 input (bot in ?autoplay=1, else pedals/buttons) ──
    const stepDt = Math.min(dt, 0.25); // SwiftShader frame spikes
    let input;
    if (this.pilot) {
      input = this.pilot.plan(this.engine.line, stepDt) ?? { belt: 0, press: null, spawnShape: null, ship: false };
    } else {
      const belt = (this.pedal.fwd ? 1 : 0) + (this.pedal.back ? -1 : 0); // both = 0 (§G1.5 safety)
      const press = this.pressQueue.shift() ?? null;
      input = {
        belt,
        press,
        spawnShape: press === 'spawn' ? this.spawnShape : null,
        ship: this.shipQueued,
      };
      this.shipQueued = false;
    }

    // ── engine step (30 Hz substeps keep the fall/catch math stable) ────────
    /** @type {Array<object>} */
    const events = [];
    let rest = stepDt;
    let first = true;
    while (rest > 1e-6) {
      const h = Math.min(rest, 1 / 30);
      const sub = first ? input : { ...input, press: null, ship: false, spawnShape: null };
      const out = this.engine.step(h, sub);
      if (Array.isArray(out)) events.push(...out);
      first = false;
      rest -= h;
    }
    this.processEvents(events);

    // score mirror → framework HUD (engine clamps at 0 — forward deltas)
    const scoreNow = this.engine.line.score ?? 0;
    if (scoreNow !== this.reportedScore) {
      ctx.onScore(scoreNow - this.reportedScore);
      this.reportedScore = scoreNow;
    }

    // timer / endless end (§G5.4 row: 3 rejected/expired end it)
    const over = this.engine.line.over === true
      || (this.endless && this.failCount >= G62.ENDLESS_FAILS);
    const remaining = this.endless ? Infinity : G62.DURATION_SEC - elapsed;
    ctx.hud.setTime(this.endless ? elapsed : remaining);

    // Gooby emotion decay back to happy
    if (this.emotionT != null && this.emotionT > 0) {
      this.emotionT -= dt;
      if (this.emotionT <= 0) this.gooby.setEmotion('happy');
    }

    // visuals
    this.syncPanViews(dt);
    this.syncSplats();
    this.updateDropVisuals(dt);
    this.updateOven();
    this.updateCamera(dt);
    this.syncTicketsDom();
    this.updateStrip();
    this.updateDock();
    this.updateNpcs(dt);
    this.beltTex.offset.x += (this.engine.line.beltV ?? 0) * dt * 1.9;

    // Gooby watches the focus pan
    const pans = this.engine.line.pans ?? [];
    let watch = null;
    for (const pan of pans) {
      if (watch == null || pan.s > watch.s) watch = pan;
    }
    if (watch) {
      this.gooby.lookAt(new THREE.Vector3(watch.s - 3.0, G62.BELT_Y + 0.4, 0));
    } else {
      this.gooby.lookAt(null);
    }

    if (import.meta.env?.DEV) {
      this.maxDrawCalls = Math.max(this.maxDrawCalls, ctx.renderer?.info?.render?.calls ?? 0);
    }

    if (remaining <= 0 || over) {
      this.phase = 'ending';
      ctx.audio.play('ui.win');
      if (over && this.endless) ctx.hud.banner(t('mg.cake4.endless.done'));
      this.gooby.setEmotion('ecstatic');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.2, 0)), { count: 16 });
      if (this.autoplay) {
        const line = this.engine.line;
        console.log(
          `[purblePlace] autoplay run ended — engine ${this.engine.kind}, score ${line.score}, ` +
          `served ${line.cakesServed ?? this.counters.cakesServed}, ` +
          `perfect ${line.perfectCakes ?? this.counters.perfectCakes}, ` +
          `rejected ${line.rejected ?? this.counters.rejected}, expired ${line.expired ?? '?'}, ` +
          `maxDrawCalls ${this.maxDrawCalls}`
        );
      }
    }
  },

  // --------------------------------------------------------------- dispose
  dispose() {
    this.topEl?.remove();
    this.dockEl?.remove();
    this.pedalBackEl?.remove();
    this.pedalFwdEl?.remove();
    if (this.onKey) {
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('keyup', this.onKey);
      this.onKey = null;
    }
    this.ticketEls?.clear();
    this.stripDots?.clear();
    for (const npc of [...(this.npcs?.values() ?? []), ...(this.exitingNpcs ?? [])]) {
      this.ctx?.scene?.remove(npc.model);
      this.disposeNpcResources(npc);
    }
    this.npcs?.clear();
    this.exitingNpcs = [];
    this.animOwner = null;
    this.animQueue = [];
    for (const d of this.dropViews ?? []) d.mesh.parent?.remove(d.mesh);
    this.dropViews = [];
    for (const mesh of this.splatViews?.values() ?? []) mesh.parent?.remove(mesh);
    this.splatViews?.clear();
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
    this.geoCache?.clear();
    this.panViews?.clear();
    // restore the persisted radio wish (context playback ends with the game)
    if (this.musicContextOn) {
      try {
        const radio = this.ctx?.audio?.radio;
        const wish = getStore()?.get?.('radio');
        if (wish?.playing === true) radio?.start?.();
        else radio?.stop?.();
      } catch { /* headless/no-store contexts */ }
      this.musicContextOn = false;
    }
    if (import.meta.env?.DEV && window.__purble?.game === this) delete window.__purble;
    this.engine = null;
    this.pilot = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): purble is 100 % button-driven (§G1.7) — inverting is nonsense here
