// V3/G34 — sticker-book engine (PLAN3 §B5/§C5.4/§C5.5, binding): every
// condition shape (counter/special ×7/event), pure-core purity + latching,
// the live store wiring (coalesced 'change' → unlock → 'stickersChanged' +
// toast + 'sticker.get'), the §E0.1-7 'stickerHook' contract
// (store.emit('stickerHook', {id})), the §C5.5 toast queue (max 1 per 3 s)
// and the seen/„NEU" bookkeeping (markSeen drives the dot).
import test from 'node:test';
import assert from 'node:assert/strict';

// keep node runs quiet + storage-backed (store autosave is disabled anyway)
const backing = new Map();
globalThis.localStorage = {
  /** @param {string} k */ getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  /** @param {string} k @param {string} v */ setItem: (k, v) => backing.set(k, String(v)),
  /** @param {string} k */ removeItem: (k) => backing.delete(k),
};

const { defaultState } = await import('../src/core/save.js');
const { createStore } = await import('../src/core/store.js');
const { STICKERS, STICKERS_BY_ID } = await import('../src/data/stickers.js');
const {
  stickerProgress, isStickerSatisfied, applyStickerUnlocks, stickerCounts,
  initStickerBook, getStickerBook, resetStickerBookForTests,
  STICKER_TOAST_THROTTLE_MS,
} = await import('../src/systems/stickerBook.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fresh store + engine with capture arrays. */
function makeEngine(mutate) {
  resetStickerBookForTests();
  const state = defaultState();
  mutate?.(state);
  const store = createStore(state, { autosave: false });
  const toasts = [];
  const sounds = [];
  const changed = [];
  store.on('stickersChanged', (p) => changed.push(p));
  const engine = initStickerBook({
    store,
    ui: { toast: (key, vars) => toasts.push({ key, vars }) },
    audio: { play: (id) => sounds.push(id) },
  });
  return { store, engine, toasts, sounds, changed };
}

// ------------------------------------------------------------ pure core

test('stickerProgress: counter shape reads achievements.counters', () => {
  const def = STICKERS_BY_ID.ballBuddy; // balls ≥ 10
  const state = defaultState();
  assert.deepEqual(stickerProgress(def, state), { current: 0, target: 10 });
  state.achievements.counters.balls = 7;
  assert.deepEqual(stickerProgress(def, state), { current: 7, target: 10 });
  state.achievements.counters.balls = 400; // clamps at target
  assert.deepEqual(stickerProgress(def, state), { current: 10, target: 10 });
  assert.equal(isStickerSatisfied(def, state), true);
});

test('special shapes: level / fullOutfit / weightMax / setsClaimed', () => {
  const state = defaultState();
  state.level = 25;
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.bigTen, state), true);
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.quarterClub, state), true);
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.maxLevel, state), false);

  // fullOutfit counts ONLY the 3 original slots (§C13.3: back not required)
  const fullFit = STICKERS_BY_ID.fullFit;
  state.outfits.equipped = { hat: 'cap', glasses: null, neck: 'bowtie', back: 'cape' };
  assert.deepEqual(stickerProgress(fullFit, state), { current: 2, target: 3 });
  state.outfits.equipped.glasses = 'sunglasses';
  assert.equal(isStickerSatisfied(fullFit, state), true);

  state.weight.value = 85.5;
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.maxFloof, state), false);
  state.weight.value = 86;
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.maxFloof, state), true);

  state.collections.claimedSets = { veggies: 1, fish: 1, landmarks: 1 };
  assert.deepEqual(stickerProgress(STICKERS_BY_ID.albumMaster, state), { current: 3, target: 4 });
  state.collections.claimedSets.treats = 1;
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.albumMaster, state), true);
});

test('special shapes: skinsOwned / gameBest / collectionEntry', () => {
  const state = defaultState();
  assert.deepEqual(stickerProgress(STICKERS_BY_ID.freshDrip, state), { current: 1, target: 2 });
  state.skins.owned = ['cream', 'golden'];
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.freshDrip, state), true);

  state.minigames.best.danceParty = 99;
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.discoGooby, state), false);
  state.minigames.best.danceParty = 100;
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.discoGooby, state), true);

  assert.equal(isStickerSatisfied(STICKERS_BY_ID.goldenCatch, state), false);
  state.collections.entries['fish.goldenFish'] = 1;
  assert.equal(isStickerSatisfied(STICKERS_BY_ID.goldenCatch, state), true);
});

