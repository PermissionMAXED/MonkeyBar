#!/usr/bin/env node
/**
 * GOOBY — itch.io + splat asset fetcher (PLAN4.md §B3, §E block G50).
 *
 * 4.0 counterpart of fetch-kenney/fetch-kaykit: copies ONLY the whitelisted
 * files below from the local staging libraries into the repo. There is NO
 * network path — itch.io downloads are not scriptable; the staging libraries
 * (D1/D2 scout output) are the single source:
 *   /workspace/asset-staging/itchio/   (override: --staging <path>)
 *   /workspace/asset-staging/splats/   (override: --splats <path>)
 *
 * Committed layout (consumed by src/core/assets.js — see AUDIO_PACK_ROOTS +
 * PACK_FORMATS there):
 *   public/assets/music/<Kategorie - Titel>.ogg      + LICENSES.md   (§C-SYS1.7)
 *   public/assets/itch/itch-sfx/<name>.ogg           + LICENSE-NOTE.md (§C-SYS1.9)
 *   public/assets/itch/vfx/<name>.png                + LICENSE-NOTE.md (§C-SYS4.5)
 *   public/assets/itch/<pack>/<key>.glb              (baked-goods, aline-furniture)
 *   public/assets/itch/<pack>/<key>.gltf + .bin + shared texture
 *                                                    (bakery-interior, pleasant-picnic)
 *   public/assets/vfx/streak_a.png|streak_b.png      (§E0.1-5, PLAN4-GAMES §G4.2)
 *   public/assets/splats/<file>.compressed.ply + <sceneId>.LICENSE.txt (§G6.2)
 *
 * Model asset keys stay `'<pack>/<file-no-ext>'` (PLAN3 §E0.1 convention):
 * `'pleasant-picnic/radio'` (§C-SYS1.4), `'baked-goods/croissant'` (§G9.3 —
 * the plan's `itch/baked-goods/croissant` spelling maps to this key; the
 * `itch` segment is the ROOT, carried by PACK_FORMATS, not the key).
 * Audio keys: `'itch-sfx/<file>'` → assets/itch/itch-sfx/<file>.ogg (§B3).
 *
 * Baked-goods glTF+BIN(+texture) are converted to self-contained GLB
 * (§G9.3 — ≤ 60 KB each); bakery-interior/pleasant-picnic keep the KayKit
 * .gltf form (shared per-pack atlas, deduped by the V3/FIX-E texture cache).
 *
 * Fails loudly on missing staging files and per-file oversizes. Idempotent:
 * output files are only rewritten when bytes differ — a re-run against
 * unchanged staging is a byte-stable no-op (verified by `git status`).
 *
 * Pure Node (fs/child_process) — unzip(1) for the staged archives.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');

const argAfter = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : null;
};
const ITCH_STAGING = argAfter('--staging') ?? '/workspace/asset-staging/itchio';
const SPLAT_STAGING = argAfter('--splats') ?? '/workspace/asset-staging/splats';

const KB = 1024;
const MB = 1024 * 1024;

// ── Whitelist manifest (single source of truth; test/assets.test.js imports) ─

/**
 * §C-SYS1.7 INTERIM „Bordmusik" — exact renames (binding). `zip` is relative
 * to the itch staging root; `src` is the path inside the zip; `dir` entries
 * are loose staging files. All CC0.
 * @type {Array<{zip?: string, dir?: string, src: string, out: string}>}
 */
