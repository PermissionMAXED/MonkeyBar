// Cake Shop / Tortenwerkstatt (PLAN3 §C9, agent V3/G36 — flagship #2): a
// Comfy-Cakes-inspired assembly line in a warm KayKit-Restaurant bakery.
// NPC customers (Knight/Mage/Rogue, §D2.1) walk in, sit at the counter and
// order cakes (pictogram tickets, max 3); the player assembles each cake on
// a two-tier conveyor by tapping station buttons at the right moment:
// Form → Teig → Ofen (3 s meter, green zone) → Guss → Deko → Kerzen, one
// fix-loop per cake, auto-serve against the best open ticket. ALL rules and
// numbers live in purblePlace.logic.js (§B rule — the engine is pure); this
// module renders engine state, forwards taps, and runs the NPC/juice layer.
// Skinned-NPC budget (§C9.7): ≤ 1 actively-animated mixer at any time (walk/
// cheer token), seated customers are frozen poses; ≤ 250 draw calls.
// Dev-only ?autoplay=1 drives the round with the shared logic bot.

import * as THREE from 'three';
import { t } from '../../data/strings.js';
import { tween, easings } from '../../gfx/tween.js';
import { createParticles } from '../../gfx/particles.js';
import { createGooby } from '../../character/gooby.js';
import { applyEquippedOutfits } from '../../character/outfitAttach.js'; // cameo outfits (§C5.3)
import { getAchievementsEngine } from '../../systems/achievementsEngine.js';
import { clampFloatTextToView } from '../framework.js';
import {
  CAKE,
  SPONGES,
  SPONGE_HEX,
  ICINGS,
  ICING_HEX,
  TOPPINGS,
  STATION_S,
  inStationWindow,
  beltSpeedAt,
  beltSpeedMultAt,
  createEngine,
  createBot,
  mulberry32,
} from './purblePlace.logic.js';

// ---------------------------------------------------------------------------
// static tables (assets, layout, pictogram colors)
// ---------------------------------------------------------------------------

/** §C9.6/§D2.2 bakery set + §D2.1 customers + food-kit dressing/toppings. */
const RESTAURANT_KEYS = [
  'kitchencounter_straight', 'kitchencounter_sink', 'oven', 'wall_orderwindow',
  'wall_doorway', 'floor_kitchen', 'plate', 'plate_small', 'menu', 'chair_A',
  'chair_stool', 'table_round_A', 'crate_buns', 'crate_cheese',
  'crate_tomatoes', 'cuttingboard', 'jar_A_medium', 'jar_C_small', 'fridge_A',
].map((k) => `kaykit-restaurant/${k}`);
const CHAR_KEYS = ['Knight', 'Mage', 'Rogue_Hooded'].map((k) => `kaykit-characters/${k}`);
const FOOD_KEYS = ['strawberry', 'cupcake', 'muffin', 'cake-birthday', 'donut-sprinkles']
  .map((k) => `food-kit/${k}`);

/** Belt-space (0…6 m) → world mapping: two tiers joined by a chute (§C9.3
 * layout note in the logic module — stations sit clear of the 2.7–3.3 bend).
 * World kept compact (±1.75) so the portrait camera frames the whole line. */
const BELT = Object.freeze({
  T1_END: 2.7, T2_START: 3.3,
  X_LEFT: -1.75, X_RIGHT: 1.75,
  Z1: -0.85, Z2: 0.5,
  Y1: 0.72, Y2: 0.54,
});

/** NPC choreography (§C9.1 walk in → sit → cheer/sad out): customers enter
 * from the right, walk the front lane and sit on the stools next to the
 * serve zone (front-left), facing the belt. */
const NPC = Object.freeze({
  SCALE: 0.45,
  WALK_SPEED: 1.15,
  DOOR: Object.freeze({ x: 2.7, z: 1.5 }),
  SEATS: Object.freeze([
    Object.freeze({ x: -1.5, z: 1.42 }),
    Object.freeze({ x: -0.85, z: 1.58 }),
    Object.freeze({ x: -0.2, z: 1.42 }),
  ]),
  CHEER_SEC: 1.7,
});

const SPRINKLE_COLORS = ['#E4572E', '#F5C518', '#4CB5AE', '#B37FD4', '#7CC15E', '#F781B0'];
const SHAPE_GLYPH = { round: '●', square: '■', heart: '♥' };

// ---------------------------------------------------------------------------
// pictogram SVG builders (tickets are language-free cards — §C9.2)
// ---------------------------------------------------------------------------

/** @param {string} shape @param {number} cx @param {number} cy @param {number} r */
function shapeBadgeSvg(shape, cx, cy, r) {
  const c = '#7A5B40';
  if (shape === 'round') return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}"/>`;
  if (shape === 'square') {
    return `<rect x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" rx="1.5" fill="${c}"/>`;
  }
  const s = r / 8;
  return `<path transform="translate(${cx},${cy - r}) scale(${s})" fill="${c}"
    d="M0 4 C -2 0 -8 0 -8 5 C -8 9 -3 12 0 15 C 3 12 8 9 8 5 C 8 0 2 0 0 4 Z"/>`;
}

/** @param {string} topping @param {number} cx @param {number} cy */
function toppingSvg(topping, cx, cy) {
  if (topping === 'cherry') {
    return `<path d="M${cx} ${cy - 4} q 3 -5 7 -6" stroke="#2E7D32" stroke-width="1.6" fill="none"/>
      <circle cx="${cx}" cy="${cy}" r="4" fill="#D6293A"/>
      <circle cx="${cx - 1.4}" cy="${cy - 1.4}" r="1.1" fill="#F08A96"/>`;
  }
  if (topping === 'sprinkles') {
    return SPRINKLE_COLORS.slice(0, 5).map((c, i) => {
      const x = cx - 10 + i * 5;
      const y = cy + (i % 2 === 0 ? -1.5 : 1.5);
      return `<rect x="${x}" y="${y}" width="4" height="1.8" rx="0.9" fill="${c}" transform="rotate(${i * 37 - 60} ${x + 2} ${y + 1})"/>`;
    }).join('');
  }
  if (topping === 'berries') {
    const berry = (x) => `<path d="M${x} ${cy - 4} C ${x + 4} ${cy - 4} ${x + 3.4} ${cy + 1} ${x} ${cy + 3.4}
        C ${x - 3.4} ${cy + 1} ${x - 4} ${cy - 4} ${x} ${cy - 4} Z" fill="#E4405F"/>
      <path d="M${x - 2.4} ${cy - 4.4} L ${x + 2.4} ${cy - 4.4} L ${x} ${cy - 2.2} Z" fill="#4E9B47"/>`;
    return berry(cx - 5) + berry(cx + 5);
  }
  return '';
}

/**
 * Pictogram order card (§C9.2): side-view cake (pan + sponge + icing + topping
 * + candles) with a shape badge top-right — readable at every uiScale, EN+DE
 * identical (language-free).
 * @param {{shape: string, sponge: string, icing: string, topping: string, candles: number}} spec
 * @returns {string} svg markup
 */
