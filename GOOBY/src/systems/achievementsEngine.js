// Achievements engine (§C8.3) — counter tracking, condition evaluation,
// once-only unlock detection, coin reward payout and the unlock toast+jingle.
// The pure core (progressOf/isSatisfied/applyUnlocks/countNonDefaultDecor) has
// no three.js/DOM imports (§B) and is unit-tested in test/achievements.test.js;
// initAchievements() wires it to the live store (single marked G12 block in
// main.js).
//
// How conditions are fed (wiring map):
//   feeds / washes    home/interactions.js increments counters (G5)
//   tickles           applyPetTickleGain in home/interactions.js (G5)
//   sleeps            systems/sleep.js applyCompletedSleepGrants (G6)
//   trips             systems/shopTrip.js onArrive (G7)
//   cleanTrips        THIS module — initAchievements decorates framework.launch
//                     so shopTrip's cityDrive onArrive result ({crashes,towed})
//                     also lands here (no crash data is persisted elsewhere)
//   coins/level/plays/outfits/decor/streak   read from live state (§E3)
// Every mutation above flows through store.update → the coalesced 'change'
// event (§E2) → checkNow() — so unlocks need no per-feature calls. track() is
// exposed for future systems that want an explicit counter bump.

import { ACHIEVEMENTS, DECOR_DEFAULT_ITEMS, DECOR_DEFAULT_WALLPAPER, DECOR_DEFAULT_FLOOR } from '../data/achievements.js';
import { MINIGAME_IDS } from '../data/minigames.js';
import { OUTFIT_SLOTS } from '../data/outfits.js';
import { t } from '../data/strings.js';
import { now } from '../core/clock.js';
// ── V2/G23 imports: progression wiring (quests/collections live + specials) ──
// All pure modules (§B rule) — node:test keeps running this file headlessly.
import { UNLOCKS, LEVELING, PHOTO } from '../data/constants.js';
import { QUEST_POOL } from '../data/quests.js';
import { getCollectionSet } from '../data/collections.js';
import { getFood } from '../data/foods.js';
import * as questsEngine from './quests.js';
import * as collectionsEngine from './collections.js';
import * as profileStats from './profileStats.js';
import { award as economyAward } from './economy.js';
import { applyXp, unlockedMinigames } from './leveling.js';
import { localDay } from '../core/clock.js';
// ── end V2/G23 imports ──

const DEFAULT_ITEM_SET = new Set(DECOR_DEFAULT_ITEMS);

/**
 * 'decorator' progress (§C8.3): number of placed non-default items — placed
 * furniture whose item id is not a §C5.2 free default, plus every room with a
 * non-default wallpaper or floor. Fired by G11's 'decorChanged' store event.
 *
 * F2 (E11): `furniture.placed` is a FLAT `{ 'roomId:slotId': itemId }` map
 * (see systems/furniturePlacement.js §E3 header — it only ever stores
 * non-default overrides; placing a slot's free default deletes the key).
 * The previous nested `{room:{slot:id}}` iteration counted nothing, making
 * the achievement unreachable. The DEFAULT_ITEM_SET filter stays as a guard
 * against hand-edited/legacy saves.
 * @param {object} state save state (§E3: furniture.placed, decor)
 * @returns {number}
 */
export function countNonDefaultDecor(state) {
  let n = 0;
  const placed = state?.furniture?.placed ?? {};
  for (const itemId of Object.values(placed)) {
    if (typeof itemId === 'string' && itemId && !DEFAULT_ITEM_SET.has(itemId)) n += 1;
  }
  for (const id of Object.values(state?.decor?.wallpaper ?? {})) {
    if (id && id !== DECOR_DEFAULT_WALLPAPER) n += 1;
  }
  for (const id of Object.values(state?.decor?.floor ?? {})) {
    if (id && id !== DECOR_DEFAULT_FLOOR) n += 1;
  }
  return n;
}

/**
 * Progress of one achievement against the live state (§C8.3 conditions).
 * @param {import('../data/achievements.js').AchievementDef} def
 * @param {object} state save state (§E3)
 * @returns {{current: number, target: number}} current is clamped to target
 */
