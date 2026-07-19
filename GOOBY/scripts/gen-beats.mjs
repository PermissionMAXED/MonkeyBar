#!/usr/bin/env node
// GOOBY V4/G51 — beat-grid manifest generator (PLAN4 §B5.3; npm script
// `beats`). For every `Recap` category track in src/data/musicManifest.json
// (or any file passed explicitly as an argument):
//
//   1. decode to mono f32 PCM @ 22050 Hz (ffmpeg)
//   2. spectral-flux onset envelope (1024-sample Hann frames, hop 512,
//      radix-2 FFT, half-wave-rectified per-bin magnitude increase)
//   3. tempo by autocorrelation of the onset envelope over the 60–180 BPM
//      lag range, with harmonic (½×/2×) disambiguation + parabolic
//      interpolation of the winning lag
//   4. phase fit: the beat-grid offset in [0, period) that maximizes onset
//      energy sampled at the grid points
//
// Writes `<root>/beats/<basename>.beats.json` next to the track's root
// (public/assets/GoobyMusic/beats/… for owner files, public/assets/music/
// beats/… for builtins):
//
//   { "bpm": <float 1dp>, "offsetSec": <float 2dp>, "beatsPerBar": 4 }
//
// A sibling `<basename>.beats.override.json` (hand-tuned) WINS VERBATIM at
// runtime (§B5.3) — the script still reports its own measurement for
// comparison but never touches override files. Tracks without any beats file
// fall back to the default grid { bpm: 100, offsetSec: 0, beatsPerBar: 4 }
// at runtime (recap still runs, just un-tuned).
//
// Deterministic + idempotent: pure math over the decoded samples —
// re-running writes byte-identical JSON.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileP = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const MANIFEST = path.join(ROOT, 'src', 'data', 'musicManifest.json');

/** Analysis constants (frozen — §B5.3 numbers). */
export const SAMPLE_RATE = 22050;
export const FRAME = 1024;
export const HOP = 512;
export const BPM_MIN = 60;
export const BPM_MAX = 180;
/** Onset-envelope frame rate (frames per second). */
export const FRAME_RATE = SAMPLE_RATE / HOP;

// ---------------------------------------------------------------------------
// Radix-2 FFT (real input, magnitude spectrum) — small and dependency-free.
// ---------------------------------------------------------------------------

const fftCache = new Map();
function fftTables(n) {
  let t = fftCache.get(n);
  if (!t) {
    const rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i += 1) {
      let r = 0;
      for (let b = 0; b < bits; b += 1) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i += 1) {
      cos[i] = Math.cos((-2 * Math.PI * i) / n);
      sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
    t = { rev, cos, sin };
    fftCache.set(n, t);
  }
  return t;
}

/**
 * In-place iterative radix-2 FFT over interleaved-free re/im arrays.
 * @param {Float64Array} re @param {Float64Array} im
 */
