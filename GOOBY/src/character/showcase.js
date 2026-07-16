// Gooby showcase (§E9 `?scene=gooby`, §G G3 acceptance surface): Gooby on a
// pastel stage with DOM buttons for every emotion (§D2.5), every clip (§D2.4),
// the wet/stink/drool state toggles and particle demos, plus tap-region
// logging (§D2.2 raycast regions). Loaded dynamically by dev/harness.js which
// expects `createShowcaseScene(ctx)` returning the §E1 lifecycle object.

import * as THREE from 'three';
import { t } from '../data/strings.js';
import { ROOMS, UI_COLORS } from '../data/constants.js';
import { createGooby } from './gooby.js';
import { EMOTION_IDS } from './emotions.js';
import { CLIP_IDS } from './goobyAnims.js';
import { createParticles, PARTICLE_TYPES } from '../gfx/particles.js';

const PANEL_CSS = `
.gooby-showcase{position:absolute;inset:0;pointer-events:none;display:flex;flex-direction:column;justify-content:flex-end;font-family:system-ui,sans-serif;}
.gs-status{pointer-events:none;position:absolute;top:calc(8px + env(safe-area-inset-top));left:10px;right:10px;color:#4A3B36;font-size:12px;font-weight:700;text-shadow:0 1px 0 #fff;}
.gs-status .gs-tap{color:#B0567A;}
.gs-panel{pointer-events:auto;max-height:44%;overflow-y:auto;background:rgba(255,255,255,.92);border-radius:20px 20px 0 0;padding:10px 12px calc(10px + env(safe-area-inset-bottom));box-shadow:0 -6px 24px rgba(74,59,54,.18);}
.gs-section{margin-bottom:8px;}
.gs-section h4{margin:2px 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#B79E92;}
.gs-row{display:flex;flex-wrap:wrap;gap:6px;}
.gs-btn{border:none;border-radius:14px;background:#FFF6EC;color:#4A3B36;font-weight:800;font-size:13px;padding:9px 12px;border-bottom:3px solid #EBD9C8;cursor:pointer;}
.gs-btn:active{transform:scale(.96);}
.gs-btn.on{background:#FF7BA9;border-bottom-color:#D95E8B;color:#fff;}
.gs-btn.gs-teal.on{background:#59C9B9;border-bottom-color:#3EA495;}
`;

/**
 * §E1 scene factory for the Gooby showcase.
 * @param {{renderer: THREE.WebGLRenderer, input: object, ui: object}} ctx
 */
