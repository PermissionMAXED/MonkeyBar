#!/usr/bin/env node
/**
 * GOOBY — KayKit asset fetcher (PLAN3.md §B6 + §D2 + §D8-2). V3/G31.
 *
 * For every pack in kaykit-manifest.mjs:
 *   1. copy ONLY whitelisted files from the local staging library
 *      (`/workspace/asset-staging/kaykit/…`, override with --staging <path>)
 *      into public/assets/kaykit/<slug>/,
 *   2. parse each copied `.gltf` and copy every `buffers[].uri` /
 *      `images[].uri` dependency next to it (per-model `.bin` + the ONE
 *      shared `<pack>_texture.png`), then re-verify each landed — FAIL
 *      LOUDLY on any miss (§D8-2),
 *   3. copy the pack's LICENSE.txt into the slug dir.
 *
 * `.glb` files are verified self-contained (no external buffer/image URIs) —
 * §B6 form (a); the 3 rigged characters must not silently grow external deps.
 *
 * If a whitelisted file is missing from staging, the closest correctly-named
 * candidate (case/hyphen/underscore variants) in the same pack dir is used
 * and reported loudly as a SUBSTITUTION — bake persistent substitutions into
 * the manifest as { key, file } entries (§D5 availability rule).
 *
 * Idempotent: packs whose committed output is already complete are skipped.
 * Pass --force to re-copy everything. Pure Node — no npm dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KAYKIT_PACKS,
  STAGING_ROOT,
  kaykitEntry,
} from './kaykit-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(ROOT, 'public', 'assets', 'kaykit');
const FORCE = process.argv.includes('--force');
const stagingArg = process.argv.indexOf('--staging');
const STAGING =
  stagingArg !== -1 ? process.argv[stagingArg + 1] : STAGING_ROOT;

/** Normalize a filename for fuzzy matching (case/hyphen/underscore/space). */
const norm = (s) => s.toLowerCase().replace(/[-_ ]/g, '');

/**
 * External dependency URIs of a glTF JSON document (buffers + images).
 * data: URIs are embedded and need no copy.
 * @param {object} json parsed glTF 2.0 document
 * @returns {string[]}
 */
function gltfDepUris(json) {
  return [
    ...(json.buffers ?? []).map((b) => b.uri),
    ...(json.images ?? []).map((i) => i.uri),
  ].filter((uri) => uri && !uri.startsWith('data:'));
}

/** Parse the JSON chunk of a binary glTF (.glb) buffer. */
function glbJson(buf) {
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') {
    throw new Error('not a binary glTF (bad magic)');
  }
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
}

/** Expected committed relative paths for a pack (models + licence only —
 *  .bin/texture deps are derived from the committed .gltf files). */
function expectedOutputs(pack) {
  return [
    ...pack.files.map((f) => `${kaykitEntry(f, pack.ext).key}.${pack.ext}`),
    'LICENSE.txt',
  ];
}

/**
 * Verify a committed pack: every whitelisted model present, every .gltf dep
 * present next to it, every .glb self-contained. Returns a list of problems
 * (empty = complete/valid).
 * @param {object} pack manifest entry
 * @returns {string[]}
 */
function verifyPack(pack) {
  const dir = path.join(OUT_ROOT, pack.slug);
  const problems = [];
  for (const rel of expectedOutputs(pack)) {
    if (!fs.existsSync(path.join(dir, rel))) problems.push(`missing ${rel}`);
  }
  if (problems.length) return problems; // don't parse files that aren't there
  for (const entry of pack.files) {
    const { key } = kaykitEntry(entry, pack.ext);
    const file = path.join(dir, `${key}.${pack.ext}`);
    let json;
    try {
      json =
        pack.ext === 'glb'
          ? glbJson(fs.readFileSync(file))
          : JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(`${key}.${pack.ext}: unparseable (${err.message})`);
      continue;
    }
    const deps = gltfDepUris(json);
    if (pack.ext === 'glb' && deps.length) {
      problems.push(`${key}.glb: not self-contained (refs ${deps.join(', ')})`);
    }
    for (const uri of deps) {
      if (!fs.existsSync(path.join(dir, uri))) {
        problems.push(`${key}.${pack.ext}: missing dep '${uri}'`);
      }
    }
  }
  return problems;
}

const substitutions = [];

