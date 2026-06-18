import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { CONUS_STATE_CODES } from '@bird-watch/shared-types';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { upsertSpeciesMeta, getObservations, getRecentIngestRuns } from '@bird-watch/db-client';
import { runIngest } from './run-ingest.js';
import type { EbirdClient } from '../ebird/client.js';

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

/** Stub /recent + /recent/notable for a single state. */
function stateHandlers(state: string, recent: JsonBodyType, notable: JsonBodyType) {
  return [
    http.get(`https://api.ebird.org/v2/data/obs/${state}/recent`, () => HttpResponse.json(recent)),
    http.get(`https://api.ebird.org/v2/data/obs/${state}/recent/notable`, () => HttpResponse.json(notable)),
  ];
}

beforeAll(async () => {
  db = await startTestDb();
  server.listen({ onUnhandledRequest: 'error' });
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

describe('runIngest — single-state fan-out semantics', () => {
  it('fetches recent + notable, upserts, and stamps region/silhouette/is_notable', async () => {
    server.use(...stateHandlers('US-AZ', RECENT, NOTABLE));

    const summary = await runIngest({
      pool: db.pool,
      apiKey: 'test-key',
      stateCodes: ['US-AZ'],
      paceMs: 0,
      back: 14,
    });

    expect(summary.fetched).toBe(2);
    expect(summary.upserted).toBe(2);
    expect(summary.status).toBe('success');
    expect(summary.statesSucceeded).toBe(1);
    expect(summary.statesFailed).toBe(0);

    const { data: obs } = await getObservations(db.pool, {});
    expect(obs).toHaveLength(2);
    const verm = obs.find(o => o.subId === 'S100')!;
    // regionId removed from wire shape by PR-2 of #532; column dropped in PR-3.
    expect(verm).not.toHaveProperty('regionId');
    expect(verm.silhouetteId).toBe('tyrannidae');
    expect(verm.isNotable).toBe(false);
    const anna = obs.find(o => o.subId === 'S101')!;
    expect(anna).not.toHaveProperty('regionId');
    expect(anna.silhouetteId).toBe('trochilidae');
    expect(anna.isNotable).toBe(true);

    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('success');
    expect(runs[0]?.kind).toBe('recent');
  });

  it('is idempotent — second run with same data does not duplicate', async () => {
    server.use(...stateHandlers('US-AZ', RECENT, []));
    await runIngest({ pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ'], paceMs: 0 });
    await runIngest({ pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ'], paceMs: 0 });
    const { data: obs } = await getObservations(db.pool, {});
    expect(obs).toHaveLength(2);
  });
});

describe('runIngest — per-state fan-out across all CONUS states (#840)', () => {
  it('calls /recent + /recent/notable for every one of the 49 CONUS states', async () => {
    const recentHits = new Set<string>();
    const notableHits = new Set<string>();
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/:region/recent', ({ params }) => {
        recentHits.add(params.region as string);
        return HttpResponse.json(RECENT);
      }),
      http.get('https://api.ebird.org/v2/data/obs/:region/recent/notable', ({ params }) => {
        notableHits.add(params.region as string);
        return HttpResponse.json([]);
      }),
    );

    const summary = await runIngest({
      pool: db.pool,
      apiKey: 'k',
      paceMs: 0, // no real waiting in tests
    });

    expect(summary.status).toBe('success');
    expect(summary.statesSucceeded).toBe(CONUS_STATE_CODES.length);
    expect(summary.statesFailed).toBe(0);
    // Default fan-out hits every CONUS state for both endpoints.
    for (const state of CONUS_STATE_CODES) {
      expect(recentHits.has(state)).toBe(true);
      expect(notableHits.has(state)).toBe(true);
    }
    expect(recentHits.size).toBe(CONUS_STATE_CODES.length);
    // ...and only CONUS states (no nationwide 'US' call, no AK/HI).
    expect(recentHits.has('US')).toBe(false);
    expect(recentHits.has('US-AK')).toBe(false);
    expect(recentHits.has('US-HI')).toBe(false);
  });

  it('per-state notable intersection is state-local — a notable subId in one state does NOT mark the same code in another', async () => {
    // US-AZ: S101/annhum is notable. US-NM returns the same speciesCode under a
    // DIFFERENT subId (S201) and an EMPTY notable list → must NOT be notable.
    const NM_RECENT = [
      { ...RECENT[1], subId: 'S201', locId: 'L9', locName: 'Bosque' },
    ];
    server.use(
      ...stateHandlers('US-AZ', RECENT, NOTABLE),
      ...stateHandlers('US-NM', NM_RECENT, []),
    );

    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ', 'US-NM'], paceMs: 0,
    });
    expect(summary.status).toBe('success');

    const { data: obs } = await getObservations(db.pool, {});
    const azAnna = obs.find(o => o.subId === 'S101')!;
    const nmAnna = obs.find(o => o.subId === 'S201')!;
    expect(azAnna.isNotable).toBe(true);  // AZ's S101 is in AZ's notable set
    expect(nmAnna.isNotable).toBe(false); // NM's S201 is NOT — keyset is per-state
  });
});

describe('runIngest — eBird 1 rps burst pacing (#999)', () => {
  // eBird enforced new limits effective 2026-06-10: 10k req/day AND a
  // 1 req/sec burst cap (429 on breach). The pre-#999 Promise.all fired a
  // state's /recent + /recent/notable in the same instant, draining eBird's
  // burst bucket ~13 states into every sweep. These tests pin the fix:
  // the pair is strictly sequential and EVERY call (not every state round)
  // is paced.

  it('serializes the per-state pair — fetchNotable does not start until fetchRecent has resolved', async () => {
    const events: string[] = [];
    const fakeClient = {
      async fetchRecent(state: string) {
        events.push(`recent:start:${state}`);
        // Hold the recent call open long enough that a concurrent notable
        // call (the pre-#999 Promise.all shape) would observably start first.
        await new Promise(r => setTimeout(r, 20));
        events.push(`recent:resolve:${state}`);
        return [];
      },
      async fetchNotable(state: string) {
        events.push(`notable:start:${state}`);
        return [];
      },
    } as unknown as EbirdClient;

    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ', 'US-NM'], paceMs: 0,
      client: fakeClient,
    });

    expect(summary.status).toBe('success');
    for (const state of ['US-AZ', 'US-NM']) {
      const recentResolved = events.indexOf(`recent:resolve:${state}`);
      const notableStarted = events.indexOf(`notable:start:${state}`);
      expect(recentResolved).toBeGreaterThanOrEqual(0);
      expect(notableStarted).toBeGreaterThan(recentResolved);
    }
  });

  it('paces EVERY eBird call, skipping only the very first call of the run (per-call, not per-round)', async () => {
    const fakeClient = {
      async fetchRecent() { return []; },
      async fetchNotable() { return []; },
    } as unknown as EbirdClient;

    // Spy on setTimeout instead of asserting wall-clock bounds (flake-prone on
    // slow CI runners under the repo's retries:0 policy). Fake timers are not
    // an option here: node-postgres needs real timers for I/O. Filtering on
    // `delay === 25` isolates the pacing sleeps from pg/infra timers — the
    // same pattern as run-backfill.test.ts's pacing test.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ', 'US-NM'], paceMs: 25,
      client: fakeClient,
    });

    expect(summary.status).toBe('success');
    const pacingCalls = setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 25);
    // 2 states × 2 calls = 4 eBird calls; per-call pacing sleeps before every
    // call except the run's first → exactly 3. The pre-#999 per-round pacing
    // would have slept exactly once (between the two state rounds).
    expect(pacingCalls).toHaveLength(3);
    setTimeoutSpy.mockRestore();
  });

  it('defaults paceMs to 1500 when not injected (eBird burst cap headroom)', async () => {
    const fakeClient = {
      async fetchRecent() { return []; },
      async fetchNotable() { return []; },
    } as unknown as EbirdClient;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    // One state = 2 calls = exactly 1 pacing sleep at the default. This test
    // pays one real 1.5s wait to pin the default without exporting the
    // constant.
    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ'],
      client: fakeClient,
    });

    expect(summary.status).toBe('success');
    const pacingCalls = setTimeoutSpy.mock.calls.filter(([, delay]) => delay === 1_500);
    expect(pacingCalls).toHaveLength(1);
    setTimeoutSpy.mockRestore();
  });
});

