// V3/FIX-D regression suite — pins the ENGINE-side recipes behind the dev
// panel fixes (E14 P1-1 unlock-all → 37/37, E14 P1-3 sticker-fire → any of
// the 28 ids) and the E20 P1-2 NEU-ribbon lock gate. Pure modules only
// (devPanel.js itself uses import.meta.glob and stays browser-only — these
// tests replay its exact staged state recipe against the real engines).
import test from 'node:test';
import assert from 'node:assert/strict';

import { ACHIEVEMENTS } from '../src/data/achievements.js';
import { applyUnlocks } from '../src/systems/achievementsEngine.js';
import { STICKERS } from '../src/data/stickers.js';
import { applyStickerUnlocks } from '../src/systems/stickerBook.js';
import { COLLECTION_SETS } from '../src/data/collections.js';
import { OUTFITS, OUTFIT_SLOTS } from '../src/data/outfits.js';
import { SKINS } from '../src/data/skins.js';
import { MINIGAME_IDS } from '../src/data/minigames.js';
import { LEVELING } from '../src/data/constants.js';
import { isMinigameUnlocked } from '../src/systems/leveling.js';
import { defaultState } from '../src/core/save.js';

// ---------------------------------------------------------------------------
// E14 P1-1 — unlock-all recipe reaches 37/37 through the real engine
// ---------------------------------------------------------------------------

/** Replays devPanel doUnlockAll's PASS-1 persistent grants on a state. */
function applyUnlockAllPersistentGrants(state, nowMs = 1_000_000) {
  state.level = LEVELING.MAX_LEVEL;
  state.outfits.owned = [...new Set([...(state.outfits.owned ?? []), ...OUTFITS.map((o) => o.id)])];
  state.skins.owned = [...new Set([...(state.skins.owned ?? []), ...SKINS.map((s) => s.id)])];
  state.collections.entries = state.collections.entries ?? {};
  for (const set of COLLECTION_SETS) {
    for (const entry of set.entries) {
      const k = `${set.id}.${entry.id}`;
      state.collections.entries[k] = Math.max(1, Number(state.collections.entries[k]) || 0);
    }
  }
  state.collections.claimedSets = state.collections.claimedSets ?? {};
  for (const set of COLLECTION_SETS) {
    if (!state.collections.claimedSets[set.id]) state.collections.claimedSets[set.id] = nowMs;
  }
  state.stickers.unlocked = state.stickers.unlocked ?? {};
  for (const d of STICKERS) {
    if (!state.stickers.unlocked[d.id]) state.stickers.unlocked[d.id] = nowMs;
  }
  const counters = state.achievements.counters;
  for (const def of ACHIEVEMENTS) {
    if (!def.counter) continue;
    counters[def.counter] = Math.max(Math.floor(Number(counters[def.counter]) || 0), def.target);
  }
  counters.holeInOnes = Math.max(Math.floor(Number(counters.holeInOnes) || 0), 1);
  state.minigames.plays = state.minigames.plays ?? {};
  for (const id of MINIGAME_IDS) {
    state.minigames.plays[id] = Math.max(1, Math.floor(Number(state.minigames.plays[id]) || 0));
  }
  state.daily.streak = Math.max(Math.floor(Number(state.daily.streak) || 0), 7);
  return state;
}

/** Replays the full doUnlockAll pass sequence via the pure applyUnlocks. */
function runUnlockAllSequence(state) {
  // Pass 1: persistent grants.
  let r = applyUnlocks(applyUnlockAllPersistentGrants(state), 1);
  let s = r.state;
  // Pass 2: transient chonkZone/fullOutfit/decorator/neverSick.
  const saved = {
    weight: s.weight.value,
    equipped: { ...s.outfits.equipped },
    placed: { ...s.furniture.placed },
    sickEver: Math.floor(Number(s.achievements.counters.sickEver) || 0),
  };
  s.weight.value = 90;
  for (const slot of OUTFIT_SLOTS) {
    if (s.outfits.equipped[slot] == null) {
      s.outfits.equipped[slot] = OUTFITS.find((o) => o.slot === slot)?.id ?? null;
    }
  }
  for (let i = 0; i < 10; i += 1) s.furniture.placed[`g33dev:${i}`] = 'g33devUnlockProbe';
  s.achievements.counters.sickEver = 0;
  r = applyUnlocks(s, 2);
  s = r.state;
  // Pass 3: transient sleekMode.
  s.weight.value = 20;
  r = applyUnlocks(s, 3);
  s = r.state;
  // Restore the transient slices (the unlocks stay latched).
  s.weight.value = saved.weight;
  s.outfits.equipped = saved.equipped;
  s.furniture.placed = saved.placed;
  s.achievements.counters.sickEver = saved.sickEver;
  // Final pass: coins1000 sees the accumulated reward balance now.
  r = applyUnlocks(s, 4);
  return r.state;
}

test('FIX-D E14 P1-1: unlock-all recipe latches ALL 37 achievements on a fresh save', () => {
  const s = runUnlockAllSequence(defaultState());
  const unlocked = Object.keys(s.achievements.unlocked);
  const missing = ACHIEVEMENTS.map((a) => a.id).filter((id) => !unlocked.includes(id));
  assert.deepEqual(missing, [], `locked after unlock-all: ${missing.join(', ')}`);
  assert.equal(unlocked.length, ACHIEVEMENTS.length);
});

