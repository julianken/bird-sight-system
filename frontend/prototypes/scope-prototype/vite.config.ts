import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The prototype reuses the frontend workspace's installed deps (react,
// react-map-gl@8, maplibre-gl@5) — the whole point of the C0 gate is to
// validate the EXACT production library versions. node_modules lives two
// levels up at frontend/.
const frontendNodeModules = path.resolve(__dirname, '../../node_modules');

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      // Same hoist guard as frontend/vite.config.ts (#258): react-map-gl
      // dynamic-imports maplibre-gl; pin the resolution to the frontend's
      // local copy so the bundler doesn't ship a throw-Error stub chunk.
      'maplibre-gl': path.join(frontendNodeModules, 'maplibre-gl'),
    },
  },
  server: { port: 5210 },
  preview: { port: 4210 },
});