export function createShowcaseScene(ctx) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(UI_COLORS.BG_CREAM);

  // Framed so Gooby sits fully above the bottom control panel (~44% height).
  const camera = new THREE.PerspectiveCamera(ROOMS.CAMERA_FOV, innerWidth / innerHeight, 0.1, 50);
  camera.position.set(0, 0.95, 2.75);
  camera.lookAt(0, -0.05, 0);

  scene.add(new THREE.HemisphereLight(0xfff8ee, 0xd8c8be, 1.25));
  const dir = new THREE.DirectionalLight(0xfff2dd, 1.05);
  dir.position.set(2, 4, 3);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xffe4ee, 0.4);
  fill.position.set(-2.5, 1.5, -2);
  scene.add(fill);

  // --- pastel stage ---
  const ownedGeos = [];
  const ownedMats = [];
  function stageMesh(geo, color, rough = 0.75) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: rough });
    ownedGeos.push(geo);
    ownedMats.push(mat);
    return new THREE.Mesh(geo, mat);
  }
  const stage = stageMesh(new THREE.CylinderGeometry(1.15, 1.3, 0.16, 48), UI_COLORS.PRIMARY_PINK);
  stage.position.y = -0.08;
  scene.add(stage);
  const ring = stageMesh(new THREE.TorusGeometry(1.5, 0.05, 10, 56), UI_COLORS.TEAL);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.05;
  scene.add(ring);
  // unlit pastel backdrop so it stays bright behind the stage
  const backGeo = new THREE.CircleGeometry(2.8, 40);
  const backMat = new THREE.MeshBasicMaterial({ color: 0xffeef4 });
  ownedGeos.push(backGeo);
  ownedMats.push(backMat);
  const back = new THREE.Mesh(backGeo, backMat);
  back.position.set(0, 1.1, -1.8);
  scene.add(back);

  // --- Gooby + particles ---
  const particles = createParticles(scene);
  const gooby = createGooby({ particles });
  scene.add(gooby.group);

  // -------------------------------------------------------------------------
  // DOM control panel
  // -------------------------------------------------------------------------
  /** @type {HTMLElement|null} */
  let rootEl = null;
  /** @type {HTMLStyleElement|null} */
  let styleEl = null;
  /** @type {HTMLElement|null} */
  let statusEl = null;
  /** @type {HTMLElement|null} */
  let tapEl = null;
  /** @type {Map<string, HTMLButtonElement>} */
  const emotionBtns = new Map();
  /** @type {Map<string, HTMLButtonElement>} */
  const clipBtns = new Map();

  let lookTimer = 0;
  let trisLogged = false;
  /** @type {string|null} URL-driven particle demo (re-emits continuously) */
  let fxDemo = null;
  let fxTimer = 0;

  function refreshButtons() {
    for (const [id, btn] of emotionBtns) btn.classList.toggle('on', gooby.emotion() === id);
    for (const [id, btn] of clipBtns) btn.classList.toggle('on', gooby.isPlaying(id));
  }

  function section(parent, titleKey) {
    const sec = document.createElement('div');
    sec.className = 'gs-section';
    const h = document.createElement('h4');
    h.textContent = t(titleKey);
    sec.appendChild(h);
    const row = document.createElement('div');
    row.className = 'gs-row';
    sec.appendChild(row);
    parent.appendChild(sec);
    return row;
  }

  function button(row, label, onClick, extraClass = '') {
    const btn = document.createElement('button');
    btn.className = `gs-btn ${extraClass}`.trim();
    btn.textContent = label;
    btn.addEventListener('click', () => {
      onClick(btn);
      refreshButtons();
    });
    row.appendChild(btn);
    return btn;
  }

  function buildPanel() {
    styleEl = document.createElement('style');
    styleEl.textContent = PANEL_CSS;
    document.head.appendChild(styleEl);

    rootEl = document.createElement('div');
    rootEl.className = 'gooby-showcase';

    statusEl = document.createElement('div');
    statusEl.className = 'gs-status';
    statusEl.textContent = t('gooby.showcase.tapHint');
    tapEl = document.createElement('div');
    tapEl.className = 'gs-tap';
    statusEl.appendChild(tapEl);
    rootEl.appendChild(statusEl);

    const panel = document.createElement('div');
    panel.className = 'gs-panel';
    rootEl.appendChild(panel);

    const emoRow = section(panel, 'gooby.showcase.emotions');
    for (const id of EMOTION_IDS) {
      emotionBtns.set(id, button(emoRow, t(`gooby.emotion.${id}`), () => gooby.setEmotion(id)));
    }

    const clipRow = section(panel, 'gooby.showcase.clips');
    for (const id of CLIP_IDS) {
      clipBtns.set(id, button(clipRow, t(`gooby.clip.${id}`), () => {
        if (gooby.isPlaying(id)) {
          gooby.stop(id);
        } else {
          const opts = id === 'pokeWobble' ? { dir: { x: Math.random() * 2 - 1, z: 1 } } : {};
          gooby.play(id, opts).then(refreshButtons);
        }
      }));
    }

    const toggleRow = section(panel, 'gooby.showcase.toggles');
    const toggles = { wet: gooby.setWet, stink: gooby.setStink, drool: gooby.setDrool };
    for (const [id, setter] of Object.entries(toggles)) {
      let on = false;
      button(toggleRow, t(`gooby.toggle.${id}`), (btn) => {
        on = !on;
        setter(on);
        btn.classList.toggle('on', on);
      }, 'gs-teal');
    }

    const partRow = section(panel, 'gooby.showcase.particles');
    for (const type of PARTICLE_TYPES) {
      button(partRow, t(`gooby.particle.${type}`), () => {
        particles.emit(type, { x: 0, y: 0.75, z: 0.35 });
      }, 'gs-teal');
    }

    ctx.ui.el.appendChild(rootEl);
    refreshButtons();
  }

  // --- tap-region logging + look/poke reactions ---
  function onTap(p) {
    const hit = ctx.input.pick(camera, [gooby.group], p);
    const region = hit ? gooby.regionAt(hit) : null;
    console.log('[showcase] tap region:', region, hit?.object?.name ?? '(miss)');
    if (tapEl) tapEl.textContent = t('gooby.showcase.tap', { region: t(`gooby.region.${region ?? 'none'}`) });
    if (hit) {
      gooby.lookAt(hit.point);
      lookTimer = 2;
      const dx = hit.point.x - gooby.group.position.x;
      gooby.play('pokeWobble', { dir: { x: dx * 4, z: 1 } });
    }
  }

  return {
    scene,
    camera,

    enter() {
      buildPanel();
      ctx.input.on('tap', onTap);
      gooby.play('idle');
      // Dev-only deep links for headless screenshots / eval agents (§E9):
      // ?scene=gooby&emotion=<id>&clip=<id>&fx=<particleType>&wet=1&stink=1&drool=1
      const q = new URLSearchParams(location.search);
      const emotion = q.get('emotion');
      if (emotion && EMOTION_IDS.includes(emotion)) gooby.setEmotion(emotion);
      const clip = q.get('clip');
      if (clip && CLIP_IDS.includes(clip)) {
        gooby.play(clip, clip === 'pokeWobble' ? { dir: { x: 1, z: 1 } } : {});
      }
      fxDemo = q.get('fx');
      if (q.get('wet') === '1') gooby.setWet(true);
      if (q.get('stink') === '1') gooby.setStink(true);
      if (q.get('drool') === '1') gooby.setDrool(true);
      if (q.get('zoom') === '1') {
        camera.position.set(0, 0.66, 1.4); // face close-up (dev screenshots)
        camera.lookAt(0, 0.52, 0);
      }
      refreshButtons();
    },

    update(dt) {
      gooby.update(dt);
      particles.update(dt);
      if (fxDemo && PARTICLE_TYPES.includes(fxDemo)) {
        fxTimer -= dt;
        if (fxTimer <= 0) {
          fxTimer = 0.5;
          particles.emit(fxDemo, { x: 0, y: 0.55, z: 0.4 });
        }
      }
      if (lookTimer > 0) {
        lookTimer -= dt;
        if (lookTimer <= 0) gooby.lookAt(null);
      }
      refreshButtons();
      // triangle budget check (§D2.2 ≤ 6k): logged once after the first render
      if (!trisLogged && ctx.renderer.info.render.triangles > 0) {
        trisLogged = true;
        const own = gooby.triangleCount();
        const total = ctx.renderer.info.render.triangles;
        console.log(`[showcase] gooby triangles: ${own} (scene total: ${total})`);
        if (statusEl) {
          statusEl.firstChild.textContent = t('gooby.showcase.tris', { count: own, total });
        }
      }
    },

    exit() {
      rootEl?.remove();
      styleEl?.remove();
      rootEl = styleEl = statusEl = tapEl = null;
      emotionBtns.clear();
      clipBtns.clear();
    },

    dispose() {
      gooby.dispose();
      particles.dispose();
      for (const geo of ownedGeos) geo.dispose();
      for (const mat of ownedMats) mat.dispose();
    },
  };
}