export const MUSIC_FILES = [
  { zip: 'playful-piano/playful-piano.zip', src: 'PLAYFUL PIANO/PlayfulPiano_Original_Loop.ogg', out: 'Bordmusik - Playful Piano.ogg' },
  { zip: 'playful-piano/playful-piano.zip', src: 'PLAYFUL PIANO/PlayfulPiano_Atmos_Loop.ogg', out: 'Bordmusik - Piano Atmos.ogg' },
  { zip: 'playful-piano/playful-piano.zip', src: 'PLAYFUL PIANO/PlayfulPiano_JazzTrio_Loop.ogg', out: 'Bordmusik - Piano Jazz.ogg' },
  { zip: 'playful-piano/playful-piano.zip', src: 'PLAYFUL PIANO/PlayfulPiano_Melody_Loop.ogg', out: 'Bordmusik - Piano Melodie.ogg' },
  { zip: 'playful-piano/playful-piano.zip', src: 'PLAYFUL PIANO/PlayfulPiano_Strings_Loop.ogg', out: 'Bordmusik - Piano Streicher.ogg' },
  { zip: 'tallbeard-music-loop-bundle/music-loop-bundle-chiptune.zip', src: 'Three Red Hearts Rabbit Town.ogg', out: 'Bordmusik - Rabbit Town.ogg' },
  { zip: 'tallbeard-music-loop-bundle/music-loop-bundle-chiptune.zip', src: 'Three Red Hearts Penguin Town.ogg', out: 'Bordmusik - Penguin Town.ogg' },
  { zip: 'tallbeard-music-loop-bundle/music-loop-bundle-chiptune.zip', src: 'Three Red Hearts Candy.ogg', out: 'Bordmusik - Candy.ogg' },
  { zip: 'tallbeard-music-loop-bundle/music-loop-bundle-chiptune.zip', src: 'Three Red Hearts Puzzle Pieces.ogg', out: 'Bordmusik - Puzzle Pieces.ogg' },
  { zip: 'tallbeard-music-loop-bundle/music-loop-bundle-2026-q2.zip', src: 'Week 16 - Vacation Day CHILLOUT.ogg', out: 'Bordmusik - Vacation Day.ogg' },
  { zip: 'tallbeard-music-loop-bundle/music-loop-bundle-2026-q2.zip', src: 'Week 26 - Seaside CORAL REEF.ogg', out: 'Bordmusik - Seaside.ogg' },
  { zip: 'tallbeard-music-loop-bundle/music-loop-bundle-2026-q2.zip', src: 'Week 23 - Workshop BREADBOARD.ogg', out: 'Bordmusik - Werkstatt.ogg' },
  { dir: 'ragnar-orchestral-world-music', src: '02-the-town-where-i-got-the-magic-bottle.ogg', out: 'Bordmusik - Magic Bottle Town.ogg' },
  // §C-SYS2.6 recap fallback — category Recap, joins the recap-fm station.
  { dir: 'ragnar-orchestral-world-music', src: '04-youthful-elf-seeking-adventure.ogg', out: 'Recap - Abenteuer.ogg' },
];

/** Music staging packs whose LICENSE-NOTE.md consolidates into LICENSES.md. */
export const MUSIC_LICENSE_PACKS = [
  'playful-piano',
  'tallbeard-music-loop-bundle',
  'ragnar-orchestral-world-music',
];

const SFX_ZIP = 'interface-sfx-pack-1/interface-sfx-pack-1-ogg.zip';

/**
 * §C-SYS1.9 curated ObsydianX Interface SFX subset (26 OGGs) — every file the
 * §C-SYS1.9.2 replacement table references (rows 12–15, 21, 24, 34, 35, 37,
 * 43–46), flat-copied from Ogg/** with names kept. All CC0.
 * @type {Array<{src: string, out: string}>}
 */
export const ITCH_SFX = [
  ...[1, 2, 3].map((n) => `Back_tones/style2/back_style_2_00${n}.ogg`),
  ...[1, 2, 3].map((n) => `Back_tones/style3/back_style_3_00${n}.ogg`),
  // Cursor tones ship as ONE file per style (no numbered variants in the
  // staged pack) — the §C-SYS1.9.2 `cursor_style_2_001..003`/`_4_001` picks
  // resolve to these two files; rate variation covers the table's pitching.
  'Cursor_tones/cursor_style_2.ogg', // dance.perfect / dance.good (rate 1.2/1.0)
  'Cursor_tones/cursor_style_4.ogg', // says.pad1..4 via playbackRate
  ...[1, 2, 3, 4, 5, 6].map((n) => `Confirm_tones/style1/confirm_style_1_00${n}.ogg`),
  ...[1, 2, 3].map((n) => `Confirm_tones/style4/confirm_style_4_00${n}.ogg`),
  ...[1, 2, 3].map((n) => `Confirm_tones/style5/confirm_style_5_00${n}.ogg`),
  // vet.cure row (§C-SYS1.9.2 #37): style6 tones ARE the echoing/magical
  // variants — the pack ships no separate `_echo_` files for confirm style6.
  ...[1, 2].map((n) => `Confirm_tones/style6/confirm_style_6_00${n}.ogg`),
].map((p) => ({ src: `Ogg/${p}`, out: path.posix.basename(p) }));

const VFX_ZIP = 'brackeys-vfx-bundle/brackeys-vfx-bundle-v1.zip';

