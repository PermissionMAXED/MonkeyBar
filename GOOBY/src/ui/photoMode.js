// Photo mode (PLAN2 §C12.2, agent V2/G23) — HUD camera button (L1), ZERO new
// Capacitor pods. Entering hides ALL UI except the thin bottom toolbar (body
// class 'g23-photo' + a full-viewport blocker pauses care gestures); the
// toolbar cycles pose (5), emotion (4) and frame (3) pickers; the shutter
// flashes white, plays the camera SFX and captures via
// sceneManager.captureFrame() → 1080×1440 offscreen 2D composite (3:4
// portrait crop) → procedural frame overlay → PNG blob. Save: native share
// sheet when navigator.canShare({files}) (iOS/Android), else an
// <a download> anchor (desktop/dev). Bookkeeping (profile.photos, the
// photosTaken counter and +1 XP ≤ 5/day) rides the achievements engine's
// photoTaken() API. Exit restores the UI and Gooby's idle.
//
// Pure parts (catalogs + frame painters) live at module top for tests; the
// home-scene rig arrives via dynamic import (no three.js at module level).

import { PHOTO } from '../data/constants.js';
import { getAchievementsEngine } from '../systems/achievementsEngine.js';
import { t } from '../data/strings.js';
import { icon } from './icons.js';

// ── pure catalogs (§C12.2 — tested for integrity) ──────────────────────────
/** The 5 poses: rig clip + loop override (looping clips let the user time the
 * shutter — happyBounce's apex, dance steps; sit/sleep settle into a hold). */
export const PHOTO_POSES = Object.freeze([
  Object.freeze({ id: 'wave', labelKey: 'photo.pose.wave', clip: 'wave', loop: true }),
  Object.freeze({ id: 'bounce', labelKey: 'photo.pose.bounce', clip: 'happyBounce', loop: true }),
  Object.freeze({ id: 'dance', labelKey: 'photo.pose.dance', clip: 'dance', loop: true }),
  Object.freeze({ id: 'sit', labelKey: 'photo.pose.sit', clip: 'sitDrive', loop: 'hold' }),
  Object.freeze({ id: 'sleep', labelKey: 'photo.pose.sleep', clip: 'sleep', loop: true }),
]);

/** The 4 §C12.2 emotions ("the funny ones"). */
export const PHOTO_EMOTIONS = Object.freeze([
  Object.freeze({ id: 'happy', labelKey: 'photo.emo.happy' }),
  Object.freeze({ id: 'ecstatic', labelKey: 'photo.emo.ecstatic' }),
  Object.freeze({ id: 'sleepy', labelKey: 'photo.emo.sleepy' }),
  Object.freeze({ id: 'grumpy', labelKey: 'photo.emo.grumpy' }),
]);

/** The 3 frames — painters draw onto the capture canvas (procedural, §D4). */
export const PHOTO_FRAMES = Object.freeze([
  Object.freeze({ id: 'none', labelKey: 'photo.frame.none' }),
  Object.freeze({ id: 'polaroid', labelKey: 'photo.frame.polaroid' }),
  Object.freeze({ id: 'stars', labelKey: 'photo.frame.stars' }),
]);

/**
 * Draw a frame overlay onto the capture canvas (pure 2D, deterministic).
 * @param {CanvasRenderingContext2D} g
 * @param {number} w @param {number} h
 * @param {string} frameId PHOTO_FRAMES id
 * @param {string} caption polaroid caption text
 */
