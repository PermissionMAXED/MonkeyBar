// Economy (§C1.5, §C4.6, §C5, §C6 — agent G11): the single money path.
// Coins only move through award/spend (atomic, store events via §E2);
// awardMinigame is the one minigame payout path (coins incl. daily ×2,
// fun, XP + level-up coins, plays/best/lastPlayDay bookkeeping) — the
// framework's onEnd calls it and renders the returned breakdown.
// Quick Delivery (§C4.6): quickPrice(base) = ceil(base * 1.2), one-time
// 400c unlock gated at level 8, food-only orders from home.
//
// Pure module (§B): no three.js/DOM imports — node:test runs it headlessly.
// The store is injected per call (first parameter) so tests can run many
// isolated stores; all numbers come from data/constants.js.
//
// V2/G16 (PLAN2 §B3, all additive): every award/spend also increments
// profile.coinsEarned/coinsSpent; new APIs sellHarvest / buySeed / buyItem /
// useMedicine / payVet / buySkin / buyPlot (garden §C2, care §C3.5, vet
// §C9.2, skins §C8.5, plots §B6). ALL coin movement still flows exclusively
// through this module.
//
// V2/FIX-A (E8 arbitrage, coordinator ruling): the §C2.3 sell prices and §C7
// shop prices are BINDING and 6 of 8 crops sell above their shop price, so
// compost sales are gated on HARVEST PROVENANCE instead of price changes —
// recordHarvest credits items['harvested:<foodId>'] at the harvest site, and
// sellHarvest only sells min(inventory, harvestedCount) (sellableHarvest).
// Shop-bought crop foods are never compost-sellable.
//
// V4/G54 (PLAN4 §B11, §C-SYS11, §E0.1-2 — the binding stacking ruling):
//   • awardMinigame gains {difficulty, modifier} options; the SINGLE payout
//     site is frozen as base = min(row.max, max(row.min, round(rowClamp(score)
//     × difficultyMult))) → paid = base × dailyFirstPlay(×2) × codeBuff(×2)
//     × doppelGold(×2). doppelGold additionally caps paid ≤ 2 × row.max and
//     books the surplus (paid − base×daily×buff) into modifiers.dayCoins
//     against MODIFIER.DAY_COIN_CAP (150 c/local day — §C-SYS11.1 rows 1/5;
//     beyond it doppelGold pays base, the breakdown flags dayCapReached).
//   • Endless (§G5.2): flat 5 c override (framework passes coinsOverride 5),
//     daily ×2 applies; ALL endless-reason coins share the §C-SYS11.1 row-6
//     ≤ 100 c/local-day ledger (modifiers.endlessCoins/endlessCoinsDay).
//   • award() reasons 'glueckspilz'/'modifier' book into modifiers.dayCoins
//     (capped — a capped glueckspilz roll returns 0 → „Tagesbonus erreicht"),
//     'endless' books into the endless ledger; new reasons whitelist:
//     'code' | 'modifier' | 'glueckspilz' | 'endless' (§B11).
//   • beaten/bestByDiff/endlessBest single persistence site (§G5.7-4):
//     score ≥ data/difficultyTargets.js target sets beaten[id][mode]; easy/
//     hard highscores land in bestByDiff (`best` stays the Mittel board),
//     endless in endlessBest.
//   • getLedger(): dev-only in-memory ring buffer of the last 50 coin
//     movements {at, kind, amount, reason, balance} — NOT persisted (§B11).

import { ECONOMY, MINIGAME, ITEM_PRICES, UNLOCKS, VET } from '../data/constants.js'; // V2/G16: + v2 tables
import { getMinigame } from '../data/minigames.js'; // V4/G54: rowClamp math inlined at the §E0.1-2 stacking site
import { getFood } from '../data/foods.js';
import { getCrop } from '../data/crops.js'; // V2/G16 (§C2.3)
import { getSkin } from '../data/skins.js'; // V2/G16 (§C8.5)
import { applyXp, minigameXp } from './leveling.js';
import { clampStat } from './stats.js';
import { add as invAdd, remove as invRemove } from './inventory.js'; // V2/G16: + remove; V2/FIX-A: has-gate moved into sellableHarvest
import { localDay, now } from '../core/clock.js'; // V2/G16: + now (health calls)
// V4/G54: modifier caps/slice factory + §G5.4 targets (both pure, cycle-free)
import { MODIFIER_CAPS, defaultSlice as modifierDefaultSlice } from './modifierEngine.js';
import { getTarget } from '../data/difficultyTargets.js';
import { isDoubleCoinsActive } from './codesEngine.js'; // V4/G53 (§B6: code buff — pure)

/**
 * @typedef {import('../core/store.js').createStore} _store
 * @typedef {ReturnType<_store>} Store
 */