describe('runIngest — partial-failure isolation + status ladder (#840)', () => {
  it('isolates one state failure: others still upsert; status=partial under the threshold', async () => {
    // US-AZ succeeds, US-NM 500s. With the default threshold (5), 1 failure → partial.
    server.use(
      ...stateHandlers('US-AZ', RECENT, []),
      http.get('https://api.ebird.org/v2/data/obs/US-NM/recent',
        () => new HttpResponse('boom', { status: 500 })),
      http.get('https://api.ebird.org/v2/data/obs/US-NM/recent/notable',
        () => HttpResponse.json([])),
    );

    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ', 'US-NM'], paceMs: 0,
      retryBaseMs: 1, maxRetries: 1,
    });

    expect(summary.status).toBe('partial');
    expect(summary.statesSucceeded).toBe(1);
    expect(summary.statesFailed).toBe(1);
    // The failed-state info rides the summary on `partial` (not only `failure`)
    // so cli.ts can surface it in the run-completed line — a degraded-but-green
    // run must read as degraded in the aggregate log, not just the per-state
    // WARNING lines (#840 review).
    expect(summary.failures?.[0]?.state).toBe('US-NM');
    expect(summary.failures?.[0]?.error).toBeDefined();
    // AZ's two observations still landed despite NM failing.
    const { data: obs } = await getObservations(db.pool, {});
    expect(obs).toHaveLength(2);
    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('partial');
  });

  it('status=partial at exactly the threshold; status=failure one over it (boundary)', async () => {
    // 6-state list, threshold=2. Two failing states → partial; the SAME list
    // with three failing states → failure. This pins the cli heartbeat
    // behavior: cli pings the success heartbeat on success AND partial, only
    // failure skips it, so the cutover is load-bearing.
    const ok = ['US-AZ', 'US-CA', 'US-CO', 'US-NV'];
    const okHandlers = ok.flatMap(s => stateHandlers(s, [], []));
    const fail = (state: string) => [
      http.get(`https://api.ebird.org/v2/data/obs/${state}/recent`,
        () => new HttpResponse('boom', { status: 500 })),
      http.get(`https://api.ebird.org/v2/data/obs/${state}/recent/notable`,
        () => HttpResponse.json([])),
    ];

    // 2 failures, threshold 2 → partial
    server.use(...okHandlers, ...fail('US-NM'), ...fail('US-TX'));
    const partial = await runIngest({
      pool: db.pool, apiKey: 'k',
      stateCodes: [...ok, 'US-NM', 'US-TX'], paceMs: 0,
      partialFailureThreshold: 2, retryBaseMs: 1, maxRetries: 1,
    });
    expect(partial.statesFailed).toBe(2);
    expect(partial.status).toBe('partial');

    server.resetHandlers();
    await db.pool.query('TRUNCATE observations');
    await db.pool.query('TRUNCATE ingest_runs RESTART IDENTITY');

    // 3 failures, threshold 2 → failure
    server.use(...stateHandlers('US-AZ', [], []), ...stateHandlers('US-CA', [], []),
      ...stateHandlers('US-CO', [], []),
      ...fail('US-NM'), ...fail('US-TX'), ...fail('US-NV'));
    const failure = await runIngest({
      pool: db.pool, apiKey: 'k',
      stateCodes: ['US-AZ', 'US-CA', 'US-CO', 'US-NM', 'US-TX', 'US-NV'], paceMs: 0,
      partialFailureThreshold: 2, retryBaseMs: 1, maxRetries: 1,
    });
    expect(failure.statesFailed).toBe(3);
    expect(failure.status).toBe('failure');
    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('failure');
  });
});