/** §C-SYS4.5 modifier-glow textures → public/assets/itch/vfx/ (§B3). CC0. */
export const VFX_TEXTURES = [
  'circle_04.png',
  'circle_05.png',
  'twirl_01.png',
  'twirl_02.png',
  'flare_01.png',
  'star_03.png',
].map((name) => ({ src: `brackeys_vfx_bundle/particles/opague/${name}`, out: name }));

/**
 * §E0.1-5 / PLAN4-GAMES §G4.2 surf speed-line streaks → public/assets/vfx/
 * (white-on-alpha, ≤ 20 KB each). Brackeys light-streak alpha variants. CC0.
 */
export const STREAK_TEXTURES = [
  { src: 'brackeys_vfx_bundle/particles/alpha/trace_01_a.png', out: 'streak_a.png' },
  { src: 'brackeys_vfx_bundle/particles/alpha/trace_07_a.png', out: 'streak_b.png' },
];

/**
 * Model packs → public/assets/itch/<slug>/. Forms:
 *   'glb'      — staged .gltf+.bin(+texture) CONVERTED to self-contained GLB
 *   'glb-copy' — staged self-contained .glb copied verbatim (renames allowed)
 *   'gltf'     — staged .gltf+.bin copied + ONE shared pack texture (KayKit
 *                form; the V3/FIX-E texture cache dedupes the atlas)
 * `maxBytes` guards each committed model file. All packs CC0.
 * @type {Array<object>}
 */
export const MODEL_PACKS = [
  {
    // PLAN4-GAMES §G9.3 — 3 new foods; keys `baked-goods/<key>` (the plan's
    // `itch/baked-goods/<key>` spelling — `itch` is the root, not the key).
    slug: 'baked-goods',
    zip: 'tiny-treats-baked-goods/free.zip',
    srcDir: 'Tiny_Treats_Baked_Goods_1.0_FREE/Assets/gltf',
    form: 'glb',
    maxBytes: 60 * KB, // §G9.3 binding
    files: [
      { key: 'croissant', file: 'croissant.gltf' },
      { key: 'cupcake', file: 'cupcake.gltf' },
      { key: 'cinnamon-roll', file: 'cinnamon_roll.gltf' },
    ],
    packLicense: 'Tiny_Treats_Baked_Goods_1.0_FREE/License.txt',
    noteDir: 'tiny-treats-baked-goods',
  },
  {
    // §G1.5 purble bakery dressing + §G9.1 kitchen „Purble-Bäckerei-Ecke":
    // display case, mixer, scale, register, macaron trio, dough props.
    slug: 'bakery-interior',
    zip: 'tiny-treats-bakery-interior/free-v1.1.zip',
    srcDir: 'Tiny_Treats_Bakery_Interior_1.1_FREE/Assets/gltf',
    form: 'gltf',
    maxBytes: 256 * KB,
    texture: 'tiny_treats_texture_1.png',
    files: [
      'display_case_long', 'display_case_short', 'stand_mixer', 'scale',
      'cash_register', 'macaron_blue', 'macaron_pink', 'macaron_yellow',
      'dough_ball', 'dough_rolled_A', 'dough_roller',
    ].map((key) => ({ key, file: `${key}.gltf` })),
    packLicense: 'Tiny_Treats_Bakery_Interior_1.1_FREE/License.txt',
    noteDir: 'tiny-treats-bakery-interior',
  },
  {
    // §C-SYS1.4 radio furniture GLTF + §G9.1 garden picnic basket(s).
    slug: 'pleasant-picnic',
    zip: 'tiny-treats-pleasant-picnic/free.zip',
    srcDir: 'Tiny_Treats_Pleasant_Picnic_1.0_FREE/Assets/gltf',
    form: 'gltf',
    maxBytes: 256 * KB,
    texture: 'tiny_treats_texture_1.png',
    files: [
      { key: 'radio', file: 'radio.gltf' },
      { key: 'picnic_basket_round', file: 'picnic_basket_round.gltf' },
      { key: 'picnic_basket_square', file: 'picnic_basket_square.gltf' },
    ],
    packLicense: 'Tiny_Treats_Pleasant_Picnic_1.0_FREE/License.txt',
    noteDir: 'tiny-treats-pleasant-picnic',
  },
  {
    // §G9.1 room dressing — Aline 4 GLBs. `bookshelf` = simple_library_A
    // (the multi-material library with baked-in books; plain `shelf.glb` is
    // an empty cube shelf — rename baked into the manifest, kenney pattern).
    slug: 'aline-furniture',
    zip: 'aline-furniture-asset-pack/furniture-pack-update-2.0.zip',
    srcDir: 'furniture_pack_update_2.0/models/gltf_format',
    form: 'glb-copy',
    maxBytes: 512 * KB,
    files: [
      { key: 'bookshelf', file: 'simple_library_A.glb' },
      { key: 'plant', file: 'plant.glb' },
      { key: 'cactus', file: 'cactus.glb' },
      { key: 'rug', file: 'rug.glb' },
    ],
    packLicense: 'furniture_pack_update_2.0/license.txt',
    noteDir: 'aline-furniture-asset-pack',
  },
];

