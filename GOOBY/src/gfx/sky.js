// V2/G19: Sky module (§C2.1/§C10.2/§C11.2) — the garden sky dome and the
// indoor window sky textures, both procedural CanvasTextures driven by the
// day/night band (constants.DAYNIGHT §C10.2) and the weather state (§C11).
//
// ── Contracts exposed (PLAN2 §E G19; consumed by G26's ambience pass) ───────
//   makeDome(band, weather)      → THREE.Mesh — ONE draw call; call
//       mesh.userData.setSky(band, weather) to retexture on band/weather
//       changes (roomManager.setAmbience drives this); dispose via
//       mesh.userData.dispose().
//   windowTexture(band, weather) → THREE.CanvasTexture for the indoor window
//       panes (cached per band:weather — never dispose these).
//   domeTexture(band, weather)   → THREE.CanvasTexture for the dome interior
//       (cached — shared with makeDome).
//
// Bands: 'day'|'dawn'|'dusk'|'night' (systems/dayNight.js). Weather:
// 'clear'|'cloudy'|'rain' (systems/weather.js). Night gets procedural star
// dots + a moon disc (§C10.2); cloudy mixes grey + cloud puffs; rain darkens
// further (§C11.2 — the animated rain FX themselves are G26's weatherFx.js).

import * as THREE from 'three';
import { DAYNIGHT } from '../data/constants.js';

/** Dome geometry numbers: radius encloses the §C2 room camera (dist ≈ 7.6). */
export const SKY = Object.freeze({
  DOME_RADIUS: 11,
  /** Dome dips slightly below the horizon so no backdrop peeks through. */
  DOME_OVERHANG_RAD: 0.35,
});

/** Horizon (lower gradient stop) per band — warm haze under the §C10.2 sky. */
const HORIZON = Object.freeze({
  day: '#E8F6E4',
  dawn: '#FFEFD8',
  dusk: '#C98BB8', // §C10.2: dusk dome is a FFB38A → C98BB8 gradient
  night: '#2E3760',
});

/** Grey overlay strength (§C11.2: cloudy +20% grey; rain a bit more). */
const GREY_MIX = Object.freeze({ clear: 0, cloudy: 0.2, rain: 0.38 });

/** deterministic pseudo-random helper for star/cloud placement */
const jitter = (i, salt) => (((i * 73 + salt * 37) % 89) / 89);

/**
 * Mix a hex color toward grey (§C11.2 desaturation).
 * @param {string} hex @param {number} amount 0..1
 * @returns {string} css color
 */
function greyed(hex, amount) {
  if (amount <= 0) return hex;
  const c = new THREE.Color(hex);
  const g = new THREE.Color('#9AA3AD');
  c.lerp(g, amount);
  return `#${c.getHexString()}`;
}

/** @type {Map<string, THREE.CanvasTexture>} permanent texture caches */
const domeCache = new Map();
const windowCache = new Map();

/**
 * Paint the shared sky background (vertical gradient + stars/moon/clouds)
 * onto a 2D context. `w`/`h` are the canvas dimensions.
 */
