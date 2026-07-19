// ESLint 9 flat config — intentionally lenient so all build agents' code passes.
// Mirrors the MONKEYBAR sibling config with globals adapted for GOOBY.
import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  location: 'readonly',
  history: 'readonly',
  navigator: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  performance: 'readonly',
  fetch: 'readonly',
  AudioContext: 'readonly',
  OscillatorNode: 'readonly',
  GainNode: 'readonly',
  Audio: 'readonly',
  Image: 'readonly',
  HTMLElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  CanvasRenderingContext2D: 'readonly',
  CustomEvent: 'readonly',
  Event: 'readonly',
  KeyboardEvent: 'readonly',
  MouseEvent: 'readonly',
  PointerEvent: 'readonly',
  TouchEvent: 'readonly',
  Notification: 'readonly',
  ResizeObserver: 'readonly',
  devicePixelRatio: 'readonly',
  innerWidth: 'readonly',
  innerHeight: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  prompt: 'readonly',
};

const nodeGlobals = {
  process: 'readonly',
  Buffer: 'readonly',
  global: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
};

const sharedGlobals = {
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  AbortController: 'readonly',
  structuredClone: 'readonly',
  crypto: 'readonly',
};

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', 'shots/**', 'ios/**', 'public/assets/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      // V4/G51: 2023 → 2025 so import attributes parse — Node 22 REQUIRES
      // `with { type: 'json' }` on the §B2.2 committed musicManifest.json
      // import (musicRegistry.js); espree 10.4 supports it from 2025.
      ecmaVersion: 2025,
      sourceType: 'module',
      globals: { ...sharedGlobals, ...browserGlobals, ...nodeGlobals },
    },
    rules: {
      // Lenient by design (see PLAN.md §B): warn instead of error, allow console.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': 'warn',
      'no-constant-condition': ['warn', { checkLoops: false }],
    },
  },
];
