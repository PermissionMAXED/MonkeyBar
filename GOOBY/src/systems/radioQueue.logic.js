// GOOBY V4/G51 — pure radio queue logic (PLAN4 §B2.4): station filtering,
// level locks, per-track enable/trim math, the seeded shuffle order and
// skip/next stepping. No DOM/three/WebAudio imports — node-testable; the
// MediaElement engine (src/audio/radio.js) is a thin consumer.
//
// Rules implemented here (all binding):
//   · level locks — tracks with unlockLevel > player level never enter the
//     queue (owner folders Radio/Level N + Radio/LockedbyLevel/Level N)
//   · per-track enable — trims[id].on === false skips a track (§C-SYS1.5)
//   · all-disabled fallback (§C-SYS1.5): a station whose level-eligible
//     tracks are ALL disabled plays them anyway (flagged for G52's one-time
//     "Alle Tracks aus — Station spielt trotzdem" toast) — silence is never
//     persisted
//   · seeded shuffle (§B2.4): mulberry32 on (save seed × station), so the
//     order is stable per save+station but different across stations
//   · trim math (§B2.3): effective gain = manifest.gainTrim × (vol / 100),
//     vol 0–150 step 5 default 100

/** Persisted trim defaults (§B1 radio.trims is sparse — absent = default). */
export const TRIM_DEFAULT = Object.freeze({ vol: 100, on: true });
/** §C-SYS1.5 trim slider range. */
export const TRIM_VOL_MAX = 150;

/** mulberry32 — same generator family as audio.js/danceParty (§E8). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable tiny string hash (same recipe as the medley's context hash). */
export function hashStr(s) {
  let h = 0;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

/**
 * Sanitized per-track trim (§C-SYS1.5): vol clamped 0–150 (step 5, default
 * 100), on strict boolean default true.
 * @param {*} trims the sparse radio.trims map
 * @param {string} trackId
 * @returns {{vol: number, on: boolean}}
 */
export function trimFor(trims, trackId) {
  const row = trims && typeof trims === 'object' ? trims[trackId] : null;
  const raw = Number(row?.vol);
  const vol = Number.isFinite(raw)
    ? Math.max(0, Math.min(TRIM_VOL_MAX, Math.round(raw / 5) * 5))
    : TRIM_DEFAULT.vol;
  return { vol, on: row?.on !== false };
}

/**
 * §B2.3 effective per-track playback gain: manifest.gainTrim × (vol / 100).
 * @param {{gainTrim?: number}} track
 * @param {*} trims sparse radio.trims map
 * @returns {number}
 */
export function effectiveGain(track, trims) {
  const trim = Number.isFinite(Number(track?.gainTrim)) ? Number(track.gainTrim) : 1;
  return trim * (trimFor(trims, track?.id).vol / 100);
}

/**
 * Level + enable filter for one station's tracks, with the §C-SYS1.5
 * all-disabled fallback.
 * @param {ReadonlyArray<{id: string, unlockLevel?: number}>} tracks the
 *   station's member tracks (registry order)
 * @param {{level?: number, trims?: object}} [opts]
 * @returns {{tracks: Array<object>, allDisabled: boolean}}
 */
export function eligibleTracks(tracks, opts = {}) {
  const level = Math.max(1, Math.trunc(Number(opts.level) || 1));
  const unlocked = (Array.isArray(tracks) ? tracks : [])
    .filter((t) => Math.max(1, Math.trunc(Number(t?.unlockLevel) || 1)) <= level);
  const enabled = unlocked.filter((t) => trimFor(opts.trims, t.id).on);
  if (enabled.length === 0 && unlocked.length > 0) {
    return { tracks: unlocked, allDisabled: true }; // silence is never persisted
  }
  return { tracks: enabled, allDisabled: false };
}

/**
 * §B2.4 queue order: manifest order, or the seeded shuffle (mulberry32 on
 * save seed × station id) when shuffle is on. Pure Fisher-Yates — same
 * (seed, stationId, ids) always yields the same permutation.
 * @param {ReadonlyArray<string>} ids
 * @param {{shuffle?: boolean, seed?: number, stationId?: string}} [opts]
 * @returns {string[]}
 */
export function queueOrder(ids, opts = {}) {
  const list = [...(Array.isArray(ids) ? ids : [])];
  if (opts.shuffle === false || list.length < 2) return list;
  const rng = mulberry32((Number(opts.seed) >>> 0) ^ hashStr(opts.stationId ?? ''));
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Build the playable queue of a station in one step.
 * @param {ReadonlyArray<object>} stationTracks member tracks of the station
 * @param {{level?: number, trims?: object, shuffle?: boolean, seed?: number,
 *   stationId?: string}} [opts]
 * @returns {{ids: string[], allDisabled: boolean}}
 */
export function buildQueue(stationTracks, opts = {}) {
  const { tracks, allDisabled } = eligibleTracks(stationTracks, opts);
  return {
    ids: queueOrder(tracks.map((t) => t.id), opts),
    allDisabled,
  };
}

/**
 * Step the queue: the id after (dir=1) / before (dir=-1) `currentId`, with
 * wrap-around. An unknown/empty currentId starts at the queue head — this is
 * how `radio.lastTrack` continues the queue after a reload (§C-SYS1.3).
 * @param {ReadonlyArray<string>} queue
 * @param {string|null|undefined} currentId
 * @param {1|-1} [dir]
 * @returns {string|null}
 */
export function nextTrackId(queue, currentId, dir = 1) {
  if (!Array.isArray(queue) || queue.length === 0) return null;
  const at = queue.indexOf(String(currentId ?? ''));
  if (at < 0) return queue[0];
  return queue[(at + (dir === -1 ? queue.length - 1 : 1)) % queue.length];
}

export default {
  TRIM_DEFAULT, TRIM_VOL_MAX, mulberry32, hashStr, trimFor, effectiveGain,
  eligibleTracks, queueOrder, buildQueue, nextTrackId,
};