function ticketSvg(spec) {
  const parts = [];
  // candles behind the topping
  for (let i = 0; i < spec.candles; i += 1) {
    const x = 32 + (i - (spec.candles - 1) / 2) * 8;
    parts.push(`<rect x="${x - 1.3}" y="10" width="2.6" height="11" rx="1" fill="#F7E7C8" stroke="#C9A87A" stroke-width="0.6"/>
      <circle cx="${x}" cy="7.6" r="2.4" fill="#FFB13D"/>`);
  }
  // icing cap (or bare sponge top when the ticket wants none)
  if (spec.icing !== 'none') {
    const hex = ICING_HEX[spec.icing];
    parts.push(`<rect x="13" y="24" width="38" height="10" rx="5" fill="${hex}" stroke="rgba(74,59,54,0.25)" stroke-width="1"/>
      <circle cx="20" cy="34.5" r="3" fill="${hex}"/><circle cx="32" cy="36" r="3.4" fill="${hex}"/><circle cx="44" cy="34.5" r="3" fill="${hex}"/>`);
  }
  // sponge + pan
  parts.push(`<rect x="15" y="31" width="34" height="15" fill="${SPONGE_HEX[spec.sponge]}" stroke="#7A5B40" stroke-width="1.4"/>`);
  parts.push('<path d="M12 46 L52 46 L49 53 L15 53 Z" fill="#9AA0A8" stroke="#6E747C" stroke-width="1"/>');
  parts.push(toppingSvg(spec.topping, 32, 20.5));
  parts.push(shapeBadgeSvg(spec.shape, 54, 11, 6.5));
  return `<svg viewBox="0 0 64 60" aria-hidden="true">${parts.join('')}</svg>`;
}

/**
 * Mini pictograms for the station buttons (buttons are language-free; labels
 * ride aria/title from v3-cake strings).
 * @param {string} kind
 * @param {string} [color]
 * @returns {string} svg markup
 */
function buttonSvg(kind, color) {
  const wrap = (inner) => `<svg viewBox="0 0 28 28" aria-hidden="true">${inner}</svg>`;
  if (kind === 'sponge') {
    return wrap(`<rect x="4" y="7" width="20" height="14" rx="5" fill="${color}" stroke="#7A5B40" stroke-width="1.4"/>
      <circle cx="10" cy="12" r="1.5" fill="rgba(255,255,255,0.55)"/><circle cx="17" cy="16" r="1.2" fill="rgba(255,255,255,0.45)"/>`);
  }
  if (kind === 'icing') {
    return wrap(`<rect x="4" y="8" width="20" height="8" rx="4" fill="${color}" stroke="rgba(74,59,54,0.3)" stroke-width="1"/>
      <circle cx="9" cy="17" r="2.4" fill="${color}"/><circle cx="15" cy="19" r="2.8" fill="${color}"/><circle cx="21" cy="17" r="2.2" fill="${color}"/>`);
  }
  if (kind === 'oven') {
    return wrap(`<path d="M14 4 C 18 9 21 12 21 17 A 7 7 0 0 1 7 17 C 7 12 10 9 14 4 Z" fill="#F2762E"/>
      <path d="M14 11 C 16 14 17.5 15.5 17.5 18 A 3.5 3.5 0 0 1 10.5 18 C 10.5 15.5 12 14 14 11 Z" fill="#FFC93D"/>`);
  }
  if (kind === 'candle') {
    return wrap(`<rect x="11.5" y="9" width="5" height="14" rx="2" fill="#F7E7C8" stroke="#C9A87A" stroke-width="1"/>
      <circle cx="14" cy="5.5" r="3" fill="#FFB13D"/>`);
  }
  if (kind === 'cherry') return wrap(toppingSvg('cherry', 14, 16));
  if (kind === 'sprinkles') {
    return wrap(`<rect x="4" y="10" width="20" height="9" rx="4.5" fill="#FFF3E0" stroke="#C9A87A" stroke-width="1"/>${toppingSvg('sprinkles', 14, 14.5)}`);
  }
  if (kind === 'berries') return wrap(toppingSvg('berries', 14, 16));
  return wrap('');
}

// ---------------------------------------------------------------------------
// tiny floating score text (shared minigame pattern — self-disposing sprites)
// ---------------------------------------------------------------------------

function createFloatTexts(scene, camera) {
  const active = new Set();
  return {
    spawn(text, pos, color = '#4A3B36') {
      const canvas = document.createElement('canvas');
      canvas.width = 180;
      canvas.height = 80;
      const g = canvas.getContext('2d');
      g.font = '900 42px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(text, 90, 40);
      g.fillStyle = color;
      g.fillText(text, 90, 40);
      const tex = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(clampFloatTextToView(pos.clone(), camera, { halfW: 0.6, halfH: 0.27 }));
      sprite.scale.set(1.2, 0.53, 1);
      scene.add(sprite);
      active.add({ sprite, mat, tex, age: 0, life: 0.9 });
    },
    update(dt) {
      for (const f of active) {
        f.age += dt;
        f.sprite.position.y += dt * 0.9;
        f.mat.opacity = 1 - (f.age / f.life) ** 2;
        if (f.age >= f.life) {
          f.sprite.parent?.remove(f.sprite);
          f.mat.dispose();
          f.tex.dispose();
          active.delete(f);
        }
      }
    },
    dispose() {
      for (const f of active) {
        f.sprite.parent?.remove(f.sprite);
        f.mat.dispose();
        f.tex.dispose();
      }
      active.clear();
    },
  };
}

/** Belt-space s (0…6) → world position (two tiers + chute). */
function beltPoint(s, out = new THREE.Vector3()) {
  const span = BELT.X_RIGHT - BELT.X_LEFT;
  if (s <= BELT.T1_END) {
    return out.set(BELT.X_LEFT + (s / BELT.T1_END) * span, BELT.Y1, BELT.Z1);
  }
  if (s >= BELT.T2_START) {
    const f = (s - BELT.T2_START) / (CAKE.BELT_LENGTH_M - BELT.T2_START);
    return out.set(BELT.X_RIGHT - f * span, BELT.Y2, BELT.Z2);
  }
  const f = (s - BELT.T1_END) / (BELT.T2_START - BELT.T1_END);
  return out.set(BELT.X_RIGHT, BELT.Y1 + (BELT.Y2 - BELT.Y1) * f, BELT.Z1 + (BELT.Z2 - BELT.Z1) * f);
}

