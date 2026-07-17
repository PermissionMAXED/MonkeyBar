// Garden engine (§C2.3/§C2.5): plant/water/harvest roundtrip per crop,
// progress halting when unwatered, watered-window math for all 8 table rows,
// fertilizer once-only +25%, offline-style long tick gaps incl. applyRain
// interplay, sell math, plot purchase gating (§B6 L10/300c, L16/600c),
// readyAt prediction (incl. the insufficient-watering null, §C2.4), and
// purity. The crop fixture is the §C2.3 table verbatim — the engine is
// catalog-injected (§E0.1-3), the real catalog lands with G16.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FERTILIZER_BOOST,
  PLOT_PURCHASES,
  emptyPlot,
  plant,
  water,
  fertilize,
  tick,
  applyRain,
  harvest,
  readyAt,
  progressPct,
  sellValue,
  canBuyPlot,
} from '../src/systems/garden.js';

// §C2.3 crop table, verbatim (growth is REAL minutes).
const CROPS = [
  { id: 'radish',     seedPrice: 5,  growthMin: 10,  wateringsNeeded: 1, wateredWindowMin: 10,   yield: 2, sellPrice: 6,  unlock: 3 },
  { id: 'carrot',     seedPrice: 8,  growthMin: 20,  wateringsNeeded: 1, wateredWindowMin: 20,   yield: 3, sellPrice: 5,  unlock: 3 },
  { id: 'salad',      seedPrice: 12, growthMin: 30,  wateringsNeeded: 2, wateredWindowMin: 15,   yield: 2, sellPrice: 10, unlock: 3 },
  { id: 'tomato',     seedPrice: 15, growthMin: 45,  wateringsNeeded: 2, wateredWindowMin: 22.5, yield: 3, sellPrice: 9,  unlock: 4 },
  { id: 'corn',       seedPrice: 20, growthMin: 90,  wateringsNeeded: 2, wateredWindowMin: 45,   yield: 2, sellPrice: 16, unlock: 6 },
  { id: 'eggplant',   seedPrice: 25, growthMin: 150, wateringsNeeded: 3, wateredWindowMin: 50,   yield: 2, sellPrice: 20, unlock: 8 },
  { id: 'pumpkin',    seedPrice: 35, growthMin: 360, wateringsNeeded: 3, wateredWindowMin: 120,  yield: 1, sellPrice: 55, unlock: 10 },
  { id: 'watermelon', seedPrice: 45, growthMin: 480, wateringsNeeded: 4, wateredWindowMin: 120,  yield: 1, sellPrice: 70, unlock: 12 },
];
const cropsById = Object.fromEntries(CROPS.map((c) => [c.id, c]));
const byId = (id) => cropsById[id];

const MIN = 60000;
const T0 = 1_800_000_000_000; // fixed epoch base — garden never reads wall clock

/** Fresh §B2 garden slice (defaults land in save.js with G16). */
function freshGarden() {
  return {
    plotsOwned: 4,
    plots: Array.from({ length: 6 }, () => emptyPlot()),
    lastTickAt: T0,
  };
}

function deepFreeze(obj) {
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') deepFreeze(v);
  }
  return Object.freeze(obj);
}

// -------------------------------------------------------------- table shape

test('§C2.3 table invariant: wateringsNeeded × wateredWindowMin === growthMin for every crop', () => {
  for (const c of CROPS) {
    assert.equal(c.wateringsNeeded * c.wateredWindowMin, c.growthMin, c.id);
  }
});

// ----------------------------------- plant → water → harvest, per crop row

