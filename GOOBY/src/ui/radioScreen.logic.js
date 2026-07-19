// V4/G52 (PLAN4 §C-SYS1): pure radio-UI normalization and persistence helpers.
// Kept DOM/audio-free so station locks, cover fallbacks and sparse trims are
// exhaustively testable while G51's same-wave registry is still feature-detected.

export const RADIO_UI = Object.freeze({
  TRACK_PAGE_SIZE: 24,
  CHIP_VISIBLE_MS: 4000,
  DEFAULT_COVER: '/assets/GoobyMusic/covers/cover_default.png',
});

export const STATION_COVERS = Object.freeze({
  bordmusik: '/assets/GoobyMusic/covers/cover_station_cozy.png',
  'gooby-fm': '/assets/GoobyMusic/covers/cover_station_cozy.png',
  'recap-fm': '/assets/GoobyMusic/covers/cover_station_nacht.png',
  'game-fm': '/assets/GoobyMusic/covers/cover_station_arcade.png',
  alle: '/assets/GoobyMusic/covers/cover_default.png',
});

const FIXED_STATIONS = Object.freeze([
  Object.freeze({ id: 'bordmusik', nameKey: 'radio.station.bordmusik', unlockLevel: 1 }),
  Object.freeze({ id: 'gooby-fm', nameKey: 'radio.station.gooby-fm', unlockLevel: 1 }),
  Object.freeze({ id: 'recap-fm', nameKey: 'radio.station.recap-fm', unlockLevel: 5 }),
  Object.freeze({ id: 'game-fm', nameKey: 'radio.station.game-fm', unlockLevel: 8 }),
  Object.freeze({ id: 'alle', nameKey: 'radio.station.alle', unlockLevel: 1 }),
]);

/** @param {*} value @param {number} fallback @returns {number} */
const finite = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** @param {string} text @returns {string} */
export function slug(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'track';
}

/** Friendly title for manifests that only expose a path. @param {string} file */
export function titleFromFile(file) {
  let name = String(file ?? '').split('/').pop() ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // A literal '%' in a valid filename is still displayable as-is.
  }
  name = name.replace(/\.(mp3|ogg)$/i, '');
  const parts = name.split(' - ').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3 && /^treblo(?:\s*\(\d+\))?$/i.test(parts.at(-1))) {
    return parts.slice(1, -1).join(' — ');
  }
  if (parts.length >= 2 && /gooby/i.test(parts[0])) return parts.slice(1).join(' — ');
  return parts.length >= 2 ? parts.slice(1).join(' — ') : name;
}

/**
 * Resolve every documented manifest cover spelling to a public URL.
 * @param {*} cover
 * @returns {string}
 */