/** @type {object} §E8 plugin */
export default {
  id: 'purblePlace',
  assetKeys: [...RESTAURANT_KEYS, ...CHAR_KEYS, ...FOOD_KEYS],
  /** V3/G32 per-game sample warmup (§B2.3) — the V3/G36 sfxMap block. */
  sfx: ['cake.apply', 'cake.ovenDing', 'cake.splat', 'cake.serve', 'cake.candle', 'cake.order'],

  // ------------------------------------------------------------------ init
  /** @param {object} ctx §E8 game context */
  init(ctx) {
    this.ctx = ctx;
    this.autoplay =
      import.meta.env?.DEV && new URLSearchParams(location.search).get('autoplay') === '1';
    this.phase = 'play'; // 'play' | 'ending' | 'done'
    this.paused = false;
    this.endT = 0;
    this.reportedScore = 0;
    this.lastBeltMult = 1;
    this.maxDrawCalls = 0;

    this.engine = createEngine(ctx.rng);
    this.bot = this.autoplay ? createBot(mulberry32(Math.floor(ctx.rng() * 2 ** 31))) : null;

    const scene = ctx.scene;
    const camera = ctx.camera;
    camera.fov = 62; // wider than the ROOMS default — whole line fits portrait
    camera.updateProjectionMatrix();
    camera.position.set(0, 5.0, 6.6);
    camera.lookAt(0, 0.35, 0.2);
    scene.background = new THREE.Color('#F6E3D0'); // warm bakery cream
    scene.fog = new THREE.Fog('#F6E3D0', 12, 22);

    /** @type {THREE.BufferGeometry[]} */
    this.ownedGeos = [];
    /** @type {THREE.Material[]} */
    this.ownedMats = [];
    /** @type {THREE.Texture[]} */
    this.ownedTexs = [];
    /** geometry cache for the 36-combo procedural cake layers (§C9.6) */
    this.geoCache = new Map();

    this.buildLighting(scene);
    this.buildRoom(scene);
    this.buildBelt(scene);
    this.buildStations(scene);
    this.buildCakeSharedResources();

    // Gooby the baker behind the top belt tier (cameo — outfits equipped)
    this.particles = createParticles(scene);
    this.floats = createFloatTexts(scene, camera);
    this.gooby = createGooby({ particles: this.particles });
    applyEquippedOutfits(this.gooby);
    // the baker works behind the top belt tier, between Form and Teig — on a
    // little step stool so he peeks over the belt line from the high camera
    const podium = this.own(new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.42, 0.55),
      new THREE.MeshStandardMaterial({ color: '#A9744B', roughness: 0.85 })
    ));
    podium.position.set(-1.35, 0.21, -1.45);
    scene.add(podium);
    this.gooby.group.scale.setScalar(0.85);
    this.gooby.group.position.set(-1.35, 0.42, -1.45);
    this.gooby.group.rotation.y = Math.PI * 0.06;
    this.gooby.setEmotion('happy');
    scene.add(this.gooby.group);

    // --- live cake views + Form-station preview ---
    /** @type {Map<number, object>} engine cake id → view */
    this.cakeViews = new Map();
    this.formPreview = new THREE.Group();
    this.formPreview.position.copy(beltPoint(0));
    this.formPreview.position.y += 0.16;
    scene.add(this.formPreview);
    this.previewShape = null;
    this.syncFormPreview();

    // --- NPCs (§C9.1 lifecycle; §C9.7 cap: ≤1 animated mixer) ---
    /** @type {Map<number, object>} ticketId → npc */
    this.npcs = new Map();
    this.npcCharIdx = Math.floor(ctx.rng() * CHAR_KEYS.length);
    this.animOwner = null; // the single npc whose mixer advances
    /** @type {object[]} */
    this.animQueue = [];
    this.seatTaken = [false, false, false];

    this.buildTicketsDom();
    this.buildControlsDom();

    ctx.hud.setScore(0);
    ctx.hud.setTime(CAKE.DURATION_SEC);

    if (import.meta.env?.DEV) {
      // §E9 test surface: lets CDP scripts drive scripted serves (scoring
      // matrix proof) and read perf numbers without UI scraping.
      window.__purble = { game: this, engine: this.engine, renderer: ctx.renderer };
    }
  },

  // ------------------------------------------------------------- scene build
  buildLighting(scene) {
    scene.add(new THREE.HemisphereLight(0xfff3e2, 0xd9b28f, 1.05));
    const key = new THREE.DirectionalLight(0xfff0d8, 1.0);
    key.position.set(3, 7, 4);
    scene.add(key);
    const warm = new THREE.PointLight(0xffb46b, 22, 9, 2); // oven-side glow
    warm.position.set(1.6, 1.8, -1.2);
    scene.add(warm);
  },

  own(mesh) {
    if (mesh.geometry) this.ownedGeos.push(mesh.geometry);
    if (mesh.material) this.ownedMats.push(mesh.material);
    return mesh;
  },

  /** One restaurant-set clone, uniformly scaled so its bbox height = h. */
  place(scene, key, x, z, rotY = 0, h = null) {
    const m = this.ctx.assets.getModel(`kaykit-restaurant/${key}`);
    if (h != null) {
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      if (size.y > 0) m.scale.setScalar(h / size.y);
    }
    m.position.set(x, 0, z);
    m.rotation.y = rotY;
    scene.add(m);
    return m;
  },

  buildRoom(scene) {
    // warm wood ground plane + KayKit kitchen-tile accent under the belt
    const ground = this.own(new THREE.Mesh(
      new THREE.PlaneGeometry(16, 12),
      new THREE.MeshStandardMaterial({ color: '#C89A6B', roughness: 0.95 })
    ));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.02, 0.6);
    scene.add(ground);
    // §C9.6 floor_kitchen ×8 checker strip under the assembly line
    const tileProbe = this.ctx.assets.getModel('kaykit-restaurant/floor_kitchen');
    const tb = new THREE.Box3().setFromObject(tileProbe);
    const ts = tb.getSize(new THREE.Vector3());
    const tileW = ts.x > 0.01 ? ts.x : 1;
    const tileScale = 1.7 / tileW;
    for (let i = 0; i < 8; i += 1) {
      const tile = i === 0 ? tileProbe : this.ctx.assets.getModel('kaykit-restaurant/floor_kitchen');
      tile.scale.setScalar(tileScale);
      tile.position.set(-2.975 + (i % 4) * 1.7, 0, -1.05 + Math.floor(i / 4) * 1.7);
      scene.add(tile);
    }

    // back wall: order-window + doorway + order-window (§D2.2 pieces)
    this.place(scene, 'wall_orderwindow', -1.9, -2.25, 0, 2.1);
    this.place(scene, 'wall_doorway', 0.1, -2.25, 0, 2.1);
    this.place(scene, 'wall_orderwindow', 2.1, -2.25, 0, 2.1);
    // counter row along the back + kitchen dressing (§C9.6)
    this.place(scene, 'kitchencounter_straight', -3.05, -1.65, Math.PI / 2, 0.95);
    this.place(scene, 'kitchencounter_sink', -3.05, -0.55, Math.PI / 2, 0.95);
    this.place(scene, 'kitchencounter_straight', -3.05, 0.55, Math.PI / 2, 0.95);
    this.place(scene, 'fridge_A', 3.1, -1.7, -Math.PI / 2, 1.7);
    this.place(scene, 'kitchencounter_straight', 3.1, -0.55, -Math.PI / 2, 0.95);
    this.place(scene, 'crate_buns', 2.6, -1.9, 0.3, 0.42);
    this.place(scene, 'crate_cheese', -2.5, -1.95, -0.2, 0.42);
    this.place(scene, 'crate_tomatoes', -2.05, -1.85, 0.55, 0.42);
    this.place(scene, 'menu', 0.1, -2.2, 0, 0.9).position.y = 1.35;
    this.place(scene, 'cuttingboard', -3.02, -1.6, Math.PI / 2, 0.06).position.y = 0.95;
    this.place(scene, 'jar_A_medium', -3.02, 0.35, 0, 0.34).position.y = 0.95;
    this.place(scene, 'jar_C_small', -3.02, 0.75, 0, 0.26).position.y = 0.95;

    // customer corner: round table + chair tucked right, stools at the front
    this.place(scene, 'table_round_A', 2.85, 0.15, 0, 0.6);
    this.place(scene, 'chair_A', 2.8, -0.75, Math.PI, 0.85);
    this.stoolTopY = 0.5;
    for (let i = 0; i < NPC.SEATS.length; i += 1) {
      const seat = NPC.SEATS[i];
      const stool = this.place(scene, 'chair_stool', seat.x, seat.z, 0, 0.52);
      const sb = new THREE.Box3().setFromObject(stool);
      this.stoolTopY = Math.max(0.3, sb.max.y);
    }
    // pastry dressing on the back counters (food-kit — §C9.6 list)
    const dress = (key, x, z, s) => {
      const m = this.ctx.assets.getModel(`food-kit/${key}`);
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const k = s / Math.max(size.x, size.y, size.z, 0.001);
      m.scale.setScalar(k);
      m.position.set(x, 0.97, z);
      scene.add(m);
      return m;
    };
    dress('cake-birthday', -3.05, -1.0, 0.42);
    dress('cupcake', -3.0, 0.0, 0.22);
    dress('muffin', 3.05, -0.35, 0.22);
    dress('donut-sprinkles', 3.05, -0.75, 0.24);
    this.place(scene, 'plate', -3.0, -1.0, 0, 0.05).position.y = 0.95;
    this.place(scene, 'plate_small', 3.05, -0.35, 0, 0.04).position.y = 0.95;
  },

  buildBelt(scene) {
    // scrolling stripe texture shared by both tiers (offset.x = belt motion)
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 16;
    const g = canvas.getContext('2d');
    g.fillStyle = '#5B5350';
    g.fillRect(0, 0, 64, 16);
    g.fillStyle = '#6E6663';
    g.fillRect(0, 0, 26, 16);
    this.beltTex = new THREE.CanvasTexture(canvas);
    this.beltTex.wrapS = this.beltTex.wrapT = THREE.RepeatWrapping;
    this.beltTex.repeat.set(9, 1);
    this.ownedTexs.push(this.beltTex);
    const beltMat = new THREE.MeshStandardMaterial({ map: this.beltTex, roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: '#8C6A4F', roughness: 0.8 });
    this.ownedMats.push(beltMat, frameMat);

    const span = BELT.X_RIGHT - BELT.X_LEFT + 0.5;
    const mkTier = (y, z) => {
      const top = new THREE.Mesh(new THREE.BoxGeometry(span, 0.06, 0.62), beltMat);
      top.position.set(0, y - 0.03, z);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(span + 0.12, y - 0.1, 0.74), frameMat);
      frame.position.set(0, (y - 0.1) / 2, z);
      this.ownedGeos.push(top.geometry, frame.geometry);
      scene.add(top, frame);
      return top;
    };
    mkTier(BELT.Y1, BELT.Z1);
    mkTier(BELT.Y2, BELT.Z2);
    // chute connecting the tiers (right end)
    const chuteLen = Math.hypot(BELT.Z2 - BELT.Z1, BELT.Y1 - BELT.Y2) + 0.3;
    const chute = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, chuteLen), beltMat);
    chute.position.set(BELT.X_RIGHT, (BELT.Y1 + BELT.Y2) / 2 - 0.03, (BELT.Z1 + BELT.Z2) / 2);
    chute.rotation.x = Math.atan2(BELT.Y1 - BELT.Y2, BELT.Z2 - BELT.Z1);
    this.ownedGeos.push(chute.geometry);
    scene.add(chute);
    // serve plate at the belt end (s = 6)
    const servePos = beltPoint(CAKE.BELT_LENGTH_M);
    this.place(scene, 'plate', servePos.x - 0.55, servePos.z + 0.15, 0, 0.06).position.y = 0.56;
  },

  buildStations(scene) {
    // colored gantry ring per station over the belt + the real oven model
    const stationColor = {
      teig: '#E8A857', ofen: '#E4572E', guss: '#F781B0', deko: '#4CB5AE', kerzen: '#F5C518',
    };
    this.stationMarkers = {};
    for (const [st, s] of Object.entries(STATION_S)) {
      const p = beltPoint(s);
      const mat = new THREE.MeshStandardMaterial({
        color: stationColor[st], roughness: 0.6, emissive: stationColor[st], emissiveIntensity: 0.12,
      });
      const arch = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 10, 24, Math.PI), mat);
      arch.position.set(p.x, p.y - 0.02, p.z);
      this.ownedGeos.push(arch.geometry);
      this.ownedMats.push(mat);
      scene.add(arch);
      this.stationMarkers[st] = { arch, mat };
      if (st === 'kerzen') {
        // candle dropper box hanging over the ring
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(0.34, 0.26, 0.34),
          new THREE.MeshStandardMaterial({ color: '#B98A5A', roughness: 0.8 })
        );
        box.position.set(p.x, p.y + 0.62, p.z);
        this.ownedGeos.push(box.geometry);
        this.ownedMats.push(box.material);
        scene.add(box);
      }
    }
    // the real KayKit oven right behind the Ofen slot (§C9.6)
    const ofenP = beltPoint(STATION_S.ofen);
    this.place(scene, 'oven', ofenP.x, ofenP.z - 0.85, 0, 1.15);
    const glowMat = new THREE.MeshBasicMaterial({
      color: '#FF8A3C', transparent: true, opacity: 0, depthWrite: false,
    });
    this.ovenGlow = new THREE.Mesh(new THREE.CircleGeometry(0.38, 20), glowMat);
    this.ovenGlow.rotation.x = -Math.PI / 2;
    this.ovenGlow.position.set(ofenP.x, ofenP.y + 0.01, ofenP.z);
    this.ownedGeos.push(this.ovenGlow.geometry);
    this.ownedMats.push(glowMat);
    scene.add(this.ovenGlow);
  },

  // -------------------------------------------------- procedural cake meshes
  buildCakeSharedResources() {
    this.candleGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.12, 8);
    this.candleMat = new THREE.MeshStandardMaterial({ color: '#F7E7C8', roughness: 0.7 });
    const flameCanvas = document.createElement('canvas');
    flameCanvas.width = flameCanvas.height = 32;
    const g = flameCanvas.getContext('2d');
    const grad = g.createRadialGradient(16, 16, 2, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,240,180,1)');
    grad.addColorStop(0.5, 'rgba(255,170,60,0.9)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    const flameTex = new THREE.CanvasTexture(flameCanvas);
    this.flameMat = new THREE.SpriteMaterial({ map: flameTex, transparent: true, depthWrite: false });
    this.ownedTexs.push(flameTex);
    this.cherryMat = new THREE.MeshStandardMaterial({ color: '#D6293A', roughness: 0.35 });
    this.stemMat = new THREE.MeshStandardMaterial({ color: '#2E7D32', roughness: 0.7 });
    this.cherryGeo = new THREE.SphereGeometry(0.055, 12, 10);
    this.stemGeo = new THREE.CylinderGeometry(0.008, 0.01, 0.09, 6);
    this.sprinkleGeo = new THREE.BoxGeometry(0.045, 0.016, 0.016);
    this.sprinkleMats = SPRINKLE_COLORS.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 })
    );
    this.panMat = new THREE.MeshStandardMaterial({ color: '#9AA0A8', roughness: 0.45, metalness: 0.55 });
    this.ownedGeos.push(this.candleGeo, this.cherryGeo, this.stemGeo, this.sprinkleGeo);
    this.ownedMats.push(
      this.candleMat, this.flameMat, this.cherryMat, this.stemMat, this.panMat, ...this.sprinkleMats
    );
  },

  /** Cached layer geometry per (shape, height, footprint) — 36-combo rule. */
  layerGeo(shape, h, xy) {
    const key = `${shape}:${h}:${xy}`;
    let geo = this.geoCache.get(key);
    if (geo) return geo;
    if (shape === 'round') {
      geo = new THREE.CylinderGeometry(xy * 0.47, xy * 0.5, h, 24);
    } else if (shape === 'square') {
      geo = new THREE.BoxGeometry(xy * 0.9, h, xy * 0.9);
    } else {
      const s = new THREE.Shape();
      s.moveTo(25, 25);
      s.bezierCurveTo(25, 25, 20, 0, 0, 0);
      s.bezierCurveTo(-30, 0, -30, 35, -30, 35);
      s.bezierCurveTo(-30, 55, -10, 77, 25, 95);
      s.bezierCurveTo(60, 77, 80, 55, 80, 35);
      s.bezierCurveTo(80, 35, 80, 0, 50, 0);
      s.bezierCurveTo(35, 0, 25, 25, 25, 25);
      geo = new THREE.ExtrudeGeometry(s, { depth: h / (xy / 110), bevelEnabled: false });
      geo.scale(xy / 110, xy / 110, xy / 110);
      geo.rotateX(Math.PI / 2);
      geo.center();
      geo.rotateY(Math.PI); // heart tip toward the camera
    }
    this.geoCache.set(key, geo);
    this.ownedGeos.push(geo);
    return geo;
  },

  /** Build the view group of a freshly spawned pan (§C9.3 Form station). */
  makeCakeView(cake) {
    const group = new THREE.Group();
    const pan = new THREE.Mesh(this.layerGeo(cake.shape, 0.06, 0.6), this.panMat);
    pan.position.y = 0.03;
    group.add(pan);
    this.ctx.scene.add(group);
    const view = {
      group, pan, sponge: null, icing: null, toppings: null, candles: [],
      spongeMat: null, icingMat: null, returnFrom: null,
    };
    this.cakeViews.set(cake.id, view);
    return view;
  },

  /** Pop-in a component mesh on the §C9.3 'apply'/'bake' engine events. */
  applyComponentVisual(cake, view, station, value) {
    const pop = (obj) => {
      const target = obj.scale.x || 1;
      tween({
        from: 0.2, to: target, duration: 0.24, ease: easings.easeOutBack,
        onUpdate: (v) => obj.scale.setScalar(v),
      });
    };
    if (station === 'teig') {
      view.spongeMat = new THREE.MeshStandardMaterial({ color: SPONGE_HEX[value], roughness: 0.85 });
      this.ownedMats.push(view.spongeMat);
      view.sponge = new THREE.Mesh(this.layerGeo(cake.shape, 0.2, 0.56), view.spongeMat);
      view.sponge.position.y = 0.16;
      view.group.add(view.sponge);
      pop(view.sponge);
    } else if (station === 'guss') {
      view.icingMat = new THREE.MeshStandardMaterial({ color: ICING_HEX[value], roughness: 0.5 });
      this.ownedMats.push(view.icingMat);
      view.icing = new THREE.Mesh(this.layerGeo(cake.shape, 0.07, 0.6), view.icingMat);
      view.icing.position.y = 0.3;
      view.group.add(view.icing);
      pop(view.icing);
    } else if (station === 'deko') {
      view.toppings = new THREE.Group();
      const topY = view.icing ? 0.36 : 0.28;
      if (value === 'cherry') {
        const c = new THREE.Mesh(this.cherryGeo, this.cherryMat);
        c.position.y = 0.05;
        const stem = new THREE.Mesh(this.stemGeo, this.stemMat);
        stem.position.set(0.02, 0.13, 0);
        stem.rotation.z = -0.35;
        view.toppings.add(c, stem);
      } else if (value === 'sprinkles') {
        for (let i = 0; i < 6; i += 1) {
          const sp = new THREE.Mesh(this.sprinkleGeo, this.sprinkleMats[i % this.sprinkleMats.length]);
          const a = (i / 6) * Math.PI * 2 + 0.5;
          sp.position.set(Math.cos(a) * 0.14, 0.012, Math.sin(a) * 0.14);
          sp.rotation.y = a * 2.3;
          view.toppings.add(sp);
        }
      } else if (value === 'berries') {
        for (const dx of [-0.1, 0.1]) {
          const b = this.ctx.assets.getModel('food-kit/strawberry');
          const box = new THREE.Box3().setFromObject(b);
          const size = box.getSize(new THREE.Vector3());
          b.scale.setScalar(0.12 / Math.max(size.x, size.y, size.z, 0.001));
          b.position.set(dx, 0.005, 0.02 * (dx > 0 ? -1 : 1));
          view.toppings.add(b);
        }
      }
      view.toppings.position.y = topY;
      view.group.add(view.toppings);
      pop(view.toppings);
    } else if (station === 'kerzen') {
      const i = view.candles.length;
      const holder = new THREE.Group();
      const stick = new THREE.Mesh(this.candleGeo, this.candleMat);
      stick.position.y = 0.06;
      const flame = new THREE.Sprite(this.flameMat);
      flame.scale.setScalar(0.09);
      flame.position.y = 0.15;
      holder.add(stick, flame);
      const a = (i / CAKE.MAX_CANDLES) * Math.PI * 2 + 0.8;
      const baseY = view.icing ? 0.34 : view.sponge ? 0.26 : 0.06;
      holder.position.set(Math.cos(a) * 0.16, baseY, Math.sin(a) * 0.16);
      view.group.add(holder);
      view.candles.push(holder);
      pop(holder);
    }
  },

  /** Bake tint (§C9.3): pale keeps the raw hue, perfect goldens, singed chars. */
  applyBakeVisual(view, result) {
    if (!view.spongeMat) return;
    const c = view.spongeMat.color;
    if (result === 'perfect') c.lerp(new THREE.Color('#C88A3F'), 0.42);
    if (result === 'singed') c.lerp(new THREE.Color('#2E2018'), 0.68);
  },

  syncFormPreview() {
    const shape = this.engine.state.nextShape;
    if (shape === this.previewShape) return;
    this.previewShape = shape;
    for (const child of [...this.formPreview.children]) this.formPreview.remove(child);
    if (!this.ghostMat) {
      this.ghostMat = new THREE.MeshStandardMaterial({
        color: '#FFF3DC', transparent: true, opacity: 0.75, roughness: 0.6,
      });
      this.ownedMats.push(this.ghostMat);
    }
    const mesh = new THREE.Mesh(this.layerGeo(shape, 0.07, 0.6), this.ghostMat);
    this.formPreview.add(mesh);
    if (this.formBtnIcon) this.formBtnIcon.textContent = SHAPE_GLYPH[shape];
  },

  // ----------------------------------------------------------------- DOM UI
  uiRoot() {
    return document.getElementById('ui') ?? document.body;
  },

  buildTicketsDom() {
    this.ticketsEl = document.createElement('div');
    this.ticketsEl.className = 'g36-tickets';
    this.uiRoot().appendChild(this.ticketsEl);
    /** @type {Map<number, {el: HTMLElement, fill: HTMLElement}>} */
    this.ticketEls = new Map();
  },

  syncTicketsDom() {
    const tickets = this.engine.state.tickets;
    const seen = new Set();
    for (const tk of tickets) {
      seen.add(tk.id);
      let entry = this.ticketEls.get(tk.id);
      if (!entry) {
        const el = document.createElement('div');
        el.className = 'g36-ticket';
        el.innerHTML = `${ticketSvg(tk.spec)}<div class="g36-tk-bar"><div class="g36-tk-fill"></div></div>`;
        this.ticketsEl.appendChild(el);
        entry = { el, fill: el.querySelector('.g36-tk-fill') };
        this.ticketEls.set(tk.id, entry);
        requestAnimationFrame(() => el.classList.add('g36-in'));
      }
      const frac = Math.max(0, tk.remain / tk.patience);
      entry.fill.style.width = `${(frac * 100).toFixed(1)}%`;
      entry.fill.style.background =
        frac > 0.5 ? '#7CC15E' : frac > 0.25 ? '#F5A623' : '#D64545';
    }
    for (const [id, entry] of this.ticketEls) {
      if (!seen.has(id)) {
        entry.el.remove();
        this.ticketEls.delete(id);
      }
    }
  },

  buildControlsDom() {
    const bar = document.createElement('div');
    bar.className = 'g36-controls';
    this.controlsEl = bar;
    /** @type {Record<string, HTMLElement>} station id → group el */
    this.groupEls = {};
    /** group builder: label + pictogram buttons */
    const group = (station, labelKey, buttons) => {
      const el = document.createElement('div');
      el.className = 'g36-group';
      el.dataset.station = station;
      const label = document.createElement('div');
      label.className = 'g36-group-label';
      label.textContent = t(labelKey);
      const row = document.createElement('div');
      row.className = 'g36-group-row';
      for (const b of buttons) row.appendChild(b);
      el.append(label, row);
      bar.appendChild(el);
      this.groupEls[station] = el;
      return el;
    };
    const btn = (html, aria, onTap) => {
      const b = document.createElement('button');
      b.className = 'g36-btn';
      b.innerHTML = html;
      b.setAttribute('aria-label', aria);
      b.title = aria;
      b.addEventListener('click', () => onTap());
      return b;
    };

    // Form — cycles the next pan's shape (§C9.3 "BEFORE spawn")
    const formBtn = btn(
      `<span class="g36-shape-glyph">${SHAPE_GLYPH[this.engine.state.nextShape]}</span>`,
      t('mg.cake.st.form'),
      () => this.tap('form')
    );
    this.formBtnIcon = formBtn.querySelector('.g36-shape-glyph');
    group('form', 'mg.cake.st.form', [formBtn]);

    group('teig', 'mg.cake.st.teig', SPONGES.map((sp) =>
      btn(buttonSvg('sponge', SPONGE_HEX[sp]), t(`mg.cake.sponge.${sp}`), () => this.tap('teig', sp))));

    const ofenBtn = btn(buttonSvg('oven'), t('mg.cake.st.ofen'), () => this.tap('ofen'));
    const ofenGroup = group('ofen', 'mg.cake.st.ofen', [ofenBtn]);
    const meter = document.createElement('div');
    meter.className = 'g36-meter';
    meter.innerHTML = '<div class="g36-meter-green"></div><div class="g36-meter-fill"></div>';
    ofenGroup.appendChild(meter);
    this.ovenFillEl = meter.querySelector('.g36-meter-fill');

    group('guss', 'mg.cake.st.guss', ICINGS.filter((i) => i !== 'none').map((ic) =>
      btn(buttonSvg('icing', ICING_HEX[ic]), t(`mg.cake.icing.${ic}`), () => this.tap('guss', ic))));

    group('deko', 'mg.cake.st.deko', TOPPINGS.filter((tp) => tp !== 'none').map((tp) =>
      btn(buttonSvg(tp), t(`mg.cake.top.${tp}`), () => this.tap('deko', tp))));

    group('kerzen', 'mg.cake.st.kerzen', [
      btn(buttonSvg('candle'), t('mg.cake.st.kerzen'), () => this.tap('kerzen')),
    ]);

    this.uiRoot().appendChild(bar);
  },

  /** Player tap → engine (guarded while paused/ended — DOM stays clickable). */
  tap(station, value) {
    if (this.phase !== 'play' || this.paused || !this.engine) return;
    const r = this.engine.tapStation(station, value);
    if (station === 'form' && r.ok) {
      this.ctx.audio.play('ui.tap');
      this.syncFormPreview();
    }
    // feedback for apply/bake taps rides the engine events in processEvents
  },

  /** Dim/undim station groups by live window occupancy (readability aid). */
  syncControlStates() {
    const cakes = this.engine.state.cakes;
    const windowHas = (st) =>
      cakes.some((c) => !c.returning && !c.inOven && inStationWindow(c.s, STATION_S[st]));
    const on = {
      form: true,
      teig: cakes.some((c) => !c.returning && !c.inOven && c.sponge == null && inStationWindow(c.s, STATION_S.teig)),
      ofen: cakes.some((c) => c.inOven),
      guss: windowHas('guss'),
      deko: windowHas('deko'),
      kerzen: windowHas('kerzen'),
    };
    for (const [st, el] of Object.entries(this.groupEls)) {
      el.classList.toggle('g36-on', !!on[st]);
    }
    // oven meter fill + 3D glow (green zone = last 25 % — §C9.3)
    const baking = cakes.find((c) => c.inOven);
    const frac = baking ? Math.min(1, baking.ovenT / CAKE.OVEN_METER_SEC) : 0;
    this.ovenFillEl.style.width = `${(frac * 100).toFixed(1)}%`;
    this.ovenFillEl.style.background = frac >= 1 - CAKE.OVEN_GREEN_FRAC ? '#5CB85C' : '#F2762E';
    this.ovenGlow.material.opacity = baking ? 0.25 + frac * 0.55 : 0;
    for (const [st, marker] of Object.entries(this.stationMarkers)) {
      marker.mat.emissiveIntensity = on[st] ? 0.55 : 0.12;
    }
  },

  // -------------------------------------------------------------- NPC layer
  /** Grant the single animation token (§C9.7 cap) or queue for it. */
  requestAnim(npc) {
    if (this.animOwner == null) {
      this.animOwner = npc;
      return true;
    }
    if (this.animOwner !== npc && !this.animQueue.includes(npc)) this.animQueue.push(npc);
    return this.animOwner === npc;
  },

  releaseAnim(npc) {
    if (this.animOwner === npc) this.animOwner = null;
    else {
      const i = this.animQueue.indexOf(npc);
      if (i >= 0) this.animQueue.splice(i, 1);
    }
    while (this.animOwner == null && this.animQueue.length > 0) {
      const next = this.animQueue.shift();
      if (next && this.npcAlive(next)) this.animOwner = next;
    }
  },

  npcAlive(npc) {
    for (const n of this.npcs.values()) if (n === npc) return true;
    return this.exitingNpcs?.includes(npc) ?? false;
  },

  /** Play a clip exclusively on this npc's mixer. */
  npcPlay(npc, name, { loop = true, timeScale = 1 } = {}) {
    const action = npc.actions[name];
    if (!action) return null;
    npc.mixer.stopAllAction();
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = timeScale;
    action.play();
    return action;
  },

  spawnNpc(ticketId) {
    const seatIdx = this.seatTaken.indexOf(false);
    const key = CHAR_KEYS[this.npcCharIdx % CHAR_KEYS.length];
    this.npcCharIdx += 1;
    const model = this.ctx.assets.getSkinnedModel(key);
    model.scale.setScalar(NPC.SCALE);
    model.position.set(NPC.DOOR.x, 0, NPC.DOOR.z);
    this.ctx.scene.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const clips = this.ctx.assets.getAnimations(key);
    const pick = (n) => clips.find((c) => c.name === n) ?? null;
    const actions = {};
    for (const [id, clipName] of Object.entries({
      walk: 'Walking_A', sit: 'Sit_Chair_Idle', cheer: 'Cheer', idle: 'Idle',
    })) {
      const clip = pick(clipName);
      if (clip) actions[id] = mixer.clipAction(clip);
    }
    const npc = {
      ticketId, seatIdx: seatIdx >= 0 ? seatIdx : 1, model, mixer, actions,
      state: 'waitEnter', t: 0,
    };
    if (seatIdx >= 0) this.seatTaken[seatIdx] = true;
    // frozen idle pose at the door until the walk token frees (§C9.7 cap)
    this.npcPlay(npc, 'idle');
    mixer.update(0.05);
    this.npcs.set(ticketId, npc);
    return npc;
  },

  /** Move npc toward (x, z); returns true when arrived. Faces the direction. */
  npcWalkTowards(npc, x, z, dt) {
    const p = npc.model.position;
    const dx = x - p.x;
    const dz = z - p.z;
    const dist = Math.hypot(dx, dz);
    const step = NPC.WALK_SPEED * dt;
    npc.model.rotation.y = Math.atan2(dx, dz);
    if (dist <= step) {
      p.set(x, 0, z);
      return true;
    }
    p.x += (dx / dist) * step;
    p.z += (dz / dist) * step;
    return false;
  },

  /** Resolve a seated customer: serve outcome or expiry → cheer/sad exit. */
  resolveNpc(ticketId, outcome) {
    const npc = this.npcs.get(ticketId);
    if (!npc) return;
    this.npcs.delete(ticketId);
    this.seatTaken[npc.seatIdx] = false;
    this.exitingNpcs = this.exitingNpcs ?? [];
    this.exitingNpcs.push(npc);
    npc.outcome = outcome;
    npc.state = outcome === 'perfect' || outcome === 'oneWrong' ? 'cheerWait' : 'sadWait';
    npc.t = 0;
  },

  /** V3/FIX-E P1-2 (E10): free a removed NPC's per-clone GPU/JS resources.
   * Every getSkinnedModel clone owns its OWN Skeleton (SkeletonUtils re-bind,
   * §B6) whose lazily-created 16×16 float boneTexture leaked on removal —
   * +6 GL textures per launch/quit, unbounded across a session. skeleton
   * .dispose() frees exactly that per-clone texture; geometries/materials
   * stay SHARED cache masters (isCachedResource) and are never touched.
   * uncacheRoot drops the mixer's cached actions/property bindings. */
  disposeNpcResources(npc) {
    npc.mixer.stopAllAction();
    npc.mixer.uncacheRoot(npc.model);
    npc.model.traverse((obj) => {
      if (obj.isSkinnedMesh && obj.skeleton) obj.skeleton.dispose();
    });
  },

  removeNpc(npc) {
    this.releaseAnim(npc);
    this.ctx.scene.remove(npc.model);
    this.disposeNpcResources(npc);
    const i = this.exitingNpcs?.indexOf(npc) ?? -1;
    if (i >= 0) this.exitingNpcs.splice(i, 1);
  },

  updateNpcs(dt) {
    const all = [...this.npcs.values(), ...(this.exitingNpcs ?? [])];
    for (const npc of all) {
      const seat = NPC.SEATS[npc.seatIdx];
      switch (npc.state) {
        case 'waitEnter':
          if (this.requestAnim(npc)) {
            npc.state = 'enter';
            this.npcPlay(npc, 'walk');
          }
          break;
        case 'enter':
          if (this.npcWalkTowards(npc, seat.x, seat.z, dt)) {
            npc.state = 'seated';
            npc.model.rotation.y = Math.PI; // face the bakery (−z)
            npc.model.position.y = Math.max(0, this.stoolTopY - 0.3);
            this.npcPlay(npc, 'sit');
            npc.mixer.update(0.4); // settle into the pose …
            this.releaseAnim(npc); // … then FREEZE (§C9.7 seated cap)
          }
          break;
        case 'seated':
          break; // frozen pose — mixer not advanced
        case 'cheerWait':
          if (this.requestAnim(npc)) {
            npc.state = 'cheer';
            npc.t = 0;
            this.npcPlay(npc, 'cheer', { loop: false });
          }
          break;
        case 'cheer':
          npc.t += dt;
          if (npc.t >= NPC.CHEER_SEC) {
            npc.state = 'exit';
            npc.model.position.y = 0;
            this.npcPlay(npc, 'walk');
          }
          break;
        case 'sadWait':
          if (this.requestAnim(npc)) {
            npc.state = 'exit';
            npc.model.position.y = 0;
            this.npcPlay(npc, 'walk', { timeScale: 0.75 }); // sad trudge out
          }
          break;
        case 'exit':
          if (this.npcWalkTowards(npc, NPC.DOOR.x, NPC.DOOR.z, dt)) {
            this.removeNpc(npc);
          }
          break;
        default:
          break;
      }
    }
    // §C9.7 hard cap: exactly ONE mixer advances per frame
    if (this.animOwner) this.animOwner.mixer.update(dt);
  },

  // ------------------------------------------------------------- event pump
  /** Drain engine events → sfx, banners, floats, NPC + counter wiring. */
  processEvents() {
    const ctx = this.ctx;
    const state = this.engine.state;
    for (const e of this.engine.drainEvents()) {
      switch (e.type) {
        case 'order': {
          ctx.audio.play('cake.order');
          ctx.hud.banner(t('mg.cake.newOrder'));
          this.spawnNpc(e.ticketId);
          break;
        }
        case 'spawn': {
          const cake = state.cakes.find((c) => c.id === e.cakeId);
          if (cake) this.makeCakeView(cake);
          this.syncFormPreview();
          break;
        }
        case 'apply': {
          const cake = state.cakes.find((c) => c.id === e.cakeId);
          const view = this.cakeViews.get(e.cakeId);
          if (cake && view) this.applyComponentVisual(cake, view, e.station, e.value);
          ctx.audio.play(e.station === 'kerzen' ? 'cake.candle' : 'cake.apply');
          break;
        }
        case 'ovenStart':
          break; // glow ramp rides syncControlStates
        case 'bake': {
          const view = this.cakeViews.get(e.cakeId);
          if (view) this.applyBakeVisual(view, e.result);
          if (e.result === 'perfect') {
            ctx.audio.play('cake.ovenDing');
            ctx.hud.banner(t('mg.cake.bakePerfect'));
            if (view) this.particles.emit('sparkles', view.group.position.clone(), { count: 8 });
            if (view) this.floats.spawn('+5', view.group.position.clone().add(new THREE.Vector3(0, 0.5, 0)), '#2E8B57');
          } else if (e.result === 'singed') {
            ctx.audio.play('ui.error');
            ctx.hud.banner(t('mg.cake.bakeSinged'));
            if (view) this.floats.spawn('−3', view.group.position.clone().add(new THREE.Vector3(0, 0.5, 0)), '#D64570');
          } else {
            ctx.audio.play('cake.ovenDing');
          }
          break;
        }
        case 'loop': {
          ctx.hud.banner(t('mg.cake.loop'));
          ctx.audio.play('ui.tap');
          const view = this.cakeViews.get(e.cakeId);
          if (view) view.returnFrom = view.group.position.clone();
          break;
        }
        case 'loopLand': {
          const view = this.cakeViews.get(e.cakeId);
          if (view) view.returnFrom = null;
          break;
        }
        case 'serve':
          this.onServeEvent(e);
          break;
        case 'expire': {
          ctx.audio.play('ui.error');
          ctx.hud.banner(t('mg.cake.expired'));
          this.resolveNpc(e.ticketId, 'expired');
          this.gooby.setEmotion('sad');
          this.emotionT = 1.2;
          break;
        }
        default:
          break;
      }
    }
    // belt ramp banner (§C9.4 +6 %/3 serves) — derived, engine stays lean
    const mult = beltSpeedMultAt(state.serves);
    if (mult > this.lastBeltMult) {
      this.lastBeltMult = mult;
      ctx.hud.banner(t('mg.cake.speedUp'));
    }
  },

  onServeEvent(e) {
    const ctx = this.ctx;
    const view = this.cakeViews.get(e.cakeId);
    const servePos = beltPoint(CAKE.BELT_LENGTH_M).add(new THREE.Vector3(0, 0.2, 0));
    if (e.outcome === 'rejected') {
      ctx.audio.play('cake.splat');
      ctx.hud.banner(t('mg.cake.rejected'));
      this.particles.emit('dizzyStars', servePos, { count: 8 });
      this.gooby.setEmotion('sad');
      this.gooby.play('sadSlump'); // §C9.4 Gooby facepalm beat
      this.emotionT = 1.6;
      if (view) {
        // splat: squash flat, then drop out
        const group = view.group;
        tween({
          from: 1, to: 0.12, duration: 0.3, ease: easings.easeOutQuad,
          onUpdate: (v) => group.scale.set(2 - v, v, 2 - v),
          onComplete: () => this.destroyCakeView(e.cakeId),
        });
      }
    } else {
      ctx.audio.play('cake.serve');
      ctx.hud.banner(t(e.outcome === 'perfect' ? 'mg.cake.perfect' : 'mg.cake.oneWrong', { pts: e.points }));
      if (e.outcome === 'perfect') {
        this.particles.emit('confetti', servePos, { count: 12 });
        this.gooby.setEmotion('ecstatic');
        this.gooby.play('happyBounce');
        this.emotionT = 1.6;
      }
      if (view) {
        // the finished cake flies to the customer counter
        const group = view.group;
        const from = group.position.clone();
        const npcSeat = NPC.SEATS[this.npcs.get(e.ticketId)?.seatIdx ?? 1];
        const to = new THREE.Vector3(npcSeat.x, 0.85, npcSeat.z - 0.3);
        tween({
          from: 0, to: 1, duration: 0.5, ease: easings.easeInOutQuad,
          onUpdate: (v) => {
            group.position.lerpVectors(from, to, v);
            group.position.y += Math.sin(v * Math.PI) * 0.7;
          },
          onComplete: () => this.destroyCakeView(e.cakeId),
        });
      }
    }
    this.floats.spawn(
      e.points >= 0 ? `+${e.points}` : `−${Math.abs(e.points)}`,
      servePos.clone().add(new THREE.Vector3(0.2, 0.35, 0)),
      e.points >= 0 ? '#2E8B57' : '#D64570'
    );
    this.resolveNpc(e.ticketId, e.outcome);
    // §C9.5 meta counters ride the shared plumbing (stickerBook watches
    // counters.perfectCakes → cakeBoss on the FIRST perfect serve).
    try {
      const engine = getAchievementsEngine();
      engine?.track?.('cakesServed', 1);
      if (e.outcome === 'perfect') engine?.track?.('perfectCakes', 1);
    } catch (err) {
      console.warn('[purblePlace] counter tracking failed:', err);
    }
  },

  destroyCakeView(cakeId) {
    const view = this.cakeViews.get(cakeId);
    if (!view) return;
    view.group.parent?.remove(view.group);
    this.cakeViews.delete(cakeId);
  },

  /** Position cake groups from engine belt-space (+ fix-loop return flight). */
  syncCakeViews(dt) {
    const state = this.engine.state;
    const alive = new Set();
    for (const cake of state.cakes) {
      alive.add(cake.id);
      const view = this.cakeViews.get(cake.id) ?? this.makeCakeView(cake);
      if (cake.returning) {
        // arc back to the spawn point during the LOOP_RETURN window
        const f = 1 - Math.max(0, cake.returnT) / CAKE.LOOP_RETURN_SEC;
        const from = view.returnFrom ?? beltPoint(CAKE.BELT_LENGTH_M);
        const to = beltPoint(0);
        view.group.position.lerpVectors(from, to, f);
        view.group.position.y += Math.sin(f * Math.PI) * 0.9;
        view.group.rotation.y += dt * 6;
      } else {
        beltPoint(cake.s, view.group.position);
        view.group.rotation.y = Math.max(0, view.group.rotation.y - dt * 8);
        if (cake.inOven) {
          view.group.position.z -= 0.22; // nudged into the oven mouth
        }
      }
    }
    // views whose engine cake vanished by non-serve paths (safety)
    for (const id of [...this.cakeViews.keys()]) {
      if (!alive.has(id) && !this.cakeViews.get(id).dying) {
        const view = this.cakeViews.get(id);
        view.dying = true;
        setTimeout(() => this.destroyCakeView(id), 700);
      }
    }
  },

  // ---------------------------------------------------------------- update
  onPause() {
    this.paused = true;
  },

  onResume() {
    this.paused = false;
  },

  update(dt, elapsed) {
    const ctx = this.ctx;
    this.gooby.update(dt);
    this.particles.update(dt);
    this.floats.update(dt);

    if (this.phase === 'ending') {
      this.updateNpcs(dt);
      this.endT += dt;
      if (this.endT >= 1.5 && this.phase !== 'done') {
        this.phase = 'done';
        const s = this.engine.state;
        ctx.onEnd({
          score: s.score,
          meta: { cakesServed: s.cakesServed, perfectCakes: s.perfectCakes, rejected: s.rejected },
        });
      }
      return;
    }

    const remaining = CAKE.DURATION_SEC - elapsed;
    ctx.hud.setTime(remaining);

    // Gooby emotion decay back to happy
    if (this.emotionT != null && this.emotionT > 0) {
      this.emotionT -= dt;
      if (this.emotionT <= 0) this.gooby.setEmotion('happy');
    }

    // §C9.7 autoplay bot — the SAME scheduler the logic tests certify
    if (this.autoplay && this.bot) {
      for (const tp of this.bot.plan(this.engine, dt)) {
        this.engine.tapStation(tp.station, tp.value);
      }
      this.syncFormPreview();
    }

    this.engine.step(dt);
    this.processEvents();

    // score mirror → framework HUD (engine clamps at 0 — forward deltas)
    const scoreNow = this.engine.state.score;
    if (scoreNow !== this.reportedScore) {
      ctx.onScore(scoreNow - this.reportedScore);
      this.reportedScore = scoreNow;
    }

    this.syncCakeViews(dt);
    this.syncTicketsDom();
    this.syncControlStates();
    this.updateNpcs(dt);

    // belt stripe scroll (both tiers share the texture)
    this.beltTex.offset.x -= beltSpeedAt(this.engine.state.serves) * dt * 1.9;
    // Gooby watches the most advanced live cake
    let watch = null;
    for (const cake of this.engine.state.cakes) {
      if (!cake.returning && (watch == null || cake.s > watch.s)) watch = cake;
    }
    if (watch) {
      const p = beltPoint(watch.s);
      this.gooby.lookAt(new THREE.Vector3(p.x, p.y + 0.4, p.z));
    } else {
      this.gooby.lookAt(null);
    }

    if (import.meta.env?.DEV) {
      this.maxDrawCalls = Math.max(this.maxDrawCalls, ctx.renderer?.info?.render?.calls ?? 0);
    }

    if (remaining <= 0) {
      this.phase = 'ending';
      ctx.audio.play('ui.win');
      this.gooby.setEmotion('ecstatic');
      this.gooby.play('happyBounce');
      this.particles.emit('confetti', this.gooby.group.position.clone().add(new THREE.Vector3(0, 1.3, 0)), { count: 16 });
      if (this.autoplay) {
        const s = this.engine.state;
        console.log(
          `[purblePlace] autoplay run ended — score ${s.score}, served ${s.cakesServed}, ` +
          `perfect ${s.perfectCakes}, rejected ${s.rejected}, expired ${s.expired}, ` +
          `maxDrawCalls ${this.maxDrawCalls}`
        );
      }
    }
  },

  // --------------------------------------------------------------- dispose
  dispose() {
    this.ticketsEl?.remove();
    this.controlsEl?.remove();
    this.ticketEls?.clear();
    for (const npc of [...(this.npcs?.values() ?? []), ...(this.exitingNpcs ?? [])]) {
      this.ctx?.scene?.remove(npc.model);
      this.disposeNpcResources(npc); // V3/FIX-E P1-2: free skeleton boneTextures
    }
    this.npcs?.clear();
    this.exitingNpcs = [];
    this.animOwner = null;
    this.animQueue = [];
    this.floats?.dispose();
    this.particles?.dispose();
    this.gooby?.dispose();
    for (const geo of this.ownedGeos ?? []) geo.dispose();
    for (const mat of this.ownedMats ?? []) mat.dispose();
    for (const tex of this.ownedTexs ?? []) tex.dispose();
    this.ownedGeos = [];
    this.ownedMats = [];
    this.ownedTexs = [];
    this.geoCache?.clear();
    this.cakeViews?.clear();
    if (import.meta.env?.DEV && window.__purble?.game === this) delete window.__purble;
    this.engine = null;
    this.bot = null;
    this.ctx = null;
    this.gooby = null;
    this.particles = null;
    this.floats = null;
  },
};
export const controls = Object.freeze({ invertible: false }); // V4/G57 (§G2.1 rule 4, §G3.3): positional/tap/semantic input — inverting is nonsense here