/**
 * PLAN4-GAMES §G6.2 — the two shipped Gaussian-splat scenes (CC BY 4.0,
 * modified: decimated to 1M splats, SH0). LICENSE-NOTE.md committed alongside
 * as <sceneId>.LICENSE.txt; credits rows are MANDATORY (src/data/credits.js).
 * @type {Array<{sceneId: string, file: string, licenseSrc: string, maxBytes: number}>}
 */
export const SPLAT_SCENES = [
  {
    sceneId: 'windmill',
    file: 'windmill-golden-gate-mobile.compressed.ply',
    licenseSrc: 'windmill-golden-gate-source/LICENSE-NOTE.md',
    maxBytes: 16.5 * MB,
  },
  {
    sceneId: 'townsquare',
    file: 'ludlow-quality-square-mobile.compressed.ply',
    licenseSrc: 'ludlow-quality-square-source/LICENSE-NOTE.md',
    maxBytes: 16.5 * MB,
  },
];

/** Per-file size guards for flat copies. */
const SFX_MAX_BYTES = 200 * KB;
const VFX_MAX_BYTES = 150 * KB;
const STREAK_MAX_BYTES = 20 * KB; // §G4.2 binding
const MUSIC_MAX_BYTES = 6 * MB;

// ── Helpers ──────────────────────────────────────────────────────────────────

let written = 0;
let unchanged = 0;

/** Write only when bytes differ — keeps re-runs byte-stable no-ops. */
function writeIfChanged(dest, buf) {
  if (fs.existsSync(dest) && fs.readFileSync(dest).equals(buf)) {
    unchanged += 1;
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  written += 1;
  console.log(`  + ${path.relative(ROOT, dest)} (${(buf.length / KB).toFixed(1)} KB)`);
}

function mustExist(p, what) {
  if (!fs.existsSync(p)) {
    throw new Error(`missing ${what}: ${p}`);
  }
  return p;
}

function guardSize(buf, maxBytes, what) {
  if (buf.length > maxBytes) {
    throw new Error(
      `${what}: ${(buf.length / KB).toFixed(1)} KB exceeds the ` +
        `${(maxBytes / KB).toFixed(0)} KB whitelist cap`
    );
  }
}

/** zip (staging-relative) → extraction dir, extracted once per run. */
const zipRoots = new Map();
let tmpRoot = null;
function extracted(zipRel) {
  let dir = zipRoots.get(zipRel);
  if (dir) return dir;
  const zipAbs = mustExist(path.join(ITCH_STAGING, zipRel), 'staged zip');
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gooby-itch-'));
  dir = path.join(tmpRoot, zipRel.replace(/[\\/]/g, '__'));
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zipAbs, '-d', dir]);
  zipRoots.set(zipRel, dir);
  return dir;
}

const pad4 = (n) => (4 - (n % 4)) % 4;

/**
 * Convert a staged .gltf (+ sibling .bin + relative-URI textures) into ONE
 * self-contained binary glTF: external images are appended to the binary
 * buffer as bufferViews (mimeType image/png), the single buffer drops its
 * uri, JSON+BIN chunks are 4-byte aligned per the glTF 2.0 spec.
 * Deterministic for identical inputs (byte-stable re-runs).
 * @param {string} gltfPath
 * @returns {Buffer}
 */
