// V2/G19: Garden interactions (PLAN2 §C2.2/§C2.3) — the live 3D half of the
// garden room. Wires the roomManager's garden tap events + canvas drags to
// the pure engine (systems/garden.js) and the garden panels (ui/gardenPanel):
//
//   · plot visuals: growth-stage models (0/33/66/100 % via garden.progressPct),
//     watered soil darkening, FOR-SALE signs on plots ≥ plotsOwned, ready
//     sparkle + bounce
//   · tap empty owned plot → seed picker · tap ready plot → harvest (yield →
//     inventory + veggie sticker + `harvests` counter) · tap FOR-SALE plot →
//     buy sheet · compost bin → sell sheet · fertilizer bag → fertilizer sheet
//   · watering-can drag ≥ 0.5 s over a planted plot → water (tilt + drop
//     particles + soil darken, `waterings` counter) — greyed while rain/an
//     earlier watering still covers the plot (wave-1 relay: water() never
//     stacks beyond now + window)
//   · fertilizer-bag drag onto a growing plot → +25 % growth, once per
//     planting (§C2.2)
//   · swipe navigation for the 5th room (bedroom ⇄ garden — homeScene's v1
//     swipe handler only knows ROOMS.ORDER; this module handles the garden
//     legs and suppresses stray pans by starting a same-room pan first, which
//     homeScene's rm.isPanning() guard then respects)
//   · garden.tick on room enter + a 1 s in-room interval (engine is
//     idempotent — G20's global ticker coexists safely), incl. applyRain
//     while a rain block is live (§B4; G20's ambience ticker refines this)
//
// Self-wiring: initGardenInteractions() is called once from main.js (V2/G19
// marked block) BEFORE the first switchTo('home') — the home scene (and its
// roomManager) is rebuilt on every scene switch, so a poll re-wires against
// the live instance (same pattern as ui/sleepFlow.js).

import * as THREE from 'three';
import { t } from '../data/strings.js';
import { CROPS_BY_ID } from '../data/crops.js';
import * as garden from '../systems/garden.js';
import * as collections from '../systems/collections.js';
// V2/FIX-C (FA integration): harvest provenance — economy.recordHarvest
// credits items['harvested:<foodId>'] at the harvest site (anti-arbitrage
// compost gate). Namespace import + optional call = feature-detected.
import * as economy from '../systems/economy.js';
import { add as invAdd } from '../systems/inventory.js';
import { now } from '../core/clock.js';
import { weatherAt } from '../systems/weather.js';
import { createParticles } from '../gfx/particles.js';
import { getGooby, getRoomManager, getCamera } from './homeScene.js';
import { CROP_EMOJI, showForecastChip, hideForecastChip } from '../ui/gardenPanel.js';

/** water pour threshold (§C2.2: drag the can over a plot ≥ 0.5 s). */
const WATER_HOLD_MS = 500;
/** plot hover radius in room-local meters (plots sit on a 0.85 m pitch). */
const PLOT_RADIUS = 0.42;
/** how long after a tool drag swipes stay suppressed (ms). */
const SWIPE_SUPPRESS_MS = 300;
/** rewire poll cadence (ms) — cheap identity compare, sleepFlow pattern. */
const POLL_MS = 400;

/** module singleton state */
const s = {
  deps: null, // { store, ui, audio, input, assets }
  rm: null,
  /** @type {Array<() => void>} live-scene unsubscribers */
  subs: [],
  /** @type {ReturnType<typeof setInterval>|null} */
  pollTimer: null,
  /** @type {ReturnType<typeof setInterval>|null} */
  tickTimer: null,
  particles: null,
  gardenGroup: null,
  /** per-plot visual records */
  plots: [],
  /** tracked geometries/materials/textures we created (disposed on rewire) */
  owned: { geos: [], mats: [], texs: [] },
  // watering-can / fertilizer drag state
  canHolder: null,
  canHome: null,
  canHomeRotY: 0,
  bagHolder: null,
  bagHome: null,
  tool: null, // 'water' | 'fertilizer' | null
  toolEndedAt: 0,
  hoverPlot: -1,
  hoverSince: 0,
  pourFeedbackAt: 0,
  goobyDragBlocked: false,
  lastPersistAt: 0,
  time: 0,
  /**
   * V2/FIX-C (E15): ready-juice dedupe — 'plotIdx:cropId' → epoch ms of the
   * last chime/sparkle/toast. The local 1 s tick AND timeEngine's
   * 'cropsReadyLive' re-emit can observe the same crossing within one second;
   * whoever presents first wins, the other is suppressed.
   * @type {Map<string, number>}
   */
  readyShownAt: new Map(),
};

