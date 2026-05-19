import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import {
  upsertHotspots,
  upsertSpeciesMeta,
  upsertObservations,
  insertSpeciesPhoto,
  insertSpeciesDescription,
} from '@bird-watch/db-client';
import { createApp } from './app.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

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
      .toBe('public, s-maxage=600, stale-while-revalidate=1200');
    const body = await res.json() as Array<{ locId: string; locName: string }>;
    expect(body[0]?.locId).toBe('L207118');
    expect(body[0]?.locName).toBe('Sweetwater Wetlands');
  });
});

describe('GET /api/observations', () => {
  beforeAll(async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'annhum', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
    ]);
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, [
      { subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: new Date(Date.now() - 5*86400_000).toISOString(),
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'S2', speciesCode: 'annhum', comName: "Anna's Hummingbird",
        lat: 32.30, lng: -110.99, obsDt: new Date(Date.now() - 20*86400_000).toISOString(),
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
    ]);
  });

  // Helper type matching the new ObservationsResponse envelope
  type ObsEnvelope = {
    data: Array<{ subId: string; familyCode?: string | null; [k: string]: unknown }>;
    meta: { freshestObservationAt: string | null };
  };

  // Default bbox covering both seeded observations (lat 31.72/32.30, lng
  // -110.88/-110.99). #667 Scope C.1 requires bbox OR species on every
  // per-observation request, so seed-dependent tests pin a known-good bbox.
  const BBOX_AZ = '-112,31,-110,33';

  it('returns observations with correct cache header', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations?since=14d&bbox=${BBOX_AZ}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, s-maxage=300, stale-while-revalidate=600');
    const body = await res.json() as ObsEnvelope;
    // Only S1 falls within 14d (S2 is 20d old).
    expect(body.data).toHaveLength(1);
  });

  it('returns meta.freshestObservationAt as an ISO string (#456 W3-A)', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations?since=14d&bbox=${BBOX_AZ}`);
    expect(res.status).toBe(200);
    const body = await res.json() as ObsEnvelope;
    // freshestObservationAt must be a non-null ISO string — the table has rows
    expect(body.meta.freshestObservationAt).not.toBeNull();
    expect(typeof body.meta.freshestObservationAt).toBe('string');
    // Validate ISO 8601 format (YYYY-MM-DDTHH:mm:ss..Z)
    expect(body.meta.freshestObservationAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    );
  });

  it('returns meta.freshestObservationAt null when observations table is empty (#456 W3-A)', async () => {
    // Truncate then immediately test. Restore happens implicitly since
    // beforeAll re-seeds for future tests in this suite.
    await db.pool.query('TRUNCATE observations');
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations?bbox=${BBOX_AZ}`);
    expect(res.status).toBe(200);
    const body = await res.json() as ObsEnvelope;
    expect(body.meta.freshestObservationAt).toBeNull();
    // Re-seed so subsequent tests in this describe are not affected
    await upsertObservations(db.pool, [
      { subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: new Date(Date.now() - 5*86400_000).toISOString(),
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'S2', speciesCode: 'annhum', comName: "Anna's Hummingbird",
        lat: 32.30, lng: -110.99, obsDt: new Date(Date.now() - 20*86400_000).toISOString(),
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
    ]);
  });

  it('projects familyCode from species_meta onto each observation (#57)', async () => {
    const app = createApp({ pool: db.pool });
    // No since filter → both rows returned.
    const res = await app.request(`/api/observations?bbox=${BBOX_AZ}`);
    expect(res.status).toBe(200);
    const body = await res.json() as ObsEnvelope;
    const byId = Object.fromEntries(body.data.map(o => [o.subId, o.familyCode]));
    expect(byId['S1']).toBe('tyrannidae');
    expect(byId['S2']).toBe('trochilidae');
  });

  it('filters by since=14d', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations?since=14d&bbox=${BBOX_AZ}`);
    const body = await res.json() as ObsEnvelope;
    expect(body.data.map(o => o.subId)).toEqual(['S1']);
  });

  it('filters by notable=true', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations?bbox=${BBOX_AZ}&notable=true`);
    const body = await res.json() as ObsEnvelope;
    expect(body.data.map(o => o.subId)).toEqual(['S2']);
  });

  it('filters by species code', async () => {
    const app = createApp({ pool: db.pool });
    // Species-filtered request needs no bbox per #667 Scope C.1.
    const res = await app.request('/api/observations?species=vermfly');
    const body = await res.json() as ObsEnvelope;
    expect(body.data.map(o => o.subId)).toEqual(['S1']);
  });

  it('filters by family code (with bbox per #667 Scope C.1)', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations?bbox=${BBOX_AZ}&family=trochilidae`);
    const body = await res.json() as ObsEnvelope;
    expect(body.data.map(o => o.subId)).toEqual(['S2']);
  });

  it('rejects invalid since values with 400', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?since=banana');
    expect(res.status).toBe(400);
  });

  // #667 — strict validation of notable / species / family. Each rejection
  // emits a single structured 'validation_400' log line (Addendum §7).
  describe('strict allowlist validation (#667)', () => {
    it('rejects ?notable=banana with 400 + structured log', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const app = createApp({ pool: db.pool });
        const res = await app.request('/api/observations?notable=banana');
        expect(res.status).toBe(400);
        const body = await res.json() as { error: string };
        expect(body.error).toBe('invalid notable');
        const log = logSpy.mock.calls
          .map(args => args[0])
          .filter((a): a is string => typeof a === 'string')
          .map(s => { try { return JSON.parse(s); } catch { return null; } })
          .find((p): p is Record<string, unknown> =>
            !!p && p.message === 'validation_400' && p.param === 'notable');
        expect(log).toBeDefined();
        expect(log!.reason).toBe('not_in_allowlist');
        // Hash, not raw value — guard against PII / scraper payload leak.
        expect(log!.received_hash).toMatch(/^[a-f0-9]{8}$/);
        expect(JSON.stringify(log)).not.toContain('banana');
      } finally {
        logSpy.mockRestore();
      }
    });

    it.each([
      ['species', '%',                  'regex_mismatch'],
      ['species', "' OR 1=1 --",        'regex_mismatch'],
      ['species', 'GAMQUA',             'regex_mismatch'],
      ['family',  '%',                  'regex_mismatch'],
      ['family',  'TYRANNIDAE',         'regex_mismatch'],
    ])('rejects ?%s=%s with 400 (reason=%s)', async (param, value, reason) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const app = createApp({ pool: db.pool });
        const res = await app.request(
          `/api/observations?${param}=${encodeURIComponent(value)}`,
        );
        expect(res.status).toBe(400);
        const log = logSpy.mock.calls
          .map(args => args[0])
          .filter((a): a is string => typeof a === 'string')
          .map(s => { try { return JSON.parse(s); } catch { return null; } })
          .find((p): p is Record<string, unknown> =>
            !!p && p.message === 'validation_400' && p.param === param);
        expect(log).toBeDefined();
        expect(log!.reason).toBe(reason);
      } finally {
        logSpy.mockRestore();
      }
    });

    it.each(['accipi1', 'tyrann1', 'x00013', 'gamqua', 'cardin1'])(
      'accepts real eBird code %s without 400',
      async (code) => {
        const app = createApp({ pool: db.pool });
        const res = await app.request(`/api/observations?species=${code}`);
        // 200 with empty data (no seeded rows for these codes) — the
        // validation layer is what we're asserting, not the data shape.
        expect(res.status).toBe(200);
      },
    );

    it('does NOT echo received value or leak allowlist in 400 body', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request("/api/observations?species=' OR 1=1 --");
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).not.toContain("OR 1=1");
      expect(text).not.toContain('allowlist');
    });
  });

  // #667 Addendum §5 — soft-deprecation window for ?since=30d. Accepts the
  // value, coerces to 14d internally, emits Deprecation/Sunset/Warning
  // headers plus a NOTICE log. Next PR (≥14d post-deploy) flips to hard 400.
  describe('?since=30d soft-deprecation (#667 Addendum §5)', () => {
    it('returns 200 + Deprecation: true + Sunset + Warning: 299', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(`/api/observations?since=30d&bbox=${BBOX_AZ}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('deprecation')).toBe('true');
      expect(res.headers.get('sunset')).toBeTruthy();
      // ISO date is acceptable for Sunset header.
      expect(res.headers.get('sunset')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const warning = res.headers.get('warning') ?? '';
      expect(warning).toContain('299');
      expect(warning).toContain('since=30d');
    });

    it('coerces to 14d internally (S2 at 20d is excluded)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(`/api/observations?since=30d&bbox=${BBOX_AZ}`);
      const body = await res.json() as ObsEnvelope;
      expect(body.data.map(o => o.subId)).toEqual(['S1']);
    });

    it('emits a NOTICE log line with user_agent', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        const app = createApp({ pool: db.pool });
        const res = await app.request(`/api/observations?since=30d&bbox=${BBOX_AZ}`, {
          headers: { 'user-agent': 'curl/8.0' },
        });
        expect(res.status).toBe(200);
        const log = logSpy.mock.calls
          .map(args => args[0])
          .filter((a): a is string => typeof a === 'string')
          .map(s => { try { return JSON.parse(s); } catch { return null; } })
          .find((p): p is Record<string, unknown> =>
            !!p && p.message === 'deprecated_since_30d');
        expect(log).toBeDefined();
        expect(log!.severity).toBe('NOTICE');
        expect(log!.user_agent).toBe('curl/8.0');
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  // #667 Scope C.1 — guard on the per-observation path: bbox OR species.
  describe('bbox-or-species guard (#667 Scope C.1)', () => {
    it('rejects bare /api/observations with 400 (no bbox, no species)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?since=14d');
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('specify bbox or species');
    });

    it('rejects ?family=X without bbox or species (Addendum §4 scrape vector)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?family=trochilidae');
      expect(res.status).toBe(400);
    });

    it('accepts ?species=X with no bbox (deep-link before MapCanvas mounts)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?species=vermfly');
      expect(res.status).toBe(200);
    });

    it('accepts bbox with no species', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(`/api/observations?bbox=${BBOX_AZ}`);
      expect(res.status).toBe(200);
    });
  });

  // #667 Scope C.2 — per-axis bbox cap on the per-observation path. zoom < 6
  // hits aggregated mode (no cap); zoom >= 6 enforces 15° lng × 10° lat.
  describe('per-axis bbox cap (#667 Scope C.2)', () => {
    it('rejects too-wide lng span at zoom=8 with descriptive body', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(
        '/api/observations?bbox=-130,30,-110,40&zoom=8',
      );
      expect(res.status).toBe(400);
      const body = await res.json() as {
        error: string; maxLngSpan: number; maxLatSpan: number; hint: string;
      };
      expect(body.error).toBe('bbox too large');
      expect(body.maxLngSpan).toBe(15);
      expect(body.maxLatSpan).toBe(10);
      expect(body.hint).toContain('zoom out');
    });

    it('accepts state-level bbox (6° × 5°) at zoom=8', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(
        '/api/observations?bbox=-115,32,-109,37&zoom=8',
      );
      expect(res.status).toBe(200);
    });

    it('does NOT cap at zoom=4 (aggregated mode handles unbounded bbox)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(
        '/api/observations?bbox=-180,-90,180,90&zoom=4',
      );
      expect(res.status).toBe(200);
    });
  });

  // #619 — server-side bbox filtering, Phase 2 going-national pre-condition.
  // Note: #667 Scope C.1 made bbox-or-species required on the per-observation
  // path, so the prior "no bbox returns full set" test was deleted as
  // contradictory.
  describe('bbox filtering', () => {
    it('with a valid bbox narrows to in-bounds observations', async () => {
      const app = createApp({ pool: db.pool });
      // Envelope contains only S1 (31.72, -110.88); excludes S2 (32.30, -110.99)
      const res = await app.request(
        `/api/observations?bbox=-111,31.5,-110.85,31.9`
      );
      expect(res.status).toBe(200);
      const body = await res.json() as ObsEnvelope;
      expect(body.data.map(o => o.subId)).toEqual(['S1']);
    });

    it('with a malformed bbox (too few values) returns 400', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?bbox=1,2,3');
      expect(res.status).toBe(400);
    });

    it('with a non-numeric bbox returns 400', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?bbox=a,b,c,d');
      expect(res.status).toBe(400);
    });

    it('with out-of-range lat/lon returns 400', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?bbox=-200,-100,200,100');
      expect(res.status).toBe(400);
    });

    it('aggregates buckets at zoom=4 (bbox + zoom<6 → mode=aggregated, #627)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(
        '/api/observations?bbox=-112,31,-110,33&zoom=4'
      );
      expect(res.status).toBe(200);
      const body = await res.json() as {
        mode: string;
        buckets?: Array<{ count: number; speciesCount: number; families: string[] }>;
        data?: unknown;
        meta: { freshestObservationAt: string | null };
      };
      expect(body.mode).toBe('aggregated');
      expect(Array.isArray(body.buckets)).toBe(true);
      expect(body.data).toBeUndefined();
      // Two seeded observations both fall in the CONUS bbox; both share the
      // same lat band (31-32) so they may land in the same or different
      // 0.25° buckets — either way, the total count across buckets is 2.
      const total = body.buckets!.reduce((s, b) => s + b.count, 0);
      expect(total).toBe(2);
      expect(body.meta.freshestObservationAt).not.toBeNull();
    });

    it('returns per-observation mode at zoom=6 (boundary, #627)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(
        '/api/observations?bbox=-112,31,-110,33&zoom=6'
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { mode: string; data?: unknown[] };
      expect(body.mode).toBe('observations');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('bbox without zoom keeps per-observation mode (backward-compatible)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?bbox=-112,31,-110,33');
      expect(res.status).toBe(200);
      const body = await res.json() as { mode: string; data?: unknown[] };
      expect(body.mode).toBe('observations');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('zoom without bbox or species now returns 400 (#667 Scope C.1)', async () => {
      // Pre-#667 this kept per-observation mode. The bbox-or-species guard
      // now rejects before the aggregation branch fires.
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?zoom=3');
      expect(res.status).toBe(400);
    });

    it('rejects non-integer zoom with 400', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?zoom=3.5');
      expect(res.status).toBe(400);
    });

    it('rejects out-of-range zoom with 400', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?zoom=99');
      expect(res.status).toBe(400);
    });

    it('preserves the s-maxage=300 cache header when bbox present', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(
        '/api/observations?bbox=-112,31,-110,33'
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control'))
        .toBe('public, s-maxage=300, stale-while-revalidate=600');
    });
  });

  // Plan 2026-05-17, Task 5 / S2 alert source. The data-staleness alert
  // (google_logging_metric.meta_freshness_seconds) pulls
  // jsonPayload.meta_freshness_seconds out of the read-api's stdout — this
  // test pins the exact log shape Cloud Logging's value_extractor expects.
  it('emits a structured meta_freshness log line on /api/observations', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const app = createApp({ pool: db.pool });
      const res = await app.request(`/api/observations?bbox=${BBOX_AZ}`);
      expect(res.status).toBe(200);
      const matches = logSpy.mock.calls
        .map(args => args[0])
        .filter((arg): arg is string => typeof arg === 'string')
        .map(line => {
          try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; }
        })
        .filter((parsed): parsed is Record<string, unknown> =>
          !!parsed && parsed.message === 'meta_freshness');
      expect(matches).toHaveLength(1);
      const entry = matches[0]!;
      expect(entry.severity).toBe('INFO');
      expect(typeof entry.meta_freshness_seconds).toBe('number');
      expect(entry.meta_freshness_seconds as number).toBeGreaterThanOrEqual(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  // When the observations table is empty, freshestObservationAt is null and
  // we deliberately do NOT emit the log (S2's value_extractor filter excludes
  // null entries; emitting noise would just inflate log-based-metric volume).
  it('does NOT emit meta_freshness log when observations table is empty', async () => {
    await db.pool.query('TRUNCATE observations');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const app = createApp({ pool: db.pool });
      const res = await app.request(`/api/observations?bbox=${BBOX_AZ}`);
      expect(res.status).toBe(200);
      const matches = logSpy.mock.calls
        .map(args => args[0])
        .filter((arg): arg is string => typeof arg === 'string')
        .filter(line => line.includes('meta_freshness'));
      expect(matches).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
      // Re-seed so subsequent tests in this describe pass
      await upsertObservations(db.pool, [
        { subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
          lat: 31.72, lng: -110.88, obsDt: new Date(Date.now() - 5*86400_000).toISOString(),
          locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
        { subId: 'S2', speciesCode: 'annhum', comName: "Anna's Hummingbird",
          lat: 32.30, lng: -110.99, obsDt: new Date(Date.now() - 20*86400_000).toISOString(),
          locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
      ]);
    }
  });
});

