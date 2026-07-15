#!/usr/bin/env node
/**
 * GOOBY — Kenney asset fetcher (PLAN.md §D1).
 *
 * For every pack in kenney-manifest.mjs:
 *   1. discover the zip URL from https://kenney.nl/assets/<slug> (§D1 regex),
 *   2. download to a temp dir and extract with the system `unzip` binary,
 *   3. copy ONLY whitelisted files into public/assets/kenney/<slug>/
 *      (GLBs flat, audio under audio/), plus the pack's License.txt.
 *
 * Idempotent: packs whose committed output is already complete are skipped
 * (no network). Pass --force to re-download everything.
 *
 * If a whitelisted file is missing from a pack, the closest correctly-named
 * candidate (case/hyphen/underscore variants) is used and reported loudly as a
 * SUBSTITUTION — bake persistent substitutions into the manifest as
 * { key, file } entries so the §D1 key keeps resolving.
 *
 * Budget guard: exits non-zero if the total committed size exceeds §D1's
 * 80 MB budget. Prints a per-pack size table on success.
 *
 * Pure Node (built-in fetch/fs/child_process) — no npm dependencies.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PACKS,
  BUDGET_BYTES,
  discoveryRegex,
  modelEntry,
} from './kenney-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_ROOT = path.join(ROOT, 'public', 'assets', 'kenney');
const FORCE = process.argv.includes('--force');

/** Normalize a filename for fuzzy matching (case/hyphen/underscore/space). */
const norm = (s) => s.toLowerCase().replace(/[-_ ]/g, '');

const globToRegex = (glob) =>
  new RegExp(
    `^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`
  );

/** Recursively list files under dir → [{ rel, abs }]. */
function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs, base));
    else out.push({ rel: path.relative(base, abs), abs });
  }
  return out;
}

