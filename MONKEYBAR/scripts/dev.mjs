#!/usr/bin/env node
// Dev orchestration (PLAN.md §1): spawns the game server (node --watch, port 8080)
// and the Vite dev server (port 5173, proxies /ws → ws://localhost:8080).
// No extra dependencies — plain child_process.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const COLORS = { server: '\x1b[36m', client: '\x1b[35m', reset: '\x1b[0m' };

/** Pipe a child stream to stdout/stderr line-by-line with a colored prefix. */
function pipeWithPrefix(stream, name, out) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      out.write(`${COLORS[name]}[${name}]${COLORS.reset} ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buf.length) out.write(`${COLORS[name]}[${name}]${COLORS.reset} ${buf}\n`);
  });
}

const children = [];

function launch(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
    ...opts,
  });
  pipeWithPrefix(child.stdout, name, process.stdout);
  pipeWithPrefix(child.stderr, name, process.stderr);
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`[dev] ${name} exited (code=${code}, signal=${signal}); shutting down.`);
      shutdown(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  // Give children a moment to exit gracefully, then force-exit.
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('exit', () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
});

console.log('[dev] starting MONKEYBAR dev environment…');
console.log('[dev]   server → http://localhost:8080  (ws path /ws)');
console.log('[dev]   client → http://localhost:5173  (Vite, proxies /ws)');

launch('server', process.execPath, ['--watch', 'server/src/index.js']);
launch('client', 'npx', ['vite'], { cwd: join(root, 'client') });
