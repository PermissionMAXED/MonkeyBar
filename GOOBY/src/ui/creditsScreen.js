// V4/G81: static credits screen (PLAN4 §C-SYS12.4 / PLAN4-GAMES §G6.2).
// Attribution rows come only from data/credits.js. URLs are rendered as plain
// text and every row is deliberately inert: no anchors, buttons, or handlers.

import { CREDITS } from '../data/credits.js';
import { t, getLang } from '../data/strings.js';
import { EN as CREDIT_EN, DE as CREDIT_DE } from '../data/strings/v4-credits.js';
import audio from '../audio/audio.js';
import { icon } from './icons.js';

/** §C-SYS12.4 section order is binding. */
const SECTIONS = Object.freeze([
  Object.freeze({ id: 'gooby', key: 'credits.section.gooby', glyph: '🐰' }),
  Object.freeze({ id: 'welten', key: 'credits.section.worlds', glyph: '🌍' }),
  Object.freeze({ id: 'musik', key: 'credits.section.music', glyph: '🎵' }),
  Object.freeze({ id: 'soundsGrafik', key: 'credits.section.sounds', glyph: '✨' }),
  Object.freeze({ id: 'technik', key: 'credits.section.technology', glyph: '🛠️' }),
]);

/**
 * Translate credits chrome through the global table, with the owned module as
 * a same-wave fallback if strings.js has not yet been integrated.
 * @param {string} key
 * @returns {string}
 */
function tx(key) {
  const translated = t(key);
  if (translated !== key) return translated;
  return (getLang() === 'de' ? CREDIT_DE : CREDIT_EN)[key] ?? key;
}

/** @param {unknown} value @returns {string} HTML-safe literal credit data. */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Render one non-interactive credit row. Literal titles, names, licenses,
 * change indications, and URLs remain untouched apart from HTML escaping.
 * @param {import('../data/credits.js').CreditRow|object} row
 * @returns {string}
 */
export function renderCreditRow(row) {
  if (row.text) {
    return `<p class="g81-credit-copy">${escapeHtml(row.text)}</p>`;
  }
  if (row.link) {
    return `<p class="g81-credit-url" data-credit-url>${escapeHtml(row.link)}</p>`;
  }

  const note = row.note ? `, ${escapeHtml(row.note)}` : '';
  const source = row.source
    ? `<span class="g81-credit-source">· ${tx('credits.source')}: ${escapeHtml(row.source)}</span>`
    : '';
  return `
    <div class="g81-credit-row" data-credit-row>
      <span class="g81-credit-main"><strong>„${escapeHtml(row.title)}“</strong>
        ${tx('credits.by')} ${escapeHtml(row.by)} — ${escapeHtml(row.license)}${note}</span>
      ${source}
    </div>`;
}

/**
 * Create the §E6 credits screen.
 * @param {{ui: {closeAll: () => void}, audio?: {play?: (id: string) => void}}} deps
 * @returns {{mount: (el: HTMLElement) => void, unmount: () => void}}
 */
export function createCreditsScreen({ ui, audio: sound = audio }) {
  return {
    /** @param {HTMLElement} el */
    mount(el) {
      el.innerHTML = `
        <div class="g81-credits">
          <header class="g81-credits-head">
            <button class="btn btn-ghost btn-round g81-credits-back"
              aria-label="${t('ui.back')}">${icon('arrowLeft', 22)}</button>
            <h1>${tx('credits.title')}</h1>
          </header>
          <div class="g81-credits-scroll" data-credits-scroll>
            ${SECTIONS.map((section) => `
              <section class="card g81-credit-section" data-credit-section="${section.id}">
                <h2><span aria-hidden="true">${section.glyph}</span> ${tx(section.key)}</h2>
                <div class="g81-credit-rows">
                  ${CREDITS[section.id].map(renderCreditRow).join('')}
                </div>
              </section>`).join('')}
          </div>
        </div>`;

      el.querySelector('.g81-credits-back')?.addEventListener('click', () => {
        sound?.play?.('ui.close');
        ui.closeAll();
      });
    },
    unmount() {},
  };
}

/**
 * Register the feature-detected screen id consumed by settingsScreen.js.
 * @param {{registerScreen: (id: string, mod: object) => void}} ui
 */
export function registerCreditsScreen(ui) {
  ui.registerScreen('credits', createCreditsScreen({ ui }));
}
