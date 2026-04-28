# Ingestor Service Implementation Plan

> **Status: superseded by current ingestor implementation** — executed 2026-04-19; Epic-251 added `run-taxonomy` and `run-hotspots` ingest layers post-plan (family silhouettes pipeline). Do not re-execute verbatim.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a platform-agnostic Ingestor that fetches Arizona observations + hotspots from the eBird API, dedups via upsert, and stamps each row with `region_id` + `silhouette_id`. Runnable locally as a CLI; in Plan 5 it gets wrapped as a Cloudflare Worker scheduled handler.

**Architecture:** A single `runIngest()` function takes config (DB URL, eBird API key, kind) and orchestrates: fetch from eBird → transform → upsert into Postgres → record run. The eBird client wraps the public REST API with typed responses, exponential-backoff retries, and HTTP mocking via MSW for tests. All tests run against a real PostGIS container via the `db-client` test helpers from Plan 1.

**Tech Stack:** TypeScript, `pg` (via `@bird-watch/db-client`), `node-pg-migrate` (consumes Plan 1's migrations), Vitest, MSW, Testcontainers.

**Depends on:** Plan 1 (database foundation) must be complete.

---

### Task 1: Scaffold `services/ingestor`

**Files:**
- Create: `services/ingestor/package.json`
- Create: `services/ingestor/tsconfig.json`
- Create: `services/ingestor/vitest.config.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@bird-watch/ingestor",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "ingest:local": "tsx src/cli.ts"
  },
  "dependencies": {
    "@bird-watch/db-client": "*",
    "@bird-watch/shared-types": "*"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.7.0",
    "msw": "^2.1.0",
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

- [ ] **Step 4: Install dependencies**

```bash
npm install
```

Expected: `msw`, `tsx`, `@testcontainers/postgresql`, etc. installed.

- [ ] **Step 5: Commit**

```bash
git add services/ingestor package.json package-lock.json
git commit -m "chore(ingestor): scaffold package"
```

---

### Task 2: eBird API response types

**Files:**
- Create: `services/ingestor/src/ebird/types.ts`

- [ ] **Step 1: Write the response types**

```typescript
// Shapes returned by https://api.ebird.org/v2/data/obs/{regionCode}/recent
// Reference: https://documenter.getpostman.com/view/664302/S1ENwy59

export interface EbirdObservation {
  speciesCode: string;
  comName: string;
  sciName: string;
  locId: string;
  locName: string;
  obsDt: string;            // "YYYY-MM-DD HH:MM"
  howMany?: number;
  lat: number;
  lng: number;
  obsValid: boolean;
  obsReviewed: boolean;
  locationPrivate: boolean;
  subId: string;
  subnational1Code?: string;
  subnational2Code?: string;
}

export interface EbirdHotspot {
  locId: string;
  locName: string;
  countryCode: string;
  subnational1Code: string;
  subnational2Code?: string;
  lat: number;
  lng: number;
  latestObsDt?: string;     // ISO-ish or absent
  numSpeciesAllTime?: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add services/ingestor/src/ebird/types.ts
git commit -m "feat(ingestor): define eBird response types"
```

---

### Task 3: eBird client — `fetchRecent` with MSW-tested success path

**Files:**
- Create: `services/ingestor/src/ebird/client.ts`
- Create: `services/ingestor/src/ebird/client.test.ts`
- Create: `services/ingestor/src/ebird/test-server.ts`

- [ ] **Step 1: Write the failing test**

`services/ingestor/src/ebird/client.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { EbirdClient } from './client.js';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SAMPLE_OBS = [
  {
    speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
    sciName: 'Pyrocephalus rubinus', locId: 'L101234', locName: 'Madera Canyon',
    obsDt: '2026-04-15 08:00', howMany: 2, lat: 31.72, lng: -110.88,
    obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S100',
  },
];

describe('EbirdClient.fetchRecent', () => {
  it('returns observations for a region', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('back')).toBe('14');
        expect(request.headers.get('x-ebirdapitoken')).toBe('test-key');
        return HttpResponse.json(SAMPLE_OBS);
      })
    );
    const client = new EbirdClient({ apiKey: 'test-key' });
    const obs = await client.fetchRecent('US-AZ', { back: 14 });
    expect(obs).toHaveLength(1);
    expect(obs[0]?.speciesCode).toBe('vermfly');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm install
npm test --workspace @bird-watch/ingestor
```

Expected: FAIL — `Cannot find module './client.js'`.

- [ ] **Step 3: Write the implementation**

`services/ingestor/src/ebird/client.ts`:
```typescript
import type { EbirdObservation, EbirdHotspot } from './types.js';

export interface EbirdClientOptions {
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  retryBaseMs?: number;
}

export interface FetchRecentOptions {
  back?: number;       // 1–30 days; default 14
  maxResults?: number; // default 10000
}

export class EbirdClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(opts: EbirdClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.ebird.org/v2';
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 250;
  }

  async fetchRecent(
    regionCode: string,
    o: FetchRecentOptions = {}
  ): Promise<EbirdObservation[]> {
    const url = new URL(`${this.baseUrl}/data/obs/${regionCode}/recent`);
    url.searchParams.set('back', String(o.back ?? 14));
    url.searchParams.set('maxResults', String(o.maxResults ?? 10_000));
    return this.getJson<EbirdObservation[]>(url);
  }

  async fetchNotable(
    regionCode: string,
    o: FetchRecentOptions = {}
  ): Promise<EbirdObservation[]> {
    const url = new URL(`${this.baseUrl}/data/obs/${regionCode}/recent/notable`);
    url.searchParams.set('back', String(o.back ?? 14));
    url.searchParams.set('detail', 'simple');
    return this.getJson<EbirdObservation[]>(url);
  }

  async fetchHotspots(regionCode: string): Promise<EbirdHotspot[]> {
    const url = new URL(`${this.baseUrl}/ref/hotspot/${regionCode}`);
    url.searchParams.set('fmt', 'json');
    return this.getJson<EbirdHotspot[]>(url);
  }

  async fetchHistoric(
    regionCode: string,
    y: number, m: number, d: number
  ): Promise<EbirdObservation[]> {
    const url = new URL(
      `${this.baseUrl}/data/obs/${regionCode}/historic/${y}/${m}/${d}`
    );
    url.searchParams.set('maxResults', '10000');
    return this.getJson<EbirdObservation[]>(url);
  }

  private async getJson<T>(url: URL): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'x-ebirdapitoken': this.apiKey, accept: 'application/json' },
        });
        if (res.status >= 500) {
          throw new EbirdServerError(res.status, await res.text());
        }
        if (!res.ok) {
          const body = await res.text();
          throw new EbirdClientError(res.status, body);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        if (err instanceof EbirdClientError) throw err; // 4xx — don't retry
        if (attempt === this.maxRetries) break;
        const delay = this.retryBaseMs * 2 ** attempt;
        await sleep(delay);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export class EbirdClientError extends Error {
  constructor(public status: number, public body: string) {
    super(`eBird client error ${status}: ${body}`);
    this.name = 'EbirdClientError';
  }
}
export class EbirdServerError extends Error {
  constructor(public status: number, public body: string) {
    super(`eBird server error ${status}: ${body}`);
    this.name = 'EbirdServerError';
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/ingestor -- client
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add services/ingestor/src/ebird
git commit -m "feat(ingestor): EbirdClient.fetchRecent with retry skeleton"
```

---

### Task 4: eBird client — `fetchNotable` and `fetchHotspots` tests

**Files:**
- Modify: `services/ingestor/src/ebird/client.test.ts`

- [ ] **Step 1: Append tests**

```typescript
describe('EbirdClient.fetchNotable', () => {
  it('returns notable observations only', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => {
        return HttpResponse.json([{ ...SAMPLE_OBS[0], speciesCode: 'eltrog' }]);
      })
    );
    const client = new EbirdClient({ apiKey: 'k' });
    const obs = await client.fetchNotable('US-AZ');
    expect(obs[0]?.speciesCode).toBe('eltrog');
  });
});