/** Normalize a coin amount: integer ≥ 0 (fractions round AGAINST the player). */
const normAward = (n) => Math.max(0, Math.floor(Number(n) || 0));
const normCost = (n) => Math.max(0, Math.ceil(Number(n) || 0));

// --- V2/G16: optional health engine (PLAN2 §B3/§C3.5) -----------------------
// systems/health.js is G17's pure state machine (same wave). Economy only
// consumes it when the module exists at runtime — lazy dynamic import, so
// neither node:test nor the bundler hard-require it. // V2/G20 wires fully
// (tick/notification/UI effects); until then useMedicine/payVet already apply
// the §C3.5 health-slice effects through these pure calls when available.
let healthApi = null;
/** Resolves once the optional health module has been probed (tests await it). */
export const healthReady = import('./health.js').then(
  (mod) => { healthApi = mod; },
  () => { healthApi = null; }
);

// --- V4/G54: dev ledger + §C-SYS11 day-cap bookkeeping ----------------------

/** §G5.2 difficulty coin multipliers (frozen at the single payout site). */
export const DIFFICULTY_COIN_MULT = Object.freeze({ easy: 0.7, normal: 1, hard: 1.3 });

/** §G5.2: Endlos pays a flat 5 c per run (daily ×2 still applies after). */
export const ENDLESS_FLAT_COINS = 5;

/** Ledger ring-buffer size (§B11: last 50 movements, dev card 3). */
export const LEDGER_SIZE = 50;

/** @type {{at: number, kind: 'award'|'spend', amount: number, reason: string, balance: number}[]} */
let ledger = [];

/** Record one coin movement into the dev ring buffer (§B11 — NOT persisted). */
function pushLedger(kind, amount, reason, balance) {
  ledger.push({ at: now(), kind, amount, reason: reason || '', balance });
  if (ledger.length > LEDGER_SIZE) ledger = ledger.slice(-LEDGER_SIZE);
}

/**
 * V4/G54 (§B11): the dev-only in-memory ledger — last ≤ 50 coin movements
 * `{at, kind: 'award'|'spend', amount, reason, balance}`, oldest first.
 * Dev-panel card 3 renders it (G58). Returns a copy; never persisted.
 * @returns {{at: number, kind: string, amount: number, reason: string, balance: number}[]}
 */
export function getLedger() {
  return ledger.map((row) => ({ ...row }));
}

/** Test hook: empty the ledger between isolated stores. */
export function resetLedgerForTests() {
  ledger = [];
}

/**
 * Ensure the §B1 modifiers slice exists (same-wave guard until G53's save
 * v4 merges — the engine's factory keeps the shape single-sourced).
 * @param {object} state save state (mutated in place)
 * @returns {object} state.modifiers
 */
function modifiersSliceOf(state) {
  if (state.modifiers == null || typeof state.modifiers !== 'object') {
    state.modifiers = modifierDefaultSlice();
  }
  return state.modifiers;
}

/**
 * Book `amount` against the §C-SYS11.1 row-5 modifier-surplus day ledger
 * (modifiers.dayCoins, MODIFIER.DAY_COIN_CAP = 150 c per local day; the
 * day rolls over lazily). Returns the granted part (0 when capped).
 * @param {object} state save state (mutated in place)
 * @param {number} amount wanted surplus (integer ≥ 0)
 * @param {string} [day] localDay() of the booking
 * @returns {number} coins actually grantable
 */
function bookModifierDayCoins(state, amount, day = localDay()) {
  const m = modifiersSliceOf(state);
  if (m.dayCoinsDay !== day) {
    m.dayCoins = 0;
    m.dayCoinsDay = day;
  }
  const headroom = Math.max(0, MODIFIER_CAPS.DAY_COIN_CAP - m.dayCoins);
  const granted = Math.min(Math.max(0, Math.floor(amount)), headroom);
  m.dayCoins += granted;
  return granted;
}

/**
 * Book `amount` against the §C-SYS11.1 row-6 endless day ledger
 * (modifiers.endlessCoins, ≤ 100 c per local day — same pattern as
 * dayCoins). Returns the granted part.
 * @param {object} state save state (mutated in place)
 * @param {number} amount
 * @param {string} [day]
 * @returns {number}
 */
function bookEndlessDayCoins(state, amount, day = localDay()) {
  const m = modifiersSliceOf(state);
  if (m.endlessCoinsDay !== day) {
    m.endlessCoins = 0;
    m.endlessCoinsDay = day;
  }
  const headroom = Math.max(0, MODIFIER_CAPS.ENDLESS_DAY_CAP - m.endlessCoins);
  const granted = Math.min(Math.max(0, Math.floor(amount)), headroom);
  m.endlessCoins += granted;
  return granted;
}