describe('species_meta backfill for eBird hybrid/spuh codes (#484)', () => {
  // The 10 codes from issue #484 — eBird hybrid codes that have been observed
  // in US-AZ but historically had no species_meta row, causing /api/species/:code
  // to 404 even though /api/observations returns them. Migration
  // 1700000032000_backfill_species_meta_spuh_hybrid.sql inserts these rows;
  // the ingest-time invariant in services/ingestor/src/run-ingest.ts catches
  // any future leak before it reaches the read path.
  const LEAKING_CODES = [
    'ixlbun', 'mallar4',
    'x00059', 'x00618', 'x00689', 'x00758', 'x00776',
    'x01129', 'x01172', 'x01228',
  ];

  it('every backfilled code resolves with HTTP 200 from /api/species/:code', async () => {
    const app = createApp({ pool: db.pool });
    for (const code of LEAKING_CODES) {
      const res = await app.request(`/api/species/${code}`);
      expect(res.status, `species_code ${code} should resolve 200`).toBe(200);
      const body = await res.json() as {
        speciesCode: string; comName: string; sciName: string;
        familyCode: string; familyName: string;
      };
      expect(body.speciesCode).toBe(code);
      // family_code must be lowercased scientific family name (the join key
      // used by family_silhouettes), per the convention in run-taxonomy.ts.
      expect(body.familyCode).toMatch(/^[a-z]+$/);
      // family_name carries the human-readable English label.
      expect(body.familyName.length).toBeGreaterThan(0);
      // Hybrid display name should round-trip — the comName must include
      // either ' x ' (eBird hybrid convention) or the literal word 'hybrid'.
      expect(body.comName.toLowerCase()).toMatch(/hybrid| x /);
    }
  });

  it('the acceptance invariant — every speciesCode in /api/observations resolves 200 from /api/species/:code', async () => {
    // Seed observations with each leaking code, then walk /api/observations
    // and verify every species_code there is renderable via /api/species/:code.
    // This is the acceptance assertion from #484: "Every speciesCode in
    // /api/observations resolves with HTTP 200 from /api/species/:code".
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, LEAKING_CODES.map((code, i) => ({
      subId: `S-leak-${i}`,
      speciesCode: code,
      comName: code,
      lat: 32.30,
      lng: -110.99,
      obsDt: new Date(Date.now() - i * 86400_000).toISOString(),
      locId: 'L-leak',
      locName: 'Test',
      howMany: 1,
      isNotable: false,
    })));

    const app = createApp({ pool: db.pool });
    const obsRes = await app.request('/api/observations?bbox=-112,31,-110,33');
    expect(obsRes.status).toBe(200);
    const obsBody = await obsRes.json() as {
      data: Array<{ speciesCode: string }>;
    };
    const codes = Array.from(new Set(obsBody.data.map(o => o.speciesCode)));
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      const res = await app.request(`/api/species/${code}`);
      expect(res.status, `species_code ${code} must resolve 200`).toBe(200);
    }
  });
});

