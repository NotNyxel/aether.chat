import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Voice transcription (lib/transcribe.worker.ts) loads ONNX Runtime's .wasm from the CDN at the
// bundled version, so the 27 MB copy the bundler emits is never used: leave it out of the app.
const dropOrtWasm = (): Plugin => ({
  name: 'drop-ort-wasm',
  generateBundle(_, bundle) {
    for (const k of Object.keys(bundle)) if (/ort-wasm[^/]*\.wasm$/.test(k)) delete bundle[k];
  },
});

// Tauri expects a fixed dev port and a target matching the WebView2 (Chromium) runtime.
export default defineConfig({
  plugins: [react(), tailwindcss(), dropOrtWasm()],
  worker: { format: 'es', plugins: () => [dropOrtWasm()] },
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'chrome120',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    // splash.html is the desktop startup window (update check before the app opens).
    rollupOptions: { input: { main: 'index.html', splash: 'splash.html', home: 'home.html' } },
  },
});
