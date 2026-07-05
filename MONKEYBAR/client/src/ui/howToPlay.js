// How-to-play (R10) — one guide per mode: rules, controls, win condition.
// Rules text sourced from the binding contracts (PLAN.md §4/§10,
// RELEASE_PLAN.md §B) and kept in sync with shared/constants.js values.
//
// Three surfaces:
//   * createHowToPlay(ctx)          — the browsable screen (go('howToPlay')):
//                                     every mode as a card; click → overlay.
//   * openHowToPlay(ctx, modeId)    — a per-mode modal overlay, reachable from
//                                     the main-menu mode cards' ⓘ buttons.
//   * first-match auto-offer        — the first time you ever sit down in a
//                                     mode (per-browser localStorage flag) the
//                                     overlay opens by itself on match start.

import {
  CHIP_BONUS_CHAMBERS,
  DICE_START,
  HAND_SIZE,
  MAX_PLAY,
  POKER_ANTE,
  POKER_BUST_REFUND,
  POKER_MAX_RAISES,
  POKER_START_STACK,
  ROULETTE_BASE_P,
  ROULETTE_START_CHIPS,
  ROULETTE_STEP_P,
  START_CHAMBERS,
  START_COCONUTS,
  TURN_SECONDS_DEFAULT,
  TURN_SECONDS_MAX,
  TURN_SECONDS_MIN,
} from '@shared/constants.js';
import { el, clear } from './dom.js';

const SEEN_KEY = 'mb_howto_seen';
const pct = (v) => `${Math.round(v * 100)}%`;

/**
 * Per-mode guide content. Every entry: { icon, tagline, rules[], controls
 * [[what, does]], win }. Values interpolate the ACTUAL shared constants so
 * this screen can never drift from the rules engine.
 * @type {Record<string, {icon: string, tagline: string, rules: string[], controls: [string, string][], win: string}>}
 */
