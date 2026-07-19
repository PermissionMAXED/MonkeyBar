// Minigame framework (§E8). Owns the full launch flow: energy check → scene
// switch → asset preload → 3-2-1 countdown; pause/resume (incl. auto-pause on
// hidden); the results screen (score, best, coins, daily ×2 badge); reward
// payout; stat effects (−energy, +fun); XP; and returning to the home /
// shop-trip flow. Games never touch the store directly — they only get the
// §E8 ctx: { scene, camera, renderer, input, audio, assets, rng, hud, params,
// onScore(points), onEnd({score}) }.
//
// V4/G56 — framework 2.0 (PLAN4-GAMES §G5.7/§G6.6/§G3.3, PLAN4 §C-SYS4.4/
// §C-SYS7.1): awaited async init/dispose (splat prerequisite — sync games
// unaffected, awaiting undefined), a loading card while a Promise-returning
// init resolves (countdown starts only after), `launch(id, {difficulty})`
// with endless-lock validation and `ctx.params.difficulty/modifier`, the
// §G5.2 coin plumbing forwarded into economy.awardMinigame (§E0.1-2 single
// payout site; framework never computes final coins), modifier
// consume-on-launch + ≤1 refund-on-early-quit via G54's engine (feature-
// detected until it lands), the §C-SYS7.1 sick shop-trip gate, the §G3.3
// input-invert proxy, and the endless results row + endlessBest board.

import * as THREE from 'three';
import { MINIGAME, ROOMS } from '../data/constants.js';
import { getMinigame } from '../data/minigames.js';
import { t, getLang } from '../data/strings.js'; // V4/G56: + getLang (tx fallback)
import { clampStat, isExhausted } from '../systems/stats.js';
import { isMinigameUnlocked } from '../systems/leveling.js';
import * as economy from '../systems/economy.js'; // V4/G56: namespace — feature-detects G54's v4 payout support
// ── V2/G23 imports: §B3 meta forwarding + §C3.4 sick gate (pure modules) ──
import { canPlayMinigame } from '../systems/health.js';
import { onMinigameEnd as weightOnMinigameEnd } from '../systems/weight.js';
import { getAchievementsEngine } from '../systems/achievementsEngine.js';
import { now } from '../core/clock.js';
// ── end V2/G23 imports ──
// V3/G38 (§C8.6): surf-travel mode helpers — the „Laufen" run launches
// shoppingSurf with mode 'surfTravel' (alias 'travel') and rides the same
// trip-results/payout path as cityDrive's shopTrip mode. Cycle-free: nothing
// in shopTrip.js's import chain imports this module.
import { isSurfTravel, clampSurfTravelCoins } from '../systems/shopTrip.js';
import { hasGame, loadGame } from './registry.js';
import { icon } from '../ui/icons.js';
import { burstConfettiDom, flyCoinsDom } from '../gfx/particles.js'; // G14: results polish
// ── V4/G56 imports (framework 2.0) ──
import {
  DIFFICULTY_MODES,
  DIFFICULTY_COIN_MULT,
  ENDLESS_FLAT_COINS,
  applyDifficultyCoinBase,
  allowsWhileSick,
  effectiveDifficulty,
  endlessUnlocked,
  bestForMode,
  normalizeDifficulty,
  difficultyEnabled,
  difficultySliceOf,
} from './framework.logic.js';
import { wrapInvertInput } from '../core/inputInvert.js';
import { EN as DIFF_EN, DE as DIFF_DE } from '../data/strings/v4-difficulty.js';
// ── end V4/G56 imports ──
// ── V4/G76 imports (§C-SYS4.2/4.4 modifier surfacing — results breakdown,
// glueckspilz Glücksrolle, stickerChance forced drop; all pure helpers) ──
import {
  GLUECKSPILZ_ROLL,
  rollFrameValue,
  FORCED_DROP_SETS,
  hasOrganicDrop,
  pickForcedDrop,
  modifierResultsValue,
} from '../ui/modifierSurface.logic.js';
import { getCollectionSet } from '../data/collections.js';
import { countOf as stickerCountOf } from '../systems/collections.js';
// ── end V4/G76 imports ──

const awardMinigame = economy.awardMinigame; // V4/G56: unchanged call sites below

