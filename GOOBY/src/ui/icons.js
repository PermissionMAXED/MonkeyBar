// Inline SVG icon set (§D5 — no icon fonts/webfonts, Kenney ui-pack ruled out).
// icon(name, size) returns an SVG string sized for inline use in DOM UI.
// Later agents may add names; keep shapes simple and single-color (currentColor).

/** @type {Record<string, string>} inner SVG markup per icon (24×24 viewBox). */
const PATHS = {
  // stats
  hunger: '<path d="M12 3c-4 0-7 2.6-7 6.2 0 2.4 1.4 4.2 3.4 5.2L8 20a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l-.4-5.6c2-1 3.4-2.8 3.4-5.2C19 5.6 16 3 12 3z"/>',
  energy: '<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2z"/>',
  hygiene: '<path d="M12 2S5.5 9.5 5.5 14a6.5 6.5 0 0 0 13 0C18.5 9.5 12 2 12 2z"/>',
  fun: '<path d="M12 2l2.7 6.2 6.8.6-5.2 4.5 1.6 6.7L12 16.5 6.1 20l1.6-6.7L2.5 8.8l6.8-.6L12 2z"/>',
  // currency / progress
  coin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5" fill="#fff" opacity="0.35"/>',
  star: '<path d="M12 2l2.7 6.2 6.8.6-5.2 4.5 1.6 6.7L12 16.5 6.1 20l1.6-6.7L2.5 8.8l6.8-.6L12 2z"/>',
  heart: '<path d="M12 21S4.5 16.3 2.5 12C1 8.6 3 5 6.5 5 8.7 5 10.2 6.2 12 8c1.8-1.8 3.3-3 5.5-3C21 5 23 8.6 21.5 12c-2 4.3-9.5 9-9.5 9z"/>',
  sparkle: '<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z"/><circle cx="19" cy="18" r="2"/><circle cx="5" cy="18" r="1.5"/>',
  // controls
  play: '<path d="M7 4l13 8-13 8V4z"/>',
  pause: '<rect x="5" y="4" width="5" height="16" rx="1.5"/><rect x="14" y="4" width="5" height="16" rx="1.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>',
  check: '<path d="M4 12.5l5 5L20 6.5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  replay: '<path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/>',
  arrowLeft: '<path d="M15 4l-8 8 8 8" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  arrowRight: '<path d="M9 4l8 8-8 8" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2.5" fill="none"/>',
  home: '<path d="M3 11.5 12 3l9 8.5v8a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H4.5A1.5 1.5 0 0 1 3 19.5v-8z"/>',
  gear: '<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5zm9 3.5-.1-1.6-2.3-.7a7 7 0 0 0-.7-1.6l1.1-2.1-1.2-1.2-2.1 1.1a7 7 0 0 0-1.6-.7L13.6 3h-3.2l-.5 2.2a7 7 0 0 0-1.6.7L6.2 4.8 5 6l1.1 2.1a7 7 0 0 0-.7 1.6l-2.3.7L3 12l.1 1.6 2.3.7c.2.6.4 1.1.7 1.6L5 18l1.2 1.2 2.1-1.1c.5.3 1 .5 1.6.7l.5 2.2h3.2l.5-2.2c.6-.2 1.1-.4 1.6-.7l2.1 1.1 1.2-1.2-1.1-2.1c.3-.5.5-1 .7-1.6l2.3-.7z"/>',
  bell: '<path d="M12 22a2.5 2.5 0 0 0 2.5-2.5h-5A2.5 2.5 0 0 0 12 22zm7-5.5v-1l-1.5-1.5V9.5a5.5 5.5 0 0 0-4-5.3V3.5a1.5 1.5 0 0 0-3 0v.7a5.5 5.5 0 0 0-4 5.3V14L5 15.5v1h14z"/>',
  cart: '<circle cx="9" cy="20" r="1.8"/><circle cx="17" cy="20" r="1.8"/><path d="M3 4h2.5l2.5 11h9.5l2.5-8H7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
  trophy: '<path d="M7 4h10v2h4v2c0 2.5-2 4.5-4.3 4.9A5 5 0 0 1 13 16v2h3v3H8v-3h3v-2a5 5 0 0 1-3.7-3.1C5 12.5 3 10.5 3 8V6h4V4z"/>',
  shirt: '<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a3 3 0 0 1-6 0z"/>',
  // minigame tile icons (§C6)
  car: '<path d="M4 12l1.6-4.5A2 2 0 0 1 7.5 6h9a2 2 0 0 1 1.9 1.5L20 12v6h-2.5v-1.5h-11V18H4v-6zm3-1h10l-1-3H8l-1 3z"/><circle cx="8" cy="14.5" r="1.4" fill="#fff" opacity="0.6"/><circle cx="16" cy="14.5" r="1.4" fill="#fff" opacity="0.6"/>',
  carrot: '<path d="M14 3c1.5-1.5 4 0 3.5 2 2-.5 3.5 2 2 3.5L18 10l-4-4 0-3zM17 11 7 21l-4-4L13 7l4 4z"/>',
  rabbit: '<path d="M9 3c1.5 0 2.5 2 2.5 4.5h1C12.5 5 13.5 3 15 3s2 2.5.8 5c1.5 1 2.7 2.7 2.7 5A6.5 6.5 0 0 1 12 19.5 6.5 6.5 0 0 1 5.5 13c0-2.3 1.2-4 2.7-5C7 5.5 7.5 3 9 3z"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.5 9.3-8 11-4.5-1.7-8-6-8-11V5l8-3z"/>',
  cards: '<rect x="3" y="5" width="8" height="12" rx="1.5" transform="rotate(-8 7 11)"/><rect x="12" y="6" width="8" height="12" rx="1.5" transform="rotate(8 16 12)"/>',
  run: '<circle cx="15" cy="4.5" r="2"/><path d="M9 21l2.5-6L9 12.5l1.5-4L15 9l3 3 3-1-1 3-3.5-.5L14 17l-1.5 4H9z"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke="#fff" stroke-width="1.6" fill="none" opacity="0.6"/>',
  stack: '<rect x="5" y="15" width="14" height="4" rx="2"/><rect x="6" y="10" width="12" height="4" rx="2"/><rect x="7.5" y="5" width="9" height="4" rx="2"/>',
  music: '<path d="M9 19a3 3 0 1 1-2-2.8V6l12-2.5V16a3 3 0 1 1-2-2.8V7L9 9v10z"/>',
  fish: '<path d="M3 12s3.5-5.5 9-5.5c4 0 7 2.8 9 5.5-2 2.7-5 5.5-9 5.5C6.5 17.5 3 12 3 12zm-1-4 3 4-3 4V8z"/><circle cx="16" cy="11" r="1.2" fill="#fff"/>',
  bubble: '<circle cx="10" cy="10" r="7"/><circle cx="18" cy="17" r="3.5"/><circle cx="8" cy="8" r="2" fill="#fff" opacity="0.5"/>',
  spring: '<path d="M5 21h14M6 18h12M7.5 15h9M6.5 12h11M8 9h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><circle cx="12" cy="4.5" r="2.5"/>',
  // ── V3/G35 (§C6.1): nutella jar — glass jar glyph with a chocolate-brown
  // fill bar + cream lid band (fixed fills; the jar outline stays currentColor)
  nutellaJar: '<rect x="6" y="3" width="12" height="3.4" rx="1.4"/><rect x="7.2" y="6.4" width="9.6" height="1.6" rx="0.8" fill="#FFF6EC"/><path d="M6.5 8h11a1.5 1.5 0 0 1 1.5 1.5V19a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 19V9.5A1.5 1.5 0 0 1 6.5 8z"/><path d="M6.5 12.5h11V19a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6.5 19v-6.5z" fill="#5C3A21"/>',
};

/**
 * Render an icon as an inline SVG string.
 * @param {string} name key in the icon set
 * @param {number} [size] px (default 24)
 * @returns {string} SVG markup ('' for unknown names, with a console warning)
 */
export function icon(name, size = 24) {
  const inner = PATHS[name];
  if (!inner) {
    console.warn(`[icons] unknown icon: ${name}`);
    return '';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${inner}</svg>`;
}

/** @returns {string[]} all icon names */
export function iconNames() {
  return Object.keys(PATHS);
}