const track = {
  geo(g) { s.owned.geos.push(g); return g; },
  mat(m) { s.owned.mats.push(m); return m; },
  tex(tx) { s.owned.texs.push(tx); return tx; },
};

/** Ground a GLB clone: footprint-center on x/z, bbox bottom to y=0. */
function ground(model) {
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
}

/** Clone + tint a model's materials (radish = red-tinted turnip, §C2.3). */
function tintModel(model, hex) {
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    obj.material = mats.map((m) => {
      const clone = m.clone();
      clone.color.lerp(new THREE.Color(hex), 0.55);
      track.mat(clone);
      return clone;
    });
    if (Array.isArray(obj.material) && obj.material.length === 1) obj.material = obj.material[0];
  });
}

/**
 * Growth-stage index (§C2.3: stages at 0/33/66/100 % — the LAST stageModels
 * entry is the ready look, earlier entries spread across the growing phase).
 * @param {number} pct 0..1 @param {number} nStages
 * @returns {number}
 */
export function stageIndex(pct, nStages) {
  if (nStages <= 1) return 0;
  if (pct >= 1) return nStages - 1;
  return Math.min(nStages - 2, Math.floor(pct * (nStages - 1)));
}

// ---------------------------------------------------------------------------
// plot visuals
// ---------------------------------------------------------------------------

function buildForSaleSign(price) {
  const grp = new THREE.Group();
  grp.name = 'forSaleSign';
  const wood = new THREE.MeshStandardMaterial({ color: '#8A6B45', roughness: 0.85 });
  track.mat(wood);
  const post = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.05, 0.42, 0.05)), wood);
  post.position.y = 0.21;
  grp.add(post);

  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S / 2;
  const g = canvas.getContext('2d');
  g.fillStyle = '#F6EAD2';
  g.fillRect(0, 0, S, S / 2);
  g.strokeStyle = '#B58450';
  g.lineWidth = 5;
  g.strokeRect(2.5, 2.5, S - 5, S / 2 - 5);
  g.fillStyle = '#C0563E';
  g.font = '800 20px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(t('garden.plot.forSale'), S / 2, 26, S - 16);
  g.fillStyle = '#4A3B36';
  g.font = '800 18px system-ui, sans-serif';
  g.fillText(`${price}c 🪙`, S / 2, 52, S - 16);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  track.tex(tex);
  const panelMat = new THREE.MeshBasicMaterial({ map: tex });
  track.mat(panelMat);
  const panel = new THREE.Mesh(track.geo(new THREE.BoxGeometry(0.44, 0.22, 0.03)), panelMat);
  panel.position.y = 0.44;
  grp.add(panel);
  grp.rotation.y = -0.12;
  return grp;
}

