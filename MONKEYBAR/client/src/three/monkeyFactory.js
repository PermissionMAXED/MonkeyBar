// Procedural rigged monkeys — PLAN.md §6/§7 (client/src/three/monkeyFactory.js).
// Bodies from spheres/capsules/boxes in a jointed Object3D hierarchy driven by
// roster silhouette params; faces are eye+mouth planes sampling a CanvasTexture
// expression atlas drawn in code; accessories built from primitives.

import * as THREE from 'three';
import { getMonkey } from '@shared/monkeys.js';
import { makeCanvas, matte, glassMaterial, neonMaterial, brassMaterial } from './materials.js';
import { capturePose } from './animations.js';
import { buildHat, applySkinDye } from './cosmeticsRig.js';

export const EXPRESSIONS = ['neutral', 'blink', 'grin', 'shock', 'sweat', 'rage', 'ko'];

// ---------------------------------------------------------------------------
// Expression atlas — row 0 = eyes, row 1 = mouths, 7 columns
// ---------------------------------------------------------------------------

const TILE = 128;

function drawEyes(ctx, col, expr) {
  const x0 = col * TILE;
  const cx1 = x0 + TILE * 0.3;
  const cx2 = x0 + TILE * 0.7;
  const cy = TILE * 0.55;
  ctx.save();
  ctx.lineCap = 'round';
  const eyeWhite = (r) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(cx1, cy, r, r * 1.15, 0, 0, Math.PI * 2);
    ctx.ellipse(cx2, cy, r, r * 1.15, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  const pupils = (r, dy = 0) => {
    ctx.fillStyle = '#1a1008';
    ctx.beginPath();
    ctx.arc(cx1, cy + dy, r, 0, Math.PI * 2);
    ctx.arc(cx2, cy + dy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const brows = (angle, color = '#1a1008') => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(cx1 - 16, cy - 26 + angle * 10);
    ctx.lineTo(cx1 + 14, cy - 26 - angle * 10);
    ctx.moveTo(cx2 - 14, cy - 26 - angle * 10);
    ctx.lineTo(cx2 + 16, cy - 26 + angle * 10);
    ctx.stroke();
  };
  switch (expr) {
    case 'neutral':
      eyeWhite(15);
      pupils(7);
      break;
    case 'blink':
      ctx.strokeStyle = '#1a1008';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx1, cy - 4, 14, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx2, cy - 4, 14, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
      break;
    case 'grin':
      ctx.strokeStyle = '#1a1008';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(cx1, cy + 6, 14, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx2, cy + 6, 14, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
      break;
    case 'shock':
      eyeWhite(19);
      pupils(4);
      brows(-0.6);
      break;
    case 'sweat':
      eyeWhite(14);
      pupils(6, 3);
      brows(0.8);
      // sweat drops
      ctx.fillStyle = '#6fc8ff';
      ctx.beginPath();
      ctx.moveTo(x0 + TILE * 0.9, cy - 22);
      ctx.quadraticCurveTo(x0 + TILE * 0.96, cy - 4, x0 + TILE * 0.9, cy + 2);
      ctx.quadraticCurveTo(x0 + TILE * 0.84, cy - 4, x0 + TILE * 0.9, cy - 22);
      ctx.fill();
      break;
    case 'rage':
      ctx.fillStyle = '#ffdddd';
      ctx.beginPath();
      ctx.ellipse(cx1, cy, 14, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(cx2, cy, 14, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      pupils(6);
      brows(-1.2, '#7a1010');
      break;
    case 'ko':
      ctx.strokeStyle = '#1a1008';
      ctx.lineWidth = 8;
      for (const cx of [cx1, cx2]) {
        ctx.beginPath();
        ctx.moveTo(cx - 12, cy - 12);
        ctx.lineTo(cx + 12, cy + 12);
        ctx.moveTo(cx + 12, cy - 12);
        ctx.lineTo(cx - 12, cy + 12);
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
}

function drawMouth(ctx, col, expr) {
  const x0 = col * TILE;
  const cx = x0 + TILE / 2;
  const cy = TILE * 0.45;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#1a1008';
  ctx.lineWidth = 7;
  switch (expr) {
    case 'neutral':
    case 'blink':
      ctx.beginPath();
      ctx.arc(cx, cy - 8, 22, 0.25 * Math.PI, 0.75 * Math.PI);
      ctx.stroke();
      break;
    case 'grin': {
      ctx.fillStyle = '#5a1a1a';
      ctx.beginPath();
      ctx.arc(cx, cy - 6, 30, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(cx - 24, cy - 4, 48, 9);
      break;
    }
    case 'shock':
      ctx.fillStyle = '#3a1010';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 16, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'sweat':
      ctx.beginPath();
      ctx.moveTo(cx - 24, cy + 2);
      for (let i = 0; i <= 6; i++) ctx.lineTo(cx - 24 + i * 8, cy + 2 + (i % 2 === 0 ? 0 : 7));
      ctx.stroke();
      break;
    case 'rage': {
      ctx.fillStyle = '#3a1010';
      ctx.fillRect(cx - 26, cy - 8, 52, 18);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 5; i++) ctx.fillRect(cx - 24 + i * 10, cy - 6, 8, 6);
      break;
    }
    case 'ko':
      ctx.beginPath();
      ctx.ellipse(cx, cy, 9, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#d96a6a';
      ctx.beginPath();
      ctx.ellipse(cx + 10, cy + 12, 7, 10, 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

let atlasTexCache = null;

// Inner gutter per cell: mip levels average neighboring texels, so without a
// transparent margin the big eye-whites bleed across cell borders and show up
// as halos on the face planes of adjacent expressions.
const GUTTER = 8;

function getExpressionAtlas() {
  if (atlasTexCache) return atlasTexCache;
  const { canvas, ctx } = makeCanvas(TILE * EXPRESSIONS.length, TILE * 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const inset = (TILE - GUTTER * 2) / TILE;
  EXPRESSIONS.forEach((expr, i) => {
    // draw each cell scaled into its inner (TILE − 2·GUTTER) square
    ctx.save();
    ctx.translate(i * TILE + GUTTER, GUTTER);
    ctx.scale(inset, inset);
    ctx.translate(-i * TILE, 0);
    drawEyes(ctx, i, expr);
    ctx.restore();
    ctx.save();
    ctx.translate(i * TILE + GUTTER, TILE + GUTTER);
    ctx.scale(inset, inset);
    ctx.translate(-i * TILE, 0);
    drawMouth(ctx, i, expr);
    ctx.restore();
  });
  atlasTexCache = canvas;
  return canvas;
}

function makeFacePlane(kind /* 'eyes'|'mouth' */, w, h) {
  const canvas = getExpressionAtlas();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1 / EXPRESSIONS.length, 0.5);
  tex.offset.y = kind === 'eyes' ? 0.5 : 0; // flipY: top row = eyes
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.renderOrder = 2;
  return { mesh, tex };
}

// ---------------------------------------------------------------------------
// Accessory builders (all primitives)
// ---------------------------------------------------------------------------

/**
 * Tag built-in accessory nodes that occupy the head's crown volume so R9
 * catalog hats can hide them (applyCosmetics) instead of clipping through
 * them. Restoring visibility on unequip is applyCosmetics' job too.
 */
function markHeadwear(...nodes) {
  for (const node of nodes) node.userData.headwear = true;
}

/**
 * Each builder gets `a` = { head, torso, handL, handR, headR, torsoR, torsoLen, colors }.
 * Sizes are in the monkey's local (already scaled) space.
 */
const ACCESSORY_BUILDERS = {
  mohawk_red(a) {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const h = a.headR * (0.55 - Math.abs(i - 2.5) * 0.07);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(a.headR * 0.13, h, 5), matte('#d92f2f'));
      spike.position.set(0, a.headR * 0.9 + h * 0.3, a.headR * (0.45 - i * 0.18));
      spike.rotation.x = (i - 2.5) * 0.18;
      g.add(spike);
    }
    markHeadwear(g);
    a.head.add(g);
  },
  bandana(a) {
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(a.headR * 0.72, a.headR * 0.78, a.headR * 0.28, 16, 1, true),
      matte('#2f5ad9')
    );
    band.position.y = -a.headR * 0.75;
    a.head.add(band);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(a.headR * 0.16, 8, 8), matte('#2f5ad9'));
    knot.position.set(0, -a.headR * 0.75, -a.headR * 0.72);
    a.head.add(knot);
  },
  top_hat(a) {
    const black = matte('#181818', { roughness: 0.5 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(a.headR * 0.62, a.headR * 0.66, a.headR * 1.15, 20), black);
    crown.position.y = a.headR * 1.35;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(a.headR * 1.15, a.headR * 1.15, a.headR * 0.08, 24), black);
    brim.position.y = a.headR * 0.82;
    const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(a.headR * 0.68, a.headR * 0.68, a.headR * 0.2, 20), matte('#8a1e1e'));
    ribbon.position.y = a.headR * 0.95;
    markHeadwear(crown, brim, ribbon);
    a.head.add(crown, brim, ribbon);
  },
  monocle(a) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(a.headR * 0.28, a.headR * 0.045, 8, 20), brassMaterial());
    rim.position.set(a.headR * 0.34, a.headR * 0.12, a.headR * 0.92);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(a.headR * 0.26, 20), glassMaterial('#cfe8ff', { opacity: 0.35 }));
    lens.position.copy(rim.position);
    a.head.add(rim, lens);
  },
  shawl(a) {
    const shawl = new THREE.Mesh(
      new THREE.ConeGeometry(a.torsoR * 2.0, a.torsoLen * 1.1, 14, 1, true),
      matte('#b87a9a', { roughness: 0.95 })
    );
    shawl.position.y = a.torsoLen * 0.55;
    a.torso.add(shawl);
  },
  cane(a) {
    const cane = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.42, 8), matte('#4a2e18'));
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 12, Math.PI), matte('#4a2e18'));
    hook.position.y = 0.21;
    cane.add(shaft, hook);
    cane.position.set(0, -0.05, 0.02);
    a.handR.add(cane);
  },
  headphones(a) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(a.headR * 1.02, a.headR * 0.08, 8, 20, Math.PI), matte('#222831', { roughness: 0.4 }));
    band.rotation.z = 0; // arcs over the top
    markHeadwear(band);
    a.head.add(band);
    for (const s of [-1, 1]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(a.headR * 0.32, a.headR * 0.32, a.headR * 0.22, 14), matte('#39ff88', { emissive: '#39ff88', emissiveIntensity: 0.6 }));
      cup.rotation.z = Math.PI / 2;
      cup.position.set(s * a.headR * 1.02, 0, 0);
      markHeadwear(cup); // the cups read broken without their band
      a.head.add(cup);
    }
  },
  nun_habit(a) {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(a.headR * 1.22, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), matte('#14141a'));
    hood.position.y = a.headR * 0.12;
    const trim = new THREE.Mesh(new THREE.TorusGeometry(a.headR * 1.0, a.headR * 0.09, 8, 20), matte('#f0f0e8'));
    trim.rotation.x = Math.PI / 2.6;
    trim.position.set(0, a.headR * 0.35, a.headR * 0.45);
    markHeadwear(hood, trim); // the robe stays — only the hood is crown volume
    a.head.add(hood, trim);
    const robe = new THREE.Mesh(new THREE.ConeGeometry(a.torsoR * 1.7, a.torsoLen * 1.5, 14, 1, true), matte('#14141a'));
    robe.position.y = a.torsoLen * 0.3;
    a.torso.add(robe);
  },
  rosary(a) {
    const g = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI + Math.PI;
      const bead = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), matte('#7a4f2a', { roughness: 0.3 }));
      bead.position.set(Math.cos(ang) * a.torsoR * 0.9, Math.sin(ang) * a.torsoR * 0.6, a.torsoR * 0.75);
      g.add(bead);
    }
    const cross = new THREE.Group();
    const bar1 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.05, 0.008), brassMaterial());
    const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.008), brassMaterial());
    bar2.position.y = 0.008;
    cross.add(bar1, bar2);
    cross.position.set(0, -a.torsoR * 0.62, a.torsoR * 0.85);
    g.add(cross);
    g.position.y = a.torsoLen * 0.55;
    a.torso.add(g);
  },
  bib(a) {
    const bib = new THREE.Mesh(new THREE.CircleGeometry(a.torsoR * 1.15, 18), matte('#f5f5f0'));
    bib.position.set(0, a.torsoLen * 0.42, a.torsoR * 1.02);
    bib.rotation.x = -0.22;
    a.torso.add(bib);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(a.torsoR * 0.7, 0.01, 6, 16), matte('#d9d9d0'));
    strap.rotation.x = Math.PI / 2;
    strap.position.y = a.torsoLen * 0.8;
    a.torso.add(strap);
  },
  cracked_glasses(a) {
    const frame = matte('#2a2a2a', { roughness: 0.35 });
    for (const s of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(a.headR * 0.26, a.headR * 0.035, 8, 18), frame);
      rim.position.set(s * a.headR * 0.34, a.headR * 0.12, a.headR * 0.92);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(a.headR * 0.24, 18), glassMaterial('#e8f4ff', { opacity: 0.3 }));
      lens.position.copy(rim.position);
      a.head.add(rim, lens);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(a.headR * 0.24, a.headR * 0.05, a.headR * 0.05), frame);
    bridge.position.set(0, a.headR * 0.16, a.headR * 0.92);
    a.head.add(bridge);
  },
  lab_coat(a) {
    const coat = new THREE.Mesh(
      new THREE.CylinderGeometry(a.torsoR * 1.25, a.torsoR * 1.5, a.torsoLen * 1.6, 16, 1, true, Math.PI * 0.12, Math.PI * 1.76),
      matte('#e8e8e2', { roughness: 0.9 })
    );
    coat.rotation.y = Math.PI; // opening faces forward
    coat.position.y = a.torsoLen * 0.25;
    a.torso.add(coat);
  },
  eye_patch(a) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(a.headR * 0.24, 14), matte('#101010'));
    patch.position.set(-a.headR * 0.34, a.headR * 0.14, a.headR * 0.95);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(a.headR * 0.98, a.headR * 0.035, 6, 24), matte('#101010'));
    strap.rotation.x = 0.35;
    strap.rotation.z = 0.3;
    a.head.add(patch, strap);
  },
  pirate_coat(a) {
    const coat = new THREE.Mesh(
      new THREE.CylinderGeometry(a.torsoR * 1.25, a.torsoR * 1.55, a.torsoLen * 1.6, 16, 1, true, Math.PI * 0.15, Math.PI * 1.7),
      matte('#5e1e1e', { roughness: 0.8 })
    );
    coat.rotation.y = Math.PI;
    coat.position.y = a.torsoLen * 0.25;
    a.torso.add(coat);
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(a.torsoR * 0.42, 10, 8), brassMaterial());
      pad.scale.y = 0.5;
      pad.position.set(s * a.torsoR * 1.05, a.torsoLen * 0.95, 0);
      a.torso.add(pad);
    }
  },
  feather_boa(a) {
    const g = new THREE.Group();
    const mat = matte('#e86ab0', { roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const ang = (i / 14) * Math.PI * 2;
      const puff = new THREE.Mesh(new THREE.SphereGeometry(a.torsoR * 0.28 * (0.8 + 0.3 * Math.sin(i * 2.7)), 8, 6), mat);
      puff.position.set(Math.cos(ang) * a.torsoR * 0.95, Math.sin(ang) * a.torsoR * 0.28, Math.sin(ang) * a.torsoR * 0.85);
      g.add(puff);
    }
    g.position.y = a.torsoLen * 0.72;
    a.torso.add(g);
  },
  tank_top(a) {
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(a.torsoR * 1.06, a.torsoR * 1.12, a.torsoLen * 1.0, 16, 1, true),
      matte('#e8e4d8', { roughness: 0.95 })
    );
    top.position.y = a.torsoLen * 0.32;
    a.torso.add(top);
  },
  beer_mug(a) {
    const mug = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.032, 0.08, 12, 1), glassMaterial('#f0c56a', { opacity: 0.6 }));
    const foam = new THREE.Mesh(new THREE.SphereGeometry(0.034, 10, 6), matte('#fff8e8'));
    foam.scale.y = 0.4;
    foam.position.y = 0.045;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.007, 6, 12, Math.PI), glassMaterial('#f0c56a', { opacity: 0.7 }));
    handle.position.x = 0.036;
    handle.rotation.z = -Math.PI / 2;
    mug.add(body, foam, handle);
    mug.position.set(0, -0.02, 0.03);
    a.handL.add(mug);
  },
  mask_markings(a) {
    for (const s of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(a.headR * 0.2, a.headR * 0.34, 16), matte('#2a2420'));
      ring.position.set(s * a.headR * 0.34, a.headR * 0.12, a.headR * 0.9);
      a.head.add(ring);
    }
  },
  trench_coat(a) {
    const coat = new THREE.Mesh(
      new THREE.CylinderGeometry(a.torsoR * 1.22, a.torsoR * 1.7, a.torsoLen * 2.0, 16, 1, true, Math.PI * 0.15, Math.PI * 1.7),
      matte('#4a4238', { roughness: 0.9 })
    );
    coat.rotation.y = Math.PI;
    coat.position.y = a.torsoLen * 0.1;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(a.torsoR * 1.05, a.torsoR * 1.3, a.torsoLen * 0.32, 12, 1, true), matte('#3a332c'));
    collar.position.y = a.torsoLen * 1.0;
    a.torso.add(coat, collar);
  },
  fedora(a) {
    const felt = matte('#3a332c', { roughness: 0.85 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(a.headR * 0.55, a.headR * 0.68, a.headR * 0.5, 18), felt);
    crown.position.y = a.headR * 1.05;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(a.headR * 1.2, a.headR * 1.25, a.headR * 0.06, 22), felt);
    brim.position.y = a.headR * 0.8;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(a.headR * 0.62, a.headR * 0.7, a.headR * 0.14, 18), matte('#1a1612'));
    band.position.y = a.headR * 0.88;
    markHeadwear(crown, brim, band);
    a.head.add(crown, brim, band);
  },
  soda_can_crown(a) {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const can = new THREE.Mesh(
        new THREE.CylinderGeometry(a.headR * 0.16, a.headR * 0.16, a.headR * 0.4, 10),
        matte(i % 2 ? '#d92f2f' : '#d0d0d0', { roughness: 0.3, metalness: 0.8 })
      );
      can.position.set(Math.cos(ang) * a.headR * 0.55, a.headR * 1.1, Math.sin(ang) * a.headR * 0.55);
      g.add(can);
    }
    const band = new THREE.Mesh(new THREE.CylinderGeometry(a.headR * 0.72, a.headR * 0.72, a.headR * 0.16, 16), brassMaterial());
    band.position.y = a.headR * 0.9;
    g.add(band);
    markHeadwear(g);
    a.head.add(g);
  },
  acorn_pouch(a) {
    const pouch = new THREE.Mesh(new THREE.SphereGeometry(a.torsoR * 0.5, 10, 8), matte('#6b4a2e'));
    pouch.scale.y = 1.15;
    pouch.position.set(a.torsoR * 0.85, a.torsoLen * 0.1, a.torsoR * 0.55);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(a.torsoR * 1.02, 0.012, 6, 20), matte('#4a2e18'));
    strap.rotation.z = 0.8;
    strap.position.y = a.torsoLen * 0.45;
    a.torso.add(pouch, strap);
  },
  veil(a) {
    const veil = new THREE.Mesh(
      new THREE.SphereGeometry(a.headR * 1.35, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.7),
      new THREE.MeshStandardMaterial({ color: '#6b4585', transparent: true, opacity: 0.4, side: THREE.DoubleSide, roughness: 0.9 })
    );
    veil.position.y = a.headR * 0.25;
    const circlet = new THREE.Mesh(new THREE.TorusGeometry(a.headR * 0.9, a.headR * 0.05, 6, 20), brassMaterial());
    circlet.rotation.x = Math.PI / 2;
    circlet.position.y = a.headR * 0.72;
    markHeadwear(veil, circlet);
    a.head.add(veil, circlet);
  },
  crystal_ball(a) {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), glassMaterial('#d9c7ff', { opacity: 0.5, roughness: 0.05 }));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), neonMaterial('#b06bff', 1.6));
    ball.add(core);
    ball.position.set(0, -0.02, 0.04);
    a.handL.add(ball);
  },
  neon_arm(a) {
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.032 - i * 0.004, 0.007, 6, 14), neonMaterial('#35e8d0', 2.2));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.05 - i * 0.045;
      a.armR.add(ring);
    }
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.032, 10, 8), neonMaterial('#35e8d0', 1.4));
    a.handR.add(fist);
  },
  led_visor(a) {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(a.headR * 1.5, a.headR * 0.3, a.headR * 0.12), neonMaterial('#ff3df0', 1.8));
    visor.position.set(0, a.headR * 0.42, a.headR * 0.8);
    a.head.add(visor);
  },
};