for (const crop of CROPS) {
  test(`roundtrip ${crop.id}: plant → water ×${crop.wateringsNeeded} → ready at +${crop.growthMin} min → harvest ×${crop.yield}`, () => {
    let { g, ok } = plant(freshGarden(), 0, crop, T0);
    assert.equal(ok, true);
    assert.equal(g.plots[0].crop, crop.id);
    assert.equal(g.plots[0].plantedAt, T0);

    let t = T0;
    for (let w = 0; w < crop.wateringsNeeded; w += 1) {
      const watered = water(g, 0, crop, t);
      assert.equal(watered.ok, true, `watering ${w + 1}`);
      g = watered.g;
      assert.equal(g.plots[0].wateredUntil, t + crop.wateredWindowMin * MIN);
      t += crop.wateredWindowMin * MIN;
      g = tick(g, t, cropsById).g;
    }
    // perfectly timed waterings ⇒ ready exactly at plantedAt + growthMin
    assert.equal(t, T0 + crop.growthMin * MIN);
    assert.equal(g.plots[0].progressMin, crop.growthMin);
    assert.equal(g.plots[0].waterings, crop.wateringsNeeded);
    assert.equal(progressPct(g.plots[0], crop), 1);
    assert.equal(readyAt(g.plots[0], crop, t), t); // already ready → nowMs

    const h = harvest(g, 0, crop, t);
    assert.equal(h.ok, undefined);
    assert.equal(h.foodId, crop.id);
    assert.equal(h.qty, crop.yield);
    assert.deepEqual(h.g.plots[0], emptyPlot()); // plot reset for replanting
  });
}

// ------------------------------------------- watered-window math, per crop

for (const crop of CROPS) {
  test(`watered window ${crop.id}: grows inside the ${crop.wateredWindowMin} min window, halts after`, () => {
    let g = plant(freshGarden(), 0, crop, T0).g;
    g = water(g, 0, crop, T0).g;
    const half = (crop.wateredWindowMin / 2) * MIN;
    g = tick(g, T0 + half, cropsById).g;
    assert.equal(g.plots[0].progressMin, crop.wateredWindowMin / 2);
    // way past the window: only the window itself was credited
    g = tick(g, T0 + crop.wateredWindowMin * MIN + 24 * 60 * MIN, cropsById).g;
    assert.equal(g.plots[0].progressMin, crop.wateredWindowMin);
    // …and further ticks add nothing while unwatered
    g = tick(g, T0 + 48 * 60 * MIN, cropsById).g;
    assert.equal(g.plots[0].progressMin, crop.wateredWindowMin);
  });
}

test('progress halts when unwatered: an unwatered planting never grows', () => {
  let g = plant(freshGarden(), 1, byId('carrot'), T0).g;
  g = tick(g, T0 + 300 * MIN, cropsById).g;
  assert.equal(g.plots[1].progressMin, 0);
  assert.equal(progressPct(g.plots[1], byId('carrot')), 0);
});

test('re-watering never stacks beyond now + window (§C2.3)', () => {
  const carrot = byId('carrot');
  let g = plant(freshGarden(), 0, carrot, T0).g;
  g = water(g, 0, carrot, T0).g;
  g = water(g, 0, carrot, T0 + 5 * MIN).g;
  assert.equal(g.plots[0].wateredUntil, T0 + 5 * MIN + carrot.wateredWindowMin * MIN);
  assert.equal(g.plots[0].waterings, 2);
});

// ----------------------------------------------------------------- fertilize

test('fertilizer: instant +25% of growthMin, once per planting (§C2.2)', () => {
  const tomato = byId('tomato');
  let g = plant(freshGarden(), 0, tomato, T0).g;
  const f1 = fertilize(g, 0, tomato);
  assert.equal(f1.ok, true);
  assert.equal(f1.g.plots[0].progressMin, FERTILIZER_BOOST * tomato.growthMin); // 11.25
  assert.equal(f1.g.plots[0].fertilized, true);
  const f2 = fertilize(f1.g, 0, tomato);
  assert.equal(f2.ok, false);
  assert.equal(f2.g, f1.g); // unchanged reference on refusal
  // a NEW planting on the same plot may fertilize again
  const h = harvestAfterGrowing(f1.g, 0, tomato);
  const re = plant(h, 0, tomato, T0 + 1000 * MIN).g;
  assert.equal(fertilize(re, 0, tomato).ok, true);
});

/** Grow plot to readiness with perfectly timed waterings, then harvest. */
function harvestAfterGrowing(g, plotIdx, crop) {
  let t = Math.max(g.lastTickAt, g.plots[plotIdx].plantedAt);
  let cur = g;
  while (cur.plots[plotIdx].progressMin < crop.growthMin) {
    cur = water(cur, plotIdx, crop, t).g;
    t += crop.wateredWindowMin * MIN;
    cur = tick(cur, t, cropsById).g;
  }
  return harvest(cur, plotIdx, crop, t).g;
}

