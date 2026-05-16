import { defineConfig, devices } from '@playwright/test';
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
  // Epic #539 / issue #542 Task 2.5: the adaptive-grid perf gate runs as
  // a separate workflow (`.github/workflows/perf-gate.yml`) which sets
  // `CI_PERF_GATE=true` and invokes Playwright with `--grep @perf`. The
  // default e2e workflow (no CI_PERF_GATE) excludes @perf-tagged tests so
  // it stays fast and uncoupled from perf flakes.
  ...(process.env.CI_PERF_GATE === 'true' ? {} : { grepInvert: /@perf/ }),
  projects: [
    {
      name: 'dev-server',
      // Exclude both preview-only specs AND coarse-pointer-only specs from
      // the default dev-server project — Phase 2 tags coarse tests with
      // `@coarse` and limits them to the new project below. The default
      // project must NOT inherit touch emulation.
      testIgnore: /.*\.preview\.spec\.ts$/,
      grepInvert: /@coarse/,
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
    {
      // Phase 2 (#559): pointer:coarse media-query state is set at context
      // creation time, so per-test emulation via page.context().route(...) is
      // insufficient — the only reliable way is a device profile that sets
      // `hasTouch: true` AND `isMobile: true`. `iPad (gen 6)` is 768×1024
      // (matches CLAUDE.md canonical viewport for `iPad portrait (tablet)`).
      // `iPad (gen 7)` is 810×1080 and does NOT match a canonical viewport,
      // so it is explicitly NOT used here.
      //
      // Targets specs tagged `@coarse`. Currently scoped to
      // map-cell-popover.spec.ts.
      name: 'coarse-pointer',
      testIgnore: /.*\.preview\.spec\.ts$/,
      grep: /@coarse/,
      use: {
        ...devices['iPad (gen 6)'],
        baseURL: 'http://localhost:5173',
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
      // Start Vite dev server on port 5173 (proxies /api → 8787).
      // VITE_FF_CELL_POPOVER=true enables Phase 1 (cell popover) + Phase 2
      // (cluster list popover) features during e2e runs. The flag default in
      // .env is false; this override keeps the dev server flag-ON for tests
      // without affecting other workspaces.
      command: 'VITE_FF_CELL_POPOVER=true npm run dev',
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