describe('error handling', () => {
  it('returns 503 when DB query throws a connection error', async () => {
    const pg = await import('pg');
    const badPool = new pg.default.Pool({
      connectionString: 'postgres://nope:nope@127.0.0.1:1/none',
      max: 1,
      connectionTimeoutMillis: 200,
    });
    const app = createApp({ pool: badPool as unknown as Parameters<typeof createApp>[0]['pool'] });
    const res = await app.request('/api/hotspots');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'database unavailable' });
    await badPool.end();
  });
});

describe('GET /api/silhouettes', () => {
  it('returns all 25 seeded family silhouettes with the silhouettes cache header', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/silhouettes');
    expect(res.status).toBe(200);
    // Must come from cacheControlFor('silhouettes') — NOT a hardcoded string.
    // Both sides of the equality reference the same TTL table entry; if that
    // entry ever changes this test will flag both the route and the table.
    // No `immutable` directive: silhouette payload drifts between deploys
    // (curation, Phylopic seed expansion); see cache-headers.ts comment.
    expect(res.headers.get('cache-control'))
      .toBe('public, s-maxage=3600, stale-while-revalidate=7200');
    const body = await res.json() as Array<{
      familyCode: string; color: string; colorDark: string; svgData: string | null;
      source: string | null; license: string | null;
      commonName: string | null; creator: string | null;
    }>;
    // 15 rows from migration 9000 + 10 AZ-family expansion rows from
    // migration 15000 (issue #244) + the `_FALLBACK` row from migration
    // 18000 (issue #246) + icteridae row from migration 33000 (issue #482)
    // + 38 observed-family backfill rows from migration 34000 (issue #495)
    // → 65 total.
    expect(body).toHaveLength(65);
    // Spot-check the _FALLBACK row round-trips through the Hono response
    // so the frontend's symbol-layer fallback path can rely on it.
    const fallback = body.find(r => r.familyCode === '_FALLBACK');
    expect(fallback).toBeDefined();
    // Migration 1700000046000 lightened dark-failing colors; _FALLBACK was #555555.
    expect(fallback!.color).toBe('#626262');
    expect(fallback!.colorDark).toBe('#626262');
    const tyrannidae = body.find(r => r.familyCode === 'tyrannidae');
    // Migration 1700000046000 darkened light-failing colors; tyrannidae was #C77A2E.
    expect(tyrannidae?.color).toBe('#c3772d');
    expect(tyrannidae?.colorDark).toBe('#C77A2E');
    // commonName round-trips through Hono response (issue #249). Field
    // populated by migration 1700000019500.
    expect(tyrannidae?.commonName).toBe('Tyrant Flycatchers');
    // creator round-trips through Hono response (issue #245). Field
    // added by migration 1700000016000 + populated by 1700000017000.
    // Value is a string for families with a Phylopic creator attribution
    // and NULL for families flagged "no usable Phylopic SVG".
    expect(tyrannidae).toHaveProperty('creator');
  });

  it('provides color for every family_code present in species_meta (parity with deleted FAMILY_TO_COLOR)', async () => {
    // Issue #55 option (a): DB is now the single SOT for family colors.
    // For every family that species_meta references, the silhouettes
    // endpoint must return a color — otherwise the frontend's fallback
    // path would fire in production. Seeded species_meta at the top of
    // this suite covers tyrannidae + trochilidae; assert both resolve.
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/silhouettes');
    const body = await res.json() as Array<{ familyCode: string; color: string }>;
    const byFamily = Object.fromEntries(body.map(r => [r.familyCode, r.color]));
    // Migration 1700000046000 updated both colors for contrast compliance.
    expect(byFamily['tyrannidae']).toBe('#c3772d');  // was #C77A2E (light-failing, darkened)
    expect(byFamily['trochilidae']).toBe('#9637ad'); // was #7B2D8E (dark-failing, lightened)
  });
});