// ---------------------------------------------------------------------------
// The monkey rig
// ---------------------------------------------------------------------------

function capsule(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.castShadow = true;
  return m;
}

let monkeyUid = 0;

/**
 * Build a procedural rigged monkey from roster silhouette params.
 * @param {string} monkeyId  id in shared/monkeys.js (unknown → default look)
 * @param {string} [name]
 */
export function createMonkey(monkeyId, name = '') {
  const def = getMonkey(monkeyId);
  const sil = def?.silhouette ?? {
    bodyScale: 1,
    limbLength: 1,
    earSize: 1,
    muzzleSize: 1,
    furPalette: ['#8a5a2b', '#c99b6a', '#e8c39e'],
    accessories: [],
  };
  const bs = sil.bodyScale;
  // wider tempering so silhouettes clearly vary (~0.82–1.37 for bodyScale
  // 0.45–1.7) while the largest still clears table/stool and nameplates
  const size = 0.62 + 0.44 * bs;
  const [furHex, bellyHex, skinHex] = sil.furPalette;

  const fur = matte(furHex, { roughness: 0.92 });
  const belly = matte(bellyHex, { roughness: 0.95 });
  const skin = matte(skinHex, { roughness: 0.8 });

  const torsoLen = 0.21 * size;
  const torsoR = 0.105 * (0.62 + 0.5 * bs);
  const headR = 0.115 * (0.78 + 0.24 * size);
  const upperArm = 0.145 * size * sil.limbLength;
  const foreArm = 0.125 * size * sil.limbLength;
  const thigh = 0.13 * size * sil.limbLength;
  const shin = 0.115 * size * sil.limbLength;

  const root = new THREE.Group();
  root.name = `monkey_${monkeyId}`;

  const hips = new THREE.Group();
  hips.position.y = 0.04 * size;
  root.add(hips);

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(torsoR * 1.05, 14, 10), fur);
  pelvis.scale.y = 0.72;
  pelvis.castShadow = true;
  hips.add(pelvis);

  // torso pivots at the hips
  const torso = new THREE.Group();
  torso.position.y = torsoR * 0.35;
  hips.add(torso);
  const chest = capsule(torsoR, torsoLen, fur);
  chest.position.y = torsoLen * 0.62;
  torso.add(chest);
  const bellyMesh = new THREE.Mesh(new THREE.SphereGeometry(torsoR * 0.85, 12, 10), belly);
  bellyMesh.scale.set(0.8, 1.0, 0.62);
  bellyMesh.position.set(0, torsoLen * 0.5, torsoR * 0.42);
  torso.add(bellyMesh);

  // ---- head ----
  const head = new THREE.Group();
  head.position.y = torsoLen * 1.18 + headR * 0.6;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(headR, 18, 14), fur);
  skull.castShadow = true;
  head.add(skull);
  const facePlate = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.82, 16, 12), skin);
  facePlate.scale.z = 0.55;
  facePlate.position.z = headR * 0.42;
  head.add(facePlate);
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.42 * sil.muzzleSize, 12, 10), skin);
  muzzle.scale.set(1.15, 0.8, 0.85);
  muzzle.position.set(0, -headR * 0.28, headR * 0.72);
  head.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.09, 8, 6), matte('#3a2418'));
  nose.position.set(0, -headR * 0.14, headR * 0.72 + headR * 0.36 * sil.muzzleSize);
  head.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.34 * sil.earSize, 10, 8), fur);
    ear.scale.z = 0.45;
    ear.position.set(s * headR * 0.95, headR * 0.18, -headR * 0.08);
    head.add(ear);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(headR * 0.2 * sil.earSize, 10), skin);
    inner.position.set(s * headR * 0.98, headR * 0.18, -headR * 0.08 + headR * 0.1);
    inner.rotation.y = s * 0.35;
    head.add(inner);
  }

  // face planes (expression atlas)
  const eyes = makeFacePlane('eyes', headR * 1.15, headR * 0.58);
  eyes.mesh.position.set(0, headR * 0.18, headR * 0.98);
  head.add(eyes.mesh);
  const mouth = makeFacePlane('mouth', headR * 0.85, headR * 0.42);
  mouth.mesh.position.set(0, -headR * 0.32, headR * 0.72 + headR * 0.38 * sil.muzzleSize);
  head.add(mouth.mesh);

  // ---- arms ----
  function buildArm(side) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * (torsoR * 1.05), torsoLen * 1.05, 0);
    torso.add(shoulder);
    const upper = capsule(torsoR * 0.32, upperArm, fur);
    upper.position.y = -upperArm * 0.55;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -upperArm * 1.1;
    shoulder.add(elbow);
    const lower = capsule(torsoR * 0.26, foreArm, fur);
    lower.position.y = -foreArm * 0.55;
    elbow.add(lower);
    const hand = new THREE.Group();
    hand.position.y = -foreArm * 1.15;
    elbow.add(hand);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(torsoR * 0.3, 10, 8), skin);
    palm.castShadow = true;
    hand.add(palm);
    return { shoulder, elbow, hand };
  }
  const armLp = buildArm(-1);
  const armRp = buildArm(1);

  // ---- legs (seated pose) ----
  function buildLeg(side) {
    const hip = new THREE.Group();
    hip.position.set(side * torsoR * 0.62, 0, 0);
    hips.add(hip);
    const thighMesh = capsule(torsoR * 0.36, thigh, fur);
    thighMesh.position.y = -thigh * 0.55;
    hip.add(thighMesh);
    const knee = new THREE.Group();
    knee.position.y = -thigh * 1.1;
    hip.add(knee);
    const shinMesh = capsule(torsoR * 0.28, shin, fur);
    shinMesh.position.y = -shin * 0.55;
    knee.add(shinMesh);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(torsoR * 0.32, 10, 8), skin);
    foot.scale.set(0.9, 0.55, 1.5);
    foot.position.set(0, -shin * 1.15, torsoR * 0.15);
    knee.add(foot);
    return { hip, knee };
  }
  const legLp = buildLeg(-1);
  const legRp = buildLeg(1);

  // ---- tail ----
  const tail = new THREE.Group();
  tail.position.set(0, 0.01, -torsoR * 0.9);
  hips.add(tail);
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0.06 * size, -0.12 * size),
    new THREE.Vector3(0, 0.2 * size, -0.16 * size),
    new THREE.Vector3(0, 0.3 * size, -0.08 * size),
  ]);
  const tailMesh = new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 12, torsoR * 0.16, 6), fur);
  tailMesh.castShadow = true;
  tail.add(tailMesh);

  // ---- seated base pose ----
  torso.rotation.x = 0.08;
  armLp.shoulder.rotation.set(-0.55, 0, 0.18);
  armRp.shoulder.rotation.set(-0.55, 0, -0.18);
  armLp.elbow.rotation.x = -0.55;
  armRp.elbow.rotation.x = -0.55;
  legLp.hip.rotation.set(-1.45, 0, 0.22);
  legRp.hip.rotation.set(-1.45, 0, -0.22);
  legLp.knee.rotation.x = 1.35;
  legRp.knee.rotation.x = 1.35;

  const joints = {
    root,
    hips,
    torso,
    head,
    armL: armLp.shoulder,
    armR: armRp.shoulder,
    foreArmL: armLp.elbow,
    foreArmR: armRp.elbow,
    handL: armLp.hand,
    handR: armRp.hand,
    legL: legLp.hip,
    legR: legRp.hip,
    shinL: legLp.knee,
    shinR: legRp.knee,
    tail,
  };

  const state = { busy: 0, baseExpression: 'neutral', twitchy: 1 };
  let flashTimer = null;

  // R9 cosmetics state: the fur material's stock values (skin dyes override
  // furPalette[0] on this shared instance) + the currently worn hat group.
  const furBase = { color: furHex, roughness: fur.roughness, metalness: fur.metalness };
  /** @type {THREE.Group|null} */
  let hatGroup = null;

  function applyExpression(exprName) {
    const i = Math.max(0, EXPRESSIONS.indexOf(exprName));
    eyes.tex.offset.x = i / EXPRESSIONS.length;
    mouth.tex.offset.x = i / EXPRESSIONS.length;
  }

  const monkey = {
    uid: `mk${monkeyUid++}`,
    id: monkeyId,
    def,
    name: name || def?.name || monkeyId,
    root,
    joints,
    state,
    /** Set the persistent expression. */
    setExpression(exprName) {
      state.baseExpression = exprName;
      if (flashTimer) {
        clearTimeout(flashTimer);
        flashTimer = null;
      }
      applyExpression(exprName);
    },
    /** Show an expression briefly, then return to the base one (blinks). */
    flashExpression(exprName, seconds = 0.13) {
      applyExpression(exprName);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => applyExpression(state.baseExpression), seconds * 1000);
    },
    /** World position of the head (into `target`). */
    headWorldPos(target = new THREE.Vector3()) {
      return head.getWorldPosition(target);
    },
    /**
     * R9 (§10.3): wear equipped cosmetics — engine.seatMonkey forwards the
     * seat's `cosmetics` here right after creation. Re-callable/idempotent
     * (the character-select preview re-applies on equip changes):
     *   hat  — a cosmeticsRig primitive build anchored to the head group
     *   skin — a fur dye overriding furPalette[0] on the shared fur material
     * table/deco ids are venue-scoped and handled by tableView, not the rig.
     * @param {{hat?: string, skin?: string}|null} cosmetics
     */
    applyCosmetics(cosmetics) {
      if (hatGroup) {
        hatGroup.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
        });
        hatGroup.removeFromParent();
        hatGroup = null;
      }
      if (cosmetics?.hat) {
        hatGroup = buildHat(cosmetics.hat, headR);
        if (hatGroup) head.add(hatGroup);
      }
      // catalog hat on → hide the built-in crown-volume headwear (top hat,
      // mohawk, crown, veil, hood…) so the two never clip; off → restore it
      const wearingHat = !!hatGroup;
      head.traverse((o) => {
        if (o.userData.headwear) o.visible = !wearingHat;
      });
      applySkinDye(fur, cosmetics?.skin ?? null, furBase);
      return this;
    },
    dispose() {
      if (flashTimer) clearTimeout(flashTimer);
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      root.removeFromParent();
    },
  };

  // ---- accessories ----
  const actx = {
    head,
    torso,
    armL: armLp.shoulder,
    armR: armRp.shoulder,
    foreArmL: armLp.elbow,
    foreArmR: armRp.elbow,
    handL: armLp.hand,
    handR: armRp.hand,
    headR,
    torsoR,
    torsoLen,
    colors: sil.furPalette,
  };
  for (const acc of sil.accessories || []) {
    const builder = ACCESSORY_BUILDERS[acc];
    if (builder) builder(actx);
  }
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  monkey.basePose = capturePose(monkey);
  applyExpression('neutral');
  return monkey;
}
