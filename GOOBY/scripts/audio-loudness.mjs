// audio-loudness.mjs — V3/G32 (PLAN3 §B2.5): offline loudness measurement of
// every committed audio ogg. Runs at build-agent time (needs ffmpeg on PATH),
// NOT in CI — the committed src/audio/loudness.json is the durable output.
//
//   node scripts/audio-loudness.mjs            # rewrite src/audio/loudness.json
//   node scripts/audio-loudness.mjs --check    # exit 1 if json is stale/missing keys
//
// Measures the mean RMS level (ffmpeg volumedetect `mean_volume`, dBFS) of
// every `public/assets/kenney/<slug>/audio/*.ogg` and writes a flat
// `{ '<slug>/<name>': dBFS }` map. sfxMap.js volumes were recomputed ONCE
// against the §B2.5 targets (one-shots −16 dBFS, jingles −18, loops −20) and
// hand-tuned per the §C3.5 offender table; test/audioCoverage.test.js asserts
// every sample key in SFX_MAP has an entry here.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KENNEY = path.join(ROOT, 'public', 'assets', 'kenney');
const OUT = path.join(ROOT, 'src', 'audio', 'loudness.json');

/**
 * ffmpeg volumedetect logs to STDERR — spawnSync exposes both streams.
 * @param {string} file @returns {number|null} mean RMS in dBFS
 */
function measure(file) {
  const res = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  const text = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(text);
  if (!m) {
    console.error(`[loudness] ffmpeg gave no mean_volume for ${file}:`, res.error?.message ?? text.slice(-300));
    return null;
  }
  return Number(m[1]);
}

function collectOggs() {
  /** @type {Record<string, string>} key → absolute file path */
  const files = {};
  for (const slug of fs.readdirSync(KENNEY)) {
    const audioDir = path.join(KENNEY, slug, 'audio');
    if (!fs.existsSync(audioDir) || !fs.statSync(audioDir).isDirectory()) continue;
    for (const name of fs.readdirSync(audioDir)) {
      if (!name.endsWith('.ogg')) continue;
      files[`${slug}/${name.slice(0, -4)}`] = path.join(audioDir, name);
    }
  }
  return files;
}

const files = collectOggs();
const keys = Object.keys(files).sort();

if (process.argv.includes('--check')) {
  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  const missing = keys.filter((k) => typeof existing[k] !== 'number');
  if (missing.length > 0) {
    console.error(`[loudness] ${missing.length} committed ogg(s) missing from loudness.json:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`[loudness] loudness.json covers all ${keys.length} committed oggs — OK`);
  process.exit(0);
}

/** @type {Record<string, number>} */
const result = {};
let done = 0;
for (const key of keys) {
  const db = measure(files[key]);
  if (db == null) {
    console.error(`[loudness] no mean_volume for '${key}' — aborting (bad file?)`);
    process.exit(1);
  }
  result[key] = Math.round(db * 10) / 10; // 0.1 dB precision is plenty
  done += 1;
  if (done % 50 === 0) console.log(`[loudness] ${done}/${keys.length}…`);
}

// repo convention: CRLF endings (AGENTS.md — mixed endings make noisy diffs)
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`.replace(/\n/g, '\r\n'));
console.log(`[loudness] wrote ${keys.length} entries → ${path.relative(ROOT, OUT)}`);