test('fertilizer shortens the needed watered time (radish ready after 7.5 watered min)', () => {
  const radish = byId('radish');
  let g = plant(freshGarden(), 0, radish, T0).g;
  g = fertilize(g, 0, radish).g; // +2.5 progressMin
  g = water(g, 0, radish, T0).g;
  assert.equal(readyAt(g.plots[0], radish, T0), T0 + 7.5 * MIN);
  g = tick(g, T0 + 7.5 * MIN, cropsById).g;
  assert.equal(g.plots[0].progressMin, radish.growthMin);
  assert.equal(harvest(g, 0, radish, T0 + 7.5 * MIN).qty, radish.yield);
});

test('fertilize refuses on an empty plot', () => {
  const g = freshGarden();
  assert.equal(fertilize(g, 0, byId('radish')).ok, false);
});

// ------------------------------------------------- offline-style long gaps

test('offline gap: one huge tick credits exactly the watered window — full rate, uncapped (§C2.3)', () => {
  const corn = byId('corn');
  let g = plant(freshGarden(), 0, corn, T0).g;
  g = water(g, 0, corn, T0).g; // window 45 min
  // 10 h away — way past the v1 480-min stats cap, garden is NOT capped
  g = tick(g, T0 + 600 * MIN, cropsById).g;
  assert.equal(g.plots[0].progressMin, 45);
  assert.equal(g.lastTickAt, T0 + 600 * MIN);
});

test('offline rain interplay: tick(rainStart) → applyRain → tick(now) credits rain, never the dry gap (§B4)', () => {
  const pumpkin = byId('pumpkin');
  let g = plant(freshGarden(), 0, pumpkin, T0).g;
  g = water(g, 0, pumpkin, T0).g; // watered until T0+120 min
  const rainStart = T0 + 240 * MIN;
  const rainEnd = T0 + 600 * MIN; // one 6 h block
  // simulateOffline sequencing (§B4): bookkeeping current to rainStart first
  g = tick(g, rainStart, cropsById).g;
  assert.equal(g.plots[0].progressMin, 120); // watering credited, dry gap not
  g = applyRain(g, rainStart, rainEnd, cropsById);
  assert.equal(g.plots[0].wateredUntil, rainEnd);
  const res = tick(g, T0 + 900 * MIN, cropsById);
  // 120 (watering) + 360 (rain block) — the dry 120…240 min gap stays dry
  assert.equal(res.g.plots[0].progressMin, 480);
  // pumpkin (growthMin 360) crossed readiness during that tick
  assert.deepEqual(res.events, [{ type: 'ready', plotIdx: 0, cropId: 'pumpkin' }]);
});

test('applyRain: wateredUntil = max(wateredUntil, rainEnd) on planted plots only', () => {
  const radish = byId('radish');
  let g = plant(freshGarden(), 0, radish, T0).g;
  g = plant(g, 1, radish, T0).g;
  g = water(g, 1, radish, T0 + 1000 * MIN).g; // already watered PAST the rain
  const rained = applyRain(g, T0, T0 + 360 * MIN, cropsById);
  assert.equal(rained.plots[0].wateredUntil, T0 + 360 * MIN); // extended
  assert.equal(rained.plots[1].wateredUntil, T0 + 1010 * MIN); // max() kept
  assert.equal(rained.plots[2].wateredUntil, 0); // empty plot untouched
  // nothing planted / nothing to extend → same reference back
  const empty = freshGarden();
  assert.equal(applyRain(empty, T0, T0 + 360 * MIN, cropsById), empty);
  assert.equal(applyRain(rained, T0, T0 + 360 * MIN, cropsById), rained);
});

// ----------------------------------------------------- tick bookkeeping

test('tick is idempotent and safe from multiple sites (§E0: room interval + global ticker)', () => {
  const salad = byId('salad');
  let g = plant(freshGarden(), 0, salad, T0).g;
  g = water(g, 0, salad, T0).g;
  const once = tick(g, T0 + 10 * MIN, cropsById).g;
  const twice = tick(once, T0 + 10 * MIN, cropsById).g; // second site, same instant
  assert.equal(twice.plots[0].progressMin, once.plots[0].progressMin);
  // fine-grained ticking ≡ one coarse tick
  let fine = g;
  for (let i = 1; i <= 10; i += 1) fine = tick(fine, T0 + i * MIN, cropsById).g;
  assert.equal(fine.plots[0].progressMin, once.plots[0].progressMin);
});

