import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0, // No retries — fix flakes at the root, don't paper over them.
  use: {
    headless: true,
    screenshot: 'only-on-failure',
  },
  outputDir: '.playwright-out',
  projects: [
    {
      name: 'dev-server',
      testIgnore: /.*\.preview\.spec\.ts$/,
      use: {
        baseURL: 'http://localhost:5173',
      },
    },
    {
      name: 'preview-build',
      testMatch: /.*\.preview\.spec\.ts$/,
      use: {
        baseURL: 'http://localhost:4173',
      },
    },
  ],
  webServer: [
    {
      // Start read-api on port 8787 (shared by both projects)
      command: `DATABASE_URL=${process.env.DATABASE_URL ?? 'postgres://birdwatch:birdwatch@localhost:5433/birdwatch'} npm run dev --workspace @bird-watch/read-api`,
      cwd: ROOT,
      url: 'http://localhost:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Start Vite dev server on port 5173 (proxies /api → 8787)
      command: 'npm run dev',
      cwd: __dirname,
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Build and start Vite preview on port 4173.
      // VITE_API_BASE_URL points at the read-api webServer (8787) so the
      // preview bundle — which runs without the dev proxy (see preview.proxy
      // in vite.config.ts) — fetches the API cross-origin, mirroring the
      // Cloudflare Pages + Cloud Run split in production. This requires CORS
      // on the read-api; see services/read-api/src/app.ts. Without this
      // override, `npm run build` would inline .env.production's
      // https://api.bird-maps.com and the test would hit (or fail to reach)
      // real production.
      command:
        'VITE_API_BASE_URL=http://localhost:8787 npm run build && npm run preview -- --port 4173 --strictPort',
      cwd: __dirname,
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