function gltfToGlb(gltfPath) {
  const json = JSON.parse(fs.readFileSync(gltfPath, 'utf8'));
  const dir = path.dirname(gltfPath);
  if ((json.buffers ?? []).length !== 1 || !json.buffers[0].uri) {
    throw new Error(`${gltfPath}: expected exactly one external buffer`);
  }
  let bin = fs.readFileSync(
    mustExist(path.join(dir, decodeURIComponent(json.buffers[0].uri)), 'glTF buffer')
  );
  json.bufferViews ??= [];
  for (const img of json.images ?? []) {
    if (!img.uri || img.uri.startsWith('data:')) continue;
    const data = fs.readFileSync(
      mustExist(path.join(dir, decodeURIComponent(img.uri)), 'glTF image')
    );
    const offset = bin.length + pad4(bin.length);
    bin = Buffer.concat([bin, Buffer.alloc(pad4(bin.length)), data]);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.length });
    img.bufferView = json.bufferViews.length - 1;
    img.mimeType = img.mimeType ?? 'image/png';
    delete img.uri;
  }
  json.buffers = [{ byteLength: bin.length }];
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.from(' '.repeat(pad4(jsonBuf.length)))]);
  const binBuf = Buffer.concat([bin, Buffer.alloc(pad4(bin.length))]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jsonHdr = Buffer.alloc(8);
  jsonHdr.writeUInt32LE(jsonBuf.length, 0);
  jsonHdr.write('JSON', 4, 'ascii');
  const binHdr = Buffer.alloc(8);
  binHdr.writeUInt32LE(binBuf.length, 0);
  binHdr.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
  return Buffer.concat([header, jsonHdr, jsonBuf, binHdr, binBuf]);
}

/** Copy a staging pack's LICENSE-NOTE.md into the committed pack folder. */
function copyLicenseNote(noteDir, outDir) {
  const src = mustExist(
    path.join(ITCH_STAGING, noteDir, 'LICENSE-NOTE.md'),
    'staging LICENSE-NOTE.md'
  );
  writeIfChanged(path.join(outDir, 'LICENSE-NOTE.md'), fs.readFileSync(src));
}

// ── Sections ─────────────────────────────────────────────────────────────────

function doMusic() {
  console.log('> music (§C-SYS1.7 Bordmusik + recap fallback)');
  const outDir = path.join(ASSETS, 'music');
  for (const entry of MUSIC_FILES) {
    const srcAbs = entry.zip
      ? path.join(extracted(entry.zip), entry.src)
      : path.join(ITCH_STAGING, entry.dir, entry.src);
    const buf = fs.readFileSync(mustExist(srcAbs, 'music source'));
    guardSize(buf, MUSIC_MAX_BYTES, `music/${entry.out}`);
    writeIfChanged(path.join(outDir, entry.out), buf);
  }
  // Consolidated license notes (per-pack staging notes, verbatim).
  const parts = [
    '# public/assets/music — consolidated license notes (GOOBY V4/G50)\n',
    'Every file in this folder is CC0 1.0 Universal. Renames follow the',
    'PLAN4.md §C-SYS1.7 table (`Kategorie - Titel.ogg` naming, §B2.1).',
    'Source packs and their staging license notes, verbatim:\n',
  ];
  for (const pack of MUSIC_LICENSE_PACKS) {
    const note = mustExist(
      path.join(ITCH_STAGING, pack, 'LICENSE-NOTE.md'),
      'music LICENSE-NOTE.md'
    );
    parts.push(`\n---\n\n## ${pack}\n\n${fs.readFileSync(note, 'utf8').trim()}\n`);
  }
  writeIfChanged(path.join(outDir, 'LICENSES.md'), Buffer.from(parts.join('\n')));
}

function doSfx() {
  console.log('> itch-sfx (§C-SYS1.9 ObsydianX subset)');
  const zipRoot = extracted(SFX_ZIP);
  const outDir = path.join(ASSETS, 'itch', 'itch-sfx');
  for (const { src, out } of ITCH_SFX) {
    const buf = fs.readFileSync(mustExist(path.join(zipRoot, src), 'sfx source'));
    guardSize(buf, SFX_MAX_BYTES, `itch-sfx/${out}`);
    writeIfChanged(path.join(outDir, out), buf);
  }
  copyLicenseNote('interface-sfx-pack-1', outDir);
}

function doVfx() {
  console.log('> vfx textures (§C-SYS4.5 glow + §G4.2 streaks)');
  const zipRoot = extracted(VFX_ZIP);
  const glowDir = path.join(ASSETS, 'itch', 'vfx');
  for (const { src, out } of VFX_TEXTURES) {
    const buf = fs.readFileSync(mustExist(path.join(zipRoot, src), 'vfx texture'));
    guardSize(buf, VFX_MAX_BYTES, `itch/vfx/${out}`);
    writeIfChanged(path.join(glowDir, out), buf);
  }
  copyLicenseNote('brackeys-vfx-bundle', glowDir);
  const credits = path.join(zipRoot, 'brackeys_vfx_bundle', 'LICENSE & CREDITS.txt');
  if (fs.existsSync(credits)) {
    writeIfChanged(path.join(glowDir, 'LICENSE & CREDITS.txt'), fs.readFileSync(credits));
  }
  const streakDir = path.join(ASSETS, 'vfx');
  for (const { src, out } of STREAK_TEXTURES) {
    const buf = fs.readFileSync(mustExist(path.join(zipRoot, src), 'streak texture'));
    guardSize(buf, STREAK_MAX_BYTES, `vfx/${out}`);
    writeIfChanged(path.join(streakDir, out), buf);
  }
  copyLicenseNote('brackeys-vfx-bundle', streakDir);
}

