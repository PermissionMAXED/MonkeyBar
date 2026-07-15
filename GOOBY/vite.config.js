import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works inside Capacitor's file:// webview.
  base: './',
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    target: 'es2020',
  },
});