function processPack(pack) {
  const outDir = path.join(OUT_ROOT, pack.slug);
  if (!FORCE && verifyPack(pack).length === 0) {
    console.log(`= ${pack.slug}: already complete, skipping copy`);
    return;
  }

  const srcDir = path.join(STAGING, pack.source);
  if (!fs.existsSync(srcDir)) {
    throw new Error(`${pack.slug}: staging source not found: ${srcDir}`);
  }
  const available = fs.readdirSync(srcDir);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // LICENSE.txt per slug (§D2: every KayKit slug copy includes its licence).
  const licenseSrc = path.join(STAGING, pack.license);
  if (!fs.existsSync(licenseSrc)) {
    throw new Error(`${pack.slug}: LICENSE.txt not found at ${licenseSrc}`);
  }
  fs.copyFileSync(licenseSrc, path.join(outDir, 'LICENSE.txt'));

  const depUris = new Set();
  for (const entry of pack.files) {
    const { key, file } = kaykitEntry(entry, pack.ext);
    let srcName = available.includes(file) ? file : null;
    if (!srcName) {
      // Closest correctly-named variant in the same pack dir (§D5 rule).
      const want = norm(file);
      srcName = available.find(
        (n) => n.endsWith(`.${pack.ext}`) && norm(n) === want
      );
      if (!srcName) {
        const hints = available
          .filter(
            (n) =>
              n.endsWith(`.${pack.ext}`) &&
              norm(n).includes(want.slice(0, Math.min(6, want.length)))
          )
          .slice(0, 8);
        throw new Error(
          `${pack.slug}: '${file}' not in staging and no close variant. ` +
            `Nearby: ${hints.join(', ') || '(none)'}`
        );
      }
      substitutions.push({ pack: pack.slug, key, wanted: file, used: srcName });
      console.warn(`  ! SUBSTITUTION ${pack.slug}: '${file}' -> '${srcName}'`);
    }
    const srcAbs = path.join(srcDir, srcName);
    fs.copyFileSync(srcAbs, path.join(outDir, `${key}.${pack.ext}`));

    // Collect external deps from the SOURCE file (URIs are relative to it).
    const json =
      pack.ext === 'glb'
        ? glbJson(fs.readFileSync(srcAbs))
        : JSON.parse(fs.readFileSync(srcAbs, 'utf8'));
    for (const uri of gltfDepUris(json)) depUris.add(uri);
  }

  // Copy .bin/texture deps preserving their relative URI paths (§B6: flat in
  // practice — KayKit references '<model>.bin' + '<pack>_texture.png').
  for (const uri of depUris) {
    const src = path.join(srcDir, uri);
    if (!fs.existsSync(src)) {
      throw new Error(`${pack.slug}: referenced dep '${uri}' not in staging`);
    }
    const dest = path.join(outDir, uri);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  // §D8-2: parse each COMMITTED model and assert every dep landed next to it.
  const problems = verifyPack(pack);
  if (problems.length) {
    throw new Error(`${pack.slug}: post-copy verification FAILED:\n  ${problems.join('\n  ')}`);
  }
  console.log(`  ok: ${pack.slug} (${pack.files.length} models, deps verified)`);
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 };
  let bytes = 0;
  let files = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      const sub = dirSize(abs);
      bytes += sub.bytes;
      files += sub.files;
    } else {
      bytes += fs.statSync(abs).size;
      files += 1;
    }
  }
  return { bytes, files };
}

const mb = (b) => (b / (1024 * 1024)).toFixed(2);

function main() {
  for (const pack of KAYKIT_PACKS) {
    console.log(`> ${pack.slug}`);
    processPack(pack);
  }

  console.log('\nCommitted kaykit asset sizes:');
  console.log('pack                      files      MB');
  let total = 0;
  for (const pack of KAYKIT_PACKS) {
    const { bytes, files } = dirSize(path.join(OUT_ROOT, pack.slug));
    total += bytes;
    console.log(
      `${pack.slug.padEnd(24)} ${String(files).padStart(6)} ${mb(bytes).padStart(8)}`
    );
  }
  console.log(`${'TOTAL'.padEnd(24)} ${''.padStart(6)} ${mb(total).padStart(8)}`);

  if (substitutions.length) {
    console.log('\nName substitutions (bake into kaykit-manifest.mjs as {key,file}):');
    for (const s of substitutions) {
      console.log(`  ${s.pack}: key '${s.key}' wanted '${s.wanted}' used '${s.used}'`);
    }
  }
  console.log('\nOK: kaykit packs copied and dependency-verified');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