describe('EbirdClient.fetchHotspots', () => {
  it('returns hotspots for a region', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/hotspot/US-AZ', () => {
        return HttpResponse.json([
          { locId: 'L1', locName: 'Sweetwater', countryCode: 'US',
            subnational1Code: 'US-AZ', lat: 32.30, lng: -110.99,
            numSpeciesAllTime: 280 },
        ]);
      })
    );
    const client = new EbirdClient({ apiKey: 'k' });
    const h = await client.fetchHotspots('US-AZ');
    expect(h[0]?.locId).toBe('L1');
    expect(h[0]?.numSpeciesAllTime).toBe(280);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test --workspace @bird-watch/ingestor -- client
```

Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add services/ingestor/src/ebird/client.test.ts
git commit -m "test(ingestor): cover fetchNotable + fetchHotspots"
```

---

### Task 5: eBird client — retry + error handling tests

**Files:**
- Modify: `services/ingestor/src/ebird/client.test.ts`

- [ ] **Step 1: Append tests**

```typescript
describe('EbirdClient retries', () => {
  it('retries on 5xx and eventually succeeds', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => {
        calls++;
        if (calls < 3) return new HttpResponse('boom', { status: 503 });
        return HttpResponse.json(SAMPLE_OBS);
      })
    );
    const client = new EbirdClient({ apiKey: 'k', retryBaseMs: 1, maxRetries: 5 });
    const obs = await client.fetchRecent('US-AZ');
    expect(calls).toBe(3);
    expect(obs).toHaveLength(1);
  });

  it('throws immediately on 4xx (no retry)', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => {
        calls++;
        return new HttpResponse('forbidden', { status: 403 });
      })
    );
    const client = new EbirdClient({ apiKey: 'k', retryBaseMs: 1, maxRetries: 5 });
    await expect(client.fetchRecent('US-AZ')).rejects.toThrow(/403/);
    expect(calls).toBe(1);
  });

  it('throws after exhausting retries on 5xx', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => {
        calls++;
        return new HttpResponse('always broken', { status: 502 });
      })
    );
    const client = new EbirdClient({ apiKey: 'k', retryBaseMs: 1, maxRetries: 2 });
    await expect(client.fetchRecent('US-AZ')).rejects.toThrow(/502/);
    expect(calls).toBe(3); // 1 initial + 2 retries
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test --workspace @bird-watch/ingestor -- client
```