// --- end V4/G54 ledger/day-cap helpers --------------------------------------

/**
 * Can the player pay `amount` coins right now?
 * @param {Store} store
 * @param {number} amount
 * @returns {boolean}
 */
export function canAfford(store, amount) {
  return (store.get('coins') ?? 0) >= normCost(amount);
}

/**
 * Grant coins (floored, never negative). Emits 'coinsChanged' via the store.
 * V4/G54 (§C-SYS11.1): the reasons 'glueckspilz' and 'modifier' book against
 * the 150 c/local-day modifier-surplus ledger, 'endless' against the
 * 100 c/local-day endless ledger — the return value is the coins ACTUALLY
 * granted after the cap (0 when capped → the results UI renders the
 * „Tagesbonus erreicht" note, G76).
 * @param {Store} store
 * @param {number} amount
 * @param {string} [reason] payout source for logging ('minigame', 'daily', …)
 * @returns {number} coins actually granted
 */
export function award(store, amount, reason = '') {
  const n = normAward(amount);
  if (n === 0) return 0;
  let granted = n;
  store.update((state) => {
    // V4/G54: §C-SYS11.1 rows 2/5/6 — capped bonus surfaces
    if (reason === 'glueckspilz' || reason === 'modifier') {
      granted = bookModifierDayCoins(state, n);
    } else if (reason === 'endless') {
      granted = bookEndlessDayCoins(state, n);
    }
    if (granted > 0) {
      state.coins += granted;
      state.profile.coinsEarned += granted; // V2/G16: lifetime total (§B2/§C12.1)
    }
  });
  if (reason) console.debug(`[economy] +${granted}c (${reason})`);
  if (granted > 0) pushLedger('award', granted, reason, store.get('coins')); // V4/G54 (§B11)
  return granted;
}

/**
 * Spend coins atomically: either the full amount is deducted or nothing
 * happens (returns false — never partial, never negative balances).
 * @param {Store} store
 * @param {number} amount
 * @param {string} [reason]
 * @returns {boolean} whether the payment went through
 */
export function spend(store, amount, reason = '') {
  const n = normCost(amount);
  if (!canAfford(store, n)) return false;
  store.update((state) => {
    state.coins -= n;
    state.profile.coinsSpent += n; // V2/G16: lifetime total (§B2/§C12.1)
  });
  if (reason) console.debug(`[economy] -${n}c (${reason})`);
  pushLedger('spend', n, reason, store.get('coins')); // V4/G54 (§B11)
  return true;
}

/**
 * @typedef {Object} MinigameBreakdown  results-screen data (§E8)
 * @property {string} gameId
 * @property {number} score        final score
 * @property {number} coins        coins paid (after the §E0.1-2 stacking)
 * @property {boolean} firstToday  daily ×2 applied (first play per local day)
 * @property {boolean} doubleCoinsBuff V4/G53: 'UpdateLiebe' ×2 buff applied (§C-SYS5.2)
 * @property {number} best         best score after this round — the PLAYED
 *   mode's board (V4/G54 §G5.5: normal → `best`, easy/hard → `bestByDiff`,
 *   endless → `endlessBest`)
 * @property {boolean} newBest     this round set that board's best
 * @property {number} xp           XP granted (§C1.5 minigame formula)
 * @property {number} levelsGained
 * @property {number} coinsFromLevels level-up rewards paid on top (§C1.5)
 * @property {'easy'|'normal'|'hard'|'endless'} difficulty played mode (V4/G54 §G5.2)
 * @property {string}  modifierType applied payout modifier ('' = none)
 * @property {number}  modifierBonus doppelGold surplus actually paid on top
 *   (§E0.1-2 — the framework's „Bonus: {name} +X 🪙" results row, §G8-3)
 * @property {boolean} dayCapReached a §C-SYS11.1 day cap truncated this
 *   round's bonus („Tagesbonus erreicht" note)
 * @property {boolean} beatTarget  score ≥ the §G5.4 target on the played mode
 * @property {number}  [endlessBest] endless board after this round (endless only)
 * @property {boolean} [endlessNewBest] endless round improved it (endless only)
 */

