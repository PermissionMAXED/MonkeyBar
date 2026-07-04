// MONKEYBAR client boot — PLAN.md §2 (client/src/main.js).
// Contract (frozen in P1): wire engine + store + net + UI together.
// Later agents extend the imported modules, not this bootstrap order.

import { createEngine } from './three/engine.js';
import { createStore } from './state/store.js';
import { createSocket } from './net/socket.js';
import { initUI } from './ui/screens.js';

const canvas = document.getElementById('scene');

const engine = createEngine(canvas);
const store = createStore();
const socket = createSocket(store);

initUI(store, socket, engine);

engine.start();
socket.connect();

// P4 demo harness: `?demo=1` runs a standalone engine showcase (no server).
if (new URLSearchParams(location.search).get('demo') === '1') {
  import('./three/demo.js').then(({ runDemo }) => runDemo(engine));
}

console.log('[monkeybar] client booted');