Expected: 6 tests pass total.

- [ ] **Step 3: Commit**

```bash
git add services/ingestor/src/ebird/client.test.ts
git commit -m "test(ingestor): cover retry + 4xx + exhaustion paths"
```

---

### Task 6: Transform — eBird response → `ObservationInput`

**Files:**
- Create: `services/ingestor/src/transform.ts`
- Create: `services/ingestor/src/transform.test.ts`

- [ ] **Step 1: Write the failing test**

`services/ingestor/src/transform.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { toObservationInput } from './transform.js';
import type { EbirdObservation } from './ebird/types.js';

const sample: EbirdObservation = {
  speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
  sciName: 'Pyrocephalus rubinus', locId: 'L1', locName: 'Madera',
  obsDt: '2026-04-15 08:00', howMany: 2, lat: 31.72, lng: -110.88,
  obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S100',
};

describe('toObservationInput', () => {
  it('maps fields and parses obsDt to ISO', () => {
    const out = toObservationInput(sample, new Set());
    expect(out.subId).toBe('S100');
    expect(out.speciesCode).toBe('vermfly');
    expect(out.lat).toBe(31.72);
    expect(out.lng).toBe(-110.88);
    expect(out.obsDt).toBe('2026-04-15T08:00:00.000Z');
    expect(out.howMany).toBe(2);
    expect(out.isNotable).toBe(false);
  });

  it('marks is_notable=true when sub_id is in the notable set', () => {
    const notableKeys = new Set(['S100|vermfly']);
    const out = toObservationInput(sample, notableKeys);
    expect(out.isNotable).toBe(true);
  });

  it('handles missing howMany (defaults to null)', () => {
    const { howMany, ...rest } = sample;
    const out = toObservationInput(rest as EbirdObservation, new Set());
    expect(out.howMany).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/ingestor -- transform
```