describe('GET /api/species/:code', () => {
  it('returns species meta for a known code', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/vermfly');
    expect(res.status).toBe(200);
    // No `immutable`: photo_url on species_meta is a monthly-refreshed field
    // (issue #327), so the value at this URL CAN change. CDN may serve stale
    // species data for up to 7 days after a photo write — acceptable given
    // monthly refresh cadence. See cache-headers.ts comment.
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=604800');
    const body = await res.json() as { speciesCode: string; comName: string };
    expect(body.speciesCode).toBe('vermfly');
    expect(body.comName).toBe('Vermilion Flycatcher');
  });

  it('returns 404 for unknown species', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/notreal');
    expect(res.status).toBe(404);
  });

  it('populates photoUrl/photoAttribution/photoLicense when species_photos has a detail-panel row', async () => {
    // Seed a detail-panel photo row for vermfly via insertSpeciesPhoto.
    // The route handler delegates to getSpeciesMeta which LEFT JOINs
    // species_photos (purpose='detail-panel'); the three optional fields
    // round-trip through the Hono JSON response when the JOIN matches.
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'vermfly',
      purpose: 'detail-panel',
      url: 'https://photos.example/vermfly.jpg',
      attribution: 'Photographer Name / iNaturalist',
      license: 'CC-BY-NC',
    });
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/vermfly');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      speciesCode: string;
      comName: string;
      photoUrl?: string;
      photoAttribution?: string;
      photoLicense?: string;
    };
    expect(body.speciesCode).toBe('vermfly');
    expect(body.photoUrl).toBe('https://photos.example/vermfly.jpg');
    expect(body.photoAttribution).toBe('Photographer Name / iNaturalist');
    expect(body.photoLicense).toBe('CC-BY-NC');
  });

  it('populates descriptionBody/descriptionLicense/descriptionAttributionUrl when species_descriptions has a row', async () => {
    // Seed a description row for vermfly. The route handler at app.ts:102
    // delegates to getSpeciesMeta which LEFT JOINs species_descriptions
    // (issue #372); the three optional fields round-trip through the Hono
    // JSON response when the JOIN matches.
    const descBody = 'The vermilion flycatcher is a small, brilliantly colored passerine bird. '.repeat(2);
    await insertSpeciesDescription(db.pool, {
      speciesCode: 'vermfly',
      source: 'wikipedia',
      body: descBody,
      license: 'CC-BY-SA-4.0',
      revisionId: 1234567890,
      etag: '"abc123"',
      attributionUrl: 'https://en.wikipedia.org/wiki/Vermilion_flycatcher',
    });
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/vermfly');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      speciesCode: string;
      descriptionBody?: string;
      descriptionLicense?: string;
      descriptionAttributionUrl?: string;
    };
    expect(body.speciesCode).toBe('vermfly');
    expect(body.descriptionBody).toBe(descBody);
    expect(body.descriptionLicense).toBe('CC-BY-SA-4.0');
    expect(body.descriptionAttributionUrl)
      .toBe('https://en.wikipedia.org/wiki/Vermilion_flycatcher');
  });

  it('omits the three description fields when species_descriptions has no row', async () => {
    // Seed a fresh species with neither a photo nor a description, so we can
    // assert that both projection blocks return *absent* fields (the
    // exactOptionalPropertyTypes contract from species.ts:200-205 carries
    // through to the wire — JSON serialization of an object missing the
    // key produces a body where the key is absent, deserializing as
    // `=== undefined` for consumers).
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'nodescspc', comName: 'No-Description Species',
        sciName: 'Empty descriptionicus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 99003 },
    ]);
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/nodescspc');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['speciesCode']).toBe('nodescspc');
    // The three description fields are absent from the JSON body — `in`
    // catches even an explicit `undefined` value, which would be a type
    // contract violation under exactOptionalPropertyTypes.
    expect('descriptionBody' in body).toBe(false);
    expect('descriptionLicense' in body).toBe(false);
    expect('descriptionAttributionUrl' in body).toBe(false);
  });
});

