#!/usr/bin/env node
// GOOBY V4/G51 — build-time music manifest generator (PLAN4 §B2.1/§B2.2,
// §C-SYS1.1; npm script `music-manifest`).
//
// Scans BOTH music roots and writes the committed src/data/musicManifest.json:
//   · public/assets/GoobyMusic/**  — owner uploads (source 'owner'), scanned
//     RECURSIVELY because the owner organizes tracks in category folders
//     (the live convention, superseding the flat "Kategorie - Titel.mp3"
//     naming for foldered files — root files still use the §B2.1 names):
//       Radio/                       free radio tracks (station 'gooby-fm')
//       Radio/Level N/  +  Radio/LockedbyLevel/Level N/
//                                    level-locked radio tracks → unlockLevel N
//       Rooms/<Room>[/Awake|Sleeping]  per-room home tracks → context 'room:*'
//       Games/<Game>/                per-game themes → context 'game:<id>'
//       Locations/<Loc>/             city/IKEA/vet trips → context 'location:*'
//       <root> Recap*/Stinger*       recap songs + one-shot stingers
//   · public/assets/music/          — committed CC0 Bordmusik set (source
//     'builtin', flat §C-SYS1.7 names).
//
// Per track (§B2.2): ffprobe duration (1 decimal), ffmpeg volumedetect
// loudness trim to the −16 dBFS-ish mean target (2 decimals, clamp 0.3–2.0),
// cover lookup (§C-SYS1.6 — exact basename, then sanitized basename, else
// null + warning; fallback art is runtime: covers/cover_default.png), beats
// manifest lookup (§B5.3 — <root>/beats/<basename>.beats.override.json wins
// over .beats.json).
//
// Deterministic (sorted by id, stable dedupe), idempotent (byte-stable
// re-runs), graceful when both folders are empty → { "v": 1, "tracks": [] }.
// Owner workflow: drop a file in the right folder → `npm run music-manifest`
// → the track is in the game. NO code changes per track, ever.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execFileP = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
const OWNER_ROOT = path.join(ASSETS, 'GoobyMusic');
const BUILTIN_ROOT = path.join(ASSETS, 'music');
const COVERS_DIR = path.join(OWNER_ROOT, 'covers');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'musicManifest.json');

/** §B2.2: loudness-normalize target for the mean-RMS trim (dBFS-ish). */
export const TRIM_TARGET_DB = -16;
/** §B2.2: gainTrim clamp. */
export const TRIM_CLAMP = Object.freeze({ min: 0.3, max: 2.0 });
/** §B2.1: files shorter than this are auto-categorized 'Stinger'. */
export const STINGER_MAX_SEC = 10;
/** Audio extensions the scan accepts (§B2.2). */
const AUDIO_EXT = /\.(mp3|ogg)$/i;
/** Directories under the roots that never contain tracks. */
const SKIP_DIRS = new Set(['covers', 'beats']);

/** Known §B2.1 categories for root-file name parsing. */
const NAME_CATEGORIES = new Set(['Radio', 'Recap', 'Game', 'Stinger', 'Bordmusik']);

/** Owner room folders → roomManager room ids (frozen folder convention). */
export const ROOM_FOLDER_IDS = Object.freeze({
  kitchen: 'kitchen',
  mainroomlivingroom: 'living',
  livingroom: 'living',
  living: 'living',
  bathroom: 'bathroom',
  bedroom: 'bedroom',
  garden: 'garden',
});

/** Owner game folders → minigame registry ids (frozen folder convention). */
export const GAME_FOLDER_IDS = Object.freeze({
  'gooby surfer': 'shoppingSurf',
  goobywelt: 'goobyWelt',
  harbor: 'harborHopper',
  purbleplace: 'purblePlace',
  racing: 'toyRacer',
  space: 'starHopper',
  spooky: 'ghostHunt',
});

/** Owner location folders → context ids (IKEA is the shop trip target). */
export const LOCATION_FOLDER_IDS = Object.freeze({
  city: 'city',
  ikea: 'shop',
  vet: 'vet',
});

/**
 * Kebab-slug with diacritics folded (§B2.1 track ids) — same rules as the
 * radio UI's slug so both sides derive identical ids from titles.
 * @param {string} text
 * @returns {string}
 */