Expected: FAIL — `Cannot find module './transform.js'`.

- [ ] **Step 3: Write the implementation**

`services/ingestor/src/transform.ts`:
```typescript
import type { EbirdObservation } from './ebird/types.js';
import type { ObservationInput } from '@bird-watch/db-client';

/**
 * eBird returns obsDt as "YYYY-MM-DD HH:MM" in local time of the observation.
 * For MVP we treat as UTC — accuracy to the hour is fine for "what was seen recently".
 */
export function toObservationInput(
  o: EbirdObservation,
  notableKeys: ReadonlySet<string>
): ObservationInput {
  const key = `${o.subId}|${o.speciesCode}`;
  const obsDtIso = parseEbirdDate(o.obsDt);
  return {
    subId: o.subId,
    speciesCode: o.speciesCode,
    comName: o.comName,
    lat: o.lat,
    lng: o.lng,
    obsDt: obsDtIso,
    locId: o.locId,
    locName: o.locName,
    howMany: typeof o.howMany === 'number' ? o.howMany : null,
    isNotable: notableKeys.has(key),
  };
}

export function notableKeyset(obs: EbirdObservation[]): Set<string> {
  return new Set(obs.map(o => `${o.subId}|${o.speciesCode}`));
}

function parseEbirdDate(s: string): string {
  // "2026-04-15 08:00" → "2026-04-15T08:00:00.000Z"
  const normalized = s.replace(' ', 'T') + ':00.000Z';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid eBird obsDt: ${s}`);
  }
  return d.toISOString();
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/ingestor -- transform
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/ingestor/src/transform.ts services/ingestor/src/transform.test.ts
git commit -m "feat(ingestor): transform eBird obs to ObservationInput"
```

---

### Task 7: Main `runIngest` orchestrator (recent + notable)

**Files:**
- Create: `services/ingestor/src/run-ingest.ts`
- Create: `services/ingestor/src/run-ingest.test.ts`

- [ ] **Step 1: Write the failing test**

`services/ingestor/src/run-ingest.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { upsertSpeciesMeta, getObservations, getRecentIngestRuns } from '@bird-watch/db-client';
import { runIngest } from './run-ingest.js';

const server = setupServer();
let db: TestDb;

