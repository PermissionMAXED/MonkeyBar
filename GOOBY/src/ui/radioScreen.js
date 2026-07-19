// V4/G52 (PLAN4 §C-SYS1): full radio surface. G51 builds the radio engine in
// the same wave, so every engine/registry touch is feature-detected through
// import.meta.glob and accepts both the radio.js hand-off contract and the
// earlier radioPlayer.js API documented in §B2.3.

import { t, getLang } from '../data/strings.js';
import { icon } from './icons.js';
import { getGooby, getRoomManager } from '../home/homeScene.js';
import { EN as RADIO_EN, DE as RADIO_DE } from '../data/strings/v4-radio.js';
import {
  RADIO_UI,
  normalizeTrack,
  deriveStations,
  tracksForStation,
  isStationLocked,
  sparseTrimUpdate,
  trimFor,
  formatTime,
  coverUrl,
} from './radioScreen.logic.js';

const RADIO_LOADERS = import.meta.glob(['../audio/radio.js', '../audio/radioPlayer.js']);
const CATALOG_LOADERS = import.meta.glob([
  '../data/musicManifest.json',
  '../systems/musicRegistry.js',
]);

const FALLBACK_TITLES = Object.freeze([
  'Playful Piano',
  'Piano Atmos',
  'Piano Jazz',
  'Piano Melodie',
  'Piano Streicher',
  'Rabbit Town',
  'Penguin Town',
  'Candy',
  'Puzzle Pieces',
  'Vacation Day',
  'Seaside',
  'Werkstatt',
  'Magic Bottle Town',
]);

let radioModulePromise = null;
let catalogPromise = null;
let furnitureWired = false;

