// Character select screen (R9) — 16-monkey grid from catalogs.roster (§6)
// plus a LIVE 3D preview of the selected monkey wearing the equipped hat/skin
// (same monkeyFactory rig + applyCosmetics path the match uses) and equip
// controls for every owned cosmetic. Equips are server-authoritative:
// clicking a chip sends equipCosmetic and the UI re-renders from the fresh
// `profile` frame.

import * as THREE from 'three';
import { MSG } from '@shared/protocol.js';
import { el, clear } from './dom.js';
import { portraitCanvas } from './portraits.js';
import { createMonkey } from '../three/monkeyFactory.js';
import {
  SLOT_IDS,
  SLOT_META,
  getCosmeticsBySlot,
  isOwned,
  isEquipped,
  injectCosmeticsStyles,
} from './cosmetics.js';

const MONKEY_KEY = 'mb_monkey';

// ---------------------------------------------------------------------------
// Live 3D preview — its own tiny renderer so the menu screen can show the
// exact in-match rig (createMonkey + applyCosmetics) without touching the
// main engine scene.
// ---------------------------------------------------------------------------

function createMonkeyPreview() {
  const canvas = el('canvas', { className: 'r9-preview' });
  /** @type {THREE.WebGLRenderer|null} */
  let renderer = null;
  let scene = null;
  let camera = null;
  /** @type {ReturnType<typeof createMonkey>|null} */
  let monkey = null;
  let raf = 0;
  let running = false;

  function ensureRenderer() {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return false; // WebGL unavailable — the 2D portraits still cover selection
    }
    renderer.setPixelRatio(1);
    renderer.setSize(250, 240, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 250 / 240, 0.05, 10);
    camera.position.set(0, 0.52, 1.18);
    camera.lookAt(0, 0.36, 0);

    scene.add(new THREE.HemisphereLight('#fff3d9', '#1a2e16', 1.1));
    const key = new THREE.DirectionalLight('#ffe9c4', 2.2);
    key.position.set(0.8, 1.4, 1.2);
    scene.add(key);
    const rim = new THREE.PointLight('#39ff88', 1.6, 4);
    rim.position.set(-0.9, 0.7, -0.8);
    scene.add(rim);
    const stage = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.46, 0.05, 28),
      new THREE.MeshStandardMaterial({ color: '#241a2e', roughness: 0.6, metalness: 0.2 })
    );
    stage.position.y = -0.025;
    scene.add(stage);
    return true;
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (monkey) monkey.root.rotation.y = Math.sin(performance.now() / 1400) * 0.55;
    renderer.render(scene, camera);
  }

  return {
    el: canvas,
    /** Rebuild the preview monkey (selection or equipped hat/skin changed). */
    show(monkeyId, cosmetics) {
      if (!ensureRenderer()) return;
      if (monkey) {
        monkey.dispose();
        monkey = null;
      }
      monkey = createMonkey(monkeyId);
      monkey.applyCosmetics?.({ hat: cosmetics?.hat, skin: cosmetics?.skin });
      scene.add(monkey.root);
      if (!running) {
        running = true;
        loop();
      }
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/**
 * @param {{store, socket, toast, go, back}} ctx
 * @returns {{el: HTMLElement, onShow: () => void, onHide: () => void}}
 */
export function createCharacterSelect(ctx) {
  const { store, socket, toast, back } = ctx;
  injectCosmeticsStyles();

  const gridEl = el('div', { className: 'monkey-grid' });
  const equipRowsEl = el('div', { className: 'r9-equip-rows' });
  const preview = createMonkeyPreview();
  let visible = false;

  function select(monkey) {
    const profile = store.get('profile');
    store.set('profile', { ...profile, monkeyId: monkey.id });
    try {
      localStorage.setItem(MONKEY_KEY, monkey.id);
    } catch {
      /* storage blocked */
    }
    // setProfile works both in the menus and in a lobby (§3.2) — selectMonkey
    // is room-only and used to error with a toast when picked from the menu.
    if (socket.isOpen()) socket.send(MSG.SET_PROFILE, { monkeyId: monkey.id });
    toast(`You are now ${monkey.name} 🐒`);
    renderGrid();
    renderPreview();
  }

  function renderGrid() {
    clear(gridEl);
    const roster = store.get('catalogs').roster;
    const selectedId = store.get('profile').monkeyId;
    for (const monkey of roster) {
      gridEl.append(
        el(
          'div',
          {
            className: `monkey-card ${monkey.id === selectedId ? 'selected' : ''}`,
            onClick: () => select(monkey),
          },
          [
            portraitCanvas(monkey, 84),
            el('div', { className: 'mc-name', text: monkey.name }),
            el('div', { className: 'mc-passive' }, [
              el('b', { text: monkey.passive?.name ?? '' }),
              el('span', { text: monkey.passive?.desc ?? '' }),
            ]),
          ]
        )
      );
    }
  }

  function renderPreview() {
    if (!visible) return;
    const profile = store.get('profile');
    preview.show(profile.monkeyId, profile.equipped ?? {});
  }

  // ---- equip controls: one row per slot, chips for every OWNED item ----
  function renderEquipRows() {
    clear(equipRowsEl);
    const profile = store.get('profile') ?? {};
    for (const slot of SLOT_IDS) {
      const meta = SLOT_META[slot];
      const owned = getCosmeticsBySlot(slot).filter((item) => isOwned(profile, item.id));
      const chips = el('div', { className: 'chips' });
      if (!owned.length) {
        chips.append(el('span', { className: 'r9-equip-none', text: 'nothing owned — visit the Shop' }));
      }
      for (const item of owned) {
        const on = isEquipped(profile, item);
        chips.append(
          el(
            'button',
            {
              className: `r9-equip-chip ${on ? 'on' : ''}`,
              type: 'button',
              title: on ? `${item.desc} (click to unequip)` : item.desc,
              // server-authoritative: send equipCosmetic {slot, itemId|null},
              // the fresh `profile` frame re-renders chips + preview
              onClick: () => socket.send(MSG.EQUIP_COSMETIC, { slot, itemId: on ? null : item.id }),
            },
            [el('span', { text: item.glyph }), el('span', { text: item.name }), on ? el('span', { text: '✔' }) : null]
          )
        );
      }
      equipRowsEl.append(
        el('div', { className: 'r9-equip-row' }, [
          el('div', { className: 'r9-er-label', text: `${meta.glyph} ${meta.label}` }),
          chips,
        ])
      );
    }
  }

  store.on('catalogs', () => {
    renderGrid();
    renderPreview();
  });
  store.on('profile', () => {
    if (!visible) return;
    renderEquipRows();
    renderPreview();
  });

  const screen = el('div', { className: 'mb-screen' }, [
    el('div', { className: 'mb-veil' }),
    el('div', { className: 'mb-screen-content' }, [
      el('div', { className: 'panel charsel-panel' }, [
        el('div', { className: 'screen-back-row' }, [
          el('h2', { className: 'h-title', style: { margin: '0' }, text: '🐒 Pick your monkey' }),
          el('button', { className: 'btn small ghost', type: 'button', text: '← Back', onClick: back }),
        ]),
        el('div', { className: 'r9-charsel-row' }, [
          el('div', { className: 'r9-grid-col' }, [gridEl]),
          el('div', { className: 'r9-preview-col' }, [
            el('div', { className: 'r9-preview-title', text: 'Live preview — equipped gear' }),
            preview.el,
            equipRowsEl,
          ]),
        ]),
      ]),
    ]),
  ]);

  return {
    el: screen,
    onShow() {
      visible = true;
      if (socket.isOpen()) socket.send(MSG.GET_PROFILE, {});
      renderGrid();
      renderEquipRows();
      renderPreview();
    },
    onHide() {
      visible = false;
      preview.stop();
    },
  };
}
