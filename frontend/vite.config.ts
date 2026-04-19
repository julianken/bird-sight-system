import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