const RECENT = [
  { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
    sciName: 'Pyrocephalus rubinus', locId: 'L1', locName: 'Madera',
    obsDt: '2026-04-15 08:00', howMany: 2, lat: 31.72, lng: -110.88,
    obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S100' },
  { speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
    sciName: 'Calypte anna', locId: 'L2', locName: 'Sweetwater',
    obsDt: '2026-04-15 09:00', howMany: 1, lat: 32.30, lng: -110.99,
    obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S101' },
];
const NOTABLE = [
  { ...RECENT[1] },  // mark S101 / annhum as notable
];

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  db = await startTestDb();
  await upsertSpeciesMeta(db.pool, [
    { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    { speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
      sciName: 'Calypte anna', familyCode: 'trochilidae',
      familyName: 'Hummingbirds', taxonOrder: 6000 },
  ]);
}, 90_000);

afterEach(() => server.resetHandlers());

beforeEach(async () => {
  await db.pool.query('TRUNCATE observations');
  await db.pool.query('TRUNCATE ingest_runs RESTART IDENTITY');
});

afterAll(async () => {
  server.close();
  await db?.stop();
});

describe('runIngest', () => {
  it('fetches recent + notable, upserts, and stamps region/silhouette/is_notable', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => HttpResponse.json(RECENT)),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json(NOTABLE))
    );

    const summary = await runIngest({
      pool: db.pool,
      apiKey: 'test-key',
      regionCode: 'US-AZ',
      back: 14,
    });

    expect(summary.fetched).toBe(2);
    expect(summary.upserted).toBe(2);
    expect(summary.status).toBe('success');

    const obs = await getObservations(db.pool, {});
    expect(obs).toHaveLength(2);
    const verm = obs.find(o => o.subId === 'S100')!;
    expect(verm.regionId).toBe('sky-islands-santa-ritas');
    expect(verm.silhouetteId).toBe('tyrannidae');
    expect(verm.isNotable).toBe(false);
    const anna = obs.find(o => o.subId === 'S101')!;
    expect(anna.regionId).toBe('sonoran-tucson');
    expect(anna.silhouetteId).toBe('trochilidae');
    expect(anna.isNotable).toBe(true);

    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('success');
    expect(runs[0]?.kind).toBe('recent');
  });

  it('is idempotent — second run with same data does not duplicate', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => HttpResponse.json(RECENT)),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([]))
    );
    await runIngest({ pool: db.pool, apiKey: 'k', regionCode: 'US-AZ' });
    await runIngest({ pool: db.pool, apiKey: 'k', regionCode: 'US-AZ' });
    const obs = await getObservations(db.pool, {});
    expect(obs).toHaveLength(2);
  });

  it('records a failure run when eBird is unreachable', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () => new HttpResponse('boom', { status: 502 })),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([]))
    );
    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      retryBaseMs: 1, maxRetries: 1,
    });
    expect(summary.status).toBe('failure');
    expect(summary.error).toBeDefined();
    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('failure');
    expect(runs[0]?.errorMessage).toContain('502');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/ingestor -- run-ingest
```

Expected: FAIL — `Cannot find module './run-ingest.js'`.

- [ ] **Step 3: Write the implementation**

`services/ingestor/src/run-ingest.ts`:
```typescript
import {
  upsertObservations, startIngestRun, finishIngestRun, type Pool,
} from '@bird-watch/db-client';
import { EbirdClient } from './ebird/client.js';
import { toObservationInput, notableKeyset } from './transform.js';

export interface RunIngestOptions {
  pool: Pool;
  apiKey: string;
  regionCode: string;
  back?: number;
  /** Test hooks — used by retry tests. */
  maxRetries?: number;
  retryBaseMs?: number;
  /** Inject a client for tests; if omitted, one is constructed. */
  client?: EbirdClient;
}

export interface RunSummary {
  status: 'success' | 'failure';
  fetched: number;
  upserted: number;
  error?: string;
}