export const MODE_GUIDES = {
  monkeyLies: {
    icon: '🍌',
    tagline: 'The main event: shed your hand, lie well, dodge the cannon.',
    rules: [
      `Each round every living monkey is dealt ${HAND_SIZE} fruit cards, THEN the round's Table Fruit is announced.`,
      `On your turn, PLAY 1–${MAX_PLAY} cards face down. The claim is implicit and always the same: "these are all Table Fruit." Only the count is public.`,
      'Or CALL — "MONKEY LIES!" — on the previous play (only the next player in turn may call, and only while a play is unresolved).',
      'On a call the played cards flip: if EVERY card is the Table Fruit or a wild ✨ Golden Banana, the claim was true and the CALLER loses. Otherwise the liar loses.',
      `The loser faces the Coconut Cannon: ${START_CHAMBERS} chambers, ${START_COCONUTS} coconut — hit chance = coconuts ÷ chambers. Survive and you permanently lose one empty chamber.`,
      `Your one 🍀 Lucky Banana Chip bolts +${CHIP_BONUS_CHAMBERS} temporary chambers onto a single shot — spend it during your own penalty window.`,
      'Empty hand = safe for the round. If everyone else sheds first, the Last Monkey Holding must fire the cannon at themselves.',
      'A coconut hit eliminates you (you haunt the bar as a chatting ghost). The round ends after every shot; survivors reshuffle and redeal.',
    ],
    controls: [
      ['Click cards', `select 1–${MAX_PLAY} (click again to deselect)`],
      ['PLAY', 'play the selected cards face down'],
      ['🐒 MONKEY LIES!', 'challenge the previous play (appears when legal)'],
      ['🍀 USE LUCKY BANANA CHIP', `+${CHIP_BONUS_CHAMBERS} chambers during your own penalty window`],
      ['🔥 FACE THE CANNON', 'take the forced Last-Monkey-Holding shot'],
    ],
    win: 'Last monkey standing wins the match.',
  },
  bananaDice: {
    icon: '🎲',
    tagline: "Liar's dice under coconut shells — bid up or call it down.",
    rules: [
      `Everyone starts the match with ${DICE_START} jungle dice. Each round all survivors' dice re-roll in secret under their shells — you only ever see your own.`,
      'Bidding rotates clockwise: a bid names a COUNT × FACE ("four 🥥") claiming at least that many dice show that face across the whole table.',
      'Each bid must strictly beat the last: raise the count, or keep the count and raise the face. Ones 🍌 are wild and count toward every face.',
      'Instead of bidding you may CHALLENGE the standing bid: every shell lifts. If the table holds the bid, the challenger loses a die — otherwise the bidder does.',
      `Hit zero dice and you face the Coconut Cannon (${START_CHAMBERS} chambers, ${START_COCONUTS} coconut, chip rules as in Monkey Lies). Survive → one chamber gone forever, and the bar spots you one die.`,
    ],
    controls: [
      ['Count / face pickers', 'compose your bid'],
      ['📣 BID', 'place the composed bid (must beat the current one)'],
      ['🚨 CHALLENGE!', 'call the standing bid a lie — shells up'],
      ['🍀 USE LUCKY BANANA CHIP', `+${CHIP_BONUS_CHAMBERS} chambers during your own penalty window`],
    ],
    win: 'Last monkey standing wins the match.',
  },
  coconutRoulette: {
    icon: '🥥',
    tagline: 'Pure nerve: a ticking coconut and a table of cowards.',
    rules: [
      `Everyone starts with ${ROULETTE_START_CHIPS} banana chips. Each round the rigged coconut arms itself in front of a random monkey.`,
      'Holding it, you choose: SHAKE — risk the boom for +1 chip and keep holding — or PASS, paying 1 chip to slide it clockwise.',
      `The first shake of a round explodes ${pct(ROULETTE_BASE_P)} of the time, and every survived shake at the table adds ${pct(ROULETTE_STEP_P)}. The counter resets when a round ends.`,
      'At 0 chips you cannot afford to pass — you MUST shake.',
      'An explosion eliminates you on the spot (no cannon — the coconut IS the boom). Survivors start a fresh round with a re-armed coconut.',
    ],
    controls: [
      ['🥥 SHAKE', 'risk the explosion, earn a chip, keep holding'],
      ['👉 PASS', 'pay 1 chip, coconut moves to the next monkey'],
    ],
    win: 'Last monkey standing wins the match.',
  },
  junglePoker: {
    icon: '🃏',
    tagline: 'Three-card blind poker where busting has a brass consequence.',
    rules: [
      `Everyone starts with a stack of ${POKER_START_STACK} banana chips and antes ${POKER_ANTE} per hand for 3 private cards.`,
      `One betting rotation: FOLD, CALL (match the bet — calling 0 is a check), or RAISE +1–3 chips on top (max ${POKER_MAX_RAISES} raises per hand; short stacks may go all-in).`,
      'If only one monkey stays in, they take the pot UNCONTESTED — folded cards are never revealed.',
      'Otherwise, showdown: Trio > Straight Flush > Straight > Flush > Pair > High Card. Ties split the pot.',
      `Can't cover the ante? The Coconut Cannon collects (${START_CHAMBERS} chambers, ${START_COCONUTS} coconut, chip rules as in Monkey Lies). Survive → one chamber gone forever and a ${POKER_BUST_REFUND}-chip refund to keep playing.`,
    ],
    controls: [
      ['FOLD', 'muck your cards, sit the hand out'],
      ['CALL', 'match the current bet (0 = check)'],
      ['RAISE +N', 'raise by 1–3 chips (stepper sets N)'],
      ['🍀 USE LUCKY BANANA CHIP', `+${CHIP_BONUS_CHAMBERS} chambers during your own penalty window`],
    ],
    win: 'Last monkey standing wins the match.',
  },
  kingOfTheBar: {
    icon: '👑',
    tagline: 'Monkey Lies, but the bar rewrites one rule every round.',
    rules: [
      'All of Monkey Lies applies — deal, implicit Table Fruit claims, calls, the Coconut Cannon, Last Monkey Holding.',
      'Every round one random Bar Rule bends the game (never the same twice in a row):',
      '🍺 Happy Hour — everyone plays 2+ cards, no singles (a last lonely card may still go).',
      '🙊 Silent Round — chat, phrases & emotes disabled; poker faces only.',
      '🔄 Sticky Stool — the turn order runs backwards this round.',
      '🍋 Sour Table — the Table Fruit re-rolls after every 3rd play.',
      '💣 Hair Trigger — the cannon is loaded with 2 coconuts, this round only.',
      "👑 Royal Decree — the round's challenge winner decrees the next round's Table Fruit.",
    ],
    controls: [
      ['Monkey Lies controls', 'cards, PLAY, 🐒 MONKEY LIES!, 🍀 chip'],
      ['🍌 / 🥥 / 🥭 pick', 'Royal Decree only: choose the next Table Fruit'],
    ],
    win: 'Last monkey standing wins the match.',
  },
  customChaos: {
    icon: '🧪',
    tagline: 'Monkey Lies under host-tuned knobs. Break it your way.',
    rules: [
      'Monkey Lies rules, with the numbers set by the host in the lobby before the match:',
      'Hand size 3–7 cards · play size up to 1–4 cards per turn.',
      'Cannon chambers 2–8 · coconuts loaded 1–3.',
      'Lucky Banana Chips 0–3 per match · chip bonus +1–4 chambers.',
      'Guaranteed ✨ Golden Bananas 0–2 per player in the deck.',
      'The active knob set is announced at match start and shown in your HUD.',
    ],
    controls: [
      ['Monkey Lies controls', 'cards, PLAY, 🐒 MONKEY LIES!, 🍀 chip'],
      ['Lobby knobs (host)', 'tune the chaos before starting the match'],
    ],
    win: 'Last monkey standing wins the match.',
  },
};