test('event shape: no progress from state, 1/1 only once latched', () => {
  const def = STICKERS_BY_ID.grumpMorning;
  const state = defaultState();
  assert.deepEqual(stickerProgress(def, state), { current: 0, target: 1 });
  assert.equal(isStickerSatisfied(def, state), false);
  state.stickers.unlocked.grumpMorning = 123;
  assert.deepEqual(stickerProgress(def, state), { current: 1, target: 1 });
});

test('hostile state: wrong-typed slices read as zero progress, never throw', () => {
  for (const hostile of [
    {},
    { achievements: null },
    { achievements: { counters: 'many' } },
    { outfits: { equipped: null }, skins: { owned: 'cream' } },
    { minigames: { best: null }, collections: null, weight: { value: 'chonky' } },
    null,
    undefined,
  ]) {
    for (const def of STICKERS) {
      assert.doesNotThrow(() => stickerProgress(def, hostile), `${def.id} progress`);
      assert.equal(isStickerSatisfied(def, hostile), false, `${def.id} unsatisfied`);
    }
  }
});

test('applyStickerUnlocks: latches once, pure, unchanged input → same ref', () => {
  const state = defaultState();
  state.achievements.counters.feeds = 1;
  const json = JSON.stringify(state);
  const first = applyStickerUnlocks(state, 4242);
  assert.deepEqual(first.unlocked.map((d) => d.id), ['firstNom']);
  assert.equal(first.state.stickers.unlocked.firstNom, 4242);
  assert.equal(JSON.stringify(state), json, 'input state untouched (pure)');
  // second pass: nothing new, SAME reference back (achievements pattern)
  const second = applyStickerUnlocks(first.state, 9999);
  assert.deepEqual(second.unlocked, []);
  assert.equal(second.state, first.state);
  assert.equal(second.state.stickers.unlocked.firstNom, 4242, 'timestamp latched');
});

test('applyStickerUnlocks never unlocks event stickers (hook-only path)', () => {
  const state = defaultState();
  // even a hostile pre-set truthy condition can't trigger event stickers
  state.achievements.counters.grumpyWake = 99;
  const { unlocked } = applyStickerUnlocks(state, 1);
  assert.deepEqual(unlocked.filter((d) => d.cond.event), []);
});

test('stickerCounts: unlocked/total/unseen drive the n/28 header + NEU dot', () => {
  const state = defaultState();
  assert.deepEqual(stickerCounts(state), { unlocked: 0, total: 28, unseen: 0 });
  state.stickers.unlocked = { firstNom: 1, sleepyhead: 2, bigTen: 3 };
  state.stickers.seen = { firstNom: true };
  assert.deepEqual(stickerCounts(state), { unlocked: 3, total: 28, unseen: 2 });
});

// ------------------------------------------------------- live store wiring

test('engine: counter bump → unlock + stickersChanged + queued toast + sound', async () => {
  const { store, toasts, sounds, changed } = makeEngine();
  store.update((s) => {
    s.achievements.counters.feeds = 1;
  });
  await sleep(20); // coalesced 'change' flush (setTimeout 0 in node) + drain
  assert.equal(store.get('stickers').unlocked.firstNom > 0, true);
  assert.deepEqual(changed, [{ id: 'firstNom' }]);
  assert.deepEqual(toasts.map((t) => t.key), ['stickerbook.unlockToast']);
  assert.deepEqual(sounds, ['sticker.get']);
  resetStickerBookForTests();
});

test('engine: conditions already met by the loaded save unlock at init', () => {
  const { store } = makeEngine((s) => {
    s.level = 10;
    s.achievements.counters.washes = 1;
  });
  const unlocked = store.get('stickers').unlocked;
  assert.ok(unlocked.bigTen, 'bigTen latched at init');
  assert.ok(unlocked.squeakyClean, 'squeakyClean latched at init');
  resetStickerBookForTests();
});

