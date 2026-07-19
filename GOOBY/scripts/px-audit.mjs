// V3/G33 — §B3 px-audit grep-gate. Fails (exit 1) on `px` values in
// font-size/padding/margin/gap/border-radius declarations inside UI CSS:
// `src/ui/styles.css` plus every component-injected CSS template literal in
// `src/ui/*.js`. The rem sweep (§B3: px → rem ÷16) made the DOM UI scale
// with `settings.uiScale`; new px declarations in these properties would
// silently opt out of scaling.
//
// Allowed (the §B3 exemption list):
//   - 0px / 1px (hairlines) / 999px (pill radii)
//   - the 44 px real-px tap-target floor inside max(44px, …) (§B3)
//   - env(safe-area-inset-*, 0px) fallbacks (§B9)
//   - CSS comments (historical numbers stay verbatim)
//   - box-shadow/text-shadow/filter/transform values (not in checked props)
//   - @media breakpoints (queries, not declarations)
//   - FILE_ALLOW entries below (justify every addition — §E0.1-5; G47 may
//     extend for §C11.2 border-image slice values)
//
// Usage: npm run px-audit   (add to your pre-commit verification — §E0)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/** Files whose UI CSS is NOT yet swept (owner justification required). */
const FILE_ALLOW = new Set([
  // (empty — V4/G-UI swept the last holdout, albumScreen.js' G23 block)
]);

/** Properties gated by §B3 (px here breaks uiScale scaling). */
const PROPS = /(?:^|[;{\s])(font-size|padding(?:-[a-z]+)?|margin(?:-[a-z]+)?|gap|row-gap|column-gap|border-radius|letter-spacing)\s*:\s*([^;}]*)/g;

/** px tokens allowed inside a checked declaration value. */
function pxAllowed(value, px) {
  const n = Number(px);
  if (n === 0 || n === 1 || n === 999) return true;
  // §B3 tap-target floor + §C1.4 safe-area shapes: max(44px, …) / max(Npx, …)
  // keep a real-px floor by design; env(…, 0px) fallbacks ride along.
  if (new RegExp(`(max|env)\\([^)]*${px}px`).test(value)) return true;
  return false;
}

/** Strip CSS comments so historical px numbers in prose don't trip the gate. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** @returns {Array<{prop: string, decl: string}>} offending declarations */
function auditCss(css) {
  const bad = [];
  const clean = stripComments(css);
  for (const m of clean.matchAll(PROPS)) {
    const [, prop, value] = m;
    for (const px of value.matchAll(/(\d*\.?\d+)px/g)) {
      if (!pxAllowed(value, px[1])) {
        bad.push({ prop, decl: `${prop}: ${value.trim()}` });
        break;
      }
    }
  }
  return bad;
}

/** Extract CSS template-literal bodies from a JS module (injected styles). */
function extractCssStrings(js) {
  const out = [];
  for (const m of js.matchAll(/const\s+\w*CSS\w*\s*=\s*`([\s\S]*?)`/g)) out.push(m[1]);
  return out;
}

let failures = 0;

function report(file, bad) {
  for (const { decl } of bad) {
    failures += 1;
    console.error(`px-audit: ${file}: ${decl}`);
  }
}

// 1. The stylesheet itself.
const cssFile = 'src/ui/styles.css';
report(cssFile, auditCss(fs.readFileSync(path.join(ROOT, cssFile), 'utf8')));

// 2. Component-injected CSS strings in src/ui/*.js.
for (const name of fs.readdirSync(path.join(ROOT, 'src/ui')).sort()) {
  if (!name.endsWith('.js')) continue;
  const rel = `src/ui/${name}`;
  if (FILE_ALLOW.has(rel)) continue;
  const js = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const css of extractCssStrings(js)) report(rel, auditCss(css));
}

if (failures > 0) {
  console.error(`px-audit: FAILED — ${failures} px declaration(s) in UI CSS (use rem ÷16; see §B3 exemptions in scripts/px-audit.mjs)`);
  process.exit(1);
}
console.log('px-audit: OK — UI CSS is rem-clean (§B3)');
