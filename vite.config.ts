/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: process.env.GITHUB_ACTIONS && !process.env.TAURI_ENV_PLATFORM ? '/scry-web/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@gen': resolve(__dirname, 'src/gen'),
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // Two pages: the app, and the transparent overlay window Tauri opens as its own
      // WebviewWindow. Both are served by the same dev server in `tauri dev`.
      input: {
        main: resolve(__dirname, 'index.html'),
        overlay: resolve(__dirname, 'overlay.html'),
      },
    },
  },
  test: {
    // happy-dom is enough for store + localStorage tests; we don't
    // render React components in unit tests (the panel/drag UI lives
    // in playwright e2e instead).
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
