#!/usr/bin/env node
// Headless-Chrome screenshot helper (no npm deps).
// Usage: npm run shot -- "<url>" shots/name.png
// Spawns: google-chrome --headless=new --screenshot=<out> --window-size=390,844
//         --virtual-time-budget=15000 --hide-scrollbars <url>
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';

const [url, outArg] = process.argv.slice(2);
if (!url) {
  console.error('usage: npm run shot -- "<url>" [out.png]');
  process.exit(1);
}
const out = resolve(outArg || 'shots/shot.png');
mkdirSync(dirname(out), { recursive: true });

// Fresh throwaway profile per run: some VMs wrap `google-chrome` with a pinned
// shared --user-data-dir + --remote-debugging-port that hangs headless runs, so
// prefer the real binary when present and isolate the profile.
const profile = mkdtempSync(join(tmpdir(), 'gooby-shot-'));
const chromeBin = existsSync('/usr/bin/google-chrome-stable')
  ? '/usr/bin/google-chrome-stable'
  : 'google-chrome';

const args = [
  '--headless=new',
  `--screenshot=${out}`,
  '--window-size=390,844',
  '--virtual-time-budget=15000',
  '--hide-scrollbars',
  `--user-data-dir=${profile}`,
  // VM-friendly flags (software WebGL via SwiftShader, no sandbox in containers)
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader',
  url,
];

const TIMEOUT_MS = 120000;

const chrome = spawn(chromeBin, args, { stdio: ['ignore', 'inherit', 'inherit'] });
const timeout = setTimeout(() => {
  console.error(`google-chrome hung > ${TIMEOUT_MS / 1000}s — killing`);
  chrome.kill('SIGKILL');
}, TIMEOUT_MS);

function cleanup() {
  clearTimeout(timeout);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch { /* best effort */ }
}

chrome.on('error', (err) => {
  console.error('failed to launch google-chrome:', err.message);
  cleanup();
  process.exit(1);
});
chrome.on('exit', (code) => {
  cleanup();
  if (code !== 0) {
    console.error(`google-chrome exited with code ${code}`);
    process.exit(code ?? 1);
  }
  if (!existsSync(out) || statSync(out).size === 0) {
    console.error(`screenshot not written: ${out}`);
    process.exit(1);
  }
  console.log(`wrote ${out} (${statSync(out).size} bytes)`);
});