/**
 * THE minigame payout path (§C6 shared rules + §C1.5 + V4/G54 §E0.1-2 —
 * the ONE frozen stacking order):
 *   base = min(row.max, max(row.min, round(rowClamp(score) × difficultyMult)))
 *   paid = base × dailyFirstPlay(×2) × codeBuff(×2) × doppelGold(×2)
 * Endless replaces base with the flat 5 c override (§G5.2). doppelGold
 * additionally caps paid ≤ 2 × row.max (the cap limits the modifier's
 * ADDITION, never the pre-modifier chain) and books its surplus into
 * modifiers.dayCoins against MODIFIER.DAY_COIN_CAP (§C-SYS11.1 rows 1/5 —
 * beyond it the round pays base × daily × buff and `dayCapReached` flags
 * the „Tagesbonus erreicht" note). Also pays +15 fun, minigame XP
 * (10 + min(15, floor(coins/2))) with level-up coin rewards, updates
 * plays/lastPlayDay and the per-mode boards (§G5.7-4 single write site:
 * `best` = Mittel, `bestByDiff` = Leicht/Schwer, `endlessBest` = Endlos)
 * plus `beaten` vs the §G5.4 targets — in one atomic store.update.
 * Returns the breakdown for the results screen.
 * @param {Store} store
 * @param {string} id minigame id
 * @param {number} score
 * @param {{coinsOverride?: number, difficulty?: string,
 *   modifier?: string|{type: string}}} [opts] cityDrive/surf-travel pass
 *   §C4.3 coins via coinsOverride; the framework (G56) forwards the launch
 *   difficulty and the CONSUMED modifier snapshot (§C-SYS4.4)
 * @returns {MinigameBreakdown}
 */
export function awardMinigame(store, id, score, opts = {}) {
  const meta = getMinigame(id);
  if (!meta) throw new Error(`[economy] unknown minigame '${id}'`);
  const s = Math.max(0, Math.floor(Number(score) || 0));
  const today = localDay();
  const firstToday = store.get(`minigames.lastPlayDay.${id}`) !== today;

  // ── V4/G54 (§G5.2/§E0.1-2): played mode + base coins ──────────────────
  const difficulty = ['easy', 'normal', 'hard', 'endless'].includes(opts.difficulty)
    ? opts.difficulty : 'normal';
  const modifierType =
    typeof opts.modifier === 'string' ? opts.modifier : (opts.modifier?.type ?? '');
  let base;
  if (difficulty === 'endless') {
    // §G5.2: Endlos pays flat 5 c — the framework passes coinsOverride: 5
    // (honored when present; hard default otherwise).
    base = typeof opts.coinsOverride === 'number'
      ? Math.max(0, Math.floor(opts.coinsOverride)) : ENDLESS_FLAT_COINS;
  } else if (typeof opts.coinsOverride === 'number') {
    base = Math.max(0, Math.floor(opts.coinsOverride)); // cityDrive §C4.3 / surf travel
  } else {
    const table = meta.coinTable;
    const rowClamp = Math.min(
      table.max,
      Math.max(table.min ?? 0, Math.floor(s / (table.divisor ?? 1)))
    );
    // §G5.2: Leicht ×0.7 floors at row min, Schwer ×1.3 caps at row max;
    // ×1 reproduces the v1 rowClamp bit-identically (existing tests green).
    const mult = DIFFICULTY_COIN_MULT[difficulty] ?? 1;
    base = Math.min(table.max, Math.max(table.min ?? 0, Math.round(rowClamp * mult)));
  }
  // ── end V4/G54 base ─────────────────────────────────────────────────────

  // V4/G53 (PLAN4 §B6/§C-SYS5.2): the 'UpdateLiebe' double-coins buff — ×2
  // AFTER the daily ×2 (multiplicative → ×4, bounded per §C-SYS11.2); the
  // pure check lives in systems/codesEngine.js (the HUD ×2 chip reads it too).
  const doubleCoinsBuff = isDoubleCoinsActive(store.get(), now());

  const prevBest = store.get(`minigames.best.${id}`) ?? 0;
  const board = modeBoardOf(store, id, difficulty, s, prevBest);
  const target = getTarget(id);
  const beatTarget =
    difficulty !== 'endless' && typeof target === 'number' && s >= target;
  let progress;
  let paid = 0;
  let modifierBonus = 0;
  let dayCapReached = false;

  store.update((state) => {
    // ── V4/G54 (§E0.1-2 verbatim): the frozen stacking order ────────────
    const dailyMult = firstToday ? MINIGAME.DAILY_FIRST_PLAY_MULT : 1;
    const buffMult = doubleCoinsBuff ? 2 : 1;
    const unmodified = base * dailyMult * buffMult;
    paid = unmodified;
    if (modifierType === 'doppelGold') {
      // doppelGold ×2 AFTER daily and buff; caps paid ≤ 2 × row.max
      // (§C-SYS11.1 row 1) and books the surplus (paid − unmodified) into
      // the 150 c/day ledger (row 5 — capped surplus → pays base chain).
      const wanted = Math.min(unmodified, Math.max(0, 2 * meta.coinTable.max - unmodified));
      modifierBonus = bookModifierDayCoins(state, wanted, today);
      if (modifierBonus < wanted) dayCapReached = true;
      paid = unmodified + modifierBonus;
    }
    if (difficulty === 'endless') {
      // §C-SYS11.1 row 6: every coin an endless run pays counts against
      // the ≤ 100 c/local-day endless ledger.
      const granted = bookEndlessDayCoins(state, paid, today);
      if (granted < paid) dayCapReached = true;
      paid = granted;
    }
    // ── end stacking ─────────────────────────────────────────────────────
    state.coins += paid;
    state.stats.fun = clampStat(state.stats.fun + MINIGAME.FUN_REWARD);
    state.minigames.plays[id] = (state.minigames.plays[id] ?? 0) + 1;
    state.minigames.lastPlayDay[id] = today;
    // ── V4/G54 (§G5.7-4): per-mode boards + beaten — single write site ───
    if (difficulty === 'normal') {
      if (s > prevBest) state.minigames.best[id] = s;
    } else if (difficulty === 'endless') {
      if (board.newBest) {
        if (state.minigames.endlessBest == null) state.minigames.endlessBest = {};
        state.minigames.endlessBest[id] = s;
      }
    } else if (board.newBest) {
      if (state.minigames.bestByDiff == null) state.minigames.bestByDiff = {};
      if (state.minigames.bestByDiff[id] == null) state.minigames.bestByDiff[id] = {};
      state.minigames.bestByDiff[id][difficulty] = s;
    }
    if (beatTarget) {
      if (state.minigames.beaten == null) state.minigames.beaten = {};
      if (state.minigames.beaten[id] == null) state.minigames.beaten[id] = {};
      state.minigames.beaten[id][difficulty] = true;
    }
    if (modifierType && typeof state.achievements?.counters?.modifierPlays === 'number') {
      state.achievements.counters.modifierPlays += 1; // §B1 v4 counter
    }
    // ── end board writes ─────────────────────────────────────────────────
    progress = applyXp({ xp: state.xp, level: state.level }, minigameXp(paid), 'minigame'); // V4/G54: xpGranted source tag (§E0.1-13/§C-SYS3.1 row 1)
    state.xp = progress.xp;
    state.level = progress.level;
    state.coins += progress.coinsAwarded;
    state.profile.coinsEarned += paid + progress.coinsAwarded; // V2/G16 (§B2)
  });
  pushLedger('award', paid, 'minigame', store.get('coins') - progress.coinsAwarded); // V4/G54 (§B11)
  if (progress.coinsAwarded > 0) {
    pushLedger('award', progress.coinsAwarded, 'levelUp', store.get('coins'));
  }
  return {
    gameId: id,
    score: s,
    coins: paid,
    firstToday,
    doubleCoinsBuff, // V4/G53 (§C-SYS5.2): results-screen chip data
    best: board.best,
    newBest: board.newBest,
    xp: minigameXp(paid),
    levelsGained: progress.levelsGained,
    coinsFromLevels: progress.coinsAwarded,
    // V4/G54 (§E0.1-2/§G8-3/§G5.6): results-row + pre-game data
    difficulty,
    modifierType,
    modifierBonus,
    dayCapReached,
    beatTarget,
    ...(difficulty === 'endless'
      ? { endlessBest: board.best, endlessNewBest: board.newBest }
      : {}),
  };
}

