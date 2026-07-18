// V3/G33 — Core-UX pure logic (PLAN3 §B3/§B4/§C1/§C2/§C4): UI-scale steps,
// volume-slider row metadata, the hidden dev-gate tap counter and the
// fake-notch inset values. PURE module: no three.js/DOM imports — node:test
// runs it headlessly (test/coreux.test.js); the DOM appliers live in
// ui/settingsScreen.js. All numbers here are the binding §B3/§B9/§C2 values
// (module-local frozen consts per §E0.1-2 — constants.js stays read-only).

/** The 4 legal UI-scale steps (§B3/§C1.1). */
export const UI_SCALES = Object.freeze([85, 100, 115, 130]);

/** Default UI scale (§C1.1). */
export const UI_SCALE_DEFAULT = 100;

/** Root font-size baseline the rem sweep divides by (§B3). */
export const ROOT_FONT_PX = 16;

/**
 * Clamp/validate a persisted uiScale to the 4 legal values (§B1 rule 5:
 * illegal → 100). Defensive default until G34's save schema lands (§E0.1-11).
 * @param {*} v raw settings.uiScale
 * @returns {85|100|115|130}
 */
export function normalizeUiScale(v) {
  const n = Number(v);
  return UI_SCALES.includes(n) ? /** @type {85|100|115|130} */ (n) : UI_SCALE_DEFAULT;
}

/**
 * Root font-size in px for a uiScale step (§B3: 16 · scale/100).
 * @param {number} scale 85|100|115|130
 * @returns {number} px
 */
export function rootFontPx(scale) {
  return (ROOT_FONT_PX * normalizeUiScale(scale)) / 100;
}

/** §C2.2 binding slider defaults (mirrored by G34's save schema §B1). */
export const VOLUME_DEFAULTS = Object.freeze({
  master: 80,
  sfx: 100,
  music: 70,
  voice: 100,
  ambience: 80,
});

/**
 * §C2.1 slider rows in binding order. `mute` names the v2 quick-mute boolean
 * shown right of the slider (§C2.3 semantics live in G32's audio.js).
 * @type {ReadonlyArray<{key: string, labelKey: string, icon: string, mute?: string}>}
 */
export const VOLUME_ROWS = Object.freeze([
  Object.freeze({ key: 'master', labelKey: 'settings.vol.master', icon: 'bell' }),
  Object.freeze({ key: 'sfx', labelKey: 'settings.vol.sfx', icon: 'play', mute: 'sfx' }),
  Object.freeze({ key: 'music', labelKey: 'settings.vol.music', icon: 'music', mute: 'music' }),
  Object.freeze({ key: 'voice', labelKey: 'settings.vol.voice', icon: 'rabbit' }),
  Object.freeze({ key: 'ambience', labelKey: 'settings.vol.ambience', icon: 'sparkle' }),
]);

/**
 * Clamp/step a volume slider value: integer 0–100 (§B1 rule 5: illegal →
 * that slider's §C2.2 default).
 * @param {*} v raw value
 * @param {string} key volume key ('master'|'sfx'|'music'|'voice'|'ambience')
 * @returns {number} integer 0–100
 */
export function normalizeVolume(v, key) {
  const n = Number(v);
  if (!Number.isFinite(n)) return VOLUME_DEFAULTS[key] ?? 100;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Read the live volumes with defensive defaults (until G34's migrations[2]
 * writes settings.volumes — §E0.1-11 same-wave degradation).
 * @param {object|undefined} volumes raw settings.volumes slice (may be absent)
 * @returns {{master:number,sfx:number,music:number,voice:number,ambience:number}}
 */
export function volumesWithDefaults(volumes) {
  const src = volumes != null && typeof volumes === 'object' ? volumes : {};
  const out = {};
  for (const key of Object.keys(VOLUME_DEFAULTS)) {
    out[key] = normalizeVolume(key in src ? src[key] : VOLUME_DEFAULTS[key], key);
  }
  return out;
}

/** §B4 dev-gate numbers: 5 taps on „Auto" within a 4 s rolling window. */
export const DEV_GATE = Object.freeze({
  TAPS: 5,
  WINDOW_MS: 4000,
  IDLE_RESET_MS: 2000,
});

/**
 * Pure dev-gate tap counter (§B4/§C4.1): counts taps on the language „Auto"
 * segment; the counter resets on any other tap and on ≥ 2 s of inactivity;
 * a tap only counts while the last TAPS-1 taps fit the 4 s rolling window.
 * @returns {{tap: (atMs: number) => boolean, reset: () => void, count: () => number}}
 *   tap() returns true when this tap is the unlocking 5th.
 */
export function createDevGate() {
  /** @type {number[]} timestamps of counted „Auto" taps (rolling) */
  let taps = [];

  return {
    /**
     * Register an „Auto" tap.
     * @param {number} atMs
     * @returns {boolean} true when the gate fires (5th qualifying tap)
     */
    tap(atMs) {
      const last = taps[taps.length - 1];
      // 2 s inactivity resets the chain (§B4).
      if (last != null && atMs - last >= DEV_GATE.IDLE_RESET_MS) taps = [];
      taps.push(atMs);
      // 4 s rolling window: drop taps that fell out of it.
      taps = taps.filter((t) => atMs - t < DEV_GATE.WINDOW_MS);
      if (taps.length >= DEV_GATE.TAPS) {
        taps = [];
        return true;
      }
      return false;
    },
    /** Any other tap resets the counter (§B4). */
    reset() {
      taps = [];
    },
    /** @returns {number} current chain length (tests/debug) */
    count() {
      return taps.length;
    },
  };
}

/**
 * §B9/§C1.4 fake-notch inset values (iPhone 14 Pro): forced onto the root
 * `--safe-*` vars by the dev-panel toggle / `?notch=1` so the 40-combo layout
 * matrix runs in any browser.
 */
export const FAKE_NOTCH = Object.freeze({
  top: '59px',
  bottom: '34px',
  left: '0px',
  right: '0px',
});

/**
 * Arcade 2-column breakpoints (§C1.2): at 115/130 % the grid drops to 2
 * columns when viewportWidth / (uiScale/100) < 350 — i.e. below these
 * viewport widths. ≤ 100 % always keeps 3 columns.
 */
export const ARCADE_TWO_COL_MAX_PX = Object.freeze({ 115: 402, 130: 454 });