export function slug(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'track';
}

/**
 * §C-SYS1.6 sanitized-basename fallback for cover lookups: diacritics folded
 * + filesystem-hostile characters flattened, so covers generated on stricter
 * filesystems still match (exact basename match is tried first).
 * @param {string} basename file basename WITHOUT extension
 * @returns {string}
 */
export function sanitizeBasename(basename) {
  return String(basename ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._()!'-]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Title cleanup for one file basename (no extension): strips the constant
 * "Gooby der Dicke Hase" artist prefix, the "Treblo" generator suffix and a
 * trailing " (n)" duplicate marker; splits on " - " per §B2.1.
 * @param {string} basename
 * @returns {{nameCategory: string|null, title: string}} nameCategory is the
 *   §B2.1 category encoded in the FILENAME (root files), else null
 */
export function parseName(basename) {
  const cleaned = String(basename ?? '').replace(/\s*\(\d+\)\s*$/, '').trim();
  let parts = cleaned.split(' - ').map((s) => s.trim()).filter(Boolean);
  // Strip the generator suffix FIRST, then ONE artist prefix — a song titled
  // "Gooby der Dicke Hase" itself must keep its name.
  while (parts.length > 1 && /^treblo$/i.test(parts.at(-1))) parts = parts.slice(0, -1);
  if (parts.length > 1 && /^gooby der dicke hase$/i.test(parts[0])) parts = parts.slice(1);
  let nameCategory = null;
  if (parts.length > 1 && NAME_CATEGORIES.has(parts[0])) {
    nameCategory = parts[0];
    parts = parts.slice(1);
  } else {
    const prefix = /^(Recap|Stinger)\b/i.exec(parts[0] ?? '');
    if (prefix) nameCategory = prefix[1][0].toUpperCase() + prefix[1].slice(1).toLowerCase();
  }
  return { nameCategory, title: parts.join(' - ') || cleaned };
}

/**
 * Derive category / context / variant / unlockLevel from an owner-root
 * relative path (forward slashes, no extension handling here).
 * @param {string[]} dirs path segments WITHOUT the filename
 * @param {string} basename filename without extension
 * @param {(msg: string) => void} warn
 * @returns {{category: string, context: string|null, variant: string|null,
 *   unlockLevel: number, nameCategory: string|null}}
 */
export function classifyOwnerPath(dirs, basename, warn = () => {}) {
  const { nameCategory } = parseName(basename);
  let unlockLevel = 1;
  for (const seg of dirs) {
    const m = /^level\s*(\d+)$/i.exec(seg.trim());
    if (m) unlockLevel = Math.max(unlockLevel, parseInt(m[1], 10));
  }
  const top = (dirs[0] ?? '').toLowerCase();
  if (top === 'radio') return { category: 'Radio', context: null, variant: null, unlockLevel, nameCategory };
  if (top === 'rooms') {
    const roomKey = (dirs[1] ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (roomKey === 'arcadeuimusic') {
      return { category: 'Room', context: 'arcade', variant: null, unlockLevel, nameCategory };
    }
    const roomId = ROOM_FOLDER_IDS[roomKey];
    if (!roomId) {
      warn(`unknown Rooms/ folder '${dirs[1]}' — track joins 'alle' only`);
      return { category: 'Room', context: null, variant: null, unlockLevel, nameCategory };
    }
    const sub = (dirs[2] ?? '').toLowerCase();
    const variant = sub === 'sleeping' ? 'sleeping' : sub === 'awake' ? 'awake' : null;
    return { category: 'Room', context: `room:${roomId}`, variant, unlockLevel, nameCategory };
  }
  if (top === 'games') {
    const folder = (dirs[1] ?? '').trim();
    const gameId = GAME_FOLDER_IDS[folder.toLowerCase()] ?? null;
    if (!gameId) warn(`unknown Games/ folder '${folder}' — using slug '${slug(folder)}'`);
    return {
      category: 'Game',
      context: `game:${gameId ?? slug(folder)}`,
      variant: null,
      unlockLevel,
      nameCategory,
    };
  }
  if (top === 'locations') {
    const folder = (dirs[1] ?? '').trim();
    const locId = LOCATION_FOLDER_IDS[folder.toLowerCase()] ?? null;
    if (!locId) warn(`unknown Locations/ folder '${folder}' — using slug '${slug(folder)}'`);
    return {
      category: 'Location',
      context: `location:${locId ?? slug(folder)}`,
      variant: null,
      unlockLevel,
      nameCategory,
    };
  }
  if (dirs.length === 0) {
    // Root files carry their §B2.1 category in the name (Recap/Stinger…).
    if (nameCategory) return { category: nameCategory, context: null, variant: null, unlockLevel, nameCategory };
    warn(`'${basename}': no category folder or name prefix — treated as Radio (§B2.1)`);
    return { category: 'Radio', context: null, variant: null, unlockLevel, nameCategory };
  }
  warn(`unknown GoobyMusic folder '${dirs.join('/')}' — treated as Radio (§B2.1)`);
  return { category: 'Radio', context: null, variant: null, unlockLevel, nameCategory };
}

/** Recursively list audio files under a root (relative posix paths). */
function listAudioFiles(root) {
  const out = [];
  const walk = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name.toLowerCase())) walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
      } else if (AUDIO_EXT.test(e.name)) {
        out.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  walk(root, '');
  return out.sort((a, b) => a.localeCompare(b, 'en'));
}

/** ffprobe duration in seconds (float). */
async function probeDuration(file) {
  const { stdout } = await execFileP('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ]);
  const sec = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) throw new Error(`ffprobe returned no duration for ${file}`);
  return sec;
}

/** ffmpeg volumedetect mean_volume in dB (negative float). */
async function probeMeanVolume(file) {
  const { stderr } = await execFileP('ffmpeg', [
    '-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const m = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(stderr);
  if (!m) throw new Error(`volumedetect produced no mean_volume for ${file}`);
  return Number.parseFloat(m[1]);
}

/**
 * §B2.2 gainTrim from a measured mean volume: trim toward TRIM_TARGET_DB,
 * clamped 0.3–2.0, rounded to 2 decimals.
 * @param {number} meanDb
 * @returns {number}
 */
export function gainTrimFor(meanDb) {
  const raw = 10 ** ((TRIM_TARGET_DB - meanDb) / 20);
  const clamped = Math.min(TRIM_CLAMP.max, Math.max(TRIM_CLAMP.min, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * §C-SYS1.6 cover lookup: exact basename first, sanitized basename second.
 * @param {string} basename file basename without extension
 * @returns {string|null} path relative to /assets/ or null
 */
function findCover(basename) {
  for (const candidate of [basename, sanitizeBasename(basename)]) {
    const abs = path.join(COVERS_DIR, `${candidate}.png`);
    if (fs.existsSync(abs)) return `GoobyMusic/covers/${candidate}.png`;
  }
  return null;
}

/**
 * §B5.3 beats lookup with override precedence.
 * @param {string} rootRel 'GoobyMusic'|'music'
 * @param {string} rootAbs
 * @param {string} basename
 * @returns {string|null}
 */
function findBeats(rootRel, rootAbs, basename) {
  for (const suffix of ['.beats.override.json', '.beats.json']) {
    const rel = `beats/${basename}${suffix}`;
    if (fs.existsSync(path.join(rootAbs, rel))) return `${rootRel}/${rel}`;
  }
  return null;
}

/**
 * Build the manifest track list from pre-measured file rows (pure — the
 * ffprobe I/O happens in main(); tests feed synthetic rows).
 * @param {Array<{root: 'owner'|'builtin', rel: string, durationSec: number,
 *   meanDb: number}>} rows
 * @param {{warn?: (msg: string) => void, findCover?: typeof findCover,
 *   findBeats?: typeof findBeats}} [io]
 * @returns {object} the manifest object
 */
export function buildManifest(rows, io = {}) {
  const warn = io.warn ?? ((msg) => console.warn(`[music-manifest] WARN: ${msg}`));
  const coverOf = io.findCover ?? findCover;
  const beatsOf = io.findBeats ?? findBeats;
  const tracks = [];
  for (const row of [...rows].sort((a, b) => `${a.root}/${a.rel}`.localeCompare(`${b.root}/${b.rel}`, 'en'))) {
    const segs = row.rel.split('/');
    const filename = segs.at(-1);
    const basename = filename.replace(AUDIO_EXT, '');
    const dirs = segs.slice(0, -1);
    const { title } = parseName(basename);
    let category;
    let context = null;
    let variant = null;
    let unlockLevel = 1;
    if (row.root === 'builtin') {
      const { nameCategory } = parseName(basename);
      category = nameCategory && nameCategory !== 'Radio' ? nameCategory : 'Bordmusik';
      if (!nameCategory) warn(`builtin '${basename}': no §B2.1 category prefix — treated as Bordmusik`);
    } else {
      ({ category, context, variant, unlockLevel } = classifyOwnerPath(dirs, basename, warn));
    }
    const durationSec = Math.round(row.durationSec * 10) / 10;
    if (durationSec < STINGER_MAX_SEC && category !== 'Stinger') {
      warn(`'${basename}' is ${durationSec}s (<${STINGER_MAX_SEC}s) — auto-categorized Stinger (§B2.1)`);
      category = 'Stinger';
      context = null;
    }
    const cover = coverOf(basename);
    if (!cover) warn(`no cover for '${basename}' (§C-SYS1.6 covers/<basename>.png) — falls back to cover_default.png`);
    tracks.push({
      id: slug(variant ? `${category}-${title}-${variant}` : `${category}-${title}`),
      file: row.root === 'builtin' ? `music/${row.rel}` : `GoobyMusic/${row.rel}`,
      category,
      title,
      source: row.root === 'builtin' ? 'builtin' : 'owner',
      durationSec,
      gainTrim: gainTrimFor(row.meanDb),
      unlockLevel,
      context,
      variant,
      cover,
      beats: beatsOf(
        row.root === 'builtin' ? 'music' : 'GoobyMusic',
        row.root === 'builtin' ? BUILTIN_ROOT : OWNER_ROOT,
        basename
      ),
    });
  }
  // Stable id dedupe (owner duplicates like "… (1).mp3" copies): scan order is
  // path-sorted, later collisions get -2, -3, … suffixes.
  const seen = new Map();
  for (const t of tracks) {
    const n = (seen.get(t.id) ?? 0) + 1;
    seen.set(t.id, n);
    if (n > 1) {
      warn(`duplicate id '${t.id}' (${t.file}) — deduped as '${t.id}-${n}'`);
      t.id = `${t.id}-${n}`;
    }
  }
  tracks.sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return { v: 1, tracks };
}

/** Serialize byte-stably (2-space JSON, LF, trailing newline). */
export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function main() {
  for (const tool of ['ffprobe', 'ffmpeg']) {
    try {
      await execFileP(tool, ['-version']);
    } catch {
      console.error(`[music-manifest] FATAL: '${tool}' not found on PATH — install ffmpeg`);
      process.exit(1);
    }
  }
  const jobs = [
    ...listAudioFiles(OWNER_ROOT).map((rel) => ({ root: /** @type {'owner'} */ ('owner'), rel, abs: path.join(OWNER_ROOT, rel) })),
    ...listAudioFiles(BUILTIN_ROOT).map((rel) => ({ root: /** @type {'builtin'} */ ('builtin'), rel, abs: path.join(BUILTIN_ROOT, rel) })),
  ];
  console.log(`[music-manifest] scanning ${jobs.length} file(s) (owner ${jobs.filter((j) => j.root === 'owner').length} / builtin ${jobs.filter((j) => j.root === 'builtin').length})`);
  const rows = [];
  const WORKERS = 4;
  let next = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      const [durationSec, meanDb] = await Promise.all([probeDuration(job.abs), probeMeanVolume(job.abs)]);
      rows.push({ root: job.root, rel: job.rel, durationSec, meanDb });
      console.log(`  · ${job.root}/${job.rel} — ${durationSec.toFixed(1)}s, mean ${meanDb.toFixed(1)} dB`);
    }
  }));
  const manifest = buildManifest(rows);
  const bytes = serializeManifest(manifest);
  const previous = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;
  fs.writeFileSync(OUT_FILE, bytes);
  console.log(`[music-manifest] wrote ${path.relative(ROOT, OUT_FILE)} — ${manifest.tracks.length} track(s)${previous === bytes ? ' (byte-stable, unchanged)' : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[music-manifest] FATAL:', err);
    process.exit(1);
  });
}