/**
 * V4/G54 (§G5.5): resolve the played mode's highscore board BEFORE the round
 * is written — `best` (Mittel) / `bestByDiff` (Leicht/Schwer) /
 * `endlessBest` (Endlos). Defensive against the pre-v4 save shape.
 * @param {Store} store
 * @param {string} id
 * @param {'easy'|'normal'|'hard'|'endless'} difficulty
 * @param {number} s round score
 * @param {number} prevBest pre-read Mittel best
 * @returns {{best: number, newBest: boolean}} board value AFTER this round
 */
function modeBoardOf(store, id, difficulty, s, prevBest) {
  let prev;
  if (difficulty === 'endless') {
    prev = Math.max(0, Math.floor(Number(store.get(`minigames.endlessBest.${id}`)) || 0));
  } else if (difficulty === 'easy' || difficulty === 'hard') {
    prev = Math.max(0, Math.floor(Number(store.get(`minigames.bestByDiff.${id}.${difficulty}`)) || 0));
  } else {
    prev = prevBest;
  }
  return { best: Math.max(prev, s), newBest: s > prev };
}

/**
 * Quick-delivery price (§C4.6): +20% markup, rounded UP. Integer-cent math so
 * float noise never flips the ceil (5 × 1.2 must be 6, not 7).
 * @param {number} base catalog price in coins
 * @returns {number}
 */
