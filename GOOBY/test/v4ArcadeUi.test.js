// V4/G68 — arcade cover grid + pre-game screen pure contracts (PLAN4-GAMES
// §G7.1–7.4, §G5.6; PLAN4 §C-SYS4.5). Node-only: string tables, the pure
// grid/pregame helpers, the glow animation math and static source seams —
// the DOM renderers themselves are covered by the CDP proof (G68 report).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EN as ARC_EN, DE as ARC_DE } from '../src/data/strings/v4-arcade.js';
import { EN as DIFF_EN } from '../src/data/strings/v4-difficulty.js';
import { EN as MOD_EN } from '../src/data/strings/v4-modifier.js';
import { MINIGAMES } from '../src/data/minigames.js';
import { MODIFIER_TYPES } from '../src/systems/modifierEngine.js';
import { DIFFICULTY_MODES } from '../src/minigames/framework.logic.js';
import {
  COVER_DIR,
  coverUrl,
  TILE_COLORS,
  ARCADE_GAME_IDS,
  gameAccent,
  fallbackGradient,
  coinRange,
  formatCountdown,
  glowTint,
  pillStates,
  modeLine,
  bestOfMode,
  showSpecialRibbon,
} from '../src/ui/arcadeUi.logic.js';
import { GLOW, pulseAt, twirlAngleAt, sparkleAt } from '../src/ui/modifierGlow.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// Strings (§G7.4 + §E0.1-8: always EN + DE, same key sets, no empty values)
// ---------------------------------------------------------------------------

test('v4-arcade: EN and DE key sets match exactly and are non-empty', () => {
  assert.deepEqual(Object.keys(ARC_EN).sort(), Object.keys(ARC_DE).sort());
  assert.ok(Object.keys(ARC_EN).length > 0);
  for (const key of Object.keys(ARC_EN)) {
    assert.ok(String(ARC_EN[key]).trim(), `empty EN ${key}`);
    assert.ok(String(ARC_DE[key]).trim(), `empty DE ${key}`);
  }
});

test('v4-arcade: the §G7.4 key list is present verbatim', () => {
  for (const key of [
    'arcade.special.ribbon',
    'pregame.play',
    'pregame.target',
    'pregame.endlessLocked',
    'pregame.quality.title',
    'pregame.quality.high',
    'pregame.quality.low',
  ]) {
    assert.ok(ARC_EN[key], `missing EN ${key}`);
    assert.ok(ARC_DE[key], `missing DE ${key}`);
  }
  assert.equal(ARC_DE['arcade.special.ribbon'], 'SPECIAL — echte 3D-Welt!');
  assert.equal(ARC_DE['pregame.play'], 'Spielen ▶');
  assert.equal(ARC_DE['pregame.endlessLocked'], '🔒 Schlage Schwer (Ziel {n}) · ab L10');
});

test('v4-arcade: one banner effect blurb per §C-SYS4.2 modifier type', () => {
  for (const type of Object.keys(MODIFIER_TYPES)) {
    assert.ok(ARC_EN[`pregame.modifier.effect.${type}`], `missing EN effect for ${type}`);
    assert.ok(ARC_DE[`pregame.modifier.effect.${type}`], `missing DE effect for ${type}`);
  }
});

test('v4-arcade: no key collides with v4-difficulty (G56) or v4-modifier (G76)', () => {
  const mine = new Set(Object.keys(ARC_EN));
  for (const foreign of [...Object.keys(DIFF_EN), ...Object.keys(MOD_EN)]) {
    assert.ok(!mine.has(foreign), `key ${foreign} defined in two modules`);
  }
});

test('strings.js spreads the v4-arcade module (G53 wiring pin)', () => {
  const src = source('src/data/strings.js');
  assert.match(src, /V4_ARCADE_EN/);
  assert.match(src, /V4_ARCADE_DE/);
});

// ---------------------------------------------------------------------------
// arcadeUi.logic — §G7.1/§G7.2/§G5.6 pure helpers
// ---------------------------------------------------------------------------

test('coverUrl: §G7.1 root + <gameId>.png', () => {
  assert.equal(COVER_DIR, 'assets/covers/');
  assert.equal(coverUrl('runner'), 'assets/covers/runner.png');
  assert.equal(coverUrl('goobyWelt'), 'assets/covers/goobyWelt.png');
});

