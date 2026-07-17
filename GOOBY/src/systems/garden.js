// Garden crop engine (§C2/§B2/§B4/§B6) — PURE module: no three.js/DOM imports,
// unit-tested headlessly in test/garden.test.js. Catalog-injected per §E0.1-3:
// this file never imports data/crops.js — every function takes the crop def
// (or a cropsById map) as a parameter; wave-2 wiring passes the real catalog
// derived from constants.CROP_TABLE.
//
// Growth model (§C2.3, binding): `progressMin` accrues 1 minute per real
// minute ONLY while `now < wateredUntil`; each watering sets
// `wateredUntil = now + wateredWindowMin` (no stacking beyond now + window);
// ready when `progressMin ≥ growthMin`; ready crops never rot. Offline growth
// runs at the FULL elapsed rate, uncapped (plants are real-time like sleep) —
// simulateOffline just calls tick() with the long gap, plus applyRain() for
// elapsed rain blocks (§B4).
//
// Bookkeeping contract: tick() is the ONLY accrual site, bookkept via
// `g.lastTickAt`, so it is idempotent and safe to call from multiple sites
// (G19's in-room 1 s interval + G20's global ticker + simulateOffline
// coexist). Callers should bring bookkeeping current — i.e. call tick(g, now)
// — BEFORE plant/water/applyRain when it may be stale; the live 1 s ticker
// and the offline sim guarantee this in practice.
//
// All state-transforming functions are pure: they return NEW garden slices
// and never mutate their input. Failure paths return the input `g` reference
// unchanged plus `ok: false`.
//
// Save slice shape (§B2): garden = { plotsOwned: 4, plots: Plot[6],
// lastTickAt: 0 } with Plot = { crop: string|null, plantedAt, progressMin,
// wateredUntil, waterings, fertilized }.

/**
 * @typedef {object} CropDef  §C2.3 crop-table row (constants.CROP_TABLE)
 * @property {string} id            crop id ('radish' … 'watermelon')
 * @property {number} growthMin     watered minutes needed until ready
 * @property {number} wateredWindowMin  minutes one watering keeps growing
 * @property {number} yield         items per harvest (×1…×3)
 * @property {number} sellPrice     coins per harvested item
 * @property {string} [foodId]      food catalog id of the yield (default: id)
 */

/**
 * @typedef {object} Plot  one garden plot (§B2)
 * @property {string|null} crop     planted crop id, null when empty
 * @property {number} plantedAt     epoch ms of planting (0 when empty)
 * @property {number} progressMin   accrued watered growth minutes
 * @property {number} wateredUntil  epoch ms growth accrues until (§C2.3)
 * @property {number} waterings     watering count this planting
 * @property {boolean} fertilized   §C2.2 once-per-planting flag
 */

/**
 * @typedef {object} GardenSlice  the §B2 `garden` save slice
 * @property {number} plotsOwned
 * @property {Plot[]} plots        always length 6
 * @property {number} lastTickAt   tick() accrual bookkeeping
 */

/** Fertilizer boost (§C2.2): instant progressMin += 0.25 · growthMin. */
export const FERTILIZER_BOOST = 0.25;

/**
 * Plot purchase gating (§B6, binding): plot 5 (index 4) = L10/300c,
 * plot 6 (index 5) = L16/600c. Plots 1–4 (index 0–3) come free at L3.
 */
export const PLOT_PURCHASES = Object.freeze({
  4: Object.freeze({ level: 10, price: 300 }),
  5: Object.freeze({ level: 16, price: 600 }),
});

/**
 * A fresh empty plot — the §B2 default entry shape.
 * @returns {Plot}
 */
export function emptyPlot() {
  return { crop: null, plantedAt: 0, progressMin: 0, wateredUntil: 0, waterings: 0, fertilized: false };
}

/**
 * @param {GardenSlice} g
 * @param {number} plotIdx
 * @returns {Plot|null} the plot, or null when plotIdx is out of range
 */
function plotAt(g, plotIdx) {
  if (!g || !Array.isArray(g.plots)) return null;
  if (!Number.isInteger(plotIdx) || plotIdx < 0 || plotIdx >= g.plots.length) return null;
  return g.plots[plotIdx] ?? null;
}

/**
 * Replace one plot immutably.
 * @param {GardenSlice} g
 * @param {number} plotIdx
 * @param {Plot} plot
 * @returns {GardenSlice} new slice
 */
function withPlot(g, plotIdx, plot) {
  const plots = g.plots.slice();
  plots[plotIdx] = plot;
  return { ...g, plots };
}

