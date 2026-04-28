# Read API Service Implementation Plan

> **Status: superseded by current read-api implementation** — executed 2026-04-19; `/api/regions` was deleted across all layers in PR #194 (route, tests, types). References to `/api/regions` in this plan are stale — the route does not exist in the shipped service. Do not re-execute verbatim.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, fast HTTP service that serves JSON for the four frontend-facing endpoints (`/api/observations`, `/api/hotspots`, `/api/silhouettes`, `/api/species/:code`), with per-endpoint `Cache-Control` headers tuned to the spec's TTLs. The same code runs locally on Node and as a Cloudflare Worker (Plan 5 wraps it).

**Architecture:** Hono framework — works on Node, Bun, Deno, AWS Lambda, Cloudflare Workers, and Vercel Edge from the same code. Routes are pure functions of `(env, request) → Response`. Each route reads from Postgres via `@bird-watch/db-client`. A `cache-headers` helper applies the spec-defined TTLs. Tests start an in-process Hono app + Testcontainers Postgres and assert response shapes + cache headers.

**Tech Stack:** TypeScript, Hono, `@bird-watch/db-client`, Vitest, Testcontainers, `@hono/node-server` for local dev.

**Depends on:** Plan 1 (db-client + schema). Plan 2 not required — Read API is independent of Ingestor at the code level.

---

### Task 1: Scaffold `services/read-api`

**Files:**
- Create: `services/read-api/package.json`
- Create: `services/read-api/tsconfig.json`
- Create: `services/read-api/vitest.config.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@bird-watch/read-api",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "dev": "tsx src/local.ts"
  },
  "dependencies": {
    "@bird-watch/db-client": "*",
    "@bird-watch/shared-types": "*",
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "@hono/node-server": "^1.7.0",
    "@testcontainers/postgresql": "^10.7.0",
    "testcontainers": "^10.7.0",
    "tsx": "^4.7.0",
    "vitest": "^1.2.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [
    { "path": "../../packages/shared-types" },
    { "path": "../../packages/db-client" }
  ]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 4: Install**

```bash
npm install
```

- [ ] **Step 5: Commit**

```bash
git add services/read-api package.json package-lock.json
git commit -m "chore(read-api): scaffold package with Hono"
```

---

### Task 2: Cache-headers helper

**Files:**
- Create: `services/read-api/src/cache-headers.ts`
- Create: `services/read-api/src/cache-headers.test.ts`

- [ ] **Step 1: Write the failing test**

`services/read-api/src/cache-headers.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { cacheControlFor, type Endpoint } from './cache-headers.js';