test('ARCADE_GAME_IDS: the 28 §G7.2 grid entries (27 games + goobyWelt, no _smoke)', () => {
  assert.equal(ARCADE_GAME_IDS.length, 28);
  assert.ok(ARCADE_GAME_IDS.includes('goobyWelt'));
  assert.ok(!ARCADE_GAME_IDS.includes('_smoke'));
});

test('every grid entry can render its fallback tile (icon + coin row present)', () => {
  for (const meta of MINIGAMES.filter((m) => !m.dev)) {
    assert.equal(typeof meta.icon, 'string', `${meta.id} has no icon`);
    assert.ok(meta.coinTable && typeof meta.coinTable.max === 'number', `${meta.id} has no coin row`);
    assert.ok(Number.isFinite(meta.energyCost), `${meta.id} has no energy cost`);
  }
});

test('gameAccent/fallbackGradient: deterministic, palette-bound, accent embedded', () => {
  for (const id of ARCADE_GAME_IDS) {
    const accent = gameAccent(id);
    assert.ok(TILE_COLORS.includes(accent), `${id} accent off-palette`);
    assert.equal(gameAccent(id), accent);
    const grad = fallbackGradient(id);
    assert.match(grad, /^linear-gradient\(/);
    assert.ok(grad.includes(accent), `${id} gradient misses its accent`);
  }
  assert.ok(TILE_COLORS.includes(gameAccent('nonsense')));
});

test('coinRange: defensive on §C6 rows', () => {
  assert.deepEqual(coinRange({ min: 4, max: 20 }), { min: 4, max: 20 });
  assert.deepEqual(coinRange({ max: 30 }), { min: 0, max: 30 });
  assert.deepEqual(coinRange(undefined), { min: 0, max: 0 });
});

test('formatCountdown: §C-SYS4.5 mm:ss, clamped ≥ 0', () => {
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(-5000), '00:00');
  assert.equal(formatCountdown(1), '00:01'); // ceil — never shows 00:00 while live
  assert.equal(formatCountdown(61_000), '01:01');
  assert.equal(formatCountdown(45 * 60 * 1000), '45:00');
  assert.equal(formatCountdown(3_599_000), '59:59');
});

test('glowTint: §C-SYS4.5 tint table rides the engine colors (single source)', () => {
  // gold (doppelGold/glueckspilz), teal (muenzregen), coral (turbo),
  // lavender (riesenGooby), pink (stickerChance) — §C-SYS4.5 verbatim.
  assert.equal(glowTint('doppelGold'), '#FFD34D');
  assert.equal(glowTint('glueckspilz'), '#FFD34D');
  assert.equal(glowTint('muenzregen'), MODIFIER_TYPES.muenzregen.color);
  assert.equal(glowTint('turbo'), MODIFIER_TYPES.turbo.color);
  assert.equal(glowTint('riesenGooby'), MODIFIER_TYPES.riesenGooby.color);
  assert.equal(glowTint('stickerChance'), MODIFIER_TYPES.stickerChance.color);
  assert.equal(glowTint('unknown'), '#FFD34D');
  assert.equal(glowTint(undefined), '#FFD34D');
});

test('pillStates: 4 pills in §G5.2 order, endless lock per §G5.5', () => {
  const locked = pillStates({ beaten: {}, endlessUnlocked: false }, 'normal');
  assert.deepEqual(locked.map((p) => p.mode), [...DIFFICULTY_MODES]);
  assert.deepEqual(locked.map((p) => p.selected), [false, true, false, false]);
  assert.equal(locked[3].locked, true);
  const open = pillStates(
    { beaten: { normal: true, hard: true }, endlessUnlocked: true },
    'hard'
  );
  assert.equal(open[3].locked, false);
  assert.deepEqual(open.map((p) => p.beaten), [false, true, true, false]);
  assert.equal(open[2].selected, true);
});

