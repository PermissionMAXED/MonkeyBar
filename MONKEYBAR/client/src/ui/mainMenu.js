// Main menu screen (P5, +R10) — logo, name entry, Play / Quick Match /
// Character / How to play / Settings / Shop. Name persists to profile
// (+ localStorage) via setProfile. R10: every quick-match mode card carries a
// ⓘ button opening that mode's how-to-play overlay, and the searching state
// recovers from server errors instead of spinning forever.

import { MSG } from '@shared/protocol.js';
import { NAME_MAX_LENGTH } from '@shared/constants.js';
import { el, clear } from './dom.js';
import { portraitCanvas } from './portraits.js';
import { openHowToPlay } from './howToPlay.js';

const NAME_KEY = 'mb_name';

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createMainMenu(ctx) {
  const { store, socket, toast, go } = ctx;

  // ---- name entry ----
  const nameInput = el('input', {
    className: 'input',
    type: 'text',
    placeholder: 'Your monkey name…',
    maxlength: String(NAME_MAX_LENGTH),
    value: store.get('profile').name ?? '',
  });

  function commitName() {
    const name = nameInput.value.trim().slice(0, NAME_MAX_LENGTH);
    const profile = store.get('profile');
    if (!name || name === profile.name) return;
    store.set('profile', { ...profile, name });
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* storage blocked */
    }
    if (socket.isOpen()) socket.send(MSG.SET_PROFILE, { name });
  }

  nameInput.addEventListener('change', commitName);
  nameInput.addEventListener('blur', commitName);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });

  // ---- current monkey chip (mini portrait, links to character select) ----
  const monkeyChip = el('button', {
    className: 'monkey-chip',
    type: 'button',
    title: 'Change monkey',
    onClick: () => go('characterSelect'),
  });

  function renderMonkeyChip() {
    clear(monkeyChip);
    const { monkeyId } = store.get('profile');
    const monkey = store.get('catalogs').roster.find((m) => m.id === monkeyId);
    monkeyChip.append(portraitCanvas(monkey, 40), el('span', { text: monkey?.name ?? 'Pick' }));
  }

  // ---- quick match modal ----
  let modal = null;

  function ensureName() {
    commitName();
    if (!store.get('profile').name) {
      toast('Pick a name first, monkey.', 'error');
      nameInput.focus();
      return false;
    }
    return true;
  }

  /** One mode card: playable → launch button; locked → styled "coming soon".
   *  R10: the head also carries a ⓘ how-to-play button (cards are <div>s so
   *  the nested button stays valid HTML). */
  function modeCard(m) {
    const launch = () => {
      if (!m.playable) return;
      socket.send(MSG.QUICK_MATCH, { mode: m.id });
      store.set('quickSearching', true);
      renderSearching(m);
    };
    const children = [
      el('div', { className: 'mode-card-head' }, [
        el('span', { className: 'mode-card-name', text: m.name }),
        el('span', { className: 'mode-card-tags' }, [
          m.playable
            ? el('span', { className: 'mode-tag live', text: '● LIVE' })
            : el('span', { className: 'mode-tag soon', text: '🔒 COMING SOON' }),
          el('button', {
            className: 'mode-info-btn',
            type: 'button',
            title: `How to play ${m.name}`,
            'aria-label': `How to play ${m.name}`,
            text: 'ⓘ',
            onClick: (e) => {
              e.stopPropagation();
              openHowToPlay(ctx, m.id);
            },
          }),
        ]),
      ]),
      el('p', { className: 'mode-card-desc', text: m.desc }),
    ];
    // King of the Bar: render its Bar Rule mutator list as a teaser (§4.3)
    if (m.mutators?.length) {
      children.push(
        el(
          'ul',
          { className: 'mutator-teaser' },
          m.mutators.map((mu) => el('li', { text: mu }))
        )
      );
    }
    return el(
      'div',
      {
        className: `mode-card ${m.playable ? 'playable' : 'locked'}`,
        role: 'button',
        tabindex: m.playable ? '0' : undefined,
        onClick: launch,
        onKeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            launch();
          }
        },
      },
      children
    );
  }

  function openQuickMatch() {
    if (!ensureName()) return;
    closeModal();
    const modes = store.get('catalogs').modes;
    const list = el('div', { className: 'mode-card-list' }, modes.map(modeCard));
    modal = el('div', { className: 'modal-veil', onClick: (e) => e.target === modal && closeModal() }, [
      el('div', { className: 'modal panel purple wide' }, [
        el('h2', { className: 'h-title', text: 'Quick Match' }),
        el('p', { className: 'muted', text: 'Pick a game. Empty stools fill with bots after 5 seconds.' }),
        list,
        el('div', { className: 'modal-actions' }, [
          el('button', { className: 'btn ghost', type: 'button', text: 'Close', onClick: closeModal }),
        ]),
      ]),
    ]);
    screen.appendChild(modal);
  }

  function renderSearching(mode) {
    if (!modal) return;
    const panel = modal.querySelector('.modal');
    clear(panel);
    panel.append(
      el('div', { className: 'searching-box' }, [
        el('div', { className: 'spin', text: '🍌' }),
        el('h2', { className: 'h-title', text: 'Finding a table…' }),
        el('p', { className: 'muted', text: `${mode.name} — hang tight, rounding up monkeys.` }),
        el('div', { className: 'modal-actions', style: { justifyContent: 'center' } }, [
          el('button', {
            className: 'btn danger',
            type: 'button',
            text: 'Cancel',
            onClick: () => {
              socket.send(MSG.CANCEL_QUICK, {});
              store.set('quickSearching', false);
              closeModal();
            },
          }),
        ]),
      ])
    );
  }

  function closeModal() {
    modal?.remove();
    modal = null;
  }

  // matchFound / roomState routing happens in screens.js; just close the modal.
  store.on('quickSearching', (v) => {
    if (!v) closeModal();
  });

  // R10: a server error mid-search must not leave the spinner up forever —
  // screens.js already toasts the message, we just recover the modal state.
  socket.on(MSG.ERROR, () => {
    if (store.get('quickSearching')) {
      socket.send(MSG.CANCEL_QUICK, {});
      store.set('quickSearching', false); // closes the modal via the sub above
    }
  });

  // ---- layout ----
  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'menu-wrap' }, [
        el('div', { className: 'logo' }, [
          el('div', { className: 'word', html: 'MONKEY<span class="bar">BAR</span>' }),
          el('div', { className: 'tagline', text: '🍌 bluff · call · kaboom 🥥' }),
        ]),
        el('div', { className: 'name-row' }, [monkeyChip, nameInput]),
        el('div', { className: 'menu-buttons' }, [
          el('button', {
            className: 'btn primary',
            type: 'button',
            text: '🍹 Play',
            onClick: () => {
              if (!ensureName()) return;
              socket.send(MSG.LIST_ROOMS, {});
              go('lobbyBrowser');
            },
          }),
          el('button', { className: 'btn pink', type: 'button', text: '⚡ Quick Match', onClick: openQuickMatch }),
          el('button', {
            className: 'btn',
            type: 'button',
            text: '🐒 Character',
            onClick: () => go('characterSelect'),
          }),
          el('button', {
            className: 'btn',
            type: 'button',
            text: '📖 How to play',
            onClick: () => go('howToPlay'),
          }),
          el('button', { className: 'btn', type: 'button', text: '🔧 Settings', onClick: () => go('settings') }),
          el('button', { className: 'btn ghost', type: 'button', text: '🛍️ Shop', onClick: () => go('shop') }),
        ]),
      ]),
    ]),
  ]);

  store.on('catalogs', renderMonkeyChip);
  store.on('profile', renderMonkeyChip);
  renderMonkeyChip();

  return {
    el: screen,
    onShow() {
      renderMonkeyChip();
      if (!store.get('profile').name) nameInput.focus();
    },
  };
}
