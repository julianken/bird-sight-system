import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import { upsertSpeciesMeta, getObservations, getRecentIngestRuns } from '@bird-watch/db-client';
import { runBackfill } from './run-backfill.js';
import { runIngest } from './run-ingest.js';
import { EbirdClient } from '../ebird/client.js';

const server = setupServer();
let db: TestDb;

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
beforeEach(async () => { await db.pool.query('TRUNCATE observations'); });
afterAll(async () => { server.close(); await db?.stop(); });

// Shared observation fixtures used across several tests.
const TODAY_OBS = {
  speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
  sciName: 'Calypte anna', locId: 'L99', locName: 'Sweetwater',
  obsDt: '2026-04-16 08:00', howMany: 1, lat: 32.30, lng: -110.99,
  obsValid: true, obsReviewed: false, locationPrivate: false, subId: 'S999',
};

describe('runBackfill', () => {
  it('walks N days back and upserts observations from each day', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([])),
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
    // paceMs: 0 — pacing now defaults to 1500 (#999); tests opt out for speed,
    // matching the run-ingest.test.ts convention.
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      days: 3, today, paceMs: 0,
    });
    expect(calls).toBe(3);
    expect(summary.status).toBe('success');
    const { data: obs } = await getObservations(db.pool, {});
    expect(obs).toHaveLength(3);
  });

  it('preserves is_notable=true after backfill re-processes a day runIngest already stamped', async () => {
    // Step 1: runIngest stamps annhum as notable.
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent', () =>
        HttpResponse.json([TODAY_OBS])
      ),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () =>
        HttpResponse.json([TODAY_OBS])   // annhum is notable
      ),
    );
    // runIngest now fans out per-state (#840); scope to US-AZ with no pacing so
    // this backfill OR-coalesce test still drives a single-state recent ingest.
    await runIngest({ pool: db.pool, apiKey: 'k', stateCodes: ['US-AZ'], paceMs: 0 });

    // Confirm it was stamped notable.
    let { data: obs } = await getObservations(db.pool, {});
    expect(obs.find(o => o.subId === 'S999')?.isNotable).toBe(true);

    // Step 2: runBackfill with back=3 days — its /recent/notable returns [] (empty keyset).
    // The OR-coalesce in upsertObservations must keep is_notable=true.
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () =>
        HttpResponse.json([])   // empty — backfill doesn't know about notable
      ),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', () =>
        HttpResponse.json([TODAY_OBS])   // same observation, same subId
      ),
    );
    const today = new Date('2026-04-16T00:00:00Z');
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      days: 3, today, paceMs: 0,
    });
    expect(summary.status).toBe('success');

    // is_notable must still be true — OR-coalesce defended against the empty keyset.
    obs = (await getObservations(db.pool, {})).data;
    expect(obs.find(o => o.subId === 'S999')?.isNotable).toBe(true);
  });

  it('returns status=partial when some days fail, successful days still upserted', async () => {
    // Day offsets: i=1 (day -1) → 200, i=2 (day -2) → 500, i=3 (day -3) → 200.
    let callCount = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([])),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', ({ params }) => {
        callCount++;
        const day = Number(params['d']);
        // Apr 15 (day=15) and Apr 13 (day=13) succeed; Apr 14 (day=14) fails.
        if (day === 14) {
          return new HttpResponse('eBird server exploded', { status: 500 });
        }
        return HttpResponse.json([
          { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
            sciName: 'Pyrocephalus rubinus', locId: `L${callCount}`, locName: 'X',
            obsDt: `2026-04-${String(day).padStart(2, '0')} 08:00`,
            howMany: 1, lat: 31.72, lng: -110.88,
            obsValid: true, obsReviewed: false, locationPrivate: false,
            subId: `SDay${day}` },
        ]);
      }),
    );

    // today = Apr 16; i=1→Apr15, i=2→Apr14 (500), i=3→Apr13
    // Use maxRetries=0 so the 500 fails fast without waiting on backoff.
    const today = new Date('2026-04-16T00:00:00Z');
    const client = new EbirdClient({ apiKey: 'k', maxRetries: 0 });
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      days: 3, today, client, paceMs: 0,
    });

    expect(summary.status).toBe('partial');
    expect(summary.daysProcessed).toBe(2);
    expect(summary.error).toMatch(/500|server/i);

    // Days 1 and 3 (Apr 15 + Apr 13) must have been upserted.
    const { data: obs } = await getObservations(db.pool, {});
    const subIds = obs.map(o => o.subId).sort();
    expect(subIds).toContain('SDay15');
    expect(subIds).toContain('SDay13');
  });

  it('defaults paceMs to 1500 when not injected (eBird 1 rps burst cap, #999)', async () => {
    // eBird's limits effective 2026-06-10 include a 1 req/sec burst cap. The
    // daily 04:00 backfill previously defaulted paceMs to 0 — up to 20
    // back-to-back /historic calls with no pacing. Pin the new default
    // behaviorally via the setTimeout spy (no exported constant — knip flags
    // test-only exports): days=2 with the default → exactly one 1500ms pacing
    // sleep (between the two historic calls; never before the first).
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([])),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', () => HttpResponse.json([])),
    );
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const today = new Date('2026-04-16T00:00:00Z');
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ', days: 2, today,
    });

    expect(summary.status).toBe('success');
    const pacingCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 1_500
    );
    expect(pacingCalls).toHaveLength(1);
    setTimeoutSpy.mockRestore();
  });

  it('paces successive day fetches when paceMs > 0, skipping the wait before the first call', async () => {
    // Mirrors the run-photos.ts:113-116 pattern: a run with N days should sit
    // idle for paceMs * (N - 1), not paceMs * N. Skip the wait before the
    // first call so a 365-day backfill at 1 rps completes in ~364s, not 365s.
    let calls = 0;
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([])),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', () => {
        calls++;
        return HttpResponse.json([
          { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
            sciName: 'Pyrocephalus rubinus', locId: `LP${calls}`, locName: 'X',
            obsDt: '2026-04-10 08:00', howMany: 1, lat: 31.72, lng: -110.88,
            obsValid: true, obsReviewed: false, locationPrivate: false,
            subId: `SP${calls}` },
        ]);
      }),
    );

    // Spy on setTimeout to capture pacing calls exactly, instead of asserting
    // wall-clock elapsed bounds (flake-prone on slow CI runners under
    // CLAUDE.md's `retries: 0` policy). We can't use vi.useFakeTimers() here
    // because msw + node-postgres rely on real timers for network I/O.
    //
    // The exact property: when days=3 and paceMs=50, run-backfill.ts must
    // call setTimeout(<resolve>, 50) exactly 2 times — once between calls 1-2
    // and once between calls 2-3 — and never before the first call. Filtering
    // on `delay === 50` excludes setTimeout calls from msw, pg, etc.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const today = new Date('2026-04-16T00:00:00Z');
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      days: 3, today, paceMs: 50,
    });

    expect(summary.status).toBe('success');
    expect(calls).toBe(3);

    // Count only the pacing setTimeouts (delay === 50ms). Anything else is
    // unrelated infrastructure timer activity.
    const pacingCalls = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 50
    );
    // Exact: 2 pacing sleeps for 3 days. If the implementation regressed to
    // pacing before the first call, this would be 3.
    expect(pacingCalls).toHaveLength(2);

    setTimeoutSpy.mockRestore();
  });

  it('emits bird_ingest_day_failed with phase=fetch when a day\'s fetch errors', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([])),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', ({ params }) => {
        const day = Number(params['d']);
        if (day === 14) return new HttpResponse('eBird exploded', { status: 500 });
        return HttpResponse.json([
          { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
            sciName: 'Pyrocephalus rubinus', locId: `LF${day}`, locName: 'X',
            obsDt: `2026-04-${String(day).padStart(2, '0')} 08:00`,
            howMany: 1, lat: 31.72, lng: -110.88,
            obsValid: true, obsReviewed: false, locationPrivate: false,
            subId: `SF${day}` },
        ]);
      }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const today = new Date('2026-04-16T00:00:00Z');
    const client = new EbirdClient({ apiKey: 'k', maxRetries: 0 });
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ',
      days: 3, today, client, paceMs: 0,
    });
    expect(summary.status).toBe('partial');

    const warnObjs = warnSpy.mock.calls
      .map(([a]) => { try { return JSON.parse(String(a)); } catch { return null; } })
      .filter((o): o is Record<string, unknown> => !!o && (o as Record<string, unknown>).message === 'bird_ingest_day_failed');
    expect(warnObjs).toHaveLength(1);
    expect(warnObjs[0]).toMatchObject({
      kind: 'backfill', message: 'bird_ingest_day_failed',
      state: 'US-AZ', phase: 'fetch', dayOffset: 2, date: '2026-04-14',
    });
    expect(String(warnObjs[0]?.['error'])).toMatch(/500|server|exploded/i);

    const okObjs = logSpy.mock.calls
      .map(([a]) => { try { return JSON.parse(String(a)); } catch { return null; } })
      .filter((o): o is Record<string, unknown> => !!o && (o as Record<string, unknown>).message === 'bird_ingest_day_succeeded');
    expect(okObjs).toHaveLength(2);
    expect(okObjs[0]).toMatchObject({
      kind: 'backfill', message: 'bird_ingest_day_succeeded',
      state: 'US-AZ', fetched: 1,
    });

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('emits bird_ingest_day_failed with phase=upsert when upsertObservations throws mid-loop', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () => HttpResponse.json([])),
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d', () =>
        HttpResponse.json([
          { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
            sciName: 'Pyrocephalus rubinus', locId: 'LU2', locName: 'X',
            obsDt: '2026-04-15 08:00', howMany: 1, lat: 31.72, lng: -110.88,
            obsValid: true, obsReviewed: false, locationPrivate: false,
            subId: 'SU2' },
        ])
      ),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Wrap real pool: pass through startIngestRun/finishIngestRun (which use
    // INSERT/UPDATE on ingest_runs via pool.query) but throw on the observations
    // multi-row INSERT. As of #843 upsertObservations runs inside a transaction
    // on a connected client (pool.connect() -> client.query), so the synthetic
    // failure must be injected on BOTH paths: the direct pool.query path AND the
    // connected-client path. Intercepting only pool.query (the pre-#843 shape)
    // would let the real INSERT succeed and the status==='failure' assertion
    // would never trip.
    const rejectIfObservationsInsert = (
      text: string | { text?: string },
      pass: (t: never, p: never) => Promise<unknown>,
      params?: unknown[],
    ) => {
      const sql = typeof text === 'string' ? text : text.text ?? '';
      if (sql.includes('observations') && /INSERT/i.test(sql)) {
        return Promise.reject(new Error('synthetic upsert failure'));
      }
      return pass(text as never, params as never);
    };
    const realQuery = db.pool.query.bind(db.pool);
    const wrappedPool = new Proxy(db.pool, {
      get(target, prop) {
        if (prop === 'query') {
          return (text: string, params?: unknown[]) =>
            rejectIfObservationsInsert(text, realQuery, params);
        }
        if (prop === 'connect') {
          // upsertObservations() acquires a client and runs
          // BEGIN / INSERT / stamp / COMMIT (or ROLLBACK) on it. Return a Proxy
          // over the REAL client so BEGIN/ROLLBACK/COMMIT and release() behave
          // normally, but the observations INSERT rejects with the same
          // synthetic failure — driving the catch -> ROLLBACK -> rethrow path.
          return async () => {
            const client = await db.pool.connect();
            const realClientQuery = client.query.bind(client);
            return new Proxy(client, {
              get(clientTarget, clientProp) {
                if (clientProp === 'query') {
                  return (text: string, params?: unknown[]) =>
                    rejectIfObservationsInsert(text, realClientQuery, params);
                }
                const value = (clientTarget as unknown as Record<string | symbol, unknown>)[clientProp as string];
                return typeof value === 'function' ? value.bind(clientTarget) : value;
              },
            });
          };
        }
        return (target as unknown as Record<string | symbol, unknown>)[prop as string];
      },
    });

    const today = new Date('2026-04-16T00:00:00Z');
    const summary = await runBackfill({
      pool: wrappedPool, apiKey: 'k', regionCode: 'US-AZ',
      days: 1, today,
    });
    expect(summary.status).toBe('failure');
    expect(summary.error).toMatch(/synthetic upsert failure/);

    const warnObjs = warnSpy.mock.calls
      .map(([a]) => { try { return JSON.parse(String(a)); } catch { return null; } })
      .filter((o): o is Record<string, unknown> => !!o && (o as Record<string, unknown>).message === 'bird_ingest_day_failed');
    expect(warnObjs).toHaveLength(1);
    expect(warnObjs[0]).toMatchObject({
      kind: 'backfill', message: 'bird_ingest_day_failed',
      state: 'US-AZ', phase: 'upsert', dayOffset: 1,
    });
    expect(String(warnObjs[0]?.['error'])).toMatch(/synthetic upsert failure/);

    warnSpy.mockRestore();
  });

  it('records failure when pre-loop fetchNotable throws exhausted retries', async () => {
    server.use(
      http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable', () =>
        new HttpResponse('bad gateway', { status: 502 })
      )
    );
    const client = new EbirdClient({ apiKey: 'k', maxRetries: 0, retryBaseMs: 1 });
    const summary = await runBackfill({
      pool: db.pool, apiKey: 'k', regionCode: 'US-AZ', days: 3, client,
    });
    expect(summary.status).toBe('failure');
    expect(summary.error).toMatch(/502|server/i);

    const runs = await getRecentIngestRuns(db.pool, 10);
    expect(runs[0]?.status).toBe('failure');
  });

  it('default-constructs EbirdClient with requestTimeoutMs=120000 when o.client is omitted', async () => {
    // The /historic endpoint regularly exceeds the 30s default on high-density
    // states (CA/FL/TX/NY) — entire CA backfill runs failed reproducibly with
    // `eBird server error 0: Request timed out after 30000ms` across all 14
    // days. Scoping the 120s timeout to backfill (rather than the EbirdClient
    // global default) preserves /recent and /hotspots failure detection at
    // 30s. This test pins that contract so a future refactor can't silently
    // drop the override.
    //
    // TS `private` is a compile-time fiction; the field is reachable at
    // runtime. We do a behavioral run-through (runBackfill with no o.client)
    // so the constructor path actually executes, then assert the field on
    // the client run-backfill built. To get a handle on that client without
    // refactoring run-backfill to expose it, intercept via a Proxy on the
    // imported class. ESM namespace objects are mutable under vitest's
    // loader, so re-binding the export propagates to run-backfill's
    // `EbirdClient` reference for the duration of this test.
    const ebirdModule = await import('../ebird/client.js');
    const Real = ebirdModule.EbirdClient;
    let constructed: { requestTimeoutMs: number } | undefined;
    const Proxied = new Proxy(Real, {
      construct(target, args) {
        const instance = Reflect.construct(target, args);
        constructed = instance as unknown as { requestTimeoutMs: number };
        return instance;
      },
    });
    Object.defineProperty(ebirdModule, 'EbirdClient', {
      value: Proxied, configurable: true, writable: true,
    });

    try {
      server.use(
        http.get('https://api.ebird.org/v2/data/obs/US-AZ/recent/notable',
          () => HttpResponse.json([])),
        http.get('https://api.ebird.org/v2/data/obs/US-AZ/historic/:y/:m/:d',
          () => HttpResponse.json([])),
      );
      const today = new Date('2026-04-16T00:00:00Z');
      await runBackfill({
        pool: db.pool, apiKey: 'k', regionCode: 'US-AZ', days: 1, today,
      });
    } finally {
      Object.defineProperty(ebirdModule, 'EbirdClient', {
        value: Real, configurable: true, writable: true,
      });
    }

    expect(constructed).toBeDefined();
    expect(constructed!.requestTimeoutMs).toBe(120_000);
  });
});