export function drawFrame(g, w, h, frameId, caption = 'Gooby ♥') {
  if (frameId === 'polaroid') {
    const b = Math.round(w * 0.045); // side border
    const foot = Math.round(h * 0.14); // classic fat bottom
    g.fillStyle = '#FFF9F2';
    g.fillRect(0, 0, w, b);
    g.fillRect(0, 0, b, h);
    g.fillRect(w - b, 0, b, h);
    g.fillRect(0, h - foot, w, foot);
    g.fillStyle = '#4A3B36';
    g.font = `700 ${Math.round(h * 0.045)}px "Comic Sans MS", "Chalkboard SE", cursive, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(caption, w / 2, h - foot / 2);
  } else if (frameId === 'stars') {
    const band = Math.round(w * 0.075);
    // deterministic star confetti along the 4 edges (mulberry-ish LCG)
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const colors = ['#FFD166', '#F49CBB', '#6FC3B8', '#B9AEF0', '#FFF6EC'];
    const star = (cx, cy, r, rot) => {
      g.save();
      g.translate(cx, cy);
      g.rotate(rot);
      g.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const rr = i % 2 === 0 ? r : r * 0.45;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        g[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
      g.restore();
    };
    for (let i = 0; i < 90; i += 1) {
      const edge = i % 4;
      let x;
      let y;
      if (edge === 0) { x = rnd() * w; y = rnd() * band; }
      else if (edge === 1) { x = rnd() * w; y = h - rnd() * band; }
      else if (edge === 2) { x = rnd() * band; y = rnd() * h; }
      else { x = w - rnd() * band; y = rnd() * h; }
      g.fillStyle = colors[Math.floor(rnd() * colors.length)];
      star(x, y, (0.012 + rnd() * 0.014) * w, rnd() * Math.PI);
    }
  }
}

/**
 * Composite a captured scene blob onto the §C12.2 portrait canvas:
 * 3:4 center crop + frame overlay → PNG blob.
 * @param {Blob} sceneBlob PNG from sceneManager.captureFrame()
 * @param {string} frameId PHOTO_FRAMES id
 * @param {string} caption
 * @returns {Promise<Blob|null>}
 */
export async function composePhoto(sceneBlob, frameId, caption) {
  const bmp = await window.createImageBitmap(sceneBlob);
  const W = PHOTO.CANVAS_W;
  const H = PHOTO.CANVAS_H;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  // cover-fit the 3:4 portrait crop from the (usually landscape-ish) capture
  const scale = Math.max(W / bmp.width, H / bmp.height);
  const sw = W / scale;
  const sh = H / scale;
  g.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, 0, 0, W, H);
  bmp.close?.();
  drawFrame(g, W, H, frameId, caption);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

// ── DOM layer ───────────────────────────────────────────────────────────────

const PHOTO_CSS = `
body.g23-photo .g5-hud{display:none!important;}
body.g23-photo .g23-sick-chip{display:none!important;}
.g23-ph-layer{position:fixed;inset:0;z-index:80;pointer-events:auto;display:flex;flex-direction:column;justify-content:flex-end;}
.g23-ph-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity 90ms ease;}
.g23-ph-flash.g23-on{opacity:.92;}
.g23-ph-bar{position:relative;display:flex;align-items:center;gap:6px;padding:8px calc(8px + var(--safe-right)) calc(8px + var(--safe-bottom)) calc(8px + var(--safe-left));background:rgba(42,26,60,.78);backdrop-filter:blur(6px);}
.g23-ph-exit{flex:none;display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border:none;border-radius:50%;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.g23-ph-pickers{flex:1;min-width:0;display:flex;gap:6px;}
.g23-ph-pick{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:1px;border:none;border-radius:12px;padding:6px 4px;background:rgba(255,255,255,.14);color:#fff;font-family:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent;}
.g23-ph-pick-k{font-size:8.5px;font-weight:800;opacity:.6;text-transform:uppercase;letter-spacing:.4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.g23-ph-pick-v{font-size:11px;font-weight:800;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.g23-ph-shutter{flex:none;width:56px;height:56px;border-radius:50%;border:4px solid #fff;background:var(--pink);box-shadow:0 0 0 3px rgba(42,26,60,.4);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:transform 90ms ease;}
.g23-ph-shutter:active{transform:scale(.92);}
.g23-ph-shutter[disabled]{opacity:.5;}
`;

/**
 * Wire photo mode (idempotent). Listens for the HUD's 'gooby:photoMode'
 * CustomEvent (shopTrip pattern — hud.js stays decoupled). Bookkeeping flows
 * through the achievements engine, so no direct store handle is needed.
 * @param {{ui: object, audio: object,
 *   sceneManager: {currentId: () => string|null, captureFrame: () => Promise<Blob|null>}}} deps
 * @returns {{enter: () => void, exit: () => void, isActive: () => boolean}}
 */
export function initPhotoMode({ ui, audio, sceneManager }) {
  if (!document.querySelector('style[data-owner="g23-photo"]')) {
    const style = document.createElement('style');
    style.dataset.owner = 'g23-photo';
    style.textContent = PHOTO_CSS;
    document.head.appendChild(style);
  }

  /** @type {HTMLElement|null} */
  let layer = null;
  let poseIdx = 0;
  let emoIdx = 0;
  let frameIdx = 0;
  let busy = false;

  async function goobyRig() {
    try {
      const mod = await import('../home/homeScene.js');
      return mod.getGooby?.() ?? null;
    } catch {
      return null;
    }
  }

  async function applyPose() {
    const rig = await goobyRig();
    if (!rig) return;
    const pose = PHOTO_POSES[poseIdx];
    try {
      rig.setEmotion(pose.id === 'sleep' ? 'sleepy' : PHOTO_EMOTIONS[emoIdx].id);
      rig.play(pose.clip, { loop: pose.loop });
    } catch (err) {
      console.warn('[photoMode] pose failed:', err?.message);
    }
  }

  async function applyEmotion() {
    const rig = await goobyRig();
    try {
      rig?.setEmotion(PHOTO_EMOTIONS[emoIdx].id);
    } catch (err) {
      console.warn('[photoMode] emotion failed:', err?.message);
    }
  }

  async function restoreGooby() {
    const rig = await goobyRig();
    try {
      rig?.setEmotion('happy');
      rig?.play('idle', { loop: true });
    } catch { /* scene may be gone — fine */ }
  }

  /** Share-or-download pipeline (§C12.2 — zero new pods). */
  async function deliver(blob) {
    const file = new window.File([blob], `gooby-${Date.now()}.png`, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return true; // user closed the sheet
        console.warn('[photoMode] share failed, falling back:', err?.message);
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  async function shutter(btn, flash) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    flash.classList.add('g23-on');
    audio.play('photo.shutter');
    try {
      const sceneBlob = await sceneManager.captureFrame();
      setTimeout(() => flash.classList.remove('g23-on'), 140);
      if (!sceneBlob) throw new Error('captureFrame returned null');
      const blob = await composePhoto(sceneBlob, PHOTO_FRAMES[frameIdx].id, t('photo.caption'));
      if (!blob) throw new Error('compose failed');
      await deliver(blob);
      const xp = getAchievementsEngine()?.photoTaken?.() ?? 0;
      ui.toast(xp > 0 ? 'toast.photoSaved' : 'toast.photoSavedNoXp', { xp });
      // expose the latest capture for dev/CDP verification (dev builds only)
      if (import.meta.env?.DEV) window.__goobyLastPhoto = blob;
    } catch (err) {
      console.error('[photoMode] capture failed:', err);
      flash.classList.remove('g23-on');
      ui.toast('toast.photoFailed');
    }
    btn.disabled = false;
    busy = false;
  }

  function picker(labelKey, valueOf, onCycle) {
    const b = document.createElement('button');
    b.className = 'g23-ph-pick';
    const sync = () => {
      b.innerHTML = `<span class="g23-ph-pick-k">${t(labelKey)}</span>
        <span class="g23-ph-pick-v">${valueOf()}</span>`;
    };
    b.addEventListener('click', () => {
      audio.play('ui.pick');
      onCycle();
      sync();
    });
    sync();
    return b;
  }

  function enter() {
    if (layer) return; // already open
    if (sceneManager.currentId() !== 'home') return; // §C12.2: home/garden only
    ui.closeAll();
    document.body.classList.add('g23-photo');

    layer = document.createElement('div');
    layer.className = 'g23-ph-layer';
    const flash = document.createElement('div');
    flash.className = 'g23-ph-flash';
    const bar = document.createElement('div');
    bar.className = 'g23-ph-bar';

    const exitBtn = document.createElement('button');
    exitBtn.className = 'g23-ph-exit';
    exitBtn.setAttribute('aria-label', t('photo.exit'));
    exitBtn.innerHTML = icon('close', 20);
    exitBtn.addEventListener('click', () => {
      audio.play('ui.close');
      exit();
    });

    const pickers = document.createElement('div');
    pickers.className = 'g23-ph-pickers';
    pickers.append(
      picker('photo.pose', () => t(PHOTO_POSES[poseIdx].labelKey), () => {
        poseIdx = (poseIdx + 1) % PHOTO_POSES.length;
        applyPose();
      }),
      picker('photo.emotion', () => t(PHOTO_EMOTIONS[emoIdx].labelKey), () => {
        emoIdx = (emoIdx + 1) % PHOTO_EMOTIONS.length;
        applyEmotion();
      }),
      picker('photo.frame', () => t(PHOTO_FRAMES[frameIdx].labelKey), () => {
        frameIdx = (frameIdx + 1) % PHOTO_FRAMES.length;
      })
    );

    const shutterBtn = document.createElement('button');
    shutterBtn.className = 'g23-ph-shutter';
    shutterBtn.setAttribute('aria-label', t('photo.shutter'));
    shutterBtn.addEventListener('click', () => shutter(shutterBtn, flash));

    bar.append(exitBtn, pickers, shutterBtn);
    layer.append(flash, bar);
    document.body.appendChild(layer);

    audio.play('ui.open');
    applyPose(); // start on the current pose so the preview matches the bar
  }

  function exit() {
    if (!layer) return;
    layer.remove();
    layer = null;
    document.body.classList.remove('g23-photo');
    restoreGooby();
  }

  window.addEventListener('gooby:photoMode', enter);
  return { enter, exit, isActive: () => layer != null };
}