export async function runIngest(opts: RunIngestOptions): Promise<RunSummary> {
  const client = opts.client ?? new EbirdClient({
    apiKey: opts.apiKey,
    maxRetries: opts.maxRetries,
    retryBaseMs: opts.retryBaseMs,
  });

  const runId = await startIngestRun(opts.pool, 'recent');
  try {
    const [recent, notable] = await Promise.all([
      client.fetchRecent(opts.regionCode, { back: opts.back ?? 14 }),
      client.fetchNotable(opts.regionCode, { back: opts.back ?? 14 }),
    ]);
    const notableKeys = notableKeyset(notable);
    const inputs = recent.map(o => toObservationInput(o, notableKeys));
    const upserted = await upsertObservations(opts.pool, inputs);

    await finishIngestRun(opts.pool, runId, {
      status: 'success',
      obsFetched: recent.length,
      obsUpserted: upserted,
    });

    return { status: 'success', fetched: recent.length, upserted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishIngestRun(opts.pool, runId, {
      status: 'failure',
      errorMessage: msg,
    });
    return { status: 'failure', fetched: 0, upserted: 0, error: msg };
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/ingestor -- run-ingest
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/ingestor/src/run-ingest.ts services/ingestor/src/run-ingest.test.ts
git commit -m "feat(ingestor): runIngest orchestrator with notable handling + run logging"
```

---

### Task 8: Hotspots ingest (separate function — different cadence)

**Files:**
- Create: `services/ingestor/src/run-hotspots.ts`
- Create: `services/ingestor/src/run-hotspots.test.ts`

- [ ] **Step 1: Write the failing test**

`services/ingestor/src/run-hotspots.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { getHotspots } from '@bird-watch/db-client';
import { runHotspotIngest } from './run-hotspots.js';

const server = setupServer();
let db: TestDb;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  db = await startTestDb();
}, 90_000);

afterEach(() => server.resetHandlers());
beforeEach(async () => { await db.pool.query('TRUNCATE hotspots'); });
afterAll(async () => { server.close(); await db?.stop(); });

describe('runHotspotIngest', () => {
  it('fetches hotspots from eBird and upserts with region stamping', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/ref/hotspot/US-AZ', () => HttpResponse.json([
        { locId: 'L1', locName: 'Madera Canyon', countryCode: 'US',
          subnational1Code: 'US-AZ', lat: 31.72, lng: -110.88, numSpeciesAllTime: 410 },
        { locId: 'L2', locName: 'Sweetwater Wetlands', countryCode: 'US',
          subnational1Code: 'US-AZ', lat: 32.30, lng: -110.99, numSpeciesAllTime: 280 },
      ]))
    );

    const summary = await runHotspotIngest({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
    });
    expect(summary.status).toBe('success');
    expect(summary.upserted).toBe(2);

    const stored = await getHotspots(db.pool);
    expect(stored).toHaveLength(2);
    expect(stored.find(h => h.locId === 'L1')?.regionId).toBe('sky-islands-santa-ritas');
    expect(stored.find(h => h.locId === 'L2')?.regionId).toBe('sonoran-tucson');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/ingestor -- run-hotspots
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`services/ingestor/src/run-hotspots.ts`:
```typescript
import {
  upsertHotspots, startIngestRun, finishIngestRun,
  type Pool, type HotspotInput,
} from '@bird-watch/db-client';
import { EbirdClient } from './ebird/client.js';

export interface RunHotspotOptions {
  pool: Pool;
  apiKey: string;
  regionCode: string;
  client?: EbirdClient;
}

export interface RunHotspotSummary {
  status: 'success' | 'failure';
  fetched: number;
  upserted: number;
  error?: string;
}

export async function runHotspotIngest(o: RunHotspotOptions): Promise<RunHotspotSummary> {
  const client = o.client ?? new EbirdClient({ apiKey: o.apiKey });
  const runId = await startIngestRun(o.pool, 'hotspots');
  try {
    const hotspots = await client.fetchHotspots(o.regionCode);
    const inputs: HotspotInput[] = hotspots.map(h => ({
      locId: h.locId,
      locName: h.locName,
      lat: h.lat,
      lng: h.lng,
      numSpeciesAlltime: h.numSpeciesAllTime ?? null,
      latestObsDt: h.latestObsDt ?? null,
    }));
    const upserted = await upsertHotspots(o.pool, inputs);
    await finishIngestRun(o.pool, runId, {
      status: 'success', obsFetched: hotspots.length, obsUpserted: upserted,
    });
    return { status: 'success', fetched: hotspots.length, upserted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishIngestRun(o.pool, runId, { status: 'failure', errorMessage: msg });
    return { status: 'failure', fetched: 0, upserted: 0, error: msg };
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/ingestor -- run-hotspots
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add services/ingestor/src/run-hotspots.ts services/ingestor/src/run-hotspots.test.ts
git commit -m "feat(ingestor): runHotspotIngest"
```

---

### Task 9: Daily back-fill (`runBackfill`)

**Files:**
- Create: `services/ingestor/src/run-backfill.ts`
- Create: `services/ingestor/src/run-backfill.test.ts`

- [ ] **Step 1: Write the failing test**