/**
 * Plant a crop into an empty OWNED plot (§C2.2). Seed purchase/consumption is
 * economy's job (economy.buySeed) — this only mutates the garden slice.
 * @param {GardenSlice} g
 * @param {number} plotIdx 0–5; must be < g.plotsOwned
 * @param {CropDef} cropDef
 * @param {number} nowMs
 * @returns {{g: GardenSlice, ok: boolean}} ok:false leaves g unchanged
 */
export function plant(g, plotIdx, cropDef, nowMs) {
  const plot = plotAt(g, plotIdx);
  if (!plot || !cropDef || plotIdx >= (Number(g.plotsOwned) || 0)) return { g, ok: false };
  if (plot.crop != null) return { g, ok: false }; // occupied
  return {
    g: withPlot(g, plotIdx, {
      crop: cropDef.id,
      plantedAt: nowMs,
      progressMin: 0,
      wateredUntil: 0,
      waterings: 0,
      fertilized: false,
    }),
    ok: true,
  };
}

/**
 * Water a planted plot (§C2.3): sets
 * `wateredUntil = nowMs + cropDef.wateredWindowMin * 60000` — NO stacking
 * beyond now + window — and increments `waterings`. Call tick() first when
 * bookkeeping may be stale (see module header).
 * @param {GardenSlice} g
 * @param {number} plotIdx
 * @param {CropDef} cropDef def of the crop in this plot
 * @param {number} nowMs
 * @returns {{g: GardenSlice, ok: boolean}} ok:false on empty/unknown plot
 */
export function water(g, plotIdx, cropDef, nowMs) {
  const plot = plotAt(g, plotIdx);
  if (!plot || !cropDef || plot.crop == null) return { g, ok: false };
  return {
    g: withPlot(g, plotIdx, {
      ...plot,
      wateredUntil: nowMs + cropDef.wateredWindowMin * 60000,
      waterings: plot.waterings + 1,
    }),
    ok: true,
  };
}

/**
 * Fertilize a planted plot (§C2.2): instant
 * `progressMin += FERTILIZER_BOOST * cropDef.growthMin`, once per planting
 * (`fertilized` flag). Item purchase/consumption is economy's job.
 * @param {GardenSlice} g
 * @param {number} plotIdx
 * @param {CropDef} cropDef
 * @returns {{g: GardenSlice, ok: boolean}} ok:false when empty or already fertilized
 */
export function fertilize(g, plotIdx, cropDef) {
  const plot = plotAt(g, plotIdx);
  if (!plot || !cropDef || plot.crop == null || plot.fertilized) return { g, ok: false };
  return {
    g: withPlot(g, plotIdx, {
      ...plot,
      progressMin: plot.progressMin + FERTILIZER_BOOST * cropDef.growthMin,
      fertilized: true,
    }),
    ok: true,
  };
}

/**
 * Accrue growth from `g.lastTickAt` to `nowMs` (§C2.3): each planted plot
 * gains 1 progressMin per real minute of overlap between
 * [max(lastTickAt, plantedAt), nowMs] and its watered window
 * (…, wateredUntil). Idempotent — bookkeeping via `g.lastTickAt` never moves
 * backwards, so calling it from multiple sites (room interval, global ticker,
 * offline sim) is safe. Handles offline-style long gaps at the FULL elapsed
 * rate, uncapped.
 *
 * Events: `{type: 'ready', plotIdx, cropId}` for every plot that CROSSED
 * readiness (progressMin ≥ growthMin) during this tick — feeds the offline
 * 'cropsReady' welcome-back toast and the in-room sparkle.
 * @param {GardenSlice} g
 * @param {number} nowMs
 * @param {Object<string, CropDef>} cropsById injected crop catalog
 * @returns {{g: GardenSlice, events: {type: string, plotIdx: number, cropId: string}[]}}
 */
export function tick(g, nowMs, cropsById) {
  /** @type {{type: string, plotIdx: number, cropId: string}[]} */
  const events = [];
  if (!g || !Array.isArray(g.plots)) return { g, events };
  const last = Number(g.lastTickAt) || 0;
  const plots = g.plots.map((plot, plotIdx) => {
    if (!plot || plot.crop == null) return plot;
    const from = Math.max(last, Number(plot.plantedAt) || 0);
    const until = Math.min(nowMs, Number(plot.wateredUntil) || 0);
    const dtMin = Math.max(0, (until - from) / 60000);
    if (dtMin <= 0) return plot;
    const progressMin = plot.progressMin + dtMin;
    const def = cropsById?.[plot.crop];
    if (def && plot.progressMin < def.growthMin && progressMin >= def.growthMin) {
      events.push({ type: 'ready', plotIdx, cropId: plot.crop });
    }
    return { ...plot, progressMin };
  });
  return { g: { ...g, plots, lastTickAt: Math.max(last, nowMs) }, events };
}