test('tick never rewinds: an out-of-order older timestamp is a no-op', () => {
  const salad = byId('salad');
  let g = plant(freshGarden(), 0, salad, T0).g;
  g = water(g, 0, salad, T0).g;
  g = tick(g, T0 + 10 * MIN, cropsById).g;
  const back = tick(g, T0 + 5 * MIN, cropsById).g;
  assert.equal(back.plots[0].progressMin, 10);
  assert.equal(back.lastTickAt, T0 + 10 * MIN);
});

test('ready event fires exactly once, at the crossing tick', () => {
  const radish = byId('radish');
  let g = plant(freshGarden(), 0, radish, T0).g;
  g = water(g, 0, radish, T0).g;
  const before = tick(g, T0 + 9 * MIN, cropsById);
  assert.deepEqual(before.events, []);
  const crossing = tick(before.g, T0 + 12 * MIN, cropsById);
  assert.deepEqual(crossing.events, [{ type: 'ready', plotIdx: 0, cropId: 'radish' }]);
  const after = tick(crossing.g, T0 + 20 * MIN, cropsById);
  assert.deepEqual(after.events, []); // already ready — no repeat
});

// ------------------------------------------------------------------ guards

test('plant guards: occupied, locked (≥ plotsOwned) and out-of-range plots refuse', () => {
  const radish = byId('radish');
  const g0 = freshGarden();
  const planted = plant(g0, 0, radish, T0);
  assert.equal(planted.ok, true);
  const again = plant(planted.g, 0, radish, T0);
  assert.equal(again.ok, false);
  assert.equal(again.g, planted.g); // untouched reference
  assert.equal(plant(g0, 4, radish, T0).ok, false); // plot 5 not owned yet
  assert.equal(plant(g0, 5, radish, T0).ok, false); // plot 6 not owned yet
  assert.equal(plant(g0, 6, radish, T0).ok, false); // out of range
  assert.equal(plant(g0, -1, radish, T0).ok, false);
  // …but a bought plot accepts plants
  const withFive = { ...g0, plotsOwned: 5 };
  assert.equal(plant(withFive, 4, radish, T0).ok, true);
});

test('water/harvest guards: empty plot refuses; harvest before ready refuses', () => {
  const carrot = byId('carrot');
  const g0 = freshGarden();
  assert.equal(water(g0, 0, carrot, T0).ok, false);
  assert.deepEqual(harvest(g0, 0, carrot, T0), { ok: false });
  let g = plant(g0, 0, carrot, T0).g;
  g = water(g, 0, carrot, T0).g;
  g = tick(g, T0 + 10 * MIN, cropsById).g; // progress 10 of 20
  assert.deepEqual(harvest(g, 0, carrot, T0 + 10 * MIN), { ok: false });
});

// ------------------------------------------------- readyAt (notification 6)

test('readyAt predicts readiness while watering suffices (§C2.4)', () => {
  const salad = byId('salad'); // growth 30, window 15, needs 2 waterings
  let g = plant(freshGarden(), 0, salad, T0).g;
  g = water(g, 0, salad, T0).g;
  g = tick(g, T0 + 15 * MIN, cropsById).g;
  g = water(g, 0, salad, T0 + 15 * MIN).g;
  // 15 min progress + 15 min watered window remaining = ready at T0+30
  assert.equal(readyAt(g.plots[0], salad, T0 + 15 * MIN), T0 + 30 * MIN);
});

test('readyAt is null when the current watering cannot reach readiness ("don\'t lie", §C2.4)', () => {
  const salad = byId('salad'); // one watering (15) < growth (30)
  let g = plant(freshGarden(), 0, salad, T0).g;
  g = water(g, 0, salad, T0).g;
  assert.equal(readyAt(g.plots[0], salad, T0), null);
  // unwatered → null, empty plot → null
  const unwatered = plant(freshGarden(), 0, salad, T0).g;
  assert.equal(readyAt(unwatered.plots[0], salad, T0 + MIN), null);
  assert.equal(readyAt(emptyPlot(), salad, T0), null);
});