test('modeLine: §G5.6 per-mode lines incl. the §G5.5 lock line', () => {
  const diff = { target: 380, endlessUnlocked: false, bestByMode: { endless: 0 } };
  assert.deepEqual(modeLine(diff, 'easy'), { key: 'mg.diff.coins.easy' });
  assert.deepEqual(modeLine(diff, 'normal'), { key: 'mg.diff.coins.normal' });
  assert.deepEqual(modeLine(diff, 'hard'), { key: 'mg.diff.coins.hard', vars: { n: 380 } });
  assert.deepEqual(modeLine(diff, 'endless'), { key: 'pregame.endlessLocked', vars: { n: 380 } });
  const open = { target: 380, endlessUnlocked: true, bestByMode: { endless: 123 } };
  assert.deepEqual(modeLine(open, 'endless'), { key: 'mg.diff.coins.endless', vars: { n: 123 } });
});

test('bestOfMode + showSpecialRibbon: defensive reads', () => {
  assert.equal(bestOfMode({ bestByMode: { hard: 42 } }, 'hard'), 42);
  assert.equal(bestOfMode({ bestByMode: {} }, 'endless'), 0);
  assert.equal(bestOfMode(undefined, 'easy'), 0);
  assert.equal(showSpecialRibbon({ minigames: { plays: {} } }), true);
  assert.equal(showSpecialRibbon({}), true);
  assert.equal(showSpecialRibbon({ minigames: { plays: { goobyWelt: 1 } } }), false);
});

// ---------------------------------------------------------------------------
// modifierGlow — §C-SYS4.5 numbers + animation math
// ---------------------------------------------------------------------------

test('GLOW: §C-SYS4.5 spec numbers verbatim', () => {
  assert.equal(GLOW.TWIRL, 'twirl_02.png');
  assert.equal(GLOW.RING, 'circle_04.png');
  assert.equal(GLOW.SPARKLE, 'star_03.png');
  assert.equal(GLOW.ROT_REV_PER_SEC, 0.15);
  assert.equal(GLOW.TWIRL_ALPHA, 0.55);
  assert.equal(GLOW.PULSE_HZ, 0.8);
  assert.equal(GLOW.PULSE_SCALE_MIN, 0.92);
  assert.equal(GLOW.PULSE_SCALE_MAX, 1.08);
  assert.equal(GLOW.PULSE_ALPHA_MIN, 0.35);
  assert.equal(GLOW.PULSE_ALPHA_MAX, 0.6);
  assert.equal(GLOW.SPARKLE_COUNT, 6);
  assert.equal(GLOW.SPARKLE_MIN_PX, 8);
  assert.equal(GLOW.SPARKLE_MAX_PX, 12);
  assert.equal(GLOW.SPARKLE_RESPAWN_SEC, 1.2);
  assert.equal(GLOW.DEFAULT_TINT, '#FFD34D');
});

test('the 3 §C-SYS4.5 VFX textures are committed (G50 inventory)', () => {
  for (const name of [GLOW.TWIRL, GLOW.RING, GLOW.SPARKLE]) {
    assert.ok(
      existsSync(join(ROOT, 'public', GLOW.TEXTURE_DIR, name)),
      `public/${GLOW.TEXTURE_DIR}${name} missing`
    );
  }
});

test('pulseAt: 0.8 Hz sine within scale 0.92–1.08 / alpha 0.35–0.6', () => {
  for (let t = 0; t <= 5; t += 0.05) {
    const { scale, alpha } = pulseAt(t);
    assert.ok(scale >= GLOW.PULSE_SCALE_MIN - 1e-9 && scale <= GLOW.PULSE_SCALE_MAX + 1e-9);
    assert.ok(alpha >= GLOW.PULSE_ALPHA_MIN - 1e-9 && alpha <= GLOW.PULSE_ALPHA_MAX + 1e-9);
  }
  // one full period = 1/0.8 s
  const period = 1 / GLOW.PULSE_HZ;
  assert.ok(Math.abs(pulseAt(0.3).scale - pulseAt(0.3 + period).scale) < 1e-9);
  // extremes actually reached (quarter periods of the sine)
  assert.ok(Math.abs(pulseAt(period / 4).scale - GLOW.PULSE_SCALE_MAX) < 1e-9);
  assert.ok(Math.abs(pulseAt((3 * period) / 4).scale - GLOW.PULSE_SCALE_MIN) < 1e-9);
});

test('twirlAngleAt: 0.15 rev/s', () => {
  assert.ok(Math.abs(twirlAngleAt(1) - 2 * Math.PI * 0.15) < 1e-12);
  assert.ok(Math.abs(twirlAngleAt(1 / 0.15) - 2 * Math.PI) < 1e-9); // one revolution
});