/**
 * Rain auto-watering (§B4, binding): every PLANTED plot's
 * `wateredUntil = max(wateredUntil, rainEnd)`. Pure; called from the ambience
 * ticker and from simulateOffline for elapsed rain blocks. Callers must bring
 * bookkeeping current to rainStart (tick(g, rainStart)) BEFORE applying, so
 * a dry gap before the rain is never credited by the next tick.
 * @param {GardenSlice} g
 * @param {number} rainStart rain block start (epoch ms; sequencing aid, see above)
 * @param {number} rainEnd rain block end (epoch ms)
 * @param {Object<string, CropDef>} [cropsById] injected catalog (§E0.1-3 signature parity)
 * @returns {GardenSlice} new slice (same reference when nothing changed)
 */
export function applyRain(g, rainStart, rainEnd, cropsById) {
  if (!g || !Array.isArray(g.plots)) return g;
  let changed = false;
  const plots = g.plots.map((plot) => {
    if (!plot || plot.crop == null || plot.wateredUntil >= rainEnd) return plot;
    changed = true;
    return { ...plot, wateredUntil: rainEnd };
  });
  return changed ? { ...g, plots } : g;
}

/**
 * Harvest a ready plot (§C2.2): resets the plot to empty and reports what the
 * caller should add to the food inventory (+ collections veggie sticker +
 * `harvests` counter — wave-2 wiring).
 * @param {GardenSlice} g
 * @param {number} plotIdx
 * @param {CropDef} cropDef
 * @param {number} nowMs unused today; kept for §E signature stability
 * @returns {{g: GardenSlice, foodId: string, qty: number}|{ok: false}}
 */
export function harvest(g, plotIdx, cropDef, nowMs) {
  const plot = plotAt(g, plotIdx);
  if (!plot || !cropDef || plot.crop == null) return { ok: false };
  if (plot.progressMin < cropDef.growthMin) return { ok: false }; // not ready
  return {
    g: withPlot(g, plotIdx, emptyPlot()),
    foodId: cropDef.foodId ?? cropDef.id,
    qty: cropDef.yield,
  };
}

/**
 * Predicted readiness time (feeds harvest notification id 6, §C2.4): epoch ms
 * when the plot reaches growthMin — `nowMs` when already ready — or null when
 * the CURRENT watering can't carry it to readiness (progress would halt at
 * wateredUntil first; "don't lie" rule) or the plot is empty.
 * @param {Plot} plot
 * @param {CropDef} cropDef
 * @param {number} nowMs
 * @returns {number|null}
 */
export function readyAt(plot, cropDef, nowMs) {
  if (!plot || !cropDef || plot.crop == null) return null;
  const remainingMin = cropDef.growthMin - plot.progressMin;
  if (remainingMin <= 0) return nowMs; // already ready
  const wateredRemainMin = (plot.wateredUntil - nowMs) / 60000;
  if (wateredRemainMin < remainingMin) return null; // watering insufficient
  return nowMs + remainingMin * 60000;
}

/**
 * Growth fraction 0..1 — render stages at 0/33/66/100 % (§C2.3).
 * @param {Plot} plot
 * @param {CropDef} cropDef
 * @returns {number} 0 for empty plots
 */
export function progressPct(plot, cropDef) {
  if (!plot || !cropDef || plot.crop == null) return 0;
  const growthMin = Number(cropDef.growthMin);
  if (!(growthMin > 0)) return 0;
  return Math.min(1, Math.max(0, plot.progressMin / growthMin));
}

/**
 * Coins for selling harvested items at the compost bin (§C2.2/§C2.3 sell
 * price/ea). Payout itself goes through economy.sellHarvest (§B3).
 * @param {CropDef} cropDef
 * @param {number} qty
 * @returns {number}
 */
export function sellValue(cropDef, qty) {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  return (Number(cropDef?.sellPrice) || 0) * n;
}

/**
 * Plot purchase gating (§B6): plots must be bought in order (index ===
 * plotsOwned), plot 5 (index 4) needs L10/300c, plot 6 (index 5) L16/600c.
 * `price` is reported for purchasable indices even when ok:false, so the
 * FOR-SALE sign can show it while level-locked.
 * @param {GardenSlice} g
 * @param {number} index plot index 0–5
 * @param {number} level current player level
 * @returns {{ok: boolean, price: number}}
 */
export function canBuyPlot(g, index, level) {
  const def = PLOT_PURCHASES[index];
  if (!def) return { ok: false, price: 0 };
  const owned = Number(g?.plotsOwned) || 0;
  return { ok: index === owned && (Number(level) || 0) >= def.level, price: def.price };
}
