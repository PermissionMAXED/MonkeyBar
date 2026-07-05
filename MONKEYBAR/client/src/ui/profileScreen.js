// Profile / stats screen — REGISTERED PLACEHOLDER (R3, filled by R9/R10):
// coins/XP/level, per-mode plays/wins, and the cosmetics inventory all come
// from store.profile once the server economy (R2) streams `profile` frames.
// Reachable via go('profile'); no menu entry links here yet (R10 adds it).

import { el, clear, shortName } from './dom.js';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createProfileScreen(ctx) {
  const { store, back } = ctx;

  const bodyEl = el('div', {});

  function render() {
    clear(bodyEl);
    const profile = store.get('profile') ?? {};
    bodyEl.append(
      el('div', { className: 'm-name', text: shortName(profile.name || 'Nameless monkey', 20) }),
      // server economy fields appear here once R2's `profile` frames land
      profile.level != null
        ? el('div', {
            className: 'muted',
            style: { marginTop: '6px' },
            text: `Level ${profile.level} · 🍌 ${profile.coins ?? 0} coins · ${profile.wins ?? 0} wins / ${profile.matches ?? 0} matches`,
          })
        : el('div', {
            className: 'muted',
            style: { marginTop: '6px' },
            text: 'Coins, XP, levels and per-mode stats are still brewing behind the bar (coming in 1.0).',
          })
    );
  }

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel' }, [
        el('div', { className: 'screen-back-row' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '🐒 Profile' }),
          el('button', { className: 'btn small ghost', type: 'button', text: '← Back', onClick: back }),
        ]),
        bodyEl,
      ]),
    ]),
  ]);

  return { el: screen, onShow: render };
}