/** (re)build one plot's dynamic contents to match the save slice. */
function renderPlot(idx, g) {
  const rec = s.plots[idx];
  if (!rec) return;
  const plot = g.plots[idx];
  const forSale = idx >= (g.plotsOwned ?? 4);

  // FOR-SALE sign (§C2.1: plots ≥ plotsOwned)
  if (forSale && !rec.sign) {
    const price = garden.PLOT_PURCHASES[idx]?.price ?? 0;
    rec.sign = buildForSaleSign(price);
    rec.sign.position.set(0.18, 0, -0.22);
    rec.holder.add(rec.sign);
  } else if (!forSale && rec.sign) {
    rec.holder.remove(rec.sign);
    rec.sign = null;
  }

  // crop growth-stage model (§C2.3)
  const crop = plot?.crop ? CROPS_BY_ID[plot.crop] : null;
  const pct = crop ? garden.progressPct(plot, crop) : 0;
  const stage = crop ? stageIndex(pct, crop.stageModels.length) : -1;
  const wantKey = crop ? `${crop.id}:${stage}` : null;
  if (rec.cropKey !== wantKey) {
    if (rec.cropModel) {
      rec.holder.remove(rec.cropModel);
      rec.cropModel = null;
    }
    rec.cropKey = wantKey;
    if (crop) {
      const holder = new THREE.Group();
      holder.name = `crop-${crop.id}`;
      const model = s.deps.assets.getModel(crop.stageModels[stage]);
      model.scale.setScalar(0.85);
      ground(model);
      // §C2.3 composite ready looks: tomato/eggplant fruit on stage-B leafs
      const isFruitStage = stage === crop.stageModels.length - 1 &&
        (crop.id === 'tomato' || crop.id === 'eggplant');
      if (isFruitStage) {
        const leafs = s.deps.assets.getModel('nature-kit/crops_leafsStageB');
        leafs.scale.setScalar(0.85);
        ground(leafs);
        holder.add(leafs);
        const nFruit = crop.id === 'tomato' ? 3 : 1;
        for (let f = 0; f < nFruit; f += 1) {
          const fruit = s.deps.assets.getModel(crop.stageModels[stage]);
          fruit.scale.setScalar(crop.id === 'tomato' ? 0.5 : 0.62);
          ground(fruit);
          fruit.position.set(
            Math.sin(f * 2.2) * 0.14,
            0.1,
            Math.cos(f * 2.2) * 0.12
          );
          holder.add(fruit);
        }
      } else {
        if (crop.id === 'radish' && stage === crop.stageModels.length - 1) {
          tintModel(model, '#D8504A'); // §C2.3: turnip tinted red
        }
        holder.add(model);
      }
      holder.position.y = 0.08; // sit on the dirt mound
      holder.traverse((obj) => { if (obj.isMesh) obj.castShadow = true; });
      rec.holder.add(holder);
      rec.cropModel = holder;
    }
  }
  rec.ready = !!(crop && plot.progressMin >= crop.growthMin);

  // watered soil darkening (§C2.2) — translucent overlay disc
  const watered = !!(crop && plot.wateredUntil > now());
  if (rec.wetDisc) rec.wetDisc.visible = watered;
}

function renderPlots() {
  const g = s.deps.store.get('garden');
  if (!g || !s.gardenGroup) return;
  for (let i = 0; i < 6; i += 1) renderPlot(i, g);
}

// ---------------------------------------------------------------------------
// garden tick (§C2.3 — room enter + 1 s in-room interval; idempotent engine)
// ---------------------------------------------------------------------------

/**
 * Float-accumulation guard: ~600 one-second tick() additions can leave
 * progressMin a few ULPs below growthMin even though exact arithmetic says
 * ready (9.999999999999996 vs 10 when one watering window exactly equals the
 * remaining growth — radish's 10/10 case). Snap within EPS so exact-boundary
 * waterings still ripen; 1e-6 min = 60 µs of growth, imperceptible.
 * TODO(G19→engine owner): fold this epsilon into systems/garden.js tick().
 * @param {import('../systems/garden.js').GardenSlice} g
 * @param {{type: string, plotIdx: number, cropId: string}[]} [events]
 *        ready events appended for snapped plots (same shape as tick())
 * @returns {import('../systems/garden.js').GardenSlice}
 */
const READY_EPS_MIN = 1e-6;
export function snapReady(g, events = []) {
  if (!g || !Array.isArray(g.plots)) return g;
  let changed = false;
  const plots = g.plots.map((plot, plotIdx) => {
    const crop = plot?.crop ? CROPS_BY_ID[plot.crop] : null;
    if (!crop) return plot;
    const gap = crop.growthMin - plot.progressMin;
    if (gap <= 0 || gap > READY_EPS_MIN) return plot;
    changed = true;
    events.push({ type: 'ready', plotIdx, cropId: plot.crop });
    return { ...plot, progressMin: crop.growthMin };
  });
  return changed ? { ...g, plots } : g;
}