describe('runIngest — 429 circuit-break (#840)', () => {
  it('aborts the run as failure after consecutive 429s rather than hammering every state', async () => {
    // Every state 429s. With max429Streak=3 the fan-out must stop after the
    // 3rd consecutive 429 and report failure — NOT grind through all states.
    const hits = new Set<string>();
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/:region/recent', ({ params }) => {
        hits.add(params.region as string);
        return new HttpResponse('rate limited', { status: 429, headers: { 'retry-after': '0' } });
      }),
      http.get('https://api.ebird.org/v2/data/obs/:region/recent/notable',
        () => HttpResponse.json([])),
    );

    const summary = await runIngest({
      pool: db.pool, apiKey: 'k',
      // a long list so the test proves it STOPS early rather than running to end
      stateCodes: CONUS_STATE_CODES,
      paceMs: 0, retryBaseMs: 1, maxRetries: 1,
      max429Streak: 3,
    });

    expect(summary.status).toBe('failure');
    expect(summary.error).toMatch(/429/);
    // Circuit broke after the 3rd state — did NOT touch all 49.
    expect(hits.size).toBe(3);
    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('failure');
    expect(runs[0]?.errorMessage).toMatch(/429/);
  });

  it('a 429 streak interrupted by a success resets the counter (no false circuit-break)', async () => {
    // AZ 429s once, CA succeeds (resets streak), NM 429s once. With
    // max429Streak=2 the streak never reaches 2 consecutively → run is partial,
    // not failure.
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent',
        () => new HttpResponse('rl', { status: 429, headers: { 'retry-after': '0' } })),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable',
        () => HttpResponse.json([])),
      ...stateHandlers('US-CA', RECENT, []),
      http.get('https://api.ebird.org/v2/data/obs/US-NM/recent',
        () => new HttpResponse('rl', { status: 429, headers: { 'retry-after': '0' } })),
      http.get('https://api.ebird.org/v2/data/obs/US-NM/recent/notable',
        () => HttpResponse.json([])),
    );

    const summary = await runIngest({
      pool: db.pool, apiKey: 'k',
      stateCodes: ['US-AZ', 'US-CA', 'US-NM'], paceMs: 0,
      retryBaseMs: 1, maxRetries: 1, max429Streak: 2, partialFailureThreshold: 5,
    });

    expect(summary.status).toBe('partial');
    expect(summary.statesSucceeded).toBe(1); // CA
    expect(summary.statesFailed).toBe(2);    // AZ + NM (429-as-failure)
    const { data: obs } = await getObservations(db.pool, {});
    expect(obs).toHaveLength(2); // CA's two observations landed
  });
});

