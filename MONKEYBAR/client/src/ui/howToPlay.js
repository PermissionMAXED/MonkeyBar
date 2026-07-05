// How-to-play screen — REGISTERED PLACEHOLDER (R3, filled by R10 with proper
// per-mode rules pages, diagrams and controls). For now: one card per mode
// from the shared catalog, so every mode has at least its pitch on screen.
// Reachable via go('howToPlay'); no menu entry links here yet (R10 adds it).

import { el, clear } from './dom.js';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createHowToPlay(ctx) {
  const { store, back } = ctx;

  const listEl = el('div', {});

  function render() {
    clear(listEl);
    const modes = store.get('catalogs')?.modes ?? [];
    if (!modes.length) {
      listEl.append(el('p', { className: 'muted', text: 'Connecting to the bar…' }));
      return;
    }
    for (const mode of modes) {
      listEl.append(
        el('div', { style: { marginBottom: '14px' } }, [
          el('h3', { className: 'h-sub', style: { marginBottom: '4px' } }, [
            el('span', { text: mode.name }),
            mode.playable ? null : el('span', { className: 'badge bot', text: '🔒 coming soon' }),
          ]),
          el('p', { className: 'muted', style: { margin: '0' }, text: mode.desc }),
        ])
      );
    }
  }

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel', style: { maxHeight: '80vh', overflowY: 'auto' } }, [
        el('div', { className: 'screen-back-row' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '📖 How to play' }),
          el('button', { className: 'btn small ghost', type: 'button', text: '← Back', onClick: back }),
        ]),
        listEl,
      ]),
    ]),
  ]);

  return { el: screen, onShow: render };
}
