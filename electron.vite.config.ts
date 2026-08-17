import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The desktop shell. The RENDERER IS THE SAME TREE THE WEB BUILD USES — root is the repo
// root, so index.html/overlay.html and all of src/ are shared, and `bun run build` keeps
// producing the plain web bundle for Pages with no second copy of the UI to maintain.
export default defineConfig({
  main: {
    build: {
      // `electron` is the RUNTIME's built-in module, never the npm package — and the npm
      // package is a devDependency, which electron-vite does not externalize by default.
      // Bundled, its Node-side launcher (`getElectronPath`) ends up inside the main bundle
      // and the app tries to download a binary at startup instead of running.
      rollupOptions: {
        external: ['electron'],
        input: { index: resolve(__dirname, 'electron/main/index.ts') },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        // Externalizing `electron` here also keeps each preload SELF-CONTAINED: it was the
        // only module the two shared, so without it rollup hoists a chunk — and a sandboxed
        // preload's `require` cannot resolve one, which silently installs no bridge at all.
        external: ['electron'],
        // PRELOADS MUST BE COMMONJS, and package.json is `type: module`, so a `.js` here
        // would be read as ESM — it fails to load and installs NO bridge, with nothing in
        // the log to say so. `.cjs` is unambiguous whatever the package type says.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
        // Two bridges: the app's, and a leaner one for the overlay window. A window that
        // floats over the game with click-through has no business holding the full surface.
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
          overlay: resolve(__dirname, 'electron/preload/overlay.ts'),
        },
      },
    },
  },
  renderer: {
    root: __dirname,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@gen': resolve(__dirname, 'src/gen'),
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          overlay: resolve(__dirname, 'overlay.html'),
        },
      },
    },
  },
});