function doModels() {
  for (const pack of MODEL_PACKS) {
    console.log(`> itch/${pack.slug} (${pack.form})`);
    const zipRoot = extracted(pack.zip);
    const srcDir = path.join(zipRoot, pack.srcDir);
    const outDir = path.join(ASSETS, 'itch', pack.slug);
    for (const { key, file } of pack.files) {
      const srcAbs = mustExist(path.join(srcDir, file), `${pack.slug} model`);
      if (pack.form === 'glb') {
        const glb = gltfToGlb(srcAbs);
        guardSize(glb, pack.maxBytes, `itch/${pack.slug}/${key}.glb`);
        writeIfChanged(path.join(outDir, `${key}.glb`), glb);
      } else if (pack.form === 'glb-copy') {
        const buf = fs.readFileSync(srcAbs);
        guardSize(buf, pack.maxBytes, `itch/${pack.slug}/${key}.glb`);
        writeIfChanged(path.join(outDir, `${key}.glb`), buf);
      } else {
        // 'gltf' form: .gltf + sibling .bin, shared texture committed once.
        const gltf = fs.readFileSync(srcAbs);
        const binName = `${path.basename(file, '.gltf')}.bin`;
        const bin = fs.readFileSync(mustExist(path.join(srcDir, binName), `${pack.slug} bin`));
        guardSize(bin, pack.maxBytes, `itch/${pack.slug}/${binName}`);
        writeIfChanged(path.join(outDir, `${key}.gltf`), gltf);
        writeIfChanged(path.join(outDir, binName), bin);
      }
    }
    if (pack.texture) {
      const tex = fs.readFileSync(mustExist(path.join(srcDir, pack.texture), 'pack texture'));
      writeIfChanged(path.join(outDir, pack.texture), tex);
    }
    if (pack.packLicense) {
      const lic = mustExist(path.join(zipRoot, pack.packLicense), 'pack license');
      writeIfChanged(path.join(outDir, 'License.txt'), fs.readFileSync(lic));
    }
    copyLicenseNote(pack.noteDir, outDir);
  }
}

function doSplats() {
  console.log('> splats (§G6.2 — CC BY 4.0, credits rows mandatory)');
  const outDir = path.join(ASSETS, 'splats');
  for (const scene of SPLAT_SCENES) {
    const buf = fs.readFileSync(
      mustExist(path.join(SPLAT_STAGING, scene.file), 'splat PLY')
    );
    guardSize(buf, scene.maxBytes, `splats/${scene.file}`);
    writeIfChanged(path.join(outDir, scene.file), buf);
    const note = mustExist(
      path.join(SPLAT_STAGING, scene.licenseSrc),
      'splat LICENSE-NOTE.md'
    );
    writeIfChanged(
      path.join(outDir, `${scene.sceneId}.LICENSE.txt`),
      fs.readFileSync(note)
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function dirBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let bytes = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    bytes += e.isDirectory() ? dirBytes(abs) : fs.statSync(abs).size;
  }
  return bytes;
}

function main() {
  mustExist(ITCH_STAGING, 'itch staging root (see PLAN4 §B3 / --staging)');
  mustExist(SPLAT_STAGING, 'splat staging root (see PLAN4-GAMES §G6.2 / --splats)');
  try {
    doMusic();
    doSfx();
    doVfx();
    doModels();
    doSplats();
  } finally {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('\nCommitted sizes:');
  for (const rel of ['music', 'itch', 'vfx', 'splats']) {
    const bytes = dirBytes(path.join(ASSETS, rel));
    console.log(`  ${rel.padEnd(8)} ${(bytes / MB).toFixed(2).padStart(8)} MB`);
  }
  console.log(
    written === 0
      ? `\nOK: byte-stable no-op (${unchanged} files verified unchanged)`
      : `\nOK: ${written} files written, ${unchanged} unchanged`
  );
}

// Run only when executed directly — test/assets.test.js imports the
// whitelist consts above without touching the staging libraries (CI has no
// /workspace/asset-staging; the committed files are the test's evidence).
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