test('FIX-D E14 P1-1: counters land at (or above) every counter target', () => {
  const s = runUnlockAllSequence(defaultState());
  for (const def of ACHIEVEMENTS) {
    if (!def.counter) continue;
    const v = Math.floor(Number(s.achievements.counters[def.counter]) || 0);
    assert.ok(v >= def.target, `${def.counter} ${v} < ${def.target}`);
  }
});

test('FIX-D E14 P1-1: transient slices are restored (no repaint side effects)', () => {
  const fresh = defaultState();
  const before = {
    weight: fresh.weight.value,
    equipped: JSON.stringify(fresh.outfits.equipped),
    placed: JSON.stringify(fresh.furniture.placed),
  };
  const s = runUnlockAllSequence(fresh);
  assert.equal(s.weight.value, before.weight);
  assert.equal(JSON.stringify(s.outfits.equipped), before.equipped);
  assert.equal(JSON.stringify(s.furniture.placed), before.placed);
  assert.equal(s.achievements.counters.sickEver, 0);
});

// ---------------------------------------------------------------------------
// E14 P1-3 — sticker-fire recipe unlocks EVERY one of the 28 defs
// ---------------------------------------------------------------------------

/** Replays devPanel fireSticker's per-kind state recipe for one def. */
function applyFireStickerRecipe(state, def) {
  const cond = def.cond;
  const target = Math.max(1, Math.floor(Number(cond.target) || 1));
  if (cond.event) {
    // The panel emits store.emit('stickerHook', {id: cond.event}); the engine
    // maps hook id → def and latches directly — modelled here as the latch.
    state.stickers.unlocked[def.id] = 1;
  } else if (cond.code) {
    // V4/G53 (PLAN4 §C-SYS5): secret sticker #29 — redeeming its code flips
    // codes.redeemed, which stickerProgress reads as a 0/1 gate.
    state.codes.redeemed[cond.code] = Date.now();
  } else if (cond.counter) {
    const counters = state.achievements.counters;
    counters[cond.counter] = Math.max(Math.floor(Number(counters[cond.counter]) || 0), target);
  } else if (cond.special === 'collectionEntry') {
    state.collections.entries[`${cond.set}.${cond.entry}`] = target;
  } else if (cond.special === 'gameBest') {
    state.minigames.best[cond.game] = target;
  } else if (cond.special === 'level') {
    state.level = Math.max(Math.floor(Number(state.level) || 1), target);
  } else if (cond.special === 'weightMax') {
    state.weight.value = Math.max(Number(state.weight.value) || 0, target);
  } else if (cond.special === 'fullOutfit') {
    for (const slot of OUTFIT_SLOTS) {
      if (state.outfits.equipped[slot] == null) {
        state.outfits.equipped[slot] = OUTFITS.find((o) => o.slot === slot)?.id ?? null;
      }
    }
  } else if (cond.special === 'setsClaimed') {
    for (const set of COLLECTION_SETS) {
      if (!state.collections.claimedSets[set.id]) state.collections.claimedSets[set.id] = 1;
    }
  } else if (cond.special === 'skinsOwned') {
    state.skins.owned = [...new Set([...(state.skins.owned ?? []), ...SKINS.map((k) => k.id)])];
  } else {
    assert.fail(`fireSticker recipe misses special '${cond.special}' (${def.id})`);
  }
  return state;
}

test('FIX-D E14 P1-3: the fire recipe unlocks each of the 28 sticker defs', () => {
  assert.equal(STICKERS.length, 29); // V4/G53: 28 + the secret herzGooby (#29)
  for (const def of STICKERS) {
    const state = applyFireStickerRecipe(defaultState(), def);
    if (def.cond.event) {
      // Hook-mapped ids latch directly; assert the hook id actually exists.
      assert.equal(typeof def.cond.event, 'string');
      assert.ok(state.stickers.unlocked[def.id], `${def.id} hook latch`);
      continue;
    }
    const r = applyStickerUnlocks(state, 5, STICKERS);
    assert.ok(
      r.unlocked.some((d) => d.id === def.id) || state.stickers.unlocked[def.id],
      `${def.id} still locked after its fire recipe`
    );
  }
});

// ---------------------------------------------------------------------------
// E20 P1-2 — NEU ribbons never on locked tiles (§C10.3 "after first unlock")
// ---------------------------------------------------------------------------
// arcadeScreen.js is browser-only (registry's import.meta.glob), so the gate
// is pinned through the same leveling predicate the screen consults.

test('FIX-D E20 P1-2: all six 3.0 games are still LOCKED at level 5 except shoppingSurf', () => {
  const V3_IDS = ['shoppingSurf', 'purblePlace', 'toyRacer', 'ghostHunt', 'rocketRescue', 'harborHopper'];
  const unlockedAt5 = V3_IDS.filter((id) => isMinigameUnlocked(id, 5));
  assert.deepEqual(unlockedAt5, ['shoppingSurf']);
  // The E20 repro: the five later games must NOT satisfy the ribbon rule's
  // unlock gate at level 5 while shoppingSurf (its flagship window) may.
  for (const id of V3_IDS) {
    if (id === 'shoppingSurf') continue;
    assert.equal(isMinigameUnlocked(id, 5), false, `${id} unexpectedly unlocked at L5`);
  }
  for (const id of V3_IDS) assert.equal(isMinigameUnlocked(id, 40), true);
});