export function quickPrice(base) {
  const cents = Math.round(Math.max(0, base) * 100 * (1 + ECONOMY.QUICK_DELIVERY_MARKUP));
  return Math.ceil(cents / 100);
}

/**
 * Buy food into the inventory (§C5.1). At the shop (trip) the catalog price
 * applies; a quick-delivery order from home (§C4.6) pays quickPrice(base).
 * Atomic: on insufficient coins nothing changes.
 * @param {Store} store
 * @param {string} foodId
 * @param {number} [qty]
 * @param {{quick?: boolean}} [opts] quick: order from home (+20% markup)
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'|'coins'|'locked', total?: number}}
 */
export function buyFood(store, foodId, qty = 1, opts = {}) {
  const food = getFood(foodId);
  if (!food) return { ok: false, reason: 'unknown' };
  const n = Math.floor(Number(qty) || 0);
  if (n < 1) return { ok: false, reason: 'qty' };
  if (opts.quick && !store.get('quickDelivery')) return { ok: false, reason: 'locked' };
  const unit = opts.quick ? quickPrice(food.price) : food.price;
  const total = unit * n;
  if (!spend(store, total, opts.quick ? 'order' : 'shop')) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.inventory = invAdd(state.inventory, foodId, n);
  });
  return { ok: true, total };
}

/**
 * Is the one-time Quick Delivery unlock (§C4.6) purchasable right now?
 * @param {Store} store
 * @returns {{ok: boolean, reason?: 'owned'|'level'|'coins'}}
 */
export function canBuyQuickDelivery(store) {
  if (store.get('quickDelivery')) return { ok: false, reason: 'owned' };
  if ((store.get('level') ?? 1) < ECONOMY.QUICK_DELIVERY_LEVEL) return { ok: false, reason: 'level' };
  if (!canAfford(store, ECONOMY.QUICK_DELIVERY_PRICE)) return { ok: false, reason: 'coins' };
  return { ok: true };
}

/**
 * One-time Quick Delivery purchase (§C4.6): 400c, level ≥ 8, sets
 * `quickDelivery: true`. Atomic.
 * @param {Store} store
 * @returns {{ok: boolean, reason?: 'owned'|'level'|'coins'}}
 */
export function buyQuickDelivery(store) {
  const check = canBuyQuickDelivery(store);
  if (!check.ok) return check;
  if (!spend(store, ECONOMY.QUICK_DELIVERY_PRICE, 'quickDelivery')) {
    return { ok: false, reason: 'coins' };
  }
  store.update((state) => {
    state.quickDelivery = true;
  });
  return { ok: true };
}

// ============================================================================
// V2/G16: 2.0 economy APIs (PLAN2 §B3 — all additive; every one mirrors the
// v1 buyFood contract: pure store-in, {ok:boolean, reason?, total?} out,
// atomic, coins only ever move through award/spend above).
// ============================================================================

/**
 * V2/G16: canonical items-map key for seeds ('seed:<cropId>' — colon-flat like
 * furniture.placed's 'room:slot' keys, because store.get() paths split on
 * dots). Seeds live in the `items` slice (§B2: non-food consumables, NOT in
 * `inventory` — the fridge tray lists every inventory key as food).
 * @param {string} cropId
 * @returns {string}
 */
export const seedKey = (cropId) => `seed:${cropId}`;

/**
 * V2/FIX-A (E8 arbitrage): items-map key for the harvest-provenance counter
 * ('harvested:<foodId>' — colon-flat like seedKey). The counter tracks how
 * many units of a crop food were actually HARVESTED (vs shop-bought); only
 * those units are compost-sellable. Missing keys read as 0, so existing v2
 * saves need no migration (pre-fix stock simply becomes unsellable).
 * @param {string} foodId
 * @returns {string}
 */
export const harvestedKey = (foodId) => `harvested:${foodId}`;

/**
 * V2/FIX-A (E8 arbitrage): record a real garden harvest so the yield becomes
 * compost-sellable. The harvest site (home/gardenInteractions.js) calls this
 * right where the yield lands in the inventory; the counter lives in
 * `items[harvestedKey(foodId)]` and is decremented by sellHarvest.
 * CONTRACT for the harvest wiring: call ONCE per harvest with the crop's
 * yielded qty (`res.qty`), in addition to (not instead of) the inventory add.
 * @param {Store} store
 * @param {string} foodId crop-food id ('radish', …) — must be a catalog crop
 * @param {number} qty units harvested (≥ 1)
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'}}
 */
export function recordHarvest(store, foodId, qty) {
  if (!getCrop(foodId)) return { ok: false, reason: 'unknown' };
  const n = Math.floor(Number(qty) || 0);
  if (n < 1) return { ok: false, reason: 'qty' };
  store.update((state) => {
    const key = harvestedKey(foodId);
    state.items[key] = Math.max(0, Math.floor(Number(state.items[key]) || 0)) + n;
  });
  return { ok: true };
}