// ---------------------------------------------------------------------------
// First-match auto-offer flags (per-browser localStorage)
// ---------------------------------------------------------------------------

function seenMap() {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Has this browser ever seen the guide for `modeId`? */
export function hasSeenGuide(modeId) {
  return !!seenMap()[modeId];
}

/** Remember that the guide for `modeId` was shown (never auto-offer again). */
export function markGuideSeen(modeId) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seenMap(), [modeId]: true }));
  } catch {
    /* storage blocked — auto-offer may repeat, harmless */
  }
}

// ---------------------------------------------------------------------------
// The per-mode overlay
// ---------------------------------------------------------------------------

/**
 * Open the how-to-play overlay for one mode (modal over WHATEVER screen is
 * active — menus and the in-match HUD alike). Marks the mode's guide seen.
 * @param {{store}} ctx
 * @param {string} modeId
 * @returns {HTMLElement|null} the veil element (null for unknown modes)
 */
export function openHowToPlay(ctx, modeId) {
  const guide = MODE_GUIDES[modeId];
  if (!guide) return null;
  markGuideSeen(modeId);

  const mode = ctx.store.get('catalogs')?.modes?.find((m) => m.id === modeId);
  const name = mode?.name ?? modeId;
  const host = document.getElementById('ui') ?? document.body;
  // one guide at a time — replace any open one
  host.querySelector('.htp-veil')?.remove();

  const close = () => veil.remove();
  const veil = el(
    'div',
    { className: 'modal-veil htp-veil', onClick: (e) => e.target === veil && close() },
    [
      el('div', { className: 'modal panel purple wide htp-modal' }, [
        el('div', { className: 'screen-back-row', style: { marginBottom: '6px' } }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: `${guide.icon} ${name}` }),
          el('button', { className: 'btn small ghost', type: 'button', text: '✕', onClick: close }),
        ]),
        el('p', { className: 'htp-tagline', text: guide.tagline }),
        el('h3', { className: 'h-sub', text: '📜 Rules' }),
        el('ul', { className: 'htp-rules' }, guide.rules.map((r) => el('li', { text: r }))),
        el('h3', { className: 'h-sub', text: '🎮 Controls' }),
        el(
          'div',
          { className: 'htp-controls' },
          guide.controls.map(([what, does]) =>
            el('div', { className: 'htp-control-row' }, [
              el('span', { className: 'htp-control-what', text: what }),
              el('span', { className: 'htp-control-does', text: does }),
            ])
          )
        ),
        el('div', { className: 'htp-win' }, [
          el('span', { text: '🏆 ' }),
          el('strong', { text: guide.win }),
        ]),
        el('p', {
          className: 'muted',
          style: { fontSize: '11px', margin: '10px 0 0' },
          text:
            `Turn timer: ${TURN_SECONDS_DEFAULT}s by default — the host can set ` +
            `${TURN_SECONDS_MIN}–${TURN_SECONDS_MAX}s in the lobby. Idle two turns and a bot takes your stool.`,
        }),
        el('div', { className: 'modal-actions' }, [
          el('button', { className: 'btn primary', type: 'button', text: '🍌 Got it', onClick: close }),
        ]),
      ]),
    ]
  );
  host.appendChild(veil);
  return veil;
}