export function coverUrl(cover) {
  const value = typeof cover === 'string' ? cover.trim() : '';
  if (!value) return RADIO_UI.DEFAULT_COVER;
  if (/^(?:https?:)?\/\//.test(value) || value.startsWith('/')) return value;
  if (value.startsWith('assets/')) return `/${value}`;
  if (value.startsWith('GoobyMusic/')) return `/assets/${value}`;
  if (value.startsWith('covers/')) return `/assets/GoobyMusic/${value}`;
  return `/assets/GoobyMusic/covers/${value}`;
}

/**
 * Normalize G51 manifest/registry rows without depending on one export shape.
 * @param {*} row
 * @param {number} [index]
 */
export function normalizeTrack(row, index = 0) {
  const raw = row && typeof row === 'object' ? row : {};
  const file = String(raw.file ?? raw.url ?? raw.src ?? '');
  const title = String(raw.title ?? raw.name ?? titleFromFile(file) ?? `Track ${index + 1}`);
  const category = String(raw.category ?? raw.kind ?? '').toLowerCase();
  const source = String(raw.source ?? '').toLowerCase();
  const explicitStations = Array.isArray(raw.stationIds)
    ? raw.stationIds
    : Array.isArray(raw.stations)
      ? raw.stations.map((s) => typeof s === 'string' ? s : s?.id)
      : [raw.stationId ?? raw.station].filter(Boolean);
  const stationIds = explicitStations.map(String).filter(Boolean);
  return Object.freeze({
    ...raw,
    id: String(raw.id ?? slug(`${category || source}-${title}-${index}`)),
    title,
    file,
    category,
    source,
    durationSec: Math.max(0, finite(raw.durationSec ?? raw.duration, 0)),
    gainTrim: Math.max(0, finite(raw.gainTrim, 1)),
    cover: coverUrl(raw.cover),
    unlockLevel: Math.max(1, Math.trunc(finite(raw.unlockLevel ?? raw.level, 1))),
    stationIds: Object.freeze(stationIds),
  });
}

/** @param {ReturnType<typeof normalizeTrack>} track */
export function isStinger(track) {
  return track.category === 'stinger' || track.durationSec > 0 && track.durationSec < 10 ||
    /^stinger(?:-|$)/.test(track.id);
}

/** @param {string} id @returns {string} */
export function stationCover(id) {
  if (STATION_COVERS[id]) return STATION_COVERS[id];
  const key = String(id).toLowerCase();
  if (/garten|garden/.test(key)) return '/assets/GoobyMusic/covers/cover_station_garten.png';
  if (/city|stadt/.test(key)) return '/assets/GoobyMusic/covers/cover_station_city.png';
  if (/night|nacht|recap|epic/.test(key)) return '/assets/GoobyMusic/covers/cover_station_nacht.png';
  if (/game|arcade|spiel/.test(key)) return '/assets/GoobyMusic/covers/cover_station_arcade.png';
  if (/cozy|bord|radio|gooby/.test(key)) return '/assets/GoobyMusic/covers/cover_station_cozy.png';
  return RADIO_UI.DEFAULT_COVER;
}

/** @param {ReturnType<typeof normalizeTrack>} track @param {string} stationId */
export function trackBelongsTo(track, stationId) {
  if (isStinger(track)) return false;
  if (stationId === 'alle') return true;
  if (track.stationIds.includes(stationId)) return true;
  if (stationId === 'bordmusik') return track.source === 'builtin' && track.category !== 'recap';
  if (stationId === 'gooby-fm') return track.category === 'radio' || track.source === 'owner' && !track.category;
  if (stationId === 'recap-fm') return track.category === 'recap';
  if (stationId === 'game-fm') return track.category === 'game';
  return false;
}

/**
 * Build station cards from G51 metadata when available, otherwise from the
 * fixed §C-SYS1 station contract. Empty stations stay hidden.
 * @param {readonly object[]} rawTracks
 * @param {readonly object[]} [rawStations]
 */
export function deriveStations(rawTracks, rawStations = []) {
  const tracks = rawTracks.map((row, index) =>
    row?.stationIds && row?.cover ? row : normalizeTrack(row, index));
  const provided = Array.isArray(rawStations) ? rawStations : [];
  const defs = provided.length > 0 ? provided : FIXED_STATIONS;
  const stations = [];
  for (const raw of defs) {
    if (!raw) continue;
    const id = String(typeof raw === 'string' ? raw : raw.id ?? raw.slug ?? '');
    if (!id) continue;
    const listed = Array.isArray(raw.trackIds)
      ? new Set(raw.trackIds.map(String))
      : Array.isArray(raw.tracks)
        ? new Set(raw.tracks.map((track) => String(typeof track === 'string' ? track : track?.id)))
        : null;
    const count = tracks.filter((track) =>
      listed ? listed.has(track.id) : trackBelongsTo(track, id)).length;
    if (count === 0) continue;
    stations.push(Object.freeze({
      ...raw,
      id,
      nameKey: raw.nameKey ?? `radio.station.${id}`,
      name: raw.name ?? raw.label ?? '',
      cover: coverUrl(raw.cover ?? stationCover(id)),
      unlockLevel: Math.max(1, Math.trunc(finite(raw.unlockLevel ?? raw.level, 1))),
      count,
      trackIds: listed ? Object.freeze([...listed]) : null,
    }));
  }
  return Object.freeze(stations);
}

/** @param {object} station @param {number} level */
export function isStationLocked(station, level) {
  return Math.max(1, Math.trunc(finite(level, 1))) <
    Math.max(1, Math.trunc(finite(station?.unlockLevel, 1)));
}

/** @param {readonly object[]} tracks @param {object} station */
export function tracksForStation(tracks, station) {
  if (!station) return [];
  const listed = Array.isArray(station.trackIds) ? new Set(station.trackIds) : null;
  return tracks.filter((track) =>
    listed ? listed.has(track.id) : trackBelongsTo(track, station.id));
}

/**
 * Return a new sparse trims map. Defaults ({vol:100,on:true}) are removed.
 * @param {*} current
 * @param {string} trackId
 * @param {{vol?: *, on?: *}} next
 */
export function sparseTrimUpdate(current, trackId, next) {
  const trims = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...current }
    : {};
  const prev = trims[trackId] && typeof trims[trackId] === 'object' ? trims[trackId] : {};
  const vol = Math.max(0, Math.min(150, Math.round(finite(next.vol ?? prev.vol, 100) / 5) * 5));
  const on = typeof next.on === 'boolean' ? next.on : prev.on !== false;
  if (vol === 100 && on) delete trims[trackId];
  else trims[trackId] = { vol, on };
  return trims;
}

/** @param {*} trims @param {string} trackId */
export function trimFor(trims, trackId) {
  const row = trims && typeof trims === 'object' ? trims[trackId] : null;
  return {
    vol: Math.max(0, Math.min(150, Math.round(finite(row?.vol, 100) / 5) * 5)),
    on: row?.on !== false,
  };
}

/** @param {*} seconds */
export function formatTime(seconds) {
  const sec = Math.max(0, Math.floor(finite(seconds, 0)));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