/**
 * V2/FIX-A (E8 arbitrage): how many units of a crop food are sellable at the
 * compost bin RIGHT NOW = min(inventory count, harvested-provenance counter).
 * Shop-bought units (and pre-fix stock, incl. the §C5.1 starter carrots)
 * count 0. The sell sheet (ui/gardenPanel.js) must read THIS, not the raw
 * inventory count.
 * @param {object} state save state (§E3) — or any {inventory, items} shape
 * @param {string} foodId crop-food id
 * @returns {number}
 */
export function sellableHarvest(state, foodId) {
  const inv = Math.max(0, Math.floor(Number(state?.inventory?.[foodId]) || 0));
  const harvested = Math.max(0, Math.floor(Number(state?.items?.[harvestedKey(foodId)]) || 0));
  return Math.min(inv, harvested);
}

/**
 * Sell harvested crop food from the inventory at the §C2.3 sell price
 * (compost-bin sell sheet, §C2.2). Only crop foods are sellable (crop id ==
 * food id) — and only units that were actually HARVESTED (V2/FIX-A, E8):
 * several §C2.3 sell prices sit above the §C7 shop prices, so shop-bought
 * stock must never be compost-sellable (the provenance counter in
 * items[harvestedKey(foodId)] caps the sale; see recordHarvest). The
 * requested qty is capped at sellableHarvest(state, foodId); with nothing
 * sellable the call refuses ({ok:false, reason:'none'}). Bumps
 * `achievements.counters.sells` by the qty actually sold (quest event 'sell'
 * — G23 wires).
 * @param {Store} store
 * @param {string} foodId crop-food id ('radish', …)
 * @param {number} [qty]
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'|'none', total?: number,
 *   qty?: number}} qty = units actually sold (≤ requested)
 */
export function sellHarvest(store, foodId, qty = 1) {
  const crop = getCrop(foodId);
  if (!crop) return { ok: false, reason: 'unknown' };
  const requested = Math.floor(Number(qty) || 0);
  if (requested < 1) return { ok: false, reason: 'qty' };
  const n = Math.min(requested, sellableHarvest(store.get(), foodId));
  if (n < 1) return { ok: false, reason: 'none' };
  store.update((state) => {
    state.inventory = invRemove(state.inventory, foodId, n);
    const key = harvestedKey(foodId);
    state.items[key] = Math.max(0, Math.floor(Number(state.items[key]) || 0) - n);
    state.achievements.counters.sells += n;
  });
  const total = award(store, crop.sellPrice * n, 'sellHarvest');
  return { ok: true, total, qty: n };
}

/**
 * Buy crop seeds (§C2.3 seed prices; seed-picker buy row §C2.2). Seeds land
 * in `items[seedKey(cropId)]`; planting consumes one from there (G19 wires —
 * systems/garden.js stays slice-pure). Level-gated per UNLOCKS.CROPS.
 * @param {Store} store
 * @param {string} cropId
 * @param {number} [qty]
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'|'level'|'coins', total?: number}}
 */
export function buySeed(store, cropId, qty = 1) {
  const crop = getCrop(cropId);
  if (!crop) return { ok: false, reason: 'unknown' };
  const n = Math.floor(Number(qty) || 0);
  if (n < 1) return { ok: false, reason: 'qty' };
  if ((store.get('level') ?? 1) < crop.unlock) return { ok: false, reason: 'level' };
  const total = crop.seedPrice * n;
  if (!spend(store, total, 'seed')) return { ok: false, reason: 'coins' };
  store.update((state) => {
    const key = seedKey(cropId);
    state.items[key] = (state.items[key] ?? 0) + n;
  });
  return { ok: true, total };
}

/**
 * Buy a non-food consumable (§C3.5 medicine 40c / §C2.2 fertilizer 25c —
 * the shop Care row; quick-delivery eligible per §C3.5 is a UI concern, the
 * price here is always the catalog price). Lands in the `items` slice.
 * @param {Store} store
 * @param {'medicine'|'fertilizer'} itemId
 * @param {number} [qty]
 * @returns {{ok: boolean, reason?: 'unknown'|'qty'|'coins', total?: number}}
 */
export function buyItem(store, itemId, qty = 1) {
  const price = ITEM_PRICES[itemId];
  if (price == null) return { ok: false, reason: 'unknown' };
  const n = Math.floor(Number(qty) || 0);
  if (n < 1) return { ok: false, reason: 'qty' };
  const total = price * n;
  if (!spend(store, total, itemId)) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.items[itemId] = (state.items[itemId] ?? 0) + n;
  });
  return { ok: true, total };
}

