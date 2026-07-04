// Chat panel + quick phrases + radial emote wheel (P5).
// One factory, two mounts: embedded in the lobby screen and docked in the HUD.
// Incoming chat/quickPhrase/emote events land in store.chatLog (screens.js).

import { MSG } from '@shared/protocol.js';
import { CHAT_MAX_LENGTH } from '@shared/constants.js';
import { el, clear } from './dom.js';

/**
 * @param {{store, socket, toast}} ctx
 * @param {{compact?: boolean}} [opts]
 * @returns {{el: HTMLElement, onShow: () => void, onHide: () => void}}
 */
export function createChatPanel(ctx, opts = {}) {
  const { store, socket } = ctx;

  // ---- log ----
  const logEl = el('div', { className: 'chat-log' });

  function lineFor(entry) {
    if (entry.kind === 'sys') {
      return el('div', { className: 'c-line sys', text: entry.text });
    }
    if (entry.kind === 'emote') {
      return el('div', { className: 'c-line emote-line' }, [
        el('b', { text: `${entry.name} ` }),
        el('span', { text: entry.glyph }),
      ]);
    }
    if (entry.kind === 'phrase') {
      return el('div', { className: 'c-line phrase' }, [
        el('b', { text: `${entry.name}: ` }),
        el('i', { text: entry.text }),
      ]);
    }
    // plain chat — in-game spectators arrive with seat == null (👁 prefix, §3.4)
    const spectator = !!store.get('snapshot') && (entry.seat === null || entry.seat === undefined);
    return el('div', { className: `c-line ${spectator ? 'spec' : ''}` }, [
      el('b', { text: `${spectator ? '👁 ' : ''}${entry.name}: ` }),
      el('span', { text: entry.text }),
    ]);
  }

  let rendered = 0;

  function renderLog(log, full = false) {
    if (full) {
      clear(logEl);
      rendered = 0;
    }
    const entries = log ?? [];
    // chatLog is append-only (trimmed at cap) — re-render fully if it shrank
    if (entries.length < rendered) {
      clear(logEl);
      rendered = 0;
    }
    for (let i = rendered; i < entries.length; i++) logEl.append(lineFor(entries[i]));
    rendered = entries.length;
    logEl.scrollTop = logEl.scrollHeight;
  }

  const unsubLog = store.on('chatLog', (log) => renderLog(log));
  void unsubLog; // panel lives for the app's lifetime

  // ---- input ----
  const input = el('input', {
    type: 'text',
    placeholder: 'Say something…',
    maxlength: String(CHAT_MAX_LENGTH),
  });

  function sendChat() {
    const text = input.value.trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    socket.send(MSG.CHAT, { text });
    input.value = '';
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
    e.stopPropagation();
  });

  // ---- quick phrases tray ----
  const phraseTray = el('div', { className: 'phrase-tray', style: { display: 'none' } });
  let trayOpen = false;

  function renderPhrases() {
    clear(phraseTray);
    for (const phrase of store.get('catalogs').quickPhrases) {
      phraseTray.append(
        el('button', {
          type: 'button',
          text: phrase.text,
          onClick: () => {
            socket.send(MSG.QUICK_PHRASE, { phraseId: phrase.id });
            toggleTray(false);
          },
        })
      );
    }
  }

  function toggleTray(force) {
    trayOpen = force ?? !trayOpen;
    phraseTray.style.display = trayOpen ? '' : 'none';
    phraseBtn.classList.toggle('active', trayOpen);
    if (trayOpen) renderPhrases();
  }

  const phraseBtn = el('button', {
    className: 'chat-tool-btn',
    type: 'button',
    text: '💬 Phrases',
    onClick: () => toggleTray(),
  });

  // ---- radial emote wheel ----
  let wheelVeil = null;

  function closeWheel() {
    wheelVeil?.remove();
    wheelVeil = null;
  }

  function openWheel() {
    closeWheel();
    const emotes = store.get('catalogs').emotes;
    const n = emotes.length || 1;
    const radius = Math.min(150, window.innerHeight * 0.22);
    const wheel = el('div', { className: 'emote-wheel' }, [
      el('div', { className: 'ew-center', text: 'emote\nwheel' }),
    ]);
    emotes.forEach((emote, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const item = el('button', {
        className: 'ew-item',
        type: 'button',
        text: emote.glyph,
        title: emote.name,
        style: {
          left: `${Math.cos(angle) * radius}px`,
          top: `${Math.sin(angle) * radius}px`,
          animationDelay: `${i * 0.02}s`,
        },
        onClick: (e) => {
          e.stopPropagation();
          socket.send(MSG.EMOTE, { emoteId: emote.id });
          closeWheel();
        },
      });
      wheel.append(item);
    });
    wheelVeil = el('div', { className: 'emote-wheel-veil', onClick: closeWheel }, [wheel]);
    document.getElementById('ui')?.appendChild(wheelVeil);
  }

  const emoteBtn = el('button', {
    className: 'chat-tool-btn',
    type: 'button',
    text: '😜 Emotes',
    onClick: openWheel,
  });

  // ---- assemble ----
  const panel = el('div', { className: 'chat-dock-inner', style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [
    phraseTray,
    el('div', { className: 'chat-panel' }, [
      logEl,
      el('div', { className: 'chat-input-row' }, [
        input,
        el('button', { type: 'button', text: 'SEND', onClick: sendChat }),
      ]),
    ]),
    el('div', { className: 'chat-tools' }, [phraseBtn, emoteBtn]),
  ]);

  if (opts.compact) logEl.style.height = '110px';

  return {
    el: panel,
    onShow() {
      renderLog(store.get('chatLog'), true);
    },
    onHide() {
      toggleTray(false);
      closeWheel();
    },
  };
}
