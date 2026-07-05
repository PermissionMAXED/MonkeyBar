// Settings screen (P5, +R10) — audio mute/volume + quality + reduced-motion
// toggles stored as flags in store.prefs (the engine/audio layers and the
// gameClient choreography read these), plus the current room turn-timer
// display and a back button.

import { TURN_SECONDS_DEFAULT } from '@shared/constants.js';
import { el } from './dom.js';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createSettingsScreen(ctx) {
  const { store, back } = ctx;

  function setPref(key, value) {
    store.set('prefs', { ...store.get('prefs'), [key]: value });
  }

  // ---- audio mute ----
  const muteToggle = el('div', {
    className: 'toggle',
    role: 'switch',
    onClick: () => {
      const muted = !store.get('prefs').muted;
      setPref('muted', muted);
      muteToggle.classList.toggle('on', muted);
    },
  });

  // ---- volume ----
  const volOut = el('output');
  const volSlider = el('input', {
    className: 'slider',
    type: 'range',
    min: '0',
    max: '100',
    step: '5',
  });
  volSlider.addEventListener('input', () => {
    volOut.textContent = `${volSlider.value}%`;
    setPref('volume', parseInt(volSlider.value, 10) / 100);
  });

  // ---- quality ----
  const qualityToggle = el('div', {
    className: 'toggle',
    role: 'switch',
    onClick: () => {
      const quality = store.get('prefs').quality === 'high' ? 'low' : 'high';
      setPref('quality', quality);
      qualityToggle.classList.toggle('on', quality === 'high');
      qualityLabel.textContent = quality === 'high' ? '✨ High (bloom + shadows)' : '🥔 Low (performance)';
    },
  });
  const qualityLabel = el('span', { text: '✨ High (bloom + shadows)' });

  // ---- reduced motion (R10) ----
  // gameClient's fastMode() reads prefs.reducedMotion on every tools.wait,
  // so flipping this mid-match takes effect on the very next choreography beat.
  const motionToggle = el('div', {
    className: 'toggle',
    role: 'switch',
    onClick: () => {
      const reducedMotion = !store.get('prefs').reducedMotion;
      setPref('reducedMotion', reducedMotion);
      motionToggle.classList.toggle('on', reducedMotion);
    },
  });

  // ---- turn timer display (set by the room host, shown read-only here) ----
  const timerEl = el('span', { style: { fontWeight: '800', color: 'var(--banana)' } });

  function sync() {
    const prefs = store.get('prefs');
    muteToggle.classList.toggle('on', !!prefs.muted);
    volSlider.value = String(Math.round((prefs.volume ?? 0.8) * 100));
    volOut.textContent = `${volSlider.value}%`;
    qualityToggle.classList.toggle('on', prefs.quality !== 'low');
    qualityLabel.textContent =
      prefs.quality !== 'low' ? '✨ High (bloom + shadows)' : '🥔 Low (performance)';
    motionToggle.classList.toggle('on', !!prefs.reducedMotion);
    const room = store.get('roomState');
    timerEl.textContent = room
      ? `${room.settings?.turnSeconds ?? TURN_SECONDS_DEFAULT}s (host-set for "${room.name}")`
      : `${TURN_SECONDS_DEFAULT}s (default — host can change it in the lobby)`;
  }

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel settings-panel' }, [
        el('div', { className: 'screen-back-row' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '🔧 Settings' }),
          el('button', { className: 'btn small ghost', type: 'button', text: '← Back', onClick: back }),
        ]),
        el('h3', { className: 'h-sub', text: 'Audio' }),
        el('div', { className: 'toggle-row' }, [el('span', { text: '🔇 Mute all audio' }), muteToggle]),
        el('div', { className: 'field' }, [
          el('label', { text: 'Volume' }),
          el('div', { className: 'turn-seconds-row' }, [volSlider, volOut]),
        ]),
        el('h3', { className: 'h-sub', text: 'Graphics' }),
        el('div', { className: 'toggle-row' }, [qualityLabel, qualityToggle]),
        el('div', { className: 'toggle-row' }, [
          el('span', { text: '🐢 Reduced motion (skip long animations)' }),
          motionToggle,
        ]),
        el('h3', { className: 'h-sub', text: 'Game' }),
        el('div', { className: 'toggle-row' }, [el('span', { text: '⏱ Turn timer' }), timerEl]),
      ]),
    ]),
  ]);

  return { el: screen, onShow: sync };
}