async function fetchOk(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

async function download(url, dest) {
  const res = await fetchOk(url);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/**
 * External image URIs referenced by a binary glTF (relative to the .glb).
 * Kenney's newer packs reference a shared `Textures/colormap.png` this way —
 * it must be committed next to the GLBs or every load 404s in the browser.
 * @param {Buffer} buf
 * @returns {string[]}
 */
function glbImageUris(buf) {
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') return [];
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  return (json.images ?? []).map((i) => i.uri).filter(Boolean);
}

/** Expected committed relative paths for a pack (deterministic). */
function expectedModelOutputs(pack) {
  return [
    ...pack.files.map((f) => `${modelEntry(f).key}.glb`),
    'License.txt',
  ];
}

function packComplete(pack) {
  const dir = path.join(OUT_ROOT, pack.slug);
  if (!fs.existsSync(dir)) return false;
  if (pack.files) {
    if (
      !expectedModelOutputs(pack).every((rel) =>
        fs.existsSync(path.join(dir, rel))
      )
    ) {
      return false;
    }
    // Every texture referenced by a committed GLB must be committed too.
    return pack.files.every((entry) =>
      glbImageUris(
        fs.readFileSync(path.join(dir, `${modelEntry(entry).key}.glb`))
      ).every((uri) => fs.existsSync(path.join(dir, uri)))
    );
  }
  // Audio packs: complete if License.txt + at least one matching ogg exist.
  const audioDir = path.join(dir, 'audio');
  return (
    fs.existsSync(path.join(dir, 'License.txt')) &&
    fs.existsSync(audioDir) &&
    fs.readdirSync(audioDir).some((f) => f.endsWith('.ogg'))
  );
}

const substitutions = [];

async function processPack(pack, tmpRoot) {
  const outDir = path.join(OUT_ROOT, pack.slug);
  if (!FORCE && packComplete(pack)) {
    console.log(`= ${pack.slug}: already complete, skipping download`);
    return;
  }

  console.log(`> ${pack.slug}: discovering zip URL…`);
  const page = await (await fetchOk(`https://kenney.nl/assets/${pack.slug}`)).text();
  const m = page.match(discoveryRegex(pack.slug));
  if (!m) throw new Error(`${pack.slug}: no zip URL matched the §D1 regex`);
  const zipUrl = `https://kenney.nl${m[0]}`;

  const zipPath = path.join(tmpRoot, `${pack.slug}.zip`);
  console.log(`  downloading ${zipUrl}`);
  await download(zipUrl, zipPath);
  const extractDir = path.join(tmpRoot, pack.slug);
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', extractDir]);

  const all = walk(extractDir);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // License.txt (any case, anywhere in the zip — usually at the root).
  const license = all.find((f) => path.basename(f.rel).toLowerCase() === 'license.txt');
  if (!license) throw new Error(`${pack.slug}: License.txt not found in zip`);
  fs.copyFileSync(license.abs, path.join(outDir, 'License.txt'));

  if (pack.files) {
    const inDir = all.filter(
      (f) => path.dirname(f.rel) === pack.modelDir && f.rel.endsWith('.glb')
    );
    const textureUris = new Set();
    for (const entry of pack.files) {
      const { key, file } = modelEntry(entry);
      let src = inDir.find((f) => path.basename(f.rel) === file);
      if (!src) {
        // Closest correctly-named variant: normalized-name match, preferring
        // the declared modelDir, then anywhere in the pack.
        const want = norm(file);
        src =
          inDir.find((f) => norm(path.basename(f.rel)) === want) ??
          all.find(
            (f) => f.rel.endsWith('.glb') && norm(path.basename(f.rel)) === want
          );
        if (!src) {
          const hints = inDir
            .map((f) => path.basename(f.rel))
            .filter((n) => norm(n).includes(want.slice(0, Math.min(5, want.length))))
            .slice(0, 8);
          throw new Error(
            `${pack.slug}: '${file}' not found and no close variant. Nearby: ${hints.join(', ') || '(none)'}`
          );
        }
        substitutions.push({ pack: pack.slug, key, wanted: file, used: src.rel });
        console.warn(`  ! SUBSTITUTION ${pack.slug}: '${file}' -> '${src.rel}'`);
      }
      fs.copyFileSync(src.abs, path.join(outDir, `${key}.glb`));
      for (const uri of glbImageUris(fs.readFileSync(src.abs))) {
        textureUris.add(uri);
      }
    }
    // Copy externally-referenced textures (URIs are relative to the GLB, so
    // the source lives at <modelDir>/<uri> inside the zip).
    for (const uri of textureUris) {
      const wantedRel = path.join(pack.modelDir, uri);
      const tex =
        all.find((f) => f.rel === wantedRel) ??
        all.find((f) => norm(f.rel) === norm(wantedRel)) ??
        all.find((f) => norm(path.basename(f.rel)) === norm(path.basename(uri)));
      if (!tex) {
        throw new Error(`${pack.slug}: referenced texture '${uri}' not in zip`);
      }
      const dest = path.join(outDir, uri);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(tex.abs, dest);
    }
  } else {
    const rx = globToRegex(pack.glob);
    const matches = all
      .filter(
        (f) =>
          path.dirname(f.rel) === pack.dir && rx.test(path.basename(f.rel))
      )
      .sort((a, b) => a.rel.localeCompare(b.rel))
      .slice(0, pack.max);
    if (matches.length === 0) {
      throw new Error(`${pack.slug}: glob '${pack.glob}' matched nothing in '${pack.dir}'`);
    }
    const audioOut = path.join(outDir, 'audio');
    fs.mkdirSync(audioOut, { recursive: true });
    for (const f of matches) {
      fs.copyFileSync(f.abs, path.join(audioOut, path.basename(f.rel)));
    }
  }
  console.log(`  ok: ${pack.slug}`);
}

function dirSize(dir) {
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 };
  const files = walk(dir);
  return {
    bytes: files.reduce((n, f) => n + fs.statSync(f.abs).size, 0),
    files: files.length,
  };
}

const mb = (b) => (b / (1024 * 1024)).toFixed(2);

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gooby-kenney-'));
  try {
    for (const pack of PACKS) await processPack(pack, tmpRoot);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('\nCommitted asset sizes:');
  console.log('pack                      files      MB');
  let total = 0;
  for (const pack of PACKS) {
    const { bytes, files } = dirSize(path.join(OUT_ROOT, pack.slug));
    total += bytes;
    console.log(`${pack.slug.padEnd(24)} ${String(files).padStart(6)} ${mb(bytes).padStart(8)}`);
  }
  console.log(`${'TOTAL'.padEnd(24)} ${''.padStart(6)} ${mb(total).padStart(8)}`);

  if (substitutions.length) {
    console.log('\nName substitutions (bake into kenney-manifest.mjs as {key,file}):');
    for (const s of substitutions) {
      console.log(`  ${s.pack}: key '${s.key}' wanted '${s.wanted}' used '${s.used}'`);
    }
  }

  if (total > BUDGET_BYTES) {
    console.error(`\nFAIL: total ${mb(total)} MB exceeds budget ${mb(BUDGET_BYTES)} MB`);
    process.exit(1);
  }
  console.log(`\nOK: total ${mb(total)} MB within ${mb(BUDGET_BYTES)} MB budget`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