/**
 * V2/FIX-C (E15): dedupe window for the ready chime/sparkle/toast (ms). The
 * local 1 s tick and timeEngine's 'cropsReadyLive' re-emit can both observe
 * the same readiness crossing — one presentation per plot per window.
 */
const READY_DEDUPE_MS = 5000;

/**
 * The §C2.2 "crop became ready" juice: harvestReady chime + sparkle at the
 * plot + toast. Shared by the local tick fallback and the 'cropsReadyLive'
 * store event (V2/FIX-B timeEngine contract); deduped via s.readyShownAt.
 * @param {{type?: string, plotIdx: number, cropId: string}[]} events
 */
function presentReadyEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return;
  const { ui, audio } = s.deps;
  const atMs = Date.now();
  for (const ev of events) {
    if (!ev || (ev.type && ev.type !== 'ready')) continue;
    const key = `${ev.plotIdx}:${ev.cropId}`;
    if (atMs - (s.readyShownAt.get(key) ?? 0) < READY_DEDUPE_MS) continue;
    s.readyShownAt.set(key, atMs);
    audio.play('garden.harvestReady');
    const crop = CROPS_BY_ID[ev.cropId];
    const at = s.rm?.getAnchor(`plot${ev.plotIdx}`, 'garden');
    if (at) s.particles?.emit('sparkles', { x: at.x, y: at.y + 0.35, z: at.z });
    if (crop) ui.toast('garden.ready', { name: t(crop.nameKey) });
  }
}

function gardenTick() {
  const { store } = s.deps;
  const nowMs = now();
  const before = store.get('garden');
  if (!before) return;
  let { g, events } = garden.tick(before, nowMs, CROPS_BY_ID);
  g = snapReady(g, events);
  // live rain auto-waters (§B4 applyRain — G20's ambience ticker + offline
  // sim also call this; wateredUntil = max(…) keeps it idempotent)
  const weather = weatherAt(nowMs);
  if (weather.state === 'rain') {
    g = garden.applyRain(g, weather.start, weather.end, CROPS_BY_ID);
  }
  const plotsChanged = g.plots.some((p, i) => p !== before.plots[i]);
  // avoid a 1 Hz gardenChanged storm: persist plot changes immediately,
  // bare lastTickAt bookkeeping at most every 30 s
  if (plotsChanged || nowMs - s.lastPersistAt > 30000) {
    s.lastPersistAt = nowMs;
    store.update((state) => { state.garden = g; });
  }
  // V2/FIX-C (E15): local-tick fallback path — timeEngine's global 1 Hz
  // ticker usually consumes the crossing first (its 'cropsReadyLive' re-emit
  // lands via the store subscription in wireScene), but when it doesn't run
  // (or this tick wins the race) the juice still presents from here.
  presentReadyEvents(events);
}

// ---------------------------------------------------------------------------
// tap flows (§C2.2)
// ---------------------------------------------------------------------------

