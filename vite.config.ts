import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Tauri expects a fixed dev port and a target matching the WebView2 (Chromium) runtime.
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