export function progressOf(def, state) {
  let current = 0;
  if (def.counter) {
    current = Math.floor(Number(state?.achievements?.counters?.[def.counter]) || 0);
  } else {
    switch (def.special) {
      case 'coins':
        current = Math.floor(Number(state?.coins) || 0);
        break;
      case 'level':
        current = Math.floor(Number(state?.level) || 0);
        break;
      case 'fullOutfit': {
        const eq = state?.outfits?.equipped ?? {};
        current = OUTFIT_SLOTS.filter((slot) => eq[slot] != null).length;
        break;
      }
      case 'decor':
        current = countNonDefaultDecor(state);
        break;
      case 'streak':
        current = Math.floor(Number(state?.daily?.streak) || 0);
        break;
      case 'play12': {
        const plays = state?.minigames?.plays ?? {};
        current = MINIGAME_IDS.filter((id) => (plays[id] ?? 0) >= 1).length;
        break;
      }
      // ── V2/G23: 2.0 specials (§C5.3) — evaluation in v2SpecialProgress ──
      case 'allCrops':
      case 'stickers':
      case 'setsClaimed':
      case 'neverSick':
      case 'weightMax':
      case 'weightMin':
      case 'play21':
      case 'holeInOne':
        current = v2SpecialProgress(def, state);
        break;
      // ── end V2/G23 ──
      default:
        current = 0;
    }
  }
  return { current: Math.max(0, Math.min(def.target, current)), target: def.target };
}

// ═══════════════════════════════════════════════════════════════ V2/G23 ═══
// Achievements 2.0 + live progression wiring (§C5.3 specials, §B7 quests &
// collections riding the SAME call sites this engine already instruments).
//
// HOW QUEST EVENTS FLOW (the §B7 "same call sites" ruling, zero edits in
// other agents' files): most §C5.1 events are counter-backed — feeds, washes,
// tickles, balls, sleeps, trips, cleanTrips, plantings, waterings, harvests,
// sells, deliveries, photosTaken. Whether a counter is bumped through
// engine.track() OR mutated directly in the store (interactions.js, sleep.js,
// shopTrip.js, garden wiring …), it flows through the coalesced 'change'
// event — the wiring below DIFFS the counters on every flush and forwards
// each increment to quests.track exactly once. Non-counter events come from
// dedicated call sites: minigame events from the framework's V2/G23 onEnd
// block, 'statsScreen' from the profile screen mount, 'feedHealthy'/'buyFood'
// from inventory diffs, 'pet' from the petsToday/tickles daily counters.

/**
 * §C5.1 pool decorated for the §B7 engine: constants.QUEST_POOL rows carry
 * flat `coins`/`xp` — systems/quests.js expects `reward: {coins, xp}` and the
 * `mode` progress arithmetic. Event-name patterns pick the mode:
 * score:<id> / round:<id> / tricks:<id> → 'max' (single-round bests),
 * gameDistinct → 'distinct' (seen-ids set), everything else → 'add'.
 * @type {import('./quests.js').QuestDef[]}
 */
export const V2_QUEST_POOL = Object.freeze(
  QUEST_POOL.map((row) =>
    Object.freeze({
      ...row,
      reward: Object.freeze({ coins: row.coins, xp: row.xp }),
      mode:
        /^(score|round|tricks):/.test(row.event) ? 'max'
          : row.event === 'gameDistinct' ? 'distinct'
            : 'add',
    })
  )
);

/**
 * §B7 QuestCtx from the live state (requires-filtering for rolls/rerolls).
 * @param {object} state
 * @returns {import('./quests.js').QuestCtx}
 */
export function questCtxOf(state) {
  const level = Math.max(1, Math.floor(Number(state?.level) || 1));
  return {
    level,
    unlockedGameIds: unlockedMinigames(level),
    gardenUnlocked: level >= UNLOCKS.GARDEN,
  };
}

