import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Issue #258: `@vis.gl/react-maplibre` does a dynamic
      // `import('maplibre-gl')` at runtime. npm workspaces hoists
      // `@vis.gl/react-maplibre` to the root `node_modules/`, but
      // `maplibre-gl` is declared only as a frontend dep so it stays in
      // `frontend/node_modules/`. Vite's bundler can't resolve from one
      // to the other, and ships a chunk whose body is `throw Error(...)`.
      // The alias pins the resolution to the frontend's local copy and
      // is robust against future hoist drift (e.g. when a peer-dep'd
      // sibling package gets installed at root).
      'maplibre-gl': path.resolve(__dirname, 'node_modules/maplibre-gl'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  preview: {
    port: 4173,
    // Intentionally empty: vite preview inherits server.proxy by default
    // in Vite 5. Overriding with {} makes /api requests hit the static
    // origin (no proxy), simulating the production Cloudflare Pages
    // deploy where API lives on a different subdomain.
    // prod-smoke.preview.spec.ts depends on this to reproduce the bug.
    proxy: {},
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
    css: true,
    exclude: ['node_modules', 'e2e/**'],
  },
});
