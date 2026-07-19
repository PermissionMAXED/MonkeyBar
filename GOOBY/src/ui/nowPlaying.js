// V4/G52 (PLAN4 §C-SYS1.8): one persistent, non-stacking now-playing chip.
// It responds to G51's `radioTrackChanged` contract (store event or CustomEvent)
// and the earlier §B10 `radioChanged` event while both agents build concurrently.

import { t, getLang } from '../data/strings.js';
import { EN as RADIO_EN, DE as RADIO_DE } from '../data/strings/v4-radio.js';
import { RADIO_UI, coverUrl } from './radioScreen.logic.js';
import { loadRadioApi } from './radioScreen.js';

let activeChip = null;

function tx(key) {
  const global = t(key);
  if (global !== key) return global;
  return (getLang() === 'de' ? RADIO_DE : RADIO_EN)[key] ?? key;
}

/** @param {string} id */
function stationName(id) {
  const key = `radio.station.${id || 'bordmusik'}`;
  const label = tx(key);
  return label === key ? String(id || '').replaceAll('-', ' ') : label;
}

/** @param {HTMLImageElement} image */
function installCoverFallback(image) {
  image.addEventListener('error', () => {
    if (image.dataset.fallback === '1') return;
    image.dataset.fallback = '1';
    image.src = RADIO_UI.DEFAULT_COVER;
  });
}

/**
 * Mount the singleton chip into the persistent UI root.
 * @param {{store: object, ui: object, audio?: object, sceneManager?: object,
 *   framework?: object}} deps
 */
export function initNowPlaying({ store, ui, audio, sceneManager, framework }) {
  activeChip?.dispose?.();

  const chip = document.createElement('button');
  chip.className = 'g52-now-chip';
  chip.type = 'button';
  chip.setAttribute('aria-label', tx('radio.open'));
  chip.innerHTML = `
    <img src="${RADIO_UI.DEFAULT_COVER}" alt="">
    <span class="g52-chip-copy">
      <strong>${tx('radio.unknownTrack')}</strong>
      <small></small>
    </span>
    <span class="g52-chip-eq" aria-hidden="true"><i></i><i></i><i></i></span>`;
  ui.el.appendChild(chip);

  const image = /** @type {HTMLImageElement} */ (chip.querySelector('img'));
  const title = chip.querySelector('strong');
  const station = chip.querySelector('small');
  installCoverFallback(image);

  let hideTimer = null;
  let suppressTimer = null;
  let lastTrackId = '';
  let disposed = false;

  const suppressed = () =>
    framework?.isActive?.() === true ||
    sceneManager?.currentId?.() === 'minigame' ||
    document.querySelector('.mg-hud,.mg-countdown,.mg-pause,.mg-results') != null;

  function hide() {
    chip.classList.remove('g52-chip-show');
  }

  function paint(now) {
    if (!now || disposed || suppressed()) return;
    const trackId = String(now.trackId ?? now.id ?? now.track?.id ?? '');
    const nextTitle = String(now.title ?? now.track?.title ?? '');
    if (!trackId && !nextTitle) return;
    lastTrackId = trackId || lastTrackId;
    title.textContent = nextTitle || tx('radio.unknownTrack');
    station.textContent = stationName(now.station ?? now.stationId);
    image.dataset.fallback = '0';
    image.src = coverUrl(now.cover ?? now.track?.cover);
    chip.setAttribute('aria-label', `${tx('radio.open')}: ${title.textContent}`);
    if (hideTimer != null) clearTimeout(hideTimer);
    // Force the transition to restart when a new track replaces visible copy.
    chip.classList.remove('g52-chip-show');
    void chip.offsetWidth;
    chip.classList.add('g52-chip-show');
    hideTimer = setTimeout(hide, RADIO_UI.CHIP_VISIBLE_MS);
  }

  async function onTrack(payload) {
    const detail = payload?.detail ?? payload;
    // Paint event data immediately: acceptance requires ≤500 ms.
    if (detail?.title || detail?.track?.title) {
      paint(detail);
      return;
    }
    const api = audio?.radio ?? audio?.radioPlayer ?? await loadRadioApi();
    let now = null;
    try {
      now = await api?.now?.();
    } catch (err) {
      console.warn('[now-playing] read failed:', err);
    }
    paint(now ?? detail);
  }

  function onRadioChanged(payload) {
    const detail = payload?.detail ?? payload;
    const id = String(detail?.trackId ?? detail?.track?.id ?? '');
    if (!id || id === lastTrackId) return;
    onTrack(detail);
  }

  const offs = [
    store.on('radioTrackChanged', onTrack),
    store.on('radioChanged', onRadioChanged),
  ];
  window.addEventListener('radioTrackChanged', onTrack);
  window.addEventListener('radioChanged', onRadioChanged);

  chip.addEventListener('click', () => {
    audio?.play?.('ui.tap');
    ui.showScreen('radio');
  });

  // A chip already on screen vanishes immediately when a minigame HUD mounts.
  suppressTimer = setInterval(() => {
    if (suppressed()) hide();
  }, 200);

  const handle = {
    el: chip,
    /** Test/dev seam; production starts come through `radioTrackChanged`. */
    show: paint,
    hide,
    dispose() {
      disposed = true;
      for (const off of offs) off?.();
      window.removeEventListener('radioTrackChanged', onTrack);
      window.removeEventListener('radioChanged', onRadioChanged);
      if (hideTimer != null) clearTimeout(hideTimer);
      if (suppressTimer != null) clearInterval(suppressTimer);
      chip.remove();
      if (activeChip === handle) activeChip = null;
    },
  };
  activeChip = handle;
  return handle;
}