/**
 * Progress for the 8 §C5.3 v2 specials (pure — progressOf clamps to target).
 *   allCrops    veggie stickers owned ≥ 1 (collections, §C6 row 2)
 *   stickers    distinct collection entries owned
 *   setsClaimed sets in collections.claimedSets
 *   neverSick   level ≥ 10 with counters.sickEver === 0 (fed by the wiring
 *               below on every healthy/queasy → sick transition)
 *   weightMax   live weight.value ("reached": unlock latches via checkNow)
 *   weightMin   target when value ≤ target, else 0 (§C4 downward milestone)
 *   play21      distinct catalog games played ≥ 1
 *   holeInOne   counters.holeInOnes (framework forwards miniGolf meta)
 * @param {import('../data/achievements.js').AchievementDef} def
 * @param {object} state
 * @returns {number}
 */
export function v2SpecialProgress(def, state) {
  switch (def.special) {
    case 'allCrops': {
      const set = getCollectionSet('veggies');
      const entries = state?.collections?.entries ?? {};
      return set.entries.filter((e) => Math.floor(Number(entries[`veggies.${e.id}`]) || 0) >= 1).length;
    }
    case 'stickers':
      return Object.values(state?.collections?.entries ?? {})
        .filter((n) => Math.floor(Number(n) || 0) >= 1).length;
    case 'setsClaimed':
      return Object.keys(state?.collections?.claimedSets ?? {}).length;
    case 'neverSick': {
      const level = Math.floor(Number(state?.level) || 0);
      const sickEver = Math.floor(Number(state?.achievements?.counters?.sickEver) || 0);
      return level >= 10 && sickEver === 0 ? 1 : 0;
    }
    case 'weightMax':
      return Math.floor(Number(state?.weight?.value) || 0);
    case 'weightMin': {
      const v = Number(state?.weight?.value);
      return Number.isFinite(v) && v > 0 && v <= def.target ? def.target : 0;
    }
    case 'play21': {
      const plays = state?.minigames?.plays ?? {};
      return MINIGAME_IDS.filter((id) => (plays[id] ?? 0) >= 1).length;
    }
    case 'holeInOne':
      return Math.floor(Number(state?.achievements?.counters?.holeInOnes) || 0);
    default:
      return 0;
  }
}

/**
 * Photo-mode XP grant (§C12.2: +1 XP, max 5/day) — pure on the counters map,
 * mirrors interactions.js applyPetTickleGain's petsDay day-key pattern.
 * @param {object} counters achievements.counters (photoXpDay/photoXpToday)
 * @param {string} day localDay string
 * @returns {{counters: object, xp: number}}
 */
export function photoXpGrant(counters, day) {
  const c = { ...counters };
  if (c.photoXpDay !== day) {
    c.photoXpDay = day;
    c.photoXpToday = 0;
  }
  const xp = (c.photoXpToday ?? 0) < PHOTO.XP_DAILY_CAP ? PHOTO.XP_PER_PHOTO : 0;
  if (xp > 0) c.photoXpToday = (c.photoXpToday ?? 0) + 1;
  return { counters: c, xp };
}
// ═══════════════════════════════════════════════════════════ end V2/G23 ═══

/**
 * @param {import('../data/achievements.js').AchievementDef} def
 * @param {object} state
 * @returns {boolean} condition currently satisfied
 */
export function isSatisfied(def, state) {
  const p = progressOf(def, state);
  return p.current >= p.target;
}

/**
 * Detect + apply every not-yet-unlocked achievement whose condition holds:
 * marks it unlocked (timestamp) exactly once and pays the coin reward
 * (§C8.3). Pure — returns a new state; unchanged input → same reference back.
 *
 * V2/FIX-A2 (§C1.5 single-money-path): the payout also feeds
 * profile.coinsEarned, mirroring economy.award's bookkeeping — a direct
 * economy.award call is impossible here because this pure helper is applied
 * INSIDE store.update by checkNow (a nested store call would split the
 * atomic unlock+payout and double-pay on the listener re-check). Without it
 * the stats screen's "Coins earned" silently missed every unlock reward.
 * @param {object} state save state (§E3)
 * @param {number} [nowMs] unlock timestamp (defaults to clock now())
 * @returns {{state: object, unlocked: import('../data/achievements.js').AchievementDef[]}}
 */