describe('runIngest — #484 species-meta invariant (preserved across the fan-out)', () => {
  it('fails the ingest when an observation references a missing species_meta row', async () => {
    const RECENT_WITH_LEAK = [
      ...RECENT,
      // `xUNKNOWN1` is a synthetic eBird-style spuh code with no species_meta
      // row — simulates the bug class from #484 (`ixlbun`, `x00059`, etc.).
      { speciesCode: 'xUNKNOWN1', comName: 'Unknown Hybrid',
        sciName: 'Genus species x other', locId: 'L3', locName: 'Test',
        obsDt: '2026-04-15 10:00', howMany: 1, lat: 32.30, lng: -110.99,
        obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S102' },
    ];
    server.use(...stateHandlers('US-AZ', RECENT_WITH_LEAK, []));

    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ'], paceMs: 0,
    });

    expect(summary.status).toBe('failure');
    expect(summary.error).toBeDefined();
    // Error message must name the offending code(s) so a triage agent can jump
    // straight to a `species_meta` backfill PR.
    expect(summary.error).toContain('xUNKNOWN1');
    // No observations may have been inserted — the invariant runs BEFORE upsert,
    // so a leak fails the whole batch rather than corrupting the read path.
    const { data: obs } = await getObservations(db.pool, {});
    expect(obs).toHaveLength(0);
    const runs = await getRecentIngestRuns(db.pool, 5);
    expect(runs[0]?.status).toBe('failure');
    expect(runs[0]?.errorMessage).toContain('xUNKNOWN1');
  });

  it('succeeds (no false-positive invariant trip) when every observation has a species_meta row', async () => {
    server.use(...stateHandlers('US-AZ', RECENT, []));
    const summary = await runIngest({
      pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ'], paceMs: 0,
    });
    expect(summary.status).toBe('success');
    expect(summary.upserted).toBe(2);
  });
});