export function fft(re, im) {
  const n = re.length;
  const { rev, cos, sin } = fftTables(n);
  for (let i = 0; i < n; i += 1) {
    const r = rev[i];
    if (r > i) {
      let tmp = re[i]; re[i] = re[r]; re[r] = tmp;
      tmp = im[i]; im[i] = im[r]; im[r] = tmp;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j += 1) {
        const k = j * step;
        const tre = re[i + j + half] * cos[k] - im[i + j + half] * sin[k];
        const tim = re[i + j + half] * sin[k] + im[i + j + half] * cos[k];
        re[i + j + half] = re[i + j] - tre;
        im[i + j + half] = im[i + j] - tim;
        re[i + j] += tre;
        im[i + j] += tim;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Onset envelope + tempo + phase (pure — exported for tests)
// ---------------------------------------------------------------------------

/**
 * Spectral-flux onset envelope of mono PCM.
 * @param {Float32Array} pcm
 * @returns {Float64Array} one flux value per hop frame
 */
export function onsetEnvelope(pcm) {
  const frames = Math.max(0, Math.floor((pcm.length - FRAME) / HOP) + 1);
  const flux = new Float64Array(Math.max(0, frames));
  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  let prev = new Float64Array(FRAME / 2);
  let mags = new Float64Array(FRAME / 2);
  for (let f = 0; f < frames; f += 1) {
    const at = f * HOP;
    for (let i = 0; i < FRAME; i += 1) {
      re[i] = pcm[at + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    let sum = 0;
    for (let b = 0; b < FRAME / 2; b += 1) {
      const mag = Math.hypot(re[b], im[b]);
      mags[b] = mag;
      const d = mag - prev[b];
      if (d > 0) sum += d; // half-wave rectified flux
    }
    flux[f] = sum;
    const swap = prev;
    prev = mags;
    mags = swap;
  }
  // Remove the local mean (2 s window) so sustained loudness doesn't bias the
  // autocorrelation, then half-wave rectify.
  const out = new Float64Array(flux.length);
  const half = Math.round(FRAME_RATE);
  for (let i = 0; i < flux.length; i += 1) {
    const a = Math.max(0, i - half);
    const b = Math.min(flux.length - 1, i + half);
    let mean = 0;
    for (let j = a; j <= b; j += 1) mean += flux[j];
    mean /= b - a + 1;
    out[i] = Math.max(0, flux[i] - mean);
  }
  return out;
}

/**
 * Autocorrelation tempo estimate over BPM_MIN..BPM_MAX with harmonic
 * disambiguation (a comb over 1×/2×/4× the candidate lag).
 * @param {Float64Array} onset
 * @returns {{bpm: number, lag: number, score: number}}
 */
export function detectTempo(onset) {
  const n = onset.length;
  const minLag = Math.floor((FRAME_RATE * 60) / BPM_MAX);
  const maxLag = Math.ceil((FRAME_RATE * 60) / BPM_MIN);
  const ac = new Float64Array(maxLag + 3);
  let norm = 0;
  for (let i = 0; i < n; i += 1) norm += onset[i] * onset[i];
  if (norm <= 0) return { bpm: 100, lag: (FRAME_RATE * 60) / 100, score: 0 };
  for (let lag = 1; lag <= maxLag + 2; lag += 1) {
    let sum = 0;
    for (let i = 0; i + lag < n; i += 1) sum += onset[i] * onset[i + lag];
    ac[lag] = sum / norm;
  }
  let best = { lag: minLag, score: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    // Comb: reward candidates whose double/quadruple periods also correlate —
    // this pulls e.g. a 150 BPM offbeat reading back down to the true 75.
    let score = ac[lag];
    const l2 = lag * 2;
    const l4 = lag * 4;
    if (l2 < ac.length) score += 0.5 * ac[l2];
    else if (l2 / 2 < ac.length) score += 0.5 * ac[lag];
    if (l4 < ac.length) score += 0.25 * ac[l4];
    if (score > best.score) best = { lag, score };
  }
  // Parabolic interpolation around the winning integer lag.
  let lag = best.lag;
  const y0 = ac[best.lag - 1] ?? 0;
  const y1 = ac[best.lag];
  const y2 = ac[best.lag + 1] ?? 0;
  const denom = y0 - 2 * y1 + y2;
  if (Math.abs(denom) > 1e-12) {
    const delta = (0.5 * (y0 - y2)) / denom;
    if (Math.abs(delta) <= 1) lag += delta;
  }
  const bpm = (FRAME_RATE * 60) / lag;
  return { bpm, lag, score: best.score };
}

/**
 * Phase fit: beat-grid offset in [0, period) maximizing onset energy at the
 * grid points (linear interpolation between frames).
 * @param {Float64Array} onset
 * @param {number} bpm
 * @returns {number} offsetSec
 */
export function fitPhase(onset, bpm) {
  const periodFrames = (FRAME_RATE * 60) / bpm;
  const steps = 64;
  let best = { phase: 0, score: -Infinity };
  for (let s = 0; s < steps; s += 1) {
    const phase = (s / steps) * periodFrames;
    let score = 0;
    for (let t = phase; t < onset.length - 1; t += periodFrames) {
      const i = Math.floor(t);
      const frac = t - i;
      score += onset[i] * (1 - frac) + onset[i + 1] * frac;
    }
    if (score > best.score) best = { phase, score };
  }
  // The FFT frame reports energy centered mid-frame; add half a frame.
  return (best.phase * HOP + FRAME / 2) / SAMPLE_RATE;
}

/**
 * On-beat vs off-beat onset energy of a bpm grid at its best phase — the
 * half/double disambiguation metric (a true beat grid has high energy ON the
 * grid and little at the half-period points; a half-tempo reading scores both
 * equally because its "offbeats" are real beats).
 * @param {Float64Array} onset @param {number} bpm
 * @returns {{ratio: number, phaseFrames: number}}
 */
export function gridContrast(onset, bpm) {
  const period = (FRAME_RATE * 60) / bpm;
  const steps = 64;
  let best = { phase: 0, score: -Infinity };
  for (let s = 0; s < steps; s += 1) {
    const phase = (s / steps) * period;
    let score = 0;
    for (let t = phase; t < onset.length - 1; t += period) {
      const i = Math.floor(t);
      const frac = t - i;
      score += onset[i] * (1 - frac) + onset[i + 1] * frac;
    }
    if (score > best.score) best = { phase, score };
  }
  let on = 0;
  let off = 0;
  let count = 0;
  for (let t = best.phase; t + period / 2 < onset.length - 1; t += period) {
    const i = Math.floor(t);
    const f = t - i;
    on += onset[i] * (1 - f) + onset[i + 1] * f;
    const u = t + period / 2;
    const j = Math.floor(u);
    const g = u - j;
    off += onset[j] * (1 - g) + onset[j + 1] * g;
    count += 1;
  }
  if (count === 0) return { ratio: 0, phaseFrames: best.phase };
  return { ratio: (on / count) / Math.max(1e-9, off / count), phaseFrames: best.phase };
}

/**
 * Full analysis of a mono PCM buffer. The autocorrelation comb prefers slow
 * (half-time) readings, so the final tempo is picked between the candidate
 * and its double by grid contrast (measured on the three shipped Recap
 * tracks: the double grid wins 175:1 on the orchestral fallback).
 * @param {Float32Array} pcm
 * @returns {{bpm: number, offsetSec: number, beatsPerBar: number}}
 */
export function analyzePcm(pcm) {
  const onset = onsetEnvelope(pcm);
  let { bpm } = detectTempo(onset);
  const doubled = bpm * 2;
  if (doubled <= BPM_MAX && gridContrast(onset, doubled).ratio > gridContrast(onset, bpm).ratio) {
    bpm = doubled;
  }
  const offsetRaw = fitPhase(onset, bpm);
  const period = 60 / bpm;
  const offsetSec = ((offsetRaw % period) + period) % period;
  return {
    bpm: Math.round(bpm * 10) / 10,
    offsetSec: Math.round(offsetSec * 100) / 100,
    beatsPerBar: 4,
  };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

async function decodeMono(file) {
  const { stdout } = await execFileP(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }
  );
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
}

/** beats/ dir + basename for a track file under public/assets/. */
function beatsTarget(assetRel) {
  const abs = path.join(ASSETS, assetRel);
  const basename = path.basename(assetRel).replace(/\.(mp3|ogg)$/i, '');
  const root = assetRel.startsWith('music/') ? path.join(ASSETS, 'music') : path.join(ASSETS, 'GoobyMusic');
  return { abs, basename, beatsDir: path.join(root, 'beats') };
}

async function processFile(assetRel) {
  const { abs, basename, beatsDir } = beatsTarget(assetRel);
  if (!fs.existsSync(abs)) {
    console.error(`[beats] MISSING file: ${assetRel}`);
    process.exitCode = 1;
    return;
  }
  const pcm = await decodeMono(abs);
  const grid = analyzePcm(pcm);
  const overrideFile = path.join(beatsDir, `${basename}.beats.override.json`);
  const outFile = path.join(beatsDir, `${basename}.beats.json`);
  fs.mkdirSync(beatsDir, { recursive: true });
  const bytes = `${JSON.stringify(grid, null, 2)}\n`;
  const previous = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null;
  fs.writeFileSync(outFile, bytes);
  const overridden = fs.existsSync(overrideFile);
  console.log(
    `[beats] ${assetRel} → bpm ${grid.bpm}, offset ${grid.offsetSec}s, ${grid.beatsPerBar}/4` +
      `${previous === bytes ? ' (byte-stable)' : ''}` +
      `${overridden ? ` — NOTE: ${basename}.beats.override.json exists and WINS at runtime (§B5.3)` : ''}`
  );
}

async function main() {
  try {
    await execFileP('ffmpeg', ['-version']);
  } catch {
    console.error('[beats] FATAL: ffmpeg not found on PATH');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  let targets = [];
  if (args.length > 0) {
    targets = args.map((a) => {
      const abs = path.resolve(a);
      const rel = path.relative(ASSETS, abs).split(path.sep).join('/');
      if (rel.startsWith('..')) throw new Error(`${a} is not under public/assets/`);
      return rel;
    });
  } else {
    if (!fs.existsSync(MANIFEST)) {
      console.log('[beats] no musicManifest.json — run `npm run music-manifest` first; nothing to do');
      return;
    }
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    targets = (manifest.tracks ?? []).filter((t) => t.category === 'Recap').map((t) => t.file);
    if (targets.length === 0) {
      console.log('[beats] no Recap tracks in the manifest — nothing to do');
      return;
    }
  }
  for (const rel of targets) await processFile(rel);
  console.log('[beats] done — remember to re-run `npm run music-manifest` so manifest beats paths pick up new files');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[beats] FATAL:', err);
    process.exit(1);
  });
}