/** Same-wave i18n fallback until G53 spreads v4-radio.js into strings.js. */
function tx(key, vars) {
  const global = t(key, vars);
  if (global !== key) return global;
  let text = (getLang() === 'de' ? RADIO_DE : RADIO_EN)[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/** @param {*} value */
const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

function fallbackTracks() {
  const rows = FALLBACK_TITLES.map((title) => ({
    id: `bordmusik-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title,
    category: 'Bordmusik',
    source: 'builtin',
    file: `music/Bordmusik - ${title}.ogg`,
    durationSec: 0,
    cover: null,
  }));
  rows.push({
    id: 'recap-abenteuer',
    title: 'Abenteuer',
    category: 'Recap',
    source: 'builtin',
    file: 'music/Recap - Abenteuer.ogg',
    durationSec: 0,
    cover: null,
  });
  return rows.map(normalizeTrack);
}

/**
 * Load G51's singleton radio API if it is present. Supported methods:
 * start/stop/toggle/skip/setStation/setShuffle/setTrim/preview/now/getStats.
 * @returns {Promise<object|null>}
 */
export function loadRadioApi() {
  if (!radioModulePromise) {
    radioModulePromise = (async () => {
      // Dev/CDP seam for same-wave verification while G51 is still unmerged.
      // It is stripped from production builds and follows the exact §B2.3 API.
      const stub = import.meta.env.DEV ? globalThis.__goobyRadioStub : null;
      if (stub && typeof stub.now === 'function') return stub;
      for (const load of Object.values(RADIO_LOADERS)) {
        try {
          const mod = await load();
          const api = mod.default ?? mod.radio ?? mod.radioPlayer ?? mod;
          if (api && (
            typeof api.start === 'function' ||
            typeof api.toggle === 'function' ||
            typeof api.now === 'function'
          )) return api;
        } catch (err) {
          console.warn('[radio-ui] radio engine load failed:', err);
        }
      }
      return null;
    })();
  }
  return radioModulePromise;
}

/**
 * Normalize G51 registry + manifest output. The fallback is the fixed 14-track
 * §C-SYS1.7 catalog and disappears automatically as soon as G51 lands.
 * @returns {Promise<{tracks: readonly object[], stations: readonly object[], fallback: boolean}>}
 */
export function loadRadioCatalog() {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      let manifest = null;
      let registry = null;
      for (const [path, load] of Object.entries(CATALOG_LOADERS)) {
        try {
          const mod = await load();
          if (path.endsWith('.json')) manifest = mod.default ?? mod;
          else registry = mod;
        } catch (err) {
          console.warn(`[radio-ui] catalog load failed (${path}):`, err);
        }
      }

      let rawTracks =
        manifest?.tracks ??
        registry?.tracks ??
        registry?.TRACKS ??
        registry?.getTracks?.() ??
        [];
      if (!Array.isArray(rawTracks)) rawTracks = [];
      const fallback = rawTracks.length === 0;
      const tracks = (fallback ? fallbackTracks() : rawTracks.map(normalizeTrack));

      let rawStations =
        registry?.stations ??
        registry?.STATIONS ??
        registry?.getStations?.(tracks) ??
        [];
      if (!Array.isArray(rawStations)) rawStations = [];
      return {
        tracks: Object.freeze(tracks),
        stations: deriveStations(tracks, rawStations),
        fallback,
      };
    })();
  }
  return catalogPromise;
}

/** @param {object} station */
function stationLabel(station) {
  const translated = tx(station.nameKey ?? `radio.station.${station.id}`);
  if (translated !== station.nameKey && translated !== `radio.station.${station.id}`) return translated;
  return station.name || String(station.id).replaceAll('-', ' ');
}

/** Ensure the save slice exists until G53's schema lands. */
function writeRadio(store, patch) {
  store.update((state) => {
    state.radio = {
      station: 'bordmusik',
      playing: false,
      shuffle: true,
      replaceContext: true,
      lastTrack: '',
      trims: {},
      ...(state.radio && typeof state.radio === 'object' ? state.radio : {}),
      ...patch,
    };
  });
  store.flush?.();
}

/** @param {HTMLImageElement|null} image */
function installCoverFallback(image) {
  image?.addEventListener('error', () => {
    if (image.dataset.fallback === '1') return;
    image.dataset.fallback = '1';
    image.src = RADIO_UI.DEFAULT_COVER;
  }, { once: true });
}

function showRadioToast(ui, scope, key, vars) {
  if (t(key, vars) !== key) ui.toast(key, vars);
  else showLocalToast(scope, tx(key, vars));
}

/**
 * Create one §E6 radio module. `radio`, `radioPanel` and `trackSettings` each
 * receive their own instance so a G58 settings route cannot share mount state.
 * @param {{store: object, ui: object, audio?: object}} deps
 * @param {{panelId?: string, tracksOnly?: boolean}} [options]
 */
export function createRadioScreen({ store, ui, audio }, options = {}) {
  let root = null;
  let api = null;
  let tracks = [];
  let stations = [];
  let selectedId = String(store.get('radio.station') ?? 'bordmusik');
  let visibleTracks = RADIO_UI.TRACK_PAGE_SIZE;
  let nowState = null;
  let clockTimer = null;
  let offEvents = [];
  const allOffToasted = new Set();

  const currentStation = () =>
    stations.find((station) => station.id === selectedId) ?? stations[0] ?? null;

  const selectedTracks = () => tracksForStation(tracks, currentStation());

  async function callApi(method, ...args) {
    const target = api ?? audio?.radio ?? audio?.radioPlayer ?? await loadRadioApi();
    api = target;
    if (typeof target?.[method] !== 'function') return undefined;
    try {
      return await target[method](...args);
    } catch (err) {
      console.warn(`[radio-ui] ${method} failed:`, err);
      return undefined;
    }
  }

  function emitFallbackTrack(track) {
    if (!track) return;
    writeRadio(store, { lastTrack: track.id, station: selectedId, playing: true });
    store.emit?.('radioTrackChanged', {
      trackId: track.id,
      title: track.title,
      cover: track.cover,
      station: selectedId,
      t: 0,
      duration: track.durationSec,
    });
  }

  async function refreshNow(payload = null) {
    if (!root) return;
    const detail = payload?.detail ?? payload;
    let next = detail && typeof detail === 'object' &&
      (detail.trackId || detail.title || detail.track?.id)
      ? detail
      : null;
    const live = await callApi('now');
    if (live && typeof live === 'object') next = live;
    if (!next) {
      const id = store.get('radio.lastTrack');
      const track = tracks.find((row) => row.id === id) ?? selectedTracks()[0];
      if (track) {
        next = {
          trackId: track.id,
          title: track.title,
          cover: track.cover,
          station: selectedId,
          t: 0,
          duration: track.durationSec,
        };
      }
    }
    nowState = next;
    const title = root.querySelector('[data-radio-now-title]');
    const station = root.querySelector('[data-radio-now-station]');
    const time = root.querySelector('[data-radio-now-time]');
    const cover = /** @type {HTMLImageElement|null} */ (root.querySelector('[data-radio-now-cover]'));
    if (title) title.textContent = next?.title || tx('radio.unknownTrack');
    const stationRow = stations.find((row) => row.id === (next?.station ?? selectedId));
    if (station) station.textContent = stationRow ? stationLabel(stationRow) : String(next?.station ?? '');
    if (time) time.textContent = `${formatTime(next?.t)} / ${formatTime(next?.duration)}`;
    if (cover) {
      const src = coverUrl(next?.cover);
      if (cover.getAttribute('src') !== src) {
        cover.dataset.fallback = '0';
        cover.src = src;
      }
    }
  }

  function renderLoading() {
    if (!root) return;
    root.innerHTML = `
      <div class="g52-radio ${options.tracksOnly ? 'g52-radio-tracks-only' : ''}">
        <div class="g52-radio-head">
          <button class="btn btn-ghost btn-round g52-radio-close" aria-label="${esc(tx('radio.back'))}">
            ${icon('arrowLeft', 22)}
          </button>
          <div><h1>${esc(tx('radio.title'))}</h1><p>${esc(tx('radio.subtitle'))}</p></div>
        </div>
        <div class="g52-radio-loading" aria-busy="true">📻</div>
      </div>`;
    root.querySelector('.g52-radio-close')?.addEventListener('click', close);
  }

  function render() {
    if (!root) return;
    const state = store.get('radio') ?? {};
    const station = currentStation();
    if (station && station.id !== selectedId) selectedId = station.id;
    const level = Number(store.get('level')) || 1;
    const list = selectedTracks();
    const shown = list.slice(0, visibleTracks);
    const left = Math.max(0, list.length - shown.length);
    const playing = state.playing === true;
    const shuffle = state.shuffle !== false;
    const replaceContext = state.replaceContext !== false;
    const nowTrack = tracks.find((track) => track.id === (nowState?.trackId ?? state.lastTrack)) ?? shown[0];
    const nowCover = coverUrl(nowState?.cover ?? nowTrack?.cover);
    const nowTitle = nowState?.title ?? nowTrack?.title ?? tx('radio.unknownTrack');
    const stationCards = stations.map((row) => {
      const locked = isStationLocked(row, level);
      return `<button class="g52-station ${row.id === selectedId ? 'g52-active' : ''} ${locked ? 'g52-locked' : ''}"
        data-station="${esc(row.id)}" role="listitem" aria-pressed="${row.id === selectedId}">
        <img src="${esc(row.cover)}" alt="">
        <span>${esc(stationLabel(row))}</span>
        <small>${locked
          ? `🔒 ${esc(tx('radio.levelBadge', { level: row.unlockLevel }))}`
          : `${row.count} ${esc(tx('radio.tracks'))}`}</small>
      </button>`;
    }).join('');

    root.innerHTML = `
      <div class="g52-radio ${options.tracksOnly ? 'g52-radio-tracks-only' : ''}">
        <div class="g52-radio-head">
          <button class="btn btn-ghost btn-round g52-radio-close" aria-label="${esc(tx('radio.back'))}">
            ${icon('arrowLeft', 22)}
          </button>
          <div>
            <h1>${esc(options.tracksOnly ? tx('radio.trackSettings') : tx('radio.title'))}</h1>
            <p>${esc(options.tracksOnly ? tx('radio.trackSettingsHint') : tx('radio.subtitle'))}</p>
          </div>
        </div>

        ${options.tracksOnly ? '' : `
        <section class="g52-now-card card" aria-label="${esc(tx('radio.nowPlaying'))}">
          <img data-radio-now-cover src="${esc(nowCover)}" alt="">
          <div class="g52-now-copy">
            <span>${esc(tx('radio.nowPlaying'))}</span>
            <strong data-radio-now-title>${esc(nowTitle)}</strong>
            <small><span data-radio-now-station>${esc(station ? stationLabel(station) : '')}</span>
              · <span data-radio-now-time>${formatTime(nowState?.t)} / ${formatTime(nowState?.duration ?? nowTrack?.durationSec)}</span></small>
          </div>
        </section>

        <div class="g52-transport">
          <button class="g52-transport-btn g52-shuffle ${shuffle ? 'g52-on' : ''}"
            aria-label="${esc(shuffle ? tx('radio.shuffleOn') : tx('radio.shuffleOff'))}"
            aria-pressed="${shuffle}">🔀</button>
          <button class="g52-transport-btn g52-play" aria-label="${esc(playing ? tx('radio.pause') : tx('radio.play'))}">
            ${playing ? '⏸' : '▶'}
          </button>
          <button class="g52-transport-btn g52-skip" aria-label="${esc(tx('radio.skip'))}">⏭</button>
        </div>

        <div class="g52-section-title">${esc(tx('radio.stations'))}</div>
        <div class="g52-stations" role="list">
          ${stationCards}
        </div>

        <label class="g52-replace card">
          <span>${esc(tx('radio.replaceContext'))}</span>
          <button class="g52-toggle ${replaceContext ? 'g52-on' : ''}" role="switch"
            aria-checked="${replaceContext}" aria-label="${esc(tx('radio.replaceContext'))}">
            <span></span>
          </button>
        </label>

        <button class="g52-track-settings-link card">
          <span>
            <strong>${esc(tx('radio.trackSettings'))}</strong>
            <small>${esc(tx('radio.trackSettingsHint'))}</small>
          </span>
          <b aria-hidden="true">›</b>
        </button>`}

        ${options.tracksOnly ? `
        <div class="g52-section-title">${esc(tx('radio.stations'))}</div>
        <div class="g52-stations" role="list">${stationCards}</div>` : ''}

        <div class="g52-section-title">${esc(tx('radio.tracks'))}</div>
        <div class="g52-track-list">
          ${shown.map((track) => {
            const pref = trimFor(state.trims, track.id);
            const locked = track.unlockLevel > level;
            return `
              <article class="g52-track ${pref.on ? '' : 'g52-track-off'} ${locked ? 'g52-track-locked' : ''}"
                data-track-row="${esc(track.id)}">
                <img src="${esc(track.cover)}" alt="">
                <div class="g52-track-copy">
                  <strong title="${esc(track.title)}">${esc(track.title)}</strong>
                  <small>${locked
                    ? `🔒 ${esc(tx('radio.levelBadge', { level: track.unlockLevel }))}`
                    : `${formatTime(track.durationSec)} · ${Math.round(track.gainTrim * 100)}%`}</small>
                </div>
                <button class="g52-track-toggle ${pref.on ? 'g52-on' : ''}" data-track-toggle="${esc(track.id)}"
                  role="switch" aria-checked="${pref.on}" ${locked ? 'disabled' : ''}
                  aria-label="${esc(pref.on ? tx('radio.trackEnabled') : tx('radio.trackDisabled'))}"><span></span></button>
                <div class="g52-track-volume">
                  <input type="range" min="0" max="150" step="5" value="${pref.vol}"
                    style="--g47-fill:${(pref.vol / 150) * 100}%"
                    data-track-volume="${esc(track.id)}" ${locked ? 'disabled' : ''}
                    aria-label="${esc(tx('radio.volume', { title: track.title }))}">
                  <output>${pref.vol}%</output>
                  <button class="g52-preview" data-track-preview="${esc(track.id)}" ${locked ? 'disabled' : ''}
                    aria-label="${esc(tx('radio.preview', { title: track.title }))}">▶</button>
                </div>
              </article>`;
          }).join('')}
          ${left > 0 ? `<button class="btn btn-ghost g52-more">${esc(tx('radio.showMore', {
            count: Math.min(RADIO_UI.TRACK_PAGE_SIZE, left),
          }))}</button>` : ''}
        </div>
      </div>`;

    root.querySelector('.g52-radio-close')?.addEventListener('click', close);
    for (const image of root.querySelectorAll('img')) installCoverFallback(image);

    root.querySelector('.g52-play')?.addEventListener('click', async () => {
      audio?.play?.('ui.tap');
      const next = store.get('radio.playing') !== true;
      if (api || audio?.radio || audio?.radioPlayer || Object.keys(RADIO_LOADERS).length > 0) {
        if (typeof (api ?? audio?.radio ?? audio?.radioPlayer)?.toggle === 'function') {
          await callApi('toggle');
        } else if (next) {
          await callApi('start', selectedId);
        } else {
          await callApi('stop');
        }
      }
      writeRadio(store, { playing: next, station: selectedId });
      if (next && !(api?.now)) emitFallbackTrack(selectedTracks().find((track) => trimFor(store.get('radio.trims'), track.id).on) ?? selectedTracks()[0]);
      render();
      refreshNow();
    });

    root.querySelector('.g52-skip')?.addEventListener('click', async () => {
      audio?.play?.('ui.tap');
      const result = await callApi('skip');
      if (result == null) {
        const listNow = selectedTracks();
        const at = Math.max(-1, listNow.findIndex((track) => track.id === store.get('radio.lastTrack')));
        emitFallbackTrack(listNow[(at + 1) % Math.max(1, listNow.length)]);
      }
      refreshNow(result);
    });

    root.querySelector('.g52-shuffle')?.addEventListener('click', async () => {
      audio?.play?.('ui.tap');
      const next = store.get('radio.shuffle') === false;
      writeRadio(store, { shuffle: next });
      await callApi('setShuffle', next);
      render();
    });

    for (const button of root.querySelectorAll('[data-station]')) {
      button.addEventListener('click', async () => {
        const next = stations.find((row) => row.id === button.dataset.station);
        if (!next) return;
        if (isStationLocked(next, level)) {
          audio?.play?.('ui.error');
          showRadioToast(ui, root, 'radio.stationLocked', { level: next.unlockLevel });
          return;
        }
        audio?.play?.('ui.tabSwitch');
        selectedId = next.id;
        visibleTracks = RADIO_UI.TRACK_PAGE_SIZE;
        writeRadio(store, { station: selectedId });
        await callApi('setStation', selectedId);
        render();
        refreshNow();
      });
    }

    root.querySelector('.g52-replace .g52-toggle')?.addEventListener('click', () => {
      audio?.play?.('ui.tap');
      writeRadio(store, { replaceContext: store.get('radio.replaceContext') === false });
      render();
    });

    root.querySelector('.g52-track-settings-link')?.addEventListener('click', () => {
      audio?.play?.('ui.open');
      if (options.panelId) ui.openPanel('trackSettings');
      else ui.showScreen('trackSettings');
    });

    for (const button of root.querySelectorAll('[data-track-toggle]')) {
      button.addEventListener('click', async () => {
        const trackId = button.dataset.trackToggle;
        const current = trimFor(store.get('radio.trims'), trackId);
        const next = { ...current, on: !current.on };
        const trims = sparseTrimUpdate(store.get('radio.trims'), trackId, next);
        writeRadio(store, { trims });
        await callApi('setTrim', trackId, next);
        audio?.play?.(next.on ? 'ui.toggleOn' : 'ui.toggleOff');
        const stationRows = selectedTracks();
        let showAllOff = false;
        if (!next.on && stationRows.every((track) => !trimFor(trims, track.id).on) && !allOffToasted.has(selectedId)) {
          allOffToasted.add(selectedId);
          showAllOff = true;
        }
        render();
        if (showAllOff) showRadioToast(ui, root, 'radio.allOff');
      });
    }

    for (const slider of root.querySelectorAll('[data-track-volume]')) {
      const trackId = slider.dataset.trackVolume;
      const row = slider.closest('.g52-track');
      const output = row?.querySelector('output');
      slider.addEventListener('input', async () => {
        const current = trimFor(store.get('radio.trims'), trackId);
        const next = { ...current, vol: Number(slider.value) };
        const trims = sparseTrimUpdate(store.get('radio.trims'), trackId, next);
        writeRadio(store, { trims });
        slider.style.setProperty('--g47-fill', `${(next.vol / 150) * 100}%`);
        if (output) output.textContent = `${next.vol}%`;
        await callApi('setTrim', trackId, next);
      });
      slider.addEventListener('change', () => audio?.play?.('ui.slider'));
    }

    for (const button of root.querySelectorAll('[data-track-preview]')) {
      button.addEventListener('click', async () => {
        const track = tracks.find((row) => row.id === button.dataset.trackPreview);
        if (!track) return;
        audio?.play?.('ui.tap');
        const target = api ?? audio?.radio ?? audio?.radioPlayer ?? await loadRadioApi();
        const preview = target?.preview ?? target?.previewTrack ?? audio?.previewRadioTrack;
        if (typeof preview === 'function') {
          await preview.call(target, track.id, 5);
        } else {
          store.emit?.('radioTrackChanged', {
            trackId: track.id,
            title: track.title,
            cover: track.cover,
            station: selectedId,
            t: 0,
            duration: track.durationSec,
            preview: true,
          });
          showLocalToast(root, tx('radio.previewUnavailable'));
        }
      });
    }

    root.querySelector('.g52-more')?.addEventListener('click', () => {
      visibleTracks += RADIO_UI.TRACK_PAGE_SIZE;
      render();
    });
  }

  function close() {
    audio?.play?.('ui.close');
    if (options.panelId) ui.closePanel(options.panelId);
    else ui.closeAll();
  }

  return {
    /** @param {HTMLElement} el */
    mount(el) {
      root = el;
      renderLoading();
      Promise.all([loadRadioCatalog(), loadRadioApi()]).then(([catalog, loadedApi]) => {
        if (!root) return;
        tracks = [...catalog.tracks];
        stations = [...catalog.stations];
        api = audio?.radio ?? audio?.radioPlayer ?? loadedApi;
        const requested = stations.find((row) => row.id === selectedId);
        if (!requested || isStationLocked(requested, Number(store.get('level')) || 1)) {
          selectedId = stations.find((row) => !isStationLocked(row, Number(store.get('level')) || 1))?.id ??
            stations[0]?.id ?? 'bordmusik';
        }
        render();
        refreshNow();
      });
      offEvents = [
        store.on('radioTrackChanged', (payload) => refreshNow(payload)),
        store.on('radioChanged', (payload) => refreshNow(payload)),
      ];
      clockTimer = setInterval(() => refreshNow(), 500);
    },
    unmount() {
      for (const off of offEvents) off?.();
      offEvents = [];
      if (clockTimer != null) clearInterval(clockTimer);
      clockTimer = null;
      root = null;
    },
  };
}

/** Small inline fallback for same-wave strings that ui.toast cannot see yet. */
function showLocalToast(scope, text) {
  const host = scope?.closest?.('.screen,.panel') ?? scope;
  if (!host) return;
  host.querySelector('.g52-local-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'g52-local-toast';
  toast.textContent = text;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

/**
 * Poll the recreated room manager and bind the pleasant-picnic radio hitbox.
 * @param {{store: object, ui: object, audio?: object}} deps
 */
function wireFurnitureTap({ store, ui, audio }) {
  if (furnitureWired) return;
  furnitureWired = true;
  let manager = null;
  let offTap = null;
  setInterval(() => {
    const next = getRoomManager();
    if (next === manager) return;
    offTap?.();
    manager = next;
    offTap = manager?.on?.('tap:radio', () => {
      audio?.play?.('ui.open');
      ui.openPanel('radioPanel');
      if (store.get('radio.playing') === true) {
        const gooby = getGooby();
        gooby?.setEmotion?.('happy');
        gooby?.play?.('happyBounce', { speed: 0.72 });
      }
    }) ?? null;
  }, 400);
}

/**
 * Register all G52/G58 integration ids.
 * @param {{store: object, ui: object, audio?: object}} deps
 */
export function registerRadioUi(deps) {
  deps.ui.registerScreen('radio', createRadioScreen(deps));
  deps.ui.registerPanel('radioPanel', createRadioScreen(deps, { panelId: 'radioPanel' }));
  deps.ui.registerScreen('trackSettings', createRadioScreen(deps, { tracksOnly: true }));
  deps.ui.registerPanel(
    'trackSettings',
    createRadioScreen(deps, { panelId: 'trackSettings', tracksOnly: true })
  );
  wireFurnitureTap(deps);
}