export function applyUnlocks(state, nowMs = now()) {
  const already = state?.achievements?.unlocked ?? {};
  const newly = ACHIEVEMENTS.filter((def) => !already[def.id] && isSatisfied(def, state));
  if (newly.length === 0) return { state, unlocked: [] };
  const reward = newly.reduce((sum, def) => sum + def.coins, 0);
  const next = {
    ...state,
    coins: state.coins + reward,
    profile: {
      ...state.profile,
      coinsEarned: (Number(state.profile?.coinsEarned) || 0) + reward,
    },
    achievements: {
      ...state.achievements,
      unlocked: {
        ...already,
        ...Object.fromEntries(newly.map((def) => [def.id, nowMs])),
      },
    },
  };
  return { state: next, unlocked: newly };
}

// ---------------------------------------------------------------------------
// Runtime wiring (store subscription; DOM/audio only via injected deps)
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof initAchievements>|null} */
let engineSingleton = null;

/** V2/G23: disposer for the quest midnight-rollover timer (test hygiene). */
let v2Cleanup = null;

/**
 * Wire the engine to the live store (idempotent). Subscribes centrally to the
 * coalesced 'change' event (§E2) — every §C8.3 condition source (counters,
 * coins, level, outfits, decor, streak, plays) mutates the store and therefore
 * flows through here; unlock payout + toast + jingle happen exactly once per
 * achievement ('achievementUnlocked' is then emitted by the store itself).
 *
 * @param {{store: object, ui?: object, audio?: object,
 *   framework?: {launch: Function}}} deps  ui/audio optional (headless tests);
 *   framework enables the §C8.3 noCrash interception (see header).
 * @returns {{track: (counterId: string, n?: number) => void,
 *   trackTripResult: (result: {crashes?: number, towed?: boolean}) => void,
 *   checkNow: () => void}}
 */