function onPlotTap(idx) {
  const { store, ui, audio } = s.deps;
  const nowMs = now();
  // bring bookkeeping current so ready-checks never lag (engine contract)
  const ticked = snapReady(garden.tick(store.get('garden'), nowMs, CROPS_BY_ID).g);
  const plot = ticked.plots[idx];

  if (idx >= (ticked.plotsOwned ?? 4)) {
    audio.play('ui.open');
    ui.openPanel('gardenBuyPlot', { index: idx });
    return;
  }
  if (!plot?.crop) {
    audio.play('ui.open');
    ui.openPanel('gardenSeeds', { plotIdx: idx });
    return;
  }
  const crop = CROPS_BY_ID[plot.crop];
  if (!crop) return;
  if (plot.progressMin < crop.growthMin) {
    ui.toast('garden.notReady');
    return;
  }

  // harvest (§C2.2): yield → inventory, veggie sticker, `harvests` counter
  const res = garden.harvest(ticked, idx, crop, nowMs);
  if (!res.g) return;
  let firstSticker = false;
  store.update((state) => {
    state.garden = res.g;
    state.inventory = invAdd(state.inventory, res.foodId, res.qty);
    state.achievements.counters.harvests += 1;
    const award = collections.award(state.collections, 'veggies', crop.id);
    state.collections = award.c;
    firstSticker = award.first;
  });
  // V2/FIX-C (FA integration): harvest provenance for the anti-arbitrage
  // compost gate — items['harvested:<foodId>'] += qty, ONCE per harvest,
  // right where the yield lands in the inventory. Feature-detected (?.):
  // recordHarvest is V2/FIX-A's economy API; the final tree has both.
  economy.recordHarvest?.(store, res.foodId, res.qty);
  audio.play('garden.harvest');
  ui.toast('garden.harvested', {
    qty: res.qty,
    emoji: CROP_EMOJI[crop.id] ?? '🌱',
    name: t(crop.nameKey),
  });
  if (firstSticker) {
    setTimeout(() => s.deps.ui.toast('garden.sticker', { name: t(crop.nameKey) }), 900);
  }
  const at = s.rm?.getAnchor(`plot${idx}`, 'garden');
  if (at) s.particles?.emit('sparkles', { x: at.x, y: at.y + 0.4, z: at.z }, { count: 10 });
  getGooby()?.play('happyBounce');
}

// ---------------------------------------------------------------------------
// watering-can / fertilizer drags (§C2.2)
// ---------------------------------------------------------------------------

/** ray → the plot-top plane, in WORLD coords (y ≈ dirt-mound height). */
function dragPointOnGround(p, camera) {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(p.nx, p.ny), camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.12);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
}