describe('cacheControlFor', () => {
  it('returns 30-min TTL with SWR for /observations', () => {
    expect(cacheControlFor('observations'))
      .toBe('public, max-age=1800, stale-while-revalidate=600');
  });
  it('returns 24h TTL with SWR for /hotspots', () => {
    expect(cacheControlFor('hotspots'))
      .toBe('public, max-age=86400, stale-while-revalidate=3600');
  });
  it('returns 7d immutable for /regions', () => {
    expect(cacheControlFor('regions'))
      .toBe('public, max-age=604800, immutable');
  });
  it('returns 7d immutable for /species', () => {
    expect(cacheControlFor('species'))
      .toBe('public, max-age=604800, immutable');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/read-api -- cache-headers
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`services/read-api/src/cache-headers.ts`:
```typescript
export type Endpoint = 'observations' | 'hotspots' | 'regions' | 'species';

const TABLE: Record<Endpoint, string> = {
  observations: 'public, max-age=1800, stale-while-revalidate=600',
  hotspots:     'public, max-age=86400, stale-while-revalidate=3600',
  regions:      'public, max-age=604800, immutable',
  species:      'public, max-age=604800, immutable',
};

export function cacheControlFor(endpoint: Endpoint): string {
  return TABLE[endpoint];
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/read-api -- cache-headers
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/read-api/src/cache-headers.ts services/read-api/src/cache-headers.test.ts
git commit -m "feat(read-api): cache-control header table per spec TTLs"
```

---

### Task 3: App factory (`createApp`) with `/api/regions` route

**Files:**
- Create: `services/read-api/src/app.ts`
- Create: `services/read-api/src/app.test.ts`
- Create: `services/read-api/src/test-helpers.ts`

- [ ] **Step 1: Write the failing test**

`services/read-api/src/app.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { createApp } from './app.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('GET /api/regions', () => {
  it('returns the 9 seeded regions with the correct cache header', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/regions');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=604800, immutable');
    const body = await res.json() as Array<{ id: string }>;
    expect(body).toHaveLength(9);
    expect(body.find(r => r.id === 'sky-islands-santa-ritas')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: FAIL — `Cannot find module './app.js'`.

- [ ] **Step 3: Write the implementation**

`services/read-api/src/app.ts`:
```typescript
import { Hono } from 'hono';
import type { Pool } from '@bird-watch/db-client';
import { getRegions } from '@bird-watch/db-client';
import { cacheControlFor } from './cache-headers.js';

export interface AppDeps {
  pool: Pool;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/health', c => c.json({ ok: true }));

  app.get('/api/regions', async c => {
    const rows = await getRegions(deps.pool);
    c.header('Cache-Control', cacheControlFor('regions'));
    return c.json(rows);
  });

  return app;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add services/read-api/src/app.ts services/read-api/src/app.test.ts
git commit -m "feat(read-api): createApp + /api/regions"
```

---

### Task 4: `/api/hotspots` route

**Files:**
- Modify: `services/read-api/src/app.ts`
- Modify: `services/read-api/src/app.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```typescript
import { upsertHotspots } from '@bird-watch/db-client';

describe('GET /api/hotspots', () => {
  it('returns hotspots with the correct cache header', async () => {
    await upsertHotspots(db.pool, [
      { locId: 'L207118', locName: 'Sweetwater Wetlands',
        lat: 32.30, lng: -110.99, numSpeciesAlltime: 280, latestObsDt: '2026-04-15T12:00:00Z' },
    ]);
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/hotspots');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=86400, stale-while-revalidate=3600');
    const body = await res.json() as Array<{ locId: string; regionId: string | null }>;
    expect(body[0]?.locId).toBe('L207118');
    expect(body[0]?.regionId).toBe('sonoran-tucson');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: 404 from the hotspots route.

- [ ] **Step 3: Add the route to `app.ts`**

Append to `createApp`:
```typescript
app.get('/api/hotspots', async c => {
  const rows = await (await import('@bird-watch/db-client')).getHotspots(deps.pool);
  c.header('Cache-Control', cacheControlFor('hotspots'));
  return c.json(rows);
});
```

(For cleanliness, hoist the import to the top of the file.)

Final `services/read-api/src/app.ts` after this task:
```typescript
import { Hono } from 'hono';
import type { Pool } from '@bird-watch/db-client';
import { getRegions, getHotspots } from '@bird-watch/db-client';
import { cacheControlFor } from './cache-headers.js';

export interface AppDeps {
  pool: Pool;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/health', c => c.json({ ok: true }));

  app.get('/api/regions', async c => {
    const rows = await getRegions(deps.pool);
    c.header('Cache-Control', cacheControlFor('regions'));
    return c.json(rows);
  });

  app.get('/api/hotspots', async c => {
    const rows = await getHotspots(deps.pool);
    c.header('Cache-Control', cacheControlFor('hotspots'));
    return c.json(rows);
  });

  return app;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/read-api/src
git commit -m "feat(read-api): /api/hotspots"
```

---

### Task 5: `/api/observations` with filters

**Files:**
- Modify: `services/read-api/src/app.ts`
- Modify: `services/read-api/src/app.test.ts`

- [ ] **Step 1: Write the failing tests (append)**

```typescript
import { upsertObservations, upsertSpeciesMeta } from '@bird-watch/db-client';

describe('GET /api/observations', () => {
  beforeAll(async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
    ]);
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, [
      { subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: new Date(Date.now() - 5*86400_000).toISOString(),
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'S2', speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
        lat: 32.30, lng: -110.99, obsDt: new Date(Date.now() - 20*86400_000).toISOString(),
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
    ]);
  });

  it('returns observations with correct cache header', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=1800, stale-while-revalidate=600');
    const body = await res.json() as Array<unknown>;
    expect(body).toHaveLength(2);
  });

  it('filters by since=14d', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=14d');
    const body = await res.json() as Array<{ subId: string }>;
    expect(body.map(o => o.subId)).toEqual(['S1']);
  });

  it('filters by notable=true', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d&notable=true');
    const body = await res.json() as Array<{ subId: string }>;
    expect(body.map(o => o.subId)).toEqual(['S2']);
  });

  it('filters by species code', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d&species=vermfly');
    const body = await res.json() as Array<{ subId: string }>;
    expect(body.map(o => o.subId)).toEqual(['S1']);
  });

  it('filters by family code', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=30d&family=trochilidae');
    const body = await res.json() as Array<{ subId: string }>;
    expect(body.map(o => o.subId)).toEqual(['S2']);
  });

  it('rejects invalid since values with 400', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=banana');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to confirm failures**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: 6 new tests fail (404 / wrong shape).

- [ ] **Step 3: Add the route**

Append to `createApp`:
```typescript
app.get('/api/observations', async c => {
  const since = c.req.query('since') as '1d' | '7d' | '14d' | '30d' | undefined;
  if (since !== undefined && !['1d','7d','14d','30d'].includes(since)) {
    return c.json({ error: 'invalid since' }, 400);
  }
  const notableParam = c.req.query('notable');
  const speciesCode = c.req.query('species');
  const familyCode = c.req.query('family');

  const rows = await (await import('@bird-watch/db-client')).getObservations(deps.pool, {
    since,
    notable: notableParam === 'true',
    speciesCode,
    familyCode,
  });
  c.header('Cache-Control', cacheControlFor('observations'));
  return c.json(rows);
});
```

For the final clean version, update the imports at top:
```typescript
import {
  getRegions, getHotspots, getObservations,
} from '@bird-watch/db-client';
```

And the inline `await import` becomes a direct call.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: 8 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add services/read-api/src
git commit -m "feat(read-api): /api/observations with filters"
```

---

### Task 6: `/api/species/:code` route

**Files:**
- Modify: `services/read-api/src/app.ts`
- Modify: `services/read-api/src/app.test.ts`

- [ ] **Step 1: Write the failing tests (append)**

```typescript
describe('GET /api/species/:code', () => {
  it('returns species meta for a known code', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/vermfly');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=604800, immutable');
    const body = await res.json() as { speciesCode: string; comName: string };
    expect(body.speciesCode).toBe('vermfly');
    expect(body.comName).toBe('Vermilion Flycatcher');
  });

  it('returns 404 for unknown species', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/notreal');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: failures.

- [ ] **Step 3: Add the route**

Add to `createApp`:
```typescript
app.get('/api/species/:code', async c => {
  const code = c.req.param('code');
  const meta = await (await import('@bird-watch/db-client')).getSpeciesMeta(deps.pool, code);
  if (!meta) return c.json({ error: 'not found' }, 404);
  c.header('Cache-Control', cacheControlFor('species'));
  return c.json(meta);
});
```

Update top imports to include `getSpeciesMeta`:
```typescript
import {
  getRegions, getHotspots, getObservations, getSpeciesMeta,
} from '@bird-watch/db-client';
```

- [ ] **Step 4: Run the test**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/read-api/src
git commit -m "feat(read-api): /api/species/:code"
```

---

### Task 7: Generic error handling — pool exhaustion → 503

**Files:**
- Modify: `services/read-api/src/app.ts`
- Modify: `services/read-api/src/app.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```typescript
import { Pool } from '@bird-watch/db-client';

describe('error handling', () => {
  it('returns 503 when DB query throws a connection error', async () => {
    // Construct a pool pointing to a closed port to force connection failure.
    const badPool = new (await import('pg')).default.Pool({
      connectionString: 'postgres://nope:nope@127.0.0.1:1/none',
      max: 1,
      connectionTimeoutMillis: 200,
    }) as unknown as Pool;
    const app = createApp({ pool: badPool });
    const res = await app.request('/api/regions');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'database unavailable' });
    await (badPool as unknown as { end: () => Promise<void> }).end();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: failure (uncaught error, not 503).

- [ ] **Step 3: Add the error handler to `createApp`**

Add at the end of `createApp` before `return app`:
```typescript
app.onError((err, c) => {
  // pg connection errors surface as ECONNREFUSED / ETIMEDOUT / etc.
  const msg = (err as { code?: string }).code ?? '';
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(msg)) {
    return c.json({ error: 'database unavailable' }, 503);
  }
  // Pool acquisition timeout (pg-pool) throws a TimeoutError.
  if (err.name === 'TimeoutError' || /timeout/i.test(err.message)) {
    return c.json({ error: 'database unavailable' }, 503);
  }
  console.error('Unhandled error', err);
  return c.json({ error: 'internal' }, 500);
});
```

- [ ] **Step 4: Run the test**

```bash
npm test --workspace @bird-watch/read-api -- app
```

Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/read-api/src
git commit -m "feat(read-api): 503 on DB connection failures"
```

---

### Task 8: Local dev server (`npm run dev`)

**Files:**
- Create: `services/read-api/src/local.ts`

- [ ] **Step 1: Write the local server entry**

```typescript
#!/usr/bin/env tsx
import { serve } from '@hono/node-server';
import { createPool } from '@bird-watch/db-client';
import { createApp } from './app.js';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  const pool = createPool({ databaseUrl: dbUrl });
  const app = createApp({ pool });
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: app.fetch, port });
  console.log(`Read API listening on http://localhost:${port}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke test (with local DB up)**

```bash
set -a; source ../../.env; set +a
npm run dev --workspace @bird-watch/read-api
# in another terminal:
curl -i http://localhost:8787/health
curl -i http://localhost:8787/api/regions
```

Expected: `{ "ok": true }` and a JSON array of 9 regions with `Cache-Control` header.

- [ ] **Step 3: Build everything**

```bash
npm run build --workspace @bird-watch/read-api
```

- [ ] **Step 4: Commit**

```bash
git add services/read-api/src/local.ts
git commit -m "feat(read-api): local dev server"
```

---

### Task 9: Export the app + types

**Files:**
- Create: `services/read-api/src/index.ts`

- [ ] **Step 1: Write `index.ts`**

```typescript
export { createApp, type AppDeps } from './app.js';
export { cacheControlFor, type Endpoint } from './cache-headers.js';
```

- [ ] **Step 2: Build and verify**

```bash
npm run build --workspace @bird-watch/read-api
```

- [ ] **Step 3: Commit**

```bash
git add services/read-api/src/index.ts
git commit -m "chore(read-api): export public surface"
```

---

## Self-review checklist (run before declaring Plan 3 done)

- [ ] All 11 read-api tests pass against fresh PostGIS containers
- [ ] Each route sets the correct `Cache-Control` header per spec
- [ ] `/api/observations` honors all four filters
- [ ] 503 is returned on DB connection failures
- [ ] 404 is returned for unknown species
- [ ] `npm run dev` starts a working local server
- [ ] `npm run build --workspace @bird-watch/read-api` succeeds with no TS errors

When all checked: Plan 3 is done. Move on to Plan 4.
