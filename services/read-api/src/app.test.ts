import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
import type { Pool } from '@bird-watch/db-client';
import {
  upsertHotspots,
  upsertSpeciesMeta,
  upsertObservations,
  insertSpeciesPhoto,
  insertSpeciesDescription,
  refreshGridAgg,
} from '@bird-watch/db-client';
import { createApp } from './app.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('GET /health', () => {
  it('returns 200 {ok:true} when the DB probe succeeds (#821)', async () => {
    // Healthy path: the real testcontainer pool answers SELECT 1, so the
    // deepened probe returns 200. This guards against a regression where the
    // handler reports healthy without actually round-tripping the DB.
    const app = createApp({ pool: db.pool });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('returns 503 when the DB probe fails (#821)', async () => {
    // DB-down path: a typed fake Pool DI double whose query() rejects. This is
    // dependency-injection substitution at the createApp seam, NOT a pg-driver
    // mock — the no-DB-mocks rule (CLAUDE.md) bans vi.mock('pg'), not Pool-
    // shaped doubles. The handler catches in-place and returns 503 directly
    // (not via app.onError, which would map a generic throw to 500), so the
    // 503 is deterministic regardless of the rejection's error shape.
    const failingPool = {
      query: () => Promise.reject(new Error('connection terminated')),
    } as unknown as Pool;
    const app = createApp({ pool: failingPool });
    const res = await app.request('/health');
    expect(res.status).toBe(503);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});

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
    meta: { freshestObservationAt: string | null; truncated?: boolean };
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
      .toBe('public, s-maxage=2400, stale-while-revalidate=2400');
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

  // #733 (plan task B6) — the per-observation row brake surfaces as
  // meta.truncated. A truncated body sets truncated:true; a normal body omits
  // the field entirely (consumers treat absence as "not truncated").
  it('omits meta.truncated on a normal (non-truncated) observations response (#733 B6)', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations?bbox=${BBOX_AZ}`);
    expect(res.status).toBe(200);
    const body = await res.json() as ObsEnvelope;
    // Two seeded rows, well under the 10000 brake → field is absent.
    expect(body.meta.truncated).toBeUndefined();
    expect('truncated' in body.meta).toBe(false);
  });

  it('surfaces meta.truncated:true when the species row brake fires (#733 B6)', async () => {
    // Seed 5001 rows of one species (no bbox → species deep-link path). The
    // 5000 species cap fires, so the body is truncated. Use a wide CONUS bbox-
    // free species query (?species=) which #667 C.1 accepts without a bbox.
    await db.pool.query('TRUNCATE observations');
    await db.pool.query(`
      INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
      VALUES ('hossp1', 'House Sparrow', 'Passer domesticus', 'passeridae', 'Old World Sparrows', 999999)
      ON CONFLICT (species_code) DO NOTHING
    `);
    await db.pool.query(`
      INSERT INTO observations
        (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
      SELECT
        'S-trunc-' || g::text, 'hossp1',
        31.72 + (g * 0.0001), -110.88 - (g * 0.0001),
        now() - (g * interval '1 second'),
        'L-trunc', 'Trunc Test Loc', 1, false
      FROM generate_series(1, 5001) g
    `);
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations?species=hossp1');
    expect(res.status).toBe(200);
    const body = await res.json() as ObsEnvelope;
    expect(body.data).toHaveLength(5000);
    expect(body.meta.truncated).toBe(true);

    // Re-seed so subsequent tests in this describe are not affected.
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
      // Sunset header is anchored to a fixed UTC date (2026-06-01) rather
      // than `now() + 14d`, so the deprecation window is a real deadline.
      expect(res.headers.get('sunset')).toBe(new Date('2026-06-01T00:00:00Z').toUTCString());
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
  // hits aggregated mode (no cap); zoom >= 6 enforces 45° lng × 25° lat.
  describe('per-axis bbox cap (#667 Scope C.2)', () => {
    it('rejects too-wide lng span at zoom=8 with descriptive body', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(
        '/api/observations?bbox=-140,30,-90,40&zoom=8',
      );
      expect(res.status).toBe(400);
      const body = await res.json() as {
        error: string; maxLngSpan: number; maxLatSpan: number; hint: string;
      };
      expect(body.error).toBe('bbox too large');
      expect(body.maxLngSpan).toBe(45);
      expect(body.maxLatSpan).toBe(25);
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
        buckets?: Array<{
          count: number;
          speciesCount: number;
          families: Array<{
            code: string;
            count: number;
            speciesCount: number;
            species: Array<{ code: string; count: number }>;
          }>;
        }>;
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
      // #859 — families now nest real species (code+count), not bare codes.
      const allFamilies = body.buckets!.flatMap(b => b.families);
      expect(allFamilies.length).toBeGreaterThan(0);
      for (const fam of allFamilies) {
        expect(typeof fam.code).toBe('string');
        expect(Array.isArray(fam.species)).toBe(true);
        expect(fam.species.length).toBeGreaterThan(0);
        expect(typeof fam.species[0]!.code).toBe('string');
        expect(typeof fam.species[0]!.count).toBe('number');
      }
      // The seeded species codes ride the wire directly (vermfly/annhum).
      const speciesCodes = allFamilies.flatMap(f => f.species.map(s => s.code)).sort();
      expect(speciesCodes).toEqual(['annhum', 'vermfly']);
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

    it('preserves the s-maxage=2400 cache header when bbox present', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(
        '/api/observations?bbox=-112,31,-110,33'
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control'))
        .toBe('public, s-maxage=2400, stale-while-revalidate=2400');
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

  // #734 (plan task B5) — `?state=US-XX` is wired through app.ts into
  // ObservationFilters.stateCode (parsed by parseState/#729) and clipped by
  // the data layer (ST_Intersects against state_boundaries/#733). The clip
  // applies in BOTH per-observation and aggregated modes because
  // filters.stateCode is set before the aggregated-mode branch. The state
  // codes here resolve against the 49 CONUS rows seeded by migration
  // 1700000050000_state_boundaries.sql, which startTestDb() applies.
  describe('?state= scope (#734 B5)', () => {
    // Re-seed an AZ-ONLY fixture so the US-FL empty-scope assertion is exact.
    // S1/S2 both fall inside the Arizona polygon; there is deliberately NO
    // Florida row, so `?state=US-FL` must come back empty.
    beforeAll(async () => {
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

    it('(a) ?state=US-AZ with no bbox → 200 observations + AZ rows (guard accepts state)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?state=US-AZ');
      expect(res.status).toBe(200);
      const body = await res.json() as { mode: string } & ObsEnvelope;
      expect(body.mode).toBe('observations');
      // Both seeded rows fall inside Arizona; the polygon clip keeps both.
      expect(body.data.map(o => o.subId).sort()).toEqual(['S1', 'S2']);
    });

    it('(b) ?state=US-FL → 200 empty (empty-scope path; AZ-only seed has no FL row)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?state=US-FL');
      expect(res.status).toBe(200);
      const body = await res.json() as { mode: string } & ObsEnvelope;
      expect(body.mode).toBe('observations');
      // No Florida observations exist — the ST_Intersects clip excludes the
      // AZ rows. Empty result, NOT a 404 or error.
      expect(body.data).toEqual([]);
    });

    it('(c) ?state=banana → 400 invalid state', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?state=banana');
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('invalid state');
    });

    it('(c) ?state=US-AK → 400 invalid state (Alaska is outside the CONUS allowlist)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?state=US-AK');
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('invalid state');
    });

    it('(d) ?state=US-AZ&bbox=... ANDs the state clip with the bbox', async () => {
      const app = createApp({ pool: db.pool });
      // This bbox contains only S1 (31.72, -110.88); excludes S2 (32.30,
      // -110.99). Both are inside Arizona, so the state clip alone keeps both —
      // the narrowing to S1 proves the bbox AND-composes with the state clip.
      const res = await app.request(
        '/api/observations?state=US-AZ&bbox=-111,31.5,-110.85,31.9',
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { mode: string } & ObsEnvelope;
      expect(body.mode).toBe('observations');
      expect(body.data.map(o => o.subId)).toEqual(['S1']);
    });

    it('(e) ?state=US-AZ&zoom=4&bbox=... → mode=aggregated (clip applies in aggregated mode)', async () => {
      const app = createApp({ pool: db.pool });
      const res = await app.request(
        '/api/observations?state=US-AZ&bbox=-112,31,-110,33&zoom=4',
      );
      expect(res.status).toBe(200);
      const body = await res.json() as {
        mode: string;
        buckets?: Array<{ count: number }>;
      };
      expect(body.mode).toBe('aggregated');
      expect(Array.isArray(body.buckets)).toBe(true);
      // Both AZ rows fall in the bbox AND the Arizona polygon → total count 2.
      const total = body.buckets!.reduce((s, b) => s + b.count, 0);
      expect(total).toBe(2);
    });

    it('(e) aggregated state clip excludes out-of-state rows (US-FL → empty buckets)', async () => {
      const app = createApp({ pool: db.pool });
      // A CONUS-wide bbox + zoom<6 (aggregated) clipped to Florida. The AZ
      // rows are outside the FL polygon, so the aggregated result is empty —
      // this is the aggregated-mode counterpart to case (b) and proves the
      // clip is applied before, not after, the aggregation branch.
      const res = await app.request(
        '/api/observations?state=US-FL&bbox=-125,24,-66,50&zoom=4',
      );
      expect(res.status).toBe(200);
      const body = await res.json() as {
        mode: string;
        buckets?: Array<{ count: number }>;
      };
      expect(body.mode).toBe('aggregated');
      const total = body.buckets!.reduce((s, b) => s + b.count, 0);
      expect(total).toBe(0);
    });

    it('(f) ?state= request rides the shared observations cache header (#734 B7)', async () => {
      // #734 B7 — `?state=` rides the existing full-URL cache key exactly like
      // `?bbox=`. The observations TTL is the shared cache-headers.ts value
      // (raised to s-maxage=1800/SWR=1800 in #868, then 2400/2400 in #870);
      // `?state=` does not special-case it.
      const app = createApp({ pool: db.pool });
      const res = await app.request('/api/observations?state=US-AZ');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control'))
        .toBe('public, s-maxage=2400, stale-while-revalidate=2400');
    });

    // Restore the canonical S1/S2 fixture for any later describe that assumes
    // the post-suite table state.
    afterAll(async () => {
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
  });
});

// ── #878 — precompute read-path routing ─────────────────────────────────────
//
// The aggregated low-zoom default view (state scope or national, default since,
// no filters, standard multiplier) must route to the PRECOMPUTE LOOKUP
// (observation_grid_agg); any filter / non-default since routes to the live CTE
// FALLBACK. The discriminator: refresh the grid, then mutate `observations`
// WITHOUT refreshing. An eligible request returns the STALE precomputed grid
// (proving it read the cache); an ineligible request reflects the live mutated
// table (proving it ran the CTE). Both paths return mode=aggregated, identical
// envelope shape.
describe('GET /api/observations precompute routing (#878)', () => {
  const AZ_ENVELOPE = '-114.81651,31.33218,-109.04528,37.00426';
  const seedAzRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      subId: `G${i}`, speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
      lat: 33.45, lng: -112.07,
      obsDt: new Date(Date.now() - (i % 10) * 86400_000).toISOString(),
      locId: 'L1', locName: 'X', howMany: 1, isNotable: i % 4 === 0,
    }));

  beforeAll(async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, seedAzRows(40));
    // Build the precompute grid for the current table state.
    await refreshGridAgg(db.pool);
  });

  afterAll(async () => {
    await db.pool.query('TRUNCATE observations');
    await db.pool.query('DELETE FROM observation_grid_agg');
    await upsertObservations(db.pool, [
      { subId: 'S1', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: new Date(Date.now() - 5*86400_000).toISOString(),
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
    ]);
  });

  type AggEnvelope = { mode: string; buckets: Array<{ count: number }> };
  const totalCount = (b: AggEnvelope) => b.buckets.reduce((s, x) => s + x.count, 0);

  it('default state scope (state + envelope bbox, default since, z5) routes to the LOOKUP and is sub-second', async () => {
    const app = createApp({ pool: db.pool });
    const t0 = performance.now();
    const res = await app.request(
      `/api/observations?state=US-AZ&bbox=${AZ_ENVELOPE}&zoom=5&since=14d`,
    );
    const elapsedMs = performance.now() - t0;
    expect(res.status).toBe(200);
    const body = await res.json() as AggEnvelope;
    expect(body.mode).toBe('aggregated');
    // The precompute carries all 40 seeded AZ rows.
    expect(totalCount(body)).toBe(40);
    // Cheap PK lookup — comfortably sub-second.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('the default lookup returns the STALE grid after an unrefreshed mutation (proves it read the cache, not the live CTE)', async () => {
    // Mutate observations WITHOUT refreshing the grid: delete half the rows.
    await db.pool.query(`DELETE FROM observations WHERE sub_id LIKE 'G2%' OR sub_id LIKE 'G3%'`);
    const app = createApp({ pool: db.pool });
    const res = await app.request(
      `/api/observations?state=US-AZ&bbox=${AZ_ENVELOPE}&zoom=5&since=14d`,
    );
    const body = await res.json() as AggEnvelope;
    // Still 40 — the lookup served the pre-mutation precompute, NOT the live
    // (now-smaller) table. This is the load-bearing proof the default routes to
    // the cache.
    expect(totalCount(body)).toBe(40);
    // Re-seed so the next test's fallback math is from a known state.
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, seedAzRows(40));
  });

  it('a notable filter routes to the live FALLBACK (reflects the live table, ignores the cache)', async () => {
    // Grid was last refreshed with 40 rows; the live notable subset is the
    // i%4===0 rows = 10 of 40. A notable request must NOT use the cache (the
    // precompute carries no notable-only variant), so it must report the live
    // notable count, not the 40-row cached total.
    const app = createApp({ pool: db.pool });
    const res = await app.request(
      `/api/observations?state=US-AZ&bbox=${AZ_ENVELOPE}&zoom=5&since=14d&notable=true`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as AggEnvelope;
    expect(body.mode).toBe('aggregated');
    expect(totalCount(body)).toBe(10);
  });

  it('a non-default since routes to the live FALLBACK', async () => {
    // since=7d keeps only rows aged 0..6 days = ages {0,1,2,3,4,5,6} of the i%10
    // cycle → 4 full decades of 7 + remainder. We assert it differs from the
    // cached 40 by reflecting the live since-filtered subset (i.e. < 40), which
    // only the live CTE can produce.
    const app = createApp({ pool: db.pool });
    const res = await app.request(
      `/api/observations?state=US-AZ&bbox=${AZ_ENVELOPE}&zoom=5&since=7d`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as AggEnvelope;
    expect(body.mode).toBe('aggregated');
    // 7d window prunes the 7,8,9-day-old rows → strictly fewer than 40.
    expect(totalCount(body)).toBeLessThan(40);
    expect(totalCount(body)).toBeGreaterThan(0);
  });
});

describe('species_meta backfill for eBird hybrid/spuh codes (#484)', () => {
  // The 10 codes from issue #484 — eBird hybrid codes that have been observed
  // in US-AZ but historically had no species_meta row, causing /api/species/:code
  // to 404 even though /api/observations returns them. Migration
  // 1700000032000_backfill_species_meta_spuh_hybrid.sql inserts these rows;
  // the ingest-time invariant in services/ingestor/src/commands/run-ingest.ts catches
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
  it('returns all 96 seeded family silhouettes with the silhouettes cache header', async () => {
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
    // + 32 national-coverage rows from migration 48000 (Phase 3a US-wide
    // flip — 17 with svg_data, 15 with NULL svg_data) − 1 spelling-variant
    // dedupe from migration 52000 (#922, inverted-spelling fix: dropped the
    // no-`i` orphan `ptilogonatidae`, kept eBird-canonical `ptiliogonatidae`)
    // → 96 total.
    expect(body).toHaveLength(96);
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

describe('GET /api/states', () => {
  // The 49 CONUS state_boundaries rows are seeded by migration
  // 1700000050000_state_boundaries.sql, which startTestDb() applies — no
  // per-test seeding. This endpoint is the frontend's single source for state
  // name + bbox; the polygon geom must never appear in the body.
  it('returns 49 name-sorted StateSummary rows with the states cache header and no geom', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/states');
    expect(res.status).toBe(200);
    // Build-time-stable seed → long immutable header on both browser + CDN.
    expect(res.headers.get('cache-control'))
      .toBe('public, max-age=604800, s-maxage=604800, immutable');

    const body = await res.json() as Array<{
      stateCode: string; name: string; bbox: [number, number, number, number];
    }>;
    expect(body).toHaveLength(49);

    // Name-sorted ascending.
    const names = body.map(r => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));

    // Every row is a well-formed StateSummary; geom must never leave the server.
    for (const r of body) {
      expect(r.stateCode).toMatch(/^US-[A-Z]{2}$/);
      expect(typeof r.name).toBe('string');
      expect(r.bbox).toHaveLength(4);
      const [w, s, e, n] = r.bbox;
      expect(w).toBeLessThan(e);
      expect(s).toBeLessThan(n);
      expect(r).not.toHaveProperty('geom');
    }

    const az = body.find(r => r.stateCode === 'US-AZ');
    expect(az?.name).toBe('Arizona');
  });
});

describe('GET /api/species (dictionary, #859)', () => {
  it('returns the flat species dictionary with the long-lived cache header', async () => {
    // Seed two species; the dictionary projects each as {code,comName,familyCode}.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'annhum', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
    ]);
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, s-maxage=86400, stale-while-revalidate=172800');
    const body = await res.json() as Array<{ code: string; comName: string; familyCode: string }>;
    const verm = body.find(d => d.code === 'vermfly')!;
    expect(verm.comName).toBe('Vermilion Flycatcher');
    expect(verm.familyCode).toBe('tyrannidae');
    // Only the three wire fields are present on each entry.
    expect(Object.keys(verm).sort()).toEqual(['code', 'comName', 'familyCode']);
  });

  it('does NOT shadow the per-code detail route (GET /api/species/:code still resolves)', async () => {
    // Route-ordering guard: the no-param dictionary route must not capture a
    // request that carries a :code segment. /api/species/vermfly must still
    // return the per-species detail (200 with sciName), not the dictionary.
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/vermfly');
    expect(res.status).toBe(200);
    const body = await res.json() as { speciesCode: string; sciName: string };
    expect(body.speciesCode).toBe('vermfly');
    expect(body.sciName).toBe('Pyrocephalus rubinus');
  });
});

describe('GET /api/species/with-photos (#992)', () => {
  it('returns ONLY species with a detail-panel photo in one response with the species cache header', async () => {
    // Seed three species; give two a detail-panel photo. The INNER JOIN must
    // drop the photo-less one so the photo-curation `sync` tool enumerates the
    // observed-with-photos set in ONE call (no per-species detail walk).
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'wpvermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'wpannhum', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
      { speciesCode: 'wpmallar', comName: 'Mallard',
        sciName: 'Anas platyrhynchos', familyCode: 'anatidae',
        familyName: 'Ducks, Geese, and Waterfowl', taxonOrder: 261 },
    ]);
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'wpvermfly', purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/species/wpvermfly.jpg',
      attribution: '(c) A (CC BY)', license: 'cc-by',
    });
    await insertSpeciesPhoto(db.pool, {
      speciesCode: 'wpmallar', purpose: 'detail-panel',
      url: 'https://photos.bird-maps.com/species/wpmallar.jpg',
      attribution: '(c) B (CC BY-NC)', license: 'cc-by-nc',
    });
    // wpannhum has NO photo row → absent from the response.

    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/with-photos');
    expect(res.status).toBe(200);
    // Rides the per-species 'species' cache tier (photo_url is a
    // monthly-refreshed field — see cache-headers.ts).
    expect(res.headers.get('cache-control')).toBe('public, max-age=604800');

    const body = await res.json() as Array<{
      code: string; comName: string; sciName: string; family: string;
      photoUrl: string; photoAttribution: string; photoLicense: string;
    }>;
    const codes = body.map(r => r.code);
    expect(codes).toContain('wpvermfly');
    expect(codes).toContain('wpmallar');
    expect(codes).not.toContain('wpannhum');

    const verm = body.find(r => r.code === 'wpvermfly')!;
    expect(verm.comName).toBe('Vermilion Flycatcher');
    expect(verm.sciName).toBe('Pyrocephalus rubinus');
    expect(verm.family).toBe('Tyrant Flycatchers');
    expect(verm.photoUrl).toBe('https://photos.bird-maps.com/species/wpvermfly.jpg');
    expect(verm.photoAttribution).toBe('(c) A (CC BY)');
    expect(verm.photoLicense).toBe('cc-by');
    // Exactly the seven wire fields.
    expect(Object.keys(verm).sort())
      .toEqual(['code', 'comName', 'family', 'photoAttribution', 'photoLicense', 'photoUrl', 'sciName']);
  });

  it('is NOT shadowed by the /api/species/:code detail route', async () => {
    // Route-ordering guard: /api/species/with-photos must resolve to the
    // with-photos endpoint (an ARRAY), not the :code detail route treating
    // 'with-photos' as a species code (a 404 object).
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species/with-photos');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
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

describe('GET /api/species-in-scope', () => {
  beforeAll(async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'sis-verm', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
      { speciesCode: 'sis-anna', comName: "Anna's Hummingbird",
        sciName: 'Calypte anna', familyCode: 'trochilidae',
        familyName: 'Hummingbirds', taxonOrder: 6000 },
      // Meta-only — no observation seeded → must NEVER appear in the response.
      { speciesCode: 'sis-ghost', comName: 'Ghost Bird',
        sciName: 'Nullus avis', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 99999 },
      // Has ONLY an observation older than 14d → appears in an all-history scan
      // but NOT in the default 14d window (proves the no-since default below).
      { speciesCode: 'sis-old', comName: 'Stale Crow',
        sciName: 'Corvus vetus', familyCode: 'corvidae',
        familyName: 'Crows, Jays, and Magpies', taxonOrder: 50000 },
    ]);
    await db.pool.query("DELETE FROM observations WHERE sub_id LIKE 'SIS-%'");
    await upsertObservations(db.pool, [
      { subId: 'SIS-1', speciesCode: 'sis-verm', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: new Date(Date.now() - 3 * 86400_000).toISOString(),
        locId: 'L1', locName: 'AZ', howMany: 1, isNotable: false },
      { subId: 'SIS-2', speciesCode: 'sis-anna', comName: "Anna's Hummingbird",
        lat: 32.30, lng: -110.99, obsDt: new Date(Date.now() - 4 * 86400_000).toISOString(),
        locId: 'L2', locName: 'AZ', howMany: 1, isNotable: true },
      { subId: 'SIS-OLD', speciesCode: 'sis-old', comName: 'Stale Crow',
        lat: 32.30, lng: -110.99, obsDt: new Date(Date.now() - 30 * 86400_000).toISOString(),
        locId: 'L3', locName: 'AZ', howMany: 1, isNotable: false },
    ]);
  });

  type SisRow = { code: string; comName: string; familyCode: string };

  it('defaults the window to 14d when ?since= is absent (excludes a >14d-old observation)', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species-in-scope');
    expect(res.status).toBe(200);
    const codes = ((await res.json()) as SisRow[]).map(r => r.code);
    // Recent species present; the all-history-only species is excluded by the
    // 14d default (an unbounded scan would have included sis-old).
    expect(codes).toContain('sis-verm');
    expect(codes).not.toContain('sis-old');
  });

  it('returns represented species as {code,comName,familyCode}[], comName-sorted, excluding unobserved meta rows', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species-in-scope?since=14d');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as SisRow[];
    const codes = rows.map(r => r.code);
    // sis-ghost (meta-only) excluded; the two observed appear comName-sorted
    // (Anna's Hummingbird before Vermilion Flycatcher).
    expect(codes).toContain('sis-verm');
    expect(codes).toContain('sis-anna');
    expect(codes).not.toContain('sis-ghost');
    const annaIdx = codes.indexOf('sis-anna');
    const vermIdx = codes.indexOf('sis-verm');
    expect(annaIdx).toBeLessThan(vermIdx);
    const anna = rows.find(r => r.code === 'sis-anna')!;
    expect(Object.keys(anna).sort()).toEqual(['code', 'comName', 'familyCode']);
  });

  it('honors the ?family= filter', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species-in-scope?since=14d&family=trochilidae');
    expect(res.status).toBe(200);
    const rows = (await res.json()) as SisRow[];
    const codes = rows.map(r => r.code);
    expect(codes).toContain('sis-anna');
    expect(codes).not.toContain('sis-verm');
  });

  it('rejects an invalid ?state= with 400 (shared allowlist validation)', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species-in-scope?state=US-ZZ');
    expect(res.status).toBe(400);
  });

  it('sets the species-scope Cache-Control tier', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/species-in-scope?since=14d');
    expect(res.headers.get('cache-control'))
      .toBe('public, s-maxage=3600, stale-while-revalidate=86400');
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

  // #1278 — no-Origin cache poisoning. The cache-warm cron, uptime probes, and
  // `curl` fetch the canonical `/api/observations` URLs with NO Origin header.
  // Before the fix, Hono's cors set no ACAO on that path, so Cloudflare cached
  // a header-less body under the `Vary: Origin` "(absent)" slot and (with
  // tiered-cache variant collapse) served it to real browsers → intermittent
  // CORS error on the national prefetch. The fix emits ACAO for the canonical
  // origin whenever the request has no Origin header, so the warm-seeded cache
  // entry is never header-less.
  it('sets Access-Control-Allow-Origin to the canonical origin on a no-Origin request (#1278)', async () => {
    delete process.env.FRONTEND_ORIGINS; // canonical = https://bird-maps.com
    const app = createApp({ pool: db.pool });
    // No Origin header — exactly what run-cache-warm.ts and probes send.
    const res = await app.request('/api/hotspots');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin'))
      .toBe('https://bird-maps.com');
  });

  it('keeps Access-Control-Allow-Origin on a no-Origin 503 from app.onError (#1278)', async () => {
    delete process.env.FRONTEND_ORIGINS;
    // A pool whose query rejects with a connection error → app.onError → 503.
    // The CORS middleware runs before route handlers, so ACAO is set on the
    // pre-next pass and must survive the error-path response. A cron-warmed
    // 503/5xx that lacks ACAO is the worst poison — it both fails AND is
    // cacheable on the stale-while-revalidate window.
    const failingPool = {
      query: () => Promise.reject(Object.assign(new Error('connection terminated'), { code: 'ECONNREFUSED' })),
    } as unknown as Pool;
    const app = createApp({ pool: failingPool });
    const res = await app.request('/api/hotspots'); // no Origin header
    expect(res.status).toBe(503);
    expect(res.headers.get('access-control-allow-origin'))
      .toBe('https://bird-maps.com');
  });

  it('keeps Access-Control-Allow-Origin on an allow-listed-Origin 503 (#1278)', async () => {
    delete process.env.FRONTEND_ORIGINS;
    const failingPool = {
      query: () => Promise.reject(Object.assign(new Error('connection terminated'), { code: 'ECONNREFUSED' })),
    } as unknown as Pool;
    const app = createApp({ pool: failingPool });
    const res = await app.request('/api/hotspots', {
      headers: { Origin: 'https://bird-maps.com' },
    });
    expect(res.status).toBe(503);
    expect(res.headers.get('access-control-allow-origin'))
      .toBe('https://bird-maps.com');
  });

  it('keeps Access-Control-Allow-Origin on a 429 rate-limit response (#1278)', async () => {
    // Lock in the origin guarantee on the rate-limit short-circuit path so a
    // future refactor can't silently move CORS after the rate-limiter. CORS is
    // registered before rateLimitFromEnv, so the 429 (built downstream) still
    // carries the ACAO set on the cors pre-next pass.
    const savedOrigins = process.env.FRONTEND_ORIGINS;
    const savedEnabled = process.env.RATE_LIMIT_ENABLED;
    const savedBurst = process.env.READ_API_RATE_BURST;
    const savedRefill = process.env.READ_API_RATE_REFILL_PER_SEC;
    delete process.env.FRONTEND_ORIGINS;
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.READ_API_RATE_BURST = '1';
    process.env.READ_API_RATE_REFILL_PER_SEC = '0';
    try {
      const app = createApp({ pool: db.pool });
      const headers = { Origin: 'https://bird-maps.com' };
      // First request consumes the single burst token (200).
      const ok = await app.request('/api/hotspots', { headers });
      expect(ok.status).toBe(200);
      // Second request is rate-limited.
      const limited = await app.request('/api/hotspots', { headers });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('access-control-allow-origin'))
        .toBe('https://bird-maps.com');
    } finally {
      if (savedOrigins === undefined) delete process.env.FRONTEND_ORIGINS;
      else process.env.FRONTEND_ORIGINS = savedOrigins;
      if (savedEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED;
      else process.env.RATE_LIMIT_ENABLED = savedEnabled;
      if (savedBurst === undefined) delete process.env.READ_API_RATE_BURST;
      else process.env.READ_API_RATE_BURST = savedBurst;
      if (savedRefill === undefined) delete process.env.READ_API_RATE_REFILL_PER_SEC;
      else process.env.READ_API_RATE_REFILL_PER_SEC = savedRefill;
    }
  });

  it('still omits Access-Control-Allow-Origin for a present-but-disallowed origin (#1278)', async () => {
    // The no-Origin fix must not weaken the disallowed-origin guarantee: a
    // browser sending a non-allow-listed Origin still gets no ACAO so the
    // browser blocks the cross-origin read.
    delete process.env.FRONTEND_ORIGINS;
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/hotspots', {
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

// #1300 (B1) — the single-cell sightings-log route. A thin adapter over
// getCellObservations: validates species/scope/m/lng/lat/since, derives the
// cell, and returns CellObservationsResponse ({ data, meta: {
// cellObservationCount, truncated } }). All SQL lives in db-client; this only
// pins the route contract (param validation + the meta shape + cache tier).
describe('GET /api/observations/cell (#1300)', () => {
  // m=2 cell, bucket center (-111.0, 32.0) — an Arizona interior cell. half =
  // 0.5/2 = 0.25 → envelope [-111.25, 31.75, -110.75, 32.25].
  const CELL = 'species=vermfly&scope=US&m=2&lng=-111.0&lat=32.0';

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
      // Four vermfly rows AT the cell center, distinct ages (DESC + since).
      { subId: 'C-6h', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.0, lng: -111.0, obsDt: new Date(Date.now() - 6 * 3_600_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 2, isNotable: false },
      { subId: 'C-2d', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.0, lng: -111.0, obsDt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 1, isNotable: false },
      { subId: 'C-3d', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.0, lng: -111.0, obsDt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 1, isNotable: true },
      { subId: 'C-10d', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.0, lng: -111.0, obsDt: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 1, isNotable: false },
      // Different species, same cell → excluded by the species filter.
      { subId: 'C-OTHER', speciesCode: 'annhum', comName: "Anna's Hummingbird",
        lat: 32.0, lng: -111.0, obsDt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        locId: 'L1', locName: 'Center', howMany: 1, isNotable: false },
      // Same species, adjacent cell → outside the target envelope.
      { subId: 'C-ADJ', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.0, lng: -110.5, obsDt: new Date(Date.now() - 1 * 86_400_000).toISOString(),
        locId: 'L2', locName: 'Adjacent', howMany: 1, isNotable: false },
    ]);
  });

  type CellEnvelope = {
    data: Array<{ subId: string; familyCode?: string | null; [k: string]: unknown }>;
    meta: { cellObservationCount: number; truncated: boolean };
  };

  it('returns the target species in the cell with the observations cache tier', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations/cell?${CELL}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control'))
      .toBe('public, s-maxage=2400, stale-while-revalidate=2400');
    const body = await res.json() as CellEnvelope;
    // Four center vermfly rows (annhum + adjacent excluded), newest-first.
    expect(body.data.map(o => o.subId)).toEqual(['C-6h', 'C-2d', 'C-3d', 'C-10d']);
    expect(body.data[0]!.familyCode).toBe('tyrannidae');
  });

  it('returns meta exactly { cellObservationCount, truncated } — no freshest field', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations/cell?${CELL}`);
    const body = await res.json() as CellEnvelope;
    expect(body.meta).toEqual({ cellObservationCount: 4, truncated: false });
    expect('freshestObservationAt' in body.meta).toBe(false);
  });

  it('forwards since to the query (since=1d returns only the windowed rows)', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations/cell?${CELL}&since=1d`);
    expect(res.status).toBe(200);
    const body = await res.json() as CellEnvelope;
    // Only the 6h-old row is within 1d; the denominator drops to the window.
    expect(body.data.map(o => o.subId)).toEqual(['C-6h']);
    expect(body.meta.cellObservationCount).toBe(1);
  });

  it('applies the state clip when scope is a US-XX code', async () => {
    const app = createApp({ pool: db.pool });
    // All four center rows are in Arizona, so US-AZ returns the same set.
    const res = await app.request(`/api/observations/cell?species=vermfly&scope=US-AZ&m=2&lng=-111.0&lat=32.0`);
    expect(res.status).toBe(200);
    const body = await res.json() as CellEnvelope;
    expect(body.data.map(o => o.subId)).toEqual(['C-6h', 'C-2d', 'C-3d', 'C-10d']);
  });

  it('400s when species is missing', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations/cell?scope=US&m=2&lng=-111.0&lat=32.0');
    expect(res.status).toBe(400);
  });

  it('400s when m is not in STANDARD_GRID_MULTIPLIERS (m=3)', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations/cell?species=vermfly&scope=US&m=3&lng=-111.0&lat=32.0');
    expect(res.status).toBe(400);
  });

  it.each(['abc', '', 'NaN', 'Infinity'])('400s on non-finite lng=%s', async (lng) => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(
      `/api/observations/cell?species=vermfly&scope=US&m=2&lng=${encodeURIComponent(lng)}&lat=32.0`,
    );
    expect(res.status).toBe(400);
  });

  it('400s on non-finite lat', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations/cell?species=vermfly&scope=US&m=2&lng=-111.0&lat=abc');
    expect(res.status).toBe(400);
  });

  it('400s on a bad since value', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request(`/api/observations/cell?${CELL}&since=banana`);
    expect(res.status).toBe(400);
  });

  it('400s on an invalid scope', async () => {
    const app = createApp({ pool: db.pool });
    const res = await app.request('/api/observations/cell?species=vermfly&scope=US-ZZ&m=2&lng=-111.0&lat=32.0');
    expect(res.status).toBe(400);
  });
});