test('readyAt boundary: watering exactly sufficient predicts the exact minute', () => {
  const carrot = byId('carrot'); // window 20 == growth 20
  let g = plant(freshGarden(), 0, carrot, T0).g;
  g = water(g, 0, carrot, T0).g;
  assert.equal(readyAt(g.plots[0], carrot, T0), T0 + 20 * MIN);
});

// ----------------------------------------------------------- render helper

test('progressPct maps the 0/33/66/100 render stages (§C2.3)', () => {
  const corn = byId('corn'); // growth 90
  const plot = { ...emptyPlot(), crop: 'corn', plantedAt: T0 };
  assert.equal(progressPct(plot, corn), 0);
  assert.ok(Math.abs(progressPct({ ...plot, progressMin: 29.7 }, corn) - 0.33) < 1e-12);
  assert.ok(Math.abs(progressPct({ ...plot, progressMin: 59.4 }, corn) - 0.66) < 1e-12);
  assert.equal(progressPct({ ...plot, progressMin: 90 }, corn), 1);
  assert.equal(progressPct({ ...plot, progressMin: 500 }, corn), 1); // clamped
  assert.equal(progressPct(emptyPlot(), corn), 0);
});

// -------------------------------------------------------------- sell math

test('sellValue: §C2.3 sell price/ea × qty for every crop', () => {
  for (const c of CROPS) {
    assert.equal(sellValue(c, c.yield), c.sellPrice * c.yield, c.id);
    assert.equal(sellValue(c, 1), c.sellPrice, c.id);
  }
  assert.equal(sellValue(byId('radish'), 0), 0);
  assert.equal(sellValue(byId('radish'), -3), 0);
  assert.equal(sellValue(byId('pumpkin'), 2.9), 110); // whole items only
});

// ------------------------------------------------ plot purchases (§B6)

test('canBuyPlot: plot 5 (index 4) needs L10/300c, plot 6 (index 5) L16/600c', () => {
  assert.deepEqual(PLOT_PURCHASES, { 4: { level: 10, price: 300 }, 5: { level: 16, price: 600 } });
  const g4 = freshGarden(); // plotsOwned 4
  assert.deepEqual(canBuyPlot(g4, 4, 9), { ok: false, price: 300 }); // level short
  assert.deepEqual(canBuyPlot(g4, 4, 10), { ok: true, price: 300 });
  assert.deepEqual(canBuyPlot(g4, 4, 40), { ok: true, price: 300 });
  // plot 6 only AFTER plot 5 (in order), and only at L16
  assert.deepEqual(canBuyPlot(g4, 5, 40), { ok: false, price: 600 });
  const g5 = { ...g4, plotsOwned: 5 };
  assert.deepEqual(canBuyPlot(g5, 5, 15), { ok: false, price: 600 });
  assert.deepEqual(canBuyPlot(g5, 5, 16), { ok: true, price: 600 });
  assert.deepEqual(canBuyPlot(g5, 4, 40), { ok: false, price: 300 }); // owned already
  const g6 = { ...g4, plotsOwned: 6 };
  assert.deepEqual(canBuyPlot(g6, 5, 40), { ok: false, price: 600 }); // all owned
  // the 4 starter plots are never purchasable
  assert.deepEqual(canBuyPlot(g4, 0, 40), { ok: false, price: 0 });
  assert.deepEqual(canBuyPlot(g4, 3, 40), { ok: false, price: 0 });
});

// ------------------------------------------------------------------ purity

test('all garden functions are pure: deep-frozen input slices never throw/mutate', () => {
  const radish = byId('radish');
  const g0 = deepFreeze(freshGarden());
  const p = plant(g0, 0, radish, T0);
  assert.equal(p.ok, true);
  const w = water(deepFreeze(p.g), 0, radish, T0);
  const f = fertilize(deepFreeze(w.g), 0, radish);
  const t = tick(deepFreeze(f.g), T0 + 10 * MIN, cropsById);
  const r = applyRain(deepFreeze(t.g), T0, T0 + 360 * MIN, cropsById);
  const h = harvest(deepFreeze(r), 0, radish, T0 + 10 * MIN);
  assert.equal(h.foodId, 'radish');
  assert.equal(g0.plots[0].crop, null); // original untouched throughout
});