function paintSky(g, w, h, band, weather) {
  const cfg = DAYNIGHT[band] ?? DAYNIGHT.day;
  const grey = GREY_MIX[weather] ?? 0;
  const top = greyed(cfg.sky, grey);
  const bottom = greyed(cfg.sky2 ?? HORIZON[band] ?? HORIZON.day, grey);

  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  if (cfg.stars) {
    // procedural star dots (§C10.2) — deterministic, denser near the top
    g.fillStyle = '#FFE9A8';
    for (let i = 0; i < 70; i += 1) {
      const x = jitter(i, 3) * w;
      const y = jitter(i, 11) * h * 0.7;
      g.globalAlpha = 0.35 + jitter(i, 7) * 0.6 * (weather === 'clear' ? 1 : 0.4);
      const r = 0.6 + jitter(i, 5) * 1.1;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  if (cfg.moon && weather !== 'rain') {
    // moon disc with a soft crater-side shadow (§C10.2)
    const mx = w * 0.72;
    const my = h * 0.2;
    const mr = Math.min(w, h) * 0.07;
    g.fillStyle = '#F4EFD9';
    g.beginPath();
    g.arc(mx, my, mr, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(160,160,190,0.35)';
    for (const [dx, dy, rr] of [[-0.3, -0.15, 0.22], [0.25, 0.3, 0.16], [0.05, -0.4, 0.12]]) {
      g.beginPath();
      g.arc(mx + dx * mr, my + dy * mr, rr * mr, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (weather !== 'clear') {
    // drifting-look cloud puffs (§C11.2 — static here; G26 animates sprites)
    g.fillStyle = weather === 'rain' ? 'rgba(120,128,140,0.55)' : 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 7; i += 1) {
      const cx = jitter(i, 17) * w;
      const cy = (0.12 + jitter(i, 23) * 0.35) * h;
      const s = 0.5 + jitter(i, 29) * 0.9;
      for (const [dx, dy, r] of [[-0.9, 0, 0.7], [0, -0.45, 0.95], [0.95, 0, 0.75], [0.35, 0.3, 0.8]]) {
        g.beginPath();
        g.ellipse(cx + dx * 22 * s, cy + dy * 14 * s, r * 20 * s, r * 12 * s, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

/**
 * Dome interior texture for a band/weather combo (cached, do not dispose).
 * @param {'day'|'dawn'|'dusk'|'night'} band
 * @param {'clear'|'cloudy'|'rain'} weather
 * @returns {THREE.CanvasTexture}
 */
export function domeTexture(band, weather) {
  const key = `${band}:${weather}`;
  if (domeCache.has(key)) return domeCache.get(key);
  const W = 512;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  paintSky(g, W, H, band, weather);
  // horizon haze band at the very bottom so the dome's below-horizon skirt
  // reads as a distant meadow instead of a hard gradient cut
  const haze = g.createLinearGradient(0, H * 0.82, 0, H);
  haze.addColorStop(0, 'rgba(190,214,178,0)');
  haze.addColorStop(1, greyed(band === 'night' ? '#39406B' : '#BCD8A8', GREY_MIX[weather] ?? 0));
  g.fillStyle = haze;
  g.fillRect(0, H * 0.82, W, H * 0.18);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  domeCache.set(key, tex);
  return tex;
}

/**
 * Indoor window sky texture (§C10.2 window column; G26 layers rain streaks
 * on top in wave 3). Cached per band:weather — treat as permanent.
 * @param {'day'|'dawn'|'dusk'|'night'} band
 * @param {'clear'|'cloudy'|'rain'} weather
 * @returns {THREE.CanvasTexture}
 */
export function windowTexture(band, weather) {
  const key = `${band}:${weather}`;
  if (windowCache.has(key)) return windowCache.get(key);
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  paintSky(g, S, S, band, weather);
  if (weather === 'rain') {
    // static droplet streak hints (animated overlay is G26's §C11.2 work)
    g.strokeStyle = 'rgba(225,240,255,0.4)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 9; i += 1) {
      const x = jitter(i, 41) * S;
      const y = jitter(i, 43) * S * 0.7;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - 2, y + 10 + jitter(i, 47) * 14);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  windowCache.set(key, tex);
  return tex;
}

/**
 * Build the garden sky dome (§C2.1): ONE mesh = one draw call. The dome is an
 * inward-facing hemisphere (+ a small below-horizon skirt) big enough to
 * enclose the §C2 room camera. Returns the mesh; the creator adds it to the
 * garden group and toggles `.visible` (the dome must not swallow the indoor
 * rooms' backdrop — roomManager shows it only around the garden).
 *
 * mesh.userData.setSky(band, weather)  — swap the cached texture (cheap).
 * mesh.userData.dispose()              — free the geometry (textures are cached).
 *
 * @param {'day'|'dawn'|'dusk'|'night'} band
 * @param {'clear'|'cloudy'|'rain'} weather
 * @returns {THREE.Mesh}
 */
export function makeDome(band, weather) {
  const geo = new THREE.SphereGeometry(
    SKY.DOME_RADIUS, 24, 12,
    0, Math.PI * 2,
    0, Math.PI / 2 + SKY.DOME_OVERHANG_RAD
  );
  const mat = new THREE.MeshBasicMaterial({
    map: domeTexture(band, weather),
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'skyDome';
  mesh.userData.setSky = (b, w) => {
    mat.map = domeTexture(b, w);
    mat.needsUpdate = true;
  };
  mesh.userData.dispose = () => {
    geo.dispose();
    mat.dispose(); // material only — the CanvasTextures stay cached
  };
  return mesh;
}