/**
 * Use one medicine (§C3.5): sick → queasy, queasy → healthy; refuses while
 * healthy (nothing consumed). Health-slice transition goes through
 * systems/health.js when present (see healthReady above; the healthy check
 * reads the save slice directly, so the gate holds either way). Bumps
 * `medsGiven`, plus `cures` when the dose lands (§C5.3 firstCure).
 * @param {Store} store
 * @returns {{ok: boolean, reason?: 'none'|'healthy'}}
 */
export function useMedicine(store) {
  if ((store.get('items.medicine') ?? 0) < 1) return { ok: false, reason: 'none' };
  if (store.get('health.state') === 'healthy') return { ok: false, reason: 'healthy' };
  const cured = healthApi ? healthApi.useMedicine(store.get('health'), now()).h : null;
  store.update((state) => {
    state.items.medicine -= 1;
    if (cured) state.health = cured;
    state.achievements.counters.medsGiven += 1;
    state.achievements.counters.cures += 1;
  });
  return { ok: true };
}

/**
 * Pay the vet (§C3.5/§C9.2). 'cure' — 120c, only while queasy/sick: full cure
 * (junk/neglect reset via health.vetCure when the module is present) plus
 * +10 all stats (clamped); bumps `cures`. 'checkup' — 30c anytime: resets
 * neglectMin (health.vetCheckup). The `vetTrips`/`trips` counters belong to
 * the trip arrival flow (§C9.2 — G21 wires), NOT to the payment.
 * @param {Store} store
 * @param {'cure'|'checkup'} kind
 * @returns {{ok: boolean, reason?: 'unknown'|'healthy'|'coins', total?: number}}
 */
export function payVet(store, kind) {
  if (kind !== 'cure' && kind !== 'checkup') return { ok: false, reason: 'unknown' };
  if (kind === 'cure' && store.get('health.state') === 'healthy') {
    return { ok: false, reason: 'healthy' };
  }
  const price = kind === 'cure' ? VET.CURE_PRICE : VET.CHECKUP_PRICE;
  if (!spend(store, price, `vet:${kind}`)) return { ok: false, reason: 'coins' };
  store.update((state) => {
    if (kind === 'cure') {
      if (healthApi) state.health = healthApi.vetCure(state.health, now());
      for (const k of Object.keys(state.stats)) {
        state.stats[k] = clampStat(state.stats[k] + VET.CURE_STAT_BONUS);
      }
      state.achievements.counters.cures += 1;
    } else if (healthApi) {
      state.health = healthApi.vetCheckup(state.health);
    }
  });
  return { ok: true, total: price };
}

/**
 * Buy a fur-color skin (§C8.5; shop Skins tab from UNLOCKS.SKINS = L5).
 * New skins go straight on (same ruling as v1 outfit purchases).
 * @param {Store} store
 * @param {string} id skin id
 * @returns {{ok: boolean, reason?: 'unknown'|'owned'|'level'|'coins', total?: number}}
 */
export function buySkin(store, id) {
  const skin = getSkin(id);
  if (!skin) return { ok: false, reason: 'unknown' };
  if ((store.get('skins.owned') ?? []).includes(id)) return { ok: false, reason: 'owned' };
  if ((store.get('level') ?? 1) < UNLOCKS.SKINS) return { ok: false, reason: 'level' };
  if (!spend(store, skin.price, 'skin')) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.skins.owned.push(id);
    state.skins.equipped = id;
  });
  return { ok: true, total: skin.price };
}

/**
 * Buy a garden plot (§B6: index 4 at L10/300c, index 5 at L16/600c; plots
 * unlock strictly in order). Success bumps `garden.plotsOwned` to index + 1.
 * @param {Store} store
 * @param {number} index 0-based plot index (only 4 and 5 are purchasable)
 * @returns {{ok: boolean, reason?: 'unknown'|'owned'|'order'|'level'|'coins', total?: number}}
 */
export function buyPlot(store, index) {
  const idx = Math.floor(Number(index));
  const owned = store.get('garden.plotsOwned') ?? 4;
  if (idx >= 0 && idx < owned) return { ok: false, reason: 'owned' };
  const def = UNLOCKS.GARDEN_PLOTS[idx];
  if (!def) return { ok: false, reason: 'unknown' };
  if (idx > owned) return { ok: false, reason: 'order' }; // plot 5 before 6
  if ((store.get('level') ?? 1) < def.level) return { ok: false, reason: 'level' };
  if (!spend(store, def.price, 'plot')) return { ok: false, reason: 'coins' };
  store.update((state) => {
    state.garden.plotsOwned = idx + 1;
  });
  return { ok: true, total: def.price };
}