// V4/G56 (§E0.1-11): same-wave i18n fallback until G53 spreads
// strings/v4-difficulty.js into strings.js (G52's tx pattern).
function tx(key, vars) {
  const global = t(key, vars);
  if (global !== key) return global;
  let text = (getLang() === 'de' ? DIFF_DE : DIFF_EN)[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

// V4/G56 (§E0.1-11): G54's modifier engine + difficulty-target table land in
// the same wave — feature-detect via import.meta.glob so the build never
// hard-requires them. modifierApi stays null until systems/modifierEngine.js
// exists; targets default to null (lock toast omits the number).
const optionalModules = import.meta.glob(
  ['../systems/modifierEngine.js', '../data/difficultyTargets.js']
);
let modifierApi = null;
let difficultyTargets = null;
for (const [path, load] of Object.entries(optionalModules)) {
  load().then(
    (mod) => {
      if (path.includes('modifierEngine')) modifierApi = mod;
      else difficultyTargets = mod.TARGETS ?? mod.default ?? mod;
    },
    () => {}
  );
}

/** V4/G56: §G5.4 Schwer target for a game (null until G54's table lands). */
function targetFor(gameId) {
  const row = difficultyTargets?.[gameId];
  if (typeof row === 'number') return row;
  if (row && typeof row === 'object') return Number(row.target ?? row.hard) || null;
  return null;
}

// V4/G56 (§G3.3): module NAMESPACE loaders for the games — registry.loadGame
// returns only the default export, and registry.js is frozen (§E0.1-19), so
// the framework reads G57's module-level `export const controls` through its
// own glob (same modules, shared bundler cache — no double download).
const gameNamespaces = import.meta.glob('./games/*.js');

/** @param {string} gameId @returns {Promise<{invertible?: boolean}|undefined>} */
async function controlsOf(gameId) {
  try {
    const ns = await gameNamespaces[`./games/${gameId}.js`]?.();
    return ns?.controls;
  } catch {
    return undefined;
  }
}

// V4/G56 (§E0.1-2/§E0.1-11): does economy.awardMinigame already implement
// G54's v4 payout (difficulty/modifier options, per-mode board writes)?
// Source probe — the v3 body never mentions 'difficulty'; property names
// survive minification. While G54 hasn't landed, the framework passes a
// PRE-multiplied base as coinsOverride (same §E0.1-2 math, oracle-tested)
// so the payout slot in the stacking order is correct either way.
const economyHandlesDifficulty = /difficulty/.test(String(economy.awardMinigame));

/**
 * Deterministic RNG (mulberry32) handed to games as ctx.rng (§E8).
 * @param {number} seed
 * @returns {() => number} 0..1
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t2 = Math.imul(a ^ (a >>> 15), 1 | a);
    t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) | 0;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Clamp a float-text spawn position into the camera's visible safe area
 * (F4 P2-3): score popups spawned near screen edges otherwise clip offscreen.
 * Projects to NDC, insets by the sprite's half extents (converted to NDC at
 * the spawn depth), clamps, and unprojects at the same depth. Mutates and
 * returns `pos` so call sites can stay one-liners.
 * @param {import('three').Vector3} pos world-space spawn position
 * @param {import('three').Camera} camera the game's ctx.camera
 * @param {{halfW?: number, halfH?: number, pad?: number}} [opts] sprite half
 *   extents in world units (match the sprite scale) + extra NDC padding
 * @returns {import('three').Vector3} pos
 */
export function clampFloatTextToView(pos, camera, { halfW = 0.8, halfH = 0.3, pad = 0.02 } = {}) {
  if (!camera) return pos;
  camera.updateMatrixWorld();
  const p = pos.clone().project(camera);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return pos;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const ndcHalfW = Math.abs(pos.clone().addScaledVector(right, halfW).project(camera).x - p.x);
  const ndcHalfH = Math.abs(pos.clone().addScaledVector(up, halfH).project(camera).y - p.y);
  const limX = Math.max(0, 1 - ndcHalfW - pad);
  const limY = Math.max(0, 1 - ndcHalfH - pad);
  const cx = Math.max(-limX, Math.min(limX, p.x));
  const cy = Math.max(-limY, Math.min(limY, p.y));
  if (cx === p.x && cy === p.y) return pos;
  return pos.copy(new THREE.Vector3(cx, cy, p.z).unproject(camera));
}

/**
 * Create the framework: registers the 'minigame' scene and the results screen.
 * @param {{sceneManager: object, store: object, ui: object, audio: object}} deps
 * @returns {{launch: (id: string, params?: object) => Promise<boolean>,
 *   isActive: () => boolean}}
 */
export function createMinigameFramework({ sceneManager, store, ui, audio }) {
  /** Result of the last finished round, consumed by the results screen. */
  let lastResult = null;
  /** V4/G76: interval handle of the results Glücksrolle animation. */
  let glueckspilzRollTimer = 0;
  // F4 for F2: read-only "a minigame is on screen" flag — true from the
  // minigame scene's enter (countdown) through the results screen until the
  // scene exits. (sceneManager.currentId() === 'minigame' is the equivalent
  // check when a sceneManager handle is available.)
  let minigameActive = false;
  // V4/G56 (§C-SYS4.4): armed when a modifier play was consumed at launch;
  // disarmed when the countdown finishes (round really started). A scene exit
  // while still armed = early quit → ≤ 1 refund (the engine caps per event
  // via the snapshot's refundUsed flag — G54's contract).
  let modifierRefundArmed = false;
  /** @type {object|null} the pre-decrement event snapshot consume() returned */
  let modifierRefundSnapshot = null;

  // ---------------------------------------------------------------- results screen
  ui.registerScreen('mgResults', {
    /** @param {HTMLElement} el */
    mount(el) {
      const r = lastResult;
      if (!r) return;
      const card = document.createElement('div');
      card.className = 'card';
      card.style.textAlign = 'center';
      const bestBadge = r.newBest ? `<span class="mg-badge mg-badge-pink">${t('mg.results.newBest')}</span>` : '';
      const dailyBadge = r.firstToday ? `<span class="mg-badge">${t('mg.results.daily2x')}</span>` : '';
      // F4 P2-6: a shop trip is not an arcade round — its "score" IS the coin
      // payout (§C4.3 pickups + bonuses), so Score/Best rows would repeat the
      // coins with arcade wording. Trip results show the earned coins only
      // (existing strings; the trip flavor line reuses 'trip.earned').
      // V3/G38 (§C8.6): a surf-travel run gets the IDENTICAL coins-only trip
      // layout + „Laden/Shop" continue button — same arrival handoff.
      const isTrip = r.launchParams?.mode === 'shopTrip' || isSurfTravel(r.launchParams?.mode);
      // ── V4/G56 (§G5.6/§C-SYS4.4): endless-best extra row (+ newBest badge
      // on improvement). The endless badge reuses .mg-badge-pink. ──
      const isEndless = r.difficulty === 'endless';
      const endlessBadge = isEndless && r.endlessNewBest
        ? `<span class="mg-badge mg-badge-pink">${t('mg.results.newBest')}</span>` : '';
      const endlessRow = isEndless
        ? `<div class="mg-results-row"><span>${tx('mg.results.endlessBest')}</span><span class="mg-value">${r.endlessBest}${endlessBadge}</span></div>`
        : '';
      // ── end V4/G56 ──
      // ── V4/G76 (§C-SYS4.4/§G8-3 + §C-SYS4.2): modifier breakdown — the
      // "{name} aktiv" chip row (kept per §C-SYS4.4) gains the per-type
      // bonus line from the pure helper (doppelGold „+N extra" 🪙 with the
      // §C-SYS11 „Tagesbonus erreicht" note when day-capped, turbo
      // „Punkte ×1,5", stickerChance drop/quest-tick note); glueckspilz
      // adds its own „Glücksrolle" row whose 900 ms slot-roll (started
      // after mount below) lands on the bonus onEnd already PAID via
      // economy.award('glueckspilz'). ──
      const modifierName = r.modifierInfo?.nameKey ? t(r.modifierInfo.nameKey) : null;
      let modifierRow = '';
      if (modifierName && modifierName !== r.modifierInfo.nameKey) {
        const detail = modifierResultsValue(r.modifierInfo.type, {
          bonus: r.modifierBonus,
          capped: r.modifierCapped,
          stickerOutcome: r.stickerOutcome,
        });
        const detailText = detail
          ? `${tx(detail.key, detail.vars)}${detail.coin ? ` ${icon('coin', 16)}` : ''}`
          : '';
        modifierRow = `<div class="mg-results-row g76-mod-row" style="--modifier-color:${r.modifierInfo.color}"><span>${tx('mg.results.modifierActive', { name: modifierName })}</span><span class="mg-value">${detailText}</span></div>`;
        if (r.modifierInfo.type === 'glueckspilz') {
          modifierRow += `<div class="mg-results-row g76-mod-row g76-roll-row" style="--modifier-color:${r.modifierInfo.color}"><span>🍀 ${tx('modifier.results.glueckspilz')}</span><span class="mg-value g76-roll-value">…</span></div>`;
        }
      }
      // ── end V4/G76 (results breakdown) ──
      // V4/G56 (§G5.6): in endless mode the „Endlos-Best" row REPLACES the
      // Mittel „Best" row (r.best is mode-aware for easy/hard — §G5.5 boards).
      const bestRow = isEndless
        ? endlessRow
        : `<div class="mg-results-row"><span>${t('mg.results.best')}</span><span class="mg-value">${r.best}</span></div>`;
      const rows = isTrip
        ? `<div class="mg-results-row"><span>${t('mg.results.coins')}</span><span class="mg-value">${icon('coin', 20)} +${r.coins}${dailyBadge}</span></div>`
        : `<div class="mg-results-row"><span>${t('mg.results.score')}</span><span class="mg-value">${r.score}${bestBadge}</span></div>
          ${bestRow}${modifierRow}
          <div class="mg-results-row"><span>${t('mg.results.coins')}</span><span class="mg-value">${icon('coin', 20)} +${r.coins}${dailyBadge}</span></div>`;
      card.innerHTML = `
        <h1 class="mg-overlay-title">${t('mg.results.title')}</h1>
        <div style="font-weight:700;opacity:0.6">${t(r.titleKey)}</div>
        <div class="mg-results-rows">
          ${rows}
        </div>
        <div class="mg-btn-row"></div>`;
      const btnRow = card.querySelector('.mg-btn-row');
      const againBtn = document.createElement('button');
      againBtn.className = 'btn btn-teal';
      againBtn.innerHTML = `${icon('replay', 20)} ${t('mg.results.playAgain')}`;
      againBtn.addEventListener('click', async () => {
        audio.play('ui.confirmBig'); // V3/FIX-C (E19): results CTAs were silent
        ui.closeAll();
        await launch(r.gameId, r.launchParams);
      });
      const homeBtn = document.createElement('button');
      homeBtn.className = 'btn';
      // F4 P2-6: after a trip arrival the exit continues INTO the shop
      // (systems/shopTrip.js onExit) — label it that way (existing string).
      homeBtn.innerHTML = isTrip
        ? `${icon('cart', 20)} ${t('trip.shopTitle')}`
        : `${icon('home', 20)} ${t('mg.results.home')}`;
      homeBtn.addEventListener('click', () => {
        // V3/FIX-C (E19): silent before — trip results continue INTO the shop
        // (confirm), plain results leave to home (close/back semantics).
        audio.play(isTrip ? 'ui.confirmBig' : 'ui.close');
        ui.closeAll();
        exitToHome(r.launchParams);
      });
      btnRow.append(againBtn, homeBtn);
      el.appendChild(card);
      burstConfettiDom(el); // G14: results confetti (§G14 polish)
      // G14: coins fly from the results row to the HUD counter corner
      flyCoinsDom({ fromEl: card.querySelector('.mg-results-row:last-child .mg-value'), count: Math.min(10, Math.max(3, Math.round(r.coins / 3))), onArrive: () => audio.play('coin.fly') });
      // ── V4/G76 (§C-SYS4.2): glueckspilz 900 ms slot-roll — the reel
      // cycles seeded 10–60 display values every tick, then LANDS on the
      // bonus onEnd already paid (0 → the „Tagesbonus erreicht" note). ──
      const rollEl = card.querySelector('.g76-roll-value');
      if (rollEl) {
        const rollSeed = Math.floor(Number(r.glueckspilzSeed) || 0);
        let frame = 0;
        rollEl.classList.add('g76-rolling');
        rollEl.textContent = `+${rollFrameValue(frame, rollSeed)}`;
        glueckspilzRollTimer = setInterval(() => {
          frame += 1;
          if (frame * GLUECKSPILZ_ROLL.TICK_MS < GLUECKSPILZ_ROLL.DURATION_MS) {
            rollEl.textContent = `+${rollFrameValue(frame, rollSeed)}`;
            return;
          }
          clearInterval(glueckspilzRollTimer);
          glueckspilzRollTimer = 0;
          rollEl.classList.remove('g76-rolling');
          rollEl.classList.add('g76-roll-land');
          if (r.glueckspilzBonus > 0) {
            rollEl.innerHTML = `+${r.glueckspilzBonus} ${icon('coin', 16)}`;
            audio.play('coin.fly');
          } else {
            rollEl.textContent = tx('modifier.results.capped');
          }
        }, GLUECKSPILZ_ROLL.TICK_MS);
      }
      // ── end V4/G76 (Glücksrolle) ──
    },
    unmount() {
      // V4/G76: stop a still-spinning Glücksrolle on early screen close
      clearInterval(glueckspilzRollTimer);
      glueckspilzRollTimer = 0;
    },
  });

  /** Shop-trip arrival hands off to G7's flow via params.onExit; default: home. */
  function exitToHome(launchParams) {
    if (typeof launchParams?.onExit === 'function') {
      launchParams.onExit();
    } else {
      sceneManager.switchTo('home').catch((err) => console.error('[minigames] exit failed:', err));
    }
  }

  // ══════════════════════════════════════════════════════════════ V2/G23 ═══
  // §B3 meta forwarding on the end path: games call onEnd({score, meta?}) and
  // THIS block fans the round out to quests / collections / achievements /
  // weight. Wave-3/4 games need zero wiring — just pass `meta`.
  //
  // QUEST EVENT VOCABULARY (== §C5.1 `event` column, verbatim):
  //   gameFinish          n=1 per finished round (any game)
  //   gameDistinct        n=1, meta {id: gameId} — distinct-games set per day
  //   gameCoins           n = coins earned this round (after clamp/×2)
  //   score:<gameId>      n = final score — 'max' semantics (single round)
  //   fishCaught          n = meta.caught.length (fishingPond §C6 species)
  //   tricks:<gameId>     n = meta.tricks (trampoline §C5.1 q.tricks5)
  //   round:<gameId>      n = meta.round (goobySays q.says6; derived from
  //                       score when absent — §C1.2 #1: score = 10·rounds + 0–8)
  //   deliver             via the `deliveries` counter (meta.deliveries)
  //   cleanDrive          meta.crashes === 0 on NON-shopTrip drives (shop
  //                       trips ride the cleanTrips counter → same event)
  // Care/garden/economy events (feed, wash, pet, …) ride the achievements
  // counter diff in systems/achievementsEngine.js — not this block.
  //
  // KNOWN §B3 META SHAPES: fishingPond {caught: string[]} · cityDrive /
  // deliveryRush {landmarks: string[], crashes, distanceM(, deliveries)} ·
  // miniGolf {strokes, holeInOnes}. meta.distanceM is NOT forwarded here —
  // cityDrive feeds profile.distanceM itself via its 'gooby:driveDistance'
  // bridge (G21), so forwarding again would double-count.
  //
  // Also fed here: collections fish + landmark stickers (landmarks firstOnly —
  // G21 awards live during the drive too), `holeInOnes`/`deliveries` counters,
  // `nightPlays` counter for rounds finished 22:00–06:00 (§C10.3), and
  // weight.onMinigameEnd (§B5). play21 (§C5.3) needs no feed — its special
  // reads minigames.plays, which economy.awardMinigame already increments.

  /**
   * @param {string} gameId
   * @param {number} score final (clamped) round score
   * @param {number} coins coins paid for the round
   * @param {object|undefined} gameMeta the game's §B3 onEnd meta
   * @param {object} launchParams framework launch params (mode detection)
   * @param {boolean} devGame dev-only games (_smoke) skip progression
   * @returns {'drop'|'quest'|null} V4/G76: stickerChance round outcome
   */
  function forwardProgression(gameId, score, coins, gameMeta, launchParams, devGame) {
    if (devGame) return null;
    // V4/G76 (§C-SYS4.2): stickerChance round outcome for the results row —
    // 'drop' (a collection sticker landed) | 'quest' (+1 tick) | null.
    let stickerOutcome = null;
    try {
      const engine = getAchievementsEngine();
      if (engine?.quests) {
        const quests = engine.quests;
        quests.track('gameFinish', 1);
        quests.track('gameDistinct', 1, { id: gameId });
        if (coins > 0) quests.track('gameCoins', coins);
        if (score > 0) quests.track(`score:${gameId}`, score);
        const caught = Array.isArray(gameMeta?.caught) ? gameMeta.caught : null;
        if (caught && caught.length > 0) {
          quests.track('fishCaught', caught.length);
          for (const speciesId of caught) engine.collections.award('fish', speciesId);
        }
        if (Array.isArray(gameMeta?.landmarks)) {
          for (const landmarkId of gameMeta.landmarks) {
            engine.collections.award('landmarks', landmarkId, 1, { firstOnly: true });
          }
        }
        const tricks = Math.floor(Number(gameMeta?.tricks) || 0);
        if (tricks > 0) quests.track(`tricks:${gameId}`, tricks);
        const round = Math.floor(Number(gameMeta?.round) || 0)
          || (gameId === 'goobySays' ? Math.floor(score / 10) : 0);
        if (round > 0) quests.track(`round:${gameId}`, round);
        const holeInOnes = Math.floor(Number(gameMeta?.holeInOnes) || 0);
        if (holeInOnes > 0) engine.track('holeInOnes', holeInOnes);
        const deliveries = Math.floor(Number(gameMeta?.deliveries) || 0);
        if (deliveries > 0) engine.track('deliveries', deliveries);
        // ── V3/G38 (§C8.5/§C8.6): shoppingSurf counters — BOTH modes bump
        // surfRuns (sticker 'surfStar' rides it via the stickerBook counter
        // watcher) + surfDistanceM from the §B3 meta. Single count site: the
        // arrival flow in systems/shopTrip.js deliberately does NOT bump them.
        if (gameId === 'shoppingSurf') {
          engine.track('surfRuns');
          const surfDist = Math.floor(Number(gameMeta?.distanceM) || 0);
          if (surfDist > 0) engine.track('surfDistanceM', surfDist);
        }
        // ── end V3/G38 ────────────────────────────────────────────────────
        if (gameMeta && Number(gameMeta.crashes) === 0 && launchParams?.mode !== 'shopTrip'
          && gameId !== 'shoppingSurf') { // V3/G38: surf stumbles aren't drives — cleanDrive stays a car-game quest (§C8.6 pays its own clean bonus)
          quests.track('cleanDrive', 1);
        }
        const hour = new Date(now()).getHours();
        if (hour >= 22 || hour < 6) engine.track('nightPlays');
        // ── V4/G76 (§C-SYS4.2 stickerChance): forced collection drop —
        // the consumed modifier guarantees a collection-eligible drop.
        // Rounds that already dropped organically (fish `caught` /
        // landmark meta) satisfy the guarantee; otherwise games with a
        // §B3-v2 collection set (FORCED_DROP_SETS) get a seeded pick
        // (unowned first) awarded through the SAME central path as every
        // other sticker (awardSticker → first-time toast/XP watcher);
        // games without drops instead guarantee the +1 quest-progress
        // tick (an extra 'gameFinish' tick — the round counts double). ──
        if (launchParams?.modifier?.type === 'stickerChance' && launchParams?.mode == null) {
          if (hasOrganicDrop(gameMeta)) {
            stickerOutcome = 'drop';
          } else {
            const setId = FORCED_DROP_SETS[gameId];
            const setDef = setId ? getCollectionSet(setId) : null;
            if (setDef) {
              const c = store.get('collections');
              const entryIds = setDef.entries.map((e) => e.id);
              const owned = Object.fromEntries(entryIds.map((id) => [id, stickerCountOf(c, setId, id)]));
              const pick = pickForcedDrop(entryIds, owned, now(), setId === 'fish');
              if (pick) {
                engine.collections.award(setId, pick, 1, { firstOnly: setId === 'landmarks' });
                stickerOutcome = 'drop';
              }
            }
            if (stickerOutcome == null) {
              quests.track('gameFinish', 1);
              stickerOutcome = 'quest';
            }
          }
        }
        // ── end V4/G76 (forced drop) ──
      }
    } catch (err) {
      console.warn('[minigames] V2/G23 progression forwarding error:', err);
    }
    // §B5: every finished round nudges the weight (active games −1.0 / −0.25)
    store.update((state) => {
      state.weight = weightOnMinigameEnd(state.weight, gameId);
    });
    return stickerOutcome; // V4/G76: feeds the results breakdown row
  }
  // ══════════════════════════════════════════════════════════ end V2/G23 ═══

  // ---------------------------------------------------------------- minigame scene
  sceneManager.register('minigame', (ctx) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(ROOMS.CAMERA_FOV, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 0, 10);

    /** @type {object|null} */
    let game = null;
    let meta = null;
    let launchParams = null;
    let running = false;
    let paused = false;
    let ended = false;
    let elapsed = 0;
    let score = 0;

    /** @type {HTMLElement|null} */
    let hudEl = null;
    let scoreEl = null;
    let timeEl = null;
    /** @type {HTMLElement|null} */
    let pauseOverlayEl = null;

    function buildHud() {
      hudEl = document.createElement('div');
      hudEl.className = 'mg-hud';
      hudEl.innerHTML = `
        <div class="mg-top">
          <span class="mg-pill"><span class="mg-label">${t('mg.hud.score')}</span><span class="mg-score">0</span></span>
          <span class="mg-pill"><span class="mg-label">${t('mg.hud.time')}</span><span class="mg-time">–</span></span>
        </div>`;
      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'btn btn-ghost btn-round mg-pause-btn';
      pauseBtn.style.cssText = `position:absolute;bottom:calc(16px + var(--safe-bottom));right:calc(16px + var(--safe-right));`;
      pauseBtn.setAttribute('aria-label', t('mg.pause'));
      pauseBtn.innerHTML = icon('pause', 22);
      pauseBtn.addEventListener('click', () => pause());
      hudEl.appendChild(pauseBtn);
      ui.el.appendChild(hudEl);
      scoreEl = hudEl.querySelector('.mg-score');
      timeEl = hudEl.querySelector('.mg-time');
    }

    // F4 P2-2: banners fired in quick succession (combo + steal + reward …)
    // used to stack on the same spot and overlap. At most ONE banner is
    // visible; extra ones queue FIFO (bounded — old news gets dropped) and
    // queued banners display shorter so they never lag far behind the action.
    const BANNER_SEC = 1.2;
    const BANNER_QUEUED_SEC = 0.7;
    const BANNER_QUEUE_MAX = 3;
    /** @type {string[]} */
    const bannerQueue = [];
    /** @type {HTMLElement|null} */
    let bannerEl = null;
    let bannerTimer = 0;

    function showNextBanner(text) {
      bannerEl = document.createElement('div');
      bannerEl.className = 'mg-banner';
      bannerEl.textContent = text;
      hudEl.appendChild(bannerEl);
      const holdSec = bannerQueue.length > 0 ? BANNER_QUEUED_SEC : BANNER_SEC;
      bannerTimer = setTimeout(() => {
        bannerEl?.remove();
        bannerEl = null;
        const next = bannerQueue.shift();
        if (next != null && hudEl) showNextBanner(next);
      }, holdSec * 1000);
    }

    function clearBanners() {
      clearTimeout(bannerTimer);
      bannerEl?.remove();
      bannerEl = null;
      bannerQueue.length = 0;
    }

    /** §E8 hud handed to games. */
    const hud = {
      /** @param {number} n */
      setScore(n) {
        if (scoreEl) scoreEl.textContent = String(n);
      },
      /** @param {number} sec remaining seconds (rendered as ceil) */
      setTime(sec) {
        if (timeEl) timeEl.textContent = String(Math.max(0, Math.ceil(sec)));
      },
      /** @param {string} text pre-translated (games pass t(...) themselves) */
      banner(text) {
        if (!hudEl) return;
        if (bannerEl) {
          if (bannerQueue.length >= BANNER_QUEUE_MAX) bannerQueue.shift();
          bannerQueue.push(text);
          return;
        }
        showNextBanner(text);
      },
    };

    function countdown() {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'mg-countdown';
        ui.el.appendChild(overlay);
        let n = MINIGAME.COUNTDOWN_FROM;
        const show = () => {
          if (n < 0) {
            overlay.remove();
            resolve();
            return;
          }
          overlay.innerHTML = `<div class="mg-count">${n > 0 ? n : t('mg.countdown.go')}</div>`;
          audio.play(n > 0 ? 'ui.count' : 'ui.go');
          n -= 1;
          setTimeout(show, n < 0 ? 600 : 900);
        };
        show();
      });
    }

    function pause() {
      if (!running || paused || ended) return;
      paused = true;
      // F6 (RE5): optional §E8 game hook — games with real-time clocks
      // (danceParty) freeze/rebase them across the paused span.
      try {
        game?.onPause?.();
      } catch (err) {
        console.warn('[minigames] game onPause error:', err);
      }
      audio.play('ui.tap');
      pauseOverlayEl = document.createElement('div');
      pauseOverlayEl.className = 'screen';
      pauseOverlayEl.style.background = 'rgba(74,59,54,0.55)';
      const card = document.createElement('div');
      card.className = 'card';
      card.style.textAlign = 'center';
      card.innerHTML = `<h1 class="mg-overlay-title">${t('mg.paused')}</h1><div class="mg-btn-row"></div>`;
      const row = card.querySelector('.mg-btn-row');
      const resumeBtn = document.createElement('button');
      resumeBtn.className = 'btn btn-teal';
      resumeBtn.innerHTML = `${icon('play', 20)} ${t('mg.resume')}`;
      resumeBtn.addEventListener('click', () => resume());
      const quitBtn = document.createElement('button');
      quitBtn.className = 'btn btn-ghost';
      quitBtn.innerHTML = `${icon('home', 20)} ${t('mg.quit')}`;
      quitBtn.addEventListener('click', () => {
        removePauseOverlay();
        exitToHome(launchParams);
      });
      row.append(resumeBtn, quitBtn);
      pauseOverlayEl.appendChild(card);
      ui.el.appendChild(pauseOverlayEl);
    }

    function removePauseOverlay() {
      pauseOverlayEl?.remove();
      pauseOverlayEl = null;
    }

    // ── V4/G56 (§G6.6): loading card while a Promise-returning init resolves
    // (goobyWelt splat load, 2–9 s). Appended to document.body ABOVE the
    // sceneManager fade overlay (z 9999 → card z 10000 in styles.css), since
    // enter() runs while the stage is still faded to black. ──
    /** @type {HTMLElement|null} */
    let loadingEl = null;
    function showLoading() {
      loadingEl = document.createElement('div');
      loadingEl.className = 'mg-loading';
      loadingEl.innerHTML = `
        <div class="mg-loading-card">
          <div class="mg-loading-title">${t(meta.titleKey)}</div>
          <div class="mg-loading-text">${tx('mg.loading')}</div>
          <div class="mg-loading-dots"><span></span><span></span><span></span></div>
        </div>`;
      document.body.appendChild(loadingEl);
    }
    function hideLoading() {
      loadingEl?.remove();
      loadingEl = null;
    }
    // ── end V4/G56 loading card ──

    function resume() {
      removePauseOverlay();
      paused = false;
      // F6 (RE5): optional §E8 game hook — see pause().
      try {
        game?.onResume?.();
      } catch (err) {
        console.warn('[minigames] game onResume error:', err);
      }
    }

    function onHidden() {
      if (document.visibilityState === 'hidden') pause();
    }

    /** §E8 ctx.onScore — accumulate + reflect in the HUD. */
    function onScore(points) {
      score += points;
      hud.setScore(score);
    }

    /** §E8 ctx.onEnd — rewards, persistence, results screen. */
    function onEnd({ score: finalScore, coins: coinsOverride, meta: gameMeta } = {}) { // V2/G23: + §B3 meta
      if (ended) return;
      ended = true;
      running = false;
      const s = typeof finalScore === 'number' ? finalScore : score;

      // V3/G38 (§C8.6): defensive travel-reward ceiling — a surf-travel run
      // pays the game's collected-coins override, but never more than
      // cap 30 + clean bonus 5 = 35 (== cityDrive's trip cap). Clamped
      // BEFORE awardMinigame so the daily ×2 applies AFTER the clamp.
      const coinsPaid = typeof coinsOverride === 'number' && isSurfTravel(launchParams?.mode)
        ? clampSurfTravelCoins(coinsOverride)
        : coinsOverride;

      // ── V4/G56 (§G5.2/§E0.1-2): difficulty into THE payout site. The
      // framework never computes FINAL coins — economy owns daily ×2 / code
      // buff / doppelGold. Endless ALWAYS passes `coinsOverride: 5` (§E0.1-2
      // ruling; daily ×2 still applies after). Easy/hard forward the
      // `difficulty`/`modifier` options once G54's economy handles them;
      // until then the §G5.2 base (rowClamp × mult, re-clamped) is
      // pre-multiplied HERE via the shared framework.logic.js oracle and
      // passed as coinsOverride — same math, same stacking slot. Trips ride
      // mode semantics (difficulty is always 'normal' for them). ──
      const difficulty = normalizeDifficulty(launchParams?.difficulty);
      const isTripEnd = launchParams?.mode != null;
      const devGame = !!meta.dev;
      const prevModeBest = bestForMode(store.get(), meta.id, difficulty);
      const prevMittelBest = store.get(`minigames.best.${meta.id}`) ?? 0;
      let awardOpts = { coinsOverride: coinsPaid };
      if (!isTripEnd && !devGame && difficulty !== 'normal') {
        if (difficulty === 'endless') {
          awardOpts = { coinsOverride: ENDLESS_FLAT_COINS, difficulty, modifier: launchParams?.modifier };
        } else if (economyHandlesDifficulty) {
          awardOpts = { coinsOverride: coinsPaid, difficulty, modifier: launchParams?.modifier };
        } else if (typeof coinsPaid !== 'number') {
          awardOpts = { coinsOverride: applyDifficultyCoinBase(meta.coinTable, s, difficulty) };
        }
      } else if (!isTripEnd && !devGame && economyHandlesDifficulty) {
        awardOpts = { coinsOverride: coinsPaid, difficulty, modifier: launchParams?.modifier };
      }
      // G11: economy.awardMinigame is the single payout path (§C6 coins incl.
      // daily ×2, +fun, XP + level-up coins, plays/best/lastPlayDay — §C1.5).
      const reward = awardMinigame(store, meta.id, s, awardOpts);

      // ── V4/G56 (§G5.5): per-mode boards. economy.awardMinigame (G54) is
      // the persistence site once it lands — these fallback writes are
      // monotone + idempotent (no-ops when economy already wrote them):
      // easy/hard highscores land in bestByDiff, endless in endlessBest, and
      // the Mittel `best` board is restored if the v3 economy wrote a
      // non-Mittel score onto it. Containers are created defensively until
      // G53's save-v4 migration ships them. ──
      const modeNewBest = s > prevModeBest;
      if (!isTripEnd && !devGame && difficulty !== 'normal') {
        store.update((state) => {
          const mg = state.minigames;
          if ((mg.best?.[meta.id] ?? 0) !== prevMittelBest) mg.best[meta.id] = prevMittelBest;
          if (difficulty === 'endless') {
            if (mg.endlessBest == null || typeof mg.endlessBest !== 'object') mg.endlessBest = {};
            if (s > (Math.floor(Number(mg.endlessBest[meta.id])) || 0)) mg.endlessBest[meta.id] = s;
          } else {
            if (mg.bestByDiff == null || typeof mg.bestByDiff !== 'object') mg.bestByDiff = {};
            const row = mg.bestByDiff[meta.id] && typeof mg.bestByDiff[meta.id] === 'object'
              ? mg.bestByDiff[meta.id]
              : {};
            if (s > (Math.floor(Number(row[difficulty])) || 0)) row[difficulty] = s;
            mg.bestByDiff[meta.id] = row;
          }
        });
      }
      // ── end V4/G56 payout plumbing ──

      // ── V2/G23: §B3 meta forwarding + progression wiring ─────────────────
      // V4/G76: returns the stickerChance round outcome (null without one)
      const stickerOutcome = forwardProgression(meta.id, reward.score, reward.coins, gameMeta, launchParams, devGame);
      // ── end V2/G23 ────────────────────────────────────────────────────────

      // ── V4/G76 (§C-SYS4.2/§E0.1-2): glueckspilz results-roll — ONE
      // seeded 10–60 c roll per consumed play (G54's rollGlueckspilz
      // advances the persisted seed stream) paid via
      // economy.award('glueckspilz') so the §C-SYS11 day cap applies THERE
      // (granted 0 → „Tagesbonus erreicht" on the results row). Rolled
      // HERE in onEnd, never at results mount, so a re-mount cannot pay
      // twice — the Glücksrolle animation only lands on this number. ──
      let glueckspilzBonus = 0;
      let glueckspilzSeed = 0;
      if (launchParams?.modifierInfo?.type === 'glueckspilz' && !isTripEnd && !devGame
        && typeof modifierApi?.rollGlueckspilz === 'function') {
        try {
          let rolled = 0;
          store.update((state) => {
            glueckspilzSeed = Math.floor(Number(state.modifiers?.seed) || 0);
            rolled = modifierApi.rollGlueckspilz(state);
          });
          glueckspilzBonus = economy.award(store, rolled, 'glueckspilz');
        } catch (err) {
          console.warn('[minigames] glueckspilz roll failed:', err);
        }
      }
      // ── end V4/G76 (glueckspilz payout) ──

      lastResult = {
        gameId: reward.gameId,
        titleKey: meta.titleKey,
        score: reward.score,
        // V4/G56 (§G5.5/§G5.6): mode-aware boards — easy/hard show their
        // bestByDiff board; endless carries the endless row instead (its
        // score-row badge stays off, the ∞ row wears it).
        best: difficulty === 'normal' ? reward.best : Math.max(prevModeBest, reward.score),
        newBest: difficulty === 'normal' ? reward.newBest : difficulty !== 'endless' && modeNewBest,
        coins: reward.coins,
        firstToday: reward.firstToday,
        launchParams,
        // V4/G56 (§G5.6/§C-SYS4.4): results extras
        difficulty,
        endlessBest: difficulty === 'endless' ? Math.max(prevModeBest, reward.score) : 0,
        endlessNewBest: difficulty === 'endless' && modeNewBest,
        modifierInfo: launchParams?.modifierInfo ?? null, // §G8-1 descriptor (nameKey chip)
        modifierBonus: Math.max(0, Math.floor(Number(reward.modifierBonus) || 0)),
        // V4/G76 (§C-SYS4.2/§C-SYS11): results-breakdown facts
        modifierCapped: reward.dayCapReached === true,
        stickerOutcome,
        glueckspilzBonus,
        glueckspilzSeed,
      };
      // V3/G32 (§C3.3): context-aware results stingers replace the blind
      // 'jingle.results' pick — best (HIT15) / normal (HIT10) / zero (HIT08).
      // V4/G56: compared against the MODE board (identical for Mittel).
      audio.play(
        reward.score <= 0 ? 'jingle.resultsZero'
          : reward.score >= lastResult.best ? 'jingle.resultsBest'
            : 'jingle.resultsNormal'
      );
      ui.showScreen('mgResults');
    }

    let exited = false;

    return {
      scene,
      camera,
      async enter(params) {
        minigameActive = true; // F4 for F2
        meta = getMinigame(params.gameId);
        launchParams = params.params ?? {};
        const mod = await loadGame(params.gameId);
        buildHud();
        try {
          await ctx.assets?.preload?.(mod.assetKeys ?? []);
        } catch (err) {
          console.warn('[minigames] asset preload failed:', err);
        }
        // V3/G32 (§B2.3): warm the game's sample buffers into the decoded
        // LRU cache — optional `sfx: []` export of sfx ids and/or raw
        // '<pack>/<file>' keys (fire-and-forget: never blocks the launch).
        if (Array.isArray(mod.sfx) && mod.sfx.length > 0) {
          Promise.resolve(audio.preloadSamples?.(mod.sfx)).catch(() => {});
        }
        const seed = Number.isFinite(launchParams.seed) ? launchParams.seed : Math.floor(Math.random() * 2 ** 31);
        game = mod;
        // ── V4/G56 (§G3.3): input-invert proxy. Wrapped when the module's
        // controls export (G57's contract) does NOT opt out — modules without
        // the export default to invertible; positional-input games export
        // `invertible: false` and get the RAW emitter. Flags are read live per
        // event, so a settings flip applies to the running round. pick()/tap
        // always stay screen-true (proxy passes them through untouched). ──
        const gameControls = await controlsOf(params.gameId);
        const gameInput = gameControls?.invertible !== false
          ? wrapInvertInput(ctx.input, () => ({
            x: store.get('settings.controls.invertX') === true,
            y: store.get('settings.controls.invertY') === true,
          }))
          : ctx.input;
        // ── V4/G56 (§G6.6): awaited async init. Sync games return undefined
        // (no card, no behavior change); a thenable shows the loading card and
        // holds the countdown until init resolves. Rejection exits to home
        // (deferred until the in-flight switch settles — switchTo is a no-op
        // while switching). ──
        let initResult;
        try {
          initResult = game.init({
            scene,
            camera,
            renderer: ctx.renderer,
            input: gameInput,
            audio,
            assets: ctx.assets,
            rng: createRng(seed),
            hud,
            params: launchParams,
            onScore,
            onEnd,
          });
        } catch (err) {
          initResult = Promise.reject(err);
        }
        if (initResult && typeof initResult.then === 'function') {
          showLoading();
          try {
            await initResult;
          } catch (err) {
            console.error('[minigames] game init failed:', err);
            hideLoading();
            ui.toast('toast.minigameMissing');
            const backToHome = () => {
              if (sceneManager.isSwitching?.() === true) {
                setTimeout(backToHome, 120);
                return;
              }
              exitToHome(launchParams);
            };
            setTimeout(backToHome, 120);
            return;
          }
          hideLoading();
          if (exited) return;
        }
        // ── end V4/G56 async init ──
        document.addEventListener('visibilitychange', onHidden);
        // The countdown runs AFTER enter resolves so the scene fade lifts
        // first and 3-2-1 plays over the visible stage (not behind black).
        (async () => {
          await countdown();
          if (exited) return;
          // Energy cost is charged when the round actually starts (§C6).
          // V3/G38 (§C8.6): a surf TRAVEL run costs the car-game rate (6,
          // like the drive it replaces) — the arcade tile keeps its 8.
          const energyCost = isSurfTravel(launchParams.mode)
            ? MINIGAME.DRIVE_ENERGY_COST
            : meta.energyCost;
          store.update((state) => {
            state.stats.energy = clampStat(state.stats.energy - energyCost);
          });
          running = true;
          // V4/G56 (§C-SYS4.4): round started — the play is spent for good
          modifierRefundArmed = false;
          modifierRefundSnapshot = null;
        })();
      },
      update(dt) {
        if (!running || paused || ended || !game) return;
        elapsed += dt;
        try {
          game.update?.(dt, elapsed);
        } catch (err) {
          console.error('[minigames] game update error:', err);
        }
      },
      exit() {
        exited = true;
        minigameActive = false; // F4 for F2
        document.removeEventListener('visibilitychange', onHidden);
        removePauseOverlay();
        clearBanners();
        hideLoading(); // V4/G56 (§G6.6): quit while an async init is pending
        // ── V4/G56 (§C-SYS4.4): leaving BEFORE the countdown finished
        // refunds the consumed modifier play — max ONCE per event (G54's
        // engine enforces via the snapshot's refundUsed flag). ──
        if (modifierRefundArmed) {
          modifierRefundArmed = false;
          const snapshot = modifierRefundSnapshot;
          modifierRefundSnapshot = null;
          try {
            if (snapshot && typeof modifierApi?.refund === 'function') {
              store.update((state) => modifierApi.refund(state, snapshot, now()));
              // V4/G76 (§B10): announce the refunded slice like consume does
              store.emit?.('modifierChanged', {
                current: store.get('modifiers')?.current ?? null,
                nextAt: Number(store.get('modifiers')?.nextAt) || 0,
              });
            }
          } catch (err) {
            console.warn('[minigames] modifier refund failed:', err);
          }
        }
        // ── end V4/G56 ──
        hudEl?.remove();
        hudEl = null;
      },
      dispose() {
        // V4/G56 (§G6.6): a Promise-returning game dispose (goobyWelt's
        // `await splats.dispose()`) is returned so sceneManager.switchTo can
        // await it; the safety sweep then runs AFTER the game freed its own
        // resources. Sync games keep the exact v3 path (sweep runs inline).
        const sweep = () => {
          // V2/FIX-F P2-3 (E17): the safety sweep frees leftovers the game's own
          // dispose missed, but must SKIP resources shared with the permanent
          // asset cache (assets.getModel clones share master geo/mats — blanket
          // disposal churned 40 geo + 40 mats per cityDrive quit, forcing GPU
          // re-uploads + shader recompiles on the next launch). Mirrors
          // roomManager's disposeIfOwned pattern (also honors userData.shared).
          const isShared = (res) =>
            ctx.assets?.isCachedResource?.(res) === true || res?.userData?.shared === true;
          scene.traverse((obj) => {
            if (obj.geometry && !isShared(obj.geometry)) obj.geometry.dispose?.();
            if (obj.material) {
              for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
                if (!isShared(m)) m.dispose?.();
              }
            }
          });
        };
        let disposeResult;
        try {
          disposeResult = game?.dispose?.();
        } catch (err) {
          console.error('[minigames] game dispose error:', err);
        }
        game = null;
        if (disposeResult && typeof disposeResult.then === 'function') {
          return disposeResult
            .catch((err) => console.error('[minigames] async game dispose error:', err))
            .then(sweep);
        }
        sweep();
      },
    };
  });

  // ---------------------------------------------------------------- launch
  /** F6 (RE5): retry cadence/budget while an in-flight scene switch settles. */
  const LAUNCH_RETRY_MS = 100;
  const LAUNCH_RETRY_MAX_MS = 5000;
  /** V2/FIX-F P2-6 (E20): serialize launches — see the guard in launch(). */
  let launchInFlight = false;

  /**
   * Launch a minigame by id (§E8): checks metadata, implementation, unlock
   * level (skipped for params.dev — harness/testing), sleep and exhaustion
   * (§C1) before switching scenes.
   *
   * F6 (RE5): sceneManager.switchTo is a SILENT no-op while another switch is
   * in flight (fade guard) — launch keeps retrying until the switch settles
   * and only resolves true once the minigame scene really is current (results
   * "Home" → immediate relaunch, arcade taps during fades, …). Resolves false
   * if it never lands within the retry budget.
   *
   * V2/FIX-F P2-6 (E20): launches are SERIALIZED — while one launch is in
   * flight every further call returns false immediately (two concurrent
   * launches used to both resolve true, last one winning the scene). The
   * fade-retry loop above still runs for the single active launch.
   * @param {string} id
   * @param {object} [params] forwarded to the game as ctx.params;
   *   params.dev bypasses the level lock; params.onExit overrides the
   *   return-to-home flow (shop trip — G7); params.seed pins ctx.rng.
   * @returns {Promise<boolean>} whether the game was launched
   */
  async function launch(id, params = {}) {
    if (launchInFlight) return false; // V2/FIX-F P2-6
    launchInFlight = true;
    try {
      return await launchInner(id, params);
    } finally {
      launchInFlight = false;
    }
  }

  /** The single active launch (V2/FIX-F P2-6 keeps this un-reentrant). */
  async function launchInner(id, params = {}) {
    const meta = getMinigame(id);
    if (!meta || !hasGame(id)) {
      ui.toast('toast.minigameMissing');
      return false;
    }
    const level = store.get('level');
    // V3/G38 (§C8.6): the surf-travel run („Laufen" to the shop) is available
    // from L1 like the drive — only the shoppingSurf ARCADE tile is L5-locked.
    const surfTravelLaunch = id === 'shoppingSurf' && isSurfTravel(params.mode);
    if (!params.dev && !meta.dev && !surfTravelLaunch && !isMinigameUnlocked(id, level)) {
      ui.toast('mg.locked', { level: meta.minLevel });
      return false;
    }
    if (store.get('sleep.sleeping')) {
      ui.toast('toast.sleeping');
      return false;
    }
    if (isExhausted(store.get('stats'))) {
      ui.toast('toast.tooSleepy');
      return false;
    }
    // V2/G23 wires (§C3.4/§B5): sick Gooby refuses minigames — mirrors the
    // exhausted gate right above; health.canPlayMinigame is G20's contract.
    // G23b: mode 'vetTrip' (G21's shopTrip machine, §C9.2) is EXEMPT — the
    // vet drive exists to cure sick Gooby (its entry points are the 🤒 chip
    // and the care sheet). V4/G56 (§C-SYS7.1): BOTH shop travel methods
    // (drive 'shopTrip' AND Shopping Surf 'surfTravel'/'travel') now also
    // launch while sick — a sick Gooby drives slowly-but-surely to buy
    // medicine. Pure arcade launches stay blocked with toast.tooSick.
    if (!allowsWhileSick(params.mode) && !canPlayMinigame(store.get('health'))) {
      ui.toast('toast.tooSick');
      return false;
    }
    // ── V4/G56 (§G5.7-1): difficulty resolution + endless lock. An explicit
    // params.difficulty (mgPregame / harness) wins; otherwise the §G5.5
    // sticky selection (minigames.difficulty[id], defensive until G53's
    // migration). Trips/excluded/dev games normalize to 'normal' inside
    // effectiveDifficulty. `params.dev` bypasses the endless lock like it
    // bypasses level locks (§G5.5 harness rule). ──
    const requested = params.difficulty !== undefined
      ? params.difficulty
      : difficultySliceOf(store.get(), id).selected;
    const difficulty = effectiveDifficulty(id, { ...params, difficulty: requested }, meta);
    if (difficulty === 'endless' && !params.dev && !endlessUnlocked(store.get(), id)) {
      // tx pre-translates (module not spread yet §E0.1-11); ui.toast's t()
      // lookup then misses and passes the finished text through verbatim.
      ui.toast(tx('toast.endlessLocked'));
      return false;
    }
    const launchParams = { ...params, difficulty, modifier: undefined, modifierInfo: undefined };
    // ── V4/G56 (§C-SYS4.4): modifier passthrough + consume-on-launch via
    // G54's engine (lazy-loaded; stale modifiers from a results-screen
    // relaunch are dropped above). Trips and dev launches are never modified
    // (§C-SYS4.3 — getActiveFor also nulls trip modes itself). ctx.params
    // carries TWO shapes per §E0.1-3: `modifier` = plain {type, …tuning}
    // numbers for the game logic (engine.launchParams), `modifierInfo` = the
    // §G8-1 descriptor (nameKey/icon/color) for the results chip. ──
    if (!params.dev && !meta.dev && params.mode == null && modifierApi) {
      try {
        const active = typeof modifierApi.getActiveFor === 'function'
          ? modifierApi.getActiveFor(store.get(), id, now(), { mode: params.mode }) ?? null
          : null;
        if (active) {
          let consumed = null;
          if (typeof modifierApi.consume === 'function') {
            store.update((state) => {
              consumed = modifierApi.consume(state, id, now());
            });
          }
          const snapshot = consumed?.ok ? consumed.modifier : active;
          launchParams.modifier = typeof modifierApi.launchParams === 'function'
            ? modifierApi.launchParams(snapshot) ?? { type: active.type }
            : { type: active.type };
          launchParams.modifierInfo = active;
          if (consumed?.ok) {
            modifierRefundArmed = true; // early quit refunds ≤ 1× (§C-SYS4.4)
            modifierRefundSnapshot = consumed.modifier;
            // V4/G76 (§B10): the consuming mutator announces the slice change
            // — the HUD chip/badges hide instantly after the last play.
            store.emit?.('modifierChanged', {
              current: store.get('modifiers')?.current ?? null,
              nextAt: Number(store.get('modifiers')?.nextAt) || 0,
            });
          }
        }
      } catch (err) {
        console.warn('[minigames] modifier wiring failed:', err);
      }
    }
    // ── end V4/G56 launch plumbing ──
    ui.closeAll();
    const deadline = Date.now() + LAUNCH_RETRY_MAX_MS;
    const settled = () =>
      sceneManager.currentId?.() === 'minigame' && sceneManager.isSwitching?.() !== true;
    await sceneManager.switchTo('minigame', { gameId: id, params: launchParams });
    while (!settled() && Date.now() < deadline) {
      // A switch was in progress and ours was swallowed (or the OLD scene is
      // still current during its fade-out) — wait for it to settle, re-check,
      // then re-issue. isSwitching() guards the fade-out phase where
      // currentId() still reports the pre-switch scene.
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_RETRY_MS));
      if (settled()) break;
      if (sceneManager.isSwitching?.() === true) continue; // still fading
      await sceneManager.switchTo('minigame', { gameId: id, params: launchParams });
    }
    return settled();
  }

  // ══════════════════════════════════════════════════════════════ V4/G56 ═══
  // §G5.5/§G5.6 — the data contract for G68's mgPregame (published API).

  /**
   * Read-only difficulty snapshot for one game (all fields defensive against
   * the pre-G53 save shape — empty defaults, never throws).
   * @param {string} gameId
   * @returns {{enabled: boolean, modes: readonly string[],
   *   selected: 'easy'|'normal'|'hard',
   *   beaten: {easy?: boolean, normal?: boolean, hard?: boolean},
   *   bestByMode: {easy: number, normal: number, hard: number, endless: number},
   *   endlessUnlocked: boolean, target: number|null,
   *   coinMult: Readonly<{easy: number, normal: number, hard: number}>,
   *   endlessCoins: number}}
   */
  function getDifficultyState(gameId) {
    const state = store.get();
    const gameMeta = getMinigame(gameId);
    const slice = difficultySliceOf(state, gameId);
    return {
      enabled: difficultyEnabled(gameId, gameMeta),
      modes: DIFFICULTY_MODES,
      selected: slice.selected,
      beaten: slice.beaten,
      bestByMode: {
        easy: bestForMode(state, gameId, 'easy'),
        normal: bestForMode(state, gameId, 'normal'),
        hard: bestForMode(state, gameId, 'hard'),
        endless: bestForMode(state, gameId, 'endless'),
      },
      endlessUnlocked: endlessUnlocked(state, gameId),
      target: targetFor(gameId), // §G5.4 Schwer target (null until G54's table lands)
      coinMult: DIFFICULTY_COIN_MULT,
      endlessCoins: ENDLESS_FLAT_COINS,
    };
  }

  /**
   * Persist the §G5.5 sticky selection. 'endless' is a LAUNCH mode, never a
   * persisted selection (§G5.5) — it and unknown values coerce to 'normal'.
   * Creates the container defensively until G53's migration ships it.
   * @param {string} gameId
   * @param {'easy'|'normal'|'hard'} mode
   */
  function setDifficulty(gameId, mode) {
    const m = mode === 'easy' || mode === 'hard' ? mode : 'normal';
    store.update((state) => {
      if (state.minigames.difficulty == null || typeof state.minigames.difficulty !== 'object') {
        state.minigames.difficulty = {};
      }
      state.minigames.difficulty[gameId] = m;
    });
  }
  // ══════════════════════════════════════════════════════════ end V4/G56 ═══

  return {
    launch,
    // F4 for F2: read-only accessor so outside systems (permission soft-ask
    // deferral in ui/permissionPrompt.js) can detect an in-progress minigame
    // without a sceneManager handle.
    isActive: () => minigameActive,
    // V4/G56 (§G5.6): mgPregame's data contract (G68 consumes).
    getDifficultyState,
    setDifficulty,
  };
}