describe('GET /api/species/:code/phenology', () => {
  beforeAll(async () => {
    // Two species seeded so unknown-species 404 contrasts with known-but-
    // unobserved 200 [].
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'phenfly', comName: 'Pheno Flycatcher',
        sciName: 'Pheno test', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 99001 },
      { speciesCode: 'noobsspc', comName: 'No-Obs Species',
        sciName: 'Empty species', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 99002 },
    ]);
    await upsertObservations(db.pool, [
      { subId: 'PH1', speciesCode: 'phenfly', comName: 'Pheno Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-03-05T08:00:00Z',
        locId: 'L-PH1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'PH2', speciesCode: 'phenfly', comName: 'Pheno Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-03-15T08:00:00Z',
        locId: 'L-PH2', locName: 'Y', howMany: 1, isNotable: false },
      { subId: 'PH3', speciesCode: 'phenfly', comName: 'Pheno Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-08-12T08:00:00Z',
        locId: 'L-PH3', locName: 'Z', howMany: 1, isNotable: false },
    ]);
  });

  it('returns sparse {month, count}[] for known species with observations', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/phenfly/phenology');
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ month: number; count: number }>;
    // March (2 obs) and August (1 obs); other months absent.
    expect(body).toEqual([
      { month: 3, count: 2 },
      { month: 8, count: 1 },
    ]);
  });

  it('sets the phenology Cache-Control header on a 200 response', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/phenfly/phenology');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, s-maxage=3600, stale-while-revalidate=7200');
  });

  it('returns 200 [] for a known species with no observations', async () => {
    // 'noobsspc' is in species_meta but no observations exist for it.
    // Helper returns []; route returns 200 (not 404) because the species
    // exists. Frontend zero-fills to 12 months.
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/noobsspc/phenology');
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body).toEqual([]);
  });

  it('returns 404 {error:"not found"} for an unknown species_code', async () => {
    // Matches the species-meta route's 404 precedent; the existence check
    // uses getSpeciesMeta to avoid divergence from the sibling endpoint.
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/notrealspc/phenology');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

describe('gzip compression middleware', () => {
  beforeAll(async () => {
    // The compress middleware's default threshold is 1024 bytes — responses
    // below it are returned uncompressed. The /api/observations seed from
    // the earlier describe leaves ~2 rows (~600 bytes of JSON), so we seed
    // extra rows here to push /api/observations?since=30d comfortably past
    // the threshold and get a deterministic compression outcome.
    const extra = Array.from({ length: 20 }, (_, i) => ({
      subId: `S-gzip-${i}`,
      speciesCode: 'vermfly',
      comName: 'Vermilion Flycatcher',
      lat: 31.72 + i * 0.01,
      lng: -110.88 + i * 0.01,
      obsDt: new Date(Date.now() - i * 86400_000).toISOString(),
      locId: `L-gzip-${i}`,
      locName: `Gzip Seed Location ${i}`,
      howMany: 1,
      isNotable: false,
    }));
    await upsertObservations(db.pool, extra);
  });

  it('returns content-encoding: gzip when client accepts gzip', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?species=vermfly', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('omits content-encoding when client does not advertise gzip', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?species=vermfly');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('sets Vary: Accept-Encoding on a gzipped response', async () => {
    // Caches (CloudFlare CDN, browser caches) must vary their stored entry
    // by Accept-Encoding so they never serve a gzip body to a client that
    // didn't negotiate it.  See #143.
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?species=vermfly', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('gzip');
    expect(
      res.headers.get('vary')?.toLowerCase().includes('accept-encoding'),
    ).toBe(true);
  });
});

describe('CORS middleware', () => {
  // Save + restore FRONTEND_ORIGINS around tests that mutate it so other
  // describe blocks stay deterministic.
  const ORIGINAL_FRONTEND_ORIGINS = process.env.FRONTEND_ORIGINS;
  afterAll(() => {
    if (ORIGINAL_FRONTEND_ORIGINS === undefined) {
      delete process.env.FRONTEND_ORIGINS;
    } else {
      process.env.FRONTEND_ORIGINS = ORIGINAL_FRONTEND_ORIGINS;
    }
  });

  it('returns Access-Control-Allow-Origin for an allow-listed origin', async () => {
    delete process.env.FRONTEND_ORIGINS; // use default allowlist
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/hotspots', {
      headers: { Origin: 'https://bird-maps.com' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin'))
      .toBe('https://bird-maps.com');
  });

  it('omits Access-Control-Allow-Origin for a disallowed origin', async () => {
    delete process.env.FRONTEND_ORIGINS;
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/hotspots', {
      headers: { Origin: 'https://evil.example' },
    });
    // Hono's cors omits the ACAO header entirely (rather than echoing) for
    // origins not in the allowlist — browsers treat the absence as a block.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('responds 204 to an OPTIONS preflight with allow-methods: GET', async () => {
    delete process.env.FRONTEND_ORIGINS;
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://bird-maps.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin'))
      .toBe('https://bird-maps.com');
    // Header value may be a single method or CSV; assert GET is present.
    expect(res.headers.get('access-control-allow-methods') ?? '')
      .toMatch(/GET/);
  });

  it('trims whitespace when parsing FRONTEND_ORIGINS', async () => {
    // Leading/trailing whitespace in each comma-separated entry must be
    // stripped; otherwise Hono's array-origin matcher (strict .includes)
    // silently rejects the browser's exact Origin header.
    process.env.FRONTEND_ORIGINS = ' https://a.test , https://b.test ';
    const app = createApp({ pool: db.pool });
    const resA = await app.request('/api/hotspots', {
      headers: { Origin: 'https://a.test' },
    });
    const resB = await app.request('/api/hotspots', {
      headers: { Origin: 'https://b.test' },
    });
    expect(resA.headers.get('access-control-allow-origin')).toBe('https://a.test');
    expect(resB.headers.get('access-control-allow-origin')).toBe('https://b.test');
  });

  it('sets Vary: Origin on a cached route so CDN keys per-origin', async () => {
    // `/api/species/:code` is served with `Cache-Control: public, max-age=604800`
    // (no `immutable` — photo_url drifts on a monthly cadence, see #327).
    // With `Vary: Origin`, a spec-compliant CDN caches a separate entry per
    // Origin. That multiplies the cache namespace N× for N allowed origins
    // (trivial at 3, callable-out if that grows) but keeps the ACAO header
    // correct for each cached response. The body itself is Origin-agnostic.
    delete process.env.FRONTEND_ORIGINS;
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/vermfly', {
      headers: { Origin: 'https://bird-maps.com' },
    });
    expect(res.status).toBe(200);
    const vary = res.headers.get('vary') ?? '';
    expect(vary.toLowerCase()).toContain('origin');
    // Coexists with route-level Cache-Control.
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=604800');
  });
});