`services/ingestor/src/run-backfill.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { upsertSpeciesMeta, getObservations } from '@bird-watch/db-client';
import { runBackfill } from './run-backfill.js';

const server = setupServer();
let db: TestDb;

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  db = await startTestDb();
  await upsertSpeciesMeta(db.pool, [
    { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
      sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
      familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
  ]);
}, 90_000);

afterEach(() => server.resetHandlers());
beforeEach(async () => { await db.pool.query('TRUNCATE observations'); });
afterAll(async () => { server.close(); await db?.stop(); });

describe('runBackfill', () => {
  it('walks N days back and upserts observations from each day', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', () => {
        calls++;
        return HttpResponse.json([
          { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
            sciName: 'Pyrocephalus rubinus', locId: `L${calls}`, locName: 'X',
            obsDt: '2026-04-10 08:00', howMany: 1, lat: 31.72, lng: -110.88,
            obsValid: true, obsReviewed: false, locationPrivate: false,
            subId: `S${calls}` },
        ]);
      })
    );

    const today = new Date('2026-04-16T00:00:00Z');
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      days: 3, today,
    });
    expect(calls).toBe(3);
    expect(summary.status).toBe('success');
    const obs = await getObservations(db.pool, {});
    expect(obs).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/ingestor -- run-backfill
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`services/ingestor/src/run-backfill.ts`:
```typescript
import {
  upsertObservations, startIngestRun, finishIngestRun, type Pool,
} from '@bird-watch/db-client';
import { EbirdClient } from './ebird/client.js';
import { toObservationInput } from './transform.js';

export interface RunBackfillOptions {
  pool: Pool;
  apiKey: string;
  regionCode: string;
  days: number;          // how many days back, e.g. 30
  today?: Date;          // injectable for tests
  client?: EbirdClient;
}

export interface RunBackfillSummary {
  status: 'success' | 'partial' | 'failure';
  fetched: number;
  upserted: number;
  daysProcessed: number;
  error?: string;
}