test("§E0.1-7 contract: store.emit('stickerHook', {id}) unlocks event stickers", () => {
  const { store, engine, changed } = makeEngine();
  // the exact call G35/G36/G37 make at their fire sites:
  store.emit('stickerHook', { id: 'grumpyWake' });
  assert.ok(store.get('stickers').unlocked.grumpMorning, 'grumpMorning unlocked');
  assert.deepEqual(changed, [{ id: 'grumpMorning' }]);
  // repeat fire: safe no-op (no double announce)
  store.emit('stickerHook', { id: 'grumpyWake' });
  assert.equal(changed.length, 1);
  // all 4 §C5.4 hook ids map to their stickers
  store.emit('stickerHook', { id: 'rainCanopy' });
  store.emit('stickerHook', { id: 'nightStars' });
  store.emit('stickerHook', { id: 'towed' });
  const unlocked = store.get('stickers').unlocked;
  for (const id of ['grumpMorning', 'rainyDay', 'starGazer', 'towTrouble']) {
    assert.ok(unlocked[id], `${id} unlocked via hook`);
  }
  // junk payloads / unknown hooks: safe no-ops
  assert.doesNotThrow(() => store.emit('stickerHook', null));
  assert.doesNotThrow(() => store.emit('stickerHook', { id: 42 }));
  assert.equal(engine.unlockByHook('nonsenseHook'), false);
  resetStickerBookForTests();
});

test('§C5.5 queue: bulk unlock shows 1 toast now, rest throttled 1 per 3 s', async () => {
  assert.equal(STICKER_TOAST_THROTTLE_MS, 3000);
  const { store, toasts } = makeEngine();
  // 3 hook unlocks back-to-back (dev-panel-style bulk)
  store.emit('stickerHook', { id: 'grumpyWake' });
  store.emit('stickerHook', { id: 'rainCanopy' });
  store.emit('stickerHook', { id: 'nightStars' });
  await sleep(30);
  assert.equal(toasts.length, 1, 'only the first toast fires immediately');
  assert.equal(Object.keys(store.get('stickers').unlocked).length, 3, 'unlocks are NOT throttled');
  resetStickerBookForTests(); // clears the pending queue timer
});

test('markSeen: sets seen once, only for unlocked; counts() reflects NEU', () => {
  const { store, engine } = makeEngine();
  engine.markSeen('firstNom'); // locked → no-op
  assert.equal(store.get('stickers').seen.firstNom, undefined);
  store.emit('stickerHook', { id: 'towed' });
  assert.equal(engine.isUnlocked('towTrouble'), true);
  assert.equal(engine.isSeen('towTrouble'), false);
  assert.deepEqual(engine.counts(), { unlocked: 1, total: 28, unseen: 1 });
  engine.markSeen('towTrouble');
  assert.equal(engine.isSeen('towTrouble'), true);
  assert.deepEqual(engine.counts(), { unlocked: 1, total: 28, unseen: 0 });
  resetStickerBookForTests();
});

test('initStickerBook is a singleton; getStickerBook exposes it', () => {
  const { engine } = makeEngine();
  assert.equal(getStickerBook(), engine);
  const again = initStickerBook({ store: null }); // ignored — singleton returns
  assert.equal(again, engine);
  resetStickerBookForTests();
  assert.equal(getStickerBook(), null);
});

// ------------------------------------------- §C5.5 stickerCount achievements

test("achievements 'stickerCount' special counts stickers.unlocked", async () => {
  const { progressOf, isSatisfied } = await import('../src/systems/achievementsEngine.js');
  const { ACHIEVEMENTS_BY_ID } = await import('../src/data/achievements.js');
  const state = defaultState();
  const a10 = ACHIEVEMENTS_BY_ID.stickerBook10;
  const aFull = ACHIEVEMENTS_BY_ID.stickerBookFull;
  assert.deepEqual(progressOf(a10, state), { current: 0, target: 10 });
  state.stickers.unlocked = Object.fromEntries(STICKERS.slice(0, 10).map((s) => [s.id, 1]));
  assert.equal(isSatisfied(a10, state), true);
  assert.equal(isSatisfied(aFull, state), false);
  state.stickers.unlocked = Object.fromEntries(STICKERS.map((s) => [s.id, 1]));
  assert.deepEqual(progressOf(aFull, state), { current: 28, target: 28 });
  assert.equal(isSatisfied(aFull, state), true);
  // hostile slice
  assert.doesNotThrow(() => progressOf(a10, { stickers: 'lots' }));
});
