// Character select screen (P5) — 16-monkey grid from catalogs.roster (§6):
// silhouette-flavored portrait cards with passive text; select → selectMonkey
// + profile persist; localStorage win-count cosmetic locks (1/3/5/10 wins).

import { MSG } from '@shared/protocol.js';
import { el, clear } from './dom.js';
import { portraitCanvas } from './portraits.js';
import { COSMETICS, getWins, isUnlocked } from './cosmetics.js';

const MONKEY_KEY = 'mb_monkey';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createCharacterSelect(ctx) {
  const { store, socket, toast, back } = ctx;

  const gridEl = el('div', { className: 'monkey-grid' });
  const cosmeticStripEl = el('div', { className: 'cosmetic-strip' });
  const winsEl = el('span', { className: 'muted' });

  function select(monkey) {
    const profile = store.get('profile');
    store.set('profile', { ...profile, monkeyId: monkey.id });
    try {
      localStorage.setItem(MONKEY_KEY, monkey.id);
    } catch {
      /* storage blocked */
    }
    // setProfile works both in the menus and in a lobby (§3.2) — selectMonkey
    // is room-only and used to error with a toast when picked from the menu.
    if (socket.isOpen()) socket.send(MSG.SET_PROFILE, { monkeyId: monkey.id });
    toast(`You are now ${monkey.name} 🐒`);
    renderGrid();
  }

  function renderGrid() {
    clear(gridEl);
    const roster = store.get('catalogs').roster;
    const selectedId = store.get('profile').monkeyId;
    for (const monkey of roster) {
      gridEl.append(
        el(
          'div',
          {
            className: `monkey-card ${monkey.id === selectedId ? 'selected' : ''}`,
            onClick: () => select(monkey),
          },
          [
            portraitCanvas(monkey, 84),
            el('div', { className: 'mc-name', text: monkey.name }),
            el('div', { className: 'mc-passive' }, [
              el('b', { text: monkey.passive?.name ?? '' }),
              el('span', { text: monkey.passive?.desc ?? '' }),
            ]),
          ]
        )
      );
    }
  }

  function renderCosmetics() {
    clear(cosmeticStripEl);
    const wins = getWins();
    winsEl.textContent = `🏆 ${wins} win${wins === 1 ? '' : 's'} on this device`;
    for (const cosmetic of COSMETICS) {
      const unlocked = isUnlocked(cosmetic, wins);
      cosmeticStripEl.append(
        el('div', { className: `cosmetic-chip ${unlocked ? '' : 'locked'}`, title: cosmetic.desc }, [
          el('span', { text: cosmetic.glyph }),
          el('span', { text: cosmetic.name }),
          el('span', {
            className: 'req',
            text: unlocked ? '✔ unlocked' : `🔒 ${cosmetic.winsRequired} win${cosmetic.winsRequired === 1 ? '' : 's'}`,
          }),
        ])
      );
    }
  }

  store.on('catalogs', renderGrid);

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel charsel-panel' }, [
        el('div', { className: 'screen-back-row' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '🐒 Pick your monkey' }),
          el('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, [
            winsEl,
            el('button', { className: 'btn small ghost', type: 'button', text: '← Back', onClick: back }),
          ]),
        ]),
        gridEl,
        el('h3', { className: 'h-sub', text: 'Cosmetics — earned with match wins' }),
        cosmeticStripEl,
      ]),
    ]),
  ]);

  return {
    el: screen,
    onShow() {
      renderGrid();
      renderCosmetics();
    },
  };
}
