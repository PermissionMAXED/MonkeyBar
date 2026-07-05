// Client state store — PLAN.md §2 (client/src/state/store.js).
// FROZEN SIGNATURE (P1): export function createStore()
//
// Tiny event-emitter store: get/set/on (+ update/push conveniences).
// Emits a change event per key on every set.
//
// Keys used by the UI layer (P5):
//   screen      'boot'|'mainMenu'|'lobbyBrowser'|'lobby'|'characterSelect'|
//               'settings'|'shop'|'game'|'results'|'profile'|'howToPlay'
//   profile     { name, monkeyId } — local identity, merged (R3) with the
//               server economy Profile (§10.2: coins, xp, level, xpToNext,
//               wins, matches, unlocked, equipped, stats) once `profile`
//               frames arrive; name/monkeyId always stay client-owned
//   catalogs    { roster, modes, maps, emotes, quickPhrases }   (from `welcome`)
//   playerId    string|null
//   roomList    RoomSummary[]
//   roomState   RoomState|null
//   snapshot    Snapshot|null            (maintained by ui/screens.js reducers)
//   turnInfo    { seat, deadline, canCall }|null
//   penaltyInfo { seat, chambers, coconuts, chipUsable, deadline }|null
//   matchResult { winnerSeat, standings }|null
//   lastRewards Rewards|null (§10.2) — post-match payout, private per seat;
//               cleared on gameStart (R3; rewards screen lands in R10)
//   modeData    Object|null — mode-scoped state folded from `modeEvent`
//               frames by ui/modes/index.js reduceByMode (R3); reset on
//               gameStart. Monkey Lies never writes it.
//   modeEvents  raw `modeEvent` log [{ kind, ...payload, ts }] (R3; capped
//               by store.push, reset on gameStart)
//   chatLog     [{ kind, seat, name, text, glyph, ts }]
//   connStatus  'connecting'|'open'|'reconnecting'|'closed'
//   prefs       { muted, volume, quality, reducedMotion }
//               (audio/engine/choreography flags, persisted; reducedMotion
//               makes gameClient's fastMode() skip long animations)
//   welcome     raw welcome payload (P1 compat)
//   connection  legacy P1 connection string (kept for compat)

const PREFS_KEY = 'mb_prefs';

const PREFS_DEFAULTS = { muted: false, volume: 0.8, quality: 'high', reducedMotion: false };

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...PREFS_DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* corrupted prefs -> defaults */
  }
  return { ...PREFS_DEFAULTS };
}

/**
 * @returns {{
 *   get: (key: string) => any,
 *   set: (key: string, value: any) => void,
 *   update: (key: string, fn: (value: any) => any) => void,
 *   push: (key: string, item: any, max?: number) => void,
 *   on: (key: string, fn: (value: any, prev: any) => void) => () => void,
 * }}
 */
export function createStore() {
  /** @type {Map<string, any>} */
  const state = new Map();
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  // ---- defaults ----
  state.set('screen', 'boot');
  state.set('profile', {
    name: localStorage.getItem('mb_name') || '',
    monkeyId: localStorage.getItem('mb_monkey') || 'rico',
  });
  state.set('catalogs', { roster: [], modes: [], maps: [], emotes: [], quickPhrases: [] });
  state.set('playerId', null);
  state.set('roomList', []);
  state.set('roomState', null);
  state.set('snapshot', null);
  state.set('turnInfo', null);
  state.set('penaltyInfo', null);
  state.set('matchResult', null);
  state.set('lastRewards', null);
  state.set('modeData', null);
  state.set('modeEvents', []);
  state.set('chatLog', []);
  state.set('connStatus', 'connecting');
  state.set('prefs', loadPrefs());

  const store = {
    get(key) {
      return state.get(key);
    },
    set(key, value) {
      const prev = state.get(key);
      if (prev === value) return;
      state.set(key, value);
      if (key === 'prefs') {
        try {
          localStorage.setItem(PREFS_KEY, JSON.stringify(value));
        } catch {
          /* storage full/blocked — prefs stay in-memory */
        }
      }
      const fns = listeners.get(key);
      if (fns) {
        for (const fn of [...fns]) fn(value, prev);
      }
    },
    /** Functional update: set(key, fn(current)). */
    update(key, fn) {
      store.set(key, fn(state.get(key)));
    },
    /** Append to an array key (new array reference), keeping at most `max` items. */
    push(key, item, max = 120) {
      const arr = [...(state.get(key) ?? []), item];
      if (arr.length > max) arr.splice(0, arr.length - max);
      store.set(key, arr);
    },
    on(key, fn) {
      let fns = listeners.get(key);
      if (!fns) {
        fns = new Set();
        listeners.set(key, fns);
      }
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };

  return store;
}