// ---------------------------------------------------------------------------
// The browsable screen (go('howToPlay')) + first-match auto-offer
// ---------------------------------------------------------------------------

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void}}
 */
export function createHowToPlay(ctx) {
  const { store, back } = ctx;

  const listEl = el('div', { className: 'mode-card-list' });

  function render() {
    clear(listEl);
    const modes = store.get('catalogs')?.modes ?? [];
    if (!modes.length) {
      listEl.append(el('p', { className: 'muted', text: 'Connecting to the bar…' }));
      return;
    }
    for (const mode of modes) {
      const guide = MODE_GUIDES[mode.id];
      listEl.append(
        el(
          'div',
          {
            className: `mode-card ${guide ? 'playable' : 'locked'}`,
            role: 'button',
            tabindex: '0',
            onClick: () => guide && openHowToPlay(ctx, mode.id),
            onKeydown: (e) => {
              if (guide && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                openHowToPlay(ctx, mode.id);
              }
            },
          },
          [
            el('div', { className: 'mode-card-head' }, [
              el('span', { className: 'mode-card-name', text: `${guide?.icon ?? '❓'} ${mode.name}` }),
              el('span', { className: 'mode-tag live', text: '📖 RULES' }),
            ]),
            el('p', { className: 'mode-card-desc', text: mode.desc }),
          ]
        )
      );
    }
  }

  // FIRST-MATCH AUTO-OFFER: entering the game screen as a seated player in a
  // mode this browser has never read about pops the guide once, ever.
  store.on('screen', (name) => {
    if (name !== 'game') return;
    const snap = store.get('snapshot');
    if (!snap || snap.yourSeat == null || snap.phase === 'matchEnd') return;
    const modeId = snap.mode;
    if (!MODE_GUIDES[modeId] || hasSeenGuide(modeId)) return;
    // Let the table land first, then offer the rules over the live match.
    setTimeout(() => {
      const current = store.get('snapshot');
      if (store.get('screen') === 'game' && current?.mode === modeId) {
        openHowToPlay(ctx, modeId);
      }
    }, 900);
  });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel', style: { width: 'min(560px, 94vw)', maxHeight: '82vh', overflowY: 'auto' } }, [
        el('div', { className: 'screen-back-row' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '📖 How to play' }),
          el('button', { className: 'btn small ghost', type: 'button', text: '← Back', onClick: back }),
        ]),
        el('p', { className: 'muted', text: 'Six games, one cannon. Pick a mode to read its rules.' }),
        listEl,
      ]),
    ]),
  ]);

  return { el: screen, onShow: render };
}