test('sparkleAt: 6 border sparkles, 8–12 px, respawn every 1.2 s, deterministic', () => {
  for (let i = 0; i < GLOW.SPARKLE_COUNT; i += 1) {
    for (let t = 0; t < 4; t += 0.1) {
      const s = sparkleAt(i, t);
      assert.ok(s.sizePx >= GLOW.SPARKLE_MIN_PX && s.sizePx <= GLOW.SPARKLE_MAX_PX);
      assert.ok(s.x >= 0.04 - 1e-9 && s.x <= 0.96 + 1e-9, `x off-tile: ${s.x}`);
      assert.ok(s.y >= 0.04 - 1e-9 && s.y <= 0.96 + 1e-9, `y off-tile: ${s.y}`);
      assert.ok(s.alpha >= 0 && s.alpha <= 1);
      assert.deepEqual(sparkleAt(i, t), s); // pure/deterministic
    }
    // a new generation exactly one respawn window later
    assert.equal(sparkleAt(i, 0.1).gen + 1, sparkleAt(i, 0.1 + GLOW.SPARKLE_RESPAWN_SEC).gen);
  }
  // staggered: the 6 sparkles never share one generation phase
  const phases = new Set();
  for (let i = 0; i < GLOW.SPARKLE_COUNT; i += 1) {
    const cycles = 0.6 / GLOW.SPARKLE_RESPAWN_SEC + i / GLOW.SPARKLE_COUNT;
    phases.add((cycles - Math.floor(cycles)).toFixed(4));
  }
  assert.equal(phases.size, GLOW.SPARKLE_COUNT);
});

// ---------------------------------------------------------------------------
// Static source seams (DOM renderers — browser-only, pinned by source scan)
// ---------------------------------------------------------------------------

test('arcadeScreen: §G7.2 grid is 2-col ALWAYS and taps open mgPregame', () => {
  const src = source('src/ui/arcadeScreen.js');
  assert.match(src, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(src, /showScreen\('mgPregame'/);
  assert.match(src, /gap:0\.75rem/); // §G7.2 gap
  assert.match(src, /max-width:27\.5rem/); // §G7.2 grid max-width
});

test('arcadeScreen: the g48-flagship span-2 treatment is retired (§G7.2)', () => {
  const src = source('src/ui/arcadeScreen.js');
  assert.ok(!src.includes('grid-column:span 2'), 'span-2 rule still present');
  assert.ok(!src.includes('g48-flagship{'), 'flagship CSS block still present');
  // …but the NEU ribbon logic/CSS stays (§C10.3 rules unchanged).
  assert.match(src, /g48-new-ribbon/);
  assert.match(src, /shouldShowV3GameRibbon/);
});

test('arcadeScreen: modifier glow rides the §G8-2 accessor + shared canvas driver', () => {
  const src = source('src/ui/arcadeScreen.js');
  assert.match(src, /getActiveFor\(/);
  assert.match(src, /createGlowManager\(/);
  assert.match(src, /arcade\.modifier\.badge/);
  assert.match(src, /--modifier-color/);
});

test('pregameScreen: registers mgPregame, launches with the selected difficulty', () => {
  const src = source('src/ui/pregameScreen.js');
  assert.match(src, /registerScreen\('mgPregame'/);
  assert.match(src, /difficulty: selected/);
  assert.match(src, /\.launch\(meta\.id, launchParams\)/);
  assert.match(src, /getActiveFor\(/); // §G8-1 banner accessor
  assert.match(src, /setDifficulty\(meta\.id/); // §G5.5 sticky selection
  assert.match(src, /goobyWeltQuality/); // §G6.6 quality toggle
  assert.match(src, /pregame\.locked/); // level requirement instead of PLAY
});

test('styles.css: ONE marked V4/G68 block with the pre-game + glow chrome', () => {
  const css = source('src/ui/styles.css');
  assert.match(css, /V4\/G68 — arcade cover grid \+ pre-game screen/);
  assert.match(css, /end V4\/G68/);
  assert.match(css, /\.g68-pre-cover/);
  assert.match(css, /min\(86vw, 22rem\)/); // §G5.6/§G7.3 cover width
  assert.match(css, /@keyframes g68pulse/); // §G7.2 box-shadow pulse (2 s ease)
  assert.match(css, /\.g68-glow-canvas/);
});
