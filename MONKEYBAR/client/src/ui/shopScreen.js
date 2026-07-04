// Shop screen (P5) — scaffolded cosmetic catalog (§6 slice scope): grid with
// win-count locked/unlocked states and a "coming soon" banner. No currency.

import { el, clear } from './dom.js';
import { COSMETICS, getWins, isUnlocked } from './cosmetics.js';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createShopScreen(ctx) {
  const { back } = ctx;

  const gridEl = el('div', { className: 'shop-grid' });

  function renderGrid() {
    clear(gridEl);
    const wins = getWins();
    for (const cosmetic of COSMETICS) {
      const unlocked = isUnlocked(cosmetic, wins);
      gridEl.append(
        el('div', { className: `shop-item ${unlocked ? '' : 'locked'}` }, [
          el('span', {
            className: `lock-tag ${unlocked ? 'unlocked' : ''}`,
            text: unlocked ? '✔ OWNED' : `🔒 ${cosmetic.winsRequired} WIN${cosmetic.winsRequired === 1 ? '' : 'S'}`,
          }),
          el('div', { className: 'glyph', text: cosmetic.glyph }),
          el('div', { className: 'si-name', text: cosmetic.name }),
          el('div', { className: 'si-desc', text: cosmetic.desc }),
        ])
      );
    }
    // future catalog slots, visibly stubbed
    for (const stub of ['Fur Dyes', 'Table Skins', 'Victory Dances', 'Cannon Paint']) {
      gridEl.append(
        el('div', { className: 'shop-item locked' }, [
          el('span', { className: 'lock-tag', text: 'SOON' }),
          el('div', { className: 'glyph', text: '📦' }),
          el('div', { className: 'si-name', text: stub }),
          el('div', { className: 'si-desc', text: 'A future shipment. The parrot signed for it already.' }),
        ])
      );
    }
  }

  const winsLine = el('p', { className: 'muted' });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel purple shop-panel' }, [
        el('div', { className: 'screen-back-row' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '🛍️ The Back Room' }),
          el('button', { className: 'btn small ghost', type: 'button', text: '← Back', onClick: back }),
        ]),
        el('div', { className: 'coming-soon-banner' }, [
          el('span', { text: '🚧' }),
          el('span', { text: 'Shop coming soon — cosmetics unlock free with match wins for now' }),
        ]),
        winsLine,
        gridEl,
      ]),
    ]),
  ]);

  return {
    el: screen,
    onShow() {
      const wins = getWins();
      winsLine.textContent = `🏆 ${wins} lifetime win${wins === 1 ? '' : 's'} on this device.`;
      renderGrid();
    },
  };
}