export function initAchievements({ store, ui, audio, framework }) {
  if (engineSingleton) return engineSingleton;

  function checkNow() {
    const result = applyUnlocks(store.get());
    if (result.unlocked.length === 0) return;
    store.update((state) => {
      // Re-apply against the live state (listener-safe): applyUnlocks is
      // idempotent per achievement via the unlocked map.
      const again = applyUnlocks(state);
      Object.assign(state, again.state);
    });
    for (const def of result.unlocked) {
      ui?.toast?.('ach.unlockedToast', { name: t(def.nameKey), coins: def.coins });
      audio?.play?.('jingle.achievement');
    }
  }

  /**
   * Explicit counter bump (§C3 "all care actions run achievement counters").
   * @param {string} counterId achievements.counters key (§E3)
   * @param {number} [n]
   */
  function track(counterId, n = 1) {
    if (!counterId || !Number.isFinite(n) || n <= 0) return;
    store.update((state) => {
      const counters = state.achievements.counters;
      counters[counterId] = Math.floor(Number(counters[counterId]) || 0) + Math.floor(n);
    });
    checkNow();
  }

  /**
   * Feed a finished shop-trip drive result into the noCrash achievement
   * (§C8.3: 1 trip with 0 crashes → cleanTrips counter).
   * @param {{crashes?: number, towed?: boolean}} result cityDrive arrival result
   */
  function trackTripResult(result) {
    if (!result || result.towed || (result.crashes ?? 0) !== 0) return;
    track('cleanTrips');
  }

  // §C8.3 noCrash wiring: crash counts are not persisted anywhere, so tap the
  // shop-trip launch path — shopTrip.js passes params.onArrive({pickups,
  // crashes, towed, coins}) through framework.launch (§C4.3). Decorating the
  // launch params here keeps G1/G7 files untouched.
  if (framework && typeof framework.launch === 'function' && !framework.__g12NoCrashTap) {
    const origLaunch = framework.launch.bind(framework);
    framework.launch = (id, params = {}) => {
      if (id === 'cityDrive' && params?.mode === 'shopTrip' && typeof params.onArrive === 'function') {
        const onArrive = params.onArrive;
        params = {
          ...params,
          onArrive: (result) => {
            onArrive(result);
            trackTripResult(result);
          },
        };
      }
      return origLaunch(id, params);
    };
    framework.__g12NoCrashTap = true;
  }

  store.on('change', checkNow);
  checkNow(); // catch conditions already met by the loaded save

  // ══════════════════════════════════════════════════════════ V2/G23 ═══
  // Live progression wiring: daily quests, sticker album, photo XP, and the
  // quest-forwarding hook (module-header "HOW QUEST EVENTS FLOW").

  /** Forward one §C5.1 quest event into the persisted quests slice. */
  function trackQuest(event, n = 1, meta = undefined) {
    const q = store.get('quests');
    if (!q?.active?.length) return false;
    const r = questsEngine.track(q, event, n, meta, V2_QUEST_POOL);
    if (!r.changed) return false;
    store.update((state) => {
      state.quests = r.q;
    });
    return true;
  }

  /** Roll/refresh today's quests (no-op when quests.day already matches). */
  function rollQuestsNow() {
    const state = store.get();
    const rolled = questsEngine.rollDaily(state.quests, now(), V2_QUEST_POOL, questCtxOf(state));
    if (rolled !== state.quests) {
      store.update((s) => {
        s.quests = rolled;
      });
    }
  }

  /** Apply XP through the §C5.2 curve (level-up coins ride economy's rule). */
  function grantXp(state, amount) {
    const p = applyXp({ xp: state.xp, level: state.level }, amount);
    state.xp = p.xp;
    state.level = p.level;
    state.coins += p.coinsAwarded;
    state.profile.coinsEarned += p.coinsAwarded;
  }

  /**
   * Claim a completed quest (§B7): marks claimed, pays coins via economy +
   * XP via leveling, bumps the questsDone counter. Returns the reward or null.
   */
  function claimQuest(id) {
    const r = questsEngine.claim(store.get('quests'), id, V2_QUEST_POOL);
    if (!r.q) return null;
    store.update((state) => {
      state.quests = r.q;
      const counters = state.achievements.counters;
      counters.questsDone = Math.floor(Number(counters.questsDone) || 0) + 1;
    });
    economyAward(store, r.reward.coins, 'quest');
    store.update((state) => grantXp(state, r.reward.xp));
    checkNow();
    return r.reward;
  }

  /** Free daily reroll (§B7). Returns whether the reroll happened. */
  function rerollQuests() {
    const state = store.get();
    const r = questsEngine.reroll(state.quests, now(), V2_QUEST_POOL, questCtxOf(state));
    if (!r.ok) return false;
    store.update((s) => {
      s.quests = r.q;
    });
    return true;
  }

  /** HUD badge count (§B7). */
  function claimableQuests() {
    return questsEngine.claimableCount(store.get('quests'), V2_QUEST_POOL);
  }

  /**
   * Earn a sticker into the persisted collections slice (§B7). First-time
   * toast + §C5.2 sticker XP fire centrally from the diff watcher below, so
   * every award path (this API, garden/feed/landmark wiring) behaves alike.
   * @param {boolean} [opts.firstOnly] skip when already owned (landmark
   *   forwarding — G21 triggers award live during the drive too)
   */
  function awardSticker(setId, entryId, n = 1, opts = {}) {
    const c = store.get('collections');
    if (opts.firstOnly && collectionsEngine.countOf(c, setId, entryId) >= 1) return false;
    const r = collectionsEngine.award(c, setId, entryId, n);
    if (r.c === c) return false;
    store.update((state) => {
      state.collections = r.c;
    });
    return r.first;
  }

  /**
   * Claim a completed set ONCE (§C6): coins via economy, +50 XP, reward deco
   * into furniture.owned. Returns the reward or null.
   */
  function claimCollectionSet(setId) {
    const setDef = getCollectionSet(setId);
    if (!setDef) return null;
    const r = collectionsEngine.claimSet(store.get('collections'), setId, setDef, now());
    if (!r.c) return null;
    store.update((state) => {
      state.collections = r.c;
      if (r.reward.furniture && !state.furniture.owned.includes(r.reward.furniture)) {
        state.furniture.owned.push(r.reward.furniture);
      }
    });
    economyAward(store, r.reward.coins, 'album');
    store.update((state) => grantXp(state, r.reward.xp ?? LEVELING.XP_SET_COMPLETE));
    checkNow();
    return r.reward;
  }

  /**
   * Photo-mode capture bookkeeping (§C12.2): photosTaken counter (feeds the
   * shutterbug achievement + the 'photo' quest event via the diff watcher),
   * profile.photos, and +1 XP capped at 5/day. Returns the XP granted.
   */
  function photoTaken() {
    let granted = 0;
    store.update((state) => {
      const g = photoXpGrant(state.achievements.counters, localDay());
      state.achievements.counters = g.counters;
      const counters = state.achievements.counters;
      counters.photosTaken = Math.floor(Number(counters.photosTaken) || 0) + 1;
      state.profile = profileStats.onPhoto(state.profile);
      if (g.xp > 0) {
        grantXp(state, g.xp);
        granted = g.xp;
      }
    });
    checkNow();
    return granted;
  }

  // --- quest-forwarding hook: counter/inventory diff on every flush ---
  /** counter id → §C5.1 quest event (verbatim event column). */
  const COUNTER_QUEST_EVENTS = Object.freeze({
    feeds: 'feed', washes: 'wash', tickles: 'tickle', balls: 'ball',
    sleeps: 'sleep', trips: 'shopTrip', cleanTrips: 'cleanDrive',
    plantings: 'plant', waterings: 'water', harvests: 'harvest',
    sells: 'sell', deliveries: 'deliver', photosTaken: 'photo',
  });

  function progressSnapshot(state) {
    const counters = state?.achievements?.counters ?? {};
    const snap = {
      counters: {},
      petsToday: Math.floor(Number(counters.petsToday) || 0),
      petsDay: counters.petsDay,
      inventory: { ...(state?.inventory ?? {}) },
      coinsSpent: Number(state?.profile?.coinsSpent) || 0,
      healthState: state?.health?.state ?? 'healthy',
      owned: new Set(
        Object.entries(state?.collections?.entries ?? {})
          .filter(([, n]) => Math.floor(Number(n) || 0) >= 1)
          .map(([key]) => key)
      ),
    };
    for (const id of Object.keys(COUNTER_QUEST_EVENTS)) {
      snap.counters[id] = Math.floor(Number(counters[id]) || 0);
    }
    return snap;
  }

  /** First-time sticker: +5 XP (§C5.2) + toast + jingle, exactly once. */
  function onFirstSticker(key) {
    const dot = key.indexOf('.');
    if (dot <= 0) return;
    const setId = key.slice(0, dot);
    const entryId = key.slice(dot + 1);
    store.update((state) => grantXp(state, LEVELING.XP_STICKER));
    ui?.toast?.('toast.sticker', { name: t(`sticker.${setId}.${entryId}.name`), xp: LEVELING.XP_STICKER });
    audio?.play?.('sticker.get');
  }

  let progressPrev = progressSnapshot(store.get());
  store.on('change', (state) => {
    const cur = progressSnapshot(state);
    const prev = progressPrev;
    progressPrev = cur; // swap BEFORE forwarding (re-entrancy guard)

    /** @type {Array<[string, number, object|undefined]>} */
    const events = [];
    for (const [counterId, event] of Object.entries(COUNTER_QUEST_EVENTS)) {
      const d = cur.counters[counterId] - prev.counters[counterId];
      if (d > 0) events.push([event, d, undefined]);
    }
    // 'pet' (§C5.1 q.pet5): petsToday counts pet AND tickle XP grants
    // (interactions.applyPetTickleGain) — subtract the tickle share; a
    // petsDay rollover resets the counter, so re-baseline instead of diffing.
    let petsDelta = cur.petsToday - prev.petsToday;
    if (cur.petsDay !== prev.petsDay) petsDelta = cur.petsToday;
    const tickleDelta = Math.max(0, cur.counters.tickles - prev.counters.tickles);
    const petStrokes = Math.max(0, petsDelta - tickleDelta);
    if (petStrokes > 0) events.push(['pet', petStrokes, undefined]);
    // 'feedHealthy' / 'buyFood' via inventory diffs: a feed consumes a food
    // from the inventory (junk flag on the food row, §C7); a buy adds food
    // AND spends coins in the same flush (harvests add food without a spend).
    const feedsDelta = cur.counters.feeds - prev.counters.feeds;
    let healthyFed = 0;
    let foodGained = 0;
    for (const key of new Set([...Object.keys(prev.inventory), ...Object.keys(cur.inventory)])) {
      const d = (Number(cur.inventory[key]) || 0) - (Number(prev.inventory[key]) || 0);
      if (d === 0) continue;
      const food = getFood(key);
      if (!food) continue; // seeds etc. never count as food buys/feeds
      if (d < 0 && feedsDelta > 0 && food.junk !== true) healthyFed += -d;
      if (d > 0) foodGained += d;
    }
    if (healthyFed > 0) events.push(['feedHealthy', Math.min(healthyFed, feedsDelta), undefined]);
    const spentDelta = cur.coinsSpent - prev.coinsSpent;
    const harvestsDelta = cur.counters.harvests - prev.counters.harvests;
    if (foodGained > 0 && spentDelta > 0 && harvestsDelta <= 0) events.push(['buyFood', 1, undefined]);
    // V2/FIX-A (E7): the §C5.2 "harvest +2 XP" / "delivery +3 XP" grants were
    // defined (LEVELING.XP_HARVEST/XP_DELIVERY) but never paid anywhere. Grant
    // them here on the SAME counter diffs the quest events ride — whichever
    // path bumps counters.harvests/.deliveries pays exactly once, through the
    // real leveling path (grantXp — level-ups pay coins like quest/sticker XP).
    const deliveriesDelta = cur.counters.deliveries - prev.counters.deliveries;
    const counterXp =
      Math.max(0, harvestsDelta) * LEVELING.XP_HARVEST +
      Math.max(0, deliveriesDelta) * LEVELING.XP_DELIVERY;
    if (counterXp > 0) store.update((state) => grantXp(state, counterXp));
    // neverSick bookkeeping (§C5.3): latch every → sick transition
    if (cur.healthState === 'sick' && prev.healthState !== 'sick') track('sickEver');
    // first-time stickers (§C5.2): +5 XP + toast, whoever awarded them
    for (const key of cur.owned) {
      if (!prev.owned.has(key)) onFirstSticker(key);
    }
    for (const [event, n, meta] of events) trackQuest(event, n, meta);
  });

  // Boot roll + midnight rollover (§C5.1 "new quests at midnight"): rollDaily
  // no-ops while quests.day matches, so a coarse timer is enough.
  rollQuestsNow();
  const rolloverTimer = setInterval(rollQuestsNow, 60_000);
  if (typeof rolloverTimer === 'object' && rolloverTimer?.unref) rolloverTimer.unref();
  v2Cleanup = () => clearInterval(rolloverTimer);

  const v2Api = {
    quests: {
      pool: V2_QUEST_POOL,
      ctx: () => questCtxOf(store.get()),
      rollNow: rollQuestsNow,
      track: trackQuest,
      claim: claimQuest,
      reroll: rerollQuests,
      claimable: claimableQuests,
    },
    collections: {
      award: awardSticker,
      claimSet: claimCollectionSet,
    },
    photoTaken,
  };
  // ══════════════════════════════════════════════════════ end V2/G23 ═══

  engineSingleton = { track, trackTripResult, checkNow };
  Object.assign(engineSingleton, v2Api); // V2/G23: live progression APIs
  return engineSingleton;
}

/** @returns {ReturnType<typeof initAchievements>|null} engine after initAchievements */
export function getAchievementsEngine() {
  return engineSingleton;
}

/** Test-only: drop the singleton so initAchievements can re-wire a fresh store. */
export function resetAchievementsEngineForTests() {
  engineSingleton = null;
  // V2/G23: stop the quest rollover timer of the dropped engine
  v2Cleanup?.();
  v2Cleanup = null;
}
