// Tiny DOM helpers shared by all UI screens (P5).

/**
 * Create an element.
 * @param {string} tag
 * @param {Object} [attrs]  className, text, html, title, dataset, style(obj), on{event}, plus raw attributes
 * @param {(Node|string|null|undefined)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

/** Remove all children. */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Presentation metadata for the fruit enum (§4.1). */
export const FRUIT_META = {
  banana: { glyph: '🍌', label: 'BANANA', color: '#ffd23d' },
  coconut: { glyph: '🥥', label: 'COCONUT', color: '#c9a08a' },
  mango: { glyph: '🥭', label: 'MANGO', color: '#ff9a3d' },
  golden: { glyph: '✨', label: 'GOLDEN', color: '#ffe98a' },
};

/** Clamp helper. */
export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** Escape user text for safe innerHTML-free rendering (we use textContent everywhere anyway). */
export function shortName(name, max = 14) {
  const n = (name || '').trim();
  return n.length > max ? `${n.slice(0, max - 1)}…` : n;
}