/** nearest plot index within PLOT_RADIUS of a world point, or -1. */
function plotAtPoint(world) {
  let best = -1;
  let bestD = PLOT_RADIUS;
  for (let i = 0; i < 6; i += 1) {
    const at = s.rm.getAnchor(`plot${i}`, 'garden');
    if (!at) continue;
    const d = Math.hypot(world.x - at.x, world.z - at.z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function onDragStart(p) {
  if (!s.rm || s.rm.activeRoom() !== 'garden' || s.rm.isPanning()) return;
  const camera = getCamera();
  if (!camera) return;
  const gooby = getGooby();
  s.goobyDragBlocked = !!(gooby && s.deps.input.pick(camera, [gooby.group], p));
  if (s.goobyDragBlocked) return;
  if (s.canHolder && s.deps.input.pick(camera, [s.canHolder], p)) {
    s.tool = 'water';
    s.hoverPlot = -1;
    s.deps.audio.play('ui.pick');
  } else if (s.bagHolder && s.deps.input.pick(camera, [s.bagHolder], p)) {
    if ((s.deps.store.get('items.fertilizer') ?? 0) < 1) return; // tap opens the buy sheet
    s.tool = 'fertilizer';
    s.hoverPlot = -1;
    s.deps.audio.play('ui.pick');
  }
}

function onDrag(p) {
  if (!s.tool || !s.rm) return;
  const camera = getCamera();
  const world = camera && dragPointOnGround(p, camera);
  if (!world) return;
  const holder = s.tool === 'water' ? s.canHolder : s.bagHolder;
  const local = s.gardenGroup.worldToLocal(world.clone());
  holder.position.set(local.x, 0.45, local.z);
  if (s.tool === 'water') holder.rotation.z = -0.65; // pour tilt (§C2.2)

  const over = plotAtPoint(world);
  if (over !== s.hoverPlot) {
    s.hoverPlot = over;
    s.hoverSince = performance.now();
  } else if (s.tool === 'water' && over >= 0 &&
    performance.now() - s.hoverSince >= WATER_HOLD_MS) {
    tryWater(over);
    s.hoverSince = performance.now(); // re-arm (guarded by wateredUntil)
  }
}

function tryWater(idx) {
  const { store, ui, audio } = s.deps;
  const nowMs = now();
  const ticked = snapReady(garden.tick(store.get('garden'), nowMs, CROPS_BY_ID).g);
  const plot = ticked.plots[idx];
  if (!plot?.crop || idx >= (ticked.plotsOwned ?? 4)) return;
  const crop = CROPS_BY_ID[plot.crop];
  if (!crop || plot.progressMin >= crop.growthMin) return; // ready — nothing to water
  if (plot.wateredUntil > nowMs) {
    // §C2.2/relay: suppress while rain-watered or already watered (no stacking)
    if (performance.now() - s.pourFeedbackAt > 1500) {
      s.pourFeedbackAt = performance.now();
      ui.toast(weatherAt(nowMs).state === 'rain' ? 'garden.rainWatered' : 'garden.alreadyWatered');
    }
    return;
  }
  const res = garden.water(ticked, idx, crop, nowMs);
  if (!res.ok) return;
  store.update((state) => {
    state.garden = res.g;
    state.achievements.counters.waterings += 1;
  });
  audio.play('garden.water');
  const at = s.rm.getAnchor(`plot${idx}`, 'garden');
  if (at) s.particles?.emit('bubbles', { x: at.x, y: at.y + 0.45, z: at.z }, { count: 8 });
  ui.toast('garden.watered');
}

function tryFertilize(idx) {
  const { store, ui, audio } = s.deps;
  const nowMs = now();
  const ticked = snapReady(garden.tick(store.get('garden'), nowMs, CROPS_BY_ID).g);
  const plot = ticked.plots[idx];
  if (!plot?.crop) {
    ui.toast('garden.fertilizeEmpty');
    return;
  }
  if (plot.fertilized) {
    ui.toast('garden.alreadyFertilized');
    return;
  }
  if ((store.get('items.fertilizer') ?? 0) < 1) return;
  const crop = CROPS_BY_ID[plot.crop];
  const res = garden.fertilize(ticked, idx, crop);
  if (!res.ok) return;
  store.update((state) => {
    state.garden = res.g;
    state.items.fertilizer -= 1;
  });
  audio.play('garden.fertilize');
  const at = s.rm.getAnchor(`plot${idx}`, 'garden');
  if (at) s.particles?.emit('sparkles', { x: at.x, y: at.y + 0.4, z: at.z }, { count: 8 });
  ui.toast('garden.fertilized');
}

function onDragEnd(p) {
  if (!s.tool) return;
  const camera = getCamera();
  if (s.tool === 'fertilizer' && camera) {
    const world = dragPointOnGround(p, camera);
    const idx = world ? plotAtPoint(world) : -1;
    if (idx >= 0) tryFertilize(idx);
  }
  s.tool = null;
  s.toolEndedAt = performance.now();
  s.hoverPlot = -1;
  // tools glide home in the update hook
}

// ---------------------------------------------------------------------------
// swipe navigation for the 5th room (§C2.1: garden right of the bedroom)
// ---------------------------------------------------------------------------

function onSwipe(p) {
  const rm = getRoomManager();
  if (!rm || rm.isPanning?.()) return;
  if (p.dir !== 'left' && p.dir !== 'right') return;
  if (s.goobyDragBlocked) return; // pet/tickle gestures win (homeScene rule)
  const active = rm.activeRoom();
  // a tool drag (watering can / fertilizer) must never pan the room — start a
  // same-room "pan" so homeScene's rm.isPanning() swipe guard bails out too
  if (s.tool || performance.now() - s.toolEndedAt < SWIPE_SUPPRESS_MS) {
    if (active === 'garden') rm.goTo('garden');
    return;
  }
  if (active === 'bedroom' && p.dir === 'left') {
    rm.goTo('garden'); // locked → emits 'gardenLocked' (teaser toast below)
  } else if (active === 'garden') {
    if (p.dir === 'right') rm.goTo('bedroom');
    else rm.goTo('garden'); // suppress homeScene's indexOf(-1) kitchen jump
  }
}

// ---------------------------------------------------------------------------
// per-frame animation hook (rides rm.update — §C2.2 feel)
// ---------------------------------------------------------------------------

function onFrame(dt) {
  s.time += dt;
  s.particles?.update(dt);

  // tools glide back to their stands when idle
  if (s.canHolder && s.tool !== 'water') {
    s.canHolder.position.lerp(s.canHome, Math.min(1, dt * 8));
    s.canHolder.rotation.z += (0 - s.canHolder.rotation.z) * Math.min(1, dt * 8);
  }
  if (s.bagHolder && s.tool !== 'fertilizer') {
    s.bagHolder.position.lerp(s.bagHome, Math.min(1, dt * 8));
  }

  // ready crops bounce gently + sparkle now and then (§C2.2)
  for (const rec of s.plots) {
    if (!rec?.cropModel) continue;
    if (rec.ready) {
      const pulse = 1 + Math.sin(s.time * 3.2 + rec.idx) * 0.06;
      rec.cropModel.scale.setScalar(pulse);
      if (s.rm?.activeRoom() === 'garden' && Math.random() < dt * 0.35) {
        const at = s.rm.getAnchor(`plot${rec.idx}`, 'garden');
        if (at) s.particles?.emit('sparkles', { x: at.x, y: at.y + 0.4, z: at.z }, { count: 3 });
      }
    } else if (rec.cropModel.scale.x !== 1) {
      rec.cropModel.scale.setScalar(1);
    }
  }
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

function teardownScene() {
  for (const unsub of s.subs) unsub();
  s.subs.length = 0;
  if (s.tickTimer) clearInterval(s.tickTimer);
  s.tickTimer = null;
  hideForecastChip();
  s.particles?.dispose();
  s.particles = null;
  for (const geo of s.owned.geos) geo.dispose();
  for (const mat of s.owned.mats) mat.dispose();
  for (const tex of s.owned.texs) tex.dispose();
  s.owned = { geos: [], mats: [], texs: [] };
  s.plots = [];
  s.gardenGroup = null;
  s.canHolder = null;
  s.bagHolder = null;
  s.tool = null;
  s.rm = null;
}

function startRoomTick() {
  if (s.tickTimer) return;
  gardenTick();
  s.tickTimer = setInterval(gardenTick, 1000);
}

function stopRoomTick() {
  if (s.tickTimer) clearInterval(s.tickTimer);
  s.tickTimer = null;
}

function wireScene(rm) {
  const { store, ui, audio } = s.deps;
  s.rm = rm;
  s.gardenGroup = rm.getRoomGroup('garden');
  if (!s.gardenGroup) return;

  // particles parent: the home group (world coords, always visible)
  s.particles = createParticles(s.gardenGroup.parent ?? s.gardenGroup, { poolSize: 32 });

  // tool holders (built by roomManager's proc builders)
  s.canHolder = s.gardenGroup.getObjectByName('furn-wateringCan');
  s.canHome = s.canHolder?.position.clone() ?? new THREE.Vector3();
  s.bagHolder = s.gardenGroup.getObjectByName('furn-fertilizerBag');
  s.bagHome = s.bagHolder?.position.clone() ?? new THREE.Vector3();

  // per-plot dynamic holders + watered-soil overlay discs
  for (let i = 0; i < 6; i += 1) {
    const at = rm.getAnchor(`plot${i}`, 'garden');
    const holder = new THREE.Group();
    holder.name = `plotFx${i}`;
    const local = s.gardenGroup.worldToLocal(at.clone());
    holder.position.copy(local);
    s.gardenGroup.add(holder);
    const wetMat = track.mat(new THREE.MeshBasicMaterial({
      color: '#5B4226', transparent: true, opacity: 0.4, depthWrite: false,
    }));
    const wet = new THREE.Mesh(track.geo(new THREE.CircleGeometry(0.28, 14)), wetMat);
    wet.rotation.x = -Math.PI / 2;
    wet.position.y = 0.125;
    wet.visible = false;
    holder.add(wet);
    s.plots.push({ idx: i, holder, wetDisc: wet, cropModel: null, cropKey: null, sign: null, ready: false });
  }

  // taps (roomManager hitbox events — §C2.2)
  for (let i = 0; i < 6; i += 1) {
    s.subs.push(rm.on(`tap:plot${i}`, () => onPlotTap(i)));
  }
  s.subs.push(rm.on('tap:compost', () => {
    audio.play('ui.open');
    ui.openPanel('gardenSell');
  }));
  s.subs.push(rm.on('tap:fertilizer', () => {
    audio.play('ui.open');
    ui.openPanel('gardenFertilizer');
  }));
  s.subs.push(rm.on('tap:wateringCan', () => ui.toast('garden.waterHint')));
  s.subs.push(rm.on('gardenLocked', ({ unlockLevel }) => {
    audio.play('ui.error');
    ui.toast('garden.locked', { level: unlockLevel });
  }));

  // room enter/exit: forecast chip + the 1 s in-room tick (§C2.2/§C11.3)
  s.subs.push(rm.on('roomChanged', ({ roomId }) => {
    if (roomId === 'garden') {
      showForecastChip(ui);
      startRoomTick();
    } else {
      hideForecastChip();
      stopRoomTick();
    }
  }));
  if (rm.activeRoom() === 'garden') {
    showForecastChip(ui);
    startRoomTick();
  } else {
    // still bring growth bookkeeping current on scene (re)entry (§C2.2)
    gardenTick();
  }

  // V2/FIX-C (E15): live readiness crossings — timeEngine's global 1 Hz
  // ticker consumes garden.tick's 'ready' events before the in-room tick can
  // see them and re-emits them as the runtime-only store event
  // 'cropsReadyLive' (payload = [{type:'ready', plotIdx, cropId}, …] —
  // V2/FIX-B contract in core/timeEngine.js). Present the chime/sparkle/
  // toast while the garden is the active room; presentReadyEvents dedupes
  // against the local-tick fallback above. Feature-detected: with an older
  // engine the event never fires and the local tick still covers it.
  if (typeof store.on === 'function') {
    s.subs.push(store.on('cropsReadyLive', (events) => {
      if (s.rm?.activeRoom() !== 'garden') return;
      presentReadyEvents(events);
      renderPlots(); // stage swap + ready bounce without waiting for the tick
    }));
  }

  // visuals follow the save slice
  s.subs.push(store.on('gardenChanged', renderPlots));
  s.subs.push(rm.addUpdateHook(onFrame));
  renderPlots();

  console.info('[gardenInteractions] garden wired (plots/taps/drags active)');
}

/**
 * One-time boot wiring (main.js V2/G19 marked block, before switchTo('home')).
 * Registers the canvas drag/swipe listeners and starts the re-wire poll —
 * the home scene (and its roomManager) is rebuilt on every scene switch.
 * @param {{store: object, ui: object, audio: object, input: object, assets: object}} deps
 */
export function initGardenInteractions(deps) {
  s.deps = deps;

  // global canvas gestures (registered BEFORE homeScene's enter() so the
  // swipe handler runs first — see onSwipe's same-room pan suppression)
  deps.input.on('dragstart', onDragStart);
  deps.input.on('drag', onDrag);
  deps.input.on('dragend', onDragEnd);
  deps.input.on('swipe', onSwipe);

  s.pollTimer = setInterval(() => {
    const rm = getRoomManager();
    if (rm === s.rm) return;
    teardownScene();
    if (rm) wireScene(rm);
  }, POLL_MS);

  // dev handle (§E9 spirit): CDP tests navigate/tick without touch gymnastics
  if (import.meta.env?.DEV && typeof window !== 'undefined') {
    const attach = setInterval(() => {
      if (!window.__gooby) return;
      clearInterval(attach);
      window.__gooby.garden = {
        goTo: () => getRoomManager()?.goTo('garden'),
        rm: () => getRoomManager(),
        camera: () => getCamera(),
        tick: gardenTick,
      };
    }, 500);
  }
}