export async function runBackfill(o: RunBackfillOptions): Promise<RunBackfillSummary> {
  const client = o.client ?? new EbirdClient({ apiKey: o.apiKey });
  const runId = await startIngestRun(o.pool, 'backfill');
  const today = o.today ?? new Date();

  let totalFetched = 0;
  let totalUpserted = 0;
  let daysProcessed = 0;
  let firstError: string | undefined;

  for (let i = 1; i <= o.days; i++) {
    const date = new Date(today.getTime() - i * 24 * 3600 * 1000);
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth() + 1;
    const d = date.getUTCDate();
    try {
      const obs = await client.fetchHistoric(o.regionCode, y, m, d);
      const inputs = obs.map(eb => toObservationInput(eb, new Set()));
      const upserted = await upsertObservations(o.pool, inputs);
      totalFetched += obs.length;
      totalUpserted += upserted;
      daysProcessed++;
    } catch (err) {
      if (!firstError) firstError = err instanceof Error ? err.message : String(err);
    }
  }

  const status: RunBackfillSummary['status'] =
    daysProcessed === o.days ? 'success'
      : daysProcessed === 0 ? 'failure'
        : 'partial';

  await finishIngestRun(o.pool, runId, {
    status,
    obsFetched: totalFetched,
    obsUpserted: totalUpserted,
    errorMessage: firstError,
  });

  return {
    status, fetched: totalFetched, upserted: totalUpserted,
    daysProcessed, error: firstError,
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/ingestor -- run-backfill
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add services/ingestor/src/run-backfill.ts services/ingestor/src/run-backfill.test.ts
git commit -m "feat(ingestor): runBackfill walks last N days"
```

---

### Task 10: Local CLI for one-shot manual ingest

**Files:**
- Create: `services/ingestor/src/cli.ts`

- [ ] **Step 1: Write the CLI**

```typescript
#!/usr/bin/env tsx
import { createPool, closePool } from '@bird-watch/db-client';
import { runIngest } from './run-ingest.js';
import { runHotspotIngest } from './run-hotspots.js';
import { runBackfill } from './run-backfill.js';

const KIND = process.argv[2] ?? 'recent';

async function main() {
  const apiKey = process.env.EBIRD_API_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!apiKey) throw new Error('EBIRD_API_KEY not set');
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  const pool = createPool({ databaseUrl: dbUrl });
  try {
    let summary: unknown;
    if (KIND === 'recent') {
      summary = await runIngest({ pool, apiKey, regionCode: 'US-AZ' });
    } else if (KIND === 'hotspots') {
      summary = await runHotspotIngest({ pool, apiKey, regionCode: 'US-AZ' });
    } else if (KIND === 'backfill') {
      summary = await runBackfill({ pool, apiKey, regionCode: 'US-AZ', days: 30 });
    } else {
      throw new Error(`Unknown kind: ${KIND}. Try recent | hotspots | backfill`);
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await closePool(pool);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Manual smoke test (optional, requires real eBird key)**

```bash
set -a; source ../../.env; set +a
npm run ingest:local --workspace @bird-watch/ingestor recent
```

Expected (with valid `EBIRD_API_KEY`): JSON summary printed; observations land in DB.

- [ ] **Step 3: Commit**

```bash
git add services/ingestor/src/cli.ts
git commit -m "feat(ingestor): local CLI entry point"
```

---

### Task 11: Generic handler shape for serverless wrappers

**Files:**
- Create: `services/ingestor/src/handler.ts`
- Modify: `services/ingestor/src/index.ts` (create if absent)

- [ ] **Step 1: Write the handler**

`services/ingestor/src/handler.ts`:
```typescript
import { createPool, closePool } from '@bird-watch/db-client';
import { runIngest, type RunSummary } from './run-ingest.js';
import { runHotspotIngest, type RunHotspotSummary } from './run-hotspots.js';
import { runBackfill, type RunBackfillSummary } from './run-backfill.js';

export interface HandlerEnv {
  DATABASE_URL: string;
  EBIRD_API_KEY: string;
}

export type ScheduledKind = 'recent' | 'hotspots' | 'backfill';

/**
 * Platform-agnostic entry. Accepts `kind` and an env object; constructs a
 * pool, runs the appropriate flow, closes the pool, returns the summary.
 *
 * Cloudflare Worker wrapper (Plan 5) calls this from `scheduled()`.
 */
export async function handleScheduled(
  kind: ScheduledKind,
  env: HandlerEnv
): Promise<RunSummary | RunHotspotSummary | RunBackfillSummary> {
  const pool = createPool({ databaseUrl: env.DATABASE_URL });
  try {
    switch (kind) {
      case 'recent':
        return await runIngest({ pool, apiKey: env.EBIRD_API_KEY, regionCode: 'US-AZ' });
      case 'hotspots':
        return await runHotspotIngest({ pool, apiKey: env.EBIRD_API_KEY, regionCode: 'US-AZ' });
      case 'backfill':
        return await runBackfill({
          pool, apiKey: env.EBIRD_API_KEY, regionCode: 'US-AZ', days: 30,
        });
    }
  } finally {
    await closePool(pool);
  }
}
```

- [ ] **Step 2: Write `services/ingestor/src/index.ts`**

```typescript
export { handleScheduled, type HandlerEnv, type ScheduledKind } from './handler.js';
export { runIngest, type RunSummary } from './run-ingest.js';
export { runHotspotIngest, type RunHotspotSummary } from './run-hotspots.js';
export { runBackfill, type RunBackfillSummary } from './run-backfill.js';
```

- [ ] **Step 3: Build**

```bash
npm run build --workspace @bird-watch/ingestor
```

Expected: clean compile, `dist/` contains `index.js` etc.

- [ ] **Step 4: Commit**

```bash
git add services/ingestor/src/handler.ts services/ingestor/src/index.ts
git commit -m "feat(ingestor): platform-agnostic scheduled handler"
```

---

## Self-review checklist (run before declaring Plan 2 done)

- [ ] All ingestor tests pass against fresh PostGIS containers
- [ ] `runIngest` is idempotent (the test enforces this)
- [ ] `is_notable` is correctly stamped from the notable endpoint
- [ ] Failure cases are recorded in `ingest_runs.status='failure'` with the error message
- [ ] `npm run build --workspace @bird-watch/ingestor` succeeds
- [ ] CLI prints a JSON summary when run with valid env

When all checked: Plan 2 is done. Move on to Plan 3.
