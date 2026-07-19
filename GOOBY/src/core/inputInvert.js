// V4/G56 — „Steuerung invertieren" input proxy (PLAN4-GAMES §G3.3). The
// FRAMEWORK owns the mechanism (games stay dumb): when the launched game
// module exports `controls.invertible !== false` and a settings flag is on,
// the game's ctx.input is wrapped so ONLY directional payloads transform:
//
//   swipe               dir left↔right (invertX) / up↔down (invertY);
//                       dx/vx negated (invertX), dy/vy negated (invertY)
//   drag/dragstart/     nx/dx/vx negated (invertX); ny/dy/vy negated
//   dragend             (invertY). x/y client px stay RAW.
//   tap / hold / pick() pass through UNTOUCHED (picking stays screen-true).
//
// carController does NOT ride this proxy (own DOM zones + keys) — the car
// games pass `invertSteer: store.get('settings.controls.invertX')` into
// createCarController instead (G57's §G3.1-a contract).
//
// PURE module: no three.js/DOM imports — invertPayload is node-tested.

/** The §E5 events that carry direction and therefore transform. */
const DIRECTIONAL_EVENTS = Object.freeze(['swipe', 'drag', 'dragstart', 'dragend']);

/** swipe `dir` mirror tables. */
const FLIP_X = Object.freeze({ left: 'right', right: 'left' });
const FLIP_Y = Object.freeze({ up: 'down', down: 'up' });

/**
 * Transform ONE gesture payload per the §G3.3 table. Non-directional events
 * (tap, hold) and payloads with no flag set return the ORIGINAL object
 * untouched; transformed payloads are shallow copies (listeners may mutate
 * their copy without corrupting other subscribers).
 * @param {string} event §E5 event name ('swipe'|'drag'|'dragstart'|'dragend'|'tap'|'hold')
 * @param {import('./input.js').PointerPayload} p gesture payload
 * @param {{x?: boolean, y?: boolean}} invert active invert flags
 * @returns {import('./input.js').PointerPayload}
 */
export function invertPayload(event, p, invert = {}) {
  const ix = invert.x === true;
  const iy = invert.y === true;
  if ((!ix && !iy) || !DIRECTIONAL_EVENTS.includes(event) || p == null) return p;
  const out = { ...p };
  if (ix) {
    if (typeof out.dx === 'number') out.dx = -out.dx;
    if (typeof out.vx === 'number') out.vx = -out.vx;
    if (event === 'swipe') {
      if (out.dir in FLIP_X) out.dir = FLIP_X[out.dir];
    } else if (typeof out.nx === 'number') {
      out.nx = -out.nx; // analog axis (drag family) — §G2.1 rule 2 mirrored
    }
  }
  if (iy) {
    if (typeof out.dy === 'number') out.dy = -out.dy;
    if (typeof out.vy === 'number') out.vy = -out.vy;
    if (event === 'swipe') {
      if (out.dir in FLIP_Y) out.dir = FLIP_Y[out.dir];
    } else if (typeof out.ny === 'number') {
      out.ny = -out.ny;
    }
  }
  return out;
}

/**
 * Wrap a (scoped) §E5 input emitter so subscriptions receive inverted
 * directional payloads. `pick` and `removeAll` delegate untouched — pick must
 * stay screen-true (§G3.3) and the sceneManager keeps calling removeAll on
 * the UNDERLYING scoped emitter, which still owns every subscription.
 * Flags are read per event via `getInvert()` so a settings change applies to
 * the running game without rewiring.
 * @param {{on: Function, off: Function, pick?: Function, removeAll?: Function}} input
 * @param {() => {x?: boolean, y?: boolean}} getInvert live flag reader
 * @returns {typeof input} same-shaped emitter
 */
export function wrapInvertInput(input, getInvert) {
  /** @type {Map<string, Map<Function, Function>>} event → original cb → wrapped cb */
  const wrapped = new Map();

  return {
    ...input,
    on(event, cb) {
      if (!DIRECTIONAL_EVENTS.includes(event)) return input.on(event, cb);
      const proxy = (p) => cb(invertPayload(event, p, getInvert()));
      if (!wrapped.has(event)) wrapped.set(event, new Map());
      wrapped.get(event).set(cb, proxy);
      const off = input.on(event, proxy);
      return () => {
        wrapped.get(event)?.delete(cb);
        off();
      };
    },
    off(event, cb) {
      const proxy = wrapped.get(event)?.get(cb);
      if (proxy) {
        wrapped.get(event).delete(cb);
        input.off(event, proxy);
      } else {
        input.off(event, cb);
      }
    },
  };
}
